# Session Aggregate — 2026-05-20 — Phase 7 Slice 7.F + Animation Close-out Phase

**Session date:** 2026-05-20.
**Scope:** Closed Phase 7 (Insert Keyframe) via Slice 7.F, then ran the
entire animation **close-out phase** (the plan's *second* "Phase 7" =
Rule №2 baggage sweep) end-to-end on user directive "no migration
baggage, so remove classic."
**Branch:** master. **Final state:** 0 commits ahead of origin (all
pushed), working tree clean.
**Schema:** v42 (unchanged — no schema bumps this session).
**Commits:** 8 (`71b835b` → `e84932b`).

---

## Part 1 — Phase 7 Slice 7.F (Insert Keyframe exit gate)

**Commits:** `71b835b` (substrate) + `0bc6cab` (audit-fix).

Meta-work slice (0 new code): coverage audit + manual checklist +
phase aggregate + plan banner flip → **Phase 7 SHIP-COMPLETE 6/6**.

- `ANIMATION_PHASE_7_COVERAGE_AUDIT.md` — proved all 5 plan §7.F
  prescribed test files are subsumed by 5 existing suites (370 asserts:
  keyingSets 144 + insertKeyframe 87 + keyingSetMenu 69 +
  autoKeyDispatch 48 + kKeyFirstUseToast 22). Re-verified green.
- `ANIMATION_PHASE_7_MANUAL_CHECKLIST.md` — 20–30 min user-facing
  verification (I-menu, K-toast, auto-key dropdown, gate semantics).
- `ANIMATION_PHASE_7_AGGREGATE.md` — rollup of all 6 Insert-Keyframe
  slices.

