// @ts-check
/* eslint-disable react/prop-types */

/**
 * Animation Phase 5 Slice 5.Q — Active Keyframe N-panel section.
 *
 * React rendering for the "Active Keyframe" panel inside the
 * FCurveEditor's N-panel (right sidebar). Pure presentation; all
 * state derivation + edit recipes live in
 * [activeKeyformPanelData.js](./activeKeyformPanelData.js). Sister
 * architecture to `fcurveFooterData.js` ↔ `FCurveEditor.FCurveFooter`
 * (Slice 5.P).
 *
 * Mirrors Blender's `graph_panel_key_properties` rendering at
 * `reference/blender/source/blender/editors/space_graph/graph_buttons.cc:365-610`,
 * registered as `GRAPH_PT_key_properties` with label `"Active Keyframe"`
 * (`graph_buttons.cc:1434-1438`).
 *
 * # Three editable fields (MVP)
 *
 *   - **Interpolation** dropdown — Blender's `bezt_ptr.prop("interpolation")`
 *     at `graph_buttons.cc:410`. SS uses the existing 13-entry
 *     `INTERPOLATION_TYPES` array (FCurveEditor.jsx:397-411) for
 *     parity with the existing T-menu's options.
 *   - **Time (ms)** number input — Blender's "Key Frame" / `co_ui[0]`
 *     at `graph_buttons.cc:443-457`. SS labels as "Time (ms)" per the
 *     `feedback_ms_canonical_animation_time` rule (SS canonical unit
 *     is ms throughout the eval substrate).
 *   - **Value** number input — Blender's `co_ui[1]` at
 *     `graph_buttons.cc:460-475`.
 *
 * Handle editing rows (left handle, right handle, easing direction,
 * easing extras) are deferred to Slice 5.R — see
 * `activeKeyformPanelData.js` Deviation 1.
 *
 * # Edit commit semantics
 *
 * Each field uses commit-on-blur + commit-on-Enter (mirrors Blender's
 * `B_REDR` button retval pattern at `graph_buttons.cc:456`). Pressing
 * Escape cancels the in-flight edit. The component owns a local
 * "draft" string per field while the user is typing; on commit the
 * draft is parsed and the matching `applyEdit*` recipe is dispatched
 * through `update()` (no `skipHistory:true` — these are data writes
 * that should populate the undo stack).
 *
 * Preflight gates (Slices 5.M/5.N/5.O/5.P pattern): the dispatcher
 * calls `wouldEdit*Change` BEFORE `update()` so committing the
 * existing value (Enter without changing anything) doesn't burn an
 * undo slot via the unconditional `projectStore.js:230-232` snapshot.
 *
 * # When there's no active keyform
 *
 * The panel renders an "empty" state matching Blender's
 * `graph_buttons.cc:604-606` ("No active keyframe on F-Curve"). SS
 * surfaces the same message regardless of whether the absence is
 * caused by no fcurves, no active fcurve, or no selected keyform on
 * the active fcurve — Blender splits those into 3 sub-messages
 * (`graph_buttons.cc:594-606`) but only the 3rd (`"No active
 * keyframe"`) actually applies to SS today since SS doesn't have
 * F-Modifiers (`fcu.modifiers`) or sampled points (`fcu.fpt`) yet.
 * Closure ties to Phase 5 queued path #14 (F-Curve modifiers).
 *
 * @module v3/editors/fcurve/ActiveKeyformPanel
 */

