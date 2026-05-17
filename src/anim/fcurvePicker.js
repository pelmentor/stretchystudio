// @ts-check

/**
 * Animation Phase 5 Slice 5.W audit-fix — Shared "active fcurve" picker.
 *
 * Extracted from FCurveEditor.jsx's local `pickFCurve` helper so the
 * DopesheetEditor (Slice 5.W) can gate its active-keyform halo on the
 * same fcurve the FCurveEditor considers active. Pre-Slice 5.X this
 * picker was SS's primary stand-in for Blender's `FCURVE_ACTIVE` flag.
 *
 * The picker walks `selection` from newest to oldest and returns the
 * first FCurve targeting the most-recent selected item (parameter →
 * `paramId` match; part/group → `nodeId` match via `decodeFCurveTarget`).
 *
 * # Status post-Slice 5.X — DEMOTED to bootstrap fallback
 *
 * Slice 5.X (2026-05-17) ported Blender's persisted `FCURVE_ACTIVE` bit
 * as `fcurve.active` (see [./fcurveActive.js](./fcurveActive.js)). Both
 * FCurveEditor and DopesheetEditor now consult `getActiveFCurve(action)`
 * FIRST and fall back to this picker only when no fcurve in the action
 * carries `active === true` — the bootstrap path for legacy saves that
 * predate 5.X. After the user's first click in either editor,
 * `setActiveFCurve` writes the persisted bit and the fallback retires
 * for that action.
 *
 * The picker is NOT a retirement candidate; it carries the load on
 * legacy data + on the moment between action-load and first-click. The
 * audit-fix LOW-2 finding (Slice 5.X arch audit 2026-05-17) corrected
 * the substrate's earlier "this picker can retire" framing to "demoted
 * to bootstrap fallback" — sister to Rule №2's principled-fallback
 * stance (no transitional shim; the fallback is intrinsic to the
 * no-migration policy on the `fc.active` field).
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
