// @ts-check

/**
 * Shared emission context for the .cmo3 generator (Phase 6, sweep #41).
 *
 * One bag of state passed to every per-section helper instead of long
 * destructured arg lists. Built up incrementally as `generateCmo3` runs:
 *
 *   1. Bootstrap   — `createEmitContext(input)` captures static input
 *      + creates empty accumulators (`perMesh`, `layerRefs`,
 *      `allDeformerSources`, `rigCollector`, `rigDebugLog`).
 *   2. Globals     — `attachGlobals(ctx, _globals)` copies the result
 *      of `setupGlobalSharedObjects` onto the context.
 *   3. Pre-passes  — body/face-parallax/neck warp + eye-closure parabola
 *      fits + per-tag binding map all attach their results before the
 *      heavy emission loops run.
 *   4. Emission    — Section 2/3c/4 helpers (extracted in sweeps
 *      #42–#44) read whichever fields they need and mutate the
 *      accumulators in place.
 *
 * The typedef below is the single catalog of what *can* live on the
 * context. Helpers should JSDoc their `ctx` param against `EmitContext`
 * (or a `Pick<>`-style narrower type once we need it) so a missing
 * field surfaces at type-check time rather than as a `cannot read of
 * undefined` at runtime.
 *
 * @module io/live2d/cmo3/emitContext
 */

import { emptyRigSpec } from '../rig/rigSpec.js';

/**
 * @typedef {import('./globalSetup.js').GlobalSharedSetup} GlobalSharedSetup
 */

/**
 * @typedef {Object} ResolvedConfigs
 * @property {string[]} backdropTagsList
 * @property {string[]} eyeClosureTagsList
 * @property {number}   eyeClosureLashStripFrac
 * @property {number}   eyeClosureBinCount
 * @property {string[]} rotSkipRoles
 * @property {number}   rotParamRangeMin
 * @property {number}   rotParamRangeMax
 * @property {number[]} rotGroupParamKeys
 * @property {number[]} rotGroupAngles
 * @property {number[]} rotFaceParamKeys
 * @property {number[]} rotFaceAngles
 */

/**
 * @typedef {Object} EmitContext
 *
 * Static input — set once in `createEmitContext`.
 * @property {import('../xmlbuilder.js').XmlBuilder} x
 * @property {number}   canvasW
 * @property {number}   canvasH
 * @property {Array<any>} meshes
 * @property {Array<any>} groups
 * @property {Array<any>} parameters
 * @property {Array<any>} animations
 * @property {string}   modelName
 * @property {boolean}  generateRig
 * @property {boolean}  rigOnly
 * @property {Array<any>} maskConfigs
 * @property {any}      physicsRules
 * @property {Array<number>} bakedKeyformAngles
 * @property {any}      autoRigConfig
 * @property {any}      faceParallaxSpec
 * @property {any}      bodyWarpChain
 * @property {Map<string, any>|null} rigWarps
 * @property {ResolvedConfigs} configs
 *
 * Accumulators — appended/mutated during emission.
 * @property {Array<any>} perMesh
 * @property {Array<{pidLayer: string, pidImg: string}>} layerRefs
 * @property {Array<{pid: string, tag: string}>} allDeformerSources
 * @property {ReturnType<typeof emptyRigSpec>} rigCollector
 * @property {any|null} rigDebugLog
 *
 * Globals — set by `attachGlobals` after `setupGlobalSharedObjects`.
 * @property {string|number} [pidParamGroupGuid]
 * @property {string|number} [pidModelGuid]
 * @property {string|number} [pidPartGuid]
 * @property {string|number} [pidBlend]
 * @property {string|number} [pidDeformerRoot]
 * @property {string|number} [pidDeformerNull]
 * @property {string|number} [pidCoord]
 * @property {Array<{id: string, pid: string|number}>} [paramDefs]
 * @property {Array<any>} [paramSpecs]
 * @property {string|number} [pidParamOpacity]
 * @property {number} [bakedAngleMin]
 * @property {number} [bakedAngleMax]
 * @property {Array<number>} [bakedAngles]
 * @property {Map<string, any>} [boneParamGuids]
 * @property {Map<string, string|number>} [groupPartGuids]
 * @property {string|number} [pidFdefSel]
 * @property {string|number} [pidFdefFlt]
 * @property {{pidFvidMiGuid: string, pidFvidMiLayer: string}} [filterValueIds]
 * @property {any} [filterValues]
 *
 * Pre-pass: variant pairing.
 * @property {Map<string, string>} [variantParamPidBySuffix]
 * @property {Map<string, string[]>} [variantSuffixesByBasePartId]
 * @property {Set<string>} [backdropTagsSet]
 *
 * Pre-pass: eye closure (parabola fits per side / per (side, suffix)).
 * @property {Map<string, any>} [eyewhiteCurvePerSide]
 * @property {Map<string, any>} [eyelashMeshBboxPerSide]
 * @property {Map<string, any>} [eyeUnionBboxPerSide]
 * @property {Map<string, any>} [variantEyewhiteCurvePerSideAndSuffix]
 * @property {Map<string, Array<[number, number]>>} [eyelashBandCanvas]
 * @property {Map<string, number>} [eyelashShiftCanvas]
 *
 * Pre-pass: body silhouette.
 * @property {any} [bodyAnalysis]
 * @property {any} [bodyChain]
 * @property {(cx: number) => number} [canvasToBodyXX]
 * @property {(cy: number) => number} [canvasToBodyXY]
 *
 * Pre-pass: face parallax + face pivot.
 * @property {any} [faceUnionBbox]
 * @property {(cx: number) => number} [canvasToFaceUnionX]
 * @property {(cy: number) => number} [canvasToFaceUnionY]
 * @property {number|null} [facePivotCx]
 * @property {number|null} [facePivotCy]
 * @property {string} [facePivotCySource]
 *
 * Pre-pass: neck warp.
 * @property {any} [neckUnionBbox]
 * @property {(cx: number) => number} [canvasToNeckWarpX]
 * @property {(cy: number) => number} [canvasToNeckWarpY]
 *
 * Section 3a–3c: rotation deformers + per-mesh warps + rig warp tag bindings.
 * @property {Map<string, any>} [groupMap]
 * @property {string|null} [headGroupId]
 * @property {string|null} [neckGroupId]
 * @property {Map<string, any>} [groupWorldMatrices]
 * @property {Map<string, {originX: number, originY: number}>} [deformerWorldOrigins]
 * @property {Map<string, string>} [groupDeformerGuids]
 * @property {Array<any>} [rotDeformerTargetNodes]
 * @property {Array<any>} [rotDeformerOriginNodes]
 * @property {Map<string, any>} [deformerParamMap]
 * @property {Map<string, string>} [meshWarpDeformerGuids]
 * @property {Map<string, {gridMinX: number, gridMinY: number, gridW: number, gridH: number}>} [rigWarpBbox]
 * @property {Map<string, any>} [rigWarpDebugInfo]
 * @property {Array<any>} [rigWarpTargetNodesToReparent]
 * @property {Map<string, any>} [tagParamBindings]
 * @property {Object<string, string>} [paramPidByName]
 * @property {Array<any>} [eyeContexts]
 * @property {(tag: string, bboxCx: number, bboxCy: number) => any} [findEyeCtx]
 *
 * Section 3 hierarchy.
 * @property {any} [rootPart]
 * @property {Array<any>} [allPartSources]
 * @property {Map<string, any>} [groupParts]
 */

