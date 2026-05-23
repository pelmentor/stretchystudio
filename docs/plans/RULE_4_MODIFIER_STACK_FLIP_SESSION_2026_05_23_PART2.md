# RULE №4 modifier-stack flip — Session aggregate 2026-05-23 (part 2)

Compact-resumption anchor for the autonomous second-day session of the
RULE №4 follow-up audit. Continues from
`RULE_4_AUDIT_FOLLOWUP_SESSION_2026_05_23.md` (part 1, which closed
Leaks #1+#2 + Slice 3 variant GC + Slice 4 variantRole alias).

This session shipped 6 distinct slices of the **modifier-stack flip
plan** (M1, M2.1, M2.2, M3.1, M3.2, M5) — the audit's #2 highest-
impact open item ("3-way drift hazard" between `part.modifiers[]`,
`part.rigParent`, and `mesh.runtime.parent`).

## What shipped

| # | Commit(s) | Slice | LOC | Audits |
|---|-----------|-------|-----|--------|
| 1 | `a3e527d` + `52b505a` | **M1** — modifier-stack writer flip (seedRigWarps/clearRigWarps write `modifiers[0]`; synthesizeModifierStacks reads modifiers[0] first; inverse-synth clears stale rigParent) | ~543 | arch 1 HIGH (armature flag wipe) + 1 MED (same-id leaf stomp); Blender CLEAN |
| 2 | `27f1ad5` | **M2.1** — delete depgraph implicit-parent fallback (`walkDeformerParentChain` + matching build.js dep-edges) | -62 net | both CLEAN (1 MED doc folded) |
| 3 | `fd01246` | **M2.2** — collapse selectRigSpec `cachedRefInModifiers`/`modifierStackComplete` gate | -15 net | both CLEAN, no findings |
| 4 | `a2586a4` | **M5** — retire dead rotation-display filter in ModifierStackSection (~16 LOC; dual-audit skipped per scoping-substituted) | ~16 | scoping agent did arch analysis pre-ship |
| 5 | `a3b361d` | **M3.1** — selectRigSpec stops reading `runtime.parent` (derives from modifiers[0] with lattice→'warp' normalization) | +50 src / +100 test | both CLEAN + 2 LOW fixes |
| 6 | `00cc8c0` | **M3.2** — synthesizeModifierStacks stops reading `runtime.parent` (shared `findInnermostBodyWarpId` helper extracted) | +213 / -103 | arch 1 MED + 2 LOW folded; Blender CLEAN |

Plus this session-aggregate commit (Pelmentor-authored per RULE №5).

Total: 7 commits + 1 doc commit, ~900 LOC net across the modifier-
stack flip pipeline.

## Modifier-stack flip plan — status post-session

**SHIPPED** (6 of 5 originally-planned slices — M3 was sub-split):
- **M1** — writer flip: authoring callers write `modifiers[0]`;
  `rigParent` is a derived mirror.
- **M2.1** — depgraph kernel's implicit-parent fallback retired
  (dead code post-v44 migration).
- **M2.2** — selectRigSpec's `cachedRefInModifiers`/`modifierStackComplete`
  gate collapsed (provably always-true post-M1).
- **M3.1** — selectRigSpec stops reading `runtime.parent`; cachedParent
  derives from `modifiers[0]`.
- **M3.2** — `synthesizeModifierStacks` stops reading `runtime.parent`;
  bone-baked seed derives from shared helper.
- **M5** — rotation-modifier display filter retired (dead post-v44 +
  seedAllRig step ordering).

**OPEN** (deferred):
- **M3.3** — stop WRITING `runtime.parent` + v48 migration to strip
  the field from persisted projects. Now genuinely possible: M3.1 +
  M3.2 retired all live-runtime readers. Only
  `migrateGroupRotationDeformersToBones:73` still reads it (migration-
  only). M3.3 either retires that read or declares it migration-
  internal and lets v48 strip only post-migration.
- **M4** — demote `rigParent` to export-adapter-only + v49 migration.
- **Follow-on cleanup** (LOW-3 from M3.2 audit): v21 migration's
  private buggy `findInnermostBodyWarpId` — re-point to shared helper.

## Cross-slice learnings

### Dead-code deletion needs writer-invariant proof

M2.1 + M2.2 + M5 all retired code that was provably dead in production.
The discipline: don't just say "this looks dead" — TRACE the writer
chain end-to-end. For M2.1: v44 migration is mandatory + converts
all rotation deformers to bones + `persistArtMeshRuntime` writes
`runtime.parent.type === 'part'` not `'rotation'` post-v44 + walk
function exits immediately for group nodes = inert. The 4-step trace
took 5 minutes via scoping agent; the deletion was risk-free.

### Sub-split high-blast slices

M3 was originally scoped as a single 200 LOC slice with v48 migration.
After M2.1/M2.2 reduced the picture, M3.1 became 50 LOC (pure reader
change). M3.2 needed careful design work — sub-split surfaced 2
distinct branches (bone-baked vs pre-v44-rotation-parent) and a
shared helper extraction. Each sub-slice independently shippable +
auditable.

### Test fixture must be unambiguous about what it pins

M3.1's first pin test used a STALE-but-NONEXISTENT runtime.parent id.
Arch audit caught that `_buildFrameCtx` defensive null-passthrough
made the test a false positive (would have passed even with M3.1
reverted). Strengthened to two valid warps with valid rest grids —
now distinguishes M3.1-honored vs M3.1-reverted paths unambiguously.

### "Ask agents if lost" (user reminder mid-session)

The user's reminder triggered the M3.2 tiebreaker scoping agent call,
which surfaced critical findings I would have missed:
- 3 existing copies of the body-warp-leaf-finding algorithm
  (selectRigSpec, v21 migration with post-v43 bug, would-be Option-C
  new persisted field).
- Option C (new persisted field) was a cache-rename in disguise — would
  have made the duplication worse, not better.
- Extraction (Option B) is strictly cleaner: shared helper, no new
  state, RULE-№2-clean.

### Carry-forward at the write site, not just the synth

M1's audit-fix MED finding: the synth's `priorFlags` map only sees what's
in `modifiers[]` WHEN IT RUNS. If a writer (seedRigWarps) overwrites
`modifiers[0]` before the synth, priorFlags reads the just-written
defaults, not the user state. Fix: capture prior at the write site.
Lesson: don't rely on downstream state-preservation when upstream
mutates state.

### Type-discrimination at fallback chains

M1's audit-fix HIGH: the leaf-resolution chain (modifiers[0] → rigParent
→ runtime.parent) initially assumed `modifiers[0]` is always a
deformer/lattice leaf. After `clearRigWarps` preserves armature-only
stacks, that assumption broke. Fix: type-check before treating an entry
as a leaf; armature is a tail-pass, not a chain root.

