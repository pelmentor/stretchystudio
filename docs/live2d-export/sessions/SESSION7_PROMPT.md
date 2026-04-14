# Session 7 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай документацию в `docs/live2d-export/`:
- `README.md` — индекс, quick-start, troubleshooting
- `PROGRESS.md` — статус проекта
- `ARCHITECTURE.md` — решения, маппинг данных, binding system
- `CMO3_FORMAT.md` — формат .cmo3

## Что сделано (Phase 1-2 COMPLETE + деформеры)

### Phase 1 (.moc3 runtime) — COMPLETE
- JS moc3writer, рендерится в Cubism Viewer 5.0 и Ren'Py

### Phase 2 (.cmo3 project) — COMPLETE
- Полный pipeline: ExportModal → exportLive2DProject → generateCmo3 → packCaff
- Текстуры, draw order, single-PSD pattern
- Part hierarchy: группы SS → CPartSource с nesting
- Parameters: все project.parameters + ParamOpacity

### Session 5-6: Деформеры + Polish
- **Rotation deformers**: каждая группа → CRotationDeformerSource
  - Origin: SS pivot (если задан) → центр descendant мешей (fallback)
  - angle=0 (rest pose, вершины в canvas-space)
  - Деформер chain следует иерархии групп
  - Мешы под ROOT (canvas-space), пользователь парентит вручную в Editor
- **Error handling**: ошибки отображаются в UI
- **Docs**: реорганизованы (README, ARCHITECTURE, archived sessions)
- **Upstream merge**: Spine export, anim curves, UI improvements

### Критическая находка Session 6:
- **Live2D child positions are in parent's LOCAL coordinate space**
  (из доков: docs.live2d.com/en/cubism-editor-manual/system-of-parent-child-relation/)
- Поэтому мешы нельзя парентить к деформерам напрямую — вершины в canvas-space
- Для правильного парентинга: нужно трансформировать вершины в local-space деформера

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (parts, params, deformers)
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json
- `src/io/live2d/motion3json.js` — .motion3.json
- `src/io/live2d/cdi3json.js` — .cdi3.json
- `src/io/live2d/textureAtlas.js` — atlas packer
- `src/components/export/ExportModal.jsx` — UI

## Задачи Session 7

### 1. Pivot setup в SS → правильные joint positions
Сейчас origin деформеров = центр bounding box (fallback).
Нужно чтобы пользователь задавал pivots на группах в SS.
Проверить что pivots из SS корректно транслируются в origin деформеров.

### 2. Auto-parent мешей к деформерам
Сейчас все мешы под ROOT. Чтобы авто-парентить:
- Трансформировать вершины из canvas-space в local-space деформера
- ИЛИ создать деформеры с identity transform (origin в canvas center, angle=0)
  и парентить мешы, оставляя вершины as-is

### 3. Параметры из анимаций
SS анимации содержат tracks по свойствам (x, y, rotation, opacity).
Создать Live2D параметры автоматически и привязать к деформерам:
- track.property === 'rotation' → ParamRotation_GroupName
- track.property === 'opacity' → PartOpacity

### 4. Animation export в .cmo3
.motion3.json уже работает для runtime. Проверить интеграцию с .cmo3.

### 5. Warp deformers (advanced)
Для mesh_verts анимаций — warp deformers с grid.
Stretchy Studio хранит vertex-level animation → Live2D warp deformer keyforms.

## Координатные системы (критически важно!)
- **SS mesh vertices**: в image-local space (0..imageW, 0..imageH)
  Для canvas-sized PSD layers это совпадает с canvas-space
- **SS transforms**: T(x+pivotX, y+pivotY) × R(rot) × S(sx, sy) × T(-pivotX, -pivotY)
- **Live2D deformers**: child positions in PARENT'S local coordinate space
- **Live2D canvas**: vertex positions in canvas pixels, origin top-left

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Live2D docs: https://docs.live2d.com/en/cubism-editor-manual/
  - Deformers: /deformer/
  - Parent-child: /system-of-parent-child-relation/
  - Rotation deformer: /making-and-rotation-of-rotationdeformer/
