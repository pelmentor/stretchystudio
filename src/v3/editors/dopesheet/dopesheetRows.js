// @ts-check

/**
 * Animation Phase 5 Slice 5.W — Dopesheet row builder.
 *
 * Pure data layer for `DopesheetEditor.jsx`. Walks an Action's
 * `fcurves`, decodes each target, applies the visibility filter, and
 * returns the renderable row list enriched with per-row state flags
 * (`isMuted`, `activeKfIdx`, `fcurveId`).
 *
 * # Sister to Blender's `ED_add_fcurve_channel` — SEPARATION pattern only
 *
 * Audit-fix MED-2 (Slice 5.W fidelity audit 2026-05-17): the original
 * substrate cited `ED_add_fcurve_channel`
 * (`reference/blender/source/blender/editors/animation/keyframes_draw.cc:754-774`)
 * as authority for precomputing per-channel render hints. Verification
 * shows Blender's function precomputes ONLY `channel_locked` (a
 * derivation across `FCURVE_PROTECTED`, `AGRP_PROTECTED`, and library-
 * override status). Mute and active-keyform state are NOT precomputed
 * in Blender — they're re-derived at draw time in `graph_draw.cc:1190`
 * (`FCURVE_MUTED` stroke colour) and `graph_draw.cc:241-262`
 * (`draw_fcurve_active_vertex`) respectively.
 *
 * SS adopts the same SEPARATION pattern (data layer vs renderer) but
 * precomputes a wider set of flags. The precompute is an SS
 * architectural improvement, not a literal Blender port — the citation
 * is structural inspiration, not symbol mirror.
 *
 * # Row state flags
 *
 * ## `isMuted` (cascade-aware)
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
 * **Mute styling — SS-original (audit-fix HIGH-1).** When `isMuted=true`,
 * the renderer applies `italic + opacity-60` to the label and `opacity:
 * 0.4` to the diamond track. This is SS-original UX, not a Blender port:
 *
 *   - `graph_draw.cc:1190-1194` (real) styles the CURVE STROKE in the
 *     Graph Editor when muted (`immUniformThemeColorShade(TH_HEADER, 50)`).
 *     The dopesheet draws pips, not strokes, so this cite is the existence
 *     proof for "Blender styles muted curves" but NOT the implementation
 *     to mirror.
 *   - `keyframes_draw.cc:215` (real — `channel_ui_data_init`) sets
 *     `ctx->alpha = channel_locked ? 0.25f : 1.0f` — alpha-dim of
 *     dopesheet pips fires only for **locked (PROTECTED)** rows, not
 *     muted. The inline comment at line 119 ("graying out protected/muted
 *     channels") describes intent but only `channel_locked` actually
 *     drives the alpha branch.
 *
 * SS chooses to alpha-dim muted dopesheet pips because the FCurveEditor
 * sidebar / plot sister surface (Slice 5.G) already greys muted rows;
 * leaving the dopesheet visually identical between muted and unmuted
 * rows would force users to context-switch to FCurveEditor to know
 * which curves are evaluating. The alpha-drop is the same SEMANTIC
 * signal as Blender's mute hint, rendered in the medium the dopesheet
 * actually uses. Documented as Deviation 1 below.
 *
 * ## `activeKfIdx` (renderer gates on activeFCurveId separately)
 *
 * `getActiveKeyformIndex(fc)` — Slice 5.H's port of
 * `BKE_fcurve_active_keyframe_index`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:815-831`).
 * Returns `FCURVE_ACTIVE_KEYFORM_NONE` (-1) when the field is missing,
 * out of bounds, or `fcurve.keyforms` is absent.
 *
 * The row exposes this value, but the **halo only renders when the
 * row's fcurve matches the editor-store's `activeFCurveId`**. This is
 * SS's stand-in for Blender's per-channel `FCURVE_ACTIVE` flag — see
 * the audit-fix HIGH-2 note in `DopesheetEditor.jsx` for the gate
 * placement. Until SS ships per-fcurve ACTIVE (queued path #11), the
 * editor-local `activeFCurveId` carries the same semantic.
 *
 * Mirrors `draw_fcurve_active_vertex` at `graph_draw.cc:241-262`,
 * specifically the early-return at `:244`:
 *
 *   ```c
 *   if (!(fcu->flag & FCURVE_ACTIVE) ||
 *       active_keyframe_index == FCURVE_ACTIVE_KEYFRAME_NONE) {
 *     return;
 *   }
 *   ```
 *
 * Selection precondition (Blender's `:254`: `if (!(bezt->f2 & SELECT))
 * return;`) is not enforced in DopesheetEditor — SS keyform selection
 * lives in editor-local React state (the FCurveEditor `selectedHandles`
 * Map) that the dopesheet doesn't observe. Same split rationale as
 * `fcurveActiveKeyform.js` module header. Documented as Deviation 2.
 *
 * # Filtering — hidden curves (deliberate deviation from Action Editor)
 *
 * Effective-hidden rows are EXCLUDED from the returned list.
 *
 * Audit-fix MED-1 (Slice 5.W fidelity audit 2026-05-17): the original
 * substrate cited `anim_filter.cc:1287-1288` (`ANIMFILTER_CURVE_VISIBLE`)
 * as authority. Verification shows the in-source comment at that line
 * reads "only include if visible (Graph Editor check, not channels
 * check)" — the `FCURVE_VISIBLE` flag is owned by the Graph Editor.
 * Blender's Action Editor (`space_action/action_draw.cc`) has ZERO
 * references to `FCURVE_VISIBLE` and does NOT honour the flag at draw
 * time; hidden rows stay in the sidebar so the user can un-hide them.
 *
 * SS deviates by design: the DopesheetEditor has no sidebar / no
 * un-hide affordance. A hidden row staying on-screen would be visual
 * noise the user can't act on. To un-hide, the user opens FCurveEditor
 * (which mirrors Blender's per-row sidebar control) and clicks the eye
 * glyph. Documented as Deviation 3.
 *
 * Per Slice 5.V cascade, the filter covers both per-fcurve `hide` AND
 * the group-level cascade (`group.hide` hides every child fcurve).
 *
 * # SS deviations (cumulative — closes when conditions met)
 *
 * **Deviation 1 — muted dopesheet rows alpha-dim (Blender's action editor
 * doesn't).** SS-original UX. Closure: not planned. Re-evaluate if
 * users find the dim unhelpful or if Blender adds dopesheet mute styling
 * upstream (unlikely; the protect-only convention has been stable since
 * `keyframes_draw.cc`'s introduction).
 *
 * **Deviation 2 — active-keyform halo does not enforce keyform-selection
 * precondition** (`graph_draw.cc:254`: `if (!(bezt->f2 & SELECT)) return;`).
 * SS keyform selection lives in editor-local React state that the
 * dopesheet doesn't observe. Closure: future cross-editor selection
 * subscription, OR adoption of a project-stored keyform-selection field
 * (which would itself need a Phase 5 slice — none currently queued).
 *
 * **Deviation 3 — hidden curves filtered from dopesheet (Blender's action
 * editor keeps them).** SS-deliberate per UX rationale above. Closure:
 * none planned. If a sidebar with un-hide affordance ever lands on
 * DopesheetEditor (no slice queued), this filter relaxes naturally.
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
import { getActiveKeyformIndex } from '../../../anim/fcurveActiveKeyform.js';
import { logger } from '../../../lib/logger.js';

/**
 * @typedef {object} DopesheetRowKeyform
 * @property {number} time   Finite numeric ms (non-numeric or non-finite times are filtered at build time).
 * @property {number|number[]|string|boolean|null|undefined} value   Raw value; renderer formats for tooltip.
 */

