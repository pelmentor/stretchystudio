// @ts-check

/**
 * v3 Phase 1A — Outliner editor.
 *
 * Single canonical tree (Blender's "View Layer" pattern) with a header
 * dropdown that switches the *scope* of the visible rows. Three scopes
 * today:
 *
 *   - **View Layer** (default): full unified tree. Project hierarchy
 *     (parts + groups + bones inline) plus deformer nodes (warps +
 *     rotations from BFA-006 Phase 1+3, living in `project.nodes`
 *     under their chain parent). Bones get the bone icon via `isBone`,
 *     deformers via `isDeformer` + `deformerKind`, so a glance at
 *     the tree tells you what's what without flipping modes.
 *   - **Armature**: bones-only filter — only `boneRole`-tagged
 *     groups, bone-to-bone parent chain (non-bone groups skipped on
 *     the way up). Click → highlights the bone in SkeletonOverlay.
 *   - **Deformer Graph**: deformer-only view (rigSpec graph; warps +
 *     rotations + their art-mesh leaves).
 *
 * **Blender deviation (F-4 partial — 2026-05-16 UI fidelity sweep)**:
 * Blender's `SO_VIEW_LAYER` enum (`reference/blender/source/blender/
 * makesdna/DNA_space_enums.h:228-246`) ships display modes View Layer
 * / Scenes / Blender File / Data API / Orphan Data / Library Overrides.
 * SS's "Armature" and "Deformer Graph" modes are NOT in that enum —
 * they are SS-specific tree shapes. The full F-4 fix would fold
 * "Armature" into a `use_filter_object_armature`-style filter check
 * inside OUTLINER_PT_filter while keeping the View Layer tree shape;
 * this requires the broader filter set to land first. Tracked.
 *
 * Header right-side filter popover (Funnel icon) mirrors Blender's
 * `OUTLINER_PT_filter` (`scripts/startup/bl_ui/space_outliner.py:403`)
 * with a starter filter set: "Show Selected Only" + "Hide Hidden".
 *
 * Why a single tree + dropdown (vs. the old 3 tabs): Blender's
 * Outliner has ONE tree and a header dropdown that filters scope.
 * Three tabs broke that muscle memory and duplicated bones across
 * Hierarchy + Skeleton modes. Plan: docs/archive/plans-shipped/BLENDER_FIDELITY_AUDIT.md.
 *
 * @module v3/editors/outliner/OutlinerEditor
 */

import { useMemo, useCallback, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useRigSpecStore } from '../../../store/rigSpecStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { selectAndMirror } from '../../../lib/selectionSync.js';
import { buildOutlinerTree, walkOutlinerTree } from './treeBuilder.js';
import { isBoneGroup } from '../../../store/objectDataAccess.js';
import { isWarpLatticeNode } from '../../../store/warpLatticeAccess.js';
import { filterOutlinerTree, filterOutlinerTreeByPredicate } from './filters.js';
import { TreeNode } from './TreeNode.jsx';

// F-1 sweep — header chrome (display-mode dropdown, search, filter
// popover) lifted into `src/v3/headers/OutlinerHeader.jsx` and rendered
// in the per-area Header slot. State source-of-truth is `editorStore`
// (slots `outlinerMode`, `outlinerSearchQuery`, `outlinerShowSelectedOnly`,
// `outlinerHideHidden`); both header and body subscribe independently.

