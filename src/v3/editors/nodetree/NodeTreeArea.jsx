// @ts-check

/**
 * V2 Phase N-4 / final wire (2026-05-07) — NodeTree editor area host.
 *
 * Mounted as the `nodeTree` editor type (see `editorRegistry.js`).
 * Owns the local mode pill that flips between RigTree / DriverTree /
 * AnimationTree views and routes the active selection's tree into
 * the shared, read-only `NodeTreeEditor` SVG renderer.
 *
 * Selection sources:
 *  - Rig: `editorStore.selection[0]` interpreted as a partId.
 *  - Driver: `editorStore.selection[0]` interpreted as a paramId.
 *    (UX limitation in v1: selecting a parameter is a Parameters-panel
 *     concern that landed post-N-4. Until that lands, the user picks
 *     a paramId from a small dropdown sourced from `nodeTrees.driver`.)
 *  - Animation: scene-bound action wins, falling back to
 *    `animationStore.activeActionId` (Stage 1.E rewire 2026-05-11).
 *
 * No edit ops yet — the underlying datablocks are still derived from
 * the legacy mirrors (modifiers / drivers / animations). Phase N-5
 * lands edit ops behind a separate flag (`riggingPath: 'nodeTree'`).
 *
 * @module v3/editors/nodetree/NodeTreeArea
 */

import { useMemo, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { NodeTreeEditor } from './NodeTreeEditor.jsx';

/** @type {Array<{ id: 'rig'|'driver'|'animation', label: string }>} */
const MODES = [
  { id: 'rig',       label: 'Rig' },
  { id: 'driver',    label: 'Driver' },
  { id: 'animation', label: 'Animation' },
];

export function NodeTreeArea() {
  const [mode, setMode] = useState(/** @type {'rig'|'driver'|'animation'} */ ('rig'));

  const project = useProjectStore((s) => s.project);
  const selectionHead = useEditorStore((s) => (Array.isArray(s.selection) && s.selection.length > 0 ? s.selection[0] : null));
  const uiActiveActionId = useAnimationStore((s) => s.activeActionId);
  // Stage 1.E: scene-bound action wins over UI-store fallback. The
  // legacy `project.nodeTrees.animation` shadow trees are keyed by
  // action id; resolution order is identical to the rest of the
  // editor surface — `__scene__.animData.actionId` first, then the
  // UI store's last-clicked id.
  const activeActionId = useMemo(
    () => getActiveSceneAction(project, uiActiveActionId)?.id ?? null,
    [project.nodes, project.actions, uiActiveActionId],
  );

  // Driver mode — when selection isn't a paramId, fall back to the
  // first driverTree key so the user sees a non-empty graph instead
  // of the "No tree" empty-state.
  const [driverFallbackId, setDriverFallbackId] = useState(/** @type {string|null} */ (null));

  const trees = project?.nodeTrees ?? null;

  const tree = useMemo(() => {
    if (!trees) return null;
    if (mode === 'rig') {
      const dict = trees.rig ?? {};
      if (selectionHead && dict[selectionHead]) return dict[selectionHead];
      return null;
    }
    if (mode === 'driver') {
      const dict = trees.driver ?? {};
      if (selectionHead && dict[selectionHead]) return dict[selectionHead];
      if (driverFallbackId && dict[driverFallbackId]) return dict[driverFallbackId];
      const firstKey = Object.keys(dict)[0];
      return firstKey ? dict[firstKey] : null;
    }
    if (mode === 'animation') {
      const dict = trees.animation ?? {};
      if (activeActionId && dict[activeActionId]) return dict[activeActionId];
      const firstKey = Object.keys(dict)[0];
      return firstKey ? dict[firstKey] : null;
    }
    return null;
  }, [trees, mode, selectionHead, activeActionId, driverFallbackId]);

  const subtitle = useMemo(() => {
    if (mode === 'rig') {
      if (!selectionHead) return 'Select a part to view its rig tree';
      return `RigTree · part ${selectionHead}`;
    }
    if (mode === 'driver') {
      const dict = trees?.driver ?? {};
      const id = (selectionHead && dict[selectionHead]) ? selectionHead
        : (driverFallbackId && dict[driverFallbackId]) ? driverFallbackId
        : Object.keys(dict)[0] ?? null;
      return id ? `DriverTree · ${id}` : 'No driven parameters';
    }
    if (mode === 'animation') {
      const dict = trees?.animation ?? {};
      const id = (activeActionId && dict[activeActionId])
        ? activeActionId : Object.keys(dict)[0] ?? null;
      return id ? `AnimationTree · ${id}` : 'No animations';
    }
    return '';
  }, [mode, trees, selectionHead, activeActionId, driverFallbackId]);

  const driverIds = useMemo(() => Object.keys(trees?.driver ?? {}), [trees]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={
                'text-xs px-2 py-0.5 rounded transition-colors ' +
                (active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted')
              }
            >
              {m.label}
            </button>
          );
        })}
        {mode === 'driver' && driverIds.length > 0 && (
          <select
            className="text-xs ml-2 bg-muted text-foreground rounded px-1 py-0.5"
            value={(selectionHead && (trees?.driver ?? {})[selectionHead]) ? selectionHead
              : (driverFallbackId ?? driverIds[0])}
            onChange={(e) => setDriverFallbackId(e.target.value)}
          >
            {driverIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        )}
      </div>
      <NodeTreeEditor tree={tree} title={subtitle} />
    </div>
  );
}
