// @ts-check

/**
 * V4 Phase 1 — Deformer Keyforms section.
 * V4 Phase 3a — read-only grid view + click-to-snap-params.
 * V4 Phase 3b — Edit / Apply / Cancel header + Esc binding +
 *               snapshot-restore on Cancel.
 *
 * Lifted out of `DeformerTab`'s inline KeyformsSection. Phase 3a layers
 * the cartesian-product grid UI on top:
 *
 *   - 0 bindings: shows the flat list of keyforms (legacy behaviour).
 *   - 1 binding: row of cells, one per `binding.keys[i]`. Click a cell
 *     to snap the bound param to that key value (live preview reflects
 *     the keyform geometry the next frame).
 *   - 2 bindings: matrix indexed by (binding[0].keys, binding[1].keys).
 *     Click a cell to snap BOTH params simultaneously.
 *   - N >= 3 bindings: flat list (axis-pinning UI deferred to polish).
 *
 * Active-cell highlight: when the live param values land exactly on a
 * keyTuple, that cell renders highlighted. Off-key paramValues (mid-
 * interpolation) leave nothing highlighted — Cubism Editor does the
 * same.
 *
 * Phase 3b: when active params land on a key, the section header
 * surfaces "Edit keyform". Click → snapshot the current keyform +
 * enter `editMode='keyform'`. Canvas overlays (Warp / Rotation) pick
 * up the slot and switch their handles to draggable. Apply commits
 * (live edits already wrote to the project), Cancel restores from
 * the snapshot. Esc is wired to Cancel.
 *
 * @module v3/editors/properties/sections/DeformerKeyformsSection
 */

import { useMemo, useEffect, useCallback } from 'react';
import { Diamond, Pencil, Check, X } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useParamValuesStore } from '../../../../store/paramValuesStore.js';
import { useEditorStore } from '../../../../store/editorStore.js';
import { SectionShell } from './SectionShell.jsx';
import { buildKeyformGridLayout, findKeyform } from './keyformGridLayout.js';

/**
 * @param {Object} props
 * @param {string} props.deformerId
 */
