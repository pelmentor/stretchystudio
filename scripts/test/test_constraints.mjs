// Tests for the Phase 4 constraint evaluator (`src/anim/constraints.js`).
//
// Ports four Blender constraint types to SS's 2D model:
//   - COPY_LOCATION  (Blender CONSTRAINT_TYPE_LOCLIKE)
//   - COPY_ROTATION  (Blender CONSTRAINT_TYPE_ROTLIKE)
//   - LIMIT_ROTATION (Blender CONSTRAINT_TYPE_ROTLIMIT)
//   - TRACK_TO       (Blender CONSTRAINT_TYPE_TRACKTO)
//
// Run: node scripts/test/test_constraints.mjs

import {
  evaluateConstraint,
  evaluateConstraints,
} from '../../src/anim/constraints.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertNear(actual, expected, eps, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

const id = () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

function makeProject(targetTransform) {
  return {
    nodes: [
      {
        id: 'target',
        type: 'part',
        transform: { ...id(), ...targetTransform },
      },
    ],
  };
}

// ── COPY_LOCATION: copy x and y from target ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL', enabled: true, influence: 1,
    payload: { targetId: 'target', useX: true, useY: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 10, y: 5 }, project);
  assertNear(out.x, 100, 1e-9, 'COPY_LOCATION: x copied');
  assertNear(out.y, 50, 1e-9, 'COPY_LOCATION: y copied');
}

// ── COPY_LOCATION: useX false leaves x untouched ──
{
  const project = makeProject({ x: 999, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL', enabled: true,
    payload: { targetId: 'target', useX: false, useY: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 10, y: 5 }, project);
  assertNear(out.x, 10, 1e-9, 'COPY_LOCATION: useX:false preserves x');
  assertNear(out.y, 50, 1e-9, 'COPY_LOCATION: useY:true copies y');
}

// ── COPY_LOCATION: invertX negates ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL',
    payload: { targetId: 'target', useX: true, useY: true, invertX: true },
  };
  const out = evaluateConstraint(con, id(), project);
  assertNear(out.x, -100, 1e-9, 'COPY_LOCATION: invertX negates target x');
  assertNear(out.y, 50, 1e-9, 'COPY_LOCATION: invertX leaves y alone');
}

// ── COPY_LOCATION: offset adds owner pos to copied target ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL',
    payload: { targetId: 'target', useX: true, useY: true, offset: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 10, y: 5 }, project);
  assertNear(out.x, 110, 1e-9, 'COPY_LOCATION: offset adds owner.x');
  assertNear(out.y, 55, 1e-9, 'COPY_LOCATION: offset adds owner.y');
}

// ── COPY_LOCATION: missing target falls through to identity ──
{
  const project = makeProject({});
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL',
    payload: { targetId: 'nonexistent', useX: true, useY: true },
  };
  const owner = { ...id(), x: 7, y: 8 };
  const out = evaluateConstraint(con, owner, project);
  assertNear(out.x, 7, 1e-9, 'COPY_LOCATION: missing target preserves owner x');
  assertNear(out.y, 8, 1e-9, 'COPY_LOCATION: missing target preserves owner y');
}

// ── COPY_ROTATION: replace mode ──
{
  const project = makeProject({ rotation: 1.0 });
  const con = {
    id: 'cn1', type: 'COPY_ROTATION', name: 'CR',
    payload: { targetId: 'target', mixMode: 'replace' },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 0.5 }, project);
  assertNear(out.rotation, 1.0, 1e-9, 'COPY_ROTATION replace: takes target rotation');
}

// ── COPY_ROTATION: add mode ──
{
  const project = makeProject({ rotation: 1.0 });
  const con = {
    id: 'cn1', type: 'COPY_ROTATION', name: 'CR',
    payload: { targetId: 'target', mixMode: 'add' },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 0.5 }, project);
  assertNear(out.rotation, 1.5, 1e-9, 'COPY_ROTATION add: sums owner + target');
}

// ── COPY_ROTATION: invert flips target sign ──
{
  const project = makeProject({ rotation: 1.0 });
  const con = {
    id: 'cn1', type: 'COPY_ROTATION', name: 'CR',
    payload: { targetId: 'target', mixMode: 'replace', invert: true },
  };
  const out = evaluateConstraint(con, id(), project);
  assertNear(out.rotation, -1.0, 1e-9, 'COPY_ROTATION invert: target sign flipped');
}

