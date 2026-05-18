// @ts-check

/**
 * Animation Phase 3 Slice 3.C -- FCurve Modifiers panel data layer.
 *
 * Pure data ops for the modifier-stack UI. React rendering lives in
 * [FCurveModifiersPanel.jsx](./FCurveModifiersPanel.jsx). Sister
 * architecture to `activeKeyformPanelData.js` <->
 * `ActiveKeyformPanel.jsx` (Slice 5.Q+5.R).
 *
 * # Recipe convention (matches Slice 5.Q+5.R pattern)
 *
 *   - `resolve*Context(action, activeFCurveId)` -- locate the modifier
 *     stack; returns null when there is no active fcurve.
 *   - `wouldX(...)` predicates -- pure, side-effect-free; called BEFORE
 *     `update()` so identity edits don't burn an undo slot.
 *   - `applyX(action, ...)` -- mutates `action.fcurves[i].modifiers[]`
 *     in place. Caller wraps in `useProjectStore.updateProject((p) => ...)`.
 *
 * # Cycles head-of-stack invariant
 *
 * Blender asserts `BLI_assert(fcm->prev == nullptr)` for Cycles modifiers
 * at `reference/blender/source/blender/blenkernel/intern/fmodifier.cc:635`
 * -- Cycles MUST be the first modifier in the stack. SS enforces this
 * in three ops:
 *   - `applyAddModifier('cycles', ...)` -- inserts at index 0
 *   - `applyAddModifier(other type)` with existing Cycles -- inserts at
 *     index 1+ so Cycles stays at 0
 *   - `applyReorderModifier(...)` -- rejects moves that displace Cycles
 *     from index 0 OR place anything before Cycles
 *
 * One Cycles per fcurve. `applyAddModifier('cycles', ...)` with existing
 * Cycles is a no-op (the `would*Change` predicate returns false so the
 * panel's add button is greyed in that state).
 *
 * # EXCLUSIVE `active` invariant
 *
 * At most one modifier per fcurve carries `active: true`. The setter
 * clears `active` on every other modifier in the same stack. Mirrors
 * Blender's `FMODIFIER_FLAG_ACTIVE` semantics at
 * `reference/blender/source/blender/makesdna/DNA_anim_enums.h:50` and
 * the active-set pattern used elsewhere (Slice 5.H's per-FCurve active
 * keyframe; Slice 5.LL's per-Action active group).
 *
 * # Time-unit canonical: ms (per `feedback_ms_canonical_animation_time`)
 *
 * Every per-type default that carries a time field (`sfra`, `efra`,
 * `blendin`, `blendout`, `noise.size`, `noise.phase`, `stepped.stepSize`,
 * `stepped.offset`, `stepped.startTime`, `stepped.endTime`,
 * `envelope.controlPoints[].time`) uses ms.
 *
 * @module v3/editors/fcurve/fcurveModifiersPanelData
 */

import { getFCurveModifiers, FMODIFIER_TYPES, isFModifierType } from '../../../anim/fmodifiers.js';

/**
 * Resolve the modifier-stack context for the active fcurve. Returns
 * null when no fcurve is active OR the action has no fcurves.
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @returns {{ fcurve: any, modifiers: any[] } | null}
 */
export function resolveModifiersContext(action, activeFCurveId) {
  if (!action || !Array.isArray(action.fcurves) || !activeFCurveId) return null;
  const fcurve = action.fcurves.find((fc) => fc && fc.id === activeFCurveId);
  if (!fcurve) return null;
  const modifiers = Array.isArray(fcurve.modifiers) ? fcurve.modifiers : [];
  return { fcurve, modifiers };
}

// ---------------------------------------------------------------------------
// Per-type default-data factory
//
// One factory per of the six supported modifier types. Defaults match
// Blender's `fcm_*_new_data` initialisers wherever it makes sense, with
// SS-side ms conversions noted inline. Per RULE №2 (no migration
// baggage), defaults are written sparsely only when they DIFFER from
// the SS sparse-absent meaning -- e.g. `cycles.after` is written
// explicitly because the sparse default of `'none'` would make the
// modifier a no-op on creation, contradicting user intent of "I added
// a Cycles modifier because I want cycling."
// ---------------------------------------------------------------------------

/**
 * Build the per-type `data` object for a freshly-added modifier of
 * `type`. Returns an object with the minimal field set the user
 * expects on creation (anything beyond that should be sparse-absent).
 *
 * @param {string} type -- one of the 6 supported types
 * @returns {object}
 */
