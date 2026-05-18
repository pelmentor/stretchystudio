// Tests for FCurve Modifiers panel data layer (Animation Phase 3 Slice 3.C).
//
// Covers:
//   - resolveModifiersContext + sparse-aware reads
//   - applyAddModifier per type + Cycles head-of-stack invariant
//   - applyRemoveModifier + active-promotion behavior
//   - applyReorderModifier + Cycles invariant enforcement
//   - applySetModifierMuted (sparse-delete on false)
//   - applySetActiveModifier (EXCLUSIVE)
//   - applyEditModifierData + applyEditModifierNumber + applySetModifierFlag
//   - applyEdit/Add/RemoveGeneratorCoefficient
//   - applyAdd/Remove/EditEnvelopeControlPoint + sorted insertion
//   - createDefaultModifierData per type (ms-canonical)
//   - All would*Change predicates
//
// Run: node scripts/test/test_fcurveModifiersPanelData.mjs

import {
  resolveModifiersContext,
  createDefaultModifierData,
  wouldAddModifierChange,
  applyAddModifier,
  wouldRemoveModifierChange,
  applyRemoveModifier,
  wouldReorderModifierChange,
  applyReorderModifier,
  wouldSetModifierMutedChange,
  applySetModifierMuted,
  wouldSetActiveModifierChange,
  applySetActiveModifier,
  wouldEditModifierDataChange,
  applyEditModifierData,
  wouldSetModifierFlagChange,
  applySetModifierFlag,
  wouldEditModifierNumberChange,
  applyEditModifierNumber,
  applyAddGeneratorCoefficient,
  applyRemoveGeneratorCoefficient,
  applyEditGeneratorCoefficient,
  wouldAddGeneratorCoefficientChange,
  wouldRemoveGeneratorCoefficientChange,
  wouldEditGeneratorCoefficientChange,
  applyAddEnvelopeControlPoint,
  applyRemoveEnvelopeControlPoint,
  applyEditEnvelopeControlPoint,
  wouldAddEnvelopeControlPointChange,
  wouldRemoveEnvelopeControlPointChange,
  wouldEditEnvelopeControlPointChange,
  MODIFIER_TYPE_OPTIONS,
  MODIFIER_TYPE_LABELS,
} from '../../src/v3/editors/fcurve/fcurveModifiersPanelData.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

// Helper to build a fresh fcurve in an action
function fc(action, id) {
  if (!Array.isArray(action.fcurves)) action.fcurves = [];
  const f = { id, keyforms: [] };
  action.fcurves.push(f);
  return f;
}

// ===========================================================================
// resolveModifiersContext
// ===========================================================================

// ── 1. null action ─────────────────────────────────────────────────
{
  eq(resolveModifiersContext(null, 'fc1'), null, '1: null action → null');
}

// ── 2. action with no fcurves ──────────────────────────────────────
{
  eq(resolveModifiersContext({ id: 'a', fcurves: [] }, 'fc1'), null,
    '2: empty fcurves → null');
}

// ── 3. unknown fcurve id ───────────────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  eq(resolveModifiersContext(a, 'fc2'), null, '3: unknown fcurve id → null');
}

// ── 4. valid context, no modifiers ─────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  const ctx = resolveModifiersContext(a, 'fc1');
  assert(ctx !== null, '4a: ctx returned');
  eq(ctx.modifiers.length, 0, '4b: no modifiers → empty list');
}

// ── 5. valid context, with modifiers ───────────────────────────────
{
  const a = { id: 'a' };
  const f = fc(a, 'fc1');
  f.modifiers = [{ id: 'm1', type: 'noise', data: {} }];
  const ctx = resolveModifiersContext(a, 'fc1');
  eq(ctx.modifiers.length, 1, '5: modifier list returned');
}

// ===========================================================================
// createDefaultModifierData — ms-canonical defaults
// ===========================================================================

