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

| Editor | Purpose | Phase | Status |
|--------|---------|-------|--------|
| **Preferences** | Theme, keymap, viewport options, performance | 4 | ✅ shipped (`9dab70e` + `2fee609`) — modal + KeymapModal viewer |
| **Performance Profiler** | Live frame breakdown, allocation graph, GC pauses | 4 | ✅ shipped first cut (`c7e78ba`) — FPS sampler + project / mesh / rig stats |
| **Animations** (list panel) | Browse / create / rename / delete project animations | 3 | ✅ shipped (`1264e27`) — paired with Properties as tabs in Animation workspace |

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

#### -1B — v2 R6 coord-space bug fix (3-5 days) **[STATUS: ✅ COMPLETE — paired with Phase 1E]**

Two-part fix:

- **Part 1** (commit `2397d54`): `rigDrivenParts` Set passed to scenePass;
  rig-driven parts skip `worldMatrix(part)` multiplication. Necessary
  to avoid DOUBLE rotation when the user drags a SkeletonOverlay
  rotation arc — the arc writes both `node.transform.rotation` AND
  the bone rotation parameter, and evalRig + worldMatrix would each
  apply the rotation if both ran on rig-driven parts.

- **Part 2** (commit `c07751b`, Phase 1E): chainEval applies
  `1/canvasMaxDim` scale at every rotation→warp boundary. moc3
  binary carries this conversion; cmo3 XML doesn't; the runtime
  evaluator was missing it. See Phase 1E table row + the
  Working Note "2026-04-29 — Round-2 shelby smoke test (Coord-Space
  Debugger live)" for full diagnostic trail.

Part 1 alone could not fix the symptom because the unit mismatch
inside the chain produced wrong canvas-px output regardless of how
the renderer handled it downstream.

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

### PHASE 0 — Foundation (8-10 weeks) **[STATUS: most substages shipped 2026-04-28; 0C partial, 0E + projectStore split pending]**

Substage status:

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 0A — Shell + workspace + editor type system | ✅ shipped | `a35a9b7` | Behind `?ui=v3`; 4-area 2×2 layout; 5 workspaces; editor stubs; ErrorBoundary; operator dispatcher with Ctrl+1..5. Phase 1 fills editors. |
| 0B — Service layer (Pillar F) | ✅ shipped | `0192d88` | RigService / ExportService / ImportService / PersistenceService façades with pure preflight functions. |
| 0C — Coord-space type wrappers (Pillar C) | ⚠️ partial | — | TaggedBuffer wrappers + 34 tests shipped (round-2). Integration into evalRig pipeline still pending. |
| 0D — Type checking (Pillar G) | ✅ shipped | `a3658b3` | `tsc --noEmit` runs in `npm test`. Per-file opt-in via `// @ts-check` (14 new files locked in); legacy code untouched until refactored. |
| 0E — Vitest migration (Pillar H) | ⏳ pending | — | UI tests need jsdom; .mjs scripts can stay. |
| 0F.1 — Pure helpers extraction | ✅ shipped | `1380fc6` | 8 utility functions out of CanvasViewport into `viewport/helpers.js` (-116 LOC). |
| 0F.2 — Export-frame capture extraction | ✅ shipped | `ee49cb5` | `viewport/captureExportFrame.js` (-102 LOC). |
| 0F.4 — `zoomAroundCursor` helper | ✅ shipped | `775c4b2` | Added to `viewport/helpers.js`; onWheel collapsed to 3 lines. |
| 0F.5 — File→importer routing dispatch | ✅ shipped | `db29668` | `viewport/fileRouting.js`; deduped onDrop + handleFileChange. |
| 0F.6 — Top-level ErrorBoundary in v2 (Pillar K) | ✅ shipped | `cf6aed4` | `components/ErrorBoundary.jsx` shared between v2 + v3. |
| 0F.7 — Time / frame math helpers | ✅ shipped | `59bbaa4` | `lib/timeMath.js` (clamp / msToFrame / frameToMs); 27 tests. |
| 0F.8 — Undo memory budget + `undoStats()` (Pillar M) | ✅ shipped | `06aff32` | Soft 50 MB byte cap + observability. Full Immer-patches refactor still future. |
| 0F.9 — projectStore seeders DRY'd via `projectMutator` | ✅ shipped | `bc9334e` | 14 actions collapsed to 1-liners; -62 LOC in projectStore.js. |
| 0F.10 — Pillar Q: serializer purity test | ✅ shipped | `57a1bc8` | `test_serializerPurity.mjs` locks in saveProject "no input mutation" contract. |
| 0F.11 — Rig group BFS cleanup helper | ✅ shipped | `eecaf00` | `viewport/rigGroupCleanup.js`; 16 tests for ancestor walks. |
| 0F.12 — PSD split-parts applier | ✅ shipped | `8d75afe` | `viewport/applySplits.js`; 15 tests. |
| 0F.13–0F.40 — Test coverage backfill | ✅ shipped | various | Locked down 28 critical pure modules with ~1043 tests: transforms, animationEngine, psdOrganizer, variantNormalizer, paramValuesStore, editorStore, frameConvert, animationStore, rigSpec, faceParallaxStore, rigWarpsStore, bodyWarpStore, xmlbuilder, mesh/sample, armatureOrganizer, idle/motionLib, rotationDeformers, warpDeformers, cmo3/pngHelpers, idle/builder, motion3json, io/exportAnimation, idle/paramDefaults, cdi3json, model3json, physics3json, cmo3/PHYSICS_RULES, lib/themePresets (surfaced upstream gap: discord-light missing `secondary` color, documented in KNOWN_GAPS). |
| 0F.N — Pointer events + wizard handlers + projectStore split | ⏳ pending | — | Each is large + coupled; needs browser eyes. CanvasViewport sits at ~2029 LOC after 1F sprint additions (was 2243 pre-extraction). |
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

- `src/v3/shell/AppShell.jsx` — root component (default UI since v2 retirement, 2026-04-29)
- `src/v3/shell/WorkspaceTabs.jsx` — top tabs
  (Layout/Modeling/Rigging/Animation) — round-4 OPNsense-style tab strip
- `src/v3/shell/AreaTree.jsx` — recursive split layout (uses
  react-resizable-panels)
- `src/v3/shell/Area.jsx` — single area, hosts an editor
- `src/v3/shell/AreaTabBar.jsx` — per-area tab strip (round-4 tabs-per-area model; replaced EditorHeader)
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

### PHASE 1 — Core Editors (5-7 weeks) **[STATUS: ✅ first cuts complete 2026-04-29 — 5/5 editors real; 1B 8/10 tabs shipped; 1F sprint shipped]**

