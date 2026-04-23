# .cmo3 Format — Cubism Editor 5.0 Project File

> **Status**: JS cmo3writer generates .cmo3 files that open in Cubism Editor 5.0 with textures, draw order, and part hierarchy.
>
> See also: [ARCHITECTURE.md](ARCHITECTURE.md) (texture pipeline, part hierarchy, design decisions) | [README.md](README.md) (index)

---

## File Structure Overview

`.cmo3` is a **CAFF** (Cubism Archive File Format) container — a custom binary archive.

```
[0..4)    Magic: "CAFF" (ASCII)
[4..7)    Archive version: 3 bytes (major.minor.patch)
[7..11)   Format ID: 4 chars ("----" for cmo3)
[11..14)  Format version: 3 bytes
[14..18)  Obfuscate key: int32 BE (XOR key for encrypted entries)
[18..26)  Reserved (8 bytes)
[26..46)  Preview image metadata (format, color, width, height, offset, size)
[46..54)  Reserved (8 bytes)
[54..)    File table: count + entries
[..)      File data: raw or ZIP-compressed, optionally XOR-obfuscated
[-2..)    Guard bytes: [98, 99]
```

All multi-byte integers are **BIG-ENDIAN**. Strings use variable-length integer for size.

### CAFF Binary Encoding

| Type | Encoding | XOR |
|------|----------|-----|
| byte | 1 byte | `value ^ (key & 0xFF)` |
| int16 | 2 bytes BE | `(value_as_int16) ^ (key & 0xFFFF)` |
| int32 | 4 bytes BE | `value ^ key` |
| int64 | 8 bytes BE | `value ^ ((key << 32) \| (key & 0xFFFFFFFF))` |
| string | varint_length + UTF-8 bytes | each component XORed with key |
| varint | 1-4 bytes, high bit = continuation | each byte XORed |
| byte[] | raw bytes | each byte XORed with `key & 0xFF` |

### Compression

Entries can be: `RAW (16)`, `FAST (33)`, or `SMALL (37)`. Compressed entries are stored as **ZIP archives** (not raw deflate) containing a single file named "contents".

### Hiyori Reference

```
File: hiyori_pro_t11.cmo3 (28,873,070 bytes)
Archive: CAFF v0.0.0
Format:  ---- v0.0.0
Obfuscate key: -816980164 (0xCF4DDF3C)
Files: 689 (688 PNGs + 1 main.xml)
Guard bytes: [98, 99]
```

## Contents

A .cmo3 archive contains:
- **688 PNG images** — layer textures (obfuscated, raw)
- **1 main.xml** — complete model definition (obfuscated, ZIP-compressed, ~6MB uncompressed)

The `main.xml` file has tag `"main_xml"` in the CAFF file table.

## main.xml Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?version CArtMeshSource:4?>
<?version CModelSource:14?>
<?version SerializeFormatVersion:2?>
<?import com.live2d.cubism.doc.model...?>  <!-- 76 import statements -->

<root fileFormatVersion="402030000">
  <shared>   <!-- 4694 objects = shared object pool -->
  <main>     <!-- CModelSource = model hierarchy (refs into shared) -->
</root>
```

### Architecture: Shared Object Pool + Model Tree

- **`<shared>`**: Flat list of 4694 objects with unique `xs.id="#N"` identifiers. All entity definitions live here.
- **`<main>`**: `CModelSource` that references objects in shared via `xs.ref="#N"`.

Cross-reference system:
- `xs.id="#N"` — declares object identity (unique, 0-4693)
- `xs.ref="#N"` — reference to another object (25758 total, 0 orphans)
- `xs.n="fieldName"` — names the Java field (340 unique names)
- `xs.idx="N"` — internal serialization index (max 36316)

### `<main>` — CModelSource

```xml
<main>
  <CModelSource isDefaultKeyformLocked="true">
    <CModelGuid xs.n="guid" .../>
    <s xs.n="name">桃瀬ひより_t13</s>
    <CImageCanvas xs.n="canvas">
      <i xs.n="pixelWidth">2976</i>
      <i xs.n="pixelHeight">4175</i>
    </CImageCanvas>
    <CParameterSourceSet xs.n="parameterSourceSet">     <!-- 70 parameters -->
    <CDrawableSourceSet xs.n="drawableSourceSet">        <!-- 140 art meshes -->
    <CDeformerSourceSet xs.n="deformerSourceSet">         <!-- 104 deformers -->
    <CPartSourceSet xs.n="partSourceSet">                 <!-- 27 parts -->
    <CPhysicsSettingsSourceSet xs.n="physicsSettingsSourceSet">
  </CModelSource>
</main>
```

## Entity Types

### Entity Counts (Hiyori)

| XML tag | Count | .moc3 equivalent |
|---------|-------|-----------------|
| CArtMeshSource | 140 | art_mesh (134 in moc3) |
| CWarpDeformerSource | 50 | warp_deformer (50) |
| CRotationDeformerSource | 54 | rotation_deformer (54) |
| CPartSource | 27 | part (24 in moc3) |
| CParameterGuid | 81 | parameter (70) |
| KeyformBindingSource | 346 | keyform_binding |
| KeyformGridSource | 224 | keyform grid |
| CGlueSource | 26 | glue (26) |
| CTextureAtlas | 2 | texture atlas |
| GTexture2D | — | per-mesh texture ref |

### CArtMeshSource — Art Mesh (Drawable)

The primary visual element. Contains mesh geometry, UVs, keyforms, and texture reference.

```xml
<CArtMeshSource xs.id="#1180" xs.idx="6374">
  <ACDrawableSource xs.n="super">
    <ACParameterControllableSource xs.n="super">
      <s xs.n="localName">Butterfly Tie 1</s>
      <b xs.n="isVisible">true</b>
      <b xs.n="isLocked">false</b>
      <CPartGuid xs.n="parentGuid" xs.ref="#1189"/>       <!-- parent Part -->
      <KeyformGridSource xs.n="keyformGridSource" xs.ref="#1177"/>
      <carray_list xs.n="_extensions" count="3">
        <CEditableMeshExtension>
          <GEditableMesh2 xs.n="editableMesh" nextPointUid="26" useDelaunayTriangulation="true">
            <float-array xs.n="point" count="52">...</float-array>        <!-- 26 verts x2 -->
            <short-array xs.n="edge" count="114">...</short-array>        <!-- mesh edges -->
            <int-array xs.n="pointUid" count="26">0 1 2 ... 25</int-array>
          </GEditableMesh2>
        </CEditableMeshExtension>
        <CTextureInputExtension xs.ref="#1181"/>
        <CMeshGeneratorExtension>
          <MeshGenerateSetting xs.n="meshGenerateSetting">
            <i xs.n="polygonDensity">100</i>
            <i xs.n="polygonMargin">20</i>
          </MeshGenerateSetting>
        </CMeshGeneratorExtension>
      </carray_list>
    </ACParameterControllableSource>
    <CDrawableId xs.n="id" idstr="ArtMesh93"/>
    <CDrawableGuid xs.n="guid" xs.ref="#4598"/>
    <CDeformerGuid xs.n="targetDeformerGuid" xs.ref="#1209"/>  <!-- parent deformer -->
    <carray_list xs.n="clipGuidList" count="0"/>
    <b xs.n="invertClippingMask">false</b>
  </ACDrawableSource>

  <int-array xs.n="indices" count="96">3 4 5 3 6 2 ...</int-array>   <!-- triangles -->
  <carray_list xs.n="keyforms" count="3">
    <CArtMeshForm>
      <ACDrawableForm xs.n="super">
        <i xs.n="drawOrder">500</i>
        <f xs.n="opacity">1.0</f>
        <CFloatColor xs.n="multiplyColor" red="1.0" green="1.0" blue="1.0" alpha="1.0"/>
        <CFloatColor xs.n="screenColor" red="0.0" green="0.0" blue="0.0" alpha="1.0"/>
      </ACDrawableForm>
      <float-array xs.n="positions" count="52">...</float-array>  <!-- normalized positions -->
    </CArtMeshForm>
    <!-- ... more keyforms ... -->
  </carray_list>
  <float-array xs.n="positions" count="52">...</float-array>     <!-- pixel-space positions -->
  <float-array xs.n="uvs" count="52">...</float-array>           <!-- UV coordinates -->
  <GTexture2D xs.n="texture" xs.ref="#1188"/>
  <ColorComposition xs.n="colorComposition" v="NORMAL"/>
  <b xs.n="culling">false</b>
