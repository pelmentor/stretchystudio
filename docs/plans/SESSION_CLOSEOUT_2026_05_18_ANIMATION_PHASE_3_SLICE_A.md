# Animation Phase 3 — Slice 3.A close-out

**Date**: 2026-05-18
**Commits**: `8312433` (substrate) → `31a713e` (audit-fix sweep) → (this doc)
**Path #14 from Phase 3 queue** — *FCurve.modifiers[] substrate (schema v41)*
— SHIPPED. **First slice of Phase 3** after the 17-slice Phase 5 group-
selection arc (5.Y → 5.NN) wrapped.

## What the path was

> "Top queued path | **#14 — Phase 3 F-Curve modifiers** (full phase,
> ~weeks)"
> — from Session-spanning close-out `SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_5_SLICES_KK_TO_NN.md`

Phase 3 is decomposed in the plan as 3.A through 3.G:

| Slice | Scope                              | Status |
|-------|------------------------------------|--------|
| **3.A** | Schema substrate (FModifier typedef + v41 migration) | **SHIPPED this slice** |
| 3.B  | Modifier evaluator (`fmodifier.cc` port)             | queued |
| 3.C  | Per-FCurve modifier list UI in Properties panel      | queued |
| 3.D  | Cycles → motion3.json IsLoop export                  | queued |
| 3.E  | Noise → bake-at-export pipeline                      | queued |
| 3.F  | Test suites (per-modifier + composition)             | partial (3.A ships 46 baseline) |
| 3.G  | Phase exit gate (round-trip + Cubism Viewer load)    | queued |

## Blender divergence verified

| Aspect              | Blender                                          | SS port (3.A)                                |
|---------------------|--------------------------------------------------|----------------------------------------------|
| FModifier struct    | `DNA_anim_types.h:40-73`                         | `FModifier` typedef in `src/anim/fmodifiers.js` |
| eFModifier_Types    | `DNA_anim_enums.h:24-39` (11 entries; 2 deferred, 2 removed) | `FMODIFIER_TYPES` frozen const (6 entries) |
| eFModifier_Flags    | `DNA_anim_enums.h:42-57` (5 active bits; 1 deprecated) | 5 sparse booleans unpacked (`muted`/`active`/`disabled`/`useRestrictedRange`/`useInfluence`) |
| FCurve.modifiers    | `DNA_anim_types.h:353` `ListBaseT<FModifier> modifiers` | `FCurve.modifiers?: FModifier[]` (sparse-absent default) |
| FMod_Cycles modes   | `DNA_anim_enums.h:87-96` (4 modes)               | 4-mode union (`'none'`/`'repeat'`/`'repeat_offset'`/`'mirror'`) |
| FMod_Generator modes| `DNA_anim_enums.h:63-66` (2 modes)               | 2-mode union (`'polynomial'`/`'polynomial_factorised'`) |
| FMod_Generator flag | `DNA_anim_enums.h:71-74` (`FCM_GENERATOR_ADDITIVE` only) | single `additive?: boolean` |
| FMod_Noise blendType| `DNA_anim_enums.h:107-116` (4 modes)             | 4-mode union (`'replace'`/`'add'`/`'subtract'`/`'multiply'`) |
| FMod_Limits flags   | `DNA_anim_enums.h:99-104` (4 bits + `rctf rect`) | 4 sparse booleans + 4 named axis fields |
| FMod_Stepped flags  | `DNA_anim_enums.h:119-124` (2 NEGATIVE-sense bits) | 2 POSITIVE-sense booleans + I/O-boundary inversion documented |
| FCurve.modifiers default | Empty list                                   | sparse-absent (reader `getFCurveModifiers` returns frozen `EMPTY_MODIFIERS`) |

## What shipped

