# Post-BUG-003 Work Queue

**Snapshot:** 2026-05-03, after the authored-cmo3 init rig path landed (commits `5152ba4` shipping the fix, `41e63bc` plugging GAP-008 opt-out into it).

This file ranks the next-best things to work on, written down before /compact so context survives. Tiers are by ROI, not by interest.

## Just-shipped today (2026-05-03)

- Phase 2b Stage 0 diagnostics: kernel flag, TraceCollector, lifted-grid `evalChainAtPoint`, `probe_kernel.mjs`, `--kernel=` oracle flag (commit `1833380`)
- Phase 2b Stage 1 measurement: slope ≡ J⁻¹ at all rotation pivots (commit `beb60ed`); pivot-patch disproof (commit `d15d8b3`)
- README restored from upstream + plan docs queued (commit `043dcbb`)
- **BUG-003 closed via authored-cmo3 init rig path** (`5152ba4`): `buildRigSpecFromCmo3.js` assembles RigSpec end-to-end from authored cmo3 deformer data. AngleZ_pos30 PARAM 9.45 → 0.01 px; overall PARAM max 9.45 → 5.42 px; rest-pose match to 0.07 px.
- **GAP-008 opt-out wired to authored path** (`41e63bc`): `eyeRig`/`hairRig`/`clothingRig`/`mouthRig` flags drop matching leaf rigWarps + reparent art meshes upward.

## Tier 1 — small wins (½ day combined, low risk, user-visible)

Rationale: clean up the `Open` BUGs list. Each is small, tests are fast, no architectural surface. Probably one-file fixes.

1. **BUG-005** — Per-piece Opacity slider does nothing
   - Severity: medium · Status: open
   - Likely a wiring issue between the slider and the per-mesh opacity binding
2. **BUG-007** — Variant `*.suffix` layers visible by default after PSD import
   - Variants should be `wasVisibleInPsd: false` until driver param activates them
   - Probably one place in PSD-import where the flag isn't propagated
3. **BUG-009** — Eyes display closed after Init Rig until param toggled
   - ParamEyeLOpen / ParamEyeROpen probably initializes to 0 when default should be 1

These three could ship in one sweep. Recommend doing this **next session**.

## Tier 2 — continuation of init-rig work (1-2 days, medium risk)

4. **Body chain residual ~5 px PARAM** on `BodyAngleX/Z`, `Breath`
   - Separate signal from BUG-003's AngleZ pivot issue (which is now 0.01 px)
   - Likely body warp keyform interpolation difference between v3's evaluator and Cubism's
   - Investigation path:
     - Run oracle on `BodyAngleX_pos10`, find which mesh diverges most
     - Use `probe_kernel.mjs` to dump body warp lifted bboxes at param-driven pose
     - Compare authored body warp keyform[1] (param=10) vs interpolated value at param=10
     - If they match: the bug is in chainEval's per-keyform composition
     - If they don't: the bug is in v3's keyform evaluation (`evalWarpGrid` interpolation)
   - Worst case re-derived ~5px is acceptable and we file as known-residual

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

## Recommendation for next session

**Tier 1 sweep** — three small BUG-fixes in one session.

- Closes 3 of 4 open BUGs (only BUG-003 was the big one and that's done)
- Fast tests, low context burn
- User-visible improvements

Or, if heroics: **Tier 2 #4** (body residual). Direct continuation of today's work; same mental model still cached.

**Don't combine Tier 1 + Tier 2** in a single session — different contexts, different test cycles, mistakes rise sharply.

## Anti-patterns to avoid

- ❌ Going back to chainEval to chase the body residual without measuring first (same trap Phase 2b fell into)
- ❌ Mixing init-rig path changes with feature work in one commit (the authored path is now load-bearing)
- ❌ Adding feature flags for the new paths without a real reason — embryo-stage project, hard cutovers preferred
