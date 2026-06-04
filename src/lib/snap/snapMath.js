// @ts-check

/**
 * Toolset Plan Phase 2 — pure snap-math helpers.
 *
 * These are extracted from `ModalTransformOverlay` so they can be
 * unit-tested in isolation (jsdom-free). Each function is pure: no
 * stores, no side effects, no DOM.
 *
 *   - `snapDeltaToGrid(deltaCanvas, increment)` — Phase 2.B. Returns a
 *     new `{ x, y }` snapped to the nearest `increment` multiple along
 *     each axis. Increment is canvas-px.
 *   - `snapAngleToIncrement(angleRad, incrementDeg)` — Phase 2.D.
 *     Returns the angle (rad) snapped to the nearest `incrementDeg`
 *     multiple. Tolerates 0/Infinity/NaN by returning the input.
 *   - `snapScaleToIncrement(scale, incrementDeg)` — Phase 2.D scale
 *     companion. `incrementDeg/100` is the scale step (matches
 *     Blender's 1° = 0.01× convention from §2.A jsdoc); scale snaps
 *     to that multiple.
 *   - `computeSelectionAnchor(verts, target, opts?)` — Phase 2.C.
 *     Given a list of selected vertices and a target mode (`'closest'
 *     | 'center' | 'median' | 'active'`), returns the canvas-px point
 *     that should land ON the snap vertex. `closest` uses the cursor
 *     (caller passes `opts.cursor`). `active` uses the active vert
 *     (caller passes `opts.activeVert`). `center` uses the AABB
 *     centre. `median` uses the per-axis median.
 *
 * All inputs are canvas-px; modal callers pre-divide by zoom.
 *
 * @module lib/snap/snapMath
 */

import { getMesh } from '../../store/objectDataAccess.js';

/** Phase 2.B — snap a 2D delta to grid increments along each axis. */
export function snapDeltaToGrid(delta, increment) {
  if (!delta) return { x: 0, y: 0 };
  const inc = Number(increment);
  if (!Number.isFinite(inc) || inc <= 0) return { x: delta.x ?? 0, y: delta.y ?? 0 };
  const dx = Number.isFinite(delta.x) ? delta.x : 0;
  const dy = Number.isFinite(delta.y) ? delta.y : 0;
  return {
    x: Math.round(dx / inc) * inc,
    y: Math.round(dy / inc) * inc,
  };
}

/** Phase 2.D — snap an angle (radians) to nearest `incrementDeg`. */
export function snapAngleToIncrement(angleRad, incrementDeg) {
  if (!Number.isFinite(angleRad)) return angleRad;
  const incDeg = Number(incrementDeg);
  if (!Number.isFinite(incDeg) || incDeg <= 0) return angleRad;
  const stepRad = incDeg * Math.PI / 180;
  return Math.round(angleRad / stepRad) * stepRad;
}

/** Phase 2.D — scale companion. `incrementDeg` is the rotation step
 *  in degrees; scale uses `incrementDeg / 100` per the SNAP_DEFAULT
 *  jsdoc convention (15° → 0.15× step). Falls back to the legacy 0.1
 *  step when `incrementDeg <= 0`. Scale floor is `step` (positive). */
export function snapScaleToIncrement(scale, incrementDeg) {
  if (!Number.isFinite(scale)) return scale;
  const incDeg = Number(incrementDeg);
  if (!Number.isFinite(incDeg) || incDeg <= 0) return scale;
  const step = incDeg / 100;
  if (step <= 0) return scale;
  const snapped = Math.round(scale / step) * step;
  return Math.max(step, snapped);
}

/** Phase 2 audit fix (D-1) — translate-precision multiplier. Blender's
 *  `MOD_PRECISION` makes free-transform 10× finer when Shift held;
 *  identical math whether snap is engaged or not. */
export function applyPrecisionToDelta(delta, factor) {
  if (!delta) return { x: 0, y: 0 };
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return {
    x: (Number.isFinite(delta.x) ? delta.x : 0) * f,
    y: (Number.isFinite(delta.y) ? delta.y : 0) * f,
  };
}

