# Audit: Pose Read/Write Canonicalisation (Phase 8) — Data-Shape Integrity

**Commit:** `b58b505` (master, 2026-05-11)
**Plan:** `docs/plans/POSE_WRITE_CANONICALISATION_PLAN.md`
**Auditor:** Claude Opus 4.7 (1M context)
**Scope:** Does pose data survive every cycle of write → save → load → migrate
→ read without corruption, regardless of starting shape (v17/v18 flat or v19+
channels)?

## Summary

Phase 8 closes the SkeletonOverlay / animationEngine / paramValuesStore
writer–reader gap correctly. **The plan's writer table is complete.** But the
plan's reader audit missed three critical reader sites that were added or
overlooked, plus one writer site (rnaPath) that was never enumerated:

| Severity | Count |
|----------|-------|
| HIGH     | 3     |
| MED      | 3     |
| LOW      | 2     |
| **TOTAL**| **8** |

Two of the HIGH gaps (D-1, D-2) are render-path regressions on v19 bones in
the depgraph kernel that bypass `getBonePose`. The third (D-3) is a corrupt-
state lock-in: any bone that ever had `pose.{flat-fields}` co-existing with
`pose.channels` (e.g. via Phase 4 driver code today) will be PERMANENTLY
skipped by the v19 migration's `!flatPose.channels` guard, leaving the user's
flat-shape data forever unreadable through `getBonePose`.

The "no observable user impact today" hedge that the original G-2 plan made,
and that Phase 8 explicitly called out as wrong, is repeated by Phase 8 itself
for the depgraph + driver paths that didn't yet exist when the writer table
was drafted.

---

## Gap Table

### D-1: HIGH — `bonePostChain.resolveBoneWorldFromCtx` reads identity for v19 bones

**File:** `src/anim/depgraph/kernels/bonePostChain.js:122`
```js
const pose = composed ? composedTransformToBonePose(bone, composed) : (bone.pose ?? null);
const r = pose?.rotation ?? 0;
const px = pose?.x ?? 0;
// ...
```

**Problem:** When `composed` is null (the common case — depgraph fallback
used for partial graphs / tests / bones with no constraints), the code reads
`bone.pose ?? null` and then `pose?.rotation`. For a v19 channels-shape bone,
`bone.pose = { channels: {...} }` is truthy → `pose.rotation === undefined` →
fallthrough to `?? 0` → bone renders at identity, dropping every pose delta.

**Repro (verified live):**
```
World matrix for v19 bone via depgraph: m[0]=1.0000 (expected ≈cos(0.7)=0.7648)
```

**Why missed:** The plan's reader table (POSE_WRITE_CANONICALISATION_PLAN.md
§"Readers to consolidate") does not include `bonePostChain.js`. The plan
ships fixes for `transforms.js:180`, `boneOverlayMatrix.js`, and
`animationEngine.js`, but `bonePostChain.js` is the depgraph kernel — a
parallel render path that wasn't on the writer's radar.

**Severity:** HIGH. This is the EXACT same render regression the plan was
written to fix. The CanvasViewport has been wired through the depgraph since
Phase 0.D.0 (commit `c8f86f3`); v19 schema is registered today. The moment
`CURRENT_SCHEMA_VERSION` reaches 19, every existing project's pose data
silently evaporates in the depgraph render path.

**Fix:** Replace `(bone.pose ?? null)` with `getBonePose(bone) ?? null`. The
helper handles both shapes and returns the same flat contract that
`composedTransformToBonePose` produces.

---

### D-2: HIGH — `transformCompose.overlayTransform` leaks stale flat fields onto channels envelope

**File:** `src/anim/depgraph/kernels/transformCompose.js:138-148`
```js
return {
  ...node,
  pose: {
    ...(node.pose ?? {}),                          // LEAK: spreads channels envelope
    rotation: t.rotation,
    x:        t.x - pivotX,
    y:        t.y - pivotY,
    scaleX:   t.scaleX,
    scaleY:   t.scaleY,
  },
};
```

**Problem:** For a v19 channels-shape bone, `node.pose = { channels: {...} }`.
Spread produces `pose: { channels: {...}, rotation: ..., x: ..., y: ..., scaleX, scaleY }`
— stale flat-shape siblings co-existing with the channels envelope. Then
`getBonePose` (called by every downstream consumer including
`constraints.js:effectiveTransform`) sees `channels` truthy and returns
`channels[node.id]` — the STALE PRE-COMPOSE pose. **The depgraph's composed
transform values are silently dropped.**