// ── 6. cycles default: after=repeat, afterCycles=0 ─────────────────
{
  const d = createDefaultModifierData('cycles');
  eq(d.after, 'repeat', '6a: after defaults to repeat (most common use case)');
  eq(d.afterCycles, 0, '6b: afterCycles=0 (infinite)');
}

// ── 7. noise default ───────────────────────────────────────────────
{
  const d = createDefaultModifierData('noise');
  eq(d.size, 1000, '7a: size=1000ms (SS user-friendly; not Blender 1.0 frame)');
  eq(d.strength, 1, '7b: strength=1');
  eq(d.phase, 1, '7c: phase=1 (matches Blender fcm_noise_new_data:805)');
  eq(d.depth, 0, '7d: depth=0 (single octave; matches Blender)');
  eq(d.lacunarity, 2, '7e: lacunarity=2 (matches Blender)');
  eq(d.roughness, 0.5, '7f: roughness=0.5 (matches Blender)');
  eq(d.blendType, 'replace', '7g: blendType=replace');
}

// ── 8. generator default ───────────────────────────────────────────
{
  const d = createDefaultModifierData('generator');
  eq(d.mode, 'polynomial', '8a: mode=polynomial');
  assert(Array.isArray(d.coefficients) && d.coefficients.length === 2,
    '8b: coefficients length=2');
  eq(d.coefficients[0], 0, '8c: c0=0 (matches Blender fcm_generator_new_data)');
  eq(d.coefficients[1], 1, '8d: c1=1 (linear 0..1)');
}

// ── 9. limits default — empty (all use-flags false) ────────────────
{
  const d = createDefaultModifierData('limits');
  eq(Object.keys(d).length, 0, '9: limits default is empty');
}

// ── 10. stepped default — ms-converted ─────────────────────────────
{
  const d = createDefaultModifierData('stepped');
  eq(d.stepSize, 100, '10a: stepSize=100ms (SS user-friendly)');
  eq(d.offset, 0, '10b: offset=0');
}

// ── 11. envelope default ───────────────────────────────────────────
{
  const d = createDefaultModifierData('envelope');
  eq(d.referenceValue, 0, '11a: referenceValue=0');
  eq(d.defaultMin, -1, '11b: defaultMin=-1 (matches Blender)');
  eq(d.defaultMax, 1, '11c: defaultMax=1 (matches Blender)');
  assert(Array.isArray(d.controlPoints) && d.controlPoints.length === 0,
    '11d: controlPoints=[]');
}

// ── 12. unknown type returns empty ─────────────────────────────────
{
  const d = createDefaultModifierData('not_a_real_type');
  eq(Object.keys(d).length, 0, '12: unknown type → empty');
}

// ===========================================================================
// applyAddModifier — basic + Cycles head-of-stack
// ===========================================================================

// ── 13. Add non-cycles to empty stack → appended at index 0 ────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  eq(a.fcurves[0].modifiers.length, 1, '13a: 1 modifier added');
  eq(a.fcurves[0].modifiers[0].type, 'noise', '13b: type=noise');
  assert(typeof a.fcurves[0].modifiers[0].id === 'string', '13c: id assigned');
  // Single-on-add per Blender's add_fmodifier:1213-1215 — first modifier
  // becomes active because BLI_listbase_is_single(modifiers) is true.
  eq(a.fcurves[0].modifiers[0].active, true, '13d: single-on-add → active (matches Blender)');
}

// ── 14. Add Cycles to empty stack → at index 0 ─────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');
  eq(a.fcurves[0].modifiers[0].type, 'cycles', '14: cycles at index 0');
}

// ── 15. Add Cycles to stack with existing Cycles → no-op ───────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');
  applyAddModifier(a, 'fc1', 'cycles');
  eq(a.fcurves[0].modifiers.length, 1, '15: second Cycles rejected (one-per-fcurve)');
}

