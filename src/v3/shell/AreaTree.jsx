// @ts-check

/**
 * v3 1A.UX — Splittable area layout.
 *
 * Two-column layout (2026-04-29 — user feedback "no right column"):
 *
 *   Left column (vertical split)       Center column
 *   ────────────────────────────       ──────────────
 *   leftTop:    Outliner + Parameters  center:   Viewport
 *   leftBottom: Properties             timeline: Timeline (animation ws)
 *
 * Areas are looked up by id (not positional index) so a workspace
 * preset that omits an area just renders empty space in that slot.
 * autoSaveId is bumped to `v3-ws-<wsKey>-h2` so the new defaults
 * take effect for users who had the old 3-column layout's panel
 * sizes saved in localStorage.
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

export function AreaTree() {
  const activeWorkspace = useUIV3Store((s) => s.activeWorkspace);
  const workspaces      = useUIV3Store((s) => s.workspaces);
  const ws = workspaces[activeWorkspace];
  if (!ws) return null;

  const byId = Object.fromEntries(ws.areas.map((a) => [a.id, a]));
  const leftTop    = byId.leftTop;
  const leftBottom = byId.leftBottom;
  const center     = byId.center;
  const timeline   = byId.timeline;

  const wsKey = activeWorkspace;

  // Left column: Outliner+Parameters on top, Properties below.
  // Falls back to single panel if a workspace defines only one half.
  const leftColumn = leftTop && leftBottom ? (
    <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-l`}>
      <Panel defaultSize={55} minSize={20}>
        <Area area={leftTop} />
      </Panel>
      <PanelResizeHandle className={VERTICAL_HANDLE} />
      <Panel defaultSize={45} minSize={15}>
        <Area area={leftBottom} />
      </Panel>
    </PanelGroup>
  ) : (
    (leftTop || leftBottom) && <Area area={leftTop ?? leftBottom} />
  );

  // Center column: viewport on top; if this workspace defines a
  // 'timeline' area, split horizontally below for it.
  const centerColumn = timeline ? (
    <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-c`}>
      <Panel defaultSize={75} minSize={20}>
        {center && <Area area={center} />}
      </Panel>
      <PanelResizeHandle className={VERTICAL_HANDLE} />
      <Panel defaultSize={25} minSize={10}>
        <Area area={timeline} />
      </Panel>
    </PanelGroup>
  ) : (
    center && <Area area={center} />
  );

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={`v3-ws-${wsKey}-h2`}
      className="flex-1 min-h-0"
    >
      <Panel defaultSize={22} minSize={14} maxSize={45}>
        {leftColumn}
      </Panel>
      <PanelResizeHandle className={HORIZONTAL_HANDLE} />
      <Panel defaultSize={78} minSize={30}>
        {centerColumn}
      </Panel>
    </PanelGroup>
  );
}
