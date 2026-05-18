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
 * # Why three presets
 *
 * Blender ships two default keyconfigs (`blender_default.py`,
 * `industry_compatible_data.py`). SS adds a third preset slot to
 * separate two distinct mappings of the `blender_default.py` file:
 *
 *   - **`'default'` (SS preset; toggle-branch mapping)** —
 *     `blender_default.py:3864` →
 *     `_template_items_select_actions` toggle branch at `:435-439`
 *     (gated by `use_select_all_toggle=True`): A → TOGGLE,
 *     Alt+A → DESELECT, Ctrl+I → INVERT. Matches FCurveEditor's
 *     pre-5.AA behavior (hand-rolled "A clears if anything selected,
 *     else select-all" — exactly the toggle semantic). SS picks this
 *     as the default-out-of-the-box preset for SS users because the
 *     toggle UX is more discoverable than the SELECT-only no-toggle
 *     UX. Note: this is an SS UX choice — Blender's actual
 *     out-of-the-box default is `'default_no_toggle'` below.
 *
 *   - **`'default_no_toggle'` (SS preset; Slice 5.GG 2026-05-18)** —
 *     byte-faithful port of Blender's TRUE out-of-the-box default
 *     config (`blender_default.py:115` `use_select_all_toggle=False`,
 *     which gates the `:422-427` no-toggle branch): A → SELECT,
 *     Alt+A → DESELECT, Ctrl+I → INVERT, A_DOUBLE_CLICK → DESELECT
 *     (`:426`, web-omitted in SS). Closes Slice 5.AA Dev 1 deviation.
 *
 *   - **`'industry_compatible'`** —
 *     `keymap_data/industry_compatible_data.py` Maya/Adobe-style
 *     bindings: Ctrl+A adds, Ctrl+Shift+A deselects, Ctrl+I inverts.
 *     No single-key toggle.
 *
 * The Blender `default` vs `industry_compatible` choice is exposed
 * in Blender's UI at Edit → Preferences → Keymap. SS exposes the
 * (extended) 3-option toggle as `preferencesStore.keymapPreset`.
 *
 * Audit-fix HIGH-A1 (Slice 5.AA fidelity audit 2026-05-17) corrected
 * the original "two presets, default=toggle = Blender out-of-the-box"
 * misframing in this section. Slice 5.GG (this slice) closes the
 * follow-on deviation by adding the byte-faithful third preset.
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
 * binding family because the three SS presets map the same operator
 * (`anim.channels_select_all` / `graph.select_all`) to different
 * (key, modifier, action) combos:
 *
 *   - `'default'` (SS preset; toggle-branch mapping) —
 *     `blender_default.py:3864` via `_template_items_select_actions`
 *     toggle branch at `:435-439`:
 *     - A          → TOGGLE   (`:436`)
 *     - Alt+A      → CLEAR    (`:437`)
 *     - Ctrl+I     → INVERT   (`:438`)
 *
 *   - `'default_no_toggle'` (SS preset; Slice 5.GG 2026-05-18) —
 *     byte-faithful Blender out-of-the-box default at `:422-427`:
 *     - A          → ADD      (`:423`)
 *     - Alt+A      → CLEAR    (`:424`)
 *     - Ctrl+I     → INVERT   (`:425`)
 *     A_DOUBLE_CLICK → DESELECT (`:426`) is omitted (web KeyboardEvent
 *     has no clean keyboard-double-press semantic; Blender's row only
 *     fires from mouse double-click anyway). Audit-fix LOW-A1
 *     (Slice 5.AA) noted this for the `'default'` preset; the same
 *     omission applies here.
 *
 *   - `'industry_compatible'` —
 *     `industry_compatible_data.py:2345-2350` (channels region) +
 *     `:963-966` (graph region — identical mapping in both):
 *     - Ctrl+A         → ADD (SELECT)
 *     - Ctrl+Shift+A   → CLEAR (DESELECT)
 *     - Ctrl+I         → INVERT
 *
 * Note `industry_compatible` AND `default_no_toggle` both have NO
 * TOGGLE binding — the "toggle" semantic exists ONLY in the
 * `'default'` preset (SS's pre-5.AA behavior carried forward).
 * Callers that bind A in `'default'` mode get `'toggle'`; in
 * `'default_no_toggle'` they get `'add'`; in `'industry_compatible'`
 * the bare A key is unbound (Ctrl+A binds to `'add'`).
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
 * @typedef {'default' | 'default_no_toggle' | 'industry_compatible'} KeymapPreset
 */

/**
 * @typedef {object} EventLikeKeyState
 *   Normalized read-only view of the keyboard event subset the
 *   resolvers consume. Tests pass plain objects; the React handler
 *   spreads `e` into this shape.
 * @property {string} code      — `e.code` (KeyboardEvent.code, e.g. 'KeyA')
 * @property {boolean} ctrlKey
 * @property {boolean} metaKey  — SS treats as Ctrl-equivalent on macOS
 *                                (web/DOM convention; NOT a Blender port —
 *                                Blender keeps `KM_CTRL` and `KM_OSKEY`
 *                                as distinct modifiers per
 *                                `wm_event_system.cc:2470-2471`).
 * @property {boolean} altKey
 * @property {boolean} shiftKey
 */

/** @type {readonly KeymapPreset[]} */
export const KEYMAP_PRESETS = Object.freeze(['default', 'default_no_toggle', 'industry_compatible']);

/** @type {KeymapPreset} */
export const KEYMAP_PRESET_DEFAULT = 'default';

/**
 * Coerce arbitrary input to a valid `KeymapPreset`, defaulting to
 * `'default'` on any unrecognized value. The preferencesStore setter
 * already does this for stored values, but the resolvers also coerce
 * defensively in case a caller passes a stale or hand-crafted preset.
 *
 * Slice 5.GG (2026-05-18): added `'default_no_toggle'` as the third
 * valid preset — byte-faithful port of Blender's out-of-the-box
 * default config (`blender_default.py:115` `use_select_all_toggle=False`).
 * Closes Slice 5.AA Dev 1 deviation.
 *
 * @param {unknown} value
 * @returns {KeymapPreset}
 */
export function coerceKeymapPreset(value) {
  if (value === 'industry_compatible') return 'industry_compatible';
  if (value === 'default_no_toggle') return 'default_no_toggle';
  return 'default';
}

/**
 * Resolve a keyboard event to a `SelectAllMode` value per the active
 * preset. Returns `null` when no binding in the preset matches the
 * event — caller should fall through to the next handler.
 *
 * Treats `metaKey` as Ctrl-equivalent so macOS users get the same
 * bindings as Linux/Windows without per-platform branching at the
 * call site. **SS deviation** — Blender's keymap matcher at
 * `reference/blender/source/blender/windowmanager/intern/wm_event_system.cc:2470-2471`
 * checks `KM_OSKEY` independently from `KM_CTRL`; macOS-specific
 * keymap entries (when shipped) carry their own oskey flag rather
 * than falling back to ctrl. SS collapses the two because (a) the
 * browser surfaces metaKey separately and (b) Cmd-as-Ctrl is the
 * established web/DOM convention for cross-platform shortcuts.
 * Audit-fix HIGH-A2 (Slice 5.AA fidelity audit 2026-05-17): this
 * deviation was previously framed as if it were a Blender port —
 * corrected here.
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
    // `blender_default.py:3864` → `_template_items_select_actions`
    // toggle branch at `:435-439` (SS deviation from default-config
    // no-toggle branch at `:422-427` — see module JSDoc "Why three
    // presets" for rationale; the byte-faithful no-toggle preset is
    // available as `'default_no_toggle'`).
    // - A (no modifiers)        → TOGGLE  (`:436`)
    // - Alt+A (no ctrl/shift)   → CLEAR   (`:437`)
    // - Ctrl+I (no alt/shift)   → INVERT  (`:438`)
    if (e.code === 'KeyA' && !ctrl && !e.altKey && !e.shiftKey) return 'toggle';
    if (e.code === 'KeyA' && !ctrl && e.altKey && !e.shiftKey) return 'clear';
    if (e.code === 'KeyI' && ctrl && !e.altKey && !e.shiftKey) return 'invert';
    return null;
  }

  if (p === 'default_no_toggle') {
    // Slice 5.GG (2026-05-18) — byte-faithful Blender default-config.
    // `blender_default.py:3864` → `_template_items_select_actions`
    // no-toggle branch at `:422-427` (the `if (!params.use_select_all_toggle)`
    // path; `use_select_all_toggle=False` is Blender's out-of-the-box
    // default per `:115`).
    // - A (no modifiers)        → ADD     (`:423` SELECT_ADD)
    // - Alt+A (no ctrl/shift)   → CLEAR   (`:424` SELECT_DESELECT)
    // - Ctrl+I (no alt/shift)   → INVERT  (`:425` SELECT_INVERT)
    // - A_DOUBLE_CLICK omitted (`:426`) — SS has no clean keyboard-
    //   double-press semantic in web KeyboardEvent (sister to Slice
    //   5.AA module-header LOW-A1 note for `'default'` preset).
    if (e.code === 'KeyA' && !ctrl && !e.altKey && !e.shiftKey) return 'add';
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

/**
 * Slice 5.II — resolve a keyboard event to the channels-region
 * `anim.channels_delete` operator (sidebar X/Backspace/DEL).
 *
 * Per-preset divergence (DEL works in BOTH; the extra key differs):
 *   - `'default'` / `'default_no_toggle'`:
 *       `blender_default.py:3873-3874` — X or DEL.
 *   - `'industry_compatible'`:
 *       `industry_compatible_data.py:2357-2358` — BACKSPACE or DEL.
 *
 * Returns `'delete'` when the event matches the active preset's
 * channel-delete binding, `null` otherwise. Caller (FCurveEditor's
 * onKeyDown handler) gates on `regionHoverRef.current === 'sidebar'`
 * because the operator is channels-region only — pressing X over the
 * timeline does NOT dispatch this; it falls through to the existing
 * `operatorDelete` keyform-delete path (Slice 5.C).
 *
 * Closes a Slice 5.N inline TODO ("Industry-Compatible keymap binds
 * Backspace for channel delete — not wired today. Per Slice 5.M
 * Deviation 2 precedent, gated on an SS keymap-preset selector that
 * doesn't exist yet."). The selector now exists (Slices 5.AA + 5.GG
 * + 5.HH UI), so the IC binding is wired here.
 *
 * macOS Cmd is NOT applicable to this binding family — Blender's
 * keymap entries for anim.channels_delete carry no `ctrl/meta`
 * modifiers, so the resolver only matches bare keypresses.
 *
 * @param {KeymapPreset | string | null | undefined} preset
 * @param {EventLikeKeyState} e
 * @returns {'delete' | null}
 */
export function resolveChannelDeleteAction(preset, e) {
  if (!e || typeof e !== 'object') return null;
  // No-modifier requirement: Blender's keymap entries carry no
  // `ctrl/shift/alt/oskey` — reject any modifier permutation.
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;

  // Delete is bound in BOTH presets — short-circuit common path.
  if (e.code === 'Delete') return 'delete';

  const p = coerceKeymapPreset(preset);

  if (p === 'industry_compatible') {
    // IC: BACKSPACE / DEL (`industry_compatible_data.py:2357-2358`)
    if (e.code === 'Backspace') return 'delete';
    return null;
  }

  // p === 'default' OR 'default_no_toggle'.
  // `'default_no_toggle'` inherits the default channel-delete binding
  // (only the select-all triplet differs between `'default'` and
  // `'default_no_toggle'` — Slice 5.GG); both use the same
  // `blender_default.py:3873-3874` X / DEL pair.
  if (e.code === 'KeyX') return 'delete';
  return null;
}

/**
 * Slice 5.JJ — resolve a keyboard event to the graph-region
 * `graph.hide` / `graph.reveal` operators (H / Shift+H / Alt+H or
 * Ctrl+H / Shift+H / Alt+H).
 *
 * Per-preset divergence (only the "hide selected" key differs;
 * Shift+H and Alt+H are shared across all presets):
 *
 *   - `'default'` / `'default_no_toggle'`:
 *       `blender_default.py:1967` → `_template_items_hide_reveal_actions`
 *       at `:461-466`:
 *         - H            → hide selected (`graph.hide`, unselected=false)
 *         - Shift+H      → hide unselected (`graph.hide`, unselected=true)
 *         - Alt+H        → reveal (`graph.reveal`)
 *
 *   - `'industry_compatible'`:
 *       `industry_compatible_data.py:919-923`:
 *         - Ctrl+H       → hide selected (`graph.hide`, unselected=false)
 *         - Shift+H      → hide unselected (`graph.hide`, unselected=true)
 *         - Alt+H        → reveal (`graph.reveal`)
 *
 * Shift+H and Alt+H are IDENTICAL across all 3 presets. The ONLY
 * divergence is the "hide selected" key: bare H in default, Ctrl+H
 * in industry-compatible. (Sister-pattern to Slice 5.II's
 * channel-delete: shared DEL + divergent X/Backspace.)
 *
 * Returns one of `'hide_selected'`, `'hide_unselected'`, `'reveal'`,
 * or `null`. Caller (FCurveEditor's onKeyDown handler) maps these
 * to `applyHideOp('selected')`, `applyHideOp('unselected')`, and
 * `applyRevealOp()` respectively (Slice 5.M dispatcher).
 *
 * Region routing: Blender's H/Shift+H/Alt+H bind only in the
 * km_graph_editor (timeline region); `km_animation_channels`
 * (sidebar) does NOT bind these keys — sidebar visibility is
 * toggled per-row via W (`anim.channels_setting_toggle`,
 * `blender_default.py:3876`). SS's existing dispatcher inherits
 * this convention: the resolver is region-agnostic; the caller
 * decides whether to gate on `regionHoverRef.current`. Today the
 * caller does NOT gate (fires regardless of cursor region —
 * documented at Slice 5.M dispatcher).
 *
 * macOS Cmd: per the same web/DOM convention used in
 * `resolveSelectAllAction` (Slice 5.AA HIGH-A2 audit deviation),
 * `metaKey` is treated as Ctrl-equivalent. So Cmd+H on macOS in
 * `'industry_compatible'` preset also resolves to 'hide_selected'.
 *
 * @param {KeymapPreset | string | null | undefined} preset
 * @param {EventLikeKeyState} e
 * @returns {'hide_selected' | 'hide_unselected' | 'reveal' | null}
 */
export function resolveHideRevealAction(preset, e) {
  if (!e || typeof e !== 'object') return null;
  if (e.code !== 'KeyH') return null;  // short-circuit non-H presses

  const ctrl = e.ctrlKey || e.metaKey;

  // Shared bindings across all 3 presets — check before per-preset split.
  // Alt+H → reveal (no ctrl/shift)
  if (e.altKey && !ctrl && !e.shiftKey) return 'reveal';
  // Shift+H → hide unselected (no ctrl/alt)
  if (e.shiftKey && !ctrl && !e.altKey) return 'hide_unselected';

  // Divergent: "hide selected" key combo.
  const p = coerceKeymapPreset(preset);

  if (p === 'industry_compatible') {
    // IC: Ctrl+H → hide selected (no shift/alt)
    if (ctrl && !e.shiftKey && !e.altKey) return 'hide_selected';
    return null;
  }

  // p === 'default' OR 'default_no_toggle'.
  // `'default_no_toggle'` inherits the default hide/reveal bindings
  // (only the select-all triplet differs between `'default'` and
  // `'default_no_toggle'` — Slice 5.GG).
  // Default: bare H → hide selected (no modifiers).
  if (!ctrl && !e.shiftKey && !e.altKey) return 'hide_selected';
  return null;
}