export function OutlinerEditor() {
  const nodes = useProjectStore((s) => s.project.nodes);
  const updateProject = useProjectStore((s) => s.updateProject);
  const rigSpec = useRigSpecStore((s) => s.rigSpec);

  const items = useSelectionStore((s) => s.items);
  // 2026-06-10 selection-split fix. Outliner clicks used to write only
  // to `useSelectionStore` (typed items), leaving `editorStore.selection`
  // stale. The Gizmo / Properties / canvas-modal G/R/S read editorStore,
  // so picking a bone in the Outliner left the gizmo pointed at the
  // PREVIOUS selection — user pressed R and rotated a different bone
  // than the one highlighted in the canvas. Route every Outliner
  // selection write through `selectAndMirror` so the two stores stay
  // in sync (no-op for non-node types like deformers).
  const select = useSelectionStore((s) => s.select);  // retained for legacy callers below

  // PP2-010(b) — per-warp visibility map. Rig-mode warp rows surface
  // an eye icon that flips this entry; WarpDeformerOverlay reads the
  // map to filter which lattices it paints. `viewLayers.warpGridVisibility`
  // is always populated as `{}` in editorStore initial state.
  const warpGridVisibility = useEditorStore((s) => s.viewLayers.warpGridVisibility);
  const toggleWarpGridVisibility = useEditorStore((s) => s.toggleWarpGridVisibility);

  // F-1 sweep — header state lifted to editorStore so the per-area
  // OutlinerHeader can write while the body reads.
  const mode = useEditorStore((s) => s.outlinerMode);
  const query = useEditorStore((s) => s.outlinerSearchQuery);
  const showSelectedOnly = useEditorStore((s) => s.outlinerShowSelectedOnly);
  const hideHidden = useEditorStore((s) => s.outlinerHideHidden);
  // Collapsed-set stays local — it's per-render-instance ephemeral
  // (Blender's outliner restores expansion via the .blend file but
  // SS doesn't persist UI tree state).
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));

  const roots = useMemo(() => {
    if (mode === 'rig') return buildOutlinerTree(rigSpec, { mode: 'rig' });
    if (mode === 'skeleton') return buildOutlinerTree(nodes, { mode: 'skeleton' });
    // viewLayer (default): unified tree composed from both project
    // nodes AND rigSpec.
    return buildOutlinerTree({ nodes, rigSpec }, { mode: 'viewLayer' });
  }, [mode, nodes, rigSpec]);

  // Whether the project has any boneRole-tagged groups. Used by the
  // empty-state message (the "skeleton mode disabled" hint lives in
  // OutlinerHeader; this signal stays local for the empty-state copy).
  const hasArmature = useMemo(
    () => nodes.some((n) => isBoneGroup(n)),
    [nodes],
  );

  // Pre-compute the selection-id set (used by the "Show Selected Only"
  // filter so the predicate is O(1) per node).
  const selectionIdSet = useMemo(() => {
    const s = new Set();
    for (const it of items) s.add(it.id);
    return s;
  }, [items]);

  // Apply search filter (substring) + the OUTLINER_PT_filter starter
  // predicates. Each layer keeps the ancestor chain of any kept row.
  const filteredRoots = useMemo(() => {
    let r = roots;
    if (query.trim()) r = filterOutlinerTree(r, query.trim());
    if (hideHidden) r = filterOutlinerTreeByPredicate(r, (n) => n.visible !== false);
    if (showSelectedOnly && selectionIdSet.size > 0) {
      r = filterOutlinerTreeByPredicate(r, (n) => selectionIdSet.has(n.id));
    }
    return r;
  }, [roots, query, hideHidden, showSelectedOnly, selectionIdSet]);

  // Selection lookup — selectionStore items can be any type; we
  // surface the ones whose type matches the current display mode's
  // node types so a selected deformer stays highlighted in rig mode
  // and ditto a selected part in hierarchy mode.
  const selectedIds = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      if (mode === 'rig') {
        if (it.type === 'deformer' || it.type === 'part') s.add(it.id);
      } else if (mode === 'skeleton') {
        // Armature-data view is bone-only; only group selections matter
        // here. (Bones are stored as `type:'group'` with `boneRole`.)
        // F-4 sweep will replace this display-mode with an
        // OUTLINER_PT_filter-style popover that filters the View Layer
        // tree by Object type instead of branching on a separate enum.
        if (it.type === 'group') s.add(it.id);
      } else {
        // viewLayer: unified tree carries both project nodes and
        // deformers, so any selection type can show up here. v43 — lattice
        // (warp) objects are `type:'object'`.
        if (it.type === 'part' || it.type === 'group' || it.type === 'deformer' || it.type === 'object') s.add(it.id);
      }
    }
    return s;
  }, [items, mode]);

  const activeId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (mode === 'rig' && (it.type === 'deformer' || it.type === 'part' || it.type === 'object')) return it.id;
      if (mode === 'skeleton' && it.type === 'group') return it.id;
      if (mode === 'viewLayer'
        && (it.type === 'part' || it.type === 'group' || it.type === 'deformer' || it.type === 'object')) return it.id;
    }
    return null;
  }, [items, mode]);

  const rows = useMemo(() => {
    /** @type {Array<{node: import('./treeBuilder.js').OutlinerNode, depth: number}>} */
    const out = [];
    walkOutlinerTree(
      filteredRoots,
      (node, depth) => out.push({ node, depth }),
      (node) => !collapsed.has(node.id),
    );
    return out;
  }, [filteredRoots, collapsed]);

  const onSelect = useCallback(
    /** @param {string} id @param {'replace'|'add'|'toggle'} modifier */
    (id, modifier) => {
      // Resolve type from the tree node — different display modes map
      // to different selectionStore types. Art-mesh leaves in rig mode
      // dispatch as 'part' (they're parts of the project, just shown
      // under their deformer in rig mode).
      let type = /** @type {import('../../../store/selectionStore.js').SelectableType} */ ('part');
      /** @type {import('./treeBuilder.js').OutlinerNode|null} */
      let found = null;
      walkOutlinerTree(filteredRoots, (n) => {
        if (!found && n.id === id) found = n;
      });
      if (!found) return;
      // BVR-003 — clicking the synthetic Armature root has no real
      // backing node. Route to the first child bone so keyboard nav
      // still feels right and Properties has something to inspect.
      const synthetic = /** @type {any} */ (found).isSynthetic === true;
      if (synthetic) {
        const firstChild = /** @type {import('./treeBuilder.js').OutlinerNode|undefined} */ (
          /** @type {any} */ (found).children?.[0]
        );
        if (!firstChild) return;
        selectAndMirror({ type: 'group', id: firstChild.id }, modifier);
        return;
      }
      const ft = /** @type {import('./treeBuilder.js').OutlinerNode} */ (found).type;
      if (ft === 'part' || ft === 'artmesh') type = 'part';
      else if (ft === 'group') type = 'group';
      else if (ft === 'deformer') type = 'deformer';
      else if (ft === 'object') type = 'object'; // v43 lattice (warp) object
      // `selectAndMirror` only mirrors `'part' | 'group'` into the
      // legacy editorStore slot; deformer and v43 lattice `object`
      // writes update only the universal store, which is the correct
      // scope for them.
      selectAndMirror({ type, id }, modifier);
    },
    [filteredRoots],
  );

  const onToggleExpand = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onToggleNodeVisibility = useCallback(
    (id) => {
      // Visibility only makes sense for project nodes (parts/groups).
      // Deformer rows have no visibility flag in the project model.
      updateProject((proj) => {
        const n = proj.nodes.find((nn) => nn.id === id);
        if (n) n.visible = n.visible === false ? true : false;
      });
    },
    [updateProject],
  );

  // PP2-010(b) — per-warp eye toggle for rig-mode warp rows.
  const onToggleWarpVisibility = useCallback(
    (id) => toggleWarpGridVisibility(id),
    [toggleWarpGridVisibility],
  );

  // BVR-006 — drag-reparent handler. The synthetic Armature root
  // doesn't exist in `project.nodes`, so dropping onto it routes to
  // its first child bone (= top-level bone) when the dragged item
  // is itself a bone; otherwise it's a no-op (Armature can't own
  // non-bones). Other drops dispatch projectStore.reparentNode which
  // validates cycles + type compatibility.
  const reparentNode = useProjectStore((s) => s.reparentNode);
  const onReparent = useCallback(
    /** @param {string} childId @param {string} newParentId */
    (childId, newParentId) => {
      // Resolve child + drop target via the current node array.
      const child = nodes.find((n) => n?.id === childId);
      if (!child) return;
      // Synthetic Armature drop: route to first top-level bone, or
      // drop to root if the dragged child is itself the first bone.
      if (newParentId === '__armature_root__') {
        if (!isBoneGroup(child)) return; // armature only owns bones
        // For now, drop to root — the user can re-drop onto a specific
        // bone for nesting. Avoids guessing which top-level bone.
        reparentNode(childId, null);
        return;
      }
      reparentNode(childId, newParentId);
    },
    [nodes, reparentNode],
  );

  // ↑/↓ moves active row, ←/→ collapse/expand. Scoped to the
  // Outliner DOM tree via tabIndex + onKeyDown so the global
  // operator dispatcher doesn't fight us — these chords are
  // outliner-local, not workspace operators.
  const onTreeKeyDown = useCallback(
    (e) => {
      if (rows.length === 0) return;
      const idx = rows.findIndex((r) => r.node.id === activeId);
      const cur = rows[idx]?.node;
      // Phase 4 paint-fidelity follow-up — Outliner A / Alt+A.
      // Mirrors Blender's `outliner.select_all` (`reference/blender/
      // source/blender/editors/space_outliner/outliner_select.cc:1814+`)
      // — A toggles select-all of visible rows, Alt+A deselects all.
      // Pre-fix the global `selection.selectAllToggle` operator scoped
      // to mode (Edit → vertices, Pose → bones, Object → parts). The
      // mode-Object branch only selected visible PARTS — the Outliner
      // also shows groups, bones, deformers, lattice objects — A in
      // Outliner missed those by design. Now A in the focused tree
      // selects every visible row's node, regardless of type, by
      // converting each tree node to its selectionStore type via the
      // same mapping `onSelect` uses for single-row clicks.
      //
      // stopPropagation prevents the global op from also firing.
      if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.altKey) {
          // Alt+A → deselect all
          useSelectionStore.getState().clear();
          useEditorStore.getState().setSelection([]);
          return;
        }
        // Bare A → toggle: any selection → clear; else select all rows.
        const sel = useSelectionStore.getState();
        if (sel.items.length > 0) {
          sel.clear();
          useEditorStore.getState().setSelection([]);
          return;
        }
        /** @type {Array<{type: string, id: string}>} */
        const items = [];
        for (const { node } of rows) {
          // Skip synthetic (e.g. armature root placeholder) — they have
          // no backing project node to select against.
          if (/** @type {any} */ (node).isSynthetic === true) continue;
          const t = /** @type {any} */ (node).type;
          let storeType;
          if (t === 'part' || t === 'artmesh') storeType = 'part';
          else if (t === 'group') storeType = 'group';
          else if (t === 'deformer') storeType = 'deformer';
          else if (t === 'object') storeType = 'object';
          else continue;
          items.push({ type: storeType, id: node.id });
        }
        if (items.length === 0) return;
        sel.select(items, 'replace');
        // Legacy editorStore.selection mirrors part/group only (deformer
        // and object are universal-store-only). Walk reverse for the
        // last part/group as active head; matches the Object Mode A
        // convention in `selection.selectAllToggle`.
        let activeHead = null;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].type === 'part' || items[i].type === 'group') {
            activeHead = items[i].id;
            break;
          }
        }
        useEditorStore.getState().setSelection(activeHead ? [activeHead] : []);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = rows[Math.min(idx < 0 ? 0 : idx + 1, rows.length - 1)]?.node;
        if (next) onSelect(next.id, 'replace');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = rows[Math.max(idx < 0 ? 0 : idx - 1, 0)]?.node;
        if (prev) onSelect(prev.id, 'replace');
      } else if (e.key === 'ArrowLeft' && cur) {
        e.preventDefault();
        if (cur.children.length > 0 && !collapsed.has(cur.id)) {
          // Collapse current.
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.add(cur.id);
            return next;
          });
        } else if (cur.parent) {
          // Already a leaf or already collapsed → jump to parent.
          onSelect(cur.parent, 'replace');
        }
      } else if (e.key === 'ArrowRight' && cur) {
        e.preventDefault();
        if (cur.children.length > 0 && collapsed.has(cur.id)) {
          // Expand current.
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(cur.id);
            return next;
          });
        } else if (cur.children.length > 0) {
          // Already expanded → jump to first child.
          onSelect(cur.children[0].id, 'replace');
        }
      }
    },
    [rows, activeId, collapsed, onSelect],
  );

  return (
    <div className="h-full w-full flex flex-col text-xs" data-editor-type="outliner">
      {rows.length === 0 ? (
        <EmptyState mode={mode} hasNodes={nodes.length > 0} hasRigSpec={!!rigSpec} hasArmature={hasArmature} hasQuery={!!query.trim()} />
      ) : (
        <div
          role="tree"
          aria-label="Outliner"
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          className="flex-1 min-h-0 overflow-auto py-1 focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          {rows.map(({ node, depth }) => {
            // PP2-010(b) — rig-mode warp rows surface a per-warp eye
            // toggle. Decorate `visible` from the editorStore map so
            // the row dims/highlights match the lattice overlay state.
            const isWarpRow = mode === 'rig' && isWarpLatticeNode(node);
            const decorated = isWarpRow
              ? { ...node, visible: warpGridVisibility[node.id] !== false }
              : node;
            const visToggle = isWarpRow
              ? onToggleWarpVisibility
              : (node.type === 'part' || node.type === 'group')
                ? onToggleNodeVisibility
                : undefined;
            return (
              <TreeNode
                key={node.id}
                node={decorated}
                depth={depth}
                expanded={!collapsed.has(node.id)}
                selected={selectedIds.has(node.id)}
                active={activeId === node.id}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onToggleVisibility={visToggle}
                onReparent={mode === 'rig' ? undefined : onReparent}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ mode, hasNodes, hasRigSpec, hasArmature, hasQuery }) {
  let msg = '';
  if (hasQuery) msg = 'No matches.';
  else if (mode === 'rig' && !hasRigSpec) msg = 'No rig built — click Initialize Rig in Parameters.';
  else if (mode === 'rig') msg = 'Rig is empty.';
  else if (mode === 'skeleton' && !hasArmature) msg = 'No armature — import a PSD with bone-tagged groups, or run Init Rig.';
  else if (mode === 'skeleton') msg = 'Skeleton is empty.';
  else if (!hasNodes) msg = 'No layers — import a PSD to begin.';
  else msg = 'Empty.';
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground select-none">
      <span>{msg}</span>
    </div>
  );
}
