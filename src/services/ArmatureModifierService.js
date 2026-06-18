// @ts-check

/**
 * Armature modifier operators — Blender-style "Apply" on a per-part
 * Armature modifier.
 *
 * Mirrors `modifier_apply_obdata` in
 * `reference/blender/source/blender/editors/object/object_modifier.cc:1050`,
 * specialised for the deform-only Armature case
 * (`reference/blender/source/blender/modifiers/intern/MOD_armature.cc:115`).
 *
 * **Semantics.** Apply takes whatever the viewport currently shows for
 * the part — i.e. the full eval pipeline output: depgraph
 * (`evalProjectFrameViaDepgraph`) producing canvas-px verts, then
 * two-bone LBS on top — and writes the result into `mesh.vertices`.
 * The Armature modifier entry is then removed from `node.modifiers[]`.
 * After Apply, the part is no longer skinned to the armature; its rest
 * geometry IS the previously-deformed geometry. Mirrors Blender's
 * behaviour: the Armature modifier dropdown → Apply bakes the deformation
 * permanently and removes the modifier.
 *
 * **Composes with the SS workflow.** Typical sequence (from the user's
 * own description, 2026-05-08):
 *   1. Pose the bones (Pose Mode arc gestures) — visible deformation
 *      is the two-bone LBS we just shipped.
 *   2. For each rigged mesh, click "Apply" on its Armature modifier
 *      → this function. Mesh now stores the posed geometry as rest.
 *      Modifier disappears.
 *   3. On the armature, "Apply Pose as Rest" → bone pose channels are
 *      zeroed and the rest absorbs the pose. Bones look unchanged.
 *   4. Re-rig: re-add the Armature modifier (currently via re-running
 *      Init Rig; future: a one-click re-bind operator).
 *
 * @module services/ArmatureModifierService
 */

import { useProjectStore } from '../store/projectStore.js';
import { useParamValuesStore } from '../store/paramValuesStore.js';
import { selectRigSpec } from '../io/live2d/rig/selectRigSpec.js';
import { evalProjectFrameViaDepgraph } from '../anim/depgraph/evalProjectFrame.js';
import { computeBoneParentMap } from '../renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinningObj } from '../renderer/boneSkinning.js';
import { logger } from '../lib/logger.js';
import { getMesh } from '../store/objectDataAccess.js';

/**
 * Least-squares fit of a 2D affine map  out = A·in + t  (6 params) from
 * corresponding flat point arrays. Returns the map plus its max residual on
 * the input pairs, so callers can reject a NON-affine correspondence (a
 * non-uniform deformer grid) instead of silently reprojecting through a bad
 * map.
 *
 * The keyform-frame conversion this powers (canvas-px → deformer-local) is
 * EXACT when the leaf deformer's rest lift is affine — which it is for SS's
 * rig (warp rest grids are built with uniform canvas spacing; a rotation rest
 * map is a rigid transform). The fit recovers that exact map (including cage
 * padding / pivot offset) from the part's OWN rest correspondence, so it
 * round-trips even for posed verts that fall OUTSIDE the rest bbox (a bent
 * limb), where naive bbox-normalisation would extrapolate.
 *
 * @param {number[]|Float32Array} src  flat [x0,y0,x1,y1,...] (input space)
 * @param {number[]|Float32Array} dst  flat, same length (output space)
 * @returns {{ map: (x:number,y:number)=>[number,number], residual: number }|null}
 */
function _fitAffine2D(src, dst) {
  const n = src.length >> 1;
  if (n < 3 || dst.length !== src.length) return null;
  // Per-output-axis linear least squares against [x, y, 1].
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0;
  let Ux = 0, Uy = 0, U1 = 0, Vx = 0, Vy = 0, V1 = 0;
  for (let i = 0; i < n; i++) {
    const x = src[2 * i], y = src[2 * i + 1];
    const u = dst[2 * i], v = dst[2 * i + 1];
    Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y;
    Ux += u * x; Uy += u * y; U1 += u;
    Vx += v * x; Vy += v * y; V1 += v;
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const solve = (b) => {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let k = c; k < 4; k++) M[c][k] /= d;
      for (let r = 0; r < 3; r++) if (r !== c) {
        const f = M[r][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3], M[1][3], M[2][3]];
  };
  const ax = solve([Ux, Uy, U1]);
  const ay = solve([Vx, Vy, V1]);
  if (!ax || !ay) return null;
  const map = /** @type {(x:number,y:number)=>[number,number]} */ (
    (x, y) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]]
  );
  let residual = 0;
  for (let i = 0; i < n; i++) {
    const [u, v] = map(src[2 * i], src[2 * i + 1]);
    residual = Math.max(residual, Math.hypot(u - dst[2 * i], v - dst[2 * i + 1]));
  }
  return { map, residual };
}

