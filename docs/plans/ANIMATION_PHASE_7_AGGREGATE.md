# Animation Phase 7 — Phase Aggregate (Insert Keyframe + Keying Sets)

**Status:** **SHIP-COMPLETE 6/6 slices** as of 2026-05-20.
**Schemas touched:** none (Phase 7 has no schema bumps; all new
fields use the sparse-storage idiom per Rule №2).
**Date opened:** 2026-05-19 (Slice 7.A first commit `2ebefe4`).
**Date closed:** 2026-05-20 (Slice 7.F this commit).
**Net duration:** ~2 calendar days (plan budget was 3–5 days).

This aggregate rolls up Slices 7.A → 7.F covering Blender's `I`-key
parity: the keying-set registry, the Insert Keyframe kernel, the
I-key menu UI, the auto-key mode parity, the K-key first-use
toast, and (this slice) the test sweep + exit gate.

For per-slice detail, see the six session close-outs in
`docs/plans/SESSION_CLOSEOUT_2026_05_*_ANIMATION_PHASE_7_SLICE_*.md`
and the two session aggregates in
`docs/plans/SESSION_AGGREGATE_2026_05_*_PHASE_7_*.md`.

---

## What ships

### Public API surface (new exports)

| Module                                | Export                                                                 | Slice |
|---------------------------------------|------------------------------------------------------------------------|-------|
| `src/anim/keyingSets.js`              | `BUILTIN_KEYING_SET_IDS`, `getKeyingSet`, `listKeyingSets`, `getActiveKeyingSet`, `setActiveKeyingSet`, `collectChannels`, `addKeyingSet`, `removeKeyingSet`, `cloneKeyingSet` | 7.A   |
| `src/anim/insertKeyframe.js`          | `INSERTKEY_FLAGS`, `applyKeyingSet`, `wouldApplyKeyingSetChange`        | 7.B   |
| `src/anim/keyingSetDefault.js`        | `pickDefaultKeyingSet`                                                 | 7.C   |
| `src/anim/insertKeyframeResolver.js`  | `buildLiveResolver` (closes 7.B MED-3 trap with live param values)     | 7.C   |
| `src/v3/operators/insertKey.js`       | `registerInsertKeyOperators`, `execApplyKeyingSet`                     | 7.C   |
| `src/v3/shell/KeyingSetMenu.jsx`      | `<KeyingSetMenu>` popover (lazy-mounted via `editMenuStore`)           | 7.C   |
| `src/anim/autoKeyDispatch.js`         | `AUTOKEY_MODES`, `getAutoKeyMode`, `pickActiveSetIdForAutoKey`, `runAutoKey` | 7.D   |
| `src/store/preferencesStore.js`       | `kKeyFirstUseShown`, `setKKeyFirstUseShown` (sparse boolean pref)      | 7.E   |

### Sparse schema fields (no migration; Rule №2)

| Field                              | Default coalescing       | Slice |
|------------------------------------|--------------------------|-------|
| `project.activeKeyingSetId?: string \| null` | `null`         | 7.A   |
| `project.keyingSets?: KeyingSet[]`           | `[]`           | 7.A   |
| `project.autoKeyMode?: 'all' \| 'activeSet' \| 'available'` | `'all'` | 7.D |
| `preferences.kKeyFirstUseShown: boolean`     | `false` (localStorage `v3.prefs.kKeyFirstUseShown`) | 7.E |

### Keybindings (new in default keymap)

| Chord  | Operator                  | Behavior                                          | Slice |
|--------|---------------------------|---------------------------------------------------|-------|
| `I`    | `insertKey.menu`          | Open Keying Set popover at cursor                 | 7.C   |
| `K`    | (legacy — unchanged)      | Insert all properties on selection + first-use toast | 7.E |

### UI surfaces (new)

- **`<KeyingSetMenu>`** — Radix-free popover, opens at cursor on
  `I`, lists 7 built-ins + user-defined sets in canonical order,
  default-picked entry is bold, active set has `•` bullet,
  user-defined sets badged "USER".
