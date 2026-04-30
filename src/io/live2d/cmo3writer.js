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
import { emptyRigSpec } from './rig/rigSpec.js';
import { buildBodyWarpChain } from './rig/bodyWarp.js';
import { buildGroupRotationSpec } from './rig/rotationDeformers.js';
import { buildTagBindingMap } from './rig/tagWarpBindings.js';
import { VERSION_PIS, IMPORT_PIS } from './cmo3/constants.js';
import {
  emitKfBinding,
  emitSingleParamKfGrid,
  emitStructuralWarp,
} from './cmo3/deformerEmit.js';
import { emitNeckWarp, emitFaceRotation } from './cmo3/bodyRig.js';
import { emitFaceParallax } from './cmo3/faceParallax.js';
import { emitPhysicsSettings } from './cmo3/physics.js';
import {
  RIG_WARP_TAGS,
  FACE_PARALLAX_TAGS,
  FACE_PARALLAX_DEPTH,
  NECK_WARP_TAGS,
} from './cmo3/rigWarpTags.js';
import { CATEGORY_DEFS, categorizeParam } from './cmo3/paramCategories.js';
import { computeGroupWorldMatrices } from './cmo3/groupWorldMatrices.js';
import { fitParabolaFromLowerEdge } from './cmo3/eyeClosureFit.js';
import {
  evalClosureCurve,
  computeClosedCanvasVerts,
  computeClosedVertsForMesh,
} from './cmo3/eyeClosureApply.js';
import { setupGlobalSharedObjects } from './cmo3/globalSetup.js';
import { emitModelImageGroup } from './cmo3/modelImageGroup.js';
import { packCmo3 } from './cmo3/caffPack.js';
import { buildMainXml } from './cmo3/mainXmlBuilder.js';
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

  // ── Phase 0 diagnostic log (only populated when generateRig is on) ──
  // Emitted as `{modelName}.rig.log.json` alongside the .cmo3 in the export zip.
  // Pure capture — no behavior changes. See docs/live2d-export/AUTO_RIG_PLAN.md.
  const rigDebugLog = generateRig ? {
    version: 1,
    timestamp: new Date().toISOString(),
    modelName,
    canvas: { W: canvasW, H: canvasH },
    meshSummary: [],
    tagCoverage: null,
    body: null,
    faceUnion: null,
    facePivot: null,
    neckUnion: null,
    neckWarp: null,
    faceParallax: null,
    eyeClosureContexts: [],
    params: {},
    warnings: [],
  } : null;

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

  const x = new XmlBuilder();

  // ── RigSpec collector ──
  // Single source of truth for every rig element emitted below. Both this
  // writer and moc3writer consume the resulting RigSpec — cmo3 translates
  // it to XML, moc3 translates it to binary. Collector is built up as each
  // emit* helper runs; final value is returned alongside the cmo3 buffer.
  const rigCollector = emptyRigSpec({ w: canvasW, h: canvasH });

  // ==================================================================
  // 1. GLOBAL SHARED OBJECTS (used by all meshes)
  // ==================================================================
  // Setup lives in `cmo3/globalSetup.js`. Returns a bundle of pids +
  // shared XML element refs consumed by sections 2-6 below.
  const _globals = setupGlobalSharedObjects(x, {
    parameters, meshes, groups,
    generateRig, bakedKeyformAngles, rotationDeformerConfig,
  });
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
  const {
    pidFvidIlfOutput, pidFvidMiLayer, pidFvidIlfInput, pidFvidMiGuid,
    pidFvidIlfGuid, pidFvidMiOutImg, pidFvidMiOutXfm, pidFvidIlfInLayer,
  } = filterValueIds;
  const {
    pidFvSel, pidFvImp, pidFvImpSel, pidFvCurGuid, pidFvSelGuid,
    pidFvOutImg, pidFvOutImgRes, pidFvOutXfm, pidFvOutXfm2,
  } = filterValues;
  // ==================================================================
  // 2. SHARED PSD (one CLayeredImage with N layers)
  // ==================================================================
  // Session 4 finding: Editor requires ONE CLayeredImage ("PSD") with N CLayers.
  // N separate CLayeredImages = geometry renders but NO textures.

  const [, pidLiGuid] = x.shared('CLayeredImageGuid', { uuid: uuid(), note: 'fakepsd' });
  const [layeredImg, pidLi] = x.shared('CLayeredImage');
  const [layerGroup, pidLg] = x.shared('CLayerGroup');

  const perMesh = [];
  const layerRefs = []; // [{pidLayer, pidImg}] for building CLayerGroup/CLayeredImage after loop

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

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    const meshName = m.name;
    const meshId = `ArtMesh${mi}`;

    // Per-mesh GUIDs. `pidFormMesh` is allocated later (after the compound-
    // variant gate is known) so meshes entering the 2D compound branch
    // don't leave an orphaned CFormGuid in the shared catalog.
    const [, pidDrawable] = x.shared('CDrawableGuid', { uuid: uuid(), note: meshName });
    const [, pidMiGuid] = x.shared('CModelImageGuid', { uuid: uuid(), note: `modelimg${mi}` });
    const [, pidTexGuid] = x.shared('GTextureGuid', { uuid: uuid(), note: `tex${mi}` });
    const [, pidExtMesh] = x.shared('CExtensionGuid', { uuid: uuid(), note: `mesh_ext${mi}` });
    const [, pidExtTex] = x.shared('CExtensionGuid', { uuid: uuid(), note: `tex_ext${mi}` });
    const [, pidEmesh] = x.shared('GEditableMeshGuid', { uuid: uuid(), note: `editmesh${mi}` });

    const pngPath = `imageFileBuf_${mi}.png`;

    // CImageResource (canvas-sized — matches CLayeredImage dimensions)
    const [imgRes, pidImg] = x.shared('CImageResource', {
      width: String(canvasW), height: String(canvasH), type: 'INT_ARGB',
      imageFileBuf_size: String(m.pngData.length),
      previewFileBuf_size: '0',
    });
    x.sub(imgRes, 'file', { 'xs.n': 'imageFileBuf', path: pngPath });

    // CLayer (per-mesh, inside shared CLayerGroup)
    const [layer, pidLayer] = x.shared('CLayer');
    layerRefs.push({ pidLayer, pidImg });

    const acil = x.sub(layer, 'ACImageLayer', { 'xs.n': 'super' });
    const ale = x.sub(acil, 'ACLayerEntry', { 'xs.n': 'super' });
    x.sub(ale, 's', { 'xs.n': 'name' }).text = meshName;
    x.sub(ale, 's', { 'xs.n': 'memo' }).text = '';
    x.sub(ale, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(ale, 'b', { 'xs.n': 'isClipping' }).text = 'false';
    x.subRef(ale, 'CBlend_Normal', pidBlend, { 'xs.n': 'blend' });
    x.sub(ale, 'CLayerGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
    x.subRef(ale, 'CLayerGroup', pidLg, { 'xs.n': 'group' });
    x.sub(ale, 'i', { 'xs.n': 'opacity255' }).text = '255';
    x.sub(ale, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });
    x.subRef(ale, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
    x.subRef(layer, 'CImageResource', pidImg, { 'xs.n': 'imageResource' });
    const bounds = x.sub(layer, 'CRect', { 'xs.n': 'boundsOnImageDoc' });
    x.sub(bounds, 'i', { 'xs.n': 'x' }).text = '0';
    x.sub(bounds, 'i', { 'xs.n': 'y' }).text = '0';
    x.sub(bounds, 'i', { 'xs.n': 'width' }).text = String(canvasW);
    x.sub(bounds, 'i', { 'xs.n': 'height' }).text = String(canvasH);
    const lid = x.sub(layer, 'CLayerIdentifier', { 'xs.n': 'layerIdentifier' });
    x.sub(lid, 's', { 'xs.n': 'layerName' }).text = meshName;
    x.sub(lid, 's', { 'xs.n': 'layerId' }).text = `00-00-00-${String(mi + 1).padStart(2, '0')}`;
    x.sub(lid, 'i', { 'xs.n': 'layerIdValue_testImpl' }).text = String(mi + 1);
    x.sub(layer, 'null', { 'xs.n': 'icon16' });
    x.sub(layer, 'null', { 'xs.n': 'icon64' });
    x.sub(layer, 'linked_map', { 'xs.n': 'layerInfo', count: '0', keyType: 'string' });
    x.sub(layer, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });

    // FILTER GRAPH (per-mesh)
    const [filterSet, pidFset] = x.shared('ModelImageFilterSet');
    const [, pidFiid0] = x.shared('FilterInstanceId', { idstr: `filter0_${mi}` });
    const [fiSelector, pidFiSel] = x.shared('FilterInstance', { filterName: 'CLayerSelector' });
    const [foutConn, pidFout] = x.shared('FilterOutputValueConnector');
    const [, pidFiid1] = x.shared('FilterInstanceId', { idstr: `filter1_${mi}` });
    const [fiFilter, pidFiFlt] = x.shared('FilterInstance', { filterName: 'CLayerFilter' });

    // FilterOutputValueConnector
    x.sub(foutConn, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(foutConn, 'FilterInstance', pidFiSel, { 'xs.n': 'instance' });
    x.subRef(foutConn, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'id' });
    x.subRef(foutConn, 'FilterValue', pidFvSel, { 'xs.n': 'valueDef' });

    // FilterInstance: CLayerSelector
    x.subRef(fiSelector, 'StaticFilterDefGuid', pidFdefSel, { 'xs.n': 'filterDefGuid' });
    x.sub(fiSelector, 'null', { 'xs.n': 'filterDef' });
    x.subRef(fiSelector, 'FilterInstanceId', pidFiid0, { 'xs.n': 'filterId' });
    const icSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'inputConnectors', count: '2' });
    const e1 = x.sub(icSel, 'entry');
    x.subRef(e1, 'FilterValueId', pidFvidIlfInput, { 'xs.n': 'key' });
    const evc1 = x.sub(e1, 'EnvValueConnector', { 'xs.n': 'value' });
    x.sub(evc1, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(evc1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'envValueId' });
    const e2 = x.sub(icSel, 'entry');
    x.subRef(e2, 'FilterValueId', pidFvidIlfGuid, { 'xs.n': 'key' });
    const evc2 = x.sub(e2, 'EnvValueConnector', { 'xs.n': 'value' });
    x.sub(evc2, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(evc2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'envValueId' });
    const ocSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'outputConnectors', count: '1' });
    const e3 = x.sub(ocSel, 'entry');
    x.subRef(e3, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'key' });
    x.subRef(e3, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
    x.subRef(fiSelector, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

    // FilterInstance: CLayerFilter
    x.subRef(fiFilter, 'StaticFilterDefGuid', pidFdefFlt, { 'xs.n': 'filterDefGuid' });
    x.sub(fiFilter, 'null', { 'xs.n': 'filterDef' });
    x.subRef(fiFilter, 'FilterInstanceId', pidFiid1, { 'xs.n': 'filterId' });
    const icFlt = x.sub(fiFilter, 'hash_map', { 'xs.n': 'inputConnectors', count: '1' });
    const e4 = x.sub(icFlt, 'entry');
    x.subRef(e4, 'FilterValueId', pidFvidIlfInLayer, { 'xs.n': 'key' });
    x.subRef(e4, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
    x.sub(fiFilter, 'hash_map', { 'xs.n': 'outputConnectors', count: '0', keyType: 'string' });
    x.subRef(fiFilter, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

    // Fill ModelImageFilterSet
    const fsSuper = x.sub(filterSet, 'FilterSet', { 'xs.n': 'super' });
    const fm = x.sub(fsSuper, 'linked_map', { 'xs.n': 'filterMap', count: '2' });
    const fmE1 = x.sub(fm, 'entry');
    x.subRef(fmE1, 'FilterInstanceId', pidFiid0, { 'xs.n': 'key' });
    x.subRef(fmE1, 'FilterInstance', pidFiSel, { 'xs.n': 'value' });
    const fmE2 = x.sub(fm, 'entry');
    x.subRef(fmE2, 'FilterInstanceId', pidFiid1, { 'xs.n': 'key' });
    x.subRef(fmE2, 'FilterInstance', pidFiFlt, { 'xs.n': 'value' });
    // _externalInputs
    const ei = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalInputs', count: '2' });
    const eiE1 = x.sub(ei, 'entry');
    x.subRef(eiE1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'key' });
    const ec1 = x.sub(eiE1, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec1, 'FilterValue', pidFvImp, { 'xs.n': '_envValueDef' });
    x.subRef(ec1, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
    x.subRef(ec1, 'FilterValue', pidFvImpSel, { 'xs.n': 'filterValueDef' });
    const eiE2 = x.sub(ei, 'entry');
    x.subRef(eiE2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'key' });
    const ec2 = x.sub(eiE2, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec2, 'FilterValue', pidFvCurGuid, { 'xs.n': '_envValueDef' });
    x.subRef(ec2, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
    x.subRef(ec2, 'FilterValue', pidFvSelGuid, { 'xs.n': 'filterValueDef' });
    // _externalOutputs
    const eo = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalOutputs', count: '2' });
    const eoE1 = x.sub(eo, 'entry');
    x.subRef(eoE1, 'FilterValueId', pidFvidMiOutImg, { 'xs.n': 'key' });
    const ec3 = x.sub(eoE1, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec3, 'FilterValue', pidFvOutImg, { 'xs.n': '_envValueDef' });
    x.subRef(ec3, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
    x.subRef(ec3, 'FilterValue', pidFvOutImgRes, { 'xs.n': 'filterValueDef' });
    const eoE2 = x.sub(eo, 'entry');
    x.subRef(eoE2, 'FilterValueId', pidFvidMiOutXfm, { 'xs.n': 'key' });
    const ec4 = x.sub(eoE2, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec4, 'FilterValue', pidFvOutXfm, { 'xs.n': '_envValueDef' });
    x.subRef(ec4, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
    x.subRef(ec4, 'FilterValue', pidFvOutXfm2, { 'xs.n': 'filterValueDef' });

    // GTexture2D
    const [tex2d, pidTex2d] = x.shared('GTexture2D');
    const gtex = x.sub(tex2d, 'GTexture', { 'xs.n': 'super' });
    x.sub(gtex, 's', { 'xs.n': 'name' }).text = meshName;
    x.sub(gtex, 'WrapMode', { 'xs.n': 'wrapMode', v: 'CLAMP_TO_BORDER' });
    const fmTex = x.sub(gtex, 'FilterMode', { 'xs.n': 'filterMode' });
    x.subRef(fmTex, 'GTexture2D', pidTex2d, { 'xs.n': 'owner' });
    x.sub(fmTex, 'MinFilter', { 'xs.n': 'minFilter', v: 'LINEAR_MIPMAP_LINEAR' });
    x.sub(fmTex, 'MagFilter', { 'xs.n': 'magFilter', v: 'LINEAR' });
    x.subRef(gtex, 'GTextureGuid', pidTexGuid, { 'xs.n': 'guid' });
    x.sub(gtex, 'Anisotropy', { 'xs.n': 'anisotropy', v: 'ON' });
    x.subRef(tex2d, 'CImageResource', pidImg, { 'xs.n': 'srcImageResource' });
    x.sub(tex2d, 'CAffine', {
      'xs.n': 'transformImageResource01toLogical01',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(tex2d, 'i', { 'xs.n': 'mipmapLevel' }).text = '1';
    x.sub(tex2d, 'b', { 'xs.n': 'isPremultiplied' }).text = 'true';

    // CTextureInputExtension + CTextureInput_ModelImage
    const [texInputExt, pidTie] = x.shared('CTextureInputExtension');
    const [texInputMi, pidTimi] = x.shared('CTextureInput_ModelImage');

    const ati = x.sub(texInputMi, 'ACTextureInput', { 'xs.n': 'super' });
    x.sub(ati, 'CAffine', {
      'xs.n': 'optionalTransformOnCanvas',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.subRef(ati, 'CTextureInputExtension', pidTie, { 'xs.n': '_owner' });
    x.subRef(texInputMi, 'CModelImageGuid', pidMiGuid, { 'xs.n': '_modelImageGuid' });

    const tieSup = x.sub(texInputExt, 'ACExtension', { 'xs.n': 'super' });
    x.subRef(tieSup, 'CExtensionGuid', pidExtTex, { 'xs.n': 'guid' });
    // _owner placeholder — will be set when mesh is created
    const tieInputs = x.sub(texInputExt, 'carray_list', { 'xs.n': '_textureInputs', count: '1' });
    x.subRef(tieInputs, 'CTextureInput_ModelImage', pidTimi);
    x.subRef(texInputExt, 'CTextureInput_ModelImage', pidTimi, { 'xs.n': 'currentTextureInputData' });

    // Keyform system — baked bone-weight keyforms for meshes with boneWeights,
    // eyelash-l uses per-vertex closure keyforms (Session 17),
    // otherwise single keyform bound to ParamOpacity (existing behavior)
    const hasBakedKeyforms = !!(m.boneWeights && m.jointBoneId && boneParamGuids.has(m.jointBoneId));
    // Session 17: per-eye closure via per-vertex CArtMeshForm keyforms.
    // Eyelash/eyewhite/irides (both sides) all collapse to their side's eyelash band.
    // Bypasses warp-grid coarseness — bottom contour truly stays static.
    // Stage 5: closureTags resolved from `project.eyeClosureConfig` via the
    // input arg above.
    const EYE_CLOSURE_TAGS = new Set(_EYE_CLOSURE_TAGS_LIST);
    // Session 36 (2026-04-23): 2D keyform grid for eye variants.
    // Base and variant eye meshes both enter a compound branch
    // (ParamEye{L,R}Open × Param<Suffix>) with 4 corners = 4 unique
    // CFormGuids. No sharing: variant's closure geometry uses the
    // variant's OWN parabola fit (`variantEyewhiteCurvePerSideAndSuffix`),
    // never base's. Variant lash bbox comes from variant's own verts.
    const isVariant = !!m.variantRole;
    const variantSuffixForMesh = m.variantSuffix ?? m.variantRole ?? null;

    // Closure side is now set for BOTH base and variant eye meshes
    // (previously variants were carved out with `!isVariant`).
    const closureSide = EYE_CLOSURE_TAGS.has(m.tag)
      ? (m.tag.endsWith('-l') ? 'l' : 'r') : null;
    const closureParamPid = closureSide === 'l' ? pidParamEyeLOpenEarly
      : closureSide === 'r' ? pidParamEyeROpenEarly : null;
    const myClosureCurve = closureSide === null ? null
      : isVariant
        ? variantEyewhiteCurvePerSideAndSuffix.get(`${closureSide}|${variantSuffixForMesh}`) ?? null
        : eyewhiteCurvePerSide.get(closureSide) ?? null;
    const hasClosureData = myClosureCurve !== null && !!closureParamPid;

    const pidParamForVariant = variantSuffixForMesh
      ? variantParamPidBySuffix.get(variantSuffixForMesh) ?? null
      : null;
    const hasEmotionVariant = !hasBakedKeyforms && isVariant && !!pidParamForVariant;

    const basePartVariantSuffixes = !isVariant
      ? (variantSuffixesByBasePartId.get(m.partId) ?? [])
      : [];
    const baseFadeSuffix = basePartVariantSuffixes[0] ?? null;
    const pidParamForBaseFade = baseFadeSuffix
      ? variantParamPidBySuffix.get(baseFadeSuffix) ?? null
      : null;
    const BACKDROP_TAGS = BACKDROP_TAGS_SET;
    const isBackdrop = BACKDROP_TAGS.has(m.tag);
    const hasBaseFade = !isVariant && !hasBakedKeyforms && !!pidParamForBaseFade && !isBackdrop;

    // Compound 2D gate: eye mesh with BOTH closure data AND a variant axis.
    // Base eye: has a paired variant sibling → fade on Param<Suffix>.
    // Variant eye: has its own Param<Suffix> → fade-in.
    // Either way, the same 2D grid handles blink × variant simultaneously.
    const hasEyeVariantCompound = !hasBakedKeyforms && hasClosureData
      && ((isVariant && hasEmotionVariant) || (!isVariant && hasBaseFade));

    // Standalone 1D branches — gated so compound wins when both could apply.
    const hasEyelidClosure = !isVariant && !hasBakedKeyforms && hasClosureData
      && !hasEyeVariantCompound;
    const hasNeckCornerShapekeys = !isVariant && !hasBakedKeyforms && !hasEyelidClosure
      && !hasEyeVariantCompound
      && generateRig && m.tag === 'neck' && !!pidParamAngleXEarly;
    const hasEmotionVariantOnly = hasEmotionVariant && !hasEyeVariantCompound;
    const hasBaseFadeOnly       = hasBaseFade       && !hasEyeVariantCompound;

    // `kfBinding` is the single KeyformBindingSource used by every 1D branch
    // (closure / neck / emotion / base fade / default). Compound meshes use
    // two *separate* bindings allocated inside their branch instead.
    let kfBinding = null, pidKfb = null;
    if (!hasEyeVariantCompound) {
      [kfBinding, pidKfb] = x.shared('KeyformBindingSource');
    }
    const [kfGridMesh, pidKfgMesh] = x.shared('KeyformGridSource');

    // Extra form GUIDs. Allocated per branch to avoid orphans.
    let pidFormClosed = null;
    let bakedFormGuids = null;
    let neckCornerFormGuids = null;
    let pidFormVariant = null;
    let pidFormBaseHidden = null;
    // Compound's 4 corner guids (only when hasEyeVariantCompound). Each is
    // UNIQUE — never reuses pidFormMesh / pidFormBaseHidden / pidFormVariant
    // from the standalone branches. Names carry semantic meaning for logs.
    let pidCornerOpenNeutral   = null;
    let pidCornerClosedNeutral = null;
    let pidCornerOpenVariant   = null;
    let pidCornerClosedVariant = null;
    // `pidFormMesh` is the standard rest-pose form. Only non-compound
    // branches reference it — skip allocation for compound meshes to
    // avoid orphans in the shared catalog.
    let pidFormMesh = null;
    if (!hasEyeVariantCompound) {
      [, pidFormMesh] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_form` });
    }
    if (hasEyeVariantCompound) {
      const sfx = isVariant ? variantSuffixForMesh : baseFadeSuffix;
      [, pidCornerOpenNeutral]   = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_corner_open_neutral`   });
      [, pidCornerClosedNeutral] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_corner_closed_neutral` });
      [, pidCornerOpenVariant]   = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_corner_open_${sfx}`    });
      [, pidCornerClosedVariant] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_corner_closed_${sfx}`  });
    }
    if (hasEmotionVariantOnly) {
      const [, _pidFv] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_variant` });
      pidFormVariant = _pidFv;
    }
    if (hasBaseFadeOnly) {
      const [, _pidBh] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_base_hidden` });
      pidFormBaseHidden = _pidBh;
    }

    if (hasBakedKeyforms) {
      // Multiple keyforms to reduce linear interpolation shrinkage
      bakedFormGuids = [];
      const boneParam = boneParamGuids.get(m.jointBoneId);

      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(BAKED_ANGLES.length) });

      for (let i = 0; i < BAKED_ANGLES.length; i++) {
        let pidForm;
        if (BAKED_ANGLES[i] === 0) {
          pidForm = pidFormMesh;
        } else {
          const [, _pid] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_baked_${BAKED_ANGLES[i]}` });
          pidForm = _pid;
        }
        bakedFormGuids.push(pidForm);

        const kog = x.sub(kfog, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(i);
        x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
      }

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', boneParam.pidParam, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: String(BAKED_ANGLES.length) });
      for (const ang of BAKED_ANGLES) {
        x.sub(keys, 'f').text = ang.toFixed(1);
      }
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = boneParam.paramId;
    } else if (hasEyelidClosure) {
      // 2 keyforms: closed (k=0), open (k=1, rest). Bound to ParamEye{L,R}Open by side.
      // The mask-artmesh fix for the Cubism warning lives at the WARP level
      // (see TAG_PARAM_BINDINGS entries for eyewhite-l/-r), not at the mesh
      // level, so this branch stays simple.
      const [, _pidFormClosed] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_closed` });
      pidFormClosed = _pidFormClosed;
      const closureParamId = closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';

      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '2' });
      const kog0 = x.sub(kfog, 'KeyformOnGrid');
      const ak0 = x.sub(kog0, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop0 = x.sub(ak0, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon0 = x.sub(kop0, 'KeyOnParameter');
      x.subRef(kon0, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon0, 'i', { 'xs.n': 'keyIndex' }).text = '0';
      x.subRef(kog0, 'CFormGuid', pidFormClosed, { 'xs.n': 'keyformGuid' });
      const kog1 = x.sub(kfog, 'KeyformOnGrid');
      const ak1 = x.sub(kog1, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop1 = x.sub(ak1, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon1 = x.sub(kop1, 'KeyOnParameter');
      x.subRef(kon1, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon1, 'i', { 'xs.n': 'keyIndex' }).text = '1';
      x.subRef(kog1, 'CFormGuid', pidFormMesh, { 'xs.n': 'keyformGuid' });

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', closureParamPid, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '2' });
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = closureParamId;
    } else if (hasNeckCornerShapekeys) {
      // 3 keyforms on ParamAngleX: −30 (keyIndex 0), 0 rest (1), +30 (2).
      // Top-corner-only shapekey to eliminate seam visibility under head yaw.
      const [, pidFormNeg] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_neck_angleX_neg30` });
      const [, pidFormPos] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_neck_angleX_pos30` });
      neckCornerFormGuids = [pidFormNeg, pidFormPos];

      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '3' });
      const angleXForms = [pidFormNeg, pidFormMesh, pidFormPos];
      for (let i = 0; i < 3; i++) {
        const kog = x.sub(kfog, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(i);
        x.subRef(kog, 'CFormGuid', angleXForms[i], { 'xs.n': 'keyformGuid' });
      }

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', pidParamAngleXEarly, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '3' });
      x.sub(keys, 'f').text = '-30.0';
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = '30.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = 'ParamAngleX';
    } else if (hasEyeVariantCompound) {
      // Session 36: 2D keyform grid for eye meshes that have both a blink
      // axis (ParamEye{L,R}Open) AND a variant axis (Param<Suffix>).
      // 4 corners on the (closure, variant) rectangle, each with its own
      // unique CFormGuid and its own (positions, opacity) pair. Row-major
      // over (closureKey, variantKey) — first binding varies fastest per
      // the Hiyori reference convention.
      //
      // Base eye (isVariant=false): alpha=1 at variant=0, alpha=0 at variant=1.
      //   Base's own parabola drives closedVerts; base's own lash bbox for
      //   strip compression. At ParamSmile=1 the base is fully hidden.
      // Variant eye (isVariant=true): alpha=0 at variant=0, alpha=1 at variant=1.
      //   Variant's own parabola (from variantEyewhiteCurvePerSideAndSuffix)
      //   drives closedVerts; variant's own lash bbox. At ParamSmile=0 the
      //   variant is fully hidden. Blink works at every ParamSmile value.
      const [kfBindingClosure, pidKfbClosure] = x.shared('KeyformBindingSource');
      const [kfBindingVariant, pidKfbVariant] = x.shared('KeyformBindingSource');
      const variantParamPid = isVariant ? pidParamForVariant : pidParamForBaseFade;
      const sfxLocal        = isVariant ? variantSuffixForMesh : baseFadeSuffix;
      const variantParamIdStr = variantParamId(sfxLocal);
      const closureParamIdStr = closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';

      // Row-major over (closureKey, variantKey). Matches Hiyori's convention:
      // first binding (closure) varies fastest, second (variant) slowest.
      const cornersOrder = [
        { ck: 0, vk: 0, pidForm: pidCornerClosedNeutral },
        { ck: 1, vk: 0, pidForm: pidCornerOpenNeutral   },
        { ck: 0, vk: 1, pidForm: pidCornerClosedVariant },
        { ck: 1, vk: 1, pidForm: pidCornerOpenVariant   },
      ];
      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '4' });
      for (const { ck, vk, pidForm } of cornersOrder) {
        const kog = x.sub(kfog, 'KeyformOnGrid');
        const ak  = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '2' });
        const konA = x.sub(kop, 'KeyOnParameter');
        x.subRef(konA, 'KeyformBindingSource', pidKfbClosure, { 'xs.n': 'binding' });
        x.sub(konA, 'i', { 'xs.n': 'keyIndex' }).text = String(ck);
        const konB = x.sub(kop, 'KeyOnParameter');
        x.subRef(konB, 'KeyformBindingSource', pidKfbVariant, { 'xs.n': 'binding' });
        x.sub(konB, 'i', { 'xs.n': 'keyIndex' }).text = String(vk);
        x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
      }

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '2' });
      x.subRef(kb, 'KeyformBindingSource', pidKfbClosure);
      x.subRef(kb, 'KeyformBindingSource', pidKfbVariant);

      // Fill the two KeyformBindingSource nodes. They share the same
      // _gridSource (our KeyformGridSource) but have independent params,
      // keys, interpolation and description.
      const fillBinding = (node, paramPid, keys, descriptionStr) => {
        x.subRef(node, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
        x.subRef(node, 'CParameterGuid', paramPid, { 'xs.n': 'parameterGuid' });
        const keysEl = x.sub(node, 'array_list', { 'xs.n': 'keys', count: String(keys.length) });
        for (const k of keys) x.sub(keysEl, 'f').text = k;
        x.sub(node, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
        x.sub(node, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
        x.sub(node, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
        x.sub(node, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
        x.sub(node, 's', { 'xs.n': 'description' }).text = descriptionStr;
      };
      fillBinding(kfBindingClosure, closureParamPid, ['0.0', '1.0'], closureParamIdStr);
      fillBinding(kfBindingVariant, variantParamPid, ['0.0', '1.0'], variantParamIdStr);
    } else if (hasEmotionVariantOnly) {
      // 2 keyforms on ParamSmile — simple 0→1 opacity fade for the variant.
      //   keyIndex 0 at Smile=0  : pidFormMesh, opacity 0 (hidden)
      //   keyIndex 1 at Smile=1  : pidFormVariant, opacity 1 (visible)
      // The base mesh keeps its default opacity=1 single keyform and is
      // always rendered underneath, so at any Smile value the base is
      // fully visible and the variant layers on top with its current
      // interpolated opacity.
      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '2' });
      const emitKog = (keyIndex, formPid) => {
        const kog = x.sub(kfog, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(keyIndex);
        x.subRef(kog, 'CFormGuid', formPid, { 'xs.n': 'keyformGuid' });
      };
      emitKog(0, pidFormMesh);     // Smile=0 → hidden form
      emitKog(1, pidFormVariant);  // Smile=1 → visible form

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      const variantParamIdStr = variantParamId(variantSuffixForMesh);
      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', pidParamForVariant, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '2' });
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = variantParamIdStr;
    } else if (hasBaseFadeOnly) {
      // Base mesh with a variant sibling (and not the face-skin backdrop):
      // 2 keyforms on Param<Suffix> — linear crossfade of the neutral
      // mesh from opacity 1 at 0 to opacity 0 at 1. The face-skin backdrop
      // stays at opacity=1 always, so the alpha composite is solid at
      // every intermediate Param value — no see-through midpoint.
      //   keyIndex 0 at Smile=0 : pidFormMesh,       opacity 1
      //   keyIndex 1 at Smile=1 : pidFormBaseHidden, opacity 0
      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '2' });
      const emitBaseKog = (keyIndex, formPid) => {
        const kog = x.sub(kfog, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(keyIndex);
        x.subRef(kog, 'CFormGuid', formPid, { 'xs.n': 'keyformGuid' });
      };
      emitBaseKog(0, pidFormMesh);
      emitBaseKog(1, pidFormBaseHidden);

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      const baseParamIdStr = variantParamId(baseFadeSuffix);
      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', pidParamForBaseFade, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '2' });
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = baseParamIdStr;
    } else {
      // Standard single keyform bound to ParamOpacity
      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
      const kog = x.sub(kfog, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kopList = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kop = x.sub(kopList, 'KeyOnParameter');
      x.subRef(kop, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kop, 'i', { 'xs.n': 'keyIndex' }).text = '0';
      x.subRef(kog, 'CFormGuid', pidFormMesh, { 'xs.n': 'keyformGuid' });
      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', pidParamOpacity, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '1' });
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = 'ParamOpacity';
    }

    // Mesh-level eye closure: pre-compute closed canvas verts inside the
    // perMesh loop so they're available BEFORE the rigOnly short-circuit
    // (which fires before section 4's XML emit). moc3writer needs these
    // to emit 2 keyforms on ParamEye{L,R}Open with the closed-eye geometry;
    // without them the runtime model has no blink animation at all.
    let closedCanvasVerts = null;
    if (hasClosureData && (hasEyelidClosure || hasEyeVariantCompound)) {
      const isEyelash = m.tag === 'eyelash-l' || m.tag === 'eyelash-r';
      const lashBboxForCompute = isVariant
        ? (isEyelash ? bboxFromVertsY(m.vertices) : null)
        : eyelashMeshBboxPerSide.get(closureSide);
      const bandFallback = isVariant ? null : eyelashBandCanvas.get(closureSide);
      const shiftPx = eyelashShiftCanvas.get(closureSide) ?? 0;
      closedCanvasVerts = computeClosedCanvasVerts({
        curve: myClosureCurve,
        bandCurveFallback: bandFallback,
        isEyelash,
        lashBbox: lashBboxForCompute,
        canvasVerts: m.vertices,
        numVerts: m.vertices.length / 2,
        shiftPx,
        lashStripFrac: EYE_CLOSURE_LASH_STRIP_FRAC,
      });
      if (rigCollector) {
        rigCollector.eyeClosure ??= new Map();
        rigCollector.eyeClosure.set(m.partId, {
          closureSide,
          isVariant,
          variantSuffix: variantSuffixForMesh,
          closedCanvasVerts,
        });
      }
    }

    perMesh.push({
      mi, meshName, meshId, pngPath, drawOrder: m.drawOrder ?? (500 + mi),
      pidDrawable, pidFormMesh, bakedFormGuids, pidFormClosed,
      neckCornerFormGuids, pidFormVariant,
      pidFormBaseHidden,
      // Compound 2D corners (null for non-compound meshes)
      pidCornerOpenNeutral, pidCornerClosedNeutral,
      pidCornerOpenVariant, pidCornerClosedVariant,
      hasEyeVariantCompound,
      isVariant,
      myClosureCurve,
      pidMiGuid, pidTexGuid, pidExtMesh, pidExtTex, pidEmesh,
      pidImg, pidLayer,
      pidFset, pidTex2d, pidTie, pidTimi,
      pidKfb, pidKfgMesh,
      tieSup, hasBakedKeyforms, hasEyelidClosure, closureSide,
      hasNeckCornerShapekeys,
      hasEmotionVariantOnly, hasBaseFadeOnly,
      variantRole: m.variantRole ?? null,
      vertices: m.vertices,
      triangles: m.triangles,
      uvs: m.uvs,
      boneWeights: m.boneWeights,
      jointPivotX: m.jointPivotX,
      jointPivotY: m.jointPivotY,
      closedCanvasVerts, // shared with moc3 via rigCollector.eyeClosure
      // v2 R1.b — captured here so the per-mesh emit loop can populate
      // rigCollector.artMeshes without recomputing variant pairing.
      variantSuffixForMesh,
      baseFadeSuffix,
      partId: m.partId,
    });
  }

  // ==================================================================
  // 2b. FILL SHARED CLayerGroup + CLayeredImage (after all layers created)
  // ==================================================================

  const nLayers = layerRefs.length;

  // CLayerGroup (root containing all layers)
  const alg = x.sub(layerGroup, 'ACLayerGroup', { 'xs.n': 'super' });
  const ale2 = x.sub(alg, 'ACLayerEntry', { 'xs.n': 'super' });
  x.sub(ale2, 's', { 'xs.n': 'name' }).text = 'root';
  x.sub(ale2, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(ale2, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(ale2, 'b', { 'xs.n': 'isClipping' }).text = 'false';
  x.subRef(ale2, 'CBlend_Normal', pidBlend, { 'xs.n': 'blend' });
  x.sub(ale2, 'CLayerGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
  x.sub(ale2, 'null', { 'xs.n': 'group' });
  x.sub(ale2, 'i', { 'xs.n': 'opacity255' }).text = '255';
  x.sub(ale2, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });
  x.subRef(ale2, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const childrenLg = x.sub(alg, 'carray_list', { 'xs.n': '_children', count: String(nLayers) });
  for (const lr of layerRefs) x.subRef(childrenLg, 'CLayer', lr.pidLayer);
  x.sub(layerGroup, 'null', { 'xs.n': 'layerIdentifier' });

  // CLayeredImage (single "PSD")
  x.sub(layeredImg, 's', { 'xs.n': 'name' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(layeredImg, 'i', { 'xs.n': 'width' }).text = String(canvasW);
  x.sub(layeredImg, 'i', { 'xs.n': 'height' }).text = String(canvasH);
  x.sub(layeredImg, 'file', { 'xs.n': 'psdFile' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'description' }).text = '';
  x.subRef(layeredImg, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'guid' });
  x.sub(layeredImg, 'null', { 'xs.n': 'psdBytes' });
  x.sub(layeredImg, 'l', { 'xs.n': 'psdFileLastModified' }).text = '0';
  x.subRef(layeredImg, 'CLayerGroup', pidLg, { 'xs.n': '_rootLayer' });
  const layerSet = x.sub(layeredImg, 'LayerSet', { 'xs.n': 'layerSet' });
  x.subRef(layerSet, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const lsList = x.sub(layerSet, 'carray_list', { 'xs.n': '_layerEntryList', count: String(nLayers + 1) });
  x.subRef(lsList, 'CLayerGroup', pidLg);
  for (const lr of layerRefs) x.subRef(lsList, 'CLayer', lr.pidLayer);
  x.sub(layeredImg, 'null', { 'xs.n': 'icon16' });
  x.sub(layeredImg, 'null', { 'xs.n': 'icon64' });

  // ==================================================================
  // 3. PART SOURCES (hierarchical: Root → Groups → Drawables)
  // ==================================================================
  // Hiyori pattern: Root Part._childGuids → CPartGuid refs (child groups)
  // Each group._childGuids → CDrawableGuid refs (meshes in that group)
  // Meshes without a group parent go directly under Root Part.

  /**
   * Helper: create a CPartSource node with standard boilerplate.
   * Returns [partSourceNode, pidPartSource].
   */
  function makePartSource(partName, partIdStr, partGuidPid, parentGuidPid) {
    const [, pidForm] = x.shared('CFormGuid', { uuid: uuid(), note: `${partIdStr}_form` });

    const [kfg, pidKfg] = x.shared('KeyformGridSource');
    const kfogN = x.sub(kfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
    const kogN = x.sub(kfogN, 'KeyformOnGrid');
    const akN = x.sub(kogN, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    x.sub(akN, 'array_list', { 'xs.n': '_keyOnParameterList', count: '0' });
    x.subRef(kogN, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
    x.sub(kfg, 'array_list', { 'xs.n': 'keyformBindings', count: '0' });

    const [ps, pidPs] = x.shared('CPartSource');
    const ctrl = x.sub(ps, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(ctrl, 's', { 'xs.n': 'localName' }).text = partName;
    x.sub(ctrl, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(ctrl, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    if (parentGuidPid) {
      x.subRef(ctrl, 'CPartGuid', parentGuidPid, { 'xs.n': 'parentGuid' });
    } else {
      x.sub(ctrl, 'null', { 'xs.n': 'parentGuid' });
    }
    x.subRef(ctrl, 'KeyformGridSource', pidKfg, { 'xs.n': 'keyformGridSource' });
    const mft = x.sub(ctrl, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwc = x.sub(mft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(ctrl, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(ctrl, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.subRef(ps, 'CPartGuid', partGuidPid, { 'xs.n': 'guid' });
    x.sub(ps, 'CPartId', { 'xs.n': 'id', idstr: partIdStr });
    x.sub(ps, 'b', { 'xs.n': 'enableDrawOrderGroup' }).text = 'false';
    x.sub(ps, 'i', { 'xs.n': 'defaultOrder_forEditor' }).text = '500';
    x.sub(ps, 'b', { 'xs.n': 'isSketch' }).text = 'false';
    x.sub(ps, 'CColor', { 'xs.n': 'partsEditColor' });
    // _childGuids placeholder — caller fills this
    const cg = x.sub(ps, 'carray_list', { 'xs.n': '_childGuids', count: '0' });
    x.subRef(ps, 'CDeformerGuid', pidDeformerNull, { 'xs.n': 'targetDeformerGuid' });
    const kfl = x.sub(ps, 'carray_list', { 'xs.n': 'keyforms', count: '1' });
    const pf = x.sub(kfl, 'CPartForm');
    const acf = x.sub(pf, 'ACForm', { 'xs.n': 'super' });
    x.subRef(acf, 'CFormGuid', pidForm, { 'xs.n': 'guid' });
    x.sub(acf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
    x.sub(acf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
    x.subRef(acf, 'CPartSource', pidPs, { 'xs.n': '_source' }); // self-reference
    x.sub(acf, 'null', { 'xs.n': 'name' });
    x.sub(acf, 's', { 'xs.n': 'notes' }).text = '';
    x.sub(pf, 'i', { 'xs.n': 'drawOrder' }).text = '500';

    return { node: ps, pid: pidPs, childGuidsNode: cg };
  }

  // Build mesh→parentGroupId lookup and group→children lookup
  const meshParentMap = new Map(); // meshIndex → groupId
  for (let i = 0; i < perMesh.length; i++) {
    meshParentMap.set(i, meshes[i].parentGroupId ?? null);
  }

  // Create Root Part
  const rootPart = makePartSource('Root Part', '__RootPart__', pidPartGuid, null);
  const allPartSources = [rootPart]; // collect for PartSourceSet

  // Create group parts
  const groupParts = new Map(); // groupId → { pid, childGuidsNode, ... }
  for (const g of groups) {
    const gpid = groupPartGuids.get(g.id);
    // Determine parent: if group.parent exists and has a CPartGuid, use it; else use root
    const parentPid = g.parent && groupPartGuids.has(g.parent)
      ? groupPartGuids.get(g.parent) : pidPartGuid;
    const sanitizedId = `Part_${sanitisePartName(g.name || g.id)}`;
    const gp = makePartSource(g.name || g.id, sanitizedId, gpid, parentPid);
    groupParts.set(g.id, gp);
    allPartSources.push(gp);
  }

  // Fill _childGuids for each part
  // Root Part children = top-level groups (parent == null) + orphan meshes
  const rootChildren = [];
  for (const g of groups) {
    if (!g.parent || !groupPartGuids.has(g.parent)) {
      rootChildren.push({ type: 'CPartGuid', pid: groupPartGuids.get(g.id) });
    }
  }
  // Meshes: assign to their parent group, or root if no group
  for (let i = 0; i < perMesh.length; i++) {
    const parentId = meshParentMap.get(i);
    const target = parentId && groupParts.has(parentId)
      ? groupParts.get(parentId) : null;
    if (target) {
      // Add to group's _childGuids
      target.childGuidsNode.children.push(
        x.ref('CDrawableGuid', perMesh[i].pidDrawable)
      );
    } else {
      // Add to root
      rootChildren.push({ type: 'CDrawableGuid', pid: perMesh[i].pidDrawable });
    }
  }

  // Sub-groups: groups whose parent is another group (not root)
  for (const g of groups) {
    if (g.parent && groupParts.has(g.parent)) {
      const parentGp = groupParts.get(g.parent);
      parentGp.childGuidsNode.children.push(
        x.ref('CPartGuid', groupPartGuids.get(g.id))
      );
    }
  }

  // Write root children
  for (const c of rootChildren) {
    rootPart.childGuidsNode.children.push(x.ref(c.type, c.pid));
  }

  // Update count attrs on all _childGuids nodes
  for (const ps of allPartSources) {
    ps.childGuidsNode.attrs.count = String(ps.childGuidsNode.children.length);
  }

  // ==================================================================
  // 3b. ROTATION DEFORMERS (one per group with transform data)
  // ==================================================================
  // Each group node → CRotationDeformerSource. Deformer chain follows group hierarchy.
  // Meshes are auto-parented to their group's deformer with vertex space conversion.

  // --- Compute world-space pivot positions for all groups ---
  // Used for: (a) deformer origins, (b) mesh vertex → deformer-local transform.
  // Logic lives in `cmo3/groupWorldMatrices.js`; pure transform-math, no I/O.
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // Identify head and neck groups for structural chain integration
  const headGroupId = groups.find(g =>
    g.boneRole === 'head' || g.boneRole === 'face' ||
    (g.name && (g.name.toLowerCase() === 'head' || g.name.toLowerCase() === 'face'))
  )?.id;
  const neckGroupId = groups.find(g =>
    g.boneRole === 'neck' ||
    (g.name && g.name.toLowerCase() === 'neck')
  )?.id;

  const { groupWorldMatrices, deformerWorldOrigins } =
    computeGroupWorldMatrices(groups, meshes, canvasW, canvasH);

  const groupDeformerGuids = new Map(); // groupId → pidDeformerGuid
  const rotDeformerTargetNodes = new Map(); // groupId → XML node (for re-parenting to Body Warp)
  const rotDeformerOriginNodes = new Map(); // groupId → [{xNode, yNode, ox, oy}, ...] per keyform
  const allDeformerSources = []; // {pid, tag} for CDeformerSourceSet
  // Exported: groupId → parameter ID string (for animation export)
  const deformerParamMap = new Map(); // groupId → { paramId, min, max }

  // Default rotation range for generic parameter bindings (Approach B from
  // Session 8 prompt). Stage 8: resolved from project.rotationDeformerConfig.
  const DEFORMER_ANGLE_MIN = _ROT_PARAM_RANGE_MIN;
  const DEFORMER_ANGLE_MAX = _ROT_PARAM_RANGE_MAX;

  // Bone nodes get baked keyforms on their meshes instead of rotation deformers.
  // Their parameters were already created in the pre-creation step above.
  // Add them to deformerParamMap for animation export (can3writer needs them).
  for (const [boneId, bp] of boneParamGuids) {
    deformerParamMap.set(boneId, {
      paramId: bp.paramId, min: BAKED_ANGLE_MIN, max: BAKED_ANGLE_MAX,
    });
  }

  // Hiyori doesn't have rotation deformers for torso or eyes.
  // Torso body lean is done via Body X Warp (section 3d). Eyes via warp/parallax.
  // Also skip 'neck' — creating a rotation deformer for neck places its origin
  // at a drawn-pivot (often undefined in SS) or bbox-center fallback, neither of
  // which is anatomically at the neck-base. When parent Body X Warp bows, the
  // neck mesh rotates around this wrong pivot and appears to "tear off" from
  // the shoulders. Letting neck fall through to NeckWarp → Body X Warp directly
  // yields clean warp-grid deformation aligned with shoulders.
  // Stage 8: skip set resolved from project.rotationDeformerConfig.
  const SKIP_ROTATION_ROLES = new Set(_ROT_SKIP_ROLES);

  for (const g of groups) {
    // Skip bone nodes — they get baked mesh keyforms, not rotation deformers
    if (boneParamGuids.has(g.id)) continue;
    // Skip groups that Hiyori handles via warps, not rotation deformers
    if (SKIP_ROTATION_ROLES.has(g.boneRole)) continue;

    const t = g.transform || {};
    // Create a deformer for non-bone, non-skipped groups
    const [, pidDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Rot_${g.name || g.id}` });
    groupDeformerGuids.set(g.id, pidDfGuid);

    // Stage 8: keyform count = paramKeys length (default 3 = min/def/max).
    // Allocate one CFormGuid per key.
    const _GROUP_PARAM_KEYS = _ROT_GROUP_PARAM_KEYS;
    const _GROUP_ANGLES     = _ROT_GROUP_ANGLES;
    const _GROUP_KF_COUNT   = _GROUP_PARAM_KEYS.length;
    const groupFormGuidPids = [];
    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      const [, pidForm] = x.shared('CFormGuid', {
        uuid: uuid(),
        note: `RotForm_${g.name}_${_GROUP_PARAM_KEYS[kfi]}`,
      });
      groupFormGuidPids.push(pidForm);
    }

    // Parameter for this deformer: ParamRotation_GroupName
    // Guard: bone params are pre-created above — skip if ID already exists
    const sanitizedName = sanitisePartName(g.name || g.id);
    const rotParamId = `ParamRotation_${sanitizedName}`;
    const existingParam = paramDefs.find(p => p.id === rotParamId);
    const pidRotParam = existingParam
      ? existingParam.pid
      : (() => { const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: rotParamId }); return pid; })();
    if (!existingParam) {
      paramDefs.push({
        pid: pidRotParam, id: rotParamId, name: `Rotation ${g.name || g.id}`,
        min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX, defaultVal: 0,
        decimalPlaces: 1,
      });
    }
    deformerParamMap.set(g.id, {
      paramId: rotParamId, min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX,
    });

    // Mirror the group rotation spec into rigCollector. Initial parent is
    // ROOT (re-parenting in section 3d will move it under Body X for non-leg
    // groups). The rigCollector reflects the current parent at push time;
    // a fix-up pass after re-parenting updates rigCollector to match.
    const _gWorldOrigin = deformerWorldOrigins.get(g.id) ?? { x: 0, y: 0 };
    const { spec: _grpRotSpec } = buildGroupRotationSpec({
      id: `GroupRotation_${g.id}`,
      name: g.name || g.id,
      paramId: rotParamId,
      pivotCanvas: { x: _gWorldOrigin.x, y: _gWorldOrigin.y },
      paramKeys: _GROUP_PARAM_KEYS,
      angles:    _GROUP_ANGLES,
    });
    // Initial parent override: if g has a parent group with a deformer, use it
    if (g.parent && groupDeformerGuids.has(g.parent)) {
      _grpRotSpec.parent = { type: 'rotation', id: `GroupRotation_${g.parent}` };
    }
    rigCollector.rotationDeformers.push(_grpRotSpec);

    // CoordType for this deformer (Canvas coordinates)
    const [coordDf, pidCoordDf] = x.shared('CoordType');
    x.sub(coordDf, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource — links this deformer to its rotation parameter
    const [kfBinding, pidKfBinding] = x.shared('KeyformBindingSource');

    // KeyformGridSource (one keyform per paramKey, 1 parameter binding)
    const [kfgDf, pidKfgDf] = x.shared('KeyformGridSource');
    const kfogDf = x.sub(kfgDf, 'array_list', {
      'xs.n': 'keyformsOnGrid', count: String(_GROUP_KF_COUNT),
    });
    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      const kog = x.sub(kfogDf, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidKfBinding, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(kfi);
      x.subRef(kog, 'CFormGuid', groupFormGuidPids[kfi], { 'xs.n': 'keyformGuid' });
    }

    // keyformBindings list
    const kfbList = x.sub(kfgDf, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(kfbList, 'KeyformBindingSource', pidKfBinding);

    // Fill KeyformBindingSource (circular ref with KeyformGridSource — matches Hiyori)
    x.subRef(kfBinding, 'KeyformGridSource', pidKfgDf, { 'xs.n': '_gridSource' });
    x.subRef(kfBinding, 'CParameterGuid', pidRotParam, { 'xs.n': 'parameterGuid' });
    const keysArr = x.sub(kfBinding, 'array_list', {
      'xs.n': 'keys', count: String(_GROUP_KF_COUNT),
    });
    for (const k of _GROUP_PARAM_KEYS) {
      x.sub(keysArr, 'f').text = `${k}.0`;
    }
    x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = rotParamId;

    // Determine parent deformer: parent group's deformer or ROOT
    const parentDfGuid = g.parent && groupDeformerGuids.has(g.parent)
      ? groupDeformerGuids.get(g.parent) : pidDeformerRoot;

    // Determine parent part for this deformer
    const parentPartGuid = groupPartGuids.has(g.id)
      ? groupPartGuids.get(g.id)
      : pidPartGuid; // fallback to root part

    // CRotationDeformerSource
    const [rotDf, pidRotDf] = x.shared('CRotationDeformerSource');
    allDeformerSources.push({ pid: pidRotDf, tag: 'CRotationDeformerSource' });

    const acdfs = x.sub(rotDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const acpcs = x.sub(acdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(acpcs, 's', { 'xs.n': 'localName' }).text = `${g.name || g.id}`;
    x.sub(acpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(acpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(acpcs, 'CPartGuid', parentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(acpcs, 'KeyformGridSource', pidKfgDf, { 'xs.n': 'keyformGridSource' });
    const mftDf = x.sub(acpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mftDf, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwcDf = x.sub(mftDf, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwcDf, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(acpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(acdfs, 'CDeformerGuid', pidDfGuid, { 'xs.n': 'guid' });
    const dfIdStr = `Rotation_${sanitizedName}`;
    x.sub(acdfs, 'CDeformerId', { 'xs.n': 'id', idstr: dfIdStr });
    const rotDfTargetNode = x.subRef(acdfs, 'CDeformerGuid', parentDfGuid, { 'xs.n': 'targetDeformerGuid' });
    rotDeformerTargetNodes.set(g.id, rotDfTargetNode); // stored for re-parenting in section 3c

    x.sub(rotDf, 'b', { 'xs.n': 'useBoneUi_testImpl' }).text = 'true';

    // TRAP: Deformer origins are in PARENT DEFORMER's local space, NOT canvas space.
    // Hiyori Rotation22: originX=-0.44, originY=-718.2 (relative to parent Rotation21).
    // If you use canvas-space origins, controllers will appear far from the character.
    const worldOrigin = deformerWorldOrigins.get(g.id);
    const parentWorldOrigin = g.parent && deformerWorldOrigins.has(g.parent)
      ? deformerWorldOrigins.get(g.parent)
      : { x: 0, y: 0 }; // ROOT = canvas origin (0,0)
    const originX = worldOrigin.x - parentWorldOrigin.x;
    const originY = worldOrigin.y - parentWorldOrigin.y;

    // N keyforms — one per paramKey (default 3: min/def/max).
    // All share the same origin (origin changes are rare — Hiyori does it for some deformers
    // but for generic export, keeping origin constant across keyforms is correct)
    const kfsDf = x.sub(rotDf, 'carray_list', {
      'xs.n': 'keyforms', count: String(_GROUP_KF_COUNT),
    });

    // Helper to emit one CRotationDeformerForm
    const rotFormNodes = []; // stored for origin re-patching in section 3d
    const emitRotForm = (formGuidPid, angle) => {
      const rdf = x.sub(kfsDf, 'CRotationDeformerForm', {
        angle: angle.toFixed(1),
        originX: originX.toFixed(1),
        originY: originY.toFixed(1),
        scale: '1.0',
        isReflectX: 'false',
        isReflectY: 'false',
      });
      rotFormNodes.push(rdf);
      const adfSuper = x.sub(rdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const acfDf = x.sub(adfSuper, 'ACForm', { 'xs.n': 'super' });
      x.subRef(acfDf, 'CFormGuid', formGuidPid, { 'xs.n': 'guid' });
      x.sub(acfDf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(acfDf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(acfDf, 'CRotationDeformerSource', pidRotDf, { 'xs.n': '_source' });
      x.sub(acfDf, 'null', { 'xs.n': 'name' });
      x.sub(acfDf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(adfSuper, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(adfSuper, 'CoordType', pidCoordDf, { 'xs.n': 'coordType' });
    };

    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      emitRotForm(groupFormGuidPids[kfi], _GROUP_ANGLES[kfi]);
    }
    rotDeformerOriginNodes.set(g.id, { forms: rotFormNodes, ox: originX, oy: originY, wx: worldOrigin.x, wy: worldOrigin.y, coordNode: coordDf });

    x.sub(rotDf, 'f', { 'xs.n': 'handleLengthOnCanvas' }).text = '200.0';
    x.sub(rotDf, 'f', { 'xs.n': 'circleRadiusOnCanvas' }).text = '100.0';
    x.sub(rotDf, 'f', { 'xs.n': 'baseAngle' }).text = '0.0';
  }

  // Add deformer GUIDs to their parent part's _childGuids
  for (const g of groups) {
    const dfGuid = groupDeformerGuids.get(g.id);
    if (!dfGuid) continue;
    // Find which part source owns this group
    const partSource = groupParts.has(g.id) ? groupParts.get(g.id) : rootPart;
    partSource.childGuidsNode.children.push(x.ref('CDeformerGuid', dfGuid));
    partSource.childGuidsNode.attrs.count = String(partSource.childGuidsNode.children.length);
  }

  // ==================================================================
  // 3b. CWarpDeformerSource (per mesh with mesh_verts animation)
  // ==================================================================

  // Extract mesh_verts tracks: partId → keyframes[{time, value:[{x,y},...]}]
  const meshVertsMap = new Map();
  for (const anim of animations) {
    for (const track of (anim.tracks ?? [])) {
      if (track.property === 'mesh_verts' && track.keyframes?.length >= 2) {
        // Use first animation that has mesh_verts for this part
        if (!meshVertsMap.has(track.nodeId)) {
          meshVertsMap.set(track.nodeId, track.keyframes);
        }
      }
    }
  }

  const WARP_COL = 3;
  const WARP_ROW = 3;
  const WARP_GRID_POINTS = (WARP_COL + 1) * (WARP_ROW + 1); // 16
  const meshWarpDeformerGuids = new Map(); // partId → pidWarpDfGuid

  for (const pm of perMesh) {
    const partId = meshes[pm.mi].partId;
    const keyframes = meshVertsMap.get(partId);
    if (!keyframes) continue;

    const meshParentGroup = meshes[pm.mi].parentGroupId;
    const sanitizedMeshName = sanitisePartName(pm.meshName || partId);
    const numKf = keyframes.length;

    // Rest-pose vertices in deformer-local space (same as mesh keyform positions)
    const canvasVerts = pm.vertices; // canvas space
    const dfOrigin = meshParentGroup && deformerWorldOrigins.has(meshParentGroup)
      ? deformerWorldOrigins.get(meshParentGroup)
      : null;
    const restVerts = dfOrigin
      ? canvasVerts.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y))
      : [...canvasVerts];

    // Compute bounding box of rest vertices (deformer-local space)
    const numVerts = restVerts.length / 2;
    let bboxMinX = Infinity, bboxMinY = Infinity, bboxMaxX = -Infinity, bboxMaxY = -Infinity;
    for (let i = 0; i < numVerts; i++) {
      const vx = restVerts[i * 2], vy = restVerts[i * 2 + 1];
      if (vx < bboxMinX) bboxMinX = vx; if (vy < bboxMinY) bboxMinY = vy;
      if (vx > bboxMaxX) bboxMaxX = vx; if (vy > bboxMaxY) bboxMaxY = vy;
    }
    // Pad bbox by 10%
    const padX = (bboxMaxX - bboxMinX) * 0.1 || 10;
    const padY = (bboxMaxY - bboxMinY) * 0.1 || 10;
    bboxMinX -= padX; bboxMinY -= padY; bboxMaxX += padX; bboxMaxY += padY;
    const bboxW = bboxMaxX - bboxMinX;
    const bboxH = bboxMaxY - bboxMinY;

    // Build rest grid: regular (col+1)×(row+1) grid over padded bbox
    const gridW = WARP_COL + 1;
    const gridH = WARP_ROW + 1;
    const restGrid = new Float64Array(WARP_GRID_POINTS * 2);
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        const idx = (r * gridW + c) * 2;
        restGrid[idx] = bboxMinX + c * bboxW / WARP_COL;
        restGrid[idx + 1] = bboxMinY + r * bboxH / WARP_ROW;
      }
    }

    // Compute grid positions for each keyframe using IDW
    const gridKeyforms = []; // array of Float64Array(WARP_GRID_POINTS * 2)

    for (const kf of keyframes) {
      // Convert keyframe vertex positions to deformer-local space
      const kfLocalVerts = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts; i++) {
        const v = kf.value[i];
        if (!v) { kfLocalVerts[i * 2] = restVerts[i * 2]; kfLocalVerts[i * 2 + 1] = restVerts[i * 2 + 1]; continue; }
        kfLocalVerts[i * 2] = v.x - (dfOrigin ? dfOrigin.x : 0);
        kfLocalVerts[i * 2 + 1] = v.y - (dfOrigin ? dfOrigin.y : 0);
      }

      // Vertex deltas from rest
      const deltas = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts * 2; i++) {
        deltas[i] = kfLocalVerts[i] - restVerts[i];
      }

      // IDW: propagate vertex deltas to grid control points
      const gridPositions = new Float64Array(WARP_GRID_POINTS * 2);
      const epsilon = 1e-6;

      for (let gi = 0; gi < WARP_GRID_POINTS; gi++) {
        const gx = restGrid[gi * 2];
        const gy = restGrid[gi * 2 + 1];
        let sumWx = 0, sumWy = 0, sumW = 0;
        for (let vi = 0; vi < numVerts; vi++) {
          const dx = gx - restVerts[vi * 2];
          const dy = gy - restVerts[vi * 2 + 1];
          const distSq = dx * dx + dy * dy + epsilon;
          const w = 1 / distSq;
          sumWx += w * deltas[vi * 2];
          sumWy += w * deltas[vi * 2 + 1];
          sumW += w;
        }
        gridPositions[gi * 2] = gx + sumWx / sumW;
        gridPositions[gi * 2 + 1] = gy + sumWy / sumW;
      }

      gridKeyforms.push(gridPositions);
    }

    // --- Create CWarpDeformerSource XML ---

    // Warp deformer GUID
    const [, pidWarpDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Warp_${sanitizedMeshName}` });
    meshWarpDeformerGuids.set(partId, pidWarpDfGuid);

    // Form GUIDs (one per keyframe)
    const warpFormGuids = [];
    for (let ki = 0; ki < numKf; ki++) {
      const [, pidWarpForm] = x.shared('CFormGuid', { uuid: uuid(), note: `WarpForm_${sanitizedMeshName}_${ki}` });
      warpFormGuids.push(pidWarpForm);
    }

    // Parameter: ParamDeform_MeshName, range [0, numKf-1]
    const warpParamId = `ParamDeform_${sanitizedMeshName}`;
    const [, pidWarpParam] = x.shared('CParameterGuid', { uuid: uuid(), note: warpParamId });
    paramDefs.push({
      pid: pidWarpParam, id: warpParamId, name: `Deform ${pm.meshName}`,
      min: 0, max: numKf - 1, defaultVal: 0,
      decimalPlaces: 1,
    });
    deformerParamMap.set(partId, {
      paramId: warpParamId, type: 'warp', min: 0, max: numKf - 1,
      keyframeTimes: keyframes.map(kf => kf.time),
    });

    // CoordType for this warp deformer
    const [coordWarp, pidCoordWarp] = x.shared('CoordType');
    x.sub(coordWarp, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource — links warp to its parameter
    const [warpKfBinding, pidWarpKfBinding] = x.shared('KeyformBindingSource');

    // KeyformGridSource (numKf keyforms, 1 parameter binding)
    const [warpKfg, pidWarpKfg] = x.shared('KeyformGridSource');
    const warpKfogList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(numKf) });

    for (let ki = 0; ki < numKf; ki++) {
      const kog = x.sub(warpKfogList, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidWarpKfBinding, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(ki);
      x.subRef(kog, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'keyformGuid' });
    }

    const warpKfbList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(warpKfbList, 'KeyformBindingSource', pidWarpKfBinding);

    // Fill KeyformBindingSource
    x.subRef(warpKfBinding, 'KeyformGridSource', pidWarpKfg, { 'xs.n': '_gridSource' });
    x.subRef(warpKfBinding, 'CParameterGuid', pidWarpParam, { 'xs.n': 'parameterGuid' });
    const warpKeysArr = x.sub(warpKfBinding, 'array_list', { 'xs.n': 'keys', count: String(numKf) });
    for (let ki = 0; ki < numKf; ki++) {
      x.sub(warpKeysArr, 'f').text = ki.toFixed(1);
    }
    x.sub(warpKfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(warpKfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(warpKfBinding, 's', { 'xs.n': 'description' }).text = warpParamId;

    // Parent deformer: group's rotation deformer or ROOT
    const warpParentDfGuid = meshParentGroup && groupDeformerGuids.has(meshParentGroup)
      ? groupDeformerGuids.get(meshParentGroup) : pidDeformerRoot;

    // Parent part: same as the mesh's parent part
    const warpParentPartGuid = meshParentGroup && groupPartGuids.has(meshParentGroup)
      ? groupPartGuids.get(meshParentGroup) : pidPartGuid;

    // CWarpDeformerSource
    const [warpDf, pidWarpDf] = x.shared('CWarpDeformerSource');
    allDeformerSources.push({ pid: pidWarpDf, tag: 'CWarpDeformerSource' });

    const warpAcdfs = x.sub(warpDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const warpAcpcs = x.sub(warpAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(warpAcpcs, 's', { 'xs.n': 'localName' }).text = `${pm.meshName} Warp`;
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(warpAcpcs, 'CPartGuid', warpParentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(warpAcpcs, 'KeyformGridSource', pidWarpKfg, { 'xs.n': 'keyformGridSource' });
    const warpMft = x.sub(warpAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(warpMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const warpBwc = x.sub(warpMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(warpBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(warpAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(warpAcdfs, 'CDeformerGuid', pidWarpDfGuid, { 'xs.n': 'guid' });
    x.sub(warpAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `Warp_${sanitizedMeshName}` });
    x.subRef(warpAcdfs, 'CDeformerGuid', warpParentDfGuid, { 'xs.n': 'targetDeformerGuid' });

    // Warp-specific fields
    x.sub(warpDf, 'i', { 'xs.n': 'col' }).text = String(WARP_COL);
    x.sub(warpDf, 'i', { 'xs.n': 'row' }).text = String(WARP_ROW);
    x.sub(warpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

    // Keyforms: one CWarpDeformerForm per animation keyframe
    const warpKfsList = x.sub(warpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });

    for (let ki = 0; ki < numKf; ki++) {
      const wdf = x.sub(warpKfsList, 'CWarpDeformerForm');
      const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(wdfAcf, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'guid' });
      x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(wdfAcf, 'CWarpDeformerSource', pidWarpDf, { 'xs.n': '_source' });
      x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
      x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(wdfAdf, 'CoordType', pidCoordWarp, { 'xs.n': 'coordType' });

      // Grid positions for this keyframe
      const posArr = gridKeyforms[ki];
      x.sub(wdf, 'float-array', {
        'xs.n': 'positions', count: String(WARP_GRID_POINTS * 2),
      }).text = Array.from(posArr).map(v => v.toFixed(1)).join(' ');
    }

    // Add warp deformer guid to parent part's _childGuids
    const warpPartSource = groupParts.has(meshParentGroup) ? groupParts.get(meshParentGroup) : rootPart;
    warpPartSource.childGuidsNode.children.push(x.ref('CDeformerGuid', pidWarpDfGuid));
    warpPartSource.childGuidsNode.attrs.count = String(warpPartSource.childGuidsNode.children.length);
  }

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

  // Look up standard parameter PIDs (created by generateRig standardParams above)
  const pidParamBreath = paramDefs.find(p => p.id === 'ParamBreath')?.pid;
  // ParamBodyAngleX presence is checked inline at the body chain call site
  // (buildBodyWarpChain's hasParamBodyAngleX flag), so no local pid var here.
  const pidParamBodyAngleY = paramDefs.find(p => p.id === 'ParamBodyAngleY')?.pid;
  const pidParamBodyAngleZ = paramDefs.find(p => p.id === 'ParamBodyAngleZ')?.pid;
  const pidParamEyeBallX   = paramDefs.find(p => p.id === 'ParamEyeBallX')?.pid;
  const pidParamEyeBallY   = paramDefs.find(p => p.id === 'ParamEyeBallY')?.pid;
  const pidParamBrowLY     = paramDefs.find(p => p.id === 'ParamBrowLY')?.pid;
  const pidParamBrowRY     = paramDefs.find(p => p.id === 'ParamBrowRY')?.pid;
  const pidParamMouthOpenY = paramDefs.find(p => p.id === 'ParamMouthOpenY')?.pid;
  const pidParamEyeLOpen   = paramDefs.find(p => p.id === 'ParamEyeLOpen')?.pid;
  const pidParamEyeROpen   = paramDefs.find(p => p.id === 'ParamEyeROpen')?.pid;
  const pidParamHairFront  = paramDefs.find(p => p.id === 'ParamHairFront')?.pid;
  const pidParamHairBack   = paramDefs.find(p => p.id === 'ParamHairBack')?.pid;
  const pidParamSkirt      = paramDefs.find(p => p.id === 'ParamSkirt')?.pid;
  const pidParamShirt      = paramDefs.find(p => p.id === 'ParamShirt')?.pid;
  const pidParamPants      = paramDefs.find(p => p.id === 'ParamPants')?.pid;
  const pidParamBust       = paramDefs.find(p => p.id === 'ParamBust')?.pid;
  // Face parallax (Session 19) — drive Face Rotation (AngleZ) + 7 face parallax warps (AngleX × AngleY).
  const pidParamAngleX     = paramDefs.find(p => p.id === 'ParamAngleX')?.pid;
  const pidParamAngleY     = paramDefs.find(p => p.id === 'ParamAngleY')?.pid;
  const pidParamAngleZ     = paramDefs.find(p => p.id === 'ParamAngleZ')?.pid;

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

  // ── Pre-pass: compute eye closure contexts from eyewhite meshes (Session 16) ──
  // Eyewhite's lower edge = lower eyelid line = natural closed-eye position.
  // All eye parts (eyelash, eyewhite, irides) for the same eye use this shared curve.
  // Fallback to eyelash if eyewhite not available.
  const EYEWHITE_TAGS = new Set(['eyewhite', 'eyewhite-l', 'eyewhite-r']);
  const EYELASH_TAGS = new Set(['eyelash', 'eyelash-l', 'eyelash-r']);
  const EYE_SOURCE_TAGS = new Set([...EYEWHITE_TAGS, ...EYELASH_TAGS]);
  const EYE_PART_TAGS = new Set([
    'eyelash', 'eyelash-l', 'eyelash-r',
    'eyewhite', 'eyewhite-l', 'eyewhite-r',
    'irides', 'irides-l', 'irides-r',
  ]);
  const eyeContexts = []; // { tag, isEyewhite, curvePoints, bboxCenterX, bboxCenterY }
  if (generateRig) {
    for (const pm of perMesh) {
      const m = meshes[pm.mi];
      if (!EYE_SOURCE_TAGS.has(m.tag)) continue;
      if (pm.hasBakedKeyforms) continue;
      const verts = pm.vertices;
      const nv = verts.length / 2;
      if (nv < 3) continue;
      // ── Extract true bottom contour via X-bin max-Y ──
      // Sort vertices by X, split into X-bins, take MAX Y vertex per bin.
      // This captures the actual bottom boundary (not mixed with interior
      // triangulation vertices that filtering by Y > median would include).
      const pairs = new Array(nv);
      for (let i = 0; i < nv; i++) pairs[i] = [verts[i * 2], verts[i * 2 + 1]];
      pairs.sort((a, b) => a[0] - b[0]);
      // For eyewhite: use all vertices (clean mesh, no wings).
      // For eyelash fallback: take central 60% to exclude decorative wings.
      const isEyewhiteSrc = EYEWHITE_TAGS.has(m.tag);
      const pLo = isEyewhiteSrc ? 0 : Math.floor(nv * 0.20);
      const pHi = isEyewhiteSrc ? nv : Math.max(pLo + 1, Math.ceil(nv * 0.80));
      const central = pairs.slice(pLo, pHi);
      if (central.length < 4) continue;
      // Bin-max extraction of bottom contour
      const N_BINS = Math.min(8, Math.max(3, Math.floor(central.length / 3)));
      const lowerHalf = []; // actually "bottom contour points" now
      for (let b = 0; b < N_BINS; b++) {
        const binStart = Math.floor(central.length * b / N_BINS);
        const binEnd = Math.floor(central.length * (b + 1) / N_BINS);
        if (binEnd <= binStart) continue;
        let maxY = -Infinity, sumX = 0;
        for (let i = binStart; i < binEnd; i++) {
          if (central[i][1] > maxY) maxY = central[i][1];
          sumX += central[i][0];
        }
        lowerHalf.push([sumX / (binEnd - binStart), maxY]);
      }
      if (lowerHalf.length < 3) continue;
      // Compute Y-range of mesh to offset the curve up to natural closed-eye position.
      // Raw bin-max-Y sits at the lower eyelid; natural closed eye is slightly above.
      let meshMinY = Infinity, meshMaxY = -Infinity;
      for (const p of pairs) {
        if (p[1] < meshMinY) meshMinY = p[1];
        if (p[1] > meshMaxY) meshMaxY = p[1];
      }
      const yOffset = -0.15 * (meshMaxY - meshMinY); // negative = upward on canvas
      // Fit parabola y = ax² + bx + c via least-squares (normalize X for numerical stability)
      const fullMinX = pairs[0][0], fullMaxX = pairs[pairs.length - 1][0];
      const xMid = (fullMinX + fullMaxX) / 2;
      const xScale = (fullMaxX - fullMinX) / 2 || 1;
      let sX = 0, sY = 0, sX2 = 0, sX3 = 0, sX4 = 0, sXY = 0, sX2Y = 0;
      for (const [x, y] of lowerHalf) {
        const xn = (x - xMid) / xScale; // normalized X ∈ roughly [-1, 1]
        const xn2 = xn * xn;
        sX += xn; sY += y;
        sX2 += xn2; sX3 += xn2 * xn; sX4 += xn2 * xn2;
        sXY += xn * y; sX2Y += xn2 * y;
      }
      const nPts = lowerHalf.length;
      // Solve 3x3 linear system: M * [c, b, a]^T = [sY, sXY, sX2Y]^T
      //   [nPts sX  sX2] [c]   [sY]
      //   [sX   sX2 sX3] [b] = [sXY]
      //   [sX2  sX3 sX4] [a]   [sX2Y]
      // Using Cramer's rule (3x3 determinants)
      const det3 = (a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
        a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
      const detM  = det3(nPts, sX, sX2, sX, sX2, sX3, sX2, sX3, sX4);
      if (Math.abs(detM) < 1e-12) continue;
      const detC  = det3(sY, sX, sX2, sXY, sX2, sX3, sX2Y, sX3, sX4);
      const detB  = det3(nPts, sY, sX2, sX, sXY, sX3, sX2, sX2Y, sX4);
      const detA  = det3(nPts, sX, sY, sX, sX2, sXY, sX2, sX3, sX2Y);
      const c = detC / detM, b = detB / detM, a = detA / detM;
      // Sample parabola within fit data X range (avoid extrapolation drift)
      const fitMinX = lowerHalf.reduce((m, p) => Math.min(m, p[0]), Infinity);
      const fitMaxX = lowerHalf.reduce((m, p) => Math.max(m, p[0]), -Infinity);
      const N_SAMPLES = 7;
      const rawSamples = [];
      for (let i = 0; i < N_SAMPLES; i++) {
        const t = i / (N_SAMPLES - 1);
        const xCanvas = fitMinX + t * (fitMaxX - fitMinX);
        const xn = (xCanvas - xMid) / xScale;
        const yCanvas = a * xn * xn + b * xn + c;
        rawSamples.push([xCanvas, yCanvas]);
      }
      // Eyewhite lower edge = lower eyelid (smile shape directly, no flip needed).
      // Eyelash lower edge = upper eye opening (frown shape); flip to get smile shape.
      // Apply yOffset to raise curve from raw lower-edge to natural closed-eye position.
      const isEyewhite = EYEWHITE_TAGS.has(m.tag);
      let curvePoints;
      if (isEyewhite) {
        curvePoints = rawSamples.map(([x, y]) =>
          [canvasToBodyXX(x), canvasToBodyXY(y + yOffset)]);
      } else {
        // Flip around line through endpoints (preserve tilt, invert curvature)
        const [x0, y0s] = rawSamples[0];
        const [xN, yNs] = rawSamples[rawSamples.length - 1];
        const slope = (yNs - y0s) / Math.max(1e-6, xN - x0);
        curvePoints = rawSamples.map(([x, y]) => {
          const yLine = y0s + slope * (x - x0);
          return [canvasToBodyXX(x), canvasToBodyXY(2 * yLine - y + yOffset)];
        });
      }
      // Bbox center for proximity matching with eyewhite/irides (use full pairs range)
      const [lX, lY] = pairs[0];
      const [rX, rY] = pairs[pairs.length - 1];
      const bboxCenterX = canvasToBodyXX((lX + rX) / 2);
      const bboxCenterY = canvasToBodyXY((lY + rY) / 2);
      eyeContexts.push({
        tag: m.tag, isEyewhite, curvePoints, bboxCenterX, bboxCenterY,
      });
      if (rigDebugLog) {
        rigDebugLog.eyeClosureContexts.push({
          sourceTag: m.tag, isEyewhite,
          meshBbox: { minY: meshMinY, maxY: meshMaxY, H: meshMaxY - meshMinY },
          yOffset_canvasPx: yOffset,
          parabolaFit: { a, b, c, xMid, xScale },
          curveSampleCount: curvePoints.length,
          curvePoints_bodyX01: curvePoints,
        });
      }
    }
  }

  // Find matching eye ctx: prefer eyewhite source (more accurate), same side, proximity
  const findEyeCtx = (tag, bboxCx, bboxCy) => {
    if (eyeContexts.length === 0) return null;
    const side = tag.endsWith('-l') ? 'l' : tag.endsWith('-r') ? 'r' : '';
    // First try: eyewhite with matching side
    let pool = eyeContexts.filter(c => c.isEyewhite &&
      ((side === 'l' && c.tag.endsWith('-l')) ||
       (side === 'r' && c.tag.endsWith('-r')) ||
       (!side)));
    // Second try: any eyewhite
    if (!pool.length) pool = eyeContexts.filter(c => c.isEyewhite);
    // Third try: eyelash with matching side
    if (!pool.length) pool = eyeContexts.filter(c =>
      (side === 'l' && c.tag.endsWith('-l')) ||
      (side === 'r' && c.tag.endsWith('-r')));
    // Last resort: any context
    if (!pool.length) pool = eyeContexts;
    let best = null, bestD2 = Infinity;
    for (const c of pool) {
      const dx = bboxCx - c.bboxCenterX, dy = bboxCy - c.bboxCenterY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  };

  if (generateRig) {
    for (const pm of perMesh) {
      const m = meshes[pm.mi];
      const warpSpec = RIG_WARP_TAGS.get(m.tag);
      if (!warpSpec) continue;
      if (meshWarpDeformerGuids.has(m.partId)) continue;
      if (pm.hasBakedKeyforms) continue; // arms/legs/hands: bone-baked pose only → no rigWarp; physics drives the bone rotation deformers directly

      const { col: warpCol, row: warpRow } = warpSpec;
      const warpGridPts = (warpCol + 1) * (warpRow + 1);

      const partId = m.partId;
      const canvasVerts = pm.vertices;
      const numVerts = canvasVerts.length / 2;
      const sanitizedName = sanitisePartName(pm.meshName || partId);

      // Bounding box in canvas space — use FULL extent so every mesh vertex stays
      // inside the warp grid (0..1 space). Percentile-filtered bbox caused outlier
      // vertices to have <0 or >1 warp-local coords, producing bad extrapolation
      // (vertices "sticking out" at closed keyforms).
      let bxMin = Infinity, byMin = Infinity, bxMax = -Infinity, byMax = -Infinity;
      for (let i = 0; i < numVerts; i++) {
        const vx = canvasVerts[i * 2], vy = canvasVerts[i * 2 + 1];
        if (vx < bxMin) bxMin = vx; if (vy < byMin) byMin = vy;
        if (vx > bxMax) bxMax = vx; if (vy > byMax) byMax = vy;
      }
      // P11: extend eye-part rig warp bbox to eye union bounds. Needed because
      // the closure band may fall outside the mesh's own bbox (e.g., waifu L eye:
      // eyewhite extends 19 px below eyelash → band is outside lash bbox →
      // P5 clamp squashes lash to its own max, leaving gap with eyewhite/iris
      // closed lines). Union bbox ensures all eye-part meshes share a common
      // warp domain that covers the band.
      if (EYE_PART_TAGS.has(m.tag)) {
        const side = m.tag.endsWith('-l') ? 'l' : m.tag.endsWith('-r') ? 'r' : null;
        const unionBb = side ? eyeUnionBboxPerSide.get(side) : null;
        if (unionBb) {
          if (unionBb.minX < bxMin) bxMin = unionBb.minX;
          if (unionBb.minY < byMin) byMin = unionBb.minY;
          if (unionBb.maxX > bxMax) bxMax = unionBb.maxX;
          if (unionBb.maxY > byMax) byMax = unionBb.maxY;
        }
      }
      const padX = (bxMax - bxMin) * 0.1 || 10;
      const padY = (byMax - byMin) * 0.1 || 10;
      bxMin -= padX; byMin -= padY; bxMax += padX; byMax += padY;
      const bW = bxMax - bxMin;
      const bH = byMax - byMin;

      // rigWarpBbox stays in canvas space (used for mesh 0..1 conversion in section 4)
      rigWarpBbox.set(partId, { gridMinX: bxMin, gridMinY: byMin, gridW: bW, gridH: bH });

      // Grid positions: in parent warp's 0..1 local space.
      // Face-parallax tags → grid in single FaceParallax 0..1 (rebased via faceUnionBbox).
      // Neck-warp tags    → grid in single NeckWarp 0..1 (rebased via neckUnionBbox).
      // Everything else   → grid in Body X 0..1 (via canvasToBodyXX/Y).
      const isFaceTag = FACE_PARALLAX_TAGS.has(m.tag) && faceUnionBbox;
      const isNeckTag = !isFaceTag && NECK_WARP_TAGS.has(m.tag) && neckUnionBbox;
      const gW = warpCol + 1;
      const gH = warpRow + 1;
      const restGrid = new Float64Array(warpGridPts * 2);
      for (let r = 0; r < gH; r++) {
        for (let c = 0; c < gW; c++) {
          const idx = (r * gW + c) * 2;
          const cx = bxMin + c * bW / warpCol;
          const cy = byMin + r * bH / warpRow;
          if (isFaceTag) {
            restGrid[idx]     = canvasToFaceUnionX(cx);
            restGrid[idx + 1] = canvasToFaceUnionY(cy);
          } else if (isNeckTag) {
            restGrid[idx]     = canvasToNeckWarpX(cx);
            restGrid[idx + 1] = canvasToNeckWarpY(cy);
          } else {
            restGrid[idx]     = canvasToBodyXX(cx);
            restGrid[idx + 1] = canvasToBodyXY(cy);
          }
        }
      }

      // Path C diagnostic: capture rig-warp grid corners for eye parts.
      // Lets us verify the grid is positioned correctly in its parent's coord space
      // (FaceParallax 0..1 for eye parts). If grid corners are off, rendering
      // displacement has nothing to do with the closure algorithm.
      if (rigDebugLog && EYE_PART_TAGS && EYE_PART_TAGS.has(m.tag)) {
        const cornerIdx = (r, c) => (r * gW + c) * 2;
        const tl = cornerIdx(0, 0);
        const tr = cornerIdx(0, gW - 1);
        const bl = cornerIdx(gH - 1, 0);
        const br = cornerIdx(gH - 1, gW - 1);
        rigWarpDebugInfo.set(partId, {
          parentSpace: isFaceTag ? 'FaceParallax 0..1'
                     : isNeckTag ? 'NeckWarp 0..1'
                     : 'Body X 0..1',
          gridDim: { cols: gW, rows: gH },
          gridCanvasBbox: { minX: bxMin, minY: byMin, W: bW, H: bH },
          gridCorners_parentSpace: {
            topLeft:     [restGrid[tl],     restGrid[tl + 1]],
            topRight:    [restGrid[tr],     restGrid[tr + 1]],
            bottomLeft:  [restGrid[bl],     restGrid[bl + 1]],
            bottomRight: [restGrid[br],     restGrid[br + 1]],
          },
        });
      }

      const [, pidRigWarpGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `RigWarp_${sanitizedName}` });
      meshWarpDeformerGuids.set(partId, pidRigWarpGuid);

      // ── Mesh orientation context (Session 16: unified eye closure) ──
      // For eye parts (eyelash/eyewhite/irides): use shared eyeContext (computed
      // from eyelash) so all three compress to the SAME convergence line.
      // For other face tags: no ctx (shiftFn uses local grid behavior).
      let meshCtx = null;
      if (EYE_PART_TAGS.has(m.tag)) {
        // Compute this mesh's bbox center in Body X space for proximity matching
        const bCx = canvasToBodyXX((bxMin + bxMax) / 2);
        const bCy = canvasToBodyXY((byMin + byMax) / 2);
        const ctx = findEyeCtx(m.tag, bCx, bCy);
        if (ctx) meshCtx = { curvePoints: ctx.curvePoints };
      }
      // ── Per-part warp binding: standard param or no-op ParamOpacity (Session 16) ──
      const tagBinding = TAG_PARAM_BINDINGS.get(m.tag);
      const hasBinding = !!(tagBinding && tagBinding.bindings.every(b => b.pid));
      let pidRigWarpKfg, rigWarpFormGuids, rigWarpKeyValues;

      if (hasBinding) {
        const { bindings } = tagBinding;
        const numBindings = bindings.length;
        // Generate all key index/value combinations across N bindings via
        // a cartesian product. Emission order matches Cubism's column-
        // major expectation (binding[0] = fastest axis).
        //   bindings[0] = [-1, 0, 1], bindings[1] = [-1, 0, 1], bindings[2] = [-1, 0, 1]
        //   → (0,0,0), (1,0,0), (2,0,0), (0,1,0), (1,1,0), …
        const keyCombos = [];       // [[idx0, idx1, …], …] for KeyOnParameter keyIndex
        rigWarpKeyValues = [];      // [[val0, val1, …], …] for shiftFn
        const idxBuf = new Array(numBindings);
        const valBuf = new Array(numBindings);
        const cartesian = (dim) => {
          if (dim === numBindings) {
            keyCombos.push(idxBuf.slice());
            rigWarpKeyValues.push(valBuf.slice());
            return;
          }
          // Recurse from inner (dim=0) to outer (dim=numBindings-1) — so
          // outer bindings vary slowest in the emitted sequence. Match the
          // original hardcoded 2D order: `for j of b[1]` outside `for i of b[0]`.
          const inv = numBindings - 1 - dim;
          const b = bindings[inv];
          for (let i = 0; i < b.keys.length; i++) {
            idxBuf[inv] = i;
            valBuf[inv] = b.keys[i];
            cartesian(dim + 1);
          }
        };
        cartesian(0);
        const totalKf = keyCombos.length;
        rigWarpFormGuids = [];

        // KeyformBindingSources — one per param
        const kfbs = bindings.map(b => {
          const [kfb, pidKfb] = x.shared('KeyformBindingSource');
          return { kfb, pidKfb, ...b };
        });

        // KeyformGridSource with totalKf keyforms
        const [kfg, pidKfg] = x.shared('KeyformGridSource');
        pidRigWarpKfg = pidKfg;
        const kfogList = x.sub(kfg, 'array_list', {
          'xs.n': 'keyformsOnGrid', count: String(totalKf),
        });
        for (let ki = 0; ki < totalKf; ki++) {
          const [, pidForm] = x.shared('CFormGuid', {
            uuid: uuid(), note: `RigWarpForm_${sanitizedName}_${keyCombos[ki].join('_')}`,
          });
          rigWarpFormGuids.push(pidForm);
          const kog = x.sub(kfogList, 'KeyformOnGrid');
          const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
          const kop = x.sub(ak, 'array_list', {
            'xs.n': '_keyOnParameterList', count: String(numBindings),
          });
          for (let bi = 0; bi < numBindings; bi++) {
            const kon = x.sub(kop, 'KeyOnParameter');
            x.subRef(kon, 'KeyformBindingSource', kfbs[bi].pidKfb, { 'xs.n': 'binding' });
            x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(keyCombos[ki][bi]);
          }
          x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
        }
        // Binding list + emit each binding
        const kfbList = x.sub(kfg, 'array_list', {
          'xs.n': 'keyformBindings', count: String(numBindings),
        });
        for (const kfb of kfbs) {
          x.subRef(kfbList, 'KeyformBindingSource', kfb.pidKfb);
          emitKfBinding(x, kfb.kfb, pidKfg, kfb.pid, kfb.keys.map(k => k + '.0'), kfb.desc);
        }
      } else {
        // No standard binding — single rest keyform, no-op ParamOpacity
        const [, pidRigWarpForm] = x.shared('CFormGuid', { uuid: uuid(), note: `RigWarpForm_${sanitizedName}` });
        rigWarpFormGuids = [pidRigWarpForm];
        rigWarpKeyValues = null;
        const [rigWarpKfb, pidRigWarpKfb] = x.shared('KeyformBindingSource');
        const [rigWarpKfg, pidKfg] = x.shared('KeyformGridSource');
        pidRigWarpKfg = pidKfg;
        const kfogList = x.sub(rigWarpKfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
        const kog = x.sub(kfogList, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidRigWarpKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = '0';
        x.subRef(kog, 'CFormGuid', pidRigWarpForm, { 'xs.n': 'keyformGuid' });
        const kfbList = x.sub(rigWarpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
        x.subRef(kfbList, 'KeyformBindingSource', pidRigWarpKfb);
        emitKfBinding(x, rigWarpKfb, pidRigWarpKfg, pidParamOpacity, ['1.0'], 'ParamOpacity');
      }

      // Parent part
      const meshParentGroup = m.parentGroupId;
      const rigWarpPartGuid = meshParentGroup && groupPartGuids.has(meshParentGroup)
        ? groupPartGuids.get(meshParentGroup) : pidPartGuid;

      // All per-part warps target ROOT, re-parented to Breath in section 3d.

      // CWarpDeformerSource — grid in Breath 0..1 space
      const [rigWarpDf, pidRigWarpDf] = x.shared('CWarpDeformerSource');
      allDeformerSources.push({ pid: pidRigWarpDf, tag: 'CWarpDeformerSource' });

      const rwAcdfs = x.sub(rigWarpDf, 'ACDeformerSource', { 'xs.n': 'super' });
      const rwAcpcs = x.sub(rwAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
      x.sub(rwAcpcs, 's', { 'xs.n': 'localName' }).text = `${pm.meshName} Warp`;
      x.sub(rwAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
      x.sub(rwAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
      x.subRef(rwAcpcs, 'CPartGuid', rigWarpPartGuid, { 'xs.n': 'parentGuid' });
      x.subRef(rwAcpcs, 'KeyformGridSource', pidRigWarpKfg, { 'xs.n': 'keyformGridSource' });
      const rwMft = x.sub(rwAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
      x.sub(rwMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
      const rwBwc = x.sub(rwMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
      x.sub(rwBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
      x.sub(rwAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
      x.sub(rwAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
      x.sub(rwAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
      x.subRef(rwAcdfs, 'CDeformerGuid', pidRigWarpGuid, { 'xs.n': 'guid' });
      x.sub(rwAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `RigWarp_${sanitizedName}` });
      // targetDeformerGuid: ROOT, patched to Breath in section 3d
      const rigWarpTargetNode = x.subRef(rwAcdfs, 'CDeformerGuid', pidDeformerRoot, { 'xs.n': 'targetDeformerGuid' });

      x.sub(rigWarpDf, 'i', { 'xs.n': 'col' }).text = String(warpCol);
      x.sub(rigWarpDf, 'i', { 'xs.n': 'row' }).text = String(warpRow);
      x.sub(rigWarpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

      // ── Keyforms: N procedurally-shifted grids, or 1 rest keyform ──
      const numKf = rigWarpFormGuids.length;
      const rigKfsList = x.sub(rigWarpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });
      const gxSpan = restGrid[warpCol * 2] - restGrid[0];
      const gySpan = restGrid[(warpRow * gW) * 2 + 1] - restGrid[1];

      // Per-mesh rig warp spec for moc3 binary translator. Captures the
      // SAME data the XML emission below produces, just in normalised form.
      // Parent will be resolved at re-parenting time (face → FaceParallax,
      // neck → NeckWarp, default → BodyXWarp).
      const rigWarpSpec = {
        id: `RigWarp_${sanitizedName}`,
        name: `${pm.meshName} Warp`,
        parent: { type: 'warp', id: 'BodyXWarp' }, // re-parenting may override
        // moc3 translator uses this to set the mesh's parent_deformer_index
        // to the rig warp instead of the deepest body warp. partId is the
        // SS project node id; cmo3 path uses the same as the canonical
        // mesh identity.
        targetPartId: m.partId,
        // Canvas-pixel bounding box of this rig warp's grid. moc3 uses
        // this to convert mesh vertex canvas positions to 0..1 of the
        // grid's canvas extent (the convention cmo3 art-mesh emission
        // uses for rig-warp-parented meshes — see lines ~3497-3503).
        canvasBbox: { minX: bxMin, minY: byMin, W: bW, H: bH },
        gridSize: { rows: warpRow, cols: warpCol },
        baseGrid: new Float64Array(restGrid),
        localFrame: 'normalized-0to1',
        bindings: hasBinding
          ? tagBinding.bindings.map(b => ({
              // TAG_PARAM_BINDINGS stores the param id as `desc`; `pid` is
              // the XML reference (only useful inside cmo3 emission).
              parameterId: b.desc ?? 'ParamOpacity',
              keys: b.keys.slice(),
              interpolation: 'LINEAR',
            }))
          : [{ parameterId: 'ParamOpacity', keys: [1], interpolation: 'LINEAR' }],
        keyforms: [],
        isVisible: true,
        isLocked: false,
        isQuadTransform: false,
      };

      // Stage 9b: resolve stored per-mesh keyforms. If a record exists for
      // this partId AND its keyform count + per-keyform position length
      // match the cartesian-product expected shape, the stored positions
      // replace the procedural shiftFn invocation below. On any shape
      // mismatch (e.g. a save where the mesh was re-meshed since seed)
      // we fall back to the inline path — same behaviour as no record.
      const _storedRigWarp = rigWarps?.get?.(m.partId) ?? null;
      const _useStoredRigWarp = !!(_storedRigWarp
        && Array.isArray(_storedRigWarp.keyforms)
        && _storedRigWarp.keyforms.length === numKf
        && _storedRigWarp.keyforms.every(k =>
          k && k.positions && k.positions.length === warpGridPts * 2));

      for (let ki = 0; ki < numKf; ki++) {
        // Generate grid positions: stored (Stage 9b) > shiftFn for bound
        // params > rest grid for no-op. Stored case still emits via the
        // same XML path below — Stage 9b is reader-only, the writer
        // shape is unchanged.
        const pos = _useStoredRigWarp
          ? new Float64Array(_storedRigWarp.keyforms[ki].positions)
          : (hasBinding && rigWarpKeyValues)
            ? tagBinding.shiftFn(restGrid, gW, gH, rigWarpKeyValues[ki], gxSpan, gySpan, meshCtx)
            : new Float64Array(restGrid);

        rigWarpSpec.keyforms.push({
          keyTuple: rigWarpKeyValues ? rigWarpKeyValues[ki].slice() : [1],
          positions: new Float64Array(pos),
          opacity: 1,
        });

        const wdf = x.sub(rigKfsList, 'CWarpDeformerForm');
        const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
        const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
        x.subRef(wdfAcf, 'CFormGuid', rigWarpFormGuids[ki], { 'xs.n': 'guid' });
        x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
        x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
        x.subRef(wdfAcf, 'CWarpDeformerSource', pidRigWarpDf, { 'xs.n': '_source' });
        x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
        x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
        x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
        x.sub(wdfAdf, 'CFloatColor', {
          'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
        });
        x.sub(wdfAdf, 'CFloatColor', {
          'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
        });
        x.subRef(wdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
        x.sub(wdf, 'float-array', {
          'xs.n': 'positions', count: String(warpGridPts * 2),
        }).text = Array.from(pos).map(v => v.toFixed(6)).join(' ');
      }

      // Register in parent part's _childGuids
      const rigWarpPartSrc = groupParts.has(meshParentGroup) ? groupParts.get(meshParentGroup) : rootPart;
      rigWarpPartSrc.childGuidsNode.children.push(x.ref('CDeformerGuid', pidRigWarpGuid));
      rigWarpPartSrc.childGuidsNode.attrs.count = String(rigWarpPartSrc.childGuidsNode.children.length);

      // Store for re-parenting in section 3d. Face-parallax tags route to the single
      // FaceParallax warp; other tags route to Body X.
      rigWarpTargetNodesToReparent.push({
        node: rigWarpTargetNode, isFaceTag, isNeckTag,
        rigWarpSpecRef: rigWarpSpec, // for spec parent fix-up after reparent
      });

      // Tentative parent ahead of re-parenting; the re-parent block updates
      // both the XML ref AND this spec's parent so moc3 sees the FINAL parent.
      if (isFaceTag) rigWarpSpec.parent = { type: 'warp', id: 'FaceParallaxWarp' };
      else if (isNeckTag) rigWarpSpec.parent = { type: 'warp', id: 'NeckWarp' };
      else rigWarpSpec.parent = { type: 'warp', id: 'BodyXWarp' };

      rigCollector.warpDeformers.push(rigWarpSpec);
    }
  }

  // ==================================================================
  // 3d. Structural Body Warp Chain (Hiyori pattern: 3 chained warps)
  // ==================================================================
  // Hiyori uses THREE chained structural warps, each with a single parameter:
  //   Body Warp Z (ParamBodyAngleZ, Canvas coords) → targets ROOT
  //   Body Warp Y (ParamBodyAngleY, DeformerLocal) → targets Body Warp Z
  //   Breath Warp (ParamBreath, DeformerLocal)      → targets Body Warp Y
  // All per-part warps and rotation deformers target Breath (the innermost).
  // Legs stay at ROOT — independent of body rotation.
  //
  // See WARP_DEFORMERS.md "Structural Warp Chain" for exact Hiyori values.

  const LEG_ROLES = new Set(['leftLeg', 'rightLeg', 'bothLegs', 'leftKnee', 'rightKnee']);

  // Shared context for extracted emitStructuralWarp — passes in mutable collections
  // and pid references that the helper writes into.
  const emitCtx = { allDeformerSources, pidPartGuid, rootPart };

  // Only Breath + Body X are referenced after the chain emits (re-parenting
  // target). BZ + BY pids are produced by the loop but not consumed externally.
  let pidBreathGuid = null;
  let pidBodyXGuid = null;
  if (generateRig && pidParamBodyAngleZ && pidParamBodyAngleY && pidParamBreath) {
    // Body warp chain emission — translates the 4 WarpDeformerSpec entries
    // returned by buildBodyWarpChain (called near line 2420) into XML via
    // emitStructuralWarp + emitSingleParamKfGrid. The math/coordinate logic
    // lives in rig/bodyWarp.js — this block is pure XML translation.
    //
    // Per-spec parameter pid lookup keeps the spec format-agnostic
    // (parameterId is a string; cmo3 needs the XML pid for KeyformBindingSource).
    const _bodyParamPid = (paramId) => paramDefs.find(p => p.id === paramId)?.pid;
    const _bodyDeformerPids = new Map(); // spec.id → its CDeformerGuid pid
    const [_coordBWZ, pidCoordBWZ] = x.shared('CoordType');
    x.sub(_coordBWZ, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    for (const spec of _bodyChain.specs) {
      rigCollector.warpDeformers.push(spec);
      const [, pid] = x.shared('CDeformerGuid', { uuid: uuid(), note: spec.id });
      _bodyDeformerPids.set(spec.id, pid);

      // BZ uses canvas coords; rest of chain uses the standard DeformerLocal pidCoord.
      const coordPid = spec.localFrame === 'canvas-px' ? pidCoordBWZ : pidCoord;

      // Resolve parent pid: ROOT → pidDeformerRoot, warp → previously-emitted spec pid.
      const parentPid = spec.parent.type === 'root'
        ? pidDeformerRoot
        : _bodyDeformerPids.get(spec.parent.id);

      const binding = spec.bindings[0];
      const paramPid = _bodyParamPid(binding.parameterId);
      const { pidKfg, formGuids } = emitSingleParamKfGrid(
        x, paramPid, binding.keys, binding.parameterId,
      );
      const positions = spec.keyforms.map(k => k.positions);
      emitStructuralWarp(
        x, emitCtx,
        spec.name, spec.id, spec.gridSize.cols, spec.gridSize.rows,
        pid, parentPid, pidKfg, coordPid, formGuids, positions,
      );
    }
    pidBreathGuid = _bodyDeformerPids.get('BreathWarp') ?? null;
    pidBodyXGuid = _bodyDeformerPids.get('BodyXWarp') ?? null;
  }

  // Neck warp + face rotation + face parallax + re-parenting pass run only
  // when the body warp chain emitted (they parent under Body X). Kept inside
  // the same outer guard the original block used.
  if (generateRig && pidParamBodyAngleZ && pidParamBodyAngleY && pidParamBreath) {
    // ==================================================================
    // 3d.1 Neck Warp (Session 20: neck follows head tilt)
    // ==================================================================
    // See `cmo3/bodyRig.js` emitNeckWarp for details. Chain:
    //   Body X → NeckWarp → neck/neckwear rig warps → neck meshes
    const pidNeckWarpGuid = emitNeckWarp(x, {
      pidParamAngleZ, neckUnionBbox, pidBodyXGuid,
      neckGroupId, groupDeformerGuids, deformerWorldOrigins,
      canvasToBodyXX, canvasToBodyXY,
      pidCoord, rigDebugLog, emitCtx,
      rigCollector,
      autoRigNeckWarp: autoRigConfig?.neckWarp,
    });

    // ==================================================================
    // 3d.2 Face Rotation + Face Parallax Warp (Sessions 19–20)
    // ==================================================================
    // Chain:  Body X → Face Rotation (ParamAngleZ, 3kf, pivot=chin)
    //                    └─ FaceParallax (single warp, 6×6 grid, 9kf on AngleX×AngleY)
    //                             └─ RigWarp_<part>  (rebased into FaceParallax 0..1)
    //
    // Session 19 shipped the single FaceParallax warp but left Face Rotation orphaned.
    // Session 20 diagnosed the coord-space: a rotation-deformer parent exposes a local
    // frame of canvas-pixel offsets from its own pivot (NOT 0..1), so FaceParallax grid
    // values must be `(canvas_pos - facePivotCx/Cy)`, not `canvasToBodyXX/Y(...)`.
    // Face Rotation's pivot stays in Body X 0..1 because its own parent is a warp.
    // See SESSION20_FINDINGS.md + WARP_DEFORMERS.md "Rotation Deformer Local Frame".
    //
    // FaceParallax deformation = Session 15 Body-X-pattern layered effects:
    //   1. Base bow (sine profile, center > edges).
    //   2. Asymmetric perspective (far side of rotation shifts more).
    //   3. Cross-axis Y-on-AngleX + X-on-AngleY (tilt-while-turning cue).
    //   4. Row/col fade (top/bottom/edge columns move less than middle).
    const faceParallaxGuids = new Map(); // groupKey → pidCDeformerGuid
    if (pidParamAngleZ && facePivotCx !== null && faceUnionBbox && pidBodyXGuid) {
      // ── Face Rotation (CRotationDeformerSource) ──
      // See `cmo3/bodyRig.js` emitFaceRotation — 3 keyforms on ParamAngleZ,
      // pivot at chin, rotation capped at ±10°. FaceParallax reparents to it.
      const pidFaceRotGuid = emitFaceRotation(x, {
        pidParamAngleZ, facePivotCx, facePivotCy, pidBodyXGuid,
        headGroupId, groupDeformerGuids, deformerWorldOrigins,
        canvasToBodyXX, canvasToBodyXY,
        allDeformerSources, pidPartGuid, pidCoord, rootPart,
        rigCollector,
        faceRotationParamKeys: _ROT_FACE_PARAM_KEYS,
        faceRotationAngles:    _ROT_FACE_ANGLES,
      });

      // ── FaceParallax warp (6×6 grid, 9kf on AngleX × AngleY) ──
      // See `cmo3/faceParallax.js` emitFaceParallax — contains protected
      // region build (A.3 pairing, A.6b cell expansion), 3D rotation math
      // with #3 eye-parallax amp + #5 far-eye squash, and the deformer emit.
      //
      // Stage 11 invariant: same as the body-warp guard above — outside
      // `rigOnly` the spec should always be pre-resolved.
      if (!faceParallaxSpec && !rigOnly) {
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

    // ── Re-parent: rotation deformers targeting ROOT → Body X Warp ──
    // Body X is the innermost structural warp (4th layer). Everything targets it.
    // Skip legs (they stay at ROOT).
    // Convert ALL non-leg rotation deformer origins to Body X space using world positions.
    // canvasToBodyXX/Y defined before section 3c.
    const pidReparentTarget = pidBodyXGuid || pidBreathGuid; // fallback if no Body X

    // Fix-up rigCollector: keep parent references in sync with the XML
    // re-parenting below. moc3 translator reads spec.parent at emission
    // time, so the spec must reflect the FINAL parent (post-reparenting).
    const rigReparentTargetId = pidBodyXGuid ? 'BodyXWarp' : 'BreathWarp';
    for (const [gid, targetNode] of rotDeformerTargetNodes) {
      const group = groupMap.get(gid);
      if (group && LEG_ROLES.has(group.boneRole)) continue;

      // Re-parent ROOT-targeting deformers to Body X (or Breath)
      if (targetNode.attrs['xs.ref'] === pidDeformerRoot) {
        targetNode.attrs['xs.ref'] = pidReparentTarget;
        // Keep rigCollector parent ref in sync — pivot conversion happens
        // in the unified loop below (both ROOT→warp and parent-rotation
        // cases need their own conversion math).
        const rigSpecD = rigCollector.rotationDeformers.find(
          s => s.id === `GroupRotation_${gid}`,
        );
        if (rigSpecD && rigSpecD.parent.type === 'root') {
          rigSpecD.parent = { type: 'warp', id: rigReparentTargetId };
        }
      }

      // Convert origin for ALL non-leg deformers using world position → correct space (pixels or 0..1)
      const originData = rotDeformerOriginNodes.get(gid);
      if (originData) {
        const parentRef = targetNode.attrs['xs.ref'];
        const pGroupId = group ? group.parent : null;
        const isParentGroupRot = pGroupId && groupDeformerGuids.get(pGroupId) === parentRef;

        let ox, oy;
        if (isParentGroupRot) {
          // Parent is another rotation deformer: use pixel offsets from parent's pivot
          const parentPivot = deformerWorldOrigins.get(pGroupId) || { x: 0, y: 0 };
          ox = originData.wx - parentPivot.x;
          oy = originData.wy - parentPivot.y;
        } else {
          // Parent is a warp (Body X or NeckWarp etc): use 0..1 of Body X space (standard fallback)
          ox = canvasToBodyXX(originData.wx);
          oy = canvasToBodyXY(originData.wy);
        }

        const newOx = ox.toFixed(6);
        const newOy = oy.toFixed(6);
        for (const rdf of originData.forms) {
          rdf.attrs.originX = newOx;
          rdf.attrs.originY = newOy;
        }
        // Patch shared CoordType: Canvas → DeformerLocal (origins adapted to parent space)
        const coordTextNode = originData.coordNode.children.find(c => c.attrs?.['xs.n'] === 'coordName');
        if (coordTextNode) coordTextNode.text = 'DeformerLocal';

        // Mirror the converted pivot into rigCollector so moc3 binary emits
        // the same value. All keyforms of the spec share the same pivot.
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

    // ── Re-parent: per-part rig warps → FaceParallax (face tag), NeckWarp (neck tag),
    // or Body X (default).  Grids were rebased to the appropriate 0..1 domain in section 3c.
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
  // passed any (post-seed path), else from the inline heuristic below
  // (matches the algorithm in rig/maskConfigs.js exactly). Either way we
  // resolve to `pidByPartId` for the per-mesh emission loop.
  const pidByPartId = new Map();
  for (const pmEntry of perMesh) {
    pidByPartId.set(meshes[pmEntry.mi].partId, pmEntry.pidDrawable);
  }

  const maskPidByMaskedPartId = new Map();
  // R7 (native rig render) — partId-keyed mirror so the rigSpec push below
  // can populate `artMesh.maskMeshIds` for runtime/scenePass consumption.
  // Carries ALL maskMeshIds verbatim (not just the first) — cmo3 emission
  // still collapses to one clip ref via maskPidByMaskedPartId, but the
  // rigSpec contract preserves full multi-mask sets for future fidelity.
  const maskMeshIdsByPartId = new Map();
  if (maskConfigs.length > 0) {
    for (const pair of maskConfigs) {
      const masks = (pair.maskMeshIds ?? [])
        .map(id => pidByPartId.get(id))
        .filter(pid => pid != null);
      if (masks.length > 0) {
        // cmo3 currently emits a single clip ref per mesh — first wins.
        maskPidByMaskedPartId.set(pair.maskedMeshId, masks[0]);
      }
      if (Array.isArray(pair.maskMeshIds) && pair.maskMeshIds.length > 0) {
        maskMeshIdsByPartId.set(pair.maskedMeshId, [...pair.maskMeshIds]);
      }
    }
  } else {
    // Fallback heuristic — kept for projects that haven't been seeded.
    // Mirrors rig/maskConfigs.js:buildMaskConfigsFromProject.
    const CLIP_RULES = { irides: 'eyewhite', 'irides-l': 'eyewhite-l', 'irides-r': 'eyewhite-r' };
    const basePidByTag = new Map();
    const variantPidByTagAndSuffix = new Map();
    const basePartIdByTag = new Map();
    const variantPartIdByTagAndSuffix = new Map();
    for (const pmEntry of perMesh) {
      const mesh = meshes[pmEntry.mi];
      const tag = mesh.tag;
      if (!tag) continue;
      const sfx = mesh.variantSuffix ?? mesh.variantRole ?? null;
      if (sfx) {
        const key = `${tag}|${sfx}`;
        if (!variantPidByTagAndSuffix.has(key)) {
          variantPidByTagAndSuffix.set(key, pmEntry.pidDrawable);
          variantPartIdByTagAndSuffix.set(key, mesh.partId);
        }
      } else if (!basePidByTag.has(tag)) {
        basePidByTag.set(tag, pmEntry.pidDrawable);
        basePartIdByTag.set(tag, mesh.partId);
      }
    }
    for (const pmEntry of perMesh) {
      const mesh = meshes[pmEntry.mi];
      const tag = mesh.tag;
      if (!tag) continue;
      const maskTag = CLIP_RULES[tag];
      if (!maskTag) continue;
      const sfx = mesh.variantSuffix ?? mesh.variantRole ?? null;
      const pid = sfx
        ? (variantPidByTagAndSuffix.get(`${maskTag}|${sfx}`) ?? basePidByTag.get(maskTag) ?? null)
        : (basePidByTag.get(maskTag) ?? null);
      if (pid) maskPidByMaskedPartId.set(mesh.partId, pid);
      const maskPartId = sfx
        ? (variantPartIdByTagAndSuffix.get(`${maskTag}|${sfx}`) ?? basePartIdByTag.get(maskTag) ?? null)
        : (basePartIdByTag.get(maskTag) ?? null);
      if (maskPartId) maskMeshIdsByPartId.set(mesh.partId, [maskPartId]);
    }
  }

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
