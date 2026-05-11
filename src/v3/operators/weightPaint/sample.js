// @ts-check

/**
 * Toolset Plan Phase 7.B.1 — Sample Weight (eyedropper).
 *
 * Picks the weight value of the vertex closest to the cursor in the
 * active part's active weight group, and writes it to
 * `editorStore.brushWeight`. The N-panel "Weight" slider updates to
 * match (it's the same slot).
 *
 * Mirrors Blender's `PAINT_OT_weight_sample`
 * (`reference/blender/source/blender/editors/sculpt_paint/mesh/paint_vertex_weight_ops.cc:278`
 * — operator registration; invoke at `:172`). Keymap: `Shift+X` per
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:5136`
 * (`("paint.weight_sample", {"type": 'X', "value": 'PRESS', "shift": True})`).
 *
 * # Phase 7.B audit-fixed binding
 *
 * The plan §7.B.1 originally proposed `Ctrl+LMB` (browser-friendly
 * eyedropper gesture) but the audit-fixed binding table at
 * `TOOLSET_BLENDER_PARITY_PLAN.md` §"Phase 7 — Weight Paint" rebinds to
 * `Shift+X` for Blender muscle-memory parity. SS uses `Shift+X`.
 *
 * # Selection scope
 *
 * Operates on the *currently weight-painted* part — the same node the
 * WeightPaintOverlay reads (`selection[0]`). Sampling on a non-meshed
 * part / no selection is a no-op (returns `null`).
 *
 * # Cursor coords
 *
 * Caller passes screen-space cursor coords (`{x, y}` in client px) and
 * the SVG/canvas bounding rect for the projection. We use the same
 * `(zoom, panX, panY)` projection that WeightPaintOverlay uses so the
 * threshold is in the same space the user perceives.
 *
 * # Pick threshold
 *
 * Defaults to half the brush size — the eyedropper feels Blender-y when
 * picks register from anywhere within a fat cursor. Caller can override
 * for tests.
 *
 * @module v3/operators/weightPaint/sample
 */

import { useEditorStore } from '../../../store/editorStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { getMesh } from '../../../store/objectDataAccess.js';

/**
 * Sample the weight at the cursor and write to `editorStore.brushWeight`.
 *
 * @param {{
 *   clientX: number,
 *   clientY: number,
 *   rect: { left: number, top: number },
 *   threshold?: number,
 * }} args
 * @returns {{ sampled: boolean, weight: number|null, vertexIndex: number|null }}
 */
export function sampleWeightAt({ clientX, clientY, rect, threshold }) {
  const editor = useEditorStore.getState();
  if (editor.editMode !== 'weightPaint') {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const mesh = getMesh(node, project);
  if (!mesh) return { sampled: false, weight: null, vertexIndex: null };
  const verts = mesh.vertices;
  if (!Array.isArray(verts) || verts.length === 0) {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const activeName = mesh.activeWeightGroup;
  const w = activeName && mesh.weightGroups?.[activeName]
    ? mesh.weightGroups[activeName]
    : (mesh.boneWeights ?? null);
  if (!Array.isArray(w) || w.length === 0) {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  // Project canvas-px → screen-px via the same (zoom, panX, panY)
  // projection WeightPaintOverlay uses; sample in screen space so the
  // threshold has the same feel as the brush cursor.
  const view = editor.viewByMode?.viewport ?? { zoom: 1, panX: 0, panY: 0 };
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const r = (typeof threshold === 'number' && threshold > 0)
    ? threshold
    : Math.max(8, (editor.brushSize ?? 50) / 2);
  const r2 = r * r;
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    if (!v) continue;
    const vx = (typeof v.x === 'number') ? v.x : v[0];
    const vy = (typeof v.y === 'number') ? v.y : v[1];
    const px = vx * view.zoom + view.panX;
    const py = vy * view.zoom + view.panY;
    const dx = px - sx;
    const dy = py - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 && d2 <= r2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const sampled = Number(w[bestIdx]) || 0;
  const clamped = Math.max(0, Math.min(1, sampled));
  useEditorStore.getState().setBrushWeight(clamped);
  return { sampled: true, weight: clamped, vertexIndex: bestIdx };
}

/**
 * Operator-callable version: reads the last mouse position from the
 * `op.exec` ctx the registry passes through. The dispatcher records
 * `_lastMouse` globally already (see `lastMousePos()` in registry.js);
 * the operator wrapper in `registry.js` uses that here. Returns the
 * same `{ sampled, weight, vertexIndex }` shape.
 *
 * # G-3 DOCUMENT-AS-DEVIATION (singleton overlay assumption)
 *
 * `document.querySelector('svg[data-overlay="weightPaint"]')` returns
 * the FIRST DOM match in document order. Today `CanvasArea.jsx`
 * mounts `<WeightPaintOverlay />` only when `!isPreview`, so there's
 * exactly one match in the production shell — this is safe in v1.
 * If split-view (two CanvasArea instances) ships in a future phase,
 * the eyedropper would project against the wrong viewport's bounding
 * rect. Future fix: register the active overlay's rect via a
 * module-level getter on mount/unmount and call it instead of
 * querySelector. Tracked under audit fix G-3.
 *
 * # D-7 DOCUMENT-AS-DEVIATION (threshold tied to brushSize)
 *
 * Blender's `ED_MESH_PICK_DEFAULT_VERT_DIST = 25` px is a fixed
 * constant per `reference/blender/source/blender/editors/include/ED_mesh.hh:662`.
 * SS uses `max(8, brushSize/2)` (see `sampleWeightAt`) so the
 * eyedropper feel scales with the brush cursor. Equals 25 at the
 * default brushSize=50; diverges at brushSize<16 (floors to 8 →
 * harder to land than Blender) and brushSize>50 (exceeds 25 → easier
 * to land, may sample distant verts).
 *
 * @param {{ x: number, y: number }} clientPoint
 * @returns {{ sampled: boolean, weight: number|null, vertexIndex: number|null }}
 */
export function sampleWeightFromGlobalCursor(clientPoint) {
  if (typeof window === 'undefined') {
    return { sampled: false, weight: null, vertexIndex: null };
  }
  const svg = document.querySelector('svg[data-overlay="weightPaint"]');
  if (svg && typeof svg.getBoundingClientRect === 'function') {
    const rect = svg.getBoundingClientRect();
    return sampleWeightAt({
      clientX: clientPoint.x,
      clientY: clientPoint.y,
      rect: { left: rect.left, top: rect.top },
    });
  }
  return { sampled: false, weight: null, vertexIndex: null };
}
