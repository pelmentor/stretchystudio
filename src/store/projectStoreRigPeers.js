// @ts-check

/**
 * Lazy loader for projectStore's "rig-touch" peer modules — code that
 * runs only inside seedAllRig / loadProject / weight-paint actions,
 * never on the boot path.
 *
 * Phase A2 loading sweep (2026-05-09). Companion to
 * `projectStoreSeeds.js` — that one covers the seed/clear functions;
 * this covers the deformer-node sync + signature + weight + diagnostic
 * helpers. All seven modules deferred together because they're all
 * reached through the same async action paths.
 *
 * Production paths that need these helpers:
 *   - `seedAllRig(harvest)` — already async post seed-deferral.
 *   - `loadProject` — already async (file decode → migrations).
 *   - `applyWeightStrokeAction` / `ensureWeightGroupsForPart` — async
 *     after this refactor.
 *
 * @module store/projectStoreRigPeers
 */

/**
 * @typedef {Object} RigPeers
 * @property {(p: any) => any} computeProjectSignatures
 * @property {(mesh: any, boneGroups: any) => boolean} ensureWeightGroups
 * @property {(mesh: any, boneGroups: any) => void} syncBoneWeightsFromActive
 * @property {(mesh: any, updates: any, boneGroups: any) => void} applyWeightStroke
 * @property {(spec: any) => any} rotationSpecToDeformerNode
 * @property {(spec: any) => any} warpSpecToDeformerNode
 * @property {(nodes: any[], stored: any) => any} upsertWarpAsLattice
 * @property {(nodes: any[], node: any) => void} upsertDeformerNode
 * @property {(nodes: any[]) => void} removeAllRotationDeformerNodes
 * @property {(p: any) => void} synthesizeModifierStacks
 * @property {(p: any) => void} synthesizeDeformerParents
 * @property {(p: any, rigSpec: any, mode: string) => void} persistArtMeshRuntime
 * @property {(p: any) => any} findOrphanReferences
 * @property {(p: any) => any} findBindingSchemaDrift
 * @property {(p: any) => any} migrateProject
 */

/** @type {Promise<RigPeers> | null} */
let _rigPeersPromise = null;

/**
 * Load all rig-peer modules in parallel. Memoised — concurrent callers
 * share the same import promise.
 *
 * @returns {Promise<RigPeers>}
 */
export function loadRigPeers() {
  if (!_rigPeersPromise) {
    _rigPeersPromise = Promise.all([
      import('../io/meshSignature.js'),
      import('../io/live2d/rig/meshSync.js'),
      import('./deformerNodeSync.js'),
      import('./artMeshRuntimeSync.js'),
      import('../io/live2d/rig/paramReferences.js'),
      import('../io/live2d/rig/paramSchemaDrift.js'),
      import('./projectMigrations.js'),
    ]).then(([
      meshSignature, meshSync, deformerNodeSync, artMeshRuntimeSync,
      paramReferences, paramSchemaDrift, migrations,
    ]) => ({
      computeProjectSignatures: meshSignature.computeProjectSignatures,
      ensureWeightGroups: meshSync.ensureWeightGroups,
      syncBoneWeightsFromActive: meshSync.syncBoneWeightsFromActive,
      applyWeightStroke: meshSync.applyWeightStroke,
      rotationSpecToDeformerNode: deformerNodeSync.rotationSpecToDeformerNode,
      warpSpecToDeformerNode: deformerNodeSync.warpSpecToDeformerNode,
      upsertWarpAsLattice: deformerNodeSync.upsertWarpAsLattice,
      upsertDeformerNode: deformerNodeSync.upsertDeformerNode,
      removeAllRotationDeformerNodes: deformerNodeSync.removeAllRotationDeformerNodes,
      synthesizeModifierStacks: deformerNodeSync.synthesizeModifierStacks,
      synthesizeDeformerParents: deformerNodeSync.synthesizeDeformerParents,
      persistArtMeshRuntime: artMeshRuntimeSync.persistArtMeshRuntime,
      findOrphanReferences: paramReferences.findOrphanReferences,
      findBindingSchemaDrift: paramSchemaDrift.findBindingSchemaDrift,
      migrateProject: migrations.migrateProject,
    })).catch((err) => {
      _rigPeersPromise = null;
      throw err;
    });
  }
  return _rigPeersPromise;
}
