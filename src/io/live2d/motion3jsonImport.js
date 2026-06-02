// @ts-check

/**
 * Reverse parser for `.motion3.json` runtime motion files.
 *
 * v3 Phase 5 — pairs with the multi-motion timeline switcher: a user can
 * load a `.motion3.json` from disk (idle generator output, Cubism Editor
 * export, anything Live2D-shaped) into the project as a brand-new entry
 * in `project.actions`, then preview it via the transport-bar dropdown.
 *
 * Segment encoding (mirrors `motion3json.js`):
 *   - First two values:  [startTime, startValue]
 *   - Then repeating segments:
 *       0 (linear):           type, time, value
 *       1 (bezier):           type, cx1, cy1, cx2, cy2, time, value
 *       2 (stepped):          type, time, value
 *       3 (inverse stepped):  type, time, value
 *
 * # Slice 2.G.1 — bezier handle round-trip
 *
 * Bezier segments (type 1) decode their `cx1/cy1/cx2/cy2` control points
 * into the BezTriple handle slots:
 *   - `prevKey.handleRight = { time: cx1*1000, value: cy1 }`
 *   - `currKey.handleLeft  = { time: cx2*1000, value: cy2 }`
 *
 * Both handles are typed `'free'` so the post-import recalc in
 * `normalizeKeyforms` (Slice 2.D) doesn't overwrite them. Paired with
 * `motion3json.js`'s exporter (Slice 2.G) this gives a byte-identical
 * round-trip on all curve types Cubism supports natively.
 *
 * # Slice 3.D — Loop ↔ Cycles round-trip
 *
 * Cubism `Meta.Loop=true` maps to a head-of-stack `Cycles` FModifier on
 * every imported fcurve with `data.after='repeat'` (sparse-default
 * `before='none'`, `afterCycles=0`). This is the symmetric pair of
 * `motion3json.js`'s `actionHasUniformLoopingCycles` exporter gate —
 * import → re-export preserves the loop intent so a Cubism-authored
 * loop motion round-trips byte-identically (including `Meta.Loop`).
 * `Meta.Loop=false` (or missing) imports as zero modifiers; re-export
 * also yields `Loop=false`.
 *
 * @module io/live2d/motion3jsonImport
 */

import {
  buildParamFCurve,
  buildNodeFCurve,
} from '../../anim/animationFCurve.js';

const SEG_LINEAR = 0;
const SEG_BEZIER = 1;
const SEG_STEPPED = 2;
const SEG_INV_STEPPED = 3;

const SEG_TO_INTERPOLATION = {
  [SEG_LINEAR]: 'linear',
  [SEG_BEZIER]: 'bezier',
  [SEG_STEPPED]: 'constant',
  // No Blender equivalent for inverse-stepped (Cubism-only quirk where
  // the value JUMPS at the start instead of the end of the segment).
  // Degrade to 'constant' — round-trip parity for inverse-stepped is
  // a follow-up; idle generator + most tooling never emit it.
  [SEG_INV_STEPPED]: 'constant',
};

/**
 * @typedef {Object} ParsedMotion
 * @property {Object} action - SS action object ready to push into `project.actions`
 * @property {string[]} warnings — non-fatal issues (skipped curves, unknown segment types)
 */

