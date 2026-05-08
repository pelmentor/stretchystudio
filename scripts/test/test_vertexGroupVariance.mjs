// Tests for src/lib/vertexGroupVariance.js — predicate that decides
// whether a part's mesh.boneWeights are rigid-intent (all-1.0 to the
// structural parent bone) and can therefore be stripped for cmo3/moc3
// export without changing wire format.
//
// Run: node scripts/test/test_vertexGroupVariance.mjs

import {
  isRigidVertexGroup,
  nearestBoneAncestorId,
} from '../../src/lib/vertexGroupVariance.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── isRigidVertexGroup ─────────────────────────────────────────────────

// Test 1: clean rigid case — all 1.0, jointBone matches structural parent
{
  const r = isRigidVertexGroup([1, 1, 1, 1], 4, 'leftArm', 'leftArm');
  assert(r === true, 'Test 1: all-1.0 + bone match → true');
}

// Test 2: empty array → false
{
  const r = isRigidVertexGroup([], 0, 'leftArm', 'leftArm');
  assert(r === false, 'Test 2: empty array → false');
}

// Test 3: null → false
{
  const r = isRigidVertexGroup(null, 4, 'leftArm', 'leftArm');
  assert(r === false, 'Test 3: null weights → false');
}

// Test 4: undefined → false
{
  const r = isRigidVertexGroup(undefined, 4, 'leftArm', 'leftArm');
  assert(r === false, 'Test 4: undefined weights → false');
}

// Test 5: any weight not ≈ 1.0 → false
{
  const r = isRigidVertexGroup([1, 1, 0.5, 1], 4, 'leftArm', 'leftArm');
  assert(r === false, 'Test 5: mixed weights → false');
}

// Test 6: all-0 → false (different intent than rigid)
{
  const r = isRigidVertexGroup([0, 0, 0], 3, 'leftArm', 'leftArm');
  assert(r === false, 'Test 6: all-zero → false (not rigid)');
}

// Test 7: float32 round-trip drift within epsilon → true
{
  const r = isRigidVertexGroup(
    [0.99999994, 1.0000001, 1, 0.999999984], 4, 'leftArm', 'leftArm',
  );
  assert(r === true, 'Test 7: small float drift within eps=1e-6 → true');
}

// Test 8: drift past 1e-6 → false
{
  const r = isRigidVertexGroup([1, 1, 0.99999, 1], 4, 'leftArm', 'leftArm');
  assert(r === false, 'Test 8: drift > eps → false');
}

// Test 9: length mismatch → false (defensive)
{
  const r = isRigidVertexGroup([1, 1, 1], 4, 'leftArm', 'leftArm');
  assert(r === false, 'Test 9: length mismatch → false');
}

// Test 10: vertCount=null disables length check
{
  const r = isRigidVertexGroup([1, 1, 1, 1], null, 'leftArm', 'leftArm');
  assert(r === true, 'Test 10: vertCount=null skips length check');
}

// Test 11: jointBoneId !== nearestBoneAncestorId → false (BONE-ROUTING INTENT)
{
  // The hand-detaches-from-elbow corner case. computeSkinWeights produced
  // all-1.0 because every vert sat past the elbow blend zone, but the
  // weights encode "follow leftElbow specifically, not whatever leftArm
  // walks up to." Adapter must NOT strip these.
  const r = isRigidVertexGroup([1, 1, 1, 1], 4, 'leftElbow', 'leftArm');
  assert(r === false,
    'Test 11: jointBoneId=leftElbow but nearest ancestor=leftArm → false (preserve routing)');
}

// Test 12: jointBoneId set but nearestBoneAncestorId null → false
{
  // Part has jointBoneId but no bone-group ancestor (e.g. the part is at
  // canvas root). Stripping would lose the binding entirely.
  const r = isRigidVertexGroup([1, 1, 1], 3, 'leftArm', null);
  assert(r === false, 'Test 12: jointBoneId set but no bone ancestor → false');
}

// Test 13: jointBoneId null → false
{
  const r = isRigidVertexGroup([1, 1], 2, null, 'leftArm');
  assert(r === false, 'Test 13: jointBoneId null → false');
}