- **`<AutoKeyModeDropdown>`** — chevron flush-right of AutoKey
  toggle in `<PlaybackControls>`, RadioGroup with 3 modes,
  sparse-write semantics (picks `'all'` deletes the field),
  `{skipHistory: true}` per Blender's user-pref-not-undo storage.
- **K-toast** — first manual K-press emits a toast pointing to the
  I-menu; auto-key triggered K-events skip via `__ssAutoKey`
  sentinel.

---

## Per-slice rollup

### Slice 7.A — Keying Set registry ✅ SHIPPED 2026-05-19

**Commits:** `2ebefe4` (substrate) + `768d25c` (audit-fix) + `3d0b049`
(close-out).

**Substrate.** 1 new module (`src/anim/keyingSets.js` ~370 LOC) + 1
new test (`scripts/test/test_keyingSets.mjs` 144 asserts after
fixes).

**Built-in sets registered.** 7 built-ins. The 5 ported entries
preserve the relative order they appear in Blender's
`keyingsets_builtins.py:647-670` `classes` tuple (Available →
Location → Rotation → Scaling → LocRotScale; SS skips Blender's
LocRot / LocRotScaleCProp / LocScale / RotScale / Delta* / Visual*
/ BendyBones / WholeCharacter[Selected] entries — 18 omitted).
`BlendShape` + `AllParams` are SS-original (DEV 24 + DEV 25) and
sit at the tail of the menu.

> Audit-fix LOW-F sweep #83-F (2026-05-20): pre-fix wording
> "matches Blender canonical menu order" overclaimed — the cite
> range points to the full 23-entry tuple from which SS subsets.

**DEVIATIONS added.** DEV 20 (Scaling id vs Scale label), DEV 21
(per-component Scaling for bones), DEV 22 (Euler-only Rotation),
DEV 23 (Available filters non-owner paths per shared-action),
DEV 24 (BlendShape SS-original), DEV 25 (AllParams SS-original).

**Audit sweep #78.** 2 HIGH-F + 2 MED + 4 LOW. **Cite-discipline
streak from Phase 6 BROKEN** at 2 HIGH-F fab cites (post-fix:
`anim_sys.cc:1473-1490`, `_keyingsets_utils.py:157-160`). Rules 9
(re-OPEN every cite per same-session file open) added.

---

### Slice 7.B — Insert Keyframe kernel ✅ SHIPPED 2026-05-19

**Commits:** `5bd0982` (substrate) + `de91759` (audit-fix) + `577ebdd`
(close-out).

**Substrate.** 1 new module (`src/anim/insertKeyframe.js` ~330 LOC) +
1 new test (`scripts/test/test_insertKeyframe.mjs` 87 asserts after
fixes).

**Kernel API.** `applyKeyingSet(project, setId, objectIds, time, flags, options)`
with `{ resolveValue: (path) => number }` callback (closes the
"who reads the current value" abstraction so Slice 7.C can hand in
live param-values from `paramValuesStore`).

**Flag semantics.** `INSERTKEY_FLAGS` frozen object mirrors Blender's
bit values at `DNA_anim_enums.h:501-523`: `NOFLAGS=0` (`:501`),
`NEEDED=1<<0=1` (`:503`), `REPLACE=1<<4=16` (`:511`),
`AVAILABLE=1<<10=1024` (`:523`). Combinable via bitwise OR.

> Audit-fix MED-F sweep #83-F (2026-05-20): pre-fix range was
> `:503-523`, missing the `NOFLAGS=0` line at `:501`.

**Per-channel result statuses.** `created-fcurve`, `inserted`,
`replaced`, `skipped-needed`, `skipped-replace`, `skipped-available`,
`skipped-no-action`, `skipped-non-finite`, `skipped-invalid-path`.

**DEVIATIONS added.** DEV 26 (TIME_EPSILON_MS=0.5 boundary),
DEV 27 (`__params__` paths route to `__scene__`'s action — closes
"where do project-wide param fcurves live" question), DEV 28 (free
bezier handle preservation across replace — matches Blender's
`replace_bezt_keyframe_ypos` at `animrig/intern/fcurve.cc:149-164`,
literal comment at `:151` *"Just change the values when replacing,
so as to not overwrite handles."*), DEV 29 (REPLACE no-fcurve falls
through to `skipped-replace` rather than creating).

