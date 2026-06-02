import { create } from 'zustand';
import { produce } from 'immer';
import { pushSnapshot, isBatching, clearHistory } from './undoHistory.js';
import { useParamValuesStore } from './paramValuesStore.js';
// Phase A2 (2026-05-09) — `CURRENT_SCHEMA_VERSION` lives in a tiny
// side-effect-free file so reading the constant doesn't drag the 11
// migration modules onto the eager path. `migrateProject` itself is
// loaded via `loadRigPeers` only on `loadProject`.
import { CURRENT_SCHEMA_VERSION } from './projectSchemaVersion.js';
// RULE №4 Slice 3 audit-fix HIGH-1 (2026-05-23): import from the
// tiny `eyeClosurePrune.js` module — NOT from `eyeClosure.js` (which
// stays behind the `loadRigPeers()` lazy bridge for
// resolveEyeClosure/seedEyeClosure). Direct top-level import of
// `eyeClosure.js` here caused a dual-import: eager (via this
// projectStore) + lazy (via peers). The split file keeps the boot
// path light AND lets deleteNode call the prune synchronously.
import { pruneOrphanedVariantParabolas } from '../io/live2d/rig/eyeClosurePrune.js';
// Phase A2 — seed modules + rig-peer modules dynamically loaded on
// first action call. See `projectStoreSeeds.js` + `projectStoreRigPeers.js`.
// All production paths reaching these (seedAllRig / loadProject /
// weight paint) are async, so awaiting the import is mechanical.
import { loadSeedModule } from './projectStoreSeeds.js';
import { loadRigPeers } from './projectStoreRigPeers.js';
import {
  getMesh,
  isMeshedPart,
  isBoneGroup,
  setObjectMode,
  setBonePose,
} from './objectDataAccess.js';
import { logger } from '../lib/logger.js';
import { uid } from '../lib/ids.js';
import {
  fcurveTargetsParam,
  fcurveTargetsNode,
  renameFCurveParam,
  renameFCurveNode,
  decodeFCurveTarget,
} from '../anim/animationFCurve.js';
import {
  deleteAction as registryDeleteAction,
  assignAction as registryAssignAction,
  unassignAction as registryUnassignAction,
  cloneAction as registryCloneAction,
} from '../anim/actionRegistry.js';
import { useAnimationStore } from './animationStore.js';

/**
 * Revoke every `blob:` URL the project owns — texture sources +
 * audio track sourceUrls. Run BEFORE overwriting `state.project` in
 * `resetProject` / `loadProject` so the previous project's blobs are
 * released back to the browser; otherwise Chrome holds an entire
 * PSD-worth of texture blobs (50-200 MB) per project switch.
 *
 * Non-blob sources (data:, https://, file paths in pre-loaded
 * snapshots) are left alone — `URL.revokeObjectURL` no-ops on those
 * but we skip the call to avoid the warning noise.
 */
function disposeProjectResources(project) {
  if (!project) return;
  const revoke = (url) => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); }
      catch { /* defensive — revoke shouldn't throw, but non-fatal */ }
    }
  };
  for (const tex of project.textures ?? []) revoke(tex?.source);
  for (const action of project.actions ?? []) {
    for (const track of action.audioTracks ?? []) revoke(track?.sourceUrl);
  }
}
import { coerceNumberArray } from '../lib/numberArrayCoerce.js';
import { computeWorldMatrices } from '../renderer/transforms.js';

/**
 * Deep clone an object, preserving TypedArrays.
 * Safe for use with Immer draft proxies.
 */
/**
 * Whether `n` is a node that hosts parameter `bindings[]` — rotation
 * deformers (`type:'deformer'`) AND lattice/warp objects (`type:'object',
 * objectKind:'lattice'`, v43). Param-cascade walks (remove/rename) must
 * cover both so a deleted/renamed param doesn't leave dangling
 * `parameterId` refs in lattice warp bindings.
 *
 * @param {object|null|undefined} n
 * @returns {boolean}
 */
