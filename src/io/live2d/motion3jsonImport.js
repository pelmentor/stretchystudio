// @ts-check

/**
 * Reverse parser for `.motion3.json` runtime motion files.
 *
 * v3 Phase 5 — pairs with the multi-motion timeline switcher: a user can
 * load a `.motion3.json` from disk (idle generator output, Cubism Editor
 * export, anything Live2D-shaped) into the project as a brand-new entry
 * in `project.animations`, then preview it via the transport-bar dropdown.
 *
 * Segment encoding (mirrors `motion3json.js`):
 *   - First two values:  [startTime, startValue]
 *   - Then repeating segments:
 *       0 (linear):           type, time, value
 *       1 (bezier):           type, cx1, cy1, cx2, cy2, time, value
 *       2 (stepped):          type, time, value
 *       3 (inverse stepped):  type, time, value
 *
 * Bezier segments are decoded into a single SS keyframe at the segment
 * end-point with `easing: 'ease-both'`. Control points are not preserved
 * — the SS animation engine doesn't ingest per-segment cubic handles, and
 * round-tripping the same file would re-fit `1/3, 2/3` handles anyway.
 *
 * @module io/live2d/motion3jsonImport
 */

const SEG_LINEAR = 0;
const SEG_BEZIER = 1;
const SEG_STEPPED = 2;
const SEG_INV_STEPPED = 3;

const SEG_TO_EASING = {
  [SEG_LINEAR]: 'linear',
  [SEG_BEZIER]: 'ease-both',
  [SEG_STEPPED]: 'stepped',
  [SEG_INV_STEPPED]: 'inverse-stepped',
};

/**
 * @typedef {Object} ParsedMotion
 * @property {Object} animation - SS animation object ready to push into `project.animations`
 * @property {string[]} warnings — non-fatal issues (skipped curves, unknown segment types)
 */

/**
 * Parse a `.motion3.json` text payload into a Stretchy Studio animation
 * object. Throws on malformed JSON or unsupported Version.
 *
 * @param {string} jsonText
 * @param {{ uid: () => string, name?: string }} opts
 *   `uid()` is required (host supplies the id generator so we don't bake
 *   one in here). `name` overrides the default clip name when provided.
 * @returns {ParsedMotion}
 */
export function parseMotion3Json(jsonText, opts) {
  if (!opts || typeof opts.uid !== 'function') {
    throw new Error('parseMotion3Json: opts.uid() is required');
  }
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`motion3.json: not valid JSON — ${(e && e.message) || e}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('motion3.json: expected an object at the root');
  }
  if (doc.Version !== 3) {
    throw new Error(`motion3.json: unsupported Version (got ${doc.Version}, expected 3)`);
  }
  if (!Array.isArray(doc.Curves)) {
    throw new Error('motion3.json: missing Curves array');
  }

  const meta = doc.Meta ?? {};
  const fps = numOr(meta.Fps, 24);
  const durationSec = numOr(meta.Duration, 2);
  const durationMs = Math.max(1, Math.round(durationSec * 1000));

  /** @type {string[]} */
  const warnings = [];
  const tracks = [];

  for (let ci = 0; ci < doc.Curves.length; ci++) {
    const curve = doc.Curves[ci];
    if (!curve || typeof curve !== 'object') {
      warnings.push(`Curve [${ci}]: skipped (not an object)`);
      continue;
    }
    const target = curve.Target;
    const id = curve.Id;
    if (typeof id !== 'string' || !id) {
      warnings.push(`Curve [${ci}]: missing Id, skipped`);
      continue;
    }

    const keyframes = decodeSegmentsToKeyframes(curve.Segments, warnings, `Curve "${id}"`);
    if (keyframes.length < 2) {
      warnings.push(`Curve "${id}": skipped (< 2 keyframes after decode)`);
      continue;
    }

    if (target === 'Parameter') {
      tracks.push({
        id: opts.uid(),
        paramId: id,
        keyframes,
      });
    } else if (target === 'PartOpacity') {
      tracks.push({
        id: opts.uid(),
        nodeId: id,
        property: 'opacity',
        keyframes,
      });
    } else if (target === 'Model') {
      warnings.push(`Curve "${id}": Model-target curves not supported, skipped`);
    } else {
      warnings.push(`Curve "${id}": unknown Target "${target}", skipped`);
    }
  }

  const animation = {
    id: opts.uid(),
    name: opts.name ?? 'Imported motion',
    duration: durationMs,
    fps,
    tracks,
    audioTracks: [],
  };

  return { animation, warnings };
}

/**
 * Decode a flat `Segments[]` array into SS keyframes
 * (`{time: ms, value, easing}`). Skips malformed segments with a warning.
 *
 * @param {unknown} segs
 * @param {string[]} warnings
 * @param {string} ctx
 * @returns {Array<{time:number, value:number, easing:string}>}
 */
function decodeSegmentsToKeyframes(segs, warnings, ctx) {
  if (!Array.isArray(segs) || segs.length < 2) return [];

  const out = [];
  out.push({
    time: Math.round(numOr(segs[0], 0) * 1000),
    value: numOr(segs[1], 0),
    easing: 'linear',
  });

  let i = 2;
  while (i < segs.length) {
    const type = segs[i];
    i++;
    if (type === SEG_LINEAR || type === SEG_STEPPED || type === SEG_INV_STEPPED) {
      if (i + 1 >= segs.length) {
        warnings.push(`${ctx}: truncated segment (type ${type})`);
        break;
      }
      out.push({
        time: Math.round(numOr(segs[i], 0) * 1000),
        value: numOr(segs[i + 1], 0),
        easing: SEG_TO_EASING[type],
      });
      i += 2;
    } else if (type === SEG_BEZIER) {
      if (i + 5 >= segs.length) {
        warnings.push(`${ctx}: truncated bezier segment`);
        break;
      }
      // Drop control points (cx1, cy1, cx2, cy2) — keep end point only.
      out.push({
        time: Math.round(numOr(segs[i + 4], 0) * 1000),
        value: numOr(segs[i + 5], 0),
        easing: SEG_TO_EASING[SEG_BEZIER],
      });
      i += 6;
    } else {
      warnings.push(`${ctx}: unknown segment type ${type}, aborting decode`);
      break;
    }
  }

  return out;
}

function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
