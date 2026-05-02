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

const PE_DEFAULT = Object.freeze({
  enabled:       false,
  radius:        100,
  falloff:       'smooth',
  connectedOnly: false,
});

/** Last-used tool per `editMode`. Keys mirror `editorStore.editMode`
 *  values: `null` is encoded as `'object'`. Reseeded by
 *  `editorStore.setToolMode` so sticky tool choices persist across
 *  Tab in/out within a session AND across page reloads. Values must
 *  be strings the toolbar's `tools.js` advertises for that mode —
 *  unknown values fall back to the mode's first sticky tool entry. */
const LTM_DEFAULT = Object.freeze({
  object:     'select',
  mesh:       'brush',
  skeleton:   'joint_drag',
  blendShape: 'brush',
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
  /** Last-used tool per editMode (`'object' | 'mesh' | 'skeleton' |
   *  'blendShape'`). Persisted across sessions so sticky tool choices
   *  (e.g. preferring `add_vertex` over the default `brush` in mesh
   *  edit) survive Tab out / Tab in, page reload, and project switch.
   *  See `editorStore.enterEditMode` (reads on entry) and
   *  `editorStore.setToolMode` (writes on every tool flip). */
  lastToolByMode: loadJson(LTM_KEY, LTM_DEFAULT),

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