/**
 * Parse a `.motion3.json` text payload into a Stretchy Studio action
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
  // L2D-JSON-09 — pre-fix `Math.max(1, Math.round(durationSec * 1000))`
  // silently clamped 0 / negative / NaN durations to 1ms, leaving every
  // keyform clipped past the end of the action. Reject negative; warn
  // on missing/non-finite/0; if recoverable, infer from the largest
  // decoded keyform time below.
  const rawDuration = meta.Duration;
  if (Number.isFinite(rawDuration) && rawDuration < 0) {
    throw new Error(`motion3.json: negative Meta.Duration (${rawDuration}) — refusing to import`);
  }
  const haveValidDuration = Number.isFinite(rawDuration) && rawDuration > 0;
  if (!haveValidDuration) {
    // Defer durationMs computation until after we've decoded keyforms;
    // infer from largest keyform.time below.
  }
  /** @type {string[]} */
  const _earlyWarnings = [];
  if (!haveValidDuration) {
    _earlyWarnings.push(`Meta.Duration missing or ≤0 (got ${String(rawDuration)}) — inferring from keyform times`);
  }
  // Slice 3.D — Loop ↔ Cycles symmetry. Cubism loop intent imports as a
  // head-of-stack Cycles FModifier on every fcurve so the re-export gate
  // (`actionHasUniformLoopingCycles` in motion3json.js) sees the signal.
  const loopIntent = meta.Loop === true;

  /** @type {string[]} */
  const warnings = [];
  const fcurves = [];

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

    const keyforms = decodeSegmentsToKeyframes(curve.Segments, warnings, `Curve "${id}"`);
    if (keyforms.length < 2) {
      warnings.push(`Curve "${id}": skipped (< 2 keyframes after decode)`);
      continue;
    }

    if (target === 'Parameter') {
      const fc = buildParamFCurve(id, keyforms);
      if (fc) {
        if (loopIntent) attachLoopCyclesModifier(fc, opts.uid);
        fcurves.push(fc);
      }
    } else if (target === 'PartOpacity') {
      const fc = buildNodeFCurve(id, 'opacity', keyforms);
      if (fc) {
        if (loopIntent) attachLoopCyclesModifier(fc, opts.uid);
        fcurves.push(fc);
      }
    } else if (target === 'Model') {
      warnings.push(`Curve "${id}": Model-target curves not supported, skipped`);
    } else {
      warnings.push(`Curve "${id}": unknown Target "${target}", skipped`);
    }
  }

  // L2D-JSON-09 — finalize durationMs. If Meta.Duration was usable, use
  // it; otherwise infer from the largest decoded keyform time across all
  // accepted fcurves, then round up to a whole second (matches Cubism
  // Editor's behaviour of stretching the loop to a tidy boundary).
  let durationMs;
  if (haveValidDuration) {
    durationMs = Math.round(rawDuration * 1000);
  } else {
    let maxKeyformTime = 0;
    for (const fc of fcurves) {
      for (const k of (fc.keyforms ?? [])) {
        if (Number.isFinite(k.time) && k.time > maxKeyformTime) maxKeyformTime = k.time;
      }
    }
    durationMs = Math.max(1000, Math.ceil(maxKeyformTime / 1000) * 1000);
    _earlyWarnings.push(`inferred durationMs=${durationMs} from max keyform time ${maxKeyformTime}`);
  }
  // Prepend the deferred Duration warnings so they show first in the
  // caller's diagnostic.
  warnings.unshift(..._earlyWarnings);

  const action = {
    id: opts.uid(),
    name: opts.name ?? 'Imported motion',
    duration: durationMs,
    fps,
    fcurves,
    audioTracks: [],
    flag: 0,
    meta: {
      createdAt: null,
      modifiedAt: null,
      source: 'imported_motion3',
    },
  };

  return { action, warnings };
}

/**
 * Decode a flat `Segments[]` array into loose keyform records keyed by
 * `interpolation` (the v39 BezTriple discriminator). Records flow
 * through `buildParamFCurve` / `buildNodeFCurve` → `normalizeKeyforms`
 * which mints proper BezTriple keyforms with default handles.
 *
 * In motion3.json the segment type is carried by the SEGMENT (start →
 * end), but in the v39 BezTriple shape the discriminator lives on the
 * START keyform. The decoder therefore writes `interpolation` to the
 * keyform that PRECEDES each segment (i.e. `out[out.length - 1]` at the
 * moment of decode).
 *
 * # Slice 2.G.1
 *
 *   - SEG_BEZIER: `cx1/cy1` → `prevKey.handleRight`, `cx2/cy2` →
 *     `currKey.handleLeft`, with `handleType: 'free'/'free'` on both so
 *     `recalcKeyformHandles` (the build-time reify in `normalizeKeyforms`)
 *     leaves the imported control points untouched.
 *   - SEG_LINEAR / SEG_STEPPED / SEG_INV_STEPPED: `handleType:
 *     'vector'/'vector'` per ANIMATION_BLENDER_PARITY_PLAN.md §2.B.
 *
 * @param {unknown} segs
 * @param {string[]} warnings
 * @param {string} ctx
 * @returns {Array<{time:number, value:number, interpolation:string, handleLeft?:{time:number,value:number}, handleRight?:{time:number,value:number}, handleType?:{left:string,right:string}}>}
 */