> Audit-fix HIGH-F sweep #83-F (2026-05-20): pre-fix cite was
> `anim_sys.cc:1473-1490` (inherited from 7.A's audit-fix without
> rule-9 re-OPEN). That range is inside
> `nlaevalchan_get_default_values()` (NLA mix-mode dispatch) —
> unrelated to replace_keys logic. The retroactive break means the
> 7.A audit-fix's "post-fix" was itself fab; cite-discipline arc
> below reflects this correction.

**Audit sweep #79.** 1 HIGH-F + 1 MED + 5 LOW. **Cite-discipline
regression confirmed multi-slice.** Rules 10 + 11 added (literal-
source-value for constants; "comment says X" promotes X to
byte-quotation).

---

### Slice 7.C — I-key menu + resolver + picker ✅ SHIPPED 2026-05-19

**Commits:** `4643dc3` (substrate) + `57f2bb2` (audit-fix) + `0112b9e`
(close-out).

**Substrate.** 4 new modules (`keyingSetDefault.js`,
`insertKeyframeResolver.js`, `insertKey.js`, `KeyingSetMenu.jsx` —
~505 LOC total) + 1 new test (`scripts/test/test_keyingSetMenu.mjs`
69 asserts after fixes) + 5 modified call-site files.

**Default-picker logic** (`pickDefaultKeyingSet`). BlendShape-mode
wins → `'BlendShape'`; otherwise LAST→FIRST selection walk; bone →
`'Rotation'`; mesh → `'LocRotScale'`; empty → `null`.

**Live-resolver** (`buildLiveResolver`). Regex
`^objects\["__params__"\]\.values\["([^"]+)"\]$` matches the emitter
at `keyingSets.js:204`; NaN/Infinity live values fall through to
default. Closes the 7.B MED-3 trap where `evaluateRnaPath` returned
STATIC `project.parameters[*].default` for `__params__` paths.

**Operator wiring.** `registerInsertKeyOperators` registers
`insertKey.menu` (opens popover via `editMenuStore.openKeyingSet`)
+ `insertKey.applySet` (dispatched via menu click). KeyMap binding
`'KeyI': 'insertKey.menu'` in `src/v3/keymap/default.js`.

**DEVIATIONS added.** DEV 30 — SS's I/K mapping inversion from
Blender. Blender Object Mode: I = `keyframe_insert` (last-used set,
non-pie default), K = `keyframe_insert_menu` (`always_prompt=True`).
SS Phase 7: I opens the menu (no last-used-set memory yet), K stays
on legacy "insert all".

**Audit sweep #80.** 0 HIGH + 0 MED + 1 LOW (test gap on operator
wiring). **Cite-discipline streak RESTARTED** at 0/0/0 across 9
cites. Rules 9 + 10 + 11 held.

---

### Slice 7.D — Auto-key mode parity ✅ SHIPPED 2026-05-19

**Commits:** `26e53ce` (substrate) + `3022543` (audit-fix) + `7cd7e74`
(close-out).