/** Rotation-precision multiplier (Modal R + Shift, no snap). */
export function applyPrecisionToAngle(angleRad, factor) {
  if (!Number.isFinite(angleRad)) return angleRad;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return angleRad * f;
}

/** Scale-precision multiplier. Blender precision-scales relative to
 *  1.0 (so 1.5× with 0.1 precision becomes 1.05×). */
export function applyPrecisionToScale(scale, factor) {
  if (!Number.isFinite(scale)) return scale;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return 1 + (scale - 1) * f;
}

/** Phase 2.C audit fix (D-3) — Blender-faithful selection-anchor pick.
 *
 *  Replaces the old `computeSelectionAnchor` which interpreted
 *  `'closest'` as "cursor IS the anchor". Blender's `SCE_SNAP_SOURCE_CLOSEST`
 *  (transform_snap.cc:1481-1588 `snap_source_closest_fn`) finds the
 *  selection vertex / bbox-corner geometrically closest to the snap
 *  target. The whole selection then translates so that anchor lands
 *  ON the target.
 *
 *  Modes:
 *    - `closest`: the anchor of `anchorVerts` nearest to `opts.snapTarget`.
 *      If no snapTarget is provided, falls back to the first vert (or
 *      `opts.cursor` if anchorVerts is empty).
 *    - `center`:  AABB centre of `anchorVerts` (min/max midpoint).
 *    - `median`:  per-axis median of `anchorVerts`.
 *    - `active`:  the first entry of `anchorVerts` (caller supplies
 *      the active vert / node pivot at index 0). Falls back to cursor
 *      when empty.
 *
 *  Empty `anchorVerts` falls through to `opts.cursor` (or `{x:0,y:0}`)
 *  so the function NEVER returns null.
 *
 *  @param {Array<{x:number,y:number}>} anchorVerts
 *  @param {'closest'|'center'|'median'|'active'} target
 *  @param {{
 *    cursor?: {x:number,y:number},
 *    snapTarget?: {x:number,y:number}|null,
 *  }} [opts]
 */
export function pickSelectionAnchor(anchorVerts, target, opts) {
  const cursor = opts?.cursor && Number.isFinite(opts.cursor.x) && Number.isFinite(opts.cursor.y)
    ? { x: opts.cursor.x, y: opts.cursor.y }
    : { x: 0, y: 0 };
  const list = Array.isArray(anchorVerts)
    ? anchorVerts.filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y))
    : [];

  if (list.length === 0) return cursor;

  if (target === 'closest' || !target) {
    const t = opts?.snapTarget;
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) {
      return { x: list[0].x, y: list[0].y };
    }
    let bestD2 = Infinity;
    let best = list[0];
    for (const v of list) {
      const dx = v.x - t.x;
      const dy = v.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
    return { x: best.x, y: best.y };
  }

  if (target === 'active') {
    return { x: list[0].x, y: list[0].y };
  }

  if (target === 'center') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of list) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  if (target === 'median') {
    const xs = list.map((v) => v.x).sort((a, b) => a - b);
    const ys = list.map((v) => v.y).sort((a, b) => a - b);
    return { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
  }

  return { x: list[0].x, y: list[0].y };
}

/** Enumerate the candidate anchor verts for the active selection.
 *
 *  Phase 2.C audit fix (D-3) — feeds `pickSelectionAnchor`. Per
 *  Blender:
 *    - **Object Mode**: bounding-box corners of each selected node
 *      (Blender uses 8 bbox corners in 3D → 4 corners in 2D). For SS,
 *      the bbox of a part comes from `node.imageBounds` if set, else
 *      `node.mesh.vertices` extents. For each selected node, emit 4
 *      corners + 1 centroid (5 anchor candidates). The centroid is
 *      Blender's "Pivot" anchor under MEDIAN_POINT, here as a fall-
 *      through for unmeshed nodes.
 *    - **Edit Mode**: every vertex listed in
 *      `editorState.selectedVertexIndices.get(activePartId)` projected
 *      to canvas-px via the part's frames-resolved positions (rest
 *      verts, since modal G in Edit Mode is a rest-frame edit).
 *      First entry is the active vertex (so `target='active'` picks it).
 *
 *  All coordinates returned are canvas-px.
 *
 *  @param {object} project
 *  @param {Array<{ id: string, type: string }>} selection
 *  @param {{
 *    editMode?: string,
 *    activeVertex?: { partId: string, vertIndex: number }|null,
 *    selectedVertexIndices?: Map<string, Set<number>>,
 *  }} [editorState]
 */
