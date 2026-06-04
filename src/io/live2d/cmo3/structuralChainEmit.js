// @ts-check

import { emitBodyWarpChain } from './bodyChainEmit.js';
import { emitNeckWarp, emitFaceRotation } from './bodyRig.js';
import { emitFaceParallax } from './faceParallax.js';

/**
 * Section 3d — Structural Body Warp Chain orchestration.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #32).
 *
 * Hiyori's structural pattern:
 *   Body Warp Z (ParamBodyAngleZ, Canvas)         → ROOT
 *     └─ Body Warp Y (ParamBodyAngleY, Local)     → Body Z
 *         └─ Breath Warp (ParamBreath, Local)     → Body Y
 *             └─ Body X Warp (ParamBodyAngleX)    → Breath
 *                 ├─ Neck Warp (ParamAngleZ Y-grad) → upper-neck/neckwear
 *                 ├─ Face Rotation (ParamAngleZ ±10°)
 *                 │    └─ Face Parallax warp (ParamAngleX × ParamAngleY)
 *                 │         └─ per-face-part RigWarp_*
 *                 └─ per-body-part RigWarp_*  (re-parented from ROOT)
 * Legs stay at ROOT (independent of body rotation).
 *
 * Three phases inside the same outer guard:
 *
 *   1. **Body warp chain emit** — `bodyChainEmit.emitBodyWarpChain`
 *      translates the 4 WarpDeformerSpec entries (BZ → BY → Breath →
 *      Body X) into XML. Returns pidBreathGuid + pidBodyXGuid.
 *
 *   2. **Neck Warp + Face Rotation + Face Parallax emission** — calls
 *      `bodyRig.emitNeckWarp`, `bodyRig.emitFaceRotation`, and
 *      `faceParallax.emitFaceParallax`. Each produces its
 *      CDeformerGuid pid; FaceParallax goes into a per-group-key Map
 *      (single `'__all__'` entry today).
 *
 *   3. **Re-parenting pass** — patches XML node `xs.ref` and the
 *      mirror entries in rigCollector to point chain-relative
 *      parents at their final targets:
 *      - Rotation deformers targeting ROOT → Body X (or Breath
 *        fallback). Origin conversion: pivot-relative pixels when
 *        the parent is another rotation deformer, otherwise 0..1
 *        of Body X. CoordType label flips Canvas → DeformerLocal.
 *      - Per-part rig warps → FaceParallax / NeckWarp / Body X
 *        depending on `isFaceTag`/`isNeckTag` flags collected
 *        during section 3c emission.
 *
 * Mutates: `rigCollector` (parent refs + keyform origins),
 * `rotDeformerTargetNodes` + `rotDeformerOriginNodes` (XML attrs),
 * `rigWarpTargetNodesToReparent` (final xs.ref). Returns nothing.
 *
 * @module io/live2d/cmo3/structuralChainEmit
 */

/**
 * @param {Object} x
 * @param {Object} opts
 */