export function createDefaultModifierData(type) {
  switch (type) {
    case 'cycles':
      // Default: "after" set to repeat (the most common use case --
      // user adds Cycles to make a 4-keyform loop infinite). `before`
      // stays absent (default 'none'). `afterCycles=0` is the
      // sparse-default but written explicitly for editor-discovery so
      // the UI shows "0 (infinite)" in the field on first render.
      return { after: 'repeat', afterCycles: 0 };
    case 'noise':
      // Matches Blender's `fcm_noise_new_data` at
      // `fmodifier.cc:798-812`: size=1.0fr, strength=1.0, phase=1.0,
      // depth=0, lacunarity=2.0, roughness=0.5. SS converts size from
      // frames to ms with a user-friendly default of 1000ms (3.A
      // typedef rationale: 1.0 fr at 24fps = ~41.67ms is too high-
      // frequency for typical Live2D authoring).
      return {
        size: 1000,
        strength: 1,
        phase: 1,
        depth: 0,
        lacunarity: 2,
        roughness: 0.5,
        blendType: 'replace',
      };
    case 'generator':
      // Matches Blender's `fcm_generator_new_data` at
      // `fmodifier.cc:113-123`: poly_order=1, coefficients=[0, 1] -->
      // "y = 0 + 1*x" = linear 0..1. The mode defaults to
      // 'polynomial' (Blender's `FCM_GENERATOR_POLYNOMIAL=0`).
      return { mode: 'polynomial', coefficients: [0, 1] };
    case 'limits':
      // Blender's FMod_Limits has no `new_data` initialiser (the static
      // FMI_LIMITS entry at `fmodifier.cc:924-938` lists `nullptr`).
      // SS starts with all use-flags false so the modifier is a no-op
      // until the user enables an axis; matches Blender's UX where the
      // limits panel surfaces 4 unchecked checkboxes on creation.
      return {};
    case 'stepped':
      // Matches Blender's `fcm_stepped_new_data` at
      // `fmodifier.cc:942-949`: step_size=2 frames. SS converts to
      // ms with a 100ms default (3.A typedef rationale: a user-
      // friendly hold duration; 2 frames at 24fps = ~83ms).
      return { stepSize: 100, offset: 0 };
    case 'envelope':
      // Blender's `fcm_envelope_new_data` at `fmodifier.cc:412-417`
      // initialises `min=-1, max=1` (the +/- 1 reference range). SS
      // mirrors that, leaving controlPoints empty so the user can add
      // them via the panel.
      return { referenceValue: 0, defaultMin: -1, defaultMax: 1, controlPoints: [] };
    default:
      return {};
  }
}

/**
 * Generate a unique-ish modifier id. Format: `mod_${type}_${randomHex}`.
 * @param {string} type
 * @returns {string}
 */
function generateModifierId(type) {
  // 8 hex chars is enough collision-safety for per-fcurve modifier ids
  // (any single fcurve has <10 modifiers in practice; 2^32 ids per
  // type is far more than needed). Math.random() suffices -- crypto
  // not required for ids.
  const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `mod_${type}_${hex}`;
}

// ---------------------------------------------------------------------------
// Add modifier
// ---------------------------------------------------------------------------

/**
 * Predicate: would adding a modifier of `type` actually change the
 * fcurve's stack? Returns true unless:
 *   - `type` is not one of the 6 supported types, OR
 *   - `type === 'cycles'` and a Cycles modifier already exists (one-per
 *     -fcurve invariant)
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} type
 * @returns {boolean}
 */
export function wouldAddModifierChange(action, activeFCurveId, type) {
  if (!isFModifierType(type)) return false;
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  if (type === 'cycles' && ctx.modifiers.some((m) => m && m.type === 'cycles')) {
    return false;
  }
  return true;
}

/**
 * Add a modifier of `type` to the active fcurve's stack. Cycles always
 * goes to index 0; other types append, unless a Cycles modifier exists
 * at index 0 in which case they insert at index 1 (preserving the
 * head-of-stack invariant). The new modifier becomes the EXCLUSIVE
 * active modifier on the stack.
 *
 * Caller is responsible for the `wouldAddModifierChange` preflight
 * check before invoking `update()`.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} type
 */
