// @ts-check

/**
 * Schema v42 — Animation Phase 4 Slice 4.A:
 * NLA stack substrate (backup pointers on AnimData + NlaTrack/NlaStrip
 * shape conventions).
 *
 * # Why this migration exists
 *
 * Per Animation Phase 4 plan §4.A
 * (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1240`):
 *
 * > AnimData backup pointers (`tmpActionId` / `tmpSlotHandle` /
 * > `tweakTrackId` / `tweakStripId`) are part of Phase 1's animData
 * > shape (now expanded above) — Phase 4 wires them.
 *
 * The plan-doc CLAIM that the backup pointers were already in Phase 1's
 * shape is wrong: v36's `defaultAnimData()`
 * (`src/store/migrations/v36_action_datablock.js:292-303`) and v37's
 * parallel (`src/store/migrations/v37_scene_anim_data.js:140-151`)
 * declared 8 fields — `actionId`, `actionInfluence`, `actionBlendmode`,
 * `actionExtendmode`, `slotHandle`, `nlaTracks`, `drivers`, `flag` —
 * but NOT the four backup-pointer slots required by tweak-mode entry/
 * exit (`BKE_nla_tweakmode_enter` / `BKE_nla_tweakmode_exit` in
 * `reference/blender/source/blender/blenkernel/BKE_nla.hh`).
 *
 * Tweak mode (Phase 4.C) pivots on those four slots existing on every
 * AnimData. Adding them via a runtime "ensure" helper would be a Rule
 * №2 violation (migration baggage — backup state should be part of the
 * shape, not patched in by the consumer). v42 puts them in the schema.
 *
 * # Blender source mirror
 *
 * Blender `AnimData` struct (`reference/blender/source/blender/makesdna/DNA_anim_types.h:697-713`):
 *
 *     bAction *tmpact = nullptr;                          // → SS tmpActionId  (string id)
 *     int32_t  tmp_slot_handle = 0;                       // → SS tmpSlotHandle
 *     char     tmp_last_slot_identifier[258] = "";        // omitted; SS doesn't carry slot identifiers yet
 *     ListBaseT<NlaTrack> nla_tracks = {nullptr, nullptr}; // already SS nlaTracks[] (v36)
 *     NlaTrack *act_track = nullptr;                      // → SS tweakTrackId  (string id)
 *     NlaStrip *actstrip  = nullptr;                      // → SS tweakStripId  (string id)
 *
 * **SS naming deviation** (deliberate): Blender names the runtime
 * "active during tweak" pointers `act_track` / `actstrip`. The `act_`
 * prefix collides with the existing `act_blendmode` / `act_extendmode`
 * / `act_influence` fields where `act` means "the active action"
 * (a persistent state) rather than "the active strip during tweak"
 * (a transient editing state). Plan §4.A renamed these to
 * `tweakTrackId` / `tweakStripId` for unambiguity. The SS animData
 * already converted Blender's `bAction *` pointers to string ids
 * (`actionId` not `act`), so the `Id` suffix follows established
 * convention.
 *
 * # Idempotent
 *
 * Re-running v42 on a v42+ project is a no-op: each animData slot
 * either already has the 4 fields (skip) or doesn't (add). Setting a
 * field that already exists at the same value is a no-op even without
 * the guard, but the explicit `=== undefined` check makes the
 * idempotent intent visible.
 *
 * # Lossless
 *
 * Pre-v42 there was no tweak-mode UI to drive backup-pointer values
 * (Slice 4.C hasn't shipped). All four slots default to null/0, which
 * is the "not in tweak mode" state Blender uses for fresh AnimData
 * (`anim_data.cc:105-129` BKE_animdata_ensure_id). Zero-loss.
 *
 * # Cross-references
 *
 * - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4.A
 *   (line 1260) — slice spec; this migration corrects the spec's
 *   Phase-1 claim with a sister-migration approach.
 * - `src/anim/nla.js` — Slice 4.A NlaTrack/NlaStrip constructors +
 *   flag enums + predicates. Imported by `defaultAnimData()` so new
 *   projects get the same shape this migration writes for old ones.
 * - `src/store/migrations/v36_action_datablock.js:292-303` — v36
 *   `defaultAnimData()` (parallel-updated this slice with the 4 new
 *   fields so freshly-created projects match the migrated shape).
 * - `src/store/migrations/v37_scene_anim_data.js:140-151` — v37
 *   `__scene__` node's `defaultAnimData()` (parallel-updated).
 * - `reference/blender/source/blender/makesdna/DNA_anim_types.h:697-713`
 *   — Blender's `AnimData` struct; the four backup-pointer fields.
 * - `reference/blender/source/blender/makesdna/DNA_anim_enums.h:553-587`
 *   — `eAnimData_Flag` including `ADT_NLA_EDIT_ON = (1 << 2)` (line
 *   559) — the flag Slice 4.C will set to indicate tweak mode is on.
 *
 * @module store/migrations/v42_nla_substrate
 */

