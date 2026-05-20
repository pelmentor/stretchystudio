// @ts-check

/**
 * Animation Phase 7 Slice 7.G — "insert all properties" keyframe fan-out.
 *
 * Extracted verbatim from the legacy K-key handler in `CanvasViewport.jsx`
 * (was inline in the `updateProject` recipe). Two reasons for the lift:
 *
 *   1. **Testability.** The fan-out lived inside a React effect and was
 *      never unit-tested; pulling it into a pure store-free function lets
 *      `test_insertAllProperties.mjs` pin its exact behaviour.
 *   2. **K-rebind preference (§7.G).** With the fan-out callable, the
 *      K-key handler can branch on `preferencesStore.kKeyOpensMenu`:
 *      open the I-menu (Blender-faithful "always prompt") vs. run this
 *      legacy "insert every visible property" path. See plan §7.E/§7.G.
 *
 * For each selected node this keys: every `KEYFRAME_PROPS` transform
 * channel, `mesh_verts` (deform parts only — gated on an existing
 * deform draft or fcurve), and every blend-shape influence. Per channel
 * the keyed value is taken from the highest-priority source available:
 * `draftPose` (live drag) > `keyframeOverrides` (current keyform) >
 * the base node value. When a fcurve is newly created and the playhead
 * sits past `startMs`, an auto rest-pose keyform is inserted at `startMs`
 * first, so the channel holds rest before the new key.
 *
 * Mutates `draft` in place — the caller wraps it in `updateProject`. All
 * volatile inputs (overrides + rest/draft pose maps + frame bounds) are
 * passed in, so the function is pure with respect to the Zustand stores.
 *
 * @module renderer/insertAllProperties
 */

import { KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe, upsertMeshKeyframe } from './animationEngine.js';
import { buildNodeFCurve, decodeFCurveTarget } from '../anim/animationFCurve.js';
import { getMesh } from '../store/objectDataAccess.js';

/**
 * Find a node-targeted fcurve for (`nodeId`, `property`) in an action, or
 * undefined. Narrows the `decodeFCurveTarget` union to the `'node'` kind
 * so the `.property` access is type-safe.
 *
 * @param {{fcurves: Array<any>}} action
 * @param {string} nodeId
 * @param {string} property
 */
function findNodeFCurve(action, nodeId, property) {
  return action.fcurves.find((f) => {
    const t = decodeFCurveTarget(f);
    return t?.kind === 'node' && t.nodeId === nodeId && t.property === property;
  });
}

/**
 * @typedef {Object} InsertAllPropertiesCtx
 * @property {string} actionId               id of the action to write into
 * @property {string[]} selectedIds          node ids to key (selection, pre-expanded for JS-skinning joints)
 * @property {number} currentTimeMs          playhead time (canonical ms)
 * @property {number} startMs                action start time (canonical ms) — anchor for the auto rest keyform
 * @property {Map<string, any>} keyframeOverrides  per-node `computePoseOverrides` result at `currentTimeMs`
 * @property {Map<string, any>} restPose      per-node rest snapshot (from `animationStore.restPose`)
 * @property {Map<string, any>} draftPose     per-node live-drag draft (from `animationStore.draftPose`)
 */

/**
 * @param {object} draft - immer draft of the project
 * @param {InsertAllPropertiesCtx} ctx
 */
