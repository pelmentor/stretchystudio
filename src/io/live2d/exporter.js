/**
 * Main Live2D export orchestrator.
 *
 * Coordinates all generators (model3.json, cdi3.json, motion3.json, moc3,
 * texture atlas) and packages the result as a downloadable ZIP file.
 *
 * @module io/live2d/exporter
 */

import { generateModel3Json } from './model3json.js';
import { generateCdi3Json } from './cdi3json.js';
import { generateMotion3Json } from './motion3json.js';
import { generatePhysics3Json } from './physics3json.js';
import { generateMoc3 } from './moc3writer.js';
import { packTextureAtlas } from './textureAtlas.js';
import { generateCmo3 } from './cmo3writer.js';
import { generateCan3 } from './can3writer.js';
import { buildMotion3, PRESETS, resultToSsAnimation } from './idle/builder.js';
import { buildParameterSpec } from './rig/paramSpec.js';
import { resolveMaskConfigs } from './rig/maskConfigs.js';
import { resolvePhysicsRules } from './rig/physicsConfig.js';
import { resolveBoneConfig } from './rig/boneConfig.js';
import { resolveVariantFadeRules } from './rig/variantFadeRules.js';
import { resolveEyeClosureConfig } from './rig/eyeClosureConfig.js';
import { resolveRotationDeformerConfig } from './rig/rotationDeformerConfig.js';
import { resolveAutoRigConfig } from './rig/autoRigConfig.js';
import { resolveFaceParallax } from './rig/faceParallaxStore.js';
import { resolveBodyWarp } from './rig/bodyWarpStore.js';
import { resolveRigWarps } from './rig/rigWarpsStore.js';
import { matchTag } from '../armatureOrganizer.js';
import { extractVariant } from '../psdOrganizer.js';

/**
 * @typedef {Object} ExportOptions
 * @property {string}   modelName   - Base name (e.g. "character")
 * @property {number}   [atlasSize=2048] - Texture atlas size
 * @property {boolean}  [exportMotions=true] - Whether to include .motion3.json files from project.animations
 * @property {boolean}  [generatePhysics=true] - Emit `physics3.json` from PHYSICS_RULES
 * @property {string[]} [physicsDisabledCategories=null] - Category names to suppress (`'hair'`, `'clothing'`, `'bust'`, `'arms'`)
 * @property {Array<string | {preset:string, personality?:string, durationSec?:number, seed?:number}>} [motionPresets]
 *                    Procedural motion presets to synthesise as `.motion3.json` files and register
 *                    in `model3.json`'s `Motions` block. Each preset becomes its own group named
 *                    after the preset's label (e.g. `Idle`, `Listening`, `TalkingIdle`, `EmbarrassedHold`).
 * @property {function} [onProgress] - Progress callback (message: string)
 */

/**
 * Export a Stretchy Studio project as a Live2D Cubism model in a ZIP file.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {Map<string, HTMLImageElement>} images - Loaded texture images
 * @param {ExportOptions} opts
 * @returns {Promise<Blob>} ZIP blob ready for download
 */
