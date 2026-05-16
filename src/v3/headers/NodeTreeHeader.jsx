// @ts-check

/**
 * NodeTreeHeader — area-header chrome for the NodeTree editor.
 *
 * Mirrors Blender's `NODE_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_node.py:41`). The
 * top-of-header element in Blender is the tree-type selector (shader /
 * compositor / geometry / texture node tree), driven by
 * `snode.tree_type`. SS's analog is `editorStore.nodeTreeMode`
 * (rig / driver / animation) — same role, different vocabulary
 * (SS's three modes derive from canonical sources, not Blender's
 * shader-renderer plumbing).
 *
 * F2-1 lifts the mode pill + driver fallback dropdown out of
 * `NodeTreeArea.jsx`'s body so the area-header slot owns the chrome
 * and the body is left as pure tree rendering. State moved to
 * `editorStore` for shared subscription per the Outliner / Viewport
 * header pattern (Rule №1 — no prop-drilling, no in-body state hidden
 * from the area chrome).
 *
 * @module v3/headers/NodeTreeHeader
 */

import { useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';

/** Mode-pill labels carry canonical-source hints (Audit-fix D-7) — same
 *  set the body used pre-lift. Blender's NodeEditor `tree_type` enum
 *  (`DNA_node_types.h:274-283`) names types but doesn't disclose edit
 *  surfaces because the editor IS edit-capable; SS extends the labels
 *  because NodeTreeArea is read-only. */
const MODES = /** @type {const} */ ([
  { id: 'rig',       label: 'Rig (Modifiers)' },
  { id: 'driver',    label: 'Driver (Expression)' },
  { id: 'animation', label: 'Animation (FCurves)' },
]);

export function NodeTreeHeader() {
  const mode = useEditorStore((s) => s.nodeTreeMode);
  const setMode = useEditorStore((s) => s.setNodeTreeMode);
  const driverFallbackId = useEditorStore((s) => s.nodeTreeDriverFallbackId);
  const setDriverFallbackId = useEditorStore((s) => s.setNodeTreeDriverFallbackId);

  const selectionHead = useEditorStore(
    (s) => (Array.isArray(s.selection) && s.selection.length > 0 ? s.selection[0] : null),
  );
  const parameters = useProjectStore((s) => s.project.parameters);

  const driverIds = useMemo(() => {
    const params = Array.isArray(parameters) ? parameters : [];
    return params.filter((p) => p && p.driver).map((p) => p.id);
  }, [parameters]);

  const driverPick = useMemo(() => {
    if (mode !== 'driver') return null;
    if (driverIds.length === 0) return null;
    return (selectionHead && driverIds.includes(selectionHead))
      ? selectionHead
      : (driverFallbackId && driverIds.includes(driverFallbackId))
        ? driverFallbackId
        : driverIds[0];
  }, [mode, driverIds, selectionHead, driverFallbackId]);

  return (
    <div
      className="border-b border-border bg-muted/20 flex items-center
                 px-2 py-1 gap-1 text-[11px] select-none shrink-0"
    >
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={
              'text-[11px] px-2 py-0.5 rounded transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted')
            }
          >
            {m.label}
          </button>
        );
      })}
      {mode === 'driver' && driverIds.length > 0 ? (
        <select
          className="text-[11px] ml-2 bg-muted text-foreground rounded px-1 py-0.5"
          value={driverPick ?? driverIds[0]}
          onChange={(e) => setDriverFallbackId(e.target.value)}
        >
          {driverIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