function decodeSegmentsToKeyframes(segs, warnings, ctx) {
  if (!Array.isArray(segs) || segs.length < 2) return [];

  const out = [];
  const firstTime = Math.round(numOr(segs[0], 0) * 1000);
  const firstValue = numOr(segs[1], 0);
  out.push({
    time: firstTime,
    value: firstValue,
    interpolation: 'linear', // patched once the next segment's type is known
    handleType: { left: 'vector', right: 'vector' },
    handleLeft:  { time: firstTime, value: firstValue },
    handleRight: { time: firstTime, value: firstValue },
  });

  let i = 2;
  while (i < segs.length) {
    const type = segs[i];
    i++;
    const interp = SEG_TO_INTERPOLATION[type];
    if (interp === undefined) {
      warnings.push(`${ctx}: unknown segment type ${type}, aborting decode`);
      break;
    }
    // Discriminator lives on the START keyform of the segment in v39.
    const startKey = out[out.length - 1];
    if (startKey) startKey.interpolation = interp;

    if (type === SEG_LINEAR || type === SEG_STEPPED || type === SEG_INV_STEPPED) {
      if (i + 1 >= segs.length) {
        warnings.push(`${ctx}: truncated segment (type ${type})`);
        break;
      }
      const endTime = Math.round(numOr(segs[i], 0) * 1000);
      const endValue = numOr(segs[i + 1], 0);
      out.push({
        time: endTime,
        value: endValue,
        interpolation: 'linear', // tail; patched if a later segment follows
        handleType: { left: 'vector', right: 'vector' },
        handleLeft:  { time: endTime, value: endValue },
        handleRight: { time: endTime, value: endValue },
      });
      i += 2;
    } else if (type === SEG_BEZIER) {
      if (i + 5 >= segs.length) {
        warnings.push(`${ctx}: truncated bezier segment`);
        break;
      }
      // Slice 2.G.1: preserve Cubism's authored control points.
      // cx1/cy1 → segment START's right handle; cx2/cy2 → segment END's
      // left handle. Both keyforms get `handleType.{left,right} = 'free'`
      // so `recalcKeyformHandles` won't overwrite them.
      //
      // Audit-fix MED-B3 (2026-05-16): emit a per-segment warning when
      // any of the 6 bezier payload floats are non-finite (NaN/Infinity).
      // Previously the `numOr(v, 0)` silently substituted 0 with no
      // signal — a malformed file would produce a geometrically wrong
      // curve (handles collapsed to time=0) while passing fidelity tests
      // that don't sample affected segments. The warning matches the
      // module's existing truncation-warning pattern (see SEG_LINEAR /
      // SEG_STEPPED branches above).
      const bezPayload = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[i + 4], segs[i + 5]];
      if (bezPayload.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        warnings.push(
          `${ctx}: bezier segment has non-finite control points `
          + `[${bezPayload.map((v) => String(v)).join(', ')}], substituting 0`,
        );
      }
      const cx1 = Math.round(numOr(segs[i],     0) * 1000);
      const cy1 = numOr(segs[i + 1], 0);
      const cx2 = Math.round(numOr(segs[i + 2], 0) * 1000);
      const cy2 = numOr(segs[i + 3], 0);
      const endTime  = Math.round(numOr(segs[i + 4], 0) * 1000);
      const endValue = numOr(segs[i + 5], 0);

      if (startKey) {
        startKey.handleRight = { time: cx1, value: cy1 };
        startKey.handleType = { left: startKey.handleType?.left ?? 'free', right: 'free' };
      }
      out.push({
        time: endTime,
        value: endValue,
        interpolation: 'linear', // tail
        handleType: { left: 'free', right: 'vector' },
        handleLeft:  { time: cx2, value: cy2 },
        handleRight: { time: endTime, value: endValue },
      });
      i += 6;
    }
  }

  return out;
}

function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Slice 3.D — attach the Cubism-Loop-equivalent Cycles modifier to an
 * imported fcurve in-place. Matches the exporter's
 * `actionHasUniformLoopingCycles` gate exactly:
 *   - head-of-stack (per 3.C `unshift` invariant)
 *   - `data.after = 'repeat'`
 *   - sparse defaults for the rest (`before='none'`, `afterCycles=0`)
 *   - stable `id` from caller's uid (audit-fix MED-2: missing id leaves
 *     the 3.C UI panel's modifier-row keys + active-highlight reading
 *     `undefined` and any future serialisation invariant pointing at
 *     `modifier.id` silently breaks)
 *
 * @param {object} fcurve - fcurve with `modifiers?` to mutate
 * @param {() => string} uid - id mint (host's uid generator, same as
 *   the one used to mint the action id)
 */
function attachLoopCyclesModifier(fcurve, uid) {
  if (!Array.isArray(fcurve.modifiers)) fcurve.modifiers = [];
  fcurve.modifiers.unshift({
    id: uid(),
    type: 'cycles',
    data: { after: 'repeat' },
  });
}
