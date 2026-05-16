// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * Footer — Audit 4 #1 (2026-05-16) status bar.
 *
 * Bottom-of-shell row mirroring Blender's `STATUSBAR_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_statusbar.py:8-31`):
 * three sections separated by spacers — input status (left), reports
 * banner (center), and stats info (right). Always mounted by
 * `AppShell.jsx`; never hides per workspace (Blender keeps the
 * status bar visible regardless of active screen).
 *
 * Per-section sources:
 *
 *   - LEFT  — `formatInputStatus(...)` over `useModalTransformStore` +
 *             `useModalVertexTransformStore` + `useEditorStore.editMode`
 *             + active-head dataKind. Modal active → keybind + live
 *             delta (matches the on-canvas HUD). No modal → mode label.
 *   - CENTER — `countReports(...)` over `useLogsStore.entries`. Renders
 *              warn (yellow) + error (red) pills with counts; hidden
 *              when both are zero. Title attr names the entry kind +
 *              count for keyboard / screen-reader access.
 *   - RIGHT  — `formatStats(...)` over `useEditorStore.selection` +
 *              active-head dataKind + per-mode embellishments (vert
 *              count in mesh-edit).
 *
 * Future-target: when the F-1 follow-on transport-row lift lands
 * (`TimelineHeader.jsx:25-32` notes the plan), the center area can
 * host playback controls mirroring Blender's
 * `DOPESHEET_HT_playback_controls` + `GRAPH_HT_playback_controls` —
 * the spacer-flex layout is already shaped for that injection.
 *
 * Per Rule №1 (no quick-and-dirty fixes): NO interactive affordances
 * yet. Click-to-open-Logs would require either workspace mutation
 * (swap an Area's editorType to 'logs' — invasive) or a new global
 * Logs-panel store (parallel to editMenuStore but for a non-popover
 * surface — out of scope for the first cut). The bar is read-only
 * informational; users open Logs via the existing area-tab dropdown.
 * Marked as a deliberate first-cut scope, not an oversight.
 *
 * @module v3/shell/Footer
 */

import { useMemo } from 'react';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useLogsStore } from '../../store/logsStore.js';
import { getDataKind } from '../../store/objectDataAccess.js';
import {
  formatInputStatus,
  formatStats,
  countReports,
} from './footerStatusData.js';

export function Footer() {
  // Modal subscriptions — narrow primitive selectors per
  // `feedback_filter_in_selector` (return store-resident values,
  // not derived arrays/objects, to keep getSnapshot stable across
  // ticks).
  const modalKind        = useModalTransformStore((s) => s.kind);
  const modalAxis        = useModalTransformStore((s) => s.axis);
  const modalTyped       = useModalTransformStore((s) => s.typedBuffer);
  const modalNumeric     = useModalTransformStore((s) => s.numericMode);
  const modalLiveDelta   = useModalTransformStore((s) => s.liveDelta);

  const vModalKind  = useModalVertexTransformStore((s) => s.kind);
  const vModalAxis  = useModalVertexTransformStore((s) => s.axis);
  const vModalTyped = useModalVertexTransformStore((s) => s.typedBuffer);

  const editMode       = useEditorStore((s) => s.editMode);
  const selection      = useEditorStore((s) => s.selection);
  const vertexSelMap   = useEditorStore((s) => s.selectedVertexIndices);

  const project = useProjectStore((s) => s.project);

  // Subscribe to entries ref directly — countReports is the derive
  // step, kept in useMemo so re-renders only fire when entries changes
  // (the LogsStore push always mutates the array reference).
  const entries = useLogsStore((s) => s.entries);
  const reports = useMemo(() => countReports(entries), [entries]);

  const activeHead = Array.isArray(selection) && selection.length > 0
    ? selection[0]
    : null;
  const headDataKind = useMemo(() => {
    if (!activeHead) return null;
    const node = project?.nodes?.find((n) => n.id === activeHead);
    return getDataKind(node, project);
  }, [activeHead, project]);

  // Sum vertex selection across all parts. Edit Mode mesh-only stat;
  // ignored by formatStats for other modes.
  const vertexSelectionCount = useMemo(() => {
    if (editMode !== 'edit') return 0;
    if (!(vertexSelMap instanceof Map) || vertexSelMap.size === 0) return 0;
    let total = 0;
    for (const set of vertexSelMap.values()) {
      total += (set?.size ?? 0);
    }
    return total;
  }, [editMode, vertexSelMap]);

  const inputStatus = formatInputStatus({
    modal: {
      kind: modalKind,
      axis: modalAxis,
      typedBuffer: modalTyped,
      numericMode: modalNumeric,
      liveDelta: modalLiveDelta,
    },
    vertexModal: {
      kind: vModalKind,
      axis: vModalAxis,
      typedBuffer: vModalTyped,
    },
    editMode,
    dataKind: headDataKind,
  });

  const stats = formatStats({
    selectionCount: Array.isArray(selection) ? selection.length : 0,
    editMode,
    headDataKind,
    vertexSelectionCount,
  });

  // Highlight the input-status when a modal is active so the user's
  // attention tracks the in-flight gesture. Mirrors Blender's status-bar
  // emphasis on the active operator name.
  const modalActive = !!modalKind || !!vModalKind;

  return (
    <footer className="h-6 border-t shrink-0 bg-card flex items-center px-3 gap-3 text-[11px] text-muted-foreground select-none">
      {/* LEFT — input status (modal echo or mode label).
          tabular-nums keeps the live delta from jittering width during
          drags; the foreground color flips while a modal is active to
          reinforce "you are in a gesture". */}
      <div
        className={
          'shrink-0 tabular-nums font-medium '
          + (modalActive ? 'text-foreground' : 'text-muted-foreground')
        }
      >
        {inputStatus}
      </div>

      {/* CENTER — flex spacer. Doubles as the future home for the
          transport-row lift (DOPESHEET_HT_playback_controls). Today
          it just pushes the reports + stats to the right edge. */}
      <div className="flex-1" />

      {/* CENTER-RIGHT — reports banner. Hidden when both warn + error
          are zero so the bar reads quiet at rest. */}
      {(reports.warn > 0 || reports.error > 0) ? (
        <div className="flex items-center gap-1.5 shrink-0">
          {reports.warn > 0 ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 rounded bg-yellow-500/15 text-yellow-300 tabular-nums"
              title={`${reports.warn} warning${reports.warn === 1 ? '' : 's'} in Logs`}
            >
              <span aria-hidden>⚠</span>
              <span>{reports.warn}</span>
            </span>
          ) : null}
          {reports.error > 0 ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 rounded bg-red-500/15 text-red-300 tabular-nums"
              title={`${reports.error} error${reports.error === 1 ? '' : 's'} in Logs`}
            >
              <span aria-hidden>⛔</span>
              <span>{reports.error}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* RIGHT — stats info. Selection count + active head data kind. */}
      <div className="shrink-0 tabular-nums">
        {stats}
      </div>
    </footer>
  );
}
