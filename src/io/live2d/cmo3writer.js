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

import { XmlBuilder, uuid } from './xmlbuilder.js';
import { analyzeBody } from './bodyAnalyzer.js';
import { BAKED_BONE_ANGLES } from './rig/paramSpec.js';
import { buildBodyWarpChain } from './rig/bodyWarp.js';
import { buildTagBindingMap } from './rig/tagWarpBindings.js';
import { VERSION_PIS, IMPORT_PIS } from './cmo3/constants.js';
import { FACE_PARALLAX_TAGS, NECK_WARP_TAGS } from './cmo3/rigWarpTags.js';
import { fitParabolaFromLowerEdge } from './cmo3/eyeClosureFit.js';
import { evalClosureCurve } from './cmo3/eyeClosureApply.js';
import { setupGlobalSharedObjects, lookupStandardParamPids } from './cmo3/globalSetup.js';
import { emitModelImageGroup } from './cmo3/modelImageGroup.js';
import { packCmo3 } from './cmo3/caffPack.js';
import { buildMainXml } from './cmo3/mainXmlBuilder.js';
import { fillLayerGroupAndImage } from './cmo3/meshLayer.js';
import { buildPartHierarchy } from './cmo3/partHierarchy.js';
import { emitMeshVertsWarpDeformers } from './cmo3/meshVertsWarp.js';
import { emitRotationDeformers } from './cmo3/rotationDeformerEmit.js';
import { emitStructuralChainAndReparent } from './cmo3/structuralChainEmit.js';
import { createEmitContext, attachGlobals } from './cmo3/emitContext.js';
import { emitAllMeshLayersAndKeyforms } from './cmo3/meshLayerKeyform.js';
import { buildEyeContexts } from './cmo3/eyeContexts.js';
import { emitPerPartRigWarps } from './cmo3/perPartRigWarps.js';
import { emitArtMeshSources } from './cmo3/artMeshSourceEmit.js';

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
  // Logic in `cmo3/artMeshSourceEmit.js` (sweep #44). Emits the
  // CArtMeshSource per mesh, including per-mesh keyform branches
  // (baked / closure / neck-corner / variant / default) + populates
  // `rigCollector.artMeshes` for the rigSpec session cache.
  const { meshSrcIds } = emitArtMeshSources(ctx, {
    meshWarpDeformerGuids,
    rigWarpBbox,
    groupMap,
    deformerWorldOrigins,
    groupDeformerGuids,
    eyelashMeshBboxPerSide,
    eyelashBandCanvas,
    eyelashShiftCanvas,
    bboxFromVertsY,
  });

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