</CArtMeshSource>
```

**Key fields:**
- `indices` — flat triangle indices (int-array, count = triangles * 3)
- `positions` (top-level) — vertex positions in **pixel space**
- `uvs` — UV coordinates (float-array, count = vertices * 2)
- `keyforms[].positions` — vertex positions in **normalized space** for each keyform
- `texture` — reference to GTexture2D
- `GEditableMesh2.point` — editable mesh vertices (pixel space)

### CPartSource — Part (Visibility Group)

```xml
<CPartSource xs.id="#4500" xs.idx="35336">
  <ACParameterControllableSource xs.n="super">
    <s xs.n="localName">Root Part</s>
    <b xs.n="isVisible">true</b>
    <b xs.n="isLocked">true</b>
    <null xs.n="parentGuid"/>                             <!-- null = root -->
  </ACParameterControllableSource>
  <CPartGuid xs.n="guid" xs.ref="#4501"/>
  <CPartId xs.n="id" idstr="__RootPart__"/>
  <b xs.n="enableDrawOrderGroup">false</b>
  <i xs.n="defaultOrder_forEditor">500</i>
  <b xs.n="isSketch">false</b>
  <carray_list xs.n="_childGuids" count="17">             <!-- child parts -->
    <CPartGuid xs.ref="#3973"/>
    <!-- ... -->
  </carray_list>
  <CDeformerGuid xs.n="targetDeformerGuid" xs.ref="#4503"/>
  <carray_list xs.n="keyforms" count="1">
    <CPartForm>
      <i xs.n="drawOrder">500</i>
    </CPartForm>
  </carray_list>
</CPartSource>
```

### CWarpDeformerSource — Warp Deformer

```xml
<CWarpDeformerSource xs.id="#3529" xs.idx="29322">
  <ACDeformerSource xs.n="super">
    <ACParameterControllableSource xs.n="super">
      <s xs.n="localName">Skirt Warp</s>
      <CPartGuid xs.n="parentGuid" xs.ref="#1189"/>
      <KeyformGridSource xs.n="keyformGridSource" xs.ref="#3527"/>
    </ACParameterControllableSource>
    <CDeformerGuid xs.n="guid" xs.ref="#4177"/>
    <CDeformerId xs.n="id" idstr="Warp46"/>
    <CDeformerGuid xs.n="targetDeformerGuid" xs.ref="#3536"/>
  </ACDeformerSource>
  <i xs.n="col">5</i>                                     <!-- grid columns -->
  <i xs.n="row">5</i>                                     <!-- grid rows -->
  <b xs.n="isQuadTransform">false</b>
  <carray_list xs.n="keyforms" count="3">
    <CWarpDeformerForm>...</CWarpDeformerForm>
  </carray_list>
</CWarpDeformerSource>
```

### CRotationDeformerSource — Rotation Deformer

```xml
<CRotationDeformerSource xs.id="#3543" xs.idx="29412">
  <ACDeformerSource xs.n="super">
    <s xs.n="localName">Leg L Position</s>
    <CDeformerId xs.n="id" idstr="Rotation17"/>
  </ACDeformerSource>
  <b xs.n="useBoneUi_testImpl">true</b>
  <carray_list xs.n="keyforms" count="3">
    <CRotationDeformerForm angle="-0.7" originX="1659.9995" originY="2199.5068"
                           scale="1.0" isReflectX="false" isReflectY="false">
      <f xs.n="opacity">1.0</f>
    </CRotationDeformerForm>
  </carray_list>
</CRotationDeformerSource>
```

### KeyformBindingSource — Parameter-to-Keyform Binding

Maps parameter values to keyform indices.

```xml
<KeyformBindingSource xs.id="#1179" xs.idx="6382">
  <KeyformGridSource xs.n="_gridSource" xs.ref="#1177"/>
  <CParameterGuid xs.n="parameterGuid" xs.ref="#1178"/>    <!-- which parameter -->
  <array_list xs.n="keys" count="3">                       <!-- parameter stop values -->
    <f>-1.0</f>
    <f>0.0</f>
    <f>1.0</f>
  </array_list>
  <InterpolationType xs.n="interpolationType" v="LINEAR"/>
  <ExtendedInterpolationType xs.n="extendedInterpolationType" v="LINEAR"/>
  <i xs.n="insertPointCount">1</i>
  <f xs.n="extendedInterpolationScale">1.0</f>
  <s xs.n="description">PARAM_RIBON</s>
</KeyformBindingSource>
```

### KeyformGridSource — Keyform Grid

Stores keyforms indexed by parameter values.

```xml
<KeyformGridSource xs.id="#1177" xs.idx="6376">
  <array_list xs.n="keyformsOnGrid" count="3">
    <KeyformOnGrid>
      <KeyformGridAccessKey xs.n="accessKey">
        <array_list xs.n="_keyOnParameterList" count="1">
          <KeyOnParameter>
            <KeyformBindingSource xs.n="binding" xs.ref="#1179"/>
            <i xs.n="keyIndex">0</i>                      <!-- keys[-1.0] -->
          </KeyOnParameter>
        </array_list>
      </KeyformGridAccessKey>
      <CFormGuid xs.n="keyformGuid" xs.ref="#1184"/>       <!-- actual form data -->
    </KeyformOnGrid>
    <!-- keyIndex=1 → keys[0.0], keyIndex=2 → keys[1.0] -->
  </array_list>
  <array_list xs.n="keyformBindings" count="1">
    <KeyformBindingSource xs.ref="#1179"/>
  </array_list>
</KeyformGridSource>
```

#### 2D keyform grids (multi-parameter)

A keyform grid can be driven by MORE than one parameter — `keyformBindings` holds N bindings and each `KeyformOnGrid` carries `count="N"` `KeyOnParameter` entries in its `accessKey`, one per binding. The total grid cell count is the Cartesian product of the bindings' key counts.

Hiyori uses this for body/breast parallax (`PARAM_BUST_Y × PARAM_BODY_ANGLE_X`, 3×3 = 9 cells — see `main.xml` around `xs.id="#1253"`). Our exporter uses the same structure with a 2×2 grid for eye variant compound: `ParamEye{L,R}Open × Param<Suffix>`, 4 unique `CFormGuid` corners. See `cmo3writer.js` around the `hasEyeVariantCompound` branch.

```xml
<KeyformGridSource>
  <array_list xs.n="keyformsOnGrid" count="4">
    <!-- Row-major order: first binding varies FASTEST, second slowest. -->
    <!-- Each corner has a unique CFormGuid (no sharing across cells). -->
    <KeyformOnGrid>
      <KeyformGridAccessKey xs.n="accessKey">
        <array_list xs.n="_keyOnParameterList" count="2">
          <KeyOnParameter>
            <KeyformBindingSource xs.n="binding" xs.ref="#closureBinding"/>
            <i xs.n="keyIndex">0</i>                     <!-- ParamEyeLOpen=0 (closed) -->
          </KeyOnParameter>
          <KeyOnParameter>
            <KeyformBindingSource xs.n="binding" xs.ref="#variantBinding"/>
            <i xs.n="keyIndex">0</i>                     <!-- ParamSmile=0 (neutral) -->
          </KeyOnParameter>
        </array_list>
      </KeyformGridAccessKey>
      <CFormGuid xs.n="keyformGuid" xs.ref="#cornerClosedNeutral"/>
    </KeyformOnGrid>
    <!-- Three more entries: (1,0), (0,1), (1,1) — each with its own CFormGuid -->
  </array_list>
  <array_list xs.n="keyformBindings" count="2">
    <KeyformBindingSource xs.ref="#closureBinding"/>      <!-- keys [0.0, 1.0] -->
    <KeyformBindingSource xs.ref="#variantBinding"/>      <!-- keys [0.0, 1.0] -->
  </array_list>
