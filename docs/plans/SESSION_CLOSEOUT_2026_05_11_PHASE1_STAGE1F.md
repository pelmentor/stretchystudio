# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.F sub-session — Action exit-gate test suite)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md).
This sub-session shipped **Animation Phase 1 Stage 1.F — Action exit-gate
test suite**: 4 new test files (`test_actionDatablock_migration.mjs`,
`test_actionScene.mjs`, `test_actionExportMotion3.mjs`,
`test_actionExportCan3.mjs`) closing the missing test entries from plan
§1.F (`test_actionRegistry.mjs` was already shipped in Stage 1.C+1.D).
138 substrate assertions + 44 audit-pin assertions = 182 new assertions
covering the Phase 1 exit gate. Two commits: substrate (`0ab8f2c`) +
audit-fix sweep (`cdd92f9`). Both pushed to `origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `0ab8f2c` | feat(anim): Phase 1 Stage 1.F — Action exit-gate test suite (4 files, 129 assertions). `test_actionDatablock_migration.mjs` (30 assertions, smoke pin atop the v36 deep-coverage suite). `test_actionScene.mjs` (36 assertions, `__scene__` lifecycle integration + exporter binding-agnostic invariant). `test_actionExportMotion3.mjs` (37 assertions, per-Action motion3.json contract). `test_actionExportCan3.mjs` (26 assertions, per-Action CSceneSource contract via CAFF round-trip). All 4 wired into npm test chain after `test:stage1eActionsEditor`. |
| `cdd92f9` | fix(audit): Phase 1 Stage 1.F — audit-fix sweep (2 HIGH dedup'd + 7 MED + 4 LOW). HIGH: G-1+D-2 dropped dead `opts.loop` + documented ACT_CYCLIC deferral; D-1 corrected misleading `BKE_main_namemap_get_unique_name:450` citation. MED: G-2 plumbed `project.parameters[]` through `generateCan3` (closes hardcoded `-1..1` data gap); G-3+G-9 switched can3 test from XML substring matching to robust `countDefinitions` + `readChildText` helpers; D-3 documented `__scene__.parent: null` Blender deviation; D-4 pulled BKE-runtime override explanation into v36 (sister to v37); D-5 escape-grammar contract assertion + JSDoc; D-6 Phase-scope warning on `getActiveSceneAction` test; D-7 Phase 4 NLA TODO markers in motion3+can3 tests. LOW: G-5 reframed test 6 leakage check; G-7 documented smoke-pin role; G-11 Meta accounting for single-kf curves; D-8/D-9/D-10/D-11 SS-specific shape deviation notes (action.id vs ID.name="ACIdle", audioTracks SS-only, meta SS-only, slotHandle slot-table absence). Audit-pin `test_audit_fixes_2026_05_11_phase1_stage1f.mjs` (44 assertions). Sister update to Stage 1.E audit-pin (D-6 citation paired). |

## What was the gap

The Stage 1.F-pre close-out (commit `f9d92d3`) queued Stage 1.F + 1.G
test suites as **Resume path A** — the recommended next chunk before
the manual Cubism Viewer .moc3 byte-identity gate on Hiyori (the
Phase 1 ship gate).

Per plan §1.F (lines 727-735), the test matrix lists FIVE entries:
`test_actionDatablock_migration.mjs`, `test_actionRegistry.mjs`,
`test_actionScene.mjs`, `test_actionExportMotion3.mjs`,
`test_actionExportCan3.mjs`. Of these, only `test_actionRegistry.mjs`
(95 assertions, Stage 1.C+1.D) had shipped. The other four were the
remaining Phase-1-substrate test gates needed to lock down the
exporter pipeline's per-Action contract before the manual byte-fidelity
gate runs.

The dual-audit pattern then surfaced gaps the substrate left behind:
two HIGH (one citation drift, one dead production hook) and several
MED/LOW deviations between the new substrate and Blender source.

## The conversion

### Substrate (`0ab8f2c`)

- **`test_actionDatablock_migration.mjs`** (30 assertions, 5 cases) —
  smoke pin atop `test_migration_v36.mjs`'s deep coverage (56
  assertions). Pins the high-level invariants surfaced by §1.F:
  legacy `project.animations[]` → `project.actions[]` (Blender
  `bAction` per `DNA_action_types.h:215-360`); per-Object
  `node.animData` slot (Blender `AnimData` per `DNA_anim_types.h:664-740`);
  `project.animations` deleted (Rule №2); full v17 → v38 migration
  chain lands at `CURRENT_SCHEMA_VERSION` with no residual
  `animations` field; rnaPath grammar uses double-quoted bracket-
  string keys (Blender RNA tokenizer `rna_path.cc:127`); idempotency.

- **`test_actionScene.mjs`** (36 assertions, 8 cases) — Stage 1.D
  `__scene__` integration with Stage 1.C action lifecycle
  (`assignAction` / `unassignAction` / `getActionUsers` /
  `deleteAction`) UNCHANGED — no special-case for scene id. The
  exporter pipeline (`generateMotion3Json` + `generateCan3`) is
  INDEPENDENT of WHERE the action is bound; both iterate
  `project.actions[]` directly. Asserts byte-equivalent motion3
  output between scene-bound and Object-bound actions, structural
  can3 equivalence (UUIDs are random so byte-eq fails; structure is
  what matters), scene-binding survives JSON round-trip.

- **`test_actionExportMotion3.mjs`** (37 assertions, 9 cases) —
  per-Action motion3.json contract: param-target fcurve →
  `Target='Parameter'`, opacity-target fcurve →
  `Target='PartOpacity'` (default mapping); `node.rotation`
  REQUIRES `parameterMap` entry (silent drop when absent). Meta
  accounting: `Duration` / `Fps` / `CurveCount` /
  `TotalSegmentCount` / `TotalPointCount`. Loop flag honoured.
  Empty action emits valid skeleton with zero curves. Per-Action
  contract preserved — `fps` + `duration` + curve contents do not
  bleed across actions.

- **`test_actionExportCan3.mjs`** (26 assertions, 8 cases) — per-Action
  .can3 contract: each Action becomes one CSceneSource. CAFF wrapper
  validity (magic header + `unpackCaff` round-trip). Multi-action:
  3 actions → 3 CSceneSource definitions with distinct sceneGuids.
  Scene name sanitisation (`sceneEmit.js:70`). paramInfoList unifies
  `deformerParamMap` entries + param-target fcurves. Empty-fcurve
  action still produces a CSceneSource (rest pose). `fps` + `duration`
  → `movieInfo` + Root track `durationFrames`. Canvas dims +
  `modelName` + `cmo3FileName` surface in XML.

- **package.json**: 4 new `test:action*` scripts wired into the npm
  test chain immediately after `test:stage1eActionsEditor`.

- **Plan §1.F**: test-matrix table updated to mark substrate shipped
  with assertion counts.

Net diff: +1051 lines (4 new test files + JSDoc reframings + test
helpers + npm wiring).

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `0ab8f2c`:

1. **Architecture audit** (11 gaps: G-1..G-11 — 0 HIGH, 4 MED, 7 LOW
   incl. 1 positive G-10)
2. **Blender-fidelity audit** (12 gaps: D-1..D-12 — 2 HIGH, 5 MED, 5 LOW
   incl. 1 positive D-12)

After cross-audit dedup, **11 unique gaps**: 2 HIGH + 7 MED + 4 LOW
(after dropping 2 positives + 4 procedural).

The HIGH convergence — G-1 (Architecture: dead `opts.loop` hook) +
D-2 (Blender: ACT_CYCLIC unpinned) — both audits flagged the same
root cause: the motion3 writer accepts an `opts.loop` parameter that
NO production caller passes, AND doesn't read the canonical
`action.flag & ACT_CYCLIC` Blender bit. Test 5 in the substrate
pinned a contract no caller honored — exactly the Rule №2
"callable-by-no-one" anti-pattern. Decision: drop `opts.loop`,
hardcode `Loop=true` (preserves existing behaviour), document
ACT_CYCLIC deferral to Phase 6+ Cyclic-toggle UI.

The other HIGH — D-1 — caught a citation drift in
`actionRegistry.js#nextDotNNNName`: the "Mirrors
`BKE_main_namemap_get_unique_name` (`main_namemap.cc:450`)"
comment pointed at line 450 INSIDE the static helper
`id_name_final_build`'s body, NOT the public API. Future devs
verifying parity would land at the wrong function. Decision:
correct the citation pair (`id_name_final_build:441` for the
algorithmic mirror + `BKE_main_namemap_get_unique_name:582` for
the public API entry point); sister update to Stage 1.E audit-pin's
D-6 to assert both citations.