/**
 * @typedef {object} DopesheetRow
 * @property {string} key                       Stable React key — `${kindPrefix}:${fcurveId}` (audit-fix L3).
 * @property {string} fcurveId                  Source FCurve id (renderer gates active-keyform halo on this).
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
 * # Audit-fix M4 (Slice 5.W arch audit 2026-05-17): group lookup
 *
 * `isFCurveEffectivelyMuted` and `isFCurveEffectivelyHidden` each
 * walk `action.groups[]` via `getFCurveGroupById` (O(G) per call).
 * For N fcurves × 2 helpers, that's 2N×G linear scans per build.
 * To make the build cost predictable as group count grows (Phase 4 NLA
 * may multiply group counts substantially), we pre-build a
 * `groupById` Map once at the top and inline the cascade reads here
 * — same semantic, O(1) per lookup. Future callers wanting the same
 * optimisation can adopt the same pattern; the per-curve helpers
 * stay as the public single-call surface.
 *
 * # Audit-fix L3 (Slice 5.W arch audit 2026-05-17): React key collision
 *
 * The original `${kindPrefix}:${nodeId|paramId}[:property]` key
 * collapsed multiple fcurves targeting the same `(nodeId, property)`
 * into a single React-deduped row, silently losing rows. The key now
 * includes `fcurveId` (always unique within an action). When duplicate
 * targets DO occur (today: bug; Phase 4 NLA: legitimate), a
 * `logger.warn` fires so the situation surfaces.
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

  // Audit-fix M4: pre-build group lookup so per-curve cascade reads are
  // O(1). The fast-path helpers below inline the cascade logic that
  // `isFCurveEffectivelyMuted` / `isFCurveEffectivelyHidden` perform
  // via `getFCurveGroupById`; verified identical semantic. Kept in
  // sync with `fcurveGroups.js` via the test_dopesheetRows assertions
  // covering both per-fcurve and cascade paths.
  const groups = Array.isArray(action.groups) ? action.groups : [];
  const groupById = new Map(groups.map((g) => [g?.id, g]));

  // Audit-fix Slice 6.F.2 HIGH-A: hoist the any-solo predicate before
  // the per-fcurve loop so the inline mute cascade reflects the solo
  // semantic. Pre-fix the inline cascade silently DIVERGED from
  // `isFCurveEffectivelyMuted` post-6.F.2 extension: eval engine
  // correctly silenced non-soloed fcurves but the dopesheet row
  // greying didn't reflect it (no visual feedback for solo state).
  // Decision matrix matches the function:
  //   anySolo && fc.solo  → NOT effectively muted (solo wins)
  //   anySolo && !fc.solo → effectively muted (DAW pattern)
  //   !anySolo            → original mute+group cascade applies
  // Per-call O(N) walk over fcurves; for typical SS actions (<100
  // fcurves) sub-millisecond. Hoisted ONCE per row-build, not per fc.
  let anySolo = false;
  for (const fc of action.fcurves) {
    if (fc && fc.solo === true) { anySolo = true; break; }
  }

  /** @type {DopesheetRow[]} */
  const paramRows = [];
  /** @type {DopesheetRow[]} */
  const nodeRows = [];
  /** @type {Set<string>} */
  const seenKeys = new Set();

  for (const fc of action.fcurves) {
    if (!fc) continue;

    // Hide filter — see module header for deviation rationale.
    const grp = fc.groupId ? groupById.get(fc.groupId) : undefined;
    if (fc.hide === true) continue;
    if (grp && grp.hide === true) continue;

    const target = decodeFCurveTarget(fc);
    if (!target) continue;

    const keyforms = Array.isArray(fc.keyforms) ? fc.keyforms : [];
    // Audit-fix M1: filter keyforms with non-numeric / non-finite times.
    // Coercing missing times to 0 silently creates phantom diamonds at
    // t=0 — per Rule №1 (no silent fallbacks), drop the bad entry. The
    // upstream-write should be where this gets diagnosed; the renderer
    // shouldn't paper over data corruption.
    const kfs = keyforms
      .filter((kf) => typeof kf?.time === 'number' && Number.isFinite(kf.time))
      .map((kf) => ({ time: kf.time, value: kf?.value }))
      .sort((a, b) => a.time - b.time);

    // Audit-fix Slice 6.F.2 HIGH-A: solo cascade takes priority — when
    // anySolo, soloed fcurves are NEVER greyed (solo wins over mute +
    // group); non-soloed are ALWAYS greyed regardless of mute bit. When
    // !anySolo, fall through to the original mute+group cascade.
    /** @type {boolean} */
    let isMuted;
    if (anySolo) {
      isMuted = fc.solo !== true;
    } else {
      const isMutedPerCurve = fc.mute === true;
      const isMutedPerGroup = !!(grp && grp.mute === true);
      isMuted = isMutedPerCurve || isMutedPerGroup;
    }
    const activeKfIdx = getActiveKeyformIndex(fc);

    let key, label, tooltip, kindColor;
    if (target.kind === 'param') {
      key = `param:${fc.id ?? target.paramId}`;
      label = paramNameById.get(target.paramId) ?? target.paramId;
      tooltip = `Parameter ${target.paramId}`;
      kindColor = 'bg-purple-500';
    } else {
      key = `node:${fc.id ?? `${target.nodeId}:${target.property}`}`;
      label = `${nodeNameById.get(target.nodeId) ?? target.nodeId} · ${target.property}`;
      tooltip = `Node ${target.nodeId} · ${target.property}`;
      kindColor = 'bg-cyan-500';
    }

    if (seenKeys.has(key)) {
      logger.warn(
        'dopesheetRows',
        `duplicate React key '${key}' for action '${action.id ?? '?'}' — likely two fcurves with the same id; second row dropped`,
      );
      continue;
    }
    seenKeys.add(key);

    /** @type {DopesheetRow} */
    const row = {
      key,
      fcurveId: fc.id ?? '',
      label,
      tooltip,
      kindColor,
      keyforms: kfs,
      isMuted,
      activeKfIdx,
    };
    if (target.kind === 'param') paramRows.push(row);
    else nodeRows.push(row);
  }

  paramRows.sort((a, b) => a.label.localeCompare(b.label));
  nodeRows.sort((a, b) => a.label.localeCompare(b.label));
  return [...paramRows, ...nodeRows];
}

/**
 * Return the render order for a row's keyform indices, placing
 * `activeKfIdx` last so its halo paints on top.
 *
 * Audit-fix M2 (Slice 5.W arch audit 2026-05-17): extracted from the
 * inline `useMemo` in `DopesheetEditor.jsx`'s Row component so the
 * z-order logic is unit-testable and decoupled from React.
 *
 * Mirrors Blender's two-pass order at `graph_draw.cc:241-262`
 * (`draw_fcurve_active_vertex` runs AFTER the regular vertex pass at
 * `draw_fcurve_keyframe_vertices`).
 *
 * @param {number} length          Total keyform count.
 * @param {number} activeKfIdx     Active index, or any value out of [0, length) for "no active".
 * @returns {number[]}             Index list to iterate in render order.
 */
export function getKeyformRenderOrder(length, activeKfIdx) {
  if (!Number.isInteger(length) || length <= 0) return [];
  if (!Number.isInteger(activeKfIdx) || activeKfIdx < 0 || activeKfIdx >= length) {
    return Array.from({ length }, (_, i) => i);
  }
  const out = [];
  for (let i = 0; i < length; i++) if (i !== activeKfIdx) out.push(i);
  out.push(activeKfIdx);
  return out;
}
