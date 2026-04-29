// @ts-check

/**
 * v3 Phase 1B — DeformerTab.
 *
 * Read-only inspector for the warp / rotation deformer selected via
 * the Outliner's rig display mode. Surfaces id / parent / kind +
 * kind-specific fields (warps: grid dimensions; rotations: pivot +
 * angle bindings).
 *
 * Editing deformers in v3 is Phase 2 (Warp Deformer Editor + Rotation
 * Deformer Editor); this tab is the diagnostic / read surface that
 * arrives with Phase 1B so the Outliner rig mode has a useful
 * Properties pane.
 *
 * @module v3/editors/properties/tabs/DeformerTab
 */

import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { Box, RotateCw } from 'lucide-react';

/**
 * @param {Object} props
 * @param {string} props.deformerId
 */
export function DeformerTab({ deformerId }) {
  // Pull from the cached rigSpec; rigSpec is volatile (rebuilt on
  // geometry edits) so a useRigSpecStore subscription auto-updates.
  const rigSpec = useRigSpecStore((s) => s.rigSpec);

  const found = findDeformer(rigSpec, deformerId);

  if (!found) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Deformer no longer in rigSpec — was it removed by a geometry
        edit? Run Initialize Rig to refresh.
      </div>
    );
  }

  const { kind, spec } = found;

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section
        label={kind === 'warp' ? 'Warp Deformer' : 'Rotation Deformer'}
        icon={kind === 'warp' ? <Box size={11} /> : <RotateCw size={11} />}
      >
        <Row label="ID">
          <code className="text-xs text-foreground truncate" title={spec.id}>{spec.id}</code>
        </Row>
        <Row label="Name">
          <span className="text-xs text-foreground truncate">{spec.name ?? spec.id}</span>
        </Row>
        <Row label="Parent">
          <ParentBadge parent={spec.parent} />
        </Row>
      </Section>

      {kind === 'warp' ? <WarpDetails spec={spec} /> : <RotationDetails spec={spec} />}

      <BindingsSection spec={spec} />
      <KeyformsSection spec={spec} kind={kind} />
    </div>
  );
}

function ParentBadge({ parent }) {
  if (!parent) return <span className="text-muted-foreground text-xs">—</span>;
  if (parent.type === 'root') {
    return <span className="text-emerald-400 text-xs font-mono">root</span>;
  }
  return (
    <span className="text-xs font-mono">
      <span className="text-muted-foreground">{parent.type}:</span>{' '}
      <span className="text-foreground">{parent.id}</span>
    </span>
  );
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

/**
 * @param {any} rigSpec
 * @param {string} id
 * @returns {{kind:'warp'|'rotation', spec:any}|null}
 */
function findDeformer(rigSpec, id) {
  if (!rigSpec) return null;
  for (const d of rigSpec.warpDeformers ?? []) {
    if (d?.id === id) return { kind: 'warp', spec: d };
  }
  for (const d of rigSpec.rotationDeformers ?? []) {
    if (d?.id === id) return { kind: 'rotation', spec: d };
  }
  return null;
}
