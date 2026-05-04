// @ts-check

/**
 * v3 Phase 1A — Outliner editor.
 *
 * Single canonical tree (Blender's "View Layer" pattern) with a header
 * dropdown that switches the *scope* of the visible rows — not the
 * shape of the tree. Three scopes:
 *
 *   - **View Layer** (default): full unified tree. Project hierarchy
 *     (parts + groups + bones inline) plus a synthetic "Rig" pseudo-
 *     root pinned to the bottom holding the deformer graph. Bones get
 *     the bone icon via `isBone` so a glance at the tree tells you
 *     what's an armature without flipping modes.
 *   - **Armature Data**: bones-only filter — only `boneRole`-tagged
 *     groups, bone-to-bone parent chain (non-bone groups skipped on
 *     the way up). Click → highlights the bone in SkeletonOverlay.
 *   - **Rig Data**: deformer-only filter (rigSpec graph; warps +
 *     rotations + their art-mesh leaves).
 *
 * Why a single tree + dropdown (vs. the old 3 tabs): Blender's
 * Outliner has ONE tree and a header dropdown that filters scope.
 * Three tabs broke that muscle memory and duplicated bones across
 * Hierarchy + Skeleton modes. Plan: docs/BLENDER_FIDELITY_AUDIT.md.
 *
 * Why separate editor (vs. reusing v2 LayerPanel): v2 panel couples
 * drag-reordering with depth editing and lives inside the floating
 * Inspector. v3 outliner is a workspace-area editor that shares one
 * selection model with Properties / Viewport / Parameters (Plan §5).
 *
 * @module v3/editors/outliner/OutlinerEditor
 */

import { useState, useMemo, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useRigSpecStore } from '../../../store/rigSpecStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { buildOutlinerTree, walkOutlinerTree, RIG_PSEUDO_ROOT_ID } from './treeBuilder.js';
import { filterOutlinerTree } from './filters.js';
import { TreeNode } from './TreeNode.jsx';
import * as SelectImpl from '../../../components/ui/select.jsx';

// shadcn/ui Select parts are forwardRefs without JSX-typed declarations —
// tsc can't see their props (children, className). Cast through one alias
// so the dropdown JSX below stays permissive at runtime they're the same.
// (Same pattern AnimationsEditor + IdleMotionDialog use for AlertDialog.)
/** @type {Record<string, React.ComponentType<any>>} */
const Sel = /** @type {any} */ (SelectImpl);
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = Sel;

/**
 * Header dropdown options. Matches Blender's "View Layer / Scenes /
 * Blender File / Data API" dropdown — names follow Blender's vocabulary
 * so the muscle memory transfers.
 */
const MODES = /** @type {const} */ ([
  { id: 'viewLayer', label: 'View Layer' },
  { id: 'skeleton',  label: 'Armature Data' },
  { id: 'rig',       label: 'Rig Data' },
]);