export function emitStructuralChainAndReparent(x, opts) {
  const {
    generateRig, rigOnly,
    paramDefs, pidDeformerRoot, pidCoord, rigCollector, rigDebugLog,
    autoRigConfig, faceParallaxSpec,
    bodyChain,
    pidParamBodyAngleZ, pidParamBodyAngleY, pidParamBreath,
    pidParamAngleX, pidParamAngleY, pidParamAngleZ,
    neckUnionBbox, faceUnionBbox, faceMeshBbox, facePivotCx, facePivotCy,
    groupMap,
    groupDeformerGuids, deformerWorldOrigins,
    canvasToBodyXX, canvasToBodyXY,
    rotFaceParamKeys, rotFaceAngles,
    meshes, allDeformerSources, pidPartGuid, rootPart,
    rotDeformerTargetNodes, rotDeformerOriginNodes,
    rigWarpTargetNodesToReparent,
  } = opts;

  // Shared context for per-helper emit (mutable collections + root pid refs).
  const emitCtx = { allDeformerSources, pidPartGuid, rootPart };

  let pidBreathGuid = null;
  let pidBodyXGuid = null;
  if (generateRig && pidParamBodyAngleZ && pidParamBodyAngleY && pidParamBreath) {
    ({ pidBreathGuid, pidBodyXGuid } = emitBodyWarpChain(x, {
      bodyChain, paramDefs,
      rigCollectorWarpDeformers: rigCollector.warpDeformers,
      pidDeformerRoot, pidCoord, emitCtx,
    }));
  }

  // Outer guard for sections 3d.{1,2} + re-parent pass — mirrors the
  // body chain guard above. If the body chain didn't emit, neither do
  // the structural follow-ons.
  if (!(generateRig && pidParamBodyAngleZ && pidParamBodyAngleY && pidParamBreath)) {
    return;
  }

  // ── 3d.1 Neck Warp (Session 20) ──
  // Chain: Body X → NeckWarp → neck/neckwear rig warps → neck meshes.
  // BUG-04 sibling 2026-06-04: NeckWarp parents at BodyXWarp universally;
  // see `bodyRig.emitNeckWarp` header for the dropped `groupDeformerGuids`
  // conditional that would have produced a dangling `GroupRotation_<id>`
  // rigSpec parent ref post-RULE-№4.
  const pidNeckWarpGuid = emitNeckWarp(x, {
    pidParamAngleZ, neckUnionBbox, pidBodyXGuid,
    canvasToBodyXX, canvasToBodyXY,
    pidCoord, rigDebugLog, emitCtx,
    rigCollector,
    autoRigNeckWarp: autoRigConfig?.neckWarp,
  });

  // ── 3d.2 Face Rotation + Face Parallax (Sessions 19–20) ──
  // Chain: Body X → Face Rotation (AngleZ, ±10°) → FaceParallax
  // (AngleX × AngleY) → per-face-part rig warps.
  // Coord-space contract: rotation parents expose pivot-relative
  // pixel offsets (NOT 0..1), so FaceParallax grid uses canvas - pivot.
  /** @type {Map<string, string>} */
  const faceParallaxGuids = new Map();
  if (pidParamAngleZ && facePivotCx !== null && faceUnionBbox && pidBodyXGuid) {
    const pidFaceRotGuid = emitFaceRotation(x, {
      pidParamAngleZ, facePivotCx, facePivotCy, pidBodyXGuid,
      canvasToBodyXX, canvasToBodyXY,
      allDeformerSources, pidPartGuid, pidCoord, rootPart,
      rigCollector,
      faceRotationParamKeys: rotFaceParamKeys,
      faceRotationAngles: rotFaceAngles,
    });

    if (!faceParallaxSpec && !rigOnly) {
      // Stage 11 invariant — see body-warp guard above.
      console.warn('[cmo3writer] faceParallax heuristic firing outside rigOnly mode — exporter likely bypassed Stage 11 auto-harvest');
    }
    const pidFpGuid = emitFaceParallax(x, {
      pidParamAngleX, pidParamAngleY, pidFaceRotGuid,
      faceUnionBbox, facePivotCx, facePivotCy, faceMeshBbox,
      meshes,
      allDeformerSources, rootPart,
      pidPartGuid, pidCoord,
      rigDebugLog,
      rigCollector,
      autoRigFaceParallax: autoRigConfig?.faceParallax,
      preComputedSpec: faceParallaxSpec,
    });
    if (pidFpGuid) faceParallaxGuids.set('__all__', pidFpGuid);
  }

  // ── Re-parent rotation deformers ROOT → Body X / Breath ──
  // Body X is the innermost structural warp; everything non-leg targets it.
  const pidReparentTarget = pidBodyXGuid || pidBreathGuid;
  const rigReparentTargetId = pidBodyXGuid ? 'BodyXWarp' : 'BreathWarp';

  for (const [gid, targetNode] of rotDeformerTargetNodes) {
    const group = groupMap.get(gid);
    // Pre-2026-05-08: leg roles (leftLeg/rightLeg/bothLegs/leftKnee/rightKnee)
    // were skipped here, leaving their rotation deformers parented to
    // their initial assignment (root or `GroupRotation_<g.parent>` from
    // rotationDeformerEmit:~160-162) with origin in canvas-px. The intent
    // was to keep `Rotation_bothLegs`-style dead deformers isolated. But
    // when a leg group has a parent group with a rotation deformer (e.g.
    // legBone → torso), the initial parent is `GroupRotation_torso` AND
    // the LEG_ROLES skip suppresses origin conversion → the leg
    // deformer's authored pivot gets interpreted as torso-pivot-relative-
    // px instead of canvas-px, displacing legwear meshes by the torso
    // pivot magnitude (~640 px in test_image4.psd, the "legs fly out of
    // canvas after Init Rig" bug). Dead deformers are dropped by
    // `pruneOrphanRotationDeformers` regardless, so removing the skip
    // doesn't resurrect anything that wasn't already alive.

    if (targetNode.attrs['xs.ref'] === pidDeformerRoot) {
      targetNode.attrs['xs.ref'] = pidReparentTarget;
      const rigSpecD = rigCollector.rotationDeformers.find(
        s => s.id === `GroupRotation_${gid}`,
      );
      if (rigSpecD && rigSpecD.parent.type === 'root') {
        rigSpecD.parent = { type: 'warp', id: rigReparentTargetId };
      }
    }

    // Convert origin for ALL non-leg deformers using world position.
    const originData = rotDeformerOriginNodes.get(gid);
    if (originData) {
      const parentRef = targetNode.attrs['xs.ref'];
      const pGroupId = group ? group.parent : null;
      const isParentGroupRot = pGroupId && groupDeformerGuids.get(pGroupId) === parentRef;

      let ox, oy;
      if (isParentGroupRot) {
        // Rotation parent → pixel offsets from parent's pivot
        const parentPivot = deformerWorldOrigins.get(pGroupId) || { x: 0, y: 0 };
        ox = originData.wx - parentPivot.x;
        oy = originData.wy - parentPivot.y;
      } else {
        // Warp parent (Body X / Neck etc) → 0..1 of Body X space
        ox = canvasToBodyXX(originData.wx);
        oy = canvasToBodyXY(originData.wy);
      }

      const newOx = ox.toFixed(6);
      const newOy = oy.toFixed(6);
      for (const rdf of originData.forms) {
        rdf.attrs.originX = newOx;
        rdf.attrs.originY = newOy;
      }
      // Patch shared CoordType: Canvas → DeformerLocal post-conversion.
      const coordTextNode = originData.coordNode.children.find(c => c.attrs?.['xs.n'] === 'coordName');
      if (coordTextNode) coordTextNode.text = 'DeformerLocal';

      // Mirror converted pivot into rigCollector — moc3 emits this
      // value too, so keep it in sync.
      const rigSpecConv = rigCollector.rotationDeformers.find(
        s => s.id === `GroupRotation_${gid}`,
      );
      if (rigSpecConv) {
        for (const kf of rigSpecConv.keyforms) {
          kf.originX = ox;
          kf.originY = oy;
        }
      }
    }
  }

  // ── Re-parent per-part rig warps ──
  // Face tag → FaceParallax, neck tag → NeckWarp, default → Body X.
  // Grids were already rebased to the appropriate 0..1 domain in section 3c.
  const pidFpUnified = faceParallaxGuids.get('__all__');
  for (const entry of rigWarpTargetNodesToReparent) {
    const { node, isFaceTag, isNeckTag } = entry;
    if (isFaceTag && pidFpUnified) {
      node.attrs['xs.ref'] = pidFpUnified;
    } else if (isNeckTag && pidNeckWarpGuid) {
      node.attrs['xs.ref'] = pidNeckWarpGuid;
    } else {
      node.attrs['xs.ref'] = pidReparentTarget;
    }
  }
}