export function enumerateSelectionAnchorVerts(project, selection, editorState) {
  const out = [];
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(selection)) return out;
  const editMode = editorState?.editMode ?? null;
  const isEdit = editMode && editMode !== 'object';

  // Edit Mode — selected verts of the active part, active vert first.
  if (isEdit && editorState?.activeVertex?.partId) {
    const partId = editorState.activeVertex.partId;
    const node = project.nodes.find((n) => n?.id === partId);
    // v18: getMesh resolves the sibling meshData node for post-split parts.
    const verts = getMesh(node, project)?.vertices;
    const sel = editorState?.selectedVertexIndices?.get?.(partId);
    if (Array.isArray(verts) && sel && sel.size > 0) {
      const av = editorState.activeVertex.vertIndex;
      // Active first.
      if (Number.isInteger(av) && sel.has(av) && verts[av]) {
        out.push({ x: verts[av].x, y: verts[av].y });
      }
      for (const i of sel) {
        if (i === av) continue;
        const v = verts[i];
        if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
          out.push({ x: v.x, y: v.y });
        }
      }
      return out;
    }
  }

  // Object Mode — per selected node, emit anchor candidates.
  for (const ref of selection) {
    if (!ref?.id) continue;
    const node = project.nodes.find((n) => n?.id === ref.id);
    if (!node) continue;

    // Bone group (Pose Mode selection on bones via Modal G): use the
    // bone's pivot point. `pivotX/pivotY` lives on `node.transform`
    // and is in the parent bone's frame; for top-level bones (no
    // bone parent) that frame IS canvas-px. For nested bones this is
    // an approximation that ignores pose composition — sufficient for
    // single-bone snaps but imperfect for chained selections. Snap-
    // target side already uses post-skinning verts in Pose Mode so
    // the snap dot lines up; the anchor approximation only drifts the
    // landing offset for nested bones, which is a polish concern.
    if (node.type === 'group' && typeof node.boneRole === 'string') {
      const px = Number.isFinite(node.transform?.pivotX) ? node.transform.pivotX : 0;
      const py = Number.isFinite(node.transform?.pivotY) ? node.transform.pivotY : 0;
      out.push({ x: px, y: py });
      continue;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // v18: resolve mesh via getMesh so the AABB anchor uses real geometry
    // on post-split parts. Pre-fix v18 parts always fell through to the
    // imageBounds / transform.x-y branch — snap anchors used canvas-bound
    // PSD frame instead of the actual mesh AABB.
    const nodeMesh = getMesh(node, project);
    if (Array.isArray(nodeMesh?.vertices) && nodeMesh.vertices.length > 0) {
      for (const v of nodeMesh.vertices) {
        if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
    } else if (node?.imageBounds) {
      const ib = node.imageBounds;
      minX = ib.left ?? ib.x ?? 0;
      minY = ib.top  ?? ib.y ?? 0;
      maxX = minX + (ib.width  ?? 0);
      maxY = minY + (ib.height ?? 0);
    } else {
      // No geometry — use transform.x/y as a single-point fall-through.
      const x = node.transform?.x ?? 0;
      const y = node.transform?.y ?? 0;
      out.push({ x, y });
      continue;
    }
    if (minX > maxX || minY > maxY) continue;
    // Centroid first so target='active' (which picks index 0) lines
    // up with the selected node's median.
    out.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    out.push({ x: minX, y: minY });
    out.push({ x: maxX, y: minY });
    out.push({ x: maxX, y: maxY });
    out.push({ x: minX, y: maxY });
  }
  return out;
}

