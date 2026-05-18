// @ts-check

/**
 * v3 Phase 5 — user preferences for behaviours that aren't theming.
 *
 * Currently a single flag, but the store is structured to grow: every
 * preference is read on first access from localStorage, write-through on
 * setter call.
 *
 *   - `mlEnabled`         — Pillar O. When false, the AI Auto-Rig (DWPose)
 *                           entry in the PSD import wizard is hidden.
 *                           Default = true so existing users don't lose
 *                           access on upgrade.
 *   - `proportionalEdit`  — GAP-015 Phase B. Blender-style proportional
 *                           editing toggle + radius + falloff +
 *                           connected-only flag. Persisted across
 *                           sessions because users develop muscle memory
 *                           around their preferred radius / falloff.
 *
 * Theme / typography prefs are owned by `ThemeProvider`; this store does
 * not duplicate them.
 *
 * @module store/preferencesStore
 */

import { create } from 'zustand';
import { coerceKeymapPreset } from '../anim/keymapPresets.js';

const ML_KEY = 'v3.prefs.mlEnabled';
const PE_KEY = 'v3.prefs.proportionalEdit';
const VLP_KEY = 'v3.prefs.viewLayerPresets';
const LOM_KEY = 'v3.prefs.lockObjectModes';
const LTM_KEY = 'v3.prefs.lastToolByMode';
/** Animation Phase 5 Slice 5.U — `USER_FLAG_NUMINPUT_ADVANCED` port.
 *  Blender's `User.flag & USER_FLAG_NUMINPUT_ADVANCED` bit
 *  (`reference/blender/source/blender/makesdna/DNA_userdef_types.h:34`),
 *  exposed in Python as `user_preferences.inputs.use_numeric_input_advanced`
 *  (`reference/blender/source/blender/makesrna/intern/rna_userdef.cc:6679-6684`,
 *  label "Default to Advanced Numeric Input"). When ON, a digit/sign/dot
 *  keystroke in a modal G/R/S immediately enters numericMode (Blender's
 *  NUM_EDIT_FULL flip from `numinput.cc:352-365`); when OFF (Blender
 *  default), the user must press `=` to enter numericMode. */
const NIA_KEY = 'v3.prefs.useNumericInputAdvanced';
/** Animation Plan Phase 0.D.0 — eval-engine selector. `'classic'`
 *  (default) routes the viewport tick through chainEval's `evalRig`.
 *  `'depgraph'` routes through `evalProjectFrameViaDepgraph` (Phase
 *  0.D.0 wire-in + Phase 0.D armature port). Default flip from
 *  `'classic'` → `'depgraph'` is gated on the user-side manual byte-
 *  fidelity sweep on Shelby + test_image4 PSDs. */
const EVAL_KEY = 'v3.prefs.evalEngine';
/** Toolset Plan Phase 2 — snap config (modal G / R / S). Persisted as
 *  one JSON blob keyed `v3.prefs.snap`. See SNAP_DEFAULT below for
 *  schema; Phase 2.A. */
const SNAP_KEY = 'v3.prefs.snap';
/** Animation Phase 5 Slice 5.AA — keymap-preset selector.
 *  Mirrors Blender's preference at Edit → Preferences → Keymap dropdown.
 *  Python sources:
 *    - `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py`
 *    - `reference/blender/scripts/presets/keyconfig/keymap_data/industry_compatible_data.py`
 *    - User-facing dropdown registered in
 *      `reference/blender/scripts/presets/keyconfig/Blender.py`.
 *  Slice 5.GG (2026-05-18) extended to 3 presets (added byte-faithful
 *  `'default_no_toggle'` closing Slice 5.AA Dev 1):
 *    - `'default'`              — `keymap_data/blender_default.py`
 *                                  toggle branch at `:435-439` (A → TOGGLE;
 *                                  SS-default-out-of-box because toggle UX
 *                                  is more discoverable; SS deviation from
 *                                  Blender's actual out-of-box default)
 *    - `'default_no_toggle'`    — `keymap_data/blender_default.py` no-toggle
 *                                  branch at `:422-427` (A → SELECT;
 *                                  byte-faithful Blender out-of-box default
 *                                  per `:115` `use_select_all_toggle=False`)
 *    - `'industry_compatible'`  — `keymap_data/industry_compatible_data.py`
 *                                  (Ctrl+A SELECT / Ctrl+Shift+A DESELECT /
 *                                  Ctrl+I INVERT; no single-key toggle)
 *  Switching at runtime swaps the binding map consulted by
 *  `src/anim/keymapPresets.js::resolveSelectAllAction` (the only call
 *  site wired in 5.AA — future slices add their own preset-aware
 *  bindings to the same module). All 3 presets coerced via the
 *  single `coerceKeymapPreset` helper (Slice 5.AA arch audit-fix MED-2). */
