// @ts-check
/**
 * .cmo3 metadata inspector.
 *
 * First cut of the Phase 5 round-trip work. Pairs `unpackCaff` (the CAFF
 * container reverse-pass) with a focused regex scan over `main.xml` to
 * surface the model header that Cubism Editor uses without paying for a
 * full XStream-style DOM parse + reference-graph resolve.
 *
 * What it reads today (per `inspectCmo3`):
 *
 *   - Model name + canvas pixel dimensions
 *   - File-format / CModelSource serialiser version
 *   - Parameter list (id-string + min / max / default + display name)
 *   - Part / group / parameter / texture counts
 *
 * What it explicitly does NOT read yet — these need an XStream-style
 * shared-pool resolver, planned for follow-on sweeps:
 *
 *   - Per-mesh vertex / triangle / UV arrays
 *   - Deformer chain (warp + rotation deformers, parent links)
 *   - Keyform grids (CArtMeshForm, CWarpDeformerForm, CRotationDeformerForm)
 *   - Variants, masks, physics rules, bone-baked angles
 *
 * Use this module to verify a .cmo3's header at a glance, A/B-compare two
 * exports, or surface "what's actually in this file" before deciding to
 * round-trip it back into SS.
 *
 * @module io/live2d/cmo3Inspect
 */

import { unpackCaff } from './caffUnpacker.js';

/**
 * @typedef {Object} ParamMetadata
 * @property {string} id        e.g. "ParamAngleX" — resolved from the CParameterId pool
 * @property {string} name      Human-readable name from <s xs.n="name">…</s>
 * @property {number} min
 * @property {number} max
 * @property {number} default
 * @property {string} type      Cubism "paramType" enum string (e.g. "NORMAL")
 */

/**
 * @typedef {Object} Cmo3Metadata
 * @property {string|null} modelName
 * @property {number|null} canvasW
 * @property {number|null} canvasH
 * @property {number|null} cmodelSourceVersion   "<?version CModelSource:NN?>" PI value
 * @property {number} partCount                  CArtMeshSource occurrences (=visible meshes)
 * @property {number} groupCount                 CPartSource occurrences (=group nodes)
 * @property {number} parameterCount             CParameterSource occurrences
 * @property {number} textureCount               CModelImage occurrences
 * @property {ParamMetadata[]} parameters
 * @property {string[]} pngFiles                 file names of the PNG entries embedded in the CAFF
 * @property {string[]} warnings
 */

/**
 * Strip XStream PIs from the head of the document and capture their
 * versions. Returns a map from class name → version number so callers can
 * reason about which serialised schema the writer that produced this file
 * was using (e.g. CModelSource:14 vs 4).
 *
 * @param {string} xml
 * @returns {Map<string, number>}
 */
function readVersionPis(xml) {
  const out = new Map();
  const re = /<\?version\s+([A-Za-z0-9_]+):(\d+)\?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

/**
 * Build the CParameterId pool: `xs.id` → `idstr`. CParameterSource's `id`
 * field is a `xs.ref="#NNN"` so we have to resolve it to the matching
 * CParameterId in the shared pool to get the actual ParamID string.
 *
 * @param {string} xml
 * @returns {Map<string, string>}
 */
function readParameterIdPool(xml) {
  const out = new Map();
  const re = /<CParameterId\b[^>]*\bidstr="([^"]+)"[^>]*\bxs\.id="(#\d+)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.set(m[2], m[1]);
  }
  return out;
}

/**
 * Pull canvas dimensions out of CModelSource. The canvas element is
 * `<CImageCanvas xs.n="canvas">` containing `<i xs.n="pixelWidth">NNNN</i>`
 * + `<i xs.n="pixelHeight">NNNN</i>`. There is exactly one canvas per
 * model, so the first match wins.
 *
 * @param {string} xml
 */
