// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * CanvasContextMenu — Audit 4 #2 (2026-05-16).
 *
 * Right-click context menu on the canvas viewport. Dispatches its visible
 * item set off `editorStore.editMode` like Blender's
 * `VIEW3D_MT_<mode>_context_menu` family:
 *
 *   - Object (editMode === null)
 *     → `VIEW3D_MT_object_context_menu`
 *       (`reference/blender/scripts/startup/bl_ui/space_view3d.py:2943`)
 *   - Edit Mode on mesh
 *     → `VIEW3D_MT_edit_mesh_context_menu` (`:4565`)
 *   - Edit Mode on armature
 *     → analogue of `VIEW3D_MT_armature_context_menu` (Blender's bone
 *       rest-edit menu; SS surfaces only the universal items it can
 *       honor today)
 *   - Pose Mode (editMode === 'pose')
 *     → `VIEW3D_MT_pose_context_menu` (`:4409`)
 *   - Weight Paint (editMode === 'weightPaint')
 *     → analogue of `VIEW3D_PT_paint_weight_context_menu` (`:8836` —
 *       Blender's brush-settings Panel; SS surfaces the mode-relevant
 *       operators registered in the registry)
 *
 * Deliberate scope per Rule №1 (no crutches): the menu wires ONLY
 * operators already registered in `v3/operators/registry.js`. No stubs,
 * no "coming soon" rows. Blender items without an SS counterpart are
 * omitted (not greyed). Items whose `available(ctx)` returns false are
 * surfaced disabled — the user sees the operator exists but learns the
 * gate. This matches `SnapMenu.jsx`'s pattern.
 *
 * Sister module to `SnapMenu.jsx` / `MirrorAxisMenu.jsx` / `MergeMenu.jsx`
 * etc. — same `useEditMenuStore.kind === 'canvasContextMenu'` pivot,
 * same outside-click + Escape dismiss, same operator-dispatch ctx
 * (`{ editorType: 'viewport' }`).
 *
 * @module v3/shell/CanvasContextMenu
 */

import { useEffect, useMemo, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { getOperator } from '../operators/registry.js';
import { getDataKind } from '../../store/objectDataAccess.js';
import { pickItemSet } from './canvasContextMenuItems.js';

/** Re-export so the test suite can keep importing from one entry point
 *  if it later wants the rendered shell too. Item data lives in
 *  `canvasContextMenuItems.js` (Node-loadable without a JSX transform). */
export { pickItemSet } from './canvasContextMenuItems.js';

export function CanvasContextMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const editMode = useEditorStore((s) => s.editMode);
  const activeHead = useEditorStore((s) => (
    Array.isArray(s.selection) && s.selection.length > 0 ? s.selection[0] : null
  ));
  const project = useProjectStore((s) => s.project);
  const ref = useRef(null);

  const dataKind = useMemo(() => {
    if (!activeHead) return null;
    const node = project?.nodes?.find((n) => n.id === activeHead);
    return getDataKind(node, project);
  }, [activeHead, project]);

  const { items, heading } = pickItemSet(editMode, dataKind);

  useEffect(() => {
    if (kind !== 'canvasContextMenu') return;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        // Audit fix G-3 (SnapMenu) — stopPropagation so the bubble-phase
        // operator dispatcher doesn't see Escape and fire
        // `selection.clear` after every menu-dismiss.
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

  if (kind !== 'canvasContextMenu' || !cursor) return null;

  // Estimate menu size for viewport clamping. The popover grows with
  // item count; 32px per row + 8px per separator + 28px for the header
  // gives an honest upper bound without measuring layout post-mount.
  const estItemH = 28;
  const estSepH = 9;
  const estHeaderH = 26;
  const sepCount = items.filter((it) => it.separator).length;
  const rowCount = items.length - sepCount;
  const estH = estHeaderH + (rowCount * estItemH) + (sepCount * estSepH) + 8;
  const estW = 240;
  const x = Math.max(4, Math.min(window.innerWidth - estW - 4, cursor.x + 2));
  const y = Math.max(4, Math.min(window.innerHeight - estH - 4, cursor.y + 2));

  function run(itemId) {
    const op = getOperator(itemId);
    const ctx = { editorType: 'viewport' };
    if (!op) {
      close();
      return;
    }
    if (op.available && !op.available(ctx)) {
      close();
      return;
    }
    try { op.exec(ctx); } catch (err) { console.error('[CanvasContextMenu]', err); }
    close();
  }

  return (
    <div
      ref={ref}
      className="fixed z-[110] w-[240px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        {heading}
      </div>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="my-1 h-px bg-border/60" />;
        }
        const op = getOperator(item.id);
        const enabled = !!op && (!op.available || op.available({ editorType: 'viewport' }));
        const label = item.label ?? op?.label ?? item.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!enabled}
            className={
              'w-full text-left text-[12px] px-3 py-1 ' +
              (enabled
                ? 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
                : 'opacity-40 cursor-not-allowed')
            }
            onClick={() => enabled && run(item.id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