const KMP_KEY = 'v3.prefs.keymapPreset';

const PE_DEFAULT = Object.freeze({
  enabled:       false,
  radius:        100,
  falloff:       'smooth',
  connectedOnly: false,
});

/** Toolset Plan Phase 2 — snap config defaults (audit-fixed 2026-05-10).
 *
 *  Gesture model is Blender-faithful:
 *    - Master `enabled` (the "magnet" toggle): when true, snap auto-
 *      engages during modal G/R/S — no Shift required to engage. When
 *      false, no snap of any kind (modal is free-transform).
 *    - Shift (during modal): MOD_PRECISION — fine-grained input.
 *      Free-transform * 0.1; snap math uses the per-mode `precision`
 *      value instead of the regular value/increment/threshold.
 *    - Ctrl (during modal): MOD_SNAP_INVERT — temporarily flips the
 *      master state for the duration of the press (master on + Ctrl
 *      held = no snap that frame; master off + Ctrl held = snap fires).
 *    - Modes coexist: with both vertex + grid enabled, vertex snap
 *      wins when cursor is within threshold; otherwise grid applies.
 *
 *  Per-mode defaults (SS choices, NOT claimed Blender parity):
 *    - `modes.grid` (`enabled:true, increment:16, precision:1.6`):
 *      Modal G delta rounded to multiples of `increment`; Shift uses
 *      `precision` instead. (Blender's 2D grid is adaptive `1/pixel_width`;
 *      16 px is a SS pick because the prior hardcode was 10 px and the
 *      bump aligns better with typical PSD pixel budgets.)
 *    - `modes.vertex` (`enabled:true, threshold:8`): auto-engages
 *      when cursor is within `threshold` canvas-px of a project rest
 *      vertex (or evaluated-vertex in Pose Mode — see snapHash.js).
 *      Threshold is canvas-px so it tracks zoom. No precision field
 *      because Blender's vertex snap doesn't have one either.
 *    - `modes.increment` (`enabled:false, value:5, precision:1`):
 *      Modal R rotation snap step in degrees; Shift uses `precision`.
 *      Defaults match Blender 1:1 (`snap_angle_increment_2d = 5°`,
 *      `_precision = 1°` from `DNA_scene_types.h:2430`). Modal S
 *      snap step is `value/100` (5° → 0.05× per-Shift), Shift
 *      precision = `precision/100`.
 *    - `target` (`'closest' | 'center' | 'median' | 'active'`):
 *      Selects which point of the active selection lands ON the snap
 *      target. `closest` = nearest selected vertex (Edit Mode) /
 *      bbox corner (Object Mode) to the snap target — Blender-faithful
 *      semantics from `transform_snap.cc:snap_source_closest_fn`. */
const SNAP_DEFAULT = Object.freeze({
  enabled: false,
  modes: Object.freeze({
    grid:      Object.freeze({ enabled: true,  increment: 16, precision: 1.6 }),
    vertex:    Object.freeze({ enabled: true,  threshold:   8 }),
    increment: Object.freeze({ enabled: false, value:       5, precision: 1   }),
  }),
  target: 'closest',
});

/** Deep-merge a saved snap blob over `SNAP_DEFAULT`. The shallow
 *  `loadJson` merge in this file collapses nested `modes.{grid|vertex|
 *  increment}` if the saved blob is missing one — clobbering the
 *  defaults with `undefined`. This recursive helper preserves any
 *  per-mode subkey that wasn't persisted (e.g. on schema bumps).
 *
 *  Audit-fix 2026-05-10 — also picks up the new `precision` fields on
 *  grid / increment without dropping a saved blob from before that
 *  field existed. */
function mergeSnap(saved) {
  if (!saved || typeof saved !== 'object') {
    return JSON.parse(JSON.stringify(SNAP_DEFAULT));
  }
  const modes = saved.modes && typeof saved.modes === 'object' ? saved.modes : {};
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : SNAP_DEFAULT.enabled,
    modes: {
      grid: {
        ...SNAP_DEFAULT.modes.grid,
        ...(modes.grid && typeof modes.grid === 'object' ? modes.grid : {}),
      },
      vertex: {
        ...SNAP_DEFAULT.modes.vertex,
        ...(modes.vertex && typeof modes.vertex === 'object' ? modes.vertex : {}),
      },
      increment: {
        ...SNAP_DEFAULT.modes.increment,
        ...(modes.increment && typeof modes.increment === 'object' ? modes.increment : {}),
      },
    },
    target: typeof saved.target === 'string' && ['closest', 'center', 'median', 'active'].includes(saved.target)
      ? saved.target
      : SNAP_DEFAULT.target,
  };
}

