// @ts-nocheck

/**
 * Per-mesh layer + keyform emission for the .cmo3 generator.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #42).
 *
 * Owns the entire `for (let mi = 0; mi < meshes.length; mi++)` body
 * that runs *after* the PSD/CLayerGroup shells have been allocated and
 * after the eye-closure parabola fits + variant pairing maps are
 * computed. Produces:
 *
 *   - Per-mesh CDrawableGuid / CModelImageGuid / GTextureGuid /
 *     CExtensionGuid / GEditableMeshGuid allocations (each shared once).
 *   - CImageResource (canvas-sized) + CLayer with bounds + identifier.
 *   - Filter graph + texture inputs (delegated to `meshLayer.js`).
 *   - KeyformGridSource per mesh, with the appropriate keyform branch:
 *
 *       hasBakedKeyforms       — N-keyform bone-rotation grid.
 *       hasEyelidClosure       — 2-keyform (closed/open) blink.
 *       hasNeckCornerShapekeys — 3-keyform (−30/0/+30) ParamAngleX shape.
 *       hasEyeVariantCompound  — 4-corner 2D grid (closure × variant)
 *                                with two independent KeyformBindingSources.
 *       hasEmotionVariantOnly  — 2-keyform (hidden/visible) variant fade-in.
 *       hasBaseFadeOnly        — 2-keyform (visible/hidden) base fade-out
 *                                paired with a variant sibling (non-backdrop).
 *       default                — single ParamOpacity[1.0] keyform.
 *
 *   - Closed-canvas-verts cache (when closure data exists), copied onto
 *     `rigCollector.eyeClosure` so moc3writer can emit blink keyforms.
 *   - One entry pushed onto `ctx.perMesh` per mesh, plus one entry onto
 *     `ctx.layerRefs` for the post-loop CLayerGroup/CLayeredImage fill.
 *
 * @module io/live2d/cmo3/meshLayerKeyform
 */

import { uuid } from '../xmlbuilder.js';
import { variantParamId } from '../../psdOrganizer.js';
import { emitMeshFilterGraph, emitMeshTexture } from './meshLayer.js';
import { computeClosedCanvasVerts } from './eyeClosureApply.js';

/**
 * @typedef {Object} MeshLayerPrepass
 * @property {string|number} pidLi             - Shared CLayeredImage pid.
 * @property {string|number} pidLg             - Shared CLayerGroup pid.
 * @property {Map<string, any>} variantParamPidBySuffix
 * @property {Map<string, string[]>} variantSuffixesByBasePartId
 * @property {Set<string>} backdropTagsSet
 * @property {string|number|undefined} pidParamEyeLOpenEarly
 * @property {string|number|undefined} pidParamEyeROpenEarly
 * @property {string|number|undefined} pidParamAngleXEarly
 * @property {Map<string, any>} eyewhiteCurvePerSide
 * @property {Map<string, any>} variantEyewhiteCurvePerSideAndSuffix
 * @property {Map<string, {minY: number, maxY: number, H: number}>} eyelashMeshBboxPerSide
 * @property {Map<string, Array<[number, number]>>} eyelashBandCanvas
 * @property {Map<string, number>} eyelashShiftCanvas
 * @property {(verts: number[]) => {minY: number, maxY: number, H: number}|null} bboxFromVertsY
 */

/**
 * Emit every mesh's layer + keyform XML and populate `ctx.perMesh` /
 * `ctx.layerRefs` / `ctx.rigCollector.eyeClosure`.
 *
 * @param {import('./emitContext.js').EmitContext} ctx
 * @param {MeshLayerPrepass} prepass
 */
export function emitAllMeshLayersAndKeyforms(ctx, prepass) {
  const {
    x, canvasW, canvasH, meshes, generateRig,
    pidBlend, pidParamOpacity,
    bakedAngles: BAKED_ANGLES,
    boneParamGuids,
    pidFdefSel, pidFdefFlt,
    filterValueIds, filterValues,
    perMesh, layerRefs, rigCollector,
    configs,
  } = ctx;
  const {
    pidLi, pidLg,
    variantParamPidBySuffix,
    variantSuffixesByBasePartId,
    backdropTagsSet,
    pidParamEyeLOpenEarly,
    pidParamEyeROpenEarly,
    pidParamAngleXEarly,
    eyewhiteCurvePerSide,
    variantEyewhiteCurvePerSideAndSuffix,
    eyelashMeshBboxPerSide,
    eyelashBandCanvas,
    eyelashShiftCanvas,
    bboxFromVertsY,
  } = prepass;
  const EYE_CLOSURE_LASH_STRIP_FRAC = configs.eyeClosureLashStripFrac;
  const EYE_CLOSURE_TAGS = new Set(configs.eyeClosureTagsList);

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

    // FILTER GRAPH (per-mesh) + GTexture2D + CTextureInputExtension —
    // see `cmo3/meshLayer.js`.
    const { pidFset } = emitMeshFilterGraph(x, {
      mi,
      filterDefs: { pidFdefSel, pidFdefFlt },
      filterValueIds, filterValues,
    });
    const { pidTex2d, pidTie, pidTimi, tieSup } = emitMeshTexture(x, {
      meshName, pidImg, pidTexGuid, pidExtTex, pidMiGuid,
    });

    // Keyform system — baked bone-weight keyforms for meshes with boneWeights,
    // eyelash-l uses per-vertex closure keyforms (Session 17),
    // otherwise single keyform bound to ParamOpacity (existing behavior)
    const hasBakedKeyforms = !!(m.boneWeights && m.jointBoneId && boneParamGuids.has(m.jointBoneId));
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
    const isBackdrop = backdropTagsSet.has(m.tag);
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
}
