// @ts-check

/**
 * v3 — PhysicsTab.
 *
 * Per-node physics inspector (v50, 2026-06-08). Lists every
 * `physicsModifier` attached to the selected node's modifier stack and
 * lets the user toggle enabled / delete per modifier. Project-wide
 * actions (Import .physics3.json, Reset to defaults) remain accessible
 * here because they're the canonical entry points; both rewrite the
 * full project-wide modifier set.
 *
 * @module v3/editors/properties/tabs/PhysicsTab
 */

import { useRef, useState } from 'react';
import { Wind, Upload, RotateCcw, Trash2, Eye, EyeOff } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { installImportedPhysicsRules } from '../../../../io/live2d/rig/physicsConfig.js';
import { parsePhysics3Json } from '../../../../io/live2d/physics3jsonImport.js';
import { runStage } from '../../../../services/RigService.js';
import { getBoneRole } from '../../../../store/objectDataAccess.js';

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
  return <PhysicsTabBody nodeId={nodeId} />;
}

function PhysicsTabBody({ nodeId }) {
  const updateProject = useProjectStore((s) => s.updateProject);
  const node = useProjectStore((s) => s.project.nodes.find((n) => n.id === nodeId));
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const modifiers = Array.isArray(node?.modifiers)
    ? node.modifiers.filter((m) => m && m.type === 'physicsModifier')
    : [];

  function handleFile(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({ kind: 'error', text: 'Could not read file.' });
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const { rules, warnings } = parsePhysics3Json(text);
        let installed = 0;
        updateProject((p) => {
          installed = installImportedPhysicsRules(p, rules);
        });
        setStatus({
          kind: warnings.length ? 'warn' : 'ok',
          text: `Imported ${rules.length} rule(s) (${installed} modifier(s) installed) from ${file.name}.${
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

  async function handleReset() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await runStage('physicsRules', { mode: 'replace' });
      if (result.ok) {
        setStatus({ kind: 'ok', text: 'Reset to default physics modifiers project-wide.' });
      } else {
        setStatus({ kind: 'error', text: result.error ?? 'Reset failed.' });
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleEnabled(modifierIndex) {
    updateProject((p) => {
      const n = p.nodes.find((x) => x.id === nodeId);
      if (!n || !Array.isArray(n.modifiers)) return;
      const physMods = n.modifiers
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && x.m.type === 'physicsModifier');
      const target = physMods[modifierIndex];
      if (!target) return;
      n.modifiers[target.i] = {
        ...target.m,
        enabled: target.m.enabled === false ? true : false,
      };
    });
  }

  function deleteModifier(modifierIndex) {
    updateProject((p) => {
      const n = p.nodes.find((x) => x.id === nodeId);
      if (!n || !Array.isArray(n.modifiers)) return;
      const physMods = n.modifiers
        .map((m, i) => ({ m, i }))
        .filter((x) => x.m && x.m.type === 'physicsModifier');
      const target = physMods[modifierIndex];
      if (!target) return;
      n.modifiers = n.modifiers.filter((_m, i) => i !== target.i);
      if (n.modifiers.length === 0) delete n.modifiers;
    });
  }

  const groupName = node?.name ?? '';

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Physics" icon={<Wind size={11} />}>
        <Row label="Node">
          <span className="text-xs text-foreground truncate">{groupName || '—'}</span>
        </Row>
        <Row label="Bone role">
          <span className="text-xs font-mono text-foreground">{getBoneRole(node) ?? '—'}</span>
        </Row>
        <Row label="Modifiers">
          <span className="text-xs text-foreground tabular-nums">
            {modifiers.length} physics modifier(s) on this node
          </span>
        </Row>
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] text-foreground hover:bg-muted/50 transition-colors"
            title="Replace ALL physics modifiers project-wide with rules read from a .physics3.json file"
          >
            <Upload size={11} /> Import .physics3.json
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={busy}
            className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Re-seed default physics modifiers project-wide (drops imported rules)"
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

      {modifiers.length > 0 ? (
        <Section label={`Physics modifiers (${modifiers.length})`}>
          <div className="flex flex-col gap-2">
            {modifiers.map((m, i) => {
              const enabled = m.enabled !== false;
              return (
                <div key={`${m.ruleId}:${m.output?.paramId ?? i}`}
                     className={`border rounded p-1.5 ${enabled ? 'border-border/60 bg-muted/20' : 'border-border/30 bg-muted/10 opacity-60'}`}>
                  <div className="flex items-center gap-1">
                    <div className="flex-1 text-xs font-medium text-foreground truncate">
                      {m.name ?? m.ruleId}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleEnabled(i)}
                      className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={enabled ? 'Disable modifier' : 'Enable modifier'}
                    >
                      {enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteModifier(i)}
                      className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Delete this physics modifier"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {m.category ?? '—'} · {m.vertices?.length ?? 0} pendulum verts ·{' '}
                    {(m.inputs ?? []).length} input(s)
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.output ? (
                      <span
                        className="px-1.5 h-4 inline-flex items-center rounded bg-primary/10 text-primary text-[10px] font-mono"
                        title={`${m.output.paramId} (vertex ${m.output.vertexIndex}, scale ${m.output.scale}${m.output.isReverse ? ', reverse' : ''})`}
                      >
                        {m.output.paramId}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      ) : (
        <p className="text-[10px] text-muted-foreground leading-snug px-1">
          No physics modifiers on this node. Use Import .physics3.json or
          Reset to seed defaults across the project, then return here to
          inspect / toggle / delete per-node modifiers.
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
