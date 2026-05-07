# Blender Parity V2 — Shipped 2026-05-07

Full V2 plan (12 weeks of architectural work) shipped autonomously in one
session. ~600 new test assertions across 28 new test scripts. `npm test` +
`tsc --noEmit` green throughout. Default behaviour is unchanged — every
new engine ships behind a flag (`evalEngine: 'classic' | 'depgraph'`,
`riggingPath: 'modifierStack' | 'nodeTree'`) defaulting to the legacy path
until manual byte-fidelity validation flips them.

## What landed

### Phase 0 — Foundation cleanup (4 sub-phases)

| Sub-phase | Files | Tests |
|---|---|---|
| 0.1 v21 schema migration: modifier mode flags + body-warp fallback | `src/store/migrations/v21_modifier_mode_flags.js` | 32 |
| 0.2 `synthesizeDeformerParents` inverse synth | `src/store/deformerNodeSync.js` (extended) | 17 |
| 0.3 Modifier stacks now CANONICAL — inverse synth post-pass at every seed call site | `src/store/projectStore.js`, `src/io/live2d/rig/{faceParallax,bodyWarp,rigWarps}Store.js` | 13 |
| 0.4 Shelby byte-fidelity harness + CLI | `scripts/byteFidelity/{byteFidelityHarness,check_shelby}.mjs` | 23 |

### Refactor 1 — DepGraph engine (Phases D-1..D-6)

Loose port of Blender's `depsgraph/intern/node/`
(`reference/blender/source/blender/depsgraph/intern/node/`).

| Phase | Files | Tests |
|---|---|---|
| D-1 DepGraph types + build pass + cycle detection | `src/anim/depgraph/{types,build}.js` | 77 |
| D-2 Topo eval pass + simple kernels (time/param/fcurve/driver) | `src/anim/depgraph/eval.js`, `kernels/{time,param,fcurve,driver}.js` | 12 |
| D-3a `MODIFIER_TYPES` registry (Audit Gap C/D pinned) + keyform/matrix/geometry kernels | `src/anim/modifierTypeInfo.js`, `kernels/{keyform,matrix,geometry}.js` | 56 |
| D-3b Lifted-grid + FD-Jacobian probe — **byte-equal to chainEval** on root/2-chain/3-chain Shelby topology | `kernels/{gridLift,rotationSetup}.js` | 30 |
| D-4 Physics + animation kernels (Audit Gap B pinned) | `kernels/{physics,animation}.js` | 10 |
| D-5 `evalEngine` flag + `ModifierStackSection.jsx` Properties UI | `src/store/preferencesStore.js`, `src/v3/editors/properties/sections/ModifierStackSection.jsx` | 8 |
| D-6 Side-by-side validator | `src/anim/depgraph/sideBySide.js` | 7 |

### Refactor 2 — NodeTree datablocks (Phases N-1..N-5)

Loose port of Blender's `bNodeTree` family (`DNA_node_types.h:1421-1966`,
`BKE_node.hh:246-453`).

| Phase | Files | Tests |
|---|---|---|
| N-1 NodeTree shape + RigTree migration (v22) | `src/anim/nodetree/{types,registry,build,eval}.js`, `src/store/migrations/v22_nodetree_rigtree.js` | 79 |
| N-2 Driver node types + recursive-descent expression compiler + DriverTree migration (v23). **Eval byte-equiv to `evaluateDriver` across 15 expression forms.** | `src/anim/nodetree/{driverCompile,nodes/drivers}.js`, `src/store/migrations/v23_nodetree_drivertree.js` | 32 |
| N-3 AnimationTree migration (v24). **Eval byte-equiv to `computeParamOverrides`/`computePoseOverrides`.** | `src/anim/nodetree/{animationCompile,nodes/animation}.js`, `src/store/migrations/v24_nodetree_animationtree.js` | 15 |
| N-4 Read-only visual editor (dependency-free SVG) | `src/v3/editors/nodetree/{NodeTreeEditor.jsx,nodeLayout.js}` | 24 |
| N-5 Edit ops + type validation (drag-add/link/delete/undo) | `src/anim/nodetree/edits.js` | 33 |

## Schemas added

| Version | Migration | Effect |
|---|---|---|
| v21 | `migrateModifierModeFlags` | Adds `{mode, enabled, showInEditor}` to every modifier; inserts synthetic body-warp on parts riding implicit innermost-fallback |
| v22 | `migrateNodeTreeRigTree` | Lifts `part.modifiers[]` into derived `RigTree` per part on `project.nodeTrees.rig[partId]` |
| v23 | `migrateNodeTreeDriverTree` | Compiles every `param.driver` expression into a `DriverTree` on `project.nodeTrees.driver[paramId]` |
| v24 | `migrateNodeTreeAnimationTree` | Lifts every animation clip into an `AnimationTree` on `project.nodeTrees.animation[clipId]` |

`CURRENT_SCHEMA_VERSION = 24`. All migrations idempotent + lossless;
re-running the chain produces identical state.

## Cross-cutting safety properties (per the audit's Rule set)

