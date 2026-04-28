# Stretchy Studio v3 — Blender-style Full UX Refactor Plan

> **Status:** Living document. Authored 2026-04-28. Will be edited as work
> progresses, decisions land, and unknowns resolve. Mark sections with
> `**[STATUS: …]**` when locked in or rejected.
>
> **Anchor commit:** TBD — record the `pre-v3-refactor` tag here
> once created (after Phase -1 ships).
>
> **Branch strategy:** Long-lived `v3` branch off `master`. Killswitch
> `?ui=v3` URL flag toggles new shell. Old shell untouched until Phase 6.

---

## 1. Vision

Превратить SS из embryo-инструмента (data-layer есть, UI отсутствует) в
полноценную **Live2D Authoring Environment** с UX того же класса что
Blender / Substance Painter.

Цель — пользователь может **видеть, инспектировать, редактировать,
отлаживать** каждую сущность Live2D-рига (parameters, deformers,
keyforms, physics, masks, variants, animation, motion) интерактивно в
окне, без ухода в Cubism Viewer.

**Acceptance criterion.** На любой выбранный объект (mesh / deformer /
keyform / parameter / physics rule / mask pair / variant) в Properties
Editor открывается соответствующий tab с полными редактируемыми полями
и live-preview во viewport. На любой шаг chain-эвалюации можно
посмотреть в Coord-Space Debugger overlay'е и увидеть точный transform
на каждом уровне.

**Why now.** v1 (15 stages) + v2 (11 stages) шипанули **данные** —
1344 теста, byte-parity с Cubism Editor. Но UI остался слабым: layers
panel, Inspector, R8 scrubber. Юзер не может посмотреть warps /
keyforms / physics chain / mask configs / variants — нет инспекторов.
v2 R6 coord-space bug проявился именно из-за этого: нет debug-оверлея
чтобы увидеть в каком frame'е находятся вершины на каждом шаге chain
walk'а.

---

