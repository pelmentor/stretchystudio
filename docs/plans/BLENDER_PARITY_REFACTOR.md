# Blender Parity Refactor

Status: **DRAFT** — pending user sign-off on scope + phase order
Owner: pelmentor
Started: 2026-05-06
Target: ~3 weeks of focused work (Phases 1–6); Phase 7 scaffold-only

---

## 1. Why

The mode-consolidation work shipped 2026-05-06 (`9df561f`) collapsed Armature
Edit into Pose Mode because the two near-identical UIs were confusing users.
The collapse fixed the symptom but left the underlying architecture half-Blender
and half-SS-original, which keeps producing friction:

- Selecting a bone and pressing the "Edit Mode" affordance is greyed out, with
  a hint that says "select a meshed part" — a non-sequitur for someone who
  intentionally selected a bone.
- `project.nodes` is a flat array where a `part` node is simultaneously its own
  transform, draw-order entry, and mesh container. There is no `Object` vs
  `ObjectData` split. Adding multi-object edit, instancing, or a node graph
  on top of this shape means re-writing every consumer.
- Bones are recognised by `type === 'group' && boneRole`; there is no Armature
  container. Rest vs pose is split at the field level (`node.transform.*` vs
  `node.pose.*`) instead of at the type level the way Blender does
  (`Bone` rest data vs `bPoseChannel` deltas).
- Parameter → deformer is hard-coded inside each deformer's `bindings[]`. There
  is no general-purpose driver graph, so anything more interesting than
  "param value indexes a keyform grid" requires a new sidetable.

The goal of this refactor is to land Blender's data shape — `Object` /
`ObjectData` split, real `Armature` + `Bone` + `PoseBone`, modifier and
constraint stacks, FCurve+Driver — so that the existing pain points get fixed
and the door opens to features that need a real graph (look-at constraints,
IK, node-driven warps, multi-object edit).

The cmo3 / moc3 / can3 export pipeline must remain byte-identical throughout.
This is a refactor of in-memory shape, not of output format.

## 2. Current → target

See agent map (saved separately) for full detail. One-line summary per axis:

| Axis | Current (SS v17) | Target (Blender-shaped) |
|------|------------------|-------------------------|
| Object container | `part` / `group` nodes mix transform + data | `Object` (transform + `dataId`) + `ObjectData` (Mesh / Armature / etc.) |
| Bones | `group` nodes with `boneRole` tag, rest in `transform.*`, pose in `pose.*` | `Armature` data block holds `Bone[]` (rest); `Object.pose.channels[]` holds `PoseBone[]` (deltas) |
| Modes | Global `editorStore.editMode: string` (one slot for the whole app) | Per-object `Object.mode` (bitmask) gated by `mode_compat_test(objectType, mode)` |
| Modifiers | Deformer nodes parented in flat `project.nodes`; eval order walked via parent chain | Ordered `Object.modifiers[]` stack on each object |
| Constraints | None | `Object.constraints[]` + `PoseBone.constraints[]` |
| Drivers | Implicit: deformer's `bindings[].parameterId` indexes a keyform | Explicit `FCurve` with optional `ChannelDriver` (rna_path + variables + expression) |
| Animation | `paramValues` map + per-deformer keyform interpolation | FCurve evaluator drives any RNA-pathed property; deformers become one consumer |

## 3. Non-goals (this refactor)

- Geometry-Nodes-style visual graph editor — Phase 7 is scaffolding only;
  full editor is a follow-up.
- Real Python-expression drivers — we'll use a small JS expression subset
  (the `expression` slot is wired up, but full Python is out of scope).
- Multi-object edit UX (selecting two meshes and editing both at once) —
  the data shape supports it after Phase 2, but the UI cost is large; deferred.
- Sculpt mode, vertex paint, texture paint — `mode_compat_test` will accept
  them as legal values per the `Mesh` type, but the implementations are
  separate features.
