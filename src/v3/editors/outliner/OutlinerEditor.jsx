// @ts-check

/**
 * v3 Phase 1A — Outliner editor.
 *
 * First concrete v3 editor: a hierarchy view of the project's parts
 * and groups, sorted PSD-style (top of list = top of canvas), with
 * expand/collapse and click-to-select wired to selectionStore.
 *
 * Why a separate editor (vs. reusing v2 LayerPanel): v2 panel
 * couples drag-reordering with depth editing and lives inside the
 * floating Inspector. v3 outliner is a workspace-area editor that
 * shares one selection model with Properties / Viewport / Parameters
 * (Plan §5). Same data, different interaction surface.
 *
 * What's intentionally absent from this first cut: drag-reparent,
 * search/filter input, display-mode switcher (rig/param/anim),
 * context menu, multi-select range with shift, isolate-mode. Each
 * is a small follow-up — the structure here doesn't lock any of
 * them out.
 *
 * @module v3/editors/outliner/OutlinerEditor
 */

import { useState, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { buildOutlinerTree, walkOutlinerTree } from './treeBuilder.js';
import { TreeNode } from './TreeNode.jsx';

export function OutlinerEditor() {
  const nodes = useProjectStore((s) => s.project.nodes);
  const updateProject = useProjectStore((s) => s.updateProject);

  const items = useSelectionStore((s) => s.items);
  const select = useSelectionStore((s) => s.select);

  // Local UI state — expand/collapse is per-area volatile, not part
  // of the saved project (Plan §9.4: workspace layout persists,
  // session selection + expand state do not).
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));

  const roots = useMemo(() => buildOutlinerTree(nodes), [nodes]);

  // Selection lookup — convert {type:'part'|'group', id} entries to
  // a set keyed by id. Outliner only deals with parts/groups; other
  // selectable types (parameter, deformer, ...) are filtered out.
  const selectedIds = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      if (it.type === 'part' || it.type === 'group') s.add(it.id);
    }
    return s;
  }, [items]);

  const activeId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'part' || it.type === 'group') return it.id;
    }
    return null;
  }, [items]);

  // Flatten the tree into a row list, skipping subtrees of collapsed
  // groups. Recomputing per render is fine — typical rigs are
  // < 200 nodes and walkOutlinerTree is O(n).
  const rows = useMemo(() => {
    /** @type {Array<{node: import('./treeBuilder.js').OutlinerNode, depth: number}>} */
    const out = [];
    walkOutlinerTree(
      roots,
      (node, depth) => out.push({ node, depth }),
      (node) => !collapsed.has(node.id),
    );
    return out;
  }, [roots, collapsed]);

  const onSelect = useCallback(
    /** @param {string} id @param {'replace'|'add'|'toggle'} modifier */
    (id, modifier) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const ref = /** @type {{type:'part'|'group', id:string}} */ ({
        type: node.type === 'group' ? 'group' : 'part',
        id,
      });
      select(ref, modifier);
    },
    [nodes, select],
  );

  const onToggleExpand = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onToggleVisibility = useCallback(
    (id) => {
      updateProject((proj) => {
        const n = proj.nodes.find((nn) => nn.id === id);
        if (n) n.visible = n.visible === false ? true : false;
      });
    },
    [updateProject],
  );

  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        <span>No layers — import a PSD to begin.</span>
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label="Outliner"
      className="h-full w-full overflow-auto py-1 text-xs"
    >
      {rows.map(({ node, depth }) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={depth}
          expanded={!collapsed.has(node.id)}
          selected={selectedIds.has(node.id)}
          active={activeId === node.id}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onToggleVisibility={onToggleVisibility}
        />
      ))}
    </div>
  );
}
