// @ts-check

/**
 * V4 Phase 2 — ParameterTab (editable).
 *
 * Inspector for the parameter selected via the ParametersEditor (or
 * any other surface that dispatches `{type: 'parameter', id}`). Now
 * editable: the user can rename, change range/default/decimalPlaces,
 * add and remove breakpoint keys, and toggle the lock that preserves
 * the param across Init Rig 'merge'.
 *
 * Back-references (deformer bindings + animation tracks + physics
 * inputs) are read live via `findReferences` so the user can see
 * what depends on this param before deleting or renaming. The Delete
 * confirmation surfaces the same count.
 *
 * Edits flow through projectStore CRUD actions:
 *   - patchParameter (rename name field, range, default, decimalPlaces, role)
 *   - renameParameter (id rename — cascades through bindings + tracks + inputs)
 *   - addParamKey / removeParamKey (breakpoint edits — Init Rig regen owns
 *     the per-deformer keyform expansion until Track 3 ships)
 *   - setParameterUserAuthored (lock toggle)
 *
 * @module v3/editors/properties/tabs/ParameterTab
 */

import { useState, useMemo } from 'react';
import { Sliders, Lock, Unlock, Plus, Trash2, Check, X } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useParamValuesStore } from '../../../../store/paramValuesStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { findReferences } from '../../../../io/live2d/rig/paramReferences.js';
import { NumberField } from '../fields/NumberField.jsx';
import { TextField } from '../fields/TextField.jsx';

/**
 * @param {Object} props
 * @param {string} props.parameterId
 */
