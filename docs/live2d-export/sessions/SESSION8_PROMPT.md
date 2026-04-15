# Session 8 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай документацию в `docs/live2d-export/`:
- `README.md` — индекс, quick-start, troubleshooting, gotchas
- `PROGRESS.md` — статус проекта
- `ARCHITECTURE.md` — решения, маппинг данных, **coordinate space traps**, dual-position system
- `CMO3_FORMAT.md` — формат .cmo3

## Что сделано (Phase 1-2 COMPLETE + деформеры + auto-parenting)

### Phase 1 (.moc3 runtime) — COMPLETE
- JS moc3writer, рендерится в Cubism Viewer 5.0 и Ren'Py

### Phase 2 (.cmo3 project) — COMPLETE
- Полный pipeline: ExportModal → exportLive2DProject → generateCmo3 → packCaff
- Текстуры, draw order, single-PSD pattern
- Part hierarchy: группы SS → CPartSource с nesting
- Parameters: все project.parameters + ParamOpacity

### Session 5-6: Деформеры
- **Rotation deformers**: каждая группа → CRotationDeformerSource
  - Origin: SS pivot (если задан) → центр descendant мешей (fallback)
  - Деформер chain следует иерархии групп

### Session 7: Auto-parenting + dual-position (CRITICAL)
- **Мешы auto-parented** к деформерам (targetDeformerGuid → группа, не ROOT)
- **Dual-position system** (из Hiyori RE):
  - `meshSrc > positions` + `GEditableMesh2 > point` → CANVAS pixel space (текстуры)
  - `keyform > CArtMeshForm > positions` → deformer-local space (рендеринг)
  - TRAP: если оба в deformer-local → текстуры пустые (прозрачные мешы)
- **World-space pivots**: вычисляются через makeLocalMatrix/mat3Mul из transforms.js
- **Deformer origins в parent-relative** local coords (как в Hiyori)
- **Подтверждено**: персонаж вращается корректно в Cubism Editor 5.0

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (parts, params, deformers, auto-parenting)
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json
- `src/io/live2d/motion3json.js` — .motion3.json
- `src/io/live2d/cdi3json.js` — .cdi3.json
- `src/io/live2d/textureAtlas.js` — atlas packer
- `src/components/export/ExportModal.jsx` — UI

## Текущее состояние экспорта

Экспорт сейчас — **posable puppet** (не статический манекен):
- ✅ Мешы, текстуры, hierarchy, draw order
- ✅ Rotation deformers на каждую группу, auto-parented
- ✅ Деформеры **уже controllable** — можно кликать на контроллеры и вращать в Editor
- ✅ Параметры проекта экспортированы
- ❌ Деформеры НЕ привязаны к параметрам (нет parameter slider → deformer binding)
  - Прямое вращение через контроллеры работает
  - Но для анимации в Editor нужны parameter bindings (keyframe на timeline = parameter value)
- ❌ Анимации НЕ экспортированы в .cmo3
- ❌ Нет warp deformers
- ❌ Нет physics/pose/expressions

## Задачи Session 8

### 1. Parameter → Deformer bindings (ПРИОРИТЕТ)
Сейчас rotation deformers имеют 1 keyform (rest pose, angle=0).
Нужно привязать деформеры к параметрам чтобы они были controllable:

**Подход A — параметры из анимаций:**
- SS анимации содержат tracks: `{ targetId, property, keyframes }`
- `property === 'rotation'` на группе → создать параметр ParamRotation_GroupName
- Привязать к CRotationDeformerSource через KeyformBindingSource
- Нужно 2+ keyforms: angle at min, angle at max (из animation keyframe range)

**Подход B — generic параметры:**
- Каждый деформер получает параметр с range [-30, 30] (как Hiyori ParamAngleX)
- 3 keyforms: angle=-30, angle=0, angle=+30
- Пользователь настраивает range в Cubism Editor

Подход B проще и даёт пользователю controllable модель сразу.

### 2. Animation export
- SS анимации → .motion3.json (уже работает для runtime)
- Для .cmo3: нужно привязать motion curves к нашим параметрам
- Проверить что .motion3.json references правильные parameter IDs

### 3. Warp deformers (advanced)
- SS mesh vertex animations → CWarpDeformerSource с grid keyforms
- Stretchy Studio хранит vertex-level animation → нужна конвертация в grid
- Hiyori использует 5x5 warp grids для большинства мешей

### 4. Ren'Py validation
- Проверить что .motion3.json работает в Ren'Py
- Проверить что rotation deformers корректно отображаются в runtime

## Координатные системы (КРИТИЧЕСКИ ВАЖНО!)

### Dual-position system (Session 7 trap)
```
meshSrc > positions         → CANVAS pixel space  (для текстур)
keyform > positions         → DEFORMER-LOCAL space (для рендеринга)
GEditableMesh2 > point      → CANVAS pixel space  (для editing)
UVs                         → normalized 0..1 от CANVAS positions
```

### Deformer coordinate chain
```
Canvas origin (0, 0)
  └─ Deformer A: origin = (500, 300) в canvas space
      └─ Deformer B: origin = (100, -50) в A's local space
          └─ Mesh: keyform vertices в B's local space
              vertex_local = vertex_canvas - B_world_origin
              B_world_origin = A_origin + B_local_origin = (600, 250)
```

### SS transform
`T(x+pivotX, y+pivotY) × R(rotation°) × S(scaleX, scaleY) × T(-pivotX, -pivotY)`
Pivot в world space = `worldMatrix × [pivotX, pivotY, 1]`

## KeyformBindingSource (из Hiyori RE)

Для привязки деформера к параметру:
```xml
<KeyformBindingSource>
  <KeyformGridSource xs.n="_gridSource" xs.ref="#..." />
  <CParameterGuid xs.n="parameterGuid" xs.ref="#..." />
  <array_list xs.n="keys" count="3">
    <f>-30.0</f>  <!-- min -->
    <f>0.0</f>    <!-- default -->
    <f>30.0</f>   <!-- max -->
  </array_list>
  <InterpolationType xs.n="interpolationType" v="LINEAR" />
  ...
</KeyformBindingSource>
```

KeyformGridSource > keyformsOnGrid должен иметь count = keys.count.
Каждый KeyformOnGrid → keyformGuid → CRotationDeformerForm с разным angle.

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Live2D docs: https://docs.live2d.com/en/cubism-editor-manual/
- Reference: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
