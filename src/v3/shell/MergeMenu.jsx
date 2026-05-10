// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 4.A — Merge popover.
 *
 * Renders a 5-button floating menu at the cursor position when
 * `editMenuStore.kind === 'merge'`. Each button invokes one of the
 * five merge variants registered in `v3/operators/registry.js`:
 *   - At Center
 *   - At Cursor
 *   - At Last
 *   - By Distance
 *   - Collapse
 *
 * Click → invokes the operator + closes. Esc / outside-click also
 * closes (no operator runs).
 *
 * The menu is mounted at AppShell level and lives behind a gate flag
 * so it doesn't pull weight when not open.
 *
 * @module v3/shell/MergeMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { getOperator } from '../operators/registry.js';

// Audit fix D-3 — order matches Blender's `MESH_MT_merge` (At First, At
// Last, At Center, At Cursor, Collapse, By Distance).
//
// Audit note D-5 — Blender's "By Distance" is a separate operator
// (`MESH_OT_remove_doubles`), not a sub-item of merge. SS keeps it as
// a sub-item of M-menu for muscle-memory locality (one menu instead of
// two operator searches). Functional difference: ours ignores Blender's
// `use_unselected` (merge selected against unselected) and
// `use_centroid` (merge to vert vs centroid). Documented as v1
// simplification in plan §Phase 4.
const MENU_ITEMS = [
  { id: 'edit.merge.atFirst',     label: 'At First',    chord: '' },
  { id: 'edit.merge.atLast',      label: 'At Last',     chord: '' },
  { id: 'edit.merge.atCenter',    label: 'At Center',   chord: '' },
  { id: 'edit.merge.atCursor',    label: 'At Cursor',   chord: '' },
  { id: 'edit.merge.collapse',    label: 'Collapse',    chord: '' },
  { id: 'edit.merge.byDistance',  label: 'By Distance', chord: '' },
];

export function MergeMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  // Outside-click + Escape: close the menu.
  useEffect(() => {
    if (kind !== 'merge') return;
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

  if (kind !== 'merge' || !cursor) return null;

  // Anchor at cursor; offset by a few px so the cursor doesn't
  // accidentally land on the first item.
  const x = Math.max(0, Math.min(window.innerWidth - 180, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 200, cursor.y + 8));

  function run(itemId) {
    const op = getOperator(itemId);
    // Audit fix G-7 — exec MUST run BEFORE close() because the
    // merge.atCursor operator reads `canvasCursor` from editMenuStore
    // at exec time, and close() clears it. The prior comment had this
    // backwards — currently safe because the order matches the
    // requirement, but a future "always-close-on-click" refactor would
    // silently break atCursor without any failure signal.
    const ctx = { editorType: 'viewport' };
    if (op?.available && !op.available(ctx)) {
      close();
      return;
    }
    if (op?.exec) {
      try { op.exec(ctx); } catch (err) { console.error('[MergeMenu]', err); }
    }
    close();
  }

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[160px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Merge
      </div>
      {MENU_ITEMS.map((item) => {
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