export async function exportLive2D(project, images, opts = {}) {
  const {
    modelName = 'model',
    atlasSize = 2048,
    exportMotions = true,
    generatePhysics = true,
    physicsDisabledCategories = null,
    motionPresets = [],
    onProgress = () => {},
  } = opts;

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  // --- Step 0: Build the canonical parameter spec ---
  // Single source of truth shared with cmo3writer and moc3writer. All
  // downstream consumers (cdi3, physics3, motion presets, model3 SDK groups)
  // pull from this list — replaces the empty `project.parameters ?? []`
  // reads that left the runtime model with no rig at all.
  const meshNodesForSpec = project.nodes.filter(n =>
    n.type === 'part' && n.mesh && n.visible !== false
  );
  const groupNodesForSpec = project.nodes.filter(n => n.type === 'group');
  const boneConfigResolved = resolveBoneConfig(project);
  const rotationDeformerConfigResolved = resolveRotationDeformerConfig(project);
  const autoRigConfigResolved = resolveAutoRigConfig(project);
  const faceParallaxSpecResolved = resolveFaceParallax(project);
  const bodyWarpChainResolved = resolveBodyWarp(project);
  const rigWarpsResolved = resolveRigWarps(project);
  const paramSpec = buildParameterSpec({
    baseParameters: project.parameters ?? [],
    meshes: meshNodesForSpec.map(n => ({
      variantSuffix: n.variantSuffix ?? null,
      variantRole: n.variantRole ?? null,
      jointBoneId: n.mesh?.jointBoneId ?? null,
      boneWeights: n.mesh?.boneWeights ?? null,
    })),
    groups: groupNodesForSpec,
    generateRig: true,
    bakedKeyformAngles: boneConfigResolved.bakedKeyformAngles,
    rotationDeformerConfig: rotationDeformerConfigResolved,
  });

  // --- Step 1: Pack textures ---
  onProgress('Packing texture atlas...');
  const { atlases, regions } = await packTextureAtlas(project, images, { atlasSize });

  // Write atlas PNGs
  const textureDir = `${modelName}.${atlasSize}`;
  const textureFiles = [];
  const textureFolder = zip.folder(textureDir);

  for (let i = 0; i < atlases.length; i++) {
    const filename = `texture_${String(i).padStart(2, '0')}.png`;
    textureFolder.file(filename, atlases[i].blob);
    textureFiles.push(`${textureDir}/${filename}`);
  }

  // --- Step 2: Build RigSpec via cmo3writer (rigOnly mode) ---
  // The runtime path uses cmo3writer as the rig generator (Phase C interim
  // architecture). cmo3writer in rigOnly mode short-circuits before XML /
  // CAFF emission and returns the RigSpec containing the body warp chain
  // (BZ/BY/Breath/BX), neck warp, and face rotation. moc3writer translates
  // that spec into binary deformer sections so the runtime model actually
  // responds to ParamBodyAngleX/Y/Z, ParamBreath, and ParamAngleZ.
  onProgress('Building rig spec...');
  const meshesForRig = await buildMeshesForRig(project, images);
  const groupsForRig = project.nodes.filter(n => n.type === 'group').map(g => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));
  let rigSpec = null;
  const maskConfigs = resolveMaskConfigs(project);
  const variantFadeRulesResolved = resolveVariantFadeRules(project);
  const eyeClosureConfigResolved = resolveEyeClosureConfig(project);
  try {
    const rigResult = await generateCmo3({
      canvasW: project.canvas?.width ?? 800,
      canvasH: project.canvas?.height ?? 600,
      meshes: meshesForRig,
      groups: groupsForRig,
      parameters: project.parameters ?? [],
      animations: [],
      modelName,
      generateRig: true,
      generatePhysics: false,
      physicsDisabledCategories,
      rigOnly: true,
      maskConfigs,
      bakedKeyformAngles: boneConfigResolved.bakedKeyformAngles,
      variantFadeRules: variantFadeRulesResolved,
      eyeClosureConfig: eyeClosureConfigResolved,
      rotationDeformerConfig: rotationDeformerConfigResolved,
      autoRigConfig: autoRigConfigResolved,
      faceParallaxSpec: faceParallaxSpecResolved,
      bodyWarpChain: bodyWarpChainResolved,
      rigWarps: rigWarpsResolved,
    });
    rigSpec = rigResult.rigSpec;
  } catch (err) {
    console.warn('[exportLive2D] rigSpec build failed; runtime moc3 will ship without deformers:', err);
  }

  // --- Step 3: Generate .moc3 ---
  onProgress('Generating .moc3 binary...');
  // generateRig:true emits the SDK-standard parameter list (ParamAngleX/Y/Z,
  // EyeBlink, MouthOpen, …) plus auto-detected variant + bone params via the
  // shared paramSpec builder. rigSpec carries the warp + rotation deformers
  // and their keyforms — without it, moc3 ships mesh-only (legacy mode).
  const moc3Buffer = generateMoc3({
    project,
    regions,
    atlasSize,
    numAtlases: atlases.length,
    generateRig: true,
    rigSpec,
    bakedKeyformAngles: boneConfigResolved.bakedKeyformAngles,
    variantFadeRules: variantFadeRulesResolved,
    rotationDeformerConfig: rotationDeformerConfigResolved,
  });
  zip.file(`${modelName}.moc3`, moc3Buffer);

  // --- Step 3: Generate .motion3.json files ---
  // Build parameterMap: maps SS track keys to Live2D parameter IDs.
  // groupId.rotation → ParamRotation_GroupName (rotation deformers)
  // partId.mesh_verts → ParamDeform_MeshName (warp deformers)
  const parameterMap = new Map();
  const allGroups = project.nodes.filter(n => n.type === 'group');
  for (const g of allGroups) {
    const sanitized = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
    parameterMap.set(`${g.id}.rotation`, `ParamRotation_${sanitized}`);
  }
  // Warp deformer parameters for mesh_verts tracks
  const meshPartsWithMesh = project.nodes.filter(n => n.type === 'part' && n.mesh);
  for (const p of meshPartsWithMesh) {
    const sanitized = (p.name || p.id).replace(/[^a-zA-Z0-9_]/g, '_');
    parameterMap.set(`${p.id}.mesh_verts`, `ParamDeform_${sanitized}`);
  }

  const motionFiles = [];
  if (exportMotions && project.animations?.length > 0) {
    onProgress('Generating motion files...');
    const motionFolder = zip.folder('motion');

    for (const anim of project.animations) {
      const sanitized = sanitizeName(anim.name);
      const filename = `${sanitized}.motion3.json`;
      const motion = generateMotion3Json(anim, { parameterMap });
      motionFolder.file(filename, JSON.stringify(motion, null, '\t'));
      motionFiles.push(`motion/${filename}`);
    }
  }

  // --- Step 4: Generate .cdi3.json ---
  onProgress('Generating display info...');
  const groups = project.nodes.filter(n => n.type === 'group');
  const meshParts = project.nodes.filter(n =>
    n.type === 'part' && n.mesh && n.visible !== false && regions.has(n.id)
  );

  const cdi3 = generateCdi3Json({
    parameters: paramSpec.map(p => ({
      id: p.id,
      name: p.name,
      groupId: undefined,
    })),
    parts: groups.map(g => ({
      id: g.id,
      name: g.name ?? g.id,
    })),
  });

  const cdi3File = `${modelName}.cdi3.json`;
  zip.file(cdi3File, JSON.stringify(cdi3, null, '\t'));

  // --- Step 4.5: Generate .physics3.json ---
  // Built from the same PHYSICS_RULES source-of-truth that the cmo3 emitter uses,
  // so disabledCategories / requireTag gating stays in step across both export
  // paths. Skipped (not zipped) if no rules survive gating, or if user opted out.
  let physicsFile = null;
  if (generatePhysics) {
    onProgress('Generating physics...');
    const disabledSet = physicsDisabledCategories
      ? new Set(physicsDisabledCategories)
      : null;
    const physics3 = generatePhysics3Json({
      paramDefs: paramSpec,
      meshes: meshParts.map(p => ({ tag: matchTag(p.name || p.id) })),
      rules: resolvePhysicsRules(project),
      disabledCategories: disabledSet,
    });
    if (physics3.PhysicsSettings.length > 0) {
      physicsFile = `${modelName}.physics3.json`;
      zip.file(physicsFile, JSON.stringify(physics3, null, '\t'));
    } else {
      console.warn('[exportLive2D] physics3 has 0 settings, skipping');
    }
  }

  // --- Step 4.6: Procedural motion presets ---
  // Each enabled preset (idle/listening/talkingIdle/embarrassedHold) is
  // synthesised directly to runtime motion3.json. No Cubism Editor round-trip
  // required — Ren'Py / Cubism SDK loads model3.json and finds them via the
  // Motions block.
  /** @type {Object<string, Array<{File:string}>>} */
  const motionsByGroup = {};
  if (motionFiles.length > 0) {
    motionsByGroup.Idle = motionFiles.map(f => ({ File: f }));
  }
  if (Array.isArray(motionPresets) && motionPresets.length > 0) {
    onProgress('Synthesising procedural motions...');
    const paramIds = paramSpec.map(p => p.id);
    const motionFolder = zip.folder('motion');
    for (const entry of motionPresets) {
      const cfg = typeof entry === 'string' ? { preset: entry } : (entry ?? {});
      const preset = cfg.preset;
      if (!preset || !PRESETS[preset]) {
        console.warn(`[exportLive2D] unknown motion preset '${preset}', skipping`);
        continue;
      }
      try {
        const result = buildMotion3({
          preset,
          paramIds,
          physicsOutputIds: new Set(),
          durationSec: cfg.durationSec ?? 8,
          fps: 30,
          personality: cfg.personality ?? 'calm',
          seed: cfg.seed ?? 1,
        });
        if (result.validationErrors.length > 0) {
          console.warn(`[exportLive2D] ${preset}: validation errors, skipping:`, result.validationErrors);
          continue;
        }
        if (result.animatedIds.length === 0) {
          console.warn(`[exportLive2D] ${preset}: 0 curves, skipping`);
          continue;
        }
        const slug = preset.replace(/([A-Z])/g, '_$1').toLowerCase();
        const filename = `${modelName}_${slug}.motion3.json`;
        motionFolder.file(filename, JSON.stringify(result.motion3, null, '\t'));
        const groupName = PRESETS[preset].label.replace(/\s+/g, '');
        if (!motionsByGroup[groupName]) motionsByGroup[groupName] = [];
        motionsByGroup[groupName].push({ File: `motion/${filename}` });
        // Keep resultToSsAnimation reachable for future bidirectional flows
        // (e.g. wiring back into a .can3 if we ever bundle one alongside).
        void resultToSsAnimation;
      } catch (err) {
        console.warn(`[exportLive2D] ${preset}: synthesis failed:`, err.message);
      }
    }
  }

  // --- Step 5: Generate .model3.json ---
  // Auto-discover LipSync / EyeBlink groups from the canonical paramSpec so
  // SDK mouth-sync features work out of the box.
  const paramIdSet = new Set(paramSpec.map(p => p.id));
  const sdkGroups = {};
  if (paramIdSet.has('ParamMouthOpenY')) sdkGroups.LipSync = ['ParamMouthOpenY'];
  const blinkParams = ['ParamEyeLOpen', 'ParamEyeROpen'].filter(id => paramIdSet.has(id));
  if (blinkParams.length > 0) sdkGroups.EyeBlink = blinkParams;

  onProgress('Generating model manifest...');
  const model3 = generateModel3Json({
    modelName,
    textureFiles,
    motionsByGroup: Object.keys(motionsByGroup).length > 0 ? motionsByGroup : null,
    motionFiles: Object.keys(motionsByGroup).length > 0 ? [] : motionFiles,  // fallback
    physicsFile,
    displayInfoFile: cdi3File,
    groups: sdkGroups,
  });

  zip.file(`${modelName}.model3.json`, JSON.stringify(model3, null, '\t'));

  // --- Step 6: Package ZIP ---
  onProgress('Creating ZIP...');
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Export a Stretchy Studio project as a .cmo3 (Cubism Editor project file).
 *
 * Unlike the runtime export (.moc3 + atlas), the project export gives each
 * mesh its own texture PNG inside a CAFF archive, so the model can be further
 * edited in Cubism Editor 5.0.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {Map<string, HTMLImageElement>} images - Loaded texture images
 * @param {object} opts
 * @param {string} [opts.modelName='model']
 * @param {boolean} [opts.generateRig=false] - Generate standard Live2D rig (warp deformers, standard params)
 * @param {boolean} [opts.generatePhysics] - Emit CPhysicsSettingsSourceSet (hair + clothing pendulums). Defaults to `generateRig`.
 * @param {string[]} [opts.physicsDisabledCategories] - Category names to SUPPRESS (e.g. ['hair'] for buzz-cut characters).
 * @param {Array<string | {preset:string, personality?:string, durationSec?:number, seed?:number}>} [opts.motionPresets]
 *                   Motions to synthesise into the bundled `.can3` as editable scenes for Cubism Editor.
 *                   Each entry is either a bare preset name (uses default personality/duration) or an object
 *                   with per-motion overrides `{preset, personality, durationSec, seed}`. Once the user
 *                   re-exports the project from Cubism Editor (File → Export → For Runtime), Cubism produces
 *                   the `.motion3.json` files itself from the .can3 scenes — so we don't ship runtime
 *                   motion files alongside the cmo3 (they would be stale the moment the user tweaks a scene).
 *                   Valid preset names: `idle`, `listening`, `talkingIdle`, `embarrassedHold`.
 *                   Empty/omitted = no motions synthesised.
 * @param {function} [opts.onProgress]
 * @returns {Promise<Blob>} .cmo3 blob ready for download
 */
