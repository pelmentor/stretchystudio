// @ts-check

/**
 * Animation Phase 5 Slices 5.D + 5.S — DriverBanner component.
 *
 * Combined compact summary (5.D) + collapsible editor body (5.S).
 *
 * Sister to ActiveKeyformPanel (5.Q + 5.R) — pure presentation layer
 * with internal dispatchers; mutation logic lives in
 * `driverEditorData.js` and runs inside `update(recipe)` calls.
 *
 * # 5.D — compact summary (always shown when driver active)
 *
 * Single horizontal strip with:
 *   - Curve color swatch
 *   - "DRIVER" pill + type token + truncated expression OR variable count
 *   - Live driver value (re-evaluated upstream and passed in as `value`)
 *   - Expand/Collapse toggle (5.S addition)
 *   - "Clear Driver" button
 *
 * Mirrors Blender's "Driver" enable toggle + the
 * `graph_draw_driver_settings_panel` summary (`graph_buttons.cc:931-1050`)
 * but flattened into one strip because SS merges Blender's Drivers Mode
 * into the main Graph Editor (see FCurveEditor.jsx file-header
 * "Deviations from Blender" — "Banner mode-split").
 *
 * # 5.S — collapsible editor body (this slice)
 *
 * On expand:
 *   1. **Type dropdown** — 5-entry Blender RNA enum verbatim (Averaged
 *      Value / Sum Values / Scripted Expression / Min / Max)
 *      — `graph_buttons.cc:990` (`driver_ptr.prop("type")`).
 *   2. **Expression** input (scripted-only) — `graph_buttons.cc:1015`
 *      (`driver_ptr.prop("expression")`).
 *   3. **Variables list** — per-row name + RNA path + remove button.
 *      Mirrors the per-variable boxes at `graph_buttons.cc:1109-1226`.
 *   4. **"+ Add Variable" button** — `graph_buttons.cc:1079-1098`.
 *
 * All edits route through internal dispatcher callbacks (preflight +
 * `update()` per ActiveKeyformPanel pattern). HTMLSelectElement / text-
 * input commits on blur + Enter (matches Blender's `B_REDR` button
 * retval). Each dispatcher reads live project state via
 * `useProjectStore.getState()` so preflight sees the post-batch
 * snapshot — same pattern as ActiveKeyformPanel.
 *
 * @module v3/editors/fcurve/DriverBanner
 */

