// @ts-check

/**
 * v3 Phase 1B + BFA-006 Phase 5 — DeformerTab.
 *
 * Inspector for the warp / rotation deformer selected via the unified
 * Outliner tree. Reads from `project.nodes` (Phase 1+3 ships deformer
 * nodes as first-class entries) and surfaces:
 *
 *   - id / name / parent
 *   - kind-specific summary (warps: grid + vertex count;
 *     rotations: pivot + angle range)
 *   - bindings
 *   - keyforms
 *   - Phase 5 — `_userAuthored` toggle (locks the node from per-stage
 *     refit clobbers; preserves user keyform edits across Init Rig)
 *   - Phase 5 — parent dropdown (reparent to root, another deformer,
 *     or any part/group; mutates `node.parent` directly)
 *
 * Pre-Phase-5 the tab was rigSpec-only (read-only, no mutators);
 * Phase 5 lifts it to read+write off `project.nodes`.
 *
 * @module v3/editors/properties/tabs/DeformerTab
 */

import { useMemo } from 'react';
import { Box, RotateCw, Lock, Unlock } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import * as SelectImpl from '../../../../components/ui/select.jsx';

// shadcn forwardRefs without JSX-typed declarations — same pattern
// other tabs use to dodge tsc's missing-children prop error.
/** @type {Record<string, React.ComponentType<any>>} */
const Sel = /** @type {any} */ (SelectImpl);
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = Sel;

/** Sentinel for the "root" entry in the parent dropdown. */
const PARENT_ROOT = '__root__';

/**
 * @param {Object} props
 * @param {string} props.deformerId
 */
