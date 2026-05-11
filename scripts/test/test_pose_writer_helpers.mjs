// Pose Read/Write Canonicalisation Plan — helper unit tests.
//
// Covers `ensureBonePoseChannel` / `setBonePoseField` / `setBonePose`
// in `src/store/objectDataAccess.js`. Verifies:
//   - flat-shape (v17/v18) writes go to `node.pose.{field}` directly
//   - channels-shape (v19+) writes go to `node.pose.channels[node.id].{field}`
//   - missing pose initializes to flat shape (the safer default —
//     channels-shape only created by migrations)
//   - non-bone nodes are silent no-ops (return null from
//     ensureBonePoseChannel)
//   - unknown field names rejected (strict guard)
//   - non-numeric values rejected
//   - partial writes preserve untouched fields
//   - getBonePose reads identical values back through both shapes
//
// Run: node scripts/test/test_pose_writer_helpers.mjs

import {
  isBoneGroup,
  ensureBonePoseChannel,
  setBonePoseField,
  setBonePose,
  getBonePose,
} from '../../src/store/objectDataAccess.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function flatBone(id = 'bone-1', overrides = {}) {
  return {
    id, type: 'group', name: id, parent: null,
    boneRole: 'leftElbow',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 30 },
    pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, ...overrides },
  };
}

function channelsBone(id = 'bone-1', channelOverrides = {}) {
  return {
    id, type: 'group', name: id, parent: null,
    boneRole: 'leftElbow',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 30 },
    pose: {
      channels: {
        [id]: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, ...channelOverrides },
      },
    },
  };
}

function poseLessBone(id = 'bone-1') {
  return {
    id, type: 'group', name: id, parent: null,
    boneRole: 'leftElbow',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 30 },
    // no `pose` slot at all — covers v19 migration's "leaves untouched
    // when no flat pose pre-migration" branch
  };
}

function nonBone(id = 'p1') {
  return {
    id, type: 'part', name: id, parent: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  };
}

// ── ensureBonePoseChannel ────────────────────────────────────────────────────

// 1. Flat-shape bone: returns node.pose itself.
{
  const b = flatBone('b1', { rotation: 1.5, x: 10 });
  const ch = ensureBonePoseChannel(b);
  assert(ch === b.pose, '1: flat-shape returns node.pose by reference');
  assertEq(ch.rotation, 1.5, '1a: flat-shape rotation preserved');
  assertEq(ch.x, 10, '1b: flat-shape x preserved');
}

// 2. Channels-shape bone: returns channels[id].
{
  const b = channelsBone('b2', { rotation: 0.7, scaleX: 1.5 });
  const ch = ensureBonePoseChannel(b);
  assert(ch === b.pose.channels['b2'], '2: channels-shape returns channels[id] by reference');
  assertEq(ch.rotation, 0.7, '2a: channels-shape rotation preserved');
  assertEq(ch.scaleX, 1.5, '2b: channels-shape scaleX preserved');
  assert(b.pose.channels !== undefined, '2c: channels envelope intact');
}

// 3. Pose-less bone: initializes flat shape (safer default).
{
  const b = poseLessBone('b3');
  const ch = ensureBonePoseChannel(b);
  assert(ch === b.pose, '3: pose-less initialises flat → returns node.pose');
  assert(b.pose.channels === undefined, '3a: NO channels envelope created');
  assertEq(b.pose, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '3b: identity flat pose');
}

// 4. Non-bone: returns null, no mutation.
{
  const p = nonBone('p4');
  const ch = ensureBonePoseChannel(p);
  assert(ch === null, '4: non-bone returns null');
  assert(p.pose === undefined, '4a: non-bone untouched');
}

// 5. Channels-shape with missing inner entry: creates it.
{
  const b = {
    id: 'b5', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: { channels: {} },  // envelope present, inner missing
  };
  const ch = ensureBonePoseChannel(b);
  assert(ch === b.pose.channels['b5'], '5: missing channel entry created');
  assertEq(ch, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '5a: identity-init');
}

// 6. Channels-shape with partially-defined channel: fills missing fields.
{
  const b = {
    id: 'b6', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: { channels: { 'b6': { rotation: 0.5 } } },  // only rotation present
  };
  const ch = ensureBonePoseChannel(b);
  assertEq(ch.rotation, 0.5, '6: existing rotation preserved');
  assertEq(ch.x, 0, '6a: missing x defaulted');
  assertEq(ch.scaleX, 1, '6b: missing scaleX defaulted to 1');
}

// 7. Flat-shape with partially-defined pose: fills missing fields.
{
  const b = {
    id: 'b7', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: { rotation: 1.2 },  // only rotation, missing x/y/scaleX/scaleY
  };
  const ch = ensureBonePoseChannel(b);
  assertEq(ch.rotation, 1.2, '7: existing rotation preserved');
  assertEq(ch.scaleX, 1, '7a: missing scaleX defaulted to 1');
  assertEq(ch.x, 0, '7b: missing x defaulted to 0');
}

