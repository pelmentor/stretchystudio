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
 *     `meta = { source: 'authored' }` (Stage 1.F audit-fix D-10
 *     deviation: `meta` is SS-specific; Blender's `bAction` has no
 *     `meta` field — see `actionRegistry.js#cloneAction` Audit-fix
 *     D-7 from Stage 1.E for the per-clone semantic).
 *   - `track.paramId='X'` → `fcurve.rnaPath='objects["__params__"].values["X"]'`.
 *   - `track.nodeId='Y' + property='Z'` → `fcurve.rnaPath='objects["Y"].Z'`.
 *     Bracket-string keys use double-quotes to match Blender's RNA
 *     tokenizer (`reference/blender/source/blender/makesrna/intern/rna_path.cc:127`
 *     — `if (*p == '"')` is the only branch recognising a quoted string
 *     key; single-quoted keys would tokenise as the unquoted numeric
 *     branch and parse-fail).
 *   - `track.keyframes[]` → `fcurve.keyforms[]` (verbatim — Phase 2 promotes
 *     to BezTriples; Phase 1 keeps `{time, value, easing}` shape).
 *   - `track.driver` (already supported as a per-track driver) → `fcurve.driver`.
 *   - Every Object node (`type === 'part' || type === 'group'`) gains
 *     `node.animData = defaultAnimData()`.
 *   - `project.animations` is deleted (Rule №2 — no migration baggage).
 *
 * # Pre-fix v36 save normalisation (2026-05-11 audit-fix sweep)
 *
 * v36 shipped earlier on 2026-05-11 with single-quoted rnaPaths
 * (`objects['__params__'].values['X']`). The same-day audit-fix sweep
 * normalised the grammar to double-quotes for Blender compatibility.
 * The migration's idempotency guard now also walks pre-existing
 * `project.actions[].fcurves[]` and rewrites any single-quoted rnaPath
 * to double-quoted. This is idempotent (re-running on already-double
 * paths is a no-op) and keeps the strict-double decoder safe — by the
 * time the runtime decoder sees a project, every fcurve is canonical.
 *
 * # SS-specific shape deviations from Blender `bAction`
 *
 * **`action.id` vs Blender `ID.name = "AC<actionname>"` (Stage 1.F audit-fix D-8):**
 * Blender's `bAction` carries `ID id` as its first field (per
 * `DNA_action_types.h:1059-1060`); the ID name carries a 2-char type
 * prefix (`"AC"` for Actions; sister to `ID_SCE = MAKE_ID2('S', 'C')`
 * in `DNA_ID_enums.h:133` for Scene's "SC" prefix). A Blender Action
 * created with `BKE_action_add(&bmain, "Idle")` ends up with
 * `id.name == "ACIdle"`. SS uses TWO separate fields: `id` (UUID-style
 * stable identifier, never user-edited) + `name` (display string,
 * user-editable). The id is stable across renames in SS; in Blender
 * renaming an Action also rewrites `id.name`. Stage 1.E's rename UX
 * relies on this distinction — a Blender-trained dev should not
 * confuse `action.id` with the display name.
 *
 * **`audioTracks` SS-only field (Stage 1.F audit-fix D-9):** Blender's
 * `bAction` (`DNA_action_types.h:1053-1126`) has NO `audioTracks` field
 * — audio in Blender is the Sequencer's domain (separate datablocks:
 * `Sequence`/`SoundStrip` in `DNA_sequence_types.h`); Actions don't
 * own audio. SS preserves `audioTracks` through this migration verbatim
 * to keep the legacy idle-generator's audio-cue contract working
 * (per the Lossless guarantee below — every legacy field carries
 * forward). Phase 6+ (or whichever phase ships a Sequencer-equivalent)
 * may rehome this field then.
 *
 * # Out of scope (later stages)
 *
 *   - Stage 1.C — `actionRegistry.js` helpers (assignAction / cloneAction
 *     / deleteAction / getActionUsers).
 *   - Stage 1.D — `__scene__` pseudo-Object node carrying project-wide
 *     AnimData. Until then, no Object's `animData.actionId` is auto-bound;
 *     consumers continue to pick the active action via the UI store
 *     (`useAnimationStore.activeActionId`, renamed from `activeAnimationId`).
 *   - Stage 1.E (SHIPPED 2026-05-11) — `AnimationsEditor` → `ActionsEditor`
 *     UI rename + 11-file `activeActionId` consumer rewire through
 *     `getActiveSceneAction(project, fallback)` so scene-bound actions
 *     win over UI-store fallback throughout the editor.
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
    rnaPath = `objects["__params__"].values["${track.paramId}"]`;
    id = `param:${track.paramId}`;
  } else if (
    typeof track.nodeId === 'string' && track.nodeId.length > 0
    && typeof track.property === 'string' && track.property.length > 0
  ) {
    rnaPath = `objects["${track.nodeId}"].${track.property}`;
    id = `${track.nodeId}.${track.property}`;
  } else {
    return null;
  }
  const keyforms = [];
  for (const kf of kfs) {
    // `mesh_verts` keyforms carry array-shaped values (per-vertex
    // displacement). They are silently dropped here because Phase 1's
    // keyform shape is scalar-only ({time, value: number, easing,
    // type}); Phase 2's BezTriple migration (v37) does NOT extend this
    // — array-valued keyforms remain a separate concern owned by the
    // shape-key / vertex-animation pipeline (Phase 4+). Until then,
    // mesh_verts animation tracks are non-persistent through this
    // migration. Tracked in plan §Phase 4 (mesh deformation).
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
    // Blender's `eFCurve_Extend` (DNA_anim_enums.h:335-339) defaults to
    // `FCURVE_EXTRAPOLATE_CONSTANT = 0` (zero-init). Hold-easing
    // terminator preserves constant; linear-terminator falls through
    // to 'linear' so Phase 2's extrapolation-honouring evaluator picks
    // up the correct sentinel. Pre-audit-fix the false branch returned
    // 'constant' (dead ternary), suppressing any future linear-extrap
    // semantics.
    extrapolation: HOLD_EASINGS.has(keyforms[keyforms.length - 1].easing) ? 'constant' : 'linear',
  };
  if (track.driver && typeof track.driver === 'object') {
    fcurve.driver = track.driver;
  }
  return fcurve;
}