### Audit-fix sweep (`cdd92f9`)

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1+D-2 | HIGH | Architecture + Blender-fidelity | Drop `opts.loop` from `generateMotion3Json` (Rule №2: callable-by-no-one ≡ Rule №1 anti-pattern). Add module JSDoc "Loop semantics — Blender deviation" with ACT_CYCLIC bit citation (`DNA_action_types.h:385-386`) + Cyclic-toggle UI deferral. Test 5 rewritten to assert Loop=true regardless of `action.flag & ACT_CYCLIC` (current behaviour). |
| D-1 | HIGH | Blender-fidelity | Correct `BKE_main_namemap_get_unique_name:450` citation in `actionRegistry.js#nextDotNNNName`. Now cites both `id_name_final_build` (`main_namemap.cc:441` algorithmic mirror) AND `BKE_main_namemap_get_unique_name` (`main_namemap.cc:582` public API). Per-array-scan deviation called out (SS scans `actions[]` only, Blender walks the entire `Main` namemap). Sister update to Stage 1.E audit-pin to assert both. |
| G-2 | MED | Architecture | Plumb `project.parameters[]` through `generateCan3`. Param-target fcurves not in `deformerParamMap` (idle-generator / AI-motion params) now resolve their actual ranges from canonical param spec instead of hardcoded `-1..1` fallback. `exporter.js` caller passes `parameters: paramSpec`. Test assertions cover both spec'd-range emission + fallback when `parameters` is absent. Closes a known data gap that would surface as wrong-range Cubism Editor sliders at the Phase 1.G manual gate. |
| G-3+G-9 | MED | Architecture | Switch `test_actionExportCan3` from brittle XML-substring counting (`count(xml, '<CSceneSource exportMotionFile…')`) to `countDefinitions(xml, 'CSceneSource')` + `readChildText(xml, parent, attr, child, attr)` helpers. New helpers tolerate XmlBuilder attribute-order changes + scope reads to specific parent elements (e.g. `movieInfo > fps`). |
| D-3 | MED | Blender-fidelity | Document `__scene__.parent: null` Blender deviation in v37 migration JSDoc. Blender's Scene datablock has NO `parent` field at all; SS adds the explicit-null convention so `__scene__` is walkable by tree-traversal helpers in `actionRegistry.js` etc. |
| D-4 | MED | Blender-fidelity | Pull v37's BKE-runtime override deviation explanation (`actionInfluence = 1.0f` from `anim_data.cc:123`, NOT the DNA `0.0f` value-init) into v36 migration JSDoc. Sister cross-reference to `v37_scene_anim_data.js:77-85`. Closes the v36/v37 documentation asymmetry that invited future contributors to "fix" v36 to match the wrong DNA default. |
| D-5 | MED | Blender-fidelity | Escape-grammar contract: `decodeFCurveTarget` JSDoc + test 3b assertion. Blender's RNA tokenizer (`rna_path.cc:99-191`) supports embedded escaped quotes (`["Some\"Quote"]`); SS regex `[^"]+` doesn't. SS validates id namespaces to safe charset at construction so the gap is latent today; documented + tested with hand-edited fixture so a future id-grammar loosening surfaces immediately. |
| D-6 | MED | Blender-fidelity | Phase-scope warning prepended to `test_actionScene` test 4. The `getActiveSceneAction` "scene wins over fallback" composition is a Phase-1 SS-specific UI bridge, NOT a Blender semantic. Blender consumers read each adt independently. Warning prevents Phase 2+ contributors from cargo-culting the composition pattern. |
| D-7 | MED | Blender-fidelity | Phase 4 NLA TODO marker prepended to `test_actionExportMotion3` + `test_actionExportCan3` headers. Today's "one Action → one motion3" / "one Action → one CSceneSource" contracts hold ONLY because Phase 1 plays one Action at a time. Phase 4 NLA strips will modulate per-strip blendmode / extendmode / influence; the current writer ignores `node.animData.nlaTracks[]` entirely. Sister to Stage 1.F-pre audit-fix D-4 marker on `animationCompile.js`. |
| G-5 | LOW | Architecture | Reframe `test_actionScene` test 6 from near-tautological byte-equality (`f(x) === f(y)` where x, y are deep-equal) to non-trivial leakage check (no `__scene__` markers in motion3 output). Strengthens signal-to-noise of the binding-agnostic invariant assertion. |
| G-7 | LOW | Architecture | Document `test_actionDatablock_migration`'s smoke-pin role explicitly. Sister to `test_migration_v36.mjs` deep coverage; this file pins the walker-vs-direct invariant — a refactor that drops `migrateActionDatablock` registration in `projectMigrations.js` would pass the deep test (which imports the function directly) but fail this smoke pin (which goes through the walker). |
| G-11 | LOW | Architecture | Extend `test_actionExportMotion3` test 8 with `TotalSegmentCount=0` + `TotalPointCount=1` assertions for single-kf curves. Locks down the Meta accounting contract for Phase 1.G byte-fidelity gate (single-kf curves contribute 0 segments + 1 anchor point). |
| D-8 | LOW | Blender-fidelity | `action.id` vs Blender `ID.name = "AC<actionname>"` deviation note in v36 JSDoc. Blender's `bAction` carries `ID id` with 2-char type prefix (`"ACIdle"`); SS uses separate `id` (UUID-style stable) + `name` (display) fields. The id is stable across renames; in Blender renaming rewrites `id.name`. |
| D-9 | LOW | Blender-fidelity | `audioTracks` SS-only field deviation note. Blender `bAction` (`DNA_action_types.h:1053-1126`) has no `audioTracks`; audio is the Sequencer's domain (separate datablocks). SS preserves through migration verbatim per Lossless guarantee — Phase 6+ may rehome. |
| D-10 | LOW | Blender-fidelity | `meta` field deviation symmetry. Blender's `bAction` has no `meta` field; SS uses `meta.source = 'authored'`. Sister to `actionRegistry.js#cloneAction` D-7 from Stage 1.E. Asymmetric documentation closed. |
| D-11 | LOW | Blender-fidelity | `slotHandle = 0` slot-table-absence deviation note. Blender stores `slot_handle` as int32 indexing into `bAction.slot_array[]`; SS Phase 1 doesn't have a slot table — `slotHandle: 0` is a reserved-for-future scalar today, never read. Phase 4 NLA work introduces real slots. |

