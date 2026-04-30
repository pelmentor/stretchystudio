/**
 * .cmo3 (Cubism Editor project) generator.
 *
 * Port of scripts/cmo3_generate.py — generates a .cmo3 that opens
 * in Cubism Editor 5.0 WITHOUT "recovered" status.
 *
 * Supports N meshes with real texture data from Stretchy Studio.
 *
 * The texture pipeline replicates Cubism Editor 5.0's own format:
 *   CLayeredImage → CLayer → CModelImage (filter env) → CImageResource
 *   → CTextureInputExtension → CArtMeshSource (TextureState=MODEL_IMAGE)
 *
 * COORDINATE SPACE TRAPS (see ARCHITECTURE.md for full details):
 *   1. meshSrc>positions + GEditableMesh2>point = CANVAS space (texture mapping)
 *      keyform>CArtMeshForm>positions = DEFORMER-LOCAL space (rendering)
 *      Setting both to deformer-local → invisible textures (empty mesh fill).
 *   2. CRotationDeformerForm originX/Y = PARENT deformer's local space, not canvas.
 *   3. Canvas-space vertices + deformer parenting → scattered character.
 *      Must transform: vertex_local = vertex_canvas - deformer_world_origin.
 *
 * @module io/live2d/cmo3writer
 */

import { makeLocalMatrix, mat3Mul } from '../../renderer/transforms.js';
import { XmlBuilder, uuid } from './xmlbuilder.js';
import { analyzeBody } from './bodyAnalyzer.js';
import { variantParamId } from '../psdOrganizer.js';
import { BAKED_BONE_ANGLES } from './rig/paramSpec.js';
import { buildBodyWarpChain } from './rig/bodyWarp.js';
import { buildTagBindingMap } from './rig/tagWarpBindings.js';
import { VERSION_PIS, IMPORT_PIS } from './cmo3/constants.js';
import { emitKfBinding } from './cmo3/deformerEmit.js';
import {
  RIG_WARP_TAGS,
  FACE_PARALLAX_TAGS,
  FACE_PARALLAX_DEPTH,
  NECK_WARP_TAGS,
} from './cmo3/rigWarpTags.js';
import { CATEGORY_DEFS, categorizeParam } from './cmo3/paramCategories.js';
import { fitParabolaFromLowerEdge } from './cmo3/eyeClosureFit.js';
import {
  evalClosureCurve,
  computeClosedCanvasVerts,
  computeClosedVertsForMesh,
} from './cmo3/eyeClosureApply.js';
import { setupGlobalSharedObjects, lookupStandardParamPids } from './cmo3/globalSetup.js';
import { emitModelImageGroup } from './cmo3/modelImageGroup.js';
import { packCmo3 } from './cmo3/caffPack.js';
import { buildMainXml } from './cmo3/mainXmlBuilder.js';
import { emitMeshFilterGraph, emitMeshTexture, fillLayerGroupAndImage } from './cmo3/meshLayer.js';
import { buildPartHierarchy } from './cmo3/partHierarchy.js';
import { emitMeshVertsWarpDeformers } from './cmo3/meshVertsWarp.js';
import { emitRotationDeformers } from './cmo3/rotationDeformerEmit.js';
import { emitStructuralChainAndReparent } from './cmo3/structuralChainEmit.js';
import { resolveMaskPairings } from './cmo3/maskResolve.js';
import { createEmitContext, attachGlobals } from './cmo3/emitContext.js';
import { emitAllMeshLayersAndKeyforms } from './cmo3/meshLayerKeyform.js';
import { buildEyeContexts } from './cmo3/eyeContexts.js';
import { emitPerPartRigWarps } from './cmo3/perPartRigWarps.js';
import { EYEWHITE_TAGS, EYELASH_TAGS, EYE_SOURCE_TAGS, EYE_PART_TAGS } from './cmo3/eyeTags.js';
import { sanitisePartName } from '../../lib/partId.js';

// ---------- Main generator ----------

/**
 * @typedef {Object} MeshInfo
 * @property {string} name - Mesh name (e.g. "ArtMesh0")
 * @property {string} [partId] - Original part node ID (for group mapping)
 * @property {string|null} [parentGroupId] - Parent group node ID
 * @property {number[]} vertices - Flat array [x0,y0, x1,y1, ...] in pixel coords
 * @property {number[]} triangles - Flat triangle indices [i0,i1,i2, ...]
 * @property {number[]} uvs - UV coords [u0,v0, u1,v1, ...] in 0..1
 * @property {Uint8Array} pngData - PNG texture data for this mesh
 * @property {number} texWidth - Texture width in pixels
 * @property {number} texHeight - Texture height in pixels
 */

/**
 * @typedef {Object} GroupInfo
 * @property {string} id - Group node ID
 * @property {string} name - Group display name
 * @property {string|null} parent - Parent group ID (null = root)
 */

/**
 * @typedef {Object} ParamInfo
 * @property {string} id - Parameter ID (e.g. "ParamAngleX")
 * @property {string} [name] - Display name
 * @property {number} [min] - Minimum value (default 0)
 * @property {number} [max] - Maximum value (default 1)
 * @property {number} [default] - Default value (default 0)
 */

/**
 * @typedef {Object} Cmo3Input
 * @property {number} canvasW - Canvas width
 * @property {number} canvasH - Canvas height
 * @property {MeshInfo[]} meshes - Array of mesh data
 * @property {GroupInfo[]} [groups=[]] - Group nodes (become CPartSource)
 * @property {ParamInfo[]} [parameters=[]] - Parameters
 * @property {string} [modelName='StretchyStudio Export']
 * @property {boolean} [generateRig=false] - Add standard Live2D parameter IDs
 */

/**
 * Generate a .cmo3 file (CAFF archive containing main.xml + PNG textures).
 *
 * @param {Cmo3Input} input
 * @returns {Promise<{cmo3: Uint8Array, deformerParamMap: Map<string, {paramId: string, min: number, max: number}>}>}
 */