export function applyAddModifier(action, activeFCurveId, type) {
  if (!isFModifierType(type)) return;
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  if (type === 'cycles' && ctx.modifiers.some((m) => m && m.type === 'cycles')) return;
  if (!Array.isArray(ctx.fcurve.modifiers)) ctx.fcurve.modifiers = [];
  const mods = ctx.fcurve.modifiers;
  const mod = {
    id: generateModifierId(type),
    type,
    data: createDefaultModifierData(type),
  };
  if (type === 'cycles') {
    // Cycles always at head per `fmodifier.cc:635`.
    mods.unshift(mod);
  } else {
    // Non-cycles: if a Cycles modifier is at index 0, append AFTER it
    // (so index 0 stays Cycles); otherwise append to the tail.
    mods.push(mod);
  }
  // EXCLUSIVE active: clear any prior active flag; set the new one.
  for (const m of mods) {
    if (m && m !== mod && m.active === true) delete m.active;
  }
  mod.active = true;
}

// ---------------------------------------------------------------------------
// Remove modifier
// ---------------------------------------------------------------------------

/**
 * Predicate: is `modifierId` present on the active fcurve's stack?
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @returns {boolean}
 */
export function wouldRemoveModifierChange(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  return ctx.modifiers.some((m) => m && m.id === modifierId);
}

/**
 * Remove the modifier with `modifierId` from the active fcurve's stack.
 * If the removed modifier was active, the next surviving modifier (if
 * any) becomes active to preserve the "at most one active" invariant
 * with the convention "after removal, the closest neighbor takes
 * over" -- mirrors Blender's `BKE_fmodifier_remove` behavior at
 * `fmodifier.cc:1167-1189` (it sets the previous-or-next modifier
 * active when removing the current active).
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 */
export function applyRemoveModifier(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const i = ctx.modifiers.findIndex((m) => m && m.id === modifierId);
  if (i < 0) return;
  const wasActive = ctx.modifiers[i].active === true;
  ctx.fcurve.modifiers.splice(i, 1);
  if (wasActive && ctx.fcurve.modifiers.length > 0) {
    // Promote the previous neighbor when possible; else the new index-0.
    const promote = ctx.fcurve.modifiers[Math.max(0, i - 1)];
    if (promote) promote.active = true;
  }
  if (ctx.fcurve.modifiers.length === 0) {
    // Sparse-delete the field when no modifiers remain, matching the
    // sparse-absent default used by readers (`getFCurveModifiers`).
    delete ctx.fcurve.modifiers;
  }
}

// ---------------------------------------------------------------------------
// Reorder modifier
// ---------------------------------------------------------------------------

/**
 * Predicate: would reordering `fromIndex` -> `toIndex` actually change
 * the stack AND preserve the Cycles head-of-stack invariant?
 *
 * Rejects:
 *   - Same index (no-op)
 *   - Out-of-bounds indices
 *   - Moving Cycles away from index 0
 *   - Moving any other modifier to index 0 when a Cycles is at 0
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {boolean}
 */
export function wouldReorderModifierChange(action, activeFCurveId, fromIndex, toIndex) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const len = ctx.modifiers.length;
  if (fromIndex < 0 || fromIndex >= len) return false;
  if (toIndex < 0 || toIndex >= len) return false;
  if (fromIndex === toIndex) return false;
  const movingMod = ctx.modifiers[fromIndex];
  if (!movingMod) return false;
  const cyclesAt0 = ctx.modifiers[0] && ctx.modifiers[0].type === 'cycles';
  // Rule A: a Cycles modifier may not leave index 0.
  if (movingMod.type === 'cycles' && fromIndex === 0 && toIndex !== 0) return false;
  // Rule B: non-Cycles modifier may not move to index 0 when Cycles is there.
  if (movingMod.type !== 'cycles' && toIndex === 0 && cyclesAt0) return false;
  return true;
}

/**
 * Move the modifier at `fromIndex` to `toIndex`. Implements an
 * array-splice reorder (remove + reinsert) so other modifiers shift to
 * accommodate. Caller must preflight via `wouldReorderModifierChange`.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {number} fromIndex
 * @param {number} toIndex
 */
export function applyReorderModifier(action, activeFCurveId, fromIndex, toIndex) {
  if (!wouldReorderModifierChange(action, activeFCurveId, fromIndex, toIndex)) return;
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mods = ctx.fcurve.modifiers;
  const [removed] = mods.splice(fromIndex, 1);
  mods.splice(toIndex, 0, removed);
}

// ---------------------------------------------------------------------------
// Mute / Active toggles
// ---------------------------------------------------------------------------