| Capability | Where |
|------------|-------|
| FModifier core typedef (id, type, name, data, influence + 5 flag bits + 2 frame-range fields + 2 blend fields + ui_expand_flag) | `src/anim/fmodifiers.js` ~line 80 |
| FModCyclesData typedef (4 modes match Blender exactly) | same ~line 160 |
| FModNoiseData typedef (modern shape with lacunarity + roughness; defaults verified against `fcm_noise_new_data`) | same ~line 200 |
| FModGeneratorData typedef (2 modes; correct factorised pair order `(a*x + b)`) | same ~line 245 |
| FModLimitsData typedef (4 axis-gate booleans + 4 named limit fields) | same ~line 285 |
| FModSteppedData typedef (positive-sense `useStartTime`/`useEndTime` with documented Blender bit-flip) | same ~line 320 |
| FModEnvelopeControlPoint + FModEnvelopeData typedefs | same ~line 370 |
| `FMODIFIER_TYPES` frozen-array const (6 entries in Blender enum order) | same ~line 420 |
| `isFModifierType` type guard | same ~line 440 |
| `getFCurveModifiers` sparse-aware reader | same ~line 450 |
| `EMPTY_MODIFIERS` frozen empty-array singleton (hoisted above consumer per `1671449` lesson) | same ~line 410 |
| `FCurve.modifiers?: FModifier[]` JSDoc on FCurve typedef | `src/anim/fcurve.js` ~line 121 |
| Schema v40 → v41 migration (no-op marker; field is sparse) | `src/store/migrations/v41_fmodifiers.js` |
| v41 registered in projectMigrations + CURRENT_SCHEMA_VERSION bumped | `src/store/projectMigrations.js` + `projectSchemaVersion.js` |
| Tests: 46 new 3.A assertions (idempotency + sparse defaults + type-guard coverage + enum-order vs Blender) | `scripts/test/test_migrationV41.mjs` |
| Side-fix: relaxed pinned `=== 39` to `>= 39` in v39 migration test | `scripts/test/test_migration_v39.mjs` |
| `test:migrationV41` script + test-runner registration | `package.json` |

## Dual audit (parallel agents)

| Lane             | HIGH | MED | LOW | Total |
|------------------|------|-----|-----|-------|
| Architecture     | 0    | 3   | 3   | 6     |
| Blender fidelity | **1** | 2   | 4 (cosmetic) | 7 |
| **Combined**     | **1** | **5** | **7** | **13** |

**Fab streak BROKEN at 3** (was holding at 2: 5.MM + 5.NN). The HIGH
finding was the factorised-polynomial coefficient-order inversion
(`(c0+c1*x)*(c2+c3*x)` claimed vs `(c0*x+c1)*(c2*x+c3)` actual). One of
the two MED-fidelity items was the **comment-line trap** —
`DNA_anim_types.h:341` cited as the `FCurve.modifiers` declaration line
when `:341` is just `struct FCurve {` (opening brace) and the field
is at `:353`. This is exactly the pattern named in the audit prompt
as a known fab trap from Slice 5.LL HIGH-1
(`DNA_action_types.h:347` was a comment line; real `AGRP_ACTIVE` at
`:350`). Lesson did not transfer.

Architecture agent: every claim was either verified or flagged — most
notable was the dead-return-value `{ fcurvesScanned }` whose docblock
promised non-existent migration-walker telemetry, and the stale
"still in flight" bullet on `fcurve.js:53-54` that contradicted the
shipped @property line in the same file.

Fidelity agent: 17 distinct cite-verifications all ran against the
`reference/blender/` clone. The line-range cites for the 9 DNA structs
+ 7 enums all verified exact. Only the `DNA_anim_types.h:341` claim
failed (off by 12 — pointing at the struct opening brace not the
field).

## Audit-fix sweep (commit `31a713e`)

All 9 actionable findings (1 HIGH + 5 MED + 3 LOW) addressed:

