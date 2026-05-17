// @ts-check

/**
 * Animation Phase 5 Slice 5.AA — keymap-preset selector.
 *
 * Pure binding resolvers that switch on the active keymap preset
 * (`'default'` vs `'industry_compatible'`) and return the operator
 * mode the caller should dispatch.
 *
 * Sister to the preference slot at
 * [src/store/preferencesStore.js::keymapPreset](../store/preferencesStore.js).
 * Callers (the FCurveEditor keydown handler today; future editors and
 * keybinds tomorrow) read the preset via
 * `usePreferencesStore.getState().keymapPreset` and pass it +
 * normalized event-key state to the resolver of their choice.
 *
 * # Why two presets
 *
 * Blender ships two default keyconfigs:
 *
 *   - `keymap_data/blender_default.py` — historical Blender bindings
 *     (A toggles selection, Alt+A deselects, Ctrl+I inverts).
 *   - `keymap_data/industry_compatible_data.py` — Maya/Adobe-style
 *     bindings (Ctrl+A adds, Ctrl+Shift+A deselects, Ctrl+I inverts;
 *     no single-key toggle).
 *
 * The choice is exposed in Blender's UI at Edit → Preferences →
 * Keymap. SS exposes the same toggle as `preferencesStore.keymapPreset`.
 *
 * # What this module owns (and what it doesn't)
 *
 * **Owns**: the modifier-to-action mapping for keyboard bindings that
 * differ between the two presets. Each binding family gets its own
 * exported resolver (`resolveSelectAllAction` is the only one in
 * 5.AA; future slices add `resolveBoxSelectAction`,
 * `resolveDeleteAction`, etc.).
 *
 * **Doesn't own**: the dispatch site (the editor's keydown handler is
 * still responsible for `e.preventDefault()` + invoking the operator);
 * the operator semantics (those live in the per-helper files in
 * `src/anim/fcurveChannelSelect.js` etc.); the UI for switching
 * presets (lives in a Preferences panel — out of scope for 5.AA, the
 * setter is reachable via `usePreferencesStore.getState()` for now).
 *
 * # Slice 5.AA wired-today: `resolveSelectAllAction`
 *
 * The select-all triplet is the canonical "differs between presets"
 * binding family because both `default` and `industry_compatible` map
 * the same operator (`anim.channels_select_all` / `graph.select_all`)
 * to different (key, modifier) combos:
 *
 *   - Default keymap (`blender_default.py:3864` via
 *     `_template_items_select_actions` at `:420-439`):
 *     - A          → TOGGLE
 *     - Alt+A      → CLEAR (DESELECT)
 *     - Ctrl+I     → INVERT
 *
 *   - Industry-compatible keymap
 *     (`industry_compatible_data.py:2345-2350` for channels region;
 *     `:963-966` for graph region — identical mapping in both):
 *     - Ctrl+A         → ADD (SELECT)
 *     - Ctrl+Shift+A   → CLEAR (DESELECT)
 *     - Ctrl+I         → INVERT
 *
 * Note `industry_compatible` has NO TOGGLE binding — the "toggle"
 * semantic doesn't exist in that preset. Callers that bind A in
 * default mode get `'toggle'`; in IC mode the same key is unbound.
 *
 * # No migration
 *
 * The preference slot is a top-level scalar with default `'default'`.
 * Pre-existing users get the default Blender mapping unchanged. Per
 * Rule №2: no migration baggage.
 *
 * @module anim/keymapPresets
 */

/**
 * @typedef {'default' | 'industry_compatible'} KeymapPreset
 */

/**
 * @typedef {object} EventLikeKeyState
 *   Normalized read-only view of the keyboard event subset the
 *   resolvers consume. Tests pass plain objects; the React handler
 *   spreads `e` into this shape.
 * @property {string} code      — `e.code` (KeyboardEvent.code, e.g. 'KeyA')
 * @property {boolean} ctrlKey
 * @property {boolean} metaKey  — treated as Ctrl equivalent (macOS Cmd)
 * @property {boolean} altKey
 * @property {boolean} shiftKey
 */

/** @type {readonly KeymapPreset[]} */
export const KEYMAP_PRESETS = Object.freeze(['default', 'industry_compatible']);

/** @type {KeymapPreset} */
export const KEYMAP_PRESET_DEFAULT = 'default';

/**
 * Coerce arbitrary input to a valid `KeymapPreset`, defaulting to
 * `'default'` on any unrecognized value. The preferencesStore setter
 * already does this for stored values, but the resolvers also coerce
 * defensively in case a caller passes a stale or hand-crafted preset.
 *
 * @param {unknown} value
 * @returns {KeymapPreset}
 */
export function coerceKeymapPreset(value) {
  return value === 'industry_compatible' ? 'industry_compatible' : 'default';
}

/**
 * Resolve a keyboard event to a `SelectAllMode` value per the active
 * preset. Returns `null` when no binding in the preset matches the
 * event — caller should fall through to the next handler.
 *
 * Treats `metaKey` as Ctrl-equivalent so macOS users get the same
 * bindings as Linux/Windows without per-platform branching at the
 * call site.
 *
 * @param {KeymapPreset | string | null | undefined} preset
 * @param {EventLikeKeyState} e
 * @returns {'toggle' | 'add' | 'clear' | 'invert' | null}
 */
export function resolveSelectAllAction(preset, e) {
  if (!e || typeof e !== 'object') return null;
  const p = coerceKeymapPreset(preset);
  const ctrl = e.ctrlKey || e.metaKey;

  if (p === 'default') {
    // `blender_default.py:3864` → `_template_items_select_actions` at `:420-439`.
    // - A (no modifiers)        → TOGGLE
    // - Alt+A (no ctrl/shift)   → CLEAR
    // - Ctrl+I (no alt/shift)   → INVERT
    if (e.code === 'KeyA' && !ctrl && !e.altKey && !e.shiftKey) return 'toggle';
    if (e.code === 'KeyA' && !ctrl && e.altKey && !e.shiftKey) return 'clear';
    if (e.code === 'KeyI' && ctrl && !e.altKey && !e.shiftKey) return 'invert';
    return null;
  }

  // p === 'industry_compatible'
  // `industry_compatible_data.py:2345-2350` (channels region) +
  // `:963-966` (graph region — identical triplet).
  // - Ctrl+A (no alt/shift)       → ADD
  // - Ctrl+Shift+A (no alt)       → CLEAR
  // - Ctrl+I (no alt/shift)       → INVERT
  if (e.code === 'KeyA' && ctrl && !e.altKey && !e.shiftKey) return 'add';
  if (e.code === 'KeyA' && ctrl && !e.altKey && e.shiftKey) return 'clear';
  if (e.code === 'KeyI' && ctrl && !e.altKey && !e.shiftKey) return 'invert';
  return null;
}
