// @ts-check

/**
 * Schema v36 — Animation Phase 1 Stage 1.A + 1.B:
 * `Action` datablock + per-Object `AnimData` from legacy
 * `project.animations[]`.
 *
 * # Why this migration exists
 *
 * Pre-v36, animation data lived on a project-level flat list:
 *
 *     project.animations[i] = {
 *       id, name, fps, duration?, frameStart?, frameEnd?, audioTracks,
 *       tracks: [{ paramId | (nodeId + property), keyframes: [{time, value, easing}] }]
 *     }
 *
 * That conflates the Blender notion of `Action` (a project-level keyed
 * datablock holding FCurves) with `AnimData` (the per-Object slot that
 * binds an Object to one Action). Pre-v36 the active clip was selected
 * by the UI store's `activeAnimationId`; there was no per-Object
 * binding, no NLA, no driver/animation distinction.
 *
 * v36 splits this into Blender's shape per
 * `reference/blender/source/blender/makesdna/DNA_action_types.h:215-360`
 * (Action) and `DNA_anim_types.h:664-740` (AnimData):
 *
 *     project.actions[i] = {
 *       id, name, fps, duration?, frameStart?, frameEnd?,
 *       audioTracks,
 *       fcurves: [{ id, rnaPath, arrayIndex, keyforms, modifiers, driver?, extrapolation }],
 *       flag, meta
 *     }
 *     node.animData = {
 *       actionId, actionInfluence, actionBlendmode, actionExtendmode,
 *       slotHandle, nlaTracks, drivers, flag
 *     }
 *
 * # The conversion
 *
 *   - `animation` → `action`: spread fields verbatim, rename `tracks` →
 *     `fcurves` via `trackToFCurveInline`, default `flag = 0`, default
 *     `meta = { source: 'authored' }`.
 *   - `track.paramId='X'` → `fcurve.rnaPath='objects[\'__params__\'].values[\'X\']'`.
 *   - `track.nodeId='Y' + property='Z'` → `fcurve.rnaPath='objects[\'Y\'].Z'`.
 *   - `track.keyframes[]` → `fcurve.keyforms[]` (verbatim — Phase 2 promotes
 *     to BezTriples; Phase 1 keeps `{time, value, easing}` shape).
 *   - `track.driver` (already supported as a per-track driver) → `fcurve.driver`.
 *   - Every Object node (`type === 'part' || type === 'group'`) gains
 *     `node.animData = defaultAnimData()`.
 *   - `project.animations` is deleted (Rule №2 — no migration baggage).
 *
 * # Out of scope (later stages)
 *
 *   - Stage 1.C — `actionRegistry.js` helpers (assignAction / cloneAction
 *     / deleteAction / getActionUsers).
 *   - Stage 1.D — `__scene__` pseudo-Object node carrying project-wide
 *     AnimData. Until then, no Object's `animData.actionId` is auto-bound;
 *     consumers continue to pick the active action via the UI store
 *     (`useAnimationStore.activeActionId`, renamed from `activeAnimationId`).
 *   - Stage 1.E — `AnimationsEditor` → `ActionsEditor` UI rename.
 *   - NodeTree retirement (`project.nodeTrees.{rig,driver,animation}`).
 *     The nodetree shadow trees stay populated for now; they're retired
 *     alongside this migration in a follow-up commit so the rewire vs.
 *     retirement diffs stay separable.
 *
 * # Idempotent
 *
 * Re-running v36 on a v36+ project is a no-op:
 *   - `project.actions` already populated → skip the conversion (preserve
 *     in place).
 *   - Each node's `animData` slot already populated → skip.
 *
 * # Lossless
 *
 * Every field on the legacy `animation` carries through to `action`
 * verbatim. `fcurve.id`/`rnaPath`/`arrayIndex`/`keyforms`/`modifiers`/
 * `extrapolation` are derived from the track's identifying fields and
 * the existing keyframe array. Driver pointers (`track.driver`) survive
 * onto the fcurve. Audio tracks survive verbatim (their persistence
 * round-trip is owned by `projectFile.js` independently).
 *
 * Pre-v36 tracks that lacked both `paramId` AND (`nodeId` + `property`)
 * are dropped — they had no addressable target and the runtime already
 * skipped them silently.
 *
 * # Cross-references
 *
 * - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 1 (lines 419-578)
 *   — Action datablock + AnimData spec
 * - `src/anim/animationFCurve.js` — the Phase 5 scaffold conversion
 *   helper this migration inlines
 * - `src/anim/rnaPath.js` — the rnaPath grammar the fcurves now address
 *   targets through
 * - `src/store/objectDataAccess.js` — `setBonePoseField` for the v19
 *   channels-shape pose write that FCurve→rnaPath writers go through
 *
 * @module store/migrations/v36_action_datablock
 */

/** Easing values that collapse to constant-step keyforms. */
const HOLD_EASINGS = new Set(['constant', 'hold']);

/**
 * Convert one legacy SS track to an fcurve. Inlined from
 * `src/anim/animationFCurve.js#trackToFCurve` so the migration stays
 * self-contained (Rule for migrations: time-locked code that doesn't
 * track app evolution).
 *
 * @param {object} track
 * @returns {object|null} the fcurve, or null when the track has no
 *   addressable target / no usable keyframes
 */