export function DeformerTab({ deformerId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const updateProject = useProjectStore((s) => s.updateProject);

  /** @type {object|null} */
  const node = useMemo(
    () => (nodes ?? []).find((n) => n?.id === deformerId && n?.type === 'deformer') ?? null,
    [nodes, deformerId],
  );

  // Build the parent-dropdown options — every part / group / deformer
  // EXCEPT the node itself and its descendants (you can't reparent
  // under your own subtree). Cycle detection: walk down from `node.id`
  // and exclude every reached id.
  const parentOptions = useMemo(() => buildParentOptions(nodes, deformerId), [nodes, deformerId]);

  if (!node) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Deformer not in project — was it deleted?
      </div>
    );
  }

  const kind = node.deformerKind === 'rotation' ? 'rotation' : 'warp';

  function handleParentChange(newParentValue) {
    const newParent = newParentValue === PARENT_ROOT ? null : newParentValue;
    updateProject((proj) => {
      const target = proj.nodes.find((n) => n?.id === deformerId);
      if (target) target.parent = newParent;
    });
  }

  function toggleUserAuthored() {
    updateProject((proj) => {
      const target = proj.nodes.find((n) => n?.id === deformerId);
      if (!target) return;
      if (target._userAuthored === true) delete target._userAuthored;
      else target._userAuthored = true;
    });
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section
        label={kind === 'warp' ? 'Warp Deformer' : 'Rotation Deformer'}
        icon={kind === 'warp' ? <Box size={11} /> : <RotateCw size={11} />}
      >
        <Row label="ID">
          <code className="text-xs text-foreground truncate" title={node.id}>{node.id}</code>
        </Row>
        <Row label="Name">
          <span className="text-xs text-foreground truncate">{node.name ?? node.id}</span>
        </Row>
        <Row label="Parent">
          <Select value={node.parent ?? PARENT_ROOT} onValueChange={handleParentChange}>
            <SelectTrigger className="h-6 text-xs px-2 py-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parentOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      {kind === 'warp' ? <WarpDetails spec={node} /> : <RotationDetails spec={node} />}

      <BindingsSection spec={node} />
      <KeyformsSection spec={node} kind={kind} />

      <Section label="Per-stage refit" icon={node._userAuthored === true ? <Lock size={11} /> : <Unlock size={11} />}>
        <button
          onClick={toggleUserAuthored}
          className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${
            node._userAuthored === true
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
              : 'bg-card/30 border-border text-foreground hover:bg-card/50'
          }`}
          title={node._userAuthored === true
            ? 'Currently locked from refit. Re-running Init Rig / per-stage refit will preserve this deformer\'s keyforms and bindings as-is. Click to unlock.'
            : 'Currently regenerated by Init Rig / per-stage refit. Lock to preserve hand-edited keyforms and bindings across re-rigs. Click to lock.'}
        >
          <span className="text-[11px]">
            {node._userAuthored === true ? 'Locked from refit' : 'Auto-regenerate by refit'}
          </span>
          <span className="text-[10px] uppercase tracking-wide opacity-70">
            {node._userAuthored === true ? 'click to unlock' : 'click to lock'}
          </span>
        </button>
      </Section>
    </div>
  );
}

/**
 * Build the list of nodes a deformer can be reparented under: every
 * part / group / deformer that is NOT the node itself and NOT a
 * descendant of it (cycle prevention).
 *
 * @param {Array<object>|undefined|null} nodes
 * @param {string} selfId
 * @returns {Array<{id:string,label:string}>}
 */
function buildParentOptions(nodes, selfId) {
  /** @type {Array<{id:string,label:string}>} */
  const out = [{ id: PARENT_ROOT, label: 'root' }];
  if (!Array.isArray(nodes)) return out;

  // Compute descendants of `selfId` to exclude.
  /** @type {Set<string>} */
  const descendants = new Set([selfId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (!n || descendants.has(n.id)) continue;
      if (n.parent && descendants.has(n.parent)) {
        descendants.add(n.id);
        grew = true;
      }
    }
  }

  for (const n of nodes) {
    if (!n || !n.id) continue;
    if (descendants.has(n.id)) continue;
    if (n.type !== 'part' && n.type !== 'group' && n.type !== 'deformer') continue;
    const prefix =
      n.type === 'deformer'
        ? (n.deformerKind === 'rotation' ? 'rotation' : 'warp')
        : n.type;
    out.push({ id: n.id, label: `${prefix}: ${n.name ?? n.id}` });
  }
  return out;
}

function WarpDetails({ spec }) {
  const gridSize = spec.gridSize ?? null;
  const firstKf = Array.isArray(spec.keyforms) ? spec.keyforms[0] : null;
  const positionsLen = firstKf?.positions?.length ?? 0;
  return (
    <Section label="Warp" icon={<Box size={11} />}>
      <Row label="Grid">
        <span className="text-xs text-foreground tabular-nums font-mono">
          {gridSize ? `${gridSize.cols} × ${gridSize.rows}` : '—'}
        </span>
      </Row>
      <Row label="Vertices">
        <span className="text-xs text-foreground tabular-nums">
          {positionsLen / 2}
        </span>
      </Row>
      <Row label="Keyforms">
        <span className="text-xs text-foreground tabular-nums">
          {Array.isArray(spec.keyforms) ? spec.keyforms.length : 0}
        </span>
      </Row>
    </Section>
  );
}

function RotationDetails({ spec }) {
  const firstKf = Array.isArray(spec.keyforms) ? spec.keyforms[0] : null;
  const angles = (spec.keyforms ?? [])
    .map((k) => k.angle)
    .filter((a) => typeof a === 'number');
  const angleSummary =
    angles.length === 0 ? '—'
    : angles.length === 1 ? `${angles[0]}°`
    : `${Math.min(...angles)}° → ${Math.max(...angles)}°`;
  return (
    <Section label="Rotation" icon={<RotateCw size={11} />}>
      <Row label="Origin">
        <span className="text-xs text-foreground tabular-nums font-mono">
          {firstKf
            ? `${(firstKf.originX ?? 0).toFixed(2)}, ${(firstKf.originY ?? 0).toFixed(2)}`
            : '—'}
        </span>
      </Row>
      <Row label="Angle range">
        <span className="text-xs text-foreground tabular-nums font-mono">{angleSummary}</span>
      </Row>
      <Row label="Keyforms">
        <span className="text-xs text-foreground tabular-nums">
          {Array.isArray(spec.keyforms) ? spec.keyforms.length : 0}
        </span>
      </Row>
    </Section>
  );
}

function BindingsSection({ spec }) {
  const bindings = Array.isArray(spec.bindings) ? spec.bindings : [];
  if (bindings.length === 0) {
    return (
      <Section label="Bindings">
        <div className="text-xs text-muted-foreground italic">No parameter bindings.</div>
      </Section>
    );
  }
  return (
    <Section label={`Bindings (${bindings.length})`}>
      <div className="flex flex-col gap-1">
        {bindings.map((b, i) => (
          <div
            key={`${b?.parameterId ?? '_'}-${i}`}
            className="flex items-center justify-between gap-2 text-[11px] font-mono"
          >
            <span className="text-foreground truncate" title={b?.parameterId}>
              {b?.parameterId ?? '<no param>'}
            </span>
            <span className="text-muted-foreground shrink-0">
              [{(b?.keys ?? []).join(', ')}]
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function KeyformsSection({ spec, kind }) {
  const kfs = Array.isArray(spec.keyforms) ? spec.keyforms : [];
  if (kfs.length === 0) return null;
  return (
    <Section label={`Keyforms (${kfs.length})`}>
      <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
        {kfs.map((kf, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 text-[10px] font-mono"
          >
            <span className="text-muted-foreground shrink-0">
              {Array.isArray(kf?.keyTuple)
                ? `[${kf.keyTuple.join(', ')}]`
                : `#${i}`}
            </span>
            <span className="text-foreground tabular-nums">
              {kind === 'rotation'
                ? `angle=${(kf?.angle ?? 0).toFixed(1)}°`
                : `pos=${kf?.positions?.length ?? 0}`}
            </span>
          </div>
        ))}
      </div>
    </Section>
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
