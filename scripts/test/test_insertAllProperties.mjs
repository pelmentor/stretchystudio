// scripts/test/test_insertAllProperties.mjs — Phase 7 Slice 7.G.
//
// Pins the behaviour of `insertAllPropertyKeyframes`, the legacy K-key
// "insert all properties" fan-out extracted from CanvasViewport. Before
// 7.G this logic lived inside a React effect and was never unit-tested.
//
//   §1 transform-prop fan-out + value priority (draft > kf > base)
//   §2 auto rest-pose keyform at startMs (first-key, past start)
//   §3 mesh_verts gating (deform draft / existing fcurve only)
//   §4 blend-shape influence keyforms
//   §5 guards (missing action / missing node / fcurve reuse)

import { insertAllPropertyKeyframes } from '../../src/renderer/insertAllProperties.js';
import { KEYFRAME_PROPS } from '../../src/renderer/animationEngine.js';
import { decodeFCurveTarget } from '../../src/anim/animationFCurve.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${msg}`); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  ok(same, msg);
}

// Find the fcurve for (nodeId, property) in an action.
function fc(action, nodeId, property) {
  return action.fcurves.find((f) => {
    const t = decodeFCurveTarget(f);
    return t?.kind === 'node' && t.nodeId === nodeId && t.property === property;
  }) ?? null;
}
function keyAt(fcurve, timeMs) {
  return fcurve ? (fcurve.keyforms.find((k) => k.time === timeMs) ?? null) : null;
}

function makeProject() {
  return {
    nodes: [
      {
        id: 'partA', type: 'part', name: 'PartA',
        transform: { x: 5, y: 6, rotation: 0.1, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        opacity: 0.5, visible: true,
        mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], uvs: [], triangles: [] },
        blendShapes: [{ id: 'smile' }, { id: 'frown' }],
        blendShapeValues: { smile: 0.3, frown: 0 },
      },
      {
        id: 'partB', type: 'part', name: 'PartB',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        opacity: 1, visible: true,
        // no mesh, no blend shapes
      },
    ],
    actions: [
      { id: 'act1', name: 'Act', fcurves: [] },
    ],
  };
}

const emptyMaps = () => ({ restPose: new Map(), draftPose: new Map() });

// ── §1 transform fan-out + value priority ───────────────────────────
console.log('\n§1 transform fan-out + value priority');
{
  // §1.1 base values (no draft, no override) — every KEYFRAME_PROPS gets a key
  const proj = makeProject();
  const { restPose, draftPose } = emptyMaps();
  insertAllPropertyKeyframes(proj, {
    actionId: 'act1', selectedIds: ['partB'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose, draftPose,
  });
  const act = proj.actions[0];
  for (const prop of KEYFRAME_PROPS) {
    ok(fc(act, 'partB', prop), `§1.1 created fcurve for ${prop}`);
  }
  eq(keyAt(fc(act, 'partB', 'x'), 0)?.value, 0, '§1.1 x base value 0');

  // §1.2 base values from a populated transform
  const proj2 = makeProject();
  insertAllPropertyKeyframes(proj2, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  const act2 = proj2.actions[0];
  eq(keyAt(fc(act2, 'partA', 'x'), 0)?.value, 5, '§1.2 x from transform = 5');
  eq(keyAt(fc(act2, 'partA', 'rotation'), 0)?.value, 0.1, '§1.2 rotation = 0.1');
  eq(keyAt(fc(act2, 'partA', 'opacity'), 0)?.value, 0.5, '§1.2 opacity = 0.5');

  // §1.3 override beats base
  const proj3 = makeProject();
  insertAllPropertyKeyframes(proj3, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 100, startMs: 100,
    keyframeOverrides: new Map([['partA', { x: 42 }]]),
    restPose: new Map(), draftPose: new Map(),
  });
  eq(keyAt(fc(proj3.actions[0], 'partA', 'x'), 100)?.value, 42, '§1.3 override x = 42');
  // a prop NOT in the override still falls back to base
  eq(keyAt(fc(proj3.actions[0], 'partA', 'y'), 100)?.value, 6, '§1.3 non-overridden y = base 6');

  // §1.4 draft beats override beats base
  const proj4 = makeProject();
  insertAllPropertyKeyframes(proj4, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 100, startMs: 100,
    keyframeOverrides: new Map([['partA', { x: 42 }]]),
    restPose: new Map(),
    draftPose: new Map([['partA', { x: 99 }]]),
  });
  eq(keyAt(fc(proj4.actions[0], 'partA', 'x'), 100)?.value, 99, '§1.4 draft x = 99 wins over override');
}