function trackToFCurveInline(track) {
  if (!track || typeof track !== 'object') return null;
  const kfs = Array.isArray(track.keyframes) ? track.keyframes : [];
  if (kfs.length === 0) return null;
  let rnaPath;
  let id;
  if (typeof track.paramId === 'string' && track.paramId.length > 0) {
    rnaPath = `objects['__params__'].values['${track.paramId}']`;
    id = `param:${track.paramId}`;
  } else if (
    typeof track.nodeId === 'string' && track.nodeId.length > 0
    && typeof track.property === 'string' && track.property.length > 0
  ) {
    rnaPath = `objects['${track.nodeId}'].${track.property}`;
    id = `${track.nodeId}.${track.property}`;
  } else {
    return null;
  }
  const keyforms = [];
  for (const kf of kfs) {
    if (typeof kf?.time !== 'number' || typeof kf?.value !== 'number') continue;
    const easing = typeof kf.easing === 'string' ? kf.easing : 'linear';
    keyforms.push({
      time: kf.time,
      value: kf.value,
      easing,
      // `type` mirrors the existing FCurve evaluator's expected field
      // (`anim/fcurve.js:114`). HOLD/'constant' easings collapse to
      // 'constant'; everything else (linear, ease-in/out/both, named
      // bezier flavours that don't yet have segment encoding) collapse
      // to 'linear'. Phase 2 (BezTriple migration v37) replaces this
      // entire shape with full Blender BezTriple semantics.
      type: HOLD_EASINGS.has(easing) ? 'constant' : 'linear',
    });
  }
  if (keyforms.length === 0) return null;
  /** @type {Record<string, *>} */
  const fcurve = {
    id,
    rnaPath,
    arrayIndex: 0,
    keyforms,
    modifiers: [],
    extrapolation: HOLD_EASINGS.has(keyforms[keyforms.length - 1].easing) ? 'constant' : 'constant',
  };
  if (track.driver && typeof track.driver === 'object') {
    fcurve.driver = track.driver;
  }
  return fcurve;
}

/**
 * Default `node.animData` slot — Blender's `AnimData` defaults per
 * `DNA_anim_types.h` (act_influence=1.0, act_blendmode=ACT_BLEND_REPLACE,
 * act_extendmode=ACT_EXTEND_HOLD).
 *
 * @returns {object}
 */
function defaultAnimData() {
  return {
    actionId: null,
    actionInfluence: 1,
    actionBlendmode: 'replace',
    actionExtendmode: 'hold',
    slotHandle: 0,
    nlaTracks: [],
    drivers: [],
    flag: 0,
  };
}

/**
 * Convert legacy `animation` clip to v36 `action` shape.
 *
 * @param {object} anim
 * @returns {object}
 */
function animationToAction(anim) {
  const fcurves = [];
  for (const t of (anim.tracks ?? [])) {
    const fc = trackToFCurveInline(t);
    if (fc) fcurves.push(fc);
  }
  /** @type {Record<string, *>} */
  const action = {
    id: anim.id,
    name: anim.name,
    fps: typeof anim.fps === 'number' ? anim.fps : 24,
    audioTracks: Array.isArray(anim.audioTracks) ? anim.audioTracks : [],
    fcurves,
    flag: 0,
    meta: {
      createdAt: anim.createdAt ?? null,
      modifiedAt: anim.modifiedAt ?? null,
      source: 'authored',
    },
  };
  if (typeof anim.duration === 'number') action.duration = anim.duration;
  if (typeof anim.frameStart === 'number') action.frameStart = anim.frameStart;
  if (typeof anim.frameEnd === 'number') action.frameEnd = anim.frameEnd;
  return action;
}

/**
 * @param {object} project — mutated in place
 * @returns {{ actionsCreated: number, animDataAdded: number }}
 */
export function migrateActionDatablock(project) {
  if (!project) return { actionsCreated: 0, animDataAdded: 0 };

  // Idempotency guard: pre-existing v36+ project has `actions` and no
  // `animations` — skip the conversion and preserve in place.
  if (Array.isArray(project.actions) && !Array.isArray(project.animations)) {
    // Still ensure animData scaffolding (a partial v36 save mid-flight).
  } else {
    const animations = Array.isArray(project.animations) ? project.animations : [];
    /** @type {object[]} */
    const actions = Array.isArray(project.actions) ? [...project.actions] : [];
    for (const anim of animations) {
      if (!anim || typeof anim !== 'object') continue;
      // Skip if an action with the same id already exists (defensive
      // against partial mid-migration state).
      if (actions.some((a) => a?.id === anim.id)) continue;
      actions.push(animationToAction(anim));
    }
    project.actions = actions;
    delete project.animations;
  }

  // animData scaffolding for every Object node (parts + bone groups).
  // Stage 1.D will introduce __scene__ + auto-bind. Until then, no node
  // carries an actionId; consumers fall back to the UI store's
  // `activeActionId` (renamed from `activeAnimationId`).
  let animDataAdded = 0;
  for (const node of project.nodes ?? []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type !== 'part' && node.type !== 'group') continue;
    if (node.animData && typeof node.animData === 'object') continue;
    node.animData = defaultAnimData();
    animDataAdded++;
  }

  return {
    actionsCreated: Array.isArray(project.actions) ? project.actions.length : 0,
    animDataAdded,
  };
}
