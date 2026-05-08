// @ts-check

/**
 * Canonical "array of numbers" coercion helpers.
 *
 * # Why this exists
 *
 * BUG-NECK_NULL_BBOX (2026-05-08): `NeckWarp` + `RigWarp_neck` lifted
 * to `[null,null]` bboxes after Init Rig, leaving the neck unrendered
 * until the user clicked "Re-initialize Rig" a second time.
 *
 * Root cause: spec-conversion sites used the pattern
 *
 *     Array.isArray(x) ? x.slice() : []
 *
 * to defensively handle "missing or oddly-typed" inputs. But
 * `Array.isArray(new Float64Array([...]))` is **`false`**, so
 * `Float64Array` keyform positions (built by `buildNeckWarpSpec`,
 * `perPartRigWarps`, etc.) silently dropped to `[]`. Downstream
 * lifters then produced `[Infinity, -Infinity]` bboxes which
 * JSON-serialise as `null`. The whole class of silent
 * "type-mismatch ⇒ empty array" fallbacks is a crutch banned by
 * RULE №1.
 *
 * # Contract
 *
 * Both helpers accept the legitimate "field absent" case
 * (`undefined`, `null`) and return a canonical empty result. Any
 * present input must be array-shaped (plain `Array` or any
 * non-`DataView` `ArrayBufferView`). Anything else throws a
 * `TypeError` citing `fieldPath` so the bug surfaces at the
 * mismatched site, not three layers downstream.
 *
 * The element type is NOT validated. `coerceNumberArray([1, 'x'])`
 * returns `[1, 'x']` and the eval kernel will produce `NaN` — that's
 * a different bug class with its own diagnostics. Per-element
 * checking would impose O(n) cost on every conversion.
 *
 * # Stylistic note
 *
 * `null`/`undefined → []` is NOT a silent fallback in the sense
 * RULE №1 forbids. It encodes the field's optionality semantics:
 * "this list may be absent; absent ≡ empty." A required-mode flag
 * (`{ optional: false }`) is exposed for fields where absence is
 * itself a bug.
 *
 * @module lib/numberArrayCoerce
 */

/**
 * Internal helper — produce a diagnostic name for a non-array value.
 *
 * @param {unknown} x
 * @returns {string}
 */
function _typeName(x) {
  if (x === null) return 'null';
  if (x === undefined) return 'undefined';
  const t = typeof x;
  if (t !== 'object' && t !== 'function') return t;
  const ctor = /** @type {object} */ (x).constructor;
  return (ctor && typeof ctor.name === 'string' && ctor.name.length > 0)
    ? ctor.name
    : 'object';
}

/**
 * Coerce an "array of numbers" input into a fresh plain `Array<number>`.
 *
 *  - `undefined` / `null`             → `[]` (when `optional`)
 *  - plain `Array`                    → `.slice()` copy
 *  - `Float64Array`/`Float32Array`/`Int8Array`/`Uint8Array`/etc. →
 *    `Array.from()` copy
 *  - `DataView`                       → throws (it's not an array of numbers)
 *  - anything else                    → throws with `fieldPath` context
 *
 * @param {unknown} x
 * @param {string} fieldPath  Diagnostic context, e.g. `'keyforms[3].positions'`.
 * @param {{ optional?: boolean }} [opts]  `optional: false` rejects null/undefined.
 * @returns {Array<number>}
 */
export function coerceNumberArray(x, fieldPath, opts) {
  const optional = opts?.optional !== false;
  if (x === undefined || x === null) {
    if (optional) return [];
    throw new TypeError(
      `[coerceNumberArray] "${fieldPath}": required, got ${_typeName(x)}`,
    );
  }
  if (Array.isArray(x)) return x.slice();
  if (ArrayBuffer.isView(x) && !(x instanceof DataView)) {
    return Array.from(/** @type {ArrayLike<number>} */ (/** @type {unknown} */ (x)));
  }
  throw new TypeError(
    `[coerceNumberArray] "${fieldPath}": expected Array | TypedArray`
    + (optional ? ' | null | undefined' : '')
    + `, got ${_typeName(x)}`,
  );
}

/**
 * Internal — produce a typed-array coercer for a given target type
 * (Float64Array / Float32Array / Uint16Array / …). Same contract as
 * `coerceNumberArray` but the output is the requested typed array.
 *
 * Fast path: when input is already the target typed array, returns
 * the same reference without copying — chainEval inner loops rely on
 * this to avoid per-frame allocation churn.
 *
 * @template {typeof Float64Array | typeof Float32Array | typeof Uint16Array | typeof Uint8Array | typeof Int32Array | typeof Int16Array | typeof Int8Array} TA
 * @param {TA} TypedArrayCtor
 * @returns {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => InstanceType<TA>}
 */
function _makeTypedArrayCoercer(TypedArrayCtor) {
  const ctorName = TypedArrayCtor.name;
  return function coerce(x, fieldPath, opts) {
    const optional = opts?.optional !== false;
    if (x === undefined || x === null) {
      if (optional) return /** @type {InstanceType<TA>} */ (new TypedArrayCtor(0));
      throw new TypeError(
        `[coerce${ctorName}] "${fieldPath}": required, got ${_typeName(x)}`,
      );
    }
    if (x instanceof TypedArrayCtor) {
      return /** @type {InstanceType<TA>} */ (x);
    }
    if (Array.isArray(x)) {
      // @ts-ignore — TypedArray.from accepts iterable<number>
      return /** @type {InstanceType<TA>} */ (TypedArrayCtor.from(x));
    }
    if (ArrayBuffer.isView(x) && !(x instanceof DataView)) {
      // @ts-ignore
      return /** @type {InstanceType<TA>} */ (TypedArrayCtor.from(/** @type {any} */ (x)));
    }
    throw new TypeError(
      `[coerce${ctorName}] "${fieldPath}": expected Array | TypedArray`
      + (optional ? ' | null | undefined' : '')
      + `, got ${_typeName(x)}`,
    );
  };
}

/**
 * Coerce an "array of numbers" input into a `Float64Array`. See
 * module docstring for full contract; this is the canonical
 * Float64Array side of `coerceNumberArray`.
 *
 *  - `undefined` / `null`             → `new Float64Array(0)` (when `optional`)
 *  - `Float64Array`                   → returned as-is (no copy)
 *  - plain `Array`                    → `Float64Array.from(x)`
 *  - other typed array (Float32 etc.) → `Float64Array.from(x)`
 *  - `DataView`                       → throws
 *  - anything else                    → throws with `fieldPath` context
 *
 * @type {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => Float64Array}
 */
export const coerceFloat64Array = _makeTypedArrayCoercer(Float64Array);

/** @type {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => Float32Array} */
export const coerceFloat32Array = _makeTypedArrayCoercer(Float32Array);

/** @type {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => Uint16Array} */
export const coerceUint16Array = _makeTypedArrayCoercer(Uint16Array);

/** @type {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => Uint8Array} */
export const coerceUint8Array = _makeTypedArrayCoercer(Uint8Array);

/** @type {(x: unknown, fieldPath: string, opts?: { optional?: boolean }) => Int32Array} */
export const coerceInt32Array = _makeTypedArrayCoercer(Int32Array);
