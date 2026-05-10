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

const ML_KEY = 'v3.prefs.mlEnabled';
const PE_KEY = 'v3.prefs.proportionalEdit';
const VLP_KEY = 'v3.prefs.viewLayerPresets';
const LOM_KEY = 'v3.prefs.lockObjectModes';
const LTM_KEY = 'v3.prefs.lastToolByMode';
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

const PE_DEFAULT = Object.freeze({
  enabled:       false,
  radius:        100,
  falloff:       'smooth',
  connectedOnly: false,
});

/** Toolset Plan Phase 2 — snap config defaults.
 *
 *  - `enabled` (master toggle, default false): when true, vertex snap
 *    auto-engages while the modal G drag is unshifted; the magenta
 *    snap-target dot renders. When false, vertex snap is suppressed
 *    and Shift+modal still engages grid/increment snap (matches
 *    pre-Phase-2 behaviour with the new configurable increments).
 *  - `modes.grid` (default `enabled:true, increment:16`): Shift+modal-G
 *    snaps the canvas-px delta to multiples of `increment`. Default 16
 *    matches Blender's default grid; v1 hardcoded 10. When
 *    `grid.enabled` is false, Shift+modal-G falls back to free
 *    translation (no snap), matching "I want fine input only".
 *  - `modes.vertex` (default `enabled:true, threshold:8`): when master
 *    is on AND not Shift, the cursor's nearest project-rest-vertex
 *    within `threshold` canvas-px wins; the modal delta becomes
 *    `(snappedVert - originalCursor)` (per Phase 2.C). Threshold is in
 *    canvas-px so it tracks zoom (the cursor→vert distance is
 *    measured in canvas space).
 *  - `modes.increment` (default `enabled:false, value:15`): when
 *    `enabled` is true, replaces the legacy 15° (rotate) and 0.1
 *    (scale) Shift snaps. `value` is the rotation step in degrees;
 *    scale uses `value/100` as the multiplier step (so 15 → 0.15,
 *    matching Blender's 1° = 0.01× convention).
 *  - `target` (`'closest' | 'center' | 'median' | 'active'`, default
 *    `'closest'`): Phase 2.C — selects which point of the active
 *    selection lands ON the snap vertex. `closest` = the cursor IS the
 *    anchor (simplest, Blender's default). The others compute the
 *    anchor from the selection geometry; see `lib/snap/snapMath.js`. */
const SNAP_DEFAULT = Object.freeze({
  enabled: false,
  modes: Object.freeze({
    grid:      Object.freeze({ enabled: true,  increment: 16 }),
    vertex:    Object.freeze({ enabled: true,  threshold: 8  }),
    increment: Object.freeze({ enabled: false, value:     15 }),
  }),
  target: 'closest',
});

/** Deep-merge a saved snap blob over `SNAP_DEFAULT`. The shallow
 *  `loadJson` merge in this file collapses nested `modes.{grid|vertex|
 *  increment}` if the saved blob is missing one — clobbering the
 *  defaults with `undefined`. This recursive helper preserves any
 *  per-mode subkey that wasn't persisted (e.g. on schema bumps). */
function mergeSnap(saved) {
  if (!saved || typeof saved !== 'object') return { ...SNAP_DEFAULT };
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
