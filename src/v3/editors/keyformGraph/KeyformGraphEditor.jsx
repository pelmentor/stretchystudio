// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 3C — Keyform Graph editor (read-only first cut).
 *
 * Shows the rig keyform interpolation curve for the active part:
 *
 *   - X axis: parameter value across `binding.keys`
 *   - Y axis: per-keyform scalar magnitude (max displacement from
 *     baseGrid for warps; rotation angle for rotation deformers).
 *   - Markers: one per keyform that varies along this binding axis.
 *
 * Why scalar magnitude rather than per-vertex curves: a warp keyform
 * is a Float64Array of (rows × cols × 2) coords, so a literal "all
 * vertices" plot would be a forest of curves. The scalar derived
 * from `Σ‖position − baseGrid‖` per keyform gives a single visual
 * reading of "how much does the deformer deform at this paramValue"
 * — enough to spot non-monotonic / collapsed keyforms at a glance.
 *
 * For warps with multiple bindings (a 2D shape grid like
 * ParamAngleX × ParamAngleY) the first cut walks the FIRST binding's
 * axis with the other binding indices pinned at 0. Per-binding
 * tab-switching + 2D heatmap visualisation belongs in the polish
 * pass that earns `v3-phase-3-complete`.
 *
 * @module v3/editors/keyformGraph/KeyformGraphEditor
 */

import { useMemo } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { TrendingUp } from 'lucide-react';

const PAD_X = 32;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;

export function KeyformGraphEditor() {
  const project   = useProjectStore((s) => s.project);
  const selection = useSelectionStore((s) => s.items);

  const view = useMemo(() => buildView(project, selection), [project, selection]);

  if (!view) {
    return (
      <Wrapper subtitle="No keyform data for selection">
        <Empty msg="Select a part with a rig warp / rotation deformer to see its keyform interpolation." />
      </Wrapper>
    );
  }

  if (view.kind === 'no-keyforms') {
    return (
      <Wrapper subtitle={view.partName}>
        <Empty msg="Selected part has a deformer but no keyforms with parameter variation yet." />
      </Wrapper>
    );
  }

  return (
    <Wrapper subtitle={`${view.partName} · ${view.bindingId} · ${view.points.length} keyforms`}>
      <Plot view={view} />
    </Wrapper>
  );
}

function Wrapper({ subtitle, children }) {
  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0 flex items-center gap-1.5 bg-muted/30">
        <TrendingUp size={11} className="text-muted-foreground" />
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Keyform Graph
        </h2>
        <span className="text-[10px] text-muted-foreground/70 ml-2 truncate">{subtitle}</span>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center text-xs text-muted-foreground italic">
      {msg}
    </div>
  );
}