/** Last-used tool per `editMode`. Keys mirror `editorStore.editMode`
 *  values: `null` is encoded as `'object'`. Reseeded by
 *  `editorStore.setToolMode` so sticky tool choices persist across
 *  Tab in/out within a session AND across page reloads. Values must
 *  be strings the toolbar's `tools.js` advertises for that mode —
 *  unknown values fall back to the mode's first sticky tool entry. */
const LTM_DEFAULT = Object.freeze({
  object: 'select',
  edit:   'brush',          // Blender's universal Edit Mode (was 'mesh')
  pose:   'joint_drag',     // Blender's OB_MODE_POSE (was 'skeleton')
});

/** GAP-016 Phase B — `viewLayerPresets` is a dict of user-named
 *  view-layer snapshots. Empty by default; `setViewLayerPreset(name,
 *  layers)` creates/overwrites; `deleteViewLayerPreset(name)` removes.
 *  Names are arbitrary strings (kept distinct from the three built-in
 *  presets `Clean` / `Modeling` / `Diagnostics` which are coded
 *  directly in the popover). */
const VLP_DEFAULT = Object.freeze({});

function loadBool(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function saveBool(key, val) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, val ? 'true' : 'false'); } catch { /* ignore */ }
}

function loadJson(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, val) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

/** Read a JSON-encoded scalar (string/number/bool). `loadJson` is
 *  object-shaped and would discard scalars; this helper is for
 *  prefs whose value is a single token (e.g. evalEngine). */
