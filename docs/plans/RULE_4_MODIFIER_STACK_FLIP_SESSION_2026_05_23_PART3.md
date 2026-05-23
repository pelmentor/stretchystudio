# RULE №4 modifier-stack flip — Session aggregate 2026-05-23 (part 3)

Compact-resumption anchor for the autonomous post-compact session that
**closed the modifier-stack flip plan** (M3.3 + M4) and swept the
remaining audit-deferred follow-ons. Continues from part 2
(`RULE_4_MODIFIER_STACK_FLIP_SESSION_2026_05_23_PART2.md`, which
shipped M1+audit-fix, M2.1, M2.2, M5, M3.1, M3.2).

## What shipped

| # | Commit(s) | Slice | LOC | Audits |
|---|-----------|-------|-----|--------|
| 1 | `9fe10bc` + `42bfcea` | **M3.3** — retire `mesh.runtime.parent` end-to-end (4 writers dropped + last live reader replaced with topology signal `part.parent === groupName` + v47 strip migration) | +312 / -114 | arch 1 MED stale "v48" refs + 2 LOW; Blender CLEAN |
| 2 | `7b91b8d` + `7acbff6` | **M4** — retire `part.rigParent` end-to-end (2 readers + 3 writers dropped; v20 migration inlined rigParent→modifiers[0] bootstrap; v48 strip migration; 8 source files + 10 test files swept) — **CLOSES the modifier-stack flip plan** | +627 / -350 | arch 1 MED test-comment + 2 LOW; Blender CLEAN |
| 3 | `1b0df9d` | **v21 follow-on** — delegate to shared `findInnermostBodyWarpId` helper (closes M3.2's 4-copy → 1-copy consolidation flagged by scoping agent; +1 post-v43 regression test pinning the latent `n.type === 'deformer'` filter bug) | +42 / -27 | inline ship |
| 4 | `7a1e07b` | **`_userAuthored` overlay-drag fix** — keyform-drag handlers in WarpDeformerOverlay + RotationDeformerOverlay now also set `node._userAuthored` (was: only `kf._userAuthored`; the keyform-level flag was invisible to re-rig merge readers, so user keyform edits got wiped on Refit) | +98 | inline ship |
| 5 | `df5ca24` | **Modifier-toggle reprojection observability** — `selectRigSpec` now logs (dedup'd per `(part, fromParent→toParent)`) when a modifier toggle re-projects keyforms between parent rest frames; `_reprojectKeyformVerts` separately warns (dedup'd per `(part, missingSide, missingParent)`) when the silent-passthrough math-bug edge fires | +65 / -3 | inline ship |
| 6 | `4928cce` | **Audit baseline-failure close-out** — G-1 (5 orphan test files wired into npm test chain) + D-7 (TimelineEditor `template_action` JSDoc) — full suite now **331/331** (was 329/331 with 2 unrelated pre-existing failures throughout the prior sessions) | +4 / -1 | n/a |

Total: 8 commits (no doc commit at session close until THIS aggregate).

## RULE №4 modifier-stack flip plan — FULLY CLOSED

All three Cubism-shaped chain-related persisted fields are now retired
end-to-end across the SS codebase:

| Field | Retired by | Migration | Status |
|-------|-----------|-----------|--------|
| `node.variantRole` | Slice 4 (prior session) | v46 | DONE |
| `mesh.runtime.parent` | **M3.3** | **v47** | DONE |
| `part.rigParent` | **M4** | **v48** | DONE |

Post-M4 invariants:
- **`part.modifiers[]` is the SOLE authoring source-of-truth** for the
  per-part deformer chain. Mirrors Blender's `Object.modifiers`
  ListBase shape (`DNA_modifier_types.h:131-144`).
- **`deformer.parent` is the only maintained derived mirror** —
  `synthesizeDeformerParents` derives chain links from `modifiers[]`
  for the cmo3 export adapter. The function no longer writes any
  Cubism-shaped per-part field.
- **The v44 runtime migration** (`migrateGroupRotationDeformersToBones`)
  uses topology signal `part.parent === groupName` alone to discover
  driven parts (the two retired alternatives — `rigParent === def.id`
  and `runtime.parent.id === def.id` — are gone; topology subsumes
  both per the M3.3 + M4 test verification).
- **The v15→v20→v48 migration chain** survives via inlined bootstrap:
  v15 writes `rigParent` from the legacy sidetable; v20 reads
  `rigParent` to seed `modifiers[0]` (its inlined bootstrap); v48
  strips `rigParent`. Sequential — no shim, no flag.
- **Pre-rig fallback** in `selectRigSpec._buildArtMeshes` falls to
  `innermostBodyWarpId` for parts without `mesh.runtime`. The
  rotation-parent branch was provably unreachable post-M4 and was
  deleted per RULE-№2.

The 3-way drift hazard the RULE-№4 audit flagged as item #2-highest-
impact is **structurally eliminated**: there are no longer three
parallel representations of the chain.

## Cross-slice learnings

### Test fixtures embody the OLD authoring model, not just behavior

M4's most surprising work item was the bulk fixture update across 10
test files. Every test that authored `part.rigParent: 'X'` as input
had to flip to `part.modifiers: [{ type, deformerId: 'X', ... }]`.
~30 sites across the test suite. Lesson: when retiring a field, the
test fixture update is often more LOC than the substrate change. Plan
for it — don't underestimate "just update the tests."

### v20 migration's bootstrap saved the day

The scoping agent for M4 missed that `synthesizeModifierStacks`'s
`rigParent` fallback was the consumer of the v15→v20 chain's
rigParent seed. If I'd just dropped the fallback as the agent
suggested, every pre-v20 save would have come up with empty
`modifiers[]` arrays — silent regression for ancient projects. The
fix: inline the rigParent→modifiers[0] bootstrap INTO v20 directly,
then drop the live-runtime fallback. The v15→v20→v48 chain works
sequentially, no shim.

Lesson: when retiring a live-runtime fallback that has a migration
consumer, INLINE the bootstrap into the migration entry. Don't leave
the runtime path as "load-bearing for migration."

### Topology signal subsumes Cubism cache fields

Both M3.3 (runtime.parent OR-branch) and M4 (rigParent arm of
`partsOf`) replaced Cubism-shaped cache reads with topology signals
(`part.parent === groupName`). The signal is a property of the
project tree, not a derived cache — moves with the part as you reparent
in the outliner, can't drift. Both retired branches were
PROVABLY UNREACHABLE post-fix per the post-M4 test verification.

Lesson: when retiring a Cubism-shaped cache field, look for a
topology equivalent FIRST. The project tree carries enough structure
to derive most chain-related queries.

### `_userAuthored` flag gap — keyform-level vs node-level

The audit's "Unknowns" section flagged the `_userAuthored` flag as
unclear in purpose. Investigation revealed a real bug: the two
overlay drag handlers set the KEYFORM-LEVEL flag, but the re-rig
merge readers gate on the NODE-LEVEL flag. So user's hand-edited
keyforms survived in-session but got wiped on next Refit.

The fix promotes the keyform-level flag to node-level at drag time —
single line per overlay. Auto-locks the deformer on first user edit,
matching user intent. Explicit unlock remains via the
`DeformerInfoSection` lock button.

Lesson: when seeing a flag set in one path but consumed in another,
verify the LEVEL matches. The audit's "unclear what it gates" framing
was the smell — it was gating something, but at the wrong level.

### Observability for silent paths — once-per-part dedup pattern

The `selectRigSpec` modifier-toggle reprojection runs every frame for
every part. Naive logging would flood the Logs panel. The fix uses
the existing `_warnOncePerPart(key, fn)` helper with carefully chosen
dedup keys:
- For the reproject info: `${partId}|reproject|${fromId}->${toId}` —
  one log per (part, from, to) triple. Once the user toggles a
  modifier back, the new (different) triple fires once.
- For the silent-passthrough warn: `${partId}|reprojectPassthrough|${missingSide}|${missingRef.type}:${missingRef.id}`
  — even more specific so different breakage shapes fire separately.

The dedup makes high-frequency code paths observable without flooding.

### Test baseline cleanup is low-cost, high-value

The 2 pre-existing baseline failures (G-1 + D-7) had been carried
across 8+ commits as "329/331 with 2 pre-existing unrelated." Fixing
them was 30 minutes:
- G-1: 1 missing alias + 5 chain insertions in package.json.
- D-7: 1 JSDoc paragraph in TimelineEditor.jsx (cite-verified per
  BYTE-VERIFY rule 9).

The result: full suite 331/331 clean, no more "unrelated baseline"
footnotes in commit messages. Lesson: don't let baseline failures
linger — they devalue the test signal.

## Memory updates

New memory files persisted (in user's `~/.claude/.../memory/`):
- `project_rule4_slice_m3_3_runtime_parent_retired.md` — M3.3 close.
- `project_rule4_slice_m4_rig_parent_retired.md` — M4 close (CLOSES
  the modifier-stack flip plan).
- `project_rule4_user_authored_overlay_drag_fix.md` — `_userAuthored`
  promotion fix.

MEMORY.md index updated:
- Added M3.3 + M4 + `_userAuthored` entries.
- Updated M3.2 entry to note M3.3 shipped (removed stale "deferred").
- Updated close-out phase entry to reflect ACTUAL status (CO-A/B/G
  shipped; C/D resolved-by-analysis; E/F deferred-optional) — was
  stale with old "Next close-out" wording.

## RULE-№4 audit queue — final status

**ALL substantive items shipped this session OR explicitly deferred
for documented reasons:**

| Item | Status |
|------|--------|
| Modifier-stack flip plan (M1-M5 + M3.1-M3.3 + M4) | ✅ SHIPPED |
| v21 follow-on (shared helper consolidation) | ✅ SHIPPED |
| `_userAuthored` flag gap (Leak #5's keyform-drag-wipe) | ✅ SHIPPED |
| Silent modifier-toggle reprojection | ✅ Observability shipped |
| Variant ref-counting propagation | ⏸ Deferred (audit's own verdict: "NO silent regression") |
| Leak #3 (variant fade) | ⏸ Deferred (needs UI work) |
| Leak #4 (neck cornering) | ⏸ Deferred (explicit "low payoff per audit") |
| Init Rig 'replace' wipe of locked deformers | ⏸ Intentional (destructive reset by design) |

The audit's "follow-on" queue is materially done.

## Resume hint for compact

No autonomously-shippable next slice remains in the RULE-№4 family.
Genuinely-open work in other plan areas:

1. **UI mode/pill/tool Slice E (workspace↔mode)** — UI-blocked
   (needs browser verification per
   `feedback_verify_render_path_before_ui_fix`).

2. **Leak #3 variant fade — fade-curve UI design** — needs UX scope
   from user; substrate already exists (Slice 4 retired variantRole;
   Slice 3 closed the prune).

3. **Easing-field deep retirement** — 16-file consumer audit + drop
   the legacy `easing` → `interpolation` adapter. Was scoped as
   CO-C but resolved-by-analysis per the close-out doc (the adapter
   is a "proper input-boundary adapter" per RULE-№1, not a crutch).
   Could be revisited if user wants the broader cleanup.

4. **Modifier-toggle silent-passthrough math fix** — the
   observability shipped this session surfaces it; the actual math
   fix (handling missing-rest-state gracefully vs passing through)
   needs design decisions about what the correct behavior IS in
   that broken-state case.

All work on `master`, pushed to `origin/pelmentor`. Working tree
clean as of session close. Full suite 331/331. Typecheck clean.

## Authorship breakdown (RULE №5)

- 8 Claude-authored commits (mechanical refactor / new migrations /
  observability / fixture updates / audit-fix close-outs): `9fe10bc`,
  `42bfcea`, `7b91b8d`, `7acbff6`, `1b0df9d`, `7a1e07b`, `df5ca24`,
  `4928cce`.
- 1 Pelmentor-authored commit (THIS session-aggregate doc — user-
  steered session via repeated "go" / "Act autonomously" commands +
  scope decisions on what to ship next post-M4).