// ── setBonePoseField ─────────────────────────────────────────────────────────

// 8. Flat-shape: write goes to node.pose.{field}.
{
  const b = flatBone('b8');
  setBonePoseField(b, 'rotation', 0.42);
  assertEq(b.pose.rotation, 0.42, '8: flat write rotation');
  assertEq(b.pose.x, 0, '8a: flat write doesn\'t touch x');
  assertEq(b.pose.scaleY, 1, '8b: flat write doesn\'t touch scaleY');
}

// 9. Channels-shape: write goes to channels[id].{field}.
{
  const b = channelsBone('b9');
  setBonePoseField(b, 'x', 25);
  assertEq(b.pose.channels['b9'].x, 25, '9: channels write x');
  assert(b.pose.channels !== undefined, '9a: channels envelope intact');
  assertEq(b.pose.channels['b9'].rotation, 0, '9b: untouched fields preserved');
}

// 10. Pose-less bone: write initializes + sets.
{
  const b = poseLessBone('b10');
  setBonePoseField(b, 'rotation', 1.0);
  assertEq(b.pose.rotation, 1.0, '10: pose-less init + write');
  assertEq(b.pose.scaleX, 1, '10a: pose-less init has identity siblings');
}

// 11. Non-bone: no-op.
{
  const p = nonBone('p11');
  setBonePoseField(p, 'rotation', 5);
  assert(p.pose === undefined, '11: non-bone untouched');
}

// 12. Unknown field name: rejected (strict guard).
{
  const b = flatBone('b12');
  setBonePoseField(b, 'rot', 99);          // typo
  setBonePoseField(b, 'translateX', 99);   // wrong name
  setBonePoseField(b, '__proto__', 99);    // prototype pollution attempt
  assertEq(b.pose.rotation, 0, '12: typo rejected — rotation untouched');
  assert(b.pose.rot === undefined, '12a: typo field name not added');
  assert(b.pose.translateX === undefined, '12b: wrong-name field not added');
}

// 13. Non-numeric value: rejected.
{
  const b = flatBone('b13');
  setBonePoseField(b, 'rotation', 'fast');
  setBonePoseField(b, 'rotation', null);
  setBonePoseField(b, 'rotation', { angle: 1 });
  assertEq(b.pose.rotation, 0, '13: non-numeric values rejected');
}

// ── setBonePose ──────────────────────────────────────────────────────────────

// 14. Flat-shape partial write: preserves siblings.
{
  const b = flatBone('b14', { rotation: 0.5, x: 10, y: 5, scaleX: 1.2, scaleY: 0.9 });
  setBonePose(b, { x: 100, y: 50 });
  assertEq(b.pose.x, 100, '14: flat partial write x');
  assertEq(b.pose.y, 50, '14a: flat partial write y');
  assertEq(b.pose.rotation, 0.5, '14b: rotation preserved');
  assertEq(b.pose.scaleX, 1.2, '14c: scaleX preserved');
}

// 15. Channels-shape partial write: preserves siblings.
{
  const b = channelsBone('b15', { rotation: 0.5, scaleX: 1.2 });
  setBonePose(b, { x: 100, y: 50 });
  assertEq(b.pose.channels['b15'].x, 100, '15: channels partial write x');
  assertEq(b.pose.channels['b15'].rotation, 0.5, '15a: channels rotation preserved');
  assertEq(b.pose.channels['b15'].scaleX, 1.2, '15b: channels scaleX preserved');
}

// 16. Atomic full write: matches identity.
{
  const b = flatBone('b16', { rotation: 5, x: 5 });
  setBonePose(b, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 });
  assertEq(b.pose, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '16: identity write through setBonePose');
}

// 17. Empty/null partial: no-op (no field crash).
{
  const b = flatBone('b17', { rotation: 7 });
  setBonePose(b, {});
  setBonePose(b, null);
  setBonePose(b, undefined);
  assertEq(b.pose.rotation, 7, '17: empty/null partial preserves state');
}

// 18. Non-bone: no-op.
{
  const p = nonBone('p18');
  setBonePose(p, { rotation: 5, x: 10 });
  assert(p.pose === undefined, '18: non-bone untouched by setBonePose');
}

// ── getBonePose round-trip via setBonePose ───────────────────────────────────

// 19. Round-trip flat: read after write returns the same.
{
  const b = flatBone('b19');
  setBonePose(b, { rotation: 1.5, x: 30, y: -20, scaleX: 1.5, scaleY: 0.8 });
  assertEq(
    getBonePose(b),
    { rotation: 1.5, x: 30, y: -20, scaleX: 1.5, scaleY: 0.8 },
    '19: flat round-trip',
  );
}