/**
 * Predicate: would `applySetModifierMuted(...)` actually flip the
 * modifier's `muted` flag?
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @param {boolean} muted
 * @returns {boolean}
 */
export function wouldSetModifierMutedChange(action, activeFCurveId, modifierId, muted) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return false;
  return (mod.muted === true) !== muted;
}

/**
 * Set the `muted` flag on a modifier. Sparse-delete when setting to
 * false (matches the sparse-absent default).
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {boolean} muted
 */
export function applySetModifierMuted(action, activeFCurveId, modifierId, muted) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return;
  if (muted) mod.muted = true;
  else delete mod.muted;
}

/**
 * Predicate: would `applySetActiveModifier(...)` actually shift the
 * active marker?
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @returns {boolean}
 */
export function wouldSetActiveModifierChange(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const target = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!target) return false;
  if (target.active === true) return false;
  return true;
}

/**
 * Set `modifierId` as the EXCLUSIVE active modifier on the stack.
 * Clears `active` on every other modifier in the same stack.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 */
export function applySetActiveModifier(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const target = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!target) return;
  for (const m of ctx.modifiers) {
    if (!m) continue;
    if (m === target) m.active = true;
    else if (m.active === true) delete m.active;
  }
}

// ---------------------------------------------------------------------------
// Edit per-modifier fields
// ---------------------------------------------------------------------------

/**
 * Predicate: would writing `value` to `dataPath` on the modifier
 * actually change the underlying data?
 *
 * `dataPath` is a top-level field name like `'size'`, `'strength'`,
 * `'before'`, `'useMaxY'`, etc. Nested fields are handled with
 * dot-separated paths like `'controlPoints[2].max'` -- those are NOT
 * routed through this generic helper; they get bespoke recipes (see
 * Envelope's per-point ops below).
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @param {string} dataPath
 * @param {any} value
 * @returns {boolean}
 */
export function wouldEditModifierDataChange(action, activeFCurveId, modifierId, dataPath, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return false;
  const data = mod.data ?? {};
  return data[dataPath] !== value;
}

/**
 * Write `value` to `dataPath` on the modifier's `data` object.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {string} dataPath
 * @param {any} value
 */
export function applyEditModifierData(action, activeFCurveId, modifierId, dataPath, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return;
  if (!mod.data || typeof mod.data !== 'object') mod.data = {};
  mod.data[dataPath] = value;
}

/**
 * Predicate: would flipping the modifier's top-level boolean flag
 * (`muted` aside; that has its own recipe) actually change it?
 * Covers `useRestrictedRange`, `useInfluence`, `disabled` (rarely
 * exposed in UI).
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @param {'useRestrictedRange'|'useInfluence'|'disabled'} flag
 * @param {boolean} value
 * @returns {boolean}
 */
export function wouldSetModifierFlagChange(action, activeFCurveId, modifierId, flag, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return false;
  return (mod[flag] === true) !== value;
}

/**
 * Toggle a top-level sparse boolean flag (`useRestrictedRange` /
 * `useInfluence` / `disabled`). Sparse-delete on transition to false.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {'useRestrictedRange'|'useInfluence'|'disabled'} flag
 * @param {boolean} value
 */
export function applySetModifierFlag(action, activeFCurveId, modifierId, flag, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return;
  if (value) mod[flag] = true;
  else delete mod[flag];
}

/**
 * Predicate: would editing a top-level number field (`influence`,
 * `sfra`, `efra`, `blendin`, `blendout`) actually change it?
 *
 * @param {{ id: string, fcurves: any[] } | null | undefined} action
 * @param {string | null | undefined} activeFCurveId
 * @param {string} modifierId
 * @param {'influence'|'sfra'|'efra'|'blendin'|'blendout'} field
 * @param {number} value
 * @returns {boolean}
 */
export function wouldEditModifierNumberChange(action, activeFCurveId, modifierId, field, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return false;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return false;
  return mod[field] !== value;
}

/**
 * Write a top-level number field on the modifier.
 *
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {'influence'|'sfra'|'efra'|'blendin'|'blendout'} field
 * @param {number} value
 */
export function applyEditModifierNumber(action, activeFCurveId, modifierId, field, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod) return;
  mod[field] = value;
}

// ---------------------------------------------------------------------------
// Generator coefficients (variable-length array)
// ---------------------------------------------------------------------------

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {number} index
 * @param {number} value
 */
