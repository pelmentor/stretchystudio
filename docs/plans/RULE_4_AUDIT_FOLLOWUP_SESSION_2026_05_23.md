# RULE №4 audit follow-up — Session aggregate 2026-05-23

Compact-resumption anchor for the autonomous follow-up to the
2026-05-23 RULE №4 audit. Four slices shipped end-to-end (feature +
dual-audit + audit-fix + memory) over one session, plus declaration
of **RULE №5** (commit-authorship alternation).

## What shipped

| # | Commit(s) | What | LOC | Audit-fix |
| --- | --- | --- | --- | --- |
| 1 | `2fe8750` + `df4f396` | RULE №4 Leak #1 — bone-baked art-mesh adapter (emitter dual-track + `selectRigSpec._liveSkinBoneBaked` retired + v45 force-re-rig) | ~400 | arch 1 MED (dead test fixture) |
| 2 | `fd9115f` + `764d5dd` | RULE №4 Leak #2 — eye-closure parabola substrate (`project.eyeClosureParabolas`, lazy-init, seedAllRig peer + exporter consume) | ~600 | arch 2 MED + 2 LOW (wire exporter consumers, reset cleanup, JSDoc, test discriminator) |
| 3 | `f66bdb2` + `764d089` | RULE №4 Slice 2's deferred HIGH-5 — eager `pruneOrphanedVariantParabolas` on `deleteNode` (own tiny `eyeClosurePrune.js` to keep boot light) | ~150 | arch 1 HIGH (dual-import) + 1 LOW (test harness fragility) |
| 4 | `f5d0013` | RULE №2 cleanup — retire `node.variantRole` alias (v46 migration + 22-file sweep) | ~240 | **NONE — both audits CLEAN** |

Total: 7 commits, ~1400 LOC net across feature + audit-fix cycles.

## RULE №5 declared this session

[`feedback_commit_authorship_alternation_rule_five.md`](C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_commit_authorship_alternation_rule_five.md):
alternate commit authorship between Pelmentor + Claude (set both
author AND committer per commit) so both names appear on the GitHub
contributor list. Pick by who the work is "from": Pelmentor for
foundational/user-driven; Claude for the rest. Mix over time.

The 7 commits above were all Claude-authored (pre-RULE-№5). This
session-aggregate doc is the first commit applying the new rule
(authored as Pelmentor — the session was user-steered: scope
decisions, "Go" continuations, "ask agents not user" enforcement).

## RULE-№4 audit queue — status

Source ranking: [`project_rule4_audit_results_2026_05_23.md`](C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_rule4_audit_results_2026_05_23.md)

**Closed this session:**
- Leak #1 (HIGHEST severity, bone-baked art-mesh keyforms): SHIPPED Slice 1
- Leak #2 (HIGH, eye-closure parabola hidden): SHIPPED Slice 2
- Slice 2 Blender-fidelity HIGH-5 (variant-parabola GC): SHIPPED Slice 3
- Slice 3 Blender-fidelity MED-3 (variantRole alias): SHIPPED Slice 4

**Open queue (ranked by impact ÷ blast radius):**
1. **Modifier-stack source-of-truth flip** — deferred per Slice 2
   scoping agent. 4-6 slices, big blast radius: touches
   `synthesizeModifierStacks` + `synthesizeDeformerParents` +
   `selectRigSpec` + `artMesh` kernel + `artMeshRuntimeSync`. The
   audit's #2 item by impact. Needs multi-slice plan before
   starting.
2. **Leak #3 (variant fade)** — needs fade-curve UI for the
   substrate promotion to be worth it. UX-needed.
3. **Leak #4 (neck cornering)** — low payoff (≈3 hardcoded
   keyforms at ParamAngleX ±30°/0°).
4. **Leak #5 (auto-rig warp keyforms)** — already mostly Blender-
   faithful (v43 lattice objects). Minor UX gap on heuristic-vs-
   authored distinction.
