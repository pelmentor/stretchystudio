// @ts-check

/**
 * v3 Phase 1D — Parameters editor (basic).
 *
 * Lists `project.parameters` grouped by role (Opacity / Standard /
 * Variants / Bones / Groups / Project). Each row is a slider that
 * reads/writes `paramValuesStore`; the CanvasViewport tick reads the
 * same store, so dragging here drives the live deform.
 *
 * "Reset to defaults" restores every dial to its parameter spec
 * default. Plan §4.4 also specifies a PhysicsLinkPanel and the
 * Initialize Rig action; both are scoped follow-ups (Initialize Rig
 * becomes the `rig.initialize` operator in Phase 5; PhysicsLinkPanel
 * lands as part of Phase 2 physics editor work).
 *
 * @module v3/editors/parameters/ParametersEditor
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Wand2 } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useParamValuesStore } from '../../../store/paramValuesStore.js';
import { initializeRig } from '../../../services/RigService.js';
import { buildParamGroups } from './groupBuilder.js';
import { ParamRow } from './ParamRow.jsx';
import { InitRigOptionsPopover } from './InitRigOptionsPopover.jsx';

export function ParametersEditor() {
  const params = useProjectStore((s) => s.project.parameters ?? []);
  const groups = buildParamGroups(params);

  // Collapse state per group key — local to the editor, not persisted.
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  async function runInit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await initializeRig();
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'rig init failed');
  }

  if (params.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-xs text-muted-foreground select-none gap-3 p-3">
        <span>No parameters yet.</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={runInit}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 text-xs font-semibold"
          >
            <Wand2 size={12} />
            {busy ? 'Initializing…' : 'Initialize Rig'}
          </button>
          <InitRigOptionsPopover />
        </div>
        <span className="text-[10px] text-muted-foreground/70 text-center max-w-xs">
          Runs the rig generators against current geometry and seeds the
          standard parameter set + warp / rotation deformers. Click the
          gear next to the button to opt out of subsystems.
        </span>
        {error ? (
          <span className="text-[10px] text-destructive max-w-xs text-center">{error}</span>
        ) : null}
      </div>
    );
  }

  function toggle(key) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1.5 border-b border-border bg-muted/20 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>{params.length} params</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-50"
            onClick={runInit}
            title="Re-run rig generators and reseed parameters / keyforms."
          >
            <Wand2 size={10} />
            {busy ? 'Initializing…' : 'Initialize Rig'}
          </button>
          <InitRigOptionsPopover />
          <button
            type="button"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => useParamValuesStore.getState().resetToDefaults(params)}
            title="Reset every slider back to its parameter's default value."
          >
            <RotateCcw size={10} />
            reset
          </button>
        </div>
      </div>
      {error ? (
        <div className="px-2 py-1 border-b border-destructive/40 text-[10px] text-destructive bg-destructive/10">
          {error}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <div key={g.key} className="border-b border-border/60">
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                onClick={() => toggle(g.key)}
              >
                {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                <span>{g.label}</span>
                <span className="text-muted-foreground/60 font-normal">({g.params.length})</span>
              </button>
              {!isCollapsed ? (
                <div className="flex flex-col gap-0.5 py-1">
                  {g.params.map((p) => (
                    <ParamRow key={p.id} param={p} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