export async function exportLive2DProject(project, images, opts = {}) {
  const {
    modelName = 'model',
    generateRig = false,
    generatePhysics = generateRig,
    physicsDisabledCategories = null,
    motionPresets = [],
    onProgress = () => {},
  } = opts;

  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;

  // Collect visible parts with meshes.
  // Sort by draw_order (descending) to maintain correct depth ordering (upstream fix).
  const meshParts = project.nodes
    .filter(n =>
      n.type === 'part' && n.mesh && n.visible !== false
    )
    .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

  onProgress(`Preparing ${meshParts.length} meshes...`);

  // Collect groups (for part hierarchy + deformers in .cmo3)
  const groups = project.nodes.filter(n => n.type === 'group').map(g => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));

  const meshes = [];
  for (let i = 0; i < meshParts.length; i++) {
    const part = meshParts[i];
    const mesh = part.mesh;
    const meshName = part.name || `ArtMesh${i}`;

    // Find image for this part
    const texId = part.textureId ?? part.id;
    const img = images.get(texId) ?? images.get(part.id);
    if (!img) continue;

    const fullW = img.naturalWidth || img.width;
    const fullH = img.naturalHeight || img.height;
    if (fullW === 0 || fullH === 0) continue;

    onProgress(`Encoding texture ${i + 1}/${meshParts.length}...`);

    // For .cmo3: render full canvas-sized PNG (CLayeredImage covers entire canvas)
    // Mesh vertices and textures are already in canvas space (PSD layers are canvas-sized)
    const pngData = await renderPartToCanvasPng(img, fullW, fullH, canvasW, canvasH);

    // Flatten vertices: Array<{x,y}> → [x0,y0, x1,y1, ...]
    // CRITICAL: Use restX/restY (original positions) not x/y (possibly deformed by bone rotation).
    // When a user rotates an elbow in SS before exporting, v.x/v.y are permanently committed
    // but UVs/textures are based on rest positions. Using rest positions ensures correct texture mapping.
    // Baked keyforms (below) handle posing via parameters.
    const vertices = [];
    for (const v of mesh.vertices) {
      vertices.push(v.restX ?? v.x, v.restY ?? v.y);
    }

    // Flatten triangles: Array<[i,j,k]> → [i0,j0,k0, ...]
    const triangles = [];
    for (const tri of mesh.triangles) {
      triangles.push(tri[0], tri[1], tri[2]);
    }

    // UVs — vertex positions normalized to canvas dimensions.
    // CRITICAL: Use restX/restY (same as vertices above) for UV computation.
    // cmo3writer.js transforms keyform positions to deformer-local space separately.
    const uvs = [];
    for (const v of mesh.vertices) {
      let u = Math.max(0, Math.min(1, (v.restX ?? v.x) / canvasW));
      let vv = Math.max(0, Math.min(1, (v.restY ?? v.y) / canvasH));
      uvs.push(u, vv);
    }

    // Bone weight data for baked keyforms
    const boneWeights = mesh.boneWeights ?? null;
    const jointBoneId = mesh.jointBoneId ?? null;
    // Find the elbow pivot in canvas space (jointBone's transform.pivotX/Y)
    let jointPivotX = null, jointPivotY = null;
    if (jointBoneId && boneWeights) {
      const jointBone = project.nodes.find(n => n.id === jointBoneId);
      if (jointBone?.transform) {
        jointPivotX = jointBone.transform.pivotX ?? 0;
        jointPivotY = jointBone.transform.pivotY ?? 0;
      }
    }

    // variantSuffix is the source of truth, written by variantNormalizer at
    // import time. Fall back to the name-based detection for defensive
    // reasons — an export on a project that skipped normalization will
    // still behave sensibly.
    const variantSuffix =
      part.variantSuffix ?? extractVariant(meshName).variant ?? null;

    meshes.push({
      name: meshName,
      tag: matchTag(meshName),
      variantRole: variantSuffix,    // kept for compat; same value as variantSuffix
      variantSuffix,                 // new canonical field
      variantOf: part.variantOf ?? null,
      partId: part.id,
      parentGroupId: part.parent ?? null,
      jointBoneId,
      boneWeights,
      jointPivotX,
      jointPivotY,
      drawOrder: part.draw_order ?? i,
      vertices,
      triangles,
      uvs,
      pngData,
      texWidth: canvasW,
      texHeight: canvasH,
    });
  }

  if (meshes.length === 0) {
    const partCount = meshParts.length;
    const texCount = images.size;
    throw new Error(
      partCount === 0
        ? 'No visible parts with meshes found. Generate meshes before exporting.'
        : `Found ${partCount} parts but no matching textures (${texCount} textures loaded). Check that parts have textureId matching a texture.`
    );
  }

  onProgress(`Generating .cmo3 (${meshes.length} meshes)...`);

  const { cmo3, deformerParamMap, rigDebugLog } = await generateCmo3({
    canvasW,
    canvasH,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: project.animations ?? [],
    modelName,
    generateRig,
    generatePhysics,
    physicsDisabledCategories,
    maskConfigs: resolveMaskConfigs(project),
    physicsRules: resolvePhysicsRules(project),
    bakedKeyformAngles: resolveBoneConfig(project).bakedKeyformAngles,
    variantFadeRules: resolveVariantFadeRules(project),
    eyeClosureConfig: resolveEyeClosureConfig(project),
    rotationDeformerConfig: resolveRotationDeformerConfig(project),
    autoRigConfig: resolveAutoRigConfig(project),
    faceParallaxSpec: resolveFaceParallax(project),
    bodyWarpChain: resolveBodyWarp(project),
    rigWarps: resolveRigWarps(project),
  });

  // --- Motion synthesis (optional) ---
  // Each requested preset becomes a parameter-track SS animation appended to
  // `animations`. Flowing through generateCan3 emits a .can3 scene with bezier
  // keyframes on each Standard Parameter, directly editable in Cubism Editor
  // (open .cmo3 → Animation workspace → File → Open the .can3 → pick scene
  // from list). The user then re-exports runtime files from Editor, which
  // produces the .motion3.json files from the (possibly tweaked) scenes —
  // so we deliberately don't ship runtime motion3 here.
  //
  // Presets currently available: idle, listening, talkingIdle, embarrassedHold.
  let animations = project.animations ?? [];
  if (Array.isArray(motionPresets) && motionPresets.length > 0) {
    // Use the same paramSpec the cmo3 writer just built — `project.parameters`
    // is empty for fresh PSD imports, so motion presets used to silently skip
    // every preset (no params to target).
    const paramIds = buildParameterSpec({
      baseParameters: project.parameters ?? [],
      meshes,
      groups,
      generateRig,
    }).map(p => p.id);
    for (const entry of motionPresets) {
      // Normalise both shapes: bare string OR object with overrides.
      const cfg = typeof entry === 'string' ? { preset: entry } : (entry ?? {});
      const preset = cfg.preset;
      if (!preset || !PRESETS[preset]) {
        console.warn(`[exportLive2DProject] unknown motion preset '${preset}', skipping`);
        continue;
      }
      const personality = cfg.personality ?? 'calm';
      const durationSec = cfg.durationSec ?? 8;
      const seed = cfg.seed ?? 1;
      onProgress(`Synthesising ${PRESETS[preset].label} motion...`);
      try {
        const result = buildMotion3({
          preset,
          paramIds,
          physicsOutputIds: new Set(),
          durationSec,
          fps: 30,
          personality,
          seed,
        });
        if (result.validationErrors.length > 0) {
          console.warn(`[exportLive2DProject] ${preset}: validation errors, skipping:`, result.validationErrors);
          continue;
        }
        if (result.animatedIds.length === 0) {
          console.warn(`[exportLive2DProject] ${preset}: 0 curves (no Standard Parameters present), skipping`);
          continue;
        }
        const { animation } = resultToSsAnimation(result);
        animations = [...animations, animation];
      } catch (err) {
        console.warn(`[exportLive2DProject] ${preset}: synthesis failed:`, err.message);
      }
    }
  }

  const hasAnimations = animations.length > 0 && deformerParamMap.size > 0;
  const hasRigDebug = !!rigDebugLog;

  // Bundle into ZIP when we have animations OR rig debug log.
  if (hasAnimations || hasRigDebug) {
    const cmo3FileName = `${modelName}.cmo3`;
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file(cmo3FileName, cmo3);

    if (hasAnimations) {
      onProgress('Generating .can3 animation...');
      const can3 = await generateCan3({
        animations, deformerParamMap, cmo3FileName, canvasW, canvasH, modelName,
      });
      zip.file(`${modelName}.can3`, can3);
    }

    if (hasRigDebug) {
      zip.file(`${modelName}.rig.log.json`, JSON.stringify(rigDebugLog, null, 2));
    }

    return zip.generateAsync({ type: 'blob' });
  }

  return new Blob([cmo3], { type: 'application/octet-stream' });
}

