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
 */
function renderSideColumn(top, bottom, autoSaveId, topDefault = 65) {
  if (top && bottom) {
    return (
      <PanelGroup direction="vertical" autoSaveId={autoSaveId}>
        <Panel defaultSize={topDefault} minSize={20}>
          <Area area={top} />
        </Panel>
        <PanelResizeHandle className={VERTICAL_HANDLE} />
        <Panel defaultSize={100 - topDefault} minSize={15}>
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

  const wsKey = activeWorkspace;

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

  const centerColumn = (
    <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-c`}>
      <Panel defaultSize={timeline ? 75 : 100} minSize={20}>
        {centerArea}
      </Panel>
      {timeline ? (
        <>
          <PanelResizeHandle className={VERTICAL_HANDLE} />
          <Panel defaultSize={25} minSize={10}>
            <Area area={timeline} />
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );

  const leftColumn  = renderSideColumn(leftTop,  leftBottom,  `v3-ws-${wsKey}-l`, 65);
  const rightColumn = renderSideColumn(rightTop, rightBottom, `v3-ws-${wsKey}-r`, 55);

  const hasLeft  = !!leftColumn;
  const hasRight = !!rightColumn;

  if (hasLeft && hasRight) {
    return (
      <PanelGroup
        direction="horizontal"
        autoSaveId={`v3-ws-${wsKey}-h6`}
        className="flex-1 min-h-0"
      >
        <Panel defaultSize={20} minSize={12} maxSize={40}>
          {leftColumn}
        </Panel>
        <PanelResizeHandle className={HORIZONTAL_HANDLE} />
        <Panel defaultSize={60} minSize={30}>
          {centerColumn}
        </Panel>
        <PanelResizeHandle className={HORIZONTAL_HANDLE} />
        <Panel defaultSize={20} minSize={12} maxSize={40}>
          {rightColumn}
        </Panel>
      </PanelGroup>
    );
  }

  if (hasLeft) {
    return (
      <PanelGroup
        direction="horizontal"
        autoSaveId={`v3-ws-${wsKey}-h2L`}
        className="flex-1 min-h-0"
      >
        <Panel defaultSize={22} minSize={14} maxSize={45}>{leftColumn}</Panel>
        <PanelResizeHandle className={HORIZONTAL_HANDLE} />
        <Panel defaultSize={78} minSize={30}>{centerColumn}</Panel>
      </PanelGroup>
    );
  }

  if (hasRight) {
    return (
      <PanelGroup
        direction="horizontal"
        autoSaveId={`v3-ws-${wsKey}-h2R`}
        className="flex-1 min-h-0"
      >
        <Panel defaultSize={78} minSize={30}>{centerColumn}</Panel>
        <PanelResizeHandle className={HORIZONTAL_HANDLE} />
        <Panel defaultSize={22} minSize={14} maxSize={45}>{rightColumn}</Panel>
      </PanelGroup>
    );
  }

  // Center-only fallback.
  return <div className="flex-1 min-h-0">{centerColumn}</div>;
}