**Substrate.** 1 new module (`src/anim/autoKeyDispatch.js` ~165 LOC)
+ 1 new test (`scripts/test/test_autoKeyDispatch.mjs` 48 asserts) +
4 modified UI/trigger sites (`<PlaybackControls>` dropdown,
`<SkeletonOverlay>` bone drag, `<GizmoOverlay>` handle drag,
`<CanvasViewport>` canvas-direct drag — the last was audit-fix H-2
caught by sweep #81).

**Mode dispatcher.** `runAutoKey(project)` reads `project.autoKeyMode`
(sparse, default `'all'`), dispatches by mode:
- `'all'` → synthetic `KeyboardEvent('keydown', {key:'K'})` routes
  through legacy K-key handler (retains pre-existing 170-line fan-
  out at `CanvasViewport.jsx:1457-1633`)
- `'activeSet'` → `execApplyKeyingSet(activeOrLocRotScale)` direct
- `'available'` → `execApplyKeyingSet('Available')` direct

**DEVIATIONS added.** DEV 31 — `'available'` mode dispatches to the
`'Available'` built-in set rather than setting
`INSERTKEY_FLAGS.AVAILABLE` on an unfiltered emit. Structurally
cleaner; semantically equivalent.

**Audit sweep #81.** 2 HIGH + 3 MED + 1 LOW. H-1 `e.target?.tagName`
optional chaining; H-2 missed canvas-direct trigger site; M-1
`AUTOKEY_MODES.includes` membership check; M-2 ParamRow gap doc;
M-3 `skipHistory` on mode setter; L-1 test §5.1 scope comment.
**Cite-discipline streak EXTENDED** 1 → 2 at 0/0/0 across 9 cites.

---

### Slice 7.E — K-key first-use toast ✅ SHIPPED 2026-05-20

**Commits:** `49a4239` (substrate) + `fa6b462` (audit-fix) + `e9ccfba`
(close-out).

**Substrate.** 3 modified files (`preferencesStore.js`,
`CanvasViewport.jsx`, `autoKeyDispatch.js`) + 1 new test
(`scripts/test/test_kKeyFirstUseToast.mjs` 22 asserts after fixes).
~99 LOC + 22 asserts; no new DEVs.

**Pref + setter.** `preferences.kKeyFirstUseShown: boolean` (default
`false`, persists to `localStorage` at `v3.prefs.kKeyFirstUseShown`)
+ `setKKeyFirstUseShown(v) → void` setter.

**Toast.** Emits on FIRST K-press in animation mode AFTER guards
pass (preview / editable / animation-mode / actions / selection) and
BEFORE the recipe runs. Title "K — Insert all properties";
description points to the I-menu with real built-in labels.

**`__ssAutoKey` sentinel.** Synthetic K events from `runAutoKey('all')`
carry `__ssAutoKey: true` expando (plain assignment per Safari ≤14
compat). The K-key handler skips the toast when `e.__ssAutoKey` is
set — auto-key drag never shows the toast (user never pressed K
manually).

**Scope decision.** MVP only. Plan §7.E's optional "K rebinds to
I-default-set" preference deferred to §7.F+ because extracting the
170-line legacy K-key fan-out into a pure helper is non-trivial
test surface.

**Audit sweep #82.** 0 HIGH + 2 MED + 2 LOW. MED-1 real built-in
label in toast; MED-2 plain expando for Safari compat; LOW-1
descriptor pin updated; LOW-2 exact-key assertion. **Cite-discipline
streak EXTENDED** 2 → 3 at 0/0/0 across 3 carry-over cites.

---

### Slice 7.F — Test sweep + Phase 7 exit gate ✅ SHIPPED 2026-05-20

**Commits:** this commit.

**Substrate.** 0 new code files; 3 new docs + plan banner update:

- `docs/plans/ANIMATION_PHASE_7_COVERAGE_AUDIT.md` — per-row
  subsumption verification that all 5 plan §7.F prescribed test
  filenames (`test_keyingSet_builtin.mjs`,
  `test_keyingSet_userDefined.mjs`, `test_insertKeyframe_replace.mjs`,
  `test_insertKeyframe_onlyNeeded.mjs`, `test_autoKey_keyingSet.mjs`)
  are subsumed by the 5 existing suites at strictly higher coverage
  breadth.
- `docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md` — user-facing
  checklist covering §1 keying-set registry surfaces, §2 Insert
  Keyframe kernel happy paths, §3 I-key menu UI, §4 auto-key mode
  dropdown, §5 K-key first-use toast, §6 cross-slice gate semantics.
- `docs/plans/ANIMATION_PHASE_7_AGGREGATE.md` (this doc) — phase
  rollup.
- Plan §Phase 7 banner update from "Slice remaining: 7.F" → "Phase
  7 SHIP-COMPLETE 6/6".

**Coverage audit conclusion.** Zero new test files needed; 7.F's
substrate is documentation + exit gate. The 5 existing suites total
**370 asserts** — strictly broader than the prescribed 5 single-
purpose files would have shipped.

**Manual checklist authoring.** Models after Phase 6's
`ANIMATION_PHASE_6_MANUAL_CHECKLIST.md` structure. Documents 3
known gaps (K-rebind preference deferred, param-row auto-key
bypass, no active-set UI yet).

**No new DEVs.** No new audit sweep — 7.F is meta-work.

---

## Aggregate test coverage

| Suite                              | Asserts | Slice | Net-new behavior tested |
|------------------------------------|---------|-------|-------------------------|
| `test_keyingSets.mjs`              | 144     | 7.A   | Registry shape + 7 built-in collection + user CRUD + active pointer + listing |
| `test_insertKeyframe.mjs`          | 87      | 7.B   | Kernel + 4 flag bits + 9 result statuses + bone routing + handle preservation |
| `test_keyingSetMenu.mjs`           | 69      | 7.C   | Menu listing + default-pick + operator integration + 4 guards |
| `test_autoKeyDispatch.mjs`         | 48      | 7.D   | Mode dispatcher + sparse coalescing + 3-mode end-to-end via store |
| `test_kKeyFirstUseToast.mjs`       | 22      | 7.E   | Pref roundtrip + persistence + sentinel tag + descriptor pin |
| **Total Phase 7 net-new asserts**  | **370** |       |                         |

All 5 suites wired into the `npm test` master chain at
`package.json:328`.

---

## DEVIATIONS added in Phase 7

| #  | Slice | Description |
|----|-------|-------------|
| 20 | 7.A   | Scaling id vs Scale label (Blender keyingsets_builtins.py:29 + :73) |
| 21 | 7.A   | Per-component Scaling for bones (matches per-axis fcurve granularity) |
| 22 | 7.A   | Euler-only Rotation (SS bone rotation is single-channel, not quaternion) |
| 23 | 7.A   | Available filters non-owner paths per shared-action attribution |
| 24 | 7.A   | BlendShape built-in SS-original (Blender has no analog) |
| 25 | 7.A   | AllParams built-in SS-original (Blender uses `__scene__`-style scoping) |
| 26 | 7.B   | TIME_EPSILON_MS=0.5 boundary for same-key detection |
| 27 | 7.B   | `__params__` paths route to `__scene__`'s action |
| 28 | 7.B   | Free bezier handle preservation across replace (matches Blender) |
| 29 | 7.B   | REPLACE no-fcurve falls through to `skipped-replace` |
| 30 | 7.C   | SS I/K mapping inversion from Blender (I=menu, K=insert-all) |
| 31 | 7.D   | Auto-key `'available'` dispatches to set (cleaner than flag-on-emit) |

12 new DEVIATIONS across Phase 7.

---

## Cite-discipline narrative (Phase 7)

| Slice | Pre-audit fabs            | Post-audit | Notes                                      |
|-------|---------------------------|------------|--------------------------------------------|
| 7.A   | 2 HIGH-F + 2 MED          | 1 HIGH-F leaked retroactively | **Streak BROKEN** (from Phase 6's 4-clean); 7.A audit-fix's "post-fix" cite (`anim_sys.cc:1473-1490`) itself fab — discovered in 7.F audit-fix sweep #83-F |
| 7.B   | 1 HIGH-F + 1 MED          | 0          | Multi-slice regression confirmed; inherited the 7.A post-fix fab unwittingly |
| 7.C   | 0 / 0 / 0 across 9 cites  | 0          | **Streak RESTARTED**; rules 10+11 held     |
| 7.D   | 0 / 0 / 0 across 9 cites  | 0          | **Streak EXTENDED 1 → 2**                  |
| 7.E   | 0 / 0 / 0 across 3 carry  | 0          | **Streak EXTENDED 2 → 3**                  |
| 7.F (substrate) | 0 new cites; inherited 7.A post-fix fab into 3 doc sites without rule-9 re-OPEN | **1 HIGH-F + 1 MED-F + 1 LOW-F** caught in own audit sweep | **Streak BROKEN at 7.F** — meta-work slices still carry rule 9 obligation to re-OPEN inherited cites |
| 7.F (audit-fix) | n/a — fix sweep   | 0          | All 3 fidelity findings fixed; correct cite `animrig/intern/fcurve.cc:149-164` re-located via grep + walk |

**Rules added during Phase 7:**
- **Rule 9** (added during 7.A audit) — Re-OPEN every cite per
  same-session file open. Caught the 2 HIGH-F fabs only after
  audit; goal: catch pre-ship.
- **Rule 10** (added during 7.B audit) — Literal source value for
  constants/defaults/thresholds. Don't trust an inherited "value
  is X" claim without re-reading the file.
- **Rule 11** (added during 7.B audit) — "Comment says X" promotes
  X to byte-quotation. The comment is content; verify the content
  before quoting.

**Rule 9 generalisation owed (from 7.F):** even meta-work slices
that author no new cites must re-OPEN every inherited cite that
they propagate into a new document. The 7.F substrate authored 3
new docs that all inherited the `anim_sys.cc:1473-1490` cite from
7.A's audit-fix memory without re-OPEN — sweep #83-F caught the
leak retroactively. Track as a feedback memory upgrade: rule 9
explicitly covers doc-level cite carry-over, not just substrate
authoring.

**Final Phase 7 cite-discipline:** 3-clean streak (7.C + 7.D + 7.E)
post-regression; 7.F substrate broke it via inherited carry-over fab;
7.F audit-fix resolved it. Net Phase 7: 3 ships clean, 3 ships had
cite errors (7.A, 7.B, 7.F substrate), all errors fixed in same-day
audit-fix commits.

---

## Audit sweeps in Phase 7

| Sweep | Slice | Architecture          | Blender-fidelity            |
|-------|-------|-----------------------|------------------------------|
| #78   | 7.A   | 0 HIGH / 2 MED / 4 LOW | 2 HIGH-F + 1 MED-F           |
| #79   | 7.B   | 0 HIGH / 1 MED / 5 LOW | 1 HIGH-F + 1 MED-F           |
| #80   | 7.C   | 0 HIGH / 0 MED / 1 LOW | 0 / 0 / 0 across 9 cites     |
| #81   | 7.D   | 2 HIGH / 3 MED / 1 LOW | 0 / 0 / 0 across 9 cites     |
| #82   | 7.E   | 0 HIGH / 2 MED / 2 LOW | 0 / 0 / 0 across 3 cites     |
| —     | 7.F   | (meta — no audit needed) | (no new cites)             |

All findings fixed in the same-day audit-fix commit per
`feedback_dual_audit_after_phase_ship`.

---

## Architectural patterns established in Phase 7

1. **Sparse-field schema idiom.** Three new fields
   (`activeKeyingSetId`, `keyingSets`, `autoKeyMode`) all use
   missing-=-default storage. No migration; no v42→v43 bump. Read
   sites coalesce with `?? 'all'` or `?? null`. Rule №2 compliance.

2. **Mode-aware dispatcher pattern** (`runAutoKey`). Single entry
   point reads sparse mode field, dispatches to per-mode handler.
   Adding a 4th mode requires updating the `AUTOKEY_MODES` tuple
   + one switch case + one test section. Membership check
   derives from the exported tuple (no parallel literal list).

3. **Sentinel-on-synthetic-event pattern** (`__ssAutoKey`). When a
   handler is re-used for both manual and synthetic paths, tag the
   synthetic with an internal `__`-prefixed expando so the handler
   can branch. Plain assignment (not `Object.defineProperty`) for
   browser compat. Synchronously consumed; never serialized.

4. **Audit-driven scope deferral.** Plan §7.E had two clauses; 7.E
   shipped clause (a) only and deferred clause (b) to §7.F+ because
   implementing it would have ballooned scope past the slice's test
   surface. Documented in substrate commit + audit confirmed call.

5. **Live-resolver injection** (`buildLiveResolver`). Substrate
   modules expose `{ resolveValue: callback }` rather than reading
   from stores directly. Caller composes the live source from
   live store + falls through to default. Pure modules stay pure;
   live integration happens at the operator layer.

---

## Commits this phase (18 total)

```
2ebefe4 feat(anim): Phase 7 Slice 7.A — Keying Set registry substrate
768d25c fix(audit): Phase 7 Slice 7.A audit-fix — 2 HIGH-F cite + 2 MED + 4 LOW
3d0b049 docs(plan): Phase 7 Slice 7.A SHIPPED — Keying Set registry close-out (cite-streak BROKEN)
5bd0982 feat(anim): Phase 7 Slice 7.B — Insert Keyframe kernel + applyKeyingSet operator
de91759 fix(audit): Phase 7 Slice 7.B audit-fix — 2 HIGH + 6 MED + 5 LOW
577ebdd docs(plan): Phase 7 Slice 7.B SHIPPED — Insert Keyframe close-out (cite-regression confirmed multi-slice)
4494c88 docs(plan): Session aggregate 2026-05-19 — Phase 6 SHIP-COMPLETE + Phase 7 Slices 7.A + 7.B
4643dc3 feat(anim): Phase 7 Slice 7.C — I-key Insert Keyframe menu + KeyingSetMenu popover
57f2bb2 fix(audit): Phase 7 Slice 7.C audit-fix — 1 LOW (test coverage)
0112b9e docs(plan): Phase 7 Slice 7.C SHIPPED — I-key Insert Keyframe menu (cite-streak RESTARTED)
26e53ce feat(anim): Phase 7 Slice 7.D — Auto-key mode parity (all/activeSet/available) + UI dropdown
3022543 fix(audit): Phase 7 Slice 7.D audit-fix — 2 HIGH + 3 MED + 1 LOW
7cd7e74 docs(plan): Phase 7 Slice 7.D SHIPPED — Auto-key mode parity (streak EXTENDED 1→2)
49a4239 feat(anim): Phase 7 Slice 7.E — K-key first-use toast + __ssAutoKey sentinel
fa6b462 fix(audit): Phase 7 Slice 7.E audit-fix — 2 MED + 2 LOW
e9ccfba docs(plan): Phase 7 Slice 7.E SHIPPED — K-key first-use toast (streak EXTENDED 2→3)
4991662 docs(plan): Session aggregate 2026-05-20 — Phase 7 Slices 7.C + 7.D + 7.E
71b835b docs(plan): Phase 7 Slice 7.F SHIPPED — Test sweep + Phase 7 exit gate (SHIP-COMPLETE 6/6)
[this commit] fix(audit): Phase 7 Slice 7.F audit-fix — 1 HIGH-F + 1 MED-F + 1 LOW-F + 2 HIGH-A + 1 MED-A
```

---

## Top queued path

**Polish slices (post-Phase-7, optional):**

1. **§7.G — K-rebind preference** (extract the 170-line legacy
   K-key fan-out at `CanvasViewport.jsx:1457-1633` into a pure
   helper `writeAllKeyframesForSelection(project, time, ids)`;
   then `runAutoKey('all')` calls the helper directly instead of
   via synthetic dispatch, and the rebind preference deferred from
   7.E can ship cleanly).
2. **§7.H — Param-row auto-key parity** (close the `ParamRow.jsx`
   write path so it routes through `runAutoKey` and respects
   `project.autoKeyMode`; PHASE-7-GAP comment at the write site).
3. **§7.I — Active-set UI** (add a "Set Active" submenu to
   `<KeyingSetMenu>` so users can pick the active keying set
   without dev-console writes).

**Phase 8 (per plan §Phase 8) — Close-out, deprecations, telemetry,
baggage sweep.** Plan-prescribed; not blocked by Phase 7.

---

## User-side owed

- **Phase 6 manual checklist** — outstanding from prior session.
- **Phase 7 manual checklist** — authored this slice
  (`docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md`); ~20–30
  minutes; sign-off via "Phase 7 manual checklist green" in next
  session.