// ── 16. Add Cycles AFTER non-cycles → Cycles goes to index 0 ───────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');     // noise at 0
  applyAddModifier(a, 'fc1', 'cycles');    // cycles at 0, noise at 1
  eq(a.fcurves[0].modifiers[0].type, 'cycles', '16a: cycles inserted at index 0');
  eq(a.fcurves[0].modifiers[1].type, 'noise', '16b: noise shifted to index 1');
}

// ── 17. Add non-cycles AFTER cycles → preserves head-of-stack ──────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');    // cycles at 0
  applyAddModifier(a, 'fc1', 'noise');     // noise at 1
  applyAddModifier(a, 'fc1', 'generator'); // generator at 2
  eq(a.fcurves[0].modifiers[0].type, 'cycles', '17a: cycles at 0 preserved');
  eq(a.fcurves[0].modifiers[1].type, 'noise', '17b: noise at 1');
  eq(a.fcurves[0].modifiers[2].type, 'generator', '17c: generator at 2');
}

// ── 18. wouldAddModifierChange ─────────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  eq(wouldAddModifierChange(a, 'fc1', 'noise'), true, '18a: noise → true');
  eq(wouldAddModifierChange(a, 'fc1', 'not_a_type'), false, '18b: invalid type → false');
  eq(wouldAddModifierChange(a, 'fcZ', 'noise'), false, '18c: unknown fcurve → false');
  applyAddModifier(a, 'fc1', 'cycles');
  eq(wouldAddModifierChange(a, 'fc1', 'cycles'), false,
    '18d: second cycles → false (one-per-fcurve)');
}

// ── 19. Second add preserves prior active (matches Blender) ────────
// Audit-fix 2026-05-18 fidelity MED-8: pre-fix promoted the new
// modifier to active and cleared prior. Blender's add_fmodifier only
// sets ACTIVE when BLI_listbase_is_single (i.e. stack has 1 entry
// after add). SS now matches: prior active survives subsequent adds.
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  applyAddModifier(a, 'fc1', 'generator');
  eq(a.fcurves[0].modifiers[0].active, true,
    '19a: prior active (noise) preserved across add');
  eq(a.fcurves[0].modifiers[1].active, undefined,
    '19b: newly-added (generator) is NOT auto-promoted (not single)');
}

// ===========================================================================
// applyRemoveModifier
// ===========================================================================

// ── 20. Remove existing modifier ───────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  applyRemoveModifier(a, 'fc1', id);
  // Sparse-delete when list empty
  eq(a.fcurves[0].modifiers, undefined, '20: modifiers list sparse-deleted when empty');
}

// ── 21. Remove non-existent id is no-op ────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  applyRemoveModifier(a, 'fc1', 'not_a_real_id');
  eq(a.fcurves[0].modifiers.length, 1, '21: non-existent id → no change');
}

// ── 22. Remove active (tail) promotes previous neighbor ────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');     // m0 (active, single-on-add)
  applyAddModifier(a, 'fc1', 'generator'); // m1 (not auto-promoted)
  applyAddModifier(a, 'fc1', 'limits');    // m2 (not auto-promoted)
  // Make m2 the active by explicit click
  const m2Id = a.fcurves[0].modifiers[2].id;
  applySetActiveModifier(a, 'fc1', m2Id);
  // Remove the active (m2)
  applyRemoveModifier(a, 'fc1', m2Id);
  // Previous neighbor (m1 = generator) promoted
  eq(a.fcurves[0].modifiers.length, 2, '22a: 2 modifiers remain');
  eq(a.fcurves[0].modifiers[1].type, 'generator', '22b: generator survives');
  eq(a.fcurves[0].modifiers[1].active, true, '22c: previous neighbor promoted');
}

