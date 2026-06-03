# Session aggregate — 2026-06-03

Post-compact continuation of [SESSION_AGGREGATE_2026_06_02_03.md](SESSION_AGGREGATE_2026_06_02_03.md). User reported four issues across the session, each closed end-to-end:

1. **bug-05** — face.smile variant fired I-1 invariant
2. **bug-06** — arm physics inert in live preview (hair worked fine)
3. **bug-07** — delete-layer + Ctrl+Z left the layer invisible
4. **rigInitIdentityDiag** — silently printed "0 parts" every Init Rig

Along the way: full systemic undo audit + migration of every `set(produce(...))` thunk in `projectStore.js` to `updateProject`.

## What shipped

### bug-05 — face.smile I-1 false-positive

Symptom: post-Init-Rig, `rigInvariantCheck` logged `I-1 | id=4af6f71ecf91 name=face.smile | part has mesh (183 verts) but modifiers[] is empty or missing → renderer will render at canvas origin`.

Root cause: variants get `visible: false` by design (`variantNormalizer.js` — variant fades back in on `Param<Suffix>`). The entire rig harvest path filters `n.visible !== false` (`buildMeshesForRig` at `exporter.js:823` + 8 other sites), so variants legitimately have empty `modifiers[]` because they're never reached by the rigwarp emitter. The renderer skips them via the same filter — there's no "renders at canvas origin" outcome. I-1's diagnosis was wrong for hidden parts.

Fix `f766162` (Pelmentor): add `if (n.visible === false) continue;` to the per-part loop in `rigInvariantCheck.js`. Invariants check WHAT WILL BE RENDERED. Per RULE-№1 this is a precision improvement, not a silencing crutch.

Latent gap noted (NOT fixed): variant fade rendering at `Param<Suffix>=1` doesn't actually work — runtime depgraph has no opacity keyform path. Tracked separately.

Memory: [[rig-invariant-check-framework-shipped]]

### bug-06 — arm physics inert (TWO commits)

Symptom: `ParamRotation_leftElbow`/`rightElbow` seeded as defaults, Arm Sway physics rule resolving to them, but hands didn't move in live preview. Hair physics worked.

#### First attempt (broke physics globally)

Diagnosis path: `CanvasViewport.jsx:961` called `setMany(updates, { skipBoneMirror: true })`. Depgraph's `kernelTransformCompose` reads `bone.pose.rotation` for skinned bones, NOT `paramValues[ParamRotation_<bone>]`. Skipping the mirror disconnected physics from arm bones. Hair physics worked because `ParamHairFront/Back` aren't bone-mirror — warp deformers read the param directly.

`f766162` (Pelmentor) — "fix": drop `{ skipBoneMirror: true }`. Arms started moving but jittered max↔min every frame; hair physics stopped swaying entirely.

#### Root-cause analysis of the regression

The bone-mirror fan-out path (`paramValuesStore.setMany` without `{skipBoneMirror:true}`) calls `useProjectStore.updateProject(...)`, mutating projectStore per frame. `rigSpecStore.js:265`'s subscriber fires on every project mutation: `selectRigSpec(newProject)` returns a fresh rigSpec object identity (WeakMap memo keys on project identity, so a fresh immer-produced project ref → fresh rigSpec). CanvasViewport's physics block at line 884 checks `physicsRigSpecRef.current !== _rigSpecForPhysics` and recreates `cubismPhysicsKernel` state when the identity changes. Result: every frame, every rule's pendulum velocity resets to rest. Arms saturate at single-step deflection; hair likewise.

#### Proper fix (Blender-driver overlay)

`6e176d8` (Claude) — restore `setMany(realUpdates, { skipBoneMirror: true })`, then inject bone-mirror `{rotation: paramValue}` entries into `poseOverrides` Map at eval setup. The depgraph's `TRANSFORM_COMPOSE` kernel (`transformCompose.js:75`) calls `applyPoseOverrides(ownerRaw, ctx.poseOverrides?.get(ownerId))` and seeds the bone's pose from the override — `bone.pose.rotation` stays untouched, no projectStore mutation, no rigSpec churn, no physics kernel reset. Animation playback wins on the same bone (keyframe is more explicit than physics overlay).

Memory: [[physics-bone-mirror-overlay]]

User confirmed both arms and hair physics now working.

### bug-07 — delete-layer undo invisible texture + systemic undo migration

Symptom: user reports "undo doesn't work" for delete-layer, delete-vertex, "and similar actions during editing — это системная проблема."

#### Root cause #1 — eager blob URL revocation

