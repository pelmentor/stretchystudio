# Session 3 Prompt

Продолжаем работу над Live2D экспортом для Stretchy Studio.

## Контекст

Прочитай ВСЕ файлы в `docs/live2d-export/`:
- `PROGRESS.md` — общий статус проекта
- `CMO3_FORMAT.md` — **ГЛАВНЫЙ ДОКУМЕНТ** — полный RE формата .cmo3, texture pipeline, Java serializer RE
- `MOC3_FORMAT.md` — .moc3 формат (Phase 1 завершена, модель рендерится)
- `BINDING_SYSTEM.md`, `IDA_SESSIONS.md`, `DECISIONS.md`

## Что сделано

### Phase 1 (.moc3 runtime export) — ЗАВЕРШЕНА
- JS moc3writer генерирует валидные .moc3
- Модель рендерится в Cubism Viewer 5.0 и Ren'Py
- Закоммичено и запушено в `pelmentor/stretchystudio`

### Phase 2 (.cmo3 project export) — В ПРОЦЕССЕ
- CAFF контейнер полностью отреверсен и реализован (`scripts/caff_packer.py`)
- main.xml XML serialization отреверсена через Java decompile (`Live2D_Cubism.jar` → CFR)
- xs.id/xs.idx/xs.ref система полностью понята (xs.idx не валидируется, порядок элементов не важен)
- Минимальный генератор работает (`scripts/cmo3_generate.py`) — файл ОТКРЫВАЕТСЯ в Cubism Editor 5.0
- **НО**: mesh показывает "recovered" — нет текстуры

## Главный блокер Session 3

Mesh'и открываются как "recovered" потому что генератор не создаёт **полный texture pipeline**. Нужно добавить:

1. **CLayeredImage + CLayerGroup + CLayer** — PSD layer hierarchy (фейковый — мы не из PSD, а из Stretchy Studio)
2. **CModelImage** — для каждого mesh'а, с filter env и cached image
3. **ModelImageFilterSet + FilterInstance + FilterValue + FilterValueId** — filter graph для выбора слоя
4. **CModelImageGroup** — группировка в CTextureManager
5. **`isTextureInputModelImageMode = true`** — флаг в CTextureManager

Полная цепочка для каждого mesh'а:
```
CLayer (fake PSD layer, PNG = rendered mesh texture)
  → CModelImage (filter env selects this layer)
    → CImageResource (PNG file in CAFF archive)
  → CTextureInput_ModelImage (references CModelImageGuid)
    → CTextureInputExtension (в _extensions mesh'а)
      → CArtMeshSource
```

## Reference файлы

- `reference/live2d-sample/untitled_with_mesh/main.xml` — 20-mesh model из Cubism Editor 5.0 (322KB XML)
- `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml` — Hiyori (6MB XML, сложная)
- `reference/live2d-sample/test_minimal.cmo3` — наш текущий генератор (opens with "recovered")
- `reference/D2Evil/` — C# CAFF reader/writer reference

## Инструменты

- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- CFR decompiler: `/tmp/cfr.jar` (может не быть — скачать `curl -L -o /tmp/cfr.jar "https://github.com/leibnitz27/cfr/releases/download/0.152/cfr-0.152.jar"`)
- Декомпилированные Java классы: `/tmp/cfr_out/com/live2d/serialize/` (XmlWriter.java, XmlReader.java, SerializeDef.java)
- py-moc3: `pip install py-moc3` (для .moc3 работы)
- Cubism Core DLL: `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll`
- IDA Pro с MCP доступен для RE если нужен

## Задача Session 3

**Цель**: Сгенерировать .cmo3 который открывается в Cubism Editor 5.0 БЕЗ "recovered" — с полноценной текстурой на mesh'е.

**Подход**: Reference-first. Скопировать texture pipeline из `untitled_with_mesh/main.xml` в наш генератор. Каждый mesh получает:
- Свой CLayer (с PNG)
- Свой CModelImage (с filter env)
- Свой CImageResource (с PNG файлом в CAFF)
- CTextureInputExtension привязанный к mesh

**НЕ КОММИТИТЬ** пока нет рабочего прототипа без "recovered".
