// @ts-check

/**
 * v3 1A.UX — Splittable area layout.
 *
 * Three-column layout (2026-05-02 — Live Preview surface added):
 *
 *   Left column (vertical)   Center column                       Right column (vertical)
 *   ──────────────────────   ─────────────────────────────────   ───────────────────────
 *   leftTop:    Outliner     center:      Viewport (edit)        rightTop:    Parameters
 *   leftBottom: Logs         centerRight: Live Preview (drivers) rightBottom: Properties
 *                            timeline:    Timeline (anim ws)
 *
 * Areas are looked up by id (not positional index). Each side column
 * is a vertical PanelGroup when both halves are defined, falling back
 * to a single panel if a workspace defines only one half. Workspaces
 * that omit both halves of a side render as a 2-column or 1-column
 * layout.
 *
 * The center column splits horizontally between `center` and
 * `centerRight` when both are defined (GAP-010 — Live Preview surface),
 * then vertically below for `timeline` if present. Workspaces that
 * omit `centerRight` render the center column unsplit as before.
 *
 * autoSaveId is bumped to `v3-ws-<wsKey>-h6` so users with stored
 * sizes from earlier shapes don't get a half-collapsed column on
 * first render.
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
  const centerRight = byId.centerRight;
  const rightTop    = byId.rightTop;
  const rightBottom = byId.rightBottom;
  const timeline    = byId.timeline;

  const wsKey = activeWorkspace;

  // GAP-010 — center top is `center` alone, OR a horizontal split between
  // `center` (edit Viewport) and `centerRight` (Live Preview surface) when
  // both are defined. Then if a `timeline` area is present, the whole
  // center column splits vertically below it.
  const centerTop = centerRight ? (
    <PanelGroup direction="horizontal" autoSaveId={`v3-ws-${wsKey}-cTop`}>
      <Panel defaultSize={55} minSize={25}>
        {center && <Area area={center} />}
      </Panel>
      <PanelResizeHandle className={HORIZONTAL_HANDLE} />
      <Panel defaultSize={45} minSize={20}>
        <Area area={centerRight} />
      </Panel>
    </PanelGroup>
  ) : (
    center && <Area area={center} />
  );

  const centerColumn = timeline ? (
    <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-c`}>
      <Panel defaultSize={75} minSize={20}>
        {centerTop}
      </Panel>
      <PanelResizeHandle className={VERTICAL_HANDLE} />
      <Panel defaultSize={25} minSize={10}>
        <Area area={timeline} />
      </Panel>
    </PanelGroup>
  ) : (
    centerTop
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
