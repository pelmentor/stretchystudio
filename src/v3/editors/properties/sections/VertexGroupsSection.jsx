// @ts-check

/**
 * V4 Phase 4a — Vertex Groups section.
 * V4 Phase 3b — Active radio + Edit / Exit Weights toggle.
 *
 * Per-group summary card with:
 *   - name (resolved from the bone group's `name`)
 *   - vertex count (vertices with non-zero weight) over total
 *   - mean / min-nonzero / max weight
 *   - Active radio (drives the heatmap shader + brush target)
 *   - source badge (legacy single-bone vs modern multi-group map)
 *
 * Header has an "Edit weights" button that auto-migrates legacy
 * `boneWeights` → `weightGroups` (if needed), sets the active group,
 * and enters `editMode='weightPaint'`. While in mode the same button
 * becomes "Exit weight paint".
 *
 * Visibility: plan §3 row 5 — `type:'part' && (boneWeights ||
 * jointBoneId || weightGroups)`. Predicate lives in
 * `meshHasVertexGroups`.
 *
 * @module v3/editors/properties/sections/VertexGroupsSection
 */

import { useMemo } from 'react';
import { Network, Brush, X } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useEditorStore } from '../../../../store/editorStore.js';
import { SectionShell } from './SectionShell.jsx';
import { buildVertexGroupSummaries } from './vertexGroupsLayout.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function VertexGroupsSection({ nodeId }) {
  // Subscribe to the stable `nodes` reference (immer-managed); derive
  // both `node` and `boneGroups` via `useMemo`. The previous shape —
  // `useProjectStore((s) => (s.project.nodes ?? []).filter(...))` —
  // returned a NEW filtered array on every store update, which is
  // exactly the "getSnapshot should be cached" infinite-loop trap
  // React warns about. Zustand 5's useSyncExternalStore comparator
  // sees a new reference, forces a re-render, and the selector runs
  // again — boom.
  const nodes = useProjectStore((s) => s.project.nodes);
  const ensureWeightGroupsForPart = useProjectStore((s) => s.ensureWeightGroupsForPart);
  const setActiveWeightGroup = useProjectStore((s) => s.setActiveWeightGroup);
  const editMode = useEditorStore((s) => s.editMode);
  const enterEditMode = useEditorStore((s) => s.enterEditMode);
  const exitEditMode = useEditorStore((s) => s.exitEditMode);
  const editorSelection = useEditorStore((s) => s.selection);

  const node = useMemo(
    () => (nodes ?? []).find((n) => n?.id === nodeId) ?? null,
    [nodes, nodeId],
  );
  const boneGroups = useMemo(
    () => (nodes ?? []).filter((n) => n?.type === 'group'),
    [nodes],
  );

  const summaries = useMemo(
    () => buildVertexGroupSummaries(node, boneGroups),
    [node, boneGroups],
  );

  const totalVertices = node?.mesh?.vertices?.length ?? 0;
  const isPainting =
    editMode === 'weightPaint' && editorSelection?.[0] === nodeId;

  function handleEnterPaint() {
    ensureWeightGroupsForPart(nodeId);
    useEditorStore.getState().setSelection([nodeId]);
    enterEditMode('weightPaint');
  }

  function handleExitPaint() {
    exitEditMode();
  }

  return (
    <SectionShell
      id="vertexGroups"
      label={summaries.length > 0 ? `Vertex Groups (${summaries.length})` : 'Vertex Groups'}
      icon={<Network size={11} />}
    >
      <div className="flex items-center justify-end mb-1">
        {isPainting ? (
          <button
            type="button"
            onClick={handleExitPaint}
            className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 text-[11px] flex items-center gap-1 text-foreground"
          >
            <X size={11} />
            <span>exit weight paint</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnterPaint}
            className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 text-[11px] flex items-center gap-1 text-foreground"
            title="Enter Weight Paint mode. Drag on canvas to paint the active group's per-vertex weights."
          >
            <Brush size={11} />
            <span>edit weights</span>
          </button>
        )}
      </div>

      {summaries.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          {node?.mesh?.jointBoneId
            ? 'Bone is bound but no weights painted yet. Click "edit weights" to start painting.'
            : 'No vertex groups.'}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {summaries.map((s) => (
            <GroupCard
              key={`${s.source}:${s.name}`}
              summary={s}
              totalVertices={totalVertices}
              onSelect={() => setActiveWeightGroup(nodeId, s.name)}
              isPainting={isPainting}
            />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/** @param {{summary: import('./vertexGroupsLayout.js').VertexGroupSummary, totalVertices:number, onSelect: () => void, isPainting: boolean}} props */
function GroupCard({ summary, totalVertices, onSelect, isPainting }) {
  const coverage = totalVertices > 0 ? summary.vertexCount / totalVertices : 0;
  const coveragePct = Math.round(coverage * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'flex flex-col gap-1 px-2 py-1.5 rounded border text-left transition-colors ' +
        (summary.active
          ? 'border-primary/60 bg-primary/15'
          : 'border-border bg-card/30 hover:bg-card/50')
      }
      title={summary.active
        ? 'Active weight group'
        : isPainting
          ? 'Click to make active — brush will paint into this group'
          : 'Click to activate. Enter weight paint to brush into it.'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-foreground truncate flex items-center gap-1.5" title={summary.boneId ?? summary.name}>
          <span
            className={
              'inline-block w-2 h-2 rounded-full border ' +
              (summary.active
                ? 'bg-primary border-primary'
                : 'bg-transparent border-muted-foreground/50')
            }
          />
          {summary.name}
          {summary.active ? (
            <span className="ml-1 text-[9px] text-primary uppercase tracking-wide">active</span>
          ) : null}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
          {summary.source === 'modern' ? 'group' : 'auto-rig'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground">
        <span>
          {summary.vertexCount} / {totalVertices}{' '}
          <span className="text-muted-foreground/60">verts ({coveragePct}%)</span>
        </span>
        <span className="tabular-nums">
          mean <span className="text-foreground">{summary.mean.toFixed(3)}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground">
        <span className="tabular-nums">
          min<sub className="text-muted-foreground/60">≠0</sub>{' '}
          <span className="text-foreground">{summary.min.toFixed(3)}</span>
        </span>
        <span className="tabular-nums">
          max <span className="text-foreground">{summary.max.toFixed(3)}</span>
        </span>
      </div>
    </button>
  );
}