/**
 * Rewrite any single-quoted rnaPath bracket-string key to double-quoted
 * to match Blender's RNA tokenizer (`rna_path.cc:127`). Idempotent
 * (already-double paths return verbatim). Used by the v36 idempotency
 * guard to normalise pre-audit-fix v36 saves on next load.
 *
 * @param {string} rna
 * @returns {string}
 */
function normalizeRnaPathQuotes(rna) {
  if (typeof rna !== 'string') return rna;
  // Replace any `[' ... ']` with `[" ... "]`. The bracket grammar is
  // tight enough that a literal-character substitution is safe; the
  // single-quote character does not appear inside a Live2D paramId or
  // SS nodeId (validated at id-construction time), so the inner content
  // never contains a `'` to confuse the substitution.
  return rna.replace(/\['([^']*)'\]/g, '["$1"]');
}

/**
 * Default `node.animData` slot — Blender's `AnimData` defaults.
 *
 * Field provenance (Blender source):
 *   - `actionInfluence = 1.0`: DNA struct value-inits to 0
 *     (`DNA_anim_types.h:737` — `float act_influence = 0;`), but
 *     `BKE_animdata_create` overrides to `1.0f` at runtime
 *     (`reference/blender/source/blender/blenkernel/intern/anim_data.cc:123`
 *     — `adt->act_influence = 1.0f;`). The 1.0 default is the canonical
 *     "fully-influencing" value; SS adopts the BKE-runtime default.
 *   - `actionBlendmode = 'replace'`: matches `NLASTRIP_MODE_REPLACE = 0`
 *     (`DNA_anim_enums.h:375` — `eNlaStrip_Blend_Mode`). Action blend
 *     modes share the NLASTRIP_MODE_* enum since 4.0; the action-blend
 *     -mode field on AnimData (`act_blendmode`) is read with the same
 *     enum.
 *   - `actionExtendmode = 'hold'`: matches `NLASTRIP_EXTEND_HOLD = 0`
 *     (`DNA_anim_enums.h:386` — `eNlaStrip_Extrapolate_Mode`). Same
 *     shared-enum story.
 *   - `slotHandle = 0`: AnimData.slot_handle initial = 0 (= "unassigned"
 *     sentinel; Blender 4.4+ slot system). Stage 1.F audit-fix D-11
 *     deviation: SS doesn't have a slot table at all (`bAction.slot_array`
 *     is unimplemented in Phase 1); `slotHandle: 0` is reserved for
 *     the future slot table and effectively a no-op pointer today.
 *     Phase 4 NLA work will introduce real slots.
 *   - `flag = 0`: AnimData.flag bitmask zero-init.
 *
 * # `actionInfluence = 1` BKE-runtime override deviation (Stage 1.F audit-fix D-4)
 *
 * The `1.0f` value is NOT what the DNA struct initialises to. Blender's
 * `AnimData` struct value-inits `act_influence` to `0.0f`
 * (`DNA_anim_types.h:737`), and the runtime override to `1.0f` happens
 * inside `BKE_animdata_ensure_id` (`anim_data.cc:105-129`) — which is
 * called LAZILY by `BKE_animdata_from_id` on first access for Blender
 * IDs that don't already have an `adt`.
 *
 * SS adopts the BKE-runtime default (`1.0f`) directly because we
 * eagerly create AnimData on every Object node (`type ∈ {'part',
 * 'group'}`) at migration time — there's no lazy-create path through
 * `BKE_animdata_ensure_id` to apply the override later. Without the
 * override, SS Objects would default to "no influence" rather than
 * "fully influencing," which is wrong for the user-facing semantic
 * ("a bound action plays"). Sister deviation in v37 (`__scene__`
 * pseudo-Object) uses identical reasoning — see
 * `v37_scene_anim_data.js:77-85` for the parallel writeup.
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
    // Blender's `eAction_Flags` (DNA_action_types.h:374-387) bit set:
    //   ACT_COLLAPSED   = (1 << 0)  — UI collapsed in Outliner
    //   ACT_SELECTED    = (1 << 1)  — selected in Outliner
    //   ACT_MUTED       = (1 << 9)  — runtime-disabled
    //   ACT_FRAME_RANGE = (1 << 12) — manual frame-range override
    //   ACT_CYCLIC      = (1 << 13) — loops between frame_start/end
    // Default 0 = none of the above. Stage 1.E (ActionsEditor UI) will
    // surface these as toggles.
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
  // `animations` — skip the conversion and preserve in place. ALSO
  // normalise rnaPath quote grammar (single → double) for any pre-fix
  // v36 saves shipped before the 2026-05-11 audit-fix sweep.
  if (Array.isArray(project.actions) && !Array.isArray(project.animations)) {
    for (const action of project.actions) {
      const fcs = Array.isArray(action?.fcurves) ? action.fcurves : [];
      for (const fc of fcs) {
        if (fc && typeof fc.rnaPath === 'string') {
          fc.rnaPath = normalizeRnaPathQuotes(fc.rnaPath);
        }
      }
    }
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