export function DeformerKeyformsSection({ deformerId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const updateProject = useProjectStore((s) => s.updateProject);
  const paramValues = useParamValuesStore((s) => s.values);
  const setParamValue = useParamValuesStore((s) => s.setParamValue);
  const editMode = useEditorStore((s) => s.editMode);
  const keyformEdit = useEditorStore((s) => s.keyformEdit);
  const enterEditMode = useEditorStore((s) => s.enterEditMode);
  const exitEditMode = useEditorStore((s) => s.exitEditMode);

  const node = useMemo(
    () => (nodes ?? []).find((n) => n?.id === deformerId && n?.type === 'deformer') ?? null,
    [nodes, deformerId],
  );

  const layout = useMemo(
    () => buildKeyformGridLayout(node?.bindings, node?.keyforms, paramValues),
    [node?.bindings, node?.keyforms, paramValues],
  );

  const kind = node?.deformerKind === 'rotation' ? 'rotation' : 'warp';
  const totalKeyforms = Array.isArray(node?.keyforms) ? node.keyforms.length : 0;
  const isEditingThisDeformer =
    editMode === 'keyform' && keyformEdit?.deformerId === deformerId;
  // Phase 3 polish — drag-to-edit now supports all three localFrames
  // (canvas-px / pivot-relative / normalized-0to1) via the inverse
  // helpers in WarpDeformerOverlay (canvasToLocal + inverseBilinearFFD).
  // No per-frame gate needed.

  // Resolve which keyform / keyTuple is "active" from current paramValues.
  // Drives the Edit-button enabled state.
  const activeCellInfo = useMemo(() => {
    if (!node) return null;
    const bindings = Array.isArray(node.bindings) ? node.bindings : [];
    if (bindings.length === 0) return null;
    /** @type {number[]} */
    const tuple = [];
    for (const b of bindings) {
      const cur = paramValues?.[b?.parameterId];
      if (typeof cur !== 'number' || !Number.isFinite(cur)) return null;
      const keys = Array.isArray(b.keys) ? b.keys : [];
      const hit = keys.find((k) => Math.abs(k - cur) < 1e-6);
      if (hit === undefined) return null;
      tuple.push(hit);
    }
    const kfs = Array.isArray(node.keyforms) ? node.keyforms : [];
    const matching = findKeyform(kfs, tuple);
    if (!matching) return null;
    const idx = kfs.indexOf(matching);
    return { keyTuple: tuple, keyformIndex: idx, keyform: matching };
  }, [node, paramValues]);

  function snap(keyTuple, bindings) {
    if (isEditingThisDeformer) return;  // sliders locked while editing
    for (let i = 0; i < bindings.length && i < keyTuple.length; i++) {
      const pid = bindings[i]?.parameterId;
      if (pid) setParamValue(pid, keyTuple[i]);
    }
  }

  /**
   * Cancel: restore the keyform from the snapshot, then exit mode.
   * Apply: just exit (the live drag has already written to the project).
   */
  const cancelEdit = useCallback(() => {
    if (!keyformEdit) return;
    const snap = keyformEdit.snapshot;
    const dId = keyformEdit.deformerId;
    const kIdx = keyformEdit.keyformIndex;
    const wasAuthored = keyformEdit.authoredOnEntry === true;
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn?.id === dId && nn?.type === 'deformer');
      if (!n || !Array.isArray(n.keyforms)) return;
      // Restore the keyform fields from the snapshot (full replace).
      n.keyforms[kIdx] = snap;
      // If the keyform was NOT authored before the user entered edit
      // mode, strip any _userAuthored marker the drag may have set.
      // (If it WAS authored, leave the marker alone.)
      if (!wasAuthored && n.keyforms[kIdx]) {
        delete n.keyforms[kIdx]._userAuthored;
      }
    });
    exitEditMode();
  }, [keyformEdit, updateProject, exitEditMode]);

  const applyEdit = useCallback(() => {
    exitEditMode();
  }, [exitEditMode]);

  function startEdit() {
    if (!activeCellInfo || !node) return;
    const kfs = Array.isArray(node.keyforms) ? node.keyforms : [];
    const target = kfs[activeCellInfo.keyformIndex];
    if (!target) return;
    // Deep clone the keyform so the snapshot is isolated from
    // subsequent in-place drag mutations.
    const snapshot = JSON.parse(JSON.stringify(target));
    enterEditMode('keyform', {
      deformerId,
      keyformIndex: activeCellInfo.keyformIndex,
      keyTuple: activeCellInfo.keyTuple.slice(),
      snapshot,
      authoredOnEntry: target._userAuthored === true,
    });
  }

  // Esc → Cancel while editing this deformer's keyform.
  useEffect(() => {
    if (!isEditingThisDeformer) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditingThisDeformer, cancelEdit]);

  return (
    <SectionShell
      id="deformerKeyforms"
      label={totalKeyforms > 0 ? `Keyforms (${totalKeyforms})` : 'Keyforms'}
      icon={<Diamond size={11} />}
    >
      {isEditingThisDeformer ? (
        <div className="flex items-center justify-between gap-2 mb-1 p-1.5 rounded border border-primary/40 bg-primary/15">
          <div className="text-[11px] font-mono text-foreground">
            <span className="text-muted-foreground">editing</span>{' '}
            [{(keyformEdit?.keyTuple ?? []).join(', ')}]
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={applyEdit}
              className="h-6 px-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] flex items-center gap-1"
              title="Commit drags (already live on canvas)"
            >
              <Check size={11} />
              <span>apply</span>
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="h-6 px-2 rounded border border-border bg-muted/30 hover:bg-muted/50 text-[11px] flex items-center gap-1"
              title="Esc — restore from snapshot"
            >
              <X size={11} />
              <span>cancel</span>
            </button>
          </div>
        </div>
      ) : activeCellInfo ? (
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[10px] font-mono text-muted-foreground">
            on key [{activeCellInfo.keyTuple.join(', ')}]
          </div>
          <button
            type="button"
            onClick={startEdit}
            className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 disabled:opacity-40 text-[11px] flex items-center gap-1 text-foreground"
            title="Enter Keyform Edit mode. Drag canvas handles to author the keyform; Esc to cancel."
          >
            <Pencil size={11} />
            <span>edit keyform</span>
          </button>
        </div>
      ) : null}

      {layout.kind === 'empty' && totalKeyforms === 0 ? (
        <div className="text-xs text-muted-foreground italic">No keyforms.</div>
      ) : null}

      {layout.kind === 'empty' && totalKeyforms > 0 ? (
        <FlatList keyforms={node?.keyforms ?? []} kind={kind} />
      ) : null}

      {layout.kind === '1d' ? (
        <Grid1D layout={layout} kind={kind} onSnap={snap} />
      ) : null}

      {layout.kind === '2d' ? (
        <Grid2D layout={layout} kind={kind} onSnap={snap} />
      ) : null}

      {layout.kind === 'flat' ? (
        <Grid1D
          layout={{
            kind: '1d',
            binding: { parameterId: 'mixed', keys: [] },
            cells: layout.cells,
          }}
          kind={kind}
          onSnap={(t) => snap(t, layout.bindings)}
          flatLabels
        />
      ) : null}

      {layout.kind !== 'empty' ? (
        <div className="mt-1 text-[10px] text-muted-foreground/80">
          Click a cell to snap bound parameters to that keyform. Drag-to-
          edit on canvas lands in Phase 3b.
        </div>
      ) : null}
    </SectionShell>
  );
}