## 2. Архитектурная модель — 8 слоёв

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 8 — Workspaces (Layout/Modeling/Rigging/Animation)    │
├─────────────────────────────────────────────────────────────┤
│ Layer 7 — Areas (tilable regions, split/join/swap)          │
├─────────────────────────────────────────────────────────────┤
│ Layer 6 — Editor types (Outliner/Properties/Viewport/...)   │
├─────────────────────────────────────────────────────────────┤
│ Layer 5 — Mode system (Layout/Mesh/Rig/Pose/Animate)        │
├─────────────────────────────────────────────────────────────┤
│ Layer 4 — Selection + Active model (universal)              │
├─────────────────────────────────────────────────────────────┤
│ Layer 3 — Operator framework (modal state machines + undo)  │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — Stores (existing v1+v2 + new shell stores)        │
├─────────────────────────────────────────────────────────────┤
│ Layer 1 — Data: project + rigSpec + paramValues + phys      │
└─────────────────────────────────────────────────────────────┘
```

Каждый верхний слой опирается **только на нижние**. Layer 1-2 — уже
шипанули (v1+v2), не трогаем кроме точечных расширений (workspace
layout persistence в `.stretch` schema).

---

## 3. Mode System — полная спецификация

5 режимов. Mask / Variant / Physics — это **editors**, не **modes**;
доступны через Outliner selection + Properties tabs внутри Layout/Rig.

| Mode | Что юзер делает | Selection target | Active editors | Доступные operators |
|------|-----------------|------------------|----------------|---------------------|
| **Layout** | Двигает parts (transform), регулирует opacity, переименовывает, edit'ит mask/variant configs через Properties + dedicated editors | Part / Group / MaskPair / Variant | Viewport, Outliner, Properties (Object/Mask/Variant tabs), Mask Editor, Variant Manager | G/R/S (move/rotate/scale), H (hide), M (toggle mask role), V (toggle variant), Tab→Mesh |
| **Mesh** | Edit-режим вершин, retriangulate, UV, blendshape | Vertex / Edge / Face / BlendShape | Viewport (mesh-aware), Properties (Mesh + BlendShape tabs) | G/R/S, X (delete), E (extrude), F (face), Ctrl-R (loop cut), Ctrl-T (retriangulate) |
| **Rig** | Создаёт/edit'ит warp + rotation deformers, parents, keyforms, physics rules | Deformer / ControlPoint / Keyform / PhysicsRule / Particle | Viewport (lattice + physics chain overlays), Outliner (rig-filtered), Properties (Deformer/Keyforms/PhysicsRule tabs), Physics Editor | G/R/S по control points / pivots / particles, K (insert keyform at current paramValues), Ctrl-K (delete keyform), P (parent), Ctrl-N (new physics rule) |
| **Pose** | Драгает параметры, тестирует rig + physics live | Parameter | Parameters editor, Viewport (physics overlay live) | Slider drag, T (tweak — modal slider), Tab→Animate для записи |
| **Animate** | Keyframes, motion timeline | Keyframe / Track | Timeline, Dopesheet, Graph Editor, Viewport | I (insert keyframe), Alt-I (clear), G (move keyframe), S (scale time) |

Mode switch — `Tab` cycles между Layout↔активным sub-mode по типу
выбранной сущности (Blender pattern). `Ctrl-Tab` opens pie menu с полным
списком модов.

---

## 4. Editor Types — полная спецификация

Каждый editor type это `<Editor>` React component, регистрируется в
`editorRegistry`. Header панели — `<EditorHeader>` со селектором типа.

### 4.1 Outliner

| Поле | Описание |
|------|----------|
| **Tree root** | Project / Animations / RigSpec |
| **Tree types** | Group, Part, ArtMesh, WarpDeformer, RotationDeformer, Keyform, Parameter, PhysicsRule, MaskPair, Variant, Animation, Track |
| **Filters (header)** | Type filter (multi-select), name regex search, "Show only selected", "Show only used" (filter dead deformers) |
| **Actions** | Drag-reparent (validates parent type), multi-select (Shift/Ctrl), context menu (rename/delete/duplicate/isolate), expand/collapse all |
| **Display modes** | "Project hierarchy" (groups+parts) / "Rig hierarchy" (deformers parent chain) / "Parameter list" / "Animation tracks" / "Custom" |
| **Sync** | Selection pumped to/from `selectionStore`. Active item bold + outlined. |

### 4.2 Properties Editor

Multi-tab inspector. Tabs **dynamically computed** from selection:

| Selection | Tabs available |
|-----------|----------------|
| Part | Object, Mesh, BlendShapes, Modifiers, Variants, Mask, Tags, Custom |
| ArtMesh | Object, Mesh, Keyforms, Bindings, Mask, Tags |
| WarpDeformer | Deformer, Grid, Keyforms, Bindings, Parent |
| RotationDeformer | Deformer, Pivot, Keyforms, Bindings, Parent |
| Parameter | Parameter (range/default/group), Keyforms-using, Bindings-using |
| PhysicsRule | Rule (id/category), Inputs, Vertices, Outputs, Normalization |
| MaskPair | Pair (target/masks), Stencil preview |
| Variant | Variant (suffix/parent), Fade rule, Pairing |
| (multiple) | "Common" tab — bulk-edit shared fields |

Each tab = `<PropertiesTab>` component, declared in
`propertiesTabRegistry`. Tab order configurable per mode.

### 4.3 Viewport (extended)

Existing CanvasViewport gets:

| Sub-feature | Description |
|-------------|-------------|
| **Shading modes** | Texture / Solid / Wireframe / X-ray / **Coord-space** (each mesh tinted by its parent localFrame: green=canvas, blue=normalized, red=pivot-relative) |
| **Overlays** | Wireframe, vertices, edges, deformer lattices, rotation gizmos, physics chains, masks (stencil debug), parameter HUD, FPS, **active chain trace** |
| **Active deformer gizmo** | Drag control points (warp) / drag pivot+angle (rotation) when in Rig mode |
| **Camera** | Pan/zoom existing + frame-to-selected (Numpad .), camera-locked-to-mesh (track selection) |
| **Headers** | Mode tabs, viewport options, snap-to-grid toggle, pivot type (origin/median/3D-cursor), shading dropdown |

#### Coord-Space Debugger spec (the killer feature)

- Hover any mesh → tooltip shows: `mesh in canvas-px → parent
  (RigWarp_face) in normalized-0to1 → grandparent (FaceParallaxWarp)
  in canvas-px → root`
- Right-side panel shows full chain trace with vertex sample at each
  step
- Click "Trace" button on a vertex → highlights that vertex + shows
  its position at every chain level
- This is what would have caught our v2 R6 bug in seconds

### 4.4 Parameters Editor (replaces R8 panel)

| Section | Description |
|---------|-------------|
| **Header** | Search box, group filter (LipSync/EyeBlink/Body/Face/Variant/Bone/Custom), "reset all" |
| **Group rows** | Collapsible. Each group shows count, "solo" + "mute" toggle |
| **Param row** | Slider, value field, range edit (min/max/default), keyframe diamond (filled if keyed at current time), pin (always visible), context menu (delete/rename) |
| **Footer** | "Linked physics outputs" panel (read-only highlight of physics-driven params) |
| **Live mode** | Pose mode: drag → instant viewport. Animation mode: drag → keyframe insert at current time |

### 4.5 Timeline + Dopesheet

| Editor | Purpose |
|--------|---------|
| **Timeline** | Compact: playhead + start/end + frame counter + play/pause/loop. Keyboard: spacebar play, arrows step. |
| **Dopesheet** | Full keyframe table: rows = parameters/properties, cols = time. Click=select, drag=move, scale operator (S), grease-pencil-style frame markers |
| **Keyform Graph Editor** | Rig keyform interpolation curves: LINEAR / BEZIER. Drag bezier handles. Per-deformer view. |
| **Animation F-curve Editor** | Animation track curves across TIME (motion3): BEZIER / STEP / CONSTANT. Multi-curve overlay. |

### 4.6 Live2D-specific Editors

#### 4.6.1 Warp Deformer Editor (Rig mode active)

- 6×6 lattice overlay, drag control points
- Per-keyform deltas visible, ghost outlines for non-active keyforms
- "Edit mode" (rest grid) vs "Pose mode" (current paramValues
  evaluated)
- Subdivide grid, magnet symmetry (X-mirror), reset to rest
- Side panel: keyform list with their (param₁, param₂, ...) tuple

#### 4.6.2 Rotation Deformer Editor

- Pivot (X+Y) with 4-axis origin gizmo
- Angle handle (long line ending at circle)
- Scale handles on bbox corners
- Keyform browser sidebar (one per cellTuple)

#### 4.6.3 Keyform Browser

- N-dimensional sparse grid view: e.g. for ParamEyeLOpen × ParamSmile
  = 2×2 grid showing 4 keyforms
- Click cell → jump to that paramValues, mesh deforms to it, edit
  panel opens
- Numeric diff viewer: compare two keyforms side-by-side

#### 4.6.4 Physics Editor

- Visual pendulum chain on viewport with particles as circles
- Drag particle in viewport = edit `vertices[i].x/y` (Cubism uses for
  chain anchor)
- Side panel: per-particle table (radius, mobility, delay,
  acceleration)
- Inputs section: drag parameter from outliner → drop here, choose
  type (X/Y/G_ANGLE)
- Outputs section: same drag-drop with target param + scale

#### 4.6.5 Mask Editor

- List of clip pairs: target mesh ← [mask1, mask2, ...]
- Click pair → viewport highlights target green, masks red
- Stencil preview overlay (visualises 8-bit stencil buffer
  post-frame)
- Add pair: pick target from outliner, then masks via shift-click

#### 4.6.6 Variant Manager

- Group view: each base mesh → list of variants
  (smile/cry/blush/...)
- Per-variant row: suffix, parent override, fade rule (2-keyform 0→1
  or 1→0), preview slider
- "Render variant pair" mode: viewport renders only base+variant for
  visual diff
- Auto-pair runner: re-trigger variantNormalizer.js on selection

### 4.7 Other Editors

| Editor | Purpose | Phase |
|--------|---------|-------|
| **Preferences** | Theme, keymap, viewport options, performance | 4 |
| **Performance Profiler** | Live frame breakdown, allocation graph, GC pauses | 4 |

PNG atlas inspection — handled через **Texture** sub-tab в Properties
Editor для part'ы, не отдельный editor. JSON debugging — DevTools или
открыть `.stretch` в VSCode.

---

## 5. Selection + Active Model

Universal `selectionStore`:

```js
useSelectionStore = {
  // Selection: ordered array of {type, id} tuples
  selected: [
    {type: 'part', id: 'face'},
    {type: 'deformer', id: 'BodyXWarp'},
  ],
  // Active = last-selected, has special status
  active: {type: 'deformer', id: 'BodyXWarp'},
  // Context that filters which types ARE selectable (mode-driven)
  selectableTypes: ['part', 'deformer'],
  // Actions
  select, toggle, deselectAll, addRange, setActive, ...
}
```

Every editor reads from this store. Outliner sync, Properties tab
computation, Viewport gizmo, all driven from `selected` / `active`.

**Modal selection types** (per mode):

- Layout: `part`, `group`, `maskPair`, `variant`
- Mesh: `vertex`, `edge`, `face`, `blendshape`
- Rig: `deformer`, `controlPoint`, `keyform`, `physicsRule`,
  `physicsParticle`
- Pose: `parameter`
- Animate: `keyframe`, `track`

Mode change → `selectableTypes` updates → selection auto-filtered
(incompatible items dropped). Mask / Variant / Physics — это editors,
не modes (folded into Layout/Rig per trim pass §12).

---

## 6. Operator Framework

Каждое действие = **operator**. Common shape:

```js
defineOperator({
  id: 'mesh.move_vertex',
  label: 'Move Vertex',
  modes: ['Mesh'],
  selection: ['vertex'],
  modal: true,        // has interactive state machine
  invoke: (ctx) => {  // entry point
    return MoveVertexState(ctx);
  },
  execute: (ctx, params) => {  // direct invocation with params
    applyMove(ctx.selected, params.delta);
  },
  poll: (ctx) => ctx.selected.length > 0,
  undo: 'auto'
});
```

Modal state machine handles: invoke → mouse-move (preview) → click
(commit) / Esc (cancel) / right-click (cancel) / type number (precise
input).

**Operator registry** lives in `src/v3/operators/`. One file per
operator, imported into `registry.js`. Auto-bound to keymap entries.

**F3 search** (or Cmd-K) opens fuzzy palette searching operator labels
filtered by `poll(ctx)` — same pattern as Blender / VSCode command
palette. Add `cmdk` package.

**Undo system** integrates with operator framework:

- Each operator declares undo strategy: `auto` (Immer-style patch
  captured), `manual` (operator manages), `none` (idempotent).
- Storage: per-operator deltas (Immer patches), не full project
  snapshots. См. §15 Pillar M — full clones это GB heap pressure на
  rich projects.
- Memory budget: <10 MB total history at any time, soft-limited by
  operator-count (~200 entries) + hard-limited by byte size.
- Ctrl-Z applies inverse patch. Ctrl-Shift-Z applies forward patch.

---

## 7. Themes + Keymap

### 7.1 Theme

CSS variables driven via Tailwind. Two preset themes:
**Blender-style** (primary, dark default with accent customizable) +
**Cubism-compat** (optional, для users переходящих с Cubism Editor).
Per-section overrides:

- Background colors per editor type
- Outline / selection / active colors
- Gizmo colors (X=red, Y=green, Z=blue per Blender convention)
- Curve colors (Graph Editor)

User-customizable in Preferences editor (Phase 4).

### 7.2 Keymap

`src/v3/keymap/default.js` — declarative bindings:

```js
{ key: 'g', mode: 'Mesh', operator: 'mesh.move_vertex' },
{ key: 'r', mode: 'Mesh', operator: 'mesh.rotate_vertex' },
{ key: 'tab', mode: 'Layout', operator: 'mode.toggle_edit' },
{ key: 'ctrl+z', operator: 'undo' },
```

Conflict resolution: mode-specific overrides global. Custom keymaps
per user (Phase 3+, persisted to localStorage).

---

## 8. Phases — Detailed

> **Strategy: Parallel shell with killswitch**
>
> New shell behind `?ui=v3` URL param. Old UI remains untouched. We
> migrate piece-by-piece, switching killswitch default to new shell
> when Phase 3 lands. Old shell deleted in Phase 6.

### PHASE -1 — Pre-v3 Stability (2-3 weeks) **[STATUS: ✅ SHIPPED 2026-04-28]**

All five substages landed, tag `pre-v3-refactor` set on commit
`8b8520e`. Test surface grew 1344 → 1378.

**Goal:** Стабилизировать существующее перед началом v3. Без этого мы
строим на сломанном фундаменте (v2 viewport не работает после
Initialize Rig — coord-space bug). Также удаляем dead code чтобы v3
работал на чистой базе.

#### -1A — Upstream merge (1 day)

`git merge -s ours upstream/master` — записать merge в историю,
сохранить наш код. Per `feedback_push_target` memory: push в `origin`
(pelmentor), не в upstream.

#### -1B — v2 R6 coord-space bug fix (3-5 days)

**Symptom:** После Initialize Rig меши улетают / исчезают (см. user
screenshots 2026-04-28).

**Investigation steps:**
1. Trace `node.mesh.vertices` coord system от PSD import до GPU upload
2. Trace `partRenderer.uploadPositions(partId, vertices, uvs)` —
   ожидаемый coord space (part-local или canvas-px)
3. Check `worldMatrix` per part в `scenePass.js`
4. Identify exact mismatch с evalRig output (canvas-px)

**Hypothesis:** parts имеют non-identity worldMatrix (group transforms
applied at part level в auto-rig output), evalRig output это
canvas-px → multiply in scenePass даёт double transform.

**Likely fix options:**
- (a) `chainEval.js` outputs part-local (compute inverse worldMatrix
  per mesh, apply to canvas-px output)
- (b) При upload пометить mesh как "isAlreadyWorld" → partRenderer
  skips worldMatrix multiply
- (c) Reset part worldMatrix to identity при rig-eval активном

Choose root cause после investigation, не by trial.

#### -1C — Puppet warp branch removal (1 day)

v3 не использует puppet warp. Upstream сам удалил эту фичу
(`removed puppet pins, it sucked`). Удалить:
- `src/mesh/puppetWarp.js`
- Import `applyPuppetWarp` в CanvasViewport.jsx
- Puppet warp branch L523-549 в CanvasViewport tick
- `docs/puppet_warp_implementation.md`
- Соответствующие места в SkeletonOverlay, Inspector, projectStore,
  editorStore, animationEngine (см. upstream commits 4032062 +
  f3ad239 как референс)

#### -1D — Identifier crisis fix (Pillar B, 0.5 weeks)

**Problem:** 361 references к `partId / node.id / meshSpec.id /
sanitizedName` across 24 files. Не enforced что они равны → silent
eval failures (was Risk #6 в v2 plan).

**Steps:**
- Canonical `PartId` brand type (TypeScript when available, JSDoc до
  тех пор): `/** @typedef {string & {__brand: 'PartId'}} PartId */`
- Audit каждое место конверсии node.id ↔ partId, добавить
  `assertSamePartId()`
- Test fixture: round-trip PSD → rig → eval → assert все IDs match
- cmo3writer mesh ID sanitisation (`pm.partId` → `RigWarp_${...}`)
  documented как official transform, не накладной костыль

**Verification:** Тест-кейс который раньше silently dropped frames
теперь catches mismatch и fails loudly.

#### -1E — Dead code purge (Pillars I, N, AA, 0.5 weeks)

Aggressive grep-driven audit + deletion:

- **`src/store/historyStore.js`** (Pillar N) — 38 LOC, никем не
  импортируется, stub-комментарии "in a real implementation we'd…"
  — никогда не написано. Active impl в `undoHistory.js`.
- **`src/components/Demo.jsx`** (Pillar AA) — shadcn template demo,
  никем не импортируется.
- **`src/components/PhoneLayout.jsx`** (Pillar AA) — mobile shell
  stub, никем не импортируется.
- **`cmo3writer.js:2961` TODO** (Pillar I) — `// TODO: route face
  warps through head rotation deformer (Hiyori pattern)` — verify
  whether stale (face rotation deformer added в Stage 8) и delete
  if так.
- **`src/io/exportSpine.js`** (Pillar I) — Live2D-only project per
  memory. Confirm unused и delete (или keep если используется в
  build).
- **Various commented-out blocks** across codebase — grep
  `^\s*//.*(was|removed|deprecated)`, evaluate.