export function applyEditGeneratorCoefficient(action, activeFCurveId, modifierId, index, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'generator') return;
  if (!mod.data || typeof mod.data !== 'object') mod.data = {};
  if (!Array.isArray(mod.data.coefficients)) mod.data.coefficients = [];
  if (index < 0 || index >= mod.data.coefficients.length) return;
  mod.data.coefficients[index] = value;
}

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 */
export function applyAddGeneratorCoefficient(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'generator') return;
  if (!mod.data || typeof mod.data !== 'object') mod.data = {};
  if (!Array.isArray(mod.data.coefficients)) mod.data.coefficients = [];
  mod.data.coefficients.push(0);
}

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 */
export function applyRemoveGeneratorCoefficient(action, activeFCurveId, modifierId) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'generator') return;
  if (!mod.data || typeof mod.data !== 'object') return;
  if (!Array.isArray(mod.data.coefficients) || mod.data.coefficients.length === 0) return;
  mod.data.coefficients.pop();
}

// ---------------------------------------------------------------------------
// Envelope control points
// ---------------------------------------------------------------------------

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {number} time
 */
export function applyAddEnvelopeControlPoint(action, activeFCurveId, modifierId, time) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'envelope') return;
  if (!mod.data || typeof mod.data !== 'object') mod.data = {};
  if (!Array.isArray(mod.data.controlPoints)) mod.data.controlPoints = [];
  const defaultMin = Number.isFinite(mod.data.defaultMin) ? mod.data.defaultMin : -1;
  const defaultMax = Number.isFinite(mod.data.defaultMax) ? mod.data.defaultMax : 1;
  const pt = { time, min: defaultMin, max: defaultMax };
  // Insert in sorted-by-time order so the evaluator's lerp scan finds
  // adjacent points correctly (Blender's evaluator at
  // `fmodifier.cc:458-472` assumes the array is sorted).
  let i = 0;
  while (i < mod.data.controlPoints.length && mod.data.controlPoints[i].time <= time) i++;
  mod.data.controlPoints.splice(i, 0, pt);
}

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {number} index
 */
export function applyRemoveEnvelopeControlPoint(action, activeFCurveId, modifierId, index) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'envelope') return;
  if (!mod.data || !Array.isArray(mod.data.controlPoints)) return;
  if (index < 0 || index >= mod.data.controlPoints.length) return;
  mod.data.controlPoints.splice(index, 1);
}

/**
 * @param {{ id: string, fcurves: any[] }} action
 * @param {string} activeFCurveId
 * @param {string} modifierId
 * @param {number} index
 * @param {'time'|'min'|'max'} field
 * @param {number} value
 */
export function applyEditEnvelopeControlPoint(action, activeFCurveId, modifierId, index, field, value) {
  const ctx = resolveModifiersContext(action, activeFCurveId);
  if (!ctx) return;
  const mod = ctx.modifiers.find((m) => m && m.id === modifierId);
  if (!mod || mod.type !== 'envelope') return;
  if (!mod.data || !Array.isArray(mod.data.controlPoints)) return;
  const pt = mod.data.controlPoints[index];
  if (!pt) return;
  pt[field] = value;
  // Re-sort if time edited (rare, so just sort the whole array; len < 10
  // in practice).
  if (field === 'time') {
    mod.data.controlPoints.sort((a, b) => a.time - b.time);
  }
}

// ---------------------------------------------------------------------------
// Type-info enumeration for UI dropdowns
// ---------------------------------------------------------------------------

/**
 * Human-readable label per modifier type. Mirrors Blender's
 * `FModifierTypeInfo.name` field values: "Cycles" / "Noise" /
 * "Generator" / "Limits" / "Stepped" / "Envelope". (Capitalised --
 * matches Blender's UI conventions.)
 *
 * @type {Record<string, string>}
 */
export const MODIFIER_TYPE_LABELS = Object.freeze({
  cycles: 'Cycles',
  noise: 'Noise',
  generator: 'Generator',
  limits: 'Limits',
  stepped: 'Stepped',
  envelope: 'Envelope',
});

/**
 * Type entries for "Add Modifier" dropdown. Order matches
 * FMODIFIER_TYPES which itself matches Blender's enum order.
 *
 * @type {ReadonlyArray<{ key: string, label: string }>}
 */
export const MODIFIER_TYPE_OPTIONS = Object.freeze(
  FMODIFIER_TYPES.map((key) => ({ key, label: MODIFIER_TYPE_LABELS[key] || key })),
);

// Re-export for the React panel's convenience.
export { getFCurveModifiers, FMODIFIER_TYPES };