/**
 * Render the legacy flat list (no bindings to drive the grid).
 * Read-only — there's nothing to snap when no params bind.
 */
function FlatList({ keyforms, kind }) {
  return (
    <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
      {keyforms.map((kf, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 text-[10px] font-mono"
        >
          <span className="text-muted-foreground shrink-0">
            {Array.isArray(kf?.keyTuple) ? `[${kf.keyTuple.join(', ')}]` : `#${i}`}
          </span>
          <span className="text-foreground tabular-nums">
            {kind === 'rotation'
              ? `angle=${(kf?.angle ?? 0).toFixed(1)}°`
              : `pos=${kf?.positions?.length ?? 0}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 1D row of clickable cells. Reused for the N>=3 flat fallback by
 * passing `flatLabels=true` (cells render their full keyTuple instead
 * of a single-axis label).
 */
function Grid1D({ layout, kind, onSnap, flatLabels = false }) {
  const cells = layout.cells;
  return (
    <div className="flex flex-col gap-1">
      {!flatLabels ? (
        <div className="text-[10px] text-muted-foreground font-mono truncate" title={layout.binding?.parameterId}>
          {layout.binding?.parameterId}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {cells.map((cell, i) => (
          <Cell
            key={i}
            label={flatLabels ? `[${cell.keyTuple.join(', ')}]` : String(cell.keyTuple[0])}
            cell={cell}
            kind={kind}
            onClick={() => onSnap(cell.keyTuple, layout.binding ? [layout.binding] : [])}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 2D matrix. Rows = bindingY's keys, columns = bindingX's keys. Top
 * label = bindingX param id; left labels = bindingY param keys.
 */
function Grid2D({ layout, kind, onSnap }) {
  const { bindingX, bindingY, rows } = layout;
  const keysX = Array.isArray(bindingX.keys) ? bindingX.keys : [];
  return (
    <div className="flex flex-col gap-1 overflow-auto">
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground/70 w-12 shrink-0 truncate" />
        <span
          className="text-[10px] text-muted-foreground font-mono truncate flex-1"
          title={bindingX.parameterId}
        >
          {bindingX.parameterId}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground/70 w-12 shrink-0" />
        <div className="flex gap-1">
          {keysX.map((kx, i) => (
            <span
              key={i}
              className="w-12 text-[10px] text-muted-foreground tabular-nums font-mono text-center"
            >
              {kx}
            </span>
          ))}
        </div>
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-center gap-1">
          <span
            className="text-[10px] text-muted-foreground tabular-nums font-mono w-12 shrink-0 text-right truncate"
            title={`${bindingY.parameterId} = ${bindingY.keys?.[ri]}`}
          >
            {bindingY.keys?.[ri]}
          </span>
          <div className="flex gap-1">
            {row.map((cell, ci) => (
              <Cell
                key={ci}
                label=""
                cell={cell}
                kind={kind}
                onClick={() => onSnap(cell.keyTuple, [bindingX, bindingY])}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1 mt-0.5">
        <span
          className="text-[10px] text-muted-foreground font-mono truncate w-12 shrink-0 text-right"
          title={bindingY.parameterId}
        >
          {bindingY.parameterId}
        </span>
      </div>
    </div>
  );
}

/**
 * Single clickable keyform cell.
 *
 *   - Active: live param values land on this cell → highlighted.
 *   - Has keyform: clickable + shows summary (vertex count or angle).
 *   - Missing keyform: clickable but rendered dimmed (Init Rig will
 *     regenerate if the user runs it next).
 */
function Cell({ label, cell, kind, onClick }) {
  const has = cell.keyform !== null;
  const summary = !has
    ? '—'
    : kind === 'rotation'
      ? `${(cell.keyform.angle ?? 0).toFixed(0)}°`
      : `${(cell.keyform.positions?.length ?? 0) / 2}v`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'h-8 w-12 px-1 rounded border text-[10px] font-mono flex flex-col items-center justify-center gap-0 transition-colors ' +
        (cell.active
          ? 'bg-primary/30 border-primary text-foreground'
          : has
            ? 'bg-card/40 border-border text-foreground hover:bg-muted/60'
            : 'bg-card/20 border-border/40 text-muted-foreground/60 hover:bg-muted/30')
      }
      title={`keyTuple=[${cell.keyTuple.join(', ')}]${has ? '' : '  (no keyform — run Init Rig to regenerate)'}`}
    >
      {label ? <span className="leading-none">{label}</span> : null}
      <span className="leading-none text-[9px] text-muted-foreground/80">{summary}</span>
    </button>
  );
}