/** Flatten an `{x,y}[]` vertex array to `[x0,y0,x1,y1,...]`. */
function _flattenObjVerts(verts) {
  const out = new Array(verts.length * 2);
  for (let i = 0; i < verts.length; i++) { out[2 * i] = verts[i].x; out[2 * i + 1] = verts[i].y; }
  return out;
}

/**
 * Apply the Armature modifier on a part: bake the current visible
 * deformation into `mesh.vertices` and remove the modifier from
 * `node.modifiers[]`.
 *
 * Idempotent in the absence of the modifier — if the part has no
 * Armature modifier, this is a no-op (mirrors Blender's UI which
 * just hides the dropdown when no Armature is present).
 *
 * @param {string} partId
 * @returns {{ baked: boolean, vertCount: number, reason?: string }}
 */
export function applyArmatureModifier(partId) {
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const part = project?.nodes?.find((n) => n.id === partId) ?? null;
  if (!part || part.type !== 'part') {
    return { baked: false, vertCount: 0, reason: 'not-a-part' };
  }
  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  const armatureIdx = stack.findIndex((m) => m?.type === 'armature');
  if (armatureIdx < 0) {
    return { baked: false, vertCount: 0, reason: 'no-armature-modifier' };
  }
  // v18 (Object/ObjectData split): geometry lives on a sibling `meshData`
  // node via `node.dataId`. Pre-fix this read returned null for every
  // post-v18 part, so Apply Armature reported `reason:'no-mesh-vertices'`
  // even when the part DID have a meshData node — Apply was silently
  // broken on any loaded project past schemaVersion 18.
  const mesh = getMesh(part, project);
  const restVerts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  if (!restVerts || restVerts.length === 0) {
    return { baked: false, vertCount: 0, reason: 'no-mesh-vertices' };
  }
  const armature = stack[armatureIdx];
  const jointBoneId = armature.data?.jointBoneId ?? null;
  if (typeof jointBoneId !== 'string' || jointBoneId.length === 0) {
    return { baked: false, vertCount: 0, reason: 'armature-missing-jointBoneId' };
  }
  const partWeights = Array.isArray(mesh?.boneWeights) ? mesh.boneWeights : null;
  if (!partWeights || partWeights.length < restVerts.length) {
    return { baked: false, vertCount: 0, reason: 'missing-or-short-boneWeights' };
  }

  // Run a one-shot depgraph eval with current paramValues so the bake
  // captures any baked-keyform deformation under
  // `ParamRotation_<bone>` etc. — not just the rest geometry. For
  // the common case (slider at 0) depgraph's output equals the rest
  // verts and the bake reduces to LBS-of-rest.
  //
  // Engine port 2026-05-26: was `evalRig(rigSpec, paramValues)`
  // (chainEval); now `evalProjectFrameViaDepgraph` (the sole viewport
  // engine since Phase 7 close-out). chainEval is retained only for the
  // `scripts/cubism_oracle/*.mjs` byte-fidelity harness; production
  // Apply-Armature must consume depgraph output so the bake matches
  // what the user sees in the viewport (Blender's `modifier_apply_obdata`
  // semantics: Apply takes what the viewport shows). The `rigSpec`
  // option is REQUIRED so selectRigSpec's modifier-toggle reprojection
  // fires (otherwise depgraph reads raw `mesh.runtime` in baked leaf
  // frame and toggled-off modifiers land verts wrong).
  const rigSpec = selectRigSpec(project);
  const paramValues = useParamValuesStore.getState().values ?? {};
  // rule-4-05 fix: always invoke the depgraph eval (even with a null
  // rigSpec — bone TRANSFORM_COMPOSE outputs come from project.nodes
  // regardless of rigSpec) so we can populate constraint-aware bone
  // WORLD matrices. Pre-fix this used
  // `computeBoneWorldMatrices(project.nodes)` from boneOverlayMatrix.js
  // which reads `node.pose` directly, silently bypassing
  // COPY_ROTATION / TRACK_TO / LIMIT_ROTATION constraints — so Apply
  // disagreed with the viewport whenever the rig had bone constraints.
  /** @type {Map<string, Float32Array>} */
  const boneWorld = new Map();
  const hasRigSpec = rigSpec && Array.isArray(rigSpec.artMeshes) && rigSpec.artMeshes.length > 0;
  const frames = evalProjectFrameViaDepgraph(project, paramValues, {
    rigSpec: hasRigSpec ? rigSpec : undefined,
    outBoneWorldMatrices: boneWorld,
  });
  // The depgraph frame IS the exact viewport geometry for this part — the
  // kernel already ran the full deformer chain AND `applyBonePostChainSkin`
  // (two-bone LBS) at the current pose. Baking it verbatim is Blender's
  // "Apply takes what the viewport shows" (modifier_apply_obdata). When a
  // frame is available we use it directly and DO NOT re-skin below.
  //
  // BUGFIX 2026-06-18: `frame.vertexPositions` is a Float32Array, so the
  // prior `Array.isArray(...)` gate was ALWAYS false — every Apply silently
  // fell through to the rest+manual-LBS fallback, which re-derives the pose
  // instead of consuming the viewport the code's own contract (see header)
  // promises. For a bone-only part rest+LBS happens to equal the frame, but
  // for any part carrying additional (chain / param) deformation the two
  // diverge — and a divergent re-derivation can fling verts off-canvas
  // ("the arm disappears"). Accept typed arrays via ArrayBuffer.isView.
  let baseVerts;
  let baseFromFrame = false;
  if (hasRigSpec) {
    const frame = frames.find((f) => f.id === partId) ?? null;
    const vp = frame?.vertexPositions;
    if (vp && (ArrayBuffer.isView(vp) || Array.isArray(vp)) && vp.length === restVerts.length * 2) {
      baseVerts = new Array(restVerts.length);
      for (let i = 0; i < restVerts.length; i++) {
        baseVerts[i] = { x: vp[i * 2], y: vp[i * 2 + 1] };
      }
      baseFromFrame = true;
    }
  }
  if (!baseFromFrame) {
    // No matching frame (unrigged / un-harvested part) — fall back to the
    // rest verts and skin them manually below.
    baseVerts = restVerts.map((v) => ({ x: v.x, y: v.y }));
  }

  // Two-bone LBS using the constraint-aware bone WORLD matrices the
  // depgraph eval populated above. ONLY for the rest-vert fallback — when
  // baseVerts came from the depgraph frame they are ALREADY skinned (the
  // kernel ran `applyBonePostChainSkin`), so re-skinning here would DOUBLE
  // the bone rotation and fling the mesh off-canvas. The rigid-intent
  // (all-1.0 weights) and true-skinning cases both reduce correctly: the
  // fallback skins rest→posed; the frame path is posed already.
  const boneParents = computeBoneParentMap(project.nodes);
  const childMatrix = boneWorld.get(jointBoneId) ?? null;
  const parentBoneId = armature.data?.parentBoneId ?? boneParents.get(jointBoneId) ?? null;
  const parentMatrix = parentBoneId ? boneWorld.get(parentBoneId) ?? null : null;
  if (!baseFromFrame) {
    applyTwoBoneSkinningObj(baseVerts, parentMatrix, childMatrix, partWeights);
  }

  // NaN guard — degenerate bone matrices (zero scale, infinite values)
  // propagate NaN through `applyTwoBoneSkinningObj` and would corrupt
  // mesh.vertices silently. Refuse to write; surface via logger.
  // Rule №1 fix: never persist NaN through Apply.
  for (let i = 0; i < baseVerts.length; i++) {
    if (!Number.isFinite(baseVerts[i].x) || !Number.isFinite(baseVerts[i].y)) {
      logger.error(
        'armatureModifierApplyNaN',
        `LBS bake produced non-finite vertex on "${part.name ?? partId}" — Apply aborted`,
        { partId, jointBoneId, parentBoneId, vertIndex: i,
          x: baseVerts[i].x, y: baseVerts[i].y },
      );
      return { baked: false, vertCount: 0, reason: 'lbs-bake-nan' };
    }
  }

  // Off-canvas / degenerate guard (extends the NaN guard). A bad bone
  // matrix, wrong-frame base, or double-skin produces FINITE but insane
  // verts — the mesh lands far off-canvas or collapses to a line/point,
  // which the user sees as "the part disappeared entirely". The NaN guard
  // misses these (the numbers are finite). Refuse to persist and surface
  // the full state so the cause is diagnosable from the Logs panel.
  // Rule №1: never silently destroy geometry; fail loud, leave mesh intact.
  {
    const cw = project?.canvas?.width ?? 0;
    const ch = project?.canvas?.height ?? 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of baseVerts) {
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    }
    // Collapse-to-a-POINT only (both extents ~0). NOT a line: thin /
    // axis-aligned meshes (eyelash strips, etc.) legitimately have one
    // zero extent and must NOT trip the guard.
    const degenerate = (maxX - minX) < 1e-3 && (maxY - minY) < 1e-3;
    // Allow generous slack (4× the larger canvas dimension) — legitimate
    // poses can push a limb well outside the frame; only a runaway bake
    // (orders of magnitude off) trips this.
    const margin = cw > 0 && ch > 0 ? Math.max(cw, ch) * 4 : Infinity;
    const offCanvas = cw > 0 && ch > 0
      && (maxX < -margin || minX > cw + margin || maxY < -margin || minY > ch + margin);
    if (degenerate || offCanvas) {
      logger.error(
        'armatureModifierApplyDegenerate',
        `LBS bake produced ${degenerate ? 'degenerate (collapsed)' : 'off-canvas'} geometry on `
        + `"${part.name ?? partId}" — Apply aborted, mesh left intact`,
        {
          partId, jointBoneId, parentBoneId, baseFromFrame,
          bbox: { minX, minY, maxX, maxY }, canvas: { cw, ch },
          childMatrix: childMatrix ? Array.from(childMatrix) : null,
          parentMatrix: parentMatrix ? Array.from(parentMatrix) : null,
          weight0: partWeights[0], vertCount: baseVerts.length,
        },
      );
      return { baked: false, vertCount: 0, reason: degenerate ? 'lbs-bake-degenerate' : 'lbs-bake-offcanvas' };
    }
  }

  // ── Keyform-frame reprojection (the disappearance fix, 2026-06-18) ──
  //
  // Apply removes ONLY the Armature modifier; the rest of the part's deformer
  // chain (per-part RigWarp + body warps) STAYS and re-applies every eval.
  // `selectRigSpec` interprets the runtime keyform in the leaf modifier's
  // LOCAL frame (`modifiers[0]`: warp → normalized-0to1; rotation →
  // pivot-relative). Writing the baked CANVAS-px verts verbatim made the eval
  // re-read e.g. x=787 as a normalized coord and denormalize it by the warp's
  // rest bbox → ~180k px off-canvas: the user's "arm disappears entirely"
  // (confirmed by the `artMeshDisappearDiag` log: canvas-px keyform on a
  // RigWarp leaf → bbox ≈ (181911,179872)). The bake itself was correct; the
  // keyform was simply in the wrong frame.
  //
  // Fix: reproject the baked canvas-px verts into the leaf's local frame using
  // the affine map recovered from the part's OWN rest correspondence
  // (mesh.vertices canvas ↔ rest keyform leaf-local). Exact because the rest
  // lift is affine (uniform warp grids / rigid rotation), so it round-trips
  // even for posed verts outside the rest bbox. A ROOT-leaf part (no surviving
  // warp/rotation) keeps canvas-px verbatim — the map would be identity and
  // there's nothing to reproject (this is why root-parented limbs never hit
  // the bug). NOTE: the rest correspondence is the param-0 map; the bake is
  // taken at the current param state. In the Apply workflow the user has posed
  // bones (carried by `bone.pose`, NOT params) with body/face params at rest,
  // so the two coincide and the reprojection is exact.
  const leafMod = stack.find((m) => m && m.type !== 'armature' && m.enabled !== false
    && (m.type === 'lattice' || m.type === 'warp' || m.type === 'rotation'));
  /** @type {number[]} */
  let keyformVerts;
  if (leafMod) {
    const kfs = Array.isArray(mesh?.runtime?.keyforms) ? mesh.runtime.keyforms : null;
    const restKf = kfs
      ? (kfs.find((k) => !Array.isArray(k.keyTuple) || k.keyTuple.length === 0
          || k.keyTuple.every((v) => v === 0)) ?? kfs[0])
      : null;
    const restLocal = restKf && (ArrayBuffer.isView(restKf.vertexPositions) || Array.isArray(restKf.vertexPositions))
      ? restKf.vertexPositions : null;
    const restCanvasFlat = _flattenObjVerts(restVerts);
    if (!restLocal || restLocal.length !== restCanvasFlat.length) {
      logger.error(
        'armatureModifierApply',
        `Apply Armature FAILED on "${part.name ?? partId}" — leaf modifier `
        + `"${leafMod.objectId ?? leafMod.deformerId ?? leafMod.type}" present but no usable rest keyform `
        + `to reproject the bake into its local frame (refusing to write a canvas-px keyform that would fly off-canvas)`,
        { partId, leafType: leafMod.type, hasRestKf: !!restKf,
          restLocalLen: restLocal?.length ?? 0, restCanvasLen: restCanvasFlat.length },
      );
      return { baked: false, vertCount: 0, reason: 'reproject-no-rest-keyform' };
    }
    const fit = _fitAffine2D(restCanvasFlat, restLocal);
    // Residual is in the leaf-local frame (warp: 0..1 units; rotation: px). A
    // non-affine correspondence (non-uniform cage) can't be reprojected
    // exactly — fail loud rather than land the part somewhere wrong.
    if (!fit || fit.residual > 1e-2) {
      logger.error(
        'armatureModifierApply',
        `Apply Armature FAILED on "${part.name ?? partId}" — rest correspondence for leaf `
        + `"${leafMod.objectId ?? leafMod.deformerId ?? leafMod.type}" is not affine `
        + `(residual=${fit ? fit.residual.toFixed(4) : 'singular'}); cannot reproject the bake into its local frame`,
        { partId, leafType: leafMod.type, residual: fit?.residual ?? null },
      );
      return { baked: false, vertCount: 0, reason: 'reproject-non-affine' };
    }
    keyformVerts = new Array(baseVerts.length * 2);
    for (let i = 0; i < baseVerts.length; i++) {
      const [u, v] = fit.map(baseVerts[i].x, baseVerts[i].y);
      keyformVerts[i * 2] = u;
      keyformVerts[i * 2 + 1] = v;
    }
  } else {
    // Root leaf — the keyform IS canvas-px (no chain to re-apply).
    keyformVerts = new Array(baseVerts.length * 2);
    for (let i = 0; i < baseVerts.length; i++) {
      keyformVerts[i * 2] = baseVerts[i].x;
      keyformVerts[i * 2 + 1] = baseVerts[i].y;
    }
  }

  // Write the baked verts into mesh.vertices, remove the Armature
  // modifier, and replace `mesh.runtime` with a single rest keyform in the
  // leaf modifier's local frame (see reprojection note above). Atomically,
  // in a single updateProject so undo captures the whole operation.
  //
  // # Why we WRITE a minimal runtime instead of deleting it
  //
  // 2026-05-09 (later same day): the prior version of this code
  // deleted `mesh.runtime` to "let `selectRigSpec`'s pre-rig fallback
  // rebuild." But the pre-rig fallback (`selectRigSpec._buildArtMeshes`,
  // the post-runtime branch — search "Pre-rig fallback" in the file)
  // was designed for fresh-import projects whose `mesh.vertices` are
  // in REST canvas-px. After Apply, mesh.vertices is in POSED
  // canvas-px (LBS bake output). At the time, the fallback read
  // `part.rigParent` (still pointing at a body warp from
  // synthesizeDeformerParents pre-Apply) and frame-converted the verts
  // into the warp's [0..1] normalised space using the warp's REST
  // bbox — but the posed verts can lie far outside the rest bbox,
  // producing localVerts well above 1.0 or below 0. chainEval
  // bilinearly extrapolates outside the warp grid and the part
  // renders far off-canvas — the user's reported "arm disappeared"
  // symptom. (Post-M4 RULE-№4, 2026-05-23, the fallback no longer
  // reads `rigParent` — it falls back to `innermostBodyWarpId` only —
  // but the structural concern is the same: posed verts must NOT be
  // run through any warp normalisation.)
  //
  // The structurally correct fix: write a runtime entry containing a single
  // rest keyform with the baked verts IN THE LEAF MODIFIER'S LOCAL FRAME
  // (`keyformVerts`, reprojected above — canvas-px verbatim only for a root
  // leaf). selectRigSpec's runtime-cache fast path emits them, then the eval
  // re-applies the surviving deformer chain on top. Per-bone-angle keyforms
  // (the 5-keyform multi-angle cache) are intentionally collapsed to 1: Apply
  // means "this part is no longer skinned to the armature"; the bone-pose
  // effect is now baked into the rest, mirroring Blender's
  // `modifier_apply_obdata` semantics.
  const flatBaked = Float32Array.from(keyformVerts);
  // Track whether the immer recipe actually wrote — pre-fix the callback
  // could silently no-op on v18 / vertex-count-mismatch / lost-target paths
  // while the outer return still reported `{baked:true}`. Caller saw success,
  // mesh stayed pre-bake, downstream "applied" state was a lie.
  let bakeOk = false;
  /** @type {string|null} */
  let bakeFailReason = null;
  projectState.updateProject((proj) => {
    const target = proj.nodes.find((n) => n.id === partId);
    if (!target || target.type !== 'part') {
      bakeFailReason = 'target-not-a-part-mid-update'; return;
    }
    // v18: route through getMesh so the meshData sibling node is reached.
    const targetMesh = getMesh(target, proj);
    if (!targetMesh || !Array.isArray(targetMesh.vertices)) {
      bakeFailReason = 'target-mesh-missing-mid-update'; return;
    }
    const verts = targetMesh.vertices;
    if (verts.length !== baseVerts.length) {
      bakeFailReason = `vert-count-mismatch (${verts.length} vs ${baseVerts.length})`;
      return;
    }
    for (let i = 0; i < verts.length; i++) {
      verts[i].x = baseVerts[i].x;
      verts[i].y = baseVerts[i].y;
    }
    if (Array.isArray(target.modifiers)) {
      const idx = target.modifiers.findIndex((m) => m?.type === 'armature');
      if (idx >= 0) target.modifiers.splice(idx, 1);
      if (target.modifiers.length === 0) delete target.modifiers;
    }
    // M3.3 (RULE-№4, 2026-05-23): `runtime.parent` is no longer
    // persisted — the chain leaf is derived from `part.modifiers[0]`
    // (selectRigSpec) and project topology (synthesizeModifierStacks
    // via `findInnermostBodyWarpId`). v47 migration strips the field
    // from any pre-M3.3 save on load.
    targetMesh.runtime = {
      bindings: [],
      keyforms: [{
        keyTuple: [],
        vertexPositions: Array.from(flatBaked),
        opacity: 1,
      }],
    };
    // Vertex group data (`mesh.boneWeights` + `mesh.jointBoneId`)
    // STAYS on the mesh datablock — same as Blender. Apply Modifier
    // removes the binding (the modifier entry above) but keeps the
    // vertex groups so the next modifier add re-binds automatically
    // (`object_modifier.cc` apply path doesn't touch `me->dvert`).
    // Render-loop skinning is gated on the modifier's presence
    // (CanvasViewport: armatureMod check), not on boneWeights — so
    // there's no double-apply concern.
    bakeOk = true;
  });

  if (!bakeOk) {
    logger.error(
      'armatureModifierApply',
      `Apply Armature FAILED on "${part.name ?? partId}" — ${bakeFailReason ?? 'unknown reason'}`,
      { partId, partName: part.name, reason: bakeFailReason },
    );
    return { baked: false, vertCount: 0, reason: bakeFailReason ?? 'callback-aborted' };
  }

  logger.info(
    'armatureModifierApply',
    `applied Armature modifier on "${part.name ?? partId}" — baked ${baseVerts.length} verts via two-bone LBS`,
    {
      partId,
      partName: part.name,
      jointBoneId,
      parentBoneId,
      vertCount: baseVerts.length,
    },
  );

  return { baked: true, vertCount: baseVerts.length };
}

