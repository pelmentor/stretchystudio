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

import { Wind } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { resolvePhysicsRules } from '../../../../io/live2d/rig/physicsConfig.js';

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
          <span className="text-xs text-foreground tabular-nums">{matched.length}</span>
        </Row>
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