export function ParameterTab({ parameterId }) {
  const param = useProjectStore((s) =>
    (s.project.parameters ?? []).find((p) => p?.id === parameterId) ?? null,
  );
  const project = useProjectStore((s) => s.project);
  const liveValue = useParamValuesStore((s) =>
    s.values[parameterId] ?? param?.default ?? 0,
  );

  const renameParameter         = useProjectStore((s) => s.renameParameter);
  const patchParameter          = useProjectStore((s) => s.patchParameter);
  const addParamKey             = useProjectStore((s) => s.addParamKey);
  const removeParamKey          = useProjectStore((s) => s.removeParamKey);
  const removeParameter         = useProjectStore((s) => s.removeParameter);
  const setParameterUserAuthored = useProjectStore((s) => s.setParameterUserAuthored);
  const clearSelection          = useSelectionStore((s) => s.clear);

  const refs = useMemo(
    () => (param ? findReferences(project, parameterId) : null),
    [param, project, parameterId],
  );

  const [newKeyDraft, setNewKeyDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);

  if (!param) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Parameter not in project — was it removed by Initialize Rig?
      </div>
    );
  }

  const locked = param._userAuthored === true;
  const userKeys = Array.isArray(param._userAuthoredKeys) ? param._userAuthoredKeys : [];
  const userKeySet = new Set(userKeys.map((v) => Math.round(v * 1e6) / 1e6));

  function commitNewKey() {
    const trimmed = newKeyDraft.trim();
    if (trimmed.length === 0) return;
    const v = Number(trimmed);
    if (!Number.isFinite(v)) return;
    addParamKey(parameterId, v);
    setNewKeyDraft('');
  }

  function handleIdRename(nextId) {
    const trimmed = (nextId ?? '').trim();
    if (trimmed.length === 0 || trimmed === param.id) return;
    renameParameter(param.id, trimmed);
  }

  function handleDelete() {
    if (!pendingDelete) {
      setPendingDelete(true);
      return;
    }
    setPendingDelete(false);
    removeParameter(parameterId);
    clearSelection();
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Parameter" icon={<Sliders size={11} />}>
        <Row label="ID">
          <TextField
            label=""
            value={param.id}
            onCommit={(v) => handleIdRename(v)}
          />
        </Row>
        <Row label="Name">
          <TextField
            label=""
            value={param.name ?? param.id}
            onCommit={(v) => patchParameter(parameterId, { name: v })}
          />
        </Row>
        <Row label="Role">
          <span className="text-xs text-foreground font-mono">{param.role ?? 'custom'}</span>
        </Row>
      </Section>

      <Section label="Range">
        <Row label="Min">
          <NumberField
            label=""
            value={typeof param.min === 'number' ? param.min : 0}
            step={0.5}
            precision={2}
            onCommit={(v) => patchParameter(parameterId, { min: v })}
          />
        </Row>
        <Row label="Max">
          <NumberField
            label=""
            value={typeof param.max === 'number' ? param.max : 1}
            step={0.5}
            precision={2}
            onCommit={(v) => patchParameter(parameterId, { max: v })}
          />
        </Row>
        <Row label="Default">
          <NumberField
            label=""
            value={typeof param.default === 'number' ? param.default : 0}
            step={0.5}
            precision={2}
            onCommit={(v) => patchParameter(parameterId, { default: v })}
          />
        </Row>
        <Row label="Decimals">
          <NumberField
            label=""
            value={typeof param.decimalPlaces === 'number' ? param.decimalPlaces : 2}
            step={1}
            precision={0}
            min={0}
            max={6}
            onCommit={(v) => patchParameter(parameterId, { decimalPlaces: Math.round(v) })}
          />
        </Row>
        <Row label="Live">
          <span className="text-xs text-primary tabular-nums font-mono font-semibold">
            {Number(liveValue).toFixed(param.decimalPlaces ?? 2)}
          </span>
        </Row>
      </Section>

      <Section label={`Keys (${(param.keys ?? []).length})`}>
        <div className="text-[10px] text-muted-foreground mb-1">
          Breakpoint values where keyforms are authored. New keys take
          effect on the next Init Rig (the per-deformer keyform
          expansion is owned by the Keyform Editor — coming in Phase 3).
        </div>
        <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
          {(param.keys ?? []).map((k, i) => {
            const epsKey = Math.round(k * 1e6) / 1e6;
            const isUserKey = userKeySet.has(epsKey);
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-2 text-[11px] font-mono px-1 py-0.5 rounded hover:bg-muted/30"
              >
                <span className={isUserKey ? 'text-foreground' : 'text-muted-foreground'}>
                  {k}
                  {isUserKey ? (
                    <span className="ml-1.5 text-[9px] text-amber-400 uppercase tracking-wide">
                      user
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => removeParamKey(parameterId, k)}
                  className="text-muted-foreground hover:text-destructive p-0.5"
                  title={`Remove key ${k}`}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
          {(param.keys ?? []).length === 0 ? (
            <div className="text-[10px] text-muted-foreground italic">No keys.</div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="add key…"
            value={newKeyDraft}
            onChange={(e) => setNewKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewKey();
              if (e.key === 'Escape') setNewKeyDraft('');
            }}
            className="h-6 flex-1 min-w-0 px-2 text-[11px] rounded border border-border bg-card/30 text-foreground tabular-nums font-mono focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={commitNewKey}
            disabled={newKeyDraft.trim().length === 0}
            className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 disabled:opacity-40 flex items-center gap-1 text-[11px] text-foreground"
          >
            <Plus size={11} />
          </button>
        </div>
      </Section>

      {refs && refs.total > 0 ? (
        <Section label={`Used in (${refs.total})`}>
          {refs.bindings.length > 0 ? (
            <RefList title="Deformer bindings" refs={refs.bindings} />
          ) : null}
          {refs.actionFCurves.length > 0 ? (
            <RefList title="Action FCurves" refs={refs.actionFCurves} />
          ) : null}
          {refs.physicsInputs.length > 0 ? (
            <RefList title="Physics inputs" refs={refs.physicsInputs} />
          ) : null}
        </Section>
      ) : null}

      {param.boneId || param.variantSuffix || param.groupId ? (
        <Section label="Linked">
          {param.boneId ? (
            <Row label="Bone">
              <code className="text-xs text-foreground truncate">{param.boneId}</code>
            </Row>
          ) : null}
          {param.variantSuffix ? (
            <Row label="Variant">
              <code className="text-xs text-foreground truncate">{param.variantSuffix}</code>
            </Row>
          ) : null}
          {param.groupId ? (
            <Row label="Group">
              <code className="text-xs text-foreground truncate">{param.groupId}</code>
            </Row>
          ) : null}
        </Section>
      ) : null}

      <Section label="Per-rig refit" icon={locked ? <Lock size={11} /> : <Unlock size={11} />}>
        <button
          onClick={() => setParameterUserAuthored(parameterId, !locked)}
          className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${
            locked
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
              : 'bg-card/30 border-border text-foreground hover:bg-card/50'
          }`}
          title={locked
            ? 'Currently locked from refit. Init Rig "merge" will preserve this parameter\'s name / range / default / keys verbatim. Click to unlock.'
            : 'Currently regenerated by Init Rig. Lock to preserve hand-edited fields across re-rigs. Click to lock.'}
        >
          <span className="text-[11px]">
            {locked ? 'Locked from refit' : 'Auto-regenerate by refit'}
          </span>
          <span className="text-[10px] uppercase tracking-wide opacity-70">
            {locked ? 'click to unlock' : 'click to lock'}
          </span>
        </button>
      </Section>

      <Section label="Delete">
        {pendingDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDelete}
              className="flex-1 h-7 px-2 rounded bg-destructive/80 hover:bg-destructive text-destructive-foreground text-[11px] flex items-center justify-center gap-1.5"
            >
              <Check size={11} />
              <span>
                Confirm delete
                {refs && refs.total > 0 ? ` (drops ${refs.total} ref${refs.total === 1 ? '' : 's'})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(false)}
              className="h-7 px-2 rounded border border-border bg-muted/30 hover:bg-muted/50 text-[11px]"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleDelete}
            className="h-7 px-2 rounded border border-destructive/40 bg-destructive/10 hover:bg-destructive/20 text-destructive text-[11px] flex items-center justify-center gap-1.5"
            title="Delete this parameter and drop every reference to it (deformer bindings, animation tracks, physics inputs)."
          >
            <Trash2 size={11} />
            <span>Delete parameter</span>
          </button>
        )}
      </Section>
    </div>
  );
}

function RefList({ title, refs }) {
  return (
    <div className="flex flex-col gap-0.5 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {title} ({refs.length})
      </div>
      <div className="flex flex-col gap-0.5 max-h-24 overflow-auto">
        {refs.map((r, i) => (
          <code
            key={i}
            className="text-[10px] text-muted-foreground/80 truncate font-mono px-1"
            title={r.location}
          >
            {r.location}
          </code>
        ))}
      </div>
    </div>
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
    <div className="flex items-center gap-2 text-xs h-7">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}
