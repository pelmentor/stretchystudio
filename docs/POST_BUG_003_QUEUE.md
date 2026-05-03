# Post-BUG-003 Work Queue

**Snapshot:** 2026-05-03, after the authored-cmo3 init rig path landed (commits `5152ba4` shipping the fix, `41e63bc` plugging GAP-008 opt-out into it).

This file ranks the next-best things to work on, written down before /compact so context survives. Tiers are by ROI, not by interest.

## Just-shipped today (2026-05-03)

- Phase 2b Stage 0 diagnostics: kernel flag, TraceCollector, lifted-grid `evalChainAtPoint`, `probe_kernel.mjs`, `--kernel=` oracle flag (commit `1833380`)
- Phase 2b Stage 1 measurement: slope ≡ J⁻¹ at all rotation pivots (commit `beb60ed`); pivot-patch disproof (commit `d15d8b3`)
- README restored from upstream + plan docs queued (commit `043dcbb`)
- **BUG-003 closed via authored-cmo3 init rig path** (`5152ba4`): `buildRigSpecFromCmo3.js` assembles RigSpec end-to-end from authored cmo3 deformer data. AngleZ_pos30 PARAM 9.45 → 0.01 px; overall PARAM max 9.45 → 5.42 px; rest-pose match to 0.07 px.
- **GAP-008 opt-out wired to authored path** (`41e63bc`): `eyeRig`/`hairRig`/`clothingRig`/`mouthRig` flags drop matching leaf rigWarps + reparent art meshes upward.

## Tier 1 — small wins **(EVAPORATED 2026-05-03 — re-check showed nothing actionable)**

Original plan was to clean up the `Open` BUGs list with three small fixes. After re-reading [BUGS.md](BUGS.md) on 2026-05-03 the picture is different from what I wrote at /compact time:

1. ~~**BUG-005**~~ — *Instrumented, awaiting user drag-time repro* (not "open and fixable"). [`ObjectTab.jsx`](../src/v3/editors/properties/tabs/ObjectTab.jsx) already logs `opacityCommit` on every commit. Without the user dragging the slider with Logs panel open, we can't tell if the commit is firing or the renderer is ignoring the change. Blocked on user repro, same status as BUG-015.
2. ~~**BUG-007**~~ — Already **✅ Fixed 2026-04-30** ([variantNormalizer.js:109-122](../src/io/variantNormalizer.js#L109)). The /compact-time queue confused this with an open bug.
3. ~~**BUG-009**~~ — Already **✅ Fixed 2026-04-30** ([RigService.js:147-159](../src/services/RigService.js#L147)). The /compact-time queue confused this with an open bug.

**Net:** Tier 1 is empty. Promote Tier 2 / Tier 3.

## Tier 2 — continuation of init-rig work (1-2 days, medium risk)

4. ~~**Body chain residual ~5 px PARAM** on `BodyAngleX/Z`, `Breath`~~ → **CLOSED 2026-05-03 (Phase 2b Setup port shipped)**
   - Investigation discovered the residual was the same Phase 2b matrix-structure issue we'd documented as blocked.
   - User said "work autonomously, без костылей, multi-day OK, IDA MCP ready" — so we shipped the proper Setup port instead of filing as known-residual.
   - Implementation: canvas-final matrix via FD-probed parent Jacobian. `getRotationSetup` + `buildRotationMat3CanvasFinal` in chainEval.js. Output is canvas-final; chain walker breaks after rotation. Same shape as Cubism Core's `RotationDeformer_Setup` (IDA `0x7fff2b24dee0`).
   - Result: Breath_full 5.42 → **0.14 px** (-97%), BodyAngleX 5.18 → **1.32 px** (-74%), BodyAngleY/Z 3.50 → **0.18-0.21 px** (-91 to -95%). Face/eye fixtures unchanged (already perfect).
   - All 92 test suites green. Default kernel flipped from `v3-legacy` to `cubism-setup`. Plan doc: [PHASE_2B_PLAN.md](live2d-export/PHASE_2B_PLAN.md). Kernel-level write-up: [CUBISM_WARP_PORT.md](live2d-export/CUBISM_WARP_PORT.md).

5. **`faceRig` / `bodyWarps` opt-out** (no-op today)
   - `buildRigSpecFromCmo3.js` ships these as documented no-ops because cascade-reparenting through warps with different frame conventions is non-trivial
   - Only worth doing when a real user case demands it; defer until then

## Tier 3 — larger initiatives (multi-day each, need user direction)

6. **UPSTREAM_PARITY_AUDIT** (`docs/UPSTREAM_PARITY_AUDIT.md` — plan written)
   - Compare v3's cmo3/moc3 writer output structurally against upstream's (`reference/stretchystudio-upstream-original/`)
   - Categorize each diff: intentional v3 change vs refactor regression
   - Now sensible to run since init-rig refactor landed
   - 1.75–3.25 days nominal

7. **V3 re-rig flow gap**
   - No UI yet to edit bone pivots / paint weights / re-run wizard stages after PSD-import finishes
   - Whole feature pillar, no plan written
   - Ask user for scope before writing plan

8. **Cubism Warp Port Phase 4** (`docs/live2d-export/CUBISM_WARP_PORT.md`)
   - Artmesh keyform composition — 8 "blend-shape resolve" stages in csmUpdateModel pipeline
   - Phase 5 (final parity sweep) follows
   - Phase 2b is officially cancelled (Stage 1 + pivot-patch disproof showed chainEval kernel is correct)

## Awaiting user repro

9. **BUG-015** — BodyAngle X/Y/Z sliders unresponsive in Live Preview
   - Instrumentation shipped 2026-05-02; needs drag-time repro from user

10. **BUG-005 / BUG-007 / BUG-009** above can also be moved here if first-look investigation needs the user to confirm steps

## Recommendation for next session (revised 2026-05-03 — Tier 2 #4 also filed as known-residual)

With both Tier 1 and Tier 2 #4 closed (#4 as known-residual, #1-3 as already-fixed or awaiting-repro), the genuine choices are:

**A. Tier 3 #6 — UPSTREAM_PARITY_AUDIT.** Plan already written ([UPSTREAM_PARITY_AUDIT.md](UPSTREAM_PARITY_AUDIT.md)). Now sensible to run since init-rig refactor landed. 1.75–3.25 days. *Recommended* — concrete, bounded scope.

**B. Tier 3 #8 — Cubism Warp Port Phase 4** (artmesh keyform composition). Continues the kernel-port arc. Phase 5 closes the parity sweep. Note: would also unblock the rotation-matrix refactor that closes the BUG-003 known-residual.

**C. New feature pillar — V3 re-rig flow gap (Tier 3 #7).** Whole UI for editing pivots / weights / re-running wizard stages. Needs user direction before plan is written.

## Anti-patterns to avoid

- ❌ Going back to chainEval to chase the body residual without measuring first (same trap Phase 2b fell into)
- ❌ Mixing init-rig path changes with feature work in one commit (the authored path is now load-bearing)
- ❌ Adding feature flags for the new paths without a real reason — embryo-stage project, hard cutovers preferred