export function OutlinerEditor() {
  const nodes = useProjectStore((s) => s.project.nodes);
  const updateProject = useProjectStore((s) => s.updateProject);
  const rigSpec = useRigSpecStore((s) => s.rigSpec);

  const items = useSelectionStore((s) => s.items);
  const select = useSelectionStore((s) => s.select);

  // PP2-010(b) — per-warp visibility map. Rig-mode warp rows surface
  // an eye icon that flips this entry; WarpDeformerOverlay reads the
  // map to filter which lattices it paints.
  const warpGridVisibility = useEditorStore((s) => s.viewLayers.warpGridVisibility ?? {});
  const toggleWarpGridVisibility = useEditorStore((s) => s.toggleWarpGridVisibility);

  /** @type {[import('./treeBuilder.js').OutlinerDisplayMode, Function]} */
  const [mode, setMode] = useState(/** @type {any} */ ('viewLayer'));
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));
  const [query, setQuery] = useState('');

  const roots = useMemo(() => {
    if (mode === 'rig') return buildOutlinerTree(rigSpec, { mode: 'rig' });
    if (mode === 'skeleton') return buildOutlinerTree(nodes, { mode: 'skeleton' });
    // viewLayer (default): unified tree composed from both project
    // nodes AND rigSpec.
    return buildOutlinerTree({ nodes, rigSpec }, { mode: 'viewLayer' });
  }, [mode, nodes, rigSpec]);

  // Whether the project has any boneRole-tagged groups. Drives the
  // Skeleton-tab disabled state + the empty-state message.
  const hasArmature = useMemo(
    () => nodes.some((n) => n?.type === 'group' && n?.boneRole),
    [nodes],
  );

  // Apply search filter — `q.length > 0` shrinks the visible tree to
  // matching rows + their ancestors. Empty query → unfiltered.
  const filteredRoots = useMemo(
    () => (query.trim() ? filterOutlinerTree(roots, query.trim()) : roots),
    [roots, query],
  );

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
        // Skeleton view is bone-only; only group selections matter
        // here. (Bones are stored as `type:'group'` with `boneRole`.)
        if (it.type === 'group') s.add(it.id);
      } else {
        // viewLayer: unified tree carries both project nodes and
        // deformers, so any selection type can show up here.
        if (it.type === 'part' || it.type === 'group' || it.type === 'deformer') s.add(it.id);
      }
    }
    return s;
  }, [items, mode]);

  const activeId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (mode === 'rig' && (it.type === 'deformer' || it.type === 'part')) return it.id;
      if (mode === 'skeleton' && it.type === 'group') return it.id;
      if (mode === 'viewLayer'
        && (it.type === 'part' || it.type === 'group' || it.type === 'deformer')) return it.id;
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
      // The synthetic "Rig" pseudo-root in viewLayer mode is a non-
      // selectable spacer — clicking it should expand/collapse only.
      if (id === RIG_PSEUDO_ROOT_ID) return;
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
      const ft = /** @type {import('./treeBuilder.js').OutlinerNode} */ (found).type;
      if (ft === 'part' || ft === 'artmesh') type = 'part';
      else if (ft === 'group') type = 'group';
      else if (ft === 'deformer') type = 'deformer';
      select({ type, id }, modifier);
    },
    [filteredRoots, select],
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

  // ↑/↓ moves active row, ←/→ collapse/expand. Scoped to the
  // Outliner DOM tree via tabIndex + onKeyDown so the global
  // operator dispatcher doesn't fight us — these chords are
  // outliner-local, not workspace operators.
  const onTreeKeyDown = useCallback(
    (e) => {
      if (rows.length === 0) return;
      const idx = rows.findIndex((r) => r.node.id === activeId);
      const cur = rows[idx]?.node;
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
    <div className="h-full w-full flex flex-col text-xs">
      <Header
        mode={mode}
        onModeChange={setMode}
        query={query}
        onQueryChange={setQuery}
        rigAvailable={!!rigSpec}
        skeletonAvailable={hasArmature}
      />
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
            const isWarpRow =
              mode === 'rig' && node.type === 'deformer' && node.deformerKind === 'warp';
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
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Header({ mode, onModeChange, query, onQueryChange, rigAvailable, skeletonAvailable }) {
  return (
    <div className="border-b border-border bg-muted/20 flex flex-col">
      <div className="flex items-center px-1.5 pt-1.5">
        {/* Blender-style scope dropdown — one tree, three filters.
            Replaces the old 3-tab layout that broke Outliner muscle
            memory by switching tree shape per click. */}
        <Select value={mode} onValueChange={onModeChange}>
          <SelectTrigger
            className="h-6 px-2 text-[11px] gap-1 bg-transparent border-0
                       hover:bg-background/50 focus:ring-0 focus:ring-offset-0
                       w-auto min-w-[110px]"
            aria-label="Outliner display scope"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-[180px]">
            {MODES.map((m) => {
              const disabled =
                (m.id === 'rig' && !rigAvailable)
                || (m.id === 'skeleton' && !skeletonAvailable);
              return (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  disabled={disabled}
                  className="text-[11px]"
                >
                  {m.label}
                  {disabled && m.id === 'rig' ? ' (no rig built)' : null}
                  {disabled && m.id === 'skeleton' ? ' (no armature)' : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center px-2 py-1 gap-1.5">
        <Search size={11} className="text-muted-foreground shrink-0" />
        <input
          type="text"
          value={query}
          placeholder="Search…"
          onChange={(e) => onQueryChange(e.target.value)}
          className="flex-1 h-6 px-1 bg-transparent border-0 text-[11px] focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="text-muted-foreground hover:text-foreground"
            aria-label="clear search"
          >
            <X size={11} />
          </button>
        ) : null}
      </div>
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