</KeyformGridSource>
```

Each `KeyformBindingSource` declares its own parameter, keys, interpolation, and description — independent of the other binding. Cubism bilinearly interpolates the geometry+opacity across the grid between param values.

### CTextureAtlas — Texture Atlas

```xml
<CTextureAtlas xs.id="#1067" xs.idx="5823">
  <s xs.n="name">untitled</s>
  <i xs.n="width">2048</i>
  <i xs.n="height">2048</i>
  <CImageResource xs.n="cachedAtlasImage" xs.ref="#1136"/>
  <CTextureAtlasGuid xs.n="guid" xs.ref="#1502"/>
  <carray_list xs.n="modelImages" count="68">
    <ModelImageEntry>
      <CModelImageGuid xs.n="modelImageGuid" xs.ref="#1068"/>
      <CAffine xs.n="atlasLocalToCanvasTransform"
               m00="1.0" m01="0.0" m02="1381.0"
               m10="0.0" m11="1.0" m12="-452.0"/>
      <GTransform2 xs.n="materialLocalToAtlasTransform">
        <GVector2 xs.n="position"><f xs.n="x">33.0</f><f xs.n="y">1396.0</f></GVector2>
        <GVector2 xs.n="scale"><f xs.n="x">1.0</f><f xs.n="y">1.0</f></GVector2>
        <f xs.n="eulerAngle">0.0</f>
      </GTransform2>
    </ModelImageEntry>
  </carray_list>
</CTextureAtlas>
```

### GTexture2D — Texture Reference

```xml
<GTexture2D xs.id="#1188" xs.idx="6447">
  <GTexture xs.n="super">
    <WrapMode xs.n="wrapMode" v="CLAMP_TO_BORDER"/>
    <FilterMode xs.n="filterMode">
      <MinFilter xs.n="minFilter" v="LINEAR_MIPMAP_LINEAR"/>
      <MagFilter xs.n="magFilter" v="LINEAR"/>
    </FilterMode>
    <Anisotropy xs.n="anisotropy" v="ON"/>
  </GTexture>
  <CImageResource xs.n="srcImageResource" xs.ref="#1176"/>
  <i xs.n="mipmapLevel">64</i>
</GTexture2D>
```

## Inheritance Hierarchy

Java class hierarchy (from `xs.n="super"` chains):

```
ACParameterControllableSource
  ├── CPartSource
  ├── ACDeformerSource
  │   ├── CWarpDeformerSource
  │   └── CRotationDeformerSource
  └── ACDrawableSource
      └── CArtMeshSource

ACForm
  ├── CPartForm
  ├── ACDeformerForm
  │   ├── CWarpDeformerForm
  │   └── CRotationDeformerForm
  └── ACDrawableForm
      └── CArtMeshForm
```

## Data Mapping: Stretchy Studio → .cmo3

| Stretchy Studio | .cmo3 entity | Key fields |
|----------------|-------------|-----------|
| Part (with mesh) | CArtMeshSource | positions, uvs, indices, keyforms |
| Group | CPartSource | id, childGuids, keyforms |
| mesh.vertices | `<float-array xs.n="positions">` | pixel-space XY pairs |
| mesh.uvs | `<float-array xs.n="uvs">` | normalized 0-1 |
| mesh.triangles | `<int-array xs.n="indices">` | flat triangle indices |
| Opacity animation | CArtMeshForm.opacity | per-keyform float |
| Canvas size | CImageCanvas.pixelWidth/Height | integer pixels |
| Texture | CImageResource → PNG in CAFF | stored as separate file |
| — (future) | CWarpDeformerSource | col, row, keyforms |
| — (future) | CRotationDeformerSource | angle, origin, scale |

## GUID System

Every entity has a GUID (UUID v4) for persistent identity across exports:
- `CPartGuid`, `CDrawableGuid`, `CDeformerGuid`, `CParameterGuid`
- `CFormGuid` (per keyform), `CTextureAtlasGuid`, `CModelGuid`
- `CExtensionGuid` (per extension), `GEditableMeshGuid`, `GTextureGuid`

GUIDs have format: `uuid="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" note="debug_info"`

## Processing Instructions

Required at top of main.xml. 10 `<?version?>` + 170 `<?import?>` declarations.
Full list extracted from Hiyori reference — see `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml` lines 1-180.

**Version PIs** (10):
```xml
<?version CArtMeshSource:4?>
<?version KeyformGridSource:1?>
<?version CParameterGroup:3?>
<?version com.live2d.cubism.doc.model.texture.textureAtlas.ModelImageEntry:2?>
<?version SerializeFormatVersion:2?>
<?version CModelSource:14?>
<?version CFloatColor:1?>
<?version CRotationDeformerForm:1?>
<?version CModelImage:3?>
```

**Import PIs**: 170 Java class imports (com.live2d.cubism.doc.model.*, com.live2d.graphics.*, com.live2d.type.*). See reference file for full list.

## CParameterSource — Parameter Definition

Defined inside `<main>` → `CParameterSourceSet`, NOT in `<shared>`.

```xml
<CParameterSource>
  <i xs.n="decimalPlaces">3</i>
  <CParameterGuid xs.n="guid" xs.ref="#1517"/>
  <f xs.n="snapEpsilon">0.001</f>
  <f xs.n="minValue">-30.0</f>
  <f xs.n="maxValue">30.0</f>
  <f xs.n="defaultValue">0.0</f>
  <b xs.n="isRepeat">false</b>
  <CParameterId xs.n="id" idstr="ParamAngleX"/>
  <Type xs.n="paramType" v="NORMAL"/>
  <s xs.n="name">Angle X</s>
  <s xs.n="description">+ causes it to face right side of screen</s>
  <b xs.n="combined">true</b>
  <CParameterGroupGuid xs.n="parentGroupGuid" xs.ref="#0"/>