export async function generateCmo3(input) {
  const {
    canvasW, canvasH, meshes,
    groups = [], parameters = [],
    animations = [],
    modelName = 'StretchyStudio Export',
    generateRig = false,
    // Physics: emits CPhysicsSettingsSourceSet (hair/skirt pendulums). Off by
    // default when generateRig is off — physics references rig-only params.
    generatePhysics = generateRig,
    // Optional set/array of category names to SUPPRESS in the physics
    // emission, e.g. ['hair'] for a buzz-cut character where hair
    // pendulums look wrong. Unknown categories are ignored.
    physicsDisabledCategories = null,
    // Rig-only mode skips XML serialization + PNG/CAFF packing. The runtime
    // path uses this to extract the shared RigSpec without paying for cmo3
    // emission. Returns `{rigSpec, deformerParamMap}` only.
    rigOnly = false,
    // Pre-resolved mask pairings (Stage 3 of native rig refactor). Each
    // entry is `{maskedMeshId, maskMeshIds}`. If the caller doesn't pass
    // any, this writer falls back to its inline heuristic — which matches
    // `rig/maskConfigs.js:buildMaskConfigsFromProject` semantically.
    maskConfigs = [],
    // Pre-resolved physics rules (Stage 6 of native rig refactor).
    // boneOutputs already flattened into outputs[]. If absent, callers
    // are expected to pass DEFAULT_PHYSICS_RULES via resolvePhysicsRules
    // (which builds with boneOutputs resolution against project.nodes).
    physicsRules = null,
    // Bone config (Stage 7). Drives the `BAKED_ANGLES` array used for
    // bone-rotation keyform emission. When absent, falls back to
    // BAKED_BONE_ANGLES from paramSpec (= [-90, -45, 0, 45, 90]).
    bakedKeyformAngles = BAKED_BONE_ANGLES,
    // Variant fade rules (Stage 5). `backdropTags` lists tags that NEVER
    // fade as variant bases — face / ears / front+back hair stay at α=1.
    // When absent, falls back to DEFAULT_BACKDROP_TAGS from
    // rig/variantFadeRules.js.
    variantFadeRules = null,
    // Eye closure config (Stage 5). `closureTags`, `lashStripFrac`,
    // `binCount`. When absent, falls back to defaults from
    // rig/eyeClosureConfig.js.
    eyeClosureConfig = null,
    // Rotation deformer config (Stage 8). Bundles skipRotationRoles +
    // paramAngleRange + groupRotation/faceRotation paramKey→angle
    // mappings. When absent, falls back to defaults from
    // rig/rotationDeformerConfig.js.
    rotationDeformerConfig = null,
    // autoRigConfig (Stage 2). Three sections: bodyWarp (HIP/FEET
    // fallbacks, BX/BY/Breath margins, upper-body shape), faceParallax
    // (depth, protection, eye/squash amps), neckWarp (tilt fraction).
    // When absent, each generator falls back to DEFAULT_AUTO_RIG_CONFIG
    // for that section. See `rig/autoRigConfig.js`.
    autoRigConfig = null,
    // Pre-resolved FaceParallax warp spec (Stage 4). When populated, the
    // cmo3 emitter skips the inline heuristic and serializes the stored
    // spec verbatim. When null, today's `buildFaceParallaxSpec` heuristic
    // runs as the spec source. See `rig/faceParallaxStore.js`
    // resolveFaceParallax.
    faceParallaxSpec = null,
    // Pre-resolved body warp chain (Stage 10). When populated, the cmo3
    // emitter skips the inline `buildBodyWarpChain` heuristic and uses
    // the stored chain's specs + layout (canvasToBodyXX/Y closures
    // rebuilt from the layout via `makeBodyWarpNormalizers`). When null,
    // today's heuristic runs as the chain source. See
    // `rig/bodyWarpStore.js` resolveBodyWarp.
    bodyWarpChain = null,
    // Pre-resolved per-mesh rig warps (Stage 9b). `partId → spec` map.
    // For each mesh whose `partId` is in the map and whose stored
    // keyform count matches the cartesian-product `numKf`, the writer
    // uses the stored `keyforms[ki].positions` verbatim — skipping the
    // procedural shiftFn invocation. Misses (absent partId or count
    // mismatch) fall through to the inline shiftFn path. See
    // `rig/rigWarpsStore.js` resolveRigWarps.
    rigWarps = null,
  } = input;

  // Resolve Stage 5 configs to flat constants used inline below.
  const _BACKDROP_TAGS_LIST = (variantFadeRules && Array.isArray(variantFadeRules.backdropTags)
    && variantFadeRules.backdropTags.length > 0)
    ? variantFadeRules.backdropTags
    : ['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair'];
  const _EYE_CLOSURE_TAGS_LIST = (eyeClosureConfig && Array.isArray(eyeClosureConfig.closureTags)
    && eyeClosureConfig.closureTags.length > 0)
    ? eyeClosureConfig.closureTags
    : ['eyelash-l', 'eyewhite-l', 'irides-l', 'eyelash-r', 'eyewhite-r', 'irides-r'];
  const _EYE_CLOSURE_LASH_STRIP_FRAC = Number.isFinite(eyeClosureConfig?.lashStripFrac)
    ? eyeClosureConfig.lashStripFrac : 0.06;
  const _EYE_CLOSURE_BIN_COUNT = Number.isFinite(eyeClosureConfig?.binCount) && eyeClosureConfig.binCount > 0
    ? eyeClosureConfig.binCount : 6;

  // Stage 8: rotation deformer config — skip roles + param range + paramKey/
  // angle mappings. Each falls back to today's hardcoded value when the
  // corresponding sub-field is missing or malformed.
  const _ROT_SKIP_ROLES = (rotationDeformerConfig
    && Array.isArray(rotationDeformerConfig.skipRotationRoles))
    ? rotationDeformerConfig.skipRotationRoles
    : ['torso', 'eyes', 'neck'];
  const _ROT_PARAM_RANGE_MIN = Number.isFinite(rotationDeformerConfig?.paramAngleRange?.min)
    ? rotationDeformerConfig.paramAngleRange.min : -30;
  const _ROT_PARAM_RANGE_MAX = Number.isFinite(rotationDeformerConfig?.paramAngleRange?.max)
    ? rotationDeformerConfig.paramAngleRange.max : 30;
  const _ROT_GROUP_PARAM_KEYS = (rotationDeformerConfig?.groupRotation
    && Array.isArray(rotationDeformerConfig.groupRotation.paramKeys)
    && rotationDeformerConfig.groupRotation.paramKeys.length > 0)
    ? rotationDeformerConfig.groupRotation.paramKeys
    : [-30, 0, 30];
  const _ROT_GROUP_ANGLES = (rotationDeformerConfig?.groupRotation
    && Array.isArray(rotationDeformerConfig.groupRotation.angles)
    && rotationDeformerConfig.groupRotation.angles.length === _ROT_GROUP_PARAM_KEYS.length)
    ? rotationDeformerConfig.groupRotation.angles
    : [-30, 0, 30];
  const _ROT_FACE_PARAM_KEYS = (rotationDeformerConfig?.faceRotation
    && Array.isArray(rotationDeformerConfig.faceRotation.paramKeys)
    && rotationDeformerConfig.faceRotation.paramKeys.length > 0)
    ? rotationDeformerConfig.faceRotation.paramKeys
    : [-30, 0, 30];
  const _ROT_FACE_ANGLES = (rotationDeformerConfig?.faceRotation
    && Array.isArray(rotationDeformerConfig.faceRotation.angles)
    && rotationDeformerConfig.faceRotation.angles.length === _ROT_FACE_PARAM_KEYS.length)
    ? rotationDeformerConfig.faceRotation.angles
    : [-10, 0, 10];

  const x = new XmlBuilder();

  // ── Shared emission context (sweep #41) ──
  // Single bag of state that subsequent extraction sweeps (Section 2/3c/4)
  // pass to every helper instead of long destructured arg lists. Built up
  // incrementally — this call only seeds static input + accumulators;
  // globals attach below after `setupGlobalSharedObjects` runs.
  const ctx = createEmitContext({
    x,
    canvasW, canvasH, meshes,
    groups, parameters, animations,
    modelName, generateRig, rigOnly,
    maskConfigs, physicsRules,
    bakedKeyformAngles, autoRigConfig,
    faceParallaxSpec, bodyWarpChain, rigWarps,
  }, {
    backdropTagsList: _BACKDROP_TAGS_LIST,
    eyeClosureTagsList: _EYE_CLOSURE_TAGS_LIST,
    eyeClosureLashStripFrac: _EYE_CLOSURE_LASH_STRIP_FRAC,
    eyeClosureBinCount: _EYE_CLOSURE_BIN_COUNT,
    rotSkipRoles: _ROT_SKIP_ROLES,
    rotParamRangeMin: _ROT_PARAM_RANGE_MIN,
    rotParamRangeMax: _ROT_PARAM_RANGE_MAX,
    rotGroupParamKeys: _ROT_GROUP_PARAM_KEYS,
    rotGroupAngles: _ROT_GROUP_ANGLES,
    rotFaceParamKeys: _ROT_FACE_PARAM_KEYS,
    rotFaceAngles: _ROT_FACE_ANGLES,
  }, !!generateRig);

  // ── Phase 0 diagnostic log (only populated when generateRig is on) ──
  // Emitted as `{modelName}.rig.log.json` alongside the .cmo3 in the export zip.
  // Pure capture — no behavior changes. See docs/live2d-export/AUTO_RIG_PLAN.md.
  // ctx owns the canonical instance; this local is an alias kept until the
  // extraction sweeps migrate every reference to `ctx.rigDebugLog`.
  const rigDebugLog = ctx.rigDebugLog;

  if (rigDebugLog) {
    const tags = new Set();
    let taglessCount = 0;
    for (const m of meshes) {
      const v = m.vertices;
      if (!v || v.length < 2) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < v.length; i += 2) {
        if (v[i]     < minX) minX = v[i];
        if (v[i]     > maxX) maxX = v[i];
        if (v[i + 1] < minY) minY = v[i + 1];
        if (v[i + 1] > maxY) maxY = v[i + 1];
      }
      const W = maxX - minX, H = maxY - minY;
      rigDebugLog.meshSummary.push({
        tag: m.tag ?? null,
        bbox: {
          minX, minY, maxX, maxY, W, H,
          cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
          aspect: H > 0 ? W / H : null,
        },
        vertexCount: v.length / 2,
      });
      if (m.tag) tags.add(m.tag); else taglessCount++;
    }
    rigDebugLog.tagCoverage = { present: [...tags].sort(), taglessCount };
  }

  // Body silhouette analysis — measurement pass (Step 1).
  // Run whenever rigging is requested. Consumed by body-warp code (Step 2) to
  // anchor feet-pin and spine pivot to actual geometry. rigDebugLog.body gets a
  // copy for inspection when debug is on.
  let bodyAnalysis = null;
  if (generateRig) {
    try {
      bodyAnalysis = await analyzeBody(canvasW, canvasH, meshes);
    } catch (e) {
      bodyAnalysis = { skipped: 'error', error: String(e && e.message || e) };
    }
    if (rigDebugLog) {
      rigDebugLog.body = bodyAnalysis;
      if (bodyAnalysis && bodyAnalysis.skipped === 'error') {
        rigDebugLog.warnings.push(`bodyAnalyzer threw: ${bodyAnalysis.error}`);
      }
    }
  }

  // ── RigSpec collector ──
  // Single source of truth for every rig element emitted below. Both this
  // writer and moc3writer consume the resulting RigSpec — cmo3 translates
  // it to XML, moc3 translates it to binary. Owned by `ctx` (sweep #41);
  // local alias kept until extraction sweeps migrate references.
  const rigCollector = ctx.rigCollector;

  // ==================================================================
  // 1. GLOBAL SHARED OBJECTS (used by all meshes)
  // ==================================================================
  // Setup lives in `cmo3/globalSetup.js`. Returns a bundle of pids +
  // shared XML element refs consumed by sections 2-6 below.
  const _globals = setupGlobalSharedObjects(x, {
    parameters, meshes, groups,
    generateRig, bakedKeyformAngles, rotationDeformerConfig,
  });
  attachGlobals(ctx, _globals);
  const {
    pidParamGroupGuid, pidModelGuid, pidPartGuid,
    pidBlend,
    pidDeformerRoot, pidDeformerNull,
    pidCoord,
    paramDefs, paramSpecs,
    pidParamOpacity, bakedAngleMin: BAKED_ANGLE_MIN, bakedAngleMax: BAKED_ANGLE_MAX,
    boneParamGuids,
    groupPartGuids,
    pidFdefSel, pidFdefFlt,
    filterValueIds, filterValues,
  } = _globals;
  const BAKED_ANGLES = _globals.bakedAngles;
  // Section 5 (CModelImageGroup) only needs these two filter ids; the
  // per-mesh filter graph (section 2) consumes the full bundles.
  const { pidFvidMiGuid, pidFvidMiLayer } = filterValueIds;
  // ==================================================================
  // 2. SHARED PSD (one CLayeredImage with N layers)
  // ==================================================================
  // Session 4 finding: Editor requires ONE CLayeredImage ("PSD") with N CLayers.
  // N separate CLayeredImages = geometry renders but NO textures.

  const [, pidLiGuid] = x.shared('CLayeredImageGuid', { uuid: uuid(), note: 'fakepsd' });
  const [layeredImg, pidLi] = x.shared('CLayeredImage');
  const [layerGroup, pidLg] = x.shared('CLayerGroup');

  // ctx.perMesh / ctx.layerRefs own the canonical accumulator arrays
  // (sweep #41); these locals are aliases until extraction sweeps migrate
  // every reference.
  const perMesh = ctx.perMesh;
  const layerRefs = ctx.layerRefs;

  // ── Eye closure band (Apr 2026 P7: parabola fit to eyewhite bottom edge) ──
  // User-requested algorithm redesign:
  //   "Take the bottom edge of eyewhite (the natural eye closure line, the 'zip'
  //    curve). The edge stays static. Meshes blend into that edge. No horizontal
  //    deformation. If the edge isn't wide enough, extrapolate the math curve."
  //
  // Implementation:
  //   1. Per side, collect ALL eyewhite vertices (fallback to eyelash if none)
  //   2. X-uniform bins (not vertex-index) → lower edge sample points (max Y per bin)
  //   3. Fit parabola y = a·xn² + b·xn + c via least-squares (Cramer's rule)
  //   4. The parabola IS the closure curve — evaluated per-vertex at closure time
  //   5. Extrapolates naturally outside eyewhite's X range (parabola tails)
  //
  // Algorithm is style-agnostic — curve comes from each character's own anatomy,
  // not from hand-tuned style presets.
  const pidParamEyeLOpenEarly = paramDefs.find(p => p.id === 'ParamEyeLOpen')?.pid;
  const pidParamEyeROpenEarly = paramDefs.find(p => p.id === 'ParamEyeROpen')?.pid;
  // Emotion variants: only the variant mesh gets the Param<Suffix> fade-in
  // (0 → 1 opacity); the base stays at its default opacity=1 keyform. The
  // specific parameter is chosen per-variant from its suffix (ParamSmile,
  // ParamSad, ParamAngry, ...). Look up any param id we've emitted for a
  // known suffix — all registered in the auto-register pass above.
  const variantParamPidBySuffix = new Map(); // 'smile' → pid
  for (const spec of paramSpecs) {
    if (spec.role !== 'variant' || !spec.variantSuffix) continue;
    const pid = paramDefs.find(p => p.id === spec.id)?.pid;
    if (pid) variantParamPidBySuffix.set(spec.variantSuffix, pid);
  }
  // Structural backdrop tags — base meshes with these tags stay at
  // opacity=1 always (never fade on any Param<Suffix>). User rule
  // (2026-04-23): face skin, ears, and hair shapes are the always-present
  // substrate; variants layered on top, not replacements. Every OTHER
  // base mesh with a paired variant fades smoothly 1→0 on the variant's
  // param (see hasBaseFade). Stage 5: backdrop list resolved from
  // `project.variantFadeRules` via the input arg above.
  const BACKDROP_TAGS_SET = new Set(_BACKDROP_TAGS_LIST);
  // For base meshes (other than backdrops) that have at least one variant
  // sibling, the base SMOOTHLY fades from opacity 1 at Param<Suffix>=0 to
  // opacity 0 at Param<Suffix>=1. Linear crossfade over the full range.
  // Works without midpoint translucency because the backdrops (face skin
  // etc.) stay at opacity=1 and provide the substrate everything renders
  // on top of — at no Param<Suffix> value does the viewer see through to
  // the canvas background.
  const variantSuffixesByBasePartId = new Map(); // basePartId → [suffixes]
  for (const m of meshes) {
    if (!m.variantOf) continue;
    const suffix = m.variantSuffix ?? m.variantRole;
    if (!suffix) continue;
    const list = variantSuffixesByBasePartId.get(m.variantOf) ?? [];
    if (!list.includes(suffix)) list.push(suffix);
    variantSuffixesByBasePartId.set(m.variantOf, list);
  }
  // Session 28: per-vertex CArtMeshForm shapekeys on the neck mesh bound to
  // ParamAngleX (3 keyforms at −30/0/+30). Fixes the seam visibility at the
  // top corners when the head yaws — without deforming the rest of the neck.
  const pidParamAngleXEarly = paramDefs.find(p => p.id === 'ParamAngleX')?.pid;
  // Unified across styles (Apr 2026): the parabola-fit closure derives the curve
  // from the character's OWN eyewhite geometry, so the same constants work for
  // anime and western. Strip thickness at 6% of lash height gives a clean thin
  // closed-eye line; scales naturally with lash height across character sizes.
  // Stage 5: both constants resolved from `project.eyeClosureConfig` via the
  // input arg above.
  const EYE_CLOSURE_LASH_STRIP_FRAC = _EYE_CLOSURE_LASH_STRIP_FRAC;
  const EYE_CLOSURE_BIN_COUNT       = _EYE_CLOSURE_BIN_COUNT;  // X-uniform bins for lower-edge extraction
  // Per-side parabola fit: {a, b, c, xMid, xScale} in CANVAS space. Evaluates to y.
  const eyewhiteCurvePerSide = new Map();
  const eyelashMeshBboxPerSide = new Map(); // still needed for lash-strip compression
  // P11 (Apr 2026): eye-region union bbox per side.
  // When eyewhite/iris extends below eyelash (anime big-iris topology), the
  // closure band sits below the eyelash mesh's own bbox. Without extending the
  // rig warp bbox to cover the whole eye region, eyelash vertices get clamped
  // to lash bbox → gap between closed lash line and closed white/iris line.
  // Eye-part meshes get their rig warp bbox extended to this union.
  const eyeUnionBboxPerSide = new Map();

  // Parabola-fit eye-closure curve: shared helper in `cmo3/eyeClosureFit.js`.
  // Same algorithm whether caller is base (eyewhite-{side}) or variant
  // (eyewhite-{side}.{suffix}) — no curve sharing between them.

  const bboxFromVertsY = (verts) => {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < verts.length; i += 2) {
      if (verts[i] < minY) minY = verts[i];
      if (verts[i] > maxY) maxY = verts[i];
    }
    return maxY > minY ? { minY, maxY, H: maxY - minY } : null;
  };

  for (const side of ['l', 'r']) {
    // Primary: fit parabola to base eyewhite-{side}'s lower edge. Fallback: eyelash.
    // Variant parabolas are fit separately below — NEVER shared with base.
    let sourceMesh = meshes.find(m =>
      m.tag === `eyewhite-${side}` && !m.variantOf && m.vertices && m.vertices.length >= 6
    ) ?? null;
    let sourceTag = sourceMesh ? 'eyewhite' : null;
    if (!sourceMesh) {
      sourceMesh = meshes.find(m =>
        m.tag === `eyelash-${side}` && !m.variantOf && m.vertices && m.vertices.length >= 6
      ) ?? null;
      if (sourceMesh) sourceTag = 'eyelash-fallback';
    }
    // Always capture base eyelash bbox for strip compression (separate from source choice)
    const baseLash = meshes.find(m => m.tag === `eyelash-${side}` && !m.variantOf && m.vertices) ?? null;
    if (baseLash) {
      const bb = bboxFromVertsY(baseLash.vertices);
      if (bb) eyelashMeshBboxPerSide.set(side, bb);
    }
    if (!sourceMesh) continue;
    const curve = await fitParabolaFromLowerEdge(sourceMesh, sourceTag, { binCount: EYE_CLOSURE_BIN_COUNT });
    if (!curve) continue;
    eyewhiteCurvePerSide.set(side, curve);
    // Union bbox across eyelash + eyewhite + iris for this side (P11) — base-side only
    let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
    for (const m of meshes) {
      if (m.variantOf) continue;
      if (m.tag !== `eyelash-${side}` && m.tag !== `eyewhite-${side}` && m.tag !== `irides-${side}`) continue;
      const mv = m.vertices;
      if (!mv) continue;
      for (let i = 0; i < mv.length; i += 2) {
        if (mv[i]     < uMinX) uMinX = mv[i];
        if (mv[i]     > uMaxX) uMaxX = mv[i];
        if (mv[i + 1] < uMinY) uMinY = mv[i + 1];
        if (mv[i + 1] > uMaxY) uMaxY = mv[i + 1];
      }
    }
    if (uMaxX > uMinX && uMaxY > uMinY) {
      eyeUnionBboxPerSide.set(side, { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY });
    }
  }

  // Variant parabolas — fit ONE curve per (side, suffix) group against the
  // variant's OWN eyewhite-{side}.{suffix} lower edge. Lash/iris variants of
  // the same group share this curve as their closure target (structural:
  // all eye parts within a variant group must collapse to the same line).
  // Base's `eyewhiteCurvePerSide` is NEVER used for variants.
  const variantEyewhiteCurvePerSideAndSuffix = new Map(); // `${side}|${suffix}` → curve
  // Variant lash bbox is computed per-mesh inside the CArtMeshForm branch
  // (bboxFromVertsY on the variant's own verts) — no map needed.
  for (const side of ['l', 'r']) {
    const suffixesForSide = new Set();
    for (const m of meshes) {
      if (!m.variantOf || m.tag !== `eyewhite-${side}`) continue;
      const sfx = m.variantSuffix ?? m.variantRole;
      if (sfx) suffixesForSide.add(sfx);
    }
    // Also check if there's a variant lash/iris that exists WITHOUT a variant eyewhite
    // — those suffix entries still need a parabola (fall back to variant lash).
    for (const m of meshes) {
      if (!m.variantOf || m.vertices == null) continue;
      if (m.tag !== `eyelash-${side}` && m.tag !== `irides-${side}`) continue;
      const sfx = m.variantSuffix ?? m.variantRole;
      if (sfx) suffixesForSide.add(sfx);
    }
    for (const suffix of suffixesForSide) {
      let variantSource = meshes.find(m =>
        m.variantOf && m.tag === `eyewhite-${side}`
        && (m.variantSuffix ?? m.variantRole) === suffix
        && m.vertices && m.vertices.length >= 6
      ) ?? null;
      let variantSourceTag = variantSource ? 'eyewhite' : null;
      if (!variantSource) {
        variantSource = meshes.find(m =>
          m.variantOf && m.tag === `eyelash-${side}`
          && (m.variantSuffix ?? m.variantRole) === suffix
          && m.vertices && m.vertices.length >= 6
        ) ?? null;
        if (variantSource) variantSourceTag = 'eyelash-fallback';
      }
      if (!variantSource) continue;
      const vCurve = await fitParabolaFromLowerEdge(variantSource, variantSourceTag, { binCount: EYE_CLOSURE_BIN_COUNT });
      if (vCurve) variantEyewhiteCurvePerSideAndSuffix.set(`${side}|${suffix}`, vCurve);
    }
  }
  // evalClosureCurve / evalBandY / computeClosedCanvasVerts /
  // computeClosedVertsForMesh live in `cmo3/eyeClosureApply.js`.
  // Back-compat shim: eyelashBandCanvas/eyelashShiftCanvas are used by the closure
  // emission loop and by pm.hasEyelidClosure detection. We keep them populated as
  // sampled curve points so the hasEyelidClosure check still works.
  const eyelashBandCanvas = new Map();
  const eyelashShiftCanvas = new Map();
  for (const side of ['l', 'r']) {
    const params = eyewhiteCurvePerSide.get(side);
    if (!params) continue;
    const N = 9;
    const curve = [];
    const xLo = params.xMin;
    const xHi = params.xMax;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = xLo + t * (xHi - xLo);
      curve.push([x, evalClosureCurve(params, x)]);
    }
    eyelashBandCanvas.set(side, curve);
    eyelashShiftCanvas.set(side, 0);
  }
  if (rigDebugLog) {
    rigDebugLog.eyelashBand = {
      note: 'Closure curve: parabola fit to eyewhite lower edge per side (X-uniform bins + least-squares). Parabola IS the closure target. Extrapolates naturally beyond eyewhite X range. All eye meshes blend Y to curve(vertexX); X stays. Per-mesh rwBox clamp + lash strip compression + union-bbox rwBox extension apply.',
      constants: {
        LASH_STRIP_FRAC: EYE_CLOSURE_LASH_STRIP_FRAC,
        BIN_COUNT:       EYE_CLOSURE_BIN_COUNT,
      },
      l: eyewhiteCurvePerSide.has('l') ? {
        parabola: eyewhiteCurvePerSide.get('l'),
        sampledCurve: eyelashBandCanvas.get('l'),
        lashBbox: eyelashMeshBboxPerSide.get('l') ?? null,
      } : null,
      r: eyewhiteCurvePerSide.has('r') ? {
        parabola: eyewhiteCurvePerSide.get('r'),
        sampledCurve: eyelashBandCanvas.get('r'),
        lashBbox: eyelashMeshBboxPerSide.get('r') ?? null,
      } : null,
    };
  }

  emitAllMeshLayersAndKeyforms(ctx, {
    pidLi, pidLg,
    variantParamPidBySuffix,
    variantSuffixesByBasePartId,
    backdropTagsSet: BACKDROP_TAGS_SET,
    pidParamEyeLOpenEarly,
    pidParamEyeROpenEarly,
    pidParamAngleXEarly,
    eyewhiteCurvePerSide,
    variantEyewhiteCurvePerSideAndSuffix,
    eyelashMeshBboxPerSide,
    eyelashBandCanvas,
    eyelashShiftCanvas,
    bboxFromVertsY,
  });

  // ==================================================================
  // 2b. FILL SHARED CLayerGroup + CLayeredImage (after all layers created)
  // ==================================================================
  // Logic in `cmo3/meshLayer.js`. Walks layerRefs from the per-mesh
  // loop above + populates the shared CLayerGroup/CLayeredImage XML
  // nodes that section 2 created up-front.
  fillLayerGroupAndImage(x, {
    layerGroup, layeredImg, pidLg, pidLi, pidLiGuid, pidBlend,
    uuid, layerRefs, canvasW, canvasH,
  });

  // ==================================================================
  // 3. PART SOURCES (hierarchical: Root → Groups → Drawables)
  // ==================================================================
  // Logic in `cmo3/partHierarchy.js`. Returns rootPart + allPartSources
  // + groupParts (the latter consumed by section 4 mesh routing).
  const { rootPart, allPartSources, groupParts } = buildPartHierarchy(x, {
    groups, meshes, perMesh,
    pidPartGuid, groupPartGuids, pidDeformerNull,
  });

  // ==================================================================
  // 3b. ROTATION DEFORMERS (one per group with transform data)
  // ==================================================================
  // Logic in `cmo3/rotationDeformerEmit.js`. Emits a
  // CRotationDeformerSource per non-bone non-skipped group, mirrors
  // the spec into rigCollector.rotationDeformers, and returns all the
  // per-group state (groupMap, world origins, deformer guid map,
  // rotDeformerTargetNodes for re-parenting in section 3c, etc.).
  const _rotEmit = emitRotationDeformers(x, {
    groups, meshes, canvasW, canvasH,
    paramDefs, boneParamGuids, rigCollector,
    pidPartGuid, groupPartGuids, pidDeformerRoot,
    groupParts, rootPart,
    bakedAngleMin: BAKED_ANGLE_MIN, bakedAngleMax: BAKED_ANGLE_MAX,
    rotParamRangeMin: _ROT_PARAM_RANGE_MIN, rotParamRangeMax: _ROT_PARAM_RANGE_MAX,
    rotGroupParamKeys: _ROT_GROUP_PARAM_KEYS, rotGroupAngles: _ROT_GROUP_ANGLES,
    skipRoles: _ROT_SKIP_ROLES,
  });
  const {
    groupMap, headGroupId, neckGroupId,
    groupWorldMatrices, deformerWorldOrigins,
    groupDeformerGuids,
    rotDeformerTargetNodes, rotDeformerOriginNodes,
    allDeformerSources, deformerParamMap,
  } = _rotEmit;
  // ==================================================================
  // 3b. CWarpDeformerSource (per mesh with mesh_verts animation)
  // ==================================================================
  // Logic in `cmo3/meshVertsWarp.js`. For every mesh with a
  // `mesh_verts` animation track, emits a CWarpDeformerSource whose
  // grid keyforms come from per-vertex deltas via Inverse Distance
  // Weighting. Returns the partId → pidWarpDfGuid map that section 4
  // consults when routing meshes to their own warp parent.
  const { meshWarpDeformerGuids } = emitMeshVertsWarpDeformers(x, {
    animations, meshes, perMesh,
    deformerWorldOrigins, groupDeformerGuids, groupPartGuids,
    groupParts, rootPart,
    allDeformerSources, paramDefs, deformerParamMap,
    pidPartGuid, pidDeformerRoot,
  });
  // ==================================================================
  // 3c. Standard-rig warp deformers (generateRig)
  // ==================================================================
  // When generateRig is enabled, create a ROOT-level warp deformer for each mesh
  // that matches a supported tag.  The warp grid covers the mesh's canvas-space
  // bounding box (with 10 % padding) and the mesh's keyform positions are converted
  // to 0..1 warp-local space.
  //
  // Coordinate system (reverse-engineered from Hiyori, confirmed Session 13):
  //   ROOT-level warp grid → canvas pixel space, CoordType "Canvas"
  //   Mesh keyforms under warp → 0..1 normalized, CoordType "DeformerLocal"

  // RIG_WARP_TAGS / FACE_PARALLAX_TAGS / FACE_PARALLAX_DEPTH / NECK_WARP_TAGS
  // live in `cmo3/rigWarpTags.js`. The constants drive sections 3c (per-tag
  // warp grid sizes), 3d.2 (face-parallax membership + depth) and 3d.1
  // (neck-warp membership) below.

  // partId → { gridMinX, gridMinY, gridW, gridH } for 0..1 conversion in section 4
  const rigWarpBbox = new Map();

  // Path C diagnostic (Apr 2026): partId → rig warp grid corner positions (in parent
  // deformer's coord space). Used to verify that the grid itself is positioned where
  // we expect, which tells us if a rendering displacement is algorithmic or chain-level.
  const rigWarpDebugInfo = new Map();

  // 19 standard SDK parameter pids (Breath, BodyAngleY/Z, EyeBall*, Brow*Y,
  // MouthOpenY, Eye*Open, Hair*, Skirt/Shirt/Pants/Bust, Angle{X,Y,Z}).
  // ParamBodyAngleX presence is checked inline at the body chain call site
  // (buildBodyWarpChain's hasParamBodyAngleX flag), so no local pid var.
  const {
    pidParamBreath,
    pidParamBodyAngleY, pidParamBodyAngleZ,
    pidParamEyeBallX, pidParamEyeBallY,
    pidParamBrowLY, pidParamBrowRY,
    pidParamMouthOpenY,
    pidParamEyeLOpen, pidParamEyeROpen,
    pidParamHairFront, pidParamHairBack,
    pidParamSkirt, pidParamShirt, pidParamPants, pidParamBust,
    pidParamAngleX, pidParamAngleY, pidParamAngleZ,
  } = lookupStandardParamPids(paramDefs);

  // ── Per-part warp parameter bindings (Stage 9a) ──
  // The TAG_PARAM_BINDINGS rule set (rules + procedural shiftFns) lives
  // in `rig/tagWarpBindings.js`. `buildTagBindingMap(paramPids, magnitudes)`
  // returns the same shape today expects: `tag → { bindings: [{pid, keys,
  // desc}], shiftFn }`. Magnitudes flow through `autoRigConfig.tagWarpMagnitudes`
  // — the user can override per-character without forking shared code.
  const _paramPidByName = {
    ParamHairFront:   pidParamHairFront,
    ParamHairBack:    pidParamHairBack,
    ParamSkirt:       pidParamSkirt,
    ParamShirt:       pidParamShirt,
    ParamPants:       pidParamPants,
    ParamBust:        pidParamBust,
    ParamBrowLY:      pidParamBrowLY,
    ParamBrowRY:      pidParamBrowRY,
    ParamMouthOpenY:  pidParamMouthOpenY,
    ParamEyeLOpen:    pidParamEyeLOpen,
    ParamEyeBallX:    pidParamEyeBallX,
    ParamEyeBallY:    pidParamEyeBallY,
  };
  const TAG_PARAM_BINDINGS = buildTagBindingMap(
    _paramPidByName,
    autoRigConfig?.tagWarpMagnitudes,
  );

  // Collect per-part warp target nodes for re-parenting in section 3d.
  // Each entry: { node, faceGroupKey or null } — face-parallax tags route to their
  // FaceParallax warp; others route to Body X.
  const rigWarpTargetNodesToReparent = [];

  // ── Body warp chain — single source of truth ──
  // buildBodyWarpChain is shared with moc3writer (Phase C). It returns:
  //   - specs: 4 WarpDeformerSpec (BZ, BY, Breath, BX) used by both writers
  //   - canvasToBodyXX/Y: canvas-px → BX 0..1 normaliser used by per-part warps
  //   - layout: BZ_MIN_X, BZ_W, BY_MIN, … geometry constants
  //   - debug: HIP_FRAC, FEET_FRAC, spineCfShifts (preserved in rigDebugLog).
  // The legacy inline math (~50 LOC) used to live here and was duplicated
  // in the body-warp emission block; the spec consolidates both into one
  // canonical computation.
  // Stage 10: prefer the pre-resolved chain from `project.bodyWarp` when
  // populated; otherwise fall back to the inline heuristic. The shape is
  // identical (specs + layout + canvasToBodyXX/Y + debug) so downstream
  // consumers don't branch.
  //
  // Stage 11 invariant: outside `rigOnly` mode the heuristic should never
  // fire — exporter.js's `resolveAllKeyformSpecs` runs the seeder first.
  // A live warning makes it visible if a future caller bypasses that path.
  if (!bodyWarpChain && !rigOnly) {
    console.warn('[cmo3writer] bodyWarpChain heuristic firing outside rigOnly mode — exporter likely bypassed Stage 11 auto-harvest');
  }
  if ((!rigWarps || (rigWarps.size ?? 0) === 0) && !rigOnly) {
    console.warn('[cmo3writer] per-mesh rigWarps map empty outside rigOnly mode — shiftFn fallbacks may fire (see Stage 11 auto-harvest)');
  }
  const _bodyChain = bodyWarpChain ?? buildBodyWarpChain({
    perMesh,
    canvasW,
    canvasH,
    bodyAnalysis,
    hasParamBodyAngleX: !!paramDefs.find(p => p.id === 'ParamBodyAngleX')?.pid,
    autoRigBodyWarp: autoRigConfig?.bodyWarp,
  });
  // canvasToBodyXX/Y are used by face parallax, neck warp, and per-part rig
  // warp grids when they rebase canvas coords into Body X 0..1 space. The
  // numeric layout constants (BZ_*, BY_*, BR_*, BX_*) now live only inside
  // bodyWarp.js since the spec-driven emission consumes them directly.
  const canvasToBodyXX = _bodyChain.canvasToBodyXX;
  const canvasToBodyXY = _bodyChain.canvasToBodyXY;
  // Stash the normaliser on rigCollector so moc3writer can project mesh
  // vertex positions into BodyXWarp's local frame when emitting the binary.
  rigCollector.canvasToInnermostX = canvasToBodyXX;
  rigCollector.canvasToInnermostY = canvasToBodyXY;
  rigCollector.innermostBodyWarpId =
    _bodyChain.specs.find(s => s.id === 'BodyXWarp')?.id
    ?? _bodyChain.specs.find(s => s.id === 'BreathWarp')?.id
    ?? null;
  // Stage 1b harvest: stash the full chain object (specs + layout + debug
  // + closures) so callers running rigOnly mode can seed `project.bodyWarp`
  // without re-running buildBodyWarpChain themselves. The closures aren't
  // serializable but seedBodyWarpChain serializes from the chain anyway.
  rigCollector.bodyWarpChain = _bodyChain;
  if (rigDebugLog) {
    rigDebugLog.bodyFracSource = _bodyChain.debug.bodyFracSource;
    rigDebugLog.bodyFrac = {
      HIP_FRAC: _bodyChain.debug.HIP_FRAC,
      FEET_FRAC: _bodyChain.debug.FEET_FRAC,
    };
    rigDebugLog.spineCfShifts = {
      source: bodyAnalysis && bodyAnalysis.widthProfile ? 'measured-widthProfile' : 'none',
      perRow: _bodyChain.debug.spineCfShifts,
      note: 'cf shift per grid row: 0 = bow centered on bbox, positive = spine drifts right of bbox, negative = left',
    };
  }

  // ── Face parallax pre-pass (Session 19, single-warp Body-X-style) ──
  // Compute the union canvas bbox of ALL face-tagged meshes. This bbox defines the single
  // FaceParallax warp. All face rig warps rebase into this bbox's 0..1 local.
  let fpUnionMinX = Infinity, fpUnionMinY = Infinity;
  let fpUnionMaxX = -Infinity, fpUnionMaxY = -Infinity;
  let fpAnyFaceMesh = false;
  for (const pm of perMesh) {
    const tag = meshes[pm.mi].tag;
    if (!FACE_PARALLAX_TAGS.has(tag)) continue;
    const v = pm.vertices;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < fpUnionMinX) fpUnionMinX = v[i];
      if (v[i]     > fpUnionMaxX) fpUnionMaxX = v[i];
      if (v[i + 1] < fpUnionMinY) fpUnionMinY = v[i + 1];
      if (v[i + 1] > fpUnionMaxY) fpUnionMaxY = v[i + 1];
      fpAnyFaceMesh = true;
    }
  }
  let faceUnionBbox = null;
  if (fpAnyFaceMesh) {
    const w = fpUnionMaxX - fpUnionMinX;
    const h = fpUnionMaxY - fpUnionMinY;
    const padX = w * 0.10 || 10;
    const padY = h * 0.10 || 10;
    faceUnionBbox = {
      minX: fpUnionMinX - padX, maxX: fpUnionMaxX + padX,
      minY: fpUnionMinY - padY, maxY: fpUnionMaxY + padY,
      W:   (fpUnionMaxX + padX) - (fpUnionMinX - padX),
      H:   (fpUnionMaxY + padY) - (fpUnionMinY - padY),
    };
    if (rigDebugLog) {
      rigDebugLog.faceUnion = {
        rawMinX: fpUnionMinX, rawMinY: fpUnionMinY,
        rawMaxX: fpUnionMaxX, rawMaxY: fpUnionMaxY,
        padX, padY,
        paddedMinX: faceUnionBbox.minX, paddedMinY: faceUnionBbox.minY,
        paddedMaxX: faceUnionBbox.maxX, paddedMaxY: faceUnionBbox.maxY,
        W: faceUnionBbox.W, H: faceUnionBbox.H,
        aspect: faceUnionBbox.H > 0 ? faceUnionBbox.W / faceUnionBbox.H : null,
      };
    }
  } else if (rigDebugLog) {
    rigDebugLog.warnings.push('No face-parallax-tagged meshes found; FaceParallax warp skipped');
  }
  // canvas → FaceParallax 0..1 local (used for rig warp grid rebasing, section 3c)
  const canvasToFaceUnionX = (cx) => faceUnionBbox
    ? (cx - faceUnionBbox.minX) / faceUnionBbox.W : 0;
  const canvasToFaceUnionY = (cy) => faceUnionBbox
    ? (cy - faceUnionBbox.minY) / faceUnionBbox.H : 0;
  // Face Rotation pivot (canvas space): anatomical chin anchor = bottom of
  // the 'face' mesh bbox + X-center of the 'face' mesh.
  //
  // Prior behavior (pre-Phase-0) used `faceUnionBbox.maxY` as a "chin proxy",
  // but the face union includes hair and ears, which typically extend well
  // below the actual chin. Phase-0 diagnostic log measurements:
  //   girl.psd:  face.maxY=352,  faceUnion.maxY=456  (104 px below chin)
  //   waifu.psd: face.maxY=424,  faceUnion.maxY=575  (151 px below chin)
  // The 151 px offset made ParamAngleZ rotate waifu's head around a point
  // far below the neck, producing a large unnatural swing arc.
  //
  // See docs/live2d-export/AUTO_RIG_PLAN.md (P0 fix, evidence-driven).
  let faceMeshBbox = null;
  for (const m of meshes) {
    if (m.tag !== 'face') continue;
    const v = m.vertices;
    if (!v || v.length < 2) break;
    let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < fMinX) fMinX = v[i];
      if (v[i]     > fMaxX) fMaxX = v[i];
      if (v[i + 1] < fMinY) fMinY = v[i + 1];
      if (v[i + 1] > fMaxY) fMaxY = v[i + 1];
    }
    faceMeshBbox = { minX: fMinX, minY: fMinY, maxX: fMaxX, maxY: fMaxY };
    break;
  }
  const facePivotCx = faceMeshBbox
    ? (faceMeshBbox.minX + faceMeshBbox.maxX) / 2
    : (faceUnionBbox ? (faceUnionBbox.minX + faceUnionBbox.maxX) / 2 : null);
  const facePivotCy_chin = faceMeshBbox
    ? faceMeshBbox.maxY
    : (faceUnionBbox ? faceUnionBbox.maxY : null);

  // D2: Face Rotation origin calibration via measured anatomy.
  // Rotating AngleZ (head tilt) around chin makes the hair and top of head
  // swing widely while chin stays put — natural for side-drawn cartoons but
  // reads weirdly on realistic art because viewer expects the whole head +
  // neck to pivot around the neck base (where neck meets torso).
  //
  // Heuristic:
  //   - Normal case (topwear starts BELOW chin): topwear.minY IS the neck
  //     base (e.g., shirt collar). Use it.
  //   - Hood/high-collar case (topwear overlaps face above chin): estimate
  //     neck base as chin + 10% of face height.
  //
  // Safeguard: if the candidate pivot is within THRESHOLD px of chin-based
  // pivot, keep chin (preserves characters that already look good — waifu).
  const FACE_PIVOT_DELTA_THRESHOLD = 15;
  let facePivotCy = facePivotCy_chin;
  let facePivotCySource = faceMeshBbox ? 'face_mesh_bottom' : 'face_union_max_y_fallback';
  let facePivotCandidate = null;
  if (faceMeshBbox && bodyAnalysis && bodyAnalysis.topwearBbox) {
    const chin = faceMeshBbox.maxY;
    const topwearTop = bodyAnalysis.topwearBbox.minY;
    const faceH = faceMeshBbox.maxY - faceMeshBbox.minY;
    if (topwearTop > chin) {
      facePivotCandidate = topwearTop;
    } else if (faceH > 0) {
      facePivotCandidate = chin + faceH * 0.10;
    }
    if (facePivotCandidate !== null &&
        Math.abs(facePivotCandidate - facePivotCy_chin) >= FACE_PIVOT_DELTA_THRESHOLD) {
      facePivotCy = facePivotCandidate;
      facePivotCySource = topwearTop > chin
        ? 'measured_neck_base_via_topwear_minY'
        : 'chin_plus_face_height_offset_hood_case';
    }
  }

  if (rigDebugLog && (faceMeshBbox || faceUnionBbox)) {
    rigDebugLog.facePivot = {
      cx: facePivotCx,
      cy: facePivotCy,
      cy_chin_baseline: facePivotCy_chin,
      cy_measured_candidate: facePivotCandidate,
      cy_delta_from_chin: facePivotCandidate !== null ? facePivotCandidate - facePivotCy_chin : null,
      anchorSource: facePivotCySource,
      faceMeshBbox: faceMeshBbox ?? null,
      note: 'D2 neck-base calibration: prefers measured topwear.minY (normal collar) '
          + 'or chin+10% face-height (hood case). Falls back to chin if candidate is '
          + 'within 15px of chin (e.g., waifu) so existing anime tuning is preserved.',
    };
  }

  // ── Neck warp pre-pass (Session 20) ─────────────────────────────────────
  // Union canvas bbox of all neck-tagged meshes. A dedicated NeckWarp covers
  // this bbox and applies a Y-gradient deformation driven by ParamAngleZ so
  // the upper neck follows the head tilt while the shoulders stay anchored.
  let nwUnionMinX = Infinity, nwUnionMinY = Infinity;
  let nwUnionMaxX = -Infinity, nwUnionMaxY = -Infinity;
  let nwAnyMesh = false;
  for (const pm of perMesh) {
    const tag = meshes[pm.mi].tag;
    if (!NECK_WARP_TAGS.has(tag)) continue;
    const v = pm.vertices;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < nwUnionMinX) nwUnionMinX = v[i];
      if (v[i]     > nwUnionMaxX) nwUnionMaxX = v[i];
      if (v[i + 1] < nwUnionMinY) nwUnionMinY = v[i + 1];
      if (v[i + 1] > nwUnionMaxY) nwUnionMaxY = v[i + 1];
      nwAnyMesh = true;
    }
  }
  let neckUnionBbox = null;
  if (nwAnyMesh) {
    const w = nwUnionMaxX - nwUnionMinX;
    const h = nwUnionMaxY - nwUnionMinY;
    const padX = w * 0.10 || 10;
    const padY = h * 0.10 || 10;
    neckUnionBbox = {
      minX: nwUnionMinX - padX, maxX: nwUnionMaxX + padX,
      minY: nwUnionMinY - padY, maxY: nwUnionMaxY + padY,
      W:   (nwUnionMaxX + padX) - (nwUnionMinX - padX),
      H:   (nwUnionMaxY + padY) - (nwUnionMinY - padY),
    };
    if (rigDebugLog) {
      rigDebugLog.neckUnion = {
        rawMinX: nwUnionMinX, rawMinY: nwUnionMinY,
        rawMaxX: nwUnionMaxX, rawMaxY: nwUnionMaxY,
        padX, padY,
        paddedMinX: neckUnionBbox.minX, paddedMinY: neckUnionBbox.minY,
        paddedMaxX: neckUnionBbox.maxX, paddedMaxY: neckUnionBbox.maxY,
        W: neckUnionBbox.W, H: neckUnionBbox.H,
      };
    }
  } else if (rigDebugLog) {
    rigDebugLog.warnings.push('No neck-tagged meshes found; NeckWarp skipped');
  }
  const canvasToNeckWarpX = (cx) => neckUnionBbox
    ? (cx - neckUnionBbox.minX) / neckUnionBbox.W : 0;
  const canvasToNeckWarpY = (cy) => neckUnionBbox
    ? (cy - neckUnionBbox.minY) / neckUnionBbox.H : 0;

  // ── Pre-pass: eye-closure contexts + Section 3c per-part rig warps ──
  // (sweeps #43): eye-closure contexts derive convergence curves in
  // BodyX 0..1 from eyewhite/eyelash sources; Section 3c emits one
  // CWarpDeformerSource per RIG_WARP_TAGS-matching mesh.
  const { eyeContexts, findEyeCtx } = buildEyeContexts({
    perMesh, meshes, generateRig,
    canvasToBodyXX, canvasToBodyXY, rigDebugLog,
  });

  emitPerPartRigWarps(ctx, {
    canvasToBodyXX, canvasToBodyXY,
    faceUnionBbox, canvasToFaceUnionX, canvasToFaceUnionY,
    neckUnionBbox, canvasToNeckWarpX, canvasToNeckWarpY,
    eyeUnionBboxPerSide,
    tagParamBindings: TAG_PARAM_BINDINGS,
    meshWarpDeformerGuids,
    rigWarpBbox,
    rigWarpDebugInfo,
    rigWarpTargetNodesToReparent,
    findEyeCtx,
    groupParts,
    rootPart,
    allDeformerSources,
  });

  // ==================================================================
  // 3d. Structural Body Warp Chain (Hiyori pattern: 3 chained warps)
  // ==================================================================
  // Logic in `cmo3/structuralChainEmit.js`. Emits Body Z/Y/Breath/X
  // warp chain, then NeckWarp + Face Rotation + Face Parallax under
  // Body X, then re-parents all rotation deformers + per-part rig
  // warps into their final chain positions.
  emitStructuralChainAndReparent(x, {
    generateRig, rigOnly,
    paramDefs, pidDeformerRoot, pidCoord, rigCollector, rigDebugLog,
    autoRigConfig, faceParallaxSpec,
    bodyChain: _bodyChain,
    pidParamBodyAngleZ, pidParamBodyAngleY, pidParamBreath,
    pidParamAngleX, pidParamAngleY, pidParamAngleZ,
    neckUnionBbox, faceUnionBbox, faceMeshBbox, facePivotCx, facePivotCy,
    headGroupId, neckGroupId, groupMap,
    groupDeformerGuids, deformerWorldOrigins,
    canvasToBodyXX, canvasToBodyXY,
    rotFaceParamKeys: _ROT_FACE_PARAM_KEYS, rotFaceAngles: _ROT_FACE_ANGLES,
    meshes, allDeformerSources, pidPartGuid, rootPart,
    rotDeformerTargetNodes, rotDeformerOriginNodes,
    rigWarpTargetNodesToReparent,
  });
  // ==================================================================
  // 4. CArtMeshSource (per mesh)
  // ==================================================================

  const meshSrcIds = []; // pidMesh for each mesh

  // Clipping-mask resolution: certain tagged meshes should be masked by others
  // at render time (iris inside eyewhite, iris-highlight inside iris, etc.).
  // When a mesh's tag is in CLIP_RULES keys, its drawable references the mask's
  // CDrawableGuid in clipGuidList — Cubism handles occlusion natively.
  //
  // Variant-aware pairing (2026-04-23): variant iris (`irides-l.smile`)
  // must be clipped by its OWN variant eyewhite (`eyewhite-l.smile`), NOT
  // the base eyewhite. Reason: base eyewhite fades to α=0 at the variant's
  // Param<Suffix>=1 endpoint (hasBaseFade / 2D compound), and Cubism uses
  // the mask's alpha for clipping — so a base-eyewhite-clipped variant iris
  // vanishes whenever its own param is high.
  //
  // Stage 3 (native rig): pairings come from `maskConfigs` when the caller
  // passed any (post-seed path), else from the inline heuristic in
  // `cmo3/maskResolve.js` (matches `rig/maskConfigs.js`). The
  // partId-keyed mask list is preserved for rigSpec multi-mask
  // fidelity; cmo3 emission collapses to one clip ref.
  const { maskPidByMaskedPartId, maskMeshIdsByPartId } = resolveMaskPairings({
    perMesh, meshes, maskConfigs,
  });

  for (const pm of perMesh) {
    const [meshSrc, pidMesh] = x.shared('CArtMeshSource');
    meshSrcIds.push(pidMesh);

    // Set _owner on CTextureInputExtension
    x.subRef(pm.tieSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });

    const canvasVerts = pm.vertices; // original canvas-space positions
    const tris = pm.triangles;
    const uvs = pm.uvs;
    const numVerts = canvasVerts.length / 2;

    // TRAP: .cmo3 has TWO position arrays per mesh in different coordinate spaces!
    //   - meshSrc > positions + GEditableMesh2 > point → CANVAS pixel space (texture mapping)
    //   - keyform > CArtMeshForm > positions → DEFORMER-LOCAL space (rendering)
    // Setting both to the same space breaks either textures (empty fill) or deformation (scatter).
    // See ARCHITECTURE.md "Dual-Position System" for details.
    const meshParentGroup = meshes[pm.mi].parentGroupId;
    const jointBoneId = meshes[pm.mi].jointBoneId;

    // For baked keyform meshes: parent to ARM deformer (bone's parent group), not bone deformer.
    // The ARM deformer handles shoulder rotation; baked keyforms handle elbow bending.
    let dfOwner;
    if (pm.hasBakedKeyforms) {
      // Find the ARM group (parent of the bone node) — mesh is parented here, not to bone deformer.
      // Fallback chain: bone's parent → mesh's parent → null (ungrouped, canvas space)
      const boneGroup = groupMap.get(jointBoneId);
      dfOwner = boneGroup?.parent || meshParentGroup;
    } else {
      dfOwner = jointBoneId && deformerWorldOrigins.has(jointBoneId)
        ? jointBoneId : meshParentGroup;
    }
    // If dfOwner exists but has no deformer origin (e.g. bone node with no deformer),
    // walk up the group hierarchy until we find one with a deformer origin.
    while (dfOwner && !deformerWorldOrigins.has(dfOwner)) {
      const parentGroup = groupMap.get(dfOwner);
      dfOwner = parentGroup?.parent || null;
    }
    const dfOrigin = dfOwner && deformerWorldOrigins.has(dfOwner)
      ? deformerWorldOrigins.get(dfOwner)
      : null;

    // When mesh is under a rig warp deformer, keyform positions must be 0..1 warp-local.
    // Otherwise, standard deformer-local (canvas minus deformer world origin).
    const partId = meshes[pm.mi].partId;
    const rwBox = rigWarpBbox.get(partId);
    let verts;
    if (rwBox) {
      // 0..1 warp-local: (canvasPos - gridMin) / gridSize
      verts = canvasVerts.map((v, i) =>
        i % 2 === 0
          ? (v - rwBox.gridMinX) / rwBox.gridW
          : (v - rwBox.gridMinY) / rwBox.gridH
      );
    } else if (dfOrigin) {
      verts = canvasVerts.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y));
    } else {
      verts = canvasVerts;
    }

    const ds = x.sub(meshSrc, 'ACDrawableSource', { 'xs.n': 'super' });
    const pc = x.sub(ds, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(pc, 's', { 'xs.n': 'localName' }).text = pm.meshName;
    x.sub(pc, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(pc, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    // parentGuid: the group this mesh belongs to, or root if ungrouped
    const meshParentPid = meshParentGroup && groupPartGuids.has(meshParentGroup)
      ? groupPartGuids.get(meshParentGroup) : pidPartGuid;
    x.subRef(pc, 'CPartGuid', meshParentPid, { 'xs.n': 'parentGuid' });
    x.subRef(pc, 'KeyformGridSource', pm.pidKfgMesh, { 'xs.n': 'keyformGridSource' });
    const morph = x.sub(pc, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(morph, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const mbw = x.sub(morph, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(mbw, 'carray_list', { 'xs.n': '_constraints', count: '0' });

    // Extensions: editable mesh + texture input + mesh generator
    const extList = x.sub(pc, 'carray_list', { 'xs.n': '_extensions', count: '3' });

    // CEditableMeshExtension
    const eme = x.sub(extList, 'CEditableMeshExtension');
    const emeSup = x.sub(eme, 'ACExtension', { 'xs.n': 'super' });
    x.subRef(emeSup, 'CExtensionGuid', pm.pidExtMesh, { 'xs.n': 'guid' });
    x.subRef(emeSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });

    // Build edge list from triangles
    const edgeSet = new Set();
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b_ = tris[t + 1], c = tris[t + 2];
      const addEdge = (u, v) => {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        edgeSet.add(key);
      };
      addEdge(a, b_);
      addEdge(b_, c);
      addEdge(c, a);
    }
    const edges = [];
    for (const e of edgeSet) {
      const [a, b_] = e.split(',').map(Number);
      edges.push(a, b_);
    }

    const em = x.sub(eme, 'GEditableMesh2', {
      'xs.n': 'editableMesh',
      nextPointUid: String(numVerts),
      useDelaunayTriangulation: 'true',
    });
    // Editable mesh points in canvas space (for texture baking)
    x.sub(em, 'float-array', { 'xs.n': 'point', count: String(canvasVerts.length) }).text =
      canvasVerts.map(v => v.toFixed(1)).join(' ');
    x.sub(em, 'byte-array', { 'xs.n': 'pointPriority', count: String(numVerts) }).text =
      Array(numVerts).fill('20').join(' ');
    x.sub(em, 'short-array', { 'xs.n': 'edge', count: String(edges.length) }).text =
      edges.join(' ');
    x.sub(em, 'byte-array', { 'xs.n': 'edgePriority', count: String(edges.length / 2) }).text =
      Array(edges.length / 2).fill('30').join(' ');
    x.sub(em, 'int-array', { 'xs.n': 'pointUid', count: String(numVerts) }).text =
      Array.from({ length: numVerts }, (_, i) => i).join(' ');
    x.subRef(em, 'GEditableMeshGuid', pm.pidEmesh, { 'xs.n': 'meshGuid' });
    x.subRef(em, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
    x.sub(eme, 'b', { 'xs.n': 'isLocked' }).text = 'false';

    // Texture input extension ref
    x.subRef(extList, 'CTextureInputExtension', pm.pidTie);

    // CMeshGeneratorExtension
    const mge = x.sub(extList, 'CMeshGeneratorExtension');
    const mgeSup = x.sub(mge, 'ACExtension', { 'xs.n': 'super' });
    x.sub(mgeSup, 'CExtensionGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
    x.subRef(mgeSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });
    const mgs = x.sub(mge, 'MeshGenerateSetting', { 'xs.n': 'meshGenerateSetting' });
    x.sub(mgs, 'i', { 'xs.n': 'polygonOuterDensity' }).text = '100';
    x.sub(mgs, 'i', { 'xs.n': 'polygonInnerDensity' }).text = '100';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMargin' }).text = '20';
    x.sub(mgs, 'i', { 'xs.n': 'polygonInnerMargin' }).text = '20';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMinMargin' }).text = '5';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMinBoundsPt' }).text = '5';
    x.sub(mgs, 'i', { 'xs.n': 'thresholdAlpha' }).text = '0';

    x.sub(pc, 'null', { 'xs.n': 'internalColor_direct_argb' });

    x.sub(ds, 'CDrawableId', { 'xs.n': 'id', idstr: pm.meshId });
    x.subRef(ds, 'CDrawableGuid', pm.pidDrawable, { 'xs.n': 'guid' });
    // targetDeformerGuid: warp > deformer > ROOT
    // For baked keyform meshes: parent to ARM deformer (bone's parent), not bone deformer.
    // For non-baked: jointBone's deformer > parent group's deformer > ROOT.
    const meshJointBoneId = meshes[pm.mi].jointBoneId;
    let meshDfGuid;
    if (meshWarpDeformerGuids.has(partId)) {
      meshDfGuid = meshWarpDeformerGuids.get(partId);
    } else if (pm.hasBakedKeyforms) {
      // ARM deformer (bone's parent group) — mesh bending handled by baked keyforms
      const boneGroup = groupMap.get(meshJointBoneId);
      const armGroupId = boneGroup?.parent || meshParentGroup;
      meshDfGuid = (armGroupId && groupDeformerGuids.has(armGroupId))
        ? groupDeformerGuids.get(armGroupId) : pidDeformerRoot;
    } else if (meshJointBoneId && groupDeformerGuids.has(meshJointBoneId)) {
      meshDfGuid = groupDeformerGuids.get(meshJointBoneId);
    } else if (meshParentGroup && groupDeformerGuids.has(meshParentGroup)) {
      meshDfGuid = groupDeformerGuids.get(meshParentGroup);
    } else {
      meshDfGuid = pidDeformerRoot;
    }
    x.subRef(ds, 'CDeformerGuid', meshDfGuid, { 'xs.n': 'targetDeformerGuid' });
    // Clipping-mask reference. Pairings were resolved above from either
    // `maskConfigs` (Stage 3 seeded path) or the inline heuristic
    // (legacy path), so this loop is just a lookup by partId.
    const maskPid = maskPidByMaskedPartId.get(meshes[pm.mi].partId) ?? null;
    if (maskPid) {
      const clipList = x.sub(ds, 'carray_list', { 'xs.n': 'clipGuidList', count: '1' });
      x.subRef(clipList, 'CDrawableGuid', maskPid);
    } else {
      x.sub(ds, 'carray_list', { 'xs.n': 'clipGuidList', count: '0' });
    }
    x.sub(ds, 'b', { 'xs.n': 'invertClippingMask' }).text = 'false';

    // Triangle indices
    x.sub(meshSrc, 'int-array', { 'xs.n': 'indices', count: String(tris.length) }).text =
      tris.join(' ');

    // v2 R1.b — Capture art-mesh spec for the rigSpec session cache.
    // Each branch below populates `artBindings` + `artKeyforms`; one push
    // at the end of the keyform section feeds rigCollector.artMeshes.
    // Positions written here mirror the deformer-local positions emitted
    // to XML (warp-local 0..1 if rwBox, else pivot-relative px if dfOrigin,
    // else canvas px).
    const artBindings = [];
    const artKeyforms = [];
    let artLocalFrame = rwBox ? 'normalized-0to1'
      : (dfOrigin ? 'pivot-relative' : 'canvas-px');
    // The rig-warp emission block (~L2755) sanitises the mesh name to derive
    // its CDeformerId — match the same transform here so artMesh.parent.id
    // resolves into rigSpec.warpDeformers via lookup.
    const _artSanitizedName = sanitisePartName(pm.meshName || pm.partId);
    let artParent;
    // Tracks whether the bone-baked branch fell back to root because the
    // arm group itself has no rotation deformer (e.g. shelby's leftArm
    // is also a bone). When true the keyform emission below re-encodes
    // pivot-relative verts back to canvas-px for the rigSpec only — XML
    // emission keeps its own (separate) coord-space convention.
    let bakedReencodeToCanvas = false;
    if (rwBox) {
      artParent = { type: 'warp', id: `RigWarp_${_artSanitizedName}` };
    } else if (pm.hasBakedKeyforms) {
      // Bone-baked meshes (arms/legs/hands): the bone group itself never
      // gets a rotation deformer (skipped at ~L1742 because it lives in
      // `boneParamGuids`). Mirror the XML fallback at ~L3576: parent to
      // the arm group's `GroupRotation_<id>` deformer when present; else
      // root with canvas-px verts (chainEval can't walk a missing parent).
      if (dfOwner && groupDeformerGuids.has(dfOwner)) {
        artParent = { type: 'rotation', id: `GroupRotation_${dfOwner}` };
      } else {
        artParent = { type: 'root', id: null };
        artLocalFrame = 'canvas-px';
        bakedReencodeToCanvas = !!dfOrigin;
      }
    } else if (jointBoneId && deformerWorldOrigins.has(jointBoneId)) {
      artParent = { type: 'rotation', id: jointBoneId };
    } else if (dfOwner) {
      artParent = { type: 'warp', id: dfOwner };
    } else {
      artParent = { type: 'root', id: null };
    }

    // Keyforms — baked bone-weight keyforms or single rest-pose keyform
    // Helper to emit one CArtMeshForm
    const emitArtMeshForm = (kfList, formGuidPid, positions, opacity = 1.0) => {
      const artForm = x.sub(kfList, 'CArtMeshForm');
      const adf = x.sub(artForm, 'ACDrawableForm', { 'xs.n': 'super' });
      const acf = x.sub(adf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(acf, 'CFormGuid', formGuidPid, { 'xs.n': 'guid' });
      x.sub(acf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(acf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(acf, 'CArtMeshSource', pidMesh, { 'xs.n': '_source' });
      x.sub(acf, 'null', { 'xs.n': 'name' });
      x.sub(acf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(adf, 'i', { 'xs.n': 'drawOrder' }).text = String(pm.drawOrder);
      x.sub(adf, 'f', { 'xs.n': 'opacity' }).text = opacity.toFixed(2);
      x.sub(adf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(adf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(adf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
      // Warp-local positions are 0..1 and need high precision (Hiyori uses ~8 digits).
      // Deformer-local positions are pixels where 1dp suffices, but extra precision is harmless.
      const posPrecision = rwBox ? 6 : 1;
      x.sub(artForm, 'float-array', { 'xs.n': 'positions', count: String(positions.length) }).text =
        positions.map(v => v.toFixed(posPrecision)).join(' ');
    };

    if (pm.hasBakedKeyforms) {
      // Keyforms to prevent interpolation shrinkage
      // Compute baked vertex positions by rotating each vertex around the elbow pivot
      // by angle × boneWeight. Positions match `verts` coord space — that's
      // warp-local 0..1 when mesh is under a rigWarp (RIG_WARP_OVERRIDE_BAKED
      // case for handwear), otherwise deformer-local pixels. The pivot must
      // live in the SAME space or rotation math explodes.
      //
      // Anisotropy matters in warp-local 0..1: x and y scales differ per mesh
      // (rwBox.gridW vs rwBox.gridH). A degree of rotation should look
      // visually like a degree → pre-scale the radial vector by pxPerX/pxPerY
      // (body→canvas units per mesh), rotate, unscale.
      const weights = pm.boneWeights;
      const pivotCanvasX = pm.jointPivotX ?? 0;
      const pivotCanvasY = pm.jointPivotY ?? 0;
      let pivotLocalX, pivotLocalY, scaleX = 1, scaleY = 1;
      if (rwBox) {
        pivotLocalX = (pivotCanvasX - rwBox.gridMinX) / rwBox.gridW;
        pivotLocalY = (pivotCanvasY - rwBox.gridMinY) / rwBox.gridH;
        scaleX = rwBox.gridW;  // 1 warp-local x unit == gridW canvas pixels
        scaleY = rwBox.gridH;
      } else {
        pivotLocalX = dfOrigin ? (pivotCanvasX - dfOrigin.x) : pivotCanvasX;
        pivotLocalY = dfOrigin ? (pivotCanvasY - dfOrigin.y) : pivotCanvasY;
      }

      const computeBakedPositions = (angleDeg) => {
        const positions = new Array(verts.length);
        for (let i = 0; i < numVerts; i++) {
          const localX = verts[i * 2];
          const localY = verts[i * 2 + 1];
          const w = weights[i] ?? 0;
          const rad = angleDeg * w * Math.PI / 180;
          // Scale radial offset to canvas pixels → rotate → unscale. For
          // non-rwBox (pixel space) scaleX = scaleY = 1 so this collapses to
          // the standard rotation.
          const dx = (localX - pivotLocalX) * scaleX;
          const dy = (localY - pivotLocalY) * scaleY;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          positions[i * 2]     = pivotLocalX + (dx * cos - dy * sin) / scaleX;
          positions[i * 2 + 1] = pivotLocalY + (dx * sin + dy * cos) / scaleY;
        }
        return positions;
      };

      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: String(BAKED_ANGLES.length) });
      const _bonePm = boneParamGuids.get(jointBoneId);
      if (_bonePm) {
        artBindings.push({
          parameterId: _bonePm.paramId,
          keys: BAKED_ANGLES.slice(),
          interpolation: 'LINEAR',
        });
      }
      for (let i = 0; i < BAKED_ANGLES.length; i++) {
        const ang = BAKED_ANGLES[i];
        const pidForm = pm.bakedFormGuids[i];
        const positions = (ang === 0) ? verts : computeBakedPositions(ang);
        emitArtMeshForm(kfList, pidForm, positions);
        if (_bonePm) {
          // rigSpec parent fell back to root (arm group has no deformer) →
          // re-encode pivot-relative verts back to canvas-px for chainEval.
          let rigPositions = positions;
          if (bakedReencodeToCanvas) {
            const reenc = new Array(positions.length);
            for (let pi = 0; pi < positions.length; pi += 2) {
              reenc[pi]     = positions[pi]     + dfOrigin.x;
              reenc[pi + 1] = positions[pi + 1] + dfOrigin.y;
            }
            rigPositions = reenc;
          }
          artKeyforms.push({
            keyTuple: [ang],
            vertexPositions: new Float32Array(rigPositions),
            opacity: 1.0,
          });
        }
      }
    } else if (pm.hasEyelidClosure || pm.hasEyeVariantCompound) {
      // Eye closure — shared geometry computation for standalone closure
      // and compound 2D grid. `pm.myClosureCurve` is base's parabola for
      // base meshes and variant's OWN parabola for variants (never shared).
      // `eyelashMeshBboxPerSide` is the base lash bbox; for variants we
      // compute bbox from the variant's own verts.
      const meshTag = meshes[pm.mi].tag;
      const isEyelash = meshTag === 'eyelash-l' || meshTag === 'eyelash-r';
      const lashBbox = pm.isVariant
        ? (isEyelash ? bboxFromVertsY(meshes[pm.mi].vertices) : null)
        : eyelashMeshBboxPerSide.get(pm.closureSide);
      const bandFallback = eyelashBandCanvas.get(pm.closureSide); // base-side sampled curve as fallback only
      const shiftPx = eyelashShiftCanvas.get(pm.closureSide) ?? 0;
      const closedVerts = computeClosedVertsForMesh({
        curve: pm.myClosureCurve,
        bandCurveFallback: pm.isVariant ? null : bandFallback,
        isEyelash, lashBbox,
        canvasVerts, numVerts,
        rwBox, dfOrigin, shiftPx,
        lashStripFrac: EYE_CLOSURE_LASH_STRIP_FRAC,
      });
      if (rigDebugLog && EYE_PART_TAGS && EYE_PART_TAGS.has(meshTag)) {
        if (!rigDebugLog.perVertexClosure) rigDebugLog.perVertexClosure = [];
        const sampleIndices = numVerts > 0 ? [0, Math.floor(numVerts / 2), numVerts - 1] : [];
        const samples = sampleIndices.map(vi => ({
          vertexIndex: vi,
          restCanvasXY: [canvasVerts[vi * 2], canvasVerts[vi * 2 + 1]],
          closedLocalXY: [closedVerts[vi * 2], closedVerts[vi * 2 + 1]],
        }));
        rigDebugLog.perVertexClosure.push({
          tag: meshTag, partId: pm.partId, closureSide: pm.closureSide,
          isEyelash, isVariant: pm.isVariant,
          branch: pm.hasEyeVariantCompound ? 'compound-2d' : 'standalone-1d',
          rwBox: rwBox ?? null, dfOrigin: dfOrigin ?? null,
          totalVertexCount: numVerts, samples,
        });
      }
      if (pm.hasEyeVariantCompound) {
        // 4 corners: row-major (closure, variant) matching cornersOrder above.
        // Base eye: alpha=1 at variant=0, 0 at variant=1. Variant eye: reverse.
        const αN = pm.isVariant ? 0 : 1;
        const αV = pm.isVariant ? 1 : 0;
        const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '4' });
        emitArtMeshForm(kfList, pm.pidCornerClosedNeutral, closedVerts, αN);
        emitArtMeshForm(kfList, pm.pidCornerOpenNeutral,   verts,       αN);
        emitArtMeshForm(kfList, pm.pidCornerClosedVariant, closedVerts, αV);
        emitArtMeshForm(kfList, pm.pidCornerOpenVariant,   verts,       αV);

        const closureParamIdStr = pm.closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';
        const sfxLocal = pm.isVariant ? pm.variantSuffixForMesh : pm.baseFadeSuffix;
        const variantParamIdStr = sfxLocal ? variantParamId(sfxLocal) : null;
        if (variantParamIdStr) {
          artBindings.push({ parameterId: closureParamIdStr, keys: [0, 1], interpolation: 'LINEAR' });
          artBindings.push({ parameterId: variantParamIdStr, keys: [0, 1], interpolation: 'LINEAR' });
          artKeyforms.push({ keyTuple: [0, 0], vertexPositions: new Float32Array(closedVerts), opacity: αN });
          artKeyforms.push({ keyTuple: [1, 0], vertexPositions: new Float32Array(verts),       opacity: αN });
          artKeyforms.push({ keyTuple: [0, 1], vertexPositions: new Float32Array(closedVerts), opacity: αV });
          artKeyforms.push({ keyTuple: [1, 1], vertexPositions: new Float32Array(verts),       opacity: αV });
        }
      } else {
        // Standalone 1D closure: 2 keyforms [closed, open].
        const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '2' });
        emitArtMeshForm(kfList, pm.pidFormClosed, closedVerts);
        emitArtMeshForm(kfList, pm.pidFormMesh,   verts);

        const closureParamIdStr = pm.closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';
        artBindings.push({ parameterId: closureParamIdStr, keys: [0, 1], interpolation: 'LINEAR' });
        artKeyforms.push({ keyTuple: [0], vertexPositions: new Float32Array(closedVerts), opacity: 1.0 });
        artKeyforms.push({ keyTuple: [1], vertexPositions: new Float32Array(verts),       opacity: 1.0 });
      }
    } else if (pm.hasNeckCornerShapekeys) {
      // 3 keyforms on ParamAngleX: −30 (keyIndex 0), 0 rest (1), +30 (2).
      // Each vertex gets a "cornerness" weight — product of an X-edge factor
      // (1 at left/right edge, 0 at horizontal center) × a top-edge factor
      // (1 at top, 0 at mid/bottom). Peaks at the two top corners, zero
      // elsewhere. Bottom row stays pinned at the shoulders; middle of the
      // top edge stays aligned with the neck center; only the corner region
      // follows the head horizontally.
      //
      // Shift at ±30: `sign * NECK_CORNER_TILT_FRAC * neckW * cornerness`
      // in canvas pixels, then converted into the same space as `verts`
      // (warp-local 0..1 if rwBox, else deformer-local offsets, else canvas).
      const NECK_CORNER_TILT_FRAC = 0.05;
      // Plateau thresholds on normalized distance from center-X / bottom-Y
      // (both range 0..1, peak=1 at corners). A vertex at d ≥ plateau gets
      // full-strength shift; below plateau the shift falls via smoothstep
      // (S-curve, zero derivative at both endpoints → no visible "stroke"
      // at the zone boundary). HIGHER plateau value → NARROWER full-strength
      // zone (the vertex must be closer to a corner to hit the plateau).
      const NECK_X_PLATEAU = 0.7; // outer ≤15% from each side at full shift
      const NECK_Y_PLATEAU = 0.7; // top ≤30% at full shift (then smooth fade)
      const smoothstep = (t) => t * t * (3 - 2 * t); // 0..1, flat at both ends
      let nMinX = Infinity, nMinY = Infinity, nMaxX = -Infinity, nMaxY = -Infinity;
      for (let i = 0; i < numVerts; i++) {
        const vx = canvasVerts[i * 2];
        const vy = canvasVerts[i * 2 + 1];
        if (vx < nMinX) nMinX = vx;
        if (vx > nMaxX) nMaxX = vx;
        if (vy < nMinY) nMinY = vy;
        if (vy > nMaxY) nMaxY = vy;
      }
      const nW = nMaxX - nMinX;
      const nH = nMaxY - nMinY;
      const shiftedCanvas = (sign) => {
        const out = new Array(canvasVerts.length);
        for (let i = 0; i < numVerts; i++) {
          const vx = canvasVerts[i * 2];
          const vy = canvasVerts[i * 2 + 1];
          const relX = nW > 0 ? (vx - nMinX) / nW : 0.5;
          const relY = nH > 0 ? (vy - nMinY) / nH : 0.5;
          // dX: distance from center X, 0..1 (1 at edges)
          // dY: distance from bottom, 0..1 (1 at top)
          const dX = Math.abs(2 * relX - 1);
          const dY = Math.max(0, 1 - relY);
          // Plateau at ≥threshold, smoothstep fade below it
          const tx = dX >= NECK_X_PLATEAU ? 1 : dX / NECK_X_PLATEAU;
          const ty = dY >= NECK_Y_PLATEAU ? 1 : dY / NECK_Y_PLATEAU;
          const cornerness = smoothstep(tx) * smoothstep(ty);
          out[i * 2]     = vx + sign * NECK_CORNER_TILT_FRAC * nW * cornerness;
          out[i * 2 + 1] = vy;
        }
        return out;
      };
      const toLocal = (canvasArr) => {
        if (rwBox) {
          return canvasArr.map((v, i) =>
            i % 2 === 0
              ? (v - rwBox.gridMinX) / rwBox.gridW
              : (v - rwBox.gridMinY) / rwBox.gridH
          );
        }
        if (dfOrigin) {
          return canvasArr.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y));
        }
        return canvasArr;
      };
      const negVerts = toLocal(shiftedCanvas(-1));
      const posVerts = toLocal(shiftedCanvas(+1));
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '3' });
      emitArtMeshForm(kfList, pm.neckCornerFormGuids[0], negVerts); // −30
      emitArtMeshForm(kfList, pm.pidFormMesh, verts);                //   0 (rest)
      emitArtMeshForm(kfList, pm.neckCornerFormGuids[1], posVerts); // +30

      artBindings.push({ parameterId: 'ParamAngleX', keys: [-30, 0, 30], interpolation: 'LINEAR' });
      artKeyforms.push({ keyTuple: [-30], vertexPositions: new Float32Array(negVerts), opacity: 1.0 });
      artKeyforms.push({ keyTuple: [0],   vertexPositions: new Float32Array(verts),    opacity: 1.0 });
      artKeyforms.push({ keyTuple: [30],  vertexPositions: new Float32Array(posVerts), opacity: 1.0 });
    } else if (pm.hasEmotionVariantOnly) {
      // 2 forms matching 2 keyforms on ParamSmile — simple 0→1 opacity fade.
      //   [0] Smile=0 : hidden (opacity 0) — variant fully transparent
      //   [1] Smile=1 : visible (opacity 1) — variant fully covers base
      // Base mesh is driven separately by `hasBaseFadeOnly` below (if it has
      // this variant as a sibling) — stays at opacity 1 for essentially
      // the whole range and snaps to 0 at Smile=1.
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '2' });
      emitArtMeshForm(kfList, pm.pidFormMesh,    verts, 0.0); // keyIndex 0: hidden
      emitArtMeshForm(kfList, pm.pidFormVariant, verts, 1.0); // keyIndex 1: visible

      const sfx = pm.variantSuffixForMesh;
      if (sfx) {
        artBindings.push({ parameterId: variantParamId(sfx), keys: [0, 1], interpolation: 'LINEAR' });
        artKeyforms.push({ keyTuple: [0], vertexPositions: new Float32Array(verts), opacity: 0.0 });
        artKeyforms.push({ keyTuple: [1], vertexPositions: new Float32Array(verts), opacity: 1.0 });
      }
    } else if (pm.hasBaseFadeOnly) {
      // 2 forms matching the 2-keyform linear fade on Param<Suffix>:
      //   [0] Smile=0 : opacity 1 (fully visible at rest)
      //   [1] Smile=1 : opacity 0 (fully gone — variant has taken over)
      // Same base geometry at both keyforms; only opacity differs.
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '2' });
      emitArtMeshForm(kfList, pm.pidFormMesh,       verts, 1.0); // keyIndex 0
      emitArtMeshForm(kfList, pm.pidFormBaseHidden, verts, 0.0); // keyIndex 1

      const sfx = pm.baseFadeSuffix;
      if (sfx) {
        artBindings.push({ parameterId: variantParamId(sfx), keys: [0, 1], interpolation: 'LINEAR' });
        artKeyforms.push({ keyTuple: [0], vertexPositions: new Float32Array(verts), opacity: 1.0 });
        artKeyforms.push({ keyTuple: [1], vertexPositions: new Float32Array(verts), opacity: 0.0 });
      }
    } else {
      // Single keyform at rest position
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '1' });
      emitArtMeshForm(kfList, pm.pidFormMesh, verts);

      // Default: 1-keyform plan on ParamOpacity[1.0] — mirrors moc3writer's
      // per-mesh default (`meshBindingPlan` line ~624).
      artBindings.push({ parameterId: 'ParamOpacity', keys: [1.0], interpolation: 'LINEAR' });
      artKeyforms.push({ keyTuple: [1.0], vertexPositions: new Float32Array(verts), opacity: 1.0 });
    }

    // v2 R1.b — push the captured spec into the rigCollector so the editor
    // RigSpec cache (`useRigSpecStore`) sees art-mesh keyforms in the same
    // run that already produces warpDeformers + rotationDeformers.
    if (rigCollector) {
      rigCollector.artMeshes.push({
        id: pm.partId,
        name: pm.meshName,
        parent: artParent,
        verticesCanvas: new Float32Array(canvasVerts),
        triangles: new Uint16Array(tris),
        uvs: new Float32Array(uvs),
        variantSuffix: meshes[pm.mi].variantSuffix ?? meshes[pm.mi].variantRole ?? null,
        textureId: pm.partId,
        bindings: artBindings,
        keyforms: artKeyforms,
        drawOrder: pm.drawOrder,
        localFrame: artLocalFrame,
        isVisible: true,
        // R7 — populated when this mesh is the *masked* side of a clip pair.
        // Empty array when no mask applies. scenePass + future moc3 runtime
        // can iterate without a presence check.
        maskMeshIds: maskMeshIdsByPartId.get(pm.partId) ?? [],
      });
    }

    // Base pixel-space positions — in CANVAS space (used for texture mapping)
    x.sub(meshSrc, 'float-array', { 'xs.n': 'positions', count: String(canvasVerts.length) }).text =
      canvasVerts.map(v => v.toFixed(1)).join(' ');

    // UVs
    x.sub(meshSrc, 'float-array', { 'xs.n': 'uvs', count: String(uvs.length) }).text =
      uvs.map(v => v.toFixed(6)).join(' ');
    x.subRef(meshSrc, 'GTexture2D', pm.pidTex2d, { 'xs.n': 'texture' });
    x.sub(meshSrc, 'ColorComposition', { 'xs.n': 'colorComposition', v: 'NORMAL' });
    x.sub(meshSrc, 'b', { 'xs.n': 'culling' }).text = 'false';
    x.sub(meshSrc, 'TextureState', { 'xs.n': 'textureState', v: 'MODEL_IMAGE' });
    x.sub(meshSrc, 's', { 'xs.n': 'userData' }).text = '';
  }

  // ── rigOnly short-circuit ──
  // Runtime path (`exportLive2D`) and v2 R1 (`useRigSpecStore.buildRigSpec`)
  // call generateCmo3 in rigOnly mode just to harvest the RigSpec — neither
  // needs the cmo3 buffer or CAFF packing. Moved here (post-Section 4) so
  // `rigCollector.artMeshes` is populated by the per-mesh loop before
  // returning. Section 4's XML emission is wasted work in this mode but
  // it's only a one-shot Initialize-Rig click, not a hot path.
  if (rigOnly) {
    return {
      cmo3: null,
      deformerParamMap,
      rigDebugLog,
      rigSpec: rigCollector,
    };
  }

  // ==================================================================
  // 5. CModelImageGroup (contains inline CModelImage per mesh)
  // ==================================================================
  // Logic in `cmo3/modelImageGroup.js`. Returns the group's pid for
  // CTextureManager wiring in section 6.
  const { pidImgGrp } = emitModelImageGroup(x, {
    perMesh, pidLiGuid,
    pidFvidMiGuid, pidFvidMiLayer,
    canvasW, canvasH,
  });

  // ==================================================================
  // 6. BUILD main.xml
  // ==================================================================
  // Logic in `cmo3/mainXmlBuilder.js`. Returns the populated <root>
  // element ready for serialization in section 7.
  const root = buildMainXml(x, {
    paramDefs, pidParamGroupGuid, pidModelGuid, modelName,
    canvasW, canvasH, pidLi, pidImgGrp,
    meshes, meshSrcIds,
    allDeformerSources,
    allPartSources, rootPart,
    generatePhysics, physicsRules, physicsDisabledCategories, rigDebugLog,
  });
  // ==================================================================
  // 7. SERIALIZE + PACK INTO CAFF
  // ==================================================================

  const xmlStr = x.serialize(root, VERSION_PIS, IMPORT_PIS);
  const xmlBytes = new TextEncoder().encode(xmlStr);

  const cmo3 = await packCmo3({
    xmlBytes, perMesh, meshes, canvasW, canvasH,
  });
  return { cmo3, deformerParamMap, rigDebugLog, rigSpec: rigCollector };
}
