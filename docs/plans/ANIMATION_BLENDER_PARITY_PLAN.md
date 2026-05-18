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

### Phase 3 — F-Curve modifiers (1 week, schema v34)

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

`Noise` outputs a Perlin field. The seed is derived from
`(fcurveId, modifierId, time)` so the noise is stable across saves and
deterministic for byte-fidelity tests. The export pipeline bakes Noise
modifiers into explicit keyframes at the FPS of the target Action — Cubism
has no live-noise primitive.

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

#### 3.F — Tests

| Test | What |
|------|------|
| `test_fmodifiers_cycles.mjs` | repeat / repeat_offset / mirror at various positions |
| `test_fmodifiers_noise.mjs` | seeded reproducibility + frequency response |
| `test_fmodifiers_generator.mjs` | polynomial degrees 0..4 |
| `test_fmodifiers_limits.mjs` | clamp on each axis |
| `test_fmodifiers_stepped.mjs` | hold-for-N-frames |
| `test_fmodifiers_envelope.mjs` | min/max envelope control |
| `test_fmodifiers_stack.mjs` | Cycles + Noise + Limits composition |
| `test_fmodifiers_export_bake.mjs` | Noise baked at export, byte-identical to a hand-baked motion3 |

#### 3.G — Phase exit gate

- All FModifier tests green.
- Cubism Viewer load of an exported motion3.json with `Cycles` → loops correctly.
- Round-trip: cycle-modifier on save → load → save preserves the modifier.

**Phase 3 sum:** ~1 week. Schema v35. New: FModifier stack, six modifier
types, modifier UI, exporter bake passes. Closes: 1 grievance (no
FModifiers).

---

### Phase 4 — NLA stack (1.5 weeks, schema v35)

**Goal.** Multi-action composition with blend modes, time remapping,
and tweak-mode push.

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
  Blender DNA_anim_enums.h:553-587 (`eAnimData_Flag`).
- AnimData backup pointers (`tmpActionId` / `tmpSlotHandle` /
  `tweakTrackId` / `tweakStripId`) are part of Phase 1's animData
  shape (now expanded above) — Phase 4 wires them.

#### 4.A — Schema v35 (was v36 in v1; renumbered after NodeTree absorption into v33)

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

#### 4.B — NLA evaluator

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

#### 4.C — Tweak mode

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

| Test | What |
|------|------|
| `test_nla_strip_eval.mjs` | strip time remap (start/end/actstart/actend/repeat/scale) |
| `test_nla_blend_replace.mjs` | replace mode + influence ramp |
| `test_nla_blend_add.mjs` | add mode |
| `test_nla_blend_subtract.mjs` | subtract mode |
| `test_nla_blend_multiply.mjs` | multiply mode |
| `test_nla_blend_combine.mjs` | combine on rotation (degenerate to replace) |
| `test_nla_track_solo.mjs` | solo overrides mute |
| `test_nla_extend_hold.mjs` | extend mode hold |
| `test_nla_tweak_mode.mjs` | tweak push → edit → accept |
| `test_nla_bake.mjs` | bakeNLA produces an Action whose evaluation matches the original NLA stack |

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

#### 6.A — Editor architecture

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

### Phase 7 — Insert Keyframe + Keying Sets (3–5 days)

**Goal.** Blender's `I`-key parity: a menu of keying sets, "Only
Insert Needed" mode, granular per-channel keying.

#### 7.A — Keying Set registry

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

#### 7.A — Remove `evalEngine: 'classic'` opt-out

After Phase 0 flipped the default, Phase 7 removes the legacy code
path entirely. [src/renderer/animationEngine.js](../../src/renderer/animationEngine.js)
`computeParamOverrides` / `computePoseOverrides` are deleted; the
DepGraph is the only path.

#### 7.B — Verify `project.animations[]` reader removal

Phase 1 migration deleted the writes; Phase 1.B.1 enumerated and
migrated all 8 known consumers. Phase 7 grep-verifies no reader paths
remain (this is a paranoia gate, not new work — anything that grep
catches here is a Phase 1 bug to fix in retroactive cleanup).

#### 7.C — Deprecate `easing: string` per-segment

Phase 2 migrated to BezTriple but the legacy `easing` field stayed on
keyforms for round-trip safety. Phase 7 removes the field and the
parser branches that handled it.

#### 7.D — `paramValuesStore.values` audit

Many code paths still read directly from `paramValuesStore.values`,
bypassing the FCurve evaluator. Phase 7 audits and replaces with
`evaluateRnaPath(project, 'objects[__params__].values[<paramId>]')`
calls — except for the bone-mirror sync path, which is the canonical
exception.

#### 7.E — Documentation

- Update [docs/V3_WORKSPACES.md](../V3_WORKSPACES.md) animation
  workspace section.
- New: docs/ANIMATION_GLOSSARY.md mapping Blender terms ↔ SS terms ↔
  Cubism Editor terms. Includes the deliberate divergences:
  - SS RNA path uses `.x` component access; Blender uses `[0]`. Same
    semantics, different syntax. The glossary documents the choice;
    `evaluateRnaPath` parses both.
  - JS-subset expression sandbox vs Python (per §9.A).
  - `combine` blend mode deferred (per §2.2).
- New: docs/ANIMATION_AUTHORING_FLOWS.md covering the three primary
  authoring patterns (action assigned to scene, action assigned to
  object, NLA blend).

#### 7.F — Telemetry

Add to [lib/logger.js](../../src/lib/logger.js):
- Per-tick: count of FCurve evaluations, driver evaluations,
  constraint evaluations.
- On Action save: total keyframes per action, average curves per
  action, presence of FModifiers.
- On NLA bake: input strip count, output FCurve count, time taken.

#### 7.G — Memory audit

Update auto-memory entries:
- Mark the Phase 5 scaffolds memory entry as "Wired in Phase 0 of
  Animation Blender Parity Plan".
- Mark the V2 NodeTree memory entry as "Retired in Phase 1 v33
  migration".
- Add new memory entries per phase shipped (one-line index entry +
  topic file).

**Phase 7 sum:** ~3–5 days. No new schema. No new features. Closes:
the rest of the grievances (5 polish-tier).

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