| Finding | Fix |
|---------|-----|
| HIGH-1 (fidelity) | Rewrote factorised-polynomial doc in 2 places (mode section + @property coefficients); added bold "scale-first, offset-second" callout + `fmodifier.cc:217` cite |
| MED-1 (fidelity) | Noise `phase` default 0 → 1.0; added "Defaults verified against fcm_noise_new_data" section enumerating all 8 Blender creator defaults |
| MED-2 (fidelity) | `:341` → `:353` in `fcurve.js` and `v41_fmodifiers.js` with surrounding-struct context preserved |
| MED-1 (arch) | Dropped `migrateFModifiers` return value; reworded JSDoc to plain no-op marker; 6 test assertions reworked (lost test 9's tautological assert too) |
| MED-2 (arch) | `fcurve.js:50-54` "still in flight" bullet replaced with "Phase 3: FModifier stack (post-v41)" section pointing to fmodifiers.js |
| MED-3 (arch) | Plan doc `#### 3.A — Schema v34` header updated to v41 with the schema-progression history inline |
| LOW-1 (arch) | Hoisted `EMPTY_MODIFIERS` const above its consumer per `1671449` lesson |
| LOW-2 (arch) | Test 9 tautology removed (folded into MED-1 fix) |
| LOW-3 (arch) | "Not mapped: FMODIFIER_TYPE_NULL (=0)" note added to FModifierType typedef |

Sub-threshold transparency: 4 LOW fidelity items (legacy_noise field
omitted, poly_order/arraysize redundancy with coefficients.length,
deferred FMod_FunctionGenerator scope confirmation, pre-existing Blender
typo in modifier-info table) were noted by the agent but not actionable
at the substrate slice — flagged for 3.B/3.E to revisit if relevant.

## SS deviations from Blender (still open, documented)

1. **Noise `size` default** — SS uses `1000ms`; Blender uses `1.0 frames`
   (FPS-dependent in ms; at 24fps ~41.67ms). SS chose a user-friendly
   default rather than matching Blender's too-fine-grained creator.
   Documented inline in `FModNoiseData` typedef. Decision rationale:
   ~41.67ms wavelength is too high-frequency for typical Live2D
   authoring; `1000ms` (1 second) is the user-discoverable starting
   point.

2. **Stepped flag semantic flip** — Blender uses NEGATIVE-sense
   `FCM_STEPPED_NO_BEFORE`/`_NO_AFTER`; SS uses POSITIVE-sense
   `useStartTime`/`useEndTime` for editor readability. Inversion
   documented at the typedef for any future `.blend` importer that
   round-trips to Blender wire format.

3. **`FMod_Noise.legacy_noise` not mapped (LOW from fidelity audit)** —
   Blender's legacy BLI_noise path gate (`fmodifier.cc:822`); SS will
   always emit modern Perlin in 3.E. Tracked but not blocking.

4. **`FMod_Generator.poly_order` / `arraysize` redundant with
   `coefficients.length` (LOW from fidelity audit)** — SS derives both
   from the array's length; saves 8 bytes per modifier and removes one
   write-time invariant. Documented as an intentional SS simplification.

## Queued paths (post-3.A)

| Path | Title | Status |
|------|-------|--------|
| 14 (continued) | **3.B — FModifier evaluator** (per-FCurve modifier stack eval, port of `BKE_fmodifiers_calculate_*`) | NEW TOP |
| 14 (continued) | 3.C — Properties panel UI (add/remove/reorder/mute/expand per modifier) | queued |
| 14 (continued) | 3.D — Cycles → motion3.json IsLoop export | queued |
| 14 (continued) | 3.E — Noise bake-at-export pipeline | queued |
| 14 (continued) | 3.F — Full test-suite buildout (per-modifier + composition tests) | queued |
| 14 (continued) | 3.G — Phase 3 exit gate (round-trip + Cubism Viewer load) | queued |
| 13 | Phase 2 owed-manual verification | USER-SIDE |
| 16-27 | (other Phase 5 polish + carry-overs) | queued |
| 28-29 | Timecode/Mode-drivers (5.T devs) | queued |
| 30-32 | NumInput polish (5.U devs) | queued |
| 33 | Auto-group on fcurve add (closes 5.V Dev 5) | queued |
| 34 | Group-flush helper (closes 5.V Dev 6) | queued |
| 36 | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1) | queued |
| 37 | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2) | now downstream of 3.B |
| 38 | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3) | queued |
| 60 | Box-select group rows + AGRP_ACTIVE clear (closes 5.LL Dev 4) | queued (downstream of group-row hit-test substrate) |

## Lessons

1. **The comment-line trap is the most persistent fab pattern in this
   project.** It first burned 5.LL HIGH-1 (`DNA_action_types.h:347`
   was a comment; real `AGRP_ACTIVE` at `:350`). It re-burned 3.A
   MED-2-fidelity (`DNA_anim_types.h:341` was the `struct FCurve {`
   opening brace; real `modifiers` field at `:353`). The audit prompt
   for 3.A explicitly named the pattern as one to watch for. The
   substrate author still made it. **Going forward: preflight every
   numeric line citation against the reference clone BEFORE spawning
   the fidelity audit, not after.** The cite-discipline-as-habit
   conclusion from 5.LL still applies; the fab streak is intentionally
   hard to hold.

