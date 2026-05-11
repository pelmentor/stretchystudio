# Session Close-out — 2026-05-11 (Phase 8 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE7C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7C.md).
This sub-session shipped **Pose Read/Write Canonicalisation Plan**
(closes Phase 7.C audit-fix G-2 + extends to render-path readers + ships
v35 migration to repair pre-Phase-8 corruption). Branch ahead of
`origin/master` by 33 commits at HEAD `be83451` (close-out doc commit
follows).

## What shipped this sub-session (2 commits)

### Pose Read/Write Canonicalisation Plan + audit-fix sweep #10

| Commit  | What |
|---------|------|
| `b58b505` | Phase 8 initial — 3 helpers (`ensureBonePoseChannel` / `setBonePoseField` / `setBonePose`) in `objectDataAccess.js`. Routed 7 writers + 5 readers through them. Two new test suites: `test_pose_writer_helpers.mjs` (56 assertions), `test_pose_write_v19_shape.mjs` (46 assertions). Phase 7.C audit-pin updated to reflect G-2 CLOSED (45 instead of 46 assertions). 187 test files green. |
| `be83451` | Phase 8 audit-fix sweep — 3 HIGH (G-1/D-1 bonePostChain + G-2/D-2 transformCompose + D-3 v35 repair migration) + 5 MED (G-3/D-4 rnaPath, G-4 empty-write guard, G-5/G-6 array typeof, D-5 + D-6 deviation docs) + 4 LOW (G-10/D-7 + G-11 + G-12 + G-13). 13 FIXes + 2 DOCUMENT-AS-DEVIATION (D-5 foreign channels, D-6 null-vs-identity). 26-assertion audit-pin test (188 test files green). Schema v35 (`v35_pose_shape_repair.js`). |

(Close-out doc commit follows separately.)

## Why two commits

The Phase 8 initial plan called for routing 8 writers; the audit then
caught **the plan's own reader-survey miss**: depgraph kernels
`bonePostChain.js` + `transformCompose.js` (both reader and writer
context) and `rnaPath.js` (driver/FCurve target reader+writer) bypassed
`getBonePose`. Phase 0.D.0 commit `c8f86f3` had just wired
CanvasViewport through depgraph, making G-1/D-1 a hot regression on the
render path.

The v35 migration (audit D-3) is a forced consequence: the v19
migration's `!flatPose.channels` idempotency guard PERMANENTLY locks
mixed-state bones in unreadable form. Without v35 there's no recovery
path for any project that loaded under pre-Phase-8 code, hit
transformCompose's mongrel-spread, and saved.

## Audit-fix sweep details (`be83451`)

Full per-gap details in
[AUDIT_2026_05_11_POSE_CANONICALISATION_ARCH.md](./AUDIT_2026_05_11_POSE_CANONICALISATION_ARCH.md)
(13 gaps) and
[AUDIT_2026_05_11_POSE_CANONICALISATION_DATA.md](./AUDIT_2026_05_11_POSE_CANONICALISATION_DATA.md)
(8 gaps; 4 cross-audit duplicates with arch). Headlines:

### HIGH

- **G-1/D-1** — `bonePostChain.js:122` partial-graph fallback read
  `bone.pose ?? null` directly. v19 channels-shape returned the
  wrapper → identity → every pose delta dropped on the depgraph
  render path. Fix: `getBonePose(bone)`.
- **G-2/D-2** — `transformCompose.js:overlayTransform` spread
  `node.pose` over the synthetic pose, leaking the v19 channels
  envelope as a sibling of the composed flat fields. Downstream
  `getBonePose` then returned the STALE pre-compose value. Fix: base
  the spread off `getBonePose(node)`.
- **D-3** — schema v35 migration `v35_pose_shape_repair.js`. Repairs
  mixed-state pose corruption. Lossless for pure-shape bones;
  idempotent.

### MED

- **G-3/D-4 (FIX)** — `rnaPath.evaluateRnaPath/setRnaPath` route bone
  pose paths through helpers.
- **G-4 (FIX)** — `setBonePose(node, {})` no-ops on pose-less bones
  (no surprise identity init).