// 20. Round-trip channels: read after write returns the same, channels envelope preserved.
{
  const b = channelsBone('b20');
  setBonePose(b, { rotation: 1.5, x: 30, y: -20, scaleX: 1.5, scaleY: 0.8 });
  assertEq(
    getBonePose(b),
    { rotation: 1.5, x: 30, y: -20, scaleX: 1.5, scaleY: 0.8 },
    '20: channels round-trip',
  );
  assert(b.pose.channels !== undefined, '20a: channels envelope still present');
  assert(b.pose.rotation === undefined, '20b: flat-shape did NOT leak onto envelope');
}

// 21. Cross-shape consistency: two bones, same write, getBonePose returns
//     identical values regardless of underlying shape.
{
  const flat = flatBone('flat-21');
  const ch = channelsBone('ch-21');
  setBonePose(flat, { rotation: 0.42, x: 7 });
  setBonePose(ch, { rotation: 0.42, x: 7 });
  assertEq(getBonePose(flat), getBonePose(ch), '21: shape-agnostic round-trip equivalence');
}

// 22. Repeated writes on channels-shape don't accidentally drop the channels
//     envelope (this is the actual bug the helper exists to prevent).
{
  const b = channelsBone('b22');
  setBonePose(b, { rotation: 1 });
  setBonePoseField(b, 'x', 50);
  setBonePoseField(b, 'rotation', 2);
  assert(b.pose.channels !== undefined, '22: channels envelope survives repeated writes');
  assert(b.pose.channels['b22'].rotation === 2, '22a: latest rotation persisted');
  assert(b.pose.channels['b22'].x === 50, '22b: latest x persisted');
  assert(b.pose.rotation === undefined, '22c: NO flat-shape leak onto envelope');
}

// ── isBoneGroup contract sanity ──────────────────────────────────────────────

// 23. Helpers correctly identify all fixture types.
{
  assert(isBoneGroup(flatBone('s1')), '23: flat bone identified');
  assert(isBoneGroup(channelsBone('s2')), '23a: channels bone identified');
  assert(isBoneGroup(poseLessBone('s3')), '23b: pose-less bone identified');
  assert(!isBoneGroup(nonBone('s4')), '23c: non-bone NOT identified');
}

// ── Audit-fix G-4: empty-write guard ─────────────────────────────────────────

// 24. setBonePose(poseLessBone, {}) does NOT mutate the bone (post-fix).
{
  const b = poseLessBone('b24');
  setBonePose(b, {});
  assert(b.pose === undefined, '24: empty {} write does NOT initialise pose-less bone');
  setBonePose(b, null);
  assert(b.pose === undefined, '24a: null write does NOT initialise');
  setBonePose(b, undefined);
  assert(b.pose === undefined, '24b: undefined write does NOT initialise');
  setBonePose(b, { foo: 5, bar: 'baz' });  // junk fields, no pose channels
  assert(b.pose === undefined, '24c: junk-field write does NOT initialise');
}

// 25. setBonePose with only one valid field DOES initialise + write that field.
{
  const b = poseLessBone('b25');
  setBonePose(b, { rotation: 0.5 });
  assert(b.pose !== undefined, '25: single-field write initialises pose');
  assertEq(b.pose.rotation, 0.5, '25a: rotation written');
  assertEq(b.pose.x, 0, '25b: x defaulted to 0');
}

// ── Audit-fix G-5/G-6: array-shape typeof guards ────────────────────────────

// 26. Malformed `node.pose = []` (array): ensureBonePoseChannel re-inits to flat.
{
  const b = {
    id: 'b26', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: [],  // malformed
  };
  const ch = ensureBonePoseChannel(b);
  assert(!Array.isArray(b.pose), '26: array-shape pose replaced with object');
  assertEq(b.pose, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '26a: identity init');
  assert(ch === b.pose, '26b: returns the new flat pose by reference');
}

// 27. Malformed `pose.channels = []` (array): treated as not-channels-shape, fills flat.
{
  const b = {
    id: 'b27', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: { channels: [], rotation: 1 },  // malformed channels + flat field
  };
  const ch = ensureBonePoseChannel(b);
  // Falls through to the flat-shape branch since channels is not a real object map.
  assertEq(ch.rotation, 1, '27: existing flat rotation preserved');
}

// 28. Array on channels[id]: re-creates the inner channel.
{
  const b = {
    id: 'b28', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: { channels: { 'b28': [] } },  // malformed inner
  };
  const ch = ensureBonePoseChannel(b);
  assert(!Array.isArray(b.pose.channels['b28']), '28: array channel replaced with object');
  assertEq(ch, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '28a: identity init');
}

// 29. node.pose = null: re-inits to flat.
{
  const b = {
    id: 'b29', type: 'group', boneRole: 'leftElbow',
    transform: { pivotX: 0, pivotY: 0 },
    pose: null,
  };
  const ch = ensureBonePoseChannel(b);
  assert(b.pose !== null, '29: null pose replaced');
  assertEq(b.pose, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }, '29a: identity init');
}

// 30. partialPose array → silent no-op.
{
  const b = flatBone('b30', { rotation: 5 });
  setBonePose(b, [1, 2, 3]);
  assertEq(b.pose.rotation, 5, '30: array partialPose rejected');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
