# Session aggregate — 2026-06-02 / 03

Two consecutive days of iterative framework + bug-03/bug-04 closure on Shelby PSD. **rigInvariantCheck framework extended from 15 → 21 invariants**, both surface bugs root-caused and fixed end-to-end.

## What shipped

### bug-03 — handwear bbox blowup (2026-06-02 close)

Symptom: Shelby `handwear-l` + `handwear-r` evaluated bbox 173k × 1.26M px on 1792×1792 canvas; hands scale to 100000× in viewport. I-9 (eval bbox EXTENT > 100× canvas) fired.

Root cause: **frame contract mismatch.** Bone-baked parts skipped per-part rigwarp emission (`perPartRigWarps.js:133` `if (pm.hasBakedKeyforms) skip`). Without rigwarp, keyforms stored in canvas-px (no `rwBox` in `artMeshSourceEmit.js:177`). Body-warp leaf (BodyXWarp) `cubismWarpEval` expected UV [0,1] input; far-field extrapolation produced ~800× output.

Fix `61aef3e` (Pelmentor): drop the skip — emit identity-frame-normalizer rigwarp for bone-baked parts too. Handwear keyforms now stored in UV. Bone overlay unchanged (armature modifier still appended).

Memory: [[bug-03-handwear-closure-2026-06-02]]

### bug-04 — face/head flies to upper-left corner (2026-06-03 close)

Symptom: entire head region (face + hair + ears + eyes + brows + eyelash + eyewhite + iris) appears at canvas origin immediately after Init Rig. Pre-existing since Day-1 of Shelby; masked by bug-03's louder symptom. After bug-03 closed, I-21 (eval bbox CENTER drift) fired 13×, all face-region parts, drifts 950px to 251k px.

Root cause: **dangling parent reference.** `bodyRig.emitFaceRotation` set `FaceRotation.parent = "GroupRotation_<headGroupId>"` when `groupDeformerGuids` had the head group's guid — but per the 2026-05-23 RotationDeformer→bone refactor + RULE-№4 meta, GroupRotation deformers no longer reify as nodes in SS project.nodes. Head group is now a BONE. `ROTATION_SETUP_PROBE` early-returned with `canvasFinalPivot = [px, py]` = pivot-relative-px offset (-7, +30) instead of canvas-px facePivot ~(894, 384). Matrix translation wrong → FaceParallax lifted in pivot-relative frame → RigWarp_<face-parts> lifted further → corner-zone extrapolation → 800× to 14000× drift.

Fix `0ed9f5c` (Pelmentor): parent FaceRotation at BodyXWarp universally + encode pivot in BodyXWarp UV. Per RULE-№4 + meta-principle, accept any cmo3 byte-divergence for Hiyori-class reference rigs that predate the bone-baked refactor.

Memory: [[bug-04-face-head-closure-2026-06-03]]

### Framework extensions

Six new invariants added en route. Each was motivated by a NEW SYMPTOM the previous round of invariants couldn't catch.

| ID | Catches | Motivated by |
|----|---------|--------------|
| **I-16** | STATIC composed world matrix non-translation (`m[0]/m[1]/m[3]/m[4]`) magnitude | bug-03 round 1: I-14 only covered translation, missed scale/shear chain product |
| **I-17** | depgraph `TRANSFORM_COMPOSE.scaleX/scaleY` magnitude | bug-03 round 1: same as I-16 on eval-time |
| **I-18** | keyform `vertexPositions` magnitude (sister of I-5 on magnitude axis) | bug-03 round 1: I-5 only covered NaN, missed finite-but-huge |
| **I-19** | EVAL-TIME bone WORLD matrix (via `resolveBoneWorldFromCtx`) translation + scale/shear | bug-03 round 2: I-16/I-17 per-bone but missed chain product (`100^N`) |
| **I-20** | DIAGNOSTIC per-step ART_MESH_EVAL bbox trace for I-9 offenders | bug-03 round 3: chain composition opaque, need per-step trace |
| **I-21** | Part eval bbox CENTER drift from authored mesh.vertices center | bug-04: I-9 covered EXTENT but missed POSITION; face flew to corner with normal extent |

