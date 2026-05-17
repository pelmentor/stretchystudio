// @ts-check

/**
 * Animation Phase 5 Slice 5.W — Dopesheet row builder.
 *
 * Pure data layer for `DopesheetEditor.jsx`. Walks an Action's
 * `fcurves`, decodes each target, applies the visibility filter, and
 * returns the renderable row list enriched with per-row state flags
 * (`isMuted`, `activeKfIdx`).
 *
 * Sister to Blender's `ED_add_fcurve_channel`
 * (`reference/blender/source/blender/editors/animation/keyframes_draw.cc:754-774`),
 * which computes per-channel render hints (`channel_locked`) at list-
 * build time so the subsequent draw walks don't need to re-derive them
 * per keyframe. SS adopts the same separation: this module produces a
 * `DopesheetRow[]` whose fields are everything the renderer needs.
 *
 * # Row state flags
 *
 * ## `isMuted`
 *
 * `isFCurveEffectivelyMuted(fc, action)` — covers per-fcurve mute
 * (Slice 5.G's `fcurve.mute`) AND the Slice 5.V FCurveGroup cascade
 * (`group.mute` propagates to child fcurves). Mirrors Blender's two
 * eval-gate conditions in `is_fcurve_evaluatable`
 * (`reference/blender/source/blender/blenkernel/intern/anim_sys.cc:347-352`):
 *
 *   ```c
 *   if (fcu->flag & (FCURVE_MUTED | FCURVE_DISABLED)) return false;
 *   if (fcu->grp && (fcu->grp->flag & AGRP_MUTED)) return false;
 *   ```
 *
 * SS omits `FCURVE_DISABLED` per Slice 5.G's documented deviation
 * (decoded targets that fail to resolve are filtered at decode time;
 * no SS equivalent flag exists today).
 *
 * For row styling, `isMuted=true` triggers the FCurveEditor sister
 * pattern: label gets `italic opacity-60` (matches sidebar at
 * [src/v3/editors/fcurve/FCurveEditor.jsx:3172](../../editors/fcurve/FCurveEditor.jsx#L3172))
 * and diamonds get reduced opacity (~0.4, sister to canvas
 * `globalAlpha = isMuted ? baseAlpha * 0.4 : baseAlpha` at
 * [FCurveEditor.jsx:3328](../../editors/fcurve/FCurveEditor.jsx#L3328)).
 *
 * Blender's mute hint on the GRAPH plot is `TH_HEADER` shade+50 stroke
 * (`graph_draw.cc:1190-1194`) — a colourless grey replacement. The
 * dopesheet doesn't render a curve stroke (it draws keyframe pips), so
 * SS's alpha-drop is the structural analogue: same visual signal
 * ("this curve is muted; its data still exists but is silenced"),
 * rendered in the medium the editor actually uses.
 *
 * ## `activeKfIdx`
 *
 * `getActiveKeyformIndex(fc)` — Slice 5.H's port of
 * `BKE_fcurve_active_keyframe_index`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:815-831`).
 * Returns `FCURVE_ACTIVE_KEYFORM_NONE` (-1) when the field is missing,
 * out of bounds, or `fcurve.keyforms` is absent.
 *
 * Renderer uses this to paint a halo ring around the specific keyform
 * diamond — sister to FCurveEditor's pale-yellow active-vertex halo at
 * [FCurveEditor.jsx:3343-3365](../../editors/fcurve/FCurveEditor.jsx#L3343)
 * which mirrors `draw_fcurve_active_vertex`
 * (`graph_draw.cc:241-262`) with `TH_VERTEX_ACTIVE` (bright theme
 * colour, drawn AFTER the regular vertex pass).
 *
 * Note: the halo highlights the keyform PIN, not the whole row. Per
 * Blender, an "active" channel (`FCURVE_ACTIVE`) is a separate concept
 * from an "active keyform" (`active_keyframe_index`); the former is
 * Phase 5 queued path #11, not in this slice's scope.
 *
 * # Filtering — hidden curves
 *
 * Effective-hidden rows are EXCLUDED from the returned list. Mirrors
 * Blender's `ANIMFILTER_CURVE_VISIBLE`
 * (`reference/blender/source/blender/editors/animation/anim_filter.cc:1287-1288`)
 * applied at the channel-build site: hidden curves don't make it into
 * the keyframe draw walk.
 *
 * Per Slice 5.V cascade, the filter covers both per-fcurve `hide` AND
 * the group-level cascade (`group.hide` hides every child fcurve).
 *
 * # Why filter rather than dim-then-render
 *
 * The DopesheetEditor surface is a density visualiser; it's the only
 * place these rows render (no separate sidebar with controls). The
 * Graph Editor's sidebar keeps hidden rows so the user can un-hide
 * them — SS's FCurveEditor sidebar matches that. The Dopesheet has
 * no such control affordance, so a hidden row staying on-screen would
 * just be visual noise the user can't act on. Filtering it out matches
 * the principle "don't show what the user can't interact with."
 *
 * To un-hide, the user opens FCurveEditor and clicks the eye glyph
 * there — same UX as Blender (the sidebar is the un-hide affordance,
 * regardless of which editor surface revealed the curve in the first
 * place).
 *
 * # Schema & migration
 *
 * No schema change. All consumed fields (`fcurve.mute`, `fcurve.hide`,
 * `fcurve.activeKeyformIndex`, `fcurve.groupId`, `action.groups`) are
 * already in v40.
 *
 * @module v3/editors/dopesheet/dopesheetRows
 */

