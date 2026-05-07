// @ts-check

/**
 * BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.B — synthetic deformer-node
 * export pipeline.
 *
 * Inflates each part's `Object.modifiers[]` (with `modifier.data`
 * sub-object populated by Phase 3.A's v28 migration + the
 * `synthesizeModifierStacks` dual-write) into a transient
 * deformer-node tree structurally identical to today's
 * `project.nodes.filter(n => n.type === 'deformer')` result.
 *
 * Why: post-Phase-3.C `project.nodes` will no longer carry deformer
 * entries — the data lives only on `modifier.data`. The export
 * pipeline (`selectRigSpec` → `cmo3writer` / `moc3writer`) needs the
 * old node-shaped tree to keep working byte-identically. This synth
 * provides that view on demand.
 *
 * # Output shape
 *
 * Each synthesised node carries:
 *   - `type: 'deformer'`, `deformerKind: 'warp' | 'rotation'`
 *   - `id` — the modifier's `deformerId`
 *   - `parent` — id of the next modifier up the part's stack (the
 *     leaf-first stack convention means modifiers[i+1] is the parent
 *     of modifiers[i]). `null` for outermost.
 *   - All `modifier.data.*` fields spread in (`name`, `gridSize`,
 *     `keyforms`, `bindings`, …).
 *
 * Multiple parts can share a deformer (a body warp parents many
 * parts). The synth emits each unique deformer once, taking the
 * parent edge from the first part stack that referenced it. The
 * stacks built by `synthesizeModifierStacks` are consistent across
 * parts (they walk the same `node.parent` chain), so any part's
 * stack yields the same parent edges.
 *
 * # Pre-Phase-3.C compatibility
 *
 * While `node.type === 'deformer'` entries still exist in
 * `project.nodes` (Phase 3.A / 3.B state), this synth optionally
 * emits orphan deformer nodes that are NOT in any part's modifier
 * stack (so callers like `selectRigSpec` don't lose data on a
 * partially-rigged project).
 *
 * @module io/live2d/rig/synthesizeDeformerNodesForExport
 */

/**
 * @param {object} project
 * @param {{ includeOrphans?: boolean }} [opts]
 * @returns {Array<object>}  Array of synthetic `type:'deformer'` nodes.
 */
export function synthesizeDeformerNodesForExport(project, opts = {}) {
  if (!project || !Array.isArray(project.nodes)) return [];
  const includeOrphans = opts.includeOrphans !== false; // default true

  /** @type {Map<string, object>} */
  const byId = new Map();
  /** @type {Map<string, string|null>} */
  const parentEdges = new Map();

  for (const part of project.nodes) {
    if (!part || part.type !== 'part') continue;
    if (!Array.isArray(part.modifiers)) continue;
    const stack = part.modifiers;
    for (let i = 0; i < stack.length; i++) {
      const mod = stack[i];
      if (!mod || typeof mod.deformerId !== 'string') continue;
      const data = mod.data;
      // Without modifier.data we can't synthesise — fall back to the
      // existing deformer node below in the orphan pass.
      if (!data || typeof data !== 'object') continue;
      if (!byId.has(mod.deformerId)) {
        byId.set(mod.deformerId, {
          type: 'deformer',
          deformerKind: mod.type === 'rotation' ? 'rotation' : 'warp',
          id: mod.deformerId,
          ...data,
        });
      }
      // Parent edge — taken from the FIRST stack we see the deformer
      // in (subsequent stacks should agree per `synthesizeModifierStacks`).
      if (!parentEdges.has(mod.deformerId)) {
        const nextMod = stack[i + 1];
        const parent = (nextMod && typeof nextMod.deformerId === 'string')
          ? nextMod.deformerId : null;
        parentEdges.set(mod.deformerId, parent);
      }
    }
  }

  // Pre-Phase-3.C orphan pass: emit any deformer node that nobody
  // referenced in their stack (e.g. body warps not yet wired into a
  // part because the rigging isn't complete, or partially-stripped
  // re-rig states).
  if (includeOrphans) {
    for (const n of project.nodes) {
      if (!n || n.type !== 'deformer') continue;
      if (typeof n.id !== 'string') continue;
      if (byId.has(n.id)) continue;
      // Orphan — copy the node verbatim. Parent stays as authored.
      const copy = { ...n };
      byId.set(n.id, copy);
      parentEdges.set(n.id,
        typeof n.parent === 'string' ? n.parent : null);
    }
  }

  const synth = [];
  for (const [id, node] of byId) {
    node.parent = parentEdges.get(id) ?? null;
    synth.push(node);
  }
  return synth;
}
