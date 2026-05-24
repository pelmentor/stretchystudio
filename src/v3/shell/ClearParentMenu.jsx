// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 7.A.4 — Clear Parent popover.
 *
 * Mirrors Blender's `OBJECT_OT_parent_clear` (`reference/blender/source/
 * blender/editors/object/object_relations.cc:444` — operator registration;
 * the `type` enum starts at `:315`. Audit fix D-7 corrected a pre-existing
 * wrong cite at `:294+` which is `OBJECT_OT_vertex_parent_set`, unrelated).
 * Hotkey: `Alt+P` per `blender_default.py:4510` (audit fix D-5 corrected a
 * pre-existing wrong cite at `:4548`). Three options matching Blender's
 * `type` enum:
 *
 *   - Clear Parent             (CLEAR_PARENT_ALL)
 *   - Clear and Keep Transform (CLEAR_PARENT_KEEP_TRANSFORM)  ← default
 *   - Clear Parent Inverse     (CLEAR_PARENT_INVERSE)
 *
 * The third item is mostly a parity placeholder in SS — we don't store
 * a separate inverse-stored transform, so its behaviour collapses to
 * "clear parent" in the operator. UI keeps the entry so a Blender user's
 * muscle memory finds it.
 *
 * @module v3/shell/ClearParentMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { clearParent } from '../operators/object/parent.js';

const ITEMS = [
  { mode: 'clear',           label: 'Clear Parent' },
  { mode: 'keepTransform',   label: 'Clear and Keep Transform' },
  { mode: 'inverse',         label: 'Clear Parent Inverse' },
];

export function ClearParentMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  useEffect(() => {
    if (kind !== 'clearParent') return;
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

  if (kind !== 'clearParent' || !cursor) return null;

  function commit(mode) {
    try { clearParent(mode); }
    catch (err) { console.error('[ClearParentMenu]', err); }
    close();
  }

  const x = Math.max(0, Math.min(window.innerWidth - 240, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 160, cursor.y + 8));

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[240px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Clear Parent
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