</CParameterSource>
```

## Well-Known UUIDs

Several entities in a `.cmo3` must use a SPECIFIC hardcoded UUID because
the Editor compares them by value against a `Companion` constant. A
random UUID here is silently accepted at load time but disables the
feature that checks for it.

| Constant                   | UUID                                     | Enforced by                                                                      |
|----------------------------|------------------------------------------|----------------------------------------------------------------------------------|
| `DEFORMER_ROOT_UUID`       | `71fae776-e218-4aee-873e-78e8ac0cb48a`   | `CDeformerGuid.Companion` — root-deformer lookups throughout the rig pipeline    |
| `PARAM_GROUP_ROOT_UUID`    | `e9fe6eff-953b-4ce2-be7c-4a7c3913686b`   | `CParameterGroupGuid.Companion.b()` — **Random Pose Setting dialog** (see below) |
| `FILTER_DEF_LAYER_SELECTOR`| `5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301`   | `StaticFilterDefGuid` — built-in layer-selector filter                           |
| `FILTER_DEF_LAYER_FILTER`  | `4083cd1f-40ba-4eda-8400-379019d55ed8`   | `StaticFilterDefGuid` — built-in layer filter                                    |

All four live in `src/io/live2d/cmo3/constants.js`.

### Why `PARAM_GROUP_ROOT_UUID` matters (Session 30)

The dialog controller `f_0.a(CModelSource)` in
`com/live2d/cubism/view/palette/parameter/dialog/` does:

```java
for (CParameterGroup cpg : cModelSource.getParameterGroupSet().getGroups()) {
    if (!Intrinsics.areEqual(cpg.getGuid(), CParameterGroupGuid.Companion.b())) continue;
    buildDialogFrom(cpg);
    return;
}
// fall through → empty panel
```

The `.Companion.b()` accessor returns a pre-built
`CParameterGroupGuid(new UUID(-1585707974788428574L, -4720816411997149077L))`,
i.e. UUID `e9fe6eff-953b-4ce2-be7c-4a7c3913686b` (Kotlin Java interop —
negative longs are the signed representation of the 64-bit UUID halves).
Hiyori's t11 reference uses exactly that UUID in its root
`CParameterGroupGuid` entity.

## Parameter Group Tree (for Random Pose dialog)

The dialog walks `CParameterGroup.getChildren()` recursively, rendering
each `CParameterGroup` child as a folder row and each `CParameterSource`
child as a checkbox row. A flat root with all params as direct children
(no sub-groups) does NOT crash, but produces a completely blank panel.

Hiyori's tree has:

- Root `CParameterGroup` — guid = `PARAM_GROUP_ROOT_UUID`,
  `_childGuids` = 12 `CParameterGroupGuid` refs (the sub-groups).
- 12 sub-groups: Face, Eye, Eyeball, Brow, Mouth, Body, Arm, Move,
  Move Hair ×4. Each has:
  - Own `CParameterGroupGuid` (fresh UUID — only the root is pinned).
  - `parentGroupGuid` → root's guid.
  - `_childGuids` = `CParameterGuid` refs for member params.
  - Visibility color `(1.0, 0.957, 0.769, 1.0)` (cream).
- Each `CParameterSource.parentGroupGuid` points at its sub-group, NOT
  at the root.

Our exporter categorizes params by id with `categorizeParam()` (face /
eye / eyeball / brow / mouth / body / hair / clothing / bone / custom)
and emits one sub-group per active category. See
`src/io/live2d/cmo3writer.js` around the `CATEGORY_DEFS` block.

## Prior Art

- **D2Evil** (UlyssesWu): `reference/D2Evil/` — C# CAFF reader/writer. Lincubator (moc3→cmo3) closed-source.
- **CAFF format**: Fully implemented in `CaffArchive.cs` — both read and write.
- **CmoLoader**: Handles older `.cmo` format (XOR-encrypted ZIP, different from CAFF).

## Tools

- `docs/live2d-export/scripts/cmo3_decrypt.py` — Python CAFF extractor (extracts main.xml + PNGs)
- Reference extracted to: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`

## CPhysicsSettingsSource — Physics

```xml
<CPhysicsSettingsSource>
  <s xs.n="name">Hair Front</s>
  <CPhysicsSettingId xs.n="id" idstr="PhysicsSetting3"/>
  <carray_list xs.n="inputs" count="4">
    <CPhysicsInput>
      <CParameterGuid xs.n="source" xs.ref="#1517"/>
      <f xs.n="weight">60.0</f>
      <CPhysicsSourceType xs.n="type" v="SRC_TO_X"/>
    </CPhysicsInput>
  </carray_list>
  <carray_list xs.n="outputs" count="1">
    <CPhysicsOutput>
      <CParameterGuid xs.n="destination" xs.ref="#3798"/>
      <i xs.n="vertexIndex">1</i>
      <f xs.n="angleScale">1.522</f>
      <CPhysicsSourceType xs.n="type" v="SRC_TO_G_ANGLE"/>
    </CPhysicsOutput>
  </carray_list>
  <carray_list xs.n="vertices" count="2">
    <CPhysicsVertex>
      <GVector2 xs.n="position"><f xs.n="x">0.0</f><f xs.n="y">0.0</f></GVector2>
      <f xs.n="mobility">1.0</f>
      <f xs.n="delay">1.0</f>
      <f xs.n="acceleration">1.0</f>
      <f xs.n="radius">0.0</f>
    </CPhysicsVertex>
  </carray_list>
</CPhysicsSettingsSource>
```

## CImageResource — Image Storage

PNG files stored as separate entries in CAFF archive, referenced by path.

```xml
<CImageResource width="1187" height="3753" type="INT_ARGB"
                imageFileBuf_size="2007358" previewFileBuf_size="0">
  <file xs.n="imageFileBuf" path="imageFileBuf_3.png"/>
</CImageResource>
```

- `path` references a PNG file in the CAFF archive
- `type="INT_ARGB"` = 32-bit RGBA
- Images are XOR-obfuscated in the CAFF container (raw, not compressed)
- ~110 CImageResource entries, ~688 PNG files total (includes icons, previews)

## CModelInfo — Model Metadata

```xml
<CModelInfo xs.n="modelInfo">
  <f xs.n="pixelsPerUnit">1.0</f>
  <CPoint xs.n="originInPixels">
    <i xs.n="x">0</i>
    <i xs.n="y">0</i>
  </CPoint>
</CModelInfo>
```

**Note**: In .cmo3, `pixelsPerUnit=1.0` and `origin=(0,0)`. The .moc3 export calculates PPU and origin from canvas dimensions. These are editor-space values, not runtime values.

## Version Numbers in `<main>`

```xml
<i xs.n="targetVersionNo">3000</i>                    <!-- target Cubism SDK version -->
<i xs.n="latestVersionOfLastModelerNo">4020000</i>     <!-- last editor version used -->
```

## CoordType — Coordinate System Identifiers

15 instances, two known values:
- `"Basic Coord"` — world/canvas coordinate space
- `"DeformerLocal"` — local deformer coordinate space

## Minimal .cmo3 Requirements (for generator)

Based on analysis, a minimal valid .cmo3 needs:

1. **CAFF container** with obfuscate key, guard bytes
2. **main.xml** with:
   - Processing instructions (10 version + 170 import)
   - `<root fileFormatVersion="402030000">`
   - `<shared>` with: CFormGuid(s), GTexture2D, CImageResource, CPartGuid, CDrawableGuid, KeyformGridSource, CTextureAtlas
   - `<main>` with: CModelSource → canvas, parameterSourceSet, drawableSourceSet, partSourceSet, textureManager
3. **PNG texture files** — layer images referenced by CImageResource

## xs.id / xs.idx System (Java decompile confirmed)

Source: Decompiled `com.live2d.serialize.XmlWriter` and `XmlReader` from `Live2D_Cubism.jar` via CFR.

### xs.id (ATTR_ID)
- **Generated by**: `XmlWriter.getNextRefIdNo()` — auto-increment counter (`refId++`)
- **Format**: `#0`, `#1`, `#2`, ... (strictly sequential, no gaps)
- **Used by Reader**: `XmlReader.readObjectRefs` HashMap — key=xs.id string, value=Java object
- **CRITICAL**: Must be unique. Reader resolves xs.ref by looking up this map.

### xs.idx (ATTR_INDEX)
- **Generated by**: `XmlWriter.writtenIndex++` — separate auto-increment counter
- **NOT USED BY READER** — `XmlReader` never reads xs.idx. It's a write-only artifact.
- **Can be any value** — we can set 0 for all objects, or sequential, or random.

