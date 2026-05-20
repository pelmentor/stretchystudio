# Animation Blender-Parity Plan

Status: **REFINED v2** — incorporates 2-agent audit feedback (architecture + Blender-fidelity), 2026-05-09
Owner: pelmentor
Date opened: 2026-05-09
Target: ~7–11 weeks of focused work, 7 phases, schemas v33 → v36
Working rule: **RULE №1 — no quick-and-dirty fixes**. **RULE №2 — no migration baggage**.

Audit-driven changes from v1:
- Phase 0 expanded with explicit `0.D.0 viewport wire-up` step (audit caught: depgraph default flip is a no-op without it)
- Phase 1 expanded with explicit `1.B.1 consumer enumeration` (audit caught: 8 production consumers of `project.animations[]` were missing from migration scope)
- Phase 1 absorbs NodeTree retirement (audit: deferring it to Phase 8 is migration baggage per Rule №2)
- Phase 2 absorbs `motion3jsonImport.js` upgrade to preserve bezier control points (audit caught: importer-discards-controls makes the migration lossy at the gate)
- Phase 3 dropped invented `extrapolate` Cycles mode; Cycles ships 4 modes matching Blender; Generator `polynomial_factorised` replaces invented `expanded`; FN_GENERATOR + Smooth modifiers documented as deferred; Noise gains `lacunarity` + `roughness`
- Phase 4 NLA `combine` mode REMOVED (audit: Rule №1 violation — silently degrading to `replace` for non-rotation hides intent); shipped blend list = replace/add/subtract/multiply only; combine deferred to v2
- Phase 5 Graph Editor uses canvas-2D for keyframes/handles from day 1, SVG only for static curve background (audit: SVG breaks at >200 keyframes; real characters have 1200+)
- Phase 8 trimmed (NodeTrees retired in Phase 1; ms canonical declared in Phase 0)
- ms is canonical time unit throughout; seconds appear only at motion3.json export boundary (audit: depgraph would bake ms by Phase 0 default-flip; Phase 8 audit was too late)
- DNA-name fixes: `FRAME_RANGE_LOCKED` → `FRAME_RANGE`; `ANIM_TWEAK_MODE` → `ADT_NLA_EDIT_ON`; AnimData gains `tmpact` + `act_blendmode` + `act_extendmode`

---

## 0. TL;DR

Stretchy Studio's animation system has shipped a *lot* of Blender-shaped
**scaffolding** that nobody is using yet. [src/anim/fcurve.js](../../src/anim/fcurve.js),
[src/anim/driver.js](../../src/anim/driver.js), [src/anim/rnaPath.js](../../src/anim/rnaPath.js),
[src/anim/animationFCurve.js](../../src/anim/animationFCurve.js),
[src/anim/driverPass.js](../../src/anim/driverPass.js),
[src/anim/constraints.js](../../src/anim/constraints.js), the three NodeTree
datablocks (RigTree v22 / DriverTree v23 / AnimationTree v24), and the entire
DepGraph engine ([src/anim/depgraph/](../../src/anim/depgraph/)) all exist,
all have unit tests, and all are **completely disconnected from the production
hot path**. The live tick still calls
[interpolateTrack](../../src/renderer/animationEngine.js) on a flat
`project.animations[].tracks[]` list, ignoring drivers, constraints, FCurve
modifiers, and NLA entirely.

The plan, at the highest level, is three sweeps:

1. **Wire the existing scaffolds into the hot path** (Phase 0). Cheap.
   Closes the depgraph→production gap, gets drivers and constraints actually
   running, and gives the rest of the plan a real eval substrate.
2. **Fill the four foundational gaps Blender has and we don't** (Phases 1–4):
   the `Action` datablock, BezTriple handles on FCurve keyforms, F-Curve
   modifiers, and the NLA stack.
3. **Ship the authoring UI that pays for the foundations** (Phases 5–7):
   Graph Editor write-mode, Dopesheet write-mode, Insert Keyframe operator
   with keying sets.

Phase 8 closes out: docs, deprecations, telemetry, and the "migration
baggage" sweep mandated by Rule №2.

The cmo3 / moc3 / can3 / motion3 / can3 export pipeline must remain
byte-identical throughout — every phase ships a green
[test:exportFidelity](../../scripts/test/) sweep gate.

---

## 1. Why now

The animation scaffolding work was front-loaded in the Blender Parity
Refactor (Phases 1A–5, shipped 2026-05-06, see
[BLENDER_PARITY_REFACTOR.md](./BLENDER_PARITY_REFACTOR.md)) and the V2
NodeTree+DepGraph pass (shipped 2026-05-07, see
[BLENDER_PARITY_V2.md](./BLENDER_PARITY_V2.md)). Both passes intentionally
stopped short of *flipping the read paths*: the goal at the time was to
land the data shape without risking byte-fidelity regressions on Shelby /
Hiyori exports.

Five months of subsequent work hardened the export pipeline (artMesh
runtime persist v29, BUG-025 leg-roles fix, NeckWarp dual-write fix,
moc3 band emission fix), and the byte-fidelity gates are now stable enough
that we can finally start *consuming* the scaffolds — and the gap between
"data shape Blender-correct" and "behaviour Blender-correct" has become
the dominant source of feature debt:

- **No Insert Keyframe operator.** K-key inserts on every property of
  the selection at once; there is no `I`-menu equivalent that lets the
  user key just the rotation channel of a bone. Auto-keyframe always
  writes the full property set.
- **No bezier handle editing.** Every keyframe pair has one preset
  easing (`linear`, `ease-in`, etc.); there is no per-handle vector
  editing, so a curve that "feels right" in Cubism Editor cannot be
  authored in SS without fighting the easing dropdown.
- **No FModifiers.** A 4-keyframe head bob cannot loop without
  duplicating keyframes — there is no `Cycles` modifier. Procedural
  jitter requires shipping keyframes for every frame, since there is
  no `Noise` modifier.
- **No NLA stack.** Two animations cannot be blended at runtime; there
  is no notion of "wave + walk + speak" as three concurrent strips
  with per-strip influence. The exporter cannot synthesise blended
  motion files because the data has nowhere to live.
- **No Action datablock.** Every animation lives at project root. A
  user cannot maintain a library of poses and assign different ones
  to different characters in the same project.
- **Drivers are theatre.** A driver authored on `param.driver` is
  evaluated by exactly zero production code paths; users will see the
  expression accepted, see no effect at runtime, and have no way to
  know why.
- **Constraints are theatre.** Same as drivers. `node.constraints[]`
  is dead weight.
- **Graph Editor is informational.** The user can look at the curve
  but cannot drag a handle. There is no parity with Cubism Editor's
  curve view, let alone Blender's.

The user's explicit direction: "огромный по времени желательно,
архитектурный большой". This plan budgets ~6–10 weeks because the work
is genuinely architectural (new datablock types, new evaluators wired
in two read paths, two new editor surfaces). It is also explicitly
*not* a free-for-all — Sections 4 and 9 enumerate non-goals.

---

## 2. Scope

### 2.1 In scope

| Area | What ships |
|------|-----------|
| Phase 0 | DepGraph default flip; driverPass + constraint pass wired into CanvasViewport tick; gridLift RigWarp_* coordinate-frame fix |
| Phase 1 | `Action` datablock (`project.actions[]`); `AnimData` per-Object (`node.animData`); migration v33 from existing flat animations |
| Phase 2 | `BezTriple`-shape FCurve keyforms with left/right handles, handle types (auto, auto_clamped, vector, aligned, free), interpolation modes (constant, linear, bezier, easings) |
| Phase 3 | F-Curve modifier stack: `Cycles`, `Noise`, `Generator`, `Limits`, `Stepped`, `Envelope`. Per-modifier influence + frame range |
| Phase 4 | NLA: `NlaTrack[]` with `NlaStrip[]`, blend modes (`replace` / `add` / `subtract` / `multiply` / `combine`), time remapping (`actstart` / `actend` / `repeat` / `scale`), tweak mode |
| Phase 5 | Graph Editor write-mode: drag keyframes in (time, value), drag bezier handles, box-select keyframes, scale/grab/snap, per-FCurve extrapolation menu |
| Phase 6 | Dopesheet write-mode: keyframe drag, delete, copy/paste columns, channel mute/solo, channel filter |
| Phase 7 | Insert Keyframe operator (`I` menu), Keying Set registry, "Only Insert Needed" mode, Auto-Key parity with Blender |
| Phase 8 | Docs sweep, deprecation of legacy track shape, telemetry, migration-baggage cleanup |

### 2.2 Out of scope

Mostly to keep budget honest, partly because the user explicitly excluded
them, partly because they don't pay back inside this plan's timeframe:

- **Layered Actions** (Blender's project-Baklava layered action system,
  with multiple layers per action and influence-blended composition).
  Defer to a follow-up plan; the *single-layer* Action datablock that
  Phase 1 ships is sufficient for parity with Cubism Editor, which is
  the immediate authoring target. Layered Actions are also still in
  flux upstream.
