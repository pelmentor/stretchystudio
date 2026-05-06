// @ts-check

/**
 * V4 Phase 1 — Deformer Bindings section.
 * V4 Phase 2 — bind / unbind UI added.
 *
 * Lifted out of `DeformerTab`'s inline BindingsSection. Phase 2 makes
 * it editable: a `+ bind` dropdown adds a new binding (defaults its
 * keys to the param's current `keys` list), and each row gets a
 * delete button. Stamps `_userAuthored: true` on the deformer node
 * so Init Rig 'merge' preserves the change.
 *
 * Live keyform expansion / collapse on bind / unbind is owned by the
 * Track 3 keyform editor — bind here just adds the binding entry; the
 * deformer's existing keyforms stay until the next Init Rig regen.
 *
 * @module v3/editors/properties/sections/DeformerBindingsSection
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import * as SelectImpl from '../../../../components/ui/select.jsx';
import { SectionShell } from './SectionShell.jsx';

/** @type {Record<string, React.ComponentType<any>>} */
const Sel = /** @type {any} */ (SelectImpl);
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = Sel;

/** Module-scope empty array — referentially stable for the
 *  `paramsRaw ?? EMPTY_ARRAY` fallback (a fresh `[]` would loop). */
const EMPTY_ARRAY = Object.freeze([]);

/**
 * @param {Object} props
 * @param {string} props.deformerId
 */
export function DeformerBindingsSection({ deformerId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  // Subscribe to the stable `parameters` ref (immer-managed). Don't
  // do `?? []` inline — when parameters is undefined the fallback
  // would return a new empty array every getSnapshot call, tripping
  // useSyncExternalStore's "result of getSnapshot should be cached"
  // guard and forcing an infinite re-render.
  const paramsRaw = useProjectStore((s) => s.project.parameters);
  const params = paramsRaw ?? EMPTY_ARRAY;
  const updateProject = useProjectStore((s) => s.updateProject);

  const [adding, setAdding] = useState(false);

  const node = useMemo(
    () => (nodes ?? []).find((n) => n?.id === deformerId && n?.type === 'deformer') ?? null,
    [nodes, deformerId],
  );

  const bindings = Array.isArray(node?.bindings) ? node.bindings : [];
  const boundIds = new Set(bindings.map((b) => b?.parameterId).filter(Boolean));
  const bindable = (params ?? []).filter((p) => p?.id && !boundIds.has(p.id));

  function addBinding(paramId) {
    const param = (params ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    const keys = Array.isArray(param.keys) ? param.keys.slice() : [];
    updateProject((proj) => {
      const def = proj.nodes.find((n) => n?.id === deformerId && n?.type === 'deformer');
      if (!def) return;
      def.bindings = Array.isArray(def.bindings) ? def.bindings : [];
      if (def.bindings.some((b) => b?.parameterId === paramId)) return;
      def.bindings.push({ parameterId: paramId, keys });
      def._userAuthored = true;
    });
    setAdding(false);
  }

  function removeBinding(paramId) {
    updateProject((proj) => {
      const def = proj.nodes.find((n) => n?.id === deformerId && n?.type === 'deformer');
      if (!def || !Array.isArray(def.bindings)) return;
      def.bindings = def.bindings.filter((b) => b?.parameterId !== paramId);
      def._userAuthored = true;
    });
  }

  return (
    <SectionShell
      id="deformerBindings"
      label={bindings.length > 0 ? `Bindings (${bindings.length})` : 'Bindings'}
    >
      {bindings.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No parameter bindings.</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {bindings.map((b, i) => (
            <div
              key={`${b?.parameterId ?? '_'}-${i}`}
              className="flex items-center justify-between gap-2 text-[11px] font-mono group px-1 py-0.5 rounded hover:bg-muted/30"
            >
              <span className="text-foreground truncate" title={b?.parameterId}>
                {b?.parameterId ?? '<no param>'}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-muted-foreground">
                  [{(b?.keys ?? []).join(', ')}]
                </span>
                <button
                  type="button"
                  onClick={() => removeBinding(b?.parameterId)}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`Unbind ${b?.parameterId} (keyforms stay until next Init Rig)`}
                >
                  <Trash2 size={10} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-1 flex items-center gap-1">
          <Select
            value=""
            onValueChange={(v) => addBinding(v)}
            disabled={bindable.length === 0}
          >
            <SelectTrigger className="h-6 text-xs px-2 py-0 flex-1">
              <SelectValue placeholder={bindable.length === 0 ? 'all params bound' : 'pick a parameter…'} />
            </SelectTrigger>
            <SelectContent>
              {bindable.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs font-mono">
                  {p.name && p.name !== p.id ? `${p.name} (${p.id})` : p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-6 px-2 rounded border border-border bg-muted/30 hover:bg-muted/50 text-[11px]"
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={bindable.length === 0}
          className="mt-1 h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 disabled:opacity-40 text-[11px] flex items-center gap-1 self-start text-foreground"
          title="Add a parameter binding. Keyforms regenerate on the next Init Rig."
        >
          <Plus size={11} />
          <span>bind parameter</span>
        </button>
      )}
    </SectionShell>
  );
}
