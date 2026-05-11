// @ts-check

/**
 * Animation Phase 1 Stage 1.E — Animation section (per-Object AnimData).
 *
 * Surfaces the per-Object `animData.actionId` slot in the Properties
 * panel — the binding between this Object and an `Action` datablock.
 * Mirrors Blender's "Animation" properties section (e.g. the cube's
 * Object Data tab → Animation > Action picker).
 *
 * # What this section is for
 *
 * Per Stage 1.E + plan §1.D, every Object that animates carries an
 * `animData` slot pointing at one of the project's `actions[]`. Most
 * Cubism characters use the `__scene__` pseudo-Object for the project-
 * wide motion (surfaced via the ActionsEditor's "Scene" header), but
 * per-Object bindings let an authored rig drive different parts with
 * different actions (e.g. a head idle separate from body locomotion).
 *
 * The section appears for `part` and `group` Objects (the only
 * `SelectableType`s that participate in `node.animData` per Stage 1.A
 * `objectDataAccess.isObject(node)`). Scene binding is intentionally
 * NOT exposed here — the scene cannot be selected (Stage 1.D Audit-fix
 * G-16: `selectionStore.SelectableType` excludes 'scene') so the
 * ActionsEditor owns the Scene-binding UI surface.
 *
 * # Wiring
 *
 * - Reads: `node.animData.actionId` from the active Object.
 * - Writes: `assignAction(objectId, actionId)` /
 *   `unassignAction(objectId)` — Stage 1.C `actionRegistry` lifecycle
 *   helpers exposed as `projectStore` thunks.
 *
 * # Blender-fidelity scope (Audit-fix D-10 Stage 1.E)
 *
 * The section surfaces ONLY the Action picker + a derived FCurves
 * count, mirroring Blender's `draw_action_and_slot_selector_for_id`
 * (`reference/blender/scripts/startup/bl_ui/anim.py:8-30`). The other
 * `AnimData` fields available in the schema (`actionInfluence`,
 * `actionBlendmode`, `actionExtendmode` — all v36 defaults from
 * `defaultAnimData()`) live in Blender's NLA Editor, not the per-
 * datablock Animation panel. They are reserved for Phase 4's NLA work
 * to keep the Stage-1.E surface honest.
 *
 * # Section label (Audit-fix D-2 Stage 1.E)
 *
 * Label is "Animation" (not "Animation Data") to match Blender's
 * `bl_label = "Animation"` on `PropertiesAnimationMixin`
 * (`scripts/startup/bl_ui/space_properties.py:135`). The `AnimData`
 * struct name is internal-only.
 *
 * # Default-collapsed (Audit-fix D-3 Stage 1.E)
 *
 * Section ships in the `editorStore.propertiesSectionsCollapsed`
 * initial set so it's collapsed by default — matches Blender's
 * `bl_options = {'DEFAULT_CLOSED'}` on `PropertiesAnimationMixin`
 * (`scripts/startup/bl_ui/space_properties.py:136`). Per-Object
 * bindings rarely change post-import; expanded-by-default would
 * clutter the Item tab on every selection.
 *
 * @module v3/editors/properties/sections/AnimDataSection
 */

import { useMemo } from 'react';
import { Film, Link2Off } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { SectionShell } from './SectionShell.jsx';
import { PropertyRow } from '../primitives/PropertyRow.jsx';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function AnimDataSection({ nodeId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const actions = useProjectStore((s) => s.project.actions);
  const assignAction = useProjectStore((s) => s.assignAction);
  const unassignAction = useProjectStore((s) => s.unassignAction);

  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  );

  // Defensive — every Object should have animData per the v36 migration,
  // but if a hand-edited project skipped it, render an unbound state
  // rather than crashing. Hoist the slot read above the early-return so
  // the `boundAction` useMemo always runs (Rules of Hooks).
  const ad = node?.animData;
  const boundActionId =
    ad && typeof ad === 'object' && typeof ad.actionId === 'string' && ad.actionId.length > 0
      ? ad.actionId
      : null;

  const boundAction = useMemo(
    () => (boundActionId ? actions.find((a) => a.id === boundActionId) : null) ?? null,
    [actions, boundActionId],
  );

  if (!node) return null;

  /** @param {React.ChangeEvent<HTMLSelectElement>} e */
  function onActionChange(e) {
    const v = e.target.value;
    if (v === '') {
      unassignAction(nodeId);
    } else {
      assignAction(nodeId, v, 0);
    }
  }

  return (
    <SectionShell id="animData" label="Animation" icon={<Film size={11} />}>
      <PropertyRow label="Action" title="Action datablock driving this Object's animation">
        {actions.length === 0 ? (
          <span className="text-[10.5px] text-muted-foreground italic">
            No actions — create one in the Actions panel.
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <select
              className="flex-1 h-6 text-[11px] px-1 rounded border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              value={boundActionId ?? ''}
              onChange={onActionChange}
              aria-label="Action binding"
            >
              <option value="">(unbound)</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
            </select>
            {boundActionId ? (
              <button
                type="button"
                className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => unassignAction(nodeId)}
                title="Clear Action binding"
                aria-label="Clear Action binding"
              >
                <Link2Off size={11} />
              </button>
            ) : null}
          </div>
        )}
      </PropertyRow>
      {boundAction ? (
        <PropertyRow label="FCurves" title="Number of fcurves the bound action exposes.">
          <span className="text-[11px] text-foreground tabular-nums">
            {Array.isArray(boundAction.fcurves) ? boundAction.fcurves.length : 0}
          </span>
        </PropertyRow>
      ) : null}
    </SectionShell>
  );
}