Substage status:

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 1A Outliner — first cut | ✅ shipped | `3e2911a` | Hierarchy display only. treeBuilder + TreeNode + OutlinerEditor. Sort PSD-style (top of list = top of canvas). Click select / shift-add / ctrl-toggle. Visibility toggle. 47 treeBuilder tests. Drag-reparent / search / display-mode switcher / context menu / isolate-mode are scoped follow-ups. |
| 1B Properties — first cut | ✅ shipped | `33a2915` | ObjectTab only (always-present fallback): name, visibility, opacity, transform (x/y/rot/scaleX/Y), pivot (X/Y), part-only draw_order + read-only vert/tri counts. NumberField + TextField field components with edit-and-commit semantics so each keystroke doesn't snapshot undo. 9+ Phase 1B tabs remaining (Mesh / BlendShape / Deformer / Keyforms / Bindings / Parameter / PhysicsRule / Mask / Variant / Common). |
| 1A Outliner — rig display + search | ✅ shipped | `ed80762` | Display mode tabs (Hierarchy / Rig); Rig mode reads rigSpec → deformer + art-mesh tree. Search input filters by name (case-insensitive substring with id fallback); ancestors of matches are kept for context. Cycle recovery promotes unreachable subtrees to root. 67 treeBuilder + 18 filter tests. |
| 1B Properties DeformerTab | ✅ shipped | `2333d2c` | Read-only inspector for warp / rotation deformers. ID / name / parent badge; warp-specific (grid dims, vertex/keyform counts); rotation-specific (origin, angle range across keyforms); bindings list; collapsible keyforms. |
| 1B Properties ParameterTab | ✅ shipped | `20c3893` | Read-only inspector for parameter spec + live value. Range / default / current value (highlighted in primary). Linked-id rows for bone/variant/group params. ParamRow now dispatches `{type:'parameter', id}` on click (slider drag excluded). |
| 1B Properties tab strip + BlendShapeTab | ✅ shipped | `5dc822d` | Properties editor gains an internal OPNsense-style mini-tab-strip when multiple tabs apply. tabRegistry.js + tabsFor() centralise the per-selection / per-data gating predicates (16 lock-down tests). BlendShapeTab lists shapes per part with name (TextField), influence (NumberField 0..1) and trash delete; "+ add" creates zero-delta shape. Brush delta editor stays v2 — needs viewport edit-mode plumbing (Phase 2C). |
| 1C.0 Viewport — first cut | ✅ shipped | `fa60044` | Thin wrapper that mounts existing v2 CanvasViewport with stable refs. |
| 1C.1 Coord-Space Debugger overlay | ✅ shipped | `52c2f3b` | `chainDiagnose.js` pure walker + HUD. Per-art-mesh diagnosis: terminationKind (root/unknown_parent/no_parent/cycle_or_deep) + finalFrame (canvas-px/normalized-0to1/pivot-relative/unknown). Auto-mounts in v3 viewport, top-right. Issues banner in destructive color when broken chains present. Unblocks Phase 1E. 38 tests. |
| 1D Parameters — first cut | ✅ shipped | `4b01b4c` | groupBuilder + ParamRow + ParametersEditor. Groups: Opacity / Standard / Variants / Bones / Groups / Project. Adaptive step (range ≥5 → step 1, sub-5 → 0.01). Reset to defaults. 23 groupBuilder tests. |
| 1E Coord-space bug fix (part 1) | ✅ shipped | `c07751b` | Rotation→warp scale = 1/canvasMaxDim in DeformerStateCache. moc3 binary carries this conversion; cmo3 XML doesn't expose it; runtime evaluator was missing it. Necessary but not sufficient — the chain still produced face-collapsed-to-line output because of the bilinearFFD clamp (see part 2). |
| 1E Coord-space bug fix (part 2) | ✅ shipped | `867cc29` | bilinearFFD extrapolates linearly outside [0,1] instead of clamping. Required because face pivot's y projects to v ≈ −0.043 of BodyXWarp's input (face is above the warp's region by design); clamp collapsed every face vertex to row 0. Cubism's runtime extrapolates — confirmed by reproducing the canvas→BodyX→Breath→BodyY→BodyZ chain reversal under uniform-grid extrapolation, which lands face pivot back at the rest canvas y. |
| Aux: Initialize Rig in v3 | ✅ shipped | `6b65475` | RigService.initializeRig() bundles harvest + seedAllRig + rigSpec cache + paramValues reset. Wired to button in v3 ParametersEditor (empty-state + header). |
| Aux: app.undo / app.redo | ✅ shipped | `433715c` | Operators + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z bindings (Meta variants for macOS). |
| Aux: file.save / file.load | ✅ shipped | `6be37f7` | Operators + Ctrl+S / Ctrl+O bindings. Global toolbar in WorkspaceTabs with Undo / Redo / Open / Save buttons. Save button shows dirty dot. |
| Aux: selection.clear / file.new | ✅ shipped | `d28abbd` | Esc → drop selection; Ctrl+N / Meta+N → reset project. |
| Aux: file.export | ✅ shipped | `b2ee3a4` | Ctrl+E / Meta+E + toolbar Download button. Defaults to live2d-full (cmo3 + rig + physics + motions) so the user gets the editable Cubism Editor round-trip without going to v2's ExportModal. Phase 5 surfaces format choice / atlas size / per-physics toggles. |
| 1B Properties tab strip + VariantTab | ✅ shipped | `534731a` | Read-only inspector for variant relationships. Variant child shows base part + suffix + `Param<Suffix>` + canonical fade rule (variant 0→1, base 1→0 unless backdrop). Variant base lists children + backdrop status. tabRegistry tests bumped 16 → 22. |
| 1B Properties · MeshTab / MaskTab / PhysicsTab | ✅ shipped | `6c3c39d` | MeshTab: vertex/triangle counts, UV bbox, gridSpacing input + Regenerate Mesh action (drives the existing mesh worker via captureStore.remeshPart bridge). MaskTab: read-only "masked by" / "masks for" lists with click-to-select chips. PhysicsTab: lists physics rules whose outputs target the selected group's `ParamRotation_<sanitised>`. DeformerTab already covers Bindings + Keyforms inline so those stay folded into the deformer view. 8/10 of the original 1B-tab list now real (Object / Mesh / BlendShape / Mask / Physics / Deformer / Parameter / Variant); KeyformsTab + BindingsTab folded into DeformerTab; CommonTab pending bulk multi-select work. |
| 1B Properties · MaskTab edit (add/remove) | ✅ shipped | `76fa3e0` | Adds dropdown picker + per-chip × button so the user can wire / unwire mask relationships from the same surface that displays them. Phase 2F first-cut wrapped into Phase 1B's Mask tab. |
| 1B Mesh remesh bridge | ✅ shipped | `6c3c39d` | New `captureStore` (Phase 5 originally; reused here) carries a `remeshPart(partId, opts)` ref published by ViewportEditor. MeshTab calls it with `gridSpacing` opts, mirroring the v2 `computeSmartMeshOpts` shape so the existing mesh worker accepts the call unchanged. |

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

### PHASE 1F — Pipeline Stability Sprint (2026-04-29) **[STATUS: shipped]**

Unplanned hardening pass that landed between the Phase 1 first cuts and
Phase 2 work. The shelby.psd smoke test surfaced multiple coord-pipeline
bugs at the seams between the new Coord-Space Debugger (1C.1), the
extended Viewport (1C.0), and the live param scrubber (1D / R9 physics).
Each substage was a focused fix with diagnostic-first methodology rather
than a planned editor cut.

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 1F.1 SkeletonOverlay pointer-events | ✅ shipped | `bae1ef2` | SVG parent had `pointerEvents:'none'`; child joint `<circle>` and iris `<rect>` were not overriding. Fix: set `pointerEvents:'visiblePainted'` on each. Restored joint click + iris trackpad in v3 viewport. |
| 1F.4 bone-baked artParent in rigSpec | ✅ shipped | `942bc30` | Arms chained to `rotation:<jointBoneId>` deformers that the boneParamGuids skip path never created → 18 broken chains in chainDiagnose HUD. Fix mirrors XML fallback: parent to `GroupRotation_<armGroup>` if it has a deformer, else root with canvas-px re-encoded keyforms. shelby went from 18/2 to 20/0 broken-chain count. |
| 1F.5 chainEval anisotropic warp-parent scale | ✅ shipped | `2cf81c0` | Phase 1E's `1/canvasMaxDim` was guessed from Cubism shelby.moc3 binary diff but only matches Hiyori's body-warp-spans-canvas geometry. For shelby the actual `canvasToInnermostX/Y` slope is ~5× larger → face/arms shrunk toward body axis. Fix: read slope from `rigSpec.canvasToInnermostX/Y` (already exposed by cmo3writer) at evalRig start; apply anisotropic per-axis via new `buildRotationMat3Aniso` helper. Falls back to 1/cmd when canvasToInnermost is null (synthetic test rigSpecs). User confirmed: "Работает, персонаж ПОЛНЫЙ". |
| 1F.6 Live Preview / Edit-mode separation | ✅ shipped | `d875f72` | New `livePreviewActive` flag in editorStore. Edit mode (default): physics tick + breath + cursor look gated off; sliders are the only writers to paramValuesStore — they don't dance during editing. Live Preview mode: physics runs, ParamBreath auto-cycles at Cubism's ~3.345s standard, LMB-drag drives ParamAngleX/Y/Z (±30°). Toggle button + status text in ParametersEditor header. Snapshot/restore around the session preserves slider values. **(Superseded 2026-05-02 by GAP-010 — `livePreviewActive` removed; drivers now bound to `<LivePreviewEditor>` mount lifetime so Pose/Animation workspaces show edit Viewport + Live Preview side-by-side. See [docs/FEATURE_GAPS.md](FEATURE_GAPS.md#-gap-010--live-preview-as-its-own-area-tab).)** |

**Why this sprint exists:** Phase 1's first cuts were architecturally
correct but the integrated viewport had four orthogonal pipeline bugs
that only show up on a real PSD with arms + non-square canvas. Without
this hardening pass, Phase 2 would have been built on a viewport where
arms fly off / face vanishes / sliders bounce, masking real Phase 2 bugs.

**Methodology:** Coord-Space Debugger (1C.1) was the load-bearing tool —
each fix started with `dump` table inspection, not source diving. 1F.4
and 1F.5 were diagnosed entirely from HUD output before touching a file.

**Follow-ups deferred to later sprints:**
- 1F.2 Initialize Rig options dialog (skip-hair / skip-physics / etc.)
- 1F.7 Residual param-bouncing diagnosis if any reports come in

---

### PHASE 1G — Basic Save/Load (IndexedDB) **[STATUS: ✅ shipped 2026-04-29 (`00437ef`); SUPERSEDED by Phase 5 SaveModal+gallery (`2be491b`)]**

**Why:** v2 retirement (commit `15f75e3`, 2026-04-29) deleted
`LoadModal` / `SaveModal` / `ProjectGallery` (IndexedDB-backed in-app
project save/load). User flagged the gap same day — saving a project
to disk is fine but the in-app library is gone. Phase 5 has the
gallery with thumbnails on the roadmap but that's months out; basic
save/load is a small surface we can ship now.

**Scope:** Minimum viable IndexedDB persistence — no thumbnails, no
gallery UI. Just "save current project under a name" / "list saved
projects" / "load by id". Phase 5 supersedes this with the full
gallery + thumbnails + per-project metadata.

**Files:**
- `src/io/projectDB.js` — IndexedDB layer: `saveToDB(name, project)`,
  `loadFromDB(id)`, `listProjects()`, `deleteFromDB(id)`. One
  object store, key = uid, value = `{ id, name, savedAt, project }`.
- `src/services/PersistenceService.js` — extend with
  `saveToLibrary` / `loadFromLibrary` / `listLibrary` over projectDB.
- `src/v3/operators/registry.js` — `file.saveToLibrary` (prompts for
  name) + `file.loadFromLibrary` (modal picker list) +
  `file.deleteFromLibrary`.
- UI entries in `WorkspaceTabs` toolbar (no Ctrl+S binding —
  Ctrl+S stays file-export-to-disk).

**Deliverables:** ~5 new files, ~400 LOC. Restores the in-app
save/load surface that v2 had.

---

### PHASE 2 — Live2D-specific Editors (8-10 weeks) **[STATUS: first cuts shipped 2026-04-29 — display-only overlays + paint arming + mask CRUD + 2H modal G/R/S; standalone Keyform/Physics/Variant editors deferred]**

**Goal:** Native editing of warps/rotations/keyforms/physics/masks/
variants.

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 2A Warp Deformer Editor — overlay | ✅ shipped (display) | `d730ff1` | `WarpDeformerOverlay.jsx` SVG over-canvas. Projects warp `keyforms[0].positions` through editorStore.view (zoom + pan) and renders grid lines + control points in cyan. Only handles `localFrame === 'canvas-px'` warps (top-level Body / Face / Breath chain); nested `normalized-0to1` warps show a hint banner — they need parent-grid resolution that's deferred until 2A drag-edit lands. Read-only first cut; drag-to-edit folds into 2C Keyform Editor. |
| 2B Rotation Deformer Editor — overlay | ✅ shipped (display) | `d730ff1` | `RotationDeformerOverlay.jsx` — pivot dot + circle-radius dashed ring + amber angle handle. Same canvas-px-only restriction as warp overlay; pivot-relative children show the same hint banner. Display-only first cut. |
| 2C BlendShape Paint Editor | ✅ shipped | `bb7421c` | The v2 viewport already paints blend shape deltas when `editorStore.blendShapeEditMode + activeBlendShapeId` are set; v3 just needed UI. Each shape row in BlendShapeTab now has a Brush toggle button; armed shape highlights in primary color and a Brush Settings section exposes size + hardness sliders. Drag-in-viewport paint works end-to-end through existing v2 brush logic — no new viewport code. |
| 2D Keyform Editor | ⚠️ folded | — | DeformerTab inline keyform list (Phase 1B) covers the read surface. Standalone keyform browser with cross-product cell preview + diff viewer (`SparseGrid` + `CellPreview` + `diffViewer`) is deferred — mutating keyforms requires writing to the `project.rigWarps` / `bodyWarp` / `faceParallax` / etc. stores then invalidating rigSpec, which is a deeper schema refactor than fits a first-cut. |
| 2E Physics Editor | ⚠️ folded | — | PhysicsTab (Phase 1B) lists matching physics rules with their inputs / vertex chain / output paramIds — read-only first cut. Full editor with `ChainOverlay` / `ParticleTable` / `Input/OutputDropZone` is deferred. |
| 2F Mask Editor | ✅ shipped (CRUD) | `76fa3e0` | MaskTab gains add/remove via dropdown picker + per-chip × button. Mutates `project.maskConfigs` (creating new entries when none yet exist for the part) and cleans up the legacy `node.mesh.maskMeshIds` reference on delete. Phase 2F first cut wrapped into the existing 1B tab rather than a separate editor. |
| 2G Variant Manager | ⚠️ folded | — | VariantTab (Phase 1B) shows variant child + base relationships read-only with click-to-jump. Standalone variant manager (multi-select pairing UI, suffix bulk-rename, "promote to base") is deferred. |
| 2H Modal operators G/R/S | ✅ shipped (first cut) | sweep #2 | `ModalTransformOverlay.jsx` + `modalTransformStore.js`. Bare G/R/S keys begin a Blender-style modal transform on the selected nodes. Mouse-drag commits live deltas. X/Y axis-constrain toggles; Shift snaps (10 px / 15° / 0.1×). Click / Enter commit, Esc / right-click cancel + revert. Single undo entry per modal session via `beginBatch` / `endBatch`. Numeric typed input deferred to a later polish pass. |

**Why most editors landed as overlays / Properties tabs rather than dedicated editors:** The user's directive on 2026-04-29 was "skip tests, complete all phase first cuts, then fix bugs." First cuts shipped as either display overlays mounted on ViewportEditor or as edit actions wrapped into the existing Phase 1B Properties tabs. Full standalone editors with their own modal operator sets, ghost previews, X-symmetry tools, particle drop-zones etc. need a separate sweep that's tracked as Phase 2 polish rather than first-cut. Tag `v3-phase-2-complete` will be claimed only after that polish lands.

**Files actually shipped (Phase 2 first cuts):**
- `src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx`
- `src/v3/editors/viewport/overlays/RotationDeformerOverlay.jsx`
- `src/v3/editors/properties/tabs/BlendShapeTab.jsx` (Brush toggle UI added)
- `src/v3/editors/properties/tabs/MaskTab.jsx` (add/remove CRUD added)

**Phase 2 deliverables (final target):** ~120 new files, ~18000 LOC. Tag
`v3-phase-2-complete` reserved for the full standalone-editor sweep.

---

### PHASE 3 — Animation + Operator Polish (5-6 weeks) **[STATUS: 3A+3F-lite shipped 2026-04-29; graph + dopesheet + F3 palette pending]**

Includes Pillar E (animation model unification — single
`animationStore` owns persisted keyframes + transient draft via
Immer overlay) and Pillar Z (move `animationEngine.js` from
`renderer/` to `src/animation/{engine,interpolators,evaluator,curves}`).

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 3A Timeline Editor | ✅ shipped | `0379c7d` | Restored upstream `TimelinePanel` verbatim into `v3/editors/timeline/TimelineEditor.jsx`, then extended with `rowKey` discriminator so param tracks (`{paramId, keyframes}`) render alongside node tracks (`{nodeId, property, keyframes}`). Drag / copy / paste / easing / audio sync, box-select with `param:`/`node:` prefix routing. |
| 3A.1 Param keyframe plumbing | ✅ shipped | `93aa1e4` | `track.paramId` was already supported by motion3json + can3writer exporters but engine / viewport / UI didn't drive it. 4-file plumbing landed: `animationEngine.js` adds `computeParamOverrides` + `setParamKeyframeAt`; `CanvasViewport` merges param overrides into `valuesForEval` before chainEval; `ParamRow` auto-keyframes in animation mode + autoKeyframe; TimelineEditor displays param rows on top of node rows. |
| 3B Dopesheet Editor | ✅ shipped (first cut) | sweep #2 | `DopesheetEditor.jsx` registered as `dopesheet` editor type, paired with Timeline tab in the Animation workspace. One row per track (param + node) with a tick per keyframe + a ruler. Click a tick or anywhere on the timeline to seek. Read-only: editing still happens through Timeline / auto-keyframe. |
| 3C Keyform Graph Editor | ✅ shipped (read-only first cut) | sweep #4 | `KeyformGraphEditor.jsx` registered as `keyformGraph` editor type. Picks the active part's `project.rigWarps[partId]`, walks the FIRST binding's `keys[]` and plots scalar magnitude (`mean(‖position − baseGrid‖)` per keyform whose `keyTuple[0]` matches and other slots are 0) vs paramValue. Read-only first cut; per-binding tabs + 2D heatmap + drag-handle bezier handles deferred. |
| 3D Animation F-curve Editor | ✅ shipped (read-only first cut) | sweep #3 | `FCurveEditor.jsx` plots one track's value-over-time curve via live `interpolateTrack()`, picks track from selection (parameter / part / group). 240 sample points, keyframe diamonds + playhead + click-to-seek. Read-only first cut; drag-handle bezier editing deferred. |
| 3E F3 Operator Search Palette | ✅ shipped | sweep #2 | `CommandPalette.jsx` cmdk dialog. F3 toggles. Recent group (5 entries, persisted via `commandPaletteStore` + localStorage), All operators group with chord hints. Greyed when `op.available()` returns false. |
| 3F Modal operator polish | ✅ shipped (first cut, see 2H) | sweep #2 | Axis constrain (X/Y) + Shift snap shipped via 2H modal G/R/S. Numeric typed input + grid-snap operator-side deferred. ParamRow's right-click / double-click → reset-to-default (commit `76fa3e0`) covers the parameter-side reset gesture. |
| AnimationsEditor (new editor type) | ✅ shipped | `1264e27` | Bonus deliverable not in original plan. Lists every animation with create / inline rename / delete (with confirm) / click-to-switch. Active row highlighted, duration shown in seconds. Animation workspace's leftBottom area pairs it with Properties as tabs. |

**Phase 3 deliverables:** Tag `v3-phase-3-complete` reserved for the full graph editor + F-curve editor sweep. As of sweep #2 (2026-04-29) Phase 3 has 3A + 3A.1 + 3B + 3E + 3F-lite shipped — only 3C (Keyform Graph) and 3D (Animation F-curve) remain.

---

### PHASE 4 — Reference Parity + Polish (7-9 weeks) **[STATUS: 4B + 4C + 4D + 4E-lite + 4F + 4G shipped; 4A parity harness + 4H PWA + 4I theme audit + 4J i18n pending]**

| Substage | Status | Commit | Notes |
|----------|--------|--------|-------|
| 4B Performance Profiler editor | ✅ shipped (first cut) | `c7e78ba` | `PerformanceEditor` registered as `performance` editor type. Live FPS sampler via rAF, last-second avg frame ms, 30s sparkline. Project / mesh / rig stats: node / part / group / texture / animation / parameter / mask / physics counts; total verts + tris + heaviest part by vertex count; warp / rotation / art-mesh counts; last-built rigSpec geometry version. The FPS counter samples browser repaint rather than the rig evaluator itself — a real GPU profiler is deferred until CanvasViewport exposes per-pass GL query timings. |
| 4C Preferences editor | ✅ shipped | `9dab70e` (initial) + `2fee609` (Keymap) | `PreferencesModal` exposes theme mode (light / dark / system), preset picker (existing ThemeProvider modal), font family Select, font size Slider. The Cubism-compat preset is deferred to Phase 4I (theme audit) when hardcoded color sweeps land. |
| 4D Keymap viewer | ✅ shipped (read-only) | `2fee609` | `KeymapModal` opened from Preferences "View shortcuts…" button. Lists every chord → operator binding from `DEFAULT_KEYMAP` with the operator's user-facing label, prettified chord display (`KeyA → A`, `Period → .`, `Meta → ⌘`, etc.) and a free-text filter. Editing the keymap is deferred until per-user keymap persistence lands (would need localStorage round-trip + chord-conflict detection). |
| 4E Help / Onboarding | ✅ shipped (first cut) | sweep #2 | F1 → `HelpModal.jsx` quick-reference. Workspace overview + common chord cheat-sheet + "View all shortcuts…" link to KeymapModal. Static content; per-editor context help deferred until editor surfaces stop changing weekly. |
| 4F Export validation | ✅ shipped | sweep #2 | `validateProjectForExport()` pure checker (`io/exportValidation.js`) wired into ExportModal. Errors block export by default (override checkbox), warnings inline. Click-to-jump on issues with `nodeId`. Codes: `NO_PARTS`, `PART_NO_MESH`, `PART_NO_TRIS`, `PART_UV_LENGTH`, `PART_NO_TEXTURE`, `ORPHAN_PARENT`, `MASK_TARGET_MISSING`, `MASK_MESH_MISSING`, `VARIANT_BASE_MISSING`, `PARAM_BAD_RANGE`, `NO_PARAMETERS`, `TEXTURE_MISSING`, `ANIM_EMPTY`. |
| 4G Bundle splitting | ✅ shipped | sweep #2 | `vite.config.js` `manualChunks`: vendor-react / vendor-radix / vendor-lucide / vendor-cmdk / vendor-state / vendor-onnxruntime / vendor-fontsource / vendor catch-all. Index chunk dropped from 1.3 MB / 395 KB gzip to 601 KB / 173 KB gzip with vendor cached separately across deploys. |
| 4A Reference parity harness | ⏳ pending | — | Side-by-side viewer with Hiyori, numeric snapshot fixtures via cubism-web SDK oracle. Not started. |

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

#### 4H — PWA hygiene (Pillar Y) **[STATUS: manifest + meta shipped sweep #3; SW caching deferred]**

- ✅ `public/manifest.webmanifest` — name / short_name / description / start_url / display: standalone / theme_color / icons. Browsers (Chrome / Edge / Safari) recognise the app as installable.
- ✅ `<link rel="manifest">` + `theme-color` + Apple-specific meta in `index.html`.
- ⏳ Service-worker caching for offline shell: deferred — hand-rolled SW lifecycle without a tested integration risks shipping stale assets. Future pass adopts vite-plugin-pwa.
- ⏳ Install prompt UI / "new version available" notification: deferred until SW lands.

#### 4I — Theme audit (Pillar L) **[STATUS: overlay + sparkline pass shipped sweep #3]**

- ✅ `WarpDeformerOverlay`, `RotationDeformerOverlay`, `PerformanceEditor` sparkline: replaced `rgb(...)` literals with `currentColor` / Tailwind utility classes (`text-amber-400`, `text-sky-400`, `stroke-slate-900/85`, `stroke-muted-foreground/25`). SVG fill / stroke now flow through Tailwind so theme presets re-skin overlays without rewriting rgb literals.
- ⏳ Full sweep across every component for hardcoded colors deferred — Timeline shadow / glow effects (`shadow-[0_0_15px_rgba(var(--primary)...)]`) already use CSS variables, but a complete `themePresets.js` audit is its own pass.

`themePresets.js` остаётся как data, consumed единообразно через theme system.

#### 4J — i18n infrastructure (Pillar T) **[STATUS: scaffold + RU locale shipped sweep #4]**

- ✅ `src/i18n/index.js` — `t()` / `useT()` lookup with `en` default + `ru` registered. zustand store carries `locale` + `dictionaries`. Missing keys fall back through ru → en → raw key so a non-translated string is visible during dev rather than blank.
- ✅ `CommandPalette.jsx` wraps placeholder / empty / heading strings via `useT()` — proof of concept that the wrapping pattern doesn't add visible cost.
- ⏳ Per-locale switcher in Preferences modal — deferred (would also need to localStorage-persist the choice).
- ⏳ Wrap-the-rest sweep across remaining v3 components — mechanical follow-up.

react-intl was considered but dropped: 60+ KB gzip is heavy for a
pure key→string lookup, and plural / date formatting isn't on the
immediate roadmap (every UI string today is a literal sentence).
When complex formatting becomes a requirement we swap the `t()`
implementation; call sites stay the same.

---

### PHASE 5 — Advanced (5-6 weeks) **[STATUS: 2026-04-29 — Save/Load gallery + Export modal + cmo3 round-trip + asset hot-reload + onnx-opt-in + touch refactor + physics import + motion timeline scrubbing all shipped first-cut]**

| Feature | Status | Commit | Notes |
|---------|--------|--------|-------|
| **Save Modal + Project Gallery + thumbnails** | ✅ shipped | `2be491b` | `SaveModal` (tabbed: Save to Library / Download File) + `ProjectGallery` (thumbnail grid, per-card duplicate/download/delete, inline rename) + `LoadModal` (gallery + Import Project tile). Replaces the placeholder `LibraryDialog`. Thumbnail capture goes through new `captureStore` that ViewportEditor publishes on mount; the modals pull from it without prop-drilling. Toolbar Save/Library and Open/Library buttons collapsed into single Save and Open buttons that drive the modals. |
| **Export options modal** | ✅ shipped | `d24b166` | `ExportModal` surfaces the three formats `ExportService` supports — Live2D Runtime+AutoRig (default), Live2D Runtime without rig, and editable Cubism `.cmo3`. Each option has a description so the user picks deliberately rather than relying on muscle memory. The `file.export` operator now just opens the modal; the modal owns runExport, the texture-loading step, and the download trigger. New `exportModalStore`. |
| Physics Editor — Cubism import | ✅ shipped (first cut) | sweep #5 | `io/live2d/physics3jsonImport.js` reverse-parses `.physics3.json` v3 back into the resolved `physicsRules` shape; `PhysicsTab` exposes an Import button that swaps the in-project rules in place + shows a warning banner for skipped settings (missing inputs/outputs, vertex count <2, unknown source/destination paths). Round-trip from SS-exported physics3 is identity-on-numeric-fields; tag/category default to `imported`. |
| Motion timeline scrubbing | ✅ shipped (first cut) | sweep #5 | TimelineEditor now switches between multiple `project.animations[]` via a `<select>` (active id stored in `animationStore`). New `+ New` button creates a fresh blank animation; `+ Import` loads `.motion3.json`. `io/live2d/motion3jsonImport.js` collapses bezier segments to their end-points (control points dropped — SS animation engine doesn't ingest per-segment cubic handles). Real cross-fade blending deferred. |
| Live2D round-trip .cmo3 import | ✅ shipped (first cut) — drop a .cmo3, click Import, get a working rig | sweeps #8–#19 | **#8:** CAFF unpacker + inspect modal + file.inspectCmo3. **#9:** XStream-style XML parser + structural part / group / texture extraction. **#10:** `cmo3Import.js` → loadProject-ready SS project (geometry + textures + parameters as static reference scene). **#11:** structural deformer extraction (CWarpDeformerSource + CRotationDeformerSource + chain links). **#12:** keyform binding graph (which parameter values each cell of a deformer's grid represents). **#13:** `buildRigWarpsFromScene` synthesises `project.rigWarps[partId]` for warp-parented parts (18/20 on shelby; rest pose derived from the keyform whose access keys resolve to all-zero param values). **#14:** explicit warning + diagnostics for parts under rotation deformers. **#15:** `applyRotationDeformersToGroups` mirrors cmo3 rotation deformers onto group `boneRole` + `transform.pivotX/Y` so writer's auto-rig produces equivalent rotations on re-export (handwear-l/r warning gone — re-export's per-mesh inline path generates a warp parented to GroupRotation_<role>). **#16:** `resolveRigWarpParent` walks each warp's parent chain to map cmo3 named ancestor → SS named structural warp (FaceParallax/NeckWarp/BodyXWarp); fixes evalRig chain walk for face/eye/brow/hair regions in v3 viewport. **#17:** `project.maskConfigs[]` synthesised from each part's `clipGuidList` via `ownDrawableGuidRef` → SS-node-id resolver. **#18:** `normalizeVariants` paired into the import — `face.smile` → `variantOf=face, suffix=smile`. **#19:** `Cmo3InspectModal` auto-runs `useRigSpecStore.buildRigSpec()` after `loadProject`, so the v3 viewport gets a working rig immediately (no manual Initialize Rig click). End-to-end verified against `shelby.cmo3`: 31 nodes / 20 textures / 31 parameters / 18 stored rigWarps / 7 boneRoles populated / 2 maskConfigs / 1 variant / rigSpec post-import = 26 warps + 9 rotations + 20 art meshes. **Pending follow-ups (model-specific):** physics rules (cmo3-embedded path; shelby has none, separate physics3.json import already shipped), bone-baked angles (per-mesh CWarpDeformerForm + ParamRotation_<role> binding decode; shelby's auto-rig doesn't bake bone keyforms by default). |
| Asset library + project templates (Pillar R) | ✅ shipped (templates first cut) | sweep #4 | `v3/templates/projectTemplates.js` registry — id / name / description / `apply(project)` mutator per template. New Project flow now opens `NewProjectDialog` with template radio + dirty-state warning. Initial templates: Empty / Square 1024 / Portrait HD / Landscape FHD — each tweaks canvas dimensions + name. Saved deformer / physics / variant configs + starter rigs deferred. Configurable tag set per project deferred. |
| Asset hot-reload | ✅ shipped (first cut) | sweep #6 | `io/assetHotReload.js` uses `showDirectoryPicker` (Chromium-only) + 1.5 s `lastModified` polling to swap `project.textures[].source` blob URLs in place via `updateProject(..., {skipHistory:true})`. Old blob URLs revoked after a 5 s grace so in-flight `Image` decodes don't break. Toolbar Link/Unlink button + `assetHotReloadStore` Zustand store. PSD layer name → file basename matching (case-insensitive); unmatched files reported in status. |
| Touch / pen refactor | ✅ shipped (first cut) | sweep #7 | Multi-pointer pinch+pan gesture in `CanvasViewport`: `activePointersRef` Map tracks every pointer down; when 2 touch pointers land simultaneously and no vertex/brush drag is in flight, `gestureRef` enters `pinch` mode with zoom-around-startMidpoint + two-finger pan superimposed. `onPointerCancel` wired so OS touch interruption (notification, system swipe) cleanly exits the gesture. `pointer-coarse:` Tailwind variant bumps v3 toolbar buttons + workspace tabs to ~44 px hit targets on touch primary-input devices. **Deferred:** pen pressure for warp lattice editing — needs incremental brush integration (current brush is start-snapshot + delta, not stroke-cumulative); pulling pressure into that math is its own sweep. |
| onnxruntime-web optional (Pillar O) | ✅ shipped (first cut) | sweep #6 | `vendor-onnxruntime` already split into its own chunk via `manualChunks` (4G); the chunk is now also dynamically `import()`-ed only when `pickAutoRig()` runs (already shipped pre-sweep) AND a new user-visible toggle gates the AI Auto-Rig button entirely. `preferencesStore.mlEnabled` (localStorage `v3.prefs.mlEnabled`, default `true`) drives both `PsdImportWizard` (button hidden when off) and `PreferencesModal` → AI features section. With the toggle off, the ONNX chunk is never fetched — heuristic-only rigging stays. |

---

### PHASE 6 — Migration & Cleanup (4-5 weeks) **[STATUS: all non-UI god-class breakups shipped — cmo3writer (4468→1076, −76%), moc3writer (1573→476, −70%), can3writer (857→117, −86%), cmo3Import (884→315, −64%), cmo3PartExtract (680→264, −61%) across 48 helper modules; sweeps #24-#50 2026-04-29/30. UI splits (CanvasViewport, TimelineEditor, projectStore, themePresets) deferred — need browser-eyes verification]**

- Remove old shell entirely
- Remove `?ui=v3` killswitch (now default)
- Remove old ParametersPanel, EditorLayout, etc.
- **God-class breakup, round 2** (Pillar A continuation):
  - `cmo3writer.js` — **🟡 in progress** (4468 → 2634 LOC, −1834,
    **−41%**). 22 modules under `src/io/live2d/cmo3/`. The original
    `{parts,deformers,keyforms,masks,variants,boneBaking}` target
    didn't survive contact with the actual code; replaced by
    cohesion-driven units shipped across sweeps #24-#33 (2026-04-30):
    - Pre-existing (Sessions 19-28): `constants.js`, `bodyRig.js`,
      `deformerEmit.js`, `faceParallax.js`, `physics.js` (509 LOC),
      `pngHelpers.js`.
    - Sweep #24: `rigWarpTags.js`, `paramCategories.js` (72 tests),
      `groupWorldMatrices.js` (18 tests).
    - Sweep #25: `eyeClosureFit.js` (27 tests, drops orphaned
      `extractBottomContour` import from writer).
    - Sweep #26: `eyeClosureApply.js` (35 tests). Unblocks future
      `lashStripFrac`-driven A/B comparison without forking writer.
    - Sweep #27: `globalSetup.js` (Section 1, 250 LOC — bundle of all
      shared pid setup: core GUIDs, paramDefs from paramSpec, group
      part guids, 19 filter pids); `modelImageGroup.js` (Section 5);
      `mainXmlBuilder.js` (Section 6, 313 LOC — full main.xml root +
      CModelSource + parameter group set + Random Pose manager);
      `caffPack.js` (Section 7).
    - Sweep #28: `meshLayer.js` (per-mesh ModelImageFilterSet +
      GTexture2D + CTextureInputExtension + Section 2b
      `fillLayerGroupAndImage`).
    - Sweep #29: `partHierarchy.js` (Section 3 — `makePartSource`
      boilerplate + full Root/Group/Mesh _childGuids wiring).
    - Sweep #30: `bodyChainEmit.js` (Section 3d head — translates
      `buildBodyWarpChain` specs into XML); `lookupStandardParamPids`
      added to globalSetup.js.
    - Sweep #31: `meshVertsWarp.js` (Section 3b CWarpDeformerSource
      per-mesh-vert-anim, 328 LOC; IDW propagation +
      buildRestGrid math + per-keyframe CWarpDeformerForm
      emission); `rotationDeformerEmit.js` (Section 3b ROTATION
      DEFORMERS per group, 307 LOC; CRotationDeformerSource +
      per-keyform CRotationDeformerForm with origin in
      parent-deformer-local space; returns groupMap +
      deformerWorldOrigins + groupDeformerGuids + the re-parenting
      target/origin nodes for section 3d).
    - Sweep #32: `structuralChainEmit.js` (Section 3d, 221 LOC;
      orchestrates emitBodyWarpChain → emitNeckWarp →
      emitFaceRotation → emitFaceParallax + the re-parenting pass
      for rotation deformers ROOT → Body X with origin conversion
      + per-part rig warp re-parenting to FaceParallax / NeckWarp
      / Body X. Drops emitBodyWarpChain + emitNeckWarp +
      emitFaceRotation + emitFaceParallax + emitPhysicsSettings
      imports from the writer).
    - Sweep #33: `maskResolve.js` (Section 4 head, 130 LOC; Stage 3
      native-rig path + heuristic fallback for variant-aware
      iris/eyewhite mask pairing).
    - **Pending** (3 big per-mesh emission loops, 700+840+600 ≈
      2140 LOC of remaining writer state coupling): section 2 layer
      + keyform emission, section 3c per-tag rig warp emission, and
      section 4 CArtMeshSource emission. Each iterates `perMesh`
      and reads ~25 closure variables (rigCollector + pid maps +
      bbox/curve/origin lookups). Future sweeps need a shared
      `EmitContext` object plumbed once before the loop.
  - `moc3writer.js` (1573 LOC) — **⏳ untouched**. Target shape per
    the original plan: `moc3/{header,parameters,parts,deformers,
    artMeshes,keyforms,physics}.js`. Each section is more
    cohesively bounded than cmo3writer's (binary writer with
    fixed-offset section emit) so likely a cleaner cut. Schedule
    after cmo3writer round-3 sweeps complete.
