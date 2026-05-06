// BVR-004 — Armature Edit Mode dichotomy.
//
// Properties verified:
//   1. shiftBonePivot translates the dragged bone's pivot AND every
//      descendant bone's pivot by the same delta (Blender Edit Mode "G"
//      with descendant follow).
//   2. shiftBonePivot does NOT touch node.pose (rest-frame-only write).
//   3. shiftBonePivot does NOT touch non-bone descendants (parts/groups
//      without boneRole — pivots are bone-only).
//   4. shiftBonePivot bumps geometryVersion (rigSpec invalidation).
//   5. shiftBonePivot is a no-op when (dx, dy) = (0, 0).
//   6. shiftBonePivot is a no-op when called on a non-bone node.
//
// Run: node scripts/test/test_armatureEditMode.mjs

import { useProjectStore } from '../../src/store/projectStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

function nearlyEq(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

function setupChain() {
  // root → torso(pivot=500,800) → head(pivot=500,400) → mesh part
  // plus a non-bone group spacer to confirm we descend through it.
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 17,
      canvas: { width: 1024, height: 1024 },
      textures: [],
      nodes: [
        {
          id: 'b-torso', type: 'group', boneRole: 'torso', name: 'torso',
          parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 800 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'g-spacer', type: 'group', name: 'spacer', parent: 'b-torso',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        },
        {
          id: 'b-head', type: 'group', boneRole: 'head', name: 'head',
          parent: 'g-spacer',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 500, pivotY: 400 },
          pose:      { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
        },
        {
          id: 'p-face', type: 'part', parent: 'b-head',
          mesh: { vertices: [
            { x: 500, y: 400, restX: 500, restY: 400 },
          ] },
        },
      ],
      animations: [], parameters: [], physics_groups: [],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0, textureVersion: 0 },
    hasUnsavedChanges: false,
  });
}

// ── Test 1: dragged bone pivot shifts; descendant bone pivot shifts too ──
{
  setupChain();
  const gv0 = useProjectStore.getState().versionControl.geometryVersion;
  useProjectStore.getState().shiftBonePivot('b-torso', 100, -50);
  const proj = useProjectStore.getState().project;
  const torso = proj.nodes.find((n) => n.id === 'b-torso');
  const head  = proj.nodes.find((n) => n.id === 'b-head');
  assert(nearlyEq(torso.transform.pivotX, 600), `Test 1: torso pivotX 500→600 (got ${torso.transform.pivotX})`);
  assert(nearlyEq(torso.transform.pivotY, 750), `Test 1: torso pivotY 800→750 (got ${torso.transform.pivotY})`);
  assert(nearlyEq(head.transform.pivotX, 600), `Test 1: head descendant pivotX 500→600 (got ${head.transform.pivotX})`);
  assert(nearlyEq(head.transform.pivotY, 350), `Test 1: head descendant pivotY 400→350 (got ${head.transform.pivotY})`);
  const gv1 = useProjectStore.getState().versionControl.geometryVersion;
  assert(gv1 === gv0 + 1, `Test 1: geometryVersion bumped (${gv0}→${gv1})`);
}

// ── Test 2: pose untouched on every bone ──
{
  setupChain();
  // Pre-set head's pose rotation to verify it's preserved across the bake.
  useProjectStore.setState((s) => {
    const head = s.project.nodes.find((n) => n.id === 'b-head');
    if (head) head.pose.rotation = 30;
    return s;
  });
  useProjectStore.getState().shiftBonePivot('b-torso', 100, 0);
  const proj = useProjectStore.getState().project;
  const torso = proj.nodes.find((n) => n.id === 'b-torso');
  const head  = proj.nodes.find((n) => n.id === 'b-head');
  assert(torso.pose.rotation === 0, `Test 2: torso pose unchanged (got ${torso.pose.rotation})`);
  assert(head.pose.rotation === 30, `Test 2: head pose preserved across pivot shift (got ${head.pose.rotation})`);
}

// ── Test 3: non-bone descendants ignored (no pivot mutation) ──
{
  setupChain();
  useProjectStore.getState().shiftBonePivot('b-torso', 100, 0);
  const spacer = useProjectStore.getState().project.nodes.find((n) => n.id === 'g-spacer');
  assert(spacer.transform.pivotX === 0,
    `Test 3: non-bone spacer pivotX untouched (got ${spacer.transform.pivotX})`);
}

// ── Test 4: zero-delta is a no-op (no version bump) ──
{
  setupChain();
  const gv0 = useProjectStore.getState().versionControl.geometryVersion;
  useProjectStore.getState().shiftBonePivot('b-torso', 0, 0);
  const gv1 = useProjectStore.getState().versionControl.geometryVersion;
  assert(gv0 === gv1, `Test 4: zero-delta no version bump (${gv0} vs ${gv1})`);
}

// ── Test 5: non-bone target node is a no-op ──
{
  setupChain();
  const gv0 = useProjectStore.getState().versionControl.geometryVersion;
  useProjectStore.getState().shiftBonePivot('p-face', 100, 0);
  const gv1 = useProjectStore.getState().versionControl.geometryVersion;
  assert(gv0 === gv1, 'Test 5: shiftBonePivot on a part node is a no-op');
}

// ── Test 6: shifting a leaf bone only moves the leaf ──
{
  setupChain();
  useProjectStore.getState().shiftBonePivot('b-head', 50, 0);
  const proj = useProjectStore.getState().project;
  const torso = proj.nodes.find((n) => n.id === 'b-torso');
  const head  = proj.nodes.find((n) => n.id === 'b-head');
  assert(torso.transform.pivotX === 500, `Test 6: torso untouched (got ${torso.transform.pivotX})`);
  assert(head.transform.pivotX === 550,  `Test 6: head pivot shifted alone (got ${head.transform.pivotX})`);
}

console.log(`\narmatureEditMode: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
