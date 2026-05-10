// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 6.C — Apply popover.
 *
 * Renders a floating menu at the cursor position when
 * `editMenuStore.kind === 'apply'`. Each item invokes one of the
 * `apply.*` operators registered in `v3/operators/registry.js`:
 *   - Apply Pose As Rest
 *   - Apply Armature Modifier (lazy-loaded service)
 *
 * Click → invokes the operator + closes. Esc / outside-click also
 * closes (no operator runs).
 *
 * Sister component to `MergeMenu`. Both share `editMenuStore`'s `cursor`
 * anchor and the same gating pattern. Future Apply variants (Apply
 * Visual Transform, Apply All Modifiers) plug in as additional menu
 * entries here without touching the popover infrastructure.
 *
 * Mirrors Blender's `OBJECT_MT_object_apply` /
 * `VIEW3D_MT_object_apply` popups (`reference/blender/scripts/startup/bl_ui/space_view3d.py:6280+`).
 *
 * @module v3/shell/ApplyMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { getOperator } from '../operators/registry.js';

const MENU_ITEMS = [
  { id: 'apply.poseAsRest',       label: 'Pose As Rest' },
  { id: 'apply.armatureModifier', label: 'Armature Modifier' },
];

export function ApplyMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const ref = useRef(null);

  useEffect(() => {
    if (kind !== 'apply') return;
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

  if (kind !== 'apply' || !cursor) return null;

  const x = Math.max(0, Math.min(window.innerWidth - 200, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - 200, cursor.y + 8));

  function run(itemId) {
    const op = getOperator(itemId);
    const ctx = { editorType: 'viewport' };
    if (op?.available && !op.available(ctx)) {
      close();
      return;
    }
    if (op?.exec) {
      try { op.exec(ctx); } catch (err) { console.error('[ApplyMenu]', err); }
    }
    close();
  }

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[180px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Apply
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
