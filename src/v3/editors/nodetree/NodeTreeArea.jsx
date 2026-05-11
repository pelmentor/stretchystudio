// @ts-check

/**
 * V2 Phase N-4 / Stage 1.F (pre-exit) — NodeTree editor area host.
 *
 * Mounted as the `nodeTree` editor type (see `editorRegistry.js`).
 * Owns the local mode pill that flips between RigTree / DriverTree /
 * AnimationTree views and routes the active selection's tree into
 * the shared, read-only `NodeTreeEditor` SVG renderer.
 *
 * # Post-v38 retirement
 *
 * Pre-v38 the area read the `nodeTrees` shadow on the project root —
 * a dual-write shadow populated by v22 / v23 / v24 migrations (modules
 * + dispatch entries deleted in the v38 retirement + Stage 1.F-post
 * walker refactor). Post-v38 (Animation Phase 1 Stage 1.F pre-exit)
 * the persisted shadow is gone;
 * each mode derives its tree on-the-fly from canonical state:
 *
 *  - rig:       `buildRigTreeForPart(part)` walks `part.modifiers[]`
 *               (the canonical post-v20 Blender-style modifier stack).
 *  - driver:    `compileDriverTree(paramId, param.driver)` parses the
 *               driver's expression into a graph.
 *  - animation: `compileAnimationTree(action)` walks the action's
 *               `fcurves[]` (the canonical post-v36 Action datablock
 *               shape; scene-bound action wins via
 *               `getActiveSceneAction`, UI store fallback).
 *
 * The compile passes are pure functions; the area memoises per-mode
 * via `useMemo` with narrow deps so the tree only rebuilds when its
 * canonical source changes. Cheap — even a 100-part project rebuilds
 * one rig tree per render (linear in modifier count, ~20 nodes max).
 *
 * # Documented Blender deviations
 *
 * - **Datablock vs derived view (Audit-fix D-2)**: Blender treats
 *   `bNodeTree` as a first-class `ID_NT` datablock peer of `ID_OB`
 *   (`reference/blender/source/blender/makesdna/DNA_node_types.h:1879-1882`)
 *   so it can drive undo, library linking, and library overrides per
 *   datablock. SS treats RigTree / DriverTree / AnimationTree as
 *   derived render-time views because none of those Blender features
 *   apply to a read-only inspector — undo flows through canonical
 *   source mutations, no library system, no overrides.
 * - **Read-only surface (Audit-fix D-6)**: see `NodeTreeEditor.jsx`
 *   module JSDoc — Blender's `space_node` is edit-capable; SS edits
 *   flow through the canonical sources (modifier-stack mutations on
 *   parts, driver-expression edits on parameters, fcurve edits in
 *   DopesheetEditor / FCurveEditor).
 * - **Mode-pill labels carry canonical-source hints (Audit-fix D-7)**:
 *   labels read `'Rig (Modifiers)'` / `'Driver (Expression)'` /
 *   `'Animation (FCurves)'` to nudge the user toward the right
 *   edit surfaces. Blender's NodeEditor `tree_type` enum
 *   (`DNA_node_types.h:274-283`) names types but doesn't disclose
 *   edit surfaces because the editor IS edit-capable — SS extends
 *   the labels because the surface here is read-only.
 *
 * @module v3/editors/nodetree/NodeTreeArea
 */