import { isSceneNode } from './v37_scene_anim_data.js';

/**
 * Add the four NLA backup-pointer fields to an animData slot in place.
 *
 * Field meanings (Blender DNA_anim_types.h:694-713):
 *   - `tmpActionId` (was `tmpact: bAction*`) — id of the action that
 *     was bound BEFORE tweak mode entry; restored on tweak-mode exit.
 *     null = not in tweak mode.
 *   - `tmpSlotHandle` (was `tmp_slot_handle: int32_t`) — slot handle
 *     for `tmpActionId`. 0 = unassigned (Blender's
 *     `animrig::Slot::unassigned` sentinel).
 *   - `tweakTrackId` (was `act_track: NlaTrack*`) — id of the NLA
 *     track owning the strip currently being tweaked. null = not in
 *     tweak mode.
 *   - `tweakStripId` (was `actstrip: NlaStrip*`) — id of the NLA
 *     strip currently being tweaked. null = not in tweak mode.
 *
 * @param {object} animData — mutated in place
 * @returns {boolean} true if any field was added (idempotency
 *   instrumentation; never relied on by callers)
 */
function ensureNlaBackupPointers(animData) {
  let added = false;
  if (animData.tmpActionId === undefined) {
    animData.tmpActionId = null;
    added = true;
  }
  if (animData.tmpSlotHandle === undefined) {
    animData.tmpSlotHandle = 0;
    added = true;
  }
  if (animData.tweakTrackId === undefined) {
    animData.tweakTrackId = null;
    added = true;
  }
  if (animData.tweakStripId === undefined) {
    animData.tweakStripId = null;
    added = true;
  }
  return added;
}

/**
 * Walks every node carrying an animData slot and adds the four
 * backup-pointer fields. Targets the same node-shape predicate v36 +
 * v37 used: 'part' / 'group' object nodes plus the synthetic
 * '__scene__' (type 'scene') node.
 *
 * @param {object} project — mutated in place
 * @returns {{ animDataPatched: number }}
 */
export function migrateNlaSubstrate(project) {
  if (!project) return { animDataPatched: 0 };
  if (!Array.isArray(project.nodes)) return { animDataPatched: 0 };

  let animDataPatched = 0;
  for (const node of project.nodes) {
    if (!node || typeof node !== 'object') continue;

    // Same shape gate v36 used (`v36_action_datablock.js:385-391`)
    // plus the v37 scene node (which carries animData on a non-part/
    // non-group type tag). Centralising via `isSceneNode` keeps the
    // scene-node convention in one place (v37 doc D-12).
    const carriesAnimData =
      node.type === 'part' || node.type === 'group' || isSceneNode(node);
    if (!carriesAnimData) continue;
    if (!node.animData || typeof node.animData !== 'object') continue;

    if (ensureNlaBackupPointers(node.animData)) animDataPatched++;
  }

  return { animDataPatched };
}