`deleteNode` at `projectStore.js:2028` (pre-fix) revoked deleted textures' `blob:` URLs INSIDE the mutation (MEM-01 leak fix from earlier). The undo snapshot captured at line 1999 still held references, but they were now dead. After Ctrl+Z, `project.nodes` had the part back BUT the texture-sync useEffect at `CanvasViewport.jsx:466` failed to decode the revoked URL, so the restored layer rendered as a transparent rectangle. User saw this as "undo didn't bring the layer back" (it did, just without its texture).

#### Root cause #2 — systemic `set(produce(...))` bypass

Audit via Explore agent found 10 destructive thunks in `projectStore.js` writing via raw `set(produce(state => ... state.project ...))` without calling `pushSnapshot` or going through `updateProject`. Each one silently bypassed undo capture for its mutation.

#### Fix `9462db4` (Pelmentor)

- New `setOnEvictCallback` API in `undoHistory.js` — fires when a snapshot drops off the tail of `MAX_HISTORY=50` OR `clearHistory` wipes the stack on project load/reset
- `projectStore._onUndoSnapshotEvict` walks evicted snapshot's blob URLs, revokes ONLY those not referenced by live project / remaining snapshots / remaining redo entries
- 8 destructive thunks migrated to `updateProject`: `createGroup`, `createAction`/`renameAction`/`deleteAction`, `createBlendShape`/`deleteBlendShape`, `addParameter`/`removeParameter`/`renameParameter`

#### Fix `cb60b7c` (Claude) — closed remaining GAPs

9 more thunks migrated: `assignAction`, `unassignAction`, `cloneAction`, `setBlendShapeValue`, `updateBlendShapeDeltas`, `patchParameter`, `addParamKey`, `removeParamKey`, `setParameterUserAuthored`. Each surveyed caller turned out to be a discrete user action (button click, NumberField `onCommit`, slider release-commit) — none fire per-frame. `test_actionRegistry.mjs` regex updated to accept both `state.project` and `proj` shapes.

**Post-cb60b7c invariant: zero `set(produce(state => ... state.project ...))` thunks remain in `projectStore.js`.** Every project mutation goes through `updateProject`.

Memory: [[undo-via-updateProject]]

### rigInitIdentityDiag lift

Symptom: `rigInitIdentityDiag` logged `Init Rig rest-divergence: max 0.00 px across 0 parts` on every Init Rig regardless of any actual divergence. Documented as a known broken open item from [SESSION_AGGREGATE_2026_06_02_03.md].

Root cause: the PP2-005b probe lived inside `harvestRigSpec` (`initRig.js`), which runs BEFORE `seedAllRig` populates `project.nodes[]` with modifier stacks. `evalProjectFrameViaDepgraph` saw a pre-seed project, walked zero art-mesh modifier chains, returned `frames = []`. The diag iterated empty frames and lied. Per RULE-№1: a diagnostic that prints 0 parts for a 19-part rig is worse than no diagnostic.

Fix `83922c2` (Pelmentor):
1. Extract probe to `src/io/live2d/rig/rigInitIdentityDiag.js` as `runRigInitIdentityDiag(project, rigSpec, { disabledSubsystems })`
2. Strip inline block from `harvestRigSpec`, leave forwarding comment
3. Call from `RigService.initializeRig` after `runRigInvariantChecks`
4. Same call added to `RigService.refitAll` — pre-fix both flows ran via shared `harvestRigSpec`, RULE-№2 forbids silently dropping a code path's coverage

Memory: [[rig-invariant-check-framework-shipped]] (Open section flipped + new section)

## Commits chronology

| # | Commit | Author | Items |
|---|--------|--------|-------|
| 1 | `f766162` | Pelmentor | I-1 visibility-skip + **broken bone-mirror fan-out** |
| 2 | `6e176d8` | Claude | bug-06 proper fix — poseOverrides overlay path |
| 3 | `9462db4` | Pelmentor | bug-07 closure + 8 thunks migrated |
| 4 | `cb60b7c` | Claude | remaining 9 thunks migrated + test regex updated |
| 5 | `83922c2` | Pelmentor | rigInitIdentityDiag lift to post-seed |

5 substantive commits. RULE-№5 alternation perfectly maintained (P → C → P → C → P).

## Architectural shifts

1. **Blender-driver-overlay path for runtime drivers** (`6e176d8`). Pre-fix the bone-mirror fan-out in `paramValuesStore.setMany` was a "convenience" path that worked for user-authored writes (slider drag, arc gesture) but conflated runtime drivers (physics, idle motion) with canonical state. Now runtime drivers ride on `poseOverrides` Map injected at eval setup — `bone.pose.rotation` remains the user's authored channel, drivers are an overlay the depgraph applies during `TRANSFORM_COMPOSE`. This is exactly Blender's driver evaluation phase: the canonical RNA channel stays as authored, drivers write to a runtime pose stack consumed only during eval.