- ✅ Python tooling README (Pillar W) shipped sweep #4 — `scripts/dev-tools/README.md` documents the five moc3 inspectors + depth-PSD analyzer + body verifier (purpose, install, invocation).
- Final dead code audit (round 2)
- Documentation pass: full user manual + dev guide
- Performance audit — re-bench v2 evaluator under v3 shell
- **Surfaced during sweep #25 RCA** (orphan `GroupRotation_*`
  deformers — see deferred-bugs section): the rig-warp ↔
  rotation-deformer chain wiring needs a writer-level fix before
  Phase 6 final tag. Touches the rig-warp grid coord-space
  convention; needs Hiyori parity validation. Listed here so it
  doesn't slip through to a "v3-shipped" tag with the bug intact.

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

### 2026-04-29 — Round-2 shelby smoke test (Coord-Space Debugger live)

User loaded shelby.psd in `?ui=v3`, ran Initialize Rig, observed:

**Coord-Space Debugger HUD reading.** 18 clean / 2 broken. The two
broken chains are `handwear-l` and `handwear-r` (gloves). Most parts
have CLEAN chains terminating at root (canvas-px output).

**Visible symptoms.**
- Face / head meshes are missing entirely (gone or off-canvas).
- Both arms float to the LEFT of the body, stacked together at
  what looks like canvas (~200, ~400) — a fixed shift, not random.
- Body (jacket) renders roughly at the correct canvas position.
- ParamAngleX/Y/Z (head + body angle) move the body. Head-angle
  slider triggers some movement in the head region. Other
  parameters (arm rotations, etc.) don't visibly do anything.

**Cubism Editor log (separate concern).** Loading the exported
.cmo3 in Cubism Editor shows "Parameter mismatch" — distinct from
the runtime symptom. Likely export-side (parameter list inconsistent
between rigSpec / project / motion3 / etc.).

**Hypotheses retired.**
- ❌ "All flying parts have broken chains." Refuted: only handwear
  is broken, but face / arms also fly. Most are clean canvas-px
  output yet still mispositioned.
- ❌ "Phase -1B fix opt-out is wrong-shaped because of broken
  chains." The broken-chain count is small; this is not the main
  driver.

