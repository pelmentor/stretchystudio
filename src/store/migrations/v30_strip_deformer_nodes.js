// @ts-check

/**
 * v30 — BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.C cleanup.
 *
 * Strips `type:'deformer'` entries from `project.nodes`. Deformer
 * state lives entirely on `Object.modifiers[i].data` (populated by
 * Phase 3.A's v28 fold + the dual-write window since 3.A).
 *
 * # Order of operations
 *
 * 1. Re-run the v28 fold idempotently. If any modifier carries an
 *    empty `.data` for a deformer that's still in `project.nodes`,
 *    the fold copies fields into the modifier's data sub-object. This
 *    is the safety net: a project that drifted between 3.A and 3.C
 *    (e.g. a UI edit wrote to the deformer node without re-running
 *    `synthesizeModifierStacks`) gets re-anchored before the strip.
 *
 * 2. For every `type:'deformer'` entry in `project.nodes` that is
 *    NOT referenced by any part's modifier stack (`never-in-stack`
 *    orphans), log a warning. These deformers will be lost — we can't
 *    re-create modifier entries on parts that don't reference them.
 *    In practice this should be empty for any project that has run
 *    Init Rig under Phase 3.A+ (the synth fanout-copies every chain-
 *    referenced deformer's data into every part's stack).
 *
 * 3. Strip every `type:'deformer'` entry from `project.nodes`.
 *
 * # Idempotence
 *
 * Re-running on an already-v30 project is a no-op: the v28 fold finds
 * no deformer nodes (lookup returns null), `modifier.data` is
 * preserved, and the strip pass finds no entries to remove.
 *
 * # `part.rigParent`
 *
 * The flat-id pointer stays. Post-strip it points at a deformerId
 * that no longer resolves via `nodeById`, but the synth in
 * `synthesizeDeformerNodesForExport` re-creates a virtual deformer
 * node from the part's modifier stack — so callers like
 * `selectRigSpec` that mirror the synth into their nodeById lookup
 * (already done as of Phase 3.B) keep working.
 *
 * # `_userAuthored` survival
 *
 * Phase 3.A's v28 fold copies `_userAuthored` into `modifier.data`.
 * Post-strip the marker lives on the modifier; downstream `seedAllRig`
 * merge logic must read `findDeformerById(project, id)?._userAuthored`
 * instead of `node._userAuthored` (the lookup spreads `data` so the
 * marker is exposed at the inflated-node top level — same surface UI
 * code used pre-strip).
 *
 * @module store/migrations/v30_strip_deformer_nodes
 */

import { migrateModifierDataFold } from './v28_modifier_data_fold.js';

/**
 * @param {object} project
 */
export function migrateStripDeformerNodes(project) {
  if (!project || !Array.isArray(project.nodes)) return;

  // Step 1 — idempotent v28 fold. Re-anchors any drifted modifier.data.
  migrateModifierDataFold(project);

  // Step 2 — orphan detection. Any deformer node not referenced by any
  // part's modifier stack will be lost on strip. Build the reference
  // set first.
  /** @type {Set<string>} */
  const referencedIds = new Set();
  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    for (const mod of part.modifiers) {
      if (mod && typeof mod.deformerId === 'string') {
        referencedIds.add(mod.deformerId);
      }
    }
  }
  const lostOrphans = [];
  for (const n of project.nodes) {
    if (!n || n.type !== 'deformer') continue;
    if (typeof n.id !== 'string') continue;
    if (!referencedIds.has(n.id)) {
      lostOrphans.push({ id: n.id, deformerKind: n.deformerKind ?? 'unknown' });
    }
  }
  if (lostOrphans.length > 0) {
    // Migration runs at load time before the in-app logger is wired.
    // Use console so the log surfaces in the dev console / CI output.
    // eslint-disable-next-line no-console
    console.warn(
      '[v30 migrateStripDeformerNodes] dropping never-in-stack deformers:',
      lostOrphans,
    );
  }

  // Step 3 — strip type:'deformer' from project.nodes (in-place compact).
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < project.nodes.length; readIdx++) {
    const n = project.nodes[readIdx];
    const drop = n && n.type === 'deformer';
    if (!drop) {
      if (writeIdx !== readIdx) project.nodes[writeIdx] = n;
      writeIdx++;
    }
  }
  project.nodes.length = writeIdx;
}