I-20 also surfaced an unrelated bug in `evalDepGraph`: ctx-rebuild dropped `artMeshBboxTrace` field. Fixed `f5aecfc`.

Memory: [[rig-invariant-check-framework-shipped]]

### Side fixes shipped en route

| Fix | Commit | What |
|-----|--------|------|
| `pruneOrphanRotationDeformers` walks warp parent chains | `a0f20ac` (Pelmentor) | Defensive — keeps rotations alive when reachable only via warp parents (FaceParallax → FaceRotation). Didn't end up needed for Shelby but closed a structural gap. |
| `gridLift.js` defensive logger.error on dangling parent ref | `a0f20ac` (Pelmentor) | Surface bugs of the same class as bug-04 (warp.parent.id not in project.nodes) loudly instead of silent corruption. |
| Summary text I-1..I-15 → I-1..I-21 | `87e33d4` (Claude) | Stale since I-16+ added; users saw misleading "all 15 pass". |
| Removed unused `headGroupId`/`groupDeformerGuids`/`deformerWorldOrigins` from `emitFaceRotation` | `0ed9f5c` (Pelmentor) | Bug-04 fix removed dependency; per RULE-№2 no migration baggage. |
| Cleaned diagnostic logs (`c6688ba`, `1df3819`) | `0ed9f5c` (Pelmentor) | Served their purpose surfacing the dangling ref; reverted after fix landed. |

## Commits chronology

| # | Commit | Author | Items |
|---|--------|--------|-------|
| 1 | `7679f17` | Claude | I-16 + I-17 + I-18 |
| 2 | `dc2b0ca` | Pelmentor | I-19 |
| 3 | `29ae435` | Claude | I-20 (with latent ctx-rebuild bug) |
| 4 | `f5aecfc` | Pelmentor | fix evalDepGraph ctx-rebuild for artMeshBboxTrace |
| 5 | `61aef3e` | Pelmentor | **bug-03 closure** — perPartRigWarps emit for bone-baked |
| 6 | `87e33d4` | Claude | I-21 + summary text fix |
| 7 | `a0f20ac` | Pelmentor | walk warp parent chains + gridLift defensive |
| 8 | `0816650` | Claude | diag dropped+kept rotation IDs surface |
| 9 | `c6688ba` | Pelmentor | diag rotation probe + lifted bboxes |
| 10 | `1df3819` | Claude | diag probe EARLY-RETURN path |
| 11 | `0ed9f5c` | Pelmentor | **bug-04 closure** — FaceRotation parent → BodyXWarp |

Total: **11 substantive commits, 2 surface bugs root-caused + fixed, 6 new invariants, 1 latent ctx-rebuild bug surfaced and fixed**. RULE-№5 alternation mostly maintained (broken once at `f5aecfc → 61aef3e` for the urgent bug-03 fix).

## Architectural shifts

