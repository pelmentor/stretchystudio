// @ts-check

/**
 * v3 Phase 1C — Chain diagnostics walker.
 *
 * Mirrors the parent-chain walk that `chainEval.js` does, but without
 * actually transforming any positions. For each art mesh we report:
 *
 *   - `chainLength`        — how many parent steps were walked
 *   - `terminationKind`    — *why* the walk stopped:
 *       'root'             — parent.type === 'root'  (clean)
 *       'no_parent'        — meshSpec had no parent at all
 *       'unknown_parent'   — chain referenced a parent id missing from
 *                            warpDeformers + rotationDeformers (the
 *                            silent-failure case that produces v2 R6
 *                            "parts fly off")
 *       'cycle_or_deep'    — safety counter ran out (32 hops)
 *   - `finalFrame`         — the coord space the verts sit in when the
 *                            walk stops:
 *       'canvas-px'        — only if termination === 'root'
 *       'normalized-0to1'  — terminated inside a warp parent's input
 *       'pivot-relative'   — terminated inside a rotation parent's input
 *       'unknown'          — terminated before any chain step happened
 *   - `chainPath`          — list of `{id, kind}` for each parent walked,
 *                            top-down. Useful for the debugger overlay's
 *                            tooltip.
 *
 * Phase 1E uses this to identify exactly which art meshes have broken
 * chains — that's the residual cause of the "Phase -1B coord fix
 * incomplete" symptom on shelby.psd. Once the broken chain links are
 * named, the fix is one of:
 *
 *   (a) Repair the rigSpec so every parent is resolvable.
 *   (b) Have the renderer's `rigDrivenParts` opt-out only those parts
 *       whose chain DID terminate at root.
 *
 * Pure: no store reads, no side effects. Produces fresh data on every
 * call — meant for diagnostics, not the hot path.
 *
 * @module io/live2d/runtime/evaluator/chainDiagnose
 */

/**
 * @typedef {('root'|'no_parent'|'unknown_parent'|'cycle_or_deep')} TerminationKind
 *
 * @typedef {('canvas-px'|'normalized-0to1'|'pivot-relative'|'unknown')} FinalFrame
 *
 * @typedef {Object} ChainStep
 * @property {string} id
 * @property {('warp'|'rotation'|'unknown')} kind
 *
 * @typedef {Object} ChainDiagnosis
 * @property {string} partId
 * @property {number} chainLength
 * @property {TerminationKind} terminationKind
 * @property {FinalFrame} finalFrame
 * @property {ChainStep[]} chainPath
 */

/**
 * Walk every art mesh's parent chain and collect the diagnosis.
 *
 * @param {{
 *   warpDeformers?: Array<{id:string, parent?: {type:string,id?:string}}>,
 *   rotationDeformers?: Array<{id:string, parent?: {type:string,id?:string}}>,
 *   artMeshes?: Array<{id:string, parent?: {type:string,id?:string}}>,
 * } | null | undefined} rigSpec
 * @returns {ChainDiagnosis[]}
 */
export function diagnoseRigChains(rigSpec) {
  if (!rigSpec || !Array.isArray(rigSpec.artMeshes)) return [];

  /** @type {Map<string, {kind:'warp'|'rotation', spec:any}>} */
  const index = new Map();
  for (const d of rigSpec.warpDeformers ?? []) {
    if (d?.id) index.set(d.id, { kind: 'warp', spec: d });
  }
  for (const d of rigSpec.rotationDeformers ?? []) {
    if (d?.id) index.set(d.id, { kind: 'rotation', spec: d });
  }

  /** @type {ChainDiagnosis[]} */
  const out = [];
  for (const mesh of rigSpec.artMeshes) {
    if (!mesh?.id) continue;
    out.push(diagnoseOneMesh(mesh, index));
  }
  return out;
}

/**
 * @param {any} meshSpec
 * @param {Map<string, {kind:'warp'|'rotation', spec:any}>} index
 * @returns {ChainDiagnosis}
 */
