// @ts-check

/**
 * Toolset Plan Phase 4 — Scene-ref registry.
 *
 * Module-scope holder for the WebGL scene's `partsRenderer` so global
 * keymap operators (Phase 4 Merge / Dissolve / Subdivide) can re-upload
 * mesh data after a topology mutation without threading the React
 * `sceneRef` through the operator dispatcher.
 *
 * Mirrors the existing `lastMousePos()` pattern in
 * `v3/operators/registry.js`: a single shared global, set by the
 * component that owns the resource (CanvasViewport on mount), read by
 * any operator that needs it.
 *
 * The registry is intentionally tiny — `set` / `get` only. Tests run
 * without a registered scene; consumers should `if (scene && scene.parts)`
 * before calling.
 *
 * @module lib/sceneRegistry
 */

/** @type {{ parts?: any, _markDirty?: () => void } | null} */
let _scene = null;

/**
 * Register the scene. CanvasViewport calls this on mount.
 *
 * Pass `{ parts: sceneRef.current.parts, _markDirty: () => isDirtyRef.current = true }`
 * — the dirty marker is split out as its own callback so the registry
 * doesn't have to know about CanvasViewport's render-loop internals.
 *
 * Pass `null` to clear (CanvasViewport's effect cleanup).
 *
 * @param {{ parts?: any, _markDirty?: () => void } | null} scene
 */
export function setSceneRef(scene) {
  _scene = scene ?? null;
}

/**
 * Read the registered scene. Returns null when no scene is registered
 * (typical in unit tests).
 */
export function getSceneRef() {
  return _scene;
}
