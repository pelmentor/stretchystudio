# Upstream Parity Audit — Plan

**Status:** ✅ SHIPPED 2026-05-03 — see [UPSTREAM_PARITY_FINDINGS.md](UPSTREAM_PARITY_FINDINGS.md). Stage 0 (harness) + Stage 1 (classify) + Stage 3 (lock-in) landed; Stage 2 (fix drift) was a no-op because zero unintentional regressions were found across 4 fixtures (`minimal`, `two_groups`, `with_rig`, `shelby_like`). All structural diffs are documented intentional v3 changes (param `requireTag` gating, `ParamHairSide` removal, physics-rules resolver extraction) or cosmetic ordering.

Run: `npm run audit:upstream-parity [<fixture>]` (default `minimal`).

**Original (pre-shipped) status:** queued. Authored 2026-05-03 by user request after the Phase 2b investigation surfaced concerns about v3's heuristic vs authored rigs.

**Origin (user 2026-05-03):**
> can we properly check if our cmo3 and other modules are correct by observing the original cmo3 moc3 writers at /reference/stretchystudio-upstream...? И имеется ли смысл в этом? Если он реально есть тогда стоит это сделать должным образом (проверить) без костылей, с планом, с md доком.

## Why this matters

`shelby.cmo3` — our oracle baseline — was **produced by SS v0.2's writer** (the upstream codebase at [`reference/stretchystudio-upstream-original/`](../reference/stretchystudio-upstream-original/)). Cubism Editor + Viewer load it correctly; Body Angle X/Y/Z work. That makes upstream's cmo3/moc3 writer a **proven-correct reference**.

v3 inherited this writer and ran it through ~50 refactor sweeps:
- 5 god-classes split: `cmo3writer −76%`, `moc3writer −70%`, `can3writer −86%`, `cmo3Import −64%`, `cmo3PartExtract −61%`
- −6214 LOC lifted into 48 helper modules (per memory entry `project_v3_blender_refactor.md`)

It also acquired Cubism-port changes (Phase 1/2/3) and feature additions (eye-closure variant grid, variant normalizer, FaceParallax warp, idle motion generator, etc.).

**Concern:** is v3's writer output still byte-equivalent to upstream's for the cases that don't exercise v3-only features? If not, we have silent regressions.

The previous Phase 2b investigation also flagged that **v3's heuristic init rig differs from authored cmo3 data** — but that's the rigSpec layer, not the writer per se. This audit is about the write pipeline.

## Why it's worth doing

1. **Refactor regression net.** Splitting 5 god-classes is high risk; tests catch logic but not byte drift. Upstream is the only available "ground truth" we didn't write ourselves.
2. **Phase port semantic checks.** Phase 1 fixed a real bug (BUG-014 bottom-band branch). But the fix touched the warp eval kernel, which the writer also uses indirectly. Confirming nothing else moved is cheap insurance.
3. **Future refactor safety.** If we land more sweeps (e.g., the proposed init-rig refactor in `INIT_RIG_AUTHORED_REWRITE.md`), having an upstream-baseline diff harness would catch drift immediately.
4. **Tests against shelby aren't enough.** Test fixtures encode v3's expected output. They drift in lockstep with v3. Upstream is independent.

## Why this isn't trivial

Several v3 changes are **intentional and shouldn't byte-match upstream**:
- Phase 1 BUG-014 fix (bottom-band virtual cell layout)
- Phase 3 lifted-grid composition (changes lifted-bbox values in moc3 output)
- Eye-closure parabola fit (different keyform shapes for eye meshes)
- Variant normalizer + variant fade rules (different variant draw_order + opacity bindings)
- FaceParallax warp (entirely new deformer not in upstream)
- Body warp Y-extension (memory: `bodyWarp.js` modifications post-upstream)
- Compile-time field semantics (memory: `reference_moc3_compile_time_fields.md` — 3 fields v3 emits that upstream may not)
- 4-stage cascaded normalizer (`canvasToInnermost*` instead of `1/canvasMaxDim`)

So the audit needs to be **structural**, not raw-byte:
- Pick projects with minimal feature surface (no variants, no eye closure, simple body)
- Diff at the **decoded** XML / chunk level, not raw bytes
- Categorize each diff as **intentional** (document why) or **regression** (fix it)

## Plan

### Stage 0 — Set up the harness (½ day)

**Deliverables:**
1. `scripts/upstream_parity/diff_writers.mjs` — runs both upstream's writer and v3's writer on the same project, decodes both outputs, produces a structured diff.
   - Input: a PSD path or pre-built project JSON.
   - Loads upstream writer via dynamic import from `reference/stretchystudio-upstream-original/`.
   - Loads v3 writer from current source.
   - Emits both: `out_upstream.cmo3`, `out_v3.cmo3`, plus `out_upstream.moc3`, `out_v3.moc3`.
   - Decodes the cmo3 XML on both sides (we have `cmo3XmlParser.js`); produces field-level diff.
   - Decodes the moc3 binary on both sides; field-level diff.