function _nodeHasParamBindings(n) {
  if (!n || !Array.isArray(n.bindings)) return false;
  return n.type === 'deformer' || (n.type === 'object' && n.objectKind === 'lattice');
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Float32Array) return new Float32Array(obj);
  if (obj instanceof Uint16Array) return new Uint16Array(obj);
  if (obj instanceof Uint32Array) return new Uint32Array(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

export const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

// Project store (The .stretch model, undoable)
export const useProjectStore = create((set, get) => {
  // Helper that lifts a `(project, ...args) => void` mutator function
  // into a zustand action with the standard ritual:
  //   1. Snapshot the pre-mutation project for undo (unless mid-batch).
  //   2. Run the function under immer's `produce` so its mutations
  //      are structurally shared.
  //   3. Mark hasUnsavedChanges.
  //
  // The 14 seed/clear actions below used to inline this 4-line ritual;
  // 56 LOC of cargo-cult plus 14 places to forget the snapshot guard.
  // Now there's one place. (Phase 0F.9 / Pillar A.)
  /** @param {(project: any, ...args: any[]) => void} fn */
  const projectMutator = (fn) => (/** @type {any[]} */ ...args) =>
    set((state) => {
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        fn(draft.project, ...args);
        draft.hasUnsavedChanges = true;
      });
    });

  return {
  project: {
    version: "0.1",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' },
    /** Toolset Phase 7.A.1 (schema v33) — canvas-space 3D-cursor for the
     *  Snap menu (`Shift+S`). Default = canvas centre. Read+written by
     *  `object.snap.*` operators. Persisted per-project (Blender stores it
     *  on `Scene.cursor.location`; SS does the same on `project.cursor`). */
    cursor: { x: 400, y: 300 },
    textures: [],     // { id, source (data URI or Blob URL) }
    /** Animation Phase 1 Stage 1.D (schema v37) — fresh projects start
     *  with the `__scene__` pseudo-Object pre-created so action-binding
     *  works on day one (Init Rig is not a prerequisite). The shape
     *  here MUST match `migrations/v37_scene_anim_data.makeSceneNode()`
     *  — kept in sync with the migration's source-of-truth shape. */
    nodes: [
      {
        id: '__scene__',
        type: 'scene',
        name: 'Scene',
        parent: null,
        animData: {
          actionId: null,
          actionInfluence: 1,
          actionBlendmode: 'replace',
          actionExtendmode: 'hold',
          slotHandle: 0,
          nlaTracks: [],
          drivers: [],
          flag: 0,
          // v42 Slice 4.A — NLA tweak-mode backup pointers. Mirror of
          // makeSceneNode()'s animData defaults; drift-checked by
          // scripts/test/test_migration_v37.mjs §"Drift safety".
          tmpActionId: null,
          tmpSlotHandle: 0,
          tweakTrackId: null,
          tweakStripId: null,
        },
      },
    ],
    /*
      Node schema (type === 'part'):
      {
        id:         string,
        type:       'part',
        name:       string,
        parent:     string | null,      // id of parent group, or null
        draw_order: number,
        opacity:    number (0–1),
        visible:    boolean,
        clip_mask:  string | null,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        meshOpts:   { alphaThreshold, smoothPasses, gridSpacing, edgePadding, numEdgePoints } | null,
        mesh:       { vertices, uvs, triangles, edgeIndices } | null,
        blendShapes: [{ id, name, deltas: [{dx, dy}], pinDeltas: [{pinId, dx, dy}] | null }] | null,
        blendShapeValues: { [shapeId]: number (0–1) },             // staging-mode influences
      }

      Node schema (type === 'group'):
      {
        id:         string,
        type:       'group',
        name:       string,
        parent:     string | null,
        opacity:    number (0–1),
        visible:    boolean,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        // NO draw_order — groups are never drawn directly.
        // Render order is determined solely by part.draw_order values.
      }
    */
    parameters: [],
    physics_groups: [],
    actions: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    // BFA-006 Phase 6 — legacy `faceParallax` / `bodyWarp` / `rigWarps`
    // sidetables deleted. Deformers now live in `project.nodes` as
    // `type:'deformer'` entries; the body warp's layout + debug
    // metadata persists here in the small `bodyWarpLayout` sidetable
    // (the canvas→innermost normalizer closures need persisted
    // ranges that can't be recovered from baseGrids alone).
    bodyWarpLayout: null,
    meshSignatures: {},
    lastInitRigCompletedAt: null,
    rigStageLastRunAt: {},
  },

  // Versions used to trigger rendering passes independently of React
  versionControl: {
    geometryVersion: 0,
    transformVersion: 0,
    textureVersion: 0,
  },

  hasUnsavedChanges: false,

  /**
   * Phase 1G — id of the IndexedDB library record this project was last
   * loaded from / saved to. When non-null, the next "Save to Library"
   * overwrites that record instead of creating a new one. Cleared on
   * `file.new` and on `loadProject`-from-disk so a fresh project starts
   * unlinked from the library. Library save sets it to the new record's
   * id; library load sets it to the loaded record's id.
   *
   * @type {string|null}
   */
  currentLibraryId: null,
  setCurrentLibraryId: (/** @type {string|null} */ id) => set({ currentLibraryId: id }),

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Generic immer recipe — use for all undoable project edits.
   *  Auto-snapshots before mutation unless { skipHistory: true } is passed. */
  updateProject: (recipe, { skipHistory = false } = {}) => set((state) => {
    let hasUnsavedChanges = state.hasUnsavedChanges;
    if (!skipHistory && !isBatching()) {
      pushSnapshot(state.project);
      hasUnsavedChanges = true;
    }
    return produce((state) => {
      state.hasUnsavedChanges = hasUnsavedChanges;
      recipe(state.project, state.versionControl);
    })(state);
  }),

  setHasUnsavedChanges: (val) => set({ hasUnsavedChanges: val }),

  /** Create a new empty group node */
  createGroup: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    state.project.nodes.push({
      id:        uid(),
      type:      'group',
      name:      name ?? 'Group',
      parent:    null,
      transform: DEFAULT_TRANSFORM(),
      visible:   true,
      opacity:   1,
    });
    state.versionControl.transformVersion++;
  })),

  /**
   * Reparent a node to a new parent (or to root if newParentId is null).
   * Never touches draw_order.
   *
   * BVR-006 — validates against cycles + obviously-bad type pairings:
   *   - reparent to self → no-op
   *   - reparent to a descendant (cycle) → no-op
   *   - bone → part parent → no-op (parts can't own bones)
   *
   * Pushes an undo snapshot ON SUCCESS only — rejected reparents
   * (cycle / dangling / type mismatch) are no-ops and don't pollute
   * the undo stack. Exposed as a user gesture by BVR-006 (Outliner
   * drag-reparent), so a misplaced drop now has a clean Ctrl+Z path.
   *
   * Returns nothing; caller can read `project.nodes` after to verify.
   */
  reparentNode: (nodeId, newParentId) => set((state) => {
    const nodes = state.project.nodes;
    if (!Array.isArray(nodes)) return state;
    const node = nodes.find((n) => n?.id === nodeId);
    if (!node) return state;
    if (newParentId === nodeId) return state; // self-parenting
    const newParent = newParentId ? (nodes.find((n) => n?.id === newParentId) ?? null) : null;
    if (newParentId && !newParent) return state; // dangling target
    // Cycle: walk newParent's ancestry; if nodeId appears anywhere, reject.
    if (newParent) {
      let cursor = /** @type {any} */ (newParent);
      const guard = new Set();
      while (cursor) {
        if (cursor.id === nodeId) return state;
        if (guard.has(cursor.id)) break;
        guard.add(cursor.id);
        cursor = cursor.parent ? nodes.find((n) => n?.id === cursor.parent) : null;
      }
    }
    // Type compatibility: bones can't be children of parts (parts have
    // no skeleton role, can't own bones). Other pairings are permitted —
    // a part under another part is rare but legal (PSD layer convention).
    const isBone = node.type === 'group' && !!node.boneRole;
    if (isBone && newParent && newParent.type === 'part') return state;
    // No-op short-circuit: parent already correct.
    if ((node.parent ?? null) === (newParentId ?? null)) return state;
    // Validation passed — snapshot for undo, then mutate.
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const n = draft.project.nodes.find((nn) => nn?.id === nodeId);
      if (n) n.parent = newParentId ?? null;
      draft.hasUnsavedChanges = true;
      draft.versionControl.transformVersion++;
    });
  }),
  /**
   * Action CRUD (v36 Action datablock — Animation Phase 1).
   *
   * Pre-v36 these mutated `project.animations[]` and were named
   * createAnimation / renameAnimation / deleteAnimation. The schema
   * flip renamed the slot to `project.actions[]`; the methods follow
   * suit. Stage 1.C added `src/anim/actionRegistry.js` for the
   * reference-style helpers (assignAction, unassignAction, cloneAction,
   * getActionUsers, deleteAction). All write thunks here delegate to
   * the registry so the project-shape cascades (assignAction's slot
   * write, deleteAction's animData cascade) run unconditionally. The
   * deleteAction thunk additionally resets
   * `useAnimationStore.activeActionId` when the deleted id matches —
   * audit-fix G-3 closing the cross-store dangling-pointer gap.
   */
  createAction: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const id = uid();
    state.project.actions.push({
      id,
      name:        name ?? `Action ${state.project.actions.length + 1}`,
      duration:    2000,
      fps:         24,
      fcurves:     [],
      audioTracks: [],
      flag:        0,
      meta:        { createdAt: null, modifiedAt: null, source: 'authored' },
    });
  })),

  renameAction: (id, newName) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const action = state.project.actions.find(a => a.id === id);
    if (action) action.name = newName;
  })),

  deleteAction: (id) => {
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      registryDeleteAction(state.project, id);
    }));
    // Audit-fix G-3: reset the UI store's active action when it
    // pointed at the deleted id. Without this, every consumer of
    // activeActionId (~10 surfaces — Timeline, Dopesheet, FCurve
    // editor, etc.) would silently no-op on the stale id.
    const animState = useAnimationStore.getState();
    if (animState.activeActionId === id) {
      animState.setActiveActionId(null);
    }
  },

  assignAction: (objectId, actionId, slot = 0) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    registryAssignAction(state.project, objectId, actionId, slot);
  })),

  unassignAction: (objectId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    registryUnassignAction(state.project, objectId);
  })),

  /**
   * Clone an action via the registry; returns the FULL cloned action
   * object (or null on miss) so callers don't need an extra
   * `actions.find(...)` scan post-set. (Audit-fix G-10 Stage 1.E —
   * pre-fix the thunk discarded the registry's full-object return
   * shape and returned only the id, contradicting the registry's own
   * Audit-fix G-5 Stage 1.C which lifted the return shape from id →
   * object precisely to spare callers that scan.)
   *
   * The clone the thunk returns is the immer-finalised object (not the
   * draft proxy) so it is safe to capture in React state and persists
   * after the `produce` callback completes.
   */
  cloneAction: (actionId, newName) => {
    /** @type {object|null} */
    let createdId = null;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const clone = registryCloneAction(state.project, actionId, newName);
      createdId = clone ? clone.id : null;
    }));
    if (createdId === null) return null;
    // Re-resolve the post-finalised entry from the freshly-set state
    // so the returned reference is NOT the immer draft (which is
    // revoked after `produce` returns).
    const finalActions = get().project.actions ?? [];
    return finalActions.find((a) => a && a.id === createdId) ?? null;
  },

  /** Create a new blend shape on a part node */
  createBlendShape: (nodeId, name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    const mesh = getMesh(node, state.project);
    if (!mesh) return;
    const id = uid();
    const deltas = mesh.vertices.map(() => ({ dx: 0, dy: 0 }));
    if (!node.blendShapes) node.blendShapes = [];
    if (!node.blendShapeValues) node.blendShapeValues = {};
    node.blendShapes.push({ id, name: name ?? 'Key', deltas });
    node.blendShapeValues[id] = 0;
    state.versionControl.geometryVersion++;
  })),

  /** Delete a blend shape from a part node */
  deleteBlendShape: (nodeId, shapeId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (node.blendShapes) {
      node.blendShapes = node.blendShapes.filter(s => s.id !== shapeId);
    }
    if (node.blendShapeValues) {
      delete node.blendShapeValues[shapeId];
    }
    state.versionControl.geometryVersion++;
  })),

  /** Set the influence value of a blend shape in staging mode */
  setBlendShapeValue: (nodeId, shapeId, value) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node && node.blendShapeValues) {
      node.blendShapeValues[shapeId] = Math.max(0, Math.min(1, value));
      state.versionControl.geometryVersion++;
    }
  })),

  /** Update the deltas of a blend shape (used by edit mode brush) */
  updateBlendShapeDeltas: (nodeId, shapeId, deltas) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const shape = node.blendShapes?.find(s => s.id === shapeId);
    if (shape) {
      shape.deltas = deltas;
      state.versionControl.geometryVersion++;
    }
  })),

  // ── Parameter CRUD (V4 Phase 2 — Param editor polish) ────────────
  // All actions write through the immer recipe so they're undoable.
  // Mutations stamp `_userAuthored: true` so the entry survives Init
  // Rig 'merge' (paramSpec.seedParameters honours the marker).
  // Cascading remove/rename walks every place a paramId can appear:
  //   - deformer node bindings (`node.bindings[].parameterId`)
  //   - animation tracks (`anim.tracks[].paramId`)
  //   - physics rules (`rule.inputs[].paramId`)
  // Keyforms aren't expanded/collapsed on key add/remove — that's
  // Track 3 (Keyform editor) territory; keys stored on the param drive
  // the next Init Rig regen, and the existing keyforms stay until then.

  /**
   * Add a new parameter. Stamps `_userAuthored: true` so the entry
   * survives Init Rig 'merge'. Returns true on success, false if the
   * id collides with an existing param.
   *
   * @param {{
   *   id: string,
   *   name?: string,
   *   role?: string,
   *   min?: number,
   *   max?: number,
   *   default?: number,
   *   decimalPlaces?: number,
   *   keys?: number[],
   * }} spec
   */
  addParameter: (spec) => {
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    const params = get().project?.parameters ?? [];
    if (params.some((p) => p?.id === spec.id)) return false;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const min = typeof spec.min === 'number' ? spec.min : 0;
      const max = typeof spec.max === 'number' ? spec.max : 1;
      const def = typeof spec.default === 'number' ? spec.default : Math.min(Math.max(0, min), max);
      const keys = coerceNumberArray(spec.keys, `addParameter[${spec.id}].keys`);
      state.project.parameters = state.project.parameters ?? [];
      state.project.parameters.push({
        id:   spec.id,
        name: spec.name ?? spec.id,
        role: spec.role ?? 'custom',
        min,
        max,
        default: def,
        decimalPlaces: typeof spec.decimalPlaces === 'number' ? spec.decimalPlaces : 2,
        keys,
        _userAuthored: true,
        _userAuthoredKeys: keys.slice(),
      });
    }));
    return true;
  },

  /**
   * Remove a parameter and cascade-drop every reference. Drops:
   *   - matching deformer bindings
   *   - matching animation tracks
   *   - matching physics rule inputs
   * Existing keyforms whose keyTuple includes a key on the dropped
   * param are NOT touched — they're left orphan in the deformer node
   * and Init Rig regenerates them on the next pass. (See V4 plan §4
   * Risks — keyform editor track owns the live collapse.)
   */
  removeParameter: (paramId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const proj = state.project;
    proj.parameters = (proj.parameters ?? []).filter((p) => p?.id !== paramId);
    for (const n of proj.nodes ?? []) {
      // Bindings live on rotation deformers AND lattice (warp) objects (v43).
      if (!_nodeHasParamBindings(n)) continue;
      n.bindings = n.bindings.filter((b) => b?.parameterId !== paramId);
    }
    for (const action of proj.actions ?? []) {
      if (!Array.isArray(action?.fcurves)) continue;
      action.fcurves = action.fcurves.filter((fc) => !fcurveTargetsParam(fc, paramId));
    }
    for (const rule of proj.physicsRules ?? []) {
      if (!Array.isArray(rule?.inputs)) continue;
      rule.inputs = rule.inputs.filter((inp) => inp?.paramId !== paramId);
    }
  })),

  /**
   * Rename a parameter id. Cascades the rename through deformer
   * bindings, animation tracks, and physics rule inputs. No-op if
   * `oldId === newId`. Returns false if `newId` collides with another
   * existing param. Stamps `_userAuthored: true` on the renamed entry.
   */
  renameParameter: (oldId, newId) => {
    if (typeof oldId !== 'string' || typeof newId !== 'string') return false;
    if (newId.length === 0) return false;
    if (oldId === newId) return true;
    const params = get().project?.parameters ?? [];
    if (params.some((p) => p?.id === newId)) return false;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const proj = state.project;
      const param = (proj.parameters ?? []).find((p) => p?.id === oldId);
      if (!param) return;
      param.id = newId;
      param._userAuthored = true;
      for (const n of proj.nodes ?? []) {
        // Bindings live on rotation deformers AND lattice (warp) objects (v43).
        if (!_nodeHasParamBindings(n)) continue;
        for (const b of n.bindings) {
          if (b?.parameterId === oldId) b.parameterId = newId;
        }
      }
      for (const action of proj.actions ?? []) {
        for (const fc of action?.fcurves ?? []) {
          renameFCurveParam(fc, oldId, newId);
        }
      }
      for (const rule of proj.physicsRules ?? []) {
        for (const inp of rule?.inputs ?? []) {
          if (inp?.paramId === oldId) inp.paramId = newId;
        }
      }
    }));
    return true;
  },

  /**
   * Patch fields on an existing parameter. Whitelisted fields only:
   * name, min, max, default, decimalPlaces, role. Stamps
   * `_userAuthored: true` on first patch. No cascade — just field
   * edits.
   */
  patchParameter: (paramId, partial) => set(produce((state) => {
    if (!partial || typeof partial !== 'object') return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    if (typeof partial.name === 'string')          param.name = partial.name;
    if (typeof partial.role === 'string')          param.role = partial.role;
    if (typeof partial.min === 'number')           param.min = partial.min;
    if (typeof partial.max === 'number')           param.max = partial.max;
    if (typeof partial.default === 'number')       param.default = partial.default;
    if (typeof partial.decimalPlaces === 'number') param.decimalPlaces = partial.decimalPlaces;
    param._userAuthored = true;
  })),

  /**
   * Add a breakpoint key value to a parameter. Idempotent
   * (epsilon-equal values dedup). Sorts ascending. Tracks the new
   * value in `_userAuthoredKeys` so Init Rig 'merge' preserves it.
   * Does NOT expand existing deformer keyforms — Track 3 owns that.
   */
  addParamKey: (paramId, value) => set(produce((state) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    const EPS = 1e-6;
    const keys = coerceNumberArray(param.keys, `addParamKey[${paramId}].param.keys`);
    if (!keys.some((k) => Math.abs(k - value) < EPS)) {
      keys.push(value);
      keys.sort((a, b) => a - b);
      param.keys = keys;
    }
    const userKeys = coerceNumberArray(param._userAuthoredKeys, `addParamKey[${paramId}].param._userAuthoredKeys`);
    if (!userKeys.some((k) => Math.abs(k - value) < EPS)) {
      userKeys.push(value);
      userKeys.sort((a, b) => a - b);
      param._userAuthoredKeys = userKeys;
    }
    param._userAuthored = true;
  })),

  /**
   * Remove a breakpoint key value from a parameter. Removes from both
   * `keys` and `_userAuthoredKeys` (if it was user-added). Does NOT
   * collapse existing deformer keyforms — they stay until the next
   * Init Rig pass regenerates the keyform list.
   */
  removeParamKey: (paramId, value) => set(produce((state) => {
    if (typeof value !== 'number') return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    const EPS = 1e-6;
    if (Array.isArray(param.keys)) {
      param.keys = param.keys.filter((k) => Math.abs(k - value) >= EPS);
    }
    if (Array.isArray(param._userAuthoredKeys)) {
      param._userAuthoredKeys = param._userAuthoredKeys.filter((k) => Math.abs(k - value) >= EPS);
    }
    param._userAuthored = true;
  })),

  /**
   * Toggle the `_userAuthored` lock flag on a parameter. When set,
   * Init Rig 'merge' mode preserves the parameter verbatim (range,
   * default, keys, role unchanged). 'replace' mode still clobbers.
   */
  setParameterUserAuthored: (paramId, on) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    if (on) param._userAuthored = true;
    else delete param._userAuthored;
  })),

  // ── Weight paint (V4 Phase 4b) ────────────────────────────────────
  // All actions write through immer so they're undoable. They migrate
  // legacy `mesh.boneWeights` + `mesh.jointBoneId` into the modern
  // `mesh.weightGroups` + `mesh.activeWeightGroup` shape on first
  // touch, then mirror the active group's weights back into
  // `mesh.boneWeights` so the cmo3 export pipeline stays unchanged
  // (single-bone export preserved per plan §6 scope cut).

  /**
   * Ensure a part's mesh has the weightGroups shape. Idempotent.
   * Used as the first step of entering weight paint mode (so the
   * brush has something to paint into) and by `setActiveWeightGroup`
   * before swapping the active.
   */
  ensureWeightGroupsForPart: async (partId) => {
    const peers = await loadRigPeers();
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const node = state.project.nodes.find((n) => n?.id === partId);
      const mesh = getMesh(node, state.project);
      if (!mesh) return;
      const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
      if (peers.ensureWeightGroups(mesh, boneGroups)) {
        peers.syncBoneWeightsFromActive(mesh, boneGroups);
      }
    }));
  },

  /**
   * Switch the active weight group on a part. Auto-migrates if needed
   * (so the user can pick "set active" before painting). Mirrors the
   * new active group into legacy `mesh.boneWeights`.
   */
  setActiveWeightGroup: async (partId, groupName) => {
    const peers = await loadRigPeers();
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const node = state.project.nodes.find((n) => n?.id === partId);
      const mesh = getMesh(node, state.project);
      if (!mesh) return;
      const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
      peers.ensureWeightGroups(mesh, boneGroups);
      if (typeof groupName !== 'string' || !mesh.weightGroups?.[groupName]) return;
      mesh.activeWeightGroup = groupName;
      peers.syncBoneWeightsFromActive(mesh, boneGroups);
    }));
  },

  /**
   * Toolset Plan Phase 7.B.4 — set the per-Object X-axis live mirror
   * toggle. When on, paint strokes are reflected through the object's
   * mid-X axis. Per `node.weightPaintSettings.xMirror` (schema v34;
   * Blender stores the equivalent on `Mesh.symmetry & ME_SYMMETRY_X`).
   *
   * Snapshots for undo so toggle flips are reversible (Blender's
   * `Mesh.use_mirror_x` is a property write that goes through the
   * operator system → undo stack the same way).
   *
   * No-op when the part doesn't exist or already carries the requested
   * value. weightPaintSettings is auto-created if missing (older v34
   * loads with the field absent on a new node added post-migration).
   */
  setWeightPaintXMirror: (partId, value) => set((state) => {
    const node = state.project.nodes.find((n) => n?.id === partId);
    if (!node || node.type !== 'part') return state;
    const cur = node.weightPaintSettings?.xMirror ?? false;
    const next = !!value;
    if (cur === next) return state;
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const target = draft.project.nodes.find((n) => n?.id === partId);
      if (!target) return;
      if (!target.weightPaintSettings || typeof target.weightPaintSettings !== 'object') {
        target.weightPaintSettings = { xMirror: next };
      } else {
        target.weightPaintSettings.xMirror = next;
      }
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Toolset Plan Phase 7.B — bulk weight write. Replaces the named
   * weight group's array with `nextWeights` (must be vertex-count long;
   * mismatched lengths are ignored as a safety guard against caller
   * bugs after a topology change). Used by the Mirror Weights operator
   * (one snapshot for the whole mirror op rather than per-vertex
   * `paintWeightStroke` calls) and Normalize All (writes multiple
   * groups in sequence inside a beginBatch).
   *
   * Single immer commit; `pushSnapshot` runs unless inside a batch.
   * If `groupName` is the active group, `mesh.boneWeights` is also
   * mirrored so the cmo3 export pipeline picks up the change. The
   * sync is inlined (sister to `peers.syncBoneWeightsFromActive`) so
   * this stays synchronous — `mirrorWeights` and `normalizeAllWeights`
   * are operator-dispatched without await, so they need the new state
   * observable on the very next render.
   *
   * @param {string} partId
   * @param {string} groupName  - which weight group to overwrite
   * @param {number[]} nextWeights
   */
  setWeightGroup: (partId, groupName, nextWeights) => {
    if (typeof partId !== 'string') return;
    if (typeof groupName !== 'string') return;
    if (!Array.isArray(nextWeights)) return;
    set((state) => {
      const node = state.project.nodes.find((n) => n?.id === partId);
      const meshIn = getMesh(node, state.project);
      if (!meshIn) return state;
      const w = meshIn.weightGroups?.[groupName];
      if (!Array.isArray(w) || w.length !== nextWeights.length) return state;
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        const target = draft.project.nodes.find((n) => n?.id === partId);
        const mesh = getMesh(target, draft.project);
        if (!mesh) return;
        const arr = mesh.weightGroups?.[groupName];
        if (!Array.isArray(arr) || arr.length !== nextWeights.length) return;
        for (let i = 0; i < arr.length; i++) {
          let v = Number(nextWeights[i]);
          if (!Number.isFinite(v)) v = 0;
          if (v < 0) v = 0; if (v > 1) v = 1;
          arr[i] = v;
        }
        if (mesh.activeWeightGroup === groupName) {
          // Inline `syncBoneWeightsFromActive` (meshSync.js:102-115) so
          // we don't need an async peers fetch — keeps setWeightGroup
          // synchronous for operator-dispatched mirror/normalize callers.
          mesh.boneWeights = arr.slice();
        }
        draft.hasUnsavedChanges = true;
      });
    });
  },

  /**
   * Phase 2b storage flip — write the per-object `Object.mode` field on
   * the named node (Blender-compatible per-object mode storage; today's
   * `editorStore.editMode` slot remains the read source-of-truth, but
   * this dual-write means project state carries the mode record so
   * future readers can switch over without a data migration).
   *
   * Pass `null` to clear the field (= Object Mode, the default).
   * Caller is editorStore's `enterEditMode` / `exitEditMode`. No-op when
   * nodeId is missing, or when the node is gone (deleted between
   * selection and call). Snapshots for undo via `projectMutator`-style
   * inline ritual — the immer recipe pushes the snapshot before mutation.
   *
   * Note: this action does NOT bump versionControl counters because the
   * Object.mode field doesn't influence geometry, params, or rig output;
   * it's pure UI state mirrored into the project for persistence.
   *
   * @param {string|null} nodeId
   * @param {*} mode  see modeCompat.js for valid values
   */
  setActiveObjectMode: (nodeId, mode) => {
    if (typeof nodeId !== 'string' || nodeId.length === 0) return;
    set((state) => {
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        const node = draft.project.nodes.find((n) => n?.id === nodeId);
        if (!node) return;
        setObjectMode(node, mode);
        draft.hasUnsavedChanges = true;
      });
    });
  },

  /**
   * Apply a brush stroke's per-vertex updates to the active weight
   * group. Updates is `[{ vertexIndex, weight }]`. Mirrors back to
   * `mesh.boneWeights` automatically. Called many times per stroke;
   * each call is one immer commit (undo restores per-stroke
   * granularity).
   */
  paintWeightStroke: async (partId, updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const peers = await loadRigPeers();
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const node = state.project.nodes.find((n) => n?.id === partId);
      const mesh = getMesh(node, state.project);
      if (!mesh) return;
      const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
      peers.ensureWeightGroups(mesh, boneGroups);
      peers.applyWeightStroke(mesh, updates, boneGroups);
      // NOTE: do NOT bump geometryVersion here. Weights are not geometry —
      // bumping it invalidates rigSpec on every paint commit, which makes
      // the live-preview physics tick rebuild physicsState every frame
      // (resetting accumulated pendulum velocity). The mesh vertex array
      // hasn't changed, so the rig is still valid.
    }));
  },

  /**
   * Blender's "Apply Pose As Rest" — bake every bone's pose offset
   * into descendant rest data and zero all bone poses simultaneously.
   *
   * After this, the current visual state IS the new rest pose:
   *   - Mesh `restX/restY` (and `x/y`) are updated to the canvas-space
   *     positions the meshes were previously rendered at (with poses
   *     active). Render at zero pose now matches pre-bake render.
   *   - Each bone's `transform.pivotX/pivotY` shifts to the joint's
   *     visually-current canvas-space position. Future bone arc drags
   *     rotate around the right point.
   *   - All bones' `pose` fields zero out.
   *
   * Driver-param bones (arms / elbows / head — anything with a
   * `ParamRotation_<role>` param) keep their pose at zero by contract,
   * so this action is a no-op for them. Their rotation lives in
   * params and the rig deformer chain; that wiring is untouched.
   *
   * Why all poses must zero simultaneously: rotation around point A by
   * angle α composed with rotation around point B by angle β isn't a
   * rotation by (α+β) around any C derivable from A and B alone. If we
   * baked one bone at a time leaving descendant poses in place, the
   * descendant pose centers shift but their rotations don't compose
   * correctly. Zero-all-at-once + bake cumulative world matrices into
   * mesh rest sidesteps that — meshes carry the cumulative transform
   * directly in canvas-space.
   *
   * Bumps `geometryVersion` so `rigSpecStore` invalidates and rebuilds
   * against the new rest. Idle motions / animation deltas computed
   * relative to mesh rest will see the new baseline; existing keyframe
   * tracks targeting bone poses still fire (they target node id +
   * prop name, neither of which changed).
   */
  /**
   * BVR-004 — Armature Edit Mode parent translate.
   * Shifts a bone's `transform.pivotX/Y` by `(dx, dy)`; **descendants
   * follow** by applying the same delta to their pivots so the rest
   * topology stays rigid. Mirrors Blender's Edit Mode "G" on a parent
   * bone — children move in lockstep.
   *
   * Pure-rest write: only `transform.pivotX/Y` are touched. `node.pose`
   * is untouched. Children's `pose` is untouched too — descendant-
   * follow is rest-frame-only.
   *
   * @param {string} nodeId — id of the bone to translate
   * @param {number} dx — canvas-px delta on X
   * @param {number} dy — canvas-px delta on Y
   */
  shiftBonePivot: (nodeId, dx, dy) => set(produce((state) => {
    const project = state.project;
    const nodes = project.nodes ?? [];
    if (nodes.length === 0) return;
    if (typeof dx !== 'number' || typeof dy !== 'number') return;
    if (dx === 0 && dy === 0) return;
    const start = nodes.find((n) => n?.id === nodeId);
    if (!start || start.type !== 'group' || !start.boneRole) return;
    // Walk descendants once (BFS) so we touch every bone whose chain
    // includes the dragged bone. Non-bone descendants don't carry
    // pivots — skip them, but DO descend through them so a bone child
    // separated by a plain group still moves.
    /** @type {Map<string, string[]>} */
    const childrenById = new Map();
    for (const n of nodes) {
      if (!n?.parent) continue;
      let bucket = childrenById.get(n.parent);
      if (!bucket) { bucket = []; childrenById.set(n.parent, bucket); }
      bucket.push(n.id);
    }
    const queue = [nodeId];
    const visited = new Set();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const n = nodes.find((nn) => nn?.id === cur);
      if (n && n.type === 'group' && n.boneRole) {
        if (!n.transform) {
          n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        }
        n.transform.pivotX = (n.transform.pivotX ?? 0) + dx;
        n.transform.pivotY = (n.transform.pivotY ?? 0) + dy;
      }
      const kids = childrenById.get(cur) ?? [];
      for (const kid of kids) queue.push(kid);
    }
    // Pivot is rest-frame; bump geometryVersion so rigSpec invalidates.
    state.versionControl.geometryVersion++;
  })),

  applyPoseAsRest: () => {
    set(produce((state) => {
    const project = state.project;
    const nodes = project.nodes ?? [];
    if (nodes.length === 0) return;

    const worldMap = computeWorldMatrices(nodes);

    // 1. Bake each part's world matrix into its mesh rest verts. The
    //    world matrix already incorporates every ancestor bone's pose,
    //    so this captures the cumulative transform in canvas-space.
    //
    // # The hasArmatureMod gate (2026-05-09)
    //
    // Post-Cubism-Adapter (Phase 2 — overlay path deleted), only
    // parts with an active Armature modifier visually follow bone
    // pose at render time (`CanvasViewport.jsx:817-834` → LBS overlay
    // when `composition.kind === 'lbs'`). Parts without the modifier
    // render at chainEval's canvas-px output verbatim — bone pose
    // doesn't move them. So rebasing their mesh.vertices here would
    // produce a SILENT visual jump on Apply Pose As Rest (rest now
    // points to a position the part never visually was).
    //
    // The gate also fixes the Apply Modifier → Apply Pose As Rest
    // composition: post-Apply parts have already absorbed the pose
    // into mesh.vertices (LBS bake) AND have their modifier removed.
    // Step 1 without the gate would re-rotate them by the still-
    // non-zero parent bone pose, producing a double-rotated rest.
    // Same gate as Step 1b below (which already had this fix for the
    // bone-baked-keyform code path).
    let bakedAnything = false;
    for (const n of nodes) {
      const nMesh = getMesh(n, project);
      if (!isMeshedPart(n, project) || !nMesh || !Array.isArray(nMesh.vertices)) continue;
      const hasArmatureMod = Array.isArray(n.modifiers)
        && n.modifiers.some((mod) => mod?.type === 'armature' && mod.enabled !== false);
      if (!hasArmatureMod) continue;
      const m = worldMap.get(n.id);
      if (!m) continue;
      // Skip if the matrix is identity — nothing to bake on this part.
      const isIdentity =
           Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[1])     < 1e-6
        && Math.abs(m[3])     < 1e-6 && Math.abs(m[4] - 1) < 1e-6
        && Math.abs(m[6])     < 1e-6 && Math.abs(m[7])     < 1e-6;
      if (isIdentity) continue;
      for (const v of nMesh.vertices) {
        if (!v) continue;
        const rx = (typeof v.restX === 'number') ? v.restX : v.x;
        const ry = (typeof v.restY === 'number') ? v.restY : v.y;
        const nx = m[0] * rx + m[3] * ry + m[6];
        const ny = m[1] * rx + m[4] * ry + m[7];
        v.restX = nx;
        v.restY = ny;
        v.x     = nx;
        v.y     = ny;
      }
      bakedAnything = true;
    }

    // 1b. Replace `mesh.runtime` with a minimal canvas-px entry on
    //     armature-mod parts whose mesh.vertices Step 1 just rebased.
    //
    // 2026-05-09 (afternoon): an earlier version of this code did a
    // linear-only in-place bake (`vp[i] = m0*x + m3*y`) which assumed
    // keyforms were in joint-bone-pivot-relative frame — they're
    // actually in PARENT-DEFORMER-LOCAL frame (see
    // `selectRigSpec._buildArtMeshes` frame-conversion logic — the
    // warp/rotation/canvas branches under "Frame-convert canvas-px
    // verts → parent-deformer-local"). Linear-only is correct only when
    // the parent deformer's pivot coincides with the joint bone's
    // pivot (limb case). For non-limb rigid-intent parts (handwear,
    // face-region under a non-coincident parent), the formula rotated
    // around the wrong center.
    //
    // The very next iteration tried `delete meshN.runtime` so
    // `selectRigSpec`'s pre-rig fallback would regenerate. But that
    // path frame-converts the rebased canvas-px verts into the
    // warp's [0..1] normalised space using the warp's REST bbox —
    // posed verts can land far outside [0..1], producing the
    // user-reported "arm disappears" bug.
    //
    // Structurally correct fix (same as `applyArmatureModifier`
    // 2026-05-09): write a minimal runtime entry with `parent=root`
    // and a single rest keyform holding the baked canvas-px verts
    // verbatim. selectRigSpec's runtime-cache fast path emits them
    // directly with no frame conversion. Multi-angle bone-baked
    // keyforms collapse to 1 — Apply Pose As Rest is destructive
    // (the user's choice to bake the pose into rest), so per-slider
    // animation curves are intentionally lost; recover via
    // re-Init-Rig.
    for (const n of nodes) {
      if (n.type !== 'part') continue;
      const meshN = getMesh(n, project);
      if (!meshN || !meshN.runtime) continue;
      const hasArmatureMod = Array.isArray(n.modifiers)
        && n.modifiers.some((m) => m?.type === 'armature' && m.enabled !== false);
      if (!hasArmatureMod) continue;
      const verts = Array.isArray(meshN.vertices) ? meshN.vertices : null;
      if (!verts || verts.length === 0) continue;
      const flat = new Array(verts.length * 2);
      for (let i = 0; i < verts.length; i++) {
        flat[i * 2]     = verts[i].x;
        flat[i * 2 + 1] = verts[i].y;
      }
      // M3.3 (RULE-№4, 2026-05-23): `runtime.parent` is no longer
      // persisted — the chain leaf is derived from `part.modifiers[0]`
      // (selectRigSpec) and project topology (synthesizeModifierStacks
      // via `findInnermostBodyWarpId`). v47 migration strips the field
      // from any pre-M3.3 save on load.
      meshN.runtime = {
        bindings: [],
        keyforms: [{
          keyTuple: [],
          vertexPositions: flat,
          opacity: 1,
        }],
      };
      bakedAnything = true;
    }

    // 2. Update each bone's pivot to its visually-current canvas
    //    position. We compute this in the bone's PARENT's frame: the
    //    pivot is stored relative to the parent's coordinate system,
    //    but post-bake every parent bone has identity world (pose
    //    zero, rest identity-modulo-pivot which IS identity for any
    //    input point), so parent's frame collapses to canvas.
    //    Therefore the new pivot in parent's frame = the pivot's
    //    canvas position with pre-bake poses.
    for (const n of nodes) {
      if (!isBoneGroup(n)) continue;
      const m = worldMap.get(n.id);
      if (!m) continue;
      // Apply the bone's WORLD matrix to its own pivot. The pivot is
      // an input in the bone's local frame (which is parent's frame
      // under our flat-canvas model); world maps that to canvas.
      const px = n.transform?.pivotX ?? 0;
      const py = n.transform?.pivotY ?? 0;
      const newPx = m[0] * px + m[3] * py + m[6];
      const newPy = m[1] * px + m[4] * py + m[7];
      if (!n.transform) {
        n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
      }
      n.transform.pivotX = newPx;
      n.transform.pivotY = newPy;
    }

    // 3. Zero all bone poses simultaneously.
    for (const n of nodes) {
      setBonePose(n, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 });
    }

    if (bakedAnything) {
      state.versionControl.geometryVersion++;
    }
    state.hasUnsavedChanges = true;
    }));
    // Bone-mirror sync: applyPoseAsRest just zeroed every bone's
    // pose.rotation, but `paramValuesStore.values[ParamRotation_<bone>]`
    // is a separate map kept consistent via the bone-mirror intercept.
    // Direct bone mutations (like the produce block above) bypass the
    // intercept, so we re-read the bones into the values map here.
    useParamValuesStore.getState().syncFromProject();
  },

  /** Reset project to empty state */
  resetProject: () => {
    disposeProjectResources(useProjectStore.getState().project);
    clearHistory();
    return set(produce((state) => {
      state.project.canvas   = { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' };
      state.project.textures = [];
      // Audit-fix G-1 (Stage 1.D): the v37 `__scene__` synthetic must
      // survive resetProject — without re-seeding it here, "File → New"
      // leaves the project without a scene host until reload. Shape
      // matches the initial-state literal at line ~135 (drift safety
      // net at `scripts/test/test_migration_v37.mjs`).
      state.project.nodes    = [
        {
          id: '__scene__',
          type: 'scene',
          name: 'Scene',
          parent: null,
          animData: {
            actionId: null,
            actionInfluence: 1,
            actionBlendmode: 'replace',
            actionExtendmode: 'hold',
            slotHandle: 0,
            nlaTracks: [],
            drivers: [],
            flag: 0,
            // v42 Slice 4.A — NLA tweak-mode backup pointers. Mirror of
            // makeSceneNode()'s animData defaults; drift-checked by
            // scripts/test/test_migration_v37.mjs §"Drift safety".
            tmpActionId: null,
            tmpSlotHandle: 0,
            tweakTrackId: null,
            tweakStripId: null,
          },
        },
      ];
      state.project.parameters = [];
      state.project.physics_groups = [];
      state.project.actions = [];
      state.project.maskConfigs = [];
      state.project.physicsRules = [];
      state.project.boneConfig = null;
      state.project.variantFadeRules = null;
      state.project.eyeClosureConfig = null;
      // RULE №4 Slice 2 audit-fix (MED-2): clear persisted parabolas
      // on reset so the next character's first Init Rig starts from a
      // clean slate. Without this the previous character's `l`/`r`
      // parabola survives `resetProject` (Immer mutates in place) and
      // gets consumed by any pre-Init-Rig export for the new project.
      // Lazy-init semantics: undefined means "fit fresh next time".
      state.project.eyeClosureParabolas = undefined;
      state.project.rotationDeformerConfig = null;
      state.project.autoRigConfig = null;
      // BFA-006 Phase 6 — legacy sidetables deleted; deformer nodes
      // live in `project.nodes`. resetProject's `state.project.nodes = []`
      // above already clears them. The body warp's layout sidetable:
      state.project.bodyWarpLayout = null;
      state.project.rigStageLastRunAt = {};
      // F1 — fresh project resets cursor to canvas centre, matching the
      // v33 migration seed.
      state.project.cursor = {
        x: (state.project.canvas?.width ?? 800) / 2,
        y: (state.project.canvas?.height ?? 600) / 2,
      };
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
      // Phase 1G — fresh project unlinks from any library record so the
      // next save creates a new record rather than overwriting one.
      state.currentLibraryId = null;
    }));
  },

  /** Load a deserialized project from file */
  loadProject: async (projectData) => {
    disposeProjectResources(useProjectStore.getState().project);
    // Phase A2 — `migrateProject` + `findBindingSchemaDrift` come from
    // the lazy rig-peers loader. Project loads happen on user gesture
    // (file pick / drag-drop), so awaiting the import is mechanical.
    const peers = await loadRigPeers();
    // Idempotent — the file loader (projectFile.loadProject) has already
    // migrated, but call again here to defend against direct callers.
    peers.migrateProject(projectData);
    clearHistory();
    // BUG-023 instrumentation — surface paramOrphans + deformer/part counts
    // at load time so when the user reports "rig dead after reload" we
    // already have the failure mode logged. Cheap walk, fires once per load.
    {
      const paramIds = new Set((projectData.parameters ?? []).map((p) => p?.id).filter(Boolean));
      const orphans = [];
      let deformerCount = 0;
      let partWithMeshCount = 0;
      for (const n of projectData.nodes ?? []) {
        if (n?.type === 'deformer') {
          deformerCount++;
          for (const b of n.bindings ?? []) {
            if (b?.parameterId && !paramIds.has(b.parameterId)) {
              orphans.push({ nodeId: n.id, parameterId: b.parameterId });
            }
          }
        } else if (n?.type === 'part' && getMesh(n, projectData)?.vertices) {
          partWithMeshCount++;
        }
      }
      logger.info('loadProject', `nodes=${projectData.nodes?.length ?? 0} parts=${partWithMeshCount} deformers=${deformerCount} params=${paramIds.size} initRigDone=${!!projectData.lastInitRigCompletedAt}`, {
        partWithMeshCount,
        deformerCount,
        paramCount: paramIds.size,
        lastInitRigCompletedAt: projectData.lastInitRigCompletedAt ?? null,
      });
      if (orphans.length > 0) {
        logger.warn('paramOrphans', `${orphans.length} binding(s) reference unknown params on load`, { orphans });
      }
      // Hole I-2: binding-vs-param schema drift. Detects bindings whose
      // `keys` no longer match the param's current `keys`, or whose
      // keys fall outside the param's [min, max] range. Drift can sit
      // in a saved project when the user edited a param via V4 Track 2
      // and saved without re-running Init Rig.
      const drift = peers.findBindingSchemaDrift(projectData);
      if (drift.length > 0) {
        logger.warn(
          'paramSchemaDrift',
          `${drift.length} binding(s) drifted from their param schema on load; re-Init Rig to refresh`,
          { drift },
        );
      }
    }
    return set(produce((state) => {
      state.project.version = projectData.version;
      state.project.schemaVersion = projectData.schemaVersion;
      state.project.canvas = projectData.canvas;
      state.project.textures = projectData.textures;
      state.project.nodes = projectData.nodes;
      state.project.actions = projectData.actions;
      state.project.parameters = projectData.parameters;
      state.project.physics_groups = projectData.physics_groups;
      state.project.maskConfigs = projectData.maskConfigs;
      state.project.physicsRules = projectData.physicsRules;
      state.project.boneConfig = projectData.boneConfig;
      state.project.variantFadeRules = projectData.variantFadeRules;
      state.project.eyeClosureConfig = projectData.eyeClosureConfig;
      state.project.rotationDeformerConfig = projectData.rotationDeformerConfig;
      // Stage 1b: previously-dropped fields. Loading a `.stretch` saved
      // after a rig init would silently lose its keyform stores; the
      // generator path then re-fired on every export, masking the loss.
      state.project.autoRigConfig = projectData.autoRigConfig ?? null;
      // BFA-006 Phase 6 — `faceParallax` / `bodyWarp` / `rigWarps`
      // sidetables deleted; deformer state lives in `project.nodes`
      // (loaded via `state.project.nodes = projectData.nodes` above).
      // Body warp layout/debug stays as the small dedicated sidetable:
      state.project.bodyWarpLayout = projectData.bodyWarpLayout ?? null;
      // GAP-012 step 2: meshSignatures captured at last seedAllRig.
      // Load preserves them verbatim; the StaleRigBanner re-validates
      // against current node geometry on every render.
      state.project.meshSignatures = projectData.meshSignatures ?? {};
      // Hole I-8: explicit Init Rig completion marker. Null on legacy
      // saves; exporter's seeded-state check falls back to the old
      // heuristic when the marker is missing.
      state.project.lastInitRigCompletedAt = projectData.lastInitRigCompletedAt ?? null;
      state.project.rigStageLastRunAt = projectData.rigStageLastRunAt ?? {};
      // F1 — restore 2D cursor (canvas-space). Falls back to canvas centre
      // when absent (legacy save before saveProject persisted the field).
      {
        const cw = projectData.canvas?.width ?? 800;
        const ch = projectData.canvas?.height ?? 600;
        state.project.cursor = projectData.cursor ?? { x: cw / 2, y: ch / 2 };
      }
      // Phase 1G — disk-loaded projects start unlinked from any library
      // record. The library-load operator sets `currentLibraryId` itself
      // after this call so a "save" goes back to the correct record.
      state.currentLibraryId = null;
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
    }));
  },

  /**
   * Seed `project.parameters` from the auto-rig generator (Stage 1).
   * Destructive: overwrites whatever was there. The seeder runs the
   * generator path of `buildParameterSpec` and stores its full output,
   * after which the export pipeline takes the native rig path for
   * parameters (no synthesis).
   *
   * Snapshots history so the user can undo.
   */
  // Phase A2 — async wrappers. Each lazy-loads the seed module on first
  // call; subsequent calls share the resolved import via the memo in
  // `projectStoreSeeds.loadSeedModule`. RigService.runStage already
  // awaits these via `store[action](...)` since runStage itself is async.
  seedParameters:             async (...args) => projectMutator((await loadSeedModule()).seedParameters)(...args),

  /**
   * Seed `project.maskConfigs` from the auto-rig heuristic (Stage 3).
   * Iris↔eyewhite pairings (variant-aware) are baked into project state.
   * Destructive: overwrites whatever was there.
   */
  seedMaskConfigs:            async (...args) => projectMutator((await loadSeedModule()).seedMaskConfigs)(...args),

  /**
   * Seed `project.physicsRules` from DEFAULT_PHYSICS_RULES (Stage 6).
   * boneOutputs are resolved against the project's groups (boneRole
   * lookup) and flattened into outputs[]. Destructive.
   */
  seedPhysicsRules:           async (...args) => projectMutator((await loadSeedModule()).seedPhysicsRules)(...args),

  /**
   * Seed `project.boneConfig` from defaults (Stage 7). Currently sets
   * `bakedKeyformAngles` to [-90, -45, 0, 45, 90]. Destructive.
   */
  seedBoneConfig:             async (...args) => projectMutator((await loadSeedModule()).seedBoneConfig)(...args),

  /**
   * Seed `project.variantFadeRules` from defaults (Stage 5). Currently
   * sets `backdropTags` to the canonical Hiyori-style list (face, ears,
   * front+back hair). Destructive.
   */
  seedVariantFadeRules:       async (...args) => projectMutator((await loadSeedModule()).seedVariantFadeRules)(...args),

  /**
   * Seed `project.eyeClosureConfig` from defaults (Stage 5). Currently
   * sets per-side eyelash/eyewhite/irides closureTags + lashStripFrac=0.06
   * + binCount=6. Destructive.
   */
  seedEyeClosureConfig:       async (...args) => projectMutator((await loadSeedModule()).seedEyeClosureConfig)(...args),

  /**
   * Seed `project.rotationDeformerConfig` from defaults (Stage 8). Sets
   * `skipRotationRoles=['torso','eyes','neck']`, `paramAngleRange=±30`,
   * `groupRotation` 1:1 ±30, `faceRotation` ±10° on ±30 keys. Destructive.
   */
  seedRotationDeformerConfig: async (...args) => projectMutator((await loadSeedModule()).seedRotationDeformerConfig)(...args),

  /**
   * Seed `project.autoRigConfig` from defaults (Stage 2). Three sections —
   * bodyWarp (HIP/FEET fallbacks, BX/BY/Breath margins, upper-body shape),
   * faceParallax (depth coefficients, protection per tag, eye/squash amps,
   * super-groups), neckWarp (tilt fraction). Destructive.
   */
  seedAutoRigConfig:          async (...args) => projectMutator((await loadSeedModule()).seedAutoRigConfig)(...args),

  /**
   * Upsert the FaceParallax warp deformer node in `project.nodes`
   * from a pre-computed `WarpDeformerSpec`. Caller produces the spec
   * — typically via `buildFaceParallaxSpec(...)` with current mesh /
   * bbox / pivot inputs. Destructive: overwrites the prior node by
   * id `'FaceParallaxWarp'`.
   *
   * BFA-006 Phase 6 — formerly wrote `project.faceParallax`; the
   * legacy sidetable was deleted by migration v16.
   */
  seedFaceParallax:           async (...args) => projectMutator((await loadSeedModule()).seedFaceParallax)(...args),

  /**
   * Remove the FaceParallax warp deformer node from `project.nodes`.
   * Use after PSD reimport invalidates stored vertex deltas — the
   * heuristic generator will re-synthesise it on the next Init Rig.
   */
  clearFaceParallax:          async (...args) => projectMutator((await loadSeedModule()).clearFaceParallax)(...args),

  /**
   * Upsert the body warp chain (BZ → BY → Breath → optional BX) into
   * `project.nodes` as deformer nodes, plus write
   * `project.bodyWarpLayout` (the canvas → innermost-warp normalizer
   * ranges). Caller produces the chain — typically via
   * `buildBodyWarpChain(...)`. Destructive: replaces all four chain
   * nodes (or three if no BX) by id.
   *
   * BFA-006 Phase 6 — formerly wrote the full chain to
   * `project.bodyWarp`; that sidetable was deleted by migration v16.
   * Layout/debug now persist in the small `project.bodyWarpLayout`
   * sidetable since the closures need ranges that can't be recovered
   * from chained `baseGrid`s alone.
   */
  seedBodyWarp:               async (...args) => projectMutator((await loadSeedModule()).seedBodyWarpChain)(...args),

  /**
   * Remove all body-warp-chain deformer nodes from `project.nodes`
   * and null out `project.bodyWarpLayout`. Use after PSD reimport
   * invalidates stored vertex deltas or body silhouette anchors —
   * the heuristic generator will rebuild on the next Init Rig.
   */
  clearBodyWarp:              async (...args) => projectMutator((await loadSeedModule()).clearBodyWarp)(...args),

  /**
   * Upsert per-mesh rigWarp deformer nodes (those with
   * `targetPartId` set) into `project.nodes` from a pre-computed
   * `partId → spec` map (or iterable of specs). Caller is typically
   * a rig-init flow that runs `generateCmo3` once and harvests
   * `rigSpec.warpDeformers` filtered to per-mesh entries.
   * Destructive: replaces every prior rigWarp node whose
   * `targetPartId` is in the incoming map.
   *
   * BFA-006 Phase 6 — formerly wrote `project.rigWarps[partId]`;
   * that sidetable was deleted by migration v16. Each part's leaf
   * modifier entry (`modifiers[0]`) is written so the runtime selector
   * (`selectRigSpec`) resolves the per-part chain without walking
   * rigSpec. (Pre-M4 RULE-№4 this site also wrote `part.rigParent` as
   * a Cubism-shaped mirror; the field is now derived-only and v48
   * strips it from persisted saves.)
   */
  seedRigWarps:               async (...args) => projectMutator((await loadSeedModule()).seedRigWarps)(...args),

  /**
   * Remove all rigWarp deformer nodes (those with `targetPartId`)
   * from `project.nodes` and clear every part's leaf modifier entry
   * (`modifiers[0]`). Use after PSD reimport invalidates stored
   * per-vertex deltas or any binding-axis change.
   */
  clearRigWarps:              async (...args) => projectMutator((await loadSeedModule()).clearRigWarps)(...args),

  /**
   * Stage 1b — orchestrator that seeds every native-rig store from a
   * single harvest pass. Caller (UI: v3 ParametersEditor "Initialize Rig"
   * button → RigService.initializeRig) supplies the harvest result from
   * `initializeRigFromProject(project, images)`. Single snapshot covers
   * all writes so undo reverts the whole init in one step.
   *
   * **Mode (V3 Re-Rig Phase 0):**
   *   - `'replace'` (default, back-compat): full destructive re-init —
   *     what "Re-Init Rig" + StaleRigBanner do today.
   *   - `'merge'`: preserves user-authored entries on conflict-surface
   *     fields (maskConfigs, physicsRules, faceParallax, bodyWarp,
   *     rigWarps); used by Phase 1's per-stage refit + "Refit All" UI.
   *     `subsystems` is preserved in BOTH modes (the headline Phase 0 fix).
   *
   * In merge mode, `clearFaceParallax` / `clearBodyWarp` / `clearRigWarps`
   * are bypassed — clearing a slot the user hasn't authored is fine, but
   * we don't want a missing-value harvest to wipe a user's authored spec.
   *
   * @param {{
   *   faceParallaxSpec: object|null,
   *   bodyWarpChain: object|null,
   *   rigWarps: Map<string,object>,
   * }} harvest
   * @param {'replace'|'merge'} [mode='replace']
   */
  seedAllRig: async (harvest, mode = 'replace') => {
    // Phase A2 — pre-load the seed module + rig peers BEFORE the immer
    // recipe runs. immer's `produce` recipes must be sync; we resolve
    // all needed functions up front and then call them inside the recipe.
    const [seeds, peers] = await Promise.all([
      loadSeedModule(),
      loadRigPeers(),
    ]);
    set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const proj = draft.project;
      // Config-only seeders (no keyforms). Pure defaults; merge==replace.
      // V4 Phase 2 — `seedParameters` honours `mode` so user-authored
      // params + user-added keys survive Init Rig 'merge'.
      seeds.seedParameters(proj, mode);
      seeds.seedMaskConfigs(proj, mode);
      seeds.seedPhysicsRules(proj, mode);
      seeds.seedBoneConfig(proj);
      seeds.seedVariantFadeRules(proj);
      seeds.seedEyeClosureConfig(proj);
      seeds.seedRotationDeformerConfig(proj);
      seeds.seedAutoRigConfig(proj, mode);
      // Keyform-bearing seeders. Each only fires when the harvester
      // actually produced a value — buildBodyWarpChain returns null for
      // models without ParamBodyAngleZ/Y, faceParallax is null when no
      // face-tagged meshes exist, etc.
      if (harvest?.faceParallaxSpec) {
        seeds.seedFaceParallax(proj, harvest.faceParallaxSpec, mode);
      } else if (mode === 'replace') {
        seeds.clearFaceParallax(proj);
      }
      if (harvest?.bodyWarpChain) {
        seeds.seedBodyWarpChain(proj, harvest.bodyWarpChain, mode);
      } else if (mode === 'replace') {
        seeds.clearBodyWarp(proj);
      }
      if (harvest?.rigWarps && harvest.rigWarps.size > 0) {
        seeds.seedRigWarps(proj, harvest.rigWarps, mode);
      } else if (mode === 'replace') {
        seeds.clearRigWarps(proj);
      }
      // BFA-006 Phase 6 fallout — NeckWarp dual-write. Pre-Phase-6
      // the NeckWarp deformer was dropped on the floor (lived only
      // in rigSpec). Post-Phase-6 every per-part rigWarp under it
      // carries `parent: 'NeckWarp'`, so without persisting the
      // NeckWarp itself, export validation fails with ORPHAN_PARENT
      // and the runtime can't resolve the chain. Mirrors the
      // faceParallax dual-write — single deformer, by-id upsert,
      // merge mode preserves a user-authored entry when present.
      if (Array.isArray(proj.nodes)) {
        if (harvest?.neckWarpSpec) {
          if (mode === 'merge') {
            // v43 — the NeckWarp may already be a lattice cage OBJECT (a
            // migrated project); recognise both shapes so a user-authored
            // entry isn't silently overwritten on every merge re-rig.
            const prior = proj.nodes.find(
              (n) => n && n.id === harvest.neckWarpSpec.id
                && (n.type === 'deformer'
                  || (n.type === 'object' && n.objectKind === 'lattice'))
            );
            if (!prior || prior._userAuthored !== true) {
              // Phase 5 — emit a Blender-Lattice object (+ cage), not a legacy
              // `deformer/warp` node, so NeckWarp matches every other warp.
              peers.upsertWarpAsLattice(proj.nodes, harvest.neckWarpSpec);
            }
          } else {
            peers.upsertWarpAsLattice(proj.nodes, harvest.neckWarpSpec);
          }
        } else if (mode === 'replace') {
          // No NeckWarp this run (faceRig opt-out, or no neck-tagged
          // meshes). Drop any stale entry so children aren't orphaned.
          // Route through removeDeformerNodesByPredicate so a lattice-object
          // NeckWarp's cage meshData is cleaned up too (v43).
          peers.removeDeformerNodesByPredicate(proj.nodes, (n) => n.id === 'NeckWarp');
        }
      }
      // BFA-006 Phase 3 — dual-write rotation deformer nodes from the
      // harvest's rigSpec so `selectRigSpec(project)` picks them up
      // alongside the warp deformer nodes that Phase 1 already
      // dual-writes via the seedXxx warp seeders. Rotation deformers
      // were never persisted in sidetables (they're (re)generated
      // every Init Rig); this write is what closes the post-load
      // "click Init Rig to rebuild" gap once the project's been
      // through one Init Rig pass under Phase 3+.
      //
      // Replace mode wipes all prior rotation nodes before upserting
      // the harvest output. Merge mode preserves _userAuthored
      // entries by id (same semantics the warp dual-writes use).
      const rotationDeformers = harvest?.rigSpec?.rotationDeformers ?? [];
      if (Array.isArray(proj.nodes)) {
        if (mode === 'replace') {
          peers.removeAllRotationDeformerNodes(proj.nodes);
        } else {
          // Merge mode: drop only the rotations being overwritten;
          // _userAuthored survivors stay in place.
          const incomingIds = new Set(rotationDeformers.map((r) => r?.id).filter(Boolean));
          for (let i = proj.nodes.length - 1; i >= 0; i--) {
            const n = proj.nodes[i];
            if (n?.type !== 'deformer' || n.deformerKind !== 'rotation') continue;
            if (incomingIds.has(n.id) && n._userAuthored !== true) {
              proj.nodes.splice(i, 1);
            }
          }
        }
        for (const spec of rotationDeformers) {
          if (!spec || !spec.id) continue;
          if (mode === 'merge') {
            const prior = proj.nodes.find(
              (n) => n && n.id === spec.id && n.type === 'deformer'
            );
            if (prior && prior._userAuthored === true) continue;
          }
          peers.upsertDeformerNode(proj.nodes, peers.rotationSpecToDeformerNode(spec));
        }
      }
      // GAP-012 Phase A — capture per-mesh fingerprint at seed time so
      // PSD reimport can detect when stored vertex-indexed keyforms have
      // gone stale (mesh re-mesh changes vertex order/count, breaking
      // positional indexing of `keyform.positions`). Detection only:
      // `validateProjectSignatures(project)` returns the divergence
      // report; consumer (UI banner) decides what to do.
      proj.meshSignatures = peers.computeProjectSignatures(proj);
      // Drop `ParamRotation_<g>` entries whose owning rotation deformer
      // was pruned as a dead-end orphan in `pruneOrphanRotationDeformers`
      // (initRig.js). seedParameters above synthesises one per non-bone,
      // non-skipped group; harvest knows which of those rotations have
      // no mesh chain through them and reports the corresponding
      // parameter ids back here. Without this, the slider sits in the
      // Parameters panel driving nothing (Rotation_root, Rotation_bothLegs,
      // Rotation_<arm> when handwear has no boneWeights yet, etc.).
      const droppedParamIds = harvest?.droppedParamIds;
      if (Array.isArray(droppedParamIds) && droppedParamIds.length > 0) {
        const dropSet = new Set(droppedParamIds);
        // V4 Phase 2 — keep user-authored params even if their owning
        // rotation deformer was pruned as orphan. Auto-seeded ones drop.
        proj.parameters = proj.parameters.filter((p) => {
          if (!p?.id) return true;
          if (!dropSet.has(p.id)) return true;
          return p._userAuthored === true;
        });
      }
      // 2026-05-09 (afternoon) — `seedDefaultRigidWeights(proj)` was
      // removed when the Cubism Adapter pattern was reverted toward
      // Blender parity. See
      // `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`. Parts
      // that need true skinning (limbs) get their weights from
      // `computeSkinWeights` upstream of seedAllRig; parts that
      // rigid-follow a bone don't get weights at all — they render
      // via the overlay-matrix path (`pickBonePostChainComposition`
      // returning `kind: 'overlay'`). This matches Blender's split:
      // vertex groups + Armature modifier for true skinning,
      // parent-chain transform for rigid follow.
      // Schema v29 — persist `rigSpec.artMeshes` runtime data (bindings
      // + keyforms + parent) into `project.nodes[i].mesh.runtime` so
      // `selectRigSpec(project)` produces an art-mesh tree equivalent
      // to `generateCmo3.result.rigSpec.artMeshes` post save+load and
      // post auto-fill. Without this, bone-baked handwear keyforms +
      // eye-closure curves + neck-corner offsets + variant fades all
      // silently disappear from the live preview.
      //
      // ORDER: this MUST run before `migrateGroupRotationDeformersToBones`
      // below, which derives each rotation deformer's CANVAS-FINAL bone
      // head from `mesh.vertices − mesh.runtime.keyforms[0].vertexPositions`
      // (see `groupRotationToBone.js` → `deriveCanvasPivot`). Without the
      // runtime cache populated first, the migration falls back to the
      // authored origin (warp-local for warp-parented rotations, wrong
      // canvas-final value). Post-M3.3 (2026-05-23) the ordering is
      // load-bearing for `runtime.keyforms` only — `runtime.parent` is
      // retired (no writer, no live reader; v47 strips the field on load).
      if (harvest?.rigSpec) {
        peers.persistArtMeshRuntime(proj, harvest.rigSpec, mode);
        // RULE №4 follow-up Slice 2 (2026-05-23) — mirror the eye-
        // closure parabola fit into `project.eyeClosureParabolas` so
        // pure-export reads it back instead of re-fitting. Init Rig is
        // the canonical re-fit moment; the cmo3writer prepass uses the
        // stored data via `resolveEyeClosure(project)`. See
        // `src/io/live2d/rig/eyeClosure.js` (RULE-№4 Leak #2 substrate).
        const ec = harvest.rigSpec.eyeClosureParabolas;
        if (ec) {
          peers.seedEyeClosure(proj, ec.baseParabolaPerSide, ec.variantParabolaPerSideAndSuffix);
        }
      }
      // RULE №4 — GroupRotation deformer → armature bone. A Cubism
      // GroupRotation is, in Blender, the group acting as a bone that
      // rotates its weighted meshes around its head (the pivot); the
      // Cubism deformer is a downstream export adapter
      // (`synthesizeGroupRotationDeformers`), not the authoring model.
      // Runs AFTER `persistArtMeshRuntime` because it derives each part's
      // bone head from `mesh.vertices − pivot-relative runtime keyform`,
      // and BEFORE the stack synthesis below so the bone-bound parts
      // surface an Armature modifier (not a stale `rotation` entry) and
      // the rotation deformer nodes are gone. Post-M3.3 (2026-05-23) the
      // migration no longer reads `mesh.runtime.parent`; post-M4
      // (2026-05-23) it no longer reads `rigParent` either. Driven parts
      // are discovered via the topology signal `part.parent === groupName`
      // alone (it subsumes the two retired alternatives). Validated
      // end-to-end (nested + warp-parented multi-rotation) by
      // `test_groupRotationMigrationRealRig`.
      peers.migrateGroupRotationDeformersToBones(proj);
      // Phase 3 storage flip — re-derive each part's modifier stack
      // after the full seed pass. The seedXxx fns each run synthesize
      // individually, but NeckWarp + rotation deformer upserts happen
      // AFTER seedRigWarps so the rigWarps' chain ancestors aren't
      // visible at synthesize time. Re-run once at the end so every
      // part's `Object.modifiers[]` reflects the final tree shape.
      peers.synthesizeModifierStacks(proj);
      // V2 Phase 0.3 — modifier stacks are now canonical; the
      // export-facing `deformer.parent` chain links are a derived
      // mirror for cmo3writer (the `part.rigParent` mirror was retired
      // in M4 RULE-№4, 2026-05-23). Run inverse synth after every
      // forward synth so any future caller can mutate stacks alone
      // and trust the mirror to stay consistent. See
      // `synthesizeDeformerParents` doc header.
      peers.synthesizeDeformerParents(proj);
      // Hole I-8: explicit completion marker beats heuristic-detection
      // of partially-seeded state in exporter's resolveAllKeyformSpecs.
      // ISO timestamp; readable in logs / debug if needed.
      proj.lastInitRigCompletedAt = new Date().toISOString();
      draft.hasUnsavedChanges = true;
    });
    });
    // GAP-013 / Hole I-3 — after seedAllRig (which re-runs seedParameters
    // with current tag coverage and may drop tag-gated standard params
    // when their tag isn't present anymore), enumerate references in
    // animations/bindings/physicsRules that no longer resolve. Detection
    // only — Logs panel shows the per-ref locations; remediation is the
    // user's call (today: ignore; future Param Editor UI: orphan-cleanup
    // dialog). Runs outside the immer `produce` because
    // findOrphanReferences reads the post-seed project; the `set` above
    // committed before this returns.
    const postSeedProject = get().project;
    const orphans = peers.findOrphanReferences(postSeedProject);
    const orphanIds = Object.keys(orphans);
    if (orphanIds.length > 0) {
      logger.warn(
        'paramOrphans',
        `${orphanIds.length} orphan parameter ref(s) after Init Rig: ${orphanIds.join(', ')}`,
        Object.fromEntries(
          orphanIds.map(id => [id, {
            animationTracks: orphans[id].animationTracks.map(r => r.location),
            bindings:        orphans[id].bindings.map(r => r.location),
            physicsInputs:   orphans[id].physicsInputs.map(r => r.location),
          }])
        )
      );
    }
    // Hole I-2: binding-vs-param schema drift. Detects bindings whose
    // `keys` no longer match the param's current `keys`, or whose keys
    // fall outside the param's [min, max] range. Drift accumulates when
    // the V4 Track 2 param editor mutates a param's range / keys without
    // a follow-up Init Rig — bindings still carry the old schema.
    // Detection only; "you have stale rig wiring" UI banner deferred.
    const drift = peers.findBindingSchemaDrift(postSeedProject);
    if (drift.length > 0) {
      logger.warn(
        'paramSchemaDrift',
        `${drift.length} binding(s) drifted from their param schema; re-Init Rig to refresh`,
        { drift },
      );
    }
    // Hole I-5: bone-reference orphans. `node.mesh.jointBoneId` is a
    // node-id pointer to the bone group that owns the skinning; if the
    // group was deleted/renamed, the rotation keyforms quietly emit
    // against a phantom bone. Detection only — UI bone-edit operators
    // will gate the rename/delete in Phase B.
    const groupIds = new Set();
    for (const n of postSeedProject.nodes ?? []) {
      if (n?.type === 'group') groupIds.add(n.id);
    }
    const boneOrphans = [];
    for (const n of postSeedProject.nodes ?? []) {
      const m = getMesh(n, postSeedProject);
      if (!m?.jointBoneId) continue;
      if (!groupIds.has(m.jointBoneId)) {
        boneOrphans.push({ partId: n.id, partName: n.name, jointBoneId: m.jointBoneId });
      }
    }
    if (boneOrphans.length > 0) {
      logger.warn(
        'boneOrphans',
        `${boneOrphans.length} mesh skinning ref(s) point at missing bone group(s)`,
        { orphans: boneOrphans }
      );
    }
    // Hole I-6: physicsRules[].outputs reference bone group NAMES
    // (resolved through `boneOutputs`, see physicsConfig). When the
    // group renamed/deleted, output silently zeros. Cross-check rule
    // outputs against current group names + ids; warn on miss.
    const groupNames = new Set();
    for (const n of postSeedProject.nodes ?? []) {
      if (n?.type === 'group' && typeof n.name === 'string') groupNames.add(n.name);
    }
    const physicsOrphans = [];
    for (let ri = 0; ri < (postSeedProject.physicsRules ?? []).length; ri++) {
      const rule = postSeedProject.physicsRules[ri];
      const outs = Array.isArray(rule?.outputs) ? rule.outputs : [];
      for (let oi = 0; oi < outs.length; oi++) {
        const out = outs[oi];
        const target = typeof out === 'string' ? out : out?.bone ?? out?.boneId;
        if (!target) continue;
        if (!groupNames.has(target) && !groupIds.has(target)) {
          physicsOrphans.push({ ruleIdx: ri, ruleName: rule?.name ?? null, output: target, location: `physicsRules[${ri}]:outputs[${oi}]` });
        }
      }
    }
    if (physicsOrphans.length > 0) {
      logger.warn(
        'physicsOrphans',
        `${physicsOrphans.length} physics rule output(s) reference missing group(s)`,
        { orphans: physicsOrphans }
      );
    }
  },

  /**
   * Stage 1b — clear all keyform-bearing stores (faceParallax,
   * bodyWarp, rigWarps) so the export pipeline falls back to the
   * inline heuristics. Config-only seeded fields (parameters, masks,
   * physics rules, etc.) are left intact.
   */
  clearRigKeyforms: async () => {
    // Phase A2 — pre-load seed module before the sync immer recipe.
    const seeds = await loadSeedModule();
    set((state) => {
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        seeds.clearFaceParallax(draft.project);
        seeds.clearBodyWarp(draft.project);
        seeds.clearRigWarps(draft.project);
        draft.hasUnsavedChanges = true;
      });
    });
  },

  /** Update canvas properties */
  updateCanvas: (partial) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    Object.assign(state.project.canvas, partial);
  })),

  /** Toolset Phase 7.A.1 — write the canvas-space 3D-cursor (Snap menu).
   *  Snapshots for undo via the standard `projectMutator` path so Ctrl+Z
   *  reverses cursor moves (Blender's `Scene.cursor` writes go through
   *  the operator system → undo stack the same way). */
  setProjectCursor: (x, y) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      if (!draft.project.cursor) draft.project.cursor = { x: 0, y: 0 };
      draft.project.cursor.x = x;
      draft.project.cursor.y = y;
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Recursively duplicate a node and its children.
   * Also duplicates animation tracks.
   */
  duplicateNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToMap = new Map(); // oldId -> newId

      function doDuplicate(id, parentId) {
        const original = proj.nodes.find(n => n.id === id);
        if (!original) return null;

        const newId = uid();
        idsToMap.set(id, newId);

        const newNode = deepClone(original);
        newNode.id = newId;
        newNode.parent = parentId;
        newNode.name = original.name + ' Copy';

        // For parts, handle draw_order and texture duplication
        if (original.type === 'part') {
          // Texture entry
          const originalTex = proj.textures.find(t => t.id === id);
          if (originalTex) {
            proj.textures.push({
              ...originalTex,
              id: newId
            });
          }

          // Increment draw_order of all parts that are currently at or above the original's draw order
          proj.nodes.forEach(n => {
            if (n.type === 'part' && n.draw_order > original.draw_order) {
              n.draw_order++;
            }
          });
          newNode.draw_order = original.draw_order + 1;
        }

        // Insert into flat nodes array
        proj.nodes.push(newNode);

        // Recursively duplicate children
        const children = proj.nodes.filter(n => n.parent === id && !idsToMap.has(n.id));
        for (const child of children) {
          doDuplicate(child.id, newId);
        }
        return newId;
      }

      const rootNode = proj.nodes.find(n => n.id === nodeId);
      if (!rootNode) return;

      doDuplicate(nodeId, rootNode.parent);

      // Duplicate fcurves targeting the duplicated node ids onto the new
      // ids. Preserves rnaPath property suffix; only rewrites the node-id
      // segment via `renameFCurveNode` semantics.
      for (const [oldId, newId] of idsToMap) {
        for (const action of proj.actions ?? []) {
          if (!Array.isArray(action.fcurves)) continue;
          const matching = action.fcurves.filter(fc => fcurveTargetsNode(fc, oldId));
          for (const fc of matching) {
            const cloned = deepClone(fc);
            renameFCurveNode(cloned, oldId, newId);
            action.fcurves.push(cloned);
          }
        }
      }

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),

  /**
   * Recursively delete a node and all its children.
   * Also cleans up animation tracks.
   */
  deleteNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToDelete = new Set();

      function collectRecursive(id) {
        idsToDelete.add(id);
        const children = proj.nodes.filter(n => n.parent === id);
        for (const child of children) {
          collectRecursive(child.id);
        }
      }

      collectRecursive(nodeId);

      // MEM-01 — revoke `blob:` URLs for the textures we are about to
      // drop. Pre-fix only resetProject/loadProject called
      // disposeProjectResources; deleteNode leaked one blob URL per
      // PSD-imported part for the rest of the session (and the undo
      // snapshot pinned the blob further — see MEM-03 follow-up).
      for (const t of proj.textures) {
        if (idsToDelete.has(t.id) && typeof t.source === 'string' && t.source.startsWith('blob:')) {
          try { URL.revokeObjectURL(t.source); } catch { /* already revoked */ }
        }
      }

      // Remove nodes
      proj.nodes = proj.nodes.filter(n => !idsToDelete.has(n.id));

      // Remove textures
      proj.textures = proj.textures.filter(t => !idsToDelete.has(t.id));

      // Remove fcurves targeting deleted nodes (rnaPath includes the
      // node id; decode + filter).
      for (const action of proj.actions ?? []) {
        if (!Array.isArray(action.fcurves)) continue;
        action.fcurves = action.fcurves.filter((fc) => {
          const t = decodeFCurveTarget(fc);
          return !(t?.kind === 'node' && idsToDelete.has(t.nodeId));
        });
      }

      // RULE №4 Slice 3 (2026-05-23) — eagerly drop orphaned variant
      // parabolas from `project.eyeClosureParabolas`. Closes the
      // Blender-fidelity HIGH-5 reference-counting gap exposed by
      // Slice 2: pre-Slice-3 a deleted variant's stored parabola sat
      // in the variant map until the next Init Rig's full REPLACE.
      // Now the variant map mirrors the live suffix population
      // moment-to-moment.
      pruneOrphanedVariantParabolas(proj);

      // Re-normalize draw_order for remaining parts to ensure no gaps (optional but clean)
      const remainingParts = proj.nodes
        .filter(n => n.type === 'part')
        .sort((a, b) => a.draw_order - b.draw_order);

      remainingParts.forEach((p, i) => {
        p.draw_order = i;
      });

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),
  };
});
