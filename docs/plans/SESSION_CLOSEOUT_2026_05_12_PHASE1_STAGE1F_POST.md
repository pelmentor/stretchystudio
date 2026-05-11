# Session Close-out — 2026-05-12 (Animation Phase 1 Stage 1.F-post sub-session — Migration walker gap-tolerant refactor)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md).
This sub-session shipped **Animation Phase 1 Stage 1.F-post —
Migration walker gap-tolerant refactor**: replaced the contiguous-
version walker invariant with a Blender-aligned gap-tolerant dispatch,
deleted the v22 / v23 / v24 / v30 / v31 no-op shim entries, rewired
the deviation citations, and updated four downstream docs that still
narrated the old contract. Two commits: substrate (`92ca246`) +
audit-fix sweep (`0a5ac46`). Both pushed to `origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `92ca246` | refactor(migrations): Phase 1 Stage 1.F-post — gap-tolerant walker + delete v22/v23/v24/v30/v31 shims (`src/store/projectMigrations.js`: walker change `if (!migrate) throw` → `if (typeof migrate === 'function') migrate(project)`; 5 shim entries deleted; header rewrite. `src/store/migrations/v38_nodetree_retirement.js`: JSDoc updated. `scripts/test/test_nodetree_retirement.mjs`: block 3 flipped from shim-presence to absence (73 assertions). `scripts/test/test_migrations.mjs`: 2 gap-traversal cases added (140 assertions).) |
| `0a5ac46` | fix(audit): Phase 1 Stage 1.F-post — gap-tolerant walker audit-fix sweep (4 HIGH dedup'd + 6 MED + 6 LOW). HIGH: D-1+D-4+D-11 dispatcher-level vs predicate-level clarification; G-1+G-2+G-3+G-4 doc drift cleanup across v38 module + v32 module + ANIMATION plan + CUBISM_ADAPTER_PATTERN.md. MED: D-2 single-int vs major.minor schema-version deviation; D-3+D-10 per-iteration bump deviation + idempotency requirement; D-5+D-8 retirement playbook citations; D-6 DNA_DEPRECATED_ALLOW substrate; D-7 DNA_DEFAULTS substrate; G-5 typeof === 'function' guard; G-6+G-7 walker test pins. LOW: D-9 macro family citation; D-12 explicit "Known deviations" sub-section; G-8 phase-tag scrub; G-9 v38 Companion clean-ups trim; G-10 NodeTreeArea/Editor v22-24 citations; G-11 walker inline cross-reference; G-12 test preamble trim. Audit-pin `test_audit_fixes_2026_05_12_phase1_stage1f_post.mjs` (39 assertions). |

## What was the gap

The Stage 1.F close-out (commit `a6549c4`) queued **Resume path C —
projectMigrations walker contiguous-version refactor** as the smallest
decoupled chunk if Phase 1.G was blocked on user testing time:

  > Refactor `migrateProject` to tolerate version skips (mirror Blender's
  > `MAIN_VERSION_FILE_ATLEAST` field-level predicates).
  > Delete the no-op shim entries entirely (v22/v23/v24/v30/v31).
  > Sister cleanup that closes Rule №2 baggage across the migration table.

Per Stage 1.F-pre's audit-fix D-9, the walker required contiguous
version keys: `for (let v = fromVersion + 1; v <= CURRENT; v++) {
const migrate = MIGRATIONS[v]; if (!migrate) throw new Error(...);
migrate(project); project.schemaVersion = v; }`. The throw-on-missing
forced retired migrations to leave behind `N: (project) => project,`
no-op shims (Rule №2 baggage: callable-by-no-one ≡ Rule №1 anti-
pattern). Stage 1.F-pre's NodeTree retirement created three such
shims (v22/v23/v24); the rigid-default-weights revert had created two
more (v30/v31). All five were dispatch-table entries that existed
solely to satisfy a JS-dispatch invariant.

The dual-audit pattern then surfaced the audit's own gaps: the new
JSDoc misrepresented Blender's actual pattern (the macro is per-
fixup INSIDE dispatcher functions, not at the dispatcher level), and
four downstream docs still narrated the old shim contract.

## The conversion

### Substrate (`92ca246`)

- **Walker change** (`src/store/projectMigrations.js`):
  - Pre: `if (!migrate) { throw new Error(...) } migrate(project); project.schemaVersion = v;`
  - Post: `if (migrate) { migrate(project); } project.schemaVersion = v;`
  - End-state-equivalent for non-shim entries; missing entries skip silently while schemaVersion still bumps each iteration.
- **5 shim entries deleted** from MIGRATIONS object: v22 / v23 / v24
  (NodeTree retirement, Stage 1.F-pre) + v30 / v31 (rigid-default-
  weights revert). Replaced with single comment blocks at v25 and v32
  insertion sites documenting "gap in dispatch table — gap-tolerant
  walker iterates as no-ops".
- **Header rewrite**: drops "contiguous version walker invariant"
  language; new "Blender alignment" section cites `BKE_main.hh:855`
  (MAIN_VERSION_FILE_ATLEAST). Retirement playbook simplified — step
  "replace entry with no-op shim" deleted; new step "DELETE the
  original entry from MIGRATIONS — no shim required".
- **`v38_nodetree_retirement.js`**: "# Companion clean-ups" updated
  to reflect the v22/v23/v24 entries being deleted (not just modules).
- **Test refresh**: `test_nodetree_retirement.mjs` block 3 flipped
  from shim-presence regex (`/22:\s*\(project\)\s*=>\s*project,/`) to
  absence (`/^\s*22:\s*[(\w]/m` negated) for v22/v23/v24/v30/v31; block
  19 reframed for gap-tolerant walker (asserts header cites
  MAIN_VERSION_FILE_ATLEAST + walker-no-longer-throws gates). 73
  assertions (was 68).
- **Test additions**: `test_migrations.mjs` adds 2 cases for gap
  traversal: v21 → v38 across v22/v23/v24; v29 → v38 across v30/v31.
  140 assertions (was 138).

Net diff: 4 files, +131/-84 (net −5 LOC).

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `92ca246`:

1. **Architecture audit** (12 gaps: G-1..G-12 — 4 HIGH, 5 MED, 3 LOW)
2. **Blender-fidelity audit** (12 gaps: D-1..D-12 — 3 HIGH, 4 MED, 5 LOW)

After cross-audit dedup, **16 unique gaps** total: 4 HIGH (after
collapsing two convergence clusters) + 6 MED + 6 LOW.

The HIGH clusters:

- **G-1 + G-2 + G-3 + G-4 (Doc drift)**: four downstream docs still
  narrated the contiguous-version-walker invariant + no-op shim
  language post-substrate. v38 module's "Companion clean-ups"
  described the shims as a transient stage; v32 module cited the
  deleted `v31_default_rigid_weights.js` path; ANIMATION plan §Stage
  1.F-pre asserted shim presence as a current-state ✅ bullet;
  CUBISM_ADAPTER_PATTERN.md said "v30 reserved no-op shim; v31
  registered" in the production-code stack. None broke runtime, but
  Rule №2's spirit ("don't carry stale data forward") applies to docs
  too — future contributors reading any of these would land at a
  wrong mental model.

- **D-1 + D-4 + D-11 (Blender pattern misrepresentation)**: the
  substrate's JSDoc cited `MAIN_VERSION_FILE_ATLEAST` as the SS
  walker's mirror, but Blender's macro is used INSIDE per-version
  `blo_do_versions_NNN` dispatcher functions, NOT at the dispatcher
  level. Blender's `readfile.cc:3755+` calls every dispatcher
  unconditionally; the macro gates individual fixups inside each.
  SS gates at the dispatch-table level (`MIGRATIONS[v]` present or
  absent). Same Rule №2 spirit, different layer. Future contributors
  verifying the parity would land at the wrong abstraction.

The two HIGH clusters above accounted for 7 of the 16 raw findings.

### Audit-fix sweep (`0a5ac46`)

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| D-1 + D-4 + D-11 | HIGH | Blender-fidelity | `projectMigrations.js` header rewrite — new "Known deviations from Blender" sub-section explicitly numbers four divergences: (1) single int vs major.minor (`BKE_blender_version.h:32-33`), (2) dispatcher-level vs predicate-level gap-tolerance (cite `readfile.cc:3755+`), (3) per-iteration bump (cite `readfile.cc:4166`), (4) no DNA_DEFAULTS / DNA_DEPRECATED_ALLOW substrate. Test_migrations.mjs comment tightened to match. |
| G-1 + G-2 + G-3 + G-4 | HIGH | Architecture | (G-1) `v38_nodetree_retirement.js` "Companion clean-ups" trimmed to post-state only — drops "stayed as no-op shims because... Stage 1.F-post then made the walker gap-tolerant" narration. (G-2) `v32_strip_rigid_default_weights.js` JSDoc no longer cites deleted `v31_default_rigid_weights.js` path; replaced with gap-tolerant-walker reference. (G-3) ANIMATION plan §Stage 1.F-pre carries Stage 1.F-post follow-up bullet pointing at this close-out. (G-4) CUBISM_ADAPTER_PATTERN.md gains "PATTERN REVERTED" banner + the stale "v30 reserved no-op shim; v31 registered" production-code line is annotated in-place. |
| D-2 | MED | Blender-fidelity | Header cites SS single-int vs Blender (versionfile, subversionfile) deviation explicitly; cites `BLENDER_FILE_VERSION` + `BLENDER_FILE_SUBVERSION` at `BKE_blender_version.h:32-33`. |
| D-3 + D-10 | MED | Blender-fidelity | Header cites per-step bump deviation: SS bumps `project.schemaVersion = v` every loop iteration; Blender sets `bmain->versionfile = fd->fileversion` ONCE at file load (`readfile.cc:4166`). Consequence documented: SS migrations MUST be idempotent because a crashed mid-cascade leaves the project at the last successful step. |
| D-5 + D-8 | MED | Blender-fidelity | Retirement playbook cites Blender precedents: pre-2.50 fixup retirement in `versioning_legacy.cc` (D-5); install template at `versioning_xxx_template.cc:14-20` as the inverse of the SS retirement playbook (D-8). |
| D-6 | MED | Blender-fidelity | Header cites `DNA_DEPRECATED_ALLOW` Blender substrate (`versioning_500.cc:9`) not present in SS — Blender's versioning code can legitimately touch deprecated DNA fields without compiler warnings; SS migrations have no equivalent guard rail. |
| D-7 | MED | Blender-fidelity | Header cites `DNA_DEFAULTS` machinery (`reference/blender/source/blender/makesdna/DNA_*defaults.h`) as the substrate that makes Blender's tiny per-fixup blocks viable — SS lacks the auto-fill, so SS migrations carry the explicit-init burden. |
| G-5 | MED | Architecture | Walker uses `typeof migrate === 'function'` (defensive vs `if (migrate)` truthy check) — catches accidental non-function dispatch values (typo `25: someExpr` resolving truthy but uncallable). |
| G-6 + G-7 | MED | Architecture | `test_migrations.mjs` adds 2 cases: (G-7) `fromVersion === CURRENT_SCHEMA_VERSION` is a no-op walk + sentinel check no mutation; (G-6) v21 fixture with `node.mode === 'mesh'` walks across the v22/v23/v24 gap and asserts v25 (`migrateEditModeSlotRename`) ran (mode rewritten to 'edit') — proves the walker traverses the gap AND continues running entries on the far side. |
| D-9 | LOW | Blender-fidelity | Macro family cited correctly: ATLEAST + OLDER + OLDER_OR_EQUAL variants at `BKE_main.hh:855-865`. |
| D-12 | LOW | Blender-fidelity | Header carries explicit "# Known deviations from Blender" sub-section (catalogues the 4 deviations above in one place). |
| G-8 | LOW | Architecture | "Stage 1.F-post" phase tag scrubbed from inline source comments. The phase tag stays in commit history, test names, and downstream-doc cross-references but no longer pollutes inline source — six months from now nobody needs to grep for "Stage 1.F-post" to understand the walker. |
| G-9 | LOW | Architecture | `v38_nodetree_retirement.js` "Companion clean-ups" section trimmed to ≤ 700 chars (was ~1200) — drops the sequential narrative, names only the post-state. |
| G-10 | LOW | Architecture | `NodeTreeArea.jsx` + `NodeTreeEditor.jsx` JSDoc references to v22-24 paired with "(modules deleted in v38)" / "(module + dispatch entry are both gone)" framing so contributors who grep for v22/v23/v24 get pointed at the retirement instead of trying to find the missing modules. |
| G-11 | LOW | Architecture | Walker inline comment now references header ("See header: 'Blender alignment' + 'Known deviations from Blender' for the full citation") instead of duplicating the gap-tolerance prose. |
| G-12 | LOW | Architecture | `test_nodetree_retirement.mjs` preamble entry 3 trimmed to post-state only ("v22 / v23 / v24 entries are ABSENT from MIGRATIONS table — gap-tolerant walker per Blender's MAIN_VERSION_FILE_ATLEAST"). |

**Audit-pin**: `test_audit_fixes_2026_05_12_phase1_stage1f_post.mjs`
(39 assertions). All 16 dedup'd gap blocks covered with:
- Module-source greps using `flatJsdoc` (handles `\n * ` JSDoc continuations + `\n // ` line continuations + CRLF normalisation)
- Behaviour assertions (G-5: walker dispatches via typeof; G-6/G-7: integration walk from v21 + sentinel check; D-1: header cites readfile.cc:3755)
- Source-grep for deleted dead text (`Stage 1.F-post` not in walker inline comment; `stayed as no-op shims because` not in v38 Companion clean-ups; `v31_default_rigid_weights.js` not in v32 module JSDoc)
- Length-of-section pin (G-9: Companion clean-ups ≤ 700 chars)

Audit reports kept inline (no separate AUDIT_*.md files — close-out
table IS the canonical audit record, per Stage 1.D/1.E/1.F-pre/1.F
convention).

## Test scoreboard

All Stage 1.F-post-touched suites green. Sister Stage 1.E + 1.F
audit-pins still green (no churn).

| Suite | Assertions |
|-------|------------|
| `test_audit_fixes_2026_05_12_phase1_stage1f_post` (NEW) | 39 |
| `test_nodetree_retirement` (preamble + block 3 trimmed) | 73 |
| `test_migrations` (extended via 4 new walker contract cases) | 144 |
| `test_audit_fixes_2026_05_11_phase1_stage1f` (no churn) | 44 |
| `test_audit_fixes_2026_05_11_phase1_stage1e` (no churn) | 40 |
| `test_audit_fixes_2026_05_11_phase1_stage1d` (no churn) | 81 |
| `test_audit_fixes_2026_05_11_phase1_stage1c` (no churn) | 57 |
| `test_audit_fixes_2026_05_11_phase1_stage1ab` (no churn) | 47 |
| `test_actionDatablock_migration` (no churn) | 32 |
| `test_actionScene` (no churn) | 37 |
| `test_actionExportMotion3` (no churn) | 39 |
| `test_actionExportCan3` (no churn) | 30 |
| `test_modifierStacks` (no churn) | 34 |
| `test_migrationV33` (no churn) | 9 |
| `test_migrationV34` (no churn) | 19 |
| `test_migration_v18` (no churn) | 31 |
| `test_migration_v19` (no churn) | 32 |
| `test_migration_v21` (no churn) | 32 |
| `test_migration_v25` (no churn) | 13 |
| `test_migration_v26` (no churn) | 13 |
| `test_migration_v27` (no churn) | 12 |
| `test_migration_v28` (no churn) | 29 |
| `test_migration_v29` (no churn) | 7 |
| `test_migration_v35` (no churn) | 25 |
| `test_migration_v36` (no churn) | 56 |
| `test_migration_v37` (no churn) | 57 |
| `test_projectRoundTrip` (no churn) | 41 |

Typecheck clean.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (57 from 2026-05-11 close-outs through `a6549c4`) | Phases 0–7.D + Phase 1 Stages 1.A/1.B/1.C/1.D/1.E/1.F-pre/1.F + 17 audit-fix sweeps + 12 close-out docs |
| 58    | `92ca246` | refactor(migrations): Phase 1 Stage 1.F-post — gap-tolerant walker + delete v22/v23/v24/v30/v31 shims |
| 59    | `0a5ac46` | fix(audit): Phase 1 Stage 1.F-post — gap-tolerant walker audit-fix sweep (4 HIGH dedup'd + 6 MED + 6 LOW) |
| 60    | (next)    | docs(plan): Stage 1.F-post close-out doc (this file) |

## Schemas after Phase 1 Stage 1.F-post

`CURRENT_SCHEMA_VERSION = 38` (unchanged from Stage 1.F — Stage 1.F-post
is a walker refactor + dispatch-table cleanup; no new migration).

## Hotkey reservations

Stage 1.F-post added no new hotkeys. Phase 6 `I` reservation (Insert
Keyframe) remains queued.

## Phase 1 closing scoreboard (post Stage 1.F-post)

Phase 1 stages shipped through this 2026-05-12 sub-session:

| Stage | What | Commits | Close-out |
|-------|------|---------|-----------|
| 1.A + 1.B | Action datablock + AnimData migration (v36) | 4 | [STAGE1AB](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md) |
| 1.C | actionRegistry helpers + projectStore cascade | 3 | [STAGE1C](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md) |
| 1.D | `__scene__` pseudo-Object + sceneAction selectors (v37) | 3 | [STAGE1D](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md) |
| 1.E | ActionsEditor UI + 11-file activeActionId rewire | 3 | [STAGE1E](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md) |
| 1.F-pre | NodeTree retirement (v38 — V2 dual-write shadow gone) | 3 | [STAGE1F_PRE](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md) |
| 1.F | 4 new test files (138 substrate + 44 audit-pin assertions) | 3 | [STAGE1F](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md) |
| 1.F-post | Gap-tolerant walker + 5 shim deletions | 3 (this file) | (this file) |
| 1.G | Manual Cubism Viewer .moc3 byte-identity gate on Hiyori | (owed to user) | — |

**Phase 1 ship gate** = 1.G manual byte-identity test on Hiyori with
one keyframed Action. Stage 1.F-post (this file) is decoupled polish
that closes Rule №2 baggage on the migration walker; doesn't move the
Phase 1 ship gate.

## Resume paths for fresh session

The Phase 1 ship gate is unchanged from Stage 1.F's close-out — this
sub-session was a decoupled cleanup that doesn't gate Phase 1. The
recommended path remains 1.G manual gate; B + D from Stage 1.F's
close-out are still queued.

### A. Phase 1.G manual byte-identity gate on Hiyori (recommended next)

Per plan §1.G (line 741):

  > One Cubism Viewer .moc3 load on Hiyori with one keyframed Action.

User-driven test: load Hiyori `.cmo3`, create one Action via
ActionsEditor, add keyframes, bind to `__scene__`, export, open in
Cubism Viewer 5.0 + Cubism Editor 5.0 → Animation workspace. Stage
1.F's automated tests cover everything that CAN be automated; 1.G is
the human-eyes Cubism load that closes Phase 1.

### B. Properties dedicated "Animation" tab (Stage 1.E audit-fix D-1 follow-up) — RE-RESOLVED 2026-05-12

> **Update 2026-05-12:** This Resume path's premise was a misread of
> Blender. The Item-tab placement IS the Blender mirror via
> `OBJECT_PT_animation` (`properties_object.py:618`,
> `bl_context = "object"`); Blender has no dedicated Animation tab.
> See
> [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).

Per Audit-fix D-1 deferral note in Stage 1.E close-out:

- Add a new top-level Properties tab `'animation'` (peer of `item` /
  `modifiers` / `data`) holding the `'animData'` section.
- Move `'animData'` out of the Item tab `sectionIds`.
- Mirrors Blender's `PropertiesAnimationMixin.bl_context = "data"`
  more faithfully.

Decoupled from the Phase 1 ship gate.

### C. Phase 2 — BezTriple handles (1 week, schema v39)

Per plan §Phase 2 (lines 749+): replace per-segment `easing: string`
with per-keyframe Blender `BezTriple`-shape handles per
`DNA_curve_types.h:83-117`. Migration converts existing `easing`
field to BezTriple `handleType` + `handleLeft` / `handleRight` /
`interpolation` fields. Schema v39.

Blocks on Phase 1.G ship gate (1.G manual confirmation).

### Recommended order

A → C. Phase 1.G is the Phase 1 ship gate; B is RE-RESOLVED (no
follow-up implementation needed — Item-tab placement IS the Blender
mirror).

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 lines 419-742
- Stage 1.F close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md)
- Stage 1.F-pre close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md)
- Stage 1.E close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