2. **Phase 5's all-green-by-default lesson didn't transfer to Phase
   3's substrate.** Phase 5 ended on a 2-in-a-row clean fidelity audit
   (5.MM + 5.NN). Phase 3.A was a sister-shape "type substrate" slice
   — superficially smaller in scope than 5.LL's runtime substrate, but
   denser in citations (17 DNA cites vs 5.LL's ~10). Citation density
   matters more than scope size for fab risk. **For substrate slices
   with high citation density, allocate extra preflight time
   proportional to cite count, not LOC.**

3. **Plan docs decay during long phases.** Phase 3 was drafted when the
   schema was at ~v32; by the time Phase 3 opened, the schema had
   advanced through v40 due to Phase 5's work. The plan's "Schema v34"
   header for Slice 3.A was correct relative to the draft but stale
   relative to reality. **Lesson for the next phase opener: spot-check
   the plan's schema-version annotations against
   `projectSchemaVersion.js` BEFORE writing the migration file.**

4. **Audit-fix sweeps consistently catch one no-op-comment lie.**
   5.LL had stale "this MED is open" comments after fixes. 5.MM had a
   stale "Active-elevation deferral" section. 3.A had the
   `fcurvesScanned` telemetry promise that the walker can't fulfill.
   **Lesson: every JSDoc that promises observable runtime behavior
   should be backed by a test that catches the promise getting
   broken.** The current convention covers correctness; it doesn't
   cover documentation honesty.

5. **Substrate without runtime can still ship valuable correctness
   guarantees.** Slice 3.A added zero runtime behavior but documented
   the byte-faithful field set for the entire FModifier system. When
   3.B writes the evaluator, the typedef is the spec — including the
   factorised-polynomial coefficient pair order, the
   semantic-flipped stepped flags, the negative-semantics Blender
   bit-flip, and the per-type Blender creator defaults. A 3.A done
   sloppily would have silently mis-spec'd 3.B; the audit-fix sweep
   ensured 3.B inherits a clean spec.

## Pre-doc state table

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead of origin | **116** (was 113 pre-slice; +2 substrate+audit-fix; +1 this doc) |
| Schema version | **v41** (was v40; first migration of Phase 3) |
| Slices shipped this session | 1 (3.A) |
| Per-slice commit count | 2 (substrate + audit-fix) + 1 (this doc) = 3 total |
| Dual audits run | 1 (3.A) |
| Audit-fix sweeps | 1 (3.A) |
| Audit findings | 1 HIGH (fidelity) + 5 MED + 7 LOW |
| Fab streak | **BROKEN at 3** (was 2 holding post-5.NN) |
| Test suites green | all (46 fmodifiers/v41 + 144 migrations + 35 fcurveEval + 80 fcurveGroups + 41 projectRoundTrip + 32 actionDatablock = 378 assertions verified) |
| New substrate files | `src/anim/fmodifiers.js` + `src/store/migrations/v41_fmodifiers.js` + `scripts/test/test_migrationV41.mjs` |
| Modified files | `src/anim/fcurve.js` (FCurve typedef + module header) + `src/store/projectMigrations.js` (registers v41) + `src/store/projectSchemaVersion.js` (40→41) + `package.json` (test:migrationV41) + `scripts/test/test_migration_v39.mjs` (relaxed stale pin) + `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` (3.A schema header) |
| Deviations opened (still tracked) | 4 (Noise size 1000ms vs Blender 1.0fr; stepped flag-flip; legacy_noise unmapped; poly_order redundancy) — all documented as intentional SS simplifications |
| Deviations closed | 0 (substrate slice; no pre-existing devs to close) |
| Top queued path | **#14 (continued) — 3.B FModifier evaluator** (port of `BKE_fmodifiers_calculate_*` at `fmodifier.cc`) |

## Phase 3 progress

```
Phase 3 — F-Curve modifiers (~1 week per plan)
├─ 3.A — Schema substrate ............ SHIPPED 2026-05-18 (this slice)
├─ 3.B — Modifier evaluator .......... NEW TOP
├─ 3.C — Properties panel UI ......... queued
├─ 3.D — Cycles → IsLoop export ...... queued
├─ 3.E — Noise bake-at-export ........ queued
├─ 3.F — Test-suite buildout ......... queued (3.A ships 46 baseline)
└─ 3.G — Phase exit gate ............. queued
```

## Whole-Animation-Plan progress (post-3.A)

```
Animation Plan — 8 phases:
├─ ✅ Phase 0 — Wire what already exists
├─ ✅ Phase 1 — Action datablock + NodeTree retirement (schema v33)
├─ ✅ Phase 2 — BezTriple handles (schema v34/v39)
├─ 🟡 Phase 3 — F-Curve modifiers (3.A SHIPPED v41; 3.B..3.G queued)
├─ 🔲 Phase 4 — NLA stack (~1.5 weeks)
├─ 🟡 Phase 5 — Graph Editor write-mode (slices A→NN shipped; surface largely tapped)
├─ 🔲 Phase 6 — Dopesheet write-mode (~3–4 days)
└─ 🔲 Phase 7 — Insert Keyframe + Keying Sets (~3–5 days) + close-out
```

Remaining Animation phases: **4** (3 partial, 4, 6, 7). Phase 5 is
~99% done. Phase 3.A is the first slice of an actively-shipping new
phase.
