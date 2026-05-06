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
import { ChevronDown, ChevronRight, RotateCcw, Wand2, Sparkles, Plus, X } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useParamValuesStore } from '../../../store/paramValuesStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useWizardStore } from '../../../store/wizardStore.js';
import { initializeRig } from '../../../services/RigService.js';
import { buildParamGroups } from './groupBuilder.js';
import { ParamRow } from './ParamRow.jsx';
import { InitRigOptionsPopover } from './InitRigOptionsPopover.jsx';
import { IdleMotionDialog } from '../animations/IdleMotionDialog.jsx';

export function ParametersEditor() {
  const params = useProjectStore((s) => s.project.parameters ?? []);
  const addParameter = useProjectStore((s) => s.addParameter);
  const select = useSelectionStore((s) => s.select);
  // Initialize Rig must NOT be available while the PSD import wizard
  // is still on screen — clicking it during `review` / `reorder` /
  // `adjust` / `dwpose` runs the rig generators against a half-imported
  // project and seeds garbage. Gate the button on the wizard being
  // closed (step === null).
  const wizardStep = useWizardStore((s) => s.step);
  const wizardOpen = wizardStep !== null;
  const groups = buildParamGroups(params);

  // Collapse state per group key — local to the editor, not persisted.
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  // V4 Phase 2 — inline new-param input. `null` = closed; string = draft id.
  const [draftId, setDraftId] = useState(/** @type {string|null} */ (null));
  // GAP-017 Phase B — surface idle-motion generation right next to Init
  // Rig so the natural "rig → animate" workflow doesn't require a
  // workspace switch. Same dialog AnimationsEditor mounts; either
  // call-site wins, since IdleMotionDialog routes to the Animation
  // workspace + activates the new animation on success.
  const [showIdleDialog, setShowIdleDialog] = useState(false);

  function commitNewParam() {
    if (draftId === null) return;
    const trimmed = draftId.trim();
    if (trimmed.length === 0) {
      setDraftId(null);
      return;
    }
    const ok = addParameter({
      id: trimmed,
      name: trimmed,
      role: 'custom',
      min: 0, max: 1, default: 0,
      decimalPlaces: 2,
      keys: [],
    });
    if (ok) {
      select({ type: 'parameter', id: trimmed });
      setDraftId(null);
    } else {
      setError(`Parameter id "${trimmed}" already exists.`);
    }
  }

  async function runInit() {
    if (busy) return;
    if (wizardOpen) {
      setError('Finish the PSD import wizard before initialising the rig.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await initializeRig();
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'rig init failed');
  }

  if (params.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-xs text-muted-foreground select-none gap-3 p-3">
        <span>{wizardOpen ? 'Finish the PSD import wizard first.' : 'No parameters yet.'}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || wizardOpen}
            onClick={runInit}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 text-xs font-semibold"
            title={wizardOpen
              ? `PSD wizard is on the "${wizardStep}" step — Init Rig will be re-enabled once the wizard finishes.`
              : 'Run the rig generators against current geometry.'}
          >
            <Wand2 size={12} />
            {busy ? 'Initializing…' : 'Initialize Rig'}
          </button>
          <InitRigOptionsPopover />
        </div>
        <span className="text-[10px] text-muted-foreground/70 text-center max-w-xs">
          {wizardOpen
            ? `Currently on the wizard's "${wizardStep}" step. Click "Continue" / "Skip" in the wizard banner to finish import, then Init Rig will be available.`
            : 'Runs the rig generators against current geometry and seeds the standard parameter set + warp / rotation deformers. Click the gear next to the button to opt out of subsystems.'}
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
      {/* Toolbar — proper visual hierarchy. Init Rig is the primary
          action (filled button); add / generate idle / reset are
          secondary icon-buttons with surfaces visible at rest. The
          "10px monospace text-only" pre-refactor was unreadable. */}
      <div className="px-2 py-1.5 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {params.length} params
        </span>
        <div className="flex items-center gap-1.5">
          {/* Primary: Initialize Rig (with subsystems chip beside it) */}
          <div className="flex items-stretch h-7 rounded border border-primary/40 bg-primary/10 overflow-hidden">
            <button
              type="button"
              disabled={busy || wizardOpen}
              onClick={runInit}
              className="flex items-center gap-1.5 px-2.5 text-[11px] font-medium text-foreground hover:bg-primary/20 disabled:opacity-40 disabled:hover:bg-primary/10 transition-colors"
              title={wizardOpen
                ? `PSD wizard is on the "${wizardStep}" step — Init Rig will be re-enabled once the wizard finishes.`
                : 'Re-run rig generators and reseed parameters / keyforms.'}
            >
              <Wand2 size={12} />
              <span>{busy ? 'Initializing…' : 'Initialize Rig'}</span>
            </button>
            <div className="w-px bg-primary/30" />
            <div className="flex items-center px-1.5 hover:bg-primary/20 transition-colors">
              <InitRigOptionsPopover />
            </div>
          </div>

          {/* Secondary: icon buttons. Solid border + subtle bg so they
              read as buttons even at rest. */}
          <ToolbarButton
            onClick={() => { setError(null); setDraftId(''); }}
            title="Add a custom parameter (Init Rig 'merge' preserves it)."
            icon={<Plus size={12} />}
          />
          <ToolbarButton
            onClick={() => setShowIdleDialog(true)}
            title="Generate idle motion (head wander / breath / blinks) and add it as a new animation."
            icon={<Sparkles size={12} />}
            accent
          />
          <ToolbarButton
            onClick={() => useParamValuesStore.getState().resetToDefaults(params)}
            title="Reset every slider back to its parameter's default value."
            icon={<RotateCcw size={12} />}
          />
        </div>
      </div>
      {draftId !== null ? (
        <div className="px-2 py-1.5 border-b border-border bg-card/30 flex items-center gap-1">
          <input
            type="text"
            autoFocus
            placeholder="ParamCustom"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewParam();
              if (e.key === 'Escape') { setDraftId(null); setError(null); }
            }}
            className="h-6 flex-1 min-w-0 px-2 text-[11px] rounded border border-border bg-background text-foreground font-mono focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={commitNewParam}
            disabled={draftId.trim().length === 0}
            className="h-6 px-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 text-[11px] flex items-center"
          >
            create
          </button>
          <button
            type="button"
            onClick={() => { setDraftId(null); setError(null); }}
            className="h-6 px-2 rounded border border-border bg-muted/30 hover:bg-muted/50 text-[11px] flex items-center"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}
      <IdleMotionDialog open={showIdleDialog} onOpenChange={setShowIdleDialog} />
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

/**
 * Compact bordered icon-button for the parameters toolbar. Surface is
 * always visible at rest (the previous text-only mono buttons were
 * borderline invisible). `accent` switches the hover tint to the
 * primary palette for "feature" actions like Generate Idle.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.icon
 * @param {string}   props.title
 * @param {() => void} props.onClick
 * @param {boolean=} props.accent
 */
function ToolbarButton({ icon, title, onClick, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'inline-flex items-center justify-center w-7 h-7 rounded border border-border bg-card/30 text-foreground transition-colors ' +
        (accent ? 'hover:bg-primary/15 hover:text-primary hover:border-primary/40' : 'hover:bg-muted/60')
      }
    >
      {icon}
    </button>
  );
}
