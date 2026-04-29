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
 *
 * What this module does NOT yet synthesise (each is its own follow-on
 * sweep — the plan row tracks them as deferred):
 *
 *   - Deformer chain (CWarpDeformerSource / CRotationDeformerSource)
 *   - Keyform grids → `project.rigWarps[partId]`
 *   - Variants (encoded via conditional keyform bindings)
 *   - Masks (`maskConfigs`)
 *   - Physics rules
 *   - Bone-baked angles / bone config
 *
 * Imported projects therefore arrive as a static reference scene: the
 * geometry is correct, the textures bind, the groups nest correctly,
 * but parameters won't drive any deformation until the rig path is
 * filled in.
 *
 * @module io/live2d/cmo3Import
 */

import { unpackCaff } from './caffUnpacker.js';
import { parseCmo3Xml } from './cmo3XmlParser.js';
import { extractScene } from './cmo3PartExtract.js';
import { CURRENT_SCHEMA_VERSION } from '../../store/projectMigrations.js';
import { uid } from '../../lib/ids.js';

/**
 * @typedef {import('./cmo3Inspect.js').ParamMetadata} ParamMetadata
 * @typedef {import('./cmo3PartExtract.js').ExtractedScene} ExtractedScene
 * @typedef {import('./cmo3PartExtract.js').ExtractedPart} ExtractedPart
 * @typedef {import('./cmo3PartExtract.js').ExtractedGroup} ExtractedGroup
 */

/**
 * @typedef {Object} ImportResult
 * @property {Object} project         The synthesised SS project (loadProject-ready)
 * @property {string[]} warnings      Non-fatal issues — surfaced in the inspector UI
 * @property {Object} stats           {parts, groups, textures, parameters} — for status banner
 */

const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

/**
 * Read inspect-only header bits the importer needs (canvas dims + model
 * name + parameter list) without re-running the full inspector. The
 * inspector itself can stay focused on its own UI surface; the importer
 * pulls only the structural data and tolerates a missing canvas as a
 * warning rather than a fatal.
 *
 * Mirrors the regex helpers in `cmo3Inspect.js` so behaviour stays in
 * sync; if either drifts, both should drift together.
 *
 * @param {string} xml
 */
function readHeaderBits(xml) {
  const canvasMatch = xml.match(/<CImageCanvas[^>]*xs\.n="canvas"[^>]*>[\s\S]*?<i\s+xs\.n="pixelWidth">(\d+)<\/i>[\s\S]*?<i\s+xs\.n="pixelHeight">(\d+)<\/i>/);
  const nameMatch = xml.match(/<CModelSource\b[^>]*>[\s\S]*?<s\s+xs\.n="name">([^<]*)<\/s>/);
  return {
    canvasW: canvasMatch ? Number(canvasMatch[1]) : null,
    canvasH: canvasMatch ? Number(canvasMatch[2]) : null,
    modelName: nameMatch ? nameMatch[1].trim() : '',
  };
}

/**
 * Resolve the parameter list out of main.xml the same way `cmo3Inspect`
 * does, but without going through the public inspect API (which would
 * also re-run scene extraction we already have).
 *
 * @param {string} xml
 * @returns {ParamMetadata[]}
 */