function loadJsonScalar(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export const usePreferencesStore = create((set, get) => ({
  mlEnabled: loadBool(ML_KEY, true),
  proportionalEdit: loadJson(PE_KEY, PE_DEFAULT),
  viewLayerPresets: loadJson(VLP_KEY, VLP_DEFAULT),
  /** Blender's "Lock Object Modes". When true (default — matches
   *  Blender), clicking a different node while in edit mode is
   *  rejected by `editorStore.setSelection` — the user stays focused
   *  on the currently-edited node until they Tab out. When false,
   *  selection-head changes auto-exit edit mode (the prior SS
   *  behaviour). */
  lockObjectModes: loadBool(LOM_KEY, true),

  /** Slice 5.U — Blender's `USER_FLAG_NUMINPUT_ADVANCED`. Default `false`
   *  matches Blender's default. Read by FCurveEditor's `keyEventToAction`
   *  call site and by the viewport+vertex modal overlays' key handlers;
   *  when ON, the first digit/sign/dot in a modal G/R/S enters numericMode
   *  atomically (via the reducer's `appendTypedAuto` action) instead of
   *  requiring an explicit `=` keystroke first. See
   *  [lib/modal/transformInputReducer.js](../lib/modal/transformInputReducer.js)
   *  module JSDoc "USER_FLAG_NUMINPUT_ADVANCED — CLOSED Slice 5.U". */
  useNumericInputAdvanced: loadBool(NIA_KEY, false),
  /** Last-used tool per editMode (`'object' | 'edit' | 'skeleton' |
   *  'blendShape'`). Persisted across sessions so sticky tool choices
   *  (e.g. preferring `add_vertex` over the default `brush` in Edit
   *  Mode) survive Tab out / Tab in, page reload, and project switch.
   *  See `editorStore.enterEditMode` (reads on entry) and
   *  `editorStore.setToolMode` (writes on every tool flip). */
  lastToolByMode: (() => {
    // Legacy slot-name normalisation. Pre-2026-05-07 SS used the slot
    // names 'mesh' (Blender's universal OB_MODE_EDIT) and 'skeleton'
    // (Blender's OB_MODE_POSE). Renamed to match Blender's taxonomy:
    //   'mesh'     → 'edit'
    //   'skeleton' → 'pose'
    // Rewrite legacy keys on load (lossy: drops the legacy key after
    // copying its value to the new key).
    let loaded = loadJson(LTM_KEY, LTM_DEFAULT);
    if (!loaded || typeof loaded !== 'object') return loaded;
    if ('mesh' in loaded && !('edit' in loaded)) {
      const { mesh: _mesh, ...rest } = loaded;
      loaded = { ...rest, edit: _mesh };
    }
    if ('skeleton' in loaded && !('pose' in loaded)) {
      const { skeleton: _sk, ...rest } = loaded;
      loaded = { ...rest, pose: _sk };
    }
    // Drop dead 'blendShape' key (folded into Edit Mode 2026-05-07 — Fix 1).
    if ('blendShape' in loaded) {
      const { blendShape: _bs, ...rest } = loaded;
      loaded = rest;
    }
    return loaded;
  })(),
  /** Animation Plan Phase 0.D.0 evalEngine selector — `'classic' | 'depgraph'`.
   *  Default `'classic'` (chainEval). `'depgraph'` is fully wired into
   *  the viewport tick (CanvasViewport → `evalProjectFrameViaDepgraph`)
   *  with bone post-chain skinning + ART_MESH_EVAL kernel; flipping the
   *  default to `'depgraph'` is the Phase 0.D exit gate, blocked on a
   *  user-side manual byte-fidelity sweep against Shelby + test_image4. */
  evalEngine: (loadJsonScalar(EVAL_KEY, 'classic') === 'depgraph') ? 'depgraph' : 'classic',

  setEvalEngine(v) {
    const next = v === 'depgraph' ? 'depgraph' : 'classic';
    saveJson(EVAL_KEY, next);
    set({ evalEngine: next });
  },

  /** Slice 5.AA — keymap-preset selector. `'default'` (Blender default)
   *  or `'industry_compatible'` (the Maya-style remapping shipped as
   *  Blender's second-default preset). Read by
   *  `src/anim/keymapPresets.js::resolveSelectAllAction` (and any
   *  future preset-aware binding helper) to choose the binding map.
   *  Default `'default'` matches Blender's out-of-the-box selection.
   *
   *  Audit-fix MED-2 (Slice 5.AA arch audit 2026-05-17): the init +
   *  setter both route through `coerceKeymapPreset` so all coercion
   *  lives in one place. Adding a third preset later requires only
   *  updating `KEYMAP_PRESETS` + `coerceKeymapPreset` in
   *  `keymapPresets.js`; this store file stays untouched. */
  keymapPreset: coerceKeymapPreset(loadJsonScalar(KMP_KEY, 'default')),

  setKeymapPreset(v) {
    const next = coerceKeymapPreset(v);
    saveJson(KMP_KEY, next);
    set({ keymapPreset: next });
  },

  /** Toolset Plan Phase 2.A — modal G/R/S snap config. See SNAP_DEFAULT
   *  jsdoc above for per-field semantics. */
  snap: mergeSnap(loadJson(SNAP_KEY, SNAP_DEFAULT)),

  /** Partial-merge update. Accepts any depth of `{ enabled, modes:
   *  { grid: {...}, vertex: {...}, increment: {...} }, target }` —
   *  passes through `mergeSnap` to keep schema valid. Intentionally
   *  re-runs the merge so callers can pass `{ modes: { grid: { increment: 32 } } }`
   *  without spelling out the rest. */
  setSnap(partial) {
    if (!partial || typeof partial !== 'object') return;
    const cur = get().snap;
    const merged = mergeSnap({
      enabled: 'enabled' in partial ? partial.enabled : cur.enabled,
      modes: {
        grid:      { ...cur.modes.grid,      ...(partial.modes?.grid      ?? {}) },
        vertex:    { ...cur.modes.vertex,    ...(partial.modes?.vertex    ?? {}) },
        increment: { ...cur.modes.increment, ...(partial.modes?.increment ?? {}) },
      },
      target: 'target' in partial ? partial.target : cur.target,
    });
    saveJson(SNAP_KEY, merged);
    set({ snap: merged });
  },

  setMlEnabled(v) {
    const next = !!v;
    saveBool(ML_KEY, next);
    set({ mlEnabled: next });
  },

  setLockObjectModes(v) {
    const next = !!v;
    saveBool(LOM_KEY, next);
    set({ lockObjectModes: next });
  },

  setUseNumericInputAdvanced(v) {
    const next = !!v;
    saveBool(NIA_KEY, next);
    set({ useNumericInputAdvanced: next });
  },

  setProportionalEdit(partial) {
    const next = { ...get().proportionalEdit, ...partial };
    saveJson(PE_KEY, next);
    set({ proportionalEdit: next });
  },

  /** Save `layers` under `name`. Overwrites if the name exists. Empty
   *  / whitespace names are rejected (no-op). */
  setViewLayerPreset(name, layers) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    const next = { ...get().viewLayerPresets, [trimmed]: { ...layers } };
    saveJson(VLP_KEY, next);
    set({ viewLayerPresets: next });
  },

  /** Remove a named preset. No-op if `name` doesn't exist. */
  deleteViewLayerPreset(name) {
    const cur = get().viewLayerPresets;
    if (!(name in cur)) return;
    const next = { ...cur };
    delete next[name];
    saveJson(VLP_KEY, next);
    set({ viewLayerPresets: next });
  },

  /** Record the user's current tool for the given mode key. Empty /
   *  unknown keys are no-ops so callers can pass `editMode` blindly
   *  without guarding. */
  setLastToolForMode(modeKey, toolModeId) {
    if (typeof modeKey !== 'string' || typeof toolModeId !== 'string') return;
    const cur = get().lastToolByMode;
    if (cur[modeKey] === toolModeId) return;
    const next = { ...cur, [modeKey]: toolModeId };
    saveJson(LTM_KEY, next);
    set({ lastToolByMode: next });
  },
}));
