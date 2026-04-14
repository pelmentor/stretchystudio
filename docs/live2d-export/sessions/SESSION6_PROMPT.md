# Session 6 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай ВСЕ файлы в `docs/live2d-export/`:
- `PROGRESS.md` — общий статус проекта
- `CMO3_FORMAT.md` — **ГЛАВНЫЙ ДОКУМЕНТ** — полный RE формата .cmo3
- `MOC3_FORMAT.md` — .moc3 формат (Phase 1 завершена)

## Что сделано

### Phase 1 (.moc3 runtime export) — ЗАВЕРШЕНА
- JS moc3writer генерирует валидные .moc3
- Модель рендерится в Cubism Viewer 5.0 и Ren'Py

### Phase 2 (.cmo3 project export) — ЗАВЕРШЕНА (Session 5)
- **Полный JS pipeline**: ExportModal → exportLive2DProject → generateCmo3 → packCaff → .cmo3
- Реальные текстуры из Stretchy Studio отображаются в Cubism Editor 5.0
- Правильный draw order (из part.draw_order)
- Single-PSD pattern: 1 CLayeredImage с N CLayers
- **Part hierarchy**: groups → CPartSource с правильным nesting
- **Parameters**: все project.parameters + ParamOpacity
- **Error handling**: ошибки отображаются в UI

### Критические находки Session 5 (Hiyori RE):
- Part hierarchy: Root Part → CPartGuid children → CDrawableGuid children
- _childGuids can mix CPartGuid + CDeformerGuid + CDrawableGuid
- 70 CParameterSource entries in Hiyori
- 104 deformers (warp + rotation) — documented but NOT implemented
- Deformers use same KeyformBindingSource pattern as art meshes

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (part hierarchy, parameters)
- `src/io/live2d/exporter.js` — exportLive2D (runtime) + exportLive2DProject (.cmo3)
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json manifest generator
- `src/io/live2d/motion3json.js` — .motion3.json animation generator
- `src/io/live2d/cdi3json.js` — .cdi3.json display info generator
- `src/components/export/ExportModal.jsx` — UI с "Live2D Runtime" и "Live2D Project"

## Возможные задачи Session 6

### 1. Animation/Deformer support
- Stretchy Studio не имеет концепции деформеров
- Если добавить — нужно warp/rotation deformers в cmo3writer
- Keyform bindings для параметр → деформер mapping

### 2. Advanced export features
- Physics (.physics3.json)
- Pose (.pose3.json) — part visibility groups
- Expressions (.exp3.json)

### 3. Improve runtime export
- Better .cdi3.json with parameter groups
- Standard Live2D parameter names (ParamAngleX, etc.)
- Motion grouping by name prefix in .model3.json

### 4. UX improvements
- Preview before export
- Validate model before export (missing textures, empty meshes)
- Export progress with percentage

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Cubism Core DLL: `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Reference: `reference/live2d-sample/Hiyori/` (full model with deformers, physics, motions)