/**
 * Build the mesh array `generateCmo3` expects, but WITHOUT PNG rendering.
 * Used by the runtime export path (`exportLive2D`) when invoking cmo3writer
 * in rigOnly mode — that mode short-circuits before the CAFF packing step
 * so per-mesh PNGs are never read. We pass empty pngData placeholders.
 *
 * The rig builders (body warp chain, neck warp, face rotation, …) only need
 * vertices, triangles, tags, jointBoneId, boneWeights, variantSuffix — none
 * of the texture data.
 *
 * @param {object} project
 * @param {Map<string, HTMLImageElement>} _images  unused; kept for parity with the cmo3 path
 * @returns {Promise<Array<object>>}
 */
async function buildMeshesForRig(project, _images) {
  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;
  const meshParts = project.nodes
    .filter(n => n.type === 'part' && n.mesh && n.visible !== false)
    .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));
  const meshes = [];
  for (let i = 0; i < meshParts.length; i++) {
    const part = meshParts[i];
    const mesh = part.mesh;
    const meshName = part.name || `ArtMesh${i}`;
    // Flatten vertices using rest positions (same convention as exportLive2DProject).
    const vertices = [];
    for (const v of mesh.vertices) vertices.push(v.restX ?? v.x, v.restY ?? v.y);
    const triangles = [];
    for (const tri of mesh.triangles) triangles.push(tri[0], tri[1], tri[2]);
    const uvs = [];
    for (const v of mesh.vertices) {
      const u = Math.max(0, Math.min(1, (v.restX ?? v.x) / canvasW));
      const vv = Math.max(0, Math.min(1, (v.restY ?? v.y) / canvasH));
      uvs.push(u, vv);
    }
    const boneWeights = mesh.boneWeights ?? null;
    const jointBoneId = mesh.jointBoneId ?? null;
    let jointPivotX = null, jointPivotY = null;
    if (jointBoneId && boneWeights) {
      const jointBone = project.nodes.find(n => n.id === jointBoneId);
      if (jointBone?.transform) {
        jointPivotX = jointBone.transform.pivotX ?? 0;
        jointPivotY = jointBone.transform.pivotY ?? 0;
      }
    }
    const variantSuffix =
      part.variantSuffix ?? extractVariant(meshName).variant ?? null;
    meshes.push({
      name: meshName,
      tag: matchTag(meshName),
      variantRole: variantSuffix,
      variantSuffix,
      variantOf: part.variantOf ?? null,
      partId: part.id,
      parentGroupId: part.parent ?? null,
      jointBoneId,
      boneWeights,
      jointPivotX,
      jointPivotY,
      drawOrder: part.draw_order ?? i,
      vertices,
      triangles,
      uvs,
      // pngData omitted — rigOnly mode never reads it.
      pngData: new Uint8Array(0),
      texWidth: canvasW,
      texHeight: canvasH,
    });
  }
  return meshes;
}