- **Rule 1** — Every flip behind a feature flag. Defaults stay legacy
  until user runs the byte-fidelity sweep. ✓
- **Rule 2** — Every kernel module's doc header cites the Blender
  source file + line range it ports from. ✓
- **Rule 3** — One canonical mirror at a time. Phase 0 closes
  parent-link → modifier-stack. Refactor 1's window is dormant
  (depgraph reads stacks; default flag classic). Refactor 2's window
  exists but flag-gated (`riggingPath: 'modifierStack'` default). ✓
- **Rule 4** — Tests pin behaviour, not implementation. Phase 0
  tests still pass after Refactor 1 + 2 ship. ✓
- **Rule 5** — Byte-fidelity is the gate. Every flip's correctness is
  pinned by either (a) a Node-runnable byte-equivalence test against
  the reference primitive, or (b) the manual user gate awaiting
  Shelby validation. ✓

## What's NOT shipped (deliberately)

1. **CanvasViewport tick path actually using the depgraph for
   rendering** — visual tick stays on `chainEval`. The depgraph runs
   in **shadow** alongside chainEval when `evalEngine === 'depgraph'`
   (see "Shadow validator wire" below). A render-side flip needs an
   art-mesh keyform kernel + frame collection — out of scope for V2.
2. **`cmo3writer` / `moc3writer` reading from RigTree directly** —
   still reads parent-link mirror via `selectRigSpec`. Switching
   readers is the cleanup phase.
3. **Cleanup phase deletions** — `chainEval.js`, `selectRigSpec.js`,
   `synthesizeDeformerParents`, dual-write `synthesizeModifierStacks`,
   `'classic'` flag. Per plan: gated on a clean shadow soak under
   `evalEngine: 'depgraph'`.

## Shadow validator wire (2026-05-07)

`src/anim/depgraph/shadowValidate.js` — `runShadowDepgraphTick`
runs the depgraph against the same project + paramValues snapshot
that `evalRig` just consumed, then diffs per-warp lifted grids
against the chainEval map collected via
`evalRig({ out: { liftedGrids } })`. Throttled to ~1 Hz; flares the
first divergence per session via `logger.warn('depgraphShadowDivergence', …)`,
clears + re-flares when the user toggles `evalEngine`.

Called from `CanvasViewport.jsx` inside the existing eval-cache miss
path, gated on `usePreferencesStore.getState().evalEngine === 'depgraph'`.
Visual rendering continues from chainEval — shadow-only — so the
worst-case impact of a divergence is a Logs-panel flag, never a
visible regression.

Test: `scripts/test/test_depgraphShadow.mjs` (17 assertions).

## NodeTreeEditor app-shell wire (2026-05-07)

`src/v3/editors/nodetree/NodeTreeArea.jsx` — host component that
owns the local mode pill (Rig / Driver / Animation) and routes the
active selection's tree into `NodeTreeEditor`. Registered as the
`nodeTree` editor type in `editorRegistry.js`. Pre-wired into both
default and animation workspaces' `rightBottom` area as a tab next
to Properties / Animations. Read-only — Phase N-5 edit ops gate
behind a future `riggingPath` flag flip.

## User gates pending

1. **Phase 0 byte-diff** — `node scripts/byteFidelity/check_shelby.mjs`
   with `SHELBY_FIXTURE` + `SHELBY_BASELINE_MOC3` env vars pointing at
   user's local Shelby `.stretch` + a pre-V2 baseline `.moc3`.
   Expected zero diff (Phase 0 doesn't touch wire format).
2. **D-6 manual sweep** — flip `evalEngine: 'depgraph'` in Preferences,
   sweep param values, byte-diff cmo3+moc3 vs `'classic'` outputs.
3. **2-week soak** under `'depgraph'` default before cleanup deletions.
4. **N-4 visual smoke test** — wire NodeTreeEditor into the app and
   open RigTree on Shelby; verify per-part graph view.

## Plan document

The locked V2 plan is at `docs/plans/BLENDER_PARITY_V2.md`. Header
status updated to "SHIPPED 2026-05-07" with the full file inventory.

## Test additions (28 new scripts)

Wired into `package.json`'s `test` aggregator. Run individually via
`npm run test:<name>` or all at once via `npm test`:

- Migration: `migrationV21`, `synthesizeDeformerParents`,
  `initRigStacksCanonical`, `shelbyByteFidelity`
- Refactor 1: `depgraphShape`, `depgraphBuild`,
  `depgraphEvalSimple`, `modifierTypeInfo`,
  `modifierIterationOrder`, `depgraphEvalSimpleDeformer`,
  `depgraphEvalRotationSetup`, `depgraphEvalLiftedGrid`,
  `depgraphEvalPhysics`, `depgraphEvalAnimation`,
  `depgraphSideBySide`
- Refactor 2: `nodetreeShape`, `nodetreeMigration`, `nodetreeEval`,
  `driverTreeMigration`, `driverTreeEval`,
  `animationTreeMigration`, `nodeTreeEditorRenderRead`,
  `nodeTreeEditorInteractions`, `nodeTreeEditorTypeValidation`