// ── 22b. Remove active (mid-stack) promotes previous neighbor ──────
// Audit-fix 2026-05-18 arch HIGH-2: doc said "closest neighbor" but
// implementation uses Math.max(0, i-1) which is "previous-first"
// (matches Blender). Test mid-stack case to lock the behavior.
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');     // m0 (active, single-on-add)
  applyAddModifier(a, 'fc1', 'noise');      // m1
  applyAddModifier(a, 'fc1', 'generator');  // m2
  // Make m1 the active by explicit click
  const m1Id = a.fcurves[0].modifiers[1].id;
  applySetActiveModifier(a, 'fc1', m1Id);
  // Remove m1 (mid-stack active)
  applyRemoveModifier(a, 'fc1', m1Id);
  // Previous neighbor (m0 = cycles) promoted, NOT the next (generator)
  eq(a.fcurves[0].modifiers.length, 2, '22b-1: 2 modifiers remain');
  eq(a.fcurves[0].modifiers[0].type, 'cycles', '22b-2: cycles still at head');
  eq(a.fcurves[0].modifiers[0].active, true,
    '22b-3: cycles promoted (previous-first per Blender pattern)');
  eq(a.fcurves[0].modifiers[1].active, undefined,
    '22b-4: generator NOT promoted (next neighbor secondary)');
}

// ── 22c. Remove active at index 0 falls back to new index 0 ────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');     // m0 (active)
  applyAddModifier(a, 'fc1', 'generator'); // m1
  // m0 is still active (single-on-add). Remove it.
  const m0Id = a.fcurves[0].modifiers[0].id;
  applyRemoveModifier(a, 'fc1', m0Id);
  // After splice, generator at index 0. Math.max(0, 0-1) = 0 → promote
  // the new index-0 (generator).
  eq(a.fcurves[0].modifiers[0].type, 'generator', '22c-1: generator at 0');
  eq(a.fcurves[0].modifiers[0].active, true,
    '22c-2: new index-0 promoted when head is removed');
}

// ── 23. wouldRemoveModifierChange ──────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldRemoveModifierChange(a, 'fc1', id), true, '23a: existing id → true');
  eq(wouldRemoveModifierChange(a, 'fc1', 'nope'), false, '23b: non-existent → false');
  eq(wouldRemoveModifierChange(a, 'fcZ', id), false, '23c: unknown fcurve → false');
}

// ===========================================================================
// applyReorderModifier + Cycles invariant
// ===========================================================================

// ── 24. Reorder swaps positions ────────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  applyAddModifier(a, 'fc1', 'generator');
  const noiseId = a.fcurves[0].modifiers[0].id;
  const genId = a.fcurves[0].modifiers[1].id;
  applyReorderModifier(a, 'fc1', 0, 1);
  eq(a.fcurves[0].modifiers[0].id, genId, '24a: generator now at 0');
  eq(a.fcurves[0].modifiers[1].id, noiseId, '24b: noise now at 1');
}

// ── 25. Cycles invariant: cannot move Cycles away from index 0 ─────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');
  applyAddModifier(a, 'fc1', 'noise');
  applyAddModifier(a, 'fc1', 'generator');
  eq(wouldReorderModifierChange(a, 'fc1', 0, 1), false,
    '25a: Cycles from 0→1 rejected');
  eq(wouldReorderModifierChange(a, 'fc1', 0, 2), false,
    '25b: Cycles from 0→2 rejected');
  applyReorderModifier(a, 'fc1', 0, 1);  // should no-op
  eq(a.fcurves[0].modifiers[0].type, 'cycles', '25c: Cycles still at 0');
}

// ── 26. Cycles invariant: cannot move other modifier to index 0 ────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');
  applyAddModifier(a, 'fc1', 'noise');
  applyAddModifier(a, 'fc1', 'generator');
  eq(wouldReorderModifierChange(a, 'fc1', 2, 0), false,
    '26a: generator to 0 rejected');
  eq(wouldReorderModifierChange(a, 'fc1', 1, 0), false,
    '26b: noise to 0 rejected');
  // But 1 → 2 (swap noise and generator) is fine
  eq(wouldReorderModifierChange(a, 'fc1', 1, 2), true,
    '26c: noise 1→2 allowed');
  applyReorderModifier(a, 'fc1', 1, 2);
  eq(a.fcurves[0].modifiers[1].type, 'generator', '26d: generator at 1 now');
  eq(a.fcurves[0].modifiers[2].type, 'noise', '26e: noise at 2 now');
}