**Repro (verified live):**
```
Synth pose keys: [ 'channels', 'rotation', 'x', 'y', 'scaleX', 'scaleY' ]
getBonePose on synth: rotation=0.7, x=25
Expected composed: rotation=1.0, x=50
BROKEN: composed values DROPPED, returns stale channels[node.id]
```

**Why missed:** `overlayTransform` is internal to `transformCompose.js`; the
plan's reader/writer tables don't traverse depgraph kernels.

**Severity:** HIGH. The synth node is fed back into `evaluateConstraints` via
`makeProjectView` (line 101-114) so any constraint that targets a v19 bone
reads STALE pose, not the composed result. Multi-bone constraint chains
(`copy_location` of a parent bone, IK chain reads, etc.) silently compose
against pre-compose pose for v19 bones.

**Fix:** Build the `pose` slot WITHOUT spreading `node.pose`. Use the flat-
shape contract directly:
```js
pose: { rotation: t.rotation, x: t.x - pivotX, y: t.y - pivotY,
        scaleX: t.scaleX, scaleY: t.scaleY },
```
The synth node only needs the composed pose; preserving the channels
envelope on a throwaway shallow-clone is meaningless and actively harmful.
(Compare `applyOverrideToNode` at `animationEngine.js:327` which does this
correctly via `{ ...(getBonePose(node) ?? IDENTITY_POSE) }`.)

---

### D-3: HIGH — Corrupt mixed pose locks v19 migration into NEVER channelising the bone

**File:** `src/store/projectMigrations.js:649`
```js
if (flatPose && typeof flatPose === 'object' && !flatPose.channels) {
  n.pose = { channels: { [n.id]: flatPose } };
}
```

**Problem:** The guard `!flatPose.channels` is intended to make the migration
idempotent. But it ALSO means: if a bone ever has BOTH flat fields AND a
`channels` sub-object on the same `pose` slot — which the rnaPath setter
(D-9) and `transformCompose` (D-2) both produce TODAY — the v19 migration
silently skips that bone forever. The user-authored flat-shape pose values
remain unwrapped, sitting next to a channels envelope that may contain
unrelated entries (foreign bones, stale entries, drivers' wrong-keyed
writes).

**Repro (verified live):**
```
Before v19 migration: {"rotation":0.5,"x":10,"y":0,"scaleX":1,"scaleY":1,
                       "channels":{"foreign":{"rotation":9.9,...}}}
After v19+ migration:  {"rotation":0.5,"x":10,"y":0,"scaleX":1,"scaleY":1,
                       "channels":{"foreign":{"rotation":9.9,...}}}
                       ← UNCHANGED
getBonePose returns: 9.9 (foreign channel), NOT user's 0.5
```

**Why missed:** Plan §"Migration interactions" §6 claims `!flatPose.channels`
"guards correctly." It does for clean projects, but it doesn't reconcile mixed
state. Combined with D-2 + D-9, mixed state is *produced today* by the
existing codebase before the user upgrades to a build with v19 enabled.

**Severity:** HIGH (data loss). Every v17/v18 project that ever:
- Touched a bone via the depgraph constraint compose (D-2), OR
- Targeted a bone via FCurve/Driver `objects[id].pose.rotation` (D-9)

…will arrive at v19 with a poisoned `pose` slot that the migration silently
declines to fix. Any `getBonePose(node)` read after migration returns
identity-pose (or stale foreign data). User loses every pose channel that
went through those paths.

**Fix (one of):**
- (A) **Strict reconciler**: when `flatPose.channels` AND any flat field both
  exist, log a `migration` event, prefer the flat data, and overwrite the
  channels envelope: `n.pose = { channels: { [n.id]: { rotation, x, y, scaleX, scaleY } } }`.
- (B) **Block at the source**: fix D-2 and D-9 so corrupt state CAN'T be
  produced, then leave the migration as-is. (Preferred — reactive cleanup
  hides bugs.)

---

### D-4: MED — `rnaPath.evaluateRnaPath` / `setRnaPath` bypass channels-shape resolution

**File:** `src/anim/rnaPath.js:159-176` (read), `:200-227` (write)

