// @ts-check

/**
 * Transform Pivot Point — the rotate/scale pivot mode shown in the
 * Viewport header pill (Blender's `VIEW3D_HT_header` pivot dropdown,
 * `reference/blender/scripts/startup/bl_ui/space_view3d.py`).
 *
 * Ids + labels + descriptions are taken verbatim from Blender's
 * `rna_enum_transform_pivot_full_items`
 * (`reference/blender/source/blender/makesrna/intern/rna_scene.cc:585-608`),
 * with two deliberate divergences:
 *
 *   1. `CURSOR` is labelled **"2D Cursor"** (Blender says "3D Cursor").
 *      SS is a 2D editor and its cursor tool is already labelled
 *      "2D Cursor" in `v3/shell/canvasToolbar/tools.js`; using the same
 *      name keeps the UI internally consistent.
 *
 *   2. Blender's `INDIVIDUAL_ORIGINS` ("Pivot around each object's own
 *      origin") is **omitted**. In SS's transform model it is degenerate:
 *      a vertex selection is (practically always) a single connected mesh
 *      island, so per-island origins collapse to the median; and object-
 *      mode rotate/scale already mutates each part's own rotation/scale
 *      in place (`ModalTransformOverlay` never orbits part positions),
 *      so "individual origins" is already the de-facto object behaviour.
 *      A 5th entry duplicating MEDIAN_POINT / the existing object
 *      behaviour would be a phantom control (Rule №1), so it isn't shown.
 *
 * The pivot only acts as a true orbit centre in Edit Mode (vertex G/R/S
 * rotates/scales each selected vert around it — see
 * `ModalVertexTransformOverlay`). In Object Mode it maps mouse motion to
 * the rotation angle / scale magnitude; each part still spins in place.
 *
 * @module v3/transformPivot
 */

/** @typedef {'BOUNDING_BOX_CENTER'|'CURSOR'|'MEDIAN_POINT'|'ACTIVE_ELEMENT'} TransformPivotId */

/** Blender default = Median Point (`scene.tool_settings.transform_pivot_point`). */
export const TRANSFORM_PIVOT_DEFAULT = /** @type {TransformPivotId} */ ('MEDIAN_POINT');

/**
 * Menu order matches Blender's enum (bounding box → cursor → median →
 * active), with `INDIVIDUAL_ORIGINS` removed from between cursor and
 * median. Labels/descriptions verbatim except the `CURSOR` label.
 *
 * @type {ReadonlyArray<{ id: TransformPivotId, label: string, description: string }>}
 */
export const TRANSFORM_PIVOT_ITEMS = Object.freeze([
  {
    id: 'BOUNDING_BOX_CENTER',
    label: 'Bounding Box Center',
    description: 'Pivot around bounding box center of the selection',
  },
  {
    id: 'CURSOR',
    label: '2D Cursor',
    description: 'Pivot around the 2D cursor',
  },
  {
    id: 'MEDIAN_POINT',
    label: 'Median Point',
    description: 'Pivot around the median point of the selection',
  },
  {
    id: 'ACTIVE_ELEMENT',
    label: 'Active Element',
    description: 'Pivot around the active element',
  },
]);

const _IDS = TRANSFORM_PIVOT_ITEMS.map((it) => it.id);

/** Clamp an arbitrary value to a valid pivot id (defaults on miss). */
export function coerceTransformPivot(/** @type {unknown} */ v) {
  return /** @type {TransformPivotId} */ (
    typeof v === 'string' && _IDS.includes(/** @type {TransformPivotId} */ (v))
      ? v
      : TRANSFORM_PIVOT_DEFAULT
  );
}