2. A "minimal feature" reference PSD we can ship as a test fixture. **Candidate:** a single mesh with no variants, no eyes, no body chain — just to exercise the basic writer code paths. Or a PSD pulled from upstream's test fixtures if any exist.

**Verification gate:** running on the same project produces byte-identical output **after we mask out timestamps / GUIDs / non-deterministic parts**. This is the harness's "self-check" — both sides should agree on a canonical encoding.

### Stage 1 — Identify the diff surface (½ day)

Run the harness on:
- Minimal mesh (Stage 0 fixture)
- Hiyori (memory: reference for Cubism format checks)
- Shelby (the oracle reference)
- Alexia (memory: approved for runtime parity but not cmo3)

For each project, classify every diff:
- **Intentional v3 change.** Document with reason + the commit/memory entry that introduced it.
- **Refactor drift.** A field that v3 emits differently than upstream with no explanation. Mark as bug, fix in Stage 2.
- **Order-only diff.** Cubism is robust to attribute/element ordering in many places. If both decode to equivalent semantic state, mark as cosmetic (still fix if cheap).

**Verification gate:** every diff has a category. The set of "Refactor drift" diffs is the audit's findings list.

### Stage 2 — Fix the drift findings (variable)

Each finding gets its own commit. Reasons NOT to fix:
- Backwards compat: changes might break existing v3 projects. If so, document and defer.
- Cosmetic: reordering attributes in the XML is fine if Cubism doesn't care.

For each fix:
- Reproduce the divergence in a unit test (where possible).
- Apply the fix.
- Re-run the harness to confirm the field now matches.
- Confirm `npm test` + oracle harness stay green.

**Verification gate:** harness output for the chosen test fixtures shows zero unintentional diffs.

### Stage 3 — Lock in (¼ day)

- Add `npm run audit:upstream-parity` script.
- CI hook (optional) — fail if a new unintentional diff appears.
- Document the categorized diffs in [`docs/UPSTREAM_PARITY_FINDINGS.md`](UPSTREAM_PARITY_FINDINGS.md) (created at Stage 1, finalized here).

## Cost estimate

| Stage | Days | Notes |
|-------|------|-------|
| 0 — harness | 0.5 | Dynamic import of upstream + decode side-by-side |
| 1 — classify | 0.5 | Walk findings, document each |
| 2 — fix drift | 0.5–2.0 | Depends on finding count / scope |
| 3 — lock in | 0.25 | Script + docs |
| **Total** | **1.75–3.25 days** | |

## Out of scope

- **Init-rig parity.** Upstream's init rig and v3's init rig differ by design (v3 added FaceParallax, body Y-extension, etc.). The init-rig issue is tracked separately in [`INIT_RIG_AUTHORED_REWRITE.md`](INIT_RIG_AUTHORED_REWRITE.md). The writer audit is **only the post-rigSpec → cmo3/moc3 byte emit path**.
- **PSD wizard parity.** Upstream's wizard might differ from v3's; not relevant to writer correctness.
- **Runtime evaluator parity.** Tracked separately under the Cubism Warp Port (Phases 0/1/3 done; 2/4/5 partial/blocked).

## Risk register

| Risk | Mitigation |
|------|-----------|
| Upstream codebase has its own bugs we'd inherit. | The oracle harness already demonstrates upstream's output matches Cubism — so any upstream "bug" is one Cubism Editor accepts. We're matching observed-correct, not theoretically-correct. |
| Some v3 changes can't be back-validated against upstream (FaceParallax etc.). | Document as "v3-only feature path" and exclude from the audit's regression set. |
| Findings list might be empty (no drift). | That's a successful outcome — confirms refactor was clean. |
| Findings list might be huge (many cosmetic diffs). | Group by area; fix the cheapest first; defer the rest with documented reasoning. |

## Should we do this?

**My recommendation:** yes, but **after** the init-rig refactor lands (`INIT_RIG_AUTHORED_REWRITE.md`). Reasons:

1. The init-rig refactor will rewrite `initializeRigFromProject` substantially. If we run the parity audit before that, every finding will need to be re-checked after.
2. The init-rig refactor might surface its own writer-side issues that we'd want to roll into the audit findings.
3. After init-rig refactor, the audit becomes a **regression net for the new path** — much higher value than running it on the current pre-refactor code.

Decision deferred to user. If the audit is wanted standalone, Stage 0 can land independently.