**Problem:** RNA paths like `objects['b1'].pose.rotation` are documented as
supported (lines 16-17). The walker treats `pose.rotation` as a generic
`cur[seg.value]` field access. For v19 bones, `cur = node.pose` resolves to
`{ channels: {...} }`; then `cur.rotation === undefined` → driver/FCurve READ
returns nothing; SETTER writes a stale `pose.rotation` SIBLING next to
`pose.channels`, creating the exact corrupt state that D-3 then locks in.

**Repro (verified live):**
```
evaluateRnaPath('objects.b1.pose.rotation') = undefined
                                              (driver reads NOTHING)
setRnaPath wrote: true
After write, pose envelope: {"channels":{"b1":{"rotation":0.7,...}}, "rotation":1.5}
getBonePose after rnaPath write: 0.7  ← rnaPath write IGNORED by reader
```

**Why missed:** Phase 8's plan didn't survey `rnaPath.js`. The doc in
`rnaPath.js:25` already names the future v19+ path
(`objects['__armature__'].pose.channels['<role>'].rotation`) so the gap was
known but not actioned.

**Severity:** MED today (drivers + FCurves are mostly Phase 5 scaffold,
limited end-user surface), HIGH the moment a real driver writes
`pose.rotation` on a v19 bone — both broken read AND data corruption.

**Fix:** Add a special-case in the walker: when a path resolves to
`<bone-node>.pose.<channel-field>` and the bone has channels-shape, redirect
through `node.pose.channels[node.id].<field>`. Alternatively, change the
driver/FCurve API surface to use the explicit
`objects['__armature__'].pose.channels['<role>'].rotation` path that's
already documented.

---

### D-5: MED — `ensureBonePoseChannel` doesn't clean stale leftover channels

**File:** `src/store/objectDataAccess.js:390-403`

**Problem:** When `node.pose.channels` exists but `channels[node.id]` is
missing, the helper creates a new entry for `node.id` — BUT leaves any
foreign entries in `channels` untouched. A malformed save with
`channels: { 'old-id': {...} }` after a node id rename / deferred copy
operation produces a permanent garbage entry that:
- Inflates project file size on every save.
- Will silently pick up the wrong channel if `node.id` ever matches an old
  foreign key (id collision).
- Confuses Phase 1C-flip's per-armature multi-channel code which has no way
  to distinguish "real channel for some bone" from "leftover from an id
  rename."

**Repro (verified live):**
```
ensureBonePoseChannel({pose: {channels: {'foreign': {...}}}}) creates b3 entry,
leaves 'foreign' in place: {"channels":{"foreign":{...},"b3":{...}}}
```

**Severity:** MED. Doesn't cause user-visible breakage today (1:1 bone-Object
contract per Phase 8 plan §"Out of scope"). Will surface during Phase 1C-flip
if not addressed before the multi-channel collapse ships.

**Fix:** When the helper creates a new channel entry on `ensureBonePoseChannel`,
either (a) leave it alone (current) AND document the contract that ONLY
migrations create channels-shape, OR (b) actively prune all keys that don't
match `node.id` since today's contract IS 1:1.

The plan explicitly took position (a), so this is a documentation gap rather
than a code bug. Add a JSDoc warning to `ensureBonePoseChannel` that stale
foreign channels are tolerated and accumulate; reference the Phase 1C-flip
plan as the cleanup point.

---

### D-6: MED — `getBonePose`'s identity-pose default conflates "no pose authored" with "rest pose"

**File:** `src/store/objectDataAccess.js:340-342`
```js
if (!p || typeof p !== 'object') {
  return { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
}
```

**Problem:** When `node.pose.channels` exists but `channels[node.id]` is
missing, the function returns identity-pose. From the renderer's perspective
(`computeWorldMatrices`, `boneOverlayMatrix`) this is correct — render at
rest. From the constraint/FCurve evaluator's perspective, it's ambiguous: is
the bone genuinely posed at identity (a deliberate authored value), or is
there NO authored channel?

A future driver evaluator that inspects "is this bone keyed?" would read
identity and conclude "yes, keyed at rest." That's wrong if the user's
intent was "this bone has no channel; defer to constraints."

**Severity:** MED. Doesn't bite today (no Phase-5 driver path inspects pose
authorship). Will bite the moment NLA tracks or weight blending lands
(Blender's PoseChannel has a `bone_already_warned` flag for this exact
distinction).

**Fix:** Add a sister helper `hasBonePose(node) → boolean` that distinguishes
"channel exists" from "channel missing." Keep `getBonePose` returning
identity (right user-facing default) but route the constraints/driver
evaluator through `hasBonePose` first when intent matters.

