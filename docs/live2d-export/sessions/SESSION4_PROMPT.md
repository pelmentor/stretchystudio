# Session 4 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай ВСЕ файлы в `docs/live2d-export/`:
- `PROGRESS.md` — общий статус проекта
- `CMO3_FORMAT.md` — **ГЛАВНЫЙ ДОКУМЕНТ** — полный RE формата .cmo3, Session 3 findings
- `MOC3_FORMAT.md` — .moc3 формат (Phase 1 завершена)

## Что сделано

### Phase 1 (.moc3 runtime export) — ЗАВЕРШЕНА
- JS moc3writer генерирует валидные .moc3
- Модель рендерится в Cubism Viewer 5.0 и Ren'Py

### Phase 2 (.cmo3 project export) — MILESTONE REACHED
- **Генератор работает**: `scripts/cmo3_generate.py` создаёт .cmo3 который открывается в Cubism Editor 5.0.00 БЕЗ "recovered"
- Full texture pipeline: CLayeredImage → CLayer → CModelImage (filter env) → CImageResource → CTextureInputExtension
- CAFF пакер: `scripts/caff_packer.py`
- Все критические фиксы десериализации задокументированы в CMO3_FORMAT.md "Session 3 Findings"

### Критические константы (найдены через Java decompile):
- CDeformerGuid.ROOT UUID: `71fae776-e218-4aee-873e-78e8ac0cb48a`
- StaticFilterDefGuid CLayerSelector: `5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301`
- StaticFilterDefGuid CLayerFilter: `4083cd1f-40ba-4eda-8400-379019d55ed8`
- CModelSource version: 4 (избегает обязательные поля v5+)

## Задачи Session 4

### 1. Scale to Multiple Meshes
Текущий генератор создаёт 1 mesh с белой текстурой 512x512.
Нужно масштабировать до N mesh'ей с разными текстурами.

Per-mesh нужно дублировать:
- CLayer (в CLayeredImage)
- CImageResource (с реальной PNG текстурой)
- CModelImage (в CModelImageGroup с unique filter env)
- ModelImageFilterSet + FilterInstances (per-mesh)
- GTexture2D, CTextureInputExtension, CTextureInput_ModelImage
- CArtMeshSource с реальной геометрией

### 2. Port to JavaScript
Портировать `cmo3_generate.py` → `src/io/live2d/cmo3writer.js`
Использовать реальные данные из Stretchy Studio (mesh.vertices, mesh.triangles, textures)

### 3. Integration
- Добавить .cmo3 опцию в Export Modal (ExportModal.jsx)
- Использовать CAFF пакер на JS (портировать caff_packer.py)
- ZIP упаковка с текстурами

## Reference файлы
- `reference/live2d-sample/untitled_with_mesh/main.xml` — 20-mesh reference (Cubism Editor 5.0)
- `reference/live2d-sample/test_pipeline.cmo3` — наш рабочий прототип
- Decompiled Java: `/tmp/cfr_editor/` (если доступен)

## Инструменты
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- CFR decompiler: для Java RE если нужен
- Cubism Core DLL: `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`
