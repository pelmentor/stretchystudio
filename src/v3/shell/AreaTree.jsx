// @ts-check

/**
 * v3 1A.UX — Splittable area layout.
 *
 * Default 3-column layout (Left | Center | Right). Animation
 * workspace adds a horizontal split below the center for the
 * Timeline. A workspace's areas are looked up by id rather than
 * positional index so the rest of the shell can find specific
 * panels (left / center / right / timeline) without positional
 * coupling.
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
  const left      = byId.left;
  const center    = byId.center;
  const timeline  = byId.timeline;
  const right     = byId.right;

  const wsKey = activeWorkspace;

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
      autoSaveId={`v3-ws-${wsKey}-h`}
      className="flex-1 min-h-0"
    >
      <Panel defaultSize={20} minSize={12} maxSize={40}>
        {left && <Area area={left} />}
      </Panel>
      <PanelResizeHandle className={HORIZONTAL_HANDLE} />
      <Panel defaultSize={56} minSize={25}>
        {centerColumn}
      </Panel>
      <PanelResizeHandle className={HORIZONTAL_HANDLE} />
      <Panel defaultSize={24} minSize={12} maxSize={40}>
        {right && <Area area={right} />}
      </Panel>
    </PanelGroup>
  );
}
