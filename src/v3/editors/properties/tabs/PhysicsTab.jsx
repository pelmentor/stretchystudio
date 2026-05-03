// @ts-check

/**
 * v3 Phase 1B — PhysicsTab.
 *
 * Read-only inspector for physics rules that affect the selected
 * group. Physics rules drive sway parameters (hair, clothing, bust,
 * arm) by simulating short pendulums whose outputs map onto
 * `ParamRotation_<group>`. Each rule has gating tags + bone-output
 * lookups; this tab shows the rules that match the currently
 * selected group / bone-bearing entity.
 *
 * The UI surface is deliberately minimal — a list of matching rules
 * with their inputs / vertex chain length / output param ids. Full
 * editing arrives in Phase 2E (Physics Editor).
 *
 * @module v3/editors/properties/tabs/PhysicsTab
 */

import { useRef, useState } from 'react';
import { Wind, Upload, RotateCcw } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { resolvePhysicsRules } from '../../../../io/live2d/rig/physicsConfig.js';
import { parsePhysics3Json } from '../../../../io/live2d/physics3jsonImport.js';
import { markUserAuthored } from '../../../../io/live2d/rig/userAuthorMarkers.js';
import { runStage } from '../../../../services/RigService.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function PhysicsTab({ nodeId }) {
  const project = useProjectStore((s) => s.project);
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Selected item is no longer in the project.
      </div>
    );
  }
  return <PhysicsTabBody node={node} />;
}

function PhysicsTabBody({ node }) {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const stored = Array.isArray(project.physicsRules) ? project.physicsRules : [];

  function handleFile(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({ kind: 'error', text: 'Could not read file.' });
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const { rules, warnings } = parsePhysics3Json(text);
        updateProject((p) => {
          // V3 Re-Rig Phase 0: parsePhysics3Json already marks every rule
          // with `_userAuthored: true`. Defensive re-mark in case a future
          // import path adds rules through a different code path.
          p.physicsRules = rules.map((r) => markUserAuthored(r));
        });
        setStatus({
          kind: warnings.length ? 'warn' : 'ok',
          text: `Imported ${rules.length} rule(s) from ${file.name}.${
            warnings.length ? ` ${warnings.length} warning(s).` : ''
          }`,
          warnings,
        });
      } catch (err) {
        setStatus({ kind: 'error', text: String((err && err.message) || err) });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // V3 Re-Rig Phase 4 — Reset routes through `RigService.runStage` so
  // there's one execution path for "reseed physicsRules from defaults".
  // Semantics unchanged: Reset = `mode: 'replace'` (destructive, wipes
  // imported rules); RigStagesTab → "Refit Physics" = `mode: 'merge'`
  // (preserves imported rules). Two distinct intents, two buttons.
  async function handleReset() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await runStage('physicsRules', { mode: 'replace' });
      if (result.ok) {
        setStatus({ kind: 'ok', text: 'Reset to default rules.' });
      } else {
        setStatus({ kind: 'error', text: result.error ?? 'Reset failed.' });
      }
    } finally {
      setBusy(false);
    }
  }

  const rules = resolvePhysicsRules(project) ?? [];
  const groupName = node.name ?? '';
  // Match rules whose outputs include any param ending in
  // "_<groupName-sanitised>" — that's how Stage 6 of the physics
  // resolver names per-bone outputs (`ParamRotation_<sanitised>`).
  const sanitised = groupName.replace(/[^A-Za-z0-9_]/g, '_');
  const suffix = sanitised ? `_${sanitised}` : null;
  const matched = rules.filter((r) => {
    if (!suffix) return false;
    return (r.outputs ?? []).some((o) => o.paramId?.endsWith(suffix));
  });

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Physics" icon={<Wind size={11} />}>
        <Row label="Group">
          <span className="text-xs text-foreground truncate">{groupName || '—'}</span>
        </Row>
        <Row label="Bone role">
          <span className="text-xs font-mono text-foreground">{node.boneRole ?? '—'}</span>
        </Row>
        <Row label="Rules">
          <span className="text-xs text-foreground tabular-nums">
            {matched.length} matched / {stored.length || rules.length} total
          </span>
        </Row>
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] text-foreground hover:bg-muted/50 transition-colors"
            title="Replace project physics rules with rules read from a .physics3.json file"
          >
            <Upload size={11} /> Import .physics3.json
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={busy}
            className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Re-seed project.physicsRules from the auto-rig defaults (drops imported rules)"
          >
            <RotateCcw size={11} /> Reset
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            className="hidden"
          />
        </div>
        {status ? (
          <div
            className={
              'mt-1 text-[10px] leading-snug rounded px-1.5 py-1 border ' +
              (status.kind === 'error'
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : status.kind === 'warn'
                ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-500'
                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400')
            }
          >
            {status.text}
            {status.warnings && status.warnings.length > 0 ? (
              <ul className="mt-0.5 pl-3 list-disc">
                {status.warnings.slice(0, 4).map((w, i) => (
                  <li key={i} className="font-mono">{w}</li>
                ))}
                {status.warnings.length > 4 ? (
                  <li>… +{status.warnings.length - 4} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Section>

      {matched.length > 0 ? (
        <Section label={`Matching rules (${matched.length})`}>
          <div className="flex flex-col gap-2">
            {matched.map((r) => (
              <div key={r.id} className="border border-border/60 rounded p-1.5 bg-muted/20">
                <div className="text-xs font-medium text-foreground">{r.name ?? r.id}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {r.category ?? '—'} · {r.vertices?.length ?? 0} pendulum verts ·{' '}
                  {(r.inputs ?? []).length} input(s)
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(r.outputs ?? [])
                    .filter((o) => suffix && o.paramId?.endsWith(suffix))
                    .map((o, i) => (
                      <span
                        key={i}
                        className="px-1.5 h-4 inline-flex items-center rounded bg-primary/10 text-primary text-[10px] font-mono"
                        title={`${o.paramId} (vertex ${o.vertexIndex}, scale ${o.scale})`}
                      >
                        {o.paramId}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <p className="text-[10px] text-muted-foreground leading-snug px-1">
          No physics rules drive this group. Phase 2E adds an editor
          for authoring custom rules.
        </p>
      )}
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

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}
