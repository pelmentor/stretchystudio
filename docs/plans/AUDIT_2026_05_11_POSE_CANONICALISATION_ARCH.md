# Architecture Audit — Pose Read/Write Canonicalisation (Phase 8)

**Commit audited:** `b58b505` (master, 2026-05-11)
**Plan doc:** `docs/plans/POSE_WRITE_CANONICALISATION_PLAN.md`
**Scope:** Helper API, writer routing, reader routing, edge cases, Rule
№1 / Rule №2, Phase 1C-flip readiness.

## Summary

Phase 8 successfully consolidates the dominant editor-facing read/write
sites (8 writer modules + 5 reader modules). The helpers themselves are
clean and well-tested for the cases that matter today. Two real reader
gaps survive in the depgraph kernels (`bonePostChain.js`,
`transformCompose.js`) — the Animation Plan Phase 0.D path that lands
when `evalEngine === 'depgraph'`. They are dormant behind an opt-in
preference today but will surface the moment the depgraph default flips
or a user toggles the engine. One narrow reader gap exists in
`evaluateRnaPath` (driver source-variable resolution); it's reachable by
any production driver targeting `objects['<id>'].pose.rotation`.
Helper-side: a `node.pose = []` (array) edge case produces a corrupted
mongrel; `setBonePose(node, {})` silently mutates pose-less bones; and a
few small test-coverage gaps the helper unit suite did not exercise.

The plan doc's claim of "8 writers + 5 readers" is accurate **for the
classic eval engine and its supporting UI surfaces**; the depgraph and
RNA-path consumer set is where the cross-cutting work is incomplete.

## Findings