/**
 * Bind (add) an Armature modifier to a part. Inverse of `applyArmatureModifier`.
 * Mirrors Blender's "Properties → Modifiers → Add Modifier → Armature":
 * adding an Armature modifier to a mesh is always legal regardless of
 * whether the mesh has vertex groups yet. With no vertex groups the
 * modifier is render-side a no-op (no per-vertex skinning), but the
 * mesh still rigid-follows its parent bone via the overlay-matrix
 * path. Once the user paints weights via Weight Paint mode the
 * composition decision flips from `'overlay'` to `'lbs'` and LBS
 * activates.
 *
 * Resolves `jointBoneId` in this order:
 *   1. `mesh.jointBoneId` if present (post-Apply re-bind path —
 *      Blender keeps `me->dvert` on Apply so the previous binding
 *      target is reused).
 *   2. Nearest `isBoneGroup` ancestor in `node.parent` chain
 *      (fresh-bind path on a rigid-follow part).
 *
 * If neither resolves (no bone ancestor), the operator fails — there's
 * no armature to bind to.
 *
 * Idempotent: returns `{bound: false, reason: 'already-bound'}` when
 * an Armature modifier is already on the stack.
 *
 * @param {string} partId
 * @returns {{ bound: boolean, jointBoneId?: string, parentBoneId?: string|null, reason?: string }}
 */