// ── 27. Same-index reorder is no-op ────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  applyAddModifier(a, 'fc1', 'generator');
  eq(wouldReorderModifierChange(a, 'fc1', 0, 0), false, '27a: 0→0 rejected');
  eq(wouldReorderModifierChange(a, 'fc1', 1, 1), false, '27b: 1→1 rejected');
}

// ── 28. Out-of-bounds reorder is no-op ─────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  eq(wouldReorderModifierChange(a, 'fc1', -1, 0), false, '28a: negative from rejected');
  eq(wouldReorderModifierChange(a, 'fc1', 0, 5), false, '28b: high to rejected');
}

// ===========================================================================
// applySetModifierMuted + EXCLUSIVE active
// ===========================================================================

// ── 29. Set muted true / false (sparse-delete on false) ────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  applySetModifierMuted(a, 'fc1', id, true);
  eq(a.fcurves[0].modifiers[0].muted, true, '29a: muted=true written');
  applySetModifierMuted(a, 'fc1', id, false);
  eq(a.fcurves[0].modifiers[0].muted, undefined,
    '29b: muted sparse-deleted on false');
}

// ── 30. wouldSetModifierMutedChange ────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldSetModifierMutedChange(a, 'fc1', id, true), true,
    '30a: false→true → change');
  eq(wouldSetModifierMutedChange(a, 'fc1', id, false), false,
    '30b: already false → no change');
  applySetModifierMuted(a, 'fc1', id, true);
  eq(wouldSetModifierMutedChange(a, 'fc1', id, true), false,
    '30c: already true → no change');
}

// ── 31. setActiveModifier is EXCLUSIVE ─────────────────────────────
// Post-audit-fix MED-8: add-modifier no longer auto-promotes; manually
// set each modifier active in turn to ensure prior actives are cleared.
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');     // m0 active (single-on-add)
  applyAddModifier(a, 'fc1', 'generator'); // m1 (not auto-promoted)
  applyAddModifier(a, 'fc1', 'limits');    // m2 (not auto-promoted)
  const m1Id = a.fcurves[0].modifiers[1].id;
  applySetActiveModifier(a, 'fc1', m1Id);  // m1 now active
  const m0Id = a.fcurves[0].modifiers[0].id;
  applySetActiveModifier(a, 'fc1', m0Id);
  // Only m0 should be active
  eq(a.fcurves[0].modifiers[0].active, true, '31a: m0 active');
  eq(a.fcurves[0].modifiers[1].active, undefined, '31b: m1 sparse-deleted');
  eq(a.fcurves[0].modifiers[2].active, undefined, '31c: m2 sparse-deleted');
}

// ── 32. wouldSetActiveModifierChange ───────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldSetActiveModifierChange(a, 'fc1', id), false,
    '32a: already active → no change');
  eq(wouldSetActiveModifierChange(a, 'fc1', 'nope'), false,
    '32b: unknown id → no change');
}

// ===========================================================================
// applyEditModifierData / Flag / Number
// ===========================================================================

// ── 33. applyEditModifierData on noise.size ────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  applyEditModifierData(a, 'fc1', id, 'size', 500);
  eq(a.fcurves[0].modifiers[0].data.size, 500, '33: size set');
}

// ── 34. wouldEditModifierDataChange ────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldEditModifierDataChange(a, 'fc1', id, 'size', 1000), false,
    '34a: writing existing default → no change');
  eq(wouldEditModifierDataChange(a, 'fc1', id, 'size', 500), true,
    '34b: writing different → change');
}

