// @ts-check

/**
 * Toolset Phase 0.D — Vertex selection canvas overlay.
 *
 * Active when `editorStore.editMode === 'edit'` and
 * `editorStore.toolMode === 'select'` and a meshed part is selected.
 *
 * Renders one dot per vertex in the active part:
 *   - Selected: orange-filled (HSL 25 95% 55%) — matches Blender's
 *     vertex-select highlight colour family.
 *   - Unselected: small white dot at 60% alpha — visible enough to hit
 *     but quiet on busy meshes.
 *   - Active (last clicked): white-bordered orange dot rendered ON TOP
 *     of the regular selected dot. Mirrors Blender's "active element"
 *     mark in Edit Mode.
 *
 * The overlay is read-only: pointer capture stays with CanvasViewport
 * so the existing select / brush / add_vertex / remove_vertex tool
 * dispatch keeps its single source of truth. Pointer events here pass
 * through (`pointerEvents: 'none'`).
 *
 * Mode-switch persistence is handled by editorStore; this overlay
 * just unmounts (returns null) when the conditions aren't met.
 *
 * @module v3/editors/viewport/overlays/VertexSelectionOverlay
 */

import { useMemo } from 'react';
import { useEditorStore } from '../../../../store/editorStore.js';
import { useProjectStore } from '../../../../store/projectStore.js';
import { getMesh } from '../../../../store/objectDataAccess.js';

/** Stable empty array — keeps `useMemo` deps stable when no part is
 *  selected. Avoids the "result of getSnapshot should be cached"
 *  warning that fires on `?? []` patterns. */
const EMPTY_ARRAY = [];

export function VertexSelectionOverlay() {
  // Field-level subscriptions — every dot doesn't need a re-render
  // when an unrelated slot updates. The selection Map is the only
  // hot path here; use a stable reference (Map identity) check.
  const editMode = useEditorStore((s) => s.editMode);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selection = useEditorStore((s) => s.selection);
  const selectedVertexIndices = useEditorStore((s) => s.selectedVertexIndices);
  const activeVertex = useEditorStore((s) => s.activeVertex);
  const view = useEditorStore((s) => s.viewByMode.viewport);
  const project = useProjectStore((s) => s.project);

  const node = project.nodes.find((n) => n?.id === selection?.[0]) ?? null;
  const nodeMesh = node ? getMesh(node, project) : null;
  const active = editMode === 'edit' && toolMode === 'select' && !!nodeMesh;

  const vertices = active && Array.isArray(nodeMesh.vertices)
    ? nodeMesh.vertices
    : EMPTY_ARRAY;

  // Project rest verts → screen-space using the same (zoom, pan)
  // transform the GL canvas pins to. Stable across selection changes
  // (we only depend on the vertex array reference + view).
  const projected = useMemo(() => {
    const out = new Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      out[i] = {
        x: ((v?.x ?? 0)) * view.zoom + view.panX,
        y: ((v?.y ?? 0)) * view.zoom + view.panY,
      };
    }
    return out;
  }, [vertices, view.zoom, view.panX, view.panY]);

  if (!active) return null;

  const partId = node.id;
  const selectedSet = selectedVertexIndices.get(partId) ?? null;
  const isActiveOnPart = activeVertex && activeVertex.partId === partId
    ? activeVertex.vertIndex
    : -1;

  // Render order: unselected dots first (so selected dots draw over
  // them), then selected, then the active mark on top.
  const unselectedNodes = [];
  const selectedNodes = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    const sel = selectedSet?.has(i) ?? false;
    if (sel) {
      selectedNodes.push(
        <circle
          key={`s-${i}`}
          cx={p.x}
          cy={p.y}
          r={4}
          fill="hsl(25 95% 55%)"
          stroke="hsl(0 0% 0%)"
          strokeOpacity={0.4}
          strokeWidth={0.6}
        />,
      );
    } else {
      unselectedNodes.push(
        <circle
          key={`u-${i}`}
          cx={p.x}
          cy={p.y}
          r={2.2}
          fill="hsl(0 0% 100%)"
          fillOpacity={0.6}
          stroke="hsl(0 0% 0%)"
          strokeOpacity={0.35}
          strokeWidth={0.5}
        />,
      );
    }
  }

  const activeMark = isActiveOnPart >= 0 && isActiveOnPart < projected.length
    ? (
      <circle
        cx={projected[isActiveOnPart].x}
        cy={projected[isActiveOnPart].y}
        r={5.5}
        fill="hsl(25 95% 55%)"
        stroke="hsl(0 0% 100%)"
        strokeWidth={1.6}
      />
    )
    : null;

  return (
    <svg
      className="absolute inset-0"
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      aria-hidden
    >
      {unselectedNodes}
      {selectedNodes}
      {activeMark}
    </svg>
  );
}