### Shared section sorting
- **Sorted by xs.id (ascending)** before writing to XML
- Confirmed: `XmlWriter.writeRootElement` sorts `sharedList` using comparator `i` which compares `refNo` (= xs.id number)

### Reader tolerance (from `ClassSerializer.setupInstance`)
- **Element order doesn't matter** — Reader iterates children, looks up PropertySet by `xs.n` name
- **Unknown elements ignored** — `if (nameInParentToPropertySetMap.get(string) == null) continue`
- **Missing elements** — field stays at Java default (null/0/false)
- **"super" element** — handled recursively through parent class serializer

This means our generator can:
1. Set xs.idx to any value (e.g., sequential starting from 0)
2. Write child elements in any order
3. Omit optional fields (they default to null/0/false)
4. Include only the fields we need

## Texture Pipeline (full data flow)

```
PSD Documents (CLayeredImage)
  → Layer Hierarchy (CLayerGroup → CLayer)
    → Rasterization (CImageResource = PNG in CAFF)
      → Filter Pipeline (ModelImageFilterSet + FilterInstance/CLayerSelector)
        → CModelImage (rendered composite)
          → Texture Packing (CTextureAtlas + ModelImageEntry)
            → ArtMesh Binding (CTextureInputExtension)
              → CTextureInput_TextureAtlasRegion (UV transform)
```

### CTextureInputExtension (per ArtMesh)
```xml
<CTextureInputExtension xs.id="#1181">
  <ACExtension xs.n="super">
    <CExtensionGuid xs.n="guid" uuid="..."/>
    <CArtMeshSource xs.n="_owner" xs.ref="#1180"/>
  </ACExtension>
  <carray_list xs.n="_textureInputs" count="2">
    <CTextureInput_ModelImage>...</CTextureInput_ModelImage>
    <CTextureInput_TextureAtlasRegion xs.ref="#1183"/>
  </carray_list>
  <CTextureInput_TextureAtlasRegion xs.n="currentTextureInputData" xs.ref="#1183"/>
</CTextureInputExtension>
```

### CTextureInput_TextureAtlasRegion (mesh→atlas binding)
```xml
<CTextureInput_TextureAtlasRegion xs.id="#1183">
  <ACTextureInput xs.n="super">
    <CAffine xs.n="optionalTransformOnCanvas" m00="1.0" m01="0.0" m02="0.0" m10="0.0" m11="1.0" m12="0.0"/>
    <CTextureInputExtension xs.n="_owner" xs.ref="#1181"/>
  </ACTextureInput>
  <CTextureAtlasGuid xs.n="textureAtlasGuid" xs.ref="#1182"/>
  <CAffine xs.n="inputImageLocalToCanvasTransform" m00="1.0" m01="0.0" m02="1422.0" m10="0.0" m11="1.0" m12="-487.0"/>
</CTextureInput_TextureAtlasRegion>
```

### CTextureManager (central hub)
```xml
<CTextureManager>
  <TextureImageGroup xs.n="textureList">        <!-- packed texture bitmaps -->
    <carray_list xs.n="children" count="3">
      <CTextureImage>
        <s xs.n="textureName">untitled</s>
        <CImageResource width="2048" height="2048" type="INT_ARGB" imageFileBuf_size="1394329">
          <file xs.n="imageFileBuf" path="imageFileBuf.png"/>
        </CImageResource>
      </CTextureImage>
    </carray_list>
  </TextureImageGroup>
  <carray_list xs.n="_rawImages" count="2">       <!-- source PSDs -->
  <carray_list xs.n="_modelImageGroups" count="4"> <!-- drawable groups -->
  <carray_list xs.n="_textureAtlases" count="2">   <!-- atlas configs -->
</CTextureManager>
```

## PSD Layer Hierarchy

```xml
<!-- CLayeredImage = PSD document -->
<CLayeredImage xs.id="#12">
  <i xs.n="width">2976</i>
  <i xs.n="height">4175</i>
  <CLayerGroup xs.n="_rootLayer" xs.ref="#14"/>
</CLayeredImage>

<!-- CLayerGroup = folder -->
<CLayerGroup xs.id="#14">
  <s xs.n="name">root</s>
  <carray_list xs.n="_children" count="1">
    <CLayer xs.ref="#16"/>
  </carray_list>
</CLayerGroup>

<!-- CLayer = image layer -->
<CLayer xs.id="#16">
  <s xs.n="name">桃瀬ひより_背景</s>
  <CImageResource xs.n="imageResource" xs.ref="#1041"/>
  <CRect xs.n="boundsOnImageDoc">
    <i xs.n="x">0</i><i xs.n="y">0</i>
    <i xs.n="width">2976</i><i xs.n="height">4175</i>
  </CRect>
</CLayer>
```

## CAFF Binary Writer (complete)

Full binary layout (big-endian, XOR obfuscation):

```
0x00  4B  "CAFF"                          (not obfuscated)
0x04  3B  ArchiveVersion [0,0,0]          (not obfuscated)
0x07  4B  FormatIdentifier "----"         (not obfuscated)
0x0B  3B  FormatVersion [0,0,0]           (not obfuscated)
0x0E  4B  ObfuscateKey (int32)            (not obfuscated, can be 0)
0x12  8B  padding (zeros)
0x1A  1B  PreviewImageFormat (127=NONE)   (not obfuscated)
0x1B  1B  PreviewColorType (127=NONE)     (not obfuscated)
0x1C  2B  padding
0x1E  2B  PreviewWidth (int16)
0x20  2B  PreviewHeight (int16)
0x22  8B  PreviewStartPosition (int64)    (patched later)
0x2A  4B  PreviewFileSize (int32)
0x2E  8B  padding
0x36  4B  FileCount (int32)               (OBFUSCATED)

[FOR EACH FILE]
      var  FilePath (string: varint + UTF-8)  (OBFUSCATED)
      var  Tag (string)                       (OBFUSCATED)
      8B   StartPosition placeholder          (OBFUSCATED, patched later)
      4B   StoredSize (int32)                 (OBFUSCATED)
      1B   IsObfuscated (bool)                (OBFUSCATED)
      1B   CompressOption (16=RAW,33=FAST,37=SMALL)  (OBFUSCATED)
      8B   padding                            (OBFUSCATED)

[FILE DATA - in entry order]
      var  stored bytes                       (obfuscated if entry.IsObfuscated)

[GUARD]
      1B   98                                 (not obfuscated)
      1B   99                                 (not obfuscated)

[PATCHING PHASE - seek back to each StartPosition placeholder, write actual offset]
```

Compressed entries wrap content in a ZIP archive with single entry named "contents".

## Minimal .cmo3 Requirements

For Cubism Editor 5.0 to open our file, we need AT MINIMUM:

### Required in CAFF:
- main.xml (tag="main_xml", compressed)
- 1+ PNG files (layer textures)

### Required in main.xml `<shared>`:
- CFormGuid (1 per keyform)
- CPartGuid, CDrawableGuid, CDeformerGuid (identity refs)
- CParameterGuid (parameter refs)
- KeyformGridSource (keyform storage)
- CTextureAtlas + CTextureAtlasGuid (atlas config)
- GTexture2D (per-mesh texture)
- CImageResource (image data refs)
- CBlend_Normal (blend mode)
- CoordType (coordinate systems)
- CModelImageGuid (image identity)
- ModelImageFilterSet + FilterInstance (filter pipeline — may be simplifiable)
- CLayeredImage + CLayerGroup + CLayer (PSD hierarchy)

### Required in main.xml `<main>`:
- CModelSource with:
  - CImageCanvas (width, height)
  - CParameterSourceSet (parameters)
  - CDrawableSourceSet (art meshes)
  - CPartSourceSet (parts)
  - CTextureManager (textures)
  - CModelInfo (PPU, origin)