// ── §2 auto rest-pose keyform at startMs ────────────────────────────
console.log('\n§2 auto rest keyform at startMs');
{
  // §2.1 first key past start, rest present → rest keyform inserted at startMs
  const proj = makeProject();
  insertAllPropertyKeyframes(proj, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 1000, startMs: 0,
    keyframeOverrides: new Map(),
    restPose: new Map([['partA', { x: 7, y: 8, rotation: 0, scaleX: 1, scaleY: 1, opacity: 0.9 }]]),
    draftPose: new Map(),
  });
  const fx = fc(proj.actions[0], 'partA', 'x');
  eq(keyAt(fx, 0)?.value, 7, '§2.1 rest keyform at startMs (x=7)');
  eq(keyAt(fx, 1000)?.value, 5, '§2.1 current keyform (x=base 5)');
  ok(fx.keyforms.length === 2, '§2.1 two keyforms (rest + current)');
  // opacity rest uses rest.opacity
  eq(keyAt(fc(proj.actions[0], 'partA', 'opacity'), 0)?.value, 0.9, '§2.1 opacity rest = 0.9');
  // scaleX rest fallback when missing in rest map is 1 (here rest has scaleX:1)
  eq(keyAt(fc(proj.actions[0], 'partA', 'scaleX'), 0)?.value, 1, '§2.1 scaleX rest = 1');

  // §2.2 at start (currentTimeMs == startMs) → NO rest keyform (not past start)
  const proj2 = makeProject();
  insertAllPropertyKeyframes(proj2, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(),
    restPose: new Map([['partA', { x: 7 }]]),
    draftPose: new Map(),
  });
  ok(fc(proj2.actions[0], 'partA', 'x').keyforms.length === 1, '§2.2 only one keyform at start');

  // §2.3 no rest entry → no rest keyform even past start
  const proj3 = makeProject();
  insertAllPropertyKeyframes(proj3, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 1000, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(fc(proj3.actions[0], 'partA', 'x').keyforms.length === 1, '§2.3 no rest → single keyform');

  // §2.4 rest keyform only on NEW fcurve — second insert at a different time
  // does not re-add the startMs rest keyform.
  const proj4 = makeProject();
  const ctx4 = {
    actionId: 'act1', selectedIds: ['partA'], startMs: 0,
    keyframeOverrides: new Map(),
    restPose: new Map([['partA', { x: 7 }]]),
    draftPose: new Map(),
  };
  insertAllPropertyKeyframes(proj4, { ...ctx4, currentTimeMs: 500 });
  insertAllPropertyKeyframes(proj4, { ...ctx4, currentTimeMs: 800 });
  const fx4 = fc(proj4.actions[0], 'partA', 'x');
  // keyforms: rest@0 + 500 + 800 = 3 (rest inserted once, not twice)
  ok(fx4.keyforms.length === 3, `§2.4 rest inserted once (got ${fx4.keyforms.length} keyforms)`);
  ok(keyAt(fx4, 0) && keyAt(fx4, 500) && keyAt(fx4, 800), '§2.4 keyforms at 0/500/800');
}

