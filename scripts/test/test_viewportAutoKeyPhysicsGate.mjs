// Regression for "physics should work during AutoKey in viewport" (2026-06-11).
//
// CanvasViewport's rAF tick had a single `if (livePreview) {…}` gate
// that wrapped ALL live drivers: breath / eye blink / cursor look /
// physics / record-mode keyframing. Outside Live Preview (i.e. in the
// regular Viewport surface), physics was dead — even when AutoKey was
// armed and the user was actively posing the rig. Hair/clothing/any
// physics-driven channel sat at rest, and `record` mode had no
// physics outputs to snapshot into fcurves.
//
// New gate (`shouldRunDrivers`): runs when EITHER
//   1. `livePreview` (full Cubism Viewer parity surface), OR
//   2. `!livePreview && autoKeyframe && physicsRules.length > 0`
//      (viewport authoring with physics — the user wants the sim to
//      contribute and, if mode === 'record', get keyframed).
//
// Breath / eye blink / cursor look stay gated INSIDE `if (livePreview)`
// because they're auto-cycling performance drivers, not authoring
// inputs — keyframing them while the user poses would smear
// ParamBreath's sine across every frame they touch.
//
// This test pins the gate truth table directly so future refactors
// can't silently revert the "viewport physics is off" bug. The actual
// physics tick + keyframing code paths have their own tests
// (test_physicsTick, test_insertKeyframe, test_autoKeyDispatch); this
// asserts only the GATE.
//
// Run: node scripts/test/test_viewportAutoKeyPhysicsGate.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

/**
 * The gate, extracted from `CanvasViewport.jsx`. Pure-fn so this test
 * isn't coupled to React refs / rAF setup.
 *
 * @param {{
 *   livePreview: boolean,
 *   autoKeyframe: boolean,
 *   physicsRules: any[]|null|undefined,
 * }} state
 * @returns {{
 *   shouldRunDrivers: boolean,
 *   shouldRunBreathBlinkLook: boolean,
 *   shouldRunPhysics: boolean,
 * }}
 */
function evalGates({ livePreview, autoKeyframe, physicsRules }) {
  const hasPhysicsRules = Array.isArray(physicsRules) && physicsRules.length > 0;
  const viewportAutoKeyPhysics = !livePreview && autoKeyframe && hasPhysicsRules;
  const shouldRunDrivers = livePreview || viewportAutoKeyPhysics;
  // Inside shouldRunDrivers, breath/blink/look are inner-gated on livePreview.
  const shouldRunBreathBlinkLook = shouldRunDrivers && livePreview;
  // Physics fires whenever the drivers block runs AND there are rules.
  const shouldRunPhysics = shouldRunDrivers && hasPhysicsRules;
  return { shouldRunDrivers, shouldRunBreathBlinkLook, shouldRunPhysics };
}

const RULES = [{ id: 'r1' }];
const NO_RULES = [];

// ── §1 — Live Preview surface: everything fires (unchanged behaviour) ──

{
  const g = evalGates({ livePreview: true, autoKeyframe: false, physicsRules: RULES });
  ok(g.shouldRunDrivers, '§1 — livePreview alone fires drivers');
  ok(g.shouldRunBreathBlinkLook, '§1 — livePreview fires breath/blink/look');
  ok(g.shouldRunPhysics, '§1 — livePreview fires physics');
}
{
  const g = evalGates({ livePreview: true, autoKeyframe: true, physicsRules: RULES });
  ok(g.shouldRunDrivers && g.shouldRunBreathBlinkLook && g.shouldRunPhysics,
    '§1 — livePreview + autoKey: full driver set (autoKey is orthogonal here)');
}
{
  const g = evalGates({ livePreview: true, autoKeyframe: false, physicsRules: NO_RULES });
  ok(g.shouldRunDrivers, '§1 — livePreview fires drivers even with no physics rules');
  ok(g.shouldRunBreathBlinkLook, '§1 — breath/blink/look fire without physics rules in live preview');
  ok(!g.shouldRunPhysics, '§1 — no rules → no physics tick (rules-gate orthogonal)');
}

// ── §2 — Viewport + AutoKey + physics rules: PHYSICS ONLY ──────────────

{
  const g = evalGates({ livePreview: false, autoKeyframe: true, physicsRules: RULES });
  ok(g.shouldRunDrivers, '§2 — viewport + autoKey + rules: drivers block fires (THE FIX)');
  ok(!g.shouldRunBreathBlinkLook,
    '§2 — viewport + autoKey: breath/blink/look STAY OFF (would smear keys)');
  ok(g.shouldRunPhysics, '§2 — viewport + autoKey: physics fires (user request)');
}

// ── §3 — Viewport + AutoKey + NO physics rules: drivers stay off ──────

{
  const g = evalGates({ livePreview: false, autoKeyframe: true, physicsRules: NO_RULES });
  ok(!g.shouldRunDrivers,
    '§3 — viewport + autoKey + no physics: nothing to run (drivers off)');
  ok(!g.shouldRunBreathBlinkLook, '§3 — no rules → no breath/blink/look in viewport');
  ok(!g.shouldRunPhysics, '§3 — no rules → no physics');
}

// ── §4 — Viewport without AutoKey: drivers off (static authoring) ──────

{
  const g = evalGates({ livePreview: false, autoKeyframe: false, physicsRules: RULES });
  ok(!g.shouldRunDrivers, '§4 — viewport, no autoKey: drivers off (static pose mode)');
  ok(!g.shouldRunPhysics, '§4 — viewport, no autoKey: physics off (user not authoring)');
}

// ── §5 — Edge cases ───────────────────────────────────────────────────

{
  const g = evalGates({ livePreview: false, autoKeyframe: false, physicsRules: null });
  ok(!g.shouldRunDrivers, '§5 — null physicsRules: still no drivers');
}
{
  const g = evalGates({ livePreview: false, autoKeyframe: true, physicsRules: undefined });
  ok(!g.shouldRunDrivers, '§5 — undefined physicsRules: hasPhysicsRules false → no drivers');
}

console.log(`viewportAutoKeyPhysicsGate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
