// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 7.A.1 — Snap menu popover.
 *
 * Renders a two-column floating menu when `editMenuStore.kind === 'snap'`.
 * Each item invokes one of the `object.snap.*` operators registered in
 * `v3/operators/registry.js`. Click → invokes + closes. Esc /
 * outside-click also closes (no operator runs).
 *
 * Mirrors Blender's `VIEW3D_MT_snap_pie` (`reference/blender/scripts/
 * startup/bl_ui/space_view3d.py:6377-6411`). Pie menus in SS are
 * rectangular popovers (no radial layout), but the item set is 1:1.
 * Keymap: `Shift+S` per `blender_default.py:4527` (Object Mode).
 *
 * Sister to `MergeMenu` + `ApplyMenu` (single popover infrastructure
 * via `editMenuStore.kind`).
 *
 * @module v3/shell/SnapMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { getOperator } from '../operators/registry.js';

const COLUMN_LEFT = [
  { id: 'object.snap.selectionToCursor',           label: 'Cursor' },
  { id: 'object.snap.selectionToCursorKeepOffset', label: 'Cursor (Keep Offset)' },
  { id: 'object.snap.selectionToGrid',             label: 'Grid' },
  { id: 'object.snap.selectionToWorldOrigin',      label: 'World Origin' },
  { id: 'object.snap.selectionToActive',           label: 'Active' },
];

const COLUMN_RIGHT = [
  { id: 'object.snap.cursorToWorldOrigin', label: 'World Origin' },
  { id: 'object.snap.cursorToSelected',    label: 'Selected' },
  { id: 'object.snap.cursorToGrid',        label: 'Grid' },
  { id: 'object.snap.cursorToActive',      label: 'Active' },
];

export function SnapMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  useEffect(() => {
    if (kind !== 'snap') return;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
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

  if (kind !== 'snap' || !cursor) return null;

  const x = Math.max(0, Math.min(window.innerWidth - 360, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 240, cursor.y + 8));

  function run(itemId) {
    const op = getOperator(itemId);
    const ctx = { editorType: 'viewport' };
    if (op?.available && !op.available(ctx)) {
      close();
      return;
    }
    if (op?.exec) {
      try { op.exec(ctx); } catch (err) { console.error('[SnapMenu]', err); }
    }
    close();
  }

  function renderColumn(items, header) {
    return (
      <div className="flex-1">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
          {header}
        </div>
        {items.map((item) => {
          const op = getOperator(item.id);
          const enabled = !op || !op.available || op.available({ editorType: 'viewport' });
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
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-[110] flex w-[340px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      {renderColumn(COLUMN_LEFT, 'Selection to')}
      <div className="w-px bg-border mx-1" />
      {renderColumn(COLUMN_RIGHT, 'Cursor to')}
    </div>
  );
}