function diagnoseOneMesh(meshSpec, index) {
  /** @type {ChainStep[]} */
  const path = [];
  let parent = meshSpec.parent;

  // No parent at all = chain length 0, frame is whatever evalArtMesh
  // produced — caller assumes it's the parent-of-mesh frame, but
  // there's no parent. Tag this distinct from the failed-walk case.
  if (!parent) {
    return {
      partId: meshSpec.id,
      chainLength: 0,
      terminationKind: 'no_parent',
      finalFrame: 'unknown',
      chainPath: [],
    };
  }

  let safety = 32;
  /** @type {TerminationKind} */
  let term = 'cycle_or_deep';
  // The TYPE we were aiming at when the walk stopped — this is what
  // names the frame the verts live in at exit. After applying step N's
  // transform, verts are in step (N+1)'s input domain, which is
  // determined by step (N+1).type.
  /** @type {string|null} */
  let unresolvedType = null;

  while (parent && parent.type !== 'root' && safety-- > 0) {
    if (!parent.id) {
      term = 'unknown_parent';
      path.push({ id: '<missing-id>', kind: 'unknown' });
      unresolvedType = parent.type ?? null;
      break;
    }
    const entry = index.get(parent.id);
    if (!entry) {
      term = 'unknown_parent';
      path.push({ id: parent.id, kind: 'unknown' });
      unresolvedType = parent.type ?? null;
      break;
    }
    path.push({ id: parent.id, kind: entry.kind });
    parent = entry.spec.parent;
  }

  // safety counter exhausted without break → cycle_or_deep stays.
  // parent.type === 'root' OR parent === null → clean termination.
  if (term === 'cycle_or_deep' && (!parent || parent?.type === 'root')) {
    term = 'root';
  } else if (term === 'cycle_or_deep') {
    // Hit safety limit. Verts are still mid-chain in whatever the
    // current `parent.type` declares — record it so the overlay can
    // colour the part the same as a broken chain.
    unresolvedType = parent?.type ?? null;
  }

  // finalFrame: where do the verts sit when the walk stopped?
  // The convention from chainEval: at the start of any iteration,
  // verts are in `parent`'s INPUT domain (mesh keyform output is in
  // mesh.parent's input domain; each warp/rotation step maps from
  // its own input to its output = the next parent's input). So:
  //
  //   - clean termination at root → verts in canvas-px (root's domain)
  //   - any other termination → verts in `unresolvedType`'s domain
  //
  // This covers both cases: immediate failure on mesh.parent (path
  // length 0) AND failure mid-chain (path length > 0). The unresolved
  // parent's *declared* type tells us the frame regardless of whether
  // the parent was actually resolvable.
  /** @type {FinalFrame} */
  let finalFrame = 'unknown';
  if (term === 'root') {
    finalFrame = 'canvas-px';
  } else if (unresolvedType === 'warp') {
    finalFrame = 'normalized-0to1';
  } else if (unresolvedType === 'rotation') {
    finalFrame = 'pivot-relative';
  }
  // term === 'no_parent' OR unresolvedType is null/odd → 'unknown'.

  return {
    partId: meshSpec.id,
    chainLength: path.length,
    terminationKind: term,
    finalFrame,
    chainPath: path,
  };
}

/**
 * Roll-up over a diagnosis array — useful for a one-line status line
 * in the overlay HUD.
 *
 * @param {ChainDiagnosis[]} diags
 * @returns {{
 *   total: number,
 *   clean: number,
 *   broken: number,
 *   noParent: number,
 *   cycle: number,
 *   brokenIds: string[]
 * }}
 */
export function summarizeDiagnoses(diags) {
  const out = {
    total: diags.length,
    clean: 0,
    broken: 0,
    noParent: 0,
    cycle: 0,
    /** @type {string[]} */
    brokenIds: [],
  };
  for (const d of diags) {
    if (d.terminationKind === 'root') out.clean++;
    else if (d.terminationKind === 'unknown_parent') {
      out.broken++;
      out.brokenIds.push(d.partId);
    } else if (d.terminationKind === 'no_parent') out.noParent++;
    else if (d.terminationKind === 'cycle_or_deep') out.cycle++;
  }
  return out;
}