| ID  | Sev  | What / Why / Where (file:line) | Suggested fix |
|-----|------|--------------------------------|---------------|
| G-1 | HIGH | **`bonePostChain.js:122` direct raw-pose read.** `resolveBoneWorldFromCtx` falls back to `(bone.pose ?? null)` when the depgraph hasn't computed a TRANSFORM_COMPOSE for the bone. For a v19 channels-shape bone this returns the wrapper object `{channels: {...}}` — `pose.rotation` etc. are then `undefined` and the four `?? 0`/`?? 1` coalesce to identity. Same bug class the plan claimed to close in `transforms.js:180`. Today this is reachable when `evalEngine === 'depgraph'` (opt-in via `preferencesStore.evalEngine`). The Phase 0.D path renders bone post-chain skinning entirely from this kernel, so the user-visible regression on the depgraph path is the same "every pose delta drops to identity" the plan was written to prevent. `src/anim/depgraph/kernels/bonePostChain.js:122` | Replace `(bone.pose ?? null)` with `getBonePose(bone)` (already imported via the same store path the renderer uses); the function already coalesces against the same defaults. |
| G-2 | HIGH | **`transformCompose.js:138-148` produces a Frankenstein pose shape.** `overlayTransform` for a bone spreads `{ ...(node.pose ?? {}), rotation, x, y, scaleX, scaleY }`. For a v19 channels-shape input `node.pose = {channels: {...}}`, the spread copies the `channels` envelope **and** appends flat fields. The resulting pose shape is `{channels: {[id]:{...}}, rotation, x, y, scaleX, scaleY}`. Downstream `getBonePose(syntheticNode)` sees `channels` is present → reads `channels[node.id]` → returns the **stale** values from the original channel, **silently ignoring every value `overlayTransform` just wrote**. Net effect on the depgraph path: bone-target-bone constraint chains read pre-constraint pose, breaking COPY_LOCATION / COPY_ROTATION / TRACK_TO chain composition. Hidden today behind the depgraph opt-in, but the constraint chain is the entire point of TRANSFORM_COMPOSE. `src/anim/depgraph/kernels/transformCompose.js:138-148` | Build the synthetic pose as **flat-only** (drop the `channels` field): replace the current spread with `pose: { rotation: t.rotation, x: t.x - pivotX, y: t.y - pivotY, scaleX: t.scaleX, scaleY: t.scaleY }` (no inherited spread; the rest fields aren't read by anything that matters here). Or call `getBonePose(node)` to seed a flat shape, then overlay. |
| G-3 | MED  | **`rnaPath.js` `evaluateRnaPath` does naive object walk.** Driver source-variables resolve via `evaluateRnaPath(project, "objects['<id>'].pose.rotation")` (`driver.js:130`). The walker walks `.pose.rotation` literally (`rnaPath.js:166-167`). For a v19 channels-shape bone, `cur.pose.rotation` is undefined → driver's variable evaluates to 0. The plan's "5 readers consolidated" list does not include rnaPath. **Production-reachable today** any time a driver targets a bone pose channel. `src/anim/rnaPath.js:165-167` (read) + `setRnaPath` mirror at `:225` (write — currently unused by production but a latent footgun) | At resolver time, when the resolved `cur` is a node and the next segment is `pose`, route through `getBonePose(cur)` instead of the raw walk. Symmetric for `setRnaPath` — when writing into `cur.pose.<field>`, use `setBonePoseField(cur, field, value)`. Sister-helper `getArmature` already does the right thing for the `__armature__` synthetic id. |
| G-4 | MED  | **`setBonePose` silently mutates a pose-less bone for an empty partialPose.** Line `444-447`: `setBonePose(node, {})` doesn't early-exit on the empty object (only on null/undefined/non-object). It calls `ensureBonePoseChannel(node)` which creates an identity `node.pose = {rotation:0,...}` if absent, then writes nothing. Net: a no-op call has a hidden mutation side-effect. Borderline Rule №1 — silent fallback that hides "you called the helper with bad arguments." Coverage gap: test_pose_writer_helpers.mjs case 17 exercises `setBonePose(b, {})` but `b` already has a populated pose, so the side-effect is invisible. `src/store/objectDataAccess.js:444-453` | Tighten the guard: bail if every numeric field is absent (`if (![…fields].some(k => typeof partialPose[k] === 'number')) return;`). Add a regression case to test_pose_writer_helpers.mjs: `setBonePose(poseLessBone(), {})` then `assert(b.pose === undefined, 'no-op call → no mutation')`. |
| G-5 | MED  | **`ensureBonePoseChannel` accepts `node.pose = []` (array) and produces a mongrel.** Line `382` rejects only `!node.pose` and non-objects; `Array.isArray([])` is true and `typeof [] === 'object'`, so an array survives. Then `node.pose.channels` is undefined → falls into the v17/v18 flat path → assigns `arr.rotation = 0`, `arr.x = 0`, …, leaving an array carrying both indexed + named props. `getBonePose` then reads named props off the array → returns identity. Borderline edge case but Rule №1 says "either accept the input explicitly with coercion, or throw." `src/store/objectDataAccess.js:382` | Add `Array.isArray(node.pose)` to the "init flat" branch: `if (!node.pose || typeof node.pose !== 'object' || Array.isArray(node.pose))`. Same for `node.pose.channels` (line 390). |
| G-6 | MED  | **`ensureBonePoseChannel` accepts `node.pose.channels[id]` array and pollutes it.** Symmetric to G-5 but on the inner channel: line `392` `!ch || typeof ch !== 'object'` lets an array slip through, then `if (typeof ch.rotation !== 'number') ch.rotation = 0;` decorates it. Same family as G-5. `src/store/objectDataAccess.js:391-396` | Add the array guard in the same place. |
| G-7 | MED  | **`overlayTransform` (transformCompose.js) returns a node whose synthesised pose lies about its origin.** Even if G-2 is fixed, the synthetic node's `id` is the original bone id. If a Phase 1C-flip ships where multiple bones share a single Object's `pose.channels`, the synthetic node has to carry channels-shape OR `overlayTransform`'s assumption that "self has its own object" breaks. Today this is hypothetical; mention it because the plan's "Phase 1C-flip readiness" claim depends on it. `src/anim/depgraph/kernels/transformCompose.js:133-148` | Document the pre-flip vs post-flip contract on `overlayTransform`. The clean evolution is: it always returns a flat-pose synthetic, downstream consumers always go through `getBonePose` which projects channels→flat. Both the helper and the kernel hold the line. |
| G-8 | MED  | **Test `test_pose_writer_helpers.mjs` case 17 `setBonePose(b, undefined)` doesn't actually verify the no-op claim.** It calls `setBonePose(b, undefined)` on a bone with a pre-existing pose, then asserts the rotation is preserved. But case 17 doesn't distinguish "early return" from "ensureBonePoseChannel ran and did nothing." A bone with no pose + `setBonePose(b, undefined)` is the case that would surface a regression. `scripts/test/test_pose_writer_helpers.mjs:243-249` | Add `setBonePose(poseLessBone(), undefined); assert(b.pose === undefined, 'undefined partial → no init')`. Same for null and `{}`. |
| G-9 | MED  | **No `node.pose = null` regression test.** Plan checklist asked for it — `test_pose_writer_helpers.mjs` exercises pose-less (no `pose` slot at all) and pose-with-fields, but not `pose: null`. `ensureBonePoseChannel`'s line 382 catches it, but the helper API contract isn't pinned. `scripts/test/test_pose_writer_helpers.mjs` | Add a fixture `nullPoseBone()` returning `{...flatBone(), pose: null}` and assert `ensureBonePoseChannel` initialises a fresh flat pose. |
| G-10 | LOW | **`v3/operators/object/mirror.js:120-123` legacy comment claims "non-bone groups that may carry inherited pose data."** Plan doc §"Writers to consolidate" defers this on the rationale "the mirror op explicitly skips bone groups (`isBoneGroup(node)` → `skippedBones++`) before the pose-flip block executes." The skip happens at line 79; the pose block runs only on non-bones, so it's correct as-is. But the inline comment at `mirror.js:117-119` says "if it does (legacy bone groups still carry it)" — there are no legacy bone-pose-carrying non-bone groups in v17+; the fallback is dead. Rule №2 candidate — a fragment of the pre-v17 transform/pose mix. `src/v3/operators/object/mirror.js:117-124` | Decide: either delete the block (no reachable shape it serves today) or keep + update the comment to "defensive against future schema regressions" without claiming legacy bones carry it. Document via Rule №2 audit. |
| G-11 | LOW | **`PoseService.restorePose` lost its `isBoneGroup` guard in the diff.** Pre-fix iterated only bone groups; post-fix iterates EVERY node and lets `setBonePose`'s internal `isBoneGroup` check do the filter. Functionally equivalent (silent no-op for non-bones), but turns an O(B) loop into O(N). For projects with thousands of nodes (parts + deformers), the snapshot lookup `snapshot.bonePoses?.[n.id]` runs N times instead of B times. `src/services/PoseService.js:120-128` | Restore the early-out: `for (const n of …) { if (!isBoneGroup(n)) continue; const saved = …; setBonePose(n, saved); }`. Same shape as the post-fix `resetToRestPose` which kept its `isBoneGroup` gate. Cosmetic + slight perf; pinning is what matters. |
| G-12 | LOW | **Plan doc cite `rnaPath.js` line 25 already names `objects['__armature__'].pose.channels[<role>]` as a target.** That implies someone planned to author drivers / FCurves against the channels-shape path directly — but G-3 identifies that production uses the legacy `objects['<id>'].pose.rotation` shape. There's a documentation drift between the resolver's documented surface and how it's actually called. `src/anim/rnaPath.js:25` (doc) vs `:165-167` (no `getArmature` integration in the field walk) | Reconcile: either add the `__armature__` channels lookup to `evaluateRnaPath` so the documented address actually works, or trim the doc list to the addresses production currently uses and note "channels-shape RNA paths land with Phase 1C-flip." |
| G-13 | LOW | **`bonePostChain.js:99` docstring says "fallback to `node.pose` … only relevant for partial graphs / tests."** That's a load-bearing claim because if it's true the G-1 hot-path is dormant in production. Verifying that claim requires checking that **every** bone in a real depgraph build gets a TRANSFORM_COMPOSE op, including bones with zero constraints. The depgraph build pass (`anim/depgraph/build.js`) emits TRANSFORM_COMPOSE per Object — needs an audit pin to enforce the claim. `src/anim/depgraph/kernels/bonePostChain.js:96-101` | Add a test in `test_depgraph_armature.mjs`: build a depgraph for a project with one bone + zero constraints; assert TRANSFORM_COMPOSE op exists and produces a value for that bone. If it doesn't, G-1's fallback is hot in production — bump G-1 from "depgraph opt-in only" to "depgraph + production by graph topology." |

## Out of scope (verified correct)

- `src/v3/operators/object/mirror.js:79` — bone-group skip happens before
  `:120-123`, plan rationale verified.
- `src/store/projectMigrations.js` v17 + v19 — these ARE the canonical
  shape authors; routing them through helpers would be circular. Plan
  rationale verified.
- `applyOverrideToNode` (`animationEngine.js:315-344`) — the synthetic
  node it produces carries flat-shape pose (no `channels` field); a
  downstream `getBonePose` call sees flat shape → flat read path. Works
  for both raw + effective inputs.
- `computeBoneWorldMatrices`'s `boneNode.pose` early-exit guard
  (`boneOverlayMatrix.js:108`) — uses `getBonePose` for the read so
  identity-pose bones short-circuit correctly.
- `effectiveTransform` (`anim/constraints.js:165`) — already routes
  through `getBonePose`. No work needed.
- The decision to keep v19 channels envelope alive (vs Path B re-flatten
  migration) — matches Rule №2's "Reachable from a v29 save through the
  migration walker → keep" discriminator. The envelope is intentional
  Phase 1C-flip groundwork.

## Rule №1 / Rule №2 verdict

- **Rule №1 (no crutches):** Helper API is mostly clean. Two soft
  violations: G-4 (silent mutation on empty partialPose) and G-5/G-6
  (array inputs accepted + corrupted instead of rejected). G-1 / G-2 are
  the same gap class the plan was written to close (silent fallbacks
  that mask shape mismatch); leaving them in two depgraph kernels is a
  partial application of the rule.
- **Rule №2 (no migration baggage):** No new dead code; v19 channels
  envelope is correctly preserved for Phase 1C-flip; helper docstrings
  cite the right migration phase. G-10 is a candidate for cleanup but
  pre-dates Phase 8. G-12 is doc drift, not baggage.

## Phase 1C-flip readiness

The current helper signature `(node, field, value)` is the
**bone-IS-Object** assumption. Phase 1C-flip will need
`(armatureObject, boneId, field, value)`. The minimal evolution:

1. `ensureBonePoseChannel(node, boneId)` — second arg defaults to
   `node.id` (today's behavior); when called with explicit
   `boneId !== node.id`, drills into `armatureObject.pose.channels[boneId]`.
2. Every caller routes through the helper — Phase 8 already paid this
   cost (the whole point of consolidating). The Phase 1C-flip
   migration of the helper API is then **one signature change + a
   sweep of `isBoneGroup` predicates that need to detect "armature
   data" vs "bone within armature."**

The blocker for Phase 1C-flip is no longer the writer set; it's
`isBoneGroup`'s shape detection.

## Counts

- HIGH: 2 (G-1, G-2 — both depgraph-only today)
- MED:  7 (G-3, G-4, G-5, G-6, G-7, G-8, G-9)
- LOW:  4 (G-10, G-11, G-12, G-13)
- **Total: 13 gaps**

The HIGH gaps land the moment the depgraph engine flips default — they
should be closed in the same sweep that flips, OR before. The MED gaps
are proper-fix candidates per Rule №1; G-3 is the most user-visible
(driver source variables on bone pose silently return 0).
