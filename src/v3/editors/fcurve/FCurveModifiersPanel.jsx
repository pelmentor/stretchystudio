// @ts-check
/* eslint-disable react/prop-types */

/**
 * Animation Phase 3 Slice 3.C -- FCurve Modifiers N-panel section.
 *
 * React rendering for the per-fcurve modifier stack inside the
 * FCurveEditor's N-panel (right sidebar), mounted below
 * `ActiveKeyformPanel`. All state derivation + edit recipes live in
 * [fcurveModifiersPanelData.js](./fcurveModifiersPanelData.js). Sister
 * architecture to `activeKeyformPanelData.js` <->
 * `ActiveKeyformPanel.jsx` (Slice 5.Q+5.R).
 *
 * Mirrors Blender's `graph_panel_modifiers` rendering at
 * `reference/blender/source/blender/editors/space_graph/graph_buttons.cc`
 * (the "Modifiers" panel registered alongside `GRAPH_PT_key_properties`).
 *
 * # Surface (per plan §3.C)
 *
 *   - Top: "Add Modifier" dropdown (6 type options; greys Cycles when
 *     already present)
 *   - Per modifier (collapsible card, click header to expand):
 *     - Header: type label + mute toggle + remove button + drag handle
 *       (Up/Down reorder buttons in the substrate slice; drag-to-reorder
 *       is a future polish slice)
 *     - Body (when expanded):
 *       - Per-type inline editor (cycles/noise/generator/limits/
 *         stepped/envelope)
 *       - Common range/influence fields
 *
 * # Modifier-type editor components
 *
 * One small editor per type, each rendering the appropriate field set
 * with the right control kinds (NumberInput, select, checkbox).
 *
 * @module v3/editors/fcurve/FCurveModifiersPanel
 */

import { useCallback, useRef, useState } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import {
  resolveModifiersContext,
  MODIFIER_TYPE_OPTIONS,
  MODIFIER_TYPE_LABELS,
  wouldAddModifierChange,
  applyAddModifier,
  wouldRemoveModifierChange,
  applyRemoveModifier,
  wouldReorderModifierChange,
  applyReorderModifier,
  wouldSetModifierMutedChange,
  applySetModifierMuted,
  wouldSetActiveModifierChange,
  applySetActiveModifier,
  wouldEditModifierDataChange,
  applyEditModifierData,
  wouldSetModifierFlagChange,
  applySetModifierFlag,
  wouldEditModifierNumberChange,
  applyEditModifierNumber,
  applyAddGeneratorCoefficient,
  applyRemoveGeneratorCoefficient,
  applyEditGeneratorCoefficient,
  wouldAddGeneratorCoefficientChange,
  wouldRemoveGeneratorCoefficientChange,
  wouldEditGeneratorCoefficientChange,
  applyAddEnvelopeControlPoint,
  applyRemoveEnvelopeControlPoint,
  applyEditEnvelopeControlPoint,
  wouldAddEnvelopeControlPointChange,
  wouldRemoveEnvelopeControlPointChange,
  wouldEditEnvelopeControlPointChange,
} from './fcurveModifiersPanelData.js';

/**
 * @param {{
 *   action: { id: string, fcurves: Array<any> } | null,
 *   activeActionId: string | null,
 *   activeFCurveId: string | null,
 * }} props
 */
