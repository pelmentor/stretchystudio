// @ts-check

/**
 * V3 Re-Rig Phase 1 — RigStagesTab.
 *
 * Surfaces all 11 rig pipeline stages as user-triggerable refit
 * operators. Each row shows the stage name + freshness indicator
 * (🟢 ran-since-init / ⚪ never) + a "Refit" button. Plus a
 * bottom-row "Refit All" button for the full pipeline.
 *
 * **Refit (`mode: 'merge'`) preserves user-authored entries** on
 * conflict-surface fields (manually-added masks, imported physics
 * rules). Distinct from the existing "Re-Init Rig" button on the
 * Parameters editor, which is `mode: 'replace'` (destructive on
 * purpose — wipe and regen).
 *
 * Plan: docs/V3_RERIG_FLOW_PLAN.md → Phase 1.
 *
 * @module v3/editors/properties/tabs/RigStagesTab
 */

import { useState } from 'react';
import { Wrench, Play, RotateCw } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { runStage, refitAll, RIG_STAGE_NAMES } from '../../../../services/RigService.js';

const STAGE_LABELS = {
  parameters:             { label: 'Parameters',              hint: 'Rebuild parameter spec from tag scan' },
  maskConfigs:            { label: 'Mask Configs',            hint: 'Iris↔eyewhite + variant pairings (preserves manual masks)' },
  physicsRules:           { label: 'Physics Rules',           hint: 'Hair / clothing / arm pendulum rules (preserves imported rules)' },
  boneConfig:             { label: 'Bone Config',             hint: 'Baked rotation keyform angles' },
  variantFadeRules:       { label: 'Variant Fade Rules',      hint: 'Backdrop tag list (face / ears / hair)' },
  eyeClosureConfig:       { label: 'Eye Closure Config',      hint: 'Eyelash + eyewhite + iris closure tags + bin count' },
  rotationDeformerConfig: { label: 'Rotation Deformer Config', hint: 'Skip-roles + paramAngle ranges + face-rotation amplitude' },
  autoRigConfig:          { label: 'Auto-Rig Config',         hint: 'Body-warp + face-parallax + neck tunables (preserves subsystem opt-outs)' },
  faceParallax:           { label: 'Face Parallax',           hint: 'Per-vertex deltas for head turn (rest-pose harvest)' },
  bodyWarpChain:          { label: 'Body Warp Chain',         hint: 'BZ → BY → Breath → BX deformer chain (rest-pose harvest)' },
  rigWarps:               { label: 'Per-Mesh Rig Warps',      hint: 'Tag-based shifts (hair sway / iris gaze / mouth / clothing)' },
};

/**
 * @param {{}} _props
 */
export function RigStagesTab(_props) {
  const project = useProjectStore((s) => s.project);
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  const lastRunAt = project?.rigStageLastRunAt ?? {};
  const lastInitAt = project?.lastInitRigCompletedAt ?? null;

  /**
   * @param {string} stage
   * @param {'replace'|'merge'} mode
   */
  async function handleRefitStage(stage, mode) {
    setBusy(stage);
    setError(null);
    try {
      const result = await runStage(/** @type {any} */ (stage), { mode });
      if (!result.ok) setError(`${stage}: ${result.error}`);
    } finally {
      setBusy(null);
    }
  }

  /** @param {'replace'|'merge'} mode */
  async function handleRefitAll(mode) {
    setBusy('__all__');
    setError(null);
    try {
      const result = await refitAll({ mode });
      if (!result.ok) setError(`refit all: ${result.error}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Rig stages" icon={<Wrench size={11} />}>
        <p className="text-[10px] text-muted-foreground leading-snug px-1 mb-1">
          Refit a single stage without touching the rest.{' '}
          <strong>Merge</strong> preserves your manually-added masks,
          imported physics, and subsystem opt-outs. <strong>Replace</strong>{' '}
          wipes the stage and reseeds from defaults.
        </p>
        <div className="flex flex-col gap-1">
          {RIG_STAGE_NAMES.map((s) => {
            const meta = STAGE_LABELS[s] ?? { label: s, hint: '' };
            const ts = lastRunAt[s];
            const indicator = ts ? '🟢' : (lastInitAt ? '⚪' : '·');
            const tsHuman = ts ? new Date(ts).toLocaleString() : 'never refit since init';
            const isBusy = busy === s;
            return (
              <div
                key={s}
                className="flex items-center gap-2 border border-border/60 rounded px-2 py-1 bg-card/30"
              >
                <span
                  className="font-mono text-[10px] w-3 text-center select-none"
                  title={tsHuman}
                  aria-label={tsHuman}
                >
                  {indicator}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-foreground truncate" title={meta.hint}>
                    {meta.label}
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate" title={meta.hint}>
                    {meta.hint}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRefitStage(s, 'merge')}
                  disabled={busy != null}
                  className="h-5 px-1.5 text-[10px] inline-flex items-center gap-0.5 rounded border border-border text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Refit ${meta.label} (preserves user-authored entries)`}
                >
                  {isBusy ? <RotateCw size={9} className="animate-spin" /> : <Play size={9} />}
                  Refit
                </button>
                <button
                  type="button"
                  onClick={() => handleRefitStage(s, 'replace')}
                  disabled={busy != null}
                  className="h-5 px-1.5 text-[10px] inline-flex items-center gap-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Force replace ${meta.label} (lose any customisations)`}
                >
                  Replace
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section label="All stages">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleRefitAll('merge')}
            disabled={busy != null}
            className="flex-1 h-6 px-2 text-[11px] inline-flex items-center justify-center gap-1 rounded border border-border text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Re-run every stage in pipeline order (preserves customisations)"
          >
            {busy === '__all__' ? <RotateCw size={10} className="animate-spin" /> : <Play size={10} />}
            Refit All (merge)
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground leading-snug px-1 mt-1">
          For a destructive full reset, use <strong>Re-Init Rig</strong>{' '}
          on the Parameters editor — that wipes pose state too.
        </p>
        {error ? (
          <div className="mt-1 text-[10px] leading-snug rounded px-1.5 py-1 border border-destructive/40 bg-destructive/5 text-destructive">
            {error}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Section({ label, icon = null, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
        {label}
      </div>
      {children}
    </div>
  );
}
