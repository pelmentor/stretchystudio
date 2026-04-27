/**
 * Face parallax storage helpers — Stage 4 of the native rig refactor.
 *
 * `WarpDeformerSpec` from `faceParallaxBuilder.js` contains
 * `Float64Array` fields for `baseGrid` and `keyform.positions` —
 * those don't survive `JSON.stringify` (they serialize as `{}`).
 * This module wraps spec ↔ JSON conversion and provides the
 * resolve/seed actions that other native rig stages established.
 *
 * **Storage format:** plain JSON tree mirroring the spec, with
 * `Float64Array` replaced by plain `number[]`. ~5× memory cost vs
 * binary, accepted because:
 *   - `.stretch` is JSON-based; binary would need base64 + custom
 *     parsing.
 *   - 9 keyforms × 72 floats + 72 baseGrid = ~720 numbers. Negligible
 *     vs the rest of `.stretch`.
 *
 * **Seeder semantics.** `seedFaceParallax(project, spec)` is
 * **destructive** — overwrites whatever was stored. The spec is
 * computed externally (caller runs a rigOnly export to get it, or
 * drives `buildFaceParallaxSpec` directly). v1 keeps this caller-
 * driven; future "Initialize Face Parallax" UI button (Stage 1b
 * territory) will package the build+seed.
 *
 * **Staleness invariant.** Stage 4 v1 does NOT track mesh signatures.
 * If user reimports PSD with re-meshed face, the stored vertex deltas
 * silently become stale. Documented as a known footgun; full
 * `signatureHash` tracking is deferred (see "Cross-cutting
 * invariants → ID stability" in NATIVE_RIG_REFACTOR_PLAN.md).
 *
 * @module io/live2d/rig/faceParallaxStore
 */

/**
 * Convert a face-parallax `WarpDeformerSpec` to a JSON-friendly value
 * (Float64Arrays → plain arrays). Pure; doesn't mutate input.
 *
 * @param {import('./rigSpec.js').WarpDeformerSpec} spec
 * @returns {object} JSON-safe storage shape
 */
export function serializeFaceParallaxSpec(spec) {
  return {
    id: spec.id,
    name: spec.name,
    parent: { type: spec.parent.type, id: spec.parent.id },
    gridSize: { rows: spec.gridSize.rows, cols: spec.gridSize.cols },
    baseGrid: Array.from(spec.baseGrid),
    localFrame: spec.localFrame,
    bindings: spec.bindings.map(b => ({
      parameterId: b.parameterId,
      keys: b.keys.slice(),
      interpolation: b.interpolation,
    })),
    keyforms: spec.keyforms.map(k => ({
      keyTuple: k.keyTuple.slice(),
      positions: Array.from(k.positions),
      opacity: k.opacity,
    })),
    isVisible: spec.isVisible,
    isLocked: spec.isLocked,
    isQuadTransform: spec.isQuadTransform,
  };
}

/**
 * Convert stored JSON back to a usable spec (plain arrays →
 * Float64Array). Lenient: missing fields are defaulted, so a
 * partially-corrupt entry returns a still-shaped spec rather than
 * blowing up. Returns `null` if the stored value is fundamentally
 * malformed (e.g., not an object, missing keyforms).
 *
 * @param {object} stored
 * @returns {import('./rigSpec.js').WarpDeformerSpec | null}
 */
export function deserializeFaceParallaxSpec(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (!Array.isArray(stored.keyforms) || stored.keyforms.length === 0) return null;
  if (!Array.isArray(stored.baseGrid)) return null;
  return {
    id:         stored.id ?? 'FaceParallaxWarp',
    name:       stored.name ?? 'Face Parallax',
    parent:     stored.parent ?? { type: 'rotation', id: 'FaceRotation' },
    gridSize:   stored.gridSize ?? { rows: 5, cols: 5 },
    baseGrid:   new Float64Array(stored.baseGrid),
    localFrame: stored.localFrame ?? 'pivot-relative',
    bindings:   (stored.bindings ?? []).map(b => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms:   stored.keyforms.map(k => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      positions: new Float64Array(k.positions ?? []),
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    isVisible:       stored.isVisible       ?? true,
    isLocked:        stored.isLocked        ?? false,
    isQuadTransform: stored.isQuadTransform ?? false,
  };
}

/**
 * Resolve `project.faceParallax` to a usable spec, or `null` if the
 * field is absent / malformed. When `null`, the writer falls back to
 * its inline heuristic (today's path).
 *
 * @param {object} project
 * @returns {import('./rigSpec.js').WarpDeformerSpec | null}
 */
export function resolveFaceParallax(project) {
  const stored = project?.faceParallax;
  if (!stored) return null;
  return deserializeFaceParallaxSpec(stored);
}

/**
 * Seed `project.faceParallax` from a pre-computed spec. Destructive —
 * overwrites whatever was stored. Caller is responsible for computing
 * the spec via `buildFaceParallaxSpec(...)` with current project state.
 *
 * @param {object} project - mutated
 * @param {import('./rigSpec.js').WarpDeformerSpec} spec
 * @returns {object} the serialized form written to project
 */
export function seedFaceParallax(project, spec) {
  const stored = serializeFaceParallaxSpec(spec);
  project.faceParallax = stored;
  return stored;
}

/**
 * Clear `project.faceParallax`. Used to revert to the heuristic path
 * (e.g., after PSD reimport invalidates stored deltas).
 *
 * @param {object} project - mutated
 */
export function clearFaceParallax(project) {
  project.faceParallax = null;
}
