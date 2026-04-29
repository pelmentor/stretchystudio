// @ts-check

/**
 * Phase 0C — Tagged vertex buffer wrappers (Pillar C).
 *
 * The chain evaluator works with vertex buffers in three different
 * coordinate spaces (`LocalFrame` per `frameConvert.js`). Bare
 * `Float32Array` carries no record of which frame it's in, so a
 * caller that uploads the wrong buffer to the GPU silently produces
 * the v2 R6 "parts fly off" symptom — and there's no way to
 * diagnose it short of re-deriving the frame from context.
 *
 * `TaggedBuffer` pairs the buffer with its frame and (when the frame
 * needs it) the parent context. This lets:
 *
 * 1. Phase 1C Coord-Space Debugger overlay tint each mesh by the
 *    frame its verts arrive in — making the v2 -1B residual bug
 *    visible without instrumentation.
 *
 * 2. `tsc --checkJs` (Pillar G) flag callers that pass a
 *    `'normalized-0to1'` buffer where a `'canvas-px'` one is
 *    required — at compile time, not at GPU upload time.
 *
 * 3. Chain walk asserts at each step (warp/rotation conversion
 *    expects a known input frame). Cycle bugs in chain definition
 *    surface as failed assertions instead of silent vertex drift.
 *
 * The wrapper is **not** a class. It's a frozen plain object — JIT
 * keeps it on the stack just like a tuple, and callers can spread/
 * destructure freely. A class would force `this.verts` indirections
 * inside the chain hot loop where allocation count and shape stability
 * matter.
 *
 * @module io/live2d/runtime/coords/TaggedBuffer
 */

/**
 * @typedef {import('../evaluator/frameConvert.js').LocalFrame} LocalFrame
 */

/**
 * Frame-specific context carried alongside the verts.
 *
 * - `'canvas-px'`        → no ctx (`null`).
 * - `'normalized-0to1'`  → `{ gridBox: {minX, minY, W, H} }`.
 * - `'pivot-relative'`   → `{ pivotX, pivotY, angleDeg }`.
 *
 * @typedef {null | { gridBox: {minX:number, minY:number, W:number, H:number} }
 *                 | { pivotX:number, pivotY:number, angleDeg:number }} FrameCtx
 */

/**
 * Frozen TaggedBuffer record.
 *
 * @typedef {{
 *   readonly verts: Float32Array,
 *   readonly frame: LocalFrame,
 *   readonly ctx: FrameCtx,
 * }} TaggedBuffer
 */

/**
 * Construct a tagged buffer.
 *
 * No defensive copy of `verts` — caller owns the lifetime. Phase
 * 0C deliberately avoids a copy here because the chain walker swaps
 * its scratch buffers per step (~150 conversions/frame for a 30-mesh
 * rig); copying on every wrap would burn allocation and GC cost.
 * Callers MUST treat a wrapped buffer as immutable: producing a new
 * frame ⇒ a new TaggedBuffer with a fresh `verts`.
 *
 * @param {Float32Array} verts  flat [x,y, x,y, ...] positions
 * @param {LocalFrame}   frame
 * @param {FrameCtx}     [ctx]   defaults to null for canvas-px
 * @returns {TaggedBuffer}
 */
export function taggedBuffer(verts, frame, ctx = null) {
  if (!(verts instanceof Float32Array)) {
    throw new TypeError('taggedBuffer: verts must be Float32Array');
  }
  if (frame !== 'canvas-px' && frame !== 'normalized-0to1' && frame !== 'pivot-relative') {
    throw new TypeError(`taggedBuffer: unknown frame '${frame}'`);
  }
  if (frame === 'canvas-px' && ctx !== null) {
    throw new TypeError('taggedBuffer: canvas-px frame must have null ctx');
  }
  if (frame === 'normalized-0to1') {
    if (!ctx || typeof ctx !== 'object' || !('gridBox' in ctx)) {
      throw new TypeError('taggedBuffer: normalized-0to1 requires ctx.gridBox');
    }
    const gb = /** @type {any} */ (ctx).gridBox;
    if (typeof gb?.minX !== 'number' || typeof gb?.minY !== 'number' ||
        typeof gb?.W !== 'number' || typeof gb?.H !== 'number') {
      throw new TypeError('taggedBuffer: ctx.gridBox needs {minX, minY, W, H}');
    }
  }
  if (frame === 'pivot-relative') {
    if (!ctx || typeof ctx !== 'object' || !('pivotX' in ctx)) {
      throw new TypeError('taggedBuffer: pivot-relative requires ctx with pivotX/pivotY/angleDeg');
    }
    const c = /** @type {any} */ (ctx);
    if (typeof c.pivotX !== 'number' || typeof c.pivotY !== 'number' || typeof c.angleDeg !== 'number') {
      throw new TypeError('taggedBuffer: ctx needs numeric pivotX, pivotY, angleDeg');
    }
  }
  return Object.freeze(/** @type {TaggedBuffer} */ ({ verts, frame, ctx }));
}

/**
 * Assertion helper. Use at chain-step boundaries to lock the input
 * frame each conversion expects (warp expects normalized-0to1 OR
 * the previous step's frame; rotation expects pivot-relative; etc.).
 *
 * @param {TaggedBuffer} buf
 * @param {LocalFrame} expected
 * @param {string} [where]  call-site label for the error message
 */
export function assertFrame(buf, expected, where = '') {
  if (!buf || buf.frame !== expected) {
    const got = buf?.frame ?? 'undefined';
    const loc = where ? ` at ${where}` : '';
    throw new Error(`assertFrame: expected '${expected}' but got '${got}'${loc}`);
  }
}

/**
 * True when `buf` is a TaggedBuffer (frozen plain object with the
 * three canonical fields). Cheap shape probe — avoids allocating the
 * stricter assertion error.
 *
 * @param {unknown} buf
 * @returns {buf is TaggedBuffer}
 */
export function isTaggedBuffer(buf) {
  return !!(
    buf &&
    typeof buf === 'object' &&
    /** @type {any} */ (buf).verts instanceof Float32Array &&
    typeof /** @type {any} */ (buf).frame === 'string'
  );
}