- **G-5/G-6 (FIX)** — array-shape `pose` / `pose.channels` /
  `channels[id]` rejected via `!Array.isArray(...)`.
- **D-5 (DOCUMENT-AS-DEVIATION)** — foreign channels left intact;
  out-of-scope until Phase 1C-flip.
- **D-6 (DOCUMENT-AS-DEVIATION)** — `getBonePose` identity contract
  documented; null-vs-identity nuance left for future driver work.

### LOW

- **G-10/D-7 (FIX cite)** — `object/mirror.js:117-124` comment
  rewritten with bone-skip context.
- **G-11 (FIX)** — `PoseService.restorePose` `isBoneGroup` early-out
  restored.
- **G-12 (FIX)** — `rnaPath.js` header drops aspirational
  `__armature__` pose-channel path that was never wired.
- **G-13 (FIX cite)** — `bonePostChain.js` partial-graph fallback
  contract documented.

## Test scoreboard

All Phase 8 suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_pose_writer_helpers`                                              | 72  |
| `test_pose_write_v19_shape`                                             | 46  |
| `test_migration_v35`                                                    | 25  |
| `test_audit_fixes_2026_05_11_phase8` (NEW — pins all 13 closures)      | 26  |
| **Phase 8 total**                                                       | **169** |
| migrations                                                              | 135 |
| migration_v19                                                           | 32  |
| objectDataAccess                                                        | 59  |
| editorStore                                                             | 87  |
| animationEngine                                                         | 57  |
| transforms                                                              | 34  |
| constraints                                                             | 39  |
| paramValuesStore                                                        | 27  |
| poseService                                                             | 30  |
| Phase 7.C audit-pin (post-Phase-8 re-pinned)                            | 45  |

Total tests in repo: 188 files green. Typecheck clean.

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged. Depgraph coherent post Phase 0 audit-fix; Phase 0.D flag
flip is gated on user-side manual byte-fidelity sweep on Shelby +
test_image4 PSDs. **Phase 8 fixes a depgraph regression** (G-1/D-1)
that surfaced after Phase 0.D.0 wired CanvasViewport through depgraph;
manual sweep should now reflect correct v19-bone rendering.

### B. Manual gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F + 7.A.6 + 7.B.6 + 7.C.7

Ten manual gates queued (browser-side). Phase 8 does not add a new
manual gate — it's purely a substrate fix verifiable via unit tests.
Sister observation: any Shelby project save loaded post-`be83451`
will run v35 repair on first load; user should not notice anything
unless their current project has stored mixed-state corruption (in
which case pose values silently snap to the latest-write semantics).

### C. Toolset Phase 7.D — Phase 7 exit gate

Per plan §7.D — verify all per-mode tool clusters work end-to-end on
a real Shelby project and update the plan's Top-12 score (Phase 7
covers ~6 of the 12 entries directly). Unchanged from
[SESSION_CLOSEOUT_2026_05_11_PHASE7C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7C.md)
§C.

### D. Phase 1C-flip groundwork (NOT scheduled)

Phase 8 is the prerequisite for Phase 1C-flip (per
`BLENDER_PARITY_REFACTOR.md`): every pose writer is now routed through
`setBonePose` / `setBonePoseField`. When 1C-flip ships (one armature
Object owning N bone channels), the helper signature evolves from
`(node, field, value)` to `(armatureObject, boneId, field, value)` and
every caller already routes through one chokepoint.

## Hotkey reservations

Phase 8 added no new hotkeys (substrate fix, not feature).

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (32 from earlier 2026-05-11 close-outs) | Phases 0-7.C ship + 9 audit-fix sweeps + close-outs |
| 33    | `b58b505` | Phase 8 initial — pose read/write canonicalisation (8 writers + 5 readers + 2 test suites) |
| 34    | `be83451` | audit-fix sweep #10 — Phase 8 dual audit (3 HIGH inc. depgraph misses + v35 repair, 5 MED, 4 LOW) |

## Schemas after Phase 8

`CURRENT_SCHEMA_VERSION = 35` (was 34). New migration:
`v35_pose_shape_repair.js` — repairs mixed-state pose corruption
introduced by pre-Phase-8 writers stamping flat fields onto v19 channels
envelopes.
