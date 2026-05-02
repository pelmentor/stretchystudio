# Left Toolbar (T-panel) Plan

**Status:** SHIPPED 2026-05-02 (v1) — see [`src/v3/shell/CanvasToolbar.jsx`](../src/v3/shell/CanvasToolbar.jsx), [`canvasToolbar/tools.js`](../src/v3/shell/canvasToolbar/tools.js), [`V3_WORKSPACES.md` § Canvas toolbar](V3_WORKSPACES.md). Object Mode Move/Rotate/Scale ship as operator buttons (firing modal G/R/S); sticky variants + UV Adjust slot + Knife/Smooth/Loop Cut deferred. Plan history retained below.
**Origin:** user 2026-05-02 — "We don't have an actual toolbar lol".

## What's missing

Blender's 3D Viewport has a vertical Toolbar on the left edge (T to toggle). It hosts mode-dependent tools that determine what cursor clicks do:

- Object Mode: Select Box / Tweak / Lasso / Cursor / Move / Rotate / Scale / Annotate / Measure
- Edit Mode (mesh): Select / Move / Rotate / Scale / Vertex Add / Knife / Loop Cut / Smooth / Inflate / Shrink/Flatten / Crease / Bevel / Extrude / Inset / Spin / Rip / Slide / Smooth / Randomize / Edit Mode brushes
- Sculpt / Weight Paint / etc. each have their own tool sets

In SS today these tools are scattered:

- `editorStore.toolMode` (`'select' | 'add_vertex' | 'remove_vertex'`) is the data layer
- Mesh Properties tab has Add Vertex / Remove Vertex buttons
- G/R/S keybinds for transform
- Brush settings live in BlendShape / Mesh tabs
- No spatial concentration — discoverability is poor

## Target shape

Vertical icon-strip overlay on the **canvas left edge**, mirroring our existing top-left Mode pill / top-right Layers placement. Always visible on edit Viewport (hidden on Live Preview). Contents are **driven by `editMode`**:

| editMode | Tools |
|----------|-------|
| `null` (Object Mode)   | Select / Move (G) / Rotate (R) / Scale (S) |
| `'mesh'`               | Brush (default) / Add Vertex / Remove Vertex / UV Adjust toggle / Smooth / Knife (future) |
| `'skeleton'`           | Joint Drag (default) / Add Bone (future) / Pivot Snap (future) |
| `'blendShape'`         | Brush (deform) / Smooth (future) / Eraser (future) |

Active tool maps to `editorStore.toolMode`. Click swaps the active tool; click-active again = no-op (Blender behaviour: clicking the active tool doesn't deactivate it).

## Implementation

### Files

- **New** [`src/v3/shell/CanvasToolbar.jsx`](../src/v3/shell/CanvasToolbar.jsx) — reads `editorStore.editMode + toolMode`, renders the vertical strip.
- **New** [`src/v3/shell/canvasToolbar/tools.js`](../src/v3/shell/canvasToolbar/tools.js) — declarative `ToolDef` table mapping `editMode → tool list`. Each entry: `{ id: ToolMode, label, icon, hotkey?, hint }`.
- [`src/store/editorStore.js`](../src/store/editorStore.js) — extend `toolMode` union with `'move' | 'rotate' | 'scale' | 'brush' | 'uv_adjust' | 'joint_drag'` etc. Or split into per-mode toolMode (`meshToolMode`, `objectToolMode`, ...) — TBD at implementation time.
- [`src/v3/shell/CanvasArea.jsx`](../src/v3/shell/CanvasArea.jsx) — mount `<CanvasToolbar />` adjacent to ModePill / ViewLayersPopover, gated on `!isPreview`.
- Properties tabs (MeshTab, BlendShapeTab) — migrate their tool buttons to CONSUME `toolMode` rather than each owning their own state. Single source of truth.
- Existing G/R/S keybinds in operators/registry.js — already write `toolMode` indirectly via modal transform. Stay as-is; toolbar buttons are additional surface.

### Layout

Left edge, ~36px wide vertical strip. Each tool is a 32×32 icon button. Active tool gets `bg-primary` ring. Hover shows tooltip with hotkey hint.

```
┌──┐
│ ⊕│  Select        (default cursor)
│ ↔│  Move          (G)
│ ↻│  Rotate        (R)
│ ⤢│  Scale         (S)
├──┤  ← divider when in mesh edit
│ 🖌│  Brush         (default in mesh edit)
│ +│  Add Vertex
│ −│  Remove Vertex
│ ⊕│  UV Adjust
└──┘
```

### Hotkeys (Blender-aligned)

- `W`         — cycle Select sub-tool (Box / Lasso / Tweak — only relevant once we add them)
- `G` / `R` / `S` — already bound to modal transforms. Toolbar reflects active selection.
- `Q`         — Quick Favorites (skip — not relevant for SS today)
- `Tab`       — already bound to mode toggle (untouched)

Per-tool hotkeys assigned at implementation time matching Blender where possible.

### Migration

1. Decide toolMode shape (single union string vs per-mode).
2. Build `tools.js` declarative table.
3. Build `CanvasToolbar.jsx`. Mount in CanvasArea.
4. Migrate MeshTab's Add/Remove Vertex buttons to read `toolMode` from store + dispatch through the same setter the toolbar uses.
5. Migrate BlendShapeTab's brush settings — keep Brush settings panel (per-tool config) but the active-tool gesture comes from toolbar.
6. Tests: `test:canvasToolbar` for tools.js correctness + render contract.
7. Docs: update [V3_WORKSPACES.md](V3_WORKSPACES.md) with the toolbar overlay.

### Out of scope (deferred)

- Tool-specific draggable side panels (Blender's "Active Tool" panel in Properties). SS settings already live in Properties tabs; no need to duplicate.
- Toolbar resize / flyout sub-tools (Blender's long-press for variants). Implement only if a tool genuinely has variants worth surfacing.
- Persisting last-used tool per editMode across sessions. Would go in preferencesStore. Defer.

## Anti-crutch checklist

- No "phantom" tools that don't actually do anything. Every entry in `tools.js` must wire to a real handler.
- No duplicate state between toolbar and Properties tabs — one `toolMode` slot, both surfaces consume it.
- No conditional gating by workspace (workspaces are layout-only — see [V3_WORKSPACES.md](V3_WORKSPACES.md)).
- Toolbar is mounted only on edit Viewport, not Live Preview (modes meaningless there).
- Hotkeys go through the operator dispatcher (single source of truth for keybinds).

## Estimated cost

1.5–2 days. Half a day for scaffolding + Object Mode tools, half for Mesh Edit tools, quarter day for migrating Properties tabs, quarter day for tests + docs.
