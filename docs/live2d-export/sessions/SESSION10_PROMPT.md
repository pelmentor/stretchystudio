# Session 10 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай документацию в `docs/live2d-export/`:
- `README.md` — индекс, quick-start, troubleshooting, gotchas
- `PROGRESS.md` — статус проекта (Session 9 .can3 issues)
- `ARCHITECTURE.md` — решения, маппинг данных, warp deformers, **can3 format RE**
- `CMO3_FORMAT.md` — формат .cmo3

## Что сделано (Phase 1-2 COMPLETE + deformers + .can3 WIP)

### Phase 1-2 (.moc3 + .cmo3) — COMPLETE
- Полный pipeline, рендерится в Cubism Viewer 5.0 и Ren'Py
- Rotation deformers, auto-parenting, parameter bindings

### Session 9: .can3 animation + warp deformers
- **XmlBuilder** extracted to shared module (`xmlbuilder.js`)
- **Warp deformers** in cmo3writer (CWarpDeformerSource, 3×3 grid, IDW) — dormant, needs mesh_verts tracks
- **can3writer.js** — .can3 generator (CAFF archive with CAnimation XML)
- **Export pipeline**: ZIP with .cmo3 + .can3 when animations exist
- **.can3 BLOCKED**: deserialization errors in Cubism Editor 5.0

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/xmlbuilder.js` — shared XML builder (XmlBuilder class + uuid)
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (uses xmlbuilder)
- `src/io/live2d/can3writer.js` — .can3 XML generator (WIP — uses xmlbuilder)
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject (ZIP with .cmo3 + .can3)
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json
- `src/io/live2d/motion3json.js` — .motion3.json (rotation + mesh_verts track mapping)
- `src/io/live2d/cdi3json.js` — .cdi3.json
- `src/io/live2d/textureAtlas.js` — atlas packer
- `src/components/export/ExportModal.jsx` — UI (ZIP download when anims exist)

## .can3 Deserialization Errors (ГЛАВНАЯ ПРОБЛЕМА)

Cubism Editor 5.0 fails to load our .can3 with these errors (in order):

### Error 1: CMvEffect_VisualDefault.deserialize NPE
```
[ERROR] error : CMvEffect_VisualDefault instance=...
[ERROR] java.lang.reflect.InvocationTargetException
[ERROR] Caused by: java.lang.NullPointerException
[ERROR]   at CMvEffect_VisualDefault.deserialize(Unknown Source)
```
**Причина**: CMvEffect_VisualDefault has a custom `deserialize()` method that expects specific internal fields. Our VisualDefault has track-level attributes (xy, scalex, scaley, rotate, opacity) but the structure isn't matching what the deserializer expects.

**Что попробовали**: Added CMvAttrPt (xy) + CMvAttrF (scalex, scaley, rotate, opacity) with CFixedSequence values. Still NPE.

**Подход**: Need to decompile `CMvEffect_VisualDefault.class` from Cubism Editor JAR (`C:\Program Files\Live2D Cubism 5.0\app\lib\Live2D_Cubism.jar`) to understand what `deserialize()` expects. Or compare our VisualDefault XML node-by-node with Hiyori's.

### Error 2: ICMvAttr.getTrack lateinit
```
[ERROR] kotlin.UninitializedPropertyAccessException: lateinit property has not been initialized
[ERROR]   at ICMvAttr.getTrack(Unknown Source)
```
**Причина**: CMvAttrF for parameters has `<CMvTrack_Live2DModel_Source xs.n="track" xs.ref="..."/>` but the Kotlin property isn't being set. Maybe the deserialization order matters — the track object must be fully deserialized before attributes reference it.

### Error 3: CMvEffect_Live2DParameter.addAttr NPE (cascading)
```
[ERROR] java.lang.NullPointerException
[ERROR]   at CMvEffect_Live2DParameter.addAttr(Unknown Source)
[ERROR]   at CMvTrack_Live2DModel_Source.resetModel_exe(Unknown Source)
```
**Причина**: Cascades from Error 1/2. Once VisualDefault fails, the model track can't initialize properly, which breaks parameter attribute initialization.

## .can3 Structure Reference (from Hiyori RE)

### Minimal scene structure
```
CSceneSource (exportMotionFile="true")
  sceneName, canvas, guid, tag
  CTrackSourceSet > _sources: [rootTrack, modelTrack]
  rootTrack ref
  CMvMovieInfo (duration in frames, fps, workspace range)
  CAnimation ref (_animation back-ref)
  marker, defaultParameterCurveType=SMOOTH, defaultPartCurveType=STEP
  targetVersion=FOR_SDK