---

### D-7: LOW — `object/mirror.js:121-123` writes flat directly (correctly excluded by `isBoneGroup` filter)

**File:** `src/v3/operators/object/mirror.js:120-123`

**Status:** The plan calls this out of scope correctly. Verified: line 79
`if (isBoneGroup(node)) { skippedBones++; continue; }` filters bones out of
`eligibleIds` before the pose-flip block runs. So `target.pose` is only ever
non-bone group data here — which can't be channels-shape per the v19
migration scope.

**Severity:** LOW. The block is dead code on bones today (filtered out
upstream). But the comment on line 117-119 says "If it does (legacy bone
groups still carry it), flip the matching pose axis" — the comment is wrong
post-Phase 8. A future reader will think this code path can hit bones; it
can't.

**Fix:** Delete the `target.pose` block (it's dead code per the
`isBoneGroup` filter), OR update the comment to say "non-bone group nodes
that legacy code may have left a pose slot on; bones are filtered earlier."

---

### D-8: LOW — Test fixture `test_pose_write_v19_shape.mjs` doesn't reflect real v18→v19 output

**File:** `scripts/test/test_pose_write_v19_shape.mjs:48-50`
```js
{
  id: 'b-channels', type: 'group', boneRole: 'leftElbow', parent: null,
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 200 },
  pose: { channels: { 'b-channels': { rotation: 0.7, ... } } },
},
```

**Problem:** Real v19 migration output ALSO synthesises a sibling
`{ id: '<rootId>__armature', type: 'armatureData', bones: [...] }` node and
sets `dataId` on the root bone (lines 633-639 of `projectMigrations.js`).
The fixture has neither, so:
- The fixture isn't reachable via `migrateProject(v18-fixture)` — it tests
  a hand-crafted shape.
- Any future helper that reads the v19 armature via `getArmature(project)`
  will fail on the fixture even though `getBonePose` succeeds.

**Severity:** LOW. The test passes today and exercises the relevant writer/
reader paths. But it's **not** an end-to-end test of the migration → save →
load cycle as the plan claims (§"Tests"). It's a unit test on a synthetic
shape.

**Fix:** Add a sister test that:
1. Builds a v18 fixture (flat pose, no `__armature__` node).
2. Runs `migrateProject` to produce the v19 shape.
3. Round-trips through JSON.stringify/parse.
4. Calls every consolidated writer.
5. Asserts the channels envelope AND `armatureData` sibling both survive.

This catches the real save/load/migrate cycle the plan claims to test.

---

## Verification Methodology

Each gap was reproduced by running standalone Node scripts against the
shipped helpers (`scripts/test/_audit_phase8*.mjs`, deleted post-audit). For
D-1 the test exercised `bonePostChain.resolveBoneWorldFromCtx` directly with
a v19 bone; for D-2 it built the synth via the same code path
`overlayTransform` uses; for D-3 it ran `migrateProject` on a corrupt
fixture; for D-4 it exercised `evaluateRnaPath` + `setRnaPath` directly.

All eight gaps are **read-and-verified**, not speculation.

---

## Recommendations (priority order)

1. **D-1** (HIGH) — One-line fix, ship immediately. `bonePostChain.js:122`
   replace `(bone.pose ?? null)` with `getBonePose(bone) ?? null`.
2. **D-2** (HIGH) — Six-line fix. Drop the `...(node.pose ?? {})` spread in
   `transformCompose.js:140-148`.
3. **D-9** (the rnaPath gap, listed as D-4 above) — MED today, HIGH on first
   real driver use. Either teach `rnaPath` about pose-channels resolution
   or migrate driver/FCurve targets to the explicit `__armature__` path.
4. **D-3** (HIGH-data-loss-risk) — After D-2 and D-9 are fixed, audit
   existing user projects for poisoned `pose` slots before flipping
   `CURRENT_SCHEMA_VERSION` to 19. Either harden the migration (Fix A) or
   confirm corrupt state is now unreachable (Fix B).
5. **D-5/D-6/D-8** — Documentation + small follow-ups for Phase 1C-flip's
   precondition list.
6. **D-7** — Cosmetic; clean up at next touch.

The two HIGH-render gaps (D-1, D-2) materially undermine the plan's stated
intent. Recommend they ship as a `b58b505` follow-up commit before the
plan's "all 187 test files green" claim is honoured at the next schema flip.