export function bindArmatureModifier(partId) {
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const part = project?.nodes?.find((n) => n.id === partId) ?? null;
  if (!part || part.type !== 'part') {
    return { bound: false, reason: 'not-a-part' };
  }
  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
  if (stack.some((m) => m?.type === 'armature')) {
    return { bound: false, reason: 'already-bound' };
  }
  // v18: route through getMesh so post-Apply re-bind can find the
  // jointBoneId stored on the meshData sibling node.
  const mesh = getMesh(part, project);

  // Resolve jointBoneId: prefer `mesh.jointBoneId` (post-Apply re-bind
  // path), fall back to nearest bone-group ancestor (fresh-bind path).
  let jointBoneId = typeof mesh?.jointBoneId === 'string' && mesh.jointBoneId.length > 0
    ? mesh.jointBoneId : null;
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  if (!jointBoneId) {
    let cur = part.parent ? byId.get(part.parent) : null;
    while (cur && !(cur.type === 'group' && cur.boneRole)) {
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    if (cur) jointBoneId = cur.id;
  }
  if (!jointBoneId) {
    return { bound: false, reason: 'no-bone-ancestor' };
  }
  const jointBone = byId.get(jointBoneId) ?? null;
  if (!jointBone || jointBone.type !== 'group' || !jointBone.boneRole) {
    return { bound: false, reason: 'jointBoneId-not-a-bone' };
  }
  // Resolve parent bone — walks past plain (non-bone) groups. Same
  // logic as `boneOverlayMatrix.computeBoneParentMap` and the synth in
  // `deformerNodeSync.synthesizeModifierStacks`.
  let parent = jointBone.parent ? byId.get(jointBone.parent) : null;
  while (parent && !(parent.type === 'group' && parent.boneRole)) {
    parent = parent.parent ? byId.get(parent.parent) : null;
  }
  const parentBoneId = parent?.id ?? null;

  let bindOk = false;
  /** @type {string|null} */
  let bindFailReason = null;
  projectState.updateProject((proj) => {
    const target = proj.nodes.find((n) => n.id === partId);
    if (!target || target.type !== 'part') {
      bindFailReason = 'target-not-a-part-mid-update'; return;
    }
    if (!Array.isArray(target.modifiers)) target.modifiers = [];
    // Place AFTER any existing deformer chain (same convention as
    // `synthesizeModifierStacks`). Mirrors Blender's "Add Modifier"
    // appending to the end of the stack.
    target.modifiers.push({
      type: 'armature',
      deformerId: jointBoneId,
      enabled: true,
      // DEFAULT_MIGRATED_MODE = REALTIME | RENDER (same as fresh
      // modifiers in `v21_modifier_mode_flags.DEFAULT_MIGRATED_MODE`).
      mode: 3,
      showInEditor: true,
      data: {
        jointBoneId,
        jointBoneRole: jointBone.boneRole,
        parentBoneId,
        parentBoneRole: parent?.boneRole ?? null,
        deformFlag: 1,
        vertexGroupName: '',
      },
    });
    bindOk = true;
  });

  if (!bindOk) {
    logger.error(
      'armatureModifierBind',
      `Bind Armature FAILED on "${part.name ?? partId}" — ${bindFailReason ?? 'unknown reason'}`,
      { partId, partName: part.name, reason: bindFailReason },
    );
    return { bound: false, reason: bindFailReason ?? 'callback-aborted' };
  }

  logger.info(
    'armatureModifierBind',
    `bound Armature modifier on "${part.name ?? partId}" → joint=${jointBone.boneRole}${parent?.boneRole ? ` (parent ${parent.boneRole})` : ''}`,
    { partId, partName: part.name, jointBoneId, parentBoneId },
  );

  return { bound: true, jointBoneId, parentBoneId };
}