import { useMemo, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { buildRigTreeForPart } from '../../../anim/nodetree/build.js';
import { compileDriverTree } from '../../../anim/nodetree/driverCompile.js';
import { compileAnimationTree } from '../../../anim/nodetree/animationCompile.js';
import { NodeTreeEditor } from './NodeTreeEditor.jsx';

// Side-effect imports: register the driver + animation node types so
// `NodeTreeEditor`'s `getNodeType` calls resolve their labels. Pre-v38
// these were side-effect-imported by v23 + v24 migrations (modules
// deleted in v38). The editor area is the canonical consumer
// entrypoint post-v38.
import '../../../anim/nodetree/nodes/drivers.js';
import '../../../anim/nodetree/nodes/animation.js';

/**
 * Mode-pill labels carry canonical-source hints (Audit-fix D-7).
 * Blender's NodeEditor `tree_type` enum (`DNA_node_types.h:274-283`)
 * names types but doesn't disclose edit surfaces because the editor
 * IS edit-capable. SS's NodeTreeArea is read-only — the hints make
 * "where do I edit this?" discoverable from the pill itself.
 *
 * @type {Array<{ id: 'rig'|'driver'|'animation', label: string }>}
 */
const MODES = [
  { id: 'rig',       label: 'Rig (Modifiers)' },
  { id: 'driver',    label: 'Driver (Expression)' },
  { id: 'animation', label: 'Animation (FCurves)' },
];

export function NodeTreeArea() {
  const [mode, setMode] = useState(/** @type {'rig'|'driver'|'animation'} */ ('rig'));

  const project = useProjectStore((s) => s.project);
  const selectionHead = useEditorStore((s) => (Array.isArray(s.selection) && s.selection.length > 0 ? s.selection[0] : null));
  const uiActiveActionId = useAnimationStore((s) => s.activeActionId);

  // Stage 1.E rewire: scene-bound action wins over UI-store fallback.
  // Resolution is the same as every other editor surface —
  // `__scene__.animData.actionId` first, then the UI store's last-clicked id.
  const activeActionId = useMemo(
    () => getActiveSceneAction(project, uiActiveActionId)?.id ?? null,
    [project.nodes, project.actions, uiActiveActionId],
  );

  // Driver mode — when selection isn't a paramId, fall back to the
  // first driven param so the user sees a non-empty graph instead of
  // the "No tree" empty-state.
  const [driverFallbackId, setDriverFallbackId] = useState(/** @type {string|null} */ (null));

  // Enumerate driven parameter ids on the fly (no persisted shadow).
  const driverIds = useMemo(() => {
    const params = Array.isArray(project?.parameters) ? project.parameters : [];
    return params.filter((p) => p && p.driver).map((p) => p.id);
  }, [project.parameters]);

  // Derive the active tree on the fly from canonical sources.
  // Audit-fix G-5: `driverIds` removed from deps — it's already a
  // memoised derivative of `project.parameters` (which IS in the deps),
  // so listing both is redundant.
  const tree = useMemo(() => {
    if (mode === 'rig') {
      if (!selectionHead) return null;
      const part = (project?.nodes ?? []).find((n) => n?.id === selectionHead && n?.type === 'part');
      if (!part) return null;
      return buildRigTreeForPart(part);
    }
    if (mode === 'driver') {
      const params = Array.isArray(project?.parameters) ? project.parameters : [];
      const pickId =
        (selectionHead && params.some((p) => p?.id === selectionHead && p?.driver))
          ? selectionHead
          : (driverFallbackId && params.some((p) => p?.id === driverFallbackId && p?.driver))
            ? driverFallbackId
            : params.find((p) => p?.driver)?.id ?? null;
      if (!pickId) return null;
      const param = params.find((p) => p?.id === pickId);
      if (!param || !param.driver) return null;
      return compileDriverTree(pickId, param.driver);
    }
    if (mode === 'animation') {
      const actions = Array.isArray(project?.actions) ? project.actions : [];
      const pickId = activeActionId && actions.some((a) => a?.id === activeActionId)
        ? activeActionId
        : actions[0]?.id ?? null;
      if (!pickId) return null;
      const action = actions.find((a) => a?.id === pickId);
      if (!action) return null;
      return compileAnimationTree(action);
    }
    return null;
  }, [mode, project.nodes, project.parameters, project.actions, selectionHead, activeActionId, driverFallbackId]);

  const subtitle = useMemo(() => {
    if (mode === 'rig') {
      if (!selectionHead) return 'Select a part to view its rig tree';
      return `RigTree · part ${selectionHead}`;
    }
    if (mode === 'driver') {
      const id = tree?.id?.replace(/^driver:/, '') ?? null;
      return id ? `DriverTree · ${id}` : 'No driven parameters';
    }
    if (mode === 'animation') {
      const id = tree?.actionId ?? null;
      return id ? `AnimationTree · ${id}` : 'No actions';
    }
    return '';
  }, [mode, selectionHead, tree]);

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
            value={(selectionHead && driverIds.includes(selectionHead))
              ? selectionHead
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