// ── COPY_ROTATION: result wraps to (-180, 180] (degrees) ──
// F1-rotation-units (R4) — constraint kernel now operates in degrees
// (project-wide convention; pre-fix it operated in radians and the
// renderer's deg→rad conversion at makeLocalMatrix applied PI/180
// twice — 360x off).
{
  const project = makeProject({ rotation: 175 });
  const con = {
    id: 'cn1', type: 'COPY_ROTATION', name: 'CR',
    payload: { targetId: 'target', mixMode: 'add' },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 175 }, project);
  // owner + target = 350, wrap to (-180, 180] → -10
  assertNear(out.rotation, -10, 1e-9, 'COPY_ROTATION add: wraps result into (-180,180] degrees');
}

// ── LIMIT_ROTATION: clamp into [min, max] ──
{
  const project = makeProject({});
  const con = {
    id: 'cn1', type: 'LIMIT_ROTATION', name: 'LR',
    payload: { useMin: true, useMax: true, min: -0.5, max: 0.5 },
  };
  // Owner over max → clamps to max.
  const overMax = evaluateConstraint(con, { ...id(), rotation: 1.0 }, project);
  assertNear(overMax.rotation, 0.5, 1e-9, 'LIMIT_ROTATION: above max clamps to max');
  // Owner under min → clamps to min.
  const underMin = evaluateConstraint(con, { ...id(), rotation: -1.0 }, project);
  assertNear(underMin.rotation, -0.5, 1e-9, 'LIMIT_ROTATION: below min clamps to min');
  // Inside range → unchanged.
  const inside = evaluateConstraint(con, { ...id(), rotation: 0.2 }, project);
  assertNear(inside.rotation, 0.2, 1e-9, 'LIMIT_ROTATION: inside range unchanged');
}

// ── LIMIT_ROTATION: useMin only ──
{
  const project = makeProject({});
  const con = {
    id: 'cn1', type: 'LIMIT_ROTATION', name: 'LR',
    payload: { useMin: true, useMax: false, min: 0.1, max: 0.5 },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 0.0 }, project);
  assertNear(out.rotation, 0.1, 1e-9, 'LIMIT_ROTATION useMin only: clamps low side');
  const overMax = evaluateConstraint(con, { ...id(), rotation: 1.0 }, project);
  assertNear(overMax.rotation, 1.0, 1e-9, 'LIMIT_ROTATION useMin only: high side untouched');
}

// ── LIMIT_ROTATION: neither flag → no-op ──
{
  const project = makeProject({});
  const con = {
    id: 'cn1', type: 'LIMIT_ROTATION', name: 'LR',
    payload: { useMin: false, useMax: false, min: 0.0, max: 0.0 },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 5.0 }, project);
  assertNear(out.rotation, 5.0, 1e-9, 'LIMIT_ROTATION: neither min nor max → pass-through');
}

// ── TRACK_TO: rotates to point at target ──
{
  // Owner at origin, target straight along +X → owner rotation = 0.
  const project = makeProject({ x: 10, y: 0 });
  const con = {
    id: 'cn1', type: 'TRACK_TO', name: 'TT',
    payload: { targetId: 'target' },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 1.5 }, project);
  assertNear(out.rotation, 0, 1e-9, 'TRACK_TO: target on +X → rotation 0');

  // Target straight along +Y → rotation = 90° (degrees).
  // F1-rotation-units (R4): atan2 result converted to degrees.
  const projectY = makeProject({ x: 0, y: 10 });
  const outY = evaluateConstraint(con, id(), projectY);
  assertNear(outY.rotation, 90, 1e-9, 'TRACK_TO: target on +Y → rotation 90°');
}

// ── TRACK_TO: target at owner position is no-op ──
{
  const project = makeProject({ x: 0, y: 0 });
  const con = {
    id: 'cn1', type: 'TRACK_TO', name: 'TT',
    payload: { targetId: 'target' },
  };
  const out = evaluateConstraint(con, { ...id(), rotation: 0.7 }, project);
  assertNear(out.rotation, 0.7, 1e-9, 'TRACK_TO: target at owner → pass-through');
}

// ── Influence 0 → no effect ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL', influence: 0,
    payload: { targetId: 'target', useX: true, useY: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 1, y: 2 }, project);
  assertNear(out.x, 1, 1e-9, 'influence 0: x unchanged');
  assertNear(out.y, 2, 1e-9, 'influence 0: y unchanged');
}