**Audit-pin**: `test_audit_fixes_2026_05_11_phase1_stage1f.mjs`
(44 assertions). All 11 dedup'd gap blocks covered with:
- Module-source greps using `flatJsdoc` (handles `\n * ` JSDoc continuations
  + `\n // ` line-comment continuations + CRLF normalisation)
- Behaviour assertions where applicable (G-1+D-2: ACT_CYCLIC ignored
  today; G-2: param spec lookup; D-5: malformed rnaPath mis-tokenisation)
- Source-grep for deleted dead branches (`opts.loop` destructure
  removal; brittle `count(xml, "CSceneSource…")` substring removal)
- Dual citation check (D-1: both `id_name_final_build:441` AND
  `BKE_main_namemap_get_unique_name:582`)

Audit reports kept inline (no separate AUDIT_*.md files — close-out
table IS the canonical audit record, per Stage 1.D/1.E/1.F-pre
convention).

## Test scoreboard

All Stage 1.F-touched suites green. Sister Stage 1.E audit-pin
updated via D-1 sister fix.

| Suite | Assertions |
|-------|------------|
| `test_actionDatablock_migration` (NEW substrate + extended in audit-fix) | 32 |
| `test_actionScene` (NEW substrate + extended in audit-fix) | 37 |
| `test_actionExportMotion3` (NEW substrate + extended in audit-fix) | 39 |
| `test_actionExportCan3` (NEW substrate + extended in audit-fix) | 30 |
| `test_audit_fixes_2026_05_11_phase1_stage1f` (NEW audit-pin) | 44 |
| `test_audit_fixes_2026_05_11_phase1_stage1e` (Stage 1.E pin still green; D-1 sister update) | 40 |
| `test_audit_fixes_2026_05_11_phase1_stage1d` (no churn) | 81 |
| `test_audit_fixes_2026_05_11_phase1_stage1c` (no churn) | 57 |
| `test_audit_fixes_2026_05_11_phase1_stage1ab` (no churn) | 47 |
| `test_actionRegistry` (no churn) | 95 |
| `test_sceneAction` (no churn) | 25 |
| `test_stage1e_actions_editor` (no churn) | 56 |
| `test_migration_v36` (no churn) | 56 |
| `test_motion3json` (no churn) | 35 |
| `test_exportAnimation` (no churn) | 35 |
| `test_nodetree_retirement` (Stage 1.F-pre pin still green) | 68 |
| `test_animationTree_compile` (no churn) | 15 |
| `test_projectRoundTrip` (no churn) | 41 |
| `test_depgraphEvalAnimation` (no churn) | 7 |