// ── 35. applySetModifierFlag (sparse-delete on false) ──────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  applySetModifierFlag(a, 'fc1', id, 'useRestrictedRange', true);
  eq(a.fcurves[0].modifiers[0].useRestrictedRange, true, '35a: flag set');
  applySetModifierFlag(a, 'fc1', id, 'useRestrictedRange', false);
  eq(a.fcurves[0].modifiers[0].useRestrictedRange, undefined,
    '35b: sparse-deleted on false');
}

// ── 36. applyEditModifierNumber on top-level fields ────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'noise');
  const id = a.fcurves[0].modifiers[0].id;
  applyEditModifierNumber(a, 'fc1', id, 'sfra', 200);
  eq(a.fcurves[0].modifiers[0].sfra, 200, '36a: sfra set');
  applyEditModifierNumber(a, 'fc1', id, 'influence', 0.5);
  eq(a.fcurves[0].modifiers[0].influence, 0.5, '36b: influence set');
}

// ===========================================================================
// Generator coefficient ops
// ===========================================================================

// ── 37. Add coefficient appends 0 ──────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  // Default is [0, 1]
  applyAddGeneratorCoefficient(a, 'fc1', id);
  eq(a.fcurves[0].modifiers[0].data.coefficients.length, 3,
    '37a: length grew to 3');
  eq(a.fcurves[0].modifiers[0].data.coefficients[2], 0,
    '37b: new coefficient = 0');
}

// ── 38. Remove coefficient pops from end ───────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  applyRemoveGeneratorCoefficient(a, 'fc1', id);
  eq(a.fcurves[0].modifiers[0].data.coefficients.length, 1, '38a: length=1');
  // Remove again → empty
  applyRemoveGeneratorCoefficient(a, 'fc1', id);
  eq(a.fcurves[0].modifiers[0].data.coefficients.length, 0, '38b: length=0');
  // Remove on empty → no-op (no throw)
  applyRemoveGeneratorCoefficient(a, 'fc1', id);
  eq(a.fcurves[0].modifiers[0].data.coefficients.length, 0,
    '38c: remove on empty is safe no-op');
}

// ── 39. Edit specific coefficient ──────────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  applyEditGeneratorCoefficient(a, 'fc1', id, 0, 5);
  eq(a.fcurves[0].modifiers[0].data.coefficients[0], 5, '39a: c0 = 5');
  applyEditGeneratorCoefficient(a, 'fc1', id, 1, 2);
  eq(a.fcurves[0].modifiers[0].data.coefficients[1], 2, '39b: c1 = 2');
  // Out-of-bounds is a no-op
  applyEditGeneratorCoefficient(a, 'fc1', id, 5, 99);
  eq(a.fcurves[0].modifiers[0].data.coefficients.length, 2,
    '39c: out-of-bounds doesn\'t grow array');
}

// ===========================================================================
// Envelope control point ops
// ===========================================================================

// ── 40. Add control point, sorted insertion ────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  applyAddEnvelopeControlPoint(a, 'fc1', id, 500);
  applyAddEnvelopeControlPoint(a, 'fc1', id, 100);
  applyAddEnvelopeControlPoint(a, 'fc1', id, 300);
  const pts = a.fcurves[0].modifiers[0].data.controlPoints;
  eq(pts.length, 3, '40a: 3 points');
  eq(pts[0].time, 100, '40b: sorted [100, ...]');
  eq(pts[1].time, 300, '40c: sorted [..., 300, ...]');
  eq(pts[2].time, 500, '40d: sorted [..., 500]');
  // Default min/max derived from envelope defaults (-1, +1)
  eq(pts[0].min, -1, '40e: default min=-1');
  eq(pts[0].max, 1, '40f: default max=+1');
}

// ── 41. Remove control point by index ──────────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  applyAddEnvelopeControlPoint(a, 'fc1', id, 100);
  applyAddEnvelopeControlPoint(a, 'fc1', id, 500);
  applyRemoveEnvelopeControlPoint(a, 'fc1', id, 0);
  const pts = a.fcurves[0].modifiers[0].data.controlPoints;
  eq(pts.length, 1, '41a: 1 point remains');
  eq(pts[0].time, 500, '41b: 500 survives');
}