function Plot({ view }) {
  const { points, minP, maxP, minM, maxM } = view;

  function tx(p) {
    const range = (maxP - minP) || 1;
    return PAD_X + ((p - minP) / range) * (1000 - PAD_X * 2);
  }
  function ty(m) {
    const range = (maxM - minM) || 1;
    return PAD_TOP + (1 - (m - minM) / range) * (300 - PAD_TOP - PAD_BOTTOM);
  }

  const polyPoints = points
    .map((pt) => `${tx(pt.paramValue).toFixed(1)},${ty(pt.magnitude).toFixed(2)}`)
    .join(' ');

  return (
    <div className="w-full h-full p-2">
      <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="w-full h-full">
        {/* axes */}
        <line x1={PAD_X} y1={PAD_TOP} x2={PAD_X} y2={300 - PAD_BOTTOM}
          className="stroke-border" strokeWidth={1} />
        <line x1={PAD_X} y1={300 - PAD_BOTTOM} x2={1000 - PAD_X} y2={300 - PAD_BOTTOM}
          className="stroke-border" strokeWidth={1} />

        {/* y-axis labels */}
        <text x={PAD_X - 4} y={PAD_TOP + 8} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{maxM.toFixed(1)}</text>
        <text x={PAD_X - 4} y={300 - PAD_BOTTOM} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{minM.toFixed(1)}</text>

        {/* x-axis labels: each keyform paramValue */}
        {points.map((pt, i) => (
          <text key={`x${i}`}
            x={tx(pt.paramValue)} y={300 - 4} textAnchor="middle" fontSize={10}
            className="fill-muted-foreground font-mono">
            {pt.paramValue.toFixed(pt.paramValue % 1 === 0 ? 0 : 1)}
          </text>
        ))}

        {/* connecting curve */}
        <polyline
          points={polyPoints}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
        />

        {/* keyform diamonds */}
        {points.map((pt, i) => (
          <g key={i} transform={`translate(${tx(pt.paramValue)}, ${ty(pt.magnitude)})`}>
            <rect x={-3.5} y={-3.5} width={7} height={7}
              transform="rotate(45)"
              className="fill-amber-400 stroke-card"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* axis caption */}
        <text x={500} y={300 - 4} textAnchor="middle" fontSize={10}
          className="fill-muted-foreground/60 italic">
          paramValue
        </text>
        <text x={4} y={PAD_TOP + 4} fontSize={10}
          className="fill-muted-foreground/60 italic">
          ‖Δ‖
        </text>
      </svg>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function buildView(project, selection) {
  const partSel = [...selection].reverse().find((s) => s.type === 'part');
  if (!partSel) return null;

  const part = (project.nodes ?? []).find((n) => n.id === partSel.id);
  if (!part) return null;

  // BFA-006 Phase 6 — rigWarps live as `type:'deformer'` nodes with
  // `targetPartId` set. Find the rigWarp deformer driving this part.
  const spec = (project.nodes ?? []).find(
    (n) => n?.type === 'deformer' && n.deformerKind === 'warp' && n.targetPartId === partSel.id,
  );
  if (!spec) return null;

  const partName = part.name ?? partSel.id;
  const bindings = spec.bindings ?? [];
  if (bindings.length === 0 || !spec.keyforms?.length) {
    return { kind: 'no-keyforms', partName };
  }

  const binding0 = bindings[0];
  const keys = binding0.keys ?? [];
  if (keys.length === 0) return { kind: 'no-keyforms', partName };

  // For each key index in binding0, find the keyform whose keyTuple
  // has that index in slot 0 and zeroes elsewhere. Compute scalar
  // magnitude = mean L2 distance from baseGrid.
  const baseGrid = spec.baseGrid;
  const points = [];
  for (let kIdx = 0; kIdx < keys.length; kIdx++) {
    const kf = spec.keyforms.find((k) => {
      if (!Array.isArray(k.keyTuple)) return false;
      if (k.keyTuple[0] !== kIdx) return false;
      for (let i = 1; i < k.keyTuple.length; i++) {
        if (k.keyTuple[i] !== 0) return false;
      }
      return true;
    });
    const magnitude = kf ? meanDisplacement(kf.positions, baseGrid) : 0;
    points.push({ paramValue: keys[kIdx], magnitude });
  }

  if (points.length === 0) return { kind: 'no-keyforms', partName };

  let minP = Infinity, maxP = -Infinity, minM = Infinity, maxM = -Infinity;
  for (const p of points) {
    if (p.paramValue < minP) minP = p.paramValue;
    if (p.paramValue > maxP) maxP = p.paramValue;
    if (p.magnitude < minM) minM = p.magnitude;
    if (p.magnitude > maxM) maxM = p.magnitude;
  }
  if (minM === maxM) { minM -= 0.5; maxM += 0.5; }
  const span = maxM - minM;
  minM -= span * 0.05;
  maxM += span * 0.05;

  return {
    kind: 'ok',
    partName,
    bindingId: binding0.parameterId,
    points,
    minP,
    maxP,
    minM,
    maxM,
  };
}

function meanDisplacement(positions, baseGrid) {
  if (!positions || !baseGrid) return 0;
  const n = Math.min(positions.length, baseGrid.length);
  if (n === 0) return 0;
  let sum = 0;
  // positions / baseGrid are flat (x,y,x,y,...) Float64Arrays.
  for (let i = 0; i < n; i += 2) {
    const dx = positions[i] - baseGrid[i];
    const dy = positions[i + 1] - baseGrid[i + 1];
    sum += Math.hypot(dx, dy);
  }
  return sum / (n / 2);
}
