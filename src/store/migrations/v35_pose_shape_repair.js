// @ts-check

/**
 * Schema v35 — Pose Read/Write Canonicalisation Plan audit-fix D-3:
 * repair mixed-state pose corruption produced by pre-Phase-8 writers.
 *
 * # Why this migration exists
 *
 * Phase 8 (commit `b58b505`) routed every pose writer through
 * `setBonePose` / `setBonePoseField` helpers in `objectDataAccess.js`.
 * The helpers detect v17/v18 flat shape vs v19+ channels shape and
 * write to the correct slot. Pre-Phase-8 writers (depgraph kernels
 * `bonePostChain.js` + `transformCompose.js` reached via Phase 0.D.0's
 * `c8f86f3` rAF wiring; `rnaPath.setRnaPath` for FCurve / driver
 * writes) wrote flat fields ONTO the channels envelope WITHOUT
 * updating the inner channel:
 *
 *     // Pre-Phase-8 corrupt write on a v19 channels-shape bone:
 *     node.pose = { channels: { 'b1': {rotation: 0.5} } };  // pre
 *     node.pose.rotation = 1.2;                              // bad
 *     // post: { rotation: 1.2, channels: { 'b1': {rotation: 0.5} } }
 *
 * `getBonePose` reads `channels[node.id].rotation = 0.5` (STALE
 * pre-corruption value). The user's actual intended rotation 1.2
 * lives only on the flat field, which Phase 8 audit just removed
 * every reader of.
 *
 * The v19 migration's idempotency guard
 * (`!flatPose.channels` at `projectMigrations.js:649`) PERMANENTLY
 * locks corrupt mixed-state bones in unreadable form — re-running v19
 * on a corrupted project skips them. Without v35 there is no
 * recovery path.
 *
 * # The repair
 *
 * For every bone-group node whose `pose` carries BOTH a `channels`
 * map AND any flat pose field (`rotation`/`x`/`y`/`scaleX`/`scaleY`):
 *
 *   1. Move flat fields INTO `channels[node.id]` (latest-wins
 *      semantics — the flat field is the value the post-corruption
 *      writer intended; the channels value pre-dates the corruption).
 *   2. Delete the flat fields from `node.pose`, leaving only the
 *      `channels` envelope intact.
 *
 * Lossless-by-design: bones with PURE channels-shape OR PURE flat
 * shape are untouched. Only mixed-state bones get repaired.
 *
 * # Idempotent
 *
 * Post-repair `node.pose` has either `{channels}` or `{rotation, x,
 * y, ...}` — never both. Re-running v35 on a v35+ project is a no-op.
 *
 * # Out of scope
 *
 * - Stale FOREIGN channels (a bone with `channels: {[other.id]: {...}}`
 *   where `other.id !== node.id`) — keeping for now in case multi-bone
 *   shared envelopes ship with Phase 1C-flip. `ensureBonePoseChannel`
 *   will create the self-keyed entry on next write without disturbing
 *   foreign entries.
 *
 * @module store/migrations/v35_pose_shape_repair
 */

/** Pose-channel field names — must match `POSE_CHANNEL_FIELDS` in objectDataAccess.js. */
const POSE_FIELDS = ['rotation', 'x', 'y', 'scaleX', 'scaleY'];

/**
 * Detect whether a node is a bone group. Inlined (not imported from
 * objectDataAccess) so the migration module stays standalone.
 *
 * @param {object} node
 * @returns {boolean}
 */
function isBoneGroupShape(node) {
  return Boolean(node && node.type === 'group' && typeof node.boneRole === 'string');
}

/**
 * @param {object} project — mutated in place
 * @returns {{ repaired: number }} count of bones that had mixed state cleaned
 */
export function migratePoseShapeRepair(project) {
  if (!project || !Array.isArray(project.nodes)) return { repaired: 0 };
  let repaired = 0;
  for (const node of project.nodes) {
    if (!isBoneGroupShape(node)) continue;
    const pose = node.pose;
    if (!pose || typeof pose !== 'object') continue;
    if (!pose.channels || typeof pose.channels !== 'object') continue;

    // Gather flat fields present on the envelope (the corruption
    // signature). These are the LATEST writes per the writer's intent.
    /** @type {Record<string, number>} */
    const stale = {};
    let hasMixed = false;
    for (const field of POSE_FIELDS) {
      if (typeof pose[field] === 'number') {
        stale[field] = pose[field];
        hasMixed = true;
      }
    }
    if (!hasMixed) continue;

    // Ensure the self-keyed channel exists (defensive — a corrupt
    // project might have flat fields without a self-channel).
    let ch = pose.channels[node.id];
    if (!ch || typeof ch !== 'object') {
      ch = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
      pose.channels[node.id] = ch;
    }

    // Latest-wins: flat-field corruption is the most recent write,
    // overrides the stale channels values.
    for (const field of POSE_FIELDS) {
      if (field in stale) ch[field] = stale[field];
      // Defensive: ensure all 5 fields populated (safer than partial).
      if (typeof ch[field] !== 'number') {
        ch[field] = (field === 'scaleX' || field === 'scaleY') ? 1 : 0;
      }
    }

    // Drop the flat fields from the envelope. Leaves `channels` as the
    // sole authoritative shape. This is the canonicalisation step.
    for (const field of POSE_FIELDS) {
      delete pose[field];
    }

    repaired++;
  }
  return { repaired };
}
