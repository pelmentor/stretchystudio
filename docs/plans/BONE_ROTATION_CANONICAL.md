# Bone Rotation Canonical — Plan (SUPERSEDED)

**Status:** REJECTED 2026-05-08 by user. Superseded by [BONE_ARMATURE_INDEPENDENCE.md](BONE_ARMATURE_INDEPENDENCE.md), shipped same day.
**Drafted:** 2026-05-06 · **Owner:** pelmentor

## Why superseded

This plan proposed a **mirror** between `bone.pose.rotation` and `paramValues.ParamRotation_<bone>` — write to one, the other auto-syncs, single source of truth via `paramValuesStore` interceptor. The user explicitly rejected that direction 2026-05-08:

> "I don't want when you rotate arm bones it just activates param baked arm rotation, I want bones to ACT LIKE BONES, no hacky drivers to params, and I want for example arm rotate params and arm bone rotation to COEXIST like BLENDER STYLE."

A mirror is still a driver — bone gesture would write to the param, the param would still drive baked keyforms. From the user's perspective, dragging a bone would still feel like dragging a slider via remote control.

The shipped design (BONE_ARMATURE_INDEPENDENCE) instead treats bone gesture and `ParamRotation_<bone>` slider as **independent control surfaces** that compose at render time — Blender's Armature modifier on top of shape keys. Bone gesture writes `node.pose.rotation` only; slider writes `paramValues` only; both compose visually. No mirroring, no fan-out, no cross-pollution.

---

## Original plan below (preserved for record)



## Problem

After Init Rig, dragging a limb-bone's arc in Pose Mode does NOT rotate the bone — it writes to `paramValues[ParamRotation_<bone>]`. The bone's `pose.rotation` stays at 0. Visually, mesh deforms because chainEval reads the param. But the bone authoring model is a fiction:

1. **`applyPoseAsRest` is broken** for these bones. Step 1 of the bake skips identity matrices (line 706-710 of [projectStore.js](../../src/store/projectStore.js)). Param-driven bones have identity (`pose.rotation=0`), so they're skipped — no vertex bake. Then step 3 zeroes `pose` (already zero → no-op). The param value is **left untouched** at e.g. 15°. After bake, the rotation deformer keeps applying 15°, but rest verts didn't move. Result: pieces (neck especially) end up in wrong places.
2. **Pose Mode arc-drag is a bait-and-switch.** User thinks they're rotating a bone; they're actually moving a slider. Doesn't match Blender, doesn't match the rest/pose split mental model we shipped 2026-05-05.
3. **Edit Mode entry confusion** is downstream — once arc-drag actually rotates the bone, the user has clearer feedback that bones are real, and the "no edit mode for this selection" toast is the only remaining UX gap (separate fix).

## Constraint

Cubism's data model **requires** `.moc3`/`.cmo3` to have:
- Parameters that drive deformers
- Rotation deformer keyforms keyed at specific param values
- Animation tracks keyframed against params

So at the **export boundary**, params are non-negotiable. Inside the app, the source of truth can be whatever we want — as long as we translate at the boundary.

## Design: bone is canonical, `ParamRotation_<bone>` is a mirror

Single source of truth for limb-bone rotation: `bone.pose.rotation`.
`paramValues[ParamRotation_<bone>]` is a **mirror** — kept in sync automatically on every write.

### Scope

Bone-mirror params are **only** the per-bone `ParamRotation_<sanitised(boneName)>` params that auto-rig generates for skinned limb bones (paramSpec.js section 5: `seenBones` loop, lines 270-298). Specifically:
- ✓ Mirrored: `ParamRotation_leftElbow`, `ParamRotation_rightElbow`, `ParamRotation_leftWrist`, `ParamRotation_rightWrist`, `ParamRotation_leftKnee`, `ParamRotation_rightKnee`, `ParamRotation_leftAnkle`, `ParamRotation_rightAnkle`, etc. (one per bone with skinning data).
- ✗ NOT mirrored: `ParamAngleZ`, `ParamBodyAngleZ`, `ParamEyeBallX`, `Param<Suffix>`, etc. — these are real shared standard params with their own UX (head tilt slider, etc.).
- ✗ NOT mirrored: `ParamRotation_<group>` for non-bone groups (paramSpec.js section 6: `for (const g of groups)` loop, lines 300-329) — these drive non-skeletal rotation deformers (front_hair, etc.) and have no bone counterpart.

### Behaviour contract

For every bone-mirror param `ParamRotation_<bone>`:

| Operation | Behaviour |
|---|---|
| `setParamValue(id, v)` | If `id` is bone-mirror: writes BOTH `paramValues.values[id] = v` AND `bone.pose.rotation = v` (single atomic update). |
| `paramValues.values[id]` (read) | Always reflects current truth. |
| Direct mutation of `bone.pose.rotation` (e.g., applyPoseAsRest, load) | Caller is responsible for calling `paramValuesStore.syncFromProject()` afterward, which re-reads bones into the mirror map. |
| Save format | `paramValues` slot saved as today; `bone.pose.rotation` saved as today. On load, sync bone → mirror once. |
| Animation tracks | Target `ParamRotation_<bone>` as today. On eval, sets value via `setParamValue` → fans out to bone. **No track-type change.** |
| Export (cmo3 / moc3 / motion3 / can3) | Reads `paramValues.values[id]` as today. Emits same params + keyforms + animation curves. **Byte-identical output.** |

### Why the intercept design (and not a full Option C)

| Option | Cost | Breakage risk |
|---|---|---|
| **A. Intercept (this plan)** | `paramValuesStore` getter/setter + tiny migration; ~3 files. | Minimal — chainEval, export, animations, motion3 untouched. |
| B. Two-way sync via subscriber | Adds projectStore subscription; risk of feedback loops. | Medium — debugging async sync is annoying. |
| C. Eliminate param at runtime | chainEval refactor, art-mesh keyform binding rewrite, animation track migration, motion3 generator rewrite. | High — many consumers, many tests, export translation step. |

We pick A. The "mirror" is not a crutch — it's a boundary translation between the in-app authoring model (bones rotate) and Cubism's wire format (params drive deformers). Same pattern as Blender's bone matrices ↔ FBX export.

## Implementation phases

### Phase 1: paramValuesStore intercept

[`src/store/paramValuesStore.js`](../../src/store/paramValuesStore.js):

```js
// New private state
boneMirror: {
  byParam: new Map(),  // paramId → boneId
  byBone:  new Map(),  // boneId  → paramId
},

// New action
setBoneMirrorRegistry: (entries) => {
  // entries: Array<{ paramId, boneId }>
  // Replaces the registry atomically (called after Init Rig).
},

// Modified setParamValue: fan out to bone.pose
setParamValue: (id, value) => {
  const state = get();
  const boneId = state.boneMirror.byParam.get(id);
  if (boneId) {
    // Write through to bone first; updateProject is the canonical path.
    useProjectStore.getState().updateProject((proj) => {
      const bone = proj.nodes.find(n => n.id === boneId);
      if (!bone) return;
      if (!bone.pose) bone.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
      bone.pose.rotation = value;
    }, { skipHistory: true });
    // Mirror in values for read consistency
    set(s => ({ values: { ...s.values, [id]: value } }));
    return;
  }
  // Existing path
  set(s => ({ values: { ...s.values, [id]: value } }));
},

// Same fan-out for setMany
setMany: (updates) => { /* iterate, fan out each */ },

// New action: re-sync mirror values from bone state
syncFromProject: () => {
  const state = get();
  const proj = useProjectStore.getState().project;
  const next = { ...state.values };
  let dirty = false;
  for (const [boneId, paramId] of state.boneMirror.byBone) {
    const bone = proj.nodes.find(n => n.id === boneId);
    const r = bone?.pose?.rotation ?? 0;
    if (next[paramId] !== r) { next[paramId] = r; dirty = true; }
  }
  if (dirty) set({ values: next });
},
```

### Phase 2: register the mirror after Init Rig

[`src/io/live2d/rig/initRig.js`](../../src/io/live2d/rig/initRig.js) — at the end of the rig pass (after `paramSpec` runs and `project.parameters` is populated):

```js
// Build bone-mirror registry: every ParamRotation_<bone> whose
// corresponding bone has skinning data (jointBoneId in some mesh).
const entries = [];
for (const m of meshes) {
  if (!m?.jointBoneId || !m?.boneWeights) continue;
  const boneGroup = nodes.find(n => n.id === m.jointBoneId);
  if (!boneGroup) continue;
  const boneName = sanitisePartName(boneGroup.name || m.jointBoneId);
  const paramId = `ParamRotation_${boneName}`;
  if (project.parameters.some(p => p.id === paramId)) {
    entries.push({ paramId, boneId: m.jointBoneId });
  }
}
useParamValuesStore.getState().setBoneMirrorRegistry(entries);
```

(Dedupe by boneId — multiple meshes can reference the same bone.)

### Phase 3: applyPoseAsRest sync

[`src/store/projectStore.js`](../../src/store/projectStore.js): after the existing applyPoseAsRest body, call:

```js
useParamValuesStore.getState().syncFromProject();
```

This zeroes mirror values for any bone whose pose was just zeroed. Symmetric: bone is the truth, mirror reflects it.

### Phase 4: load-time migration

When a `.stretch` project loads, paramValues comes back from save as it was — bone-mirror params may have non-zero values, but `bone.pose.rotation` may be 0 (saved with the old code). Reconcile in **this direction**: copy mirror values → bones (one-shot), then re-sync to settle.