/**
 * Build the empty context shell. Sets static input + accumulators only;
 * everything else attaches as later passes run.
 *
 * @param {Object} input - The unpacked `Cmo3Input` (already destructured by
 *   the caller so defaults like `parameters=[]` are applied).
 * @param {ResolvedConfigs} configs - Resolved Stage-5/Stage-8 fallbacks
 *   (backdrop tags, eye-closure constants, rotation-deformer mappings).
 * @param {boolean} hasGenerateRig - Mirror of `input.generateRig`; controls
 *   whether `rigDebugLog` is initialised. Kept as a separate arg so the
 *   factory doesn't have to re-read it from `input`.
 * @returns {EmitContext}
 */
export function createEmitContext(input, configs, hasGenerateRig) {
  /** @type {EmitContext} */
  const ctx = {
    x: input.x,
    canvasW: input.canvasW,
    canvasH: input.canvasH,
    meshes: input.meshes,
    groups: input.groups,
    parameters: input.parameters,
    animations: input.animations,
    modelName: input.modelName,
    generateRig: input.generateRig,
    rigOnly: input.rigOnly,
    maskConfigs: input.maskConfigs,
    physicsRules: input.physicsRules,
    bakedKeyformAngles: input.bakedKeyformAngles,
    autoRigConfig: input.autoRigConfig,
    faceParallaxSpec: input.faceParallaxSpec,
    bodyWarpChain: input.bodyWarpChain,
    rigWarps: input.rigWarps,
    configs,

    perMesh: [],
    layerRefs: [],
    allDeformerSources: [],
    rigCollector: emptyRigSpec({ w: input.canvasW, h: input.canvasH }),
    rigDebugLog: hasGenerateRig ? {
      version: 1,
      timestamp: new Date().toISOString(),
      modelName: input.modelName,
      canvas: { W: input.canvasW, H: input.canvasH },
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
    } : null,
  };
  return ctx;
}

/**
 * Copy the result of `setupGlobalSharedObjects` onto `ctx`. Mutates in
 * place so existing `_globals` references in `cmo3writer.js` keep working
 * while callers migrate to reading from `ctx` directly.
 *
 * @param {EmitContext} ctx
 * @param {GlobalSharedSetup} globals
 */
export function attachGlobals(ctx, globals) {
  ctx.pidParamGroupGuid = globals.pidParamGroupGuid;
  ctx.pidModelGuid      = globals.pidModelGuid;
  ctx.pidPartGuid       = globals.pidPartGuid;
  ctx.pidBlend          = globals.pidBlend;
  ctx.pidDeformerRoot   = globals.pidDeformerRoot;
  ctx.pidDeformerNull   = globals.pidDeformerNull;
  ctx.pidCoord          = globals.pidCoord;
  ctx.paramDefs         = globals.paramDefs;
  ctx.paramSpecs        = globals.paramSpecs;
  ctx.pidParamOpacity   = globals.pidParamOpacity;
  ctx.bakedAngleMin     = globals.bakedAngleMin;
  ctx.bakedAngleMax     = globals.bakedAngleMax;
  ctx.bakedAngles       = globals.bakedAngles;
  ctx.boneParamGuids    = globals.boneParamGuids;
  ctx.groupPartGuids    = globals.groupPartGuids;
  ctx.pidFdefSel        = globals.pidFdefSel;
  ctx.pidFdefFlt        = globals.pidFdefFlt;
  ctx.filterValueIds    = globals.filterValueIds;
  ctx.filterValues      = globals.filterValues;
}