- Replacing the moc3 / cmo3 / can3 writers. They consume `project.nodes` →
  `selectRigSpec(project)` → `RigSpec` today. The refactor preserves the
  RigSpec shape as the writer-facing contract; only its inputs change.

## 4. Phase order

Each phase is independently shippable, with a schema bump + migration on entry
and a green test suite + green byte-fidelity sweep on exit. Phases 1–4 can
proceed sequentially; Phases 5 and 7 stack on Phase 4. Phase 6 is polish that
threads through 1–5 as we go.

```
Phase 1 ── Phase 2 ── Phase 3 ── Phase 4 ── Phase 5 ── Phase 7 (scaffold)
                                  └──────── Phase 6 (polish, rolling)
```

### Phase 1 — Object vs ObjectData split (schema v18)

**Why first:** every later phase wants to attach data (modifiers, constraints,
mode) to an Object container that is structurally distinct from its payload.
The `part` / `group` conflation has to go before we can sanely add stacks.

**Scope:**
- New node types: `object`, `mesh`, `armature`. Old `part` becomes `object`
  (with `dataKind: 'mesh'`, `dataId: <mesh node id>`); old `group + boneRole`
  becomes `object` (with `dataKind: 'armature'`); old `group` without boneRole
  stays as a pure container (`object` with `dataKind: 'empty'`, like Blender's
  Empty objects).
- `Mesh` data node owns `vertices / uvs / triangles / edgeIndices /
  weightGroups / blendShapes`.
- `Armature` data node owns `bones: Bone[]` (rest hierarchy: `name / parent /
  arm_head / arm_tail / arm_mat`). Pose data moves to `Object.pose.channels:
  PoseChannel[]` (`{ boneName, loc, rot, scale, channelMatrix }`).
- `Object` keeps `transform`, `draw_order`, `parent`, `visible`, `clip_mask`.
  All payload moves to the linked data node.

**Files touched (sketch):**
- `src/store/projectMigrations.js` — v18 forward + v17 rollback (drop on n+1).
- `src/store/projectStore.js` — schema documentation block, helpers
  (`getObjectData`, `getBoneRest`, `getBonePose`).
- `src/io/live2d/rig/selectRigSpec.js` — input shape changes, output `RigSpec`
  unchanged.
- Every reader of `node.mesh` (~40 call sites per grep) → `getMesh(objectNode)`.
- Every reader of `node.boneRole` → `getArmature(objectNode)?.bones.find(...)`.
- Every writer of `node.transform.pivotX` (bone pivot edits) → writes to
  `Bone.arm_head` in the linked Armature.
- `SkeletonOverlay.jsx`, `Outliner`, `Properties`, `ModePill`, `Tab` operator,
  PsdImportService, all rig stages.

**Migration:**
- Forward: walk v17 nodes, emit two nodes per `part` (object + mesh) and per
  bone-bearing `group` (object + armature). Pose data on the bone group →
  `Object.pose.channels[]`.
- Round-trip: load v17 → migrate to v18 → save → load → must equal `migrate(v17)`.
- Test: every `.stretch` fixture in `scripts/test/fixtures/` round-trips.
- Test: `selectRigSpec(v18 project) === selectRigSpec(migrate(v17 project))`
  byte-equivalent for at least Hiyori, Alexia, Shelby fixtures.

**Exit criteria:**
- `npm test` green.
- `test:cubismFidelity` green (Hiyori cmo3 byte-identical).
- `test:breathFidelity` green (warp synthesis).
- Manual: load Hiyori, Init Rig, export cmo3, diff against current main → zero
  byte delta.

**Estimate:** 4–5 days. The breadth comes from `node.mesh` / `boneRole`
readers; each touch is small but there are many.

---

### Phase 2 — Per-object mode (schema unchanged from Phase 1)

**Why now:** with `Object` distinct from data, mode naturally lives on Object.
This is the smallest phase and unblocks the "Edit Mode for bones is greyed
out" UX problem that triggered this plan.

