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

import { ChevronRight, ChevronDown, Folder, Image as ImageIcon, Eye, EyeOff } from 'lucide-react';

const INDENT_PX = 14;

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
 */
export function TreeNode({
  node,
  depth,
  expanded,
  selected,
  active,
  onSelect,
  onToggleExpand,
  onToggleVisibility,
}) {
  const hasChildren = node.children.length > 0;
  const Icon = node.type === 'group' ? Folder : ImageIcon;
  const VisIcon = node.visible === false ? EyeOff : Eye;

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
      className={`flex items-center h-6 text-xs select-none cursor-default ${rowBg} ${visClass}`}
      style={{ paddingLeft: depth * INDENT_PX + 2 }}
      onClick={handleClick}
    >
      {/* Expand chevron — rendered for all rows so columns line up.
          Leaves get an empty placeholder of the same width.        */}
      <button
        type="button"
        className={`w-4 h-4 mr-0.5 flex items-center justify-center text-muted-foreground hover:text-foreground ${
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

      <Icon size={11} className="mr-1.5 shrink-0 text-muted-foreground" />

      <span className="flex-1 truncate">{node.name}</span>

      {onToggleVisibility ? (
        <button
          type="button"
          className="w-5 h-5 mr-1 flex items-center justify-center text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
          onClick={handleVis}
          aria-label={node.visible === false ? 'show' : 'hide'}
        >
          <VisIcon size={11} />
        </button>
      ) : null}
    </div>
  );
}