// Test 14: jointBoneId empty string → false
{
  const r = isRigidVertexGroup([1, 1], 2, '', 'leftArm');
  assert(r === false, 'Test 14: jointBoneId empty → false');
}

// Test 15: single-vertex 1.0 → true (degenerate but valid)
{
  const r = isRigidVertexGroup([1], 1, 'leftArm', 'leftArm');
  assert(r === true, 'Test 15: single-vertex rigid → true');
}

// Test 16: not-an-array (typed array) — current spec only accepts Array
{
  const r = isRigidVertexGroup(new Float32Array([1, 1, 1, 1]), 4, 'leftArm', 'leftArm');
  assert(r === false,
    'Test 16: Float32Array → false (Array.isArray contract; caller must convert)');
}

// ── nearestBoneAncestorId ─────────────────────────────────────────────

// Test 17: direct parent is bone group
{
  const isBone = (n) => n?.type === 'group' && !!n?.boneRole;
  const torso = { id: 'torso', type: 'group', boneRole: 'torso', parent: null };
  const part  = { id: 'topwear', type: 'part', parent: 'torso' };
  const byId = new Map([['torso', torso], ['topwear', part]]);
  const r = nearestBoneAncestorId(part, byId, isBone);
  assert(r === 'torso', `Test 17: direct bone parent → 'torso' (got ${r})`);
}

// Test 18: walks past plain (non-bone) groups
{
  const isBone = (n) => n?.type === 'group' && !!n?.boneRole;
  const torso  = { id: 'torso',  type: 'group', boneRole: 'torso', parent: null };
  const folder = { id: 'folder', type: 'group',                    parent: 'torso' };
  const part   = { id: 'p',      type: 'part',                     parent: 'folder' };
  const byId = new Map([['torso', torso], ['folder', folder], ['p', part]]);
  const r = nearestBoneAncestorId(part, byId, isBone);
  assert(r === 'torso', `Test 18: walks past plain group → 'torso' (got ${r})`);
}

// Test 19: no bone ancestor → null
{
  const isBone = (n) => n?.type === 'group' && !!n?.boneRole;
  const root  = { id: 'root', type: 'group', parent: null };
  const part  = { id: 'p',    type: 'part',  parent: 'root' };
  const byId = new Map([['root', root], ['p', part]]);
  const r = nearestBoneAncestorId(part, byId, isBone);
  assert(r === null, `Test 19: no bone ancestor → null (got ${r})`);
}

// Test 20: cycle guard — self-parent doesn't loop forever
{
  const isBone = () => false;
  const part = { id: 'p', type: 'part', parent: 'p' };  // self-parent (malformed)
  const byId = new Map([['p', part]]);
  const r = nearestBoneAncestorId(part, byId, isBone);
  assert(r === null, 'Test 20: self-parent cycle → null (no infinite loop)');
}

// Test 21: nested limb chain — picks the nearest bone, not the root
{
  const isBone = (n) => n?.type === 'group' && !!n?.boneRole;
  const torso    = { id: 'torso',    type: 'group', boneRole: 'torso',    parent: null };
  const leftArm  = { id: 'leftArm',  type: 'group', boneRole: 'leftArm',  parent: 'torso' };
  const handPart = { id: 'hand',     type: 'part',                        parent: 'leftArm' };
  const byId = new Map([['torso', torso], ['leftArm', leftArm], ['hand', handPart]]);
  const r = nearestBoneAncestorId(handPart, byId, isBone);
  assert(r === 'leftArm', `Test 21: nested chain picks NEAREST bone → 'leftArm' (got ${r})`);
}

// Test 22: malformed input → null (defensive)
{
  const r1 = nearestBoneAncestorId(null, new Map(), () => true);
  const r2 = nearestBoneAncestorId({}, new Map(), () => true);
  assert(r1 === null, 'Test 22a: null part → null');
  assert(r2 === null, 'Test 22b: orphan part → null');
}

console.log(`\nvertexGroupVariance: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