import { decodeFCurveTarget } from '../../../anim/animationFCurve.js';
import {
  isFCurveEffectivelyMuted,
  isFCurveEffectivelyHidden,
} from '../../../anim/fcurveGroups.js';
import { getActiveKeyformIndex, FCURVE_ACTIVE_KEYFORM_NONE } from '../../../anim/fcurveActiveKeyform.js';

/**
 * @typedef {object} DopesheetRowKeyform
 * @property {number} time
 * @property {number|number[]|string|boolean|null|undefined} value
 */

/**
 * @typedef {object} DopesheetRow
 * @property {string} key                       Stable React key (see {@link buildDopesheetRows}).
 * @property {string} label                     Display label (param name OR `Node · property`).
 * @property {string} tooltip                   Hover tooltip.
 * @property {string} kindColor                 Tailwind class for the dot swatch (param vs node).
 * @property {DopesheetRowKeyform[]} keyforms   Time-sorted keyform list (renderer paints pips).
 * @property {boolean} isMuted                  Effective mute (per-fcurve OR group cascade).
 * @property {number} activeKfIdx               Active-keyform index (-1 when none).
 */

/**
 * Build the renderable row list for a Dopesheet view of an Action.
 *
 * Walks `action.fcurves`, decodes each, skips effectively-hidden ones
 * (per-fcurve hide OR group cascade), and produces the `DopesheetRow[]`
 * sorted: param rows alphabetical, then node rows alphabetical (by
 * `Node · property` label). Matches the existing DopesheetEditor
 * ordering convention so this slice introduces no visual sort change.
 *
 * Stable React keys:
 *   - param rows: `param:${paramId}`
 *   - node rows : `node:${nodeId}:${property}`
 *
 * The key intentionally doesn't include the fcurve id — multiple
 * fcurves targeting the same `(nodeId, property)` is an upstream data
 * bug; the dopesheet doesn't make sense as a "show all duplicates"
 * surface anyway. If/when that situation becomes legitimate (e.g.
 * NLA layers with overlapping channels in Phase 4), the key will
 * need to include the fcurve id.
 *
 * @param {object|null|undefined} action  Action datablock (must carry `fcurves[]`).
 * @param {object|null|undefined} project Project (read for `nodes` + `parameters` name lookups).
 * @returns {DopesheetRow[]}
 */
export function buildDopesheetRows(action, project) {
  if (!action || !Array.isArray(action.fcurves)) return [];
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const params = Array.isArray(project?.parameters) ? project.parameters : [];
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name ?? n.id]));
  const paramNameById = new Map(params.map((p) => [p.id, p.name ?? p.id]));

  /** @type {DopesheetRow[]} */
  const paramRows = [];
  /** @type {DopesheetRow[]} */
  const nodeRows = [];

  for (const fc of action.fcurves) {
    if (!fc) continue;
    // Hide filter — mirrors `ANIMFILTER_CURVE_VISIBLE` (`anim_filter.cc:1287-1288`)
    // applied at channel-list build time. Slice 5.V cascade covers per-fcurve
    // `hide` AND `group.hide`.
    if (isFCurveEffectivelyHidden(fc, action)) continue;

    const target = decodeFCurveTarget(fc);
    if (!target) continue;

    const keyforms = Array.isArray(fc.keyforms) ? fc.keyforms : [];
    // Keep the original mapping shape — the renderer reads `time` and
    // `value` directly. Sorted by time to keep tick order stable
    // regardless of upstream insertion order.
    const kfs = keyforms
      .map((kf) => ({ time: kf?.time ?? 0, value: kf?.value }))
      .sort((a, b) => a.time - b.time);

    const isMuted = isFCurveEffectivelyMuted(fc, action);
    const activeKfIdx = getActiveKeyformIndex(fc);

    if (target.kind === 'param') {
      paramRows.push({
        key: `param:${target.paramId}`,
        label: paramNameById.get(target.paramId) ?? target.paramId,
        tooltip: `Parameter ${target.paramId}`,
        kindColor: 'bg-purple-500',
        keyforms: kfs,
        isMuted,
        activeKfIdx,
      });
    } else if (target.kind === 'node') {
      nodeRows.push({
        key: `node:${target.nodeId}:${target.property}`,
        label: `${nodeNameById.get(target.nodeId) ?? target.nodeId} · ${target.property}`,
        tooltip: `Node ${target.nodeId} · ${target.property}`,
        kindColor: 'bg-cyan-500',
        keyforms: kfs,
        isMuted,
        activeKfIdx,
      });
    }
  }

  paramRows.sort((a, b) => a.label.localeCompare(b.label));
  nodeRows.sort((a, b) => a.label.localeCompare(b.label));
  return [...paramRows, ...nodeRows];
}

export { FCURVE_ACTIVE_KEYFORM_NONE };
