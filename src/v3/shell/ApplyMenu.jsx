// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 6.C — Apply popover.
 *
 * Renders a floating menu at the cursor position when
 * `editMenuStore.kind === 'apply'`. Each item invokes one of the
 * `apply.*` operators registered in `v3/operators/registry.js`:
 *   - Apply Pose As Rest
 *   - Apply Armature Modifier
 *
 * Click → invokes the operator + closes. Esc / outside-click also
 * closes (no operator runs).
 *
 * Sister component to `MergeMenu`. Both share `editMenuStore`'s `cursor`
 * anchor and the same gating pattern. Future Apply variants (Apply
 * Visual Transform, Apply All Modifiers) plug in as additional menu
 * entries here without touching the popover infrastructure.
 *
 * Mirrors Blender's `VIEW3D_MT_object_apply`
 * (`reference/blender/scripts/startup/bl_ui/space_view3d.py:3193-3258`)
 * and `VIEW3D_MT_pose_apply` (`:4393-4406`). Audit D-11 corrected a
 * pre-existing wrong cite at `:6280+` (and a wrong class name
 * `OBJECT_MT_object_apply`, which doesn't exist in Blender — the class
 * is `VIEW3D_MT_object_apply`). Keymap bindings:
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:4529`
 * (Object Mode `Ctrl+A` → object_apply) + `:4648` (Pose Mode → pose_apply).
 *
 * **Audit D-7 (DOCUMENT-AS-DEVIATION) — coverage gap vs Blender.**
 * Blender's `VIEW3D_MT_object_apply` ships 13 items (Location /
 * Rotation / Scale / All Transforms / Rotation & Scale / Location to
 * Deltas / Rotation to Deltas / Scale to Deltas / All to Deltas /
 * Animated Transforms to Deltas / Visual Transform / Visual Geometry to
 * Mesh / Visual Geometry to Objects / Duplicates Make Real / Parent
 * Inverse + asset menu items). Pose Mode opens an entirely SEPARATE
 * `VIEW3D_MT_pose_apply` menu with 3 items (Apply Pose As Rest / Apply
 * Selected as Rest Pose / Apply Visual Transform to Pose).
 *
 * SS ships ONE menu (this one) with TWO items, shown in both modes
 * gated by per-op `available()`. Most missing items are out-of-scope
 * for the Live2D data model:
 *
 *   - Object-axis Location / Rotation / Scale / All Transforms / *-to-
 *     Deltas: Live2D models author transforms inside cmo3 deformers
 *     (warps + rotation deformers + bones), not on Object axes. There's
 *     no "Object Location" axis to apply.
 *   - Visual Geometry to Mesh / Visual Geometry to Objects: SS art-meshes
 *     ARE the geometry; there's no derived geometry stack to bake.
 *   - Make Instances Real: no instance collection model.
 *   - Visual Transform: SS's `node.transform` IS the visual transform
 *     (no parent-transform stack for non-bones to collapse).
 *   - Apply Selected as Rest Pose / Apply Visual Transform to Pose:
 *     Pose Mode bone-subset variants — Phase 7+ work.
 *
 * Apply Pose As Rest covers the canonical Pose Mode use; Apply Armature
 * Modifier covers the canonical Object Mode use. When Apply Selected
 * as Rest Pose lands, either split SS into two menus per Blender's
 * pattern or filter visible items by `editor.editMode`.
 *
 * @module v3/shell/ApplyMenu
 */

import { useEffect, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { getOperator } from '../operators/registry.js';
import { reportOpFailure } from '../operators/reportOpFailure.js';

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
      try { op.exec(ctx); } catch (err) { reportOpFailure('ApplyMenu', err, { opId: itemId }); }
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
