// @ts-check

/**
 * v3 Phase 1B — MaskTab.
 *
 * Surfaces clip-mask relationships for the selected part. A part can:
 *  - BE masked: it's the `maskedMeshId` of one or more `MaskConfig`s
 *    in `project.maskConfigs` (or has `maskMeshIds` set on its mesh).
 *  - BE a mask: another part references it inside `maskMeshIds`.
 *
 * The tab renders both relationships read-only with a "Show in
 * Outliner" jump for each linked node. Editing mask configs is Phase
 * 2F (Mask Editor); the read surface ships now so the user can audit
 * who clips whom from the same Properties pane that shows everything
 * else about a part.
 *
 * @module v3/editors/properties/tabs/MaskTab
 */

import { useState } from 'react';
import { Layers, Plus, X } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function MaskTab({ nodeId }) {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const select = useSelectionStore((s) => s.select);
  const [picking, setPicking] = useState(false);

  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'part') {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Mask tab is only available for parts.
      </div>
    );
  }

  // Part is masked → look at mask configs whose maskedMeshId points
  // here, plus the legacy node-level `mesh.maskMeshIds` fallback.
  const masks = collectMasks(project, nodeId);
  // Part is a mask → find every config / node referencing this id.
  const maskedBy = collectMaskedBy(project, nodeId);

  /** @param {string} mid */
  function addMask(mid) {
    if (!mid || mid === nodeId) return;
    updateProject((proj) => {
      const cfgs = proj.maskConfigs ?? (proj.maskConfigs = []);
      const existing = cfgs.find((c) => c.maskedMeshId === nodeId);
      if (existing) {
        if (!existing.maskMeshIds.includes(mid)) existing.maskMeshIds.push(mid);
      } else {
        cfgs.push({ maskedMeshId: nodeId, maskMeshIds: [mid] });
      }
    });
    setPicking(false);
  }

  /** @param {string} mid */
  function removeMask(mid) {
    updateProject((proj) => {
      for (const cfg of proj.maskConfigs ?? []) {
        if (cfg.maskedMeshId !== nodeId) continue;
        cfg.maskMeshIds = (cfg.maskMeshIds ?? []).filter((id) => id !== mid);
      }
      // Drop empty configs.
      proj.maskConfigs = (proj.maskConfigs ?? []).filter((c) => (c.maskMeshIds ?? []).length > 0);
      // Also clean legacy node-level reference.
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      if (n?.mesh?.maskMeshIds) {
        n.mesh.maskMeshIds = n.mesh.maskMeshIds.filter((id) => id !== mid);
      }
    });
  }

  // Candidates for adding: every other meshed part not already a mask.
  const usedMaskIds = new Set(masks.map((m) => m.id));
  const candidates = project.nodes
    .filter((n) => n.type === 'part' && n.id !== nodeId && n.mesh && !usedMaskIds.has(n.id))
    .map((n) => ({ id: n.id, name: n.name ?? n.id }));

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Clip mask" icon={<Layers size={11} />}>
        <Row label="Masked by">
          <div className="flex flex-wrap gap-1 items-center">
            {masks.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">none</span>
            ) : (
              masks.map((m) => (
                <NodeChip
                  key={m.id}
                  node={m}
                  onClick={() => select({ type: 'part', id: m.id }, 'replace')}
                  onRemove={() => removeMask(m.id)}
                />
              ))
            )}
            {picking ? (
              <select
                autoFocus
                className="h-5 text-[10px] px-1 rounded bg-muted border border-border"
                onChange={(e) => addMask(e.target.value)}
                onBlur={() => setPicking(false)}
                defaultValue=""
              >
                <option value="" disabled>pick a mask…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="h-5 px-1.5 rounded border border-dashed border-border/80 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 inline-flex items-center gap-0.5"
                title="Add a mask"
              >
                <Plus size={10} /> add
              </button>
            )}
          </div>
        </Row>
        <Row label="Masks for">
          {maskedBy.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">none</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {maskedBy.map((m) => (
                <NodeChip
                  key={m.id}
                  node={m}
                  onClick={() => select({ type: 'part', id: m.id }, 'replace')}
                />
              ))}
            </div>
          )}
        </Row>
      </Section>

      {masks.length === 0 && maskedBy.length === 0 ? (
        <p className="text-[10px] text-muted-foreground leading-snug px-1">
          This part has no clip-mask relationships. Phase 2F adds an
          editor to wire one up.
        </p>
      ) : null}
    </div>
  );
}

/**
 * @param {object} project
 * @param {string} maskedId
 * @returns {Array<{id:string, name:string}>}
 */
function collectMasks(project, maskedId) {
  const out = new Map();
  for (const cfg of project.maskConfigs ?? []) {
    if (cfg?.maskedMeshId !== maskedId) continue;
    for (const mid of cfg.maskMeshIds ?? []) {
      const n = project.nodes.find((nn) => nn.id === mid);
      if (n) out.set(n.id, { id: n.id, name: n.name ?? n.id });
    }
  }
  // Legacy: node.mesh.maskMeshIds
  const node = project.nodes.find((n) => n.id === maskedId);
  for (const mid of node?.mesh?.maskMeshIds ?? []) {
    const n = project.nodes.find((nn) => nn.id === mid);
    if (n) out.set(n.id, { id: n.id, name: n.name ?? n.id });
  }
  return [...out.values()];
}

/**
 * @param {object} project
 * @param {string} maskId
 * @returns {Array<{id:string, name:string}>}
 */
function collectMaskedBy(project, maskId) {
  const out = new Map();
  for (const cfg of project.maskConfigs ?? []) {
    if ((cfg.maskMeshIds ?? []).includes(maskId)) {
      const n = project.nodes.find((nn) => nn.id === cfg.maskedMeshId);
      if (n) out.set(n.id, { id: n.id, name: n.name ?? n.id });
    }
  }
  for (const n of project.nodes ?? []) {
    if (n.type !== 'part') continue;
    if ((n.mesh?.maskMeshIds ?? []).includes(maskId)) {
      out.set(n.id, { id: n.id, name: n.name ?? n.id });
    }
  }
  return [...out.values()];
}

function NodeChip({ node, onClick, onRemove = null }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-muted/50 hover:bg-muted/80 transition-colors">
      <button
        type="button"
        onClick={onClick}
        className="px-1.5 h-5 text-[10px] font-mono text-foreground"
        title={node.id}
      >
        {node.name}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="px-1 h-5 text-muted-foreground hover:text-destructive border-l border-border/40"
          title="Remove this mask"
          aria-label="Remove mask"
        >
          <X size={10} />
        </button>
      ) : null}
    </span>
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
    <div className="flex items-start gap-2 text-xs min-h-7">
      <span className="w-20 shrink-0 text-muted-foreground pt-1">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
