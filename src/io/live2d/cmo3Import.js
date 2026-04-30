// @ts-check
/**
 * .cmo3 → SS project synthesis.
 *
 * Sweep #10 of the Phase 5 round-trip work. Builds on:
 *   - `caffUnpacker.js` — recovers the embedded `main.xml` + PNGs
 *   - `cmo3XmlParser.js` — turns the XML into a tree + xs.id pool
 *   - `cmo3PartExtract.js` — produces structured parts / groups / textures
 *   - `cmo3Inspect.js`  — reads canvas dims + parameter list
 *
 * What this module synthesises:
 *
 *   - `project.canvas`     — pixel dimensions from CImageCanvas
 *   - `project.parameters` — one ParamSpec per CParameterSource
 *   - `project.nodes`      — one node per group / part, parent links
 *                            stitched through the CPartGuid intermediary
 *   - `project.textures`   — one entry per part, pointing at a Blob URL
 *                            of the linked imageFileBuf_N.png
 *   - `project.rigWarps[partId]` — leaf warp deformers (sweep #13)
 *   - `project.maskConfigs`      — clip refs (sweep #17)
 *   - `project.boneConfig`       — detected bone-baked angle set (sweep #20)
 *   - rotation-deformer pivots + boneRole on group nodes (sweep #15)
 *   - variant pairing via `variantNormalizer` (sweep #18)
 *
 * What this module does NOT yet synthesise (each is its own follow-on
 * sweep — the plan row tracks them as deferred):
 *   - Physics rules
 *
 * @module io/live2d/cmo3Import
 */

import { unpackCaff } from './caffUnpacker.js';
import { parseCmo3Xml } from './cmo3XmlParser.js';
import { extractScene } from './cmo3PartExtract.js';
import { CURRENT_SCHEMA_VERSION } from '../../store/projectMigrations.js';
import { uid } from '../../lib/ids.js';
import { normalizeVariants } from '../variantNormalizer.js';
import { readHeaderBits, readParameters } from './cmo3Import/headerExtract.js';
import { buildRigWarpsFromScene } from './cmo3Import/rigWarpSynth.js';
import {
  DEFAULT_TRANSFORM,
  buildGuidToNodeIdMap,
  applyRotationDeformersToGroups,
} from './cmo3Import/rotationDeformerSynth.js';

/**
 * @typedef {import('./cmo3PartExtract.js').ExtractedPart} ExtractedPart
 */

/**
 * @typedef {Object} ImportResult
 * @property {Object} project         The synthesised SS project (loadProject-ready)
 * @property {string[]} warnings      Non-fatal issues — surfaced in the inspector UI
 * @property {Object} stats           {parts, groups, textures, parameters} — for status banner
 */

/**
 * Convert an `ExtractedPart`'s flat position/UV/index arrays into the SS
 * mesh shape:
 *
 *   - `vertices`: Array<{x, y, restX, restY}>  (object array, NOT typed)
 *   - `uvs`: Float32Array (flat)
 *   - `triangles`: Array<[i0, i1, i2]>
 *   - `edgeIndices`: Set<number>  (boundary detection — left empty for now)
 *
 * @param {ExtractedPart} part
 */
function partToMesh(part) {
  const vertices = [];
  for (let i = 0; i < part.positions.length; i += 2) {
    const x = part.positions[i];
    const y = part.positions[i + 1];
    vertices.push({ x, y, restX: x, restY: y });
  }

  /** @type {Array<[number,number,number]>} */
  const triangles = [];
  for (let i = 0; i < part.indices.length; i += 3) {
    triangles.push([part.indices[i], part.indices[i + 1], part.indices[i + 2]]);
  }

  return {
    vertices,
    uvs: new Float32Array(part.uvs),
    triangles,
    edgeIndices: new Set(),
  };
}

/**
 * Synthesise a complete SS project from a parsed cmo3.
 *
 * The output is `loadProject`-ready: every field the project store
 * touches in `loadProject` is populated (with `null` / `[]` / `{}`
 * defaults for the rig fields we don't decode yet).
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<ImportResult>}
 */