**Scope:**
- New field: `Object.mode: ObjectMode` (enum bitmask, default `OB_MODE_OBJECT`).
- New module: `src/modes/modeCompat.js` exporting
  `modeCompatTest(dataKind, mode)` — direct port of Blender's
  `object_modes.cc:mode_compat_test`. `mesh` → object/edit/sculpt/vpaint/wpaint/tpaint;
  `armature` → object/edit/pose; `empty` → object only.
- `editorStore.editMode` becomes a derived selector: read the active object's
  `mode` field. Removal of the global slot.
- `ModePill` reads active object's `dataKind` → renders the mode set allowed
  by `modeCompatTest`. Bone selected → Edit Mode and Pose Mode both enabled
  (Edit Mode = bone structure edit, the mode that was collapsed; Pose Mode =
  pose deltas).
- `mode.editToggle` (Tab) routes through `modeCompatTest` instead of the
  hard-coded `if (active.type === 'part') ... else if (active.type === 'group')`.
- Re-introduce `OB_MODE_EDIT` for armature objects = bone-structure edit
  (rest pivot drag, bone parenting, bone rename) — recovered from the
  collapsed armatureEdit mode but on a clean foundation.

**Files touched:**
- `src/store/editorStore.js` — `editMode` becomes `selectActiveMode(state)`;
  setters become `setActiveObjectMode(objectId, mode)`.
- `src/v3/shell/ModePill.jsx` — entire rewrite of `describeSelection` against
  `modeCompatTest`.
- `src/v3/operators/registry.js` — `mode.editToggle` rewrite.
- `src/v3/keymap/default.js` — Tab unchanged, `Ctrl+Tab` adds Pose↔Edit cycle
  for armature objects (Blender parity).

**Migration:**
- v18 schema bump bundles this; existing projects come in with all objects in
  `OB_MODE_OBJECT`.

**Exit criteria:**
- Bone selected + Tab enters Pose Mode (current behaviour preserved).
- Bone selected + Ctrl+Tab cycles into Armature Edit Mode (new — rest-pivot
  drag, no pose write).
- Mesh selected + Tab enters mesh edit (current behaviour preserved).
- Two armatures: editing one stays in Object Mode for the other (multi-object
  data shape proven; UI for it stays single-active for now).

**Estimate:** 1–2 days.

---

### Phase 3 — Modifier stack (schema v19)

**Why now:** the deformer chain currently lives as parent-chain links in the
flat `project.nodes` array. Once we have Objects, modifiers are an ordered list
on each Object — the natural Blender shape. This is also the foundation that
Phase 5 (drivers) and Phase 7 (node graph) build on.

**Scope:**
- New field: `Object.modifiers: ModifierData[]` ordered top-to-bottom in eval
  order. Each modifier has `{ id, type, name, mode, persistentUid, payload }`.
- Modifier types (initial set): `WARP_DEFORMER`, `ROTATION_DEFORMER`,
  `BLEND_SHAPE`, `WEIGHT_GROUP_BIND`. These wrap the existing payloads.
- Migration: walk v18 deformer nodes, find their target object via parent
  chain, push them into that object's `modifiers[]`. Delete the deformer
  nodes from `project.nodes`.
- `selectRigSpec` rewrite: input is `objects[].modifiers[]`; output `RigSpec`
  unchanged.
- `chainEval` rewrite: instead of walking parent chain to compose deformers,
  iterate `object.modifiers[]` in order. Eval cache keys on
  `(objectId, modifierIdx, paramSnapshot)`.

**Files touched:**
- `src/store/projectMigrations.js` — v19 migration.
- `src/io/live2d/rig/selectRigSpec.js` — bigger rewrite than Phase 1.
- `src/io/live2d/runtime/evaluator/chainEval.js` — same.
- `src/store/rigSpecStore.js` — invalidation key changes.
- DeformerTab in Properties panel — re-render against `object.modifiers[]`.