// ── §3 mesh_verts gating ─────────────────────────────────────────────
// IMPORTANT — pins the *gating* (when a mesh_verts fcurve is created),
// NOT value storage. Pre-existing LATENT BUG surfaced by this extraction:
// `upsertKeyframe` → `makeBezTripleKeyform` rejects any non-numeric value
// (animationFCurve.js:144 `typeof input.value !== 'number' → return null`),
// so mesh_verts (a vertex ARRAY) never produces a stored keyform. The
// legacy K-key handler had this exact behaviour (same `upsertKeyframe`
// call); 7.G preserves it faithfully. Fixing it needs a mesh-aware keyform
// representation — a separate slice, out of §7.G scope. Tests below assert
// the faithful behaviour (fcurve created/gated; keyforms stay empty).
console.log('\n§3 mesh_verts gating (+ latent value-storage bug)');
{
  const deform = [{ x: 9, y: 9 }, { x: 8, y: 8 }, { x: 7, y: 7 }];

  // §3.1 no mesh deform draft + no existing mesh fcurve → NO mesh_verts fcurve
  const proj = makeProject();
  insertAllPropertyKeyframes(proj, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(!fc(proj.actions[0], 'partA', 'mesh_verts'), '§3.1 no mesh_verts fcurve without deform');

  // §3.2 mesh deform in draft OPENS the gate → mesh_verts fcurve created
  // (keyforms stay empty — latent bug above).
  const proj2 = makeProject();
  insertAllPropertyKeyframes(proj2, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 100, startMs: 100,
    keyframeOverrides: new Map(),
    restPose: new Map(),
    draftPose: new Map([['partA', { mesh_verts: deform }]]),
  });
  const mfc = fc(proj2.actions[0], 'partA', 'mesh_verts');
  ok(mfc, '§3.2 deform draft opens the gate → mesh_verts fcurve created');
  ok(mfc.keyforms.length === 0, '§3.2 LATENT BUG: array value rejected → 0 keyforms stored');

  // §3.3 existing mesh_verts fcurve ALSO opens the gate (even with no draft).
  const proj3 = makeProject();
  proj3.actions[0].fcurves.push({
    id: 'partA.mesh_verts', rnaPath: 'objects["partA"].mesh_verts',
    arrayIndex: 0, keyforms: [{ time: 50, value: 1, handleLeft: { time: 50, value: 1 }, handleRight: { time: 50, value: 1 }, handleType: { left: 'vector', right: 'vector' }, interpolation: 'linear', flag: 0 }],
    modifiers: [], extrapolation: 'constant',
  });
  insertAllPropertyKeyframes(proj3, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 1000, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  // Existing fcurve is reused (not duplicated); branch runs the upsert path.
  const meshCurves = proj3.actions[0].fcurves.filter((f) => decodeFCurveTarget(f)?.property === 'mesh_verts');
  ok(meshCurves.length === 1, '§3.3 existing mesh fcurve reused (branch runs without a draft)');

  // §3.4 part without a mesh → never a mesh_verts fcurve even with draft
  const proj4 = makeProject();
  insertAllPropertyKeyframes(proj4, {
    actionId: 'act1', selectedIds: ['partB'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(),
    restPose: new Map(),
    draftPose: new Map([['partB', { mesh_verts: deform }]]),
  });
  ok(!fc(proj4.actions[0], 'partB', 'mesh_verts'), '§3.4 no mesh → no mesh_verts fcurve');
}

// ── §4 blend-shape influence keyforms ───────────────────────────────
console.log('\n§4 blend-shape keyforms');
{
  // §4.1 every blend shape keyed from blendShapeValues
  const proj = makeProject();
  insertAllPropertyKeyframes(proj, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  eq(keyAt(fc(proj.actions[0], 'partA', 'blendShape:smile'), 0)?.value, 0.3, '§4.1 smile = 0.3');
  eq(keyAt(fc(proj.actions[0], 'partA', 'blendShape:frown'), 0)?.value, 0, '§4.1 frown = 0');

  // §4.2 draft beats stored blend value
  const proj2 = makeProject();
  insertAllPropertyKeyframes(proj2, {
    actionId: 'act1', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(),
    restPose: new Map(),
    draftPose: new Map([['partA', { 'blendShape:smile': 0.8 }]]),
  });
  eq(keyAt(fc(proj2.actions[0], 'partA', 'blendShape:smile'), 0)?.value, 0.8, '§4.2 draft smile = 0.8');

  // §4.3 part without blend shapes → no blendShape fcurves
  const proj3 = makeProject();
  insertAllPropertyKeyframes(proj3, {
    actionId: 'act1', selectedIds: ['partB'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(!proj3.actions[0].fcurves.some((f) => decodeFCurveTarget(f)?.property?.startsWith?.('blendShape:')),
    '§4.3 no blendShape fcurves for blend-shape-less part');
}

// ── §5 guards ────────────────────────────────────────────────────────
console.log('\n§5 guards');
{
  // §5.1 unknown action id → no-op, no throw
  const proj = makeProject();
  insertAllPropertyKeyframes(proj, {
    actionId: 'ghost', selectedIds: ['partA'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(proj.actions[0].fcurves.length === 0, '§5.1 unknown action → no fcurves');

  // §5.2 missing node id silently skipped, others still keyed
  const proj2 = makeProject();
  insertAllPropertyKeyframes(proj2, {
    actionId: 'act1', selectedIds: ['ghostNode', 'partB'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(fc(proj2.actions[0], 'partB', 'x'), '§5.2 valid node still keyed despite ghost sibling');

  // §5.3 second insert reuses the same fcurve (no duplicate fcurves)
  const proj3 = makeProject();
  const ctx = {
    actionId: 'act1', selectedIds: ['partB'], startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  };
  insertAllPropertyKeyframes(proj3, { ...ctx, currentTimeMs: 0 });
  insertAllPropertyKeyframes(proj3, { ...ctx, currentTimeMs: 200 });
  const xCurves = proj3.actions[0].fcurves.filter((f) => {
    const t = decodeFCurveTarget(f);
    return t?.nodeId === 'partB' && t.property === 'x';
  });
  ok(xCurves.length === 1, '§5.3 one x fcurve reused across two inserts');
  ok(xCurves[0].keyforms.length === 2, '§5.3 two keyforms on the reused fcurve');

  // §5.4 missing action.fcurves array is initialised
  const proj4 = makeProject();
  delete proj4.actions[0].fcurves;
  insertAllPropertyKeyframes(proj4, {
    actionId: 'act1', selectedIds: ['partB'], currentTimeMs: 0, startMs: 0,
    keyframeOverrides: new Map(), restPose: new Map(), draftPose: new Map(),
  });
  ok(Array.isArray(proj4.actions[0].fcurves) && proj4.actions[0].fcurves.length > 0,
    '§5.4 fcurves array initialised + populated');
}

// ── summary ──────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
