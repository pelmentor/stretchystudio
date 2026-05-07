# Phase 7 — Node Graph Editor Audit

Status: scaffold-only audit (no code changes)
Owner: pelmentor
Drafted: 2026-05-06

## What Phase 7 IS

A future Geometry-Nodes-style visual editor where users see the modifier
stack and driver graph as a node graph: each modifier and each driver
becomes a node, modifier outputs feed into the next modifier's inputs,
driver variables become socket connections from RNA-targeted properties.

## What Phase 7 IS NOT

This document. **No code lands in Phase 7.** This is an audit confirming
the Phase 1–5 scaffolding is graph-shaped enough to feed a future visual
editor without rework.

## Confirm: modifier payloads are serialisable as node parameters

Phase 3 scaffold (`src/store/objectDataAccess.js`) defines `ModifierData`
as:

```js
{
  id: string,
  type: 'WARP_DEFORMER' | 'ROTATION_DEFORMER' | 'BLEND_SHAPE' | 'WEIGHT_GROUP_BIND',
  name: string,
  enabled?: boolean,
  persistentUid?: string,
  payload: object,
}
```

For a node-graph view, each modifier becomes a single graph node. The
payload becomes the node's parameter set, surfaced as labelled input
sockets / inline numeric fields. Constraints already on each modifier
type:

- **WARP_DEFORMER** — payload carries `gridSize`, `bindings[]`,
  `keyforms[]`, `canvasBbox`. All JSON-serialisable; bindings already
  reference parameter ids by string (graph-friendly).
- **ROTATION_DEFORMER** — payload carries `bindings[]`, `keyforms[]`,
  `originX/Y`. Same shape concerns as warp; same conclusion.
- **BLEND_SHAPE** — payload carries `id` + `deltas[]` (per-vertex
  offsets). Deltas are large (~vertex-count entries) but still
  JSON-serialisable.
- **WEIGHT_GROUP_BIND** — payload carries `boneId` + `weights[]`.
  Same.

**Audit verdict:** ✅ Modifier payloads are graph-ready. No reshape
needed before Phase 7.

## Confirm: driver variables are serialisable as node sockets

Phase 5 scaffold (`src/anim/driver.js`) defines `DriverVariable`:

```js
{
  name: string,                              // "a" / "rotZ" / etc
  type?: 'singleProp' | 'transform' | 'rotation',
  target: { id: string, rnaPath: string },   // RNA-pathed addressing
}
```

For a node-graph view: each variable becomes one input socket on the
driver node. The variable's `target.rnaPath` is the wire endpoint —
either rendered as a typed-in string or, more usefully, computed from a
graph connection back to whatever node owns the property.

**Audit verdict:** ✅ Driver variables already address inputs by string,
which is exactly what a graph editor needs (graph wires resolve to
RNA paths at save-time). No reshape needed before Phase 7.

## Missing pieces (out of scope for Phase 7)

These are TODO when the visual editor itself lands, NOT scaffolding gaps
in Phase 1–5.

### 1. Visual layout

Modifiers and drivers need on-screen `(x, y)` positions for graph
nodes. Two options:

- **Option A (auto-layout):** compute layout per-frame from the
  existing parent-chain topology. Simple but reorderable nodes drift.
- **Option B (persistent layout):** store `{ x, y }` per modifier /
  driver as part of the editor's UI state (NOT the project data —
  layout is a view, not authored content). Persists per-user via
  `editorStore` + IndexedDB.

Default recommendation: **Option B**. The graph layout is part of how
the user thinks about their rig; auto-layout would jiggle each save.

### 2. Socket type system

Modifier outputs and driver inputs need declared types so the editor
can colour-code wires + reject incompatible connections (e.g. don't
wire a `rotation` output into an `opacity` input).

Initial type set:

- `scalar` — single number (rotation, opacity, blend-shape weight)
- `vec2` — 2D point (vertex position, pivot)
- `transform` — full 2D transform record
- `param` — Live2D parameter id (string-keyed singleton driver var)

### 3. Group nodes

Blender Geometry Nodes supports nesting node graphs into reusable
"node groups" (think: function abstractions). For SS, this would
correspond to "save this modifier stack as a preset" or "compile this
driver expression into a reusable formula." Useful but additive — not
required for the v1 visual editor.

## Cross-references

- Phase 1 schema: `src/store/projectMigrations.js:18` (v18 split)
- Phase 1 helpers: `src/store/objectDataAccess.js`
- Phase 5 anim primitives: `src/anim/{rnaPath,fcurve,driver}.js`
- Plan doc: `docs/plans/BLENDER_PARITY_REFACTOR.md`

## Conclusion

Phase 1–5 scaffolding is graph-ready. A future visual editor can render
modifier stacks and driver graphs verbatim against the existing data
shape; no schema change or helper reshape blocks Phase 7.

The only non-scaffolding work needed is **the visual editor itself**
(positioning, socket UI, wire rendering, drag-to-connect) — purely
client-side, no project-data migration required.
