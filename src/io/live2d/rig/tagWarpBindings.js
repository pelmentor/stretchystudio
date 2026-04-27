/**
 * Tag warp binding rules — Stage 9a of the native rig refactor.
 *
 * Today, the per-mesh rig warps in `cmo3writer.js` are driven by a Map
 * named `TAG_PARAM_BINDINGS` that paired each tag (front hair, back hair,
 * eyebrow, mouth, irides, etc.) with:
 *
 *   - `bindings`: list of standard parameters that drive the warp
 *     (e.g. front hair → `[ParamHairFront]` with keys `[-1, 0, 1]`).
 *   - `shiftFn(grid, gW, gH, [keyValues...], gxSpan, gySpan, meshCtx?)`:
 *     a procedural closure that produces the shifted grid for a given
 *     keyform.
 *
 * Stage 9a lifts that data out of `cmo3writer.js` into this module so:
 *
 *   1. The shiftFn implementations have a stable, importable surface
 *      that future per-mesh keyform baking (Stage 9b) can call once at
 *      seed time and store the per-vertex deltas in `project.rigWarps`.
 *   2. The tunable magnitudes (~13 numeric constants) are passed in
 *      via `autoRigConfig.tagWarpMagnitudes` instead of being hardcoded
 *      inside the closures — the user can override per-character
 *      without forking the source code.
 *
 * **Behavior parity.** With the default magnitudes (matching the
 * pre-Stage-9a literals bit-for-bit), the output of `getTagBinding(...)`
 * shiftFn is identical to today's inline closure. Equivalence is
 * verified in `scripts/test_tagWarpBindings.mjs`.
 *
 * **What's NOT changing in 9a.** The keyform values are still computed
 * at export time. Storage of baked deltas in `project.rigWarps[partId]`
 * is Stage 9b. Per-tag substages (`9b-mouth`, `9b-hair`, etc.) are
 * possible but not required by 9a.
 *
 * @module io/live2d/rig/tagWarpBindings
 */

import { DEFAULT_AUTO_RIG_CONFIG } from './autoRigConfig.js';

/**
 * @typedef {Object} TagWarpMagnitudes
 *   Numeric magnitudes consumed by the procedural shiftFns. Defaults
 *   live in `DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes`; the resolver
 *   in `autoRigConfig.js` produces the runtime instance.
 */

/**
 * @typedef {Object} TagWarpBindingSpec
 * @property {{pid:string|null, keys:number[], desc:string}[]} bindings
 *   Parameter axes that drive this warp. Each entry's `pid` is the cmo3
 *   XML reference (filled at lookup time by `getTagBinding`); `desc` is
 *   the canonical parameter id (e.g. `ParamHairFront`).
 * @property {(grid:Float64Array, gW:number, gH:number, keyValues:number[], gxSpan:number, gySpan:number, meshCtx?:object) => Float64Array} shiftFn
 *   Procedural keyform builder. Receives the rest grid + grid dims +
 *   keyform tuple values + per-mesh grid spans (canvas-px deltas) +
 *   optional per-mesh context (currently used only by eye-tag closure
 *   convergence math). Returns a new Float64Array with the shifted
 *   positions; the caller emits this as one keyform.
 */

/**
 * Build the canonical TAG_PARAM_BINDINGS rule set, parameterised on
 * `magnitudes`. The returned Map mirrors today's inline shape:
 * `tag → { bindings: [{paramId, keys, desc}], shiftFn }`. The
 * `paramId` field replaces the old `pid` field — `paramId` is the
 * canonical parameter id (e.g. `ParamHairFront`); the writer wires the
 * cmo3 XML pid via `getTagBinding(tag, paramPids, magnitudes)` below.
 *
 * @param {TagWarpMagnitudes} [magnitudes=DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes]
 * @returns {Map<string, {bindings:{paramId:string, keys:number[], desc:string}[], shiftFn:Function}>}
 */
