// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 7.A.2 — Mirror axis-pick popover.
 *
 * Mirrors Blender's two-step mirror gesture: `Ctrl+M` opens this menu;
 * the user clicks `X`, `Y`, or `Z` (or presses the matching key) to
 * commit. Z is accepted gracefully (no-op in 2D with a toast).
 *
 * Blender source: `editors/transform/transform_ops.cc:1047+`
 * (`TRANSFORM_OT_mirror`); the keymap binding is in
 * `blender_default.py:4544` (Object Mode `Ctrl+M`). Blender's actual
 * mirror is single-shot via the transform constraint system; the
 * axis-pick popover is SS-specific UX glue (Blender uses inline modal
 * key capture for axis selection — same UX pattern, different surface).
 *
 * @module v3/shell/MirrorAxisMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { mirrorSelected } from '../operators/object/mirror.js';
import { toast } from '../../hooks/use-toast.js';

const ITEMS = [
  { axis: 'x', label: 'X axis', code: 'KeyX' },
  { axis: 'y', label: 'Y axis', code: 'KeyY' },
  { axis: 'z', label: 'Z axis (no-op in 2D)', code: 'KeyZ' },
];

export function MirrorAxisMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  useEffect(() => {
    if (kind !== 'mirrorAxis') return;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      // Bare X/Y/Z committers — Blender's modal-key UX. No modifier filter
      // because the axis-pick popover owns the keyboard during its lifetime.
      const item = ITEMS.find((it) => it.code === e.code);
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        commit(item.axis);
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [kind, close]);

  if (kind !== 'mirrorAxis' || !cursor) return null;

  function commit(axis) {
    try {
      const result = mirrorSelected(axis);
      if (axis === 'z') {
        toast({ title: 'Z axis has no effect in 2D' });
      } else if (result.mirrored === 0 && result.skippedBones > 0) {
        toast({ title: 'Bones can’t be mirrored from Object Mode',
                description: 'Use Pose Mode → Mirror Pose (Ctrl+Shift+V) for bones.' });
      }
    } catch (err) {
      console.error('[MirrorAxisMenu]', err);
    }
    close();
  }

  const x = Math.max(0, Math.min(window.innerWidth - 200, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 160, cursor.y + 8));

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[200px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Mirror axis
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.axis}
          type="button"
          className="w-full text-left text-[12px] px-3 py-1 cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between"
          onClick={() => commit(item.axis)}
        >
          <span>{item.label}</span>
          <span className="opacity-50">{item.code.replace('Key', '')}</span>
        </button>
      ))}
    </div>
  );
}