Typecheck clean.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (54 from earlier 2026-05-11 close-outs through `f9d92d3`) | Phases 0–7.D + Phase 1 Stages 1.A/1.B/1.C/1.D/1.E/1.F-pre ship + 16 audit-fix sweeps + 11 close-out docs |
| 55    | `0ab8f2c` | feat(anim): Phase 1 Stage 1.F — Action exit-gate test suite (4 files, 129 assertions) |
| 56    | `cdd92f9` | fix(audit): Phase 1 Stage 1.F — Action exit-gate audit-fix sweep (2 HIGH dedup'd + 7 MED + 4 LOW) |
| 57    | (next)    | docs(plan): Stage 1.F Action exit-gate test suite close-out doc (this file) |

## Schemas after Phase 1 Stage 1.F

`CURRENT_SCHEMA_VERSION = 38` (unchanged from Stage 1.F-pre — Stage
1.F is a test-suite ship + production code touch-up; no new migration).

## Hotkey reservations

Stage 1.F added no new hotkeys. Phase 6 `I` reservation (Insert
Keyframe) remains queued.

## Phase 1 closing scoreboard

Phase 1 stages shipped this 2026-05-11 marathon:

| Stage | What | Commits | Close-out |
|-------|------|---------|-----------|
| 1.A + 1.B | Action datablock + AnimData migration (v36) | 4 | [STAGE1AB](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md) |
| 1.C | actionRegistry helpers + projectStore cascade | 3 | [STAGE1C](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md) |
| 1.D | `__scene__` pseudo-Object + sceneAction selectors (v37) | 3 | [STAGE1D](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md) |
| 1.E | ActionsEditor UI + 11-file activeActionId rewire | 3 | [STAGE1E](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md) |
| 1.F-pre | NodeTree retirement (v38 — V2 dual-write shadow gone) | 3 | [STAGE1F_PRE](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md) |
| 1.F | 4 new test files (129 substrate + 44 audit-pin assertions) | 3 (this file) | (this file) |
| 1.G | Manual Cubism Viewer .moc3 byte-identity gate on Hiyori | (owed to user) | — |

**Phase 1 ship gate** = 1.G manual byte-identity test on Hiyori with
one keyframed Action. Stage 1.F substrate (this file) closes the
last automated test gap; everything left in Phase 1 is the
human-eyes Cubism Viewer load.

## Resume paths for fresh session

### A. Phase 1.G manual byte-identity gate on Hiyori (recommended next)

The Phase 1 ship gate is the only unfinished work. Per plan §1.G
(line 741):

  > One Cubism Viewer .moc3 load on Hiyori with one keyframed Action.

This needs the user to:
1. Load Hiyori `.cmo3` into SS (or the test character `shelby.cmo3`).
2. Create one Action via `ActionsEditor` (Stage 1.E UI).
3. Add a few keyframes via Timeline / Dopesheet.
4. Bind Action to `__scene__` via the Stage 1.E "Scene action" header.
5. Export via `ExportModal` → produces `.cmo3` + `.can3` (and
   `.motion3.json` files via `generateMotion3Json` per action).
6. Open the resulting `.cmo3` in Cubism Viewer 5.0 — verify model
   loads without errors.
7. Open the `.can3` in Cubism Editor 5.0 → Animation workspace →
   File → Open → pick the scene → verify keyframes show on the
   timeline at the right times + values.

Stage 1.F's automated tests cover everything that CAN be automated
without a runtime Cubism Viewer / Editor. The 1.G gate is what
closes Phase 1.

### B. Properties dedicated "Animation" tab (Stage 1.E audit-fix D-1 follow-up)

Per Audit-fix D-1 deferral note in
[propertiesTabRegistry.jsx](../../src/v3/editors/properties/propertiesTabRegistry.jsx):

- Add a new top-level Properties tab `'animation'` (peer of `item` /
  `modifiers` / `data`) holding the `'animData'` section.
- Move `'animData'` out of the Item tab `sectionIds`.
- Mirrors Blender's `PropertiesAnimationMixin.bl_context = "data"`
  more faithfully — Blender registers the Animation panel on every
  datablock's Data tab; SS approximates with one peer tab since parts
  and groups share the same node abstraction.

Decoupled from the Phase 1 ship gate; could land alongside or
immediately after Phase 1.G manual confirmation.

### C. Migration walker contiguous-version refactor (Stage 1.F-pre audit-fix D-9 follow-up)

Per Audit-fix D-9 in Stage 1.F-pre's close-out:

- Refactor `migrateProject` to tolerate version skips (mirror Blender's
  `MAIN_VERSION_FILE_ATLEAST` field-level predicates).
- Delete the no-op shim entries entirely (v22/v23/v24/v30/v31).
- Sister cleanup that closes Rule №2 baggage across the migration table.

Smallest decoupled chunk if Phase 1.G is blocked on user testing time.

### D. Phase 2 — BezTriple handles (1 week, schema v39)

Per plan §Phase 2 (lines 749+): replace per-segment `easing: string`
with per-keyframe Blender `BezTriple`-shape handles. The user can
drag bezier handles in the Graph Editor (Phase 5). Schema v39
(was v34 in original plan; post-renumber). Migration converts existing
`easing` field to BezTriple `handleType` + `handleLeft` / `handleRight`
/ `interpolation` fields per Blender `DNA_curve_types.h:83-117`.

Blocks on Phase 1 ship gate (1.G manual confirmation).

### Recommended order

A → (B || C) → D. Phase 1.G is the Phase 1 ship gate — everything
else waits for it. B + C are decoupled polish; D is the next
animation-substrate chunk.

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 lines 419-742
- Stage 1.F-pre close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md)
- Stage 1.E close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md)
- Stage 1.D close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md)
- Stage 1.C close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md)
- Stage 1.A+1.B close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