- **Multi-slot Actions** (one Action animating two distinct IDs via
  slot handles — Blender's crowd-animation feature). The schema
  reserves a `slot` field but every action ships with exactly one
  implicit slot in Phase 1. Real multi-slot is a follow-up that mostly
  pays back at scale we don't have.
- **Python expression drivers.** [src/anim/driver.js](../../src/anim/driver.js)
  has a hardened JS-subset sandbox. Adding a Python runtime is large
  weight for a small authoring win — JS-subset covers `var * 2`,
  `clamp(var, 0, 1)`, `sin(var * pi)`, which is the 95% case.
- **Custom F-Curve drivers** that depend on Blender Python-only
  features (driver context properties, scripted RNA paths into the
  Python namespace).
- **Animation Layers UI as a separate space**. Blender does not have
  this either — layered composition is inside the NLA editor. Same
  approach here.
- **Graph Editor with non-1D curves** (vector-tangent fcurves where
  multiple components share a curve). Each component (X / Y / scale)
  remains a separate FCurve as in Blender.
- **Export-side NLA flattening to motion3.json beyond a single
  baked top-strip per parameter.** The exporter will continue to
  emit one motion3.json per Action; users wanting NLA-blended output
  bake the NLA stack into a new Action via a "Bake NLA" operator.
  Phase 4 ships the bake operator; the exporter does not learn NLA.
- **Cubism Editor `.can3` NLA round-trip.** The `.can3` writer emits
  flat keyframes (current behaviour) — NLA is an authoring-time
  feature that never reaches Cubism's exchange format.

### 2.3 Non-features (deliberately not building)

Not in this plan, and not deferred either — explicitly rejected:

- **Grease Pencil-style frame holding.** Cubism's parameter model is
  continuous-value-per-time; there is no concept of "this object
  becomes invisible between frame 12 and 16" outside of opacity
  keyframes, which the existing track shape already supports.
- **Procedural drivers for keyframe values** (a driver that overrides
  a keyframe instead of an FCurve). Blender does not do this; the
  driver overrides the FCurve as a whole or not at all.
- **Channel masks per-track per-bone.** Blender has bone-level mask
  via the `Action Constraint`; we will not ship it. SS uses per-mesh
  modifier stacks instead, which is the parity equivalent.

---

## 3. Architecture overview

The end state has three concentric layers, mirroring Blender:

```
Object (project.nodes[i]) ── animData ──┐
                                        │
                            actionId ───┼─── Action (project.actions[i])
                                        │       └── fcurves[]: FCurve
                            nlaTracks ──┤             ├── keyforms[]: BezTriple
                                        │             ├── modifiers[]: FModifier
                            drivers ────┘             └── driver?: ChannelDriver

DepGraph eval order:
  TIME_TICK → DRIVER_EVAL → ANIMATION_TRACK_EVAL (with NLA blend) →
  PARAM_EVAL → KEYFORM_EVAL → MATRIX_BUILD → CONSTRAINT_EVAL →
  GEOMETRY_EVAL_DEFORMED → GRID_LIFT_TO_PARENT → ROTATION_SETUP_PROBE →
  PHYSICS_EVAL → render
```

Three core invariants:

**A — RNA-path is the universal address.** Every FCurve and Driver
identifies its target via `rnaPath` ([src/anim/rnaPath.js](../../src/anim/rnaPath.js)).
There is no special case for "this is a parameter", "this is a bone
rotation", "this is a node X position" — they are all RNA paths into the
project tree. The animation engine does not know what a parameter is.

**B — Action is data; AnimData is binding.** An `Action` is a pure
collection of FCurves (with no reference to any Object). `AnimData` on an
Object names "which Action plays on me, with which slot, and what NLA
stack overlays it". Two objects can share an Action; one Action can be
swapped from many objects atomically.

**C — DepGraph is the single eval substrate.** After Phase 0, the production
tick runs through the DepGraph, not through `interpolateTrack` directly.
The legacy `evalEngine: 'classic'` flag stays for one release as an
opt-out, then is removed in Phase 8.

---

## 4. Phase order (v2, audit-refined — 7 phases)

```
Phase 0 ── Phase 1 ── Phase 2 ── Phase 3 ── Phase 4
              ║          ║          ║          ║
              ╚══════════╩══════════╩══════════╝
                            │
                       Phase 5 ── Phase 6
                                     │
                                  Phase 7
                              (close-out)
```

Phases 1–4 stack: Action ⊂ FCurve handles ⊂ FModifiers ⊂ NLA. Phase 5
(Graph Editor write-mode) comes after 1–4 because the editor needs the
final FCurve+handle+modifier shape to draw against. Phase 6 merges
Dopesheet write-mode + Insert Keyframe + Keying Sets (the audit's
implicit suggestion: these tightly share infrastructure — Insert
Keyframe operators are evaluated in Dopesheet exactly like in
TimelineEditor). Phase 7 is the audit-trimmed close-out.

(v1 had Phase 6 = Dopesheet, Phase 7 = Insert Keyframe, Phase 8 =
close-out. v2 merges 6+7 → Phase 6 and renames close-out to Phase 7.)

Each phase is independently shippable, with:

- a schema bump + reversible migration on entry
- a green test suite + green byte-fidelity sweep on exit
- one or more in-app screenshots / GIFs in the user-facing changelog
- a memory entry summarising what landed (per the auto-memory system)

---

## 5. Phases

### Phase 0 — Wire what already exists (5–7 days)

**Goal.** Stop running phantom code. The DepGraph works; the driver
sandbox works; constraints work; the only thing missing is the wire.

The audit caught two false assumptions in v1: (a) the gridLift fix is
*not* the singular blocker for default-on — `CanvasViewport.jsx` does
not currently read `preferencesStore.evalEngine` at all; flipping the
default has zero observable effect without first wiring the rAF
callback to branch on the flag. (b) Time unit canonicalization in
Phase 8 is too late — once depgraph goes production with ms-shaped
inputs, every kernel bakes the assumption. Both are addressed in
Phase 0 below.

#### 0.0 — Declare canonical time unit (1 hour, but write it down)

The codebase has 4 different time units in different subsystems:
ms (`animationStore.currentTime`, `interpolateTrack`, track keyframes),
seconds (Phase 5 scaffold `fcurve.js`, depgraph `EvalContext.time`),
frames (Cubism segment encoder), ticks (physics).

**Decision (audit-recommended Option A):** **milliseconds (ms) is canonical
throughout the eval substrate.** Seconds are used at exactly two
external boundaries:
- `motion3.json` export: convert ms → seconds at the writer (single line)
- `motion3.json` import: convert seconds → ms at the reader (single line)

All other code reads/writes ms. The Phase 5 scaffold's seconds-shaped
`FCurve.keyforms[].time` field is migrated to ms in Phase 1's v33
migration (a one-line `* 1000` per keyform). The depgraph's
`EvalContext.time` field is renamed `timeMs` and rebased.

This is recorded as a memory entry: *"ms is canonical animation time
across SS"*. Future contributors check the memory before adding new
unit-conversion logic.

#### 0.A — gridLift RigWarp_* coordinate-frame fix

[BLENDER_PARITY_V2_SHIPPED.md](./BLENDER_PARITY_V2_SHIPPED.md) closed the
V2 phase noting: *"per-part RigWarp_* lifted grids diverge from chainEval
by ~canvasW/2 (pivot-relative vs TL-origin frame mismatch in
`kernels/gridLift.js`)"*. This is the singular blocker for flipping
DepGraph default-on. The fix is contained to
[src/anim/depgraph/kernels/gridLift.js](../../src/anim/depgraph/kernels/gridLift.js)
and a sister patch to the rotation-setup probe.

**Deliverable:**

- Full byte-parity between `evalEngine: 'classic'` and `evalEngine:
  'depgraph'` on the [test:depgraphSideBySide](../../scripts/test/test_depgraphSideBySide.mjs)
  6-warp suite + the Shelby topology test in
  [test:chainEval](../../scripts/test/test_chainEval.mjs).
- Add `test_depgraph_eval_rigwarp.mjs` covering RigWarp_* (top-level + per-part).

**Why this is Phase 0.A and not its own phase.** It's a coordinate
transform off-by-half-a-canvas; it's not architectural.

#### 0.B — Driver pass wired into CanvasViewport tick

[src/anim/driverPass.js](../../src/anim/driverPass.js) exposes
`evaluateProjectDrivers(project, paramValues, time) → Map<paramId,
value>`. Currently nobody calls it. Wire it into
[CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) at the
boundary between `computeParamOverrides` (animation FCurves) and
`evalRig` (rig deformation).

Order:
1. `computeParamOverrides(animation, currentTime)` — animation tracks
2. **NEW: `evaluateProjectDrivers(project, paramValuesAfterAnim, time)` — driver overrides take precedence**
3. `evalRig(rigSpec, paramValuesAfterDrivers)`

**Deliverable:**

- Drivers visibly affect the live preview the moment they are authored.
- New telemetry: count of driver evaluations per tick, surfaced in
  `lib/logger.js` Logs panel.
- Test: `test_animationStore.mjs` extended with a project that has a
  param driver and asserts the value at tick.

#### 0.C — Constraint pass wired into selectRigSpec / depgraph output

[src/anim/constraints.js](../../src/anim/constraints.js) ships four
constraint types (`COPY_LOCATION`, `COPY_ROTATION`, `LIMIT_ROTATION`,
`TRACK_TO`). Wire them in *after* pose composition but *before* matrix
build, so a `LIMIT_ROTATION` clamps the post-pose value (matching
Blender's bone-constraint stage, not its object-constraint stage; we
will only run constraints on bone pose channels in this phase).

Wire-in point: [src/anim/depgraph/kernels/matrix.js](../../src/anim/depgraph/kernels/matrix.js)
`MATRIX_BUILD` opcode — extend to call `evaluateConstraints(node,
poseSeed, project)` before composing the world matrix.

**Deliverable:**

- A `LIMIT_ROTATION` constraint authored on a bone visibly clamps the
  user's R-modal rotation in real time.
- Test: `test_constraints_integration.mjs` covering all four types
  end-to-end through a depgraph eval.

#### 0.D.0 — Wire depgraph into the production rAF callback (audit-required)

`CanvasViewport.jsx` does not currently read `preferencesStore.evalEngine`.
The viewport tick calls `computeParamOverrides` + `evalRig` directly.
Phase 0.D.0 adds a branch that routes through `evalDepGraph` when the
flag is `'depgraph'`:

```js
// CanvasViewport.jsx tick
const evalEngine = useEvalEngine();
if (evalEngine === 'depgraph') {
  const ctx = { timeMs: animationStore.currentTime, ... };
  const result = evalDepGraph(buildDepGraph(project), ctx);
  // result.paramValues + result.poseOverrides feed evalRig
} else {
  // legacy path
}
```

The branch is introduced explicitly so 0.D's default flip actually
takes effect. Without 0.D.0, the depgraph stays in `sideBySide.js`
(test-only) and the default flip is cosmetic.

**Deliverable:**
- `CanvasViewport.jsx` reads `preferencesStore.evalEngine` per tick
- Branch routes through `evalDepGraph` when `'depgraph'`
- Both branches produce identical output on Shelby + Hiyori (this is the
  byte-fidelity gate — same gate as 0.D but proves the wire actually fires)

#### 0.D — DepGraph default flip

After 0.A–0.C + 0.D.0 land green, change [preferencesStore.js](../../src/store/preferencesStore.js)
default `evalEngine` from `'classic'` to `'depgraph'`. Keep the
`'classic'` opt-out for one release; remove in Phase 7 (final close-out
phase, formerly Phase 8).

**Deliverable:**

- All existing tests pass with depgraph as the default.
- One byte-fidelity sweep on Shelby + Hiyori with depgraph default.
- Memory entry: *"DepGraph is the production tick"*.

#### 0.E — (REMOVED v2) AnimationTree dual-write

Originally v1 had a Phase 0.E to fix the AnimationTree shadow-write
bug. Audit feedback: this is migration baggage (Rule №2). The fix is
to delete the AnimationTree entirely in Phase 1's v33 migration, not
to repair its dual-write here. Phase 0 stays focused on wiring the
existing eval substrate; 0.E is dropped.

**Phase 0 sum:** ~5–7 days (was 3–5 in v1; expanded for 0.0 + 0.D.0).
Schema unchanged. No new datablock types. Closes: 7 of the 17 Section
1 grievances (drivers theatre, constraints theatre, depgraph not in
production, gridLift bug, no driver-aware UI today, no
constraint-aware UI today, time-unit ambiguity).

---

### Phase 1 — `Action` datablock + NodeTree retirement (2 weeks, schema v33)

**Goal.** Move animation data out of `project.animations[].tracks[]`
(a project-level flat list) into `project.actions[].fcurves[]` (a
project-level keyed datablock list), and bind actions to objects via
`AnimData` ([src/store/migrations/v33_action_datablock.js]).

**Audit-driven changes from v1:**
- Phase 1 absorbs NodeTree retirement (was Phase 8.C in v1). Per audit
  Rule №2 finding, dual-writing AnimationTree/RigTree/DriverTree
  through 8 phases is migration baggage; the v33 migration retires
  them in one go.
- Sub-step 1.B.1 enumerates every production consumer of
  `project.animations[]` so the migration covers them. The audit
  identified 8 hidden consumers that v1 missed.

#### 1.A — Schema v33

```js
// project.actions[]
{
  id: string,                  // 'action.<uuid>'
  name: string,                // 'Idle' / 'Walk' / 'Wave'
  fcurves: FCurve[],           // (Phase 1 keeps the legacy keyform shape — Phase 2 upgrades)
  frameStart: number,          // ms
  frameEnd: number,            // ms
  fps: number,                 // canonical 60 (was 24 in legacy clips)
  audioTracks: AudioTrack[],   // moved verbatim from animations[]
  flag: number,                // CYCLIC | MUTED | FRAME_RANGE  (matches Blender ACT_CYCLIC | ACT_MUTED | ACT_FRAME_RANGE)
  meta: { createdAt, modifiedAt, source: 'authored' | 'imported_motion3' | 'idle_generator' }
}

// FCurve (Phase 1 keeps current shape; Phase 2 upgrades keyforms)
{
  id: string,                  // 'fcurve.<uuid>'
  rnaPath: string,             // 'objects[<id>].pose.rotation' or 'objects[__params__].values[<paramId>]'
  arrayIndex: number,          // 0 = scalar; 0..3 = component
  keyforms: [{ time, value, easing }],  // Phase 2 makes these BezTriples
  modifiers: [],               // Phase 3 populates
  driver?: ChannelDriver,      // already supported
  extrapolation: 'constant'    // Phase 3 adds 'linear' / 'cyclic'
}

// node.animData (per-Object) — Blender DNA_anim_types.h:664-740 parity
{
  actionId: string | null,     // active action; null = no animation (Blender: action pointer)
  actionInfluence: number,     // 0..1, default 1 (Blender: AnimData.act_influence)
  actionBlendmode: 'replace'|'add'|'subtract'|'multiply',  // (Blender: act_blendmode) — for active-action overlay onto NLA stack
  actionExtendmode: 'nothing'|'hold'|'hold_forward',       // (Blender: act_extendmode)
  slotHandle?: number,         // reserved; always 0 in Phase 1 (Blender: slot_handle)
  // Tweak-mode backup (Blender: tmpact / tmp_slot_handle / tmp_last_slot_identifier):
  tmpActionId?: string | null, // pre-tweak action; restored on Cancel
  tmpSlotHandle?: number,
  // Runtime tweak pointers (Blender: act_track / actstrip):
  tweakTrackId?: string | null,
  tweakStripId?: string | null,
  // NLA + drivers:
  nlaTracks: [],               // Phase 4 populates
  drivers: FCurve[],           // object-level standalone drivers (no action)
  // Flag bitmask (Blender eAnimData_Flag values used):
  flag: number                 // ADT_NLA_EDIT_ON | ADT_NLA_SOLO_TRACK | ADT_NLA_EVAL_OFF | ADT_CURVES_NOT_VISIBLE
}
```

#### 1.B — Migration v33

In-place migration:

- Each `project.animations[i]` becomes a `project.actions[i]` with the same id.
- `animation.tracks[]` → `action.fcurves[]` via `trackToFCurve()` ([src/anim/animationFCurve.js](../../src/anim/animationFCurve.js)) which already exists.
- Legacy `track.paramId` becomes `fcurve.rnaPath = 'objects[__params__].values[<paramId>]'`.
- Legacy `track.nodeId + property` becomes `fcurve.rnaPath = 'objects[<nodeId>].<property>'`.
- Each Object that was the *only* one targeted by a clip gets `node.animData.actionId = action.id` (most clips animate the whole project, so the project gets a notional `__sceneObject__` AnimData with the action — see 1.D).
- `project.animations[]` is deleted (Rule №2 — no migration baggage).
- `project.nodeTrees.{rig,driver,animation}` is deleted (audit-driven: NodeTrees retired here, not deferred to Phase 8). The NodeTreeEditor is refactored to render `selectRigSpec(project)` directly — read-only, no datablock.

Reversibility: the v32→v33 migration is one-way by design. v33 is a
strict superset of the data needed; rolling back would lose the
`animData` distinction (which actions go on which objects) and the
NodeTree shape. We accept the irreversibility because v33 is
deliberately not interoperable with v32.

#### 1.B.1 — Consumer enumeration (audit-required gate)

The v1 plan listed only 3 files as Phase-1-modified, missing 8 hidden
consumers of `project.animations[]`. **Phase 1 cannot exit until every
consumer below has been migrated to `project.actions[]`:**

| File | Current behaviour | Phase 1 fix |
|------|-------------------|-------------|
| [src/io/projectFile.js](../../src/io/projectFile.js) (line ~54) | save/load serialiser walks `project.animations` directly; reads/writes `serializedAnimations` | rewire to `project.actions` + `node.animData` |
| [src/io/live2d/exporter.js](../../src/io/live2d/exporter.js) (lines 219, 223, 535, 562) | iterates `project.animations` to emit motion3 / can3 files | iterate `project.actions` |
| [src/io/exportSpine.js](../../src/io/exportSpine.js) (line ~201) | reads `project.animations` for Spine export | rewire |
| [src/io/exportValidation.js](../../src/io/exportValidation.js) (line ~187) | validation walks `project.animations` | rewire |
| [src/io/live2d/motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js) (line ~9) | imports motion3 by pushing into `project.animations` | push into `project.actions` |
| [src/io/live2d/idle/builder.js](../../src/io/live2d/idle/builder.js) (line ~308) | idle generator pushes into `project.animations` | push into `project.actions` |
| [src/v3/editors/animations/AnimationsEditor.jsx](../../src/v3/editors/animations/AnimationsEditor.jsx) | renamed to ActionsEditor (existing v1 plan item) | already in scope |
| [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (line ~553) | reads `_proj.animations.find(...)` for the active animation | read `project.actions` + active object's `animData.actionId` |
| [src/components/canvas/GizmoOverlay.jsx](../../src/components/canvas/GizmoOverlay.jsx) | reads animations for gizmo state | rewire |
| [src/components/canvas/SkeletonOverlay.jsx](../../src/components/canvas/SkeletonOverlay.jsx) | reads animations for skeleton overlay | rewire |
| [src/store/animationStore.js](../../src/store/animationStore.js) | mid-tier coordinator | rewire all reads to actions+animData |

**Process:**
1. Before writing the v33 migration, grep `\bproject\.animations\b` and `\.animations\.` across the entire repo (including tests).
2. Each match becomes a migration line item.
3. The Phase 1 exit gate fails if any production code still reads `project.animations` after migration.
4. Test fixtures using the old shape are updated to the new shape (this is a one-shot conversion — Rule №2: no compatibility shim).

#### 1.C — `actionRegistry.js`

Module shipped 2026-05-11 at [src/anim/actionRegistry.js](../../src/anim/actionRegistry.js). Five lifecycle helpers, in-place mutation throughout (matches migrations + `objectDataAccess.js`). Return shapes follow the Blender helpers' `bool` contract rather than the prose `→ newProject` (audit-fix D-3):

```js
export function getActionUsers(project, actionId) → Object[]                  // live node refs
export function assignAction(project, objectId, actionId, slot=0) → boolean   // matches Blender bool assign_action
export function unassignAction(project, objectId) → boolean                    // matches Blender bool unassign_action
export function cloneAction(project, actionId, newName) → object | null        // returns the cloned action object
export function deleteAction(project, actionId) → { removed, cascaded }        // cascade telemetry
```

`projectStore.deleteAction` delegates to `registryDeleteAction` AND resets `useAnimationStore.activeActionId` when it matches the deleted id (audit-fix G-3, cross-store cascade). Sister thunks `projectStore.assignAction` / `unassignAction` / `cloneAction` shipped to give the registry a React-aware path (audit-fix G-4 — substrate without thunks is itself a Rule №2 anti-pattern).

**Stage 1.E entry gate (audit-fix D-10 from Stage 1.C + D-9 from Stage 1.D):** Stage 1.E will rewire these consumers to use the registry + the scene-action selector:
- `AnimationsEditor.jsx` (rename to `ActionsEditor.jsx`) — currently calls `projectStore.deleteAction`/`renameAction`/`createAction` directly; will add `cloneAction` (Duplicate command) + `assignAction` (drag-to-bind from Properties panel).
- `Properties` panel — new "AnimData" sub-section per Object surfacing the `actionId` slot with assign/unassign affordance.
- Per-action "Used by: <objects>" strip — consumes `getActionUsers`. Audit-fix D-13 Stage 1.D: when `__scene__` is in the bound list, surface it as "Scene" (not "__scene__") to match Blender Outliner naming; consider grouping it visually distinct from per-Object users (Blender shows Scene actions under a separate root in the Outliner).
- **Full `useAnimationStore.activeActionId` consumer rewire (D-9 Stage 1.D)** — Stage 1.D's audit identified 27 hits across 11 files reading `activeActionId` directly. Stage 1.E must rewire ALL of these to consume `getActiveSceneAction(project, fallback)`:
  - `src/v3/editors/timeline/TimelineEditor.jsx`
  - `src/v3/editors/dopesheet/DopesheetEditor.jsx`
  - `src/v3/editors/fcurve/FCurveEditor.jsx`
  - `src/v3/editors/animations/AnimationsEditor.jsx` (folded into the rename)
  - `src/v3/editors/parameters/ParamRow.jsx` (line 179)
  - `src/v3/editors/nodetree/NodeTreeArea.jsx`
  - `src/v3/shell/ExportModal.jsx` (line 205)
  - `src/components/canvas/CanvasViewport.jsx` (lines 646, 896, 1445, 2303)
  - `src/components/canvas/GizmoOverlay.jsx` (line 46)
  - `src/components/canvas/SkeletonOverlay.jsx` (line 114)
  - `src/io/exportAnimation.js#resolveActions` (line 100-112) — exporter integration; this is the user-visible "current action" gate.

#### 1.D — Project-level "Scene" AnimData

Some Actions animate every Object in the scene (the typical Cubism
character motion). A project-level pseudo-Object (`__scene__`) carries
an `animData` for these "scene" Actions. The exporter treats a
`__scene__` AnimData identically to an Object AnimData — it walks the
FCurves and writes them to motion3.json.

**Substrate shipped 2026-05-11 (schema v37).** The migration
`src/store/migrations/v37_scene_anim_data.js` creates a synthetic
`{id: '__scene__', type: 'scene', name: 'Scene', parent: null,
animData: defaultAnimData()}` node on every legacy v36 project (and on
fresh projects via the projectStore initial state + `resetProject`).
The selector `getActiveSceneAction(project, fallbackActionId)` lives
in `src/anim/sceneAction.js` — resolution order: scene's bound action
wins; UI store's `activeActionId` is the fallback; null when neither
resolves. The Stage 1.C audit-fix D-9 read/write asymmetry
(`getActionUsers` enumerated `__scene__` but `assignAction` rejected
it) closes naturally — both helpers now treat the scene as a
first-class Object because v37 gives it the standard `animData` slot.

**Stage 1.D ship scope (substrate only).** The plan prose "the
exporter treats `__scene__` AnimData identically to an Object
AnimData — it walks the FCurves and writes them to motion3.json" is
the EVENTUAL contract. Stage 1.D ships the substrate (migration,
selector, registry close-of-D-9). The exporter rewire to actually
read scene-bound actions is owned by Stage 1.E + Stage 1.F (Audit-fix
D-7 + G-19 Stage 1.D — overclaiming-correction). Until Stage 1.E
lands, the exporter at `src/io/live2d/exporter.js:219-223` and
`src/io/live2d/motion3json.js:50` still walk `project.actions`
directly with the UI-store `activeActionId` as the "current action"
selector. No regression — they're behaviour-preserving relative to
v36.

Blender mirror: Scene datablock owns AnimData via `Scene.adt`
(`reference/blender/source/blender/makesdna/DNA_scene_types.h:2813`).
`BKE_animdata_from_id(&scene->id)` is the AnimData getter
(`reference/blender/source/blender/blenkernel/intern/anim_data.cc:91`);
callers read `adt->action` directly — same shape as
`getSceneAction(project)`.

**Documented Blender deviations (Audit-fix Stage 1.D):**
- D-3: SS uses `type: 'scene'` for the synthetic node. Blender's
  Scene is its own ID datablock (peer of Object, not a kind of
  Object); SS approximates via a node entry so existing
  `actionRegistry` walks see it without modification.
- D-5: SS pre-creates `actionInfluence: 1` (Blender's struct DNA
  default is `0.0f`; the `1.0f` value comes from `BKE_animdata_ensure_id`
  runtime override at `anim_data.cc:123`). SS adopts the runtime
  default directly because we eagerly create AnimData (see D-6).
- D-6: SS pre-creates the scene's animData on every project. Blender
  starts scenes with `Scene.adt = nullptr` and lazy-creates via
  `BKE_animdata_ensure_id` on first action assignment. Eager creation
  trades minimal memory for first-class registry-walk uniformity.
- D-10: `getActiveSceneAction(project, fallbackActionId)` composes
  scene-binding + UI-store-pointer in one call. Blender has no
  equivalent composition — every consumer reads what it needs.
  SS-specific bridge for legacy UI behaviour (pre-Stage-1.E
  consumers).
- D-13: Stage 1.E "Used by: Scene" UI label should disambiguate
  scene from regular Objects (Blender Outliner shows actions under
  Scene as parent-child, not peer-of-Object). Cosmetic; flagged for
  Stage 1.E label work.
- D-15: `__scene__` is the FIRST double-underscore-prefixed
  synthetic that lives as a real `project.nodes` entry (`__params__`
  + `__armature__` are virtual, never in nodes). Convention break is
  intentional (see Stage 1.D module JSDoc).

#### 1.E — UI update

**SHIPPED 2026-05-11** at
[src/v3/editors/actions/ActionsEditor.jsx](../../src/v3/editors/actions/ActionsEditor.jsx)
(commit `4d3892a` substrate + `45371d5` audit-fix sweep).

- ✅ Renamed `AnimationsEditor.jsx` → `ActionsEditor.jsx`; full
  directory move from `editors/animations/` → `editors/actions/`.
- ✅ EditorRegistry `'animations'` → `'actions'` editor type;
  `uiV3Store.EditorType` enum + animation workspace `rightBottom`
  area updated.
- ✅ Per-action "Used by" strip via `getActionUsers(project, action.id)`
  + `formatUsedBy` helper. Audit-fix D-13 Stage 1.D: `__scene__`
  rendered as "Scene" and pulled to the front. Audit-fix D-11 Stage
  1.E: documented as discoverability EXTENSION over Blender's `(N)`
  user-count pip on `template_id` (`interface_template_id.cc:1267`).
- ✅ Duplicate command (per-row Copy icon) wires
  `cloneAction` thunk; clone names use Blender's `.001` convention
  via `nextDotNNNName` (Audit-fix D-6 Stage 1.E — mirrors
  `BKE_main_namemap_get_unique_name` at `main_namemap.cc:450`).
  Audit-fix G-10 Stage 1.E: thunk now returns the FULL cloned
  action object (post-finalised, NOT the immer draft proxy) so the
  caller doesn't need an extra `actions.find(...)` scan.
- ✅ Scene-action header at top of ActionsEditor: bind/unbind via
  `assignAction('__scene__', id)` / `unassignAction('__scene__')`.
  Audit-fix D-12 Stage 1.E: documented as SS-specific deviation
  because SS lacks a Scene tab in Properties; Blender's parallel is
  `SCENE_PT_animation` (`properties_scene.py:452`).
- ✅ Properties panel "Animation" section
  ([AnimDataSection.jsx](../../src/v3/editors/properties/sections/AnimDataSection.jsx))
  for per-Object AnimData binding. Visible for parts + groups.
  Default-collapsed (Audit-fix D-3 — Blender
  `bl_options = {'DEFAULT_CLOSED'}`); label "Animation" not
  "Animation Data" (Audit-fix D-2 — Blender `bl_label = "Animation"`).
  Sits in Item tab — direct mirror of Blender's `OBJECT_PT_animation`
  (`properties_object.py:618`, inherits `ObjectButtonsPanel.bl_context
  = "object"`). Audit-fix D-1 Stage 1.E RE-RESOLVED 2026-05-12: the
  original deferral premise (Blender Animation panel "lives in Data
  tab" / dedicated-Animation-tab as the clean port) was a misread of
  `PropertiesAnimationMixin`'s default `bl_context`. Blender registers
  per-datablock-type Animation subclasses across Object / Data /
  Material / World / Scene / etc. tabs — there is no dedicated
  Animation tab. SS Object selectables (parts + groups) ship on Item
  tab via `OBJECT_PT_animation` parity. See
  [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).
- ✅ Timeline action picker dropdown shows the resolved scene-aware id
  (`animation?.id`); picking re-binds `__scene__` when scene already
  bound (Audit-fix D-7 Stage 1.E: documented as Blender-faithful to
  `template_action(animated_id, ...)` writing to its pinned datablock,
  NOT the auto-broadcast `ANIM_OT_replace_action` operator).
- ✅ 11-file `activeActionId` consumer rewire through
  `getActiveSceneAction(project, fallback)`:
  TimelineEditor (12 hits), DopesheetEditor (3), FCurveEditor (3),
  ParamRow (1), NodeTreeArea (4), ExportModal (6), CanvasViewport
  (4), GizmoOverlay (1), SkeletonOverlay (1). Closes Audit-fix D-9
  Stage 1.D entry-gate enumeration.
- ✅ G-3 Stage 1.E: ActionsEditor delete confirms surface "Currently
  bound to: ..." pre-delete and toast "Unbound from: ..." post-delete
  (no more silent scene-binding cascade on action deletion).
- ✅ G-9 Stage 1.E: orphan `__scene__.animData.actionId` (when scene
  references a deleted action) emits `logger.error(...)` instead of
  silently swallowing — `deleteAction` cascade should prevent this,
  loud-error so the next bug-author finds the cascade gap fast.

#### 1.F-pre — NodeTree retirement (schema v38)

**SHIPPED 2026-05-11** (commits `ba20ef7` substrate + `7c023b3` audit-fix
sweep). Resume-path A from Stage 1.E close-out — the prerequisite that
removes the v24-shadow code path from the 1.F test matrix.

- ✅ `project.nodeTrees.{rig, driver, animation}` deleted. v38
  migration (`src/store/migrations/v38_nodetree_retirement.js`)
  idempotently strips the field from old saves.
- ✅ v22 / v23 / v24 migration MODULES deleted from disk; dispatch
  entries left as no-op shims (`N: (project) => project,`) — the
  walker required contiguous version keys at that point. Sister to
  v30/v31 retirement pattern.
  **Stage 1.F-post follow-up (2026-05-12):** Audit-fix D-9 was lifted
  by refactoring the walker to be gap-tolerant (mirror of Blender's
  `MAIN_VERSION_FILE_ATLEAST` macro family, `BKE_main.hh:855-865`);
  v22/v23/v24 + v30/v31 dispatch entries DELETED entirely. See
  [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md).
- ✅ `NodeTreeArea.jsx` refactored to derive trees on-the-fly per mode:
  - rig: `buildRigTreeForPart(part)` walks `part.modifiers[]`.
  - driver: `compileDriverTree(paramId, driver)` parses expression.
  - animation: `compileAnimationTree(action)` walks `action.fcurves[]`
    (scene-bound action wins via `getActiveSceneAction`).
- ✅ `FCurveStrip` executor's legacy `storage.track` shadow branch
  deleted (reachable only via the now-gone v24 `compileLegacyAnimationTree`).
- ✅ Audit-fix sweep: dead-write helpers
  (`buildRigTreesForProject` / `buildNodeTreesFromProject` /
  `evalAllRigTrees`) deleted from `build.js` + `eval.js` — they were
  the actual production reads/writes of `project.nodeTrees` that the
  substrate commit left behind (audit-fix G-1+G-2+D-1 HIGH).
- ✅ NodeTreeArea mode pill labels rewritten with canonical-source
  hints: `Rig (Modifiers)` / `Driver (Expression)` / `Animation (FCurves)`
  — surface read-only-by-design discoverability (audit-fix D-7).
- ✅ Blender deviation docs added throughout: D-2 (v38 cites
  `ID_NT` datablock deviation), D-6 (NodeTreeEditor read-only),
  D-8 (NodeTreeType post-v38 visualisation-only), D-9
  (`projectMigrations` walker contiguous-version vs Blender
  `MAIN_VERSION_FILE_ATLEAST`). D-4: `animationCompile` Phase 4 NLA
  TODO marker citing `NlaStrip` (`DNA_anim_types.h:425-499`).
- ✅ Audit-pin `test_nodetree_retirement.mjs` (68 assertions) — schema
  bump, migration delete + idempotency + e2e walk, no-op shim
  source-grep, disk-presence gate, repo-wide `project.nodeTrees`
  grep (v38 exempt), production-code grep for deleted branches,
  JSDoc presence checks for every deviation citation, useMemo
  dep-array regex verification.

See close-out:
[SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md).

#### 1.F — Tests

**SHIPPED 2026-05-11** — substrate (`0ab8f2c`) + audit-fix sweep
(`cdd92f9`). 4 new test files closing the missing entries from
plan §1.F (`test_actionRegistry.mjs` was already shipped in Stage
1.C+1.D). 138 substrate + 44 audit-pin = 182 assertions.

| Test | What | Status |
|------|------|--------|
| `test_actionDatablock_migration.mjs` | v32→v36 round-trip smoke pin (deep coverage in `test_migration_v36.mjs`); plus D-5 escape-grammar contract assertion | ✅ 32 assertions |
| `test_actionRegistry.mjs` | Registry CRUD + assignAction / cloneAction | ✅ 95 assertions (Stage 1.C+1.D) |
| `test_actionScene.mjs` | `__scene__` AnimData treated like Object AnimData by exporter; D-6 phase-scope warning + G-5 leakage check | ✅ 37 assertions |
| `test_actionExportMotion3.mjs` | Each Action exports to one motion3.json (per-Action contract); D-7 NLA TODO + G-11 single-kf Meta accounting | ✅ 39 assertions |
| `test_actionExportCan3.mjs` | Each Action exports to one CSceneSource (multiple actions in one .can3); D-7 NLA TODO + G-2 paramSpec resolution + G-3+G-9 robust XML extraction | ✅ 30 assertions |
| `test_audit_fixes_2026_05_11_phase1_stage1f.mjs` | Audit-pin: 11 dedup'd gap blocks (2 HIGH + 7 MED + 4 LOW) | ✅ 44 assertions |

Audit-fix sweep also touched production code:
- `motion3json.js`: dropped dead `opts.loop` parameter (Rule №2 / Rule №1
  anti-pattern); added Loop-semantics deviation JSDoc citing
  ACT_CYCLIC bit (`DNA_action_types.h:385-386`); ACT_CYCLIC integration
  deferred to Phase 6+ Cyclic-toggle UI.
- `can3writer.js`: plumbed `project.parameters[]` through, closing
  hardcoded `-1..1` data gap for fcurve-only param ranges
  (idle-generator / AI-motion params now get correct ranges).
- `actionRegistry.js`: corrected
  `BKE_main_namemap_get_unique_name:450` citation to dual cite
  `id_name_final_build:441` (algorithmic mirror) +
  `BKE_main_namemap_get_unique_name:582` (public API).
- `v36_action_datablock.js`: pulled BKE-runtime override deviation
  doc (sister to v37); added 4 SS-specific shape deviation notes
  (action.id vs ID.name, audioTracks SS-only, meta SS-only,
  slotHandle slot-table absence).
- `v37_scene_anim_data.js`: documented `__scene__.parent: null`
  Blender deviation.
- `animationFCurve.js#decodeFCurveTarget`: documented escape-grammar
  contract (SS regex `[^"]+` vs Blender escape-aware tokenizer).

See close-out:
[SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md).

#### 1.G — Phase exit gate

- All export tests green: motion3, can3, cmo3, model3 byte-identical.
- Round-trip: `project → save → load → save → load` produces identical bytes.
- Two Cubism Viewer .moc3 acceptance loads — covers BOTH user E2E test
  PSDs per memory `feedback_test_character_is_shelby.md` ("the byte-
  fidelity gate must exercise **both** PSDs"; same dual-PSD policy
  already in §11 lines 1625-1626 and Phase 0.D flag-flip gate):
  - **Shelby (Western)** — `shelby_neutral_ok.psd → Init Rig →
    ActionsEditor (one keyframed Action) → bind to __scene__ → export
    → Cubism Viewer 5.0 + Cubism Editor 5.0 Animation workspace`. The
    canonical Western test fixture; regression baseline carries over
    from §11's `shelby.cmo3` (SS v0.2 export) byte-diff gate.
  - **test_image4 (anime)** — same flow on `test_image4.psd`. Anime
    topology has historically exposed bugs the Western fixture missed
    (BUG-025 leg-roles fly was anime-only; see memory
    `project_legs_fly_bug_fix_shipped.md`). No baseline cmo3 exists,
    so the gate is acceptance (file loads, Action animates), not
    byte-diff.
  Hiyori is reference-only with NO PSD source (see §11 lines 1617-1618
  + memory `feedback_test_character_is_shelby.md`: "user has Hiyori's
  *exported* `.cmo3` … but does NOT have the Hiyori PSD source"). Gate
  on both test PSDs is acceptance (file loads, Action animates) —
  NOT byte-identity (which is the §11-line-1627 separate Hiyori-
  reference gate run on the exported .moc3 against
  `reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.moc3`).

**Phase 1 sum:** ~1–1.5 weeks. Schema v33. New: `Action` datablock,
`AnimData` per Object, `__scene__` pseudo-Object, ActionsEditor UI.
Closes: 1 of the 17 grievances (no Action datablock).

---

### Phase 2 — BezTriple handles (1 week, schema v34)

**Goal.** Replace per-segment `easing: string` with per-keyframe Blender
`BezTriple`-shape handles. The user can drag bezier handles in the Graph
Editor (Phase 5).

#### 2.A — Schema v34

```js
// FCurve.keyforms[i] (was: { time, value, easing })
// Blender DNA_curve_types.h:83-117 (BezTriple) + DNA_curve_enums.h:180-225
{
  time: number,                    // ms (canonical per Phase 0.0)
  value: number,
  // Tangent representation (Blender BezTriple.vec[0]/[1]/[2] parity):
  handleLeft: { time, value },     // pre-keyframe handle
  handleRight: { time, value },    // post-keyframe handle
  handleType: {
    left: 'free' | 'aligned' | 'vector' | 'auto' | 'auto_clamped',
    right: 'free' | 'aligned' | 'vector' | 'auto' | 'auto_clamped'
  },
  // Auto-handle algorithm flag (Blender BezTriple.auto_handle_type, eBezTriple_Auto_Type):
  autoHandleType?: 'normal' | 'locked_final',
  interpolation: 'constant' | 'linear' | 'bezier' |
                 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' |
                 'circ' | 'back' | 'bounce' | 'elastic',
  // Easing mode for named easings (Blender BezTriple.easing, eBezTriple_Easing).
  // IGNORED when interpolation === 'constant' | 'linear' | 'bezier'.
  easeMode?: 'auto' | 'in' | 'out' | 'inout',  // 'auto' = Blender's BEZT_IPO_EASE_AUTO default
  flag: number    // SELECTED (left/right/handle) | LOCKED | MUTED
}
```

#### 2.B — Migration v34

For each existing keyform:

- `easing === 'linear'` → `interpolation: 'linear'`, `handleType: 'vector'/'vector'`.
- `easing === 'stepped'` → `interpolation: 'constant'`, `handleType: 'vector'/'vector'`.
- `easing === 'ease'` → `interpolation: 'bezier'`, `handleType: 'auto'/'auto'`.
- `easing === 'ease-in'` → `interpolation: 'bezier'`, `handleType: 'free'/'auto'`, handle vectors derived from the legacy preset cubic-bezier coefficients.
- `easing === 'ease-out'` → `interpolation: 'bezier'`, `handleType: 'auto'/'free'`, similar.
- `easing === [c1, c2, c3, c4]` (custom cubic bezier) → `interpolation: 'bezier'`, `handleType: 'free'/'free'`, with handles derived from the cubic-bezier control points.

#### 2.C — Evaluator

[src/anim/fcurve.js](../../src/anim/fcurve.js) `evaluateFCurve(fcu, time)`:

- Binary search to find the segment `[k_i, k_{i+1}]` containing `time`.
- Branch on `k_i.interpolation`:
  - `'constant'` → `k_i.value`
  - `'linear'` → linear interp `k_i.value` → `k_{i+1}.value`
  - `'bezier'` → cubic-bezier sampling using `k_i.handleRight` and `k_{i+1}.handleLeft` as control points (matches Blender; the control points are absolute, not deltas)
  - `'sine'`, `'quad'`, etc. → preset easing curves at `t = (time - k_i.time) / (k_{i+1}.time - k_i.time)`, with `easeMode` selecting in/out/inout

#### 2.D — Auto-handle calculation

When a keyframe is inserted with `handleType: 'auto_clamped'` or
`'auto'` (the default), handles must be derived from neighbours.
Algorithm matches Blender's [BKE_fcurve_handles_recalc](../../reference/blender/source/blender/blenkernel/intern/fcurve.cc):

- `'auto'`: average slope of incoming + outgoing segments; handle
  length = 1/3 of segment length.
- `'auto_clamped'`: same but if the resulting handle would create an
  overshoot (value outside `[k_i, k_{i+1}]` range), clamp to flat.

This is implemented in a new helper [src/anim/fcurveHandles.js].

#### 2.E — UI

Phase 2 ships only the *evaluator* and the *migration* — the user-facing
write-mode is Phase 5. In Phase 2, the timeline easing dropdown picks
`interpolation` (and writes default `auto_clamped` handles); custom
bezier authoring is not yet exposed.

#### 2.F — Tests

| Test | What |
|------|------|
| `test_bezTriple_migration.mjs` | v33→v34 migration: every legacy easing maps to the right interpolation + handles |
| `test_fcurve_eval_constant.mjs` | constant interp |
| `test_fcurve_eval_linear.mjs` | linear interp |
| `test_fcurve_eval_bezier.mjs` | cubic-bezier sample at known times against numeric reference |
| `test_fcurve_eval_easings.mjs` | all 10 named easings (sine/quad/cubic/quart/quint/expo/circ/back/bounce/elastic) × 3 modes |
| `test_fcurve_handles_auto.mjs` | auto-handle calculation matches Blender output for ~20 fixture curves |
| `test_fcurve_handles_autoClamped.mjs` | clamped variant |

#### 2.G — Export-side parity

motion3.json exporter ([src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js))
must round-trip bezier handles → Cubism segments. Cubism's segment
encoding has linear (segment type 0), bezier (1), stepped (2). Map:

- `interpolation: 'linear'` → segment type 0
- `interpolation: 'constant'` → segment type 2 (stepped)
- `interpolation: 'bezier'` → segment type 1 with control points
  derived from `handleLeft` / `handleRight`
- All other easings → bake to a sequence of bezier segments at export
  time (Cubism doesn't have native sine/quad/etc.)

`.can3` already takes bezier control points, so it gets handles for free.

#### 2.G.1 — motion3jsonImport.js upgrade (audit-required)

The audit caught a critical lossiness gate: **today's
[motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js)
discards Cubism bezier control points** (lines 20-34 document the
deferral). Every Cubism `.motion3.json` imported into SS today is
flattened to `easing: 'ease-both'` regardless of the original curve.

Phase 2's "round-trip byte-identical on 6 Cubism samples" exit gate
is vacuous unless the importer is upgraded *first* — otherwise the
v34 migration is migrating already-flattened data.

**Phase 2.G.1 ships before the byte-fidelity sweep:**

- Decode Cubism segment type 1 (bezier) into `BezTriple` with
  `handleLeft.time/value = (cx1*duration + t0, cy1*range + v0)` and
  `handleRight.time/value = (cx2*duration + t0, cy2*range + v0)`,
  matching Cubism's per-segment cubic Bezier definition.
- Decode segment type 0 (linear) → `interpolation: 'linear'`,
  `handleType: 'vector'/'vector'`.
- Decode segment type 2 (stepped) → `interpolation: 'constant'`,
  `handleType: 'vector'/'vector'`.
- Round-trip test: import Hiyori's idle motion3 → export → diff against
  the original. Bytes must match. The plan ships this test as
  `test_motion3jsonImportExport_roundtrip.mjs`.

#### 2.H — Phase exit gate

- Round-trip `import motion3.json → save → load → export motion3.json`
  is byte-identical for all 6 Cubism samples (Hiyori, Mark, Mao,
  Natori, Wanko, Mocchin).
- All Phase 1 tests still green.

**Phase 2 sum:** ~1 week. Schema v34. New: BezTriple keyform shape,
auto-handle calculator. Closes: 1 grievance (no per-keyframe bezier
handles).

---

### Phase 3 — F-Curve modifiers ✅ SHIP-COMPLETE 2026-05-18 (1 week, schema v41)

**Status:** 7/7 slices SHIPPED (3.A → 3.G). Schema v41 (was planned
v34; the actual codebase had progressed through v35..v40 by the time
Phase 3 opened). 270 FModifier-suite assertions green. 1 user-side
manual sweep ([PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md))
remains for Cubism Viewer fidelity + UI exercise.

**Goal.** Procedural post-processing on FCurves. A 4-keyframe loop
becomes infinite via `Cycles`; jitter via `Noise`; polynomial via
`Generator`; etc.

**Audit-driven changes from v1:**
- Cycles ships **4** modes (`none`, `repeat`, `repeat_offset`,
  `mirror`) matching Blender's `eFMod_Cycling_Modes`. The invented
  `extrapolate` mode is dropped — FCurve-level extrapolation
  (`linear`/`constant`) is a separate per-FCurve field, not a Cycles
  mode. The plan already had `FCurve.extrapolation` (line 378 in v1);
  we keep it for that purpose.
- Generator's second mode is **`polynomial_factorised`**, not invented
  `expanded`. Coefficient semantics: factorised form is
  `(c0 + c1*x) * (c2 + c3*x) * ...`, not the same as polynomial.
- Noise gains **`lacunarity`** and **`roughness`** (Blender ships them
  in modern Noise; v1 omitted).
- Two Blender modifier types are **deferred to a follow-up plan**:
  `function_generator` (sin/cos/sqrt/ln/sinc — niche; SS use case is
  thin) and `smooth` (Gaussian smoothing — overlaps with FCurve
  re-key tools that already exist via the Graph Editor write-mode in
  Phase 5). Documenting deferral here so the absence is explicit, not
  an oversight.

#### 3.A — Schema v41 (was planned as v34; the actual codebase had progressed through v35/v36/v37/v38/v39/v40 by the time Phase 3 opened, so Slice 3.A landed at v41)

```js
// FCurve.modifiers[]
// Blender DNA_anim_enums.h:25-35 (eFModifier_Types)
{
  id: string,
  // 6 modifier types ship in Phase 3:
  type: 'cycles' | 'noise' | 'generator' | 'limits' | 'stepped' | 'envelope',
  // Deferred to follow-up: 'function_generator', 'smooth'
  influence: number,           // 0..1 blend
  flag: number,                // MUTED | EXPANDED | DISABLED
  useRange: boolean,           // restrict effect to [sfra, efra]
  sfra: number, efra: number,  // ms
  blendin: number, blendout: number,  // ms
  data: <type-specific>
}
```

Per-type data shapes:

```js
// cycles — Blender eFMod_Cycling_Modes (4 values, NOT 5)
{ before: 'none' | 'repeat' | 'repeat_offset' | 'mirror',
  after:  'none' | 'repeat' | 'repeat_offset' | 'mirror',
  beforeCycles: number,        // 0 = infinite
  afterCycles: number }
// Note: linear/constant extrapolation lives on FCurve.extrapolation,
// not as a Cycles mode. Audit-driven correction.

// noise — Blender FMod_Noise (DNA_anim_types.h)
{ size: number,                // wavelength in ms
  strength: number,            // amplitude in value-units
  phase: number,               // ms offset
  offset: number,              // value bias
  blendType: 'replace' | 'add' | 'subtract' | 'multiply',
  depth: number,               // octaves (Blender uses short, no hard cap; we use 1..8)
  lacunarity: number,          // frequency multiplier per octave (Blender default 2.0)
  roughness: number }          // amplitude multiplier per octave (Blender default 0.5)

// generator — Blender eFMod_Generator_Modes
{ mode: 'polynomial' | 'polynomial_factorised',  // (was 'expanded' in v1; corrected)
  coefficients: number[],
  // For 'polynomial': c0 + c1*x + c2*x^2 + ...
  // For 'polynomial_factorised': (c0 + c1*x) * (c2 + c3*x) * (c4 + c5*x) * ...
  blendType: 'replace' | 'add' | 'subtract' | 'multiply' }

// limits
{ useMinX, useMaxX, useMinY, useMaxY: boolean,
  minX, maxX, minY, maxY: number }

// stepped — Blender FMod_Stepped (uses bitmask flag in Blender; we use booleans for clarity)
{ stepSize: number,            // hold for N ms
  offset: number,
  useStartFrame, useEndFrame: boolean,
  startFrame, endFrame: number }

// envelope
{ controlPoints: [{ time, min, max }],
  referenceValue: number,
  defaultMin, defaultMax: number }
```

#### 3.B — Modifier evaluator

Implementation: [src/anim/fmodifiers.js].

The evaluator runs in two passes per FCurve sample, matching Blender
([BKE_fmodifiers_calculate_*](../../reference/blender/source/blender/blenkernel/intern/fmodifier.cc)):

1. **Time-modifying pass.** Modifiers that warp time (`Cycles`, `Stepped`)
   compose `time → effective_time` before keyframe sampling.
2. Keyframe sample at `effective_time`.
3. **Value-modifying pass.** Modifiers that warp value (`Noise`,
   `Generator`, `Limits`, `Envelope`) compose `value → effective_value`
   after keyframe sampling.

Per-modifier influence is blended: `final = lerp(value_in, value_out,
influence)`.

#### 3.C — UI

Per-FCurve modifier list in the Properties panel under a new "FCurve
Modifiers" section. Add / remove / reorder / mute / expand. Per-modifier
inline data editor (specific to each type).

#### 3.D — Cycles is special — SHIPPED 2026-05-18

`Cycles` is special because the user can author a 4-keyframe walk and
have it loop forever. The motion3.json exporter must understand this:
the Cubism `.motion3.json` format has `IsLoop: bool` on the metadata
and re-evaluates the curve modulo duration. Map: presence of a
`Cycles` modifier with `before='none', after='repeat', afterCycles=0`
on every FCurve in an Action → `IsLoop: true` in the exported
motion3.json.

If only some FCurves cycle, bake the cycles into explicit keyframes at
export time (the alternative — emitting a non-loop motion3.json with
some cycling channels — is not representable in Cubism's format).

**Implementation.** `actionHasUniformLoopingCycles(action)` in
[src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js)
gates `Meta.Loop`; `bakeFCurveModifiers(fcurve, durationMs, fps)`
samples the full FModifier stack via `evaluateFCurve` at the action
FPS for the cycling channels when `Loop=false`. The importer companion
[src/io/live2d/motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js)'s
`attachLoopCyclesModifier` synthesises a head-of-stack Cycles modifier
on every fcurve when `Meta.Loop=true` so the round-trip preserves the
loop signal. Behaviour change: the legacy hardcoded `Loop=true` is
removed; actions without any Cycles modifier now export `Loop=false`
(the idle generator bypasses this path via `buildMotion3`, unaffected).
Tests in
[scripts/test/test_motion3jsonCyclesExport.mjs](../../scripts/test/test_motion3jsonCyclesExport.mjs)
(37 assertions) + extended
[test_actionExportMotion3.mjs](../../scripts/test/test_actionExportMotion3.mjs)
§5 (10 new) + updated
[test_audit_fixes_2026_05_11_phase1_stage1f.mjs](../../scripts/test/test_audit_fixes_2026_05_11_phase1_stage1f.mjs)
§1 (Slice 3.D semantics replace the Stage 1.F hardcoded-Loop pin).

#### 3.E — Noise is special — SHIPPED 2026-05-18

`Noise` outputs a Perlin field. Determinism is structural: the field
is fully determined by
`(size, phase, offset, depth, lacunarity, roughness, evaltime)` and a
hardcoded permutation table — matching Blender's
`fcm_noise_evaluate` at `fmodifier.cc:814-867` which takes exactly the
same inputs with NO per-fcurve or per-modifier seed. Stable across
saves, across SS process restarts, and byte-fidelity-testable by
construction. *(The original plan-draft phrasing
"`(fcurveId, modifierId, time)`" was aspirational and divergent from
Blender; corrected here against the shipped implementation in
`src/anim/fmodifiers.js:528-540`. Audit-fix 3.E HIGH-1.)*

The export pipeline bakes Noise modifiers into explicit keyframes at
the FPS of the target Action — Cubism has no live-noise primitive.

**SS deviation: Cycles+Noise loop behaviour.** When an action with
uniform Cycles satisfies `Meta.Loop=true` (3.D) and one fcurve also
has Noise (3.E forces bake on that channel), Cubism's runtime replays
the *same* baked noise samples each loop iteration. Blender's live
behaviour re-evaluates Noise at unwrapped absolute time per iteration,
so each Cycles iteration shows *different* noise. The bake captures
one cycle's worth; Cubism's looping replays it identically. **Accepted
deviation** — Cubism has no live-noise primitive, so the only
alternative is to bake a multi-cycle sequence (forcing Loop=false and
losing the runtime-loop efficiency).

**Implementation.** `hasActiveNoiseModifier(fcurve)` in
[src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js)
scans the modifier stack (Noise is value-only — no head-of-stack
invariant, unlike Cycles). The bake gate now OR-composes the 3.D
Cycles trigger with this new Noise trigger; Noise fires
**unconditionally** (regardless of `Meta.Loop`) per plan §3.E. When a
fcurve carries both Cycles AND Noise, the Noise trigger still bakes
that channel even when the action would otherwise satisfy the uniform
Cycles predicate — Cubism's runtime then loops over the baked
Cycles+Noise samples (the only semantically coherent mapping; Cubism
cannot reproduce per-cycle-independent noise). Determinism is
inherited from `evaluateNoiseValue` in `fmodifiers.js`: same `(data,
evaltime)` → bit-identical output via `perlinFbm2D`. Tests in
[scripts/test/test_motion3jsonNoiseExport.mjs](../../scripts/test/test_motion3jsonNoiseExport.mjs)
(23 assertions: bake-fires, mute/disabled skip, Cycles+Noise
composition, determinism across runs, dual-Noise composition,
mesh_verts+Noise path).

#### 3.F — Tests — SHIPPED 2026-05-18

The plan listed 8 dedicated test files. Implementation strategy: a
consolidated [test_fmodifiers.mjs](../../scripts/test/test_fmodifiers.mjs)
(106 assertions after 3.F gap-fills) covers per-type semantics +
composition for all 6 modifier types in a single eval-substrate file,
plus a dedicated
[test_fmodifiers_export_bake.mjs](../../scripts/test/test_fmodifiers_export_bake.mjs)
(18 assertions) for the byte-identity gate. **Splitting the consolidated
file into 6 per-type files** (one for each modifier type) would have
been pure code churn — every assertion would have to be re-grouped, the
existing 102 substrate tests already cover the plan target table
substantially, and per Rule №2 (no migration baggage) we don't churn
working test infrastructure just to match an aspirational file naming.

Coverage mapping (plan target → actual implementation):

| Plan target | Actual coverage |
|------|------|
| `test_fmodifiers_cycles.mjs` | test_fmodifiers.mjs §30-36, §51 + test_motion3jsonCyclesExport.mjs (42 asserts) |
| `test_fmodifiers_noise.mjs` | test_fmodifiers.mjs §7-9, §25-29, §57, §62 (frequency response gap-fill) |
| `test_fmodifiers_generator.mjs` | test_fmodifiers.mjs §10-15, §53-54, §61 (degree-0 gap-fill) |
| `test_fmodifiers_limits.mjs` | test_fmodifiers.mjs §16-18, §52 |
| `test_fmodifiers_stepped.mjs` | test_fmodifiers.mjs §19-21, §38, §55 |
| `test_fmodifiers_envelope.mjs` | test_fmodifiers.mjs §22-24 |
| `test_fmodifiers_stack.mjs` | test_fmodifiers.mjs §49 + §63 (3-way Cycles+Noise+Limits gap-fill) |
| `test_fmodifiers_export_bake.mjs` | **NEW** dedicated file — 18 byte-identity asserts vs hand-bake reference |

The byte-identity gate (`test_fmodifiers_export_bake.mjs`) is the load-
bearing addition: it verifies `generateMotion3Json`'s bake helper
produces segment arrays byte-identical to a manually-constructed
hand-bake using the same FPS cadence + the same `evaluateFCurve`
pipeline. Covers Noise, Cycles, Cycles+Noise composition, all 4
blend types, multiple FPS values, non-aligned-duration clamp
arithmetic, and the driver-bearing fcurve case (regression-pin for
3.D audit-fix H-1 driver-leak).

#### 3.G — Phase exit gate ✅ SHIPPED 2026-05-18

**Status:** Phase 3 SHIP-COMPLETE (3.A → 3.G all green, 7/7 slices).

**Gate coverage:**

1. **All FModifier tests green** — ✅ satisfied.
   - `test:fmodifiers` (106) + `test:fmodifiersExportBake` (18) +
     `test:fmodifierRoundTrip` (32, NEW this slice) +
     `test:motion3jsonCyclesExport` (42) + `test:motion3jsonNoiseExport`
     (26) + `test:actionExportMotion3` (46) = **270 assertions** across
     FModifier surface.
2. **Cubism Viewer load of motion3.json with `Cycles` → loops correctly**
   — deferred to user-side per `feedback_no_background`. Consolidated
   into [PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md)
   §2.5 + §4.
3. **Round-trip: cycle-modifier on save → load → save preserves the
   modifier** — ✅ automated by new
   [scripts/test/test_fmodifierRoundTrip.mjs](../../scripts/test/test_fmodifierRoundTrip.mjs).
   - 32 assertions covering: SS-uniform-Cycles → JSON → import →
     re-export (byte-identical incl. Cycles preservation); Loop=false
     trivial round-trip; mixed-Cycles lossy case (post-stabilisation
     idempotence — bake collapses intent but audible behaviour
     preserved); Cycles+Noise hybrid (Loop=true preserved + Noise
     determinism); Noise-only (no Loop signal); SS project-store layer
     (`JSON.parse(JSON.stringify)` preserves modifier stack);
     consecutive-save determinism.
   - **Time-precision finding:** SS canonical time is integer ms
     (`feedback_ms_canonical_animation_time`); the bake helper emits
     sub-ms times in JSON (e.g. `0.0333...` for 30fps step), which
     `parseMotion3Json` snaps to integer ms via `Math.round(seg[0] *
     1000)`. So single-pass round-trip is NOT byte-identical for baked
     outputs — but the SECOND round-trip onward IS (stabilised on the
     ms grid). §3c/§4d/§5b assert this idempotence-after-stabilisation
     contract.

**Manual verification (user-side, item 2):** Consolidated into
[PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md](PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md)
covering 3.C UI (N-panel Modifiers section, all 6 types,
add/edit/mute/remove/reorder/undo), 3.D Cycles export (uniform → Loop=true,
mixed → Loop=false+bake, Cubism Viewer seamless loop), 3.E Noise export
(bake fires, muted skips, Cycles+Noise hybrid, determinism), Cubism
Viewer integration. ~25–35 min single sweep; uses existing Shelby
project state, no PSD re-import.

**Phase 3 sum:** ~1 week (actual: 7 days of substrate + audit + close-out
across 7 slices, all 2026-05-18 final slice day). Schema v41 (bumped
from v35 in plan-aspirational pre-ship — actual v41 carries the
modifier-bearing fcurve shape). 270 FModifier assertions. 11 cumulative
SS deviations documented in slice close-out docs. **Closes: 1 grievance
(no FModifiers).**

---

### Phase 4 — NLA stack (1.5 weeks, schema v35-aspirational / actual v42+)

**Goal.** Multi-action composition with blend modes, time remapping,
and tweak-mode push.

**Status:** **Slice 4.F SHIPPED 2026-05-19** (`218c68c`). Slices
complete: 4.A substrate + 4.B evaluator + 4.C tweak mode +
4.D.1-4.D.4 NLAEditor (read-only/drag/affordances/CRUD+PushDown) +
4.E BakeNLA operator + **4.F test parity sweep + manual checklists**.
Schema at **v42** (no bump since 4.A migration). Phase 4 cumulative:
**735 test asserts**, 22 SS deviations, 70 audit sweeps Phase-4-
totalled.
**Cite-discipline**: BROKE at 5 on 4.D.1; RESET to 0; HOLDS at 1
after 4.D.2; HOLDS at 2 after 4.D.3; BROKE at 2, RESET to 0 after
4.D.4; **BROKE at 2, RESET to 0** after 4.E (2 fab cites: function
name `animsys_construct_orig_action_strip` was actually
`animsys_create_action_track_strip` at `anim_sys.cc:3313`;
`keyframes_general.cc#clean_fcurve_segments` doesn't exist — bake's
clean is `bpy_extras/anim_utils.py:657-676` with wrong epsilon AND
wrong formula. Both corrected; runtime formula corrected from
max-of-abs/1e-6 to byte-faithful SUM-of-abs/1e-4).
Lesson recorded: Explore-agent reconnaissance cites need byte-
verification too, not just the marquee ones spot-checked. See
close-out docs
`docs/plans/SESSION_CLOSEOUT_2026_05_{18,19}_ANIMATION_PHASE_4_SLICE_{A,B,C,D1,D2,D3,D4,E}.md`.
**Remaining: 4.G (phase exit gate)** — GATED on user-side manual
verification at `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`
(covers Phase 3 FModifier UI carryover + Phase 4 §4.G end-to-end
scenarios). 4.G ships as a docs-only commit when the checklist comes
back green.

**Audit-driven changes from v1:**
- `combine` blend mode is **REMOVED from Phase 4**. The audit caught
  Rule №1 violation: silently degrading `combine` to `replace` for
  non-rotation channels (because SS uses Euler not quaternions) is
  exactly the silent-fallback the rule prohibits. Either implement
  proper Euler-via-quaternion-intermediary composition (which is real
  work, not in scope here), or don't ship `combine` until then.
  Phase 4 ships the 4 unambiguous modes; `combine` is documented in
  §2.2 (out of scope) as a deferred follow-up.
- `ANIM_TWEAK_MODE` flag renamed to **`ADT_NLA_EDIT_ON`** matching
  Blender DNA_anim_enums.h:553-587 (`eAnimData_Flag`). Verified during
  4.A: bit value is `(1 << 2)` per `DNA_anim_enums.h:559`; load-bearing
  for Slice 4.C tweak entry/exit.

**Plan-claim correction (Slice 4.A 2026-05-18):**
> Pre-Slice-4.A version of this section claimed: *"AnimData backup
> pointers (`tmpActionId` / `tmpSlotHandle` / `tweakTrackId` /
> `tweakStripId`) are part of Phase 1's animData shape (now expanded
> above) — Phase 4 wires them."* This was **WRONG**. v36's
> `defaultAnimData()` (`src/store/migrations/v36_action_datablock.js:292-303`)
> and v37's parallel (`v37_scene_anim_data.js:140-151`) declared 8
> fields and stopped — the 4 backup-pointer slots were absent.
> Corrected via v42 migration (sister-update to v36/v37 +
> `projectStore.js` so fresh-project ↔ migrated-project shapes stay
> in sync). Per `feedback_check_plan_against_impl_on_consumption`:
> always verify plan claims against shipped impl before consumption.

#### 4.A — Schema v42 (was v35 aspirational; actual reflects Phase 0-3 schema-bump trail)

```js
// node.animData.nlaTracks[]
{
  id: string,
  name: string,                // 'Lower Body', 'Upper Body', 'Face' (free-form)
  strips: NlaStrip[],
  flag: number,                // MUTED | SOLO | PROTECTED | ACTIVE
  index: number                // bottom-to-top order (0 is bottom)
}

// NlaStrip — Blender DNA_anim_types.h NlaStrip parity
{
  id: string,
  name: string,
  actionId: string,            // ref into project.actions[]
  slotHandle: number,          // 0 in Phase 4
  start: number,               // ms (placement on track)
  end: number,                 // ms
  actstart: number,            // ms (action local)
  actend: number,              // ms
  repeat: number,              // 1.0 = no repeat
  scale: number,               // 1.0 = no time scale
  // Blend modes — 4 ship, matching Blender NLASTRIP_MODE_REPLACE/ADD/SUBTRACT/MULTIPLY.
  // 'combine' (Blender NLASTRIP_MODE_COMBINE) deferred until proper Euler-via-quat composition lands.
  blendmode: 'replace' | 'add' | 'subtract' | 'multiply',
  // Extend mode — Blender eNlaStrip_Extrapolate_Mode (3 values) MATCHES.
  extendmode: 'nothing' | 'hold' | 'hold_forward',
  influence: number,           // 0..1 baseline
  blendin: number, blendout: number,  // ms ramp
  // Per-strip overrides:
  fcurves: FCurve[],           // can override influence and strip_time per-frame
  flag: number                 // MUTED | SELECTED | TWEAKING | USR_INFLUENCE | USR_TIME
}
```

#### 4.B — NLA evaluator (SHIPPED 2026-05-18: `d91060d` + `8d03d4c`)

[src/anim/nla.js]:

```
function evaluateNla(animData, time, project, evalContext) → Map<rnaPath, value> {
  let acc = new Map();
  // Iterate tracks bottom-to-top; muted skip; solo trumps mute
  for (track of orderedTracks(animData.nlaTracks)) {
    if (skip(track)) continue;
    for (strip of track.strips) {
      if (!stripActiveAt(strip, time)) continue;
      const stripT = remapStripTime(strip, time);
      const stripInf = computeStripInfluence(strip, time);
      const evalResult = evaluateAction(project.actions[strip.actionId], stripT);
      acc = blendInto(acc, evalResult, strip.blendmode, stripInf);
    }
  }
  return acc;
}
```

Blend modes match Blender's
[evaluate_nla_strip_blend](../../reference/blender/source/blender/blenkernel/intern/nla.cc):

- `'replace'` → `out = lerp(out, in, inf)`
- `'add'` → `out = out + in * inf`
- `'subtract'` → `out = out - in * inf`
- `'multiply'` → `out = lerp(out, out * in, inf)`
- `'combine'` — **DEFERRED** (audit-driven, Rule №1). Implementing it
  properly requires Euler ↔ quaternion ↔ Euler composition for
  rotation channels and a separate path for additive non-rotation
  channels. Shipping a `combine` that silently degrades to `replace`
  for non-rotation hides intent. Plan to add in a follow-up plan with
  proper coverage.

#### 4.C — Tweak mode (SHIPPED 2026-05-19: `f0fd4be` + `3ae4c5e`)

When the user opens an Action for editing while it's bound to an NLA
strip, Blender enters "tweak mode": the Action becomes the topmost
implicit track and edits write directly to the Action; the NLA stack
below is rendered as the underlay.

UI: an "Edit Action" button on a selected strip in the NLAEditor
toggles tweak. Visual indication: the strip border turns yellow.

Implementation: `animData.flag |= ADT_NLA_EDIT_ON` (Blender-faithful
flag name; v1's `ANIM_TWEAK_MODE` was invented). Tweak entry stores
the pre-tweak action in `animData.tmpActionId` (and `tmpSlotHandle`)
so Cancel restores cleanly. Runtime tweak strip pointer:
`animData.tweakStripId`. Eval branches on `ADT_NLA_EDIT_ON`. Wired
helpers parallel Blender's `BKE_nla_tweakmode_enter` /
`BKE_nla_tweakmode_exit` / `BKE_nla_tweakmode_clear_flags` (in
`BKE_nla.hh`).

#### 4.D — NLAEditor (new editor surface)

[src/v3/editors/nla/NLAEditor.jsx] — a dedicated editor tab in the
animation workspace, similar to TimelineEditor but with track rows
instead of FCurve rows.

Features:
- Track list (drag to reorder, right-click for menu)
- Strip rectangles per track row (drag to move, drag-edge to resize)
- Click strip → open in TimelineEditor (tweak mode)
- Per-strip dropdown for blend mode
- Per-track Mute / Solo toggles
- "Push Action Down" button (current Action of selected Object → new
  bottom-track strip)

#### 4.E — Bake NLA operator

Operator `animation.bakeNla` that flattens the NLA stack into a new
Action. Used by the exporter (Phase 4 keeps the exporter NLA-blind:
only flat actions go to motion3.json) and as a user-facing "commit"
button.

The operator samples the NLA stack at the active Action's FPS for the
strip time range and writes a new Action with one FCurve per RNA path
seen.

#### 4.F — Tests

**Status:** SHIPPED 2026-05-19 — coverage parity sweep complete.

The v2-plan table below is the AS-PLANNED file-per-feature naming
convention. SS shipped its tests under different filenames + grouped
by SUBSTRATE-LAYER not by feature, which is the natural shape given
that several "features" share an evaluator code path. The mapping
table after this one shows where each plan-row's coverage actually
lives.

| Plan v2 (notional) | As-shipped — file + sections (asserts) | Status |
|--------------------|----------------------------------------|--------|
| `test_nla_strip_eval.mjs` | `test_nlaEval` §3-7 (remapStripTime forward/scale/repeat/reverse/end-pin) + §12 (stripActiveAt extend-mode) + §22 (blendin) + §27 (USR_TIME) | FULL |
| `test_nla_blend_replace.mjs` | `test_nlaEval` §1 (kernel) + §14 (single replace strip) + §22 (blendin ramp on replace) | FULL |
| `test_nla_blend_add.mjs` | `test_nlaEval` §1 (kernel) + §15 (two strips replace+add stacked integration) | FULL |
| `test_nla_blend_subtract.mjs` | `test_nlaEval` §1 (kernel) + §30 (stacked subtract integration — Slice 4.F closure) | FULL |
| `test_nla_blend_multiply.mjs` | `test_nlaEval` §1 (kernel) + §31 (stacked multiply integration — Slice 4.F closure) | FULL |
| `test_nla_blend_combine.mjs` | DEFERRED — `combine` mode not shipped in Phase 4 per the audit-driven scope change ("combine" silently degrading to "replace" violates Rule №1). `test_nlaEval` §24 asserts `evaluateNla` THROWS on `blendmode: 'combine'`. | DEFERRED (intentional) |
| `test_nla_track_solo.mjs` | `test_nlaEval` §18 (solo track wins) + `test_nlaEditorOps` §29 (applyToggleTrackSolo exclusivity) + §30 (preserves OTHER flag bits) | FULL |
| `test_nla_extend_hold.mjs` | `test_nlaEval` §12 (stripActiveAt extend-mode hold/hold_forward/nothing) + §29 (end-to-end hold_forward past-end clamp+remap) | FULL |
| `test_nla_tweak_mode.mjs` | `test_nlaTweakMode` (16 sections: enter/exit/clear/SYNC_LENGTH/PROTECTED/empty-animData/consumer-chain composition) | FULL |
| `test_nla_bake.mjs` | `test_bakeNla` (33 sections, 110 asserts — input validation / composition / extendmode / cleanCurves / round-trip / applyBakeNla mutator paths) | FULL |

**Aggregate test totals at Phase 4 close (post-4.F):**

| File | Asserts |
|------|---------|
| `scripts/test/test_nlaEval.mjs` | 90 |
| `scripts/test/test_nlaTweakMode.mjs` | 85 |
| `scripts/test/test_nlaEditorOps.mjs` | 209 |
| `scripts/test/test_nlaEditorData.mjs` | 56 |
| `scripts/test/test_bakeNla.mjs` | 110 |
| `scripts/test/test_migrations.mjs` (v42 NLA substrate slice) | 185 |
| **Phase 4 total** | **735** |

**Coverage closure this slice:** §30 stacked subtract integration
(`test_nlaEval`) + §31 stacked multiply integration. Both replicate
the §15 (replace+add) pattern — two-track bottom-replace + top-
{subtract,multiply} stacks asserting both full-influence (1.0) +
partial-influence (0.5) kernel composition outcomes.

#### 4.G — Phase exit gate

- All NLA tests green.
- Three real-world authoring scenarios verified manually:
  - "Idle + breath" stacked → walk → talk-while-walking
  - Two characters with shared "blink" Action on top NLA track
  - Tweak push → edit blink frequency → accept reflects in NLA underlay
- Cubism Viewer load of a baked NLA → motion3.json is identical to a
  hand-authored equivalent.

**Phase 4 sum:** ~1.5 weeks. Schema v36. New: NLA tracks/strips,
NLAEditor, blend modes, tweak mode, BakeNLA operator. Closes: 1
grievance (no NLA stack).

---

### Phase 5 — Graph Editor write-mode (1.5 weeks)

**Goal.** Make [FCurveEditor.jsx](../../src/v3/editors/fcurve/FCurveEditor.jsx)
interactive. Every BezTriple handle becomes draggable; box-select +
grab/scale work on keyframe groups.

**Audit-driven change from v1:** v1 said "Phase 5 keeps SVG; migrate
to canvas-2D if profiling shows it's needed." Audit caught: typical SS
character has 20+ params × 60+ keyframes per Action = 1200+ keyframes,
which is 6× the SVG-with-React-reconciliation degradation threshold
(~200 keyframes). Profiling will always show it's needed. Shipping
SVG-only first means immediately re-doing it. Phase 5 ships canvas-2D
for the keyframe diamonds + handle dots from day 1.

#### 5.A — Editor architecture

Two-layer composition:

- **Background layer (SVG):** static curve `<path>` per FCurve.
  Cheap, scales with FCurve count not keyframe count, plays well with
  CSS theming and the existing FCurveEditor render. SVG path is
  generated by sampling the FCurve at fixed pixel intervals.
- **Foreground layer (canvas-2D):** keyframe diamonds, handle dots,
  selection box, snap indicator. Hit-test via spatial hash on
  keyframe positions (built once per FCurve mutation).

Interaction state machine: idle / picking / dragging-keyframe /
dragging-handle / box-selecting / scaling. Mouse events bound to the
canvas overlay; SVG underneath is `pointer-events: none` so events
only land where the diamonds are.

Snap-to-frame (toggleable, default on); imports
`snapToIncrement(value, increment)` from the toolset plan's
`src/lib/snap.js` (cross-plan coordination).

#### 5.B — Operator set

| Operator | Hotkey | What |
|----------|--------|------|
| `graphEd.select` | LMB | Click keyframe / handle |
| `graphEd.boxSelect` | B | Rubber-band select keyframes |
| `graphEd.grab` | G | Modal drag selected keyframes |
| `graphEd.scale` | S | Modal scale around pivot |
| `graphEd.pivot.cursor` | (menu) | Set scale pivot to playhead |
| `graphEd.pivot.median` | (menu) | Set scale pivot to keyframe median |
| `graphEd.snap.frame` | Ctrl+G | Snap selected keyframes to whole frames |
| `graphEd.handleType.set` | V | Set handle type menu (free / aligned / vector / auto / auto_clamped) |
| `graphEd.interpolation.set` | T | Set interpolation menu (constant / linear / bezier / ...) |
| `graphEd.extrapolation.set` | Shift+E | Set FCurve extrapolation menu |
| `graphEd.fitView` | Home | Fit FCurve range to view |
| `graphEd.delete` | Delete | Delete selected keyframes |

#### 5.C — Multi-curve display

Phase 5 supports displaying multiple FCurves at once (one color each).
The "active" FCurve is the one being edited; others are background
context. UI: a curve-list sidebar.

#### 5.D — Driver display

If the active FCurve has a `driver`, show the driver expression as a
banner above the curve and a "(D)" badge. Editing handles is disabled
when the driver is active (the driver overrides the curve); a button
clears the driver to allow keyframe editing.

#### 5.E — Tests

| Test | What |
|------|------|
| `test_graphEd_dragKeyframe.mjs` | Drag in (time, value) plane → keyform updated |
| `test_graphEd_dragHandle.mjs` | Drag handle → handle vector updated |
| `test_graphEd_handleType.mjs` | Switch handle types updates handles correctly |
| `test_graphEd_boxSelect.mjs` | Box select picks the right keyframes |
| `test_graphEd_grab.mjs` | Modal grab moves selection in time/value |
| `test_graphEd_scale.mjs` | Modal scale around pivot |
| `test_graphEd_undo.mjs` | One drag = one undo entry |

**Phase 5 sum:** ~1 week. No schema change. New: Graph Editor
interactivity. Closes: 1 grievance (no Graph Editor write-mode).

---

### Phase 6 — Dopesheet write-mode (3–4 days)

**Goal.** Make [DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx)
interactive. Multi-track keyframe operations.

**Status:** **PHASE 6 SHIP-COMPLETE 2026-05-19.** Slices 6.A + 6.B +
6.C + 6.D + 6.E + 6.F.1 + 6.F.2 + 6.G all SHIPPED (`cfb82a9` +
`5b4cccd` + `bdf95a8` + `dff1c99` + `98b8a2a` + `f82e670` + `872a208`
+ `a79f431` + `1aaf0b3` + `554be56` + `21416c5` + `1f15410` +
`90e8655` + `b1b7a5b` + 6.G commit). 6.F was SPLIT into 6.F.1 (mute)
+ 6.F.2 (solo) at slice-write time after discovering
`ACHANNEL_SETTING_SOLO` is NLA-tracks-only in Blender per
`ED_anim_api.hh:674` — per-FCurve solo is an SS-only DAW-convention
extension; SHIPPED in 6.F.2 with multi-solo semantic + new
`fcurve.solo` flag bit + eval-cascade extension. **6.G** wired all 8
Phase 6 test scripts (+ Phase 4.E `test:bakeNla` oversight) into
master `npm test`, reviewed all 19 SS DEVIATIONs for Rule №2 honesty
compliance, and authored
`docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`. **752 asserts
under Phase 6 gating.** 4 consecutive clean cite slices (6.D + 6.E
+ 6.F.1 + 6.F.2) establish streak-break as durable. **Phase 6
closes 1 grievance** (Dopesheet read-only).

#### 6.A — Tick selection + state lift — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetSelectOps.js`: 3 pure ops
(`applyTickSelectReplace` / `applyTickSelectExtend` /
`applyTickSelectDeselect`) + `isTickSelected` predicate. Tests:
60 asserts in `scripts/test/test_dopesheetSelectOps.mjs`.

**Architectural lift.** Slice 5.EE shipped the
`keyformSelectionStore` as a one-way mirror (FCurveEditor publishes,
DopesheetEditor reads). Phase 6 making the Dopesheet a writer too
forced lifting the canonical `selectedHandles` state OUT of
FCurveEditor's local `useState` INTO the shared store
(`useKeyformSelectionState()` hook with `[handles, setHandles]`
useState-shaped API). Drop-in for the 22 in-FCurveEditor call sites;
zero behavioral change there. The hook is identity-stable post
audit-fix CRITICAL — the original implementation was leaking a new
closure per render. See close-out doc for full audit detail.

**UI surface.** DopesheetEditor tick clicks now SELECT:
- Plain LMB → replace (clear all, select this tick)
- Shift+LMB → extend (toggle this tick, keep others)
- Ctrl/Cmd+LMB → deselect (remove this tick; SS DEVIATION 1)
- Double-click → seek to tick time (separate `onDoubleClick`
  handler post audit-fix HIGH-A2)

**Status of plan v1 list** (the surface goals stated in v1
prose below — coverage map):

- ✅ Tick selection (click / shift-click) — shipped 6.A.
- ✅ Box-select — shipped 6.B (`bdf95a8` + `dff1c99`).
- ✅ Drag selected ticks in time — shipped 6.C (`98b8a2a` + `f82e670`).
- ✅ Delete + Duplicate selected ticks — shipped 6.D (`872a208` + `a79f431`).
- ✅ Copy/paste — shipped 6.E (`1aaf0b3` + `554be56`).
- ✅ Per-channel mute/solo — shipped 6.F.1 mute (`21416c5` +
  `1f15410`) + 6.F.2 solo (`90e8655` + `b1b7a5b`). 6.F.2 is SS-original
  DAW extension (Blender has no per-FCurve solo per `ED_anim_api.hh:674`).
- 🟡 Channel collapse/expand — deferred to a future polish slice.
- 🟡 Channel filter dropdown — out of scope; defer to a polish slice.

#### 6.G — Phase exit gate ✅ SHIPPED 2026-05-19

**Status:** Phase 6 SHIP-COMPLETE (6.A → 6.G all green, 8/8 slices).

**Gate coverage:**

1. **All Phase 6 dopesheet tests green** — ✅ satisfied.
   - `test:dopesheetSelectOps` (60) + `test:dopesheetBoxSelect` (61)
     + `test:dopesheetGrab` (70) + `test:dopesheetDelDup` (83) +
     `test:dopesheetClipboard` (107) + `test:dopesheetChannelMute`
     (56) + `test:dopesheetChannelSolo` (48) + `test:fcurveSolo` (59)
     = **544 substrate assertions**.
   - Cross-slice extended suites: `test:dopesheetRows` (75),
     `test:fcurveGroups` (89), `test:keyformSelectionStore` (25),
     `test:graphEditOps` (115), `test:fcurveMute` (124) — all green.
   - **752 total assertions under Phase 6 gating.**
2. **Master `npm test` wiring** — ✅ satisfied. All 8 Phase 6 scripts
   added to the master chain (between `test:nlaEditorOps` and
   `test:fmodifiers`). Also picked up `test:bakeNla` (Phase 4.E
   substrate that was missed at 4.F — opportunistic catch).
3. **Cross-slice consistency** — ✅ satisfied. Gate-pattern table
   verified for all 6 keymap-bound slices (6.B → 6.F.2): window-level
   keymap + input-skip + grab/box-drag ref suppression + action
   store-read at fire time + conditional `preventDefault`. Pure-op +
   immer dispatcher split + `would*Change` predicate exported in all
   7 substrate slices. No latent inconsistencies.
4. **SS DEVIATION ledger (19 items)** — ✅ all audit-verified honest
   per Rule №2. Six "NOT-SHIPPED" deviations each have explicit honest
   rationale + either a deferred-slice target (6.B.1 / 6.C.1 / 6.F.2
   — and 6.F.2 was shipped same-session) or a non-applicability proof.
   No no-op shims, no transition diagnostics. See close-out doc table.
5. **Documentation completeness** — ✅ every slice has a close-out doc
   under `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_*.md`;
   2 cross-slice aggregates (`..._C_AND_D`, `..._E_F1_F2`).
6. **Manual checklist authored** —
   `docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md` covers user-side
   end-to-end verification of every shipped slice (~30-40 min sweep).
   Manual sweep is user-side per `feedback_no_background`; failed
   items become post-6.G polish slices, NOT 6.G blockers.

**Phase 6 sum:** 7 substrate slices + 1 exit gate, all shipped
2026-05-19. Schema unchanged at v42. **Cite-discipline arc**:
5-slice fab streak BROKEN at 6.D; **4 consecutive clean slices
(6.D + 6.E + 6.F.1 + 6.F.2)** establish streak-break as durable;
**rule 9 introduced** in `feedback_byte_verify_behavior_cites`
mid-session ("Re-SOURCE, don't re-QUOTE, when sister modules cover
the same Blender semantic" — subsumes rule 6 by sidestepping
inherited-fab failure class). **6.F.2 was the first SS-original
(non-port) slice under rule 9** — passed honest-framing audit
cleanly (0 HIGH-F / 0 MED-F / 0 LOW-F across 12+ provenance cites).
**Closes 1 grievance** (Dopesheet read-only).

#### 6.F.2 — Per-FCurve solo (Ctrl+Alt+M) — SHIPPED 2026-05-19

**SS-original DAW-convention extension** — NOT a Blender port.
Blender's `ACHANNEL_SETTING_SOLO = 5` at `ED_anim_api.hh:674` is
`/** only for NLA Tracks */` (verified character-for-character in
audit sweeps #76 + #77). Per-FCurve solo has no Blender analog; SS
adds a new `fcurve.solo` flag bit + multi-solo semantic (Pro Tools /
Logic / Ableton pattern: any-soloed-plays, rest-silent; solo
overrides mute).

**Substrate.** Two new modules:
- New `src/anim/fcurveSolo.js` (~230 LOC): 5 exports mirroring
  `fcurveMute.js` structural shape (for caller ergonomics, NOT cite
  inheritance per rule 9): `isFCurveSoloed`, `isAnyFCurveSoloed`
  (O(N) walk; no caching today), `toggleFCurveSolo`,
  `applyChannelSoloSelected` (scan-first), `wouldChannelSoloSelectedChange`.
- New `src/anim/dopesheetChannelSolo.js` (~190 LOC): sister to 6.F.1's
  `dopesheetChannelMute.js` — `pickSoloTarget`,
  `applyDopesheetChannelSolo`, `wouldDopesheetChannelSoloChange`.

**Eval cascade extension.** Extended `src/anim/fcurveGroups.js#isFCurveEffectivelyMuted`
with solo cascade as the highest-priority check:
- `anySolo && fc.solo` → NOT effectively muted (solo wins over mute + group)
- `anySolo && !fc.solo` → effectively muted (DAW pattern)
- `!anySolo` → original mute+group cascade (unchanged; regression-safe)

All 4 eval call sites pick up the new semantic automatically
(animationFCurve, depgraph/kernels/fcurve, depgraph/kernels/animation,
animationEngine's computePoseOverrides + computeParamOverrides) —
sister to Slice 5.V's group-mute cascade integration.

**UI surface.** DopesheetEditor.jsx wires Ctrl+Alt+M:
- New keymap effect sister to the 6.F.1 M-key effect — same gate
  pattern (input-skip + grab/box-drag ref suppression + action
  store-read + conditional preventDefault). Reuses `hoveredFcurveIdRef`
  from 6.F.1; no new hover infrastructure.
- Audit-fix HIGH-A: extended `dopesheetRows.js` inline cascade (Slice
  5.W M4 optimization) with solo branch. Pre-fix the inline DIVERGED
  silently from `isFCurveEffectivelyMuted` post-6.F.2 — eval correctly
  silenced non-soloed but UI rendered all rows ungreyed.

**SS DEVIATIONS new this slice:**
- DEV 19 — Hotkey **Ctrl+Alt+M**. SS-conventional, no Blender analog.
  Picked to (a) avoid M-key collision with 6.F.1 mute, (b) stay in
  M-family without stealing S (reserved for snap/scale gestures),
  (c) plan §6.B specifies it. Explicit acknowledgment in docstring
  that Pro Tools / Logic / Ableton use plain S.

No schema bump: `fcurve.solo` is sparse boolean (missing = false; same
pattern as `fcurve.mute` from Slice 5.G). Schema stays at v42.

**Audit sweep #77.** Blender-fidelity audit: 0 HIGH-F / 0 MED-F /
0 LOW-F — 12/12 provenance cites byte-verified; SS-original framing
HONEST across 3 docstring layers; DEV 19 ACCURATE. ARCH audit:
1 HIGH-A + 1 MED-A systemic; both fixed in `b1b7a5b` same-day:
- HIGH-A — `dopesheetRows.js` inline cascade omitted solo branch
  (silent UI divergence from eval). Fix: hoist `anySolo` ONCE per
  row-build, branch inline `isMuted` decision on it.
- MED-A (systemic) — double-find pattern in hovered dispatcher paths
  (both dopesheetChannelSolo + dopesheetChannelMute). Latent reference-
  aliasing risk if helpers refactor to splice-replace. Fix: inline the
  toggle (`fc.solo = !wasSolo;`) in both dispatchers; dropped now-unused
  `toggleFCurveSolo` / `toggleFCurveMute` imports.

Tests: 59 + 48 + 9 (extended dopesheetRows) + 12 (extended fcurveGroups)
= 128 new asserts. All sibling suites green; typecheck clean.

**Cite-discipline arc**: 0 fabs pre-audit, confirmed 0 by Blender-
fidelity agent post-audit. **4 consecutive clean slices (6.D + 6.E +
6.F.1 + 6.F.2) post-rule-6 — discipline change confirmed durable.**
6.F.2 specifically tests the rule-9 / SS-original discipline: the
substrate was honest about NOT being a Blender port; provenance cites
all verified; audit findings were on implementation-completeness
(inline-cascade sync) rather than cite fab.

#### 6.F.1 — Mute hovered/selected channel (M key) — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetChannelMute.js` (~290 LOC):
decision-tree + dispatcher routing the dopesheet M-keypress to either
single-curve toggle (hovered) or bulk toggle (selection fallback).
Three exports:

- `pickMuteTarget(action, hoveredFcurveId)` — pure decision: returns
  `{ kind: 'hovered' | 'selection' | 'none', fcurveId? }`. Hover wins
  over selection (DEV 17).
- `applyDopesheetChannelMute(action, target)` — immer-friendly
  dispatcher. Routes to `fcurveMute.toggleFCurveMute` (hovered) or
  `fcurveMute.applyChannelMuteSelected(action, 'toggle')` (selection,
  scan-first per `anim_channels_edit.cc:2968-2980`).
- `wouldDopesheetChannelMuteChange(action, target)` — predicate.

Reuses already-shipped Slice 5.O bulk-mute kernel
(`applyChannelMuteSelected` in `src/anim/fcurveMute.js`) which
byte-faithfully ports `setflag_anim_channels` at
`anim_channels_edit.cc:2923-3001`. 6.F.1 adds the DOPESHEET surface
(5.O wired the FCurveEditor sidebar Shift+W). Tests: 56 asserts in
`scripts/test/test_dopesheetChannelMute.mjs`.

**UI surface.** DopesheetEditor wires M-key:
- `hoveredFcurveIdRef = useRef(null)` — ref-based hover tracking
  (sub-frame writes; useState would 60Hz re-render).
- Row gets `onPointerEnter` / `onPointerLeave` handlers (callbacks
  passed as stable-identity props).
- M-key effect: same gate pattern as 6.C/6.D/6.E — window-level,
  input-skip, grab/box-drag ref suppression, action store-read at
  fire time, conditional `preventDefault` only when target resolves.
- Audit-fix MED-A1: `hoveredFcurveIdRef.current = null` at three
  commit sites (box-drag commit + grab modal commit + cancel) to
  avoid stale-hover from pointer-capture suppression of
  `onPointerLeave`.

**SS DEVIATIONS new this slice:**
- DEV 16 — Hotkey choice **M** (vs Blender's `Shift+W` at
  `blender_default.py:3876`). DAW convention (Pro Tools / Logic /
  Ableton). Plan §6.B operator table specifies M.
- DEV 17 — Hover-priority target selection (hovered wins over
  selection; selection is fallback). Approximates Blender's
  region-scoped Shift+W UX via explicit hover-tracking since SS uses
  window-level keymap binding.
- DEV 18 — **Solo (Ctrl+Alt+M) DEFERRED to Slice 6.F.2**. Blender's
  `ACHANNEL_SETTING_SOLO = 5` at `ED_anim_api.hh:674` is
  `/** only for NLA Tracks */` (verified character-for-character by
  Blender-fidelity audit). Per-FCurve solo would be a NEW
  DAW-convention feature requiring `FCURVE_SOLO` bit +
  `isFCurveEffectivelyMuted` cascade extension + all 4 eval call
  sites updated (sister to Slice 5.V's group-mute cascade work).
  ~3hr separate slice.

**Audit sweep #76.** 0 HIGH-F (streak HOLDS — 3 consecutive clean
slices) + 0 HIGH-A + 1 MED-A actionable + 1 MED-A observer + 2 LOW-F
cosmetic; all actionable items fixed in `1f15410` same-day:
- MED-A1 — Pointer capture during box-drag and grab modal suppresses
  Row's `onPointerLeave` events; `hoveredFcurveIdRef` stays stale
  post-commit. Fix: clear at three commit sites.
- MED-A2 — Row lacks `React.memo`, so `useCallback([], [])` identity-
  stability has no actual render-savings effect today. Pre-existing,
  NOT introduced by 6.F.1; flagged for future polish pass.
- LOW-F1 — cite range `:3090-3140` overshot
  `ANIM_OT_channels_setting_toggle` body (ends at `:3114`). Tightened.
- LOW-F2 — cite at `:3138` misattributed (line belongs to sister op
  `ANIM_OT_channels_editable_toggle`). Re-targeted to
  `:3100`/`:3113`/`:2907-2911`.

All 3 SS DEVIATIONs (DEV 16-18) confirmed accurate. DEV 18's
load-bearing "only for NLA Tracks" claim verified character-for-
character — deferral rationale is bulletproof.

**Cite-discipline arc**: 0 fabs pre-audit, confirmed 0 by Blender-
fidelity agent post-audit. **Rule 9 held in verification** — 3 lines
also cited by sister `fcurveMute.js` all match Blender source
first-hand; no inheritance fabrication detected. **3 consecutive
clean slices (6.D + 6.E + 6.F.1) establish streak-break as durable
discipline change.**

#### 6.E — Copy (Ctrl+C) + Paste (Ctrl+V) — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetClipboard.js` (~485 LOC):
module-level `_clipboard` singleton (analog of Blender's
`keyframe_copy_buffer = nullptr` at `keyframes_general.cc:1258`) +
`copyKeyformsToClipboard(action, handles, originTime)` (mirrors
`copy_animedit_keys` at `:1488-1566` — resets singleton via
`ANIM_fcurves_copybuf_reset` analog at `:1347-1352`, then deep-copies
center-selected entries with absolute times + first/last/origin
metadata matching `KeyframeCopyBuffer` struct at
`keyframes_general_intern.hh:35-100`) +
`pasteKeyformsFromClipboard(action, destinationTime)` (immer mutator
mirroring `paste_animedit_keys_fcurve` at `keyframes_general.cc:
1925-2006` — CFRA_START offset = `destinationTime - firstTime` per
`:2139`, MIX merge = same-time replace via `INSERTKEY_OVERWRITE_FULL`
analog at `:2001`, recalc handles at `:2005`) +
`handlesFromPasteResult` (converts paste result to all-parts-on
selection map per `BEZT_SEL_ALL` at `:1998`) + `wouldCopyChange` /
`wouldPasteChange` predicates + `getClipboard` / `resetClipboard`
singleton accessors. Tests: 107 asserts in
`scripts/test/test_dopesheetClipboard.mjs` (32 sections covering
input-validation throws + copy semantics + clipboard reset + paste
offset/replace/sort/handle-shift + round-trips + paste-result helper
+ post-audit-fix frozen-wrapper enforcement).

**UI surface.** DopesheetEditor wires Ctrl+C / Ctrl+V:
- Ctrl+C → if any center-selected, `copyKeyformsToClipboard` (browser
  text-copy untouched if nothing selected OR if user has a
  non-collapsed text Range — audit-fix MED-A3).
- Ctrl+V → if clipboard non-empty AND at least one destination fcurve
  matches by id, `pasteKeyformsFromClipboard` via `updateProject` +
  `handlesFromPasteResult` → selection store. New keyforms become the
  selection (all parts on).
- Both gated on input/textarea/contenteditable skip + grab/box-drag
  ref suppression (mounts once, reads store at fire time — same
  pattern as 6.D HIGH-A1 fix).
- Action resolved via `useProjectStore.getState().project` at keypress
  time (avoids action-memo dep churn).

**SS DEVIATIONS new this slice:**
- DEV 11 — Plan-naming clarification: §6.B's `dopesheet.copyColumn` /
  `dopesheet.pasteColumn` was conceptual shorthand. Blender's
  `ACTION_OT_copy` operates on SELECTION, not on a vertical column at
  playhead. Helpers named for Blender semantics.
- DEV 12 — fcurve matching by exact id (SS unique-per-action ids) vs
  Blender's `rna_path + array_index` (+ optional slot handle). SS ids
  are stable strings; cross-action paste matches by id.
- DEV 13 — Single paste mode: CFRA_START offset + MIX merge only.
  Blender exposes 4 offset modes + 4 merge modes via the F6 redo
  panel; SS has no redo panel, ships defaults from `ACTION_OT_paste`
  at `action_edit.cc:770/775`. Other modes deferred without no-op
  stubs (Rule №2 honest).
- DEV 14 — `Shift+Ctrl+V flipped` variant NOT shipped. SS dopesheet's
  keyform model has no `pose.bones["..."]` RNA paths; flip-mirror
  semantic doesn't apply.
- DEV 15 — Selection-after-paste is GLOBAL replace (vs Blender's
  per-destination-fcurve deselect-then-select at `:1935-1937` +
  `:1998`). Under realistic UX where paste targets fcurves that
  weren't already selected outside the clipboard scope, observable
  state matches. Honest simplification.

**Audit sweep #75.** 0 HIGH-F (streak-break HOLDS — 6.D was the
inflection, 6.E confirms) + 0 HIGH-A + 1 MED-A + 1 LOW + 3 LOW-F
cosmetic; all fixed in `554be56` same-day:
- MED-A3 — Ctrl+C with non-input text Range selected suppressed OS
  text copy; now bails out when `window.getSelection()?.type ===
  'Range'`. Blender has no analog (desktop app, no OS-clipboard
  contention).
- LOW-1 — `getClipboard()` returned mutable ref; docstring said "MUST
  NOT mutate" but no enforcement. Now returns a shallow-frozen wrapper
  (outer + per-fcurve + entries array all `Object.freeze`'d). Module-
  internal reads bypass; paste path unaffected.
- LOW-F1 — `:1989` cite was `if (flip) {` line; the actual
  `do_curve_mirror_flippping` call is `:1990`. Now `:1989-1991`.
- LOW-F2 — `:1493` cite was the call site inside `copy_animedit_keys`
  (defn at `:1347-1352` cited elsewhere); now disambiguated as
  "(call) / (defn)".
- LOW-F3 — `BEZT_OK_SELECTED_KEY` paraphrase dropped the
  `ANIM_editkeyframes_ok` wrap; restored.

All 5 SS DEVIATIONs (DEV 11-15) confirmed accurate by Blender-fidelity
audit. **Meta-finding promoted to memory rule 9** (`feedback_byte_verify_behavior_cites`):
"Re-SOURCE, don't re-QUOTE, when sister modules cover the same Blender
semantic." 6.E did not re-quote ANY specific Blender path/line from
in-tree sister modules — every cite drawn directly from the reference
clone. Stronger preventive than rule 6 (defensive re-verification):
sidesteps the inherited-fab failure class entirely by never depending
on sister docstrings.

**Cite-discipline arc**: 0 fabs pre-audit, confirmed 0 by Blender-
fidelity agent post-audit. **2 consecutive clean slices (6.D + 6.E)
establish streak-break as discipline change.**

#### 6.D — Delete (Del) + Duplicate-move (Shift+D) — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetDelDup.js`: immer-friendly
`applyDeleteKeyforms(action, handles)` (delegates per-fcurve to
`graphEditOps.deleteKeyforms` which mirrors Blender's
`BKE_fcurve_delete_keys_selected` at `fcurve.cc:1757-1784`) + pure
`applyDuplicateKeyforms(action, handles)` (mirrors Blender's
`duplicate_fcurve_keys` at `keyframes_general.cc:62-95` — inserts
deep-copy immediately after each selected, remap re-targets selection
at duplicates) + `wouldDelDupChange` predicate. Tests: 83 asserts in
`scripts/test/test_dopesheetDelDup.mjs`.

**UI surface.** DopesheetEditor wires Delete + Shift+D:
- Del → `applyDeleteKeyforms` via `updateProject` →
  `remapHandlesAfterTranslate` drops deleted entries from selection
  store.
- Shift+D → `applyDuplicateKeyforms` → `remapHandlesAfterTranslate`
  re-targets selection at duplicates → `enterGrabModal()` auto-enters
  the 6.C grab modal pre-targeted at the duplicates (Blender's
  `ACTION_OT_duplicate_move` macro chain at `action_ops.cc:80-89`).
- Both gated on `wouldDelDupChange` pre-check (matches Blender's
  `actkeys_*_exec` `OPERATOR_CANCELLED` on empty selection).
- `enterGrabModal` extracted from G-key effect as a useCallback
  helper so Shift+D can re-use it.

**SS DEVIATIONS new this slice:**
- DEV 7 — Empty-fcurve auto-removal NOT shipped. Blender's
  `BKE_fcurve_is_empty → ED_anim_ale_fcurve_delete` at
  `action_edit.cc:1154-1157` unhooks empty fcurves; SS keeps them
  (channel sidebar shows them as empty so user can re-insert without
  losing channel registration).
- DEV 8 — Delete confirm dialog suppressed. Blender's
  `actkeys_delete_invoke` (`action_edit.cc:1194-1208`) gates dialog
  on RNA `confirm=True`; the dopesheet keymap binding passes
  `confirm=False` (`blender_default.py:2703`), so SS mirrors the
  suppressed-confirm dopesheet behavior.
- DEV 9 — Backspace aliased to Delete. Blender binds only `DEL`; SS
  also accepts Backspace because Mac laptops have no physical
  Delete key (the labelled "delete" key IS Backspace). Honest
  extension. Audit-fix MED-A2 documentation.
- DEV 10 — Duplicate inherits original's HandleParts profile
  verbatim instead of Blender's `BEZT_SEL_ALL(copy)` force-all-on at
  `keyframes_general.cc:91`. Under realistic SS UX (tick-click +
  box-select set all 3 bits in lockstep), divergence is invisible;
  partial-bit selections diverge. Audit-fix MED-F1 honest deviation.

**Audit sweep #74.** 0 HIGH-F (5-SLICE FAB STREAK BROKEN!) + 2 HIGH-A
+ 2 MED-A + 1 MED-F + LOW polish; all fixed in `a79f431` same-day:
- HIGH-A1 — G-key + Del/Shift+D effects had `[grabState, boxDrag]`
  deps that re-mounted listeners 60-120Hz; switched to refs
  (`grabActiveRef` + new `boxDragActiveRef`), keymap effects stay
  mounted once.
- HIGH-A2 — `getState().handles` re-read 2-3 times in same handler
  produced inconsistent snapshots; now snapshot ONCE into
  `curHandles` and reuse for op input + remap input. Same fix
  applied to 6.C grab commit path.
- MED-A1 — `applyDeleteKeyforms` had silent-swallow `continue` on
  "impossible" length-unchanged path; converted to pre-filter at
  contract boundary + Rule №1 throw on actual violation. Pre-filter
  catches real pre-existing bug: `deleteKeyforms` builds non-empty
  survivor-remap even when ALL selection entries are OOB (because it
  walks the array, not the selection).
- MED-A2 — Backspace alias undocumented → SS DEV 9.
- MED-F1 — Duplicate selection-bit divergence undocumented → SS DEV 10.

**Cite-discipline arc**: 0 fabs pre-audit, confirmed 0 by Blender-
fidelity agent post-audit. **5-slice fab streak (4.D.4 / 4.E / 6.A
/ 6.B / 6.C) BROKEN.** The new `feedback_byte_verify_behavior_cites`
rule 6 (re-verify SOURCE cites when re-quoting from sister modules,
declared after 6.C) worked: pre-draft I re-checked
`graphEditOps.deleteKeyforms` against Blender's
`BKE_fcurve_delete_keys_selected` instead of trusting the in-tree
docstring.

#### 6.C — Modal grab (G key time-translate) — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetGrab.js`: immer-friendly
`applyTimeTranslate(action, handles, deltaMs)` mutator + pure
`remapHandlesAfterTranslate(handles, remaps)` + cheap
`wouldTimeTranslateChange(handles, deltaMs)` predicate. Mirrors
Blender's `transform.transform mode='TIME_TRANSLATE'` dispatched
through `TransConvertType_Action` (`transform_convert_action.cc:
1404-1409`); handle shift via `transform_convert_flush_handle2D`
(same X-delta on `handleLeft.time` + `handleRight.time` + center,
preserves bezier shape — `transform_convert.cc:1267-1285`); post-
commit `posttrans_action_clean → BKE_fcurve_merge_duplicate_keys`
which AVERAGES selected values into the lowest-index survivor
(`fcurve.cc:1801-1916`). Tests: 70 asserts in
`scripts/test/test_dopesheetGrab.mjs` (27 sections covering pure-op
semantics + identity-stability + merge-on-collision + remap
composition + multi-fcurve + integer-ms quantization).

**UI surface.** DopesheetEditor wires G-key modal:
- G keypress → grab modal entry (gated on center-selected
  count > 0, mirroring Blender's `count_fcurve_keys` pre-modal check
  at `transform_convert_action.cc:271-303`).
- Window mousemove during modal → deltaMs preview (msPerPx captured
  at grab entry).
- LMB or Enter → commit via `updateProject(applyTimeTranslate)`
  + `remapHandlesAfterTranslate` on the selection store.
- RMB or Escape → cancel (no mutation — preview is overlay-only).
- Tick clicks + box-select pointerdowns suppressed during grab via
  `grabActiveRef`.
- Ghost translucent diamonds render at `kf.time + deltaMs` for every
  selected center-keyform; status pill shows `Grab: +Nms · LMB/Enter
  commit · RMB/Esc cancel`.

**SS DEVIATIONS new this slice:**
- DEV 4 — Time-translate is INTEGER-MS (Math.round on deltaMs).
  Blender accumulates fractional frames. Matches SS canonical time
  per `feedback_ms_canonical_animation_time`.
- DEV 5 — Snap-to-frame NOT shipped; deferred to 6.C.1 polish slice.
  Honest per Rule №2.
- DEV 6 — Merge-duplicate epsilon `0.5 ms` vs Blender's `0.01f`
  frames (`BKE_fcurve.hh:217`). At 60fps ~3× coarser; matches typical
  pointer-drag overshoot. Audit-fix HIGH-F3 demoted the prior
  graphEditOps.js fab cite (`0.00002 s`) to this honest deviation.

**Audit sweep #73.** 3 HIGH-F cite fabs (5-slice fab streak —
4.D.4 / 4.E / 6.A / 6.B / 6.C) + 2 HIGH-A bugs + 1 MED-A + LOW
polish + 1 new SS DEV; all fixed in `f82e670` same-day:
- HIGH-F1 — G keymap cite `:2716-2717 transform.translate` was fab;
  real is `:2718-2719 transform.transform mode='TIME_TRANSLATE'`.
- HIGH-F2 — Merge semantics misdescribed as "selected wins +
  OVERWRITES" — actually AVERAGES (fcurve.cc:1859-1862 / 1887).
- HIGH-F3 — Inherited `BEZT_BINARYSEARCH_THRESH = 0.00002 s` cite
  from graphEditOps.js was PRE-EXISTING fab; real is `0.01f` frames
  per BKE_fcurve.hh:217. Fixed at SOURCE + consumer.
- HIGH-A1 — Listeners-mount effect dep included `activeActionId`;
  mid-grab actionId change would have sent in-flight delta to
  unrelated action. Narrowed to `[grabState !== null]`.
- HIGH-A2 — `setGrabState(null)` is React-async-batched; the
  useEffect mirror flipping `grabActiveRef.current = false` ran on
  NEXT render. Synchronous handlers in the commit tail saw stale
  ref=true. Now eagerly flips at commit/cancel entry.
- MED-A1 — `handleTrackPointerUp` dep included `[boxDrag, rows,
  duration]`; identity-stable via rowsRef/durationRef refs +
  functional setBoxDrag (matches 6.B HIGH-A1 pattern).

Cite-discipline: BROKE at 3 (5-slice streak). Mitigation insight:
the `[VERIFY]` workflow is insufficient when SOURCE cites in sister
modules are already fab. Need to RE-VERIFY against Blender even
when re-quoting from existing in-tree docstrings. Recorded as
sister to `feedback_check_plan_against_impl_on_consumption`.

#### 6.B — Box-select (B key + LMB-drag) — SHIPPED 2026-05-19

**Substrate.** New `src/anim/dopesheetBoxSelect.js`: pure
`applyBoxSelect` (3 modes — replace/extend/subtract) +
`computeBoxHits` time-axis walker + `BOX_SELECT_MODES` frozen list.
Tests: 61 asserts in `scripts/test/test_dopesheetBoxSelect.mjs`.

**UI surface.** DopesheetEditor track-area drag-rect with 4px
threshold; marquee overlay (blue for replace/extend, red for
subtract); B-key window listener arms the next pointerdown to
override the drag-on-tick guard. Modifier mapping: plain LMB-drag →
replace; Shift+LMB-drag → extend; Ctrl+LMB-drag → subtract.

**SS DEVIATIONS new this slice:**
- DEV 2 — INCLUSIVE time-range bounds vs Blender's STRICT
  inequality (`ok_bezier_framerange` at
  `keyframes_edit.cc:559-567`). Modern UI convention.
- DEV 3 — Axis-range mode (Alt+B → FRAMERANGE/CHANNELS) NOT
  shipped in 6.B; scope-deferred to 6.B.1 polish slice.

**v1 prose preserved below** for reference; flip checkmarks as
each remaining slice ships.

Track rows are columns of frame-ticks. Phase 6 adds:

- Tick selection (click / shift-click / box-select)
- Drag selected ticks in time
- Per-channel mute / solo toggles
- Channel collapse / expand (group by Object → group by FCurve group → individual FCurves)
- Channel filter dropdown (All / Selected / Driven / Errors)

#### 6.B — Operator set

| Operator | Hotkey | What |
|----------|--------|------|
| `dopesheet.select` | LMB | Click tick |
| `dopesheet.boxSelect` | B | Rubber-band |
| `dopesheet.grab` | G | Modal drag selection in time |
| `dopesheet.delete` | Delete | Delete selected |
| `dopesheet.copyColumn` | Ctrl+C | Copy column at playhead |
| `dopesheet.pasteColumn` | Ctrl+V | Paste at playhead |
| `dopesheet.duplicate` | Shift+D | Duplicate selection (modal grab) |
| `dopesheet.muteChannel` | M | Toggle mute on hovered channel |
| `dopesheet.soloChannel` | Ctrl+Alt+M | Solo channel |

#### 6.C — Tests

| Test | What |
|------|------|
| `test_dopesheet_select.mjs` | Single + shift + box select |
| `test_dopesheet_grab.mjs` | Drag selected ticks |
| `test_dopesheet_copyPasteColumn.mjs` | Column op semantics |
| `test_dopesheet_channelMute.mjs` | Mute affects eval |

**Phase 6 sum:** ~3–4 days. No schema change. New: Dopesheet
write-mode. Closes: 1 grievance (Dopesheet read-only).

---

### Phase 7 — Insert Keyframe + Keying Sets ✅ SHIP-COMPLETE 2026-05-20 (~2 days, no schema bump)

**Goal.** Blender's `I`-key parity: a menu of keying sets, "Only
Insert Needed" mode, granular per-channel keying.

**Status:** **PHASE 7 SHIP-COMPLETE 2026-05-20.** All 6 slices
green: 7.A registry + 7.B Insert Keyframe kernel + 7.C I-key menu +
7.D auto-key mode parity + 7.E K-key first-use toast + 7.F test
sweep + exit gate. Plan §7.F's 5 prescribed test files are
subsumed by 5 existing suites (370 asserts total — audit at
`docs/plans/ANIMATION_PHASE_7_COVERAGE_AUDIT.md`). Phase aggregate
at `docs/plans/ANIMATION_PHASE_7_AGGREGATE.md`; user-facing
verification at `docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md`.

**Commit chain.** 19 commits: `2ebefe4` + `768d25c` + `3d0b049` +
`5bd0982` + `de91759` + `577ebdd` + `4494c88` + `4643dc3` + `57f2bb2`
+ `0112b9e` + `26e53ce` + `3022543` + `7cd7e74` + `49a4239` + `fa6b462`
+ `e9ccfba` + `4991662` + `71b835b` (7.F substrate) + this 7.F
audit-fix.

**Cite-discipline:** 4-slice clean streak (Phase 6) **BROKEN +
REGRESSION** through 7.A (2 HIGH-F) + 7.B (1 HIGH-F), then **STREAK
RESTARTED at 7.C** (0 / 0 / 0 across 9 cites), **EXTENDED to 7.D**
(0 / 0 / 0 across 9 more cites), **EXTENDED to 7.E** (0 / 0 / 0
across 3 carry-over cites), then **BROKEN AT 7.F SUBSTRATE** via an
inherited carry-over fab (the `anim_sys.cc:1473-1490` cite from
7.A's audit-fix memory was propagated into 3 new doc sites in 7.F's
substrate without rule-9 re-OPEN — sweep #83-F caught it
retroactively). 7.F audit-fix re-located the correct cite at
`animrig/intern/fcurve.cc:149-164` (`replace_bezt_keyframe_ypos`
with literal comment "*Just change the values when replacing, so as
to not overwrite handles.*"). Final Phase 7 streak: **3 consecutive
clean ships** (7.C + 7.D + 7.E). Memory rules 9 (re-OPEN every cite),
10 (literal-source-value), and 11 ("comment says X" promotes to
byte-quotation) — generalised in 7.F audit-fix to explicitly cover
doc-level cite carry-over, not just substrate authoring.

#### 7.F — Test sweep + Phase 7 exit gate ✅ SHIPPED 2026-05-20

**Substrate.** 0 new code files; 3 new docs + this banner update:

- `docs/plans/ANIMATION_PHASE_7_COVERAGE_AUDIT.md` — per-row
  subsumption proof that plan §7.F's 5 prescribed test filenames
  (`test_keyingSet_builtin.mjs`, `test_keyingSet_userDefined.mjs`,
  `test_insertKeyframe_replace.mjs`,
  `test_insertKeyframe_onlyNeeded.mjs`,
  `test_autoKey_keyingSet.mjs`) are subsumed by 5 existing suites
  at strictly higher coverage breadth. 370 asserts total
  (144 + 87 + 69 + 48 + 22). Re-verified `npm run test:keyingSets`
  + `test:insertKeyframe` + `test:keyingSetMenu` +
  `test:autoKeyDispatch` + `test:kKeyFirstUseToast` all green
  pre-commit on `master @ 4991662`.
- `docs/plans/ANIMATION_PHASE_7_MANUAL_CHECKLIST.md` — user-facing
  20–30 minute end-to-end verification covering §1 keying-set
  registry surfaces (via I-menu), §2 Insert Keyframe kernel happy
  paths, §3 I-key menu UI semantics, §4 auto-key mode dropdown +
  all 3 trigger-site behaviors, §5 K-key first-use toast +
  `__ssAutoKey` skip, §6 cross-slice gate semantics. Models after
  `ANIMATION_PHASE_6_MANUAL_CHECKLIST.md` structure.
- `docs/plans/ANIMATION_PHASE_7_AGGREGATE.md` — phase rollup
  covering all 6 slices with API surface, sparse-field schema,
  keybindings, per-slice substrate summary, 12 new DEVIATIONs
  (20–31), cite-discipline narrative, 5 audit sweeps (#78–#82),
  4 architectural patterns established, full commit chain, queued
  polish slices.

**Coverage audit decision.** Zero new test files needed. The 5
plan-prescribed names are subsumed; the substrate work for 7.F is
documentation + the exit gate. Per Rule №2, the prescribed names
are documented as "subsumed under existing names" in the audit so
a future maintainer searching for the prescribed name lands on the
pointer to the actual suite.

**No new DEVs.** No new audit sweep (7.F is meta-work; no behavior
surface to audit).

**Known gaps documented (deferred to §7.G+ polish slices):**
- K-rebind preference (plan §7.E option (b) — needs legacy K-key
  fan-out extraction).
- Param-row auto-key bypass (`ParamRow.jsx` ignores
  `project.autoKeyMode`).
- Active-set UI (no menu item for picking active keying set yet).

#### 7.E — K-key first-use toast ✅ SHIPPED 2026-05-20

**Scope decision: MVP only.** Plan §7.E describes two deliverables:
(a) a first-use toast on K-press pointing at the new I-key menu, and
(b) an OPTIONAL rebind preference letting users swap K for "open the
I-menu". 7.E ships (a) only; (b) is deferred to §7.F+ because
implementing it requires extracting the 170-line legacy K-key fan-out
(KEYFRAME_PROPS + mesh_verts + blend-shape values + auto-rest-keyform
+ JS-skinning expansion) into a pure helper. Plan-faithful per the
"A preference CAN re-bind K" wording.

**Substrate.** 3 modified files + 1 new test suite:

- `src/store/preferencesStore.js` — added sparse boolean pref
  `kKeyFirstUseShown` (default `false`; persists to localStorage at
  `v3.prefs.kKeyFirstUseShown`) + `setKKeyFirstUseShown` setter
  matching the sibling `setMlEnabled` / `setLockObjectModes` /
  `setUseNumericInputAdvanced` pattern.
- `src/components/canvas/CanvasViewport.jsx:1505-1535` — emits a
  toast on the FIRST K-press in animation mode AFTER every guard
  passes (preview / editable / animation-mode / actions-exist /
  selection-non-empty) and BEFORE the `updateProject` recipe. The
  toast title is "K — Insert all properties" and the description
  points to the I-key menu with real built-in labels (Location /
  Rotation / All Parameters — audit-fix MED-1 replaced an invalid
  "Active Set" placeholder).
- `src/anim/autoKeyDispatch.js:113-130` — `runAutoKey('all')`'s
  synthetic K event now carries an `__ssAutoKey: true` expando
  sentinel (plain assignment per audit-fix MED-2 for Safari ≤14
  compat). The CanvasViewport handler skips the toast when
  `e.__ssAutoKey` is set so users with auto-key on don't see a
  pointer toast after dragging a bone (they never pressed K
  manually).
- `scripts/test/test_kKeyFirstUseToast.mjs` — 22 asserts in 3
  sections: §1 preferencesStore roundtrip + persistence + namespace
  (8); §2 runAutoKey sentinel tag on auto-key dispatch (6); §3
  sentinel expando + descriptor pin (8).

**SS DEVIATION** — none new this slice. Carries DEV 30 (I/K-key
inversion from Blender per plan §7.C/§7.E).

**Blender cites (re-OPENED per rule 9 + content-verified per rules
10+11):** 3 carry-overs from 7.C/7.D, all re-verified clean:

- `keymap_data/blender_default.py:4536` — K-key Object Mode →
  `anim.keyframe_insert_menu` with `always_prompt=True`.
- `keymap_data/blender_default.py:4683` — same in Pose Mode.
- `keymap_data/blender_default.py:4561` — I-key Object Mode →
  `anim.keyframe_insert` (default non-pie).

**Audit sweep #82** (Phase 7 sweep #5):

- **Architecture: 0 HIGH / 2 MED / 2 LOW.** All fixed in `fa6b462`:
  MED-1 (real built-in label in toast); MED-2 (plain expando vs
  defineProperty for Safari compat); LOW-1 (descriptor pin updated
  for new semantics); LOW-2 (§1.5 exact-key assertion).
- **Blender-fidelity: 0 HIGH-F / 0 MED-F / 0 LOW-F across 3
  carry-over cites.** Streak EXTENDED 2 → 3.

Post-audit: **22 test asserts** (was 20 pre-fix; +2 descriptor pin).
Typecheck clean. Sibling regressions green: `test:autoKeyDispatch`
(48 — `__ssAutoKey` addition does not break event-presence checks),
`test:preferencesStore` (62). Close-out doc at
`docs/plans/SESSION_CLOSEOUT_2026_05_20_ANIMATION_PHASE_7_SLICE_E.md`.

#### 7.D — Auto-key mode parity ✅ SHIPPED 2026-05-19

**Substrate.** 1 new helper + 4 modified UI/trigger sites:

- `src/anim/autoKeyDispatch.js` (~130 LOC) — `runAutoKey(project)` +
  `getAutoKeyMode` + `pickActiveSetIdForAutoKey` + `AUTOKEY_MODES`
  frozen tuple. Maps SS's 3-mode enum to Blender's flag-bit dispatch
  at `keyframing_auto.cc:126-133` (ONLYKEYINGSET branch) /
  `:139-150` (All path).
- `src/v3/shell/PlaybackControls.jsx` — new `AutoKeyModeDropdown`
  sub-component (~70 LOC) with Radix DropdownMenu + RadioGroup;
  chevron trigger flush-right of the existing AutoKey toggle.
  Sparse-write semantics: picking `'all'` deletes the field rather
  than persisting the default string (Rule №2). Mode-change writes
  use `{skipHistory: true}` (audit-fix M-3 — Blender stores autokey
  mode in user prefs, never on undo stack).
- 3 trigger-site refactors:
  - `src/components/canvas/SkeletonOverlay.jsx:513-516`
  - `src/components/canvas/GizmoOverlay.jsx:366-369`
  - `src/components/canvas/CanvasViewport.jsx:3326-3334`
    (audit-fix H-2 — missed in initial substrate ship; canvas-direct
    drags were silently bypassing the mode dropdown)
- `src/components/canvas/CanvasViewport.jsx:1463` — audit-fix H-1:
  `e.target?.tagName` optional chaining (synthetic-K events set
  `target` to `window` which has no `tagName`; sister handler at
  `:1393` was already `?.`).

**Schema.** New SPARSE field `project.autoKeyMode?: 'all' | 'activeSet'
| 'available'`. No migration; no v42→v43 bump. Read sites coalesce
`?? 'all'`. Projects saved pre-7.D behave as `'all'` on load.

**Blender cites (re-OPENED per rule 9 + content-verified per rules
10+11):**

- `keyframing_auto.cc:102-155` — `autokeyframe_object` (unified
  entry; SS's `runAutoKey` analog).
- `keyframing_auto.cc:126-133` — `if (is_keying_flag(scene,
  AUTOKEY_FLAG_ONLYKEYINGSET) && (active_ks))` branch dispatching to
  `apply_keyingset(... active_ks ...)`. SS's `'activeSet'` mode
  matches this dispatch shape.
- `keyframing_auto.cc:139-150` — non-KS "All" path
  (`insert_keyframes` with full `rna_paths` span). SS's `'all'` mode
  routes through legacy K-key handler which has analogous full
  property fan-out.
- `keyframing_auto.cc:193-258` — `autokeyframe_pose_channel` (sister
  dispatcher for bones; identical branch structure at `:235`).
- `DNA_userdef_types.h:278-293` — `eKeying_Flag` enum.
  `AUTOKEY_FLAG_INSERTAVAILABLE = (1 << 0)` at `:285`;
  `AUTOKEY_FLAG_ONLYKEYINGSET = (1 << 6)` at `:287`.

**SS DEVIATIONs new this slice (31):**

- DEV 31 — `'available'` mode dispatches to the `'Available'` built-in
  set (whose collector at `keyingSets.js:226-250` already filters to
  existing fcurves) rather than setting `INSERTKEY_FLAGS.AVAILABLE`
  on an unfiltered emit. Semantically equivalent (both produce
  "key only existing fcurves"); structurally cleaner because the
  set-based path reuses 7.B's `applyKeyingSet` kernel without a
  flag-branch in the collector.

**Synthetic K-key dispatch caveat (Rule №1 honest disclosure):** the
`'all'` mode preserves the pre-existing synthetic
`KeyboardEvent('keydown',{key:'K'})` dispatch that routes through the
legacy K-key handler at `CanvasViewport.jsx:1457-1633`. Extracting
that handler's property fan-out (KEYFRAME_PROPS + mesh_verts + blend-
shape values + auto-rest-keyform + JS-skinning expansion) into a pure
helper is §7.E+ scope. 7.D documents the crutch in
`autoKeyDispatch.js`'s module header rather than silently preserving
it.

**Param-row gap (audit-fix M-2 documented):** `ParamRow.jsx` auto-key
path bypasses `runAutoKey` and ignores `project.autoKeyMode`. Param
slider drags in `'available'` mode will still create new fcurves;
slider drags in `'activeSet'` mode key only the touched param (NOT
the full active set). Unifying the param path with mode dispatch is
§7.E+ scope; inline `PHASE-7-GAP` comment at the write site flags
this for future maintainers.

**Audit sweep #81** (Phase 7 sweep #4):

- **Architecture: 2 HIGH + 3 MED + 1 LOW.** All fixed in `3022543`:
  H-1 optional chaining; H-2 third trigger-site migration; M-1
  `AUTOKEY_MODES.includes` membership check; M-2 ParamRow gap doc;
  M-3 `skipHistory` on mode setter; L-1 test §5.1 scope comment.
  L-2 closed automatically by M-1.
- **Blender-fidelity: 0 HIGH-F / 0 MED-F / 0 LOW-F across 9 cites.**
  Streak extended 1 → 2 (7.C + 7.D both clean).

Post-audit: **48 test asserts** (unchanged across fix — fixes were
semantic hardening, not new behavior surface). Sibling tests clean:
`test:keyingSetMenu` (69), `test:insertKeyframe` (87), `test:keyingSets`
(144), `test:v3Operators` (125). Typecheck clean. Close-out doc at
`docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_D.md`.

#### 7.C — `I`-key menu UI ✅ SHIPPED 2026-05-19

**Substrate.** 4 new files (~455 LOC) + 5 modified:

- `src/anim/keyingSetDefault.js` (~85 LOC) — `pickDefaultKeyingSet`
  pure helper. Picks the highlighted built-in per plan §7.C:
  BlendShape-mode (with matching shape owner) → `BlendShape`;
  last-selected bone-role group → `Rotation`; last-selected meshed
  part → `LocRotScale`; otherwise → `null`. LAST→FIRST selection
  walk matches SS's "active = most-recently-added" semantic.
- `src/anim/insertKeyframeResolver.js` (~70 LOC) —
  `buildLiveResolver(project, paramValues)` closes the **MED-3 trap**
  from 7.B's audit. Default `evaluateRnaPath` returns
  `project.parameters[*].default` (STATIC) for `__params__` paths;
  this wrapper routes `__params__` paths through the live
  `paramValuesStore.values` snapshot first, falling through to the
  default for non-__params__ paths AND for missing/NaN/Infinity live
  values. Regex `^objects\["__params__"\]\.values\["([^"]+)"\]$`
  matches the emitter at `keyingSets.js:204` byte-for-byte.
- `src/v3/operators/insertKey.js` (~210 LOC) — registers
  `insertKey.menu` (bound to `KeyI`; opens KeyingSetMenu popover)
  and `insertKey.applySet` (forward hook for 7.D auto-key +
  command-palette; menu dispatches via `execApplyKeyingSet(setId)`
  directly). Exported `execApplyKeyingSet` runs the full guarded
  pipeline: setId/project/time validation → `getKeyingSet` pre-
  validation → `updateProject(draft => applyKeyingSet(draft, ...,
  {resolveValue: buildLiveResolver(draft, paramValues)}))` → toast
  with summarised per-channel result counts.
- `src/v3/shell/KeyingSetMenu.jsx` (~140 LOC) — Radix-free popover
  mirroring `ApplyMenu` / `SnapMenu` pattern (Esc + outside-click
  close, fixed-position div, lazy-imported in AppShell). Lists every
  set via `listKeyingSets(project)` (memoised on `[project]` per
  `feedback_filter_in_selector`); `•` indicator for active set,
  bold font for default-picked set.
- `src/store/editMenuStore.js` — `'keyingSet'` added to discriminated
  `kind` union + `openKeyingSet({cursor})` method.
- `src/v3/operators/registry.js` — `registerInsertKeyOperators`
  invoked at end of `registerBuiltins` (eager-import per sister-slice
  G-1 lesson — operator dispatcher fires `op.exec(...)` non-await).
- `src/v3/keymap/default.js` — `KeyI` → `insertKey.menu`.
- `src/v3/shell/AppShell.jsx` — `KeyingSetMenu` lazy-mounted behind
  `editMenuKind === 'keyingSet'`.

**Blender cites (re-OPENED per rule 9 + content-verified per rules
10+11 BEFORE substrate ship; ALL 9 audit-verified clean):**

- `editors/animation/keyframing.cc:509-567` — `insert_key_menu_invoke`
  (the static menu-invoker function). **Corrected** session-aggregate's
  pre-existing wrong cite at `:569-580` which pointed at the OT
  registration `ANIM_OT_keyframe_insert_menu` (registration wires
  `invoke = insert_key_menu_invoke` at `:580`).
- `editors/animation/keyframing.cc:545-558` — menu-loop that
  dispatches per-set items via `layout.op("ANIM_OT_keyframe_insert_by_name", ...)`
  at `:548`.
- `editors/animation/keyframing.cc:479-502` — `ANIM_OT_keyframe_insert_by_name`
  (the by-name operator; non-sticky — exec chain through
  `keyframe_insert_with_keyingset_exec` at `:463-477` never writes
  `scene->active_keyingset`). SS's `execApplyKeyingSet` matches this
  non-sticky semantic.
- `editors/animation/keyframing.cc:438-461` — `ANIM_OT_keyframe_insert`
  (Blender's I-key operator; description: "Insert keyframes on the
  current frame using either the active keying set, or the user
  preferences if no keying set is active").
- `editors/animation/keyframing.cc:472` —
  `keyingset_get_from_op_with_error` call site (mirrored by SS's
  pre-validation `getKeyingSet` in `execApplyKeyingSet`).
- `keymap_data/blender_default.py:4561` — I-key Object Mode →
  `anim.keyframe_insert` (default non-pie path).
- `keymap_data/blender_default.py:4536` — K-key Object Mode →
  `anim.keyframe_insert_menu` with `always_prompt=True`.
- `keymap_data/blender_default.py:4702`, `:4683` — sister bindings in
  Pose Mode.
- `_keyingsets_utils.py:42-67` — "closest analog" (paraphrased) for
  default-set picker; Blender's actual default is the user's
  `scene.active_keyingset` preference (verified at `keyframing.cc:520`).

**Plan vs Blender semantic divergence (DEV 30):** Blender binds I to
"use active KS / user-pref fallback" (`:4561`) and K to "always
menu" (`:4536`). SS plan §7.C/§7.E **inverts**: I → always menu, K →
legacy "insert all properties" (CanvasViewport.jsx:1457-1633). The
inversion is plan-faithful because (a) the legacy K-key already keys
every visible property + (b) a user-facing rebind UI is not yet
shipped. §7.E will surface a toast + preference for the Blender-
faithful rebind. Documented inline in `insertKey.js` header.

**Audit sweep #80** (Phase 7 sweep #3):

- **Architecture: 0 HIGH / 0 MED / 1 LOW.** LOW-1 (test gap on
  operator-wiring layer) closed in audit-fix `57f2bb2` — §5 added
  (14 asserts) covering null project, empty/null setId, unknown
  setId, NaN/Infinity time, AllParams happy path (live-resolver
  17.5/0.7 at currentTime 2000), LocRotScale on selected part.
- **Blender-fidelity: 0 HIGH-F / 0 MED-F / 0 LOW-F across 9 cites.**
  **Cite-discipline streak RESTARTED at 7.C** (Phase 7 2-slice
  regression ends). Rules 9 + 10 + 11 applied effectively for the
  first time post-introduction.

Post-audit: **69 test asserts** (55 pre-fix; +14 regression). Tests:
`test:keyingSetMenu` wired into master chain. Sibling tests clean:
`test:insertKeyframe` (87), `test:keyingSets` (144), `test:v3Operators`
(125), `test:applyMenuStore` (28), `test:objectModeMenuStore` (22).
Typecheck clean. Close-out doc at
`docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_C.md`.

#### 7.B — Insert Keyframe operator ✅ SHIPPED 2026-05-19

**Substrate.** New `src/anim/insertKeyframe.js` (~410 LOC):

- `INSERTKEY_FLAGS` — frozen subset of Blender's `eInsertKeyFlags`
  (NOFLAGS, NEEDED, REPLACE, AVAILABLE) with byte-faithful bit
  positions for forward-compat.
- `applyKeyingSet(project, setId, objectIds, time, flags, options)`
  — top-level operator. Walks `collectChannels(set, objectIds)`,
  resolves owner action per channel via `__params__`/`__scene__`
  routing (DEV 28), calls per-channel insert/replace kernel. Returns
  `{count, results, skippedNoAction, skippedInvalidPath}` with a
  9-status enum for UI feedback.
- `wouldApplyKeyingSetChange(...)` — pure predicate; no mutation.
- Internal: `resolveTargetAction`, `buildFCurveForPath`,
  `findKeyformAt`, `insertKeyformAtInAction`.

**Blender cites (re-OPENED per rule 9 + content-verified per
rules 10+11 post audit-fix):**

- `DNA_anim_enums.h:500-525` — eInsertKeyFlags enum, bit positions
  verified literal-for-literal (rule 10 application).
- `editors/animation/keyframing.cc:177-240` — `insert_key_with_keyingset`.
- `editors/animation/keyframing.cc:410-426` — `insert_key_exec`.
- `animrig/intern/keyingsets.cc:411-466` — `apply_keyingset` kernel
  (returns at `:465`, with `:464` carrying BLI_assert; audit-fix
  LOW-F1 corrected from `:464` off-by-one).
- `animrig/intern/keyingsets.cc:294-405` — `insert_key_to_keying_set_path`.
- `animrig/ANIM_keyingsets.hh:85-89` — ModifyKeyMode enum.
- `BKE_fcurve.hh:217` — BEZT_BINARYSEARCH_THRESH = 0.01f frames
  (sister cite from Slice 6.C audit-fix, re-verified).
- `blenlib/intern/math_base_inline.cc:457-460` — `compare_ff` signature
  (audit-fix HIGH-F1: prior cite of "compare_ff default = 1e-4" was
  fab — no Blender default exists; rewritten to honest empirical
  rationale).

**SS DEVIATIONs new this slice (26-29):**

- DEV 26 — VALUE_EPSILON = 1e-4 for INSERTKEY_NEEDED (empirical;
  tighter than animrig's only `compare_ff` call at `action.cc:762`
  which uses `0.001f`). Audit-fix HIGH-F1 corrected rationale.
- DEV 27 — TIME_EPSILON_MS = 0.5 (SS canonical ms; same as Slice
  6.C DEV 6; Blender uses 0.01f frames).
- DEV 28 — `__params__`/`__scene__` routing to `__scene__`'s
  animData (Blender analog: Scene.animation_data).
- DEV 29 — REPLACE and AVAILABLE distinguished in result-status
  reporting for UI clarity (audit-fix MED-F1 re-quoted the literal
  Blender comment at `DNA_anim_enums.h:522`: "Don't create new
  F-Curves (implied by #INSERTKEY_REPLACE)").

**Audit sweep #79** (Phase 7 sweep #2). **Blender-fidelity: 1 HIGH-F
+ 1 MED-F + 2 LOW-F.** **Architecture: 1 HIGH + 5 MED + 3 LOW.** All
findings addressed same-day in `de91759`:

- HIGH-F1 — DEV 26 `compare_ff` default fab (no such default exists).
  Rule 9 was applied per file-existence; failed per content-claim.
- HIGH-1 — `buildFCurveForPath` null returned `'skipped-available'`
  not `'skipped-invalid-path'` (Rule №1 contract violation).
- MED-1 — Handle reset on replace destroyed user-authored `'free'`
  handles silently (recalc skips them; pre-fix wipe lost offsets).
- MED-2/3/5 — JSDoc-level WARNING annotations: predicate/operator
  semantic divergence (`count` vs would-change); `__params__` default
  resolver trap (static vs live value); filter-in-selector trap on
  `wouldApplyKeyingSetChange`.
- MED-4 — Test coverage for `'skipped-invalid-path'` added.
- MED-F1 — DEV 29 paraphrased-as-quoted Blender comment text; re-quoted
  literally.
- LOW polish — malformed-action default status, `:464` off-by-one,
  call-site range tightening.

**Memory rule 10 + rule 11 introduced** in
`feedback_byte_verify_behavior_cites` mid-audit-fix:

- Rule 10 — Cite the LITERAL source value for constants/defaults/
  thresholds. Rule 9 catches file-doesn't-exist fabs; rule 10 closes
  the content-claim-fab gap.
- Rule 11 — "Comment says X" promotes X to byte-quotation. Use
  "comment implies/notes that" to license paraphrase.

Post-audit: **87 test asserts** (was 72 pre-fix; +15 regression).
Sibling regressions clean (animationEngine 61, animationStore 55,
fcurveEval 35, keyingSets 144). Typecheck clean. Close-out doc at
`docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_B.md`.

**Cite-discipline regression confirmed multi-slice** (7.A + 7.B both
shipped with HIGH-F fabs). The 4-slice Phase 6 clean streak is now
provably a Phase 6 phenomenon, not a durable discipline change.
Phase 7 author discipline regressed; rules 10+11 specifically target
the 7.B failure mode for 7.C onwards.

#### 7.A — Keying Set registry ✅ SHIPPED 2026-05-19

**Substrate.** New `src/anim/keyingSets.js` (~485 LOC):

- `BUILTIN_KEYING_SET_IDS` — frozen tuple, canonical menu order:
  `['Available', 'Location', 'Rotation', 'Scaling', 'LocRotScale',
  'BlendShape', 'AllParams']` (5 Blender ports + 2 SS-original;
  mirrors Blender `keyingsets_builtins.py:647-670` `classes` tuple
  ordering for the 5 ports).
- `getKeyingSet(project, id)` — lookup, built-ins first then
  `project.keyingSets[]`.
- `listKeyingSets(project)` — stable-ordered: built-ins first then
  user-defined (insertion-order); shadow attempts on built-in ids
  rejected at list-time too.
- `getActiveKeyingSet(project)` + `setActiveKeyingSet(project, id)`.
  Setter throws Rule №1 on unknown id; null clears.
- `collectChannels(project, set, objectIds)` — returns
  `{path, group}[]`; dispatches built-in `.collect` (per-object) OR
  user-defined static `paths[]`.
- `addKeyingSet` / `removeKeyingSet` / `cloneKeyingSet` — full CRUD
  for user-defined sets. All shadow attempts on built-in ids throw.
  Active pointer auto-clears when its target set is removed.

**Blender cites (re-SOURCED per memory rule 9):**

- `keyingsets_builtins.py:27-34` — 8 ANIM_KS_* canonical idnames.
- `keyingsets_builtins.py:38-82` — Location/Rotation/Scaling defs.
- `keyingsets_builtins.py:72-73` — DEV 20: Scaling `bl_idname="Scaling"`
  (line 72) + `bl_label="Scale"` (line 73).
- `keyingsets_builtins.py:126-144` — LocRotScale composite, loc/rot/scale
  emission order at `:140-144`.
- `keyingsets_builtins.py:348-362` — Available def.
- `keyingsets_builtins.py:647-670` — `classes` menu-order tuple.
- `_keyingsets_utils.py:130-162` — RKS_GEN_available.
- `_keyingsets_utils.py:194-217` — RKS_GEN_location (DEV 21: single
  vector path `"location"` + array_index; SS emits 2 component paths).
- `_keyingsets_utils.py:220-245` — RKS_GEN_rotation (DEV 22: mode-
  dependent quat/axis/euler; SS collapses to single Euler scalar).
- `_keyingsets_utils.py:248-270` — RKS_GEN_scaling (same DEV 21 split).

**SS DEVIATIONS new this slice (20-25):**

- DEV 20 — Scaling carries `id="Scaling"` + `label="Scale"`
  (faithful Blender split).
- DEV 21 — Per-component RNA paths (transform.x / transform.y / etc).
  Blender uses 3-vector paths + array_index; SS `evaluateRnaPath`
  has no array_index concept.
- DEV 22 — Rotation collapsed to single scalar (`transform.rotation`
  / `pose.rotation`). Blender's mode-dependent
  euler/quaternion/axis_angle absent — SS is 2D-only Live2D.
- DEV 23 — User-defined sets at `project.keyingSets[]`. Blender
  scene-scoped, but SS project IS the scene per Phase 1 Stage 1.D.
- DEV 24 — `BlendShape` SS-original set (Live2D blend shapes; no
  Blender analog).
- DEV 25 — `AllParams` SS-original set (Live2D parameter pool; no
  Blender analog).

**Schema (sparse boolean idiom — Rule №2):**

- `project.keyingSets?: Array<{id, label, description?, insertNew?,
  paths: Array<{path, group}>}>` — user-defined sets only. Default `[]`.
- `project.activeKeyingSetId?: string | null` — default `null`.

No migration. Built-ins live in this module's static registry, NOT
in the project file.

**Tests:** `test_keyingSets.mjs` ships **131 asserts** across 12
sections:

1. Built-in registry shape (DEV 20 verified at `keyingsets_builtins.py:72-73`)
2. Location on non-bone object (per-component DEV 21)
3. Pose paths on bone (DEV 22 Euler-only collapse)
4. LocRotScale composite order (Blender `keyingsets_builtins.py:140-144`)
5. BlendShape SS-original (DEV 24)
6. AllParams SS-original (DEV 25)
7. Available fcurve scan + dedup
8. Active pointer mutator (immer-friendly)
9. User-defined set CRUD (add/remove with throws on shadow)
10. cloneKeyingSet from built-in (collect snapshot) + from user (static)
11. listKeyingSets ordering + shadow-attempt rejection
12. collectChannels resilience (null project / null set / null objectIds)

Wired into master `npm test`. Sibling suites regression-checked
(animationEngine 61, animationStore 55, fcurveEval 35,
actionRegistry 95 — all green). Typecheck clean (em-dashes in JSDoc
`@property`/`@param` replaced with `--` for TS parser strictness).

**Audit sweep #78** (Phase 7 sweep #1). **Blender-fidelity: 2 HIGH-F
+ 1 MED-F + 1 LOW-F — clean cite streak BROKEN at 7.A** (1 slice in).
**Architecture: 0 HIGH + 2 MED + 4 LOW.** All findings fixed in
`768d25c` same-day:

- HIGH-F1 — `keyingsets.cc:355-364 BKE_keyingset_add_path` was a
  complete fab (real defn at `blenkernel/intern/anim_sys.cc:173`;
  cited range was `remove_keyingset_button_exec`). Classic "didn't
  open the file" pattern. Replaced.
- HIGH-F2 — Orphan `(:157-162)` cite attached visually to
  `keyingsets_builtins.py` but intent was `_keyingsets_utils.py:131-162`.
  Now explicit cross-file. Rule 9 was DECLARED in docstring but not
  APPLIED at this cite (re-quoted from draft, not re-sourced).
- MED-F — `keyingsets_builtins.py:72-73 carries bl_idname = "Scaling"`
  was constant-vs-literal mismatch. Line 72 holds the constant
  `ANIM_KS_SCALING_ID`; literal `"Scaling"` at `:29`. Docstring now
  documents the split precisely.
- LOW-F — Range `:27-34` → `:26-34` (includes the upstream "Keep
  these in sync" comment at line 26).
- MED-A1 — `availablePaths` group-attribution wrong for shared-
  action projects (every fcurve attributed to first iterating
  object). Fix: filter fcurves to those whose `rnaPath` starts with
  `objects["${oid}"]` — mirrors Blender basePath filter at
  `_keyingsets_utils.py:157-160`.
- MED-A2 — `node.name ?? id` returned `''` for empty-string names
  (nullish-coalesce only trips null/undefined). 11 sites refactored
  to shared `groupOf(node)` helper using `||`.
- LOW-A1 — Selector trap JSDoc note on `listKeyingSets`.
- LOW-A2 — Silent-empty-snapshot JSDoc note on `cloneKeyingSet`.
- LOW-A3 — Test coverage extended (+13 asserts for MED-A1/MED-A2
  regression + dedup defence + MED-F clarification).

**Root-cause memory update:** `feedback_byte_verify_behavior_cites`
rule 9 phrasing tightened — "re-OPEN, not just re-source: every
cite must come from a same-session file open. Draft notes are stale
by definition." The "rule 9 declared in docstring" half is necessary
but insufficient; the mechanical file-open step must be applied to
EVERY cite, not just marquee ones. The 4-slice Phase 6 streak gave
a false automaticity sense.

Post-audit: **144 test asserts**, sibling regressions clean
(animationEngine 61, animationStore 55, fcurveEval 35, actionRegistry
95). Typecheck clean. Close-out doc at
`docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_7_SLICE_A.md`.

#### 7.A v1 plan reference (preserved below for slice authors)

[src/anim/keyingSets.js]:

```js
// Built-in keying sets (registered once)
{
  id: 'Available',           // Insert into existing FCurves only
  insertNew: false,
  collectChannels: (object) => object's existing FCurves
}
{
  id: 'Location',
  insertNew: true,
  collectChannels: (object) => ['transform.x', 'transform.y']
}
{
  id: 'Rotation',
  insertNew: true,
  collectChannels: (object) => ['transform.rotation']  // bone: 'pose.rotation'
}
{
  id: 'Scale',
  insertNew: true,
  collectChannels: (object) => ['transform.scaleX', 'transform.scaleY']
}
{
  id: 'LocRotScale',
  insertNew: true,
  collectChannels: (object) => Location + Rotation + Scale
}
{
  id: 'BlendShape',           // SS-specific
  insertNew: true,
  collectChannels: (object) => 'blendShapeValues[*]'
}
{
  id: 'AllParams',            // SS-specific
  insertNew: true,
  collectChannels: () => '__params__.values[*]'
}
```

User-defined keying sets: stored on the project at
`project.keyingSets[]`, registered alongside built-ins.

#### 7.B — Insert Keyframe operator

Operator `animation.insertKeyframe(keyingSetId)`:

1. Resolve the keying set's `collectChannels(activeObject)` →
   list of RNA paths.
2. Resolve the active Action (from `activeObject.animData.actionId`).
3. For each RNA path:
   - Get current value via `evaluateRnaPath(project, path)`.
   - Find or create FCurve in the Action with `rnaPath` matching.
   - Insert/replace BezTriple at `animationStore.currentTime`.

Modifiers:
- `'Only Insert Needed'` (preference): if the FCurve already
  evaluates to the current value at this time (within epsilon),
  skip the insert.
- `'Replace'` vs `'Always Add'` (always replace if a key already
  exists at this time).

#### 7.C — `I`-key menu

The `I` hotkey in CanvasViewport (and TimelineEditor) opens a menu
listing all registered keying sets. Click → invoke
`animation.insertKeyframe(set.id)`.

Default visible set: pick the first applicable from the active object
type (Object → LocRotScale; Bone → Rotation; Mesh in BlendShape mode →
BlendShape; etc.).

#### 7.D — Auto-keyframe parity

Existing auto-key behaviour writes every property of the selection.
After Phase 7, auto-key respects the active keying set:

- "AutoKey: All" (current behaviour, becomes opt-in)
- "AutoKey: Active Keying Set" (new default, matches Blender)
- "AutoKey: Available" (insert only into existing FCurves)

UI: a dropdown next to the auto-key button picks the auto-key mode.

#### 7.E — K-key behaviour

Existing K-key keeps current behaviour ("Insert all visible") but
displays a small toast on first use after Phase 7 lands: "K inserts
all properties; use I to choose a keying set". A preference can
re-bind K to `I`-default-set if the user prefers.

#### 7.F — Tests

| Test | What |
|------|------|
| `test_keyingSet_builtin.mjs` | Each built-in set collects the right channels |
| `test_keyingSet_userDefined.mjs` | Custom set CRUD |
| `test_insertKeyframe_replace.mjs` | Replace existing key at time |
| `test_insertKeyframe_onlyNeeded.mjs` | Skip when value matches |
| `test_autoKey_keyingSet.mjs` | Auto-key respects active set |

**Phase 7 sum:** ~3–5 days. No schema change. New: Keying Set
registry, Insert Keyframe operator, `I`-menu, AutoKey set parity.
Closes: 1 grievance (no Insert Keyframe).

---

### Phase 7 — Close-out, deprecations, telemetry, baggage sweep (3–5 days)

(Was Phase 8 in v1; renumbered after Phase 7's "Insert Keyframe" stays
as Phase 6 was originally — see §4 Phase order. The Insert Keyframe
operator is now Phase 6.5; the close-out is Phase 7.)

**Goal.** Rule №2 — no migration baggage. Tidy up.

**Audit-driven changes from v1:**
- Phase 1 absorbed the NodeTree retirement. v1's 8.C section is gone.
- Phase 0.0 declared ms canonical. v1's 8.E was about deciding ms vs
  seconds; that decision is now front-loaded.
- Net: Phase 7 (close-out) is materially smaller than v1's Phase 8.

#### 7.A — Remove `evalEngine: 'classic'` opt-out ✅ SHIPPED 2026-05-20

The dual-engine opt-out is removed per Rule №2 (user directive
2026-05-20: "no migration baggage, so remove classic"). The Phase 0.D
default-flip gate (user-side manual byte-fidelity sweep) was
explicitly waived by the user; `evalProjectFrameViaDepgraph` is now
the sole viewport eval path.

**What was removed:**
- `preferencesStore.evalEngine` field + `EVAL_KEY` localStorage key +
  `setEvalEngine` setter.
- [CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
  per-tick `usePreferencesStore.getState().evalEngine` read + the
  `evalRig` viewport branch (now unconditional
  `evalProjectFrameViaDepgraph`) + the dead classic-only bone
  post-chain re-skin block (LBS / overlay) that the depgraph already
  performs inside `kernelArtMeshEval` (Phase 0.D armature port). The
  now-unused `evalRig` + `computeBoneWorldMatrices` /
  `computeBoneParentMap` / `computeBoneOverlayMatrices` /
  `applyOverlayMatrixObj` / `pickBonePostChainComposition` /
  `applyTwoBoneSkinningObj` imports were dropped from CanvasViewport.
- `test_preferencesStore.mjs` evalEngine assertions.

**Scope correction (vs the original v2 plan text).** The original
7.A also called for deleting
[animationEngine.js](../../src/renderer/animationEngine.js)
`computeParamOverrides` / `computePoseOverrides`. That is **NOT** part
of "remove classic" — those helpers are the engine-independent
animation **override layer** (node-transform + `mesh_verts` fcurve
animation), invoked unconditionally by the CanvasViewport tick
(`computeParamOverrides` merge into `valuesForEval`;
`computePoseOverrides` → the renderer's `poseOverrides` map) AND by
the export-frame capture path
([captureExportFrame.js](../../src/components/canvas/viewport/captureExportFrame.js)).
They feed the depgraph path too — `evalProjectFrameViaDepgraph`
evaluates art-mesh GEOMETRY (param-driven cellSelect) but does not
emit the node-transform / `mesh_verts` fcurve overrides the renderer
applies on top. `evalRig` (the function) likewise stays — still used
by `ArmatureModifierService` (bake) + the side-by-side test harness.
Deleting the override helpers would require migrating `mesh_verts` +
node-transform fcurve animation into the depgraph — a separate,
larger close-out slice, not the "classic opt-out" baggage. Tracked
as a future close-out item if desired.

#### 7.B — Verify `project.animations[]` reader removal ✅ SHIPPED 2026-05-20

Phase 1 migration deleted the writes; Phase 1.B.1 enumerated and
migrated all 8 known consumers. This grep-verify (commit `fe818c9`)
confirmed **no live reader of `project.animations[]` remains.** All
surviving references are legitimate: the v1 + v11 migrations
(`projectMigrations.js`) and the v36 migration
(`v36_action_datablock.js`) read the pre-v36 shape during the
migration walk; the rest are historical comments. Three dead-baggage
spots that re-created or carried the deleted field with zero consumers
were removed in the retroactive cleanup: `cmo3/emitContext.js`
(`ctx.animations` + its typedef — never passed, never read),
`rig/initRig.js` (an `animations: []` arg `generateCmo3` ignores), and
`cmo3Import.js` (an `animations: []` on the import shell built at
`CURRENT_SCHEMA_VERSION`). Byte-fidelity unchanged.

#### 7.C — Deprecate `easing: string` per-segment ✅ RESOLVED-BY-ANALYSIS 2026-05-20 (no removal needed)

Original premise: "Phase 2 migrated to BezTriple but the legacy
`easing` field stayed on keyforms for round-trip safety; Phase 7
removes the field and the parser branches."

**The premise is inaccurate against the shipped code.** Investigation
(2026-05-20, acting autonomously per Rule №1):

1. **The stored field is already gone.** The v39 migration
   (`v39_beztriple_keyforms.js:migrateKeyform`) *replaces* every
   keyform with a fresh object containing only `{time, value,
   handleLeft, handleRight, handleType, interpolation, flag}` —
   `easing`/`type` are dropped, not carried alongside. `makeBezTripleKeyform`
   likewise never writes `easing` onto a stored keyform. So no
   persisted or freshly-created keyform carries `easing`.

2. **The remaining `easing` is a proper input-boundary adapter, not
   baggage.** `makeBezTripleKeyform` (`anim/animationFCurve.js`)
   accepts EITHER native `interpolation` (pass-through) OR a legacy
   `easing` string, which it converts via `legacyEasingToInterpolation`.
   That conversion serves three LIVE input sources that naturally
   speak easing semantics: motion3 import, the idle-motion generator
   DSL (`motionLib.js` → `keyframeSequence.js`), and the timeline
   easing dropdown. The easing string also carries auto-handle
   shorthand (`'ease-both'` → bezier auto/auto) that native
   `interpolation`-only input loses (native `'bezier'` defaults to
   vector/vector handles).

3. **Removing the adapter would be a Rule №1 violation, not a fix.**
   Forcing motion3-import / idle-DSL / UI callers to pre-compute
   handle coordinates would scatter the conversion math across
   callers (a crutch) and lose the shorthand — strictly worse design.
   The centralized boundary adapter is the proper solution.

**Action: no removal.** CO-C's stored-field goal was achieved at v39;
the remaining `easing` vocabulary is a clean adapter and stays. (The
deliberate `legacyEasingToInterpolation` ↔ `legacyToBezTripleShape`
duplication between runtime + the frozen v39 migration is documented
and intentional — migrations stay frozen at shipping state.)

#### 7.D — `paramValuesStore.values` audit ✅ RESOLVED-BY-ANALYSIS 2026-05-20 (no replacement — premise inaccurate)

Original premise: "Many code paths read directly from
`paramValuesStore.values`, bypassing the FCurve evaluator; replace
with `evaluateRnaPath(project, 'objects[__params__].values[<id>]')`."

**The premise is inaccurate against the shipped code.** Investigation
(2026-05-20, acting autonomously per Rule №1):

1. **`evaluateRnaPath` is NOT an FCurve evaluator for params.** For
   `__params__` paths it resolves through `_paramsView`
   (`anim/rnaPath.js:172-178`), which returns
   `project.parameters[*].default` — the **static defaults**. It does
   not evaluate FCurves at all (it's a pure structural path-walk). Its
   own docstring: *"drivers / FCurves write through the paramValues
   store at runtime, not here."* Replacing live `paramValuesStore.values`
   reads with it would return static defaults everywhere — a
   catastrophic regression (every param read would ignore both user
   slider edits AND animation).

2. **`paramValuesStore.values` is already the animation-aware single
   source of truth.** In animation mode the CanvasViewport tick
   (`CanvasViewport.jsx:662-685`) runs `computeParamOverrides` (FCurve
   eval) + driver eval and **writes the results back into
   `paramValuesStore` via `setMany`**. So a direct read gets the merged
   effective value (slider state ⊕ FCurve overrides ⊕ driver outputs).
   This is the designed convergence point, not a bypass.

3. **All extant reads are legitimate live-value reads.** WarpDeformerOverlay,
   ParameterTab slider, SkeletonOverlay eye-ball, FCurveEditor channel
   display, and the insertKeyframe resolver (the 7.C fix that
   *deliberately* reads `paramValuesStore`, NOT `evaluateRnaPath`, to
   get live values) all want the live merged value. None are export
   paths (the cmo3/motion3/can3 exporters walk action FCurves directly,
   never `paramValuesStore`).

**Action: no replacement.** The plan's original idea (`evaluateRnaPath`
as the param SoT) was superseded by the implemented write-back
architecture, which is cleaner: one merged store, animation-aware,
with the bone-mirror sync as its only special case (the
`skipBoneMirror` flag on `setMany`). CO-D's intent (FCurve eval as
SoT) is already satisfied via tick write-back.

#### 7.E — Documentation ⏸ DEFERRED-OPTIONAL 2026-05-20 (additive, not baggage)

Original scope: update `docs/V3_WORKSPACES.md` animation section + new
`docs/ANIMATION_GLOSSARY.md` (Blender↔SS↔Cubism term map) + new
`docs/ANIMATION_AUTHORING_FLOWS.md`.

**Status (2026-05-20, acting autonomously per Rule №1):** deferred.
This is additive documentation, NOT migration-baggage removal (the
user's close-out directive was "no migration baggage, so remove
classic"). Notes:
- `docs/V3_WORKSPACES.md` **does not exist** — it was referenced by
  the plan + a memory entry but never created, so there is no
  animation section to "update." Creating it is net-new work.
- The glossary + authoring-flows are net-new speculative docs with no
  current consumer. Per "don't add features/docs beyond what the task
  requires," generating them to satisfy a plan checkbox would be
  low-value. Available on request.

#### 7.F — Telemetry ⏸ DEFERRED-OPTIONAL 2026-05-20 (speculative, no consumer)

Original scope: per-tick FCurve/driver/constraint eval counts + Action-save
keyframe stats + NLA-bake strip counts in `lib/logger.js`.

**Status (2026-05-20, per Rule №1):** deferred. The per-tick counters
add overhead + code to the render hot path (the depgraph eval kernels)
for telemetry with no current consumer or dashboard — speculative
instrumentation that "don't add features beyond what the task
requires" counsels against. The event-driven parts (Action save, NLA
bake) are cheaper but likewise have no consumer. Not baggage removal.
Available on request if a perf-debugging need arises (the existing
`logger.time/timeEnd` loading-times instrumentation is the precedent
to extend).

#### 7.G — Memory audit ✅ SHIPPED 2026-05-20

Corrected the stale V2 NodeTree memory entry
(`project_blender_parity_v2_phase0` index line) to reflect current
reality:
- The per-part `RigWarp_*` ~`canvasW/2` divergence (flagged at V2
  close) was FIXED in anim Phase 0.A (missing build-time relation in
  `depgraph/build.js`; pinned by `test_depgraphSideBySide_rotationParent`).
- The render-side flip is DONE — close-out CO-A (`7c0852a`) removed
  the `evalEngine:'classic'` opt-out; depgraph is the sole viewport
  eval path.
- `project.nodeTrees` DATA was retired in the **v38** migration
  (`v38_nodetree_retirement.js`) — NOT "Phase 1 v33" as this plan
  section originally stated. The NodeTreeEditor + `src/anim/nodetree/`
  compilers stay LIVE (derive trees on-the-fly); they are not dead
  baggage.

(The plan's original "Phase 5 scaffolds → wired in Phase 0" item is
already covered by the live `feedback_ms_canonical_animation_time` +
the Phase 0 progress doc; no separate stale entry needed. The "add
new memory entries per phase" item is satisfied by the existing
`project_blender_parity_plans_in_flight` index entry maintained
across every slice.)

**Phase 7 close-out outcome (2026-05-20):** the Rule №2 baggage sweep
is COMPLETE. CO-A removed the one real piece of baggage (the
dual-engine `classic` opt-out). CO-B verified `animations[]` reader
removal + cleaned 3 dead refs. CO-C + CO-D were resolved-by-analysis
(their premises were superseded by the shipped architecture; the
literal instructions would have introduced regressions). CO-G
corrected stale memory. CO-E + CO-F are additive (docs/telemetry),
deferred-optional, not baggage. No new schema, no new features.

---

## 6. Schema bumps

| v | Phase | What |
|---|-------|------|
| v33 | Phase 1 | `Action` datablock; `AnimData` per Object; `__scene__` pseudo-Object; legacy `animations[]` deleted; **NodeTrees retired** (audit-driven absorption from former Phase 8.C) |
| v34 | Phase 3 | `FCurve.modifiers[]`; modifier types `cycles` / `noise` / `generator` / `limits` / `stepped` / `envelope` (was v35 in v1) |
| v35 | Phase 4 | `AnimData.nlaTracks[]`; NlaStrip with 4 blend modes (was v36 in v1) |

(Schema v32 is current. Phase 2 BezTriple migration runs as a
non-bumping in-place transformation: a v33 project's FCurves get their
keyforms upgraded to BezTriple shape during the v33 migration step, so
no separate v34-for-BezTriple bump. Phase 7 close-out has no schema
bump — the legacy `easing` field is removed from FCurve keyform shape
in code; data files have already migrated through Phase 2.)

**Audit-driven schema-numbering compaction:** v1 had 5 schema bumps
(v33–v37). Refined v2 has 3 (v33–v35) by absorbing NodeTree retirement
into v33 (Rule №2: no dual-write phase) and the BezTriple shape change
into v33 alongside the Action migration. The Action migration already
walks every keyform; doing the BezTriple shape transformation in the
same pass is free.

---

## 7. Validation per phase

Every phase ships:

- **Unit tests** (per the per-phase tables above)
- **Integration test** — at least one `test_*_integration.mjs` exercising the full path from project schema through the eval to a deterministic output map
- **Byte-fidelity sweep** — covers BOTH user E2E test PSDs (Western + anime topology) plus Hiyori reference. This is the gate that has historically caught real regressions; it gates every phase.
- **Manual verification** — at least one screenshot or short-form GIF in the changelog, demonstrating the user-facing behaviour
- **Memory entry** — auto-memory file added, MEMORY.md updated

The **byte-fidelity sweep** runs as `pnpm test:exportFidelity` and must
pass with the new schema before phase exit. The sweep covers:

- **Shelby (Western)** — `shelby_neutral_ok.psd → Init Rig → export → diff against shelby.cmo3 baseline (SS v0.2)`. Regression-grade gate.
- **test_image4 (anime)** — `test_image4.psd → Init Rig → export → smoke-load in Cubism Viewer`. Anime topology has historically exposed bugs the Western fixture missed (BUG-025 leg-roles fly was anime-only). No baseline cmo3 — gated on Cubism Viewer load + visual sanity, not byte-diff.
- **Hiyori (reference)** — Cubism's official sample. moc3 byte-diff against the canonical reference. User has no PSD source, so this gate is on the *exported* artefact, not a re-import + re-export round-trip.
- motion3.json export of one keyframed Action per phase
- can3 export of one keyframed Action per phase
- model3.json + cdi3.json + physics3.json full-bundle export

Any regression on any of these blocks the phase merge. Anime-only or
Western-only regressions are explicit blockers — neither category can
be silently shipped because a fixture in one style passed.

---

## 8. File index

### New files

| Path | Phase | What |
|------|-------|------|
| [src/anim/actionRegistry.js](../../src/anim/actionRegistry.js) | Phase 1 | Action datablock CRUD |
| src/anim/fcurveHandles.js | Phase 2 | Auto-handle calculator |
| src/anim/fmodifiers.js | Phase 3 | F-Curve modifier evaluator |
| src/anim/nla.js | Phase 4 | NLA evaluator |
| src/anim/nlaTweak.js | Phase 4 | Tweak-mode push/accept logic |
| src/anim/keyingSets.js | Phase 7 | Keying Set registry |
| src/v3/editors/nla/NLAEditor.jsx | Phase 4 | NLA editor surface |
| src/v3/operators/insertKeyframe.js | Phase 7 | Insert Keyframe operator + I-menu |
| src/v3/operators/bakeNla.js | Phase 4 | Bake NLA operator |
| src/store/migrations/v33_action_datablock.js | Phase 1 | v32→v33 migration |
| src/store/migrations/v34_beztriple.js | Phase 2 | v33→v34 |
| src/store/migrations/v35_fmodifiers.js | Phase 3 | v34→v35 |
| src/store/migrations/v36_nla.js | Phase 4 | v35→v36 |
| src/store/migrations/v37_nodetree_retirement.js | Phase 8 | v36→v37 |
| docs/ANIMATION_GLOSSARY.md | Phase 8 | Terms map |
| docs/ANIMATION_AUTHORING_FLOWS.md | Phase 8 | Authoring patterns |

### Modified entry-point files

| Path | Phases | Note |
|------|--------|------|
| [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) | 0, 7 | Wire driver+constraint pass; add I-menu |
| [src/anim/depgraph/build.js](../../src/anim/depgraph/build.js) | 0, 1, 4 | Build NLA-aware eval graph |
| [src/anim/depgraph/eval.js](../../src/anim/depgraph/eval.js) | 0, 4 | NLA evaluation path |
| [src/anim/depgraph/kernels/animation.js](../../src/anim/depgraph/kernels/animation.js) | 1, 4 | Action+NLA aware |
| [src/anim/depgraph/kernels/matrix.js](../../src/anim/depgraph/kernels/matrix.js) | 0 | Constraint pass |
| [src/anim/depgraph/kernels/gridLift.js](../../src/anim/depgraph/kernels/gridLift.js) | 0 | RigWarp_* coordinate-frame fix |
| [src/anim/fcurve.js](../../src/anim/fcurve.js) | 2, 3 | BezTriple eval + FModifier integration |
| [src/anim/animationFCurve.js](../../src/anim/animationFCurve.js) | 1 | Action-datablock-aware bridge |
| [src/anim/driverPass.js](../../src/anim/driverPass.js) | 0 | Wired into tick |
| [src/anim/constraints.js](../../src/anim/constraints.js) | 0 | Wired into matrix kernel |
| [src/store/projectStore.js](../../src/store/projectStore.js) | 1 | Action CRUD; AnimData CRUD |
| [src/store/projectMigrations.js](../../src/store/projectMigrations.js) | 1, 2, 3, 4, 8 | Migration registration |
| [src/v3/editors/timeline/TimelineEditor.jsx](../../src/v3/editors/timeline/TimelineEditor.jsx) | 1, 2, 5, 7 | Action picker; per-keyframe handle UI; I-menu |
| [src/v3/editors/fcurve/FCurveEditor.jsx](../../src/v3/editors/fcurve/FCurveEditor.jsx) | 5 | Write-mode |
| [src/v3/editors/dopesheet/DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx) | 6 | Write-mode |
| [src/v3/editors/animations/AnimationsEditor.jsx](../../src/v3/editors/animations/AnimationsEditor.jsx) | 1 | Renamed to ActionsEditor; assignment UI |
| [src/io/live2d/exporter.js](../../src/io/live2d/exporter.js) | 1, 2, 3, 4 | Action-aware; NLA-bake-aware; FModifier-bake-aware |
| [src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js) | 2, 3 | BezTriple → Cubism segments; Cycles → IsLoop |

---

## 9. Architecture decisions

### 9.A — Why JS-subset expression sandbox stays

Drivers use [src/anim/driver.js](../../src/anim/driver.js)'s hardened
JS-subset Function() sandbox, not Python. Three reasons:

1. The sandbox is shipped, hardened, and tested. Replacing it with
   Python is high-cost low-benefit.
2. The 95% case in driver expressions is `var * 2`, `clamp(var, 0, 1)`,
   `sin(var * pi)`, `Math.max(a, b)`. The JS subset already handles
   these; the operator-precedence edge cases that distinguish JS from
   Python rarely hit in expressions of this complexity.
3. Adding Python adds a runtime dependency (Pyodide ~13 MB or RustPython
   ~2 MB after dead-code) that violates the loading-page sweep we just
   shipped.

Tradeoff: Blender artists who are accustomed to Python expression syntax
have to relearn `**` → `Math.pow()` and `min/max` → `Math.min/max`. We
document this in the ANIMATION_GLOSSARY.

### 9.B — Why Action datablock over flat track list

Three reasons:
- Reuse: one walk Action across multiple characters in the same
  project is the exact use case Cubism does not support and we want.
- NLA: NLA strips reference Actions; flat tracks have no shareable
  identity.
- Library: a "Pose Library" feature (a follow-up plan) needs Action
  datablocks as the unit of storage.

### 9.C — Why BezTriple per-keyframe over per-segment easing

Per-segment easing is what Cubism's editor does, and it covers ~80% of
authoring needs with much less UI surface. The remaining 20% — fine
control over a sigh's exhale curve, a wave's overshoot — is exactly
what the Graph Editor exists to address. We adopt Blender's per-keyframe
model because:
- It is strictly more expressive than per-segment.
- The migration from per-segment is unambiguous (each preset maps to
  one bezier handle pair).
- Cubism's `.motion3.json` segment encoder accepts bezier control
  points directly, so no expressive loss at export.

### 9.D — Why NLA in Phase 4 not Phase 1

NLA needs Actions to reference. Building NLA without an Action
datablock is the same as building a list of "anonymous track bundles
with blend modes", which we already nearly have today (multiple
clips, no blend modes). The Action layer makes NLA conceptually clean.

### 9.E — Why retire NodeTrees in Phase 8

The NodeTrees were a Phase V2 architectural bet that the future was a
visual-graph animation editor. Two months later, the visual-graph
editor remains read-only and the rest of the system has continued
evolving as a Blender-shaped Action+FCurve+NLA stack. Maintaining both
is migration baggage (Rule №2). The decision in Phase 8 picks one;
this plan recommends retiring the NodeTrees because the data they
carry is already implicit in `selectRigSpec` (rig structure) and
`animData` (animation binding) and `driverPass` (drivers). Retirement
is reversible: if a future plan brings back a visual-graph editor,
re-deriving NodeTrees from the canonical model is straightforward.

### 9.F — Why DepGraph is the production tick

The classic engine evolved as a sequence of imperative passes
(`computeParamOverrides` → `evalRig` → `physicsTick`). The DepGraph
makes the eval order explicit, which is necessary for:
- Drivers (drivers must run before the FCurve they override)
- Constraints (constraints must run after pose composition, before
  matrix build)
- NLA (NLA blend must run before the parameter-evaluator stage)
- Caching (DepGraph nodes are deterministically named, enabling
  per-node caching with revision counters)

Keeping the classic engine alive in production is migration baggage
the user can already live without (it's the opt-out, not the default,
after Phase 0).

### 9.G — Why no Pyodide for Python drivers

Loading-perf debt. ~13 MB even compressed. A Python driver runtime
costs more than the entire current eager bundle.

### 9.H — Why three Editor surfaces (Graph + Dopesheet + NLA)

Each surface answers a different question:

- **Graph Editor**: "what does this curve look like, and how do I
  shape it?" — one Channel at a time, full bezier interactivity.
- **Dopesheet**: "what is keyed when, across many channels?" —
  multi-channel, time-only manipulation.
- **NLA Editor**: "how do my actions blend in time?" — Action-level
  composition.

Collapsing them is tempting but wrong: the user task at the Graph
Editor (handle-tweaking) is incompatible with the user task at the
Dopesheet (multi-channel time-shift). Blender ships three for a
reason.

---

## 10. Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|-----------|
| 1 | gridLift coordinate-frame fix is harder than estimated; depgraph default-on slips | Medium | Phase 0 has a slip-buffer; if 0.A overruns, defer to a sub-Phase 0.5 and proceed with 0.B/0.C with the classic engine staying default. |
| 2 | BezTriple migration loses author intent on round-tripped motion3 imports | Medium | The motion3 importer already understands Cubism segment types; the migration walks per-segment, not per-clip. Worst case: one easing preset gets the wrong handle vectors; user re-shapes in the Graph Editor. |
| 3 | FModifier `Cycles` + `Noise` interactions diverge from Blender on edge cases | High | Limit Phase 3's "Blender parity" claim to the modifiers we ship + the documented order. Edge cases (e.g. `Stepped` after `Noise`) are documented as undefined and `Stepped` is auto-moved to the head of the stack. |
| 4 | NLA blend `combine` mode (rotation-aware) is hard | Medium | Phase 4 ships `combine` only on rotation channels; non-rotation `combine` falls back to `replace` (and emits a one-time toast). Blender does the same. |
| 5 | Graph Editor performance with many keyframes (1000+) | Medium | SVG with React reconciliation degrades >200 keyframes. Migrate to canvas-2D for the keyframe diamonds in Phase 5.B if profiling shows it's needed. Frame budget: 16ms for the editor at 60Hz. |
| 6 | NodeTree retirement breaks a use case we've forgotten | Low | Phase 8 retirement migration is gated on an explicit user check ("are NodeTrees used in any active workflow?"). If yes, fall back to "keep dual-write, defer retirement to a follow-up plan". |
| 7 | Bezier handle export to `.motion3.json` segments has a corner case where Cubism Viewer renders differently than SS preview | High | Round-trip test (export → re-import → diff) on every phase exit. We've already paid this cost in the moc3 / cmo3 byte-fidelity sweep. |
| 8 | The user spawns a follow-up "actually implement Pyodide drivers" before Phase 8 | Low | Section 2.2 declares it explicitly out of scope; the plan reviewer should challenge any in-flight scope creep. |
| 9 | The toolset plan ships in parallel and re-arranges keymap entries we depend on (`I` for Insert Keyframe, `B` for box select in Graph Editor) | Medium | Coordinate keymap with the toolset plan before either ships. `I` is reserved for Insert Keyframe globally; `B` in Graph Editor scope = box select keyframes; `B` in Object/Edit Mode scope = box select objects/verts. Scope-aware keymap (already present in dispatcher). |

---

## 11. Estimate

Phase-by-phase, optimistic / realistic / pessimistic. Audit-revised
upward where the audit caught hidden work.

| Phase | Optimistic | Realistic | Pessimistic |
|-------|-----------|-----------|-------------|
| 0 — Wire (incl. 0.0 ms-canonical, 0.D.0 viewport wire-up) | 5 days | 7 days | 10 days |
| 1 — Action datablock + NodeTree retirement + 8-consumer migration | 10 days | 14 days | 20 days |
| 2 — BezTriple + motion3jsonImport upgrade | 5 days | 8 days | 12 days |
| 3 — FModifiers (6 types, post-audit) | 5 days | 7 days | 10 days |
| 4 — NLA (4 blend modes; combine deferred) | 8 days | 11 days | 16 days |
| 5 — Graph Editor write-mode (canvas-2D from day 1) | 6 days | 9 days | 13 days |
| 6 — Dopesheet write-mode + Insert Keyframe + Keying Sets (merged) | 6 days | 8 days | 12 days |
| 7 — Close-out (audit-trimmed) | 2 days | 4 days | 6 days |
| **Total** | **47 days (~7 wk)** | **68 days (~10 wk)** | **99 days (~14 wk)** |

Realistic: **~10 weeks** of focused work, single-author (audit-revised
upward from v1's 9-week estimate; the architecture audit flagged
Phase 1 underestimated by ~50% due to the missed consumers, and the
fidelity audit flagged Phase 2 underestimated for the importer
upgrade).

The plan is internally sequenced so partial delivery is shippable.
Stopping after Phase 4 still gets us NLA. Stopping after Phase 6 still
gets us Graph + Dopesheet + Insert Keyframe; only Phase 7 (close-out)
is strictly optional in the sense that not running it leaves
migration baggage (Rule №2 violation) but does not break user-visible
features.

**Pessimistic 14 weeks is the number to commit to externally.**

---

## 12. Coordination with other in-flight plans

- **TOOLSET_BLENDER_PARITY_PLAN.md** (sibling plan) — keymap
  coordination per Risk #9. Specifically: `I` is reserved for Insert
  Keyframe globally; `B` is box-select in *every* scope (in Graph
  Editor → keyframes; in Object Mode → parts; in Edit Mode → verts).
- **CUBISM_ADAPTER_PATTERN.md** — the adapter pattern doc described a
  read-side abstraction that Phase 1's Action datablock fills cleanly.
  No conflict; Action becomes the canonical in-memory shape that the
  adapter writes from.
- **PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md** — open performance debts (R3
  typed-array pool wider scope, etc.) are unchanged; this plan does not
  introduce new hot-path allocations.

---

## 13. Phase exit checklists (running)

```
Phase 0:
  [ ] gridLift RigWarp_* fix lands; test_depgraphSideBySide green
  [ ] driverPass wired into tick; integration test green
  [ ] constraints wired into matrix kernel; integration test green
  [ ] depgraph default flipped; classic kept as opt-out
  [ ] Memory entry: 'DepGraph is production'
  [ ] Byte-fidelity sweep green
  (AnimationTree dual-write entry removed — Phase 0.E was dropped in v2
   per audit "migration baggage" feedback; see §Phase 0.E for rationale.)

Phase 1:
  [ ] Schema v33; migration v32→v33 round-trip
  [ ] actionRegistry.js shipped; tests green
  [ ] __scene__ pseudo-Object recognized by exporter
  [ ] ActionsEditor UI ships
  [ ] Each action exports one motion3.json + one .can3 byte-identical to baseline
  [ ] Memory entry: 'Action datablock'
  [ ] Byte-fidelity sweep green

Phase 2:
  [ ] Schema v34; BezTriple migration green
  [ ] evaluateFCurve handles all interpolation types
  [ ] Auto-handle calculator matches Blender output on fixture set
  [ ] Cubism segment export round-trip on 6 sample motions
  [ ] Memory entry: 'BezTriple FCurve handles'
  [ ] Byte-fidelity sweep green

Phase 3:
  [ ] Schema v35; FCurve.modifiers[] populated
  [ ] All 6 modifier types green in isolation + composition
  [ ] Cycles → IsLoop in motion3.json; Cubism Viewer load loops
  [ ] FCurve Modifier UI ships in Properties panel
  [ ] Memory entry: 'F-Curve modifiers'
  [ ] Byte-fidelity sweep green

Phase 4:
  [ ] Schema v36; NlaTrack[] / NlaStrip[] populated
  [ ] All 5 blend modes green
  [ ] Tweak mode push/accept green
  [ ] BakeNLA operator green; baked Action exports identically to flat NLA
  [ ] NLAEditor ships
  [ ] Memory entry: 'NLA stack'
  [ ] Byte-fidelity sweep green

Phase 5:
  [ ] FCurveEditor write-mode interactive
  [ ] All operators bound + tested
  [ ] Multi-curve display works
  [ ] Driver display + edit-disabled state
  [ ] Memory entry: 'Graph Editor write-mode'

Phase 6:
  [ ] DopesheetEditor write-mode interactive
  [ ] All operators bound + tested
  [ ] Channel mute/solo/filter
  [ ] Memory entry: 'Dopesheet write-mode'

Phase 7:
  [ ] Keying Set registry (built-in + user-defined)
  [ ] Insert Keyframe operator (I-menu) ships
  [ ] AutoKey respects active keying set
  [ ] Memory entry: 'Insert Keyframe + Keying Sets'

Phase 8:
  [ ] evalEngine: 'classic' code path removed
  [ ] Legacy project.animations[] reader paths removed
  [ ] NodeTree datablocks retired (v37) IFF they are unused
  [ ] Legacy easing field removed from FCurve.keyforms
  [ ] paramValuesStore audit complete
  [ ] Telemetry shipped
  [ ] Documentation updated (V3_WORKSPACES, ANIMATION_GLOSSARY, ANIMATION_AUTHORING_FLOWS)
  [ ] Memory entries updated
  [ ] Byte-fidelity sweep green
```

---

## 14. Quick-reference: what closes what

(The 17 grievances from the SS animation audit, mapped to phase exits.)

| Grievance | Phase |
|-----------|-------|
| A — No Action datablock | Phase 1 |
| B — No NLA stack | Phase 4 |
| C — FCurve bezier handle editing | Phase 2 (data) + Phase 5 (UI) |
| D — F-Curve modifiers | Phase 3 |
| E — DepGraph not in production | Phase 0 |
| F — Constraints not wired | Phase 0 |
| G — Drivers not wired | Phase 0 |
| H — No Insert Keyframe operator / menu | Phase 7 |
| I — No Graph Editor interactive editing | Phase 5 |
| J — Dopesheet read-only | Phase 6 |
| K — No per-FCurve extrapolation mode | Phase 3 (Cycles) + Phase 5 (UI) |
| L — No channel grouping / filter in Timeline | Phase 6 (Dopesheet) |
| M — No animation preview separation | Phase 0 (DepGraph eval result map) |
| N — AnimationTree shadow copy | Phase 8 (retire) — Phase 0.E dual-write was dropped in v2 audit as migration baggage |
| O — No "what drives this" UI | Phase 5 (Graph Editor driver banner) |
| P — Keyform vs animation conflated | Phase 1 (RNA-path namespace separation in actionData) |
| Q — Time unit inconsistency | Phase 8 (audit + canonical seconds throughout) |

---

End of plan. Ready for two-agent audit.