**Migration:**
- Round-trip: every v17 project → v18 → v19 → eval → vertex positions equal
  pre-migration to within 1e-5 (sweep on Hiyori, Alexia, Shelby fixtures).

**Exit criteria:**
- All fidelity tests green.
- Init Rig produces a project whose Object→modifier topology matches
  hand-authored expectation.
- Reordering a modifier in the panel changes evaluation visibly.

**Estimate:** 4–5 days.

---

### Phase 4 — Constraints (schema v20)

**Why now:** with modifier stacks live, constraints are the natural sibling
abstraction (modifiers transform geometry, constraints transform transforms).
Adds primitives the current code can't express.

**Scope:**
- `Object.constraints: ConstraintData[]` and `PoseChannel.constraints:
  ConstraintData[]`.
- Constraint types (initial set): `COPY_LOCATION`, `COPY_ROTATION`,
  `LIMIT_ROTATION`, `TRACK_TO`. IK is deferred (large; needs solver).
- Constraint eval runs after modifier stack on the constrained transform;
  for `PoseChannel`, runs after the pose delta is composed.
- Properties panel gets a Constraints section (parallel to Modifiers).

**Files touched:**
- New: `src/constraints/` directory with one file per constraint type +
  `evaluateConstraint(stack, ctx)`.
- `src/io/live2d/runtime/evaluator/chainEval.js` — call constraints in eval order.
- Properties panel: new ConstraintTab.

**Migration:**
- v20 adds the field as optional. Existing projects load with empty
  constraint stacks. No data conversion needed.

**Exit criteria:**
- TRACK_TO constraint on a head bone aimed at the iris controller produces
  the look-at behaviour that currently requires manual ParamAngle slider drag.
- Byte-fidelity tests still green (constraints are an additive in-memory
  feature; cmo3 export bakes them into Cubism's existing param-driven graph
  if and only if the user opts in via an export setting — default off).

**Estimate:** 2–3 days.

---

### Phase 5 — FCurve + Driver (schema v21)

**Why now:** this is the big one. Replace the implicit "param indexes a
keyform grid" binding with explicit FCurves and ChannelDrivers, the way
Blender does. Once this lands, animation, drivers, and the future node graph
all share one substrate.

**Scope:**
- New node type / data type: `Action` (Blender's name for an animation
  data block). An Action holds `fcurves: FCurve[]`. Each FCurve has
  `{ id, rnaPath, arrayIndex, keyframes[], driver?: ChannelDriver }`.
- `rnaPath` is a string addressing any project property — e.g.,
  `"objects['head'].pose.channels[0].rotation_euler"` or
  `"objects['eyes'].modifiers[0].params['offsetX']"`. Indexed by `arrayIndex`
  for vector-valued properties.
- `ChannelDriver`: `{ type: 'scripted'|'sum'|'min'|'max'|'avg', expression?,
  variables: DriverVar[] }`. Each variable has `{ name, type:
  'singleProp'|'transform'|'rotation', target: { id, rnaPath } }`.