### Possibly optional:
- CPhysicsSettingsSourceSet (no physics = skip)
- CDeformerSourceSet (no deformers = skip)
- CAffecterSourceSet/CGlueSource (no glue = skip)
- Filter pipeline (might be reducible to minimal stub)
- Icons (icon16, icon32, icon64)
- CGameMotionSet, ModelViewerSetting, CGuidesSetting

## Working ArtMesh Texture Pipeline (from Untitled Model reference)

**Reference**: `reference/live2d-sample/untitled_with_mesh/main.xml` — Cubism Editor 5.0 with imported PSD (20 ArtMeshes).

### The Complete Chain

Every visible ArtMesh requires this FULL pipeline:

```
CLayeredImage (PSD document, xs.id=#1)
  → CLayerGroup (root folder)
    → CLayer (individual PSD layer, e.g. "eyebrow-r")

CModelImage (one per visible layer)
  → guid: CModelImageGuid
  → inputFilter: ModelImageFilterSet (filter graph selecting PSD layer)
  → inputFilterEnv: ModelImageFilterEnv
    → CLayerSelectorMap (picks which CLayer from which CLayeredImage)
  → _filteredImage: CImageResource (rasterized PNG output)
  → _materialLocalToCanvasTransform: CAffine (position on canvas)
  → cachedImageManager: CCachedImageManager
    → rawImage: CImageResource (same as _filteredImage)

CArtMeshSource (the mesh)
  → _extensions[]:
    → CEditableMeshExtension (vertex data, edges)
    → CTextureInputExtension
      → _textureInputs[]: CTextureInput_ModelImage
        → _modelImageGuid: CModelImageGuid → (links to CModelImage above)
      → currentTextureInputData: (same CTextureInput_ModelImage)
    → CMeshGeneratorExtension (auto-mesh settings)
  → indices: triangle indices
  → positions: pixel-space vertices
  → uvs: normalized UVs
  → keyforms[]: CArtMeshForm (per-keyform positions)
  → texture: GTexture2D (GPU texture settings)
```

### Filter Pipeline (ModelImageFilterSet)

Each CModelImage requires a filter graph to select and render PSD layers:

```xml
<CModelImage modelImageVersion="0">
  <CModelImageGuid xs.n="guid" xs.ref="#207"/>
  <s xs.n="name">eyebrow-r</s>
  <ModelImageFilterSet xs.n="inputFilter" xs.ref="#48"/>
  <ModelImageFilterEnv xs.n="inputFilterEnv">
    <hash_map xs.n="envValues" count="2">
      <!-- Entry 1: which PSD document -->
      <entry>
        <FilterValueId xs.n="key" xs.ref="#53"/>
        <EnvValueSet xs.n="value">
          <CLayeredImageGuid xs.n="value" xs.ref="#44"/>  <!-- PSD ref -->
        </EnvValueSet>
      </entry>
      <!-- Entry 2: which layer in that PSD -->
      <entry>
        <FilterValueId xs.n="key" xs.ref="#51"/>
        <EnvValueSet xs.n="value">
          <CLayerSelectorMap xs.n="value">
            <linked_map xs.n="_imageToLayerInput" count="1">
              <entry>
                <CLayeredImageGuid xs.n="key" xs.ref="#44"/>
                <array_list xs.n="value" count="1">
                  <CLayerInputData>
                    <CLayer xs.n="layer" xs.ref="#24"/>  <!-- specific PSD layer -->
                    <CAffine xs.n="affine" m00="1.0" m01="0.0" m02="0.0" m10="0.0" m11="1.0" m12="0.0"/>
                  </CLayerInputData>
                </array_list>
              </entry>
            </linked_map>
          </CLayerSelectorMap>
        </EnvValueSet>
      </entry>
    </hash_map>
  </ModelImageFilterEnv>
  <CImageResource xs.n="_filteredImage" xs.ref="#58"/>
  <CAffine xs.n="_materialLocalToCanvasTransform" m00="1.0" m01="0.0" m02="626.0" m10="0.0" m11="1.0" m12="92.0"/>
  <CModelImageGroup xs.n="_group" xs.ref="#59"/>
  <CCachedImageManager xs.n="cachedImageManager">
    <CImageResource xs.n="rawImage" xs.ref="#58"/>
  </CCachedImageManager>
</CModelImage>
```

### CTextureManager (in `<main>`)

```xml
<CTextureManager xs.n="textureManager">
  <TextureImageGroup xs.n="textureList">
    <carray_list xs.n="children" count="0"/>     <!-- empty in ModelImage mode -->
  </TextureImageGroup>
  <carray_list xs.n="_rawImages" count="1">
    <LayeredImageWrapper>
      <CLayeredImage xs.n="image" xs.ref="#1"/>   <!-- source PSD -->
    </LayeredImageWrapper>
  </carray_list>
  <carray_list xs.n="_modelImageGroups" count="1">
    <CModelImageGroup xs.ref="#59"/>              <!-- all CModelImages -->
  </carray_list>
  <carray_list xs.n="_textureAtlases" count="0"/> <!-- empty in ModelImage mode -->
  <b xs.n="isTextureInputModelImageMode">true</b> <!-- KEY FLAG -->
</CTextureManager>
```

### Entity Counts (20-mesh reference)

| Entity | Count | Role |
|--------|-------|------|
| CArtMeshSource | 20 | Mesh geometry |
| CModelImage | 20 | Layer→rendered image (1 per mesh) |
| CTextureInputExtension | 20 | Mesh→texture binding (1 per mesh) |
| CTextureInput_ModelImage | 20 | Texture source ref (1 per mesh) |
| CImageResource | 20+ | PNG buffers for rendered layers |
| ModelImageFilterSet | shared | Filter graph (can be shared) |
| CLayeredImage | 1 | Source PSD document |
| CLayer | 20+ | Individual PSD layers |
| CTextureAtlas | 0 | Not used in ModelImage mode |

### What Our Generator Is Missing

Current generator creates CArtMeshSource with texture refs but lacks:

1. **CModelImage** — the entire layer→rendered image object with filter env
2. **CLayeredImage + CLayerGroup + CLayer** — PSD layer hierarchy
3. **ModelImageFilterSet + FilterInstance + FilterValue + FilterValueId** — filter graph
4. **CModelImageGroup** — grouping for texture manager
5. **CCachedImageManager** — image caching
6. **`isTextureInputModelImageMode = true`** — key flag in CTextureManager

The "recovered" status in Cubism Editor means it found a mesh referencing a CModelImageGuid that doesn't resolve to any CModelImage — so it recovered the mesh without texture.

## Java Serializer RE (from decompiled Live2D_Cubism.jar)

Decompiled via CFR from `C:\Program Files\Live2D Cubism 5.0\app\lib\Live2D_Cubism.jar`.

Key classes in `com.live2d.serialize`:
- **SerializeDef**: Constants — `ATTR_ID="xs.id"`, `ATTR_REF="xs.ref"`, `ATTR_NAME="xs.n"`, `ATTR_INDEX="xs.idx"`
- **XmlWriter**: Generates XML with auto-increment `refId` (xs.id) and `writtenIndex` (xs.idx), sorts shared by refNo
- **XmlReader**: Resolves `xs.ref` via HashMap lookup on `xs.id`. **Does NOT read xs.idx.** Iterates children and matches by `xs.n` name — **element order doesn't matter, missing elements get defaults, unknown elements ignored.**
- **ClassSerializer**: Uses PropertySet list for write order, nameInParentToPropertySetMap for read (HashMap lookup by name)

### Implications for Generator
- xs.idx: any value (not validated)
- xs.id: must be unique, `#N` format
- Child element order: doesn't matter
- Missing fields: get Java defaults (null/0/false)
- Extra fields: silently ignored

