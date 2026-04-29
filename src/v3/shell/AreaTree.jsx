// @ts-check

/**
 * v3 Phase 0A — Splittable area layout (2×2 fixed for now).
 *
 * Phase 0A ships the simplest non-trivial layout — four areas tiled
 * 2×2 with `react-resizable-panels` so the user can drag the
 * splitters. The component reads the active workspace's `areas[]`
 * (by id 'tl' / 'tr' / 'bl' / 'br') and slots each one into a panel.
 *
 * Phase 1+ replaces this with a recursive split-tree where every
 * splitter can be split further (Blender's "drag the corner to
 * subdivide"). The Area child component already takes the layout
 * shape it'll need then; only this file has to change.
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
  const tl = byId.tl, tr = byId.tr, bl = byId.bl, br = byId.br;

  // PanelGroup ids embed the workspace key so a workspace switch
  // remounts the tree (each workspace owns its splitter ratios in
  // localStorage via react-resizable-panels' autoSaveId).
  const wsKey = activeWorkspace;

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={`v3-ws-${wsKey}-h`}
      className="flex-1 min-h-0"
    >
      <Panel defaultSize={70} minSize={20}>
        <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-l`}>
          <Panel defaultSize={70} minSize={20}>
            {tl && <Area area={tl} />}
          </Panel>
          <PanelResizeHandle className={VERTICAL_HANDLE} />
          <Panel defaultSize={30} minSize={10}>
            {bl && <Area area={bl} />}
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className={HORIZONTAL_HANDLE} />
      <Panel defaultSize={30} minSize={15}>
        <PanelGroup direction="vertical" autoSaveId={`v3-ws-${wsKey}-r`}>
          <Panel defaultSize={50} minSize={20}>
            {tr && <Area area={tr} />}
          </Panel>
          <PanelResizeHandle className={VERTICAL_HANDLE} />
          <Panel defaultSize={50} minSize={20}>
            {br && <Area area={br} />}
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}