- Animation playback: FCurve evaluator runs at `currentTime`, writes to the
  RNA path. Driver evaluation runs after FCurves (Blender's order) and
  overrides where present.
- Migration: existing per-deformer keyform bindings become FCurves on the
  deformer's host Object (`objects['<id>'].modifiers[<i>].keyformWeight`).
  Existing `paramValues` slider remains the input to the parameter-typed
  Driver variables.
- The Live2D parameter slider model maps cleanly: each `Parameter` becomes
  a property `objects['__params__'].values['ParamAngleZ']` whose changes
  propagate via FCurves whose drivers reference that property.

**Files touched:**
- New: `src/anim/fcurve.js`, `src/anim/driver.js`, `src/anim/rnaPath.js`,
  `src/anim/expression.js` (small JS expression evaluator — safe subset, no
  `eval`).
- `src/store/animationStore.js` — Actions + FCurves replace per-deformer
  keyforms.
- `src/io/live2d/rig/selectRigSpec.js` — driver evaluation feeds modifier
  parameter values.
- `src/io/live2d/runtime/evaluator/chainEval.js` — Driver eval pass before
  modifier eval.
- Animation Editor / Timeline UI — re-render against FCurves.
- All keyform editors (V4 Track 3) — re-write to FCurve view.

**Migration:**
- v21 forward: each deformer keyform binding → FCurve. Each parameter
  default and current value → singleton FCurve at frame 0.
- Round-trip: animation playback against v21 must match v20 frame-for-frame
  on Hiyori + Alexia idle.
- Round-trip: cmo3 export from v21 must be byte-identical to cmo3 export
  from v20 (Cubism doesn't have FCurves; the writer flattens the graph back
  to keyform tables).

**Exit criteria:**
- `test:cubismFidelity` byte-identical.
- A driver scripted as `var0 * 2` on a bone rotation channel works.
- Removing the keyform table from a deformer and reconstructing it via FCurve
  + Driver produces equivalent output.

**Estimate:** 5–7 days. This is the most complex phase by far. Plan to break
it into 5a (Actions + FCurves only, no Drivers) and 5b (Drivers).

---

### Phase 6 — Mode-specific UX polish (rolling)

Threads through Phases 1–5 as features land. Items:

- Outliner shows Object → Object Data hierarchy (Blender's pattern: armature
  object expands to show its bones; mesh object expands to show modifiers,
  shape keys, vertex groups).
- Properties panel: sections become per-tab the way Blender's tabbed N-panel
  does. Each section reads the appropriate data-block slot.
- Armature Edit Mode (the rest-pivot-drag mode that was collapsed) returns
  with a clear distinction from Pose Mode in copy and gestures.
- Lock Object Modes preference covers per-object modes, not just the global
  slot.
- ModePill: dropdown lists modes from `modeCompatTest(activeObject.dataKind)`,
  grouped (Edit / Sculpt / Paint / Pose) the way Blender's header dropdown does.

**Estimate:** 2–3 days total, distributed across Phases 1–5.

---

### Phase 7 — Node graph editor (scaffold only)

**Out of scope for this refactor — scaffolding only.**

Once Phases 3–5 are in, the modifier stack + driver system IS a node graph
in non-visual form. A future Geometry-Nodes-inspired editor would render
that graph visually and let the user edit modifier parameters and driver
expressions through node sockets. This phase reserves space for it:

- Confirm Phase 3 modifier payloads are serialisable as node parameters.
- Confirm Phase 5 driver variables are serialisable as node sockets.
- Document the missing pieces (visual layout, socket types, group nodes).

No code changes in this phase; just an audit and a follow-up design doc.

**Estimate:** 0.5 days.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Schema migration drops fields silently | High | Round-trip test on every fixture; v18→v17 down-migration exists for at least one release |
| `selectRigSpec` regression on edge-case deformer topologies | High | Pin Hiyori + Alexia + Shelby + custom test fixtures; fail CI on >1e-5 vertex divergence |
| cmo3 / moc3 byte fidelity breaks during phase 1 or 3 | Critical | Run `test:cubismFidelity` after every major refactor commit; treat any byte delta as a blocker |
| Mode entry gets re-tangled with workspace policy | Medium | Keep workspaces layout-only (per `docs/WORKSPACES.md`); modes gated solely by `modeCompatTest` |
| FCurve / Driver eval order subtly wrong | Medium | Direct port of Blender's order from `BKE_animsys_evaluate_*` documentation; oracle-test against trivial rig |
| Phase 5 scope creep into full Python expressions | Medium | Hard-cap expression grammar to the JS subset documented in Phase 5; no `eval`, no module access |
| Refactor stalls mid-phase, leaving the codebase in a half-state | Medium | Each phase is independently shippable with a green test suite; never merge a half-phase to main |
| User-authored markers (`_userAuthored`) get clobbered by re-rig after schema change | Low | Audit `merge primitives` (`src/io/live2d/rig/merge/`); add tests pinning userAuthored survival across migration |

## 6. Test gates

Every phase must pass before merging to main:

- `npm test` — full unit suite green.
- `npm run test:cubismFidelity` — Hiyori cmo3 byte-identical.
- `npm run test:breathFidelity` — warp synthesis within 0.1 px of authored.
- Manual: load Hiyori, Init Rig, blink, body-angle slider, idle motion play
  through to end-of-loop, export cmo3 + .can3 + .moc3, all load in Cubism Viewer
  without warnings.
- Manual: load `shelby.cmo3` (the v0.2 regression fixture) — visual sweep
  must match pre-refactor.

Add per-phase tests as appropriate (round-trip migration tests, modifier
re-order tests, driver expression tests).

## 7. What stays the same

- The Live2D export pipeline (cmo3 / moc3 / can3 writers) takes `RigSpec`
  as its contract. RigSpec shape is preserved across all phases.
- Workspaces (Edit / Pose / Animation) stay layout-only; they do not gate
  modes (per `docs/WORKSPACES.md`).
- `editorMode` (`'staging'` vs `'animation'`) stays the orthogonal axis it
  is today — it tells the system whether transforms write rest data or
  animation keyframes, independent of the per-object mode.
- The PSD import wizard, auto-rig, and physics generators continue producing
  the same in-memory shape post-finalize; they target the v18+ schema.
- Hiyori is the canonical reference for cmo3 / can3 byte-fidelity. Alexia
  remains approved for runtime artefacts.

## 8. Open questions

1. **Should `Mesh` and `Armature` be flat node entries or nested under their
   `Object`?** — Blender uses ID blocks (separate datablocks shared by
   reference). For SS we'd lean toward separate nodes referenced by ID
   string, since the flat-array reducer is already comfortable with that
   shape. Confirm before Phase 1.

2. **Multi-object edit support — Phase 6 or later?** — Data shape supports
   it after Phase 2, but the UI is a non-trivial design problem (which
   object's tools win? how do brushes scope?). Default: defer.

3. **Driver expression grammar** — JS subset (today's plan) vs DSL vs
   small-stack VM. Cheapest is JS subset with a parsed AST whitelist; we
   should pick before Phase 5 starts.

4. **Action data block lifetime** — does each animation in `project.animations`
   become an Action, or is there a single Action with multiple "tracks"
   (Blender's NLA system)? Default: one Action per animation, NLA deferred.

5. **Should we expose v17 → v18 as a two-step gate (open → migrate prompt
   → save)?** — Or auto-migrate on load. Default: auto-migrate; keep a
   one-release-old downgrade path so v17-only consumers can still read.

## 9. Decision log

- **2026-05-06 — Phase 1 kickoff.** Open questions locked to plan defaults so
  execution can start:
  - Q1 (Mesh/Armature shape): **flat nodes referenced by ID**, not nested
    sub-objects. Reducer + selectors are already comfortable with that;
    nested would force every consumer through deeper accessors.
  - Q2 (Multi-object edit): **deferred** past Phase 6. Data shape supports
    it after Phase 2; UI is not in scope.
  - Q3 (Driver grammar): **deferred to Phase 5 kickoff** — placeholder is
    JS expression subset with AST whitelist (no `eval`, no module access,
    no global scope).
  - Q4 (Action lifetime): **one Action per animation**; NLA deferred.
  - Q5 (Migration UX): **auto-migrate on load**; v17 reader stays one
    release as a downgrade fallback.
- **2026-05-06 — Phase 1 strategy.** Going compat-helper-first rather than
  big-bang. Add `getMesh(objectNode, project)` / `getArmature(...)` /
  `getBoneRest(...)` / `getBonePose(...)` helpers that read BOTH v17 and v18
  shapes; migrate all ~40 readers commit-by-commit through the helpers; THEN
  flip the schema migration to actually emit the new shape; THEN delete the
  v17 compat branches one release later. Reduces blast radius compared to a
  single mega-commit.
