# Session aggregate 2026-05-24 — RULE-№4 follow-on + @ts-check sweep

Compact-resumption anchor for the autonomous post-compact session that:
- Shipped one remaining RULE-№4 follow-on (modifier-toggle reproject-abort)
  — **later REVERTED 2026-05-24 (`675912b`)** after user reported Init-Rig
  invisible-parts regression on Shelby. See [[revert-reproject-abort-2026-05-24]].
- Reverted a speculative defensive commit per RULE №1 + saved the lesson
- Drove the **@ts-check sweep across `src/io/live2d/` (42 files) +
  9 v3/shell JSX components** to fully type-check the Live2D emit
  pipeline (the project's primary export surface)

Continues from `RULE_4_MODIFIER_STACK_FLIP_SESSION_2026_05_23_PART3.md`
(which closed the modifier-stack flip plan end-to-end).

## What shipped

| # | Commit(s) | Slice | LOC | Notes |
|---|-----------|-------|-----|-------|
| 1 | `1ada7b2` → **REVERTED** `675912b` | **Modifier-toggle reproject-abort** — `_buildArtMeshes` aborts reproject when rest state missing on either side; emits cachedParent + FULL pre-toggle chain via new `_resolveFullModifierChain`. Mirrors Blender `BKE_modifier_is_enabled` idiom for broken modifier targets (cite-verified per BYTE-VERIFY rule 9). | +280 / -68 (then -280 / +68 on revert) | dual-audit caught HIGH-1 (chain emission needed full stack, not null) + MED-1 (test gap on effective-missing branch); both folded pre-commit. **REVERTED next day (2026-05-24)** — user reported post-Init-Rig invisible body/arms/legs on Shelby. Abort path fired spuriously on fresh Init Rig when `warpRestById` was missing a deformer; full pre-toggle chain (incl. disabled) sent chainEval through degenerate geometry. Pre-1ada7b2 silent-passthrough produces drift but keeps parts visible (RULE №1: visible > invisible). New memory: [[revert-reproject-abort-2026-05-24]]. |
| 2 | `106f527` | Stale-cite refresh — 2 cross-file `selectRigSpec.js:<range>` cites went stale across M3.1/M3.2/M3.3/M4 + the reproject-abort fix. Replaced with search-anchor cites. | +6 / -3 | comment-only |
| 3 | `578540e` → **REVERTED** `0687179` | variantNormalizer prune extension — extended Slice 3's `pruneOrphanedVariantParabolas` call to `normalizeVariants`. Blender-fidelity audit caught: all 3 callers run BEFORE seedAllRig populates parabolas → dead code in all current paths. Honest revert per RULE №1. | -71 (revert) | new lesson memory: [[verify-mutation-path-before-prune]] |
| 4 | `200f805` | `@ts-check` on `moc3/keyformAndDeformerSections.js` — first file in the sweep; +14-prop JSDoc on the opts shape; caught + fixed wrong `@returns` type the moment tsc started checking. | +23 / -1 | byte-fidelity intact (23/23) |
| 5 | `82962ab` | `@ts-check` on `moc3/binarySerialize.js` — 4 type errors all rooted in untyped `SECTION_LAYOUT` export; one JSDoc `@type` annotation pinning the tuple shape `[string, {size,write}, number, number]` cleared all 4. | +3 / -1 | `/moc3` directory complete (9/9) |
| 6 | `6ad7ffa` | `@ts-check` across 4 `can3/*` files — clean batch (finalize, keyframeSequence, sceneEmit, trackAttrs). Whole `/can3` directory now typed. | +4 / -4 | test:actionExportCan3 30/30 |
| 7 | `cb39d87` | `@ts-check` on `cmo3/eyeContexts.js` + `structuralChainEmit.js` — loosened `@returns` on eyeContexts (number[][] not [number,number][]; tag: any not string); widened `ctx.pidBodyXGuid: string\|number` + documented 4 undeclared optional ctx properties in `bodyRig.js`. | +15 / -6 | unblocks 2 more cmo3 files |
| 8 | `0c73b30` | `XmlBuilder` class fully typed + `@ts-check` enabled — critical fix: `shared(tag, attrs)` returns `[XmlNode, string]` strict tuple (was inferred as union-array, polluting every cmo3 destructure). New `XmlNode` typedef + per-method JSDoc on el/shared/ref/sub/subRef. | +41 / -5 | foundational — unlocks the narrowing cascade in `8e8e814` |
| 9 | `8e8e814` | Mass narrow `string\|number` → `string` across 14 cmo3 files — every guid in the cmo3 pipeline comes from `x.shared()` which now definitively types `string`. Net 80/-80 LOC (pure JSDoc churn). | +80 / -80 | drops error counts on 3 cmo3 holdouts: 7→2, 4→1, 8→4 |
| 10 | `b970ef8` | Last 3 cmo3 holdouts + RigSpec typedef extensions — `RigSpec.eyeClosure?` + `ArtMeshSpec.localFrame?` added to formal typedefs (were attached at runtime without coverage); 3 local-variable JSDoc annotations to narrow inferred literals (artParent, artBindings, artLocalFrame, rigWarpSpec). | +18 / -6 | **all 28 cmo3 files typed; the entire io/live2d/ pipeline (42 files) end-to-end type-checked** |
| 11 | `24ae93f` | `@ts-check` on 9 v3/shell JSX components (ApplyMenu, ClearParentMenu, KeyingSetMenu, MergeMenu, MirrorAxisMenu, PsdImportWizard, SetOriginMenu, SnapMenu, Footer) — clean batch + Footer needed `ModalKind` widening in `footerStatusData.js` (vertexModal.kind was over-narrowly typed `'translate'\|null`). | +10 / -10 | test:footerStatus 39/39 |
| 12 | `bde9df5` | shadcn primitives typed — Popover, Switch, Slider gained the standard forwardRef typing pattern + `@ts-check`. Partial unlock: 3 of 6 v3/shell holdouts have reduced error counts (Popover/Slider fixed); Switch quirk remains (Radix `ComponentPropsWithoutRef` issue). | +9 | test:uiV3Store 63/63 |

Total: 12 substrate commits + 1 revert + 2 new memory files. All pushed
to origin/master.

## The @ts-check sweep — what got typed

**Before** (start of session): `src/io/live2d/` had ~14 files under
`// @ts-nocheck`. `src/v3/shell/` had ~15 JSX files under bypass.

**After** (end of session): zero `@ts-nocheck` files in
`src/io/live2d/{can3,moc3,cmo3,xmlbuilder.js}` (42 files total).
9/15 v3/shell JSX files typed; 6 holdouts remain (need narrower
shadcn typing + local component prop optional markers).

The sweep had two cascading unlocks:

1. **XmlBuilder tuple typing** (`0c73b30`) — declaring
   `shared(tag): [XmlNode, string]` instead of letting TS infer
   `(XmlNode | string)[]` polluted every cmo3 destructure
   `[, pidFooGuid] = x.shared(...)`. Fixing it once narrowed
   guids everywhere → cascaded into the mass `string|number`
   narrowing sweep (`8e8e814`).

2. **shadcn forwardRef typing** (`bde9df5`) — declaring
   `Foo: ForwardRefExoticComponent<ComponentPropsWithoutRef<...> &
   RefAttributes<...>>` instead of the implicit `forwardRef<unknown, {}>`
   inference unblocked consumer JSX files. Standard shadcn TS pattern.

## Cross-slice learnings

### Speculative defensive code violates RULE №1 (the 578540e lesson)

The variantNormalizer prune extension *looked* right — Slice 3's
audit had said "separate slice if reference-counting needs to
propagate to every node-mutation path." So I extended the prune to
`normalizeVariants`, which has 2 explicit `delete node.variantSuffix`
sites. Shipped.

Blender-fidelity audit (after-the-fact) caught: all 3 callers of
`normalizeVariants` (`PsdImportService.applyRig`, `cmo3Import`,
`CanvasViewport`) run during the wizard flow, BEFORE `seedAllRig`
populates `project.eyeClosureParabolas`. `RigService.refitAll`
doesn't call `normalizeVariants` either. → No current code path
triggers the orphan scenario. → The prune is dead code targeting a
hypothetical. → Reverted.

New rule saved as memory:
[[verify-mutation-path-before-prune]] — before extending a
reference-counting prune to a new call site, walk the actual call
chain. If the site doesn't run post-substrate-population in any
current code path, the prune is dead code. Either don't add it, or
add it at a different call site that does run post-substrate.

### The dual-audit ceremony catches "shipped-then-revealed-dead" too

The 578540e dual-audit ran AFTER the commit (I forgot to run it
pre-commit per the convention). The Blender-fidelity audit was the
one that caught the dead-code issue. Without the late audit, the
prune would have stayed in master indefinitely.

Lesson: the dual-audit-after-every-phase-ship rule applies even to
"small follow-on" commits. The reverted commit was 71 LOC — exactly
the "feels too small to bother auditing" size. Audit anyway.

### One typed primitive cascades to many consumers

The `XmlBuilder` tuple typing fix (10 LOC) cascaded into:
- 80 LOC of `string|number` → `string` narrowing across 14 cmo3 files
- 3 of 3 cmo3 holdouts unblocked (combined with typedef extensions)
- Caught + fixed 1 wrong `@returns` type that had been wrong since
  the file was extracted from cmo3writer.js months ago

Same shape for shadcn: typing 3 primitives cascaded into 3 of 6
v3/shell holdouts dropping their error counts.

Lesson: when typing a codebase, prefer typing the primitives (XML
builder, shadcn forwardRef components, base map types) over typing
each consumer. One foundation fix often unlocks many.

### Stale cites drift fast across multi-slice plans

The cite-refresh commit (`106f527`) found 2 cross-file
`selectRigSpec.js:<line-range>` cites that went stale across the
M3.1/M3.2/M3.3/M4 slices + this session's reproject-abort. Line
numbers shifted by ~150 net.

Replaced both with search-anchor cites
(`selectRigSpec._buildArtMeshes` "Pre-rig fallback") — stable
across future line shifts.

Lesson: for cross-file cites in long-lived comments, prefer
search-anchors (function name + comment substring) over line ranges.
Line ranges go stale fast in actively-developed files.

## Memory updates

New memory files persisted (in user's `~/.claude/.../memory/`):
- `project_rule4_modifier_toggle_reproject_abort.md` — the reproject-abort
  fix (with 4 byte-verified Blender cites).
- `feedback_verify_mutation_path_before_prune.md` — the RULE №1
  lesson from the reverted variantNormalizer prune.

MEMORY.md index updated:
- Added reproject-abort + verify-mutation-path entries
- Corrected UI Slice E status (was "queued", actually shipped 2026-05-20)
- Net size: 44.8 KB → 24.7 KB (44% reduction earlier in session
  brought it under the load threshold; the additions kept it there)

## Test suite status (post-session)

All adjacent suites green:
- selectRigSpec: 85/85 (was 75/75 + new reproject-abort contracts)
- shelbyByteFidelity: 23/23 (moc3 + cmo3 export bytes intact across
  every type-check sweep)
- actionExportCan3: 30/30 (can3 export pipeline intact)
- xmlbuilder: 37/37
- footerStatus: 39/39
- uiV3Store: 63/63
- modifierStacks: 49/49
- eyeClosureVariantPrune: 15/15 (Contract 8 reverted with the rest)
- depgraphSideBySide / depgraphSideBySideRotationParent / depgraphLattice / chainEval: all green

Typecheck: clean throughout the session (every commit verified).

## Remaining open items (need user direction)

Per Pelmentor-as-agent triage (called twice this session):

| Item | Status |
|------|--------|
| UI Slice E (workspace↔mode) | ✅ Already shipped (`91873d0`, 2026-05-20); browser-verify pending |
| Leak #3 variant fade | ⏸ Needs UX scope (fade-curve UI design) |
| Leak #4 neck cornering | ⏸ Skip — confirmed low payoff per audit |
| Easing-field deep retirement | ⏸ Skip — resolved-by-analysis stands (would regress per RULE №1) |
| Modifier-toggle math fix | ⏹ `1ada7b2` shipped then **REVERTED** `675912b` (2026-05-24) — re-fix needs fresh-Init-Rig fixture coverage |
| variantNormalizer prune | ⏹ Reverted — dead code per the new lesson |
| 6 v3/shell JSX @ts-nocheck holdouts | ⏸ Need narrower shadcn typing (Button, Select, ContextMenu) + local component prop optional markers (PlaybackControls' `active`/`max`, ToolSettingsPanel's `unit`) |
| Switch typing quirk | ⏸ Radix `ComponentPropsWithoutRef` evaluates oddly even with the standard pattern; needs investigation |

## Resume hint for compact

The Live2D emit pipeline is now fully type-checked. Genuinely-open
work that needs user direction:

1. **6 v3/shell JSX @ts-nocheck holdouts** — could ship via either:
   - Type more shadcn primitives (Button, Select, ContextMenu) +
     fix local component prop signatures. Probably 30-60 LOC,
     audit-able as one slice.
   - Investigate the Switch/Radix `ComponentPropsWithoutRef` quirk
     (might be a tsconfig/lib issue).

2. **Leak #3 variant fade** — UX-blocked. Needs fade-curve UI
   design from user.

3. **Browser verification debt** — UI Slices B/C/D/E shipped but not
   browser-verified. Could be batched into a verification session.

4. **Anim Phase 4 SHIP-COMPLETE promotion** — substrate complete;
   needs the Slice 4.G manual checklist run (per
   `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`).

All work on `master`, pushed to `origin/pelmentor`. Working tree
clean as of session close. Full test suite green. Typecheck clean.

## Authorship breakdown (RULE №5)

- 12 Claude-authored substrate commits (mechanical refactor / new
  migrations / observability / fixture updates / audit-fix close-outs /
  type-check sweeps): `1ada7b2` (later REVERTED `675912b`), `106f527`,
  `0687179` (revert), `200f805`, `82962ab`, `6ad7ffa`, `cb39d87`,
  `0c73b30`, `8e8e814`, `b970ef8`, `24ae93f`, `bde9df5`.
- 1 Claude-authored revert (Day 2, 2026-05-24): `675912b` reverts
  `1ada7b2` after user reported Init-Rig invisible-parts regression.
  Per RULE №5 alternation (last commit `5c512e9` was Pelmentor).
- 1 Pelmentor-authored commit (THIS session-aggregate doc — user-
  steered session via repeated "Go" / "ask agents like they're me"
  + scope decisions on what to ship next post-RULE-№4-closeout).