// ── 42. Edit control point time → re-sort ──────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  applyAddEnvelopeControlPoint(a, 'fc1', id, 100);
  applyAddEnvelopeControlPoint(a, 'fc1', id, 300);
  // Edit pt[0] time from 100 to 500 → should re-sort
  applyEditEnvelopeControlPoint(a, 'fc1', id, 0, 'time', 500);
  const pts = a.fcurves[0].modifiers[0].data.controlPoints;
  eq(pts[0].time, 300, '42a: 300 first after edit');
  eq(pts[1].time, 500, '42b: 500 second after edit');
}

// ── 43. Edit control point min/max → no re-sort ────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  applyAddEnvelopeControlPoint(a, 'fc1', id, 500);
  applyEditEnvelopeControlPoint(a, 'fc1', id, 0, 'min', -2);
  applyEditEnvelopeControlPoint(a, 'fc1', id, 0, 'max', 2);
  const pt = a.fcurves[0].modifiers[0].data.controlPoints[0];
  eq(pt.min, -2, '43a: min=-2');
  eq(pt.max, 2, '43b: max=2');
}

// ===========================================================================
// Audit-fix 3.C arch MED-1/2: would*Change predicates for Generator +
// Envelope ops
// ===========================================================================

// ── 43b. wouldAddGeneratorCoefficientChange ────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldAddGeneratorCoefficientChange(a, 'fc1', id), true,
    '43b-1: generator exists → true');
  eq(wouldAddGeneratorCoefficientChange(a, 'fc1', 'nope'), false,
    '43b-2: unknown modifier id → false');
  // Add a non-generator, verify it returns false for non-generator
  applyAddModifier(a, 'fc1', 'noise');
  const noiseId = a.fcurves[0].modifiers[1].id;
  eq(wouldAddGeneratorCoefficientChange(a, 'fc1', noiseId), false,
    '43b-3: non-generator modifier → false');
}

// ── 43c. wouldRemoveGeneratorCoefficientChange ─────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldRemoveGeneratorCoefficientChange(a, 'fc1', id), true,
    '43c-1: default coefficients [0,1] → can remove');
  applyRemoveGeneratorCoefficient(a, 'fc1', id);
  applyRemoveGeneratorCoefficient(a, 'fc1', id);
  // Now empty
  eq(wouldRemoveGeneratorCoefficientChange(a, 'fc1', id), false,
    '43c-2: empty coefficients → cannot remove');
}

// ── 43d. wouldEditGeneratorCoefficientChange ───────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'generator');
  const id = a.fcurves[0].modifiers[0].id;
  // Default is [0, 1]
  eq(wouldEditGeneratorCoefficientChange(a, 'fc1', id, 0, 0), false,
    '43d-1: write existing (0) → no change');
  eq(wouldEditGeneratorCoefficientChange(a, 'fc1', id, 0, 5), true,
    '43d-2: write different (5) → change');
  eq(wouldEditGeneratorCoefficientChange(a, 'fc1', id, 99, 5), false,
    '43d-3: out-of-bounds index → false');
}

// ── 43e. wouldAddEnvelopeControlPointChange ────────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldAddEnvelopeControlPointChange(a, 'fc1', id), true,
    '43e-1: envelope exists → true');
  eq(wouldAddEnvelopeControlPointChange(a, 'fc1', 'nope'), false,
    '43e-2: unknown id → false');
}