**Audit (Sweep #83/#83-F)** caught the slice's own substrate
inheriting a fab cite: `anim_sys.cc:1473-1490` (carried from 7.A's
audit-fix memory into 3 new docs without rule-9 re-OPEN) was
misdirected — real source for DEV 28 (free-handle preservation on
replace) is `animrig/intern/fcurve.cc:149-164` `replace_bezt_keyframe_ypos`
(comment `:151` *"Just change the values when replacing, so as to not
overwrite handles."*). Also fixed: `DNA_anim_enums.h` range off-by-2,
canonical-order overclaim, off-by-one commit count, streak-counter
inconsistency, a missing Known-Gap. **New memory rule 12**: meta-work /
doc-only slices carry the rule-9 obligation for INHERITED cites.

**Cite-discipline:** Phase 7 final streak = 3 clean (7.C/D/E); 7.F
substrate broke it via inherited carry-over fab; 7.F audit-fix
resolved it.

---

## Part 2 — Animation Close-out Phase (Rule №2 baggage sweep)

Triggered by user directive **"New rule - no migration baggage, so
remove classic"** (waiving the Phase 0.D user-side byte-fidelity gate).

### CO-A — Remove `evalEngine: 'classic'` opt-out ✅ SHIPPED

**Commits:** `7c0852a` (removal) + `da96661` (audit-fix LOW).

`evalProjectFrameViaDepgraph` is now the **sole viewport eval path**.
Removed: `preferencesStore.evalEngine` field + `EVAL_KEY` + setter; the
CanvasViewport per-tick engine read + `evalRig` branch + the dead
classic-only bone post-chain re-skin block + 7 now-unused imports;
the evalEngine test block.

**Scope correction (vs plan's literal 7.A):** did NOT delete
`computeParamOverrides`/`computePoseOverrides` — those are the
engine-INDEPENDENT animation override layer (node-transform +
`mesh_verts` fcurve animation) used by both the viewport tick AND the
export-frame path; the depgraph evaluates art-mesh GEOMETRY only.
`evalRig` (the fn) also stays — used by ArmatureModifierService bake +
the side-by-side test harness.

**Dual-audit (Sweep #84): clean bill on all 5 HIGH claims** — notably
verified `kernelArtMeshEval`→`applyBonePostChainSkin` does bone
composition internally (so removing the re-skin block drops nothing).
1 LOW (stale `evalRig` log strings) fixed.

**Safety:** typecheck clean; 11 suites green incl. side-by-side parity
(depgraph ≈ evalRig <1e-4px); export byte-fidelity unaffected (cmo3
pipeline builds from rigSpec/project data, never runtime eval frames).

### CO-B — Verify `project.animations[]` reader removal ✅ SHIPPED

**Commit:** `fe818c9`.

Grep-verified **no live reader** of the pre-v36 `project.animations[]`
remains (all surviving refs are migration-internal — v1/v11/v36 — or
comments). Removed 3 dead-baggage spots that re-created/carried the
deleted field with zero consumers: `cmo3/emitContext.js`
(`ctx.animations` + typedef — never passed, never read), `rig/initRig.js`
(an `animations: []` arg `generateCmo3` ignores), `cmo3Import.js` (an
`animations: []` on the v42 import shell). Byte-fidelity unchanged.

### CO-C — Deprecate `easing: string` ✅ RESOLVED-BY-ANALYSIS (no removal)

**Commit:** `171d512`.

Premise inaccurate. The v39 migration (`migrateKeyform`) *replaces*
keyforms with clean BezTriple objects — `easing`/`type` dropped, not
carried. The stored field is already gone. The remaining `easing` is a
**proper input-boundary adapter** in `makeBezTripleKeyform` serving 3
live sources (motion3 import, idle-motion DSL, timeline easing
dropdown) + carrying auto-handle shorthand native `interpolation`-only
input loses. Removing it would scatter conversion math across callers
(a crutch) — a Rule №1 violation, not a fix.

### CO-D — `paramValuesStore.values` audit ✅ RESOLVED-BY-ANALYSIS (no replacement)

**Commit:** `ceb4bce`.

Premise inaccurate. `evaluateRnaPath` is NOT an FCurve evaluator — for
`__params__` paths it returns `project.parameters[*].default` (static)
via `_paramsView` (`rnaPath.js:172-178`); replacing live reads with it
→ static defaults everywhere (catastrophic regression).
`paramValuesStore.values` is already the animation-aware single source
of truth: the CanvasViewport tick (`:662-685`) runs computeParamOverrides
+ driver eval and writes results back via `setMany`. All extant reads
are legitimate live-value reads. No bypass to fix.

### CO-E — Documentation ⏸ DEFERRED-OPTIONAL

`docs/V3_WORKSPACES.md` doesn't exist (referenced but never created);
the glossary + authoring-flows are net-new speculative docs with no
consumer. Additive, not baggage. Available on request.

### CO-F — Telemetry ⏸ DEFERRED-OPTIONAL

Per-tick eval counters = speculative hot-path instrumentation, no
consumer/dashboard. "Don't add features beyond what the task
requires." Available on request.

### CO-G — Memory audit ✅ SHIPPED

**Commit:** `e84932b` (plan) + memory file (outside repo).

Corrected the stale V2 NodeTree memory entry: RigWarp_* ~canvasW/2
divergence FIXED in Phase 0.A; render-side flip DONE (CO-A);
`project.nodeTrees` DATA retired in **v38** (not "Phase 1 v33" as the
plan claimed) — NodeTreeEditor + `src/anim/nodetree/` compilers stay
LIVE (derive-on-the-fly), not dead baggage.

---

## Key architectural insights surfaced this session

1. **The depgraph is the sole viewport eval path now**, but it only
   replaces art-mesh GEOMETRY. The animation override layer
   (`computeParamOverrides`/`computePoseOverrides` → `poseOverrides`
   map for node-transform + `mesh_verts` fcurve animation) is
   engine-independent and runs in both the tick + the export-frame
   path. `evalRig` survives for the armature bake + side-by-side
   harness.

2. **`evaluateRnaPath` is a structural path-walker, not an FCurve
   evaluator.** For `__params__` it returns static defaults. Live param
   values live in `paramValuesStore.values`, kept animation-aware by
   tick write-back. (This is the same trap that bit 7.B as MED-3 and
   was fixed in 7.C's insertKeyframe resolver.)

3. **Three close-out slices (CO-C/CO-D + the helper-deletion half of
   CO-A) had plan premises the shipped architecture already
   superseded.** A long-lived plan doc accumulates aspirational design
   sketches; the implementation evolved past them. Following the
   literal text would have introduced regressions. Rule №1 → document
   the divergence, don't ship the "fix."

---

## Rule alignment

- **Rule №1** — no crutch shipped; resolved-by-analysis where the
  literal instruction would have regressed.
- **Rule №2** — the genuine baggage (the dual-engine `classic` opt-out)
  is removed; dead refs cleaned; stale memory corrected.
- **`feedback_dual_audit_after_phase_ship`** — dual-audit ran after the
  7.F substrate (Sweep #83) and the CO-A removal (Sweep #84).
- **`feedback_byte_verify_behavior_cites` rule 12** added (meta-work
  inherited-cite obligation).
- **"Don't add features beyond what the task requires"** — CO-E/CO-F
  deferred rather than generating speculative docs/telemetry.

---

## State at compact

- **Branch:** master, **0 commits ahead of origin** (all 8 pushed).
- **Working tree:** clean.
- **Schema:** v42 (unchanged).
- **Phase 7 (Insert Keyframe):** SHIP-COMPLETE 6/6.
- **Close-out phase:** baggage sweep COMPLETE (CO-A/B/G shipped;
  CO-C/D resolved-by-analysis; CO-E/F deferred-optional).
- **Open/optional:** CO-E (docs — glossary is the highest-value piece)
  + CO-F (telemetry) available on request. Phase 7 polish slices
  (§7.G K-rebind / §7.H param-row auto-key gap / §7.I active-set UI /
  toast-label drift) still queued. User-side: Phase 6 + Phase 7 manual
  checklists outstanding.