2. **Eviction-time resource lifecycle for undo correctness** (`9462db4`). Pre-fix `deleteNode` revoked blob URLs eagerly, optimizing for memory but breaking undo. The new `setOnEvictCallback` API in `undoHistory.js` defers destructive resource releases until the LAST snapshot referencing them drops off the history tail. Generalizable beyond textures — same pattern would apply to any future resource (audio buffers, WebGL resources, etc.) the project pinned via reference.

3. **Mutation entry contract: `updateProject` is the only path** (`9462db4` + `cb60b7c`). Post-cb60b7c, every project mutation in `projectStore.js` goes through `updateProject(recipe)`, which auto-pushes snapshots. The `set(produce(...))` shortcut is reserved for UI-state stores (`editorStore`, `animationStore`, etc.) that don't participate in undo. Future thunk authors don't have to remember to call `pushSnapshot` — the contract enforces it.

4. **Diagnostic timing matters as much as correctness** (`83922c2`). `rigInitIdentityDiag` was correct code in the wrong place — pre-fix it produced consistent-but-wrong output every run. The fix is purely structural: same logic, moved to a phase where its inputs exist. Pattern applies broadly — diagnostics that depend on post-seed state must run after seed, not inside the seeder. Forwarding comment in `harvestRigSpec` documents the why so the next contributor doesn't move it back.

## RULE-№5 alternation

5 substantive commits split 2 Claude + 3 Pelmentor. No alternation breaks — every commit alternated from the prior author cleanly. Author trap from earlier sessions (`git revert --no-edit` falling through to BuildTools) avoided by explicit `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars on every commit; one near-miss when `git commit` (without env vars) landed as BuildTools `b5b9972`, immediately amended to Claude `6e176d8` before push.

## What this session validated

- **Adversarial premise check** — first bug-06 fix (`f766162` Pelmentor's bone-mirror drop) felt natural and tested clean in isolation. The regression only surfaced when the user actually exercised live preview. Per [[verify-mutation-path-before-prune]] — the bone-mirror fan-out being "for user authoring only" was a load-bearing constraint that wasn't documented anywhere; the constraint AND its consequence (rigSpecStore subscriber regen → physics kernel reset cycle) only became visible by walking the entire subscriber chain post-symptom.
- **Systemic fixes from systemic complaints** — user said "это системная проблема" about undo, which prompted the audit. Without the systemic framing the fix would have been just the blob revoke (covered the immediate "delete layer" complaint) and missed the 17 latent `set(produce)` GAPs. Treating "systemic" as a literal request rather than emphasis paid off.
- **Documentation trails work** — `SESSION_AGGREGATE_2026_06_02_03.md`'s resume hint named `rigInitIdentityDiag` broken. The fix landed in this session purely because the prior session wrote that hint down. Worth keeping the convention.

## Open work for next session

- **Variant fade rendering at runtime** — `face.smile` won't visibly appear at `ParamSmile=1` because depgraph has no opacity keyform evaluation path. I-1 visibility-skip masks the symptom but the deeper feature gap remains. Tracked as bug-08 candidate.
- **NeckWarp `neckGroupRotPid` analogous pattern** — still open from prior session aggregate. NeckWarp didn't fire I-21 on Shelby but the same pre-RULE-№4 pattern that broke FaceRotation in bug-04 may surface for a future character with a neck-region symptom.
- **`_onUndoSnapshotEvict` walk cost** — current implementation walks every remaining snapshot + redo entry for every URL in the evicted snapshot. Fine for `MAX_HISTORY=50` × ~5 textures/snapshot = 250 comparisons/eviction. If eviction becomes hot (long sessions with frequent deletes), the obvious optimization is a `Map<url, refCount>` maintained on push/evict — deferred until measured.

## Resume hint for next Claude

Last commit Pelmentor `83922c2` → next must be Claude per RULE-№5 alternation.

Options ranked by ROI:
1. **Implement variant fade depgraph path** — would close bug-05's latent gap (face.smile not visibly appearing at ParamSmile=1). Requires extending depgraph kernels with an opacity-keyform op + plumbing `node.opacity` through ART_MESH_EVAL output. Substantial.
2. **NeckWarp `neckGroupRotPid` sweep** — read `bodyRig.js:63` area, apply bug-04's fix pattern preventively. Low cost, no current user symptom.
3. **Wait for user to surface the next bug** — three real bugs surfaced in this session purely from user pastes; track record of resume hints triggering work is weaker than user pastes triggering work.

Default if user says "go next" without scoping: option 3 (wait for user verification of all three fixes, then option 2 if all clean).