1. **Per-part rigwarps for bone-baked parts** (`61aef3e`). The rigwarp's true purpose was misunderstood. It's not just per-param keyform variation — it's ALSO a per-part **frame normalizer**: gives keyforms a UV [0,1] storage frame AND provides a leaf cage matching the part's spatial extent. Skipping it for bone-baked parts (because per-param variation isn't needed) silently broke the frame contract. Now emitted universally.

2. **FaceRotation parents at BodyXWarp universally** (`0ed9f5c`). The pre-RULE-№4-refactor `GroupRotation_<headGroupId>` parent reference no longer reifies in SS project.nodes (head group is a bone now). Fixed by collapsing to BodyXWarp parent unconditionally; cmo3 XML target follows. Per RULE-№4 + meta (SS IS Blender; Cubism = addon at file-format boundary), accept any Cubism Viewer byte-divergence for Hiyori-class reference rigs.

3. **Framework now covers position drift** (I-21). Previously I-9 only caught bbox EXTENT (huge mesh class). I-21 adds POSITION (wrong-place class) — catches the "head flies to corner with normal-extent mesh" pattern that I-9 silently passed over. Each future RENDERS-IN-WRONG-PLACE class bug will fire I-21 with the offender named.

4. **Framework now covers eval-time WORLD matrix** (I-19) and **per-step modifier trace** (I-20). Previously the framework couldn't pinpoint chain-composition bugs at eval time. I-19 inspects the same matrix `applyBonePostChainSkin` consumes; I-20 captures bbox after every modifier step + bone-skin so the offending step gets named. Bug-03's surgical root-cause was reached because I-20 named the warp-lifted step.

5. **Dangling-reference defense at chain walkers** (`a0f20ac`). gridLift now distinguishes "parent is part/group" (legit passthrough) from "parent id is set but no node with that id exists" (dangling reference, structural bug). The latter case emits `logger.error('gridLift', ...)` naming the warp + missing parent id. Per RULE-№1, surface silent corruption.

## RULE-№5 alternation

11 substantive commits split: 5 Claude, 6 Pelmentor. One alternation break at f5aecfc → 61aef3e — both Pelmentor in a row because bug-03 needed the prior ctx-rebuild fix to even produce trace output before the root-cause fix could land. Acceptable per "alternate but don't block urgent fixes" judgement.

## What this session validated

- **Framework scales** — extending it to catch new bug classes (chain product, eval-time world matrix, position drift, per-step trace) was uniformly cheap (~50-100 LOC per invariant + paired tests).
- **Iterative tightening converges quickly** — each round narrows the search by one structural dimension. Bug-03 took 4 rounds (I-16/17/18 → I-19 → I-20 → root-cause fix). Bug-04 took 3 rounds (I-21 → 3 diag steps → root-cause fix).
- **User feedback loop is well-tuned** — user re-runs Init Rig with the diag logs active, pastes the relevant log, framework names the next narrowing question. Per [[invariant-checks-over-user-repro]] discipline.
- **RULE-№4 meta-principle is load-bearing**. Both bug-03 and bug-04 had the same root pattern: a pre-RULE-№4 Cubism-shaped assumption that no longer matches the post-refactor SS-native shape. The fixes both unified on the Blender-native shape (rigwarps universally for bone-baked + BodyXWarp parent for FaceRotation), accepting Cubism byte-divergence.

## Open work for next session

- **`rigInitIdentityDiag` is broken** — runs BEFORE `seedAllRig` populates project.nodes with parts, so `evalProjectFrameViaDepgraph(project, {}, {rigSpec})` returns 0 frames. The log every Init Rig says "across 0 parts" — silent failure. I-21 effectively replaced its function but the broken diag remains in `initRig.js:660`. Fix: move it after `seedAllRig` (requires re-architecting RigService.initializeRig flow) OR replace it with an I-21-style depgraph eval using the rigSpec directly.
- **Hiyori reference may regress** on the FaceRotation parent change. shelbyByteFidelity test passed (was already accepting the broken shape). If Hiyori test exists and pins the old GroupRotation parent shape, it'll fail — that's WAI per RULE-№4.
- **`headGroupRotPid` analogue may exist for NeckWarp** (`bodyRig.js:63`). Same pattern — `groupDeformerGuids.get(neckGroupId)` may resolve to a non-existent SS node. Neck didn't fire I-21 in this session, but the analogous fix may be needed if a user later reports a neck-region symptom.

## Resume hint for next Claude

Last commit Pelmentor `0ed9f5c` → next must be Claude per RULE-№5 alternation.

Options ranked by ROI:
1. Fix `rigInitIdentityDiag` to actually check rest divergence (currently always 0 parts).
2. Sweep `bodyRig.js` + adjacent emit code for the same pre-RULE-№4 pattern as bug-04 (e.g. NeckWarp's `neckGroupRotPid` path).
3. Wait for user to verify head/face fixed in viewport before piling on more changes.

Default if user says "go next" without scoping: option 3 (wait for verification, then sweep #2 if all clean).