export function FCurveModifiersPanel({ action, activeActionId, activeFCurveId }) {
  // ALL hooks hoisted above any early return per
  // `feedback_hooks_before_early_return`.
  const update = useProjectStore((s) => s.updateProject);
  // Per-card collapse state lives in the component (sparse; missing
  // means expanded by default -- the modifier was just added so user
  // wants to see its fields). Track by modifier.id to survive reorder.
  const [collapsed, setCollapsed] = useState(/** @type {Record<string,boolean>} */ ({}));

  const handleAdd = useCallback((type) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldAddModifierChange(liveAction, activeFCurveId, type)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyAddModifier(a, activeFCurveId, type);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleRemove = useCallback((modifierId) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldRemoveModifierChange(liveAction, activeFCurveId, modifierId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyRemoveModifier(a, activeFCurveId, modifierId);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleReorder = useCallback((fromIndex, toIndex) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldReorderModifierChange(liveAction, activeFCurveId, fromIndex, toIndex)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyReorderModifier(a, activeFCurveId, fromIndex, toIndex);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleToggleMute = useCallback((modifierId, currentMuted) => {
    const target = !currentMuted;
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldSetModifierMutedChange(liveAction, activeFCurveId, modifierId, target)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applySetModifierMuted(a, activeFCurveId, modifierId, target);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleSetActive = useCallback((modifierId) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldSetActiveModifierChange(liveAction, activeFCurveId, modifierId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applySetActiveModifier(a, activeFCurveId, modifierId);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleEditData = useCallback((modifierId, dataPath, value) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditModifierDataChange(liveAction, activeFCurveId, modifierId, dataPath, value)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditModifierData(a, activeFCurveId, modifierId, dataPath, value);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleSetFlag = useCallback((modifierId, flag, value) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldSetModifierFlagChange(liveAction, activeFCurveId, modifierId, flag, value)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applySetModifierFlag(a, activeFCurveId, modifierId, flag, value);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleEditNumber = useCallback((modifierId, field, value) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditModifierNumberChange(liveAction, activeFCurveId, modifierId, field, value)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditModifierNumber(a, activeFCurveId, modifierId, field, value);
    });
  }, [activeActionId, activeFCurveId, update]);

  // Coefficient ops (generator). All gated on would*Change predicates
  // per Rule №1 / undo-discipline (audit-fix 3.C arch MED-1).
  const handleAddCoefficient = useCallback((modifierId) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldAddGeneratorCoefficientChange(liveAction, activeFCurveId, modifierId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyAddGeneratorCoefficient(a, activeFCurveId, modifierId);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleRemoveCoefficient = useCallback((modifierId) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldRemoveGeneratorCoefficientChange(liveAction, activeFCurveId, modifierId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyRemoveGeneratorCoefficient(a, activeFCurveId, modifierId);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleEditCoefficient = useCallback((modifierId, index, value) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditGeneratorCoefficientChange(liveAction, activeFCurveId, modifierId, index, value)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditGeneratorCoefficient(a, activeFCurveId, modifierId, index, value);
    });
  }, [activeActionId, activeFCurveId, update]);

  // Envelope control point ops. Same gating discipline as coefficients
  // (audit-fix 3.C arch MED-2).
  const handleAddControlPoint = useCallback((modifierId, time) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldAddEnvelopeControlPointChange(liveAction, activeFCurveId, modifierId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyAddEnvelopeControlPoint(a, activeFCurveId, modifierId, time);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleRemoveControlPoint = useCallback((modifierId, index) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldRemoveEnvelopeControlPointChange(liveAction, activeFCurveId, modifierId, index)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyRemoveEnvelopeControlPoint(a, activeFCurveId, modifierId, index);
    });
  }, [activeActionId, activeFCurveId, update]);

  const handleEditControlPoint = useCallback((modifierId, index, field, value) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldEditEnvelopeControlPointChange(liveAction, activeFCurveId, modifierId, index, field, value)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyEditEnvelopeControlPoint(a, activeFCurveId, modifierId, index, field, value);
    });
  }, [activeActionId, activeFCurveId, update]);

  const ctx = resolveModifiersContext(action, activeFCurveId);

  if (!ctx) {
    return (
      <PanelSection title="Modifiers">
        <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
          No active F-Curve
        </div>
      </PanelSection>
    );
  }

  const modifiers = ctx.modifiers;
  const cyclesAlreadyPresent = modifiers.some((m) => m && m.type === 'cycles');

  return (
    <PanelSection title="Modifiers">
      <div className="px-3 py-2 space-y-2">
        <AddModifierRow
          cyclesPresent={cyclesAlreadyPresent}
          onAdd={handleAdd}
        />
        {modifiers.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">
            No modifiers
          </div>
        ) : (
          modifiers.map((mod, i) => {
            if (!mod || !mod.id) return null;
            const isCollapsed = collapsed[mod.id] === true;
            return (
              <ModifierCard
                key={mod.id}
                mod={mod}
                index={i}
                count={modifiers.length}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() => setCollapsed((s) => ({ ...s, [mod.id]: !isCollapsed }))}
                onSetActive={() => handleSetActive(mod.id)}
                onToggleMute={() => handleToggleMute(mod.id, mod.muted === true)}
                onRemove={() => handleRemove(mod.id)}
                onMoveUp={() => handleReorder(i, i - 1)}
                onMoveDown={() => handleReorder(i, i + 1)}
                onEditData={(path, v) => handleEditData(mod.id, path, v)}
                onSetFlag={(flag, v) => handleSetFlag(mod.id, flag, v)}
                onEditNumber={(field, v) => handleEditNumber(mod.id, field, v)}
                onAddCoefficient={() => handleAddCoefficient(mod.id)}
                onRemoveCoefficient={() => handleRemoveCoefficient(mod.id)}
                onEditCoefficient={(idx, v) => handleEditCoefficient(mod.id, idx, v)}
                onAddControlPoint={(time) => handleAddControlPoint(mod.id, time)}
                onRemoveControlPoint={(idx) => handleRemoveControlPoint(mod.id, idx)}
                onEditControlPoint={(idx, field, v) => handleEditControlPoint(mod.id, idx, field, v)}
              />
            );
          })
        )}
      </div>
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Add Modifier dropdown
// ---------------------------------------------------------------------------

function AddModifierRow({ cyclesPresent, onAdd }) {
  return (
    <div className="flex items-center gap-2">
      <select
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onAdd(v);
          // Reset the select so the same type can be added again
          e.target.value = '';
        }}
        className="flex-1 h-6 px-1 text-[11px] bg-background border rounded focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">+ Add Modifier...</option>
        {MODIFIER_TYPE_OPTIONS.map((opt) => (
          <option
            key={opt.key}
            value={opt.key}
            disabled={opt.key === 'cycles' && cyclesPresent}
          >
            {opt.label}{opt.key === 'cycles' && cyclesPresent ? ' (already present)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-modifier card
// ---------------------------------------------------------------------------

function ModifierCard({
  mod, index, count, isCollapsed,
  onToggleCollapsed, onSetActive, onToggleMute, onRemove, onMoveUp, onMoveDown,
  onEditData, onSetFlag, onEditNumber,
  onAddCoefficient, onRemoveCoefficient, onEditCoefficient,
  onAddControlPoint, onRemoveControlPoint, onEditControlPoint,
}) {
  const isActive = mod.active === true;
  const isMuted = mod.muted === true;
  const canMoveUp = index > 0;
  const canMoveDown = index < count - 1;
  const label = MODIFIER_TYPE_LABELS[mod.type] || mod.type;

  return (
    <div
      className={`border rounded ${isActive ? 'border-accent' : 'border-border'} bg-background`}
    >
      <div
        className="h-7 px-2 flex items-center gap-1 cursor-pointer select-none"
        onClick={onSetActive}
      >
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <span className={`flex-1 text-[11px] ${isMuted ? 'opacity-50 line-through' : ''}`}>
          {label}
        </span>
        <button
          type="button"
          className="px-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!canMoveUp}
          title="Move up"
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
        >▲</button>
        <button
          type="button"
          className="px-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!canMoveDown}
          title="Move down"
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
        >▼</button>
        <button
          type="button"
          className={`px-1 text-[11px] ${isMuted ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🚫' : '👁'}
        </button>
        <button
          type="button"
          className="px-1 text-[11px] text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove modifier"
        >✕</button>
      </div>
      {!isCollapsed && (
        <div className="px-2 py-2 border-t space-y-2">
          <PerTypeEditor
            mod={mod}
            onEditData={onEditData}
            onAddCoefficient={onAddCoefficient}
            onRemoveCoefficient={onRemoveCoefficient}
            onEditCoefficient={onEditCoefficient}
            onAddControlPoint={onAddControlPoint}
            onRemoveControlPoint={onRemoveControlPoint}
            onEditControlPoint={onEditControlPoint}
          />
          <CommonRangeAndInfluence
            mod={mod}
            onSetFlag={onSetFlag}
            onEditNumber={onEditNumber}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type editor dispatch
// ---------------------------------------------------------------------------

function PerTypeEditor({ mod, onEditData, onAddCoefficient, onRemoveCoefficient, onEditCoefficient, onAddControlPoint, onRemoveControlPoint, onEditControlPoint }) {
  const data = mod.data ?? {};
  switch (mod.type) {
    case 'cycles':
      return <CyclesEditor data={data} onEditData={onEditData} />;
    case 'noise':
      return <NoiseEditor data={data} onEditData={onEditData} />;
    case 'generator':
      return (
        <GeneratorEditor
          data={data}
          onEditData={onEditData}
          onAddCoefficient={onAddCoefficient}
          onRemoveCoefficient={onRemoveCoefficient}
          onEditCoefficient={onEditCoefficient}
        />
      );
    case 'limits':
      return <LimitsEditor data={data} onEditData={onEditData} />;
    case 'stepped':
      return <SteppedEditor data={data} onEditData={onEditData} />;
    case 'envelope':
      return (
        <EnvelopeEditor
          data={data}
          onEditData={onEditData}
          onAddControlPoint={onAddControlPoint}
          onRemoveControlPoint={onRemoveControlPoint}
          onEditControlPoint={onEditControlPoint}
        />
      );
    default:
      return <div className="text-[11px] text-muted-foreground italic">Unknown modifier type: {mod.type}</div>;
  }
}

// ---------------------------------------------------------------------------
// Per-type editors
// ---------------------------------------------------------------------------

// Cycle mode labels match Blender's RNA enum at
// `reference/blender/source/blender/makesrna/intern/rna_fcurve.cc:1531-1545`.
// Audit-fix 2026-05-18 fidelity HIGH-2 + HIGH-3: pre-fix had "Repeat"
// (Blender uses "Repeat Motion") and "Mirror" (Blender uses "Repeat
// Mirrored"); corrected for label parity.
const CYCLE_MODES = /** @type {const} */ ([
  { key: 'none', label: 'No Cycles' },
  { key: 'repeat', label: 'Repeat Motion' },
  { key: 'repeat_offset', label: 'Repeat with Offset' },
  { key: 'mirror', label: 'Repeat Mirrored' },
]);

function CyclesEditor({ data, onEditData }) {
  return (
    <>
      <FieldRow label="Before">
        <SelectInput
          value={data.before ?? 'none'}
          options={CYCLE_MODES}
          onChange={(v) => onEditData('before', v)}
        />
      </FieldRow>
      <FieldRow label="Before #">
        <NumberInput
          value={Number.isFinite(data.beforeCycles) ? data.beforeCycles : 0}
          step={1}
          onCommit={(v) => onEditData('beforeCycles', v)}
        />
      </FieldRow>
      <FieldRow label="After">
        <SelectInput
          value={data.after ?? 'none'}
          options={CYCLE_MODES}
          onChange={(v) => onEditData('after', v)}
        />
      </FieldRow>
      <FieldRow label="After #">
        <NumberInput
          value={Number.isFinite(data.afterCycles) ? data.afterCycles : 0}
          step={1}
          onCommit={(v) => onEditData('afterCycles', v)}
        />
      </FieldRow>
      <Hint>0 = infinite repeats. Cycles must stay at the top of the stack.</Hint>
    </>
  );
}

const NOISE_BLEND_TYPES = /** @type {const} */ ([
  { key: 'replace', label: 'Replace' },
  { key: 'add', label: 'Add' },
  { key: 'subtract', label: 'Subtract' },
  { key: 'multiply', label: 'Multiply' },
]);

function NoiseEditor({ data, onEditData }) {
  return (
    <>
      <FieldRow label="Size (ms)">
        <NumberInput
          value={Number.isFinite(data.size) ? data.size : 1000}
          step={10}
          onCommit={(v) => onEditData('size', v)}
        />
      </FieldRow>
      <FieldRow label="Strength">
        <NumberInput
          value={Number.isFinite(data.strength) ? data.strength : 1}
          step={0.1}
          onCommit={(v) => onEditData('strength', v)}
        />
      </FieldRow>
      <FieldRow label="Phase">
        <NumberInput
          value={Number.isFinite(data.phase) ? data.phase : 1}
          step={0.1}
          onCommit={(v) => onEditData('phase', v)}
        />
      </FieldRow>
      <FieldRow label="Offset">
        <NumberInput
          value={Number.isFinite(data.offset) ? data.offset : 0}
          step={0.1}
          onCommit={(v) => onEditData('offset', v)}
        />
      </FieldRow>
      <FieldRow label="Blend">
        <SelectInput
          value={data.blendType ?? 'replace'}
          options={NOISE_BLEND_TYPES}
          onChange={(v) => onEditData('blendType', v)}
        />
      </FieldRow>
      <FieldRow label="Depth">
        <NumberInput
          value={Number.isFinite(data.depth) ? data.depth : 0}
          step={1}
          onCommit={(v) => onEditData('depth', Math.max(0, Math.floor(v)))}
        />
      </FieldRow>
      <FieldRow label="Lacunarity">
        <NumberInput
          value={Number.isFinite(data.lacunarity) ? data.lacunarity : 2}
          step={0.1}
          onCommit={(v) => onEditData('lacunarity', v)}
        />
      </FieldRow>
      <FieldRow label="Roughness">
        <NumberInput
          value={Number.isFinite(data.roughness) ? data.roughness : 0.5}
          step={0.01}
          onCommit={(v) => onEditData('roughness', v)}
        />
      </FieldRow>
      <Hint>
        SS evaluator uses modern Perlin FBM exclusively. Blender's
        `use_legacy_noise` toggle (legacy BLI_noise turbulence path)
        is intentionally omitted -- 3.B evaluator did not port the
        legacy path.
      </Hint>
    </>
  );
}

// Generator mode labels match Blender's RNA enum at
// `reference/blender/source/blender/makesrna/intern/rna_fcurve.cc:1281-1285`.
// Audit-fix 2026-05-18 fidelity HIGH-4: pre-fix had "Polynomial" /
// "Factorised Polynomial"; Blender uses "Expanded Polynomial" /
// "Factorized Polynomial" (American spelling). The underlying data
// key stays `polynomial_factorised` (British spelling, established
// 3.A typedef convention); only the user-facing label flips.
const GENERATOR_MODES = /** @type {const} */ ([
  { key: 'polynomial', label: 'Expanded Polynomial' },
  { key: 'polynomial_factorised', label: 'Factorized Polynomial' },
]);

function GeneratorEditor({ data, onEditData, onAddCoefficient, onRemoveCoefficient, onEditCoefficient }) {
  const coefficients = Array.isArray(data.coefficients) ? data.coefficients : [];
  const mode = data.mode ?? 'polynomial';
  return (
    <>
      <FieldRow label="Mode">
        <SelectInput
          value={mode}
          options={GENERATOR_MODES}
          onChange={(v) => onEditData('mode', v)}
        />
      </FieldRow>
      <FieldRow label="Additive">
        <Checkbox
          checked={data.additive === true}
          onChange={(v) => onEditData('additive', v)}
        />
      </FieldRow>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Coefficients</span>
          <div className="flex gap-1">
            <button
              type="button"
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onAddCoefficient}
              title="Add coefficient"
            >+</button>
            <button
              type="button"
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={coefficients.length === 0}
              onClick={onRemoveCoefficient}
              title="Remove last coefficient"
            >−</button>
          </div>
        </div>
        {coefficients.map((c, i) => (
          <FieldRow key={i} label={`c${i}`}>
            <NumberInput
              value={c}
              step={0.1}
              onCommit={(v) => onEditCoefficient(i, v)}
            />
          </FieldRow>
        ))}
      </div>
      <Hint>
        {mode === 'polynomial'
          ? 'y = c0 + c1·x + c2·x² + ...'
          : 'y = (c0·x + c1) · (c2·x + c3) · ...'}
      </Hint>
      <Hint>
        Polynomial degree is derived from the coefficient count (Blender
        surfaces this as the "Order" field; SS derives it implicitly to
        avoid the order/arraysize sync invariant).
      </Hint>
    </>
  );
}

function LimitsEditor({ data, onEditData }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Checkbox
          checked={data.useMinX === true}
          label="Min X"
          onChange={(v) => onEditData('useMinX', v)}
        />
        <NumberInput
          value={Number.isFinite(data.minX) ? data.minX : 0}
          step={10}
          onCommit={(v) => onEditData('minX', v)}
          disabled={data.useMinX !== true}
        />
        <Checkbox
          checked={data.useMaxX === true}
          label="Max X"
          onChange={(v) => onEditData('useMaxX', v)}
        />
        <NumberInput
          value={Number.isFinite(data.maxX) ? data.maxX : 1000}
          step={10}
          onCommit={(v) => onEditData('maxX', v)}
          disabled={data.useMaxX !== true}
        />
        <Checkbox
          checked={data.useMinY === true}
          label="Min Y"
          onChange={(v) => onEditData('useMinY', v)}
        />
        <NumberInput
          value={Number.isFinite(data.minY) ? data.minY : 0}
          step={0.1}
          onCommit={(v) => onEditData('minY', v)}
          disabled={data.useMinY !== true}
        />
        <Checkbox
          checked={data.useMaxY === true}
          label="Max Y"
          onChange={(v) => onEditData('useMaxY', v)}
        />
        <NumberInput
          value={Number.isFinite(data.maxY) ? data.maxY : 1}
          step={0.1}
          onCommit={(v) => onEditData('maxY', v)}
          disabled={data.useMaxY !== true}
        />
      </div>
      <Hint>X clamps time (ms); Y clamps value.</Hint>
    </>
  );
}

function SteppedEditor({ data, onEditData }) {
  return (
    <>
      <FieldRow label="Step Size (ms)">
        <NumberInput
          value={Number.isFinite(data.stepSize) ? data.stepSize : 100}
          step={10}
          onCommit={(v) => onEditData('stepSize', Math.max(0.001, v))}
        />
      </FieldRow>
      <FieldRow label="Offset (ms)">
        <NumberInput
          value={Number.isFinite(data.offset) ? data.offset : 0}
          step={10}
          onCommit={(v) => onEditData('offset', v)}
        />
      </FieldRow>
      <Checkbox
        checked={data.useStartTime === true}
        label="Limit Start"
        onChange={(v) => onEditData('useStartTime', v)}
      />
      {data.useStartTime === true && (
        <FieldRow label="Start Time">
          <NumberInput
            value={Number.isFinite(data.startTime) ? data.startTime : 0}
            step={10}
            onCommit={(v) => onEditData('startTime', v)}
          />
        </FieldRow>
      )}
      <Checkbox
        checked={data.useEndTime === true}
        label="Limit End"
        onChange={(v) => onEditData('useEndTime', v)}
      />
      {data.useEndTime === true && (
        <FieldRow label="End Time">
          <NumberInput
            value={Number.isFinite(data.endTime) ? data.endTime : 1000}
            step={10}
            onCommit={(v) => onEditData('endTime', v)}
          />
        </FieldRow>
      )}
    </>
  );
}

function EnvelopeEditor({ data, onEditData, onAddControlPoint, onRemoveControlPoint, onEditControlPoint }) {
  const controlPoints = Array.isArray(data.controlPoints) ? data.controlPoints : [];
  return (
    <>
      <FieldRow label="Reference">
        <NumberInput
          value={Number.isFinite(data.referenceValue) ? data.referenceValue : 0}
          step={0.1}
          onCommit={(v) => onEditData('referenceValue', v)}
        />
      </FieldRow>
      <FieldRow label="Default Min">
        <NumberInput
          value={Number.isFinite(data.defaultMin) ? data.defaultMin : -1}
          step={0.1}
          onCommit={(v) => onEditData('defaultMin', v)}
        />
      </FieldRow>
      <FieldRow label="Default Max">
        <NumberInput
          value={Number.isFinite(data.defaultMax) ? data.defaultMax : 1}
          step={0.1}
          onCommit={(v) => onEditData('defaultMax', v)}
        />
      </FieldRow>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Control Points</span>
          <button
            type="button"
            className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              // Add at the next 1000ms slot past the last point
              // (default starting time when the panel adds; user can
              // edit afterwards).
              const lastTime = controlPoints.length > 0
                ? controlPoints[controlPoints.length - 1].time
                : 0;
              onAddControlPoint(lastTime + 1000);
            }}
            title="Add control point"
          >+</button>
        </div>
        {controlPoints.map((pt, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
            <NumberInput
              value={pt.time}
              step={10}
              onCommit={(v) => onEditControlPoint(i, 'time', v)}
            />
            <NumberInput
              value={pt.min}
              step={0.1}
              onCommit={(v) => onEditControlPoint(i, 'min', v)}
            />
            <NumberInput
              value={pt.max}
              step={0.1}
              onCommit={(v) => onEditControlPoint(i, 'max', v)}
            />
            <button
              type="button"
              className="px-1 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveControlPoint(i)}
              title="Remove point"
            >✕</button>
          </div>
        ))}
        {controlPoints.length === 0 && (
          <Hint>No control points. Add one to shape the envelope.</Hint>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Common range + influence section (shown under every per-type editor)
// ---------------------------------------------------------------------------

function CommonRangeAndInfluence({ mod, onSetFlag, onEditNumber }) {
  return (
    <div className="pt-1 border-t space-y-2">
      <Checkbox
        checked={mod.useInfluence === true}
        label="Use Influence"
        onChange={(v) => onSetFlag('useInfluence', v)}
      />
      {mod.useInfluence === true && (
        <FieldRow label="Influence">
          <NumberInput
            value={Number.isFinite(mod.influence) ? mod.influence : 1}
            step={0.01}
            onCommit={(v) => onEditNumber('influence', Math.max(0, Math.min(1, v)))}
          />
        </FieldRow>
      )}
      <Checkbox
        checked={mod.useRestrictedRange === true}
        label="Restrict Range"
        onChange={(v) => onSetFlag('useRestrictedRange', v)}
      />
      {mod.useRestrictedRange === true && (
        <>
          <FieldRow label="Start (ms)">
            <NumberInput
              value={Number.isFinite(mod.sfra) ? mod.sfra : 0}
              step={10}
              onCommit={(v) => onEditNumber('sfra', v)}
            />
          </FieldRow>
          <FieldRow label="End (ms)">
            <NumberInput
              value={Number.isFinite(mod.efra) ? mod.efra : 1000}
              step={10}
              onCommit={(v) => onEditNumber('efra', v)}
            />
          </FieldRow>
          <FieldRow label="Blend In">
            <NumberInput
              value={Number.isFinite(mod.blendin) ? mod.blendin : 0}
              step={10}
              onCommit={(v) => onEditNumber('blendin', Math.max(0, v))}
            />
          </FieldRow>
          <FieldRow label="Blend Out">
            <NumberInput
              value={Number.isFinite(mod.blendout) ? mod.blendout : 0}
              step={10}
              onCommit={(v) => onEditNumber('blendout', Math.max(0, v))}
            />
          </FieldRow>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives (mirrors ActiveKeyformPanel.jsx conventions)
// ---------------------------------------------------------------------------

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

function Hint({ children }) {
  return (
    <div className="text-[10px] text-muted-foreground italic leading-snug">
      {children}
    </div>
  );
}

function SelectInput({ value, options, onChange, disabled = false }) {
  return (
    <select
      value={value}
      disabled={disabled === true}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-6 px-1 text-[11px] bg-background border rounded focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
}

function Checkbox({ checked, label = null, onChange }) {
  return (
    <label className="flex items-center gap-1 text-[11px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span className="text-muted-foreground">{label}</span>}
    </label>
  );
}

// Number input mirrors ActiveKeyformPanel.jsx's NumberInput shape:
// commit-on-blur + commit-on-Enter + cancel-on-Escape, with a draft
// string that resets only when the input is unfocused.
function NumberInput({ value, onCommit, step, disabled = false }) {
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focusedRef = useRef(false);

  if (!focusedRef.current) {
    const expected = formatNumber(value);
    if (draft !== expected) setDraft(expected);
  }

  const commit = useCallback(() => {
    // Audit-fix 2026-05-18 arch MED-3: guard on draft non-empty AND
    // parsed finite. Matches ActiveKeyformPanel convention so the
    // empty-string display (for missing values) doesn't accidentally
    // commit a phantom value on blur.
    if (draft === '') return;
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
  }, [draft, onCommit]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      disabled={disabled === true}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(formatNumber(value));
          e.currentTarget.blur();
        }
      }}
      className="w-full h-6 px-1.5 text-[11px] tabular-nums bg-background border rounded focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    />
  );
}

function formatNumber(value) {
  // Audit-fix 2026-05-18 arch MED-3: return '' for non-finite (matches
  // ActiveKeyformPanel convention; pre-fix returned '0' which could
  // commit a phantom 0 on blur without focus).
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  // Integer-like numbers display without a decimal; otherwise up to 4
  // significant digits past the decimal (matches ActiveKeyformPanel
  // convention).
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(4);
  return parseFloat(fixed).toString();
}
