// @ts-check

/**
 * v3 Phase 1C — Coord-Space Debugger overlay.
 *
 * HUD panel that surfaces per-art-mesh chain-walk diagnostics so the
 * residual Phase -1B "parts fly off after Initialize Rig" symptom
 * (shelby smoke test 2026-04-29) becomes visible without console
 * spelunking.
 *
 * Reads the cached rigSpec from `useRigSpecStore` and runs the pure
 * `diagnoseRigChains` walker. Output: counts (clean / broken /
 * no-parent / cycle) + list of broken part ids. A "broken" part is
 * one whose chain references a parent deformer that doesn't exist
 * in `rigSpec.warpDeformers + rotationDeformers` — exactly the
 * silent-failure path that causes evalRig to emit non-canvas-px
 * verts that the renderer's rigDrivenParts opt-out then mishandles.
 *
 * Phase 1C follow-up: tint each part directly in the canvas instead
 * of (or in addition to) the HUD list. Needs hooks into the part
 * renderer's color uniform; deferred until the basic diagnostic
 * proves itself useful.
 *
 * Mounted by `ViewportEditor` and gated on a v3 store flag — for the
 * first cut it's always visible when the rig has any broken chains
 * (no flag needed: clean rigs render an unobtrusive single-line
 * "all chains terminate at root" footer).
 *
 * @module v3/editors/viewport/overlays/CoordSpaceOverlay
 */

import { useMemo, useState } from 'react';
import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import {
  diagnoseRigChains,
  summarizeDiagnoses,
} from '../../../../io/live2d/runtime/evaluator/chainDiagnose.js';
import { ChevronDown, ChevronRight } from 'lucide-react';

const FRAME_COLORS = {
  'canvas-px':       'text-emerald-400',
  'normalized-0to1': 'text-rose-400',
  'pivot-relative':  'text-amber-400',
  'unknown':         'text-muted-foreground',
};

const TERM_LABELS = {
  'root':            'clean',
  'unknown_parent':  'broken',
  'no_parent':       'no parent',
  'cycle_or_deep':   'cycle',
};

export function CoordSpaceOverlay() {
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  const select = useSelectionStore((s) => s.select);
  const activeId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'part') return items[i].id;
    }
    return null;
  });
  const [expanded, setExpanded] = useState(false);

  const diags = useMemo(() => diagnoseRigChains(rigSpec), [rigSpec]);
  const summary = useMemo(() => summarizeDiagnoses(diags), [diags]);

  if (!rigSpec || diags.length === 0) return null;

  const hasIssues = summary.broken > 0 || summary.cycle > 0 || summary.noParent > 0;
  const compact = !expanded || !hasIssues;

  return (
    <div
      className={
        'absolute top-2 right-2 z-30 max-w-xs select-none rounded-md border ' +
        'shadow-md backdrop-blur-sm text-[11px] ' +
        (hasIssues ? 'border-destructive/60 bg-destructive/10' : 'border-border bg-card/85')
      }
    >
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {hasIssues ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="font-mono">
          chains: <span className="text-emerald-400">{summary.clean}</span>
          {' / '}
          <span className={summary.broken > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
            {summary.broken} broken
          </span>
          {summary.cycle > 0 ? (
            <span className="text-amber-400"> · {summary.cycle} cycle</span>
          ) : null}
          {summary.noParent > 0 ? (
            <span className="text-muted-foreground"> · {summary.noParent} no-parent</span>
          ) : null}
        </span>
      </button>

      {compact ? null : (
        <div className="border-t border-border/60 px-2 py-1 max-h-72 overflow-auto flex flex-col gap-0.5">
          {diags.map((d) => (
            <DiagnosisRow
              key={d.partId}
              d={d}
              isActive={activeId === d.partId}
              onSelect={(modifier) => select({ type: 'part', id: d.partId }, modifier)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   d: import('../../../../io/live2d/runtime/evaluator/chainDiagnose.js').ChainDiagnosis,
 *   isActive: boolean,
 *   onSelect: (m: 'replace'|'add'|'toggle') => void,
 * }} props
 */
function DiagnosisRow({ d, isActive, onSelect }) {
  const frameColor = FRAME_COLORS[d.finalFrame] ?? 'text-muted-foreground';
  const termLabel = TERM_LABELS[d.terminationKind] ?? d.terminationKind;
  const isClean = d.terminationKind === 'root';
  const tooltip = d.chainPath.length > 0
    ? `chain: ${d.chainPath.map((s) => `${s.kind}:${s.id}`).join(' → ')} → ${d.terminationKind}`
    : `chain: (${d.terminationKind})`;
  return (
    <button
      type="button"
      className={
        'flex items-center gap-1.5 font-mono text-[10px] text-left rounded px-1 transition-colors ' +
        (isActive
          ? 'bg-primary/30 text-foreground'
          : (isClean ? 'opacity-60 hover:bg-muted/40' : 'hover:bg-muted/40'))
      }
      title={tooltip}
      onClick={(e) => {
        /** @type {'replace'|'add'|'toggle'} */
        let modifier = 'replace';
        if (e.shiftKey) modifier = 'add';
        else if (e.ctrlKey || e.metaKey) modifier = 'toggle';
        onSelect(modifier);
      }}
    >
      <span className={'w-3 inline-flex justify-center ' + frameColor}>
        {isClean ? '·' : '!'}
      </span>
      <span className="truncate flex-1" title={d.partId}>{d.partId}</span>
      <span className={frameColor + ' shrink-0'}>{d.finalFrame}</span>
      <span className="text-muted-foreground shrink-0">{termLabel}</span>
    </button>
  );
}