5. **Reference-counting for ALL variant-keyed state** on every
   node-mutation path (Slice 3 Blender-fidelity HIGH-2 deferred).
   Pre-existing pattern, multi-system: migrations, undo/redo,
   mesh-import-replace. NOT a live regression today; reference-
   counting would propagate Slice 3's eager-prune pattern.

**Out of scope (user, 2026-05-23):** physics + masks/clips. Those
are intentional SS-from-Cubism adaptations, not leaks to refactor
toward Blender.

## Dual-audit pattern — track record this session

The [`feedback_dual_audit_after_phase_ship.md`](C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md)
convention proved its value: 3 of 4 slices caught real bugs.

- Slice 1: 1 MED — `test_artMeshRuntimeSync.mjs` `handwear-l`
  fixture asserted pre-Slice-1 bone-baked shape that no live emitter
  produces anymore. RULE-№2 documentation-as-test leak.
- Slice 2: 2 MED — exporter.js + initRig.js call-sites missed the
  new `eyeClosure` input param, leaving the substrate WRITE-ONLY in
  production (only the test exercised the read path). Plus
  `resetProject` leaked stale parabolas across project switches.
- Slice 3: 1 HIGH — top-level import of `eyeClosure.js` into
  `projectStore.js` broke the lazy-bridge contract (dual-import
  eager + lazy via peers). Fixed by splitting prune into its own
  tiny `eyeClosurePrune.js` module.
- Slice 4: ZERO findings. Proves the pattern catches both real bugs
  and confirms when nothing's wrong — no false positives.

## Key cross-slice learnings

- **Adapter-vs-source pattern works** (Slices 1 + 2 + 3): keep the
  Cubism XML emission unchanged (the adapter), promote the source
  data to first-class persisted substrate (the Blender-faithful
  half). The two tracks are explicitly separate in the emitter
  with clear naming (`rigCollector.eyeClosure` = bake output,
  `rigCollector.eyeClosureParabolas` = source — distinct fields).
- **Test discriminators matter** (Slice 2 Contract 4): the
  mutated-stored-value test caught a read-bug in `resolveEyeClosure`
  during dev. Without that contract the test would have passed
  vacuously (stored values == fit values when geometry unchanged).
  Slice 2's audit-fix LOW-2 hardened it with explicit
  `assert(curveL.a !== 999)` so future fixture changes can't break
  the discriminator silently.
- **Lazy-bridge contract is structural** (Slice 3 HIGH-1): boot-path
  isolation isn't just performance — it's the architectural
  contract that lets the loader sequence stay reasoned-about. Even
  a tiny top-level import of a peers-bridge module is a regression.
- **Paired reader/writer fixes** (Slice 4 `isVariant` fix): when
  retiring an alias, grep for ALL usages — pure replace-all of
  fallbacks misses single-source-read sites that depended on the
  alias being set by a now-removed writer.

## Resume hint for compact

Next slice candidates in order of "shippable in one autonomous
session":

1. **Leak #5 (warp keyforms heuristic-vs-authored UX gap)** — likely
   small, no migration needed, but UX requires browser verify so
   not pure-autonomous-safe.
2. **Modifier-stack source-of-truth flip** — scope an agent first to
   break into shippable slices. Per Slice 2's scoping agent, the
   smallest viable first slice could be: stop `synthesizeModifierStacks`
   from reading `rigParent` as source-of-truth, move it to derived;
   keep the field as adapter output for now. That's a 1-2 slice
   substrate promotion (mirrors the eye-closure pattern).
3. **Variant reference-counting propagation** — extend Slice 3's
   `pruneOrphanedVariantParabolas` pattern to undo/redo restore +
   migration paths. Per Blender's `BKE_id_free` central-point
   pattern. Multi-call-site change but mechanical once the helper
   exists.

All work on `master`, pushed to origin (pelmentor). Working tree
clean as of session close.
