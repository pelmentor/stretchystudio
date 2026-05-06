# Archive

Read-only history. **Don't edit files in here** — if a doc still describes how the system works, promote it back into the live docs root; if it doesn't, the git log holds the trail.

## Layout

```
archive/
├── plans-shipped/         Plans whose phases all shipped (or were superseded)
├── sessions/              Per-session post-mortems for the Live2D export work
└── historical/            Pre-v3 implementation notes + legacy non-doc assets
```

## plans-shipped/

Each file is a once-active plan whose phases all landed. Names match the original (minus the `_PLAN` suffix). Most have a `Status: SHIPPED <date>` banner near the top with the relevant commit SHA(s).

| File | What it shipped | When |
|---|---|---|
| [BFA_006_DEFORMER_NODES](plans-shipped/BFA_006_DEFORMER_NODES.md) | Collapse `rigSpec` sidetable into `project.nodes`; deformers as first-class nodes | 2026-05-04 |
| [BLENDER_FIDELITY_AUDIT](plans-shipped/BLENDER_FIDELITY_AUDIT.md) | Crutch catalogue + collapse plan; tracked the workspace + mode-pill collapses | 2026-05-02..03 |
| [BLENDER_VIBE_REFACTOR](plans-shipped/BLENDER_VIBE_REFACTOR.md) | Outliner / Properties visual / mode dichotomy refactor (all 8 phases) | 2026-05-06 |
| [CLICK_TO_SELECT](plans-shipped/CLICK_TO_SELECT.md) | Triangle hit-test against rig frames + KeyA select-all | 2026-05-02 |
| [INIT_RIG_AUTHORED_REWRITE](plans-shipped/INIT_RIG_AUTHORED_REWRITE.md) | Authored-cmo3 init rig path; closed BUG-003 9.45px residual | 2026-05-03 |
| [POLISH_PASS_001](plans-shipped/POLISH_PASS_001.md) | First user-driven visual audit (PP1-NNN entries) | 2026-05-03 |
| [POLISH_PASS_002](plans-shipped/POLISH_PASS_002.md) | Second visual audit (PP2-NNN entries) | 2026-05-03 |
| [POST_BUG_003_QUEUE](plans-shipped/POST_BUG_003_QUEUE.md) | Work-queue snapshot after BUG-003 closed | 2026-05-03 |
| [REST_POSE_SPLIT](plans-shipped/REST_POSE_SPLIT.md) | Schema v17 rest/pose split for bones; Apply Pose As Rest | 2026-05-05 |
| [TOOLBAR](plans-shipped/TOOLBAR.md) | Blender T-panel canvas toolbar v1 | 2026-05-02 |
| [UPSTREAM_PARITY_AUDIT](plans-shipped/UPSTREAM_PARITY_AUDIT.md) | Plan + harness for byte-diffing v3's writers vs upstream's | 2026-05-03 |
| [UPSTREAM_PARITY_FINDINGS](plans-shipped/UPSTREAM_PARITY_FINDINGS.md) | Findings: zero unintentional regressions across 4 fixtures | 2026-05-03 |
| [V3_BLENDER_REFACTOR](plans-shipped/V3_BLENDER_REFACTOR.md) | The full v3 Blender-style UX refactor (Phases 0–6 + sweeps #1–#50) | 2026-04-28 onward |
| [V3_RERIG_FLOW](plans-shipped/V3_RERIG_FLOW.md) | RigStagesTab + per-stage refit + `_userAuthored` markers | 2026-05-03 |
| [V4_BLENDER_PARITY](plans-shipped/V4_BLENDER_PARITY.md) | Properties section refactor + keyform editor + weight paint v1 | 2026-05-05 |
| [WORKSPACE_MODE_REWORK](plans-shipped/WORKSPACE_MODE_REWORK.md) | 5 → 3 workspaces, single editMode slot | 2026-05-02 |
| [AUTO_RIG](plans-shipped/AUTO_RIG.md) | Post-Session-20 auto-rig design analysis (superseded by warp port) | 2026-04 |
| [NATIVE_RIG_REFACTOR](plans-shipped/NATIVE_RIG_REFACTOR.md) | Native rig data layer + in-app evaluator (v1: 15 stages + v2: 11 stages) | 2026-04-28 |
| [PHASE_2B](plans-shipped/PHASE_2B.md) | BUG-003 Phase 2b: rotation Setup port | 2026-05-03 |
| [RUNTIME_PARITY](plans-shipped/RUNTIME_PARITY.md) | `.moc3` direct emission vs Editor's "Export For Runtime" parity | 2026-04-26 |
| [CUBISM_PHYSICS_PORT_PHASE0_FINDINGS](plans-shipped/CUBISM_PHYSICS_PORT_PHASE0_FINDINGS.md) | RE findings for the physics port Phase 0 | 2026-05-03 |

## sessions/ (gitignored)

Per-session post-mortems for the Live2D export work. These are development artefacts — kept locally, not committed (see `.gitignore`).

- `SESSION_16.md` … `SESSION_30.md` — chronological dev log for sessions 16–30
- `DECISIONS.md` — architecture decision log

## historical/

Pre-v3 implementation notes + a few non-doc assets that lived in `docs/` for legacy reasons.

- `PROJECT_STATUS_M6.md` — frozen at the M6 timeline-first design (2026-04-12), pre-Live2D pivot
- `README_M5_marketing.md` — M5-era marketing/onboarding copy (formerly `README_internal.md`)
- `JUMPSTART.md` — pre-v3 quick-start
- `inochi_basics.md` · `params_suggestions.md` · `import_wizard_steps.md` · `mesh_gen_doc.md` — research/reference notes
- `TBLR_implementation.md` — See-through framework heuristic (still referenced by [`src/io/splitLR.js`](../../src/io/splitLR.js))
- `*_implementation.md` (12 files) — M3..M6 era implementation notes for individual features (anim curves, audio, elbow/knee skinning, export, save/load, shape keys, Spine export, undo/redo, Live2D export — historical first draft). The current state of each is reflected in code; these are kept for the design intent record.
- `riggerDEMO.html` · `model.inp` · `testskeleton.json` — legacy non-doc assets
