// @ts-check

/**
 * v3 Phase 1A — Single outliner row.
 *
 * Stateless: receives the row data + selection/expansion bits and
 * dispatches click/expand/visibility back through callbacks. The
 * OutlinerEditor owns the state; this component only renders.
 *
 * Splitting render from state lets us replace the row component per
 * display mode (rig / param / anim) without touching expand/select
 * plumbing.
 *
 * @module v3/editors/outliner/TreeNode
 */

import { memo } from 'react';
import {
  ChevronRight, ChevronDown,
  Folder, Image as ImageIcon, Eye, EyeOff,
  Box, RotateCw, Bone, Grid3x3,
} from 'lucide-react';

const INDENT_PX = 14;

/** BVR-008 — vertical guide-line column width (matches INDENT_PX). */
const GUIDE_LINE_PX = INDENT_PX;

/**
 * @param {Object} props
 * @param {import('./treeBuilder.js').OutlinerNode} props.node
 * @param {number}  props.depth
 * @param {boolean} props.expanded     - only meaningful when node has children
 * @param {boolean} props.selected
 * @param {boolean} props.active       - is this the active (last-selected) item
 * @param {(id: string, modifier: 'replace'|'add'|'toggle') => void} props.onSelect
 * @param {(id: string) => void} props.onToggleExpand
 * @param {(id: string) => void} [props.onToggleVisibility]
 * @param {(childId: string, newParentId: string|null) => void} [props.onReparent]
 *   BVR-006 — drop handler. When provided, the row participates in
 *   drag-reparent (drag a row onto another row → set the dragged
 *   node's parent to the drop target).
 */
function TreeNodeImpl({
  node,
  depth,
  expanded,
  selected,
  active,
  onSelect,
  onToggleExpand,
  onToggleVisibility,
  onReparent,
}) {
  const hasChildren = node.children.length > 0;
  const Icon =
    node.isArmature ? Bone
    : node.isBone ? Bone
    : node.isLattice ? Grid3x3
    : node.type === 'group' ? Folder
    : node.type === 'deformer' ? (node.deformerKind === 'rotation' ? RotateCw : Box)
    : ImageIcon;
  const VisIcon = node.visible === false ? EyeOff : Eye;

  // BVR-003 — Blender-style bone tint (sky-400). Applies to bone rows
  // AND to the Armature container itself so a glance at the column
  // distinguishes the rigging side from the parts side.
  const labelTint = (node.isBone || node.isArmature) ? 'text-sky-400' : '';
  // The Armature header reads as a heading, not a row — slightly
  // bolder so it visually anchors the bone subtree below it.
  const labelWeight = node.isArmature ? 'font-medium' : '';
  // BVR-008 — synthetic rows get a smaller icon so they don't dominate
  // (they're containers, not selectables). 11px stays our default.

  function handleClick(e) {
    // Modifier mapping per Plan §5: shift = extend, ctrl/meta = toggle/add
    /** @type {'replace'|'add'|'toggle'} */
    let modifier = 'replace';
    if (e.shiftKey) modifier = 'add';        // 'extend' would need range resolution
    else if (e.ctrlKey || e.metaKey) modifier = 'toggle';
    onSelect(node.id, modifier);
  }

  function handleExpand(e) {
    e.stopPropagation();
    onToggleExpand(node.id);
  }

  function handleVis(e) {
    e.stopPropagation();
    onToggleVisibility?.(node.id);
  }

  // BVR-006 — drag-reparent. Synthetic rows (Armature container) and
  // rows without an `onReparent` callback are non-draggable but still
  // accept drops (Armature drop = reparent to first child bone — see
  // OutlinerEditor's onReparent handler).
  const draggable = !!onReparent && !node.isSynthetic;
  function handleDragStart(e) {
    if (!draggable) return;
    e.dataTransfer.setData('application/x-outliner-node-id', node.id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e) {
    if (!onReparent) return;
    // Always allow drop targets; the action validates cycles + types.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function handleDrop(e) {
    if (!onReparent) return;
    e.preventDefault();
    e.stopPropagation();
    const childId = e.dataTransfer.getData('application/x-outliner-node-id');
    if (!childId || childId === node.id) return;
    onReparent(childId, node.id);
  }

  // Selection styling: selected rows get a coloured background; the
  // active item additionally gets a brighter accent stripe on the
  // left edge so it's distinguishable in a multi-select.
  const rowBg = selected
    ? (active ? 'bg-primary/30' : 'bg-primary/15')
    : 'hover:bg-muted/40';
  const visClass = node.visible === false ? 'opacity-40' : 'opacity-100';

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      className={`relative flex items-center h-6 text-xs select-none cursor-default ${rowBg} ${visClass}`}
      style={{ paddingLeft: depth * INDENT_PX + 2 }}
      onClick={handleClick}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* BVR-008 — parent-relationship guide lines: thin verticals at
          each ancestor's indent column. Helps scan deep hierarchies
          without counting indent levels by eye. Drawn under the
          chevron + icon so highlights still read above them. */}
      {Array.from({ length: depth }, (_, lvl) => (
        <div
          key={`guide-${lvl}`}
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-border/50 pointer-events-none"
          style={{ left: lvl * INDENT_PX + 2 + GUIDE_LINE_PX / 2 }}
        />
      ))}

      {/* Expand chevron — rendered for all rows so columns line up.
          Leaves get an empty placeholder of the same width.        */}
      <button
        type="button"
        className={`w-4 h-4 mr-0.5 flex items-center justify-center text-muted-foreground hover:text-foreground relative ${
          hasChildren ? '' : 'pointer-events-none opacity-0'
        }`}
        onClick={hasChildren ? handleExpand : undefined}
        tabIndex={-1}
        aria-label={expanded ? 'collapse' : 'expand'}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
        ) : null}
      </button>

      <Icon size={11} className={`mr-1.5 shrink-0 relative ${labelTint || 'text-muted-foreground'}`} />

      <span className={`flex-1 truncate relative ${labelTint} ${labelWeight}`}>{node.name}</span>

      {onToggleVisibility ? (
        <button
          type="button"
          className="w-5 h-5 mr-1 flex items-center justify-center text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 relative"
          onClick={handleVis}
          aria-label={node.visible === false ? 'show' : 'hide'}
        >
          <VisIcon size={11} />
        </button>
      ) : null}
    </div>
  );
}

// React.memo skips re-renders when row props are shallow-equal —
// matters because OutlinerEditor rebuilds its `rows` list on every
// expand/collapse/selection change but most rows' (node, depth,
// expanded, selected, active) props stay equal.
export const TreeNode = memo(TreeNodeImpl);