export async function importCmo3(bytes) {
  const archive = await unpackCaff(bytes);
  const xmlEntry = archive.files.find((f) => f.path === 'main.xml');
  if (!xmlEntry) {
    throw new Error('cmo3Import: archive has no main.xml entry');
  }
  const xml = new TextDecoder('utf-8').decode(xmlEntry.content);

  /** @type {string[]} */
  const warnings = [];

  const { canvasW, canvasH, modelName } = readHeaderBits(xml);
  if (canvasW === null || canvasH === null) {
    warnings.push('No canvas dimensions found — falling back to 1024×1024');
  }

  const params = readParameters(xml);
  const parsed = parseCmo3Xml(xml);
  const scene = extractScene(parsed);
  for (const w of scene.warnings) warnings.push(`scene: ${w}`);

  // PNG → Blob URL map keyed by file name. The same imageFileBuf can be
  // referenced by multiple parts when the original PSD shared a texture;
  // sharing the Blob URL avoids redundant decode work in the texture
  // upload path.
  /** @type {Map<string, string>} */
  const pngBlobUrls = new Map();
  for (const f of archive.files) {
    if (!f.path.toLowerCase().endsWith('.png')) continue;
    if (f.path.startsWith('cmo3_icon_')) continue;
    const blob = new Blob([f.content.slice()], { type: 'image/png' });
    pngBlobUrls.set(f.path, URL.createObjectURL(blob));
  }

  // Group ID assignment runs before parts so we can resolve part→group
  // parent links via the CPartGuid intermediary.
  const guidToNodeId = buildGuidToNodeIdMap(scene.groups);

  /** @type {any[]} */
  const nodes = [];

  for (const g of scene.groups) {
    const id = g.guidRef ? guidToNodeId.get(g.guidRef) : uid();
    nodes.push({
      id,
      type: 'group',
      name: g.name || 'Group',
      parent: g.parentGuidRef ? (guidToNodeId.get(g.parentGuidRef) ?? null) : null,
      transform: DEFAULT_TRANSFORM(),
      visible: g.isVisible,
      opacity: 1,
    });
  }

  /** @type {any[]} */
  const textures = [];

  /** @type {Map<string, string>} */
  const partGuidToNodeId = new Map();
  /** @type {Map<string, string>} */
  const drawableGuidToNodeId = new Map();

  for (const part of scene.parts) {
    const nodeId = uid();
    if (part.xsId) partGuidToNodeId.set(part.xsId, nodeId);
    if (part.ownDrawableGuidRef) drawableGuidToNodeId.set(part.ownDrawableGuidRef, nodeId);
    const parent = part.parentGuidRef ? (guidToNodeId.get(part.parentGuidRef) ?? null) : null;
    if (part.parentGuidRef && parent === null) {
      warnings.push(`part ${part.drawableIdStr} (${part.name}) has unresolved parent ${part.parentGuidRef}`);
    }

    let textureSource = null;
    if (part.textureRef) {
      const tex = scene.textures.find((t) => t.xsId === part.textureRef);
      if (tex && tex.filePath && pngBlobUrls.has(tex.filePath)) {
        textureSource = pngBlobUrls.get(tex.filePath) ?? null;
      } else if (tex) {
        warnings.push(`part ${part.drawableIdStr} texture ${tex.filePath ?? '(unresolved)'} not found in CAFF archive`);
      }
    }
    if (textureSource) {
      textures.push({ id: nodeId, source: textureSource });
    }

    nodes.push({
      id: nodeId,
      type: 'part',
      name: part.name || part.drawableIdStr,
      parent,
      draw_order: part.drawOrder,
      opacity: 1,
      visible: part.isVisible,
      clip_mask: null,
      transform: DEFAULT_TRANSFORM(),
      meshOpts: null,
      mesh: partToMesh(part),
      blendShapes: null,
      blendShapeValues: {},
    });
  }

  // Sweep #13: synthesise per-mesh rig warp specs from the deformer +
  // binding + grid graph.
  const { rigWarps, warnings: rigWarnings } = buildRigWarpsFromScene(
    scene, partGuidToNodeId, canvasW ?? 1024, canvasH ?? 1024,
  );
  for (const w of rigWarnings) warnings.push(`rigWarp: ${w}`);

  // Sweep #15: mirror cmo3 rotation deformers onto their owning groups.
  const rotationWarnings = applyRotationDeformersToGroups(
    scene, nodes, guidToNodeId, canvasW ?? 1024, canvasH ?? 1024,
  );
  for (const w of rotationWarnings) warnings.push(`rotation: ${w}`);

  // Sweep #20: detect bone-baked angle set from ParamRotation_<role>
  // keyform bindings. Pick the longest unique sorted-ascending key list
  // across all `ParamRotation_*` bindings.
  /** @type {number[] | null} */
  let detectedBakedAngles = null;
  for (const b of scene.keyformBindings) {
    if (!b.description.startsWith('ParamRotation_')) continue;
    if (!Array.isArray(b.keys) || b.keys.length === 0) continue;
    const sorted = [...b.keys].sort((x, y) => x - y);
    if (!detectedBakedAngles || sorted.length > detectedBakedAngles.length) {
      detectedBakedAngles = sorted;
    }
  }

  // Sweep #18: variant pairing via canonical `variantNormalizer`.
  const variantResult = normalizeVariants({ nodes });
  if (variantResult.orphans.length > 0) {
    for (const orphan of variantResult.orphans) {
      warnings.push(`variant: orphan "${orphan.name}" — no base sibling found, will render as plain layer`);
    }
  }

  // Sweep #17: synthesise project.maskConfigs[] from each part's
  // clipGuidList. Multi-mask sources warn (writer collapses to first).
  /** @type {Array<{maskedMeshId:string, maskMeshIds:string[]}>} */
  const maskConfigs = [];
  for (const part of scene.parts) {
    if (!part.clipMaskRefs.length) continue;
    const maskedNodeId = part.xsId ? partGuidToNodeId.get(part.xsId) : null;
    if (!maskedNodeId) continue;
    /** @type {string[]} */
    const maskNodeIds = [];
    for (const ref of part.clipMaskRefs) {
      const id = drawableGuidToNodeId.get(ref);
      if (id) maskNodeIds.push(id);
      else warnings.push(`mask: part ${part.drawableIdStr} (${part.name}) clipRef ${ref} doesn't resolve to any part's CDrawableGuid`);
    }
    if (maskNodeIds.length === 0) continue;
    if (maskNodeIds.length > 1) {
      warnings.push(`mask: part ${part.drawableIdStr} has ${maskNodeIds.length} clip masks; writer keeps the first only`);
    }
    maskConfigs.push({
      maskedMeshId: maskedNodeId,
      maskMeshIds: maskNodeIds,
    });
  }

  // Synthesise SS-shaped parameter list. ParamOpacity gets 'opacity' so
  // the parameter editor groups it the way the auto-rig pipeline expects.
  const parameters = params.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    min: p.min,
    max: p.max,
    default: p.default,
    decimalPlaces: 1,
    repeat: false,
    role: p.id === 'ParamOpacity' ? 'opacity' : 'standard',
  }));

  const project = {
    version: '0.1',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: {
      width: canvasW ?? 1024,
      height: canvasH ?? 1024,
      x: 0, y: 0,
      bgEnabled: false,
      bgColor: '#ffffff',
    },
    textures,
    nodes,
    parameters,
    physics_groups: [],
    animations: [],
    maskConfigs,
    physicsRules: [],
    boneConfig: detectedBakedAngles
      ? { bakedKeyformAngles: detectedBakedAngles }
      : null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    faceParallax: null,
    bodyWarp: null,
    rigWarps,
    _importedFromCmo3: { modelName, canvasW: canvasW ?? null, canvasH: canvasH ?? null },
  };

  return {
    project,
    warnings,
    stats: {
      parts: scene.parts.length,
      groups: scene.groups.length,
      textures: textures.length,
      parameters: parameters.length,
      rigWarps: Object.keys(rigWarps).length,
    },
  };
}