## Session 3 Findings — Deserialization Validation

Session 3 goal was to fix "recovered" status. The root cause was NOT the texture pipeline
(which was actually correct) — it was multiple deserialization issues found through Java
decompilation of `Live2D_Cubism.jar` and log analysis.

### How "recovered" Works (from decompiled code)

`CModelSource.verify()` recursively walks the Part hierarchy starting from `rootPart`,
using `_childGuids` to find all children. Drawables NOT found in this walk get
`" (recovered)"` appended to their name and are re-parented to root.

```java
// CModelSource.java line ~1648
HashMap object4 = new HashMap();
object4.put(rootPart.getGuid(), rootPart);
verify_exe$local_rec_verify(this, object4, rootPart);

// For each drawable not in object4:
drawable.setLocalName(drawable.getLocalName() + " (recovered)");
rootPart.addChild(drawable, 0);
```

### Fix 1: LayeredImageWrapper (ClassCastException)

`CTextureManager._rawImages` expects `LayeredImageWrapper` objects, NOT raw `CLayeredImage`.

```xml
<!-- WRONG: causes ClassCastException -->
<carray_list xs.n="_rawImages" count="1">
  <CLayeredImage xs.ref="#1" />
</carray_list>

<!-- CORRECT: wrap in LayeredImageWrapper -->
<carray_list xs.n="_rawImages" count="1">
  <LayeredImageWrapper>
    <CLayeredImage xs.n="image" xs.ref="#1" />
    <l xs.n="importedTimeMSec">0</l>
    <l xs.n="lastModifiedTimeMSec">0</l>
    <b xs.n="isReplaced">false</b>
  </LayeredImageWrapper>
</carray_list>
```

### Fix 2: CPartSource Must Be Shared Object

CPartSource needs `xs.id` for self-reference in `_source` and `rootPart`:

```xml
<!-- In <shared>: -->
<CPartSource xs.id="#X" xs.idx="Y">
  ...
  <CPartForm>
    <ACForm>
      <CPartSource xs.n="_source" xs.ref="#X" />  <!-- self-reference -->
    </ACForm>
  </CPartForm>
</CPartSource>

<!-- In <main>: -->
<CPartSourceSet xs.n="partSourceSet">
  <carray_list xs.n="_sources" count="1">
    <CPartSource xs.ref="#X" />
  </carray_list>
</CPartSourceSet>
<CPartSource xs.n="rootPart" xs.ref="#X" />  <!-- references CPartSource, NOT CPartGuid! -->
```

### Fix 3: CDeformerGuid ROOT — Hardcoded UUID

`targetDeformerGuid` is `@NotNull` in Kotlin — cannot be `<null>`.
Must use the well-known ROOT UUID (extracted from static initializer):

```
CDeformerGuid.ROOT = new UUID(8213131368248920814L, -8701384489318959990L)
                   = 71fae776-e218-4aee-873e-78e8ac0cb48a
```

Editor compares by UUID equality. Random UUID → "target deformer not found → skipped".

```xml
<!-- WRONG: null causes NPE (Kotlin @NotNull setter) -->
<null xs.n="targetDeformerGuid" />

<!-- WRONG: random UUID → "not found" → mesh skipped entirely -->
<CDeformerGuid xs.n="targetDeformerGuid" uuid="random-uuid" />

<!-- CORRECT: well-known ROOT constant -->
<CDeformerGuid xs.n="targetDeformerGuid" xs.ref="#deformer_root" />
<!-- where #deformer_root has uuid="71fae776-e218-4aee-873e-78e8ac0cb48a" -->
```

### Fix 4: CPartSource._childGuids Must Include Drawables

The recursive hierarchy walk uses `_childGuids`. Empty list → drawables not found → recovered.

```xml
<!-- WRONG: rootPart doesn't know about any children -->
<carray_list xs.n="_childGuids" count="0" />

<!-- CORRECT: list all child drawable/deformer/part guids -->
<carray_list xs.n="_childGuids" count="1">
  <CDrawableGuid xs.ref="#drawable_guid" />
</carray_list>
```

### Fix 5: CModelSource Version 4

Version PI `CModelSource:14` requires fields we don't generate:
- v5+: `rootParameterGroup` (checkNotNull → NPE)
- v7+: `modelOptions` (checkNotNull → NPE)
- v8+: `gameMotionSet` (checkNotNull → NPE)

Solution: use `CModelSource:4` which auto-creates parameterGroupSet via `setup()+resetGroup()`.

### Fix 6: CAffecterSourceSet Required

`CModelSource.deserialize()` always reads `affecterSourceSet` with `checkNotNull`.
Must include even if empty:

```xml
<CAffecterSourceSet xs.n="affecterSourceSet">
  <carray_list xs.n="_sources" count="0" />
</CAffecterSourceSet>
```

### Fix 7: CBlend_Normal Content

Must include `ACBlend` superclass with `displayName`:

```xml
<CBlend_Normal xs.id="#X" xs.idx="Y">
  <ACBlend xs.n="super">
    <s xs.n="displayName">通常</s>
  </ACBlend>
</CBlend_Normal>
```

### Other Well-Known Constants (from Java decompile)

| Constant | UUID | Source |
|----------|------|--------|
| CDeformerGuid.ROOT | `71fae776-e218-4aee-873e-78e8ac0cb48a` | Static init in CDeformerGuid.java |
| StaticFilterDefGuid (CLayerSelector) | `5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301` | Shared in reference XML |
| StaticFilterDefGuid (CLayerFilter) | `4083cd1f-40ba-4eda-8400-379019d55ed8` | Shared in reference XML |

### FilterValueId Constants (shared across all filter graphs)

| idstr | Purpose |
|-------|---------|
| `ilf_outputLayerData` | CLayerSelector output |
| `mi_input_layerInputData` | External input: layer selection data |
| `ilf_inputLayerData` | CLayerSelector internal input |
| `mi_currentImageGuid` | External input: PSD image GUID |
| `ilf_currentImageGuid` | CLayerSelector internal input |
| `mi_output_image` | External output: rendered image |
| `mi_output_transform` | External output: canvas transform |
| `ilf_inputLayer` | CLayerFilter input (from CLayerSelector) |
| `ilf_outputImageRes` | CLayerFilter output (inline in FilterValue) |
| `ilf_outputTransform` | CLayerFilter output (inline in FilterValue) |

## Prototype Status

- **CAFF packer**: Working (`scripts/caff_packer.py`)
- **cmo3 generator**: Working (`scripts/cmo3_generate.py`) — **opens in Editor WITHOUT "recovered"**
- **Full texture pipeline**: CLayeredImage → CLayer → CModelImage (filter env) → CImageResource → CTextureInputExtension → CArtMeshSource (MODEL_IMAGE mode)
- **Validated with**: Cubism Editor 5.0.00, clean log (no errors)
- **Next**: Scale to multiple meshes, port to JS, integrate with Stretchy Studio

## TODO

- [x] Extract .cmo3 CAFF container
- [x] Document main.xml structure (shared + main)
- [x] Document all entity types
- [x] Extract processing instructions
- [x] Analyze xs.id/xs.idx via Java decompile
- [x] Document CAFF binary writer layout
- [x] Write CAFF packer (Python)
- [x] Write minimal main.xml generator
- [x] Test in Cubism Editor 5.0 (opens with "recovered")
- [x] Diff with reference to find missing pieces
- [x] Document complete texture pipeline (CModelImage + filter)
- [x] Implement CModelImage + filter pipeline in generator
- [x] Implement CLayeredImage/CLayer PSD hierarchy in generator
- [x] Fix "recovered" — LayeredImageWrapper, CPartSource shared, ROOT deformerGuid
- [x] Fix NPE — CAffecterSourceSet, CModelSource v4
- [x] **Test: open generated .cmo3 WITHOUT "recovered" ✓**
- [x] Scale to multiple meshes with real textures
- [x] Port generator from Python to JavaScript (cmo3writer.js + caffPacker.js)
- [x] Integrate into Stretchy Studio export UI (ExportModal.jsx "Live2D Project")
- [x] Fix JS cmo3writer to use single-PSD pattern (Session 4 finding)
- [x] Test with real Stretchy Studio project data — textures + draw order working
- [x] Draw order from part.draw_order property
- [ ] Test in Ren'Py