import { useCallback, useRef, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import {
  DRIVER_TYPES,
  wouldEditDriverTypeChange,
  applyEditDriverType,
  wouldEditDriverExpressionChange,
  applyEditDriverExpression,
  wouldAddDriverVariableChange,
  applyAddDriverVariable,
  wouldRemoveDriverVariableChange,
  applyRemoveDriverVariable,
  wouldEditDriverVariableNameChange,
  applyEditDriverVariableName,
  wouldEditDriverVariableRnaPathChange,
  applyEditDriverVariableRnaPath,
} from './driverEditorData.js';

/**
 * Format the live driver value for display.
 * @param {number|null} value
 */
function formatDriverValue(value) {
  if (value === null) return '--';
  if (!Number.isFinite(value)) return 'NaN (fallback to keyforms)';
  return value.toFixed(3);
}

/**
 * DriverBanner — compact summary + collapsible editor body.
 *
 * Self-contained: derives mutation dispatchers internally via
 * `useProjectStore.getState()`. Parent passes the rendered state
 * (`driver`, `value`) plus `activeActionId` + `activeFCurveId` for
 * action resolution.
 *
 * @param {{
 *   driver: { type:string, expression?:string, variables?:any[] },
 *   value: number|null,
 *   color: string|null,
 *   label: string,
 *   activeActionId: string|null,
 *   activeFCurveId: string|null,
 *   onClear: () => void,
 * }} props
 */
export function DriverBanner({
  driver,
  value,
  color,
  label,
  activeActionId,
  activeFCurveId,
  onClear,
}) {
  const [expanded, setExpanded] = useState(false);
  const update = useProjectStore((s) => s.updateProject);

  // ── Dispatchers — preflight + update() per ActiveKeyformPanel pattern.
  // Each one reads live project state via getState() so preflight sees
  // the post-batch snapshot (matches the existing dispatcher idiom).

  const onEditType = useCallback((newType) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditDriverTypeChange(liveAction, activeFCurveId, newType)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditDriverType(a, activeFCurveId, newType);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onEditExpression = useCallback((newExpr) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditDriverExpressionChange(liveAction, activeFCurveId, newExpr)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditDriverExpression(a, activeFCurveId, newExpr);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onAddVariable = useCallback(() => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldAddDriverVariableChange(liveAction, activeFCurveId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyAddDriverVariable(a, activeFCurveId);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onRemoveVariable = useCallback((idx) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldRemoveDriverVariableChange(liveAction, activeFCurveId, idx)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyRemoveDriverVariable(a, activeFCurveId, idx);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onEditVariableName = useCallback((idx, newName) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditDriverVariableNameChange(liveAction, activeFCurveId, idx, newName)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditDriverVariableName(a, activeFCurveId, idx, newName);
    });
  }, [activeActionId, activeFCurveId, update]);

  const onEditVariableRnaPath = useCallback((idx, newPath) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditDriverVariableRnaPathChange(liveAction, activeFCurveId, idx, newPath)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditDriverVariableRnaPath(a, activeFCurveId, idx, newPath);
    });
  }, [activeActionId, activeFCurveId, update]);

  const type = driver?.type ?? 'scripted';
  const expr = typeof driver?.expression === 'string' ? driver.expression : '';
  const variables = Array.isArray(driver?.variables) ? driver.variables : [];
  const varCount = variables.length;
  const exprPreview = expr.length > 60 ? expr.slice(0, 57) + '...' : expr;
  const valueText = formatDriverValue(value);

  return (
    <div className="border-b border-border bg-popover/40 shadow-sm flex-shrink-0">
      {/* Compact summary row */}
      <div
        className="flex items-center gap-2 px-3 py-1 text-[11px]"
        title={`Driver active on ${label} -- keyforms are overridden by the driver expression`}
      >
        <span
          className="w-3 h-3 rounded-sm flex-shrink-0"
          style={{ backgroundColor: color ?? 'currentColor' }}
          aria-hidden
        />
        <span className="font-mono uppercase tracking-wider text-primary px-1.5 rounded bg-primary/15">
          Driver
        </span>
        <span className="text-muted-foreground">{type}</span>
        {type === 'scripted' ? (
          <span className="font-mono text-foreground/80 truncate flex-1 min-w-0" title={expr}>
            {exprPreview || <span className="italic text-muted-foreground">empty expression</span>}
          </span>
        ) : (
          <span className="text-muted-foreground flex-1 min-w-0 truncate">
            {varCount} variable{varCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="font-mono text-foreground/90 px-1.5 border border-border rounded flex-shrink-0">
          = {valueText}
        </span>
        <button
          type="button"
          className="px-2 py-0.5 rounded border border-border bg-card hover:bg-accent text-foreground flex-shrink-0"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? 'Collapse driver editor' : 'Expand driver editor'}
          aria-expanded={expanded}
        >
          {expanded ? '▼ Edit' : '▶ Edit'}
        </button>
        <button
          type="button"
          className="px-2 py-0.5 rounded border border-border bg-card hover:bg-accent text-foreground flex-shrink-0"
          onClick={onClear}
          title="Remove the driver to allow keyframe editing"
        >
          Clear Driver
        </button>
      </div>

      {expanded ? (
        <DriverEditorBody
          driver={driver}
          variables={variables}
          onEditType={onEditType}
          onEditExpression={onEditExpression}
          onAddVariable={onAddVariable}
          onRemoveVariable={onRemoveVariable}
          onEditVariableName={onEditVariableName}
          onEditVariableRnaPath={onEditVariableRnaPath}
        />
      ) : null}
    </div>
  );
}

/**
 * Editor body — type + expression + variables list.
 *
 * @param {{
 *   driver: { type:string, expression?:string },
 *   variables: any[],
 *   onEditType: (newType: string) => void,
 *   onEditExpression: (newExpr: string) => void,
 *   onAddVariable: () => void,
 *   onRemoveVariable: (idx: number) => void,
 *   onEditVariableName: (idx: number, newName: string) => void,
 *   onEditVariableRnaPath: (idx: number, newPath: string) => void,
 * }} props
 */
function DriverEditorBody({
  driver,
  variables,
  onEditType,
  onEditExpression,
  onAddVariable,
  onRemoveVariable,
  onEditVariableName,
  onEditVariableRnaPath,
}) {
  const type = driver?.type ?? 'scripted';
  const expression = typeof driver?.expression === 'string' ? driver.expression : '';

  return (
    <div className="px-3 py-2 text-[11px] border-t border-border bg-card/50 space-y-2">
      {/* Type row */}
      <div className="flex items-center gap-2">
        <label className="text-muted-foreground w-20 flex-shrink-0">Type</label>
        <select
          className="bg-background border border-border rounded px-1 py-0.5 text-foreground font-mono flex-1 min-w-0"
          value={type}
          onChange={(e) => onEditType(e.target.value)}
          title="Driver type"
        >
          {DRIVER_TYPES.map((d) => (
            <option key={d.token} value={d.token}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Expression row (scripted only) */}
      {type === 'scripted' ? (
        <ExpressionRow expression={expression} onCommit={onEditExpression} />
      ) : null}

      {/* Variables block */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            Variables ({variables.length})
          </span>
          <button
            type="button"
            className="ml-auto px-2 py-0.5 rounded border border-border bg-background hover:bg-accent text-foreground"
            onClick={onAddVariable}
            title="Add a Driver Variable to keep track of an input used by the driver"
          >
            + Add Input Variable
          </button>
        </div>
        {variables.length === 0 ? (
          <div className="italic text-muted-foreground pl-1">
            No input variables. Add one and reference it by name in the expression.
          </div>
        ) : (
          <div className="space-y-1">
            {variables.map((v, idx) => (
              <VariableRow
                key={idx}
                index={idx}
                name={typeof v?.name === 'string' ? v.name : ''}
                rnaPath={typeof v?.target?.rnaPath === 'string' ? v.target.rnaPath : ''}
                onEditName={onEditVariableName}
                onEditRnaPath={onEditVariableRnaPath}
                onRemove={onRemoveVariable}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Expression text input — commits on blur + Enter, cancels on Escape.
 * Local draft state mirrors Blender's `B_REDR` button retval pattern.
 *
 * Audit-fix HIGH-A2 (Slice 5.S dual-audit 2026-05-17): focus-guarded
 * draft reset matches the `NumberInput` pattern in
 * `ActiveKeyformPanel.jsx:473-521` — without the guard a concurrent
 * store update (e.g., physics tick re-rendering the parent) would
 * clobber the user's in-flight edit.
 *
 * @param {{ expression: string, onCommit: (v: string) => void }} props
 */
function ExpressionRow({ expression, onCommit }) {
  const [draft, setDraft] = useState(expression);
  const focusedRef = useRef(false);

  // Reset draft to canonical value only when input is NOT focused.
  // Set-state-during-render is safe here: the next render's
  // `draft === expression` makes the branch a no-op until `expression`
  // changes again.
  if (!focusedRef.current && draft !== expression) {
    setDraft(expression);
  }

  const commit = useCallback(() => {
    if (draft !== expression) onCommit(draft);
  }, [draft, expression, onCommit]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground w-20 flex-shrink-0">Expression:</label>
      <input
        type="text"
        className="bg-background border border-border rounded px-1 py-0.5 text-foreground font-mono flex-1 min-w-0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(expression);
            e.currentTarget.blur();
          }
        }}
        placeholder="e.g. var * 2 or clamp(var, 0, 1)"
        title="JS-subset expression. Variables resolved by name; built-ins: sin, cos, abs, min, max, clamp, sqrt, pow, PI"
        spellCheck={false}
      />
    </div>
  );
}

/**
 * Per-variable row — name + rnaPath + remove. Each text input commits
 * on blur + Enter, cancels on Escape.
 *
 * @param {{
 *   index: number,
 *   name: string,
 *   rnaPath: string,
 *   onEditName: (idx: number, v: string) => void,
 *   onEditRnaPath: (idx: number, v: string) => void,
 *   onRemove: (idx: number) => void,
 * }} props
 */
function VariableRow({ index, name, rnaPath, onEditName, onEditRnaPath, onRemove }) {
  return (
    <div className="flex items-center gap-1.5 border border-border rounded px-1.5 py-1 bg-background/60">
      <TextCommit
        value={name}
        onCommit={(v) => onEditName(index, v)}
        placeholder="var"
        title="Variable name (referenced inside the expression)"
        className="w-20 flex-shrink-0 font-mono"
      />
      <TextCommit
        value={rnaPath}
        onCommit={(v) => onEditRnaPath(index, v)}
        placeholder='objects["..."].opacity'
        title='RNA path: e.g. objects["bodyAngle"].pose.rotation or objects["__params__"].values["ParamAngleZ"]'
        className="flex-1 min-w-0 font-mono"
      />
      <button
        type="button"
        className="px-1.5 py-0.5 rounded border border-border bg-card hover:bg-destructive/20 hover:border-destructive/50 text-muted-foreground hover:text-destructive flex-shrink-0"
        onClick={() => onRemove(index)}
        title="Delete target variable"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Generic text input that maintains a local draft and commits on
 * blur + Enter (cancels on Escape).
 *
 * @param {{
 *   value: string,
 *   onCommit: (v: string) => void,
 *   placeholder?: string,
 *   title?: string,
 *   className?: string,
 * }} props
 */
function TextCommit({ value, onCommit, placeholder, title, className = '' }) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // Audit-fix HIGH-A2 (Slice 5.S dual-audit 2026-05-17): focus-guarded
  // reset matches the `NumberInput` pattern in
  // `ActiveKeyformPanel.jsx:473-521`. Without it, a concurrent store
  // update (e.g., physics tick re-render, sibling variable commit)
  // would clobber the user's in-flight edit because the `value` prop
  // re-derived from a fresh immer draft has a new identity.
  if (!focusedRef.current && draft !== value) {
    setDraft(value);
  }

  const commit = useCallback(() => {
    if (draft !== value) onCommit(draft);
  }, [draft, value, onCommit]);
  return (
    <input
      type="text"
      className={`bg-background border border-border rounded px-1 py-0.5 text-foreground ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      title={title}
      spellCheck={false}
    />
  );
}
