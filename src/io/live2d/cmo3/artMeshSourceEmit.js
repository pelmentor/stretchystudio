// @ts-nocheck

/**
 * CArtMeshSource per-mesh emit (Section 4) for the .cmo3 generator.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #44).
 *
 * For every mesh in `perMesh`, allocates a CArtMeshSource and walks
 * through:
 *
 *   1. Resolve the deformer this mesh's keyforms live under:
 *      - `meshWarpDeformerGuids[partId]`     → per-part rig warp.
 *      - `pm.hasBakedKeyforms`                → ARM rotation deformer
 *        (group of the bone's parent), or root if absent.
 *      - jointBone / parent-group rotation deformer.
 *      - Else ROOT.
 *      Walks up the group hierarchy if the immediate dfOwner has no
 *      registered deformer origin.
 *
 *   2. Project canvas-space verts into the keyform-position space:
 *      - Under rig warp → 0..1 of the rig warp's canvas bbox.
 *      - Under any other deformer → pivot-relative pixels.
 *      - No deformer → canvas pixels.
 *
 *   3. Emit ACDrawableSource + parent guids + clip refs (resolved by
 *      `resolveMaskPairings`), edit-mesh extension (with pointPriority
 *      + edge list from triangles), texture-input ref, mesh-generator
 *      extension with the full Cubism polygon-density preset.
 *
 *   4. Branch on the mesh's keyform plan to emit CArtMeshForm entries:
 *
 *        hasBakedKeyforms       — N forms via per-vertex rotation
 *                                  around `jointPivot` × boneWeight.
 *        hasEyelidClosure /
 *        hasEyeVariantCompound  — closed verts via
 *                                  `computeClosedVertsForMesh`; emits
 *                                  2 forms (1D) or 4 corner forms (2D).
 *        hasNeckCornerShapekeys — 3 forms shifted by smoothstep-faded
 *                                  cornerness × NECK_CORNER_TILT_FRAC.
 *        hasEmotionVariantOnly  — 2 forms (hidden 0 / visible 1).
 *        hasBaseFadeOnly        — 2 forms (visible 1 / hidden 0).
 *        default                — 1 rest-pose form on ParamOpacity[1.0].
 *
 *   5. Mirror the same `(parameter, keys, vertexPositions, opacity)`
 *      tuples into `rigCollector.artMeshes` so the rigSpec session
 *      cache (used by useRigSpecStore + scenePass) sees art-mesh
 *      keyforms in the same emit run that produced the warp /
 *      rotation deformers.
 *
 *   6. Append base canvas-pixel positions + UVs + texture/state
 *      attributes that Cubism reads back for texture mapping.
 *
 * Returns the populated `meshSrcIds` array (consumed by Section 5's
 * CModelImageGroup builder).
 *
 * @module io/live2d/cmo3/artMeshSourceEmit
 */

import { uuid } from '../xmlbuilder.js';
import { variantParamId } from '../../psdOrganizer.js';
import { sanitisePartName } from '../../../lib/partId.js';
import { computeClosedVertsForMesh } from './eyeClosureApply.js';
import { resolveMaskPairings } from './maskResolve.js';
import { EYE_PART_TAGS } from './eyeTags.js';

/**
 * Emit one CArtMeshSource per mesh and populate `rigCollector.artMeshes`.
 *
 * @param {import('./emitContext.js').EmitContext} ctx
 * @param {Object} opts
 * @param {Map<string, string>} opts.meshWarpDeformerGuids
 * @param {Map<string, {gridMinX: number, gridMinY: number, gridW: number, gridH: number}>} opts.rigWarpBbox
 * @param {Map<string, any>} opts.groupMap
 * @param {Map<string, {x: number, y: number}>} opts.deformerWorldOrigins
 * @param {Map<string, string>} opts.groupDeformerGuids
 * @param {Map<string, {minY: number, maxY: number, H: number}>} opts.eyelashMeshBboxPerSide
 * @param {Map<string, Array<[number, number]>>} opts.eyelashBandCanvas
 * @param {Map<string, number>} opts.eyelashShiftCanvas
 * @param {(verts: number[]) => {minY: number, maxY: number, H: number}|null} opts.bboxFromVertsY
 * @returns {{ meshSrcIds: Array<string|number> }}
 */
export function emitArtMeshSources(ctx, opts) {
  const {
    x, meshes, perMesh,
    pidPartGuid, pidCoord, pidDeformerRoot,
    bakedAngles: BAKED_ANGLES,
    boneParamGuids,
    groupPartGuids,
    rigCollector, rigDebugLog,
    maskConfigs,
    configs,
  } = ctx;
  const {
    meshWarpDeformerGuids,
    rigWarpBbox,
    groupMap,
    deformerWorldOrigins,
    groupDeformerGuids,
    eyelashMeshBboxPerSide,
    eyelashBandCanvas,
    eyelashShiftCanvas,
    bboxFromVertsY,
  } = opts;
  const EYE_CLOSURE_LASH_STRIP_FRAC = configs.eyeClosureLashStripFrac;

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
    // The rig-warp emission block sanitises the mesh name to derive its
    // CDeformerId — match the same transform here so artMesh.parent.id
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
      // gets a rotation deformer (skipped at section 3b because it lives
      // in `boneParamGuids`). Mirror the XML fallback: parent to the arm
      // group's `GroupRotation_<id>` deformer when present; else root
      // with canvas-px verts (chainEval can't walk a missing parent).
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
      if (rigDebugLog && EYE_PART_TAGS.has(meshTag)) {
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

  return { meshSrcIds };
}