function readParameters(xml) {
  /** @type {Map<string, string>} */
  const idPool = new Map();
  const idRe = /<CParameterId\b[^>]*\bidstr="([^"]+)"[^>]*\bxs\.id="(#\d+)"[^>]*\/>/g;
  let im;
  while ((im = idRe.exec(xml)) !== null) {
    idPool.set(im[2], im[1]);
  }

  /** @type {ParamMetadata[]} */
  const out = [];
  const sourceRe = /<CParameterSource\b[^>]*>([\s\S]*?)<\/CParameterSource>/g;
  let m;
  while ((m = sourceRe.exec(xml)) !== null) {
    const body = m[1];
    const idRefMatch = body.match(/<CParameterId\b[^>]*xs\.n="id"[^>]*xs\.ref="(#\d+)"[^>]*\/>/);
    const idRef = idRefMatch ? idRefMatch[1] : null;
    const id = idRef ? (idPool.get(idRef) ?? '') : '';
    const minMatch = body.match(/<f\s+xs\.n="minValue">([^<]+)<\/f>/);
    const maxMatch = body.match(/<f\s+xs\.n="maxValue">([^<]+)<\/f>/);
    const defMatch = body.match(/<f\s+xs\.n="defaultValue">([^<]+)<\/f>/);
    const nameMatch = body.match(/<s\s+xs\.n="name">([^<]*)<\/s>/);
    const typeMatch = body.match(/<Type\s+xs\.n="paramType"\s+v="([^"]+)"\s*\/>/);
    out.push({
      id,
      name: nameMatch ? nameMatch[1] : '',
      min: minMatch ? Number(minMatch[1]) : 0,
      max: maxMatch ? Number(maxMatch[1]) : 1,
      default: defMatch ? Number(defMatch[1]) : 0,
      type: typeMatch ? typeMatch[1] : 'NORMAL',
    });
  }
  return out;
}

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
    uvs: new Float32Array(part.uvs),  // copy out; caller shouldn't share buffers
    triangles,
    edgeIndices: new Set(),  // boundary detection deferred
  };
}

/**
 * Map every `ExtractedGroup.guidRef` to a freshly-generated SS node id.
 * Parts use guid xs.refs to point at their parent group, so we need the
 * intermediary index to translate those into SS node parent links.
 *
 * @param {ExtractedGroup[]} groups
 */
function buildGuidToNodeIdMap(groups) {
  const map = new Map();
  for (const g of groups) {
    if (g.guidRef) map.set(g.guidRef, uid());
  }
  return map;
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

  // Build PNG → Blob URL map keyed by file name. The same imageFileBuf
  // can be referenced by multiple parts when the original PSD shared a
  // texture; sharing the Blob URL avoids redundant decode work in the
  // texture upload path. URLs are released when the project is replaced
  // (the renderer + projectStore handle that lifecycle).
  /** @type {Map<string, string>} */
  const pngBlobUrls = new Map();
  for (const f of archive.files) {
    if (!f.path.toLowerCase().endsWith('.png')) continue;
    if (f.path.startsWith('cmo3_icon_')) continue;  // editor thumbnail, not part of model
    // .slice() copies into an ArrayBuffer-backed Uint8Array; the
    // CAFF unpacker hands back ArrayBufferLike-backed views which the
    // Blob constructor's TS lib types refuse without the cast.
    const blob = new Blob([f.content.slice()], { type: 'image/png' });
    pngBlobUrls.set(f.path, URL.createObjectURL(blob));
  }

  // Group ID assignment. Parts use guidRef to point at their parent
  // group (CPartGuid intermediary), so we need the lookup table before
  // we generate part nodes.
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

  for (const part of scene.parts) {
    const nodeId = uid();
    const parent = part.parentGuidRef ? (guidToNodeId.get(part.parentGuidRef) ?? null) : null;
    if (part.parentGuidRef && parent === null) {
      warnings.push(`part ${part.drawableIdStr} (${part.name}) has unresolved parent ${part.parentGuidRef}`);
    }

    // Resolve texture file: part → GTexture2D ref → ExtractedTexture → filePath
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
      clip_mask: null,  // mask resolution deferred
      transform: DEFAULT_TRANSFORM(),
      meshOpts: null,
      mesh: partToMesh(part),
      blendShapes: null,
      blendShapeValues: {},
    });
  }

  // Synthesise SS-shaped parameter list from the inspected metadata.
  // `role` defaults to 'standard'; ParamOpacity gets 'opacity' so the
  // parameter editor groups it the way the auto-rig pipeline expects.
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
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    faceParallax: null,
    bodyWarp: null,
    rigWarps: {},
    // Stash the cmo3's own model name so callers can use it for the
    // library record / window title without re-parsing the file.
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
    },
  };
}