import { useCallback, useRef, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import {
  resolveActiveKeyformContext,
  wouldEditKeyformValueChange,
  applyEditKeyformValue,
  wouldEditKeyformFrameChange,
  applyEditKeyformFrame,
  wouldEditKeyformInterpolationChange,
  applyEditKeyformInterpolation,
} from './activeKeyformPanelData.js';

/**
 * @param {{
 *   action: { id: string, fcurves: Array<object> } | null,
 *   activeActionId: string | null,
 *   activeFCurveId: string | null,
 *   interpolationTypes: ReadonlyArray<{ key: string, label: string }>,
 * }} props
 */
export function ActiveKeyformPanel({
  action,
  activeActionId,
  activeFCurveId,
  interpolationTypes,
}) {
  // ALL hooks hoisted above any early return per
  // `feedback_hooks_before_early_return`. The empty-state branch
  // below skips rendering the data UI but the hook call list stays
  // constant across both branches.
  const update = useProjectStore((s) => s.updateProject);

  const onEditValue = useCallback((newValue) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditKeyformValueChange(liveAction, activeFCurveId, newValue)) {
      return;
    }
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditKeyformValue(a, activeFCurveId, newValue);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onEditFrame = useCallback((newTimeMs) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditKeyformFrameChange(liveAction, activeFCurveId, newTimeMs)) {
      return;
    }
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditKeyformFrame(a, activeFCurveId, newTimeMs);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onEditInterpolation = useCallback((newInterp) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditKeyformInterpolationChange(liveAction, activeFCurveId, newInterp)) {
      return;
    }
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditKeyformInterpolation(a, activeFCurveId, newInterp);
    });
  }, [activeActionId, activeFCurveId, update]);

  const ctx = resolveActiveKeyformContext(action, activeFCurveId);

  if (!ctx) {
    // Mirrors Blender's `"No active keyframe on F-Curve"` empty state
    // (`graph_buttons.cc:605`).
    return (
      <PanelSection title="Active Keyframe">
        <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
          No active keyframe
        </div>
      </PanelSection>
    );
  }

  // Interpolation dropdown — sparse-default 'linear' surfaced as the
  // display value when the field is missing.
  const currentInterp = ctx.kf.interpolation ?? 'linear';

  return (
    <PanelSection title="Active Keyframe">
      <div className="px-3 py-2 space-y-2">
        <FieldRow label="Interpolation">
          <select
            value={currentInterp}
            onChange={(e) => onEditInterpolation(e.target.value)}
            className="w-full h-6 px-1 text-[11px] bg-background border rounded focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {interpolationTypes.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Time (ms)">
          <NumberInput
            value={ctx.kf.time}
            onCommit={onEditFrame}
            step={1}
          />
        </FieldRow>

        <FieldRow label="Value">
          <NumberInput
            value={ctx.kf.value}
            onCommit={onEditValue}
            step={0.01}
          />
        </FieldRow>
      </div>
    </PanelSection>
  );
}

/**
 * Generic collapsible-style panel section (header + body). Static
 * label only — collapse state ships with the N-panel-persistence
 * slice (not this one).
 */
function PanelSection({ title, children }) {
  return (
    <div className="border-b">
      <div className="h-6 px-3 flex items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/30">
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Number input with commit-on-blur + commit-on-Enter + cancel-on-Escape
 * (commit semantics matching Blender's B_REDR pattern).
 *
 * Local "draft" string mirrors the active typing state; resets to the
 * canonical value when the prop changes (the parent re-renders with
 * new value after a successful commit OR if the active keyform
 * changes — both cases want to discard the user's stale draft).
 *
 * Resetting on prop change can clobber an in-flight edit if the
 * parent re-renders during typing. The mitigation is the `focusedRef`
 * gate: while the input has focus, the prop-change effect is
 * suppressed (the user's typing wins). On blur the draft is committed
 * AND focus drops, so the next render's prop reflects the committed
 * value with no draft to clobber.
 */
function NumberInput({ value, onCommit, step }) {
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focusedRef = useRef(false);

  // Reset draft when the canonical value changes IF the input is not
  // currently focused (user is not in the middle of typing).
  if (!focusedRef.current) {
    const expected = formatNumber(value);
    if (draft !== expected) {
      // Setting state during render is fine when guarded against
      // unbounded re-render (the next render's `draft === expected`
      // makes this branch a no-op until `value` changes again).
      setDraft(expected);
    }
  }

  const commit = useCallback(() => {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) {
      onCommit(parsed);
    }
  }, [draft, onCommit]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur(); // triggers commit via onBlur
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(formatNumber(value));
          e.currentTarget.blur();
        }
      }}
      className="w-full h-6 px-1.5 text-[11px] tabular-nums bg-background border rounded focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

/**
 * Format a number for display in the input. Integer values render
 * without a decimal point; non-integers preserve their decimal text
 * up to 6 places (matches Blender's NUM_BUTTON_PRECISION ceiling).
 */
function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  // Trim trailing zeros from a fixed-precision render.
  return String(parseFloat(n.toFixed(6)));
}
