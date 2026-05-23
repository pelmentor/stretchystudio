// @ts-check

/**
 * Eye-closure variant-parabola eager prune — separated from
 * `eyeClosure.js` so the synchronous `deleteNode` hook in
 * `projectStore.js` can import it at the top level without dragging
 * the full eyeClosure module (`resolveEyeClosure`/`seedEyeClosure`)
 * into the eager bundle.
 *
 * # Why this is its own file
 *
 * `projectStore.js` is the main store module — eager-loaded at boot.
 * `eyeClosure.js` lives behind the `loadRigPeers()` lazy bridge
 * (`projectStoreRigPeers.js`) so its full surface only loads when
 * seedAllRig/loadProject run. Slice 3 (RULE №4 follow-up, commit
 * `f66bdb2`) added a `pruneOrphanedVariantParabolas` call inside
 * `deleteNode`'s synchronous Immer block. The Slice-3 architecture
 * audit (HIGH-1, 2026-05-23) flagged that placing the helper in
 * `eyeClosure.js` AND importing it top-level into `projectStore.js`
 * caused a dual-import: eager via projectStore + lazy via peers.
 *
 * Lifting the helper into this tiny file (no transitive deps beyond
 * what the prune itself reads) keeps the eager bundle minimal: only
 * the prune logic loads at boot; `resolveEyeClosure`/`seedEyeClosure`
 * stay behind the lazy peers bridge as before. Boot-path-isolation
 * contract restored; lazy bridge semantics intact.
 *
 * @module io/live2d/rig/eyeClosurePrune
 */

/**
 * Eagerly drop stored variant parabolas whose suffix is no longer
 * referenced by any part node in the project (RULE №4 Slice 3,
 * 2026-05-23; Blender-fidelity HIGH-5 follow-up to Slice 2).
 *
 * Closes the reference-counting integrity gap: pre-Slice-3,
 * `seedEyeClosure`'s next-Init-Rig REPLACE was the only cleanup —
 * a deleted variant's parabola sat in `project.eyeClosureParabolas
 * .variantParabolaPerSideAndSuffix['<side>|<suffix>']` until the
 * user re-Init-Rig'd. Now `deleteNode` calls this helper right
 * after pruning the node, so the variant map mirrors the live
 * suffix population moment-to-moment.
 *
 * # Orphaned-suffix detection
 *
 * A suffix is orphaned iff NO remaining part node carries either
 * `variantSuffix === <suffix>` OR `variantRole === <suffix>` (the
 * older alias kept by the cmo3writer prepass — see
 * `io/live2d/cmo3writer.js` variant-suffix discovery loop). Both
 * sides of the orphaned suffix (`l|<suffix>` AND `r|<suffix>`)
 * are pruned — the suffix is the lookup key, the side is
 * granularity-only.
 *
 * `baseParabolaPerSide` is NEVER touched here — it represents the
 * base eye geometry per side, orthogonal to variants.
 *
 * Pure + idempotent: running twice is identical to running once.
 *
 * @param {object|null|undefined} project - mutated in place
 */
export function pruneOrphanedVariantParabolas(project) {
  if (!project || typeof project !== 'object') return;
  const stored = project.eyeClosureParabolas;
  if (!stored || typeof stored !== 'object') return;
  const variantMap = stored.variantParabolaPerSideAndSuffix;
  if (!variantMap || typeof variantMap !== 'object') return;

  // Active-suffix set = union of (variantSuffix, variantRole) across
  // every part node. variantRole is the pre-2026-04-26 alias kept by
  // the cmo3writer for back-compat.
  const activeSuffixes = new Set();
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  for (const n of nodes) {
    if (!n || n.type !== 'part') continue;
    if (typeof n.variantSuffix === 'string' && n.variantSuffix.length > 0) {
      activeSuffixes.add(n.variantSuffix);
    }
    if (typeof n.variantRole === 'string' && n.variantRole.length > 0) {
      activeSuffixes.add(n.variantRole);
    }
  }

  for (const key of Object.keys(variantMap)) {
    // Keys are `<side>|<suffix>`; split on the FIRST '|' so suffixes
    // containing '|' (not expected, but defensive) survive intact.
    const sepIdx = key.indexOf('|');
    if (sepIdx < 0) continue;
    const suffix = key.slice(sepIdx + 1);
    if (!activeSuffixes.has(suffix)) {
      delete variantMap[key];
    }
  }
}