/**
 * Render a part's full texture onto a canvas-sized PNG with world transform applied.
 * For .cmo3, each layer covers the full canvas (like a PSD layer).
 * The transform places the image in its correct world-space position.
 *
 * @param {HTMLImageElement} img
 * @param {number} srcW - Source image width
 * @param {number} srcH - Source image height
 * @param {number} canvasW - Canvas width
 * @param {number} canvasH - Canvas height
 * @param {number[]} wm - 3x3 column-major world matrix [m0,m1,0, m3,m4,0, m6,m7,1]
 */
async function renderPartToCanvasPngTransformed(img, srcW, srcH, canvasW, canvasH, wm) {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(canvasW, canvasH)
    : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = canvasW;
    canvas.height = canvasH;
  }
  const ctx = canvas.getContext('2d');
  // Apply world transform: canvas 2D setTransform(a, b, c, d, e, f)
  // maps from column-major [m0,m1,0, m3,m4,0, m6,m7,1]
  ctx.setTransform(wm[0], wm[1], wm[3], wm[4], wm[6], wm[7]);
  ctx.drawImage(img, 0, 0, srcW, srcH);
  ctx.resetTransform();

  let blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Render a part's full texture onto a canvas-sized PNG (no transform).
 * Legacy — kept for backward compatibility.
 */
async function renderPartToCanvasPng(img, srcW, srcH, canvasW, canvasH) {
  return renderPartToCanvasPngTransformed(img, srcW, srcH, canvasW, canvasH, [1,0,0, 0,1,0, 0,0,1]);
}

/**
 * Sanitize a name for use as a filename.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  return (name ?? 'animation')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