## Session 4 Findings — Multi-Mesh Texture Pipeline

### Critical Discovery: One PSD, N Layers

**Problem**: Generator with N separate CLayeredImages (one per mesh) opened in
Editor with geometry visible but **no textures rendered**.

**Root cause**: Cubism Editor expects **one CLayeredImage** ("PSD document")
containing **multiple CLayers** (one per art mesh). The CModelImage filter env
selects which CLayer to render for each mesh via CLayerSelectorMap.

**Reference confirmation** (untitled_with_mesh/main.xml — 20 meshes):
- 1 CLayeredImage (xs.id="#1")
- 1 CLayeredImageGuid (xs.id="#44")
- 1 CLayerGroup with `_children count="20"` (one CLayer per mesh)
- 1 LayerSet with `_layerEntryList count="21"` (group + 20 layers)
- 1 LayeredImageWrapper in `_rawImages`
- CModelImageGroup._linkedRawImageGuids count="1"

**Correct multi-mesh structure**:
```
CLayeredImage (one "PSD")
  ├─ width/height = canvas dimensions
  ├─ CLayeredImageGuid (ONE shared GUID)
  ├─ CLayerGroup (root)
  │   └─ _children: [CLayer_0, CLayer_1, ..., CLayer_N]
  ├─ LayerSet
  │   └─ _layerEntryList: [CLayerGroup, CLayer_0, ..., CLayer_N]
  └─ Each CLayer has:
      ├─ CImageResource (own PNG texture, canvas-sized)
      ├─ boundsOnImageDoc = {0, 0, canvasW, canvasH}
      └─ CLayerIdentifier (unique layerId per mesh)

CTextureManager
  ├─ _rawImages count="1": [LayeredImageWrapper → CLayeredImage]
  └─ _modelImageGroups: [CModelImageGroup]
       ├─ _linkedRawImageGuids count="1": [CLayeredImageGuid]
       └─ _modelImages count="N": [CModelImage_0, ..., CModelImage_N]
            └─ Each CModelImage filter env:
                mi_currentImageGuid → same CLayeredImageGuid
                mi_input_layerInputData → CLayerSelectorMap
                  └─ CLayeredImageGuid → [CLayerInputData → CLayer_i]
```

**Wrong approach** (N CLayeredImages): Each mesh gets its own "PSD" with its own
CLayeredImageGuid. Editor opens without errors but renders no textures because the
filter pipeline can't resolve the per-mesh PSD → layer mapping.

### CImageResource Dimensions

Each CLayer's CImageResource should be **canvas-sized** (canvasW × canvasH), matching
the CLayeredImage dimensions. The texture PNG in CAFF should also be canvas-sized.
This is because the layer represents a "PSD layer" that covers the full canvas.

### Multi-Mesh Python Test

`scripts/cmo3_multi_test.py` — generates 3-mesh .cmo3 (RedMesh, GreenMesh, BlueMesh)
with colored textures at different positions. Confirmed working in Cubism Editor 5.0.

## Session 5 Findings — Part Hierarchy + Parameters (Hiyori RE)

### Part Hierarchy (from Hiyori .cmo3)

Hiyori has **27 CPartSource** entries (1 root + 26 groups). The hierarchy is:

```
Root Part (__RootPart__)
  ├─ _childGuids: 17 × CPartGuid (child groups, NOT drawables!)
  ├─ parentGuid: null
  └─ Each child CPartSource:
      ├─ parentGuid → Root Part's CPartGuid
      ├─ _childGuids: mix of CDeformerGuid + CDrawableGuid
      │   e.g., "Cheek" part has 2 CDeformerGuid + 8 CDrawableGuid
      └─ CPartId idstr: "PartCheek", "PartSketch", etc.
```

**Key difference from untitled_with_mesh**: Hiyori uses nested CPartGuid children
in root, while untitled_with_mesh had flat CDrawableGuid children. Both are valid.

**_childGuids can contain**: CPartGuid (sub-groups), CDeformerGuid (deformers
owned by this part), CDrawableGuid (art meshes in this part).

### Parameters (from Hiyori .cmo3)

70 CParameterSource entries. Standard Live2D parameters:

| idstr | name | min | max | default |
|-------|------|-----|-----|---------|
| ParamAngleX | Angle X | -30 | 30 | 0 |
| ParamAngleY | Angle Y | -30 | 30 | 0 |
| ParamAngleZ | Angle Z | -30 | 30 | 0 |
| ParamEyeLOpen | Eye L Open | 0 | 1.2 | 1 |
| ... | (66 more) | ... | ... | ... |

Each CParameterSource has: decimalPlaces, guid, snapEpsilon, minValue, maxValue,
defaultValue, isRepeat, id (idstr), paramType (NORMAL), name, description,
combined, parentGroupGuid.

### Deformers (from Hiyori .cmo3 — NOT implemented)

104 deformers total: ~55 CWarpDeformerSource + ~49 CRotationDeformerSource.

**CWarpDeformerSource**:
```xml
<CWarpDeformerSource>
  <ACDeformerSource><ACParameterControllableSource>
    <localName>Skirt Warp</localName>
    <parentGuid>CPartGuid ref</parentGuid>  <!-- which part owns it -->
    <keyformGridSource>KeyformGridSource ref</keyformGridSource>
  </ACParameterControllableSource>
  <guid>CDeformerGuid ref</guid>
  <id idstr="Warp46" />
  <targetDeformerGuid>CDeformerGuid ref</targetDeformerGuid>  <!-- parent deformer -->
  </ACDeformerSource>
  <col>5</col><row>5</row>  <!-- grid dimensions -->
  <isQuadTransform>false</isQuadTransform>
  <keyforms count="3">
    <CWarpDeformerForm>
      <positions count="72">...</positions>  <!-- (col+1)*(row+1)*2 floats -->
    </CWarpDeformerForm>
  </keyforms>
</CWarpDeformerSource>
```

**CRotationDeformerSource**:
```xml
<CRotationDeformerSource>
  <!-- Same ACDeformerSource/ACParameterControllableSource hierarchy -->
  <useBoneUi_testImpl>true</useBoneUi_testImpl>
  <keyforms count="3">
    <CRotationDeformerForm angle="-0.7" originX="1659.9995" originY="2199.5068"
      scale="1.0" isReflectX="false" isReflectY="false">
      <!-- ACDeformerForm with opacity, multiplyColor, screenColor, coordType -->
    </CRotationDeformerForm>
  </keyforms>
  <handleLengthOnCanvas>512.71045</handleLengthOnCanvas>
  <circleRadiusOnCanvas>140.0</circleRadiusOnCanvas>
  <baseAngle>0.0</baseAngle>
</CRotationDeformerSource>
```

**Keyform binding for deformers**: Same pattern as art meshes — KeyformBindingSource
with parameterGuid, keys array (float values like -10.0, 0.0, 10.0),
interpolationType=LINEAR. KeyformGridSource maps key indices to CFormGuid refs.

Deformers are NOT exported from Stretchy Studio (no deformer concept).
Users add deformers in Cubism Editor after importing .cmo3.