**Active hypothesis (RESOLVED 2026-04-29 commit `c07751b`).** None of
the three above. Real cause: rotation→warp boundary unit conversion.
moc3 binary emits `rotation_deformer_keyform.scales = 1/canvasMaxDim`
for warp-parented rotations (moc3writer.js:1210, verified by binary
diff against Cubism's shelby.moc3 baseline). cmo3 XML always writes
scale=1.0; the runtime evaluator (chainEval) reads from cmo3-shape
spec → never applied the conversion → rotation matrix at angle=0
emits canvas-px-magnitude positions that the next-step warp's
bilinearFFD interprets as 0..1 input → off-the-grid clamp →
canvas-extreme rendering. The chain diagnose's "clean / canvas-px"
verdict was correct about termination but didn't validate unit
consistency across boundaries (a useful observation for Phase 2 —
when full Coord-Space Debugger ships with overlay tinting, it
should also surface unit-mismatch warnings inline).

Body parts hit warps directly (no rotation→warp hop) — they
worked. Arm + face chains had `mesh → rotation → rotation → warp`
or `mesh → rotation → warp`; the rotation→warp hop is exactly the
unit-mismatched boundary. ParamAngleX/Y/Z worked because BodyXWarp
(driven by them) sits at the root level — its OUTPUT is canvas-px,
no rotation hop needed. ParamRotation_<bone> didn't visibly do
anything because the broken-unit output got clamped to canvas
extremes regardless of input rotation.

Fix added the `1/canvasMaxDim` scale to `DeformerStateCache.getState`
when `spec.parent.type === 'warp'`. Read once per evalRig call from
`rigSpec.canvas`. e2e equivalence + chainEval tests still green;
two new chainEval tests lock the regression in (canonical
canvas-px pivot-relative input → expected scaled+offset output).

---

### 2026-04-29 — UX refactor: left-side tabbed sidebar (Outliner + Parameters)

User asked for the Outliner + Parameters editors to live as tabs in
a left sidebar (rather than separate quadrants in the 2×2 layout)
with tab styling that's clearly distinguishable for the active vs
inactive state — OPNsense-style with the active tab visually
"raised" and merging into the panel body.

**Refactor scope.**

1. **Data model — tabs per area.** `AreaSlot` becomes
   `{id, tabs: EditorTab[], activeTabId}`. Each `EditorTab` is
   `{id, editorType}`. The shell's existing per-area editor swap
   becomes "swap the active tab's editorType"; new actions
   `setAreaActiveTab` / `addTab` / `removeTab` ride on top.
2. **Layout — 3 columns.** Default workspace switches from 2×2
   (TL viewport / TR outliner / BL parameters / BR properties)
   to L | C | R:
     - Left: tabs (Outliner | Parameters)
     - Center: viewport
     - Right: properties
   Animation workspace gets Timeline as a horizontal split below
   center.
3. **AreaTabBar.jsx** replaces `EditorHeader.jsx`. Renders one
   chip per tab; the editor-type "swap" dropdown moves into a
   `+` menu since with tabs the swap-in-place use case is rare.
4. **OPNsense styling** — active tab has a light-card background,
   a colored top accent (primary), borders connecting into the
   panel body below. Inactive tabs sit on the muted strip with
   muted text.
5. **Migration.** v3 just shipped 2 days ago; users may have
   workspace state in `localStorage` (react-resizable-panels
   autoSaveId) referencing the 2×2 panel layout. The split-tree
   structure is owned by react-resizable-panels and reset on
   workspace-key change is harmless. The areas[] shape lives in
   uiV3Store which currently has no persistence — fresh shape
   on every load.

**Out of scope (follow-up).** Drag-tab between areas, tab close
buttons, "+" menu to add a new tab, persisting workspace state
to disk. Phase 1+ ergonomics; not needed for the visible win.

User loaded `shelby.psd` to verify Phase -1B coord fix + post-refactor
v2 paths. Three bugs surfaced; all three deferred (not fixed) on the
strategic call that v2 UI is being replaced wholesale by Phase 1+.

**Bug A — Wizard Step 3 "Adjust Joints" yellow dots not draggable.**

Repro: drag-drop PSD → wizard advances to Step 3 → joint circles
render but `onPointerDown` never fires.

Likely cause: `SkeletonOverlay.jsx:594` sets `pointerEvents: 'none'`
on the parent `<svg>`. Arc handles override with
`pointerEvents: 'visibleStroke'` (line 583), but joint `<circle>`
elements have no override → inherit `none`. Arc handles work
because they explicitly opt back in; circles never did.

Or: `editorMode !== 'staging' && editorMode !== 'animation'`
early-out (line 433) fires while wizard mode is active. Wizard step
ran in `staging` historically; needs verification post any recent
mode change.

**Status:** deferred. SkeletonOverlay's joint-drag logic moves to
the Layout-mode `layout.move_bone_pivot` operator in Phase 1A. The
wizard itself becomes the `file.import_psd` operator (per Working
Note 1.2 above). Patching the v2 path is throwaway work.

**Bug B — Phase -1B coord fix incomplete (parts still flying).**

Repro: load PSD → Initialize Rig → face mesh disappears, arms
translate off-canvas. The `rigDrivenParts` Set + skip-worldMatrix
path landed in commit `2397d54` was supposed to fix this; user
verified it does NOT.

Diagnostic clue from arm rotation controllers: rotating the arm via
its rotation deformer brings the arm back to correct screen
position; releasing the controller drops it back to flying-off
state. That means `evalRig`'s rotation-deformer chain produces
correctly-placed canvas-px verts, but the rig output WITHOUT any
rotation-deformer activity (rest pose) does not. Two hypotheses:

1. `chainEval` walks the chain to root and emits canvas-px IF the
   chain terminates at a rotation deformer. If the chain terminates
   at the root warp (most face/torso parts), no canvas-px conversion
   happens — the warp output is in normalized-0to1 or some other
   space that *needs* worldMatrix on top. Then `rigDrivenParts.add`
   incorrectly opts the part out of worldMatrix.

2. The art-mesh keyforms themselves are stored in their parent
   deformer's local frame (per `frameConvert` semantics), and
   `evalArtMesh` returns those local-frame verts. Without the
   chain walk transforming them through every parent's localToCanvas,
   the rig output is in some arbitrary frame.

Either way the -1B "use camera directly for rig-driven parts" fix
is wrong-shaped. Real fix needs the **Coord-Space Debugger overlay
(Phase 1C)** to colour-tint each mesh by the frame its verts actually
arrive in. Then root-cause becomes visible.

**Status:** deferred to Phase 1E (explicitly scoped task: "Coord-space
bug fix"). Phase 0C TaggedBuffer wrappers come first so the debugger
overlay can render frame tags reliably.

**Bug C — Rotation arc handle: arm jumps back during drag, flies away on release.**

Repro: arm flying-away (per Bug B) → click rotation arc → arm jumps
to correct rest position during drag → drag rotates correctly →
release → arm flies away again.

This is Bug B in disguise. The rotation-arc drag dispatches a
re-eval that triggers the canvas-px-emitting rotation-chain path;
release falls back to the broken rest path. Will resolve when Bug
B does.

**Status:** deferred — will fix automatically when Bug B fixes.

---

### 2026-04-29 — Phase 2-6 first-cut sweep (autonomous)

Following user directive "забить на тесты, завершить все фазы из
главного плана и затем уже исправлять баги какие найдем"
(2026-04-29, screenshots session). Eleven commits landed in a
single autonomous run: every phase from 1B through 6 now has at
least a first cut on master.

| Commit | Phase | Deliverable |
|--------|-------|-------------|
| `2be491b` | 5 | upstream-style Save/Load modals + ProjectGallery + thumbnail capture via `captureStore` |
| `6c3c39d` | 1B | Mesh / Mask / Physics Properties tabs |
| `d730ff1` | 2A+2B | Warp + Rotation Deformer overlays (display-only) |
| `bb7421c` | 2C | BlendShape paint arming via Properties tab (v2 viewport already paints) |
| `1264e27` | 3 | AnimationsEditor as new editor type |
| `c7e78ba` | 4 | PerformanceEditor (FPS sampler + project / mesh / rig stats) |
| `d24b166` | 5 | ExportModal with format radio |
| `2fee609` | 6 | KeymapModal opened from Preferences |
| `76fa3e0` | 2D-2G | Mask CRUD; ParamRow right-click reset; workspace tab → editorMode wiring |

**Trade-offs accepted.** First cuts ship as either display-only
overlays or as edit actions wrapped into existing Properties tabs
rather than dedicated editors with full modal operator sets.
- **Phase 2A/2B** — overlays render the lattice / pivot but
  drag-to-edit folds into Phase 2C (Keyform Editor) which is still
  pending.
- **Phase 2D/2E/2G** — Keyform Editor / Physics Editor / Variant
  Manager remain folded into the Phase 1B read-only tabs;
  standalone editors require deeper schema work to mutate
  `project.rigWarps` / `physicsRules` / `variantOf` then
  invalidate rigSpec correctly.
- **Phase 4** — Performance editor's FPS counter samples browser
  repaint, not GL frame time. Real GPU profiler needs
  CanvasViewport to expose per-pass query timings.
- **Phase 6** — Keymap viewer is read-only. Editing requires
  per-user persistence + chord-conflict detection.

**Bug fixes folded into the same sweep:**
- ParamRow right-click / double-click resets the param to its
  declared default — addresses user's "no quick reset" feedback.
- Workspace tab clicks set `editorMode='animation'` for Animation
  + Pose workspaces, `'staging'` otherwise. Fixes "no timeline
  visible after creating an animation."
- AnimationsEditor's `+` button now also switches to the Animation
  workspace and dispatches `switchAnimation` so the new animation
  immediately opens with a timeline.

**Bugs deferred** (explicit user instruction "затем уже исправлять
баги какие найдем"):
- ✅ Eye init parabola broken (ParamEyeLOpen=1 but eyes visually
  closed); clicking slider helps. **FIXED sweep #23** —
  `paramValuesStore.seedMissingDefaults` runs at the end of every
  `useRigSpecStore.buildRigSpec` so freshly-loaded / -imported
  projects start with `ParamEyeLOpen=1` (and every other non-zero
  default) in the values map. Without it, chainEval read `undefined`
  → cellSelect treated as 0 → eyes shut.
- Phantom skirt param — by design (SDK STANDARD_PARAMS includes
  ParamSkirt regardless of mesh tags). Filtering is a UX decision
  that needs user input; not a bug per se.
- Body angle X/Y/Z visual divergence from Cubism Editor.
- Live preview ignores previously-rotated arm (frozen-arm).
- Animation tab character invisible (separate from new-animation
  timeline visibility, which is fixed).
- Performance lag on elbow rotation in animation mode.
- Most bone controllers don't move attached body parts.
  **Root cause traced sweep #25** (analysis-only — fix is risky without
  browser eyes): for every non-bone non-skipped group, `cmo3writer.js`
  emits a `GroupRotation_<groupId>` rotation deformer driven by
  `ParamRotation_<sanitizedName>`. Bone-baked meshes (arms/legs/hands)
  *do* parent to that deformer (line 3447–3448), so their bone
  controllers work. Tagged body meshes (topwear / hair / skirt / face
  parts) instead parent to their `RigWarp_<sanitizedName>`, which
  re-parents straight to `BodyXWarp` / `FaceParallax` / `NeckWarp`
  (line 3134–3146). The group's `GroupRotation_*` ends up as a
  **sibling** of the rig warp under the body chain — never in the
  mesh's parent chain — so dialing `ParamRotation_topwear` has no
  visible effect. Same in the cmo3 file (Cubism Editor renders the
  same chain) and in the runtime evaluator (`chainEval`'s parent walk
  passes through the rig warp directly to BodyXWarp). The bone-baked
  branch and rotation-deformer logic shipped by sweep #20 means the
  group rotation deformers exist in `rigSpec.rotationDeformers` and
  get translated to moc3, but they're orphaned controllers. Fix
  requires either (a) re-parenting `RigWarp_X` under
  `GroupRotation_X` instead of BodyXWarp — touches the rig-warp grid
  coord-space convention (canvas vs 0..1 vs pivot-relative) — or (b)
  injecting a synthesized rotation effect at the chain's BodyXWarp
  ingress. Both need parity validation against Hiyori before landing.

**What "Phase N complete" means now.** First cuts unlock the surface
each phase was scoped to; full polish (standalone editors, modal
operator suites, parity harness, bundle splitting, PWA, i18n)
remains for the second pass. Tags `v3-phase-N-complete` reserved
for that polish round.

---

### 2026-04-30 — Phase first-cut sweeps #24 + #25 (autonomous, Phase 6 cmo3writer extractions)

After sweep #23 closed the last deferred bug actionable from code, sweeps #24 + #25 attack Phase 6 — god-class breakup of `cmo3writer.js` (4468 LOC). The previous extraction pass (Sessions 19–28) carved out `cmo3/constants.js`, `bodyRig.js`, `deformerEmit.js`, `faceParallax.js`, `physics.js`, `pngHelpers.js`; the writer was left as one giant `generateCmo3` async function with sections 1-7 split only by comment dividers. Combined #24 + #25 ship four cohesive sub-modules with tests, all behaviour-preserving (e2e_equivalence + rigSpec + warpDeformers + rigWarps stay 100% green).

| Sweep | Phase | Deliverable |
|-------|-------|-------------|
| #24 | 6 | `cmo3/rigWarpTags.js` — `RIG_WARP_TAGS` (per-tag warp grid sizes), `FACE_PARALLAX_TAGS` / `FACE_PARALLAX_DEPTH` (Session 19 unified-face-warp membership), `NECK_WARP_TAGS` (head-tilt followers). 80 LOC of pure data, no closures. |
| #24 | 6 | `cmo3/paramCategories.js` — `CATEGORY_DEFS` (frozen 10-folder Random-Pose-dialog taxonomy) + `categorizeParam(id)` (regex/string-table classifier). New `test_paramCategories.mjs`: 72 tests covering every branch + falsy guards + L/R-suffix edge cases. |
| #24 | 6 | `cmo3/groupWorldMatrices.js` — `computeGroupWorldMatrices(groups, meshes, canvasW, canvasH) → { groupWorldMatrices, deformerWorldOrigins }`. Memoised parent-chain traversal + pivot-fallback BFS. New `test_groupWorldMatrices.mjs`: 18 tests covering identity, propagation, pivot-transform, descendant-bbox fallback, canvas-centre fallback, orphan parents, memoisation. |
| #25 | 6 | `cmo3/eyeClosureFit.js` — `fitParabolaFromLowerEdge(sourceMesh, sourceTag, opts) → ParabolaCurve|null`. The lash-mirror + bin-max + PNG-alpha fallback parabola fitter. New `test_eyeClosureFit.mjs`: 27 tests covering degenerate input, flat-line fit, U-shape concavity, lower-edge extraction, PNG-source tracking, eyelash-fallback mirror, custom binCount. Also drops the now-orphaned `extractBottomContourFromLayerPng` import from the writer. |

**LOC delta for cmo3writer.js**: 4468 → 4255 (−213, post-#25). Total module count under `src/io/live2d/cmo3/` grew 6 → 10. Combined #24+#25: 4 new modules + 117 new test assertions (72 + 18 + 27).

---

### 2026-04-30 — Phase first-cut sweep #26 (autonomous, more cmo3writer extractions)

Sweep #25 ran a careful eye-closure-helper extraction; sweep #26 finishes the eye-closure subsystem and documents the orphan-bone-controllers RCA.

| Phase | Deliverable |
|-------|-------------|
| 6 | `cmo3/eyeClosureApply.js` — `evalClosureCurve`, `evalBandY`, `computeClosedCanvasVerts`, `computeClosedVertsForMesh`. Companion to sweep #25's `eyeClosureFit.js`: the fit module produces a `ParabolaCurve`, this module applies that curve to a target mesh's vertices to compute the closed-eye keyform. `lashStripFrac` becomes a parameter (default 0.06) so the fn no longer references the writer's `EYE_CLOSURE_LASH_STRIP_FRAC` closure constant; the two callers in cmo3writer pass it explicitly. New `test_eyeClosureApply.mjs`: 35 tests covering all branches — null curve / fallback band / eyelash strip math / shiftPx / rwBox normalization + Y clamp / dfOrigin pivot-relative / canvas passthrough. |
| Bug RCA | `docs/V3_BLENDER_REFACTOR_PLAN.md` deferred-bugs entry expanded with a 22-line root-cause analysis for "most bone controllers don't move attached body parts": cmo3writer emits `GroupRotation_<groupId>` rotation deformers that end up as **siblings** of `RigWarp_*` under `BodyXWarp` — never in the mesh's parent chain. Bone-baked meshes work (artParent explicitly hooks the deformer at line 3447–3448); tagged body meshes (topwear / hair / face parts) don't. Fix is non-trivial (rig-warp grid coord-space convention shift) and needs Hiyori parity validation; left for a session with browser eyes. |

**LOC delta for cmo3writer.js**: 4255 → 4183 (−72). Cumulative since sweep #24: 4468 → 4183 (−285). Sweep #26 adds 1 new module + 35 test assertions. `cmo3/` directory now 11 files / ~2.1k LOC of the writer's logic.

---

### 2026-04-30 — Phase first-cut sweeps #27-#30 (autonomous, "разбить god class по максимуму")

User directive: "Может стоит god class разбить по максимуму?". Four sweeps in series targeting the structural backbone of `cmo3writer.js` — sections 1, 5, 6, 7 first (the simpler bookends), then 2b + 3 + 3d-head + the standard-param-pid lookup.

| Sweep | HEAD | Phase | Deliverable |
|-------|------|-------|-------------|
| #27 | `6e3f28d` | 6 | `cmo3/globalSetup.js` (Section 1, 250 LOC) — `setupGlobalSharedObjects(x, opts)` returns a 30-field bundle: core GUIDs (param-group root, model, part, blend, deformer ROOT/null, CoordType), param-derived state (paramSpecs → paramDefs with CParameterGuid pids, ParamOpacity handle, baked-angle bounds, boneParamGuids), groupPartGuids, plus 19 filter pids. `cmo3/modelImageGroup.js` (Section 5) — `emitModelImageGroup`. `cmo3/mainXmlBuilder.js` (Section 6, 313 LOC) — `buildMainXml(x, opts)` assembles the full <root>: CModelSource + canvas + parameters + textureManager + drawable/deformer/affecter/part source sets + optional physics + parameter group set + modelInfo + 3 preview icons + gameMotionSet + ModelViewerSetting + guides + version stamps + brushes + CRandomPoseSettingManager. `cmo3/caffPack.js` (Section 7) — `packCmo3` archives icons + per-mesh PNGs + main.xml. paramSpec.js typedef gained `bakedKeyformAngles` + `rotationDeformerConfig` fields. **LOC: 4183 → 3642 (−541, −13%).** |
| #28 | `fa7c303` | 6 | `cmo3/meshLayer.js` — `emitMeshFilterGraph` (per-mesh ModelImageFilterSet + 2 FilterInstances + connectors), `emitMeshTexture` (GTexture2D + CTextureInputExtension + CTextureInput_ModelImage), `fillLayerGroupAndImage` (Section 2b — populates the shared CLayerGroup + CLayeredImage XML nodes). Per-mesh layer block in writer is now ~10 lines. **LOC: 3642 → 3496 (−146).** |
| #29 | `cc47a3a` | 6 | `cmo3/partHierarchy.js` (Section 3) — `makePartSource(x, ...)` + `buildPartHierarchy(x, opts)`. Returns rootPart + allPartSources + groupParts. Caught one bug from sweep #28 (missed `pidTex2d` / `pidTimi` destructure in `emitMeshTexture` call site — perMesh entries needed them). **LOC: 3496 → 3378 (−118).** |
| #30 | `03f5cb7` | 6 | `cmo3/bodyChainEmit.js` (Section 3d head) — `emitBodyWarpChain(x, opts)` translates the 4 WarpDeformerSpec entries from buildBodyWarpChain into XML; returns pidBreathGuid + pidBodyXGuid as re-parent targets. `lookupStandardParamPids(paramDefs)` added to globalSetup.js — collapses 21 lines of inline `paramDefs.find` calls into one destructure. **LOC: 3378 → 3334 (−44).** |

**Cumulative cmo3writer.js LOC delta sweeps #24-#30**: 4468 → 3334 (−1134, −25%). 11 modules → 18 under `src/io/live2d/cmo3/`. All 70+ test suites stay green; e2e_equivalence + rigSpec + warpDeformers + rigWarps confirm zero behavioural shift in cmo3 output.

---

### 2026-04-30 — Phase first-cut sweeps #31-#33 (autonomous, big-block continuation)

User directive: "Продолжай разбивку и make sure we didn't/don't break anything". Three more sweeps targeting the largest remaining blocks. Full-suite test run before each + after each to confirm zero regression.

| Sweep | HEAD | Module | LOC delta |
|-------|------|--------|-----------|
| #31 | `3883f7a` | `cmo3/meshVertsWarp.js` (Section 3b CWarpDeformerSource per-mesh-vert, 328 LOC; IDW propagation + rest-grid math + per-keyframe CWarpDeformerForm emission); `cmo3/rotationDeformerEmit.js` (Section 3b ROTATION DEFORMERS, 307 LOC; per-group CRotationDeformerSource + KeyformBindingSource/KeyformGridSource + per-keyform CRotationDeformerForm with origin in parent-deformer-local space). Drops `buildGroupRotationSpec` + the now-unused `computeGroupWorldMatrices` direct import from the writer. | 3334 → 2869 (−465) |
| #32 | `67014d8` | `cmo3/structuralChainEmit.js` (Section 3d, 221 LOC; orchestrates emitBodyWarpChain → emitNeckWarp → emitFaceRotation → emitFaceParallax + the re-parenting pass for rotation deformers ROOT → Body X with origin conversion + per-part rig warp re-parenting to FaceParallax/NeckWarp/Body X). Drops emitBodyWarpChain + emitNeckWarp + emitFaceRotation + emitFaceParallax + emitPhysicsSettings imports from the writer. faceParallax.js typedef gained the `rigCollector` ctx field. | 2869 → 2695 (−174) |
| #33 | `2cb0c41` | `cmo3/maskResolve.js` (Section 4 head, 130 LOC; Stage 3 native-rig path + heuristic fallback for variant-aware iris/eyewhite mask pairing). | 2695 → 2634 (−61) |

**Cumulative cmo3writer.js LOC delta sweeps #24-#33**: 4468 → 2634 (−1834, **−41%**). 11 modules → **22** under `src/io/live2d/cmo3/`. All 70+ test suites stay green throughout; baseline + post-sweep e2e + rigSpec + warpDeformers + rigWarps + initRig pre/post-comparisons confirm zero behavioural shift in cmo3 output.

**Final inventory of `src/io/live2d/cmo3/`** (22 files, ~4.4k LOC of writer logic): bodyChainEmit, bodyRig, caffPack, constants, deformerEmit, eyeClosureApply, eyeClosureFit, faceParallax, globalSetup, groupWorldMatrices, mainXmlBuilder, maskResolve, meshLayer, meshVertsWarp, modelImageGroup, paramCategories, partHierarchy, physics, pngHelpers, rigWarpTags, rotationDeformerEmit, structuralChainEmit.

**What's left in cmo3writer.js (2634 LOC, biggest blocks):**
- Section 2 per-mesh layer + keyform emission loop (~700 LOC) — meshes loop body emitting CLayer (already partly extracted to `meshLayer.js`) + per-mesh keyform XML for variant fades / eyelid-closure compounds / base fades / neck-corner shapekeys / bone-baked keyforms. Each branch differs.
- Section 3c per-tag rig warp emission (~840 LOC) — pre-passes (faceUnion/neckUnion bboxes, facePivot calibration, eye closure contexts, body-warp chain wire-up) + per-mesh `rigWarpBbox` build + grid emission. Largest single block left.
- Section 4 per-mesh CArtMeshSource emission loop (~600 LOC) — emits CArtMeshSource shell + GEditableMesh2 + dual-position vertex arrays + clip ref + extension list + keyforms.

All three blocks use a deep cross-section of writer state (~25 pid maps + rigCollector + bbox/curve/origin lookups). Future sweeps should bundle that into a typed `EmitContext` object plumbed once, then the loop bodies become ~100 LOC each instead of ~600+.

---

### 2026-04-30 — Phase first-cut sweeps #34-#40 (autonomous, moc3writer Phase 6 split)

After cmo3writer's #24-#33 reduction, sweeps #34-#40 attack the second god class — `moc3writer.js` (1573 LOC). Cleaner cuts than cmo3 because moc3 is a binary writer with fixed-offset section emit (`buildSectionData` + `serializeMoc3`) rather than closure-coupled XML emission. Test discipline: full-suite baseline before each sweep + after each, e2e_equivalence stays green throughout.

| Sweep | HEAD | Module(s) | LOC delta |
|-------|------|-----------|-----------|
| #34 | `ebaf449` | `moc3/layout.js` (231 LOC: MAGIC, HEADER_SIZE, COUNT_INFO_*, MOC_VERSION, COUNT_IDX (23 slots), ELEM types, full SECTION_LAYOUT). `moc3/binaryWriter.js` (87 LOC: BinaryWriter class with U8/I16/I32/U32/F32 + arrays, writeString fixed-field, writeRuntime, padTo, patchU32). | 1573 → 1295 (−278) |
| #35 | `ee63372` | `moc3/meshBindingPlan.js` (197 LOC) — `buildMeshBindingPlan({ meshParts, groups, rigSpec, bakedKeyformAngles, backdropTagsSet })` returns `{ meshBindingPlan, meshKeyformBeginIndex, meshKeyformCount, totalArtMeshKeyforms }`. Owns the per-mesh keyform branch order: bone-baked rotation → mesh-level eye closure → variant fade-in → base fade-out (backdrop-skip) → default `ParamOpacity[1.0]`. Drops `variantParamId` / `matchTag` / `sanitisePartName` imports. | 1295 → 1111 (−184 with #36) |
| #36 | `ee63372` | `moc3/deformerOrder.js` (96 LOC) — `topoSortDeformers({ warpSpecs, rotationSpecs })` returns `{ allDeformerSpecs, allDeformerKinds, allDeformerSrcIndices, deformerIdToIndex, meshDefaultDeformerIdx }`. Cubism's runtime processes the deformer list in array order, so the parent-before-child topo-sort is required correctness, not nicety. | (combined with #35) |
| #37 | `595ce8a` | `moc3/keyformBindings.js` (197 LOC) — `buildKeyformBindings({ meshBindingPlan, allDeformerSpecs, params })` owns the dedup-pool → contiguous-by-param reorder → band intern → kfbi expansion → per-param range pipeline. Without this layout the moc3 fails to load (band/binding counts come out 2× cubism's). Bug fix: `counts[KEYFORM_BINDING_BANDS]` was reading `bandPool.length` which went out of scope after extraction → switched to `bandBegins.length` (same value). | 1111 → 990 (−121) |
| #38 | `595ce8a` | `moc3/keyformAndDeformerSections.js` (320 LOC) — single-function helper for the entire interleaved emit pipeline (mesh kf flatten → mesh kf positions → umbrella `deformer.*` → `warp_deformer.*` + grid append → `rotation_deformer.*` + keyforms → bone kf sentinel patch). Single `allKeyformPositions` accumulator threads through all five passes; cannot be cleanly subdivided. Returns the full bundle (38 fields) for the caller to dispatch into the unified sections Map + counts array. | 990 → 683 (−307) |
| #39 | `5eb27d4` | `moc3/meshDeformerParent.js` (92 LOC) — 4-step cascade (per-mesh rig warp → bone rotation → group rotation → deepest body warp). `moc3/uvAndIndices.js` (88 LOC) — PSD→atlas UV remap + flat triangle indices + Hiyori-pattern single-root draw-order group + objects. | 683 → 588 (−95) |
| #40 | `79038dc` | `moc3/binarySerialize.js` (139 LOC) — `serializeMoc3({ sections, counts, canvas })` owns the entire two-phase binary writer (Phase 1 body emit + Phase 2 header/SOT/padding/body assembly + V3.03+ quad_transforms). `writeSection` dispatcher lives here. `generateMoc3` collapses to `return serializeMoc3(buildSectionData(input))`. | 588 → 476 (−112) |

**Cumulative moc3writer.js LOC delta sweeps #34-#40**: 1573 → 476 (−1097, **−70%**). New `src/io/live2d/moc3/` directory with **9 modules** (~1.4k LOC of writer logic). All 70+ test suites stay green throughout.

**Final inventory of `src/io/live2d/moc3/`** (9 files, ~1.4k LOC): binarySerialize, binaryWriter, deformerOrder, keyformAndDeformerSections, keyformBindings, layout, meshBindingPlan, meshDeformerParent, uvAndIndices.

**What's left in moc3writer.js (476 LOC):** module docstring + `Moc3Input` typedef + `buildSectionData` orchestrator that destructures the input, builds counts/meshInfos/partNodes/meshIndexById, then calls the 8 helpers in sequence and emits part / art_mesh / parameter / clip-mask sections inline (small enough to leave). `generateMoc3` is now 1-liner. Healthy file at this size — further splitting would just be churn.

**Combined Phase 6 god-class breakup status:** cmo3writer.js (4468 → 2634, −41%, 22 modules) + moc3writer.js (1573 → 476, −70%, 9 modules) = **31 modules** across `cmo3/` + `moc3/`, **−2931 LOC** lifted from the two writers. cmo3writer's three remaining per-mesh emission loops (Sections 2/3c/4 totaling ~2140 LOC) are the next major target — they all need a typed `EmitContext` object plumbed once before the loop bodies can be cleanly extracted.

#### Remaining refactor targets (ranked by ROI, post sweep #40)

This is the same overview I gave the user before /compact, recorded here so future sessions don't have to rediscover it.

**A. cmo3writer.js per-mesh loops (highest ROI for cmo3 cleanup, ~2140 LOC).**
- Section 2 per-mesh layer + keyform emission loop (~700 LOC) — variant fades / eyelid-closure compounds / base fades / neck-corner shapekeys / bone-baked keyforms; each branch differs.
- Section 3c per-tag rig warp emission (~840 LOC, biggest single block left) — pre-passes (faceUnion/neckUnion bboxes, facePivot calibration, eye closure contexts, body-warp chain wire-up) + per-mesh `rigWarpBbox` build + grid emission.
- Section 4 per-mesh CArtMeshSource emission loop (~600 LOC) — CArtMeshSource shell + GEditableMesh2 + dual-position vertex arrays + clip ref + extension list + keyforms.
- All three need a typed `EmitContext` object plumbed once (rigCollector + ~25 pid maps + bbox/curve/origin lookups). Recommend: build the `EmitContext` typedef + helper-passing convention as sweep #41, then extract Section 2/3c/4 in #42-#44.

**B. Other large files (split candidates, plan-flagged but not yet on the Phase 6 sweep list).**
| File | LOC | Notes |
|------|-----|-------|
| `src/components/canvas/CanvasViewport.jsx` | 2167 | Plan 0F.N pointer events split; needs browser eyes for verification. |
| `src/v3/editors/timeline/TimelineEditor.jsx` | 1831 | No split plan yet. |
| `src/io/live2d/cmo3Import.js` | ~~884~~ ✅ shipped sweep #49 (884 → 315, −64%) — cmo3Import/{headerExtract,rigWarpSynth,rotationDeformerSynth}.js. |
| `src/lib/themePresets.js` | 860 | Largely a data dictionary — split into per-theme files. |
| `src/io/live2d/can3writer.js` | ~~857~~ ✅ shipped sweeps #45-#48 (857 → 117, −86%) — can3/{constants,keyframeSequence,trackAttrs,sceneEmit,finalize}.js. |
| `src/io/live2d/exporter.js` | 800 | Public API surface; split by export target (cmo3 / moc3 / motion3). |
| `src/io/live2d/cmo3PartExtract.js` | ~~680~~ ✅ shipped sweep #50 (680 → 264, −61%) — cmo3PartExtract/{xmlHelpers,drawableExtract,deformerExtract}.js. |
| `src/store/projectStore.js` | 644 | Plan 0F.N split flagged. |

**C. Plan-flagged non-split pending.**
- 0C TaggedBuffer integration into `evalRig` (perf tickets).
- 0E Vitest migration (currently `node` test runners).
- 4A Reference parity harness (env-dependent — needs Cubism SDK adoption).
- Orphan bone-controller bug fix — RCA done in sweep #26 deferred-bugs entry; needs coord-space convention shift + Hiyori parity validation. Listed under Phase 6 to-do so `v3-shipped` doesn't ship with the bug intact.

**Recommended next-session order:**
1. cmo3 EmitContext + Section 2/3c/4 extractions (sweeps #41-#44).
2. can3writer split mirroring moc3 shape (cleanest cuts, well-understood pattern).
3. cmo3Import + cmo3PartExtract (analogous to writer extractions, lower ROI but symmetric).
4. UI splits (CanvasViewport, TimelineEditor, projectStore) — needs browser-eyes follow-up since UI behaviour changes can't be verified by the current test suite alone.

---

### 2026-04-30 — Phase first-cut sweeps #41-#44 (autonomous, cmo3writer Phase 6 split, part 2)

Sweeps #41-#44 close out cmo3writer's three big inline loops by extracting them through a shared `EmitContext` bag. Same shape as moc3 sweeps #34-#40: a typed handoff object + per-section emission helpers. All four sweeps behaviour-preserving (full test suite + typecheck stay 100% green between every commit).

- **Sweep #41 — `cmo3/emitContext.js` (260 LOC).** The catalog typedef listing every field a per-section helper might read (static input → resolved Stage-5/Stage-8 fallbacks → globals → pre-pass results → emission accumulators) plus a `createEmitContext(input, configs, hasGenerateRig)` factory + `attachGlobals(ctx, _globals)` mirror. cmo3writer.js builds the context right after `XmlBuilder` is allocated; `rigCollector` + `rigDebugLog` move from inline allocations to ctx-owned instances with local aliases until extraction sweeps migrate every reference. Pure scaffolding sweep (cmo3writer −0 → +24 net) that unblocks the three big extractions below.

- **Sweep #42 — `cmo3/meshLayerKeyform.js` (600 LOC, single-fn).** `emitAllMeshLayersAndKeyforms(ctx, prepass)` owns the entire `for (let mi = 0; mi < meshes.length; mi++)` body that was 511 LOC of inline state in cmo3writer.js: per-mesh GUID allocation, CImageResource + CLayer emit, filter graph + texture inputs (delegated to existing `meshLayer.js`), KeyformGridSource per-mesh with all six keyform branches (baked / closure / neck-corner / 2D compound / emotion-variant / base-fade / default), `closedCanvasVerts` cache for moc3 blink emission, and final `perMesh.push` + `layerRefs.push`. Caller passes a `prepass` bundle (eye-closure parabolas, variant pairing maps, PSD/layer pids). cmo3writer.js: 2634 → 2153 LOC (−481).

- **Sweep #43 — `cmo3/eyeTags.js` + `cmo3/eyeContexts.js` + `cmo3/perPartRigWarps.js` (731 LOC across 3 files).** Three modules carve Section 3c out:
  - `eyeTags.js` — shared `EYEWHITE_TAGS` / `EYELASH_TAGS` / `EYE_SOURCE_TAGS` / `EYE_PART_TAGS` sets used by Sections 3c and 4 (no duplication).
  - `eyeContexts.js`'s `buildEyeContexts({ perMesh, meshes, generateRig, canvasToBodyXX, canvasToBodyXY, rigDebugLog })` runs the lower-edge X-bin → least-squares parabola fit → flip-when-eyelash → BodyX 0..1 projection pipeline; returns `{ eyeContexts, findEyeCtx }`. Pure pre-pass with no XML emission.
  - `perPartRigWarps.js`'s `emitPerPartRigWarps(ctx, opts)` handles the `RIG_WARP_TAGS` loop: bbox + grid rebase per parent (face/neck/body), tag-binding cartesian-product keyforms (or no-op `ParamOpacity[1.0]`), Stage 9b stored-position passthrough, CWarpDeformerSource XML emission, parent-part registration, target-node stash for re-parenting, `rigCollector.warpDeformers` push.
  
  cmo3writer.js: 2153 → 1659 LOC (−494).

- **Sweep #44 — `cmo3/artMeshSourceEmit.js` (690 LOC, single-fn).** `emitArtMeshSources(ctx, opts)` owns Section 4: per-mesh CArtMeshSource allocation, deformer parent resolution (rig warp / baked-keyform ARM group / jointBone or parent-group rotation deformer / ROOT), `verts` projection (warp-local 0..1 / pivot-relative px / canvas px), edit-mesh + texture-input + mesh-generator extension emit with full Cubism polygon-density preset, clip-guid resolve via `resolveMaskPairings` (now imported into the helper, not the writer), all six keyform branches (baked / closure-1D / closure-2D / neck-corner / variant / default), `rigCollector.artMeshes` mirror, base canvas-px positions + UVs. Returns `{ meshSrcIds }` for Section 5's CModelImageGroup. cmo3writer.js: 1659 → 1089 LOC (−570). A follow-up commit (`262fd1d`) prunes 12 orphan import names (`makeLocalMatrix`, `mat3Mul`, `variantParamId`, `emitKfBinding`, `RIG_WARP_TAGS`, `FACE_PARALLAX_DEPTH`, `CATEGORY_DEFS`, `categorizeParam`, `computeClosedCanvasVerts`, `computeClosedVertsForMesh`, `emitMeshFilterGraph`, `emitMeshTexture`) made unused by the extractions: 1089 → 1076.

**What's left in cmo3writer.js (1076 LOC):** the same module docstring + `Cmo3Input` typedef + `generateCmo3` that destructures input, runs all the pre-passes (body silhouette, body-warp chain, face-parallax + face-pivot, neck warp, eye closure parabolas), calls the emit helpers in sequence (globalSetup → meshLayerKeyform → fillLayerGroupAndImage → partHierarchy → rotationDeformers → meshVertsWarp → eyeContexts → perPartRigWarps → structuralChainEmit → artMeshSourceEmit → modelImageGroup → mainXmlBuilder → caffPack), and a 12-LOC physics block in the rigOnly short-circuit. Most remaining LOC is the long input-arg destructure (Cmo3Input has 27 fields with default fallback logic for Stage 5/8 configs). Healthy file at this size.

**Combined Phase 6 god-class breakup status (post sweep #44 + import prune):** cmo3writer.js (4468 → 1076, −76%, 28 cmo3/ modules) + moc3writer.js (1573 → 476, −70%, 9 moc3/ modules) = **37 modules** total, **−4489 LOC** lifted from the two writers. cmo3writer is now a thin orchestrator over its helper modules.

**Next-session pointer:** with cmo3 EmitContext shipped and the three big sections extracted, the highest-ROI remaining target is **can3writer.js (857 LOC)** — animation export with the same writer pattern as moc3, so the moc3 split shape (`can3/{layout,sectionData,binarySerialize}.js`) applies directly. After that: `cmo3Import.js` + `cmo3PartExtract.js` (reverse of writer; same module shape mirrored), then UI splits (CanvasViewport, TimelineEditor, projectStore) when browser-eyes verification is feasible.

---

### 2026-04-30 — Phase first-cut sweeps #45-#50 (autonomous, can3writer + cmo3Import + cmo3PartExtract splits)

After sweep #44 closed cmo3writer's three big inline loops, sweeps #45-#50 finish the non-UI Phase 6 splits the plan flagged: can3writer.js (857 LOC), cmo3Import.js (884 LOC), and cmo3PartExtract.js (680 LOC). UI splits (CanvasViewport, TimelineEditor, projectStore) stay deferred — they need browser-eyes verification beyond what the test suite alone provides. All six sweeps behaviour-preserving (typecheck + 3150 tests stay 100% green between every commit).

**can3writer.js (sweeps #45-#48): 857 → 117 LOC (−740, −86%) across 5 cohesion-driven modules.**

The plan's literal "moc3 split shape" (`layout / sectionData / binarySerialize`) doesn't fit can3 — it's an XML emitter (like cmo3), not a fixed-offset binary writer. Cohesion-by-concern lands on:

- **Sweep #45 — `can3/constants.js` + `can3/keyframeSequence.js` (146 LOC).** `VERSION_PIS` (7 entries) + `IMPORT_PIS` (67 entries) lift to constants.js. `emitMutableSequence(x, parent, pidAttr, keyframes, fps, _, _)` lifts to keyframeSequence.js — used by every paramAttrF in every scene + every static rest-pinned attr (CFixedSequence is banned because Cubism Editor 5.0's "Export motion file" command crashes on it). LOC: 857 → 698 (−159).

- **Sweep #46 — `can3/trackAttrs.js` (127 LOC).** `buildTrackAttrFactories(x, pidAdaptRel, pidModelTrack)` returns `{ makeTrackAttrF, makeTrackAttrPt, makeTrackAttrI }` — the three CMvEffect_VisualDefault attr factories used 9× per scene. Hiyori shape: CMutableSequence-count=0 even for static attrs (frameStep / scaleX / etc.) since count=0 CFixedSequence kills the export. LOC: 698 → 601 (−97).

- **Sweep #47 — `can3/sceneEmit.js` (376 LOC).** `emitAllScenes(x, animations, deps)` owns the entire `for (let si = 0; si < animations.length; si++)` body — the heaviest section in the writer. Per scene: paramAttrPids × paramInfoList → CMvEffect_Live2DParameter → PartsVisible → VisualDefault (9 transform attrs via track-attr factories) → EyeBlink + LipSync stubs → CMvTrack_Group_Source root → CMvTrack_Live2DModel_Source + 5-effect effectList → CSceneSource + movieInfo + `_animation` null-placeholder. Returns `{ sceneRefs, sceneGuids, sceneAnimPlaceholders }` for finalize. LOC: 601 → 238 (−363).

- **Sweep #48 — `can3/finalize.js` (138 LOC).** `finalizeCan3(x, args)` does CResourceManager (linked .cmo3 + GUID maps) + shared CAnimation (with scene-blending playlist) + `_animation` null-placeholder patch-back + main.xml assembly (root + shared block + main ref) + CAFF pack. Owns the `VERSION_PIS / IMPORT_PIS` import so the writer no longer carries them. LOC: 238 → 117 (−121).

**What's left in can3writer.js (117 LOC):** module docstring + `Cmo3Input` typedef-style JSDoc + `generateCan3` orchestrator that allocates the 6 shared pids (AdaptType + 3 CEffectIds + RootTrackGuid + ResourceGuid) + builds paramInfoList (deformerParamMap rotation params first, then param-track-only ids in insertion order) + builds paramGuids → calls emitAllScenes → calls finalizeCan3.

**cmo3Import.js (sweep #49): 884 → 315 LOC (−569, −64%) across 3 helper modules.**

- `cmo3Import/headerExtract.js` (74 LOC) — `readHeaderBits` (canvas dims + model name regex on main.xml) + `readParameters` (CParameterSource walker resolving CParameterId.idstr via xs.id pool). Both pure regex helpers; mirror cmo3Inspect's regex shape to stay in sync.
- `cmo3Import/rigWarpSynth.js` (238 LOC) — `buildRigWarpsFromScene(scene, partGuidToNodeId, canvasW, canvasH)` (the sweep #13 body). Walks scene.deformers + scene.keyformBindings + scene.keyformGrids to synthesise `project.rigWarps[partId]`. Includes the nested `resolveRigWarpParent` walker (cmo3 deformer chain → SS structural warp resolver: cmo3 "FaceParallax" → SS "FaceParallaxWarp" etc., bottom-up walk falling through intermediate warps; without this, every imported leaf rigWarp defaulted to BodyXWarp).
- `cmo3Import/rotationDeformerSynth.js` (157 LOC) — `applyRotationDeformersToGroups(scene, nodes, guidToNodeId, canvasW, canvasH)` (the sweep #15 body) + `KNOWN_BONE_ROLES` set + `buildGuidToNodeIdMap` utility + `DEFAULT_TRANSFORM` factory (shared with the importer entry point). `partToMesh` stays inline in the orchestrator — only ~20 LOC and only called from `importCmo3`.

**What's left in cmo3Import.js (315 LOC):** typedefs (ImportResult, partial re-exports of ExtractedPart) + `partToMesh` private helper + `importCmo3` orchestrator that runs the linear pipeline (unpackCaff → parseCmo3Xml → extractScene → readHeaderBits/readParameters → group-node synthesis → part-node synthesis → buildRigWarpsFromScene → applyRotationDeformersToGroups → ParamRotation_* baked-angle detection → normalizeVariants → maskConfigs synthesis → parameters synthesis → project assembly).

**cmo3PartExtract.js (sweep #50): 680 → 264 LOC (−416, −61%) across 3 helper modules.**

- `cmo3PartExtract/xmlHelpers.js` (102 LOC) — `findAllByTag` walker + `readBoolField` / `readNumberField` / `readStringField` scalar readers + `readSizedArray` (count-validating array reader that throws on declared-vs-actual mismatch — catches truncated XML before downstream code starts misindexing).
- `cmo3PartExtract/drawableExtract.js` (214 LOC) — `extractPart` (ACDrawableSource > ACParameterControl super-chain decode, positions/uvs/indices arrays, clip refs, draw_order from first keyform), `extractGroup` (CPartSource + CPartGuid resolution), `extractTexture` (GTexture2D → CImageResource → imageFileBuf path).
- `cmo3PartExtract/deformerExtract.js` (178 LOC) — `extractDeformer` (warp + rotation, shared ACDeformerSource super-chain with per-form decode branch), `extractKeyformBinding` (parameter → keys[] pairing decode), `extractKeyformGrid` (access-keyed cell decode walking _keyOnParameterList).

**What's left in cmo3PartExtract.js (264 LOC):** the seven public typedefs (ExtractedPart / ExtractedGroup / ExtractedTexture / ExtractedDeformer / ExtractedDeformerKeyform / ExtractedKeyformBinding / ExtractedKeyformGrid / ExtractedScene + the DeformerKind enum) — they're the public surface importers reference — plus the `extractScene` orchestrator: six `findAllByTag` + try/catch loops (parts / groups / textures / warp deformers / rotation deformers / bindings / grids).

**Combined non-UI Phase 6 status (post sweep #50):** cmo3writer 4468 → 1076 (−76%) + moc3writer 1573 → 476 (−70%) + can3writer 857 → 117 (−86%) + cmo3Import 884 → 315 (−64%) + cmo3PartExtract 680 → 264 (−61%) = **−6214 LOC total** lifted from 5 god-classes into **48 helper modules** (28 cmo3/ + 9 moc3/ + 5 can3/ + 3 cmo3Import/ + 3 cmo3PartExtract/). Every god-class target on the Phase 6 ranked list is shipped except the 4 UI splits (CanvasViewport 2167, TimelineEditor 1831, projectStore 644, themePresets 860) — all flagged as needing browser-eyes verification beyond what the test suite covers, so deferred until live testing.

**Next-session pointer:** UI-eyes splits (Plan 0F.N pointer-events split for CanvasViewport, TimelineEditor section split, projectStore split per Plan 0F entries) once the user has browser test results. Pre-existing deferred items unchanged: 0C TaggedBuffer integration into evalRig, 0E Vitest migration, 4A reference parity harness, orphan bone-controller bug fix.

---

### 2026-04-30 — Phase first-cut sweep #23 (autonomous, deferred-bug fix)

After 22 sweeps shipping new surface, sweep #23 turns to the deferred-bugs list at the bottom of this doc. The "eye init parabola broken" entry was reproducible: a freshly-loaded project (or imported `.cmo3`) renders with closed eyes even though `ParamEyeLOpen.default === 1` — clicking the slider opens them. Root cause traced to `paramValues` being empty post-load: `chainEval` read `undefined` for every binding → `cellSelect` treated as 0 → params with non-zero defaults rendered at 0.

| Phase | Deliverable |
|-------|-------------|
| Bug | `paramValuesStore.seedMissingDefaults(parameters)` action — walks the parameter spec list and writes `default ?? 0` for every entry NOT already in the values map. Crucially does NOT overwrite existing values (in-flight slider edits survive), and returns the same store reference when nothing changes (no spurious re-renders). `useRigSpecStore.buildRigSpec` calls it at the end of every successful build, mirroring what `RigService.initializeRig` already does for the explicit Initialize Rig path — but covers the cmo3-import auto-build path that didn't seed defaults. 9 new tests in `test_paramValuesStore.mjs` (18 → 27 passing). End-to-end: open a saved project or import a `.cmo3`, eyes are open from frame 1. |

---

### 2026-04-30 — Phase first-cut sweep #22 (autonomous)

Sweep #21 set up the locale switcher; sweep #22 continues the wrap-the-rest pass with `KeymapModal` (high-visibility, opens from Preferences) and `NewProjectDialog` (the first thing a user sees on Ctrl+N).

| Phase | Deliverable |
|-------|-------------|
| 4J | `KeymapModal` + `NewProjectDialog` wrapped through `useT()`. KeymapModal: title, subtitle, filter placeholder, empty state ("No shortcuts match {filter}"), Action / Shortcut column headers. NewProjectDialog: title, subtitle, dirty-state warning, Cancel / Create button labels (Cancel + Create reuse existing `action.cancel` + `action.create` keys). EN + RU dictionaries each grew by 9 keys. Both modals now flip language live with the Preferences switcher. |

**Phase coverage after sweep #22:** Phase 4J i18n covers Command Palette + Help modal + Export modal + Preferences modal + Keymap modal + NewProjectDialog. Remaining v3 components with hardcoded English: SaveModal, LoadModal, Cmo3InspectModal, properties / outliner / parameters / timeline / animations / performance editors. Each is a 30-min wrap; ship as needed when translators ask. Other entirely-pending items: Phase 4I theme audit, 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-30 — Phase first-cut sweep #21 (autonomous)

Sweep #20 closed the cmo3 round-trip line; sweep #21 ships the two i18n follow-ups the plan flagged ⏳ since sweep #4 — locale persistence + Preferences switcher, and a wrap-the-rest pass on the Preferences modal itself (the natural starting point since the switcher is there).

| Phase | Deliverable |
|-------|-------------|
| 4J | i18n persistence + locale switcher + Preferences wrap. `src/i18n/index.js` exports `AVAILABLE_LOCALES` + reads/writes `v3.prefs.locale` to localStorage on `setLocale`. The default loads from localStorage on store init (falls back to `'en'`). `PreferencesModal` gains a "Language" section under Keyboard with a Select tied to `useI18n.setLocale`, and every other label in the modal (`title`, `subtitle`, `themeMode`, all three mode button labels, color preset section header, font / font size / keyboard / shortcuts button / AI section + checkbox + note) goes through `useT()`. Per-locale switcher's stored choice survives reload. EN dictionary grew from 35 → 53 keys; RU dictionary mirror updated. `useT()` re-renders the modal when `setLocale` fires, so switching language flips every label live without close-and-reopen. |

**Phase coverage after sweep #21:** Phase 5 cmo3 round-trip is end-to-end first-cut shipped. Phase 4J i18n has scaffold + first-cut wraps (Command Palette + Help modal + Export modal + Preferences modal) + persistent locale switcher. Pending pieces: Phase 4I theme audit sweep across remaining v3 components (mechanical), 4J wrap-the-rest sweep across remaining v3 components (mechanical), 4A parity harness (env-dependent — Cubism SDK), Phase 6 god-class breakup.

---

### 2026-04-30 — Phase first-cut sweep #20 (autonomous)

Sweep #19 closed the cmo3 import UX loop; sweep #20 picks up the last data-side gap on the line: bone-baked angle detection. The writer's auto-rig path bakes one keyform per angle in `boneConfig.bakedKeyformAngles` (default `[-90,-45,0,45,90]`) for bone-weighted meshes. Models authored with a different range (chibi rigs, custom workflows) need that range read back so re-export keeps the same stops.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` bone-baked angle detection. `cmo3Import.js` scans every `ExtractedKeyformBinding` whose `description` starts with `ParamRotation_` and picks the longest unique sorted-ascending key list across all of them — different bones share the set in standard rigs, longest-wins handles edge cases where one bone has more samples than others. The result lands on `project.boneConfig.bakedKeyformAngles`; null when no bone-baked bindings exist (writer falls back to default at re-export). Verified against `shelby.cmo3`: detected `[-90, -45, 0, 45, 90]` (matches `DEFAULT_BAKED_KEYFORM_ANGLES`, picked up from the legwear mesh's bone-baked keyforms). |

**Phase coverage after sweep #20:** the .cmo3 round-trip line covers everything that's representable in the cmo3 XML and SS's project schema overlap. Cmo3-embedded physics (`CPhysicsSettingsSource`) is the last gap on this line — but SS exports physics to a separate `.physics3.json` not embedded XML, and Cubism-Editor-authored cmo3 files with embedded physics aren't in our test corpus. Deferring physics-from-cmo3 honestly until a model that needs it shows up; the existing physics3.json import path (sweep #5) covers the main case. Other entirely-pending items: 4A parity harness (env-dependent — Cubism SDK adoption), Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #19 (autonomous)

Sweep #18 finished the data side; sweep #19 closes the UX gap. The "Import as new project" button in `Cmo3InspectModal.jsx` was loading the project but NOT building the rigSpec — users saw a static reference scene and had to click Initialize Rig themselves to get param-driven deformations. With imported projects now carrying rigWarps + boneRoles + maskConfigs + variants, the rig is fully buildable post-import; the modal should just trigger that itself.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` import auto-builds rigSpec. `Cmo3InspectModal.jsx`'s `handleImportAsProject` calls `useRigSpecStore.getState().buildRigSpec()` after `loadProject`, and folds the result into the success summary (`Imported X parts, Y groups … · rig: N warps, M rotations, K art meshes`). When buildRigSpec fails the message includes "rigSpec build failed (see console)" instead. End-to-end verified against `shelby.cmo3` via `verify_full_import_to_rigspec.mjs`: 26 warpDeformers (4 body chain + NeckWarp + FaceParallaxWarp + 18 per-mesh rigWarps + 2 inline-emitted for handwear-l/r), 9 rotationDeformers (FaceRotation + 8 GroupRotation_<projectGroupId>), 20 artMeshes (matches part count). The path is the same one the writer's auto-rig pipeline takes during `Initialize Rig` — the import just pre-runs it so the v3 viewport gets a working rig immediately. |

**Phase coverage after sweep #19:** the .cmo3 round-trip pipeline is now end-to-end self-driving — drop a `.cmo3`, click Import, see param-driven deformations in the v3 viewport without further button presses. Pending pieces on this line: physics rules (cmo3-embedded path; shelby has none, so this is a "when we hit a model that needs it" follow-up), bone-baked angles (per-mesh CWarpDeformerForm + ParamRotation_<role> binding decode; shelby's auto-rig doesn't bake bone keyforms by default). Other entirely-pending items: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #18 (autonomous)

Sweep #17 finished masks; sweep #18 wires up variants. Imported parts whose name carries a `.suffix` (`face.smile`, `topwear.winter`, etc.) need `variantOf` + `variantSuffix` populated so the writer's variant fade logic on re-export crossfades them against their base — name-suffix detection isn't enough by itself.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` variant pairing. Imports now call `normalizeVariants({nodes})` from `io/variantNormalizer.js` after the part loop. The normaliser pairs every variant part with its base sibling (case-insensitive name match), sets `variantOf` + `variantSuffix`, reparents the variant to its base's parent, and renumbers `draw_order` across all parts so each variant sits immediately above its base. Orphan variants (no matching base) emit warnings + render as plain layers. The same module is what `psdOrganizer` + `RigService.applyWizardRig` already use, so the post-import shape matches what every other import path produces. Verified against `shelby.cmo3`: 1 variant paired (`face.smile` → `variantOf=face, suffix=smile, draw_order=10`). 0 variant-pass warnings. The pre-existing `topwear копия` part doesn't trigger variant detection (Cyrillic + space don't match the suffix regex) — correct, since it's a Cubism Editor "Duplicate" copy, not a variant. |

**Phase coverage after sweep #18:** the .cmo3 round-trip pipeline now decodes structural + rig + clipping + variants. Pending pieces on this line: physics rules (`CPhysicsSettingsSource` decode + `physicsRules[]` population — physics3.json already has its own import path via `physics3Reverse.js`, but cmo3-embedded physics is a separate code-path), bone-baked angles (`boneConfig.bakedKeyformAngles` from per-mesh `CWarpDeformerForm` + `ParamRotation_<role>` binding combo). Other entirely-pending items: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #17 (autonomous)

Sweep #16 finished the deformer chain; sweep #17 starts the non-rig data sweep with masks. Imported cmo3 models had no clipping at all — irides drew over eyewhite, etc. — because `project.maskConfigs[]` was hard-wired to `[]`.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` mask config synthesis. `cmo3PartExtract.js`'s `ExtractedPart` gains `ownDrawableGuidRef` (the CDrawableGuid xs.ref attached to each part's `ACDrawableSource`), pulled from `<CDrawableGuid xs.n="guid" xs.ref="…"/>`. Without this the importer can't join clip refs back to parts: another part's `clipGuidList` entries point at THIS xs.ref, not the part's xs.id. `cmo3Import.js` builds a `drawableGuidToNodeId` map alongside `partGuidToNodeId` during the part loop, then walks every part's `clipMaskRefs[]` to populate `project.maskConfigs[]` with `{maskedMeshId, maskMeshIds[]}` pairs (matches the `MaskConfig` shape from `rig/maskConfigs.js`). Multi-mask sources warn (writer collapses to first on re-export), unresolved refs warn. Verified against `shelby.cmo3`: 2 mask configs synthesised — `irides-l ← eyewhite-l`, `irides-r ← eyewhite-r` — exactly matching the writer's `CLIP_RULES` table that the auto-rig path produces. 0 mask-pass warnings. |

**Phase coverage after sweep #17:** the .cmo3 round-trip pipeline now decodes the full structural + rig + clipping data the writer needs. Pending pieces on this line: variants (encoded via conditional keyform bindings — partly already covered by sweep #13's binding decode, but not yet wired through `variantNormalizer`), physics rules (`CPhysicsSettingsSource` decode + `physicsRules[]` population), bone-baked angles (`boneConfig.bakedKeyformAngles` from the per-mesh CWarpDeformerForm + ParamRotation_<role> binding combo). Other entirely-pending items: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #16 (autonomous)

Sweep #15 fixed rotation deformers; sweep #16 fixes the other half of the runtime-evaluator gap: every imported leaf rigWarp had `parent: { type: 'warp', id: 'BodyXWarp' }` hard-wired (the writer's reparent step on re-export overwrites this anyway, but evalRig at runtime walks the stored value, so face / eye / brow / hair region rigWarps were traversing the wrong chain in the v3 viewport).

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` chained-warp parent resolution. New `resolveRigWarpParent(startWarp)` inside `buildRigWarpsFromScene` walks each warp's `parentDeformerGuidRef` chain through the unified `deformerByOwnGuid` map (warps + rotations both indexed) and stops at the nearest cmo3 ancestor whose `idStr` matches one of the three named structural warps the writer emits leaf rigWarps under. Translation table: cmo3 `"FaceParallax"` → SS `"FaceParallaxWarp"`, cmo3 `"NeckWarp"` → SS `"NeckWarp"`, cmo3 `"BodyXWarp"` → SS `"BodyXWarp"`. The walk falls through intermediate warps (`BodyWarpZ` / `BodyWarpY` / `BreathWarp`) and intermediate rotations (`FaceRotation` / `Rotation_head`) — those are structural / chain nodes the auto-rig regenerates, not leaf-rigWarp parents — until it reaches a named ancestor. Falls back to `BodyXWarp` if no match (matches writer's default for non-tagged regions). Verified against `shelby.cmo3`: 18/18 rigWarps classified correctly — 14 face-region warps (`irides_l/r`, `eyebrow_l/r`, `eyewhite_l/r`, `eyelash_l/r`, `front_hair`, `back_hair`, `face`, `face_smile`, `ears_l/r`) → `FaceParallaxWarp`; 1 neck warp (`RigWarp_neck`) → `NeckWarp`; 3 body warps (`topwear`, `topwear______` (variant), `legwear`) → `BodyXWarp`. **Honest scope cut:** rotation-parented rigWarps still need an explicit owner-group lookup so the parent could be `{type: 'rotation', id: GroupRotation_<projectGroupId>}`. Today they fall through to the BodyXWarp default; the writer's per-mesh inline path on re-export still wires them under the right rotation deformer (because the parent-group's `boneRole` was set in sweep #15), but evalRig in the v3 viewport walks the warp chain not the rotation chain for those parts pre-export. Fixing that is its own sweep — needs the rigWarp's part to know its owning group's rotation deformer id, which is a write-side convention not a read-side primary. |

**Phase coverage after sweep #16:** the .cmo3 round-trip pipeline now decodes every per-mesh deformer relationship needed for evalRig to walk the chain correctly on import — face / neck / body region warps all parent to the right structural warp. Pending pieces on this line: rotation-parented rigWarps (the writer's per-mesh inline path on re-export wires them correctly, but pre-export evalRig in v3 viewport doesn't yet), variants (encoded via conditional keyform bindings), masks (`maskConfigs`), physics rules, bone-baked angles. Other entirely-pending items: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #15 (autonomous)

Sweep #14 left two `.cmo3` parts (handwear-l/r in shelby) without a stored rigWarp because their `deformerGuidRef` resolves to a `CRotationDeformerSource` rather than a warp. Sweep #15 closes that gap by mirroring the cmo3's rotation deformers onto the importer's group nodes: `boneRole` + `transform.pivotX/Y` get populated so the writer's auto-rig path produces equivalent rotation deformers on re-export — and the per-mesh inline emission picks up `GroupRotation_<role>` as the parent for warp-less parts.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` rotation-deformer → group synthesis. New `applyRotationDeformersToGroups(scene, nodes, guidToNodeId, canvasW, canvasH)` in `cmo3Import.js` runs after the part loop and runs two passes. **Pass 1 (boneRole):** every group whose `name` matches a known bone role (the `armatureOrganizer.js` `CREATE_ORDER` list — `root, torso, neck, head, face, eyes, leftArm/rightArm/leftElbow/rightElbow/bothArms/leftLeg/rightLeg/leftKnee/rightKnee/bothLegs`) gets `boneRole = name`. This catches the typical case where the cmo3 was authored by SS's auto-rig (group names ARE roles) and the cmo3 elected NOT to emit a rotation deformer for some of them (e.g. torso/eyes/neck go through warps, not rotations) — without this pass, those would re-emit unwanted rotations on re-export. **Pass 2 (pivot):** for each `kind='rotation'` deformer, resolve its owning group via `parentPartGuidRef → group.guidRef`, pick the rest keyform (lowest `|angle|`), and translate its normalised `originX/Y` into canvas-px (`origin × canvas`). Stash on `node.transform.pivotX/Y` so the writer's `deformerWorldOrigins` pass picks it up via `worldMatrix × [pivotX, pivotY, 1]`. **Honest scope cut:** rotations chained under another rotation (e.g. `FaceRotation` under `Rotation_head`) carry pixel-OFFSET `originX/Y` relative to the parent rotation, not canvas-normalised — un-translating that needs the parent's resolved canvas pivot, which is the writer's section-3d responsibility. We skip pivot translation in that case and let the writer fall back to bbox-of-descendant-meshes. The rest-keyform `(0, 0)` sentinel that some authoring paths emit is also treated as "unset". The sweep #14 warning about handwear-l/r being parented to rotation deformers is gone — the writer's per-mesh inline emission generates a warp for each at re-export, parented to `GroupRotation_<role>`, just like the auto-rig pipeline does for ordinary projects. Verified against `shelby.cmo3`: `root → boneRole=root pivot=(900.0, 1429.8)`, `head → (909.7, 149.8)`, `leftArm → (1698.0, 360.1)`, `rightArm → (123.8, 373.1)`, `bothLegs → boneRole=bothLegs pivot=(0,0)` (bbox fallback engages because cmo3's keyform origin was `(0,0)`). 0 rotation-pass warnings, 0 rigWarp-pass warnings post-sweep. |

**Phase coverage after sweep #15:** the .cmo3 round-trip pipeline now covers structural + rigWarp + rotation-deformer paths. Full coverage of the typical `.cmo3` authored by SS's own export. Pending pieces on this line: chained-warp parent resolution (cmo3 parents currently default to `BodyXWarp`; FaceParallax / NeckWarp identification needs a deformer-tree walker), variants (encoded via conditional keyform bindings), masks (`maskConfigs`), physics rules, bone-baked angles. Other entirely-pending items: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #13 (autonomous)

Sweeps #8–#12 built up everything needed structurally. Sweep #13 turns it into a working rig: imported `.cmo3` projects get their warp deformers translated into SS's `project.rigWarps[partId]` schema, so model parameters actually drive deformations after import.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` rigWarp synthesis. New `buildRigWarpsFromScene(scene, partGuidToNodeId, canvasW, canvasH)` in `cmo3Import.js` walks the extracted deformer + binding + grid graph and emits one `StoredRigWarpSpec` per part that's directly parented to a warp deformer. Mirrors the writer's per-mesh emission shape exactly (id, name, parent, targetPartId, canvasBbox, gridSize, baseGrid, localFrame, bindings, keyforms, isVisible, isLocked, isQuadTransform) so a re-export hits the writer's `_storedRigWarp`-based fast path without any structural diff. Bindings carry the parameter-id strings + key arrays + interpolation type the cmo3 had. Keyforms are reordered into the writer's binding-axis order (the cmo3's `accessKey` list isn't necessarily in binding order). Base grid is derived from the keyform whose access key resolves to all-zero parameter values (the rest pose); positions are converted from cmo3's normalised 0..1 to canvas-pixel space. Verified against `shelby.cmo3`: 18/20 parts get a rigWarp (the missing 2 are parts under chained / rotation deformers — see scope cut). Sample: `RigWarp_irides_l` synthesised with 3×3 grid, 9 keyforms, bindings `[ParamEyeBallX keys [-1, 0, 1], ParamEyeBallY keys [-1, 0, 1]]`, canvasBbox W=375.3 × H=116.1 px (sized to the actual irides region), keyform[0] keyTuple [-1, -1] matching the writer's cartesian-product ordering. **Honest scope cut:** parts whose `deformerGuidRef` resolves to an intermediate / chained warp or to a CRotationDeformerSource (rotation deformer) are skipped — chained-deformer synthesis needs a deformer-tree walker and `parent: {type, id}` resolution that maps cmo3 parents to SS's named warps (FaceParallaxWarp / NeckWarp / BodyXWarp + the rotation tree). That's the next sweep on this line. |

**Phase coverage after sweep #13:** the .cmo3 round-trip pipeline can now load a `.cmo3` from Cubism Editor and end up with a working SS project where model parameters drive deformations on the simple-warp-direct-parent parts (face / eye / brow / hair regions in the typical Live2D model). Pending pieces: rotation deformers → groupRotation, chained warps (FaceParallax / NeckWarp / BodyXWarp parent resolution), variants, masks, physics rules, bone-baked angles. Other entirely-pending items remain: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #12 (autonomous)

Sweep #11 ended at structural deformer extraction (warp + rotation definitions + keyform position arrays, but no parameter mapping). Sweep #12 closes that gap by extracting the binding graph that says "keyform index N corresponds to ParamX=v0, ParamY=v1, …".

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` keyform binding graph extraction. `cmo3PartExtract.js` gains two more record types and walks every `<KeyformBindingSource xs.id="…">` and `<KeyformGridSource xs.id="…">`. Per `ExtractedKeyformBinding`: `xsId`, `gridSourceRef` (back-pointer to its grid), `parameterGuidRef` (which CParameterGuid drives this binding), `keys[]` (parameter values at each keyform index, e.g. `[-1, 0, 1]` for a 3-key axis), `description` (the parameter id-string the writer stamped, e.g. `"ParamEyeBallX"`), `interpolationType`. Per `ExtractedKeyformGrid`: `xsId` and an `entries[]` array — one per cell of the deformer's keyform grid. Each entry carries `keyformGuidRef` (the CFormGuid xs.ref that matches the deformer keyform's own guid) plus an `accessKey[]` of `{bindingRef, keyIndex}` tuples that locate this cell along each parameter axis. Verifier cross-checks the linkage end-to-end: RigWarp_irides_l → grid #563 → 9 cells → cell 0 access (ParamEyeBallX keyIndex=0 → paramVal=-1, ParamEyeBallY keyIndex=0 → paramVal=-1) → keyformGuid #564 (matches the deformer's first keyform's CFormGuid). Inspector modal shows "Keyform bindings" + "Keyform grids" counts in the metadata grid. **Honest scope cut:** ExtractedDeformer + ExtractedKeyformBinding + ExtractedKeyformGrid → `project.rigWarps[partId]` synthesis is NOT in this sweep. The translator needs to map deformer keyform position arrays into the SS rigWarps schema (which uses a different layout: per-binding keyform tuples vs Cubism's flat cartesian-product list); that's its own sweep. |

**Phase coverage after sweep #12:** the .cmo3 round-trip now decodes everything structurally needed to drive a rig: deformer hierarchy (own guid + parent deformer ref + parent part-group ref), warp grids (cols, rows, base + per-keyform positions), rotation deformers (angle/origin/scale per keyform), and the binding graph that maps keyform indices to (parameter, value) tuples. The next sweep on this line synthesises that graph into SS's `project.rigWarps[partId]` so imported models actually deform when params change.

---

### 2026-04-29 — Phase first-cut sweep #11 (autonomous)

Sweep #10 closed the static-reference import path. Sweep #11 starts the rig-decode line: structural extraction of the deformer graph (CWarpDeformerSource + CRotationDeformerSource) so subsequent sweeps can synthesise SS rigWarps + groupRotation from real data instead of regenerating defaults.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` deformer extraction (structural, not yet synthesised). `cmo3PartExtract.js` gains `ExtractedDeformer` records and walks every CWarpDeformerSource + CRotationDeformerSource. Per record: `kind ('warp'|'rotation')`, `idStr` (e.g. `"RigWarp_irides_l"`, `"Rotation_root"`), `name` (localName), `ownGuidRef` (CDeformerGuid xs.ref so other deformers / parts can chain to it), `parentPartGuidRef` (visual hierarchy parent — a part group), `parentDeformerGuidRef` (rig-chain parent — `targetDeformerGuid` xs.ref), `keyformGridSourceRef`. Warps additionally carry `cols`, `rows`, `isQuadTransform`, top-level `positions` (canvas-normalised 0..1), and per-keyform position arrays. Rotation deformers carry `useBoneUi` + per-keyform `angle / originX / originY / scale` from the form attributes. `ExtractedScene` now exposes `deformers[]`; the inspector modal shows warp + rotation counts; the dev verifier dumps the first 8 deformers with their grid dimensions + keyform counts + parent-deformer ref. Verified end-to-end against `shelby.cmo3`: 24 warps + 6 rotations extracted (RigWarp_irides_l/r 3×3 with 9 keyforms, RigWarp_eyebrow_l/r 2×2 with 3 keyforms, Rotation_root with 3 keyforms, etc.); every deformer's parent chain (`#765`, `#735`, `#560`) decoded into the right parent ref. **Honest scope cut:** keyform-to-parameter mapping (which parameter values a particular keyform's index represents) and ExtractedDeformer → `project.rigWarps` synthesis are NOT in this sweep — those need the CParameterBindingSource + KeyformGridSource decode and a translator into SS's rigWarps schema. The plan row tracks that as the next deliverable on the same line. |

**Phase coverage after sweep #11:** the .cmo3 round-trip now decodes every structural piece a rig needs (warps, rotations, parent chain, base + keyform positions, grid dims). The next sweep on this line synthesises ExtractedDeformer + ExtractedDeformerKeyform into SS's `project.rigWarps[partId]` so imported models can deform when params change. Other entirely-pending items remain unchanged: 4A parity harness, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #10 (autonomous)

Sweep #9 stopped at structural scene extraction (parts / groups / textures decoded, surfaced in the inspector). Sweep #10 turns that into a real load path: users can now drop a `.cmo3` and import it as a new SS project.

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` import as static-reference project. New `io/live2d/cmo3Import.js` exports `importCmo3(bytes) → {project, warnings, stats}` that takes the extracted scene + the cmo3's parameter list + canvas dims and synthesises a `loadProject`-ready SS project. Group nodes get parent links via the CPartGuid intermediary (parts use guid xs.refs to point at groups, not the CPartSource xs.id directly). Part nodes get `mesh = {vertices: [{x, y, restX, restY}], uvs: Float32Array, triangles: [[i,j,k], …], edgeIndices: Set()}` in canvas pixel space — matching what the SS edit tools / triangulator already operate on. Each part's GTexture2D xs.ref resolves to its `imageFileBuf_N.png` payload from the CAFF archive; the bytes become a `Blob` and a `URL.createObjectURL` is registered with `node.id === texture.id` so the existing texture pipeline binds without changes. Parameters carry through with min/max/default; ParamOpacity gets `role: 'opacity'`, the rest default to `'standard'`. Inspector modal grows an **Import as new project** primary button (visible whenever a successfully-parsed snapshot is showing) that re-uses the cached bytes from the original pick — no re-pick required. Verified end-to-end against `shelby.cmo3`: 31 nodes (11 groups + 20 parts, full Root Part → root → torso → neck → head/eyes/leftArm/rightArm/leftElbow/rightElbow/bothLegs hierarchy decoded), parts parented correctly (irides → eyes, eyewhite/eyelash/eyebrow → head, etc.), 20 textures bound 1-to-1, 31 parameters with correct roles, mesh shapes pass the SS-side type check (object-array vertices + triplet triangles, not flat). **Honest scope cut:** deformer chain (CWarpDeformerSource / CRotationDeformerSource), keyform grids, parameter bindings, variants, masks, physics, bone-baked angles — none of those are decoded yet; imported projects arrive as a static reference scene where parameters won't deform anything until the rig path lands. The plan row tracks each as deferred. |

**Phase coverage after sweep #10:** the inspect-only path from sweep #8 has grown into a real .cmo3 → SS import for static / reference usage. The next sweep on this line could either (a) add the deformer chain + keyform decode (so imported models actually deform when params change), or (b) tackle 4A parity harness / Phase 6 god-class breakup (both still environment-dependent / pending).

---

### 2026-04-29 — Phase first-cut sweep #9 (autonomous)

Sweep #8 stopped at metadata-only `.cmo3` inspection. Sweep #9 builds on that foundation with a real XStream-style parser + structural scene extraction. No stub-shaped intermediate — every line decodes real bytes:

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` scene extraction. New `io/live2d/cmo3XmlParser.js` is a hand-rolled XStream-style XML parser (no external deps): lexer + recursive tree builder + `xs.id` pool + `resolveRef` / `findChild` / `findChildren` / `findField` / `elementText` / `readNumberArray` helpers. Tolerates Cubism's quirks (mixed text+children, `xs.idx` ordinals, named-field discrimination via `xs.n`) without dragging in jsdom or fast-xml-parser. New `io/live2d/cmo3PartExtract.js` walks the tree and produces typed `ExtractedPart[]` / `ExtractedGroup[]` / `ExtractedTexture[]` records — every CArtMeshSource, CPartSource, and GTexture2D in the model gets a structured representation with vertices in canvas pixels, triangle indices, UVs, texture file path resolved through `GTexture2D → CImageResource → file path="imageFileBuf_N.png"`, parent guid xs.refs (groups carry both their own `guidRef` and `parentGuidRef` so parts can join to groups via the CPartGuid intermediary). `cmo3Inspect.js` was rewired so the inspector modal now shows a parts table (drawableId / name / vert count / triangle count / texture / parent group) + groups list + texture file mapping; `partCount` / `groupCount` / `textureCount` were also fixed (the regex was conflating `xs.id` definitions with `xs.ref` back-references — partCount=137 became the correct partCount=20). Verified end-to-end against project-root `shelby.cmo3`: 20 parts, 11 groups (Root Part → root → torso → neck → head / eyes / leftArm / rightArm chain decoded correctly), 20 textures with each `imageFileBuf_N.png` path resolved. **Honest scope cut:** deformer chain (CWarpDeformerSource / CRotationDeformerSource), keyform grids (CWarpDeformerForm / CArtMeshForm / CRotationDeformerForm), parameter bindings (CParameterBindingSource → which params drive which deformers), variants, masks, physics, bone-baked angles — none of these are decoded yet. Each is its own sweep, and the project-synthesis step that turns ExtractedScene into `project.nodes` / `project.textures` is its own sweep too. The plan row tracks what's done vs. what's left. |

**Phase coverage after sweep #9:** Phase 5 has the inspect path + structural scene extraction on master. The next sweep on the same line could either add the deformer / keyform decode (so a round-tripped model would have its rig back) or wire ExtractedScene into project synthesis (so users can actually load a `.cmo3` as a new SS project — without rig, a static reference). Other entirely-pending items remain unchanged: 4A parity harness (needs Cubism SDK adoption — environment-dependent) + Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #8 (autonomous)

After sweep #7 the only unfinished Phase 5 line was `.cmo3` round-trip. The full reverse-pass of the 4468-LOC `cmo3writer.js` is multi-sweep work; sweep #8 lays the foundation honestly (no stub-shaped code) and ships a real, useful inspect-only path:

| Phase | Deliverable |
|-------|-------------|
| 5 | `.cmo3` inspect-only round-trip (foundation). New `io/live2d/caffUnpacker.js` mirrors `caffPacker.js` byte-for-byte: header parse, obfuscation-key read, file-table walk, per-entry XOR de-obfuscation, ZIP inflate (handles both the standard local-header + central-directory layout `caffPacker.compressZip` writes AND the streaming data-descriptor layout Cubism Editor's exports use). New `io/live2d/cmo3Inspect.js` runs a focused regex scan over the recovered `main.xml` for model name + canvas dimensions + CModelSource serialiser version + parameter list (id-string resolved through the CParameterId pool) + CArtMesh / CPart / CModelImage counts. New `Cmo3InspectModal` (Phase-5-style modal driven by `cmo3InspectStore`) plus `file.inspectCmo3` operator surface it from the F3 palette. Verified against project-root `shelby.cmo3`: 24 archive entries, 137 parts, 34 groups, 31 parameters, all `Param*` IDs / ranges / defaults parse cleanly. Dev-tool script `scripts/dev-tools/verify_cmo3_unpack.mjs` lets future module changes be diff-checked against the same reference. **Honest scope cut:** vertex / triangle / UV arrays, deformer chains (CWarpDeformerSource + CRotationDeformerSource), keyform grids (CArtMeshForm + CWarpDeformerForm + CRotationDeformerForm), variants, masks, physics rules, bone-baked angles — none of those are decoded yet. They need an XStream-style shared-pool resolver that walks `xs.id` / `xs.idx` / `xs.ref` to reconstruct the typed object graph; that's its own sweep, and the regex-scan approach used here doesn't generalise to it. The plan row records what's done vs. what's left so the next person picking it up doesn't have to guess. |

**Phase coverage after sweep #8:** Phase 5 has the inspect path on master plus a foundation (CAFF unpacker + main.xml regex scan) that the next sweep's full XStream resolver can sit on top of. Other entirely-pending items remain: 4A parity harness (needs Cubism SDK adoption — environment-dependent, not pure code) + Phase 6 god-class breakup (still wants 4A's parity harness as a safety net).

---

### 2026-04-29 — Phase first-cut sweep #7 (autonomous)

User said *"Хватит спрашивать! ... Продолжай автономно ... принимай лучшие решения без костылей"* after sweep #6 — durable directive against asking permission between sweeps and against shipping stub-shaped first cuts. Sweep #7 picks the next-most-tractable Phase 5 item that can be done honestly in one sweep:

| Phase | Deliverable |
|-------|-------------|
| 5 | Touch + pen refactor — multi-pointer pinch-zoom + two-finger pan + coarse-pointer hit targets. `CanvasViewport.jsx` grows two new refs (`activePointersRef` Map of every pointer down, `gestureRef` for in-flight gesture state) without disturbing the existing single-pointer `panRef` / `dragRef` flows. When the second touch pointer lands and no vertex/brush drag is active, the handler aborts any started panRef, computes the pair's distance + midpoint, and enters `pinch` mode; subsequent moves apply zoom-around-startMidpoint plus the midpoint's translation since gesture start, so users can pinch-and-slide naturally. `onPointerCancel` is wired to clean up if iOS / Android interrupts the touches mid-gesture. Hit targets bumped to ~44 px on coarse-pointer devices via Tailwind's `pointer-coarse:` variant on the WorkspaceTabs container, the workspace tab buttons, and `ToolbarButton`. **Honest scope cut:** pen pressure for warp lattice editing is *not* shipped — the brush deform path is start-snapshot + delta (not stroke-cumulative), and threading `e.pressure` through it stably needs a brush-engine refactor that's larger than this sweep. The plan row records that as deferred rather than shipping a stub-shaped pressure plumb-without-consumer. |

Also corrected the Phase 5 status table: **Physics Editor — Cubism import**, **Motion timeline scrubbing**, **Asset hot-reload**, and **onnxruntime opt-in** were all shipped in earlier sweeps but the table still showed them ⏳ pending. They're now ✅ with their commit-trail filled in.

**Phase coverage after sweep #7:** Phase 5 has only `.cmo3` round-trip remaining (heavy reverse-parser of the 4468-LOC writer — multi-sweep effort). Other entirely-pending items: 4A parity harness (needs Cubism SDK adoption — environment-dependent, not pure code) + Phase 6 god-class breakup (needs 4A's parity harness as a safety net per "no crutches" — won't be done as ad-hoc extraction).

---

### 2026-04-29 — Phase first-cut sweep #6 (autonomous)

User said *"Continue"* after sweep #5. Two more first cuts:

| Phase | Deliverable |
|-------|-------------|
| 5 | Asset hot-reload via the File System Access API. `src/io/assetHotReload.js` opens a directory picker, lists every PNG, matches each to a part by `node.name` (case-insensitive, ignoring extension), and polls for `lastModified` changes every 1.5s. On change it pushes a fresh `URL.createObjectURL(file)` into `project.textures[].source` (with `skipHistory: true` so live edits don't pollute undo); the existing CanvasViewport texture-sync loop notices the URL change and re-uploads to the GPU. Old blob URLs are revoked after a 5s grace so any in-flight `Image()` decode finishes first. `assetHotReloadStore` (zustand, non-persisted) holds the active watcher; WorkspaceTabs gains a Link/Unlink toolbar button with file count + tooltip. Chromium-only (`showDirectoryPicker` gate); other browsers see a single alert and no button regression. The watcher does not survive page reload — re-link after refresh. |
| 5 | onnxruntime opt-in toggle (Pillar O). New `src/store/preferencesStore.js` (zustand, localStorage-backed) holds `mlEnabled` (default true). PreferencesModal grows an "AI features" section with a checkbox: when off, PsdImportWizard hides the "AI Auto-Rig (DWPose)" button entirely so neither `onnxruntime-web` nor the DWPose model is fetched. Manual rigging + heuristic skeleton path remain unchanged. ONNX itself was already lazy-loaded via dynamic `import()` and chunked into its own vendor bundle in sweep #2 — this closes the loop with a user-visible opt-out. |

**Phase coverage after sweep #6:** Asset hot-reload + onnxruntime opt-in shipped. Remaining entirely-pending: 4A parity harness, Phase 5 `.cmo3` round-trip / touch+pen refactor, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #5 (autonomous)

User said *"Продолжай"* after compact. Three more first cuts:

| Phase | Deliverable |
|-------|-------------|
| 5 | Physics3 round-trip (import). `src/io/live2d/physics3jsonImport.js` reverse-parses a `.physics3.json` file (Version 3) into the resolved-rule shape `physicsRules` expects. Drops fields physics3 doesn't carry (`requireTag`, `requireAnyTag`, `category`) — imported rules emit unconditionally and group under `category: 'imported'`. PhysicsTab gains an "Import .physics3.json" file picker + "Reset" button, so users can replace `project.physicsRules` with the JSON's contents (undoable via `updateProject`) or re-seed from defaults. Status banner reports rule count + first 4 warnings (skipped settings, unknown input types). Click-through editor / per-rule editing surface deferred. |
| 5 | Multi-motion timeline switcher. TimelineEditor's transport bar trades the read-only animation-name span for a real `<select>` listing every clip in `project.animations`; switching syncs `activeAnimationId` + fps/endFrame/seek to 0 so the user can A/B between motions without manual fiddling. The `+ New` button now always creates a fresh clip (was: returned the existing one). |
| 5 | Motion3.json reverse-parser + import button. `src/io/live2d/motion3jsonImport.js` decodes a `.motion3.json` Version-3 segment array back into SS keyframes (linear / stepped / inverse-stepped passed through; bezier collapses to `easing: 'ease-both'` end-point — control points dropped because the engine doesn't ingest per-segment cubic handles). Curves with `Target='Parameter'` become param tracks, `'PartOpacity'` become node-opacity tracks, `'Model'` is skipped with a warning. Timeline transport bar gains a `+ Import` button next to `+ New` that pushes the parsed clip into `project.animations` and switches to it. Motion blending still deferred. |

**Phase coverage after sweep #5:** Phase 5 physics import + multi-motion switcher + motion3 reverse-parser shipped. Remaining entirely-pending: 4A parity harness, Phase 5 `.cmo3` round-trip / asset hot-reload / touch+pen refactor / onnxruntime opt-in, Phase 6 god-class breakup.

---

### 2026-04-29 — Phase first-cut sweep #4 (autonomous)

User said *"Не нужен — продолжаю"*. Four more first cuts:

| Phase | Deliverable |
|-------|-------------|
| 4J | i18n scaffold — `src/i18n/index.js` `t()` / `useT()` lookup with `en` default + `ru` registered. CommandPalette wired as proof of concept. Per-locale Preferences switcher + remaining-component sweep deferred. |
| 3C | Keyform Graph editor read-only first cut. `KeyformGraphEditor.jsx` plots scalar magnitude (mean ‖position − baseGrid‖) per keyform vs paramValue along the first binding. Polish (per-binding tabs, 2D heatmap, drag-handle bezier) deferred. |
| 5 | Project templates in New flow. `v3/templates/projectTemplates.js` registry + `NewProjectDialog.jsx` replace the AlertDialog confirm. Templates: Empty / Square 1024 / Portrait HD / Landscape FHD. Asset library + saved deformer/physics/variant configs + configurable tag set deferred. |
| 6 | Python dev-tooling README. `scripts/dev-tools/README.md` documents the five moc3 inspectors (inspect / mesh / rot / warp) + depth-PSD analyzer + body verifier. |

**Phase coverage after sweep #4:** Only 4A (Reference parity harness), Phase 5 advanced features (physics import / round-trip / asset hot-reload / touch refactor / onnx optional), and Phase 6 god-class breakup remain entirely pending. Every other phase has at least a first cut on master.

---

### 2026-04-29 — Phase first-cut sweep #3 (autonomous)

After sweep #2 the user said *"Продолжаем"*. Three more first cuts:

| Phase | Deliverable |
|-------|-------------|
| 3D | Animation F-curve editor. `FCurveEditor.jsx` registered as `fcurve` editor type, paired in the Animation workspace's timeline area alongside Timeline + Dopesheet. Plots one selected track's value-over-time curve via `interpolateTrack()` on 240 samples; keyframe diamonds overlay; click-to-seek on canvas + on diamond. Read-only first cut. |
| 4I | Theme audit (overlays + sparkline). Replaced `rgb(...)` literals in WarpDeformerOverlay / RotationDeformerOverlay / PerformanceEditor sparkline with `currentColor` + Tailwind utility classes so SVG colours participate in dark mode + theme-preset overrides. |
| 4H | PWA manifest + meta. `public/manifest.webmanifest` + `<link rel="manifest">` + `theme-color` + Apple-specific meta in `index.html`. Browsers can install the app as standalone. SW caching + install-prompt UI deferred. |

**Phase coverage after sweep #3:** Phase 3 (3A/A.1/B/D/E/F-lite shipped, only 3C Keyform Graph remains); Phase 4 (4B/C/D/E/F/G/H-lite/I-lite shipped, only 4A parity + 4J i18n remain — and 4H/4I have follow-ups).

---

### 2026-04-29 — Phase first-cut sweep #2 (autonomous)

Continuation of the previous day's "skip tests, complete all phases"
directive. Six new first cuts shipped after the user said *"Лучше
фазы продолжить"*:

| Phase | Deliverable |
|-------|-------------|
| 4G | `vite.config.js` `manualChunks`: vendor-react / vendor-radix / vendor-lucide / vendor-cmdk / vendor-state / vendor-onnxruntime / vendor-fontsource / vendor catch-all. Index chunk dropped from 1.3 MB / 395 KB gzip to 601 KB / 173 KB gzip. |
| 3E | F3 operator search palette. `commandPaletteStore` (zustand + localStorage recents) + `CommandPalette.jsx` cmdk dialog. Ranks fuzzy by label + id, recents group, chord hints. |
| 4F | Pre-export validation. `validateProjectForExport()` pure checker (`io/exportValidation.js`) wired into ExportModal. Errors block (override checkbox), warnings inline, click-to-jump on `nodeId`. |
| 4E | F1 help / quick-reference. `helpModalStore` + `HelpModal.jsx` static workspace overview + chord cheat-sheet + link to KeymapModal. Per-editor context help deferred. |
| 3B | Dopesheet editor. `DopesheetEditor.jsx` registered as `dopesheet` editor type, paired with Timeline tab in the Animation workspace. One row per track with ticks per keyframe + ruler, click-to-seek. Read-only. |
| 2H | Modal G/R/S transforms. `modalTransformStore` + `ModalTransformOverlay.jsx`. Bare G/R/S begin a Blender-style modal: mouse-drag deltas, X/Y axis constrain, Shift snap (10 px / 15° / 0.1×), click/Enter commit, Esc/right-click revert. Single undo entry via `beginBatch`/`endBatch`. |

**Phase 6 god-class breakup (cmo3writer / moc3writer) deferred:**
`cmo3writer.js` is a single 4468-LOC `async function generateCmo3`
closure — the entire body operates on shared lexical scope. A
correct extraction needs careful inject-pattern + dependency-graph
work without breaking the parity export shipped on 2026-04-26. Too
risky for an autonomous first cut; tag remains parked on Phase 6.

**Phase coverage after sweep #2:**
- Phase 2: 2A, 2B, 2C, 2F, 2H shipped first cuts. 2D/2E/2G folded into 1B Properties tabs. Standalone editors deferred.
- Phase 3: 3A, 3A.1, 3B, 3E, 3F-lite shipped. 3C (Keyform Graph) + 3D (F-curve) pending.
- Phase 4: 4B, 4C, 4D, 4E, 4F, 4G shipped. 4A parity + 4H PWA + 4I theme audit + 4J i18n pending.
- Phase 5: SaveModal+gallery + ExportModal shipped. Physics import / round-trip / templates / touch / onnx pending.
- Phase 6: keymap viewer shipped. God-class breakup + Python README + dead code round 2 + docs + perf audit pending.

---

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

### S — No ErrorBoundary **[STATUS: ✅ shipped 0F.6 / commit `cf6aed4`]**

Originally: `grep ErrorBoundary` returned 0 files. Single React error tore
down the whole app. На rich UI (10+ panels v3) — disaster.

Resolved in Phase 0F.6: `src/components/ErrorBoundary.jsx` shared
between v2 and v3. v3 wraps each `Area` editor in its own boundary so
a single editor crash shows a recoverable "This editor crashed. Restart
it." UI without taking down the rest of the workspace. Captured-error →
Performance Profiler logging is a Phase 4B follow-up.

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

---

## 16. v2 retirement **[STATUS: ✅ EXECUTED 2026-04-29]**

Two-step retirement:

- **Step 1** (commit `44a4d40`) — default UI flipped from v2 to v3.
  `?ui=v2` stayed as legacy escape hatch.
- **Step 2** (commit `15f75e3`, 2026-04-29) — full v2 deletion. `App.jsx` now
  unconditionally renders `<V3AppShell />`; `readUiVersion` and the
  `?ui=v2` branch are gone.

### Files deleted in Step 2

```
src/app/layout/EditorLayout.jsx                (v2 root shell)
src/components/animation/AnimationListPanel.jsx
src/components/armature/ArmaturePanel.jsx
src/components/export/ExportModal.jsx
src/components/inspector/Inspector.jsx
src/components/layers/LayerPanel.jsx
src/components/load/LoadModal.jsx
src/components/load/ProjectGallery.jsx
src/components/parameters/ParametersPanel.jsx
src/components/preferences/PreferencesModal.jsx
src/components/save/SaveModal.jsx
src/components/timeline/TimelinePanel.jsx
src/hooks/useUndoRedo.js                       (v2 keyboard handler)
src/app/                                       (now empty)
```

Bundle dropped 1359 → 1099 kB (−260 kB / −19%) on minified main
chunk; CSS 108 → 98 kB. typecheck + 72/72 test files green.

### Already covered in v3 at deletion time

- Inspector → v3 Properties + internal tab strip (Object / Deformer / Parameter / BlendShapes)
- LayerPanel → v3 Outliner (hierarchy + rig modes + search + ↑↓ keyboard nav)
- Parameters panel → v3 ParametersEditor (groups + click-to-select + Initialize Rig button)
- v2 keyboard handler (Ctrl+Z/Y) → v3 operator dispatcher (app.undo / app.redo) + the rest of the operator set
- v2 ExportModal "Save to file" path → v3 `file.export` (basic only — see follow-ups below)
- v2 SaveModal "Save to file" path → v3 `file.save`
- v2 main toolbar Undo/Redo/Save/Open → v3 WorkspaceTabs toolbar buttons

### Follow-ups (features lost at v2 deletion, scheduled for v3 migration)

| Feature | Status | Commit | Notes |
|---------|--------|--------|-------|
| Advanced export dialog | ✅ shipped | `d24b166` | `ExportModal` with three-format radio. Atlas size / motion preset / per-physics-category toggles still pending — those need ExportService extension. |
| Basic save/load (IndexedDB, named projects, no thumbnails) | ✅ shipped | `00437ef` | Phase 1G placeholder dialog. |
| Save-to-library + gallery (IndexedDB record + thumbnail + named projects + visual browser) | ✅ shipped | `2be491b` | Replaces the Phase 1G placeholder. `SaveModal` + `LoadModal` + `ProjectGallery` + thumbnail capture via `captureStore`. |
| Wizard joint adjust (drag bone pivots) — already broken at v2 deletion | ⏳ pending | — | Phase 1A++ — `layout.move_bone_pivot` operator with viewport gizmo |
| Mesh paint mode (brush-based vertex / blend-shape deltas) | ✅ shipped (blend-shape arming) | `bb7421c` | The v2 viewport already paints when `editorStore.blendShapeEditMode + activeBlendShapeId` are set; v3 added the arming UI in BlendShapeTab. Mesh-vertex paint mode beyond blend-shape deltas still pending. |
| Animation Timeline panel (keyframe edit UI) | ✅ shipped | `0379c7d` + `93aa1e4` | Restored upstream TimelinePanel with param-track plumbing; auto-keyframe in animation mode wires through ParamRow. |
| Random Pose dialog | ⏳ pending | — | Phase 5 niche dialog operator |
| Preferences modal (theme, font, etc.) | ✅ shipped | `9dab70e` + `2fee609` | Theme mode + preset picker + font + Keymap viewer button. |
| ProjectGallery (v2 visual library browser) | ✅ shipped | `2be491b` | Bundled with Save-to-library above. |
| Performance / Profiler editor | ✅ shipped (first cut) | `c7e78ba` | New deliverable beyond v2 retirement list — surfaces FPS + project / mesh / rig stats. |
| Keymap viewer | ✅ shipped (read-only) | `2fee609` | Opens from Preferences. Editing deferred until per-user persistence lands. |
| AnimationsEditor (animation list panel) | ✅ shipped | `1264e27` | Beyond v2 parity — Animation workspace's leftBottom area pairs it with Properties as tabs. |

### v2 code-paths still shared (NOT deleted)

- `CanvasViewport.jsx` — rig pipeline carrier; wrapped by v3 ViewportEditor.
- `SkeletonOverlay.jsx`, `PsdImportWizard.jsx`, `GizmoOverlay.jsx` — overlay components rendered inside CanvasViewport.
- `chainEval.js` / `scenePass.js` / `partRenderer.js` / `transforms.js` — shared runtime, no UI version coupling.
- `projectStore.js` / `editorStore.js` / `paramValuesStore.js` / `rigSpecStore.js` / `animationStore.js` / `selectionStore.js` / `uiV3Store.js` / `operatorStore.js` / `undoHistory.js` — shared state.
- `services/RigService.js` / `ExportService.js` / `ImportService.js` / `PersistenceService.js` — shared façades.

These are the v3-bones; nothing v2-specific lingers in them.

---

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