**Verification:** npm test зелёный, build green, total LOC -1500-2000.

**Phase -1 verification (consolidated):**
- npm test зелёный (1344+ tests stay)
- build green
- viewport работает после Initialize Rig (-1B fixed)
- `useHistoryStore`, `Demo`, `PhoneLayout` not in bundle anymore

**Tag:** `pre-v3-refactor` на финальный stable commit. Это anchor для
v3 rollback при необходимости.

---

### PHASE 0 — Foundation (8-10 weeks) **[STATUS: 0A/B/D/F.1/F.2/G shipped 2026-04-28; 0C/E + 0F remaining slices pending]**

Substage status:

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 0A — Shell + workspace + editor type system | ✅ shipped | `a35a9b7` | Behind `?ui=v3`; 4-area 2×2 layout; 5 workspaces; editor stubs; ErrorBoundary; operator dispatcher with Ctrl+1..5. Phase 1 fills editors. |
| 0B — Service layer (Pillar F) | ✅ shipped | `0192d88` | RigService / ExportService / ImportService / PersistenceService façades with pure preflight functions. |
| 0C — Coord-space type wrappers (Pillar C) | ⏳ pending | — | Phase 1 dependency for Viewport coord-debugger. |
| 0D — Type checking (Pillar G) | ✅ shipped | `a3658b3` | `tsc --noEmit` runs in `npm test`. Per-file opt-in via `// @ts-check` (14 new files locked in); legacy code untouched until refactored. |
| 0E — Vitest migration (Pillar H) | ⏳ pending | — | UI tests need jsdom; .mjs scripts can stay. |
| 0F.1 — Pure helpers extraction | ✅ shipped | `1380fc6` | 8 utility functions out of CanvasViewport into `viewport/helpers.js` (-116 LOC). 44 unit tests. |
| 0F.2 — Export-frame capture extraction | ✅ shipped | `ee49cb5` | `viewport/captureExportFrame.js` (-102 LOC). |
| 0F.N — Remaining slices (wizard handlers, pointer events, mesh worker, projectStore split) | ⏳ pending | — | Each its own commit; CanvasViewport currently 2025 LOC (was 2243). |
| 0G.1 — ID consolidation (Pillar P) | ✅ shipped | `fb651bf` | `lib/ids.js` with `uid()` + `uidLong()`; 7 `Math.random` ID sites consolidated. |
| 0G.2 — `scripts/` reorg (Pillar V) | ✅ shipped | `5ad5d2d` | `test/`, `bench/`, `dev-tools/` subdirs. |
| 0G.3 — exhaustive-deps disables (Pillar D) | ✅ shipped | `454cbba` | All 4 disables removed; pre-existing missing-deps in those files fixed too. |

**Goal:** Empty new shell that runs alongside old + foundational
infrastructure (service layer, types, error handling, undo, tooling).

#### 0A — Shell + workspace + editor type system (3-4 weeks)

**New stores:**

- `src/store/uiV3Store.js` — workspace, areas, mode, viewport options
- `src/store/selectionStore.js` — selection model (universal `{type, id}`)
- `src/store/operatorStore.js` — modal state
- `src/store/undoStore.js` — Immer-patches history (Pillar M)
- `src/store/keymapStore.js` — bindings + custom overrides
- `src/store/themeStore.js` — theme variables

**New core modules:**

- `src/v3/shell/AppShell.jsx` — root component conditional on `?ui=v3`
- `src/v3/shell/WorkspaceTabs.jsx` — top tabs
  (Layout/Modeling/Rigging/Animation)
- `src/v3/shell/AreaTree.jsx` — recursive split layout (uses
  react-resizable-panels)
