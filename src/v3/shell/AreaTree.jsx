// @ts-check

/**
 * v3 1A.UX — Splittable area layout.
 *
 * Three-column layout (2026-05-02 — Live Preview is a TAB on the
 * center area, not a side-by-side panel; the canvas is never split):
 *
 *   Left column (vertical)   Center column                  Right column (vertical)
 *   ──────────────────────   ────────────────────────────   ───────────────────────
 *   leftTop:    Outliner     tabs: [Viewport,               rightTop:    Parameters
 *   leftBottom: Logs                Live Preview]           rightBottom: Properties
 *                            timeline: Timeline (anim ws)
 *
 * Areas are looked up by id (not positional index). Each side column
 * is a vertical PanelGroup when both halves are defined, falling back
 * to a single panel if a workspace defines only one half. Workspaces
 * that omit both halves of a side render as a 2-column or 1-column
 * layout.
 *
 * If a `timeline` area is defined the center column splits vertically
 * between the center area and the timeline; otherwise the center
 * column is the center area unsplit.
 *
 * Phase 1+ replaces this with a recursive split-tree where every
 * splitter can be split further (Blender's "drag the corner to
 * subdivide"); the per-area Tab system already shipped here gives
 * users 80% of that ergonomics with a quarter of the complexity.
 *
 * @module v3/shell/AreaTree
 */

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { Area } from './Area.jsx';

const HORIZONTAL_HANDLE = 'flex-shrink-0 w-px bg-border hover:w-1 hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60 transition-colors';
const VERTICAL_HANDLE   = 'flex-shrink-0 h-px bg-border hover:h-1 hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60 transition-colors';

/**
 * Render a side column. When both halves exist, return a vertical
 * PanelGroup; with one half, return that single Area; with none,
 * return null and let the caller skip the column entirely.
 *
 * Panels carry stable `id`/`order` props: react-resizable-panels asserts
 * ("Panel data not found for index N") if it ever sees a panel-count
 * change on a reused PanelGroup instance without them.
 */
function renderSideColumn(top, bottom, idBase, topDefault = 65) {
  if (top && bottom) {
    return (
      <PanelGroup direction="vertical" id={`${idBase}-v`} autoSaveId={`${idBase}-v`}>
        <Panel id="top" order={1} defaultSize={topDefault} minSize={20}>
          <Area area={top} />
        </Panel>
        <PanelResizeHandle className={VERTICAL_HANDLE} />
        <Panel id="bottom" order={2} defaultSize={100 - topDefault} minSize={15}>
          <Area area={bottom} />
        </Panel>
      </PanelGroup>
    );
  }
  if (top || bottom) return <Area area={top ?? bottom} />;
  return null;
}

export function AreaTree() {
  const activeWorkspace = useUIV3Store((s) => s.activeWorkspace);
  const workspaces      = useUIV3Store((s) => s.workspaces);
  const ws = workspaces[activeWorkspace];
  if (!ws) return null;

  const byId = Object.fromEntries(ws.areas.map((a) => [a.id, a]));
  const leftTop     = byId.leftTop;
  const leftBottom  = byId.leftBottom;
  const center      = byId.center;
  const rightTop    = byId.rightTop;
  const rightBottom = byId.rightBottom;
  const timeline    = byId.timeline;

  // Live Preview lives as a tab on `center` (no canvas split). If a
  // `timeline` area is present, the center column splits vertically
  // between center and timeline.
  //
  // BUG-017 fix: the centerColumn wrapper is ALWAYS a vertical PanelGroup
  // — even when `timeline` is absent — so that React reconciliation
  // preserves CanvasArea's mount across workspace switches that toggle
  // timeline visibility (e.g. layout ↔ animation). The earlier shape
  // conditionally used `<Area>` bare (no timeline) vs `<PanelGroup>` (with
  // timeline); React saw different element types at the same depth, tore
  // down the entire subtree, and the CanvasViewport's WebGL2 context was
  // destroyed + texture uploads lost — surfacing as "character disappears
  // forever after layout → animation switch". Stable PanelGroup wrapper
  // keeps the centerArea path identical across workspaces.
  const centerArea = center && <Area area={center} />;

  // Stable panel `id`s ("canvas" / "timeline") keep the canvas Panel mounted
  // when the timeline appears/disappears (layout ↔ animation), preserving
  // CanvasArea's WebGL2 context (BUG-017). The stable autoSaveId stores the
  // with-timeline and without-timeline splits separately (v2 keys saved
  // layouts by panel-id set).
  const centerColumn = (
    <PanelGroup direction="vertical" id="v3-center-v" autoSaveId="v3-center-v">
      <Panel id="canvas" order={1} defaultSize={timeline ? 75 : 100} minSize={20}>
        {centerArea}
      </Panel>
      {timeline ? (
        <>
          <PanelResizeHandle className={VERTICAL_HANDLE} />
          <Panel id="timeline" order={2} defaultSize={25} minSize={10}>
            <Area area={timeline} />
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );

  const leftColumn  = renderSideColumn(leftTop,  leftBottom,  'v3-left',  65);
  const rightColumn = renderSideColumn(rightTop, rightBottom, 'v3-right', 55);

  const hasLeft  = !!leftColumn;
  const hasRight = !!rightColumn;

  // Build the column set, then render panels + handles as a single FLAT,
  // KEYED list inside ONE persistent horizontal PanelGroup. Two invariants:
  //  - The group instance + the center Panel (`id="center"`) never remount
  //    across workspace switches, so CanvasArea's WebGL2 context survives
  //    (BUG-017) even when left/right columns come and go.
  //  - Every Panel carries a stable `id`/`order`; react-resizable-panels
  //    asserts ("Panel data not found for index N") when a reused group's
  //    panel count changes without them — the crash entering Sculpt (the
  //    only center+right shape) before this fix.
  /** @type {Array<{id:string,node:any,defaultSize:number,minSize:number,maxSize?:number}>} */
  const columns = [];
  if (hasLeft) {
    columns.push({ id: 'left', node: leftColumn, defaultSize: hasRight ? 20 : 22, minSize: 12, maxSize: 45 });
  }
  columns.push({
    id: 'center',
    node: centerColumn,
    defaultSize: hasLeft && hasRight ? 60 : (hasLeft || hasRight ? 78 : 100),
    minSize: 30,
  });
  if (hasRight) {
    columns.push({ id: 'right', node: rightColumn, defaultSize: hasLeft ? 20 : 22, minSize: 12, maxSize: 45 });
  }

  // Flat, individually-keyed children (NOT Fragment-grouped): a handle and
  // the Panel that follows it must be separate keyed siblings. If a leading
  // handle were grouped with its Panel in a Fragment, toggling that handle
  // (e.g. center becomes the first column entering Sculpt) would shift the
  // Panel's position inside the Fragment and React would remount it —
  // destroying CanvasArea's WebGL2 context. Keying each element by a stable
  // role lets React track the center Panel across every column-set change.
  /** @type {import('react').ReactNode[]} */
  const children = [];
  columns.forEach((col, i) => {
    if (i > 0) {
      children.push(<PanelResizeHandle key={`handle-${col.id}`} className={HORIZONTAL_HANDLE} />);
    }
    children.push(
      <Panel
        key={col.id}
        id={col.id}
        order={i + 1}
        defaultSize={col.defaultSize}
        minSize={col.minSize}
        maxSize={col.maxSize}
      >
        {col.node}
      </Panel>,
    );
  });

  return (
    <PanelGroup direction="horizontal" id="v3-main-h" autoSaveId="v3-main-h" className="flex-1 min-h-0">
      {children}
    </PanelGroup>
  );
}