```

### Model track (CMvTrack_Live2DModel_Source)
Contains 5 effects in effectManager:
1. CMvEffect_EyeBlink
2. CMvEffect_LipSync  
3. CMvEffect_Live2DParameter (parameter animation keyframes)
4. CMvEffect_Live2DPartsVisible (part visibility)
5. CMvEffect_VisualDefault (track-level transforms)

Each CMvAttrF has `track` back-reference to the model track.

### Hiyori VisualDefault has 9 attributes
```
xy (CMvAttrPt), scalex, scaley, rotate, opacity, anchor (CMvAttrPt),
frameStep (CMvAttrI), drawOrder (CMvAttrF?), ...
```

### CFixedSequence vs CMutableSequence
- **CFixedSequence**: constant value, only `<d xs.n="value">`. NO ACValueSequence super!
- **CMutableSequence**: animated value, HAS ACValueSequence super with curMin/curMax/keyPts2/etc + CBezierPt array

## .cmo3 Warnings (lower priority)

```
[INFO] recover targetDeformer : part=Root Part , deformer=null
[INFO] recover targetDeformer : part=root , deformer=null
...
```
All parts show this warning. Non-critical (model renders fine). May need to add targetDeformerGuid to CPartSource, or it's just the Editor's recovery for parts that don't have deformers (which is correct — parts don't need deformers, only drawables do).

## Задачи Session 10

### 1. Fix .can3 deserialization (ГЛАВНАЯ ЗАДАЧА)

**Подход A — Decompile + RE**:
1. Extract `CMvEffect_VisualDefault.class` from Cubism Editor JAR
2. Decompile with IDA/jadx/cfr to understand `deserialize()` method
3. Match our XML output to what the deserializer expects

**Подход B — Diff with Hiyori**:
1. Extract our generated .can3 XML and Hiyori's .can3 XML
2. Compare the VisualDefault, model track, and attribute structures node-by-node
3. Find the minimal diff that causes ours to fail
4. Hiyori extracted: `reference/live2d-sample/Hiyori/hiyori_pro_t04_extracted/main.xml`

**Подход C — Minimal .can3**:
1. Take Hiyori's .can3
2. Strip it down to 1 scene, 1 parameter (simplest possible)
3. Repack with our caffPacker
4. Verify it opens in Cubism Editor
5. Gradually replace parts with our generated content to find what breaks

### 2. Fix .cmo3 "recover targetDeformer" warnings (if time)

### 3. Ren'Py validation (deferred from Session 9)

## Координатные системы (КРИТИЧЕСКИ ВАЖНО!)

Same as Session 9 — see ARCHITECTURE.md.

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Cubism Editor JAR (for decompilation): `C:\Program Files\Live2D Cubism 5.0\app\lib\Live2D_Cubism.jar`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Hiyori can3 extracted: `reference/live2d-sample/Hiyori/hiyori_pro_t04_extracted/main.xml`
- Our can3 extracted: `girl_extracted/main.xml` (after running cmo3_decrypt.py)
- Python decrypt: `docs/live2d-export/scripts/cmo3_decrypt.py`
- IDA Pro: available for Java class decompilation
