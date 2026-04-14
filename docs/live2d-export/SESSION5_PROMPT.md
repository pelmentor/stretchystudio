# Session 5 Prompt

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

### Phase 2 (.cmo3 project export) — ЗАВЕРШЕНА
- **Полный JS pipeline работает**: ExportModal → exportLive2DProject → generateCmo3 → packCaff → .cmo3
- Реальные текстуры из Stretchy Studio отображаются в Cubism Editor 5.0
- Правильный draw order (из part.draw_order)
- Single-PSD pattern: 1 CLayeredImage с N CLayers (Session 4 critical finding)

### Критические находки Session 4:
- **One PSD, N Layers**: Editor требует ОДНУ CLayeredImage с N CLayers внутри
- N отдельных CLayeredImages = геометрия видна, текстуры НЕТ
- CImageResource и CLayer должны быть canvas-sized
- UVs = vertex.x / canvasW, vertex.y / canvasH
- Draw order берётся из part.draw_order

## JS файлы
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator
- `src/io/live2d/exporter.js` — exportLive2D (runtime) + exportLive2DProject (.cmo3)
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/components/export/ExportModal.jsx` — UI с "Live2D Runtime" и "Live2D Project"

## Задачи Session 5

### 1. Part Hierarchy
Сейчас все мещи в одном "Root Part". Нужно маппить group ноды → CPartSource.

### 2. Deformers (Phase 3)
- Warp deformers
- Rotation deformers
- CDeformerSourceSet population

### 3. Animation Export (Phase 3)
- .motion3.json уже генерируется для runtime
- Нужно проверить что анимации работают с .cmo3 экспортом
- Keyframe → parameter bindings

### 4. Polish
- Error handling
- Progress reporting
- Test in Ren'Py

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Cubism Core DLL: `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`
- Reference: `reference/live2d-sample/untitled_with_mesh/main.xml`