export function buildTagWarpBindingRules(
  magnitudes = DEFAULT_AUTO_RIG_CONFIG.tagWarpMagnitudes,
) {
  const m = magnitudes;
  return new Map([
    // ── Hair: tips-swing (cubic frac gradient) ──
    ['front hair', {
      bindings: [{ paramId: 'ParamHairFront', keys: [-1, 0, 1], desc: 'ParamHairFront' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        const scale = Math.min(gxS, gyS);
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1);
          const swayW = frac * frac * frac;
          const curlW = frac * frac * frac;
          for (let c = 0; c < gW; c++) {
            const idx = (r * gW + c) * 2;
            pos[idx]     += k * m.hairFrontXSway * scale * swayW;
            pos[idx + 1] += k * m.hairFrontYCurl * scale * curlW;
          }
        }
        return pos;
      },
    }],
    ['back hair', {
      bindings: [{ paramId: 'ParamHairBack', keys: [-1, 0, 1], desc: 'ParamHairBack' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        const scale = Math.min(gxS, gyS);
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1);
          const swayW = frac * frac * frac;
          const curlW = frac * frac * frac;
          for (let c = 0; c < gW; c++) {
            const idx = (r * gW + c) * 2;
            pos[idx]     += k * m.hairBackXSway * scale * swayW;
            pos[idx + 1] += k * m.hairBackYCurl * scale * curlW;
          }
        }
        return pos;
      },
    }],
    // ── Clothing hem sway: X-only (Y exposes layer underneath) ──
    ['bottomwear', {
      bindings: [{ paramId: 'ParamSkirt', keys: [-1, 0, 1], desc: 'ParamSkirt' }],
      shiftFn: (grid, gW, gH, [k], gxS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1);
          const swayW = frac * frac * frac * frac;
          for (let c = 0; c < gW; c++) {
            pos[(r * gW + c) * 2] += k * m.bottomwearXSway * gxS * swayW;
          }
        }
        return pos;
      },
    }],
    // Topwear: shirt sway + bust wobble (interior-only).
    ['topwear', {
      bindings: [
        { paramId: 'ParamShirt', keys: [-1, 0, 1], desc: 'ParamShirt' },
        { paramId: 'ParamBust',  keys: [-1, 0, 1], desc: 'ParamBust'  },
      ],
      shiftFn: (grid, gW, gH, [kShirt, kBust], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (kShirt === 0 && kBust === 0) return pos;
        for (let r = 0; r < gH; r++) {
          const rFrac = r / (gH - 1);
          const shirtSwayW = rFrac * rFrac;
          const bustRowW = Math.max(0, 1 - Math.abs(rFrac - 0.5) * 2);
          for (let c = 0; c < gW; c++) {
            const cFrac = c / (gW - 1);
            const bustColW = Math.max(0, 1 - Math.abs(cFrac - 0.5) * 2);
            const bustW = bustRowW * bustColW;
            const idx = (r * gW + c) * 2;
            if (kShirt !== 0) pos[idx]     +=  kShirt * m.topwearShirtXSway * gxS * shirtSwayW;
            if (kBust  !== 0) pos[idx + 1] += -kBust  * m.topwearBustY      * gyS * bustW;
          }
        }
        return pos;
      },
    }],
    ['legwear', {
      bindings: [{ paramId: 'ParamPants', keys: [-1, 0, 1], desc: 'ParamPants' }],
      shiftFn: (grid, gW, gH, [k], gxS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1);
          const swayW = frac * frac * frac * frac;
          for (let c = 0; c < gW; c++) {
            pos[(r * gW + c) * 2] += k * m.legwearXSway * gxS * swayW;
          }
        }
        return pos;
      },
    }],
    // ── Brows: uniform Y translate (BrowY +1 = up = -Y in canvas) ──
    ['eyebrow', {
      bindings: [{ paramId: 'ParamBrowLY', keys: [-1, 0, 1], desc: 'ParamBrowLY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * m.eyebrowY * gyS;
        return pos;
      },
    }],
    ['eyebrow-l', {
      bindings: [{ paramId: 'ParamBrowLY', keys: [-1, 0, 1], desc: 'ParamBrowLY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * m.eyebrowY * gyS;
        return pos;
      },
    }],
    ['eyebrow-r', {
      bindings: [{ paramId: 'ParamBrowRY', keys: [-1, 0, 1], desc: 'ParamBrowRY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * m.eyebrowY * gyS;
        return pos;
      },
    }],
    // ── Eye open/close: collapse all three to lower-eyelid line ──
    ['irides', {
      bindings: [{ paramId: 'ParamEyeLOpen', keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * m.eyeConvergeYFrac;
        const factor = k;
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    // ── Iris gaze: ParamEyeBallX × ParamEyeBallY uniform translate ──
    ['irides-l', {
      bindings: [
        { paramId: 'ParamEyeBallX', keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { paramId: 'ParamEyeBallY', keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid, gW, gH, [kX, kY], gxS, gyS) => {
        const pos = new Float64Array(grid);
        const dx =  kX * gxS * m.iridesGazeX;
        const dy = -kY * gyS * m.iridesGazeY;
        for (let i = 0; i < pos.length; i += 2) {
          pos[i]     += dx;
          pos[i + 1] += dy;
        }
        return pos;
      },
    }],
    ['irides-r', {
      bindings: [
        { paramId: 'ParamEyeBallX', keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { paramId: 'ParamEyeBallY', keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid, gW, gH, [kX, kY], gxS, gyS) => {
        const pos = new Float64Array(grid);
        const dx =  kX * gxS * m.iridesGazeX;
        const dy = -kY * gyS * m.iridesGazeY;
        for (let i = 0; i < pos.length; i += 2) {
          pos[i]     += dx;
          pos[i + 1] += dy;
        }
        return pos;
      },
    }],
    // ── Eye whites: identity keyforms (clip-mask parity for irides) ──
    ['eyewhite-l', {
      bindings: [
        { paramId: 'ParamEyeBallX', keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { paramId: 'ParamEyeBallY', keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid) => new Float64Array(grid),
    }],
    ['eyewhite-r', {
      bindings: [
        { paramId: 'ParamEyeBallX', keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { paramId: 'ParamEyeBallY', keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid) => new Float64Array(grid),
    }],
    ['eyewhite', {
      bindings: [{ paramId: 'ParamEyeLOpen', keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * m.eyeConvergeYFrac;
        const factor = k;
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    ['eyelash', {
      bindings: [{ paramId: 'ParamEyeLOpen', keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * m.eyeConvergeYFrac;
        const factor = k;
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    // ── Mouth open: Y-stretch from top pivot, quadratic frac gradient ──
    ['mouth', {
      bindings: [{ paramId: 'ParamMouthOpenY', keys: [0, 1], desc: 'ParamMouthOpenY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        const maxStretch = gyS * m.mouthYStretch;
        for (let r = 0; r < gH; r++) {
          const rFrac = r / (gH - 1);
          const dy = k * maxStretch * rFrac * rFrac;
          for (let c = 0; c < gW; c++) {
            pos[(r * gW + c) * 2 + 1] += dy;
          }
        }
        return pos;
      },
    }],
  ]);
}

/**
 * Build the legacy-shaped binding map that the cmo3 emission loop
 * expects: `tag → { bindings: [{pid, keys, desc}], shiftFn }`. PIDs are
 * looked up in `paramPids` (a `paramId → pid` map / dict — typically
 * `paramDefs.find(p => p.id === paramId)?.pid`). Tags whose required
 * parameter is missing come back with `pid: null`, so the writer's
 * `bindings.every(b => b.pid)` gate cleanly drops them — same behavior
 * as the inline map.
 *
 * @param {Map<string, string>|Record<string, string|null|undefined>} paramPids
 * @param {TagWarpMagnitudes} [magnitudes]
 * @returns {Map<string, {bindings:{pid:string|null, keys:number[], desc:string}[], shiftFn:Function}>}
 */
export function buildTagBindingMap(paramPids, magnitudes) {
  const lookup = paramPids instanceof Map
    ? (id) => paramPids.get(id) ?? null
    : (id) => paramPids?.[id] ?? null;
  const rules = buildTagWarpBindingRules(magnitudes);
  const out = new Map();
  for (const [tag, rule] of rules) {
    out.set(tag, {
      bindings: rule.bindings.map(b => ({
        pid: lookup(b.paramId),
        keys: b.keys.slice(),
        desc: b.desc,
      })),
      shiftFn: rule.shiftFn,
    });
  }
  return out;
}