function readCanvas(xml) {
  const m = xml.match(/<CImageCanvas[^>]*xs\.n="canvas"[^>]*>[\s\S]*?<i\s+xs\.n="pixelWidth">(\d+)<\/i>[\s\S]*?<i\s+xs\.n="pixelHeight">(\d+)<\/i>/);
  if (!m) return { w: null, h: null };
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * Read the model display name from `<CModelSource ...><s xs.n="name">…</s>`.
 * If the model has no name set, returns null instead of an empty string so
 * downstream code can fall back to a default label.
 *
 * @param {string} xml
 */
function readModelName(xml) {
  const m = xml.match(/<CModelSource\b[^>]*>[\s\S]*?<s\s+xs\.n="name">([^<]*)<\/s>/);
  if (!m) return null;
  const name = m[1].trim();
  return name.length === 0 ? null : name;
}

/**
 * Walk every CParameterSource and synthesise a structured ParamMetadata.
 *
 * @param {string} xml
 * @param {Map<string, string>} idPool
 * @returns {ParamMetadata[]}
 */
function readParameters(xml, idPool) {
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
 * Cheap occurrence counter for tags that don't need attribute parsing.
 * Counts the OPENING tag (`<Tag>` / `<Tag attr="…">` / `<Tag attr="…"/>`)
 * so self-closing references don't get conflated with structural elements.
 * The regex requires a space, slash, or `>` after the tag name to avoid
 * matching `<TagSomething>` as `<Tag>` (e.g. CPartSource vs CPartSourceSet).
 *
 * @param {string} xml
 * @param {string} tag
 */
function countTag(xml, tag) {
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  return (xml.match(re) ?? []).length;
}

/**
 * Inspect a `.cmo3` byte buffer.
 *
 * Resolves the CAFF container, finds `main.xml`, and returns a structured
 * metadata snapshot. Throws on:
 *   - bad magic / wrong format identifier
 *   - missing `main.xml` entry
 *   - malformed obfuscation key (extreme file count)
 *
 * Non-fatal issues (missing canvas, no model name, no parameters) surface
 * as `warnings[]` so a downstream UI can still render the rest of the
 * snapshot.
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<Cmo3Metadata>}
 */
export async function inspectCmo3(bytes) {
  const archive = await unpackCaff(bytes);
  const xmlEntry = archive.files.find((f) => f.path === 'main.xml');
  if (!xmlEntry) {
    throw new Error('cmo3Inspect: archive has no main.xml entry');
  }
  const xml = new TextDecoder('utf-8').decode(xmlEntry.content);

  /** @type {string[]} */
  const warnings = [];

  const versions = readVersionPis(xml);
  const cmodelSourceVersion = versions.get('CModelSource') ?? null;
  if (cmodelSourceVersion === null) {
    warnings.push('No <?version CModelSource:N?> processing instruction found');
  }

  const { w: canvasW, h: canvasH } = readCanvas(xml);
  if (canvasW === null || canvasH === null) {
    warnings.push('No <CImageCanvas xs.n="canvas"> with pixelWidth + pixelHeight');
  }

  const modelName = readModelName(xml);

  const idPool = readParameterIdPool(xml);
  const parameters = readParameters(xml, idPool);
  for (const p of parameters) {
    if (!p.id) {
      warnings.push('CParameterSource references an unresolved CParameterId — pool miss');
      break;
    }
  }

  const partCount = countTag(xml, 'CArtMeshSource');
  const groupCount = countTag(xml, 'CPartSource');
  const parameterCount = parameters.length;
  const textureCount = countTag(xml, 'CModelImage');

  const pngFiles = archive.files
    .filter((f) => f.path.toLowerCase().endsWith('.png'))
    .map((f) => f.path);

  return {
    modelName,
    canvasW,
    canvasH,
    cmodelSourceVersion,
    partCount,
    groupCount,
    parameterCount,
    textureCount,
    parameters,
    pngFiles,
    warnings,
  };
}