export function insertAllPropertyKeyframes(draft, ctx) {
  const { actionId, selectedIds, currentTimeMs, startMs, keyframeOverrides, restPose, draftPose } = ctx;

  const action = draft.actions.find((a) => a.id === actionId);
  if (!action) return;
  if (!Array.isArray(action.fcurves)) action.fcurves = [];

  for (const nodeId of selectedIds) {
    const node = draft.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const rest = restPose.get(nodeId);
    const draftP = draftPose.get(nodeId);
    const kfValues = keyframeOverrides.get(nodeId);

    for (const prop of KEYFRAME_PROPS) {
      // Read value from highest-priority source: draft > current keyform > base transform
      let value;
      if (draftP && draftP[prop] !== undefined) {
        value = draftP[prop];
      } else if (kfValues && kfValues[prop] !== undefined) {
        value = kfValues[prop];
      } else {
        value = getNodePropertyValue(node, prop);
      }

      let fc = findNodeFCurve(action, nodeId, prop);
      const isNewFCurve = !fc;
      if (!fc) {
        fc = buildNodeFCurve(nodeId, prop, []) ?? {
          id: `${nodeId}.${prop}`,
          rnaPath: `objects["${nodeId}"].${prop}`,
          arrayIndex: 0,
          keyforms: [],
          modifiers: [],
          extrapolation: 'constant',
        };
        action.fcurves.push(fc);
      }

      // Auto-insert a rest-pose keyform at startFrame when this is the
      // first keyform for this fcurve and we're past the start.
      if (isNewFCurve && currentTimeMs > startMs && rest) {
        const baseVal = prop === 'opacity' ? (rest.opacity ?? 1)
          : (rest[prop] ?? (prop === 'scaleX' || prop === 'scaleY' ? 1 : 0));
        upsertKeyframe(fc.keyforms, startMs, baseVal, 'linear');
      }

      upsertKeyframe(fc.keyforms, currentTimeMs, value, 'linear');
    }

    // ── mesh_verts keyform (deform mode) ───────────────────────────
    // Only create/update if the node actually has a mesh deform in draft,
    // or if a mesh_verts fcurve already exists. This prevents accidental
    // mesh_verts keyforms from blocking blend shape animation.
    const nodeMesh = getMesh(node, draft);
    if (node.type === 'part' && nodeMesh) {
      const hasMeshDeform = draftP?.mesh_verts !== undefined;
      let meshFC = findNodeFCurve(action, nodeId, 'mesh_verts');

      if (hasMeshDeform || meshFC) {
        const meshVerts = draftP?.mesh_verts
          ?? kfValues?.mesh_verts
          ?? nodeMesh.vertices.map((v) => ({ x: v.x, y: v.y }));

        const isNewMeshFC = !meshFC;
        if (!meshFC) {
          meshFC = buildNodeFCurve(nodeId, 'mesh_verts', []) ?? {
            id: `${nodeId}.mesh_verts`,
            rnaPath: `objects["${nodeId}"].mesh_verts`,
            arrayIndex: 0,
            keyforms: [],
            modifiers: [],
            extrapolation: 'constant',
          };
          action.fcurves.push(meshFC);
        }

        // Auto-insert base-mesh keyform at startFrame if this is the first keyform
        if (isNewMeshFC && currentTimeMs > startMs) {
          const baseVerts = nodeMesh.vertices.map((v) => ({ x: v.x, y: v.y }));
          upsertMeshKeyframe(meshFC.keyforms, startMs, baseVerts, 'linear');
        }

        upsertMeshKeyframe(meshFC.keyforms, currentTimeMs, meshVerts, 'linear');
      }
    }

    // ── blend shape influence keyforms ───────────────────────────────
    if (node.type === 'part' && node.blendShapes?.length) {
      for (const shape of node.blendShapes) {
        const prop = `blendShape:${shape.id}`;
        const value = draftP?.[prop] ?? kfValues?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;

        let fc = findNodeFCurve(action, nodeId, prop);
        const isNewFCurve = !fc;
        if (!fc) {
          fc = buildNodeFCurve(nodeId, prop, []) ?? {
            id: `${nodeId}.${prop}`,
            rnaPath: `objects["${nodeId}"].${prop}`,
            arrayIndex: 0,
            keyforms: [],
            modifiers: [],
            extrapolation: 'constant',
          };
          action.fcurves.push(fc);
        }

        // Auto-insert rest-pose keyform at startFrame if this is the first keyform
        if (isNewFCurve && currentTimeMs > startMs && rest) {
          upsertKeyframe(fc.keyforms, startMs, node.blendShapeValues?.[shape.id] ?? 0, 'linear');
        }

        upsertKeyframe(fc.keyforms, currentTimeMs, value, 'linear');
      }
    }
  }
}
