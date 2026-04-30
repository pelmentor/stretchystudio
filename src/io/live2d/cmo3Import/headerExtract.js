// @ts-check
/**
 * Inspect-only header bits the cmo3 importer reads from main.xml.
 *
 * Mirrors regex helpers in `cmo3Inspect.js` so behaviour stays in sync;
 * if either drifts, both should drift together. Kept regex-driven (not
 * full XML walk) so importer can fall back to "warning + default" when
 * the canvas tag is missing instead of failing the whole import.
 *
 * @module io/live2d/cmo3Import/headerExtract
 */

/**
 * @typedef {import('../cmo3Inspect.js').ParamMetadata} ParamMetadata
 */

/**
 * Read canvas dimensions + model name without re-running the full inspector.
 *
 * @param {string} xml
 * @returns {{canvasW:number|null, canvasH:number|null, modelName:string}}
 */
export function readHeaderBits(xml) {
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
export function readParameters(xml) {
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