[`src/io/projectFile.js`](../../src/io/projectFile.js) `loadProject`, after `setBoneMirrorRegistry` runs:

```js
// Bridge: pre-canonical projects stored rotation in paramValues only.
// Copy those values into bone.pose.rotation so subsequent applyPoseAsRest
// + arc-drag see the truth. Idempotent.
const mirror = useParamValuesStore.getState().boneMirror;
useProjectStore.getState().updateProject((proj) => {
  for (const [paramId, boneId] of mirror.byParam) {
    const v = paramValuesAtLoad[paramId];
    if (typeof v !== 'number' || v === 0) continue;
    const bone = proj.nodes.find(n => n.id === boneId);
    if (!bone) continue;
    if (!bone.pose) bone.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    if (bone.pose.rotation === 0) bone.pose.rotation = v;
  }
}, { skipHistory: true });
```

No schema bump — bone.pose.rotation already exists in v17.

### Phase 5: tests

[`scripts/test/test_boneRotationCanonical.mjs`](../../scripts/test/test_boneRotationCanonical.mjs):

1. Build a tiny project with one bone + one ParamRotation param + registry entry.
2. `setParamValue('ParamRotation_leftElbow', 15)` → assert `paramValues.values['ParamRotation_leftElbow'] === 15` AND `bone.pose.rotation === 15`.
3. Direct write `bone.pose.rotation = 30` then `syncFromProject()` → assert `paramValues.values[...] === 30`.
4. `applyPoseAsRest()` → assert bone.pose.rotation === 0 AND paramValues.values[...] === 0.
5. Smoke: load → save → reload (round-trip) preserves equality.

### Phase 6: export smoke

Run `verify_full_import_to_rigspec.mjs` against shelby fixture. Then a small inline test:

1. Load shelby.cmo3.
2. Init Rig.
3. `setParamValue('ParamRotation_leftElbow', 15)`.
4. Generate cmo3 → check the emitted `<CParameterSource>` for ParamRotation_leftElbow has `value="15"`.
5. Generate moc3 → check the moc3 inspector reports the same value at the keyform binding.

Byte-diff against pre-refactor cmo3 from the same input: should match exactly (param values are floats; the only shift is HOW we got them, not WHAT we wrote).

## Phase order + estimated time

| Phase | Cost |
|---|---|
| 1. paramValuesStore intercept | 0.5h |
| 2. initRig registry build | 0.5h |
| 3. applyPoseAsRest sync | 5min |
| 4. load-time migration | 0.5h |
| 5. test_boneRotationCanonical | 0.5h |
| 6. export smoke + byte-diff | 0.5h |
| **Total** | **~2.5h** |

## What does NOT change

- chainEval, art mesh keyform binding, rotation deformer eval — read paramValues.values as today.
- moc3writer / cmo3writer / can3writer — read paramValues.values as today; emit identical output.
- motion3.json export, idle motion generator — generate against paramIds as today.
- physics tick — calls `setParamValue` (with intercept fans out to bone, no other diff).
- Animation tracks — track type unchanged (param-targeted).
- SkeletonOverlay arc-drag code — unchanged. The intercept does the work.
- `.stretch` schema — unchanged.

## Open questions

- **Driftless guarantee.** If anyone writes `bone.pose.rotation` directly bypassing setParamValue, the mirror value goes stale until next `syncFromProject()`. Today's only direct writers: `applyPoseAsRest` (we'll add the sync call), the new modal G/R/S writers in pose mode (already write `pose.rotation` — need to check if we need to call sync after), and migration paths. We audit these in Phase 3.

- **Partial bone-mirror state.** What if Init Rig partially completes and only some `ParamRotation_*` params exist? Registry is rebuilt on every Init Rig completion; partial state covered.

- **External param sliders.** The Parameters panel's slider for `ParamRotation_<bone>` is unusual — most users don't touch these directly. Slider write goes through `setParamValue` → fans out to bone. ✓ Slider stays.

- **Race during Init Rig.** Between rig spec build and `setBoneMirrorRegistry`, arc drags would write to paramValues only. Not user-reachable (no UI during Init Rig).

## Cross-references

- Pre-refactor symptoms: user reports 2026-05-06 ("после init rig the arm bones don't actually rotate bones but drive params — это костыль ебаный", "Apply pose as rest pose break character, some pieces like neck get hidden away").
- BVR-004 (Pose/Armature Edit dichotomy) collapsed 2026-05-06 (`9df561f`) — see [WORKSPACES.md](../WORKSPACES.md).
- Rest/pose split (schema v17) shipped 2026-05-05 — see [archive/plans-shipped/REST_POSE_SPLIT.md](../archive/plans-shipped/REST_POSE_SPLIT.md). That work made `bone.pose.rotation` a real slot; this plan uses it.