- `src/v3/shell/Area.jsx` — single area, hosts an editor
- `src/v3/shell/EditorHeader.jsx` — selector dropdown + actions
- `src/v3/shell/editorRegistry.js` — type → component map
- `src/v3/shell/ErrorBoundary.jsx` — Pillar S, wraps each editor area
- `src/v3/operators/registry.js` — operator definitions
- `src/v3/operators/dispatcher.js` — keymap → operator (uses
  `KeyboardEvent.code` per Working Note #3, не `.key`)
- `src/v3/operators/modalState.js` — state machine runtime
- `src/v3/operators/undoMiddleware.js` — Immer-patches integration
- `src/v3/keymap/default.js` — initial bindings

**Empty editor stubs (just shells, no content):**

- `OutlinerEditor` (Phase 1)
- `PropertiesEditor` (Phase 1)
- `ViewportEditor` — wraps existing CanvasViewport (Phase 1 customise)
- `ParametersEditor` (Phase 1)
- `TimelineEditor` (Phase 3)

#### 0B — Service layer (Pillar F, 1 week)

Mediates between stores и writers, ends direct store→writer coupling.

- `src/services/RigService.js` — rig build / cache / invalidate
- `src/services/ExportService.js` — pre-flight + format dispatch +
  progress events
- `src/services/ImportService.js` — PSD / cmo3 / exp3 ingestion
- `src/services/PersistenceService.js` — wraps `projectFile.js` +
  IndexedDB, pure (no input mutation per Pillar Q)

Editors call services через operators only.

#### 0C — Coord-space type wrappers (Pillar C, 1 week)

Tagged buffer wrappers eliminate the 61 restX/restY interpretation
ambiguity:

- `src/io/live2d/runtime/coords/TaggedBuffer.js` — `{verts, frame:
  LocalFrame}`
- All conversions через `frameConvert.js` only — no inline reads
- `tsc --checkJs` flags untagged buffer access (Pillar G)

#### 0D — Type checking (Pillar G, 0.5 weeks)

- Enable `tsc --checkJs --noEmit` в CI
- Hot files (rigSpec, evaluator/, stores) → migrate к `.ts`
- Остальное остаётся `.js + JSDoc` — gradual

#### 0E — Vitest migration (Pillar H, 0.5 weeks)

- Single `npm test` runs everything via Vitest
- Existing `.mjs` files convert (cosmetic)
- UI tests via Vitest + jsdom + @testing-library/react
- Coverage report baseline

#### 0F — God-class split: CanvasViewport + projectStore (Pillar A, 1 week)

- `CanvasViewport.jsx` (2243 LOC) → `viewport/Shell.jsx` +
  `viewport/tick.js` + `viewport/operators/`
- `projectStore.js` (736 LOC, 103 actions) → `nodesStore` /
  `rigStore` / `versionStore` (animation extracted в Phase 3)
- Manual ref-mirror anti-pattern (Pillar J) eliminated: subscribe
  pattern + `useDirtyOnChange` hook

#### 0G — Hygiene + tooling (Pillars D, P, Q, V, +0.5 weeks)

- Fix 5 `react-hooks/exhaustive-deps` disables (Pillar D) с proper
  deps + ref pattern
- `Math.random()` → `crypto.randomUUID()` в `projectDb.js` (Pillar P)
- Pure `SerializerService` без input mutation (Pillar Q)
- Reorganize `scripts/` (Pillar V): test/ bench/ dev-tools/

**Verification:**

- `?ui=v3` opens new shell with 4 splittable areas
- Each area dropdown lists editor types, can swap
- Workspace tabs change layout preset
- Old shell (`?ui=v2` or default) untouched
- ErrorBoundary catches simulated component error без падения app
- Undo memory test: 100 operations → heap stays <10 MB
- npm test зелёный + Vitest UI works
- `tsc --checkJs` passes без новых warnings

**Deliverables:** ~50 new files, ~6500 LOC. Tag
`v3-phase-0-complete`.

---

### PHASE 1 — Core Editors (5-7 weeks)

**Goal:** Outliner + Properties + extended Viewport + Parameters all
functional.

#### 1A — Outliner v2 (1.5 weeks)

**Files:**

- `src/v3/editors/outliner/OutlinerEditor.jsx`
- `src/v3/editors/outliner/treeBuilder.js` — converts project +
  rigSpec → unified tree
- `src/v3/editors/outliner/TreeNode.jsx` — recursive
- `src/v3/editors/outliner/filters.js` — type filter, search
- `src/v3/editors/outliner/displayModes.js` —
  hierarchy/rig/param/anim
- `src/v3/editors/outliner/contextMenu.jsx`

**Operators:**

- `outliner.select`, `outliner.expand`, `outliner.collapse`,
  `outliner.rename`, `outliner.delete`, `outliner.duplicate`,
  `outliner.reparent`, `outliner.isolate`

**Verification:**

- Hover deformer → highlight in viewport (gizmo on)
- Select keyform → opens Properties Keyforms tab
- Drag-reparent validates (e.g. can't parent warp under art mesh)

#### 1B — Properties Editor (1.5 weeks)

**Files:**

- `src/v3/editors/properties/PropertiesEditor.jsx`
- `src/v3/editors/properties/tabRegistry.js`
- `src/v3/editors/properties/tabs/ObjectTab.jsx` — transform,
  opacity, visibility, name, tags
- `src/v3/editors/properties/tabs/MeshTab.jsx` — vertex count,
  triangulation, retri button
- `src/v3/editors/properties/tabs/BlendShapeTab.jsx`
- `src/v3/editors/properties/tabs/DeformerTab.jsx` — id, name,
  parent, gridSize (warp) / pivot+angle (rotation)
- `src/v3/editors/properties/tabs/KeyformsTab.jsx` — list of
  keyforms, edit button per row
- `src/v3/editors/properties/tabs/BindingsTab.jsx`
- `src/v3/editors/properties/tabs/ParameterTab.jsx`
- `src/v3/editors/properties/tabs/PhysicsRuleTab.jsx`
- `src/v3/editors/properties/tabs/MaskTab.jsx`
- `src/v3/editors/properties/tabs/VariantTab.jsx`
- `src/v3/editors/properties/tabs/CommonTab.jsx`
- `src/v3/editors/properties/fields/` — reusable field widgets
  (NumberField, Vec2Field, RangeSlider, ColorPicker, Dropdown, etc.)

**Verification:**

- Select part → 7 tabs, each renders correctly
- Edit a field → updates store → viewport reflects
- Multi-select 2 parts → Common tab shows shared fields, Object tab
  shows per-item
- Tab persistence per mode (last-used tab restored)

#### 1C — Viewport extensions (1.5 weeks)

**Files modified:**

- `src/v3/editors/viewport/ViewportEditor.jsx` — wraps existing
  CanvasViewport
- `src/v3/editors/viewport/ViewportHeader.jsx`
- `src/v3/editors/viewport/shading.js` — shading mode logic
  (texture/solid/wireframe/xray/coordspace)
- `src/v3/editors/viewport/overlays/CoordSpaceOverlay.jsx` — **fixes
  R6 coord bug visually**
- `src/v3/editors/viewport/overlays/DeformerLatticeOverlay.jsx`
- `src/v3/editors/viewport/overlays/RotationGizmoOverlay.jsx`
- `src/v3/editors/viewport/overlays/PhysicsChainOverlay.jsx`
- `src/v3/editors/viewport/overlays/HUDPanel.jsx` — FPS, mode,
  active item, paramValues count

**Verification:**

- Coord-space shading mode tints meshes by parent frame
- Hover mesh → chain trace tooltip
- Toggle each overlay individually
- Frame-to-selected (period key) works

#### 1D — Parameters Editor (1 week)

**Files:**

- `src/v3/editors/parameters/ParametersEditor.jsx`
- `src/v3/editors/parameters/ParamGroupRow.jsx`
- `src/v3/editors/parameters/ParamRow.jsx` — extended R8 row
- `src/v3/editors/parameters/groupBuilder.js` — auto-group by id
  pattern
- `src/v3/editors/parameters/PhysicsLinkPanel.jsx`

#### 1E — Coord-space bug fix (1 week, integrated)

Once Coord-Space Debugger overlay is built, the v2 R6 bug becomes
diagnosable. Likely fixes:

- evalRig outputs canvas-px → render expects part-local
- Either: convert in `chainEval.js` (output part-local), or
- Convert at upload site in `CanvasViewport.jsx`, or
- Bypass part transforms when uploading rig-eval verts

Will choose root cause based on debugger output.

**Phase 1 deliverables:** ~80 new files, ~12000 LOC. Tag
`v3-phase-1-complete`. R6 coord bug fixed.

---

### PHASE 2 — Live2D-specific Editors (8-10 weeks)

**Goal:** Native editing of warps/rotations/keyforms/physics/masks/
variants.

#### 2A — Warp Deformer Editor (2 weeks)

**Files:**

- `src/v3/editors/rig/WarpDeformerEditor.jsx`
- `src/v3/editors/rig/lattice/LatticeOverlay.jsx`
- `src/v3/editors/rig/lattice/ControlPoint.jsx`
- `src/v3/editors/rig/lattice/ghostKeyforms.js`
- `src/v3/editors/rig/lattice/symmetry.js` — X-mirror

**Operators:**

- `rig.warp.move_cp`, `rig.warp.subdivide`, `rig.warp.mirror`,
  `rig.warp.reset_grid`, `rig.warp.insert_keyform`,
  `rig.warp.delete_keyform`

#### 2B — Rotation Deformer Editor (1 week)

#### 2C — Keyform Browser (1.5 weeks)

**Files:**

- `src/v3/editors/keyforms/KeyformBrowser.jsx`
- `src/v3/editors/keyforms/SparseGrid.jsx`
- `src/v3/editors/keyforms/CellPreview.jsx` — mini-viewport per cell
- `src/v3/editors/keyforms/diffViewer.jsx` — numeric diff between
  two keyforms

#### 2D — Physics Editor (2 weeks)

**Files:**

- `src/v3/editors/physics/PhysicsEditor.jsx`
- `src/v3/editors/physics/ChainOverlay.jsx`
- `src/v3/editors/physics/ParticleTable.jsx`
- `src/v3/editors/physics/InputDropZone.jsx`
- `src/v3/editors/physics/OutputDropZone.jsx`

#### 2E — Mask Editor (1 week)

#### 2F — Variant Manager (1.5 weeks)

#### 2G — Modal operators full set (1 week)

G/R/S equivalents working in all modes. Numeric typed input, axis
constrain (X/Y/Z keys), snapping.

**Phase 2 deliverables:** ~120 new files, ~18000 LOC. Tag
`v3-phase-2-complete`. Cubism Editor больше не нужен для рукотворного
редактирования рига.

---

### PHASE 3 — Animation + Operator Polish (5-6 weeks) **[STATUS: pillar E + Z added 2026-04-28]**

Includes Pillar E (animation model unification — single
`animationStore` owns persisted keyframes + transient draft via
Immer overlay) and Pillar Z (move `animationEngine.js` from
`renderer/` to `src/animation/{engine,interpolators,evaluator,curves}`).

#### 3A — Timeline Editor (1 week)

#### 3B — Dopesheet Editor (1.5 weeks)

#### 3C — Keyform Graph Editor (1 week)

Rig keyform interpolation curves: LINEAR / BEZIER. Drag bezier
handles. Per-deformer view.

#### 3D — Animation F-curve Editor (1 week)

Animation track curves across TIME (motion3): BEZIER / STEP /
CONSTANT. Multi-curve overlay для одновременного просмотра
нескольких параметров.

#### 3E — F3 Operator Search Palette (0.5 weeks)

`cmdk` package, fuzzy search, recent operators, last-used.

#### 3F — Modal operator polish (1 week)

Axis constraints (X/Y keys), snap-to-grid, precise typed numeric
input.

**Phase 3 deliverables:** Tag `v3-phase-3-complete`. Animation
production-ready.

---

### PHASE 4 — Reference Parity + Polish (7-9 weeks) **[STATUS: trimmed editors + pillars K/L/T/X/Y added 2026-04-28]**

#### 4A — Reference parity harness (mandatory)

Side-by-side viewer testing protocol with Hiyori. Numeric snapshot
harness:
- Fixtures: `scripts/parity-fixtures/{rigId}_{paramSetId}.json` —
  `{paramValues, expectedDeformedVerts}` produced from cubism-web SDK
  как oracle.
- evalRig runs against fixtures in CI; fail if divergence > ε per
  vertex.
- Reference rig: Hiyori (canonical). Optional: Alexia, custom rigs.

#### 4B — Performance Profiler editor

Live UI поверх existing bench scripts. Frame breakdown chart, per-mesh
eval time, allocation graph, GC pauses, memory pressure. Editor type
`PerformanceEditor` registered.

#### 4C — Theme system + Preferences editor

CSS variables, three presets (Dark / Light / Cubism-compat),
per-section override UI.

#### 4D — Custom keymap UI

Edit bindings, conflict detection, persistence to localStorage.

#### 4E — Help system + Onboarding

Tooltip system (`title` attrs across UI), F1 = context help linking
into docs/, first-time onboarding flow with guided tour.

#### 4F — Export validation + Migration safety (Pillar K)

Pre-export checks: parameters complete, deformers parented correctly,
masks resolve, variants paired. Modal с per-issue actionable errors,
"export anyway" override для experts.

Migration safety (Pillar K alongside):
- Auto-backup `.stretch.bak` before any schema migration
- "Migration failed" UI с diagnostic + restore-from-backup option
- Fuzz test harness: random valid `.stretch` v(N-1) → migrate →
  assert valid v(N)

#### 4G — Bundle splitting (Pillar X)

`vite.config.js` `manualChunks` для split: vendor / radix / lucide /
fontsource / app. Lazy-load editors (each editor type = own chunk).
Bundle budget: main chunk < 500 KB gzip.

#### 4H — PWA hygiene (Pillar Y)

Audit PWA manifest + SW configuration:
- Offline shell: editors load cached, project data из IndexedDB
- Install prompt UI
- "New version available, reload" notification

#### 4I — Theme audit (Pillar L)

Audit все components, replace hardcoded colors с CSS variables.
`themePresets.js` остаётся как data, consumed единообразно через
theme system.

#### 4J — i18n infrastructure (Pillar T)

String extraction infrastructure (`react-intl` или similar). All new
v3 UI uses extracted strings (`t('...')` pattern). Russian locale
shipped if время позволяет — иначе deferred to v4.

---

### PHASE 5 — Advanced (5-6 weeks) **[STATUS: pillars O + R added 2026-04-28]**

| Feature | Description |
|---------|-------------|
| **Physics Editor — Cubism import** | Read .physics3.json existing file → populate Physics Editor (round-trip) |
| **Motion timeline scrubbing** | Multi-motion preview, blending |
| **Live2D round-trip .cmo3 import** | Read exported .cmo3 back into SS for verification + post-Cubism-edit recovery |
| **Asset library + project templates** (Pillar R) | Saved deformer / physics / variant configs + starter rigs. Configurable tag set per project (replaces hardcoded `KNOWN_TAGS`). |
| **Asset hot-reload** | PNG changes на disk → live update в SS viewport |
| **Touch / pen refactor** | 44pt hit targets, pen pressure для warp lattice editing, pinch+pan жесты, adaptive layout |
| **onnxruntime-web optional** (Pillar O) | Move ML inference (DWPose) to opt-in plugin. Default PSD import без ML (heuristic-only). 25 MB WASM downloads только при user-triggered "Auto-detect joints". |

---

### PHASE 6 — Migration & Cleanup (4-5 weeks) **[STATUS: writers split + scripts org added 2026-04-28]**

- Remove old shell entirely
- Remove `?ui=v3` killswitch (now default)
- Remove old ParametersPanel, EditorLayout, etc.
- **God-class breakup, round 2** (Pillar A continuation):
  - `cmo3writer.js` (4439 LOC) → `cmo3/{parts,deformers,keyforms,
    masks,variants,boneBaking}.js`
  - `moc3writer.js` (1572 LOC) → `moc3/{header,parameters,parts,
    deformers,artMeshes,keyforms,physics}.js`
- Python tooling README (Pillar W) — `scripts/dev-tools/python/
  README.md` documenting purpose / install / usage
- Final dead code audit (round 2)
- Documentation pass: full user manual + dev guide
- Performance audit — re-bench v2 evaluator under v3 shell

Final tag `v3-shipped` после Phase 6 зелёный.

> **Plugin / scripting API deferred to v4.** JS sandbox makes sense
> only когда у SS есть юзер-база которая хочет автоматизацию. До тех
> пор — operator framework + F3 search покрывают все needs.

---

## 9. Cross-Cutting Concerns

### 9.1 Performance budget

| Editor | Target | Strategy |
|--------|--------|----------|
| Outliner | <16ms tree render at 200 nodes | Virtualization (react-window) |
| Viewport | 60fps with all overlays | GPU instancing for particles, layered Canvas2D for overlays |
| Properties | <16ms tab switch | Lazy mount tabs, debounce field updates |
| Keyform Browser | <100ms grid render at 4×4 | Worker thread for cell evaluation |
| Operator dispatch | <1ms key→op | Pre-built keymap index |
| Memory pressure | Warn at >1GB heap, hard-cap at 2GB | Performance Profiler editor monitors live; warning banner suggests mitigations (split textures, reduce overlays). Не отдельная feature — встроено в Profiler. |

### 9.2 Testing

| Layer | Framework | Added in |
|-------|-----------|----------|
| Pure functions (math, builders) | Existing vitest-style mjs | Already 1344 |
| React components (snapshot) | Vitest + @testing-library/react | Phase 0 |
| Operator state machines | Pure unit tests + state assertions | Phase 0 |
| Editor selection-driven | @testing-library/react + selectionStore mock | Phase 1 |
| Visual regression | Playwright + percy.io OR manual baseline images | Phase 4 |
| E2E user flows | Playwright (PSD import → init rig → drag → assert) | Phase 4 |
| Reference parity | cubism-web SDK as oracle, JSON-diff CI | Phase 4A |

Target: 1344 (current) → 2500+ tests by v3 ship.

### 9.3 Accessibility

- All operators keyboard-reachable
- ARIA roles on all editors

Screen-reader compliance + high-contrast theme — **deferred to v4**.
Full a11y audit это месяцы работы, неясная ROI для desktop authoring
tool. Theme system (Phase 4C) технически позволяет high-contrast
preset когда понадобится — без дополнительной работы.

### 9.4 Persistence

- `.stretch` v11 schema bumps: stores workspace layout per project
- localStorage: keymap overrides, theme, last-active workspace,
  recent operators
- Migration path documented per schema bump

---

## 10. Risks (the real ones)

1. **Scope creep.** Blender has 25 years of dev. We approximate.
   Risk: feature inflation. **Mitigation:** strict phase gates, kill
   features that miss timing windows.
2. **Coord-space bug fix surface area.** Phase -1B fixes immediate
   v2 viewport bug (canvas-px output vs part-local expectation).
   Phase 1C Coord-Space Debugger is preventive infrastructure — bug
   class может regress в любой момент при новых deformer types.
   **Mitigation:** -1B fix proceeds на основе investigation, не
   trial-and-error. 1C debugger ships independently to catch future
   regressions visually.
3. **react-resizable-panels limitations.** May not support
   drag-rearrange of areas, only resize. **Mitigation:** evaluate in
   Phase 0 prototype week; if blocked, build custom tile engine
   (adds 3-4 weeks).
4. **Operator framework over-engineering.** Modal state machines are
   tricky. **Mitigation:** prototype G/R/S in Phase 0, validate
   before broader rollout.
5. **Reference parity drift.** As we add more native editing, our
   `.cmo3` output may diverge from Cubism Editor's. **Mitigation:**
   byte-diff harness re-runs in CI, RUNTIME_PARITY_PLAN tests stay
   green.
6. **Selection model complexity.** Universal `{type, id}` tuples
   need to handle 12+ types. **Mitigation:** type registry with
   discriminated unions, exhaustiveness-checked switch statements.
7. **Mode switch UX.** Blender's Tab cycling is subtle. Bad UX would
   make modes a tax. **Mitigation:** Phase 1 includes user-test (you)
   on mode flow before locking pattern.
8. **Undo correctness.** State snapshots can be huge (full project).
   **Mitigation:** structural-shared snapshots (Immer-style) +
   per-operator tailored undo (e.g. "moved 100 vertices" stores
   deltas not full state).
9. **v2 drift during v3 development.** Если v2 evaluator получает
   bug fixes в parallel branch, v3 их inherit'ит. **Mitigation:**
   tag/freeze v2 на v3 kickoff, фиксы делаем в v2 + cherry-pick в v3
   branch.
10. **Browser performance ceiling.** v3 имеет 5+ overlays + stencil
    + evalRig + physics + multiple editors мейн-thread. Возможен
    60fps cliff. **Mitigation:** lazy mount editors, RAF throttling
    inactive areas, profiler editor с Phase 4B следит continuously.
11. **Tauri / Electron consideration.** Browser-only limits file
    system access (PSD drag-drop работает но full filesystem нет),
    multi-window требует popup permissions. **Decision deferred
    Phase 7+:** если desktop-class UX становится требованием, port
    to Tauri (~3-4 недели extra). PWA + browser остаётся primary
    target до тех пор.
12. **Test framework expansion.** Current vitest-mjs framework не
    покрывает UI/visual/E2E. **Mitigation:** добавить Vitest +
    @testing-library/react + Playwright в Phase 0 deps. Конкретно:
    test:components / test:e2e npm scripts.

---

## 11. Open Questions

> Edit as decisions land. Move resolved ones to §12 Decisions Log
> with the answer + date.

_(Initial 11 questions resolved 2026-04-28 — see §12. New questions
appear here as they arise during work.)_

1. **react-resizable-panels: drag-rearrange supported?** — needs
   Phase 0 prototype week to validate. If not, custom tile engine
   (+3-4 weeks).
2. **cubism-web SDK как oracle (Phase 4A) — какая версия / лицензия
   / интеграция?** — investigate Phase 0.
3. **Visual regression — Playwright+percy.io vs manual baseline
   images?** — pick after first visual test fails real bug.
4. **Worker thread для evaluator (R10 deferred)** — измерить нужно
   ли реально на 100+ mesh rigs, Phase 4B profiler покажет.

---

## 12. Decisions Log

> Append-only. Each decision: date, question resolved, answer,
> rationale.

### 2026-04-28 — Initial 11 questions resolved (autonomous)

1. **Reference parity harness:** **Mandatory.** Phase 4A ships
   fixtures + cubism-web SDK как oracle + CI fail на divergence > ε.
   *Rationale:* 1344 unit tests ловят математику, но не "evaluator
   misinterprets a field" — ровно класс багов как наш v2 R6.
   Visual+numeric harness обязателен для preventing parity drift.

2. **Multi-window:** **Defer to Phase 7+.** Не в v3.
   *Rationale:* 3-6 недель сложности (popout state sync, focus
   management, browser security). Phase 1-6 уже 7-9 месяцев. Не
   blow scope.

3. **Round-trip .cmo3 import:** **YES — Phase 5.**
   *Rationale:* Blender-class tool без round-trip = недоделанный.
   Use case: пользователь правит keyform в Cubism Editor →
   возвращает в SS не теряя остальное. cmo3 это XML, парсинг
   straightforward; reconciling identifiers (CGuid vs stable IDs)
   — основная работа.

4. **Live collaboration:** **NO. Out of scope v3.**
   *Rationale:* CRDT/OT — отдельный 3+ месячный subsystem.
   Misaligned с single-user authoring workflow.

5. **Plugin/scripting API:** ~~**YES — Phase 6B.**~~ **SUPERSEDED
   by trim pass below — deferred to v4.**
   *Original rationale:* Blender's Python — killer feature.
   *Trim rationale:* Blender Python работает потому что 25 лет
   user-base пишет скрипты. У SS users ещё нет, scripting API
   premature. Operator framework + F3 search покрывают automation
   needs пока что.

6. **Cubism vs Blender visual style:** **Blender-style primary.**
   Dark default, accent customizable, gizmo R/G/B = X/Y/Z. Опциональная
   "Cubism-compat" тема позже.
   *Rationale:* Юзер сказал "Blender style". Cubism UI устарелый.

7. **Mobile / tablet:** **PWA остаётся, touch refactor → Phase 5.**
   *Rationale:* PWA уже работает. Touch-first не блокирует
   desktop-first v3.

8. **Upstream merge:** **`git merge -s ours upstream/master`
   immediately.** Записать merge в историю, сохранить наш код.
   Push в `origin` (pelmentor) per memory.
   *Rationale:* Upstream's 3 "attempt" commits — менее полный
   parallel v1+v2. Их 2 puppet-removal commits полезны но v3 всё
   равно удаляет puppet warp в Phase -1C. `-s ours` чище чем
   manual conflict resolution.

9. **Coord-space bug:** **Fix NOW в Phase -1B.** Properly через
   investigation, не quick-and-dirty.
   *Rationale:* Ждать Phase 1E = 2-3+ месяца сломанного v2.
   Quick-and-dirty = костыль (юзер запретил). Properly через ~1
   день investigation.

10. **Missing systems:** ten gaps identified — added to phases.
    See §14 Working Notes for full list. Highlights:
    Performance Profiler editor (Phase 4B), Help/Onboarding (4E),
    Export pre-flight validation (4F), Telemetry opt-in (4G),
    Asset hot-reload (Phase 5), Project templates (Phase 5).

11. **Phase 0 layout framework choice:** **Start with
    react-resizable-panels** (already in deps), evaluate
    drag-rearrange support in Phase 0 first prototype week. If
    blocked, build custom tile engine (+3-4 weeks) — moved to §11
    Open Q1.

### 2026-04-28 — Plan trim pass (autonomous)

Cuts to keep v3 scope focused on Live2D authoring core, not
universal IDE:

**A — Cut entirely:**

- Driver Editor (§4.5) — Blender feature ~5% юзеров используют
- Text Editor / Console / REPL (§4.7) — debug tools, не authoring
- Asset Browser as editor (§4.7) — fold в Properties Texture tab
- Telemetry / Sentry (§4G Phase 4) — privacy + premature
- Phase 6B Scripting API — деферим в v4 пока нет user demand
- Sticker overlay system (Phase 5) — content pattern, не tool
  feature; mask + variant systems already enable
- Heatmap mode + dimension wizard в Keyform Browser (§4.6.3) —
  speculative
- Physics IsolatedTester subcomponent (§4.6.4) — кнопка на
  Properties tab достаточно
- F-panel last-op redo widget (Phase 3F) — Blender-specific UX,
  Ctrl-Z/Y хватает

**B — Merge / consolidate:**

- 8 modes → 5 modes (§3): Mask/Variant/Physics → editors внутри
  Layout/Rig modes
- Memory pressure monitoring → §9.1 Performance budget вместо
  Phase 5 deliverable
- Multi-window — убран из Phase 5 entirely (уже deferred to v4
  per Q2 decision)

**C — Accessibility trimmed (§9.3):**

- Screen-reader compliance → defer to v4
- High-contrast theme → автоматически из theme system, не
  отдельный work item

**D — Working Notes cleanup (§14):**

- Operator composition discussion → implementation detail, не
  decision; remove
- Selection ID stability → one-liner вместо section

**Rationale:** trim focuses v3 на Live2D-specific authoring
ценность. Removed items либо premature (scripting), либо
Blender-mimicry без clear ROI (Driver, F-panel, screen-reader),
либо overlap с existing systems (Asset Browser, Memory monitoring).
Net: -5-6 weeks, plan стал тоньше fokus'нее.

---

## 13. Estimated Total Scope **[STATUS: code-health pillars round 2 added 2026-04-28]**

| Phase | Weeks | LOC delta | Risk |
|-------|-------|-----------|------|
| Phase -1 (stability + ID unification + dead code purge) | 2-3 | -3500 | Low |
| Phase 0 (foundation + service layer + types + tooling + viewport split + ErrorBoundary + Immer undo + UUIDs + pure serializer) | 8-10 | +6500 | Med |
| Phase 1 (core editors) | 5-7 | +12000 | Med |
| Phase 2 (Live2D editors) | 8-10 | +17500 | High |
| Phase 3 (animation + ops + animation model unification + engine relocate) | 5-6 | +7500 | Med |
| Phase 4 (parity + polish + theme audit + migration safety + bundle split + PWA + i18n infra) | 7-9 | +9000 | Med |
| Phase 5 (advanced + onnx optional + configurable tags) | 5-6 | +7500 | Low |
| Phase 6 (cleanup + writers split + scripts org + python README) | 4-5 | -10500 | Low |
| **Total** | **44-56 weeks** | **~+46000 LOC** | — |

≈ **11-14 месяцев focused autonomous work.** Plus ~30% buffer for
unknowns = **15-18 calendar months**.

Code-health pillars (§15) добавляют **+15.5w** distributed across
phases, не отдельной mega-phase. Round 1 (A-L) +8w, Round 2 (M-AA)
+7.5w.

Phase -1 ships first (2-3 weeks) и unblocks v2 для текущего
использования while v3 строится parallel.

**Trim pass 2026-04-28** убрал ~5-6 weeks: Driver Editor, Text/Console/
Asset Browser editors, Telemetry, Phase 6B Scripting API, Sticker
overlay system, Multi-window in Phase 5, Heatmap+dimension wizard в
Keyform Browser, F-panel redo widget, Mask/Variant/Physics modes
(folded в Layout/Rig). См. §12 Decisions Log.

---

## 14. Working Notes

> Free-form scratch space. Add observations / mid-work thoughts /
> stuff that doesn't fit elsewhere yet. Promote to proper sections
> when patterns emerge.

### 2026-04-28 — Plan double-check audit

#### Architectural gaps fixed during audit

Some of these are reflected in updated phases above; others stay
here until promoted.

1. **Animation curves vs keyform curves are TWO different systems.**
   ~~Worth splitting §4.5 before Phase 3 starts.~~ **Done** —
   §4.5 теперь lists both Keyform Graph Editor (Phase 3C) +
   Animation F-curve Editor (Phase 3D) explicitly.

2. **PSD import wizard** становится operator. Modal остаётся как UI.
   Trigger: `file.import_psd` operator. Wizard's existing logic
   stays in `PsdImportWizard.jsx`, just invocation changes.

3. **Save / Load / Export** все становятся operators:
   - `file.save` → `projectFile.js::saveProject` (unchanged)
   - `file.load` → `projectFile.js::loadProject` (unchanged)
   - `file.export` → triggers Export modal, which gates через
     Phase 4F validation pre-flight
   Existing `exporter.js` + cmo3writer + moc3writer untouched.

4. **Viewport hit-test → selection sync subsystem.** Click in
   viewport must dispatch into selectionStore. New module
   `src/v3/editors/viewport/picking.js` в Phase 1C:
   - Mouse pick → ray vs mesh triangulation → selected.type='vertex'
     | 'face' depending on mode
   - Lattice mode: pick vs control point → 'controlPoint'
   - Rotation mode: pick vs gizmo handle → 'rotationHandle'

5. **SkeletonOverlay role split.**
   - Bone-skeleton overlay (visual hierarchy) → moves to viewport
     overlays, Phase 1C.
   - Group bbox handles (drag-to-move) → Layout mode operators
     `layout.move_group`, Phase 1A.

6. **Variant fade rule operators** не были explicit:
   - `variant.set_fade_pattern` (linear-up / linear-down /
     plateau) — Phase 2F.
   - `variant.set_backdrop_tag` — mark base mesh as backdrop
     (никогда не fade'ит). Phase 2F.

7. **Bone editor.** Group rotations + boneRole — это native bone
   system. UI: Layout mode + Outliner filter "show bones only".
   Per-bone properties: angle range, baked keyform angles. Phase
   1A Outliner + Phase 1B Properties (bone tab subset of group).

8. **Reset buttons per Properties tab.** Каждая tab имеет
   "Reset to seeded" button restoring tab-scope state from last
   Initialize Rig. Granular alternative к существующему Clear
   button. Phase 1B.

9. **Project templates.** Empty PSD = blank canvas. Templates для
   common archetypes (humanoid / chibi / animal / mascot) с
   pre-configured tags + auto-rig settings. Folded into Phase 5
   asset library entry.

10. **Memory pressure handling.** Large rigs (100+ meshes) могут
    OOM tab. Need monitoring (perf observer) + warning banner +
    suggested mitigation (split textures, reduce overlays). Phase
    4B profiler editor + Phase 5 monitoring.

#### Architectural decisions not yet captured

These need explicit calls before we hit them:

1. **Selection: volatile session state.** Не persist'ится в
   `.stretch`. Workspace layout — да. Решено.

2. **Mode-specific viewport rendering.** В Mesh mode подсвечиваем
   вершины крупнее. В Rig mode показываем lattice. В Pose mode
   скрываем оверлеи кроме physics. Mode → overlay-set mapping в
   `editorStore`. Phase 0 design.

3. **Keymap internationalization.** Different keyboard layouts
   (AZERTY, QWERTZ) have different key positions. Blender uses
   physical keys not characters. Need same: `KeyG` not `g`. Phase
   0 default keymap должен использовать `KeyboardEvent.code`, не
   `.key`.

#### Implementation tactics

- **One commit per editor/operator** during Phase 1-3, not
  bundled. Easier review + bisect.
- **Per-phase tag** as before: `v3-phase-N-complete`.
- **Per-editor demo**: when editor lands, ship a 30-second
  screencast showing it. Helps stakeholders track progress.
- **Stretch test rig** — keep using `shelby_neutral_ok.psd` для
  daily smoke; Hiyori для parity gates.

---

## 15. Code Health Refactors **[STATUS: added 2026-04-28]**

> Real costyly выявленные через grep по существующему коду.
> Распределены по существующим Phases — не новая mega-phase.
> Counts актуальны на 2026-04-28.

### A — God-class breakup

| Файл | LOC | Куда разбить | Phase |
|------|-----|--------------|-------|
| `cmo3writer.js` | 4439 | `cmo3/{parts,deformers,keyforms,masks,variants,boneBaking}.js` | Phase 6 (cleanup) |
| `CanvasViewport.jsx` | 2243 | `viewport/{Shell,tick,operators/}` | **Phase 0** (foundation) |
| `TimelinePanel.jsx` | 1639 | Заменяется Timeline+Dopesheet+Keyframe editors | Phase 3 (replaces) |
| `moc3writer.js` | 1572 | `moc3/{header,parameters,parts,deformers,artMeshes,keyforms,physics}.js` | Phase 6 |
| `Inspector.jsx` | 939 | Заменяется PropertiesEditor | Phase 1B (replaces) |
| `ExportModal.jsx` | 964 | Validation extract в Phase 4F; UI остаётся | Phase 4F |
| `SkeletonOverlay.jsx` | 888 | bone-skeleton overlay (viewport) + group handles (Layout op) | Phase 1C |
| `projectStore.js` | 736 (103 actions) | `nodesStore` / `rigStore` / `animationStore` / `versionStore` | **Phase 0** |

### B — Identifier crisis (Risk #6 unblock)

**361 references** to `partId / node.id / meshSpec.id / sanitizedName`
across 24 файлов. Не enforced что они равны → silent eval failures.

**Refactor Phase -1D (new substage):**
- Canonical `PartId` brand type (TypeScript when available, JSDoc until
  then)
- Assertion at every conversion site: `assertSamePartId(node.id,
  spec.id)`
- Test fixture: round-trip PSD → rig → eval → assert all IDs match

### C — Coord-space wrappers

**61 references** to `restX / restY` across 7 files. Каждый файл
интерпретирует frame по-своему.

**Refactor Phase 0:**
- Tagged buffer wrappers `{verts: Float32Array, frame: LocalFrame}`
- All conversions через `frameConvert.js` only
- Type system enforces (TypeScript --checkJs from Pillar G)

### D — eslint-disable hygiene

5 `react-hooks/exhaustive-deps` disabled — каждый stale closure
waiting:
- `CanvasViewport.jsx:591`
- `TimelinePanel.jsx:159, :732`
- `GizmoOverlay.jsx:80`
- 1 `no-console` disable in `variantNormalizer.js:154`

**Refactor Phase 0:** fix all с proper deps + ref pattern. Easy win.

### E — Animation model unification

5 stores касаются animation: `animationStore`, `paramValuesStore`,
`projectStore.animations`, `editorStore` (mode), `rigSpecStore`
(parameters). `draftPose` (transient) и `project.animations[]
.keyframes` (persisted) — параллельные модели одного и того же.

**Refactor Phase 3 (animation phase explicit subtask):**
- Single `animationStore` владеет и persisted keyframes и transient
  draft
- Immer-style overlay pattern: `effectivePose = base + draft`
- `paramValuesStore` остаётся (live dial position, separate concern)

### F — Service layer

Stores напрямую вызывают writers. Concerns смешаны.

**Refactor Phase 0:**
- `services/RigService` — rig build / cache / invalidate
- `services/ExportService` — pre-flight + format dispatch + progress
- `services/ImportService` — PSD / cmo3 / exp3 ingestion
- Stores хранят state, services делают работу. Editors talk to
  services через operators.

### G — TypeScript --checkJs

JSDoc-only сейчас. 24 файла используют partId mess без compiler
enforcement.

**Refactor Phase 0:**
- Enable `tsc --checkJs --noEmit` in CI
- Hot files (rigSpec, evaluator/, stores) → migrate к `.ts`
- Остальное остаётся `.js + JSDoc` — gradual

Full TypeScript migration не цель сама по себе; checkJs catches 80%
issues для 20% effort.

### H — Vitest migration

24 separate `npm run test:foo` scripts. No watch, no coverage, no UI.

**Refactor Phase 0 tooling:**
- Single `npm test` runs everything via Vitest
- Existing `.mjs` test files convert (cosmetic — `assert.ok` syntax
  stays)
- UI tests via Vitest + jsdom + @testing-library/react
- Coverage report как baseline для quality tracking

### I — Dead code audit

- `src/io/exportSpine.js` — Live2D-only project per memory. Используется?
- `cmo3writer.js:2961` — `// TODO: route face warps through head
  rotation deformer (Hiyori pattern)` — stale?
- Various commented-out blocks across codebase

**Refactor Phase -1 + Phase 6:** aggressive grep-driven audit, delete
unused.

### J — Manual ref-mirror anti-pattern

`useEffect(() => { isDirtyRef.current = true; }, [projectRef])` pattern
повторяется 7+ раз в `CanvasViewport.jsx`. Manual ref-mirroring каждого
store = anti-pattern (introduced потому что Zustand re-renders не
нужны на rAF tick).

**Refactor Phase 0:**
- Proper Zustand `subscribe(selector, callback)` pattern
- Custom hook `useDirtyOnChange(selectors[])` — declarative API
- Single subscription, не 7 useEffect'ов

### K — Migration safety

`projectMigrations.js` exists, 25 tests, но:
- No "re-migrate" fallback if migration fails midway
- No backup `.stretch.bak` of pre-migration project
- No fuzz testing

**Refactor Phase 4F (alongside export validation):**
- Auto-backup `.stretch.bak` before any migration
- "Migration failed" UI с diagnostic + restore-from-backup option
- Fuzz test: random valid `.stretch` v(N-1) → migrate → assert valid v(N)

### L — Theme audit

`themePresets.js` — 859 LOC of preset data. Multiple components
hardcode colors.

**Refactor Phase 4C (alongside theme system):**
- Audit все components, replace hardcoded colors с CSS variables
- `themePresets.js` остаётся как data, но consumed единообразно

### M — Undo memory bomb

`undoHistory.js` использует `structuredClone(project)` per snapshot,
MAX 50 snapshots. На богатых проектах (50+ meshes, тысячи keyforms,
audio tracks) это **десятки MB на snapshot × 50 = GB heap pressure**.

**Refactor Phase 0:**
- Migrate к Immer-style structural sharing — patches, не full clones
- Typed undo: per-operator delta (e.g. "moved vertex X by Δ" — не
  весь project)
- Memory budget: <10 MB total history at any time

### N — Dead code: parallel history store

`src/store/historyStore.js` (38 LOC) — Zustand store для undo с patches.
**Никем не импортируется** (grep: только self-reference). Stub comments
типа `// In a real implementation with immer patches, we'd apply…` —
никогда не написано.

**Refactor Phase -1:** удалить целиком. `undoHistory.js` это actual
implementation.

### O — onnxruntime-web bundle weight

`src/io/armatureOrganizer.js` динамически подгружает `onnxruntime-web`
(WASM) для DWPose pose estimation. Bundle включает **25MB
`ort-wasm-simd-threaded.jsep.wasm`**. Используется только в PSD
import wizard как опциональный шаг.

**Refactor Phase 5:**
- Move ML inference в optional plugin / lazy boundary
- Default PSD import без ML (heuristic-only по bbox layers)
- ML download только при user-triggered "Auto-detect joints" клик
- Альтернатива: серверная inference endpoint (out-of-scope сейчас)

### P — Math.random() ID collisions

`src/io/projectDb.js:55,150` — `Math.random().toString(36).slice(2, 9)`
генерирует ID для проектов. **7 chars × 36 alphabet = ~78 billion**,
но birthday paradox даёт collision вероятность ~50% на ~280k проектов.
Маловероятно но deterministic-non-safe.

**Refactor Phase 0:** заменить на `crypto.randomUUID()` (browser
native). Same call site, проще + collision-safe.

### Q — Mutation in serialization

`src/io/projectFile.js:37-60` мутирует input через `_sourceBlob`
placeholder + `delete t._sourceBlob`. Serialization функция должна
быть pure.

**Refactor Phase 0:**
- Pure SerializerService that returns new blob structure
- No input mutation, no temp keys
- Easier to test (snapshot input + compare output)

### R — Hardcoded KNOWN_TAGS

`src/io/armatureOrganizer.js:37-50` — 30+ tags хардкодятся (back hair,
front hair, headwear, face, irides-l/r, eyebrow-l/r, ...). Per
`feedback_measure_not_bake` memory: "auto-rig constants should derive
from character geometry, not hardcoded Hiyori values".

**Refactor Phase 5 (asset library):**
- Tag set per-project, configurable
- Default tag set остаётся (humanoid archetype) but extensible
- Per-character override через project templates

### S — No ErrorBoundary

`grep ErrorBoundary` returns 0 files. Single React error tears down
the whole app. На rich UI (10+ panels v3) это disaster.

**Refactor Phase 0:**
- Wrap each editor area в `<ErrorBoundary>`
- Crash UI: "This editor crashed. Restart it." с button reset
- Captured error logged to Performance Profiler editor
- Critical for v3 stability с 10+ editor types

### T — No i18n

All UI strings hardcoded English ("Initialize Rig", "Clear", "reset to
defaults"). User Russian-speaking (per memory user_profile.md).

**Refactor deferred to v4** unless explicit demand. Phase 4 polish
infrastructure prep:
- String extraction infrastructure (`react-intl` or similar)
- All new v3 UI uses extracted strings (`t('...')` pattern)
- Russian locale shipped if время позволяет

### U — Component naming consistency

✅ Уже OK — shadcn ui kebab-case, source PascalCase. Принятая
конвенция. **No refactor needed.**

### V — `scripts/` disorganization

30+ files mixing production tests, one-off debug tools, Python
inspectors, benchmarks. Loose collection.

**Refactor Phase 0:**
- `scripts/test/` — все `test_*.mjs`
- `scripts/bench/` — `bench_*.mjs`
- `scripts/dev-tools/` — inspect/dump scripts
- `scripts/idle/` остаётся (отдельная generator system)
- Python tools → `scripts/dev-tools/python/` с README

### W — Python tooling undocumented

`scripts/moc3_inspect.py`, `analyze_depth_psd.py` — Python tools без
README, без install instructions, без version pinning (no
requirements.txt).

**Refactor Phase 6:** `scripts/dev-tools/python/README.md` documenting
purpose, install (`pip install -r requirements.txt`), usage, expected
output.

### X — Bundle size

`npm run build` output: main chunk **1.3 MB** (gzip 397 KB). Plus
`ort-wasm-simd-threaded.jsep.wasm` **25 MB** (lazy). Build warning at
500 KB chunk threshold.

**Refactor Phase 4B (alongside Performance Profiler):**
- `vite.config.js` `manualChunks` для split: vendor / radix / lucide /
  fontsource / app
- Lazy-load editors (each editor type as own chunk)
- Bundle size budget: main chunk < 500 KB gzip
- ort-wasm только если ML feature активирована (Pillar O)

### Y — PWA hygiene unclear

`vite-plugin-pwa` зарегистрирован? Service worker offline support
работает? Install prompt? — нужен audit.

**Refactor Phase 4:**
- Audit PWA manifest + SW configuration
- Offline shell: editors load cached, project data из IndexedDB
- Install prompt UI (currently invisible?)
- Update notification ("new version available, reload")

### Z — animationEngine.js misorganized

`src/renderer/animationEngine.js` (287 LOC) computes pose overrides +
keyframe interpolation. Это **animation domain**, не renderer.

**Refactor Phase 3:**
- Move к `src/animation/engine.js`
- `src/animation/{interpolators,evaluator,curves}.js` — split by
  concern
- Renderer импортирует через service layer, не direct file

### AA — Dead components

- `src/components/Demo.jsx` — shadcn template demo, никем не
  импортируется (grep: только self-reference). Originally template
  example, забыт.
- `src/components/PhoneLayout.jsx` — mobile shell, никем не
  импортируется. Stub.

**Refactor Phase -1 (immediate):** удалить оба.

### Net impact на total scope

| Pillar | Effort | Folds into |
|--------|--------|-----------|
| A — God-class breakup | +2w incremental | Phase -1D + Phase 6 |
| B — Identifier crisis | +0.5w | Phase -1D (new) |
| C — Coord-space wrappers | +1w | Phase 0 |
| D — eslint-disable cleanup | +0.5w | Phase 0 |
| E — Animation model unification | +0.5w | Phase 3 |
| F — Service layer | +1w | Phase 0 |
| G — TypeScript --checkJs | +0.5w | Phase 0 |
| H — Vitest migration | +0.5w | Phase 0 |
| I — Dead code audit | +0.5w | Phase -1 + Phase 6 |
| J — Subscription pattern fix | +0.5w | Phase 0 |
| K — Migration safety | +0.5w | Phase 4F |
| L — Theme audit | +0.5w | Phase 4C |
| M — Undo Immer patches | +1w | Phase 0 |
| N — Delete historyStore.js | +0.1w | Phase -1 |
| O — onnxruntime optional | +1w | Phase 5 |
| P — UUID for project IDs | +0.1w | Phase 0 |
| Q — Pure serializer | +0.5w | Phase 0 |
| R — Configurable tags | +1w | Phase 5 |
| S — ErrorBoundary | +0.5w | Phase 0 |
| T — i18n infrastructure | +1w | Phase 4 (deferred locales) |
| V — scripts/ organization | +0.3w | Phase 0 |
| W — Python README | +0.2w | Phase 6 |
| X — Bundle splitting | +1w | Phase 4B |
| Y — PWA hygiene | +0.5w | Phase 4 |
| Z — animationEngine relocate | +0.3w | Phase 3 |
| AA — Delete Demo + PhoneLayout | +0.1w | Phase -1 |
| **Total** | **+15.5w** | distributed |

Updated Phase total: **47-58 weeks** focused = **12-15 months**.
Plus 30% buffer = **15-19 calendar months**.
