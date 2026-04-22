# Session 30 Findings — Random Pose dialog rendering (root guid pin + sub-group tree)

**Date:** 2026-04-22. Continues from Session 29's deferred "Random Pose
dialog shows empty checkbox list" task.

**Scope:** make Cubism Editor's _Animation → Playlist corner → Setting…_
dialog render the parameter tree so the user can un-tick params before
running Random Pose. Previously rendered as a blank panel even with
`CRandomPoseSettingManager` fully populated.

**Status at session end:** user confirmed working — dialog now shows
Face / Eye / Eyeball / Brow / Mouth / Body / Hair / Clothing / Bone /
Custom folders with the right params under each.

---

## 1. Dead-end from Session 29

Session 29 emitted a full `CRandomPoseSettingManager` with all params in
`parameters.keys/values` and the root group's `CParameterGroupId` in
`groups.keys`. The parser accepted the block — no ClassNotFoundException,
no `__NotInitialized__` placeholders, file loaded cleanly. But the
dialog stayed blank.

The deferred memory note hypothesized four causes. Only one mattered in
the end; the rest were red herrings.

---

## 2. Fix #1 — Sub-group hierarchy

**Observation:** Hiyori's root `CParameterGroup._childGuids` lists
**CParameterGroupGuid** refs (sub-group guids like `#0`, `#1`, …); each
sub-group's `_childGuids` lists **CParameterGuid** refs (actual params).
Hiyori has 12 sub-groups (Face, Eye, Eyeball, Brow, Mouth, Body, Arm,
Move, Move Hair ×4), giving 13 total entries in the
`CParameterGroupSet._groups` array.

**Our old export:** root `_childGuids` listed all `CParameterGuid` refs
directly — flat hierarchy, zero sub-groups.

**Why the dialog cares:** `x_0.class` (decompiled name
`CRandomPoseRootGroupRow`) iterates `group.getChildren()` — a typed list
that resolves each `CParameterGroupEntryGuid` via `instanceof` to either
a `CParameterSource` or a `CParameterGroup`. The row constructor puts
`CParameterGroup` children under nested `a_0` rows (sub-folders) and
`CParameterSource` children under `v_0` rows (param checkboxes). A
completely flat hierarchy still produces rows, but…

**Fix:** `categorizeParam(id)` in
[src/io/live2d/cmo3writer.js](../../src/io/live2d/cmo3writer.js) maps
each param id to one of ten semantic categories (face / eye / eyeball /
brow / mouth / body / hair / clothing / bone / custom). Each active
category gets a shared `CParameterGroupGuid` + `CParameterGroupId`, an
inline `CParameterGroup` block in `CParameterGroupSet._groups`, and is
listed in `CRandomPoseSetting.groups.keys`. Each `CParameterSource`'s
`parentGroupGuid` points at its sub-group instead of the root.

This was a necessary change but — as it turned out — **not sufficient**.

---

## 3. Fix #2 — The real blocker: root `CParameterGroupGuid` must be a
    specific well-known UUID

After fix #1, the dialog was _still_ empty. Time to stop guessing and
read the Editor source.

### How we got the code

```bash
cp "/c/Program Files/Live2D Cubism 5.0/app/lib/Live2D_Cubism.jar" d:/tmp/cubism_jar/
curl -o d:/tmp/cfr.jar https://www.benf.org/other/cfr/cfr-0.152.jar
java -jar d:/tmp/cfr.jar d:/tmp/cubism_jar/Live2D_Cubism.jar --outputdir d:/tmp/cubism_decomp
```

Dialog package is `com/live2d/cubism/view/palette/parameter/dialog/`.
Grep for `randomPose|CRandomPose`:

- `f_0.java` — dialog controller (`CRandomPoseDialog` in Kotlin metadata)
- `x_0.java` — root-group row (`CRandomPoseRootGroupRow`)
- `a_0.java` — sub-group row
- `v_0.java` — per-parameter row
- `y_0.java`, `K.java`, `aF.java` — interfaces/helpers

### The smoking gun

`f_0.a(CModelSource)` (dialog constructor body), around line 428:

```java
private final void a(CModelSource cModelSource) {
    CRandomPoseSetting cRandomPoseSetting = cModelSource.getRandomPoseSetting().getCurrent();
    if (cRandomPoseSetting == null) return;

    Iterable iterable = cModelSource.getParameterGroupSet().getGroups();
    CParameterGroup root = null;
    for (Object t : iterable) {
        CParameterGroup cpg = (CParameterGroup) t;
        if (!Intrinsics.areEqual(cpg.getGuid(), CParameterGroupGuid.Companion.b())) continue;
        root = cpg;
        break;
    }
    if (root == null) return;  // ← dialog renders empty

    new x_0(cRandomPoseSetting, this.e, root);  // builds the row tree
    …
}
```

The dialog does _not_ use `cModelSource.rootParameterGroup` (the ref
field). It walks `parameterGroupSet.getGroups()` and filters by
**`.getGuid()` equality** against a hardcoded constant.

That constant lives in `com/live2d/type/CParameterGroupGuid.java`:

```java
static {
    ROOT_GROUP = new CParameterGroupGuid(
        new UUID(-1585707974788428574L, -4720816411997149077L));
    ROOT_GROUP.setDebug_instance("Root Parameter Group");
}
```

Converting the two signed longs:

- msb as unsigned hex: `e9fe6eff953b4ce2`
- lsb as unsigned hex: `be7c4a7c3913686b`
- UUID: **`e9fe6eff-953b-4ce2-be7c-4a7c3913686b`**

Hiyori t11's root `CParameterGroupGuid` uses exactly that UUID with note
`"Root Parameter Group"` — confirmed by a direct grep:

```
127281:<CParameterGroupGuid uuid="e9fe6eff-953b-4ce2-be7c-4a7c3913686b"
    note="Root Parameter Group" xs.id="#4679" xs.idx="36278" />
```

Our previous export generated `uuid: uuid()` (a fresh UUID) for that
field. Value comparison failed, the dialog returned early.

### The fix

New constant in [src/io/live2d/cmo3/constants.js](../../src/io/live2d/cmo3/constants.js):

```js
// CParameterGroupGuid.ROOT_GROUP — hardcoded in Editor, compared by UUID
// equality in Random Pose dialog's root lookup (f_0.a(CModelSource)).
export const PARAM_GROUP_ROOT_UUID = 'e9fe6eff-953b-4ce2-be7c-4a7c3913686b';
```

Applied at the single root-guid declaration in
[src/io/live2d/cmo3writer.js](../../src/io/live2d/cmo3writer.js):

```js
const [, pidParamGroupGuid] = x.shared('CParameterGroupGuid', {
  uuid: PARAM_GROUP_ROOT_UUID, note: 'Root Parameter Group',
});
```

Dialog now renders correctly.

---

## 4. Broader takeaway

The Editor uses **UUID-value equality** for several well-known entities:

| Entity                          | UUID                                   | Note |
|---------------------------------|----------------------------------------|------|
| Root deformer (`CDeformerGuid`) | `71fae776-e218-4aee-873e-78e8ac0cb48a` | already pinned; see `DEFORMER_ROOT_UUID` |
| Root parameter group            | `e9fe6eff-953b-4ce2-be7c-4a7c3913686b` | pinned this session |
| Filter def — Layer Selector     | `5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301` | `FILTER_DEF_LAYER_SELECTOR` |
| Filter def — Layer Filter       | `4083cd1f-40ba-4eda-8400-379019d55ed8` | `FILTER_DEF_LAYER_FILTER` |

When a dialog or feature silently fails to render or engage, it's worth
checking whether its entry point filters a collection by `.getGuid()`
equality against a `.Companion.b()`-style accessor. The failing check is
always silent — the early `return` just leaves the UI blank.

---

## 5. Housekeeping in the same session

### Sub-group verification script

Added [scripts/verify_param_groups.mjs](../../scripts/verify_param_groups.mjs)
that:

- Builds a full-rig `generateCmo3` output.
- Unpacks the CAFF → XOR → ZIP deflate-raw pipeline inline.
- Asserts 10 sub-groups + root, all sub-group names, the ROOT_GROUP UUID
  pin, and that no `CParameterSource.parentGroupGuid` still points at
  the root.

Run with `node scripts/verify_param_groups.mjs`. 25/25 assertions
currently pass.

### `inspect_cmo3.mjs` fixes

The inspector had two bugs that made reading Hiyori reference files
impossible:

1. **Wrong int64 mask for negative obf keys.** The script used
   `maskHi = BigInt(obfKey) & 0xFFFFFFFFn` for both halves of the mask,
   but `caffPacker.createInt64Mask` uses `0xFFFFFFFFn` for the upper
   word when `key < 0`. Our own exports have obfKey = 42 (positive) so
   the bug didn't affect them — Hiyori has obfKey = -0x30b220c4
   (negative), so its file table decoded to garbage `startPos` values,
   giving a zero-length `main.xml` slice.
2. **Streaming zip layout with trailing data descriptor.** Our packer
   writes a complete zip (local header + compressed data + central dir
   + EOCD) with `compSize` set in the local header. Cubism Editor
   writes a **streaming** variant: `compSize = 0` + flag bit 3 set +
   a 16-byte data descriptor at the end of the stream, no central dir.
   Switched to `createInflateRaw` so the decompressor tolerates the
   descriptor, and trust the local-header flag bit 3 to find the
   descriptor boundary.

Both fixes in
[scripts/inspect_cmo3.mjs](../../scripts/inspect_cmo3.mjs). The
inspector now reads both our exports and reference Hiyori files.

---

## 6. Files touched

```
docs/live2d-export/SESSION_30_FINDINGS.md              (new)
scripts/verify_param_groups.mjs                         (new)
scripts/inspect_cmo3.mjs                                (int64 mask + zip descriptor)
src/io/live2d/cmo3/constants.js                         (PARAM_GROUP_ROOT_UUID)
src/io/live2d/cmo3writer.js                             (sub-groups + root uuid pin)
```

No schema version change — stays on `CModelSource:14` /
`fileFormatVersion 402030000` (Hiyori layout).