// ── 43f. wouldRemoveEnvelopeControlPointChange ─────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  eq(wouldRemoveEnvelopeControlPointChange(a, 'fc1', id, 0), false,
    '43f-1: empty controlPoints, index 0 → false');
  applyAddEnvelopeControlPoint(a, 'fc1', id, 500);
  eq(wouldRemoveEnvelopeControlPointChange(a, 'fc1', id, 0), true,
    '43f-2: after add, index 0 valid → true');
  eq(wouldRemoveEnvelopeControlPointChange(a, 'fc1', id, 5), false,
    '43f-3: out-of-bounds → false');
}

// ── 43g. wouldEditEnvelopeControlPointChange ───────────────────────
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'envelope');
  const id = a.fcurves[0].modifiers[0].id;
  applyAddEnvelopeControlPoint(a, 'fc1', id, 500);
  // Default at time 500: min=-1, max=1
  eq(wouldEditEnvelopeControlPointChange(a, 'fc1', id, 0, 'time', 500), false,
    '43g-1: write same time → no change');
  eq(wouldEditEnvelopeControlPointChange(a, 'fc1', id, 0, 'time', 700), true,
    '43g-2: write different time → change');
  eq(wouldEditEnvelopeControlPointChange(a, 'fc1', id, 0, 'min', -1), false,
    '43g-3: write same min → no change');
  eq(wouldEditEnvelopeControlPointChange(a, 'fc1', id, 0, 'min', -2), true,
    '43g-4: write different min → change');
}

// ===========================================================================
// MODIFIER_TYPE_OPTIONS / MODIFIER_TYPE_LABELS
// ===========================================================================

// ── 44. MODIFIER_TYPE_OPTIONS shape ────────────────────────────────
{
  eq(MODIFIER_TYPE_OPTIONS.length, 6, '44a: 6 type options');
  // All keys + labels
  for (const opt of MODIFIER_TYPE_OPTIONS) {
    assert(typeof opt.key === 'string' && opt.key.length > 0,
      `44b: opt.${opt.key} key non-empty`);
    assert(typeof opt.label === 'string' && opt.label.length > 0,
      `44c: opt.${opt.key} label non-empty`);
  }
  eq(MODIFIER_TYPE_LABELS.cycles, 'Cycles', '44d: cycles label');
  eq(MODIFIER_TYPE_LABELS.envelope, 'Envelope', '44e: envelope label');
}

// ===========================================================================
// Integration: complete add/edit/remove flow
// ===========================================================================

// ── 45. Complete flow: add Cycles + Noise, mute, edit, remove ──────
// Post-audit-fix MED-8: cycles is single-on-add → active; noise is
// added second → not auto-promoted. Cycles stays active throughout.
{
  const a = { id: 'a' }; fc(a, 'fc1');
  applyAddModifier(a, 'fc1', 'cycles');  // cycles at 0, active (single)
  applyAddModifier(a, 'fc1', 'noise');   // noise at 1, NOT auto-promoted
  const cyclesId = a.fcurves[0].modifiers[0].id;
  const noiseId = a.fcurves[0].modifiers[1].id;
  // Cycles is already active; verify
  eq(a.fcurves[0].modifiers[0].active, true, '45a: cycles active (single-on-add)');
  eq(a.fcurves[0].modifiers[1].active, undefined, '45b: noise NOT auto-promoted');
  // Mute noise
  applySetModifierMuted(a, 'fc1', noiseId, true);
  // Edit cycles data
  applyEditModifierData(a, 'fc1', cyclesId, 'afterCycles', 3);
  // Verify state
  eq(a.fcurves[0].modifiers[1].muted, true, '45c: noise muted');
  eq(a.fcurves[0].modifiers[0].data.afterCycles, 3, '45d: cycles afterCycles=3');
  // Remove cycles → noise promoted to active (only one left, was prior neighbor)
  applyRemoveModifier(a, 'fc1', cyclesId);
  eq(a.fcurves[0].modifiers.length, 1, '45e: 1 modifier remains');
  eq(a.fcurves[0].modifiers[0].active, true,
    '45f: noise auto-promoted to active when previous head removed');
}

console.log(`\nfcurveModifiersPanelData: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
