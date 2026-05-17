// @ts-check

/**
 * Animation Phase 5 Slice 5.W audit-fix — Shared "active fcurve" picker.
 *
 * Extracted from FCurveEditor.jsx's local `pickFCurve` helper so the
 * DopesheetEditor (Slice 5.W) can gate its active-keyform halo on the
 * same fcurve the FCurveEditor considers active. Until SS ships a
 * per-fcurve ACTIVE bit (queued Phase 5 path #11), `selection`-driven
 * picking is SS's stand-in for Blender's `FCURVE_ACTIVE` flag.
 *
 * The picker walks `selection` from newest to oldest and returns the
 * first FCurve targeting the most-recent selected item (parameter →
 * `paramId` match; part/group → `nodeId` match via `decodeFCurveTarget`).
 *
 * Once path #11 lands, both editors switch to reading the persisted
 * `fcurve.active === true` flag and this picker can retire.
 *
 * @module anim/fcurvePicker
 */

import { decodeFCurveTarget, fcurveTargetsParam } from './animationFCurve.js';

/**
 * @typedef {object} SelectionItem
 * @property {'parameter'|'part'|'group'|string} type
 * @property {string} id
 */

/**
 * Walk `selection` newest → oldest, returning the first FCurve in
 * `action.fcurves` that targets the selected item. Returns null when
 * `action` is empty or no fcurve matches any selection entry.
 *
 * @param {object|null|undefined} action
 * @param {ReadonlyArray<SelectionItem>|null|undefined} selection
 * @returns {object|null}
 */
export function pickActiveFCurve(action, selection) {
  if (!action || !Array.isArray(action.fcurves)) return null;
  if (!Array.isArray(selection) || selection.length === 0) return null;
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i];
    if (!sel || typeof sel.id !== 'string') continue;
    if (sel.type === 'parameter') {
      const fc = action.fcurves.find((f) => fcurveTargetsParam(f, sel.id));
      if (fc) return fc;
    } else if (sel.type === 'part' || sel.type === 'group') {
      const fc = action.fcurves.find((f) => {
        const t = decodeFCurveTarget(f);
        return t?.kind === 'node' && t.nodeId === sel.id;
      });
      if (fc) return fc;
    }
  }
  return null;
}