### Two-branch fallback for bone-baked vs pre-v44

M3.2's initial implementation gated the helper-fallback on
`mesh.boneWeights` only. Test failed because pre-v44 deformer-model
parts (non-bone, with rotation parents) hit the `!cur` branch and got
empty stacks. Widening the fallback to also derive from
`part.parent` → `GroupRotation_<name>` lookup restored test-infra
compatibility without breaking production.

### Dual-audit pattern proved its value

Of the 6 audited slices this session (M5 skipped dual-audit per
scoping-as-audit), 4 found actionable findings:
- M1: arch 1 HIGH + 1 MED (real bugs caught: armature flag wipe +
  leaf flag stomp).
- M2.1: arch 1 MED (stale comment in selectRigSpec).
- M2.2: both CLEAN, no findings.
- M3.1: arch 2 LOW (stronger regression pin + 2 stale comments).
- M3.2: arch 1 MED + 2 LOW (JSDoc + 2 stale comments).

All Blender-fidelity audits returned CLEAN — the writer flip + reader
retirements all enforce Blender's "modifier stack is sole source of
truth" model.

## Notable architectural state post-session

- `runtime.parent` field is **persisted but no longer read by any
  live-runtime code**. Only `migrateGroupRotationDeformersToBones:73`
  reads it (migration-only).
- `rigParent` field is **demoted to derived mirror**: only
  `synthesizeDeformerParents` (inverse synth) writes it, only legacy
  migration-bootstrap path reads it as a fallback. M4 retires it as a
  runtime read entirely.
- `part.modifiers[]` is **the authoring source-of-truth**: writers
  populate it directly, eval reads it directly. The bone-baked
  fallback derives from project topology via the shared
  `findInnermostBodyWarpId` helper.
- The depgraph kernel no longer has any implicit-parent walk —
  modifiers[] is the only chain source. `applyBonePostChainSkin`
  handles bone transforms via the always-last Armature modifier.
- selectRigSpec emits `modifierChain: []` (not null) for bone-baked
  parts; chainEval early-returns on empty chain; renderer's bone
  post-chain handles LBS.

## RULE-№4 audit queue — status post-session

**Closed this session** (6 slices/sub-slices of modifier-stack flip):
M1, M1 audit-fix, M2.1, M2.2, M5, M3.1, M3.2.

**Open queue**:
- **M3.3**: stop WRITING `runtime.parent` + v48 migration (now
  shippable post-M3.2).
- **M4**: demote `rigParent` to export-adapter-only + v49 migration.
- **Leak #3** (variant fade) — needs fade-curve UI.
- **Leak #4** (neck cornering) — low payoff.
- **Leak #5** (auto-rig warp keyforms) — minor UX gap.
- **Variant reference-counting propagation** — not a live regression.

Physics + masks/clips remain OUT OF SCOPE per user.

## Resume hint for compact

Next-shippable in order of "ready to ship":

1. **M3.3** (stop WRITING runtime.parent + v48 migration) — the
   natural next slice. Approach options:
   (a) Retire the `migrateGroupRotationDeformersToBones:73` read first
       (replace with `part.modifiers[]` lookup for the Armature
       deformerId match), then drop the writer + v48 migration.
   (b) Keep the migration-internal read, ship the writer drop + v48
       migration that strips the field only AFTER v44 migration runs
       (so v44 still has the runtime.parent it needs at its run time).

2. **M4** (rigParent retirement) — bigger blast: touches the
   inverse-synth's only writer + export pipeline. Per the M1 scoping
   agent's original plan, ~100 LOC + v49 migration. Sub-split
   candidate.

3. **Follow-on cleanup**: re-point v21 migration's buggy
   `findInnermostBodyWarpId` to the shared helper (deferred per M3.2
   audit; not blocking but removes a latent bug for very-old saves).

All work on `master`, pushed to `origin` (pelmentor). Working tree
clean as of session close.

## Authorship breakdown (RULE №5)

- 6 Claude-authored commits (mechanical refactor / dead-code
  deletion / helper extraction): a3e527d, 52b505a, 27f1ad5, fd01246,
  a2586a4, a3b361d, 00cc8c0.
- 1 Pelmentor-authored commit (THIS session-aggregate doc — user-
  steered session via repeated "go" continuations + "ask agents if
  lost" reminder + scope decisions on which slices to ship).
