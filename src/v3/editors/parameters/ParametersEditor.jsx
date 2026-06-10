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

import { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Wand2, Sparkles, Plus, X } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useParamValuesStore } from '../../../store/paramValuesStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useWizardStore } from '../../../store/wizardStore.js';
import { initializeRig } from '../../../services/RigService.js';
import { buildParamGroups } from './groupBuilder.js';
import { ParamRow } from './ParamRow.jsx';
import { InitRigOptionsPopover } from './InitRigOptionsPopover.jsx';
import { IdleMotionDialog } from '../actions/IdleMotionDialog.jsx';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { decodeFCurveTarget, buildParamFCurve } from '../../../anim/animationFCurve.js';
import { upsertKeyframe } from '../../../anim/fcurve.js';
import { toast } from '../../../hooks/use-toast.js';

export function ParametersEditor() {
  // `project.parameters` is always an array (default state + migration
  // guarantee); the prior `?? []` returned a fresh empty array on
  // every snapshot, which broke React's `useSyncExternalStore` cache
  // and triggered re-render loops on adjacent store mutations.
  const params = useProjectStore((s) => s.project.parameters);
  const addParameter = useProjectStore((s) => s.addParameter);
  const select = useSelectionStore((s) => s.select);
  // Initialize Rig must NOT be available while the PSD import wizard
  // is still on screen — clicking it during `review` / `reorder` /
  // `adjust` / `dwpose` runs the rig generators against a half-imported
  // project and seeds garbage. Gate the button on the wizard being
  // closed (step === null).
  const wizardStep = useWizardStore((s) => s.step);
  const wizardOpen = wizardStep !== null;
  const groups = useMemo(() => buildParamGroups(params), [params]);

  // Active param id — surfaced once at the editor level + drilled into
  // each ParamRow as a `selected` boolean so the row's `React.memo`
  // shallow-compare actually skips re-renders. Lifting the selection
  // scan here also avoids the prior O(rows × items) work pattern.
  const activeParamId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'parameter') return items[i].id;
    }
    return null;
  });

  // Active action — needed for the keyed-state dot per row + the
  // per-row I-key keyframe insertion. Read both action sources (scene
  // binding wins, UI fallback) via `getActiveSceneAction`. Memoised on
  // (actions, activeActionId) so 60Hz currentTime ticks don't bust it.
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const projectActions = useProjectStore((s) => s.project.actions);
  const projectNodes  = useProjectStore((s) => s.project.nodes);
  const activeAction = useMemo(
    () => getActiveSceneAction({ actions: projectActions, nodes: projectNodes }, activeActionId),
    [projectActions, projectNodes, activeActionId],
  );

  // Set of paramIds with an fcurve in the active action — drives the
  // green animated-state dot per row. Updates when the action's fcurves
  // change (add/remove of fcurves, action switch).
  const keyedParamIds = useMemo(() => {
    /** @type {Set<string>} */
    const set = new Set();
    if (!activeAction || !Array.isArray(activeAction.fcurves)) return set;
    for (const fc of activeAction.fcurves) {
      const t = decodeFCurveTarget(fc);
      if (t?.kind === 'param') set.add(t.paramId);
    }
    return set;
  }, [activeAction]);

  // Shared hover ref — ParamRow updates this on pointerenter/leave; the
  // window-level I-key handler reads it at fire time to know which
  // param to keyframe. ref instead of state so hover updates don't
  // re-render the editor.
  const hoveredParamIdRef = useRef(/** @type {string|null} */ (null));

  // Hover-gated I-key keyframe insertion (Blender's per-button I via
  // UI keymap → `ANIM_OT_keyframe_insert_button` at
  // `editors/animation/keyframing_ops_rna.cc`). When the user hovers a
  // param row and presses I, we insert a keyform for THAT param at the
  // current scrubber time. Falls back to the selected param if no row
  // is hovered — matches Blender's button-context-precedence-then-
  // selection-context behavior.
  //
  // Independent of the global `KeyI: insertKey.menu` operator (that
  // one opens the AllParams keying-set picker for batch insert). The
  // per-row I is the "per-property" path; the global I is the
  // "keying-set" path. Both ship — the user picks via context.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyI') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Hover wins — Blender's per-button I-key path is strictly
      // hover-bound (UI keymap), so a global I outside the parameters
      // panel falls through to `insertKey.menu` (the AllParams keying-
      // set picker). This keeps the two paths cleanly separated.
      const targetParamId = hoveredParamIdRef.current;
      if (!targetParamId) return;   // not hovering a row → defer to global I-menu
      const action = getActiveSceneAction(
        useProjectStore.getState().project,
        useAnimationStore.getState().activeActionId,
      );
      if (!action) {
        toast({
          title: 'Insert Keyframe',
          description: 'No active action — create one in Actions panel first.',
          variant: 'destructive',
        });
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      // Capture before preventDefault so the global I-menu doesn't
      // also fire on the same keypress.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const time = useAnimationStore.getState().currentTime;
      const value = useParamValuesStore.getState().values[targetParamId];
      const paramSpec = params.find((p) => p.id === targetParamId);
      const fallbackValue = typeof paramSpec?.default === 'number' ? paramSpec.default : 0;
      const v = Number.isFinite(value) ? value : fallbackValue;
      // Default interpolation = 'bezier' — matches Blender's User
      // Preferences → Animation → Default Interpolation Mode default
      // (`BEZT_IPO_BEZ`). `buildParamFCurve` accepts 'ease-both' as
      // bezier proxy for new-fcurve creation path.
      useProjectStore.getState().updateProject((p) => {
        const a = p.actions.find((aa) => aa.id === action.id);
        if (!a) return;
        const fc = a.fcurves.find((f) => {
          const tgt = decodeFCurveTarget(f);
          return tgt?.kind === 'param' && tgt.paramId === targetParamId;
        });
        if (!fc) {
          // First keyframe on this param — synthesise the fcurve.
          const fresh = buildParamFCurve(targetParamId, [
            { time, value: v, easing: 'ease-both' },
          ]);
          if (fresh) a.fcurves.push(fresh);
          return;
        }
        upsertKeyframe(fc, time, v, 'bezier');
      });
      const fps = useAnimationStore.getState().fps;
      const frame = Math.round((time / 1000) * Math.max(1, fps));
      const vDisplay = Math.abs(v) >= 5 ? Number(v).toFixed(0) : Number(v).toFixed(2);
      toast({
        title: 'Insert Keyframe',
        description: `${paramSpec?.name || targetParamId} = ${vDisplay} at frame ${frame}`,
      });
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [params]);

  // Collapse state per group key — local to the editor, not persisted.
  const [collapsed, setCollapsed] = useState(/** @type {Set<string>} */ (new Set()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  // V4 Phase 2 — inline new-param input. `null` = closed; string = draft id.
  const [draftId, setDraftId] = useState(/** @type {string|null} */ (null));
  // GAP-017 Phase B — surface idle-motion generation right next to Init
  // Rig so the natural "rig → animate" workflow doesn't require a
  // workspace switch. Same dialog ActionsEditor mounts; either
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
    <div className="h-full w-full flex flex-col" data-editor-type="parameters">
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
                    <ParamRow
                      key={p.id}
                      param={p}
                      selected={activeParamId === p.id}
                      isKeyed={keyedParamIds.has(p.id)}
                      hoveredParamIdRef={hoveredParamIdRef}
                    />
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
