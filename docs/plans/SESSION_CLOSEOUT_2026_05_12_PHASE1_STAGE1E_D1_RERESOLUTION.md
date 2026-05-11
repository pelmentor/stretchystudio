# Session Close-out — 2026-05-12 (Animation Phase 1 Stage 1.E D-1 RE-RESOLUTION sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md).
This sub-session **RE-RESOLVED** the Stage 1.E Audit-fix D-1
deferral: the original premise ("Blender's Animation panel lives in
the Data tab via `PropertiesAnimationMixin.bl_context = 'data'`; SS
needs a dedicated 'Animation' Properties tab") was a misread of
Blender. SS's existing Item-tab placement of `animData` IS the
Blender-faithful mirror via `OBJECT_PT_animation`. Two commits:
substrate (`dcb763d`) + audit-fix sweep (`7291845`). Both pushed to
`origin/master` after the close-out commit.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `dcb763d` | refactor(docs): Phase 1 Stage 1.E D-1 RE-RESOLUTION — Item tab placement IS Blender-faithful via `OBJECT_PT_animation`; drop dedicated-Animation-tab deferral. propertiesTabRegistry.jsx Item-tab JSDoc rewritten (cite OBJECT_PT_animation + ObjectButtonsPanel.bl_context + multi-tab landscape). AnimDataSection.jsx JSDoc gains "Blender mirror" section. ANIMATION plan §1.E animData entry rewritten. Past close-outs (1E, 1F-pre, 1F, 1F-post) annotated with RE-RESOLUTION banners. test_audit_fixes_2026_05_11_phase1_stage1e D-1 assertion updated. test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution NEW audit-pin (31 assertions). Wired into npm test chain. |
| `7291845` | fix(audit): Phase 1 Stage 1.E D-1 RE-RESOLUTION audit-fix sweep — HIGH doc-drift cluster (G-1..G-5 dedup'd) + 7 MED + 6 LOW. HIGH cluster: substrate's banner-only annotation left misread BODY recommendations intact in 4 past close-outs; bodies stripped + Recommended-order lines updated + STAGE1E.md audit-fix table cell + sweep paragraph annotated. MED: D-2 bl_order reframed (second-to-last in Blender), D-3 slot-selector deferral, D-4 bone-animation deviation callout, G-6 negative body-removal assertions in audit-pin, G-8 5.D tightened. LOW: G-10/D-1 count corrected ~16→20, G-11 dead code dropped, D-5/D-6/D-7/D-8/D-9 JSDoc precision improvements. Audit-pin extended 31→62 assertions. |

## What was the gap

The Stage 1.E Audit-fix sweep (`45371d5`, 2026-05-11) had docketed
D-1 as a HIGH→MED deferral with the rationale:

  > `animData` section in Item tab vs Blender Data tab. Doc the
  > deviation; queue dedicated Animation tab for Stage 1.F + Phase 2
  > entry-gate. SS Data tab is parts-only today (mesh/shapeKeys
  > gates), can't simply move.

The deferral note in `propertiesTabRegistry.jsx` read:

  > **Blender-fidelity deviation:** in Blender the Animation panel
  > lives under the **Data** tab via `PropertiesAnimationMixin.
  > bl_context = "data"`. … The cleaner long-term fix is a dedicated
  > "Animation" tab (peer of Item / Modifiers / Object Data).

The Stage 1.F-post close-out queued this as Resume Path B for the
next session. The dual-audit pattern for Stage 1.F-post had caught
17 unique gaps without flagging this deferral.

But Path B's premise was **wrong**. Three checks against
`reference/blender/scripts/startup/bl_ui/` proved it:

1. `PropertiesAnimationMixin.bl_context = "data"`
   (`space_properties.py:124`) is the mixin's *default*; every
   concrete subclass overrides it via its ButtonsPanel base.
2. `OBJECT_PT_animation` (`properties_object.py:618`) inherits
   `ObjectButtonsPanel` (`bl_context = "object"`, same file line 18)
   — Blender registers the Object-datablock's Animation panel on
   the **Object** tab, not the Data tab.
3. The Properties tab navigation enum (`tabs_attr_infos` in
   `space_properties.py:13-34`) contains no Animation tab. Blender
   has NO dedicated Animation tab.

For SS's Object selectables (parts + groups), `OBJECT_PT_animation`
→ Item tab IS the Blender-faithful mount. The dedicated-Animation-
tab plan would have been an SS-invented UI concept — a direct
violation of the user's strict feedback memory
(`feedback_blender_reference_strict.md`: "never invent modes/
datablocks/concepts. Check `reference/blender/source/blender/`
first; user pushed back hard 2026-05-07 after finding three SS-
invented modes").

## The conversion

### Substrate (`dcb763d`)

- **`propertiesTabRegistry.jsx` Item-tab JSDoc rewritten** (~40
  lines of new prose, ~25 lines old removed):
  - Drop "Blender-fidelity deviation" framing; reframe as "Blender
    mirror".
  - Cite `OBJECT_PT_animation` (`properties_object.py:618`) +
    `ObjectButtonsPanel.bl_context = "object"` (line 18) as the
    actual Blender mirror.
  - Document the multi-tab landscape: 7 of the 20 concrete subclasses
    listed with their ButtonsPanel base (OBJECT, DATA_PT_*_animation
    on Data tab, MATERIAL/WORLD/SCENE on their respective tabs).
  - Note `_animated_id_context_property = "object"` ↔ SS's per-Object
    `node.animData` parity.
  - Note `bl_label = "Animation"` + `bl_options = {'DEFAULT_CLOSED'}`
    ARE inherited from the mixin; only `bl_context` is overridden.
- **`AnimDataSection.jsx` JSDoc** gains:
  - "Blender mirror" section citing `OBJECT_PT_animation` + the
    multi-tab landscape brief.
  - "Bone-animation deviation" section documenting SS's per-bone-group
    binding as Cubism-runtime-driven divergence from Blender's per-
    Armature `DATA_PT_armature_animation` model.
  - "Blender-fidelity scope" section now cites the `template_action`
    half of `draw_action_and_slot_selector_for_id` (anim.py:8-30,
    template_action at line 18) and notes the `template_search` slot
    selector half is deferred to Phase 4 slotted-actions parity.
- **`ANIMATION_BLENDER_PARITY_PLAN.md` §1.E `animData` entry**: drop
  the "is in Data tab" / "awaits a dedicated Animation tab"
  assertion; replace with `OBJECT_PT_animation` citation pointing at
  this close-out doc.
- **Past close-outs** (1E + 1F-pre + 1F + 1F-post) annotated with
  "RE-RESOLVED 2026-05-12" banners pointing at this close-out.
- **`test_audit_fixes_2026_05_11_phase1_stage1e.mjs` D-1 assertion**
  updated: old regex `/PropertiesAnimationMixin\.bl_context/` →
  new `/RE-RESOLVED 2026-05-12.*OBJECT_PT_animation/`.
- **New audit-pin** `test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution.mjs`
  (31 assertions across 7 categories).

`CURRENT_SCHEMA_VERSION = 38` unchanged (doc-only change).
Net diff: 10 files, +340 / −32 (net +308 LOC, mostly JSDoc).

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `dcb763d`:

1. **Architecture audit** (13 gaps: G-1..G-13 — 5 HIGH, 4 MED, 4 LOW)
2. **Blender-fidelity audit** (11 gaps: D-1..D-11 — 0 HIGH, 4 MED, 7 LOW)

After cross-audit dedup, **17 unique gaps** total: HIGH cluster (5
raw → 1) + 7 MED (G-6/G-7/G-8/G-9 + D-2/D-3/D-4) + 6 LOW (G-10/D-1
+ G-11 + D-5/D-6/D-7/D-8/D-9). G-12+G-13+D-10+D-11 skipped as
cosmetic / pre-existing / false-alarm.

The HIGH cluster:

- **G-1+G-2+G-3+G-4+G-5 (Doc drift, same root pathology)**: the
  substrate had banner-only-annotated 4 past close-outs (Resume Path
  B/C had a "RE-RESOLVED 2026-05-12" banner inserted ABOVE the body).
  But the BODY underneath was unchanged: each close-out still
  literally said "Add a new top-level Properties tab `'animation'`",
  "Move `'animData'` out of the Item tab `sectionIds`", "Mirrors
  Blender's `PropertiesAnimationMixin.bl_context = "data"` more
  faithfully" — the exact misread the substrate rejected. Plus
  STAGE1E.md's audit-fix table cell + sweep paragraph + STAGE1F_PRE.md
  preamble + 3 Recommended-order lines all still steered toward the
  misread.

  This was the same shape as Stage 1.F-post's G-1+G-2+G-3+G-4 cluster
  (4 raw → 1 HIGH cluster). Banner-only annotation is incomplete
  when the body and steering metadata still recommend the rejected
  plan.

### Audit-fix sweep (`7291845`)

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1+G-2+G-3+G-4+G-5 | HIGH cluster | Architecture | (G-1) Strip Resume Path B/C bodies in 4 past close-outs — replace bullet recommendations with "do not do this" stub citing RE-RESOLUTION. (G-2) Update Recommended-order lines: STAGE1E.md "A → B → C" → "A → B"; STAGE1F_PRE.md "A → B → C" → "A → C"; STAGE1F.md "A → (B \|\| C) → D" → "A → C → D". (G-3) STAGE1E.md audit-fix table cell for D-1 annotated with RE-RESOLVED + corrected framing. (G-4) STAGE1E.md audit-fix-sweep paragraph annotated. (G-5) STAGE1F_PRE.md preamble line updated. |
| G-6 | MED | Architecture | Audit-pin block 7 extended with negative body-removal assertions per past close-out (3 misread-phrase patterns × 4 docs = 12 new negative assertions). Banner-only annotation would now FAIL the pin. |
| G-7 | MED | Architecture | "Per Audit-fix D-1 deferral note in [propertiesTabRegistry.jsx]" intro lines: removed by G-1 body strip. The link previously landed on a comment that contradicted the introducing text. |
| G-8 | MED | Architecture | Audit-pin test 5.D tightened from OR-over-4-alternatives to count-floor (≥2 of 8 peer subclass names must appear). Plus new 5.E (`_animated_id_context_property = "object"` citation), 5.F (bone-animation deviation), 5.G (slot-selector deferral). |
| G-9 | MED | Architecture | Multi-tab landscape duplication across propertiesTabRegistry + AnimDataSection: accepted as intentional per-file self-containment; the duplication is audit-pinned to keep both in sync (audit-pin blocks 3 + 5 check both files independently). |
| D-2 | MED | Blender-fidelity | propertiesTabRegistry "Last position" reframed — second-to-last in Blender (`bl_order = PropertyPanel.bl_order - 1 = 999`, OBJECT_PT_custom_props is last at 1000 — see `properties_object.py:622-628`); SS has no Custom Properties panel so the equivalent slot collapses to last-in-tab. |
| D-3 | MED | Blender-fidelity | AnimDataSection scope cites the `template_action` half (anim.py:18) of `draw_action_and_slot_selector_for_id`; the `template_search` slot selector (anim.py:25-30) is intentionally NOT mirrored — slotted-actions parity is deferred to Phase 4 (Blender 4.4+ multi-ID-per-Action sharing model). FCurves count noted as SS-only addition. |
| D-4 | MED | Blender-fidelity | AnimDataSection gains "Bone-animation deviation" section — Blender bones share Armature ID `animation_data` via `DATA_PT_armature_animation` (Data tab, `_animated_id_context_property = "armature"`); SS per-bone-group binding lets each bone reference its own Action — Cubism-runtime-driven divergence. |
| G-10+D-1 | LOW | Architecture+Blender-fidelity | "~16 subclasses" undercount corrected — actual is 20 concrete `XXX_PT_*_animation` subclasses across `properties_*.py` (METABALL, ARMATURE, LIGHTPROBE, MESH, LIGHT, LATTICE, SPEAKER, FREESTYLE, VOLUME, CAMERA, CURVES, GREASE_PENCIL, CURVE, MATERIAL_GPENCIL, MATERIAL, OBJECT, PARTICLE, SCENE, TEXTURE, WORLD). |
| G-11 | LOW | Architecture | Drop unused `existsSync` import + unused `assertEq` helper from new audit-pin. |
| D-5 | LOW | Blender-fidelity | Soften "SS conflates Object + ObData" — `meshData` IS a separate node type via v18+ `dataId` (see `objectDataAccess.js:161-189`); animData lives on the part's Object node regardless. New wording: "even where parts link to a `meshData` ID via v18+ `dataId`, animData lives on the part's Object node, not the linked meshData". |
| D-6 | LOW | Blender-fidelity | Latent Data-tab gap callout — if/when SS introduces an armatureData node in Data tab (mirroring Blender's Armature ID), that tab's Animation section should mirror `DATA_PT_armature_animation`, not `OBJECT_PT_animation`. |
| D-7 | LOW | Blender-fidelity | ButtonsPanel bases inlined alongside each subclass citation in propertiesTabRegistry: `OBJECT_PT_animation via ObjectButtonsPanel → Object tab`, `DATA_PT_armature_animation via ArmatureButtonsPanel → Data tab`, etc. — one-stop verification trail. |
| D-8 | LOW | Blender-fidelity | `_animated_id_context_property = "object"` parity citation added to both files — strongest parity signal, makes `context.object` ↔ `node.animData` mapping explicit. |
| D-9 | LOW | Blender-fidelity | bl_label / bl_options inheritance vs bl_context override distinction made explicit: "`bl_label = "Animation"` and `bl_options = {'DEFAULT_CLOSED'}` ARE inherited from the mixin — `bl_context` is the only field every subclass overrides". |

**Skipped (LOW cosmetic)**:
- G-12: heading rename to suffix "(RE-RESOLVED 2026-05-12)" — already
  in substrate; body strike-through (`~~text~~`) captures the intent.
- G-13: "placeholder, not the canonical mount-point" phrase
  duplication — same as G-9, accepted as per-file self-contained
  JSDoc.
- D-10: false-alarm (regex syntax fine, no actual bug).
- D-11: out-of-scope (pre-existing Stage 1.D Audit-fix G-16 claim).

**Audit-pin**: `test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution.mjs`
extended from 31 → 62 assertions across 13 categories (was 8). All
17 dedup'd gap blocks covered with:
- Module-source greps using `flatJsdoc` (handles `\n * ` JSDoc
  continuations + `\n // ` line continuations + CRLF normalisation)
- String-grep against `.jsx` (Node can't import JSX directly)
- Negative-assertion blocks for past close-outs (G-6 — 12 new
  negative-phrase patterns × 4 docs)
- Count-floor for peer-subclass citations (G-8 — ≥2 of 8 patterns
  must appear)
- Recommended-order regex checks (G-2 — exact reorder strings per
  past close-out)
- STAGE1E table-cell + sweep-paragraph regexes (G-3 / G-4)
- STAGE1F_PRE preamble regex (G-5)

Audit reports kept inline (no separate AUDIT_*.md files — close-out
table IS the canonical audit record, per Stage 1.D/1.E/1.F-pre/1.F/
1.F-post convention).

## Test scoreboard

All Stage 1.E D-1 RE-RESOLUTION-touched suites green. Sister Stage
1.E + 1.F + 1.F-post audit-pins still green (no behavioural churn).

| Suite | Assertions |
|-------|------------|
| `test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution` (NEW; extended in audit-fix) | 62 |
| `test_audit_fixes_2026_05_11_phase1_stage1e` (D-1 regex updated in substrate; no churn in audit-fix) | 40 |
| `test_audit_fixes_2026_05_12_phase1_stage1f_post` (no churn) | 39 |
| `test_audit_fixes_2026_05_11_phase1_stage1f` (no churn) | 44 |
| `test_propertiesSectionRegistry` (no churn) | 19 |
| `test_stage1e_actions_editor` (no churn) | 56 |
| `test_editorStore` (no churn) | 87 |

Typecheck clean.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (60 from 2026-05-11 + Stage 1.F-post close-outs through `a662343`) | Phases 0–7.D + Phase 1 Stages 1.A–1.F-post + 18 audit-fix sweeps + 13 close-out docs |
| 61    | `dcb763d` | refactor(docs): Phase 1 Stage 1.E D-1 RE-RESOLUTION — Item tab placement IS Blender-faithful via OBJECT_PT_animation |
| 62    | `7291845` | fix(audit): Phase 1 Stage 1.E D-1 RE-RESOLUTION audit-fix sweep (HIGH doc-drift cluster + 7 MED + 6 LOW) |
| 63    | (next)    | docs(plan): Stage 1.E D-1 RE-RESOLUTION close-out doc (this file) |

## Schemas after Phase 1 Stage 1.E D-1 RE-RESOLUTION

`CURRENT_SCHEMA_VERSION = 38` (unchanged from Stage 1.F-post — this
sub-session is doc-only; no migration, no UI surface change, no
runtime behavior change).

## Hotkey reservations

No new hotkeys. Phase 6 `I` reservation (Insert Keyframe) remains
queued.

## Phase 1 closing scoreboard (post Stage 1.E D-1 RE-RESOLUTION)

Phase 1 stages and follow-ups shipped through this 2026-05-12
sub-session:

| Stage | What | Commits | Close-out |
|-------|------|---------|-----------|
| 1.A + 1.B | Action datablock + AnimData migration (v36) | 4 | [STAGE1AB](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md) |
| 1.C | actionRegistry helpers + projectStore cascade | 3 | [STAGE1C](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md) |
| 1.D | `__scene__` pseudo-Object + sceneAction selectors (v37) | 3 | [STAGE1D](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md) |
| 1.E | ActionsEditor UI + 11-file activeActionId rewire | 3 | [STAGE1E](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md) |
| 1.F-pre | NodeTree retirement (v38 — V2 dual-write shadow gone) | 3 | [STAGE1F_PRE](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md) |
| 1.F | 4 new test files (138 substrate + 44 audit-pin assertions) | 3 | [STAGE1F](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md) |
| 1.F-post | Gap-tolerant walker + 5 shim deletions | 3 | [STAGE1F_POST](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md) |
| 1.E D-1 RE-RESOLUTION | Item tab placement IS Blender-faithful (Resume Path B re-resolved as no-implementation-needed) | 3 (this file) | (this file) |
| 1.G | Manual Cubism Viewer .moc3 byte-identity gate on Hiyori | (owed to user) | — |

**Phase 1 ship gate** = 1.G manual byte-identity test on Hiyori with
one keyframed Action. This sub-session (D-1 RE-RESOLUTION) is
decoupled polish that closes Rule №2 doc baggage on the Properties
animation panel narrative; doesn't move the Phase 1 ship gate.

## Resume paths for fresh session

The Phase 1 ship gate is unchanged from Stage 1.F's close-out — this
sub-session was a decoupled cleanup that doesn't gate Phase 1.

### A. Phase 1.G manual byte-identity gate on Hiyori (recommended next)

Per plan §1.G (line 741):

  > One Cubism Viewer .moc3 load on Hiyori with one keyframed Action.

User-driven test: load Hiyori `.cmo3`, create one Action via
ActionsEditor, add keyframes, bind to `__scene__`, export, open in
Cubism Viewer 5.0 + Cubism Editor 5.0 → Animation workspace.

### B. Phase 2 — BezTriple handles (1 week, schema v39)

Per plan §Phase 2 (lines 749+): replace per-segment `easing: string`
with per-keyframe Blender `BezTriple`-shape handles per
`DNA_curve_types.h:83-117`. Migration converts existing `easing`
field to BezTriple `handleType` + `handleLeft` / `handleRight` /
`interpolation` fields. Schema v39.

Blocks on Phase 1.G ship gate (1.G manual confirmation).

### Recommended order

A → B. Phase 1.G is the Phase 1 ship gate — everything else waits
for it. Stage 1.E's D-1 follow-up is RE-RESOLVED (this sub-session);
no implementation needed.

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 lines 419-742
- Stage 1.F-post close-out: [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md)
- Stage 1.F close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md)
- Stage 1.F-pre close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md)
- Stage 1.E close-out (source of D-1 deferral, now annotated): [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: Blender reference strict
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_blender_reference_strict.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
