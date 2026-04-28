// @ts-check

/**
 * v3 Phase 0A - Universal selection model.
 *
 * Plan §5: every selectable thing in the app is identified by a
 * `{type, id}` tuple. The current v2 `editorStore.selection: string[]`
 * only addresses parts; v3 needs to select parameters, deformers,
 * keyframes, physics rules, mask configs, etc. - same shape, same API.
 *
 * Selection ordering matters: the LAST entry is the "active" one
 * (Blender convention - gizmos / properties panel pivot off the
 * active item, multi-edit mutations target every selected item).
 *
 * Modifier semantics for `select(item, modifier)`:
 *
 *   - 'replace' → drop everything, select only this
 *   - 'add'     → append to selection (no-op if already last/active)
 *   - 'toggle'  → flip presence; if becoming present, becomes active
 *   - 'extend'  → range-select (caller resolves the range against
 *                  outliner ordering and passes the resulting array)
 *
 * Stores stay storage-only - operator system is what binds keymap
 * (shift/ctrl/click) to these modifiers (Phase 0A operatorStore).
 *
 * @module store/selectionStore
 */

import { create } from 'zustand';

/**
 * @typedef {('part'|'group'|'parameter'|'deformer'|'keyframe'|'physicsRule'|'maskConfig'|'variant')} SelectableType
 *
 * @typedef {Object} SelectableRef
 * @property {SelectableType} type
 * @property {string} id
 */

/** @param {SelectableRef} a @param {SelectableRef} b */
const sameRef = (a, b) => a.type === b.type && a.id === b.id;

export const useSelectionStore = create((set, get) => ({
  /** @type {SelectableRef[]} - last entry is "active" */
  items: [],

  /** Active = last selected. Returns null when empty. */
  getActive: () => {
    const { items } = get();
    return items.length === 0 ? null : items[items.length - 1];
  },

  /** True if this exact ref is currently in the selection. */
  isSelected: (ref) => get().items.some((it) => sameRef(it, ref)),

  /**
   * Apply a selection action.
   * @param {SelectableRef|SelectableRef[]} target
   * @param {'replace'|'add'|'toggle'|'extend'} [modifier='replace']
   */
  select: (target, modifier = 'replace') =>
    set((state) => {
      const targets = Array.isArray(target) ? target : [target];
      if (targets.length === 0 && modifier !== 'replace') return state;

      if (modifier === 'replace' || modifier === 'extend') {
        return { items: [...targets] };
      }
      if (modifier === 'add') {
        const next = state.items.filter((it) =>
          !targets.some((t) => sameRef(it, t)),
        );
        return { items: [...next, ...targets] };
      }
      // toggle
      let next = [...state.items];
      for (const t of targets) {
        const idx = next.findIndex((it) => sameRef(it, t));
        if (idx >= 0) next.splice(idx, 1);
        else next.push(t);
      }
      return { items: next };
    }),

  /** Clear all selection. */
  clear: () => set({ items: [] }),
}));
