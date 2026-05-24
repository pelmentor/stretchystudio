// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 7.A.5 — Set Origin popover.
 *
 * Mirrors Blender's `OBJECT_OT_origin_set` enum-pick UX (in Blender
 * the dropdown lives under Object → Set Origin →); SS surfaces it as
 * a popover triggered by `apply.menu` → "Set Origin" (when extended)
 * or directly via the `object.setOrigin.menu` operator.
 *
 * Blender source: `editors/object/object_transform.cc:760+`.
 * Submenu items:
 *
 *   - Geometry to Origin           — moves geometry to gizmo (NOT shipped
 *                                     in v1; would require origin-stays-put
 *                                     plumbing — opposite of what
 *                                     `applySetOrigin` does. Audit D-12
 *                                     (DOCUMENT-AS-DEVIATION): Blender's
 *                                     `GEOMETRY_TO_ORIGIN` is the FIRST
 *                                     enum item per
 *                                     `object_transform.cc:1876-1880`.
 *                                     Blender users' muscle-memory click
 *                                     position will land on "Origin to
 *                                     Geometry" instead — close enough
 *                                     for the common case but wrong for
 *                                     the centering-on-existing-pivot use)
 *   - Origin to Geometry (Median)  — `setOriginForSelection('median')`.
 *                                     Audit D-10 (DOCUMENT-AS-DEVIATION):
 *                                     Blender respects `transform_pivot_point`
 *                                     (median vs bounds); SS hardcodes mean.
 *   - Origin to 3D Cursor           — `setOriginForSelection('cursor')`
 *   - Origin to Center of Mass (Surface) — `setOriginForSelection('bboxCenter')`.
 *                                     Audit D-11 (DOCUMENT-AS-DEVIATION):
 *                                     SS approximates with AABB midpoint.
 *                                     Blender uses area-weighted centroid
 *                                     via `BKE_mesh_center_of_surface`
 *                                     (`object_transform.cc:1463-1464`).
 *   - Origin to Center of Mass (Volume)  — `setOriginForSelection('weightedGeom')`.
 *                                     SS uses bone-weight weighted centroid;
 *                                     2D analogue of Blender's volume-weighted.
 *
 * @module v3/shell/SetOriginMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { setOriginForSelection } from '../operators/object/setOrigin.js';
import { toast } from '../../hooks/use-toast.js';

const ITEMS = [
  { mode: 'median',       label: 'Origin to Geometry' },
  { mode: 'cursor',       label: 'Origin to 3D Cursor' },
  { mode: 'bboxCenter',   label: 'Origin to Center of Mass (Surface)' },
  { mode: 'weightedGeom', label: 'Origin to Center of Mass (Volume)' },
];

/**
 * Reuses `kind: 'apply'` slot? No — that's used by ApplyMenu. Set Origin
 * gets its own kind: `'setOrigin'`. Adding to editMenuStore is a 1-liner
 * but to keep the popover-mount footprint flat we route through the
 * existing `apply` kind with a sub-state. For clarity here I'll add a
 * dedicated kind.
 */
export function SetOriginMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  useEffect(() => {
    if (kind !== 'setOrigin') return;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        // Audit fix G-3 — stopPropagation so the bubble-phase dispatcher
        // doesn't fire `selection.clear` after every Esc-dismiss.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [kind, close]);

  if (kind !== 'setOrigin' || !cursor) return null;

  function commit(mode) {
    try {
      const result = setOriginForSelection(mode);
      if (result.moved === 0 && result.skipped > 0) {
        toast({ title: 'No top-level meshed parts to set origin on',
                description: 'Set Origin v1 operates on top-level parts only. Clear-parent first if needed.' });
      }
    } catch (err) {
      console.error('[SetOriginMenu]', err);
    }
    close();
  }

  const x = Math.max(0, Math.min(window.innerWidth - 320, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 200, cursor.y + 8));

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[300px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Set Origin
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.mode}
          type="button"
          className="w-full text-left text-[12px] px-3 py-1 cursor-pointer hover:bg-accent hover:text-accent-foreground"
          onClick={() => commit(item.mode)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
