// @ts-check

/**
 * Single source of truth for writing a selection that should propagate
 * to BOTH the universal `useSelectionStore` (typed `{type, id}` items)
 * AND the legacy `useEditorStore.selection` (node-id `string[]` slot).
 *
 * # Why this exists
 *
 * SS carries TWO selection stores in parallel:
 *
 *   - `useSelectionStore.items` — universal `SelectableRef[]` with
 *     `type` info (`'part' | 'group' | 'parameter' | …`). Outliner +
 *     Properties panes + the operator registry read this.
 *   - `useEditorStore.selection` — legacy `string[]` of node ids.
 *     Gizmo overlay, modal G/R/S transform, Properties tab focus, and
 *     most canvas-side consumers read this.
 *
 * Most consumers only read ONE of the two. When a writer updates only
 * one, the stores drift — clicking a bone in the Outliner used to
 * leave `editorStore.selection` pointing at the PREVIOUS selection,
 * so the gizmo stayed on the old node and pressing R rotated a
 * different bone than the one the user thought was selected. User
 * report (2026-06-10): "I press R on a bone it doesn't rotate the
 * skeleton at all" — diagnostic confirmed selectionStore had rightArm
 * while editorStore had root.
 *
 * Every selection write that targets a node (`'part' | 'group'`)
 * MUST go through this helper. Non-node selections (parameters,
 * deformers, keyframes, etc.) only live in `selectionStore`; they
 * have no peer slot on `editorStore`, so writing them there would
 * be semantically wrong.
 *
 * # Modifier semantics
 *
 * Mirror what `selectionStore.select` already does, applied to the
 * id-only legacy slot:
 *
 *   - `'replace'`  → `editor.setSelection([id, ...])`
 *   - `'add'`      → append unique ids
 *   - `'toggle'`   → flip presence per id
 *   - `'extend'`   → range, caller resolves to an id array
 *
 * @module lib/selectionSync
 */

import { useSelectionStore } from '../store/selectionStore.js';
import { useEditorStore } from '../store/editorStore.js';

/**
 * Selectable types that have a peer slot on `editorStore.selection`.
 * Anything outside this set lives only in `selectionStore`.
 */
const EDITOR_STORE_MIRRORED_TYPES = new Set(['part', 'group']);

/**
 * Write a selection that propagates to both stores.
 *
 * @param {import('../store/selectionStore.js').SelectableRef | import('../store/selectionStore.js').SelectableRef[]} target
 * @param {'replace'|'add'|'toggle'|'extend'} [modifier='replace']
 */
export function selectAndMirror(target, modifier = 'replace') {
  const targets = Array.isArray(target) ? target : [target];
  // Universal selection always updates first — this is the
  // source-of-truth write; the editorStore mirror is the projection.
  useSelectionStore.getState().select(targets, modifier);

  // Only mirror node-type writes. Parameter / deformer / keyframe
  // selections have no `editorStore.selection` peer.
  const mirroredIds = targets
    .filter((t) => t && EDITOR_STORE_MIRRORED_TYPES.has(t.type))
    .map((t) => t.id);
  if (mirroredIds.length === 0 && modifier !== 'replace') return;

  const ed = useEditorStore.getState();
  const prev = Array.isArray(ed.selection) ? ed.selection : [];

  if (modifier === 'replace' || modifier === 'extend') {
    ed.setSelection(mirroredIds);
    return;
  }
  if (modifier === 'add') {
    const next = [...prev];
    for (const id of mirroredIds) if (!next.includes(id)) next.push(id);
    ed.setSelection(next);
    return;
  }
  // toggle
  const next = [...prev];
  for (const id of mirroredIds) {
    const idx = next.indexOf(id);
    if (idx >= 0) next.splice(idx, 1);
    else next.push(id);
  }
  ed.setSelection(next);
}

/**
 * Clear both stores.
 */
export function clearSelectionEverywhere() {
  useSelectionStore.getState().clear();
  useEditorStore.getState().setSelection([]);
}