// ── Influence 0.5 → halfway ──
{
  const project = makeProject({ x: 100, y: 100 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL', influence: 0.5,
    payload: { targetId: 'target', useX: true, useY: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 0, y: 0 }, project);
  assertNear(out.x, 50, 1e-9, 'influence 0.5: x lerped halfway');
  assertNear(out.y, 50, 1e-9, 'influence 0.5: y lerped halfway');
}

// ── enabled:false → no-op ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'COPY_LOCATION', name: 'CL', enabled: false,
    payload: { targetId: 'target', useX: true, useY: true },
  };
  const out = evaluateConstraint(con, { ...id(), x: 1, y: 2 }, project);
  assertNear(out.x, 1, 1e-9, 'enabled:false: x unchanged');
}

// ── unknown type → no-op ──
{
  const project = makeProject({ x: 100, y: 50 });
  const con = {
    id: 'cn1', type: 'IK_FUTURE', name: 'IK',
    payload: { targetId: 'target' },
  };
  const out = evaluateConstraint(con, { ...id(), x: 7, y: 8 }, project);
  assertNear(out.x, 7, 1e-9, 'unknown type: pass-through x');
}

// ── evaluateConstraints walks stack in order ──
{
  // Stack: COPY_LOCATION(target), then LIMIT_ROTATION (clamp to 0.2..0.5).
  const project = {
    nodes: [
      { id: 'target', type: 'part', transform: { ...id(), x: 10, y: 20 } },
      {
        id: 'owner',
        type: 'part',
        transform: { ...id(), x: 0, y: 0, rotation: 1.0 },
        constraints: [
          { id: 'c1', type: 'COPY_LOCATION', name: 'CL',
            payload: { targetId: 'target', useX: true, useY: true } },
          { id: 'c2', type: 'LIMIT_ROTATION', name: 'LR',
            payload: { useMin: true, useMax: true, min: 0.2, max: 0.5 } },
        ],
      },
    ],
  };
  const owner = project.nodes[1];
  const out = evaluateConstraints(owner, null, project);
  assertNear(out.x, 10, 1e-9, 'stack: location copied first');
  assertNear(out.y, 20, 1e-9, 'stack: y copied first');
  assertNear(out.rotation, 0.5, 1e-9, 'stack: rotation clamped second');
}

// ── evaluateConstraints with empty stack → effective transform ──
{
  const project = {
    nodes: [
      { id: 'owner', type: 'part', transform: { ...id(), x: 5, y: 6 } },
    ],
  };
  const owner = project.nodes[0];
  const out = evaluateConstraints(owner, null, project);
  assertNear(out.x, 5, 1e-9, 'no constraints: x preserved');
  assertNear(out.y, 6, 1e-9, 'no constraints: y preserved');
}

// ── evaluateConstraints honours seed override ──
{
  const project = {
    nodes: [
      { id: 'target', type: 'part', transform: { ...id(), x: 999, y: 999 } },
      {
        id: 'owner',
        type: 'part',
        transform: { ...id(), x: 0, y: 0 },
        constraints: [
          { id: 'c1', type: 'COPY_LOCATION', name: 'CL', influence: 1,
            payload: { targetId: 'target', useX: false, useY: false } },
        ],
      },
    ],
  };
  const owner = project.nodes[1];
  // Seed with custom transform; the no-axis CL passes through, so the
  // seed ends up unchanged.
  const out = evaluateConstraints(owner, { ...id(), x: 42, y: 42 }, project);
  assertNear(out.x, 42, 1e-9, 'seed override: x from seed not from owner');
  assertNear(out.y, 42, 1e-9, 'seed override: y from seed not from owner');
}

// ── Bone owner: effectiveTransform reads pose ──
{
  // Bone with rest pivot (100, 200) and pose offset (3, 4) and rotation 0.6.
  const bone = {
    id: 'bone',
    type: 'group',
    boneRole: 'head',
    transform: { ...id(), pivotX: 100, pivotY: 200 },
    pose: { rotation: 0.6, x: 3, y: 4, scaleX: 1, scaleY: 1 },
    constraints: [
      { id: 'c1', type: 'LIMIT_ROTATION', name: 'LR',
        payload: { useMin: true, useMax: true, min: -0.5, max: 0.5 } },
    ],
  };
  const project = { nodes: [bone] };
  const out = evaluateConstraints(bone, null, project);
  assertNear(out.x, 103, 1e-9, 'bone owner: x = pivot + pose.x');
  assertNear(out.y, 204, 1e-9, 'bone owner: y = pivot + pose.y');
  assertNear(out.rotation, 0.5, 1e-9, 'bone owner: rotation clamped');
}

console.log(`constraints: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
