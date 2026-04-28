import { create } from 'zustand';
import { produce } from 'immer';
import { pushSnapshot, isBatching, clearHistory } from './undoHistory.js';
import { CURRENT_SCHEMA_VERSION, migrateProject } from './projectMigrations.js';
import { seedParameters as seedParametersFn } from '../io/live2d/rig/paramSpec.js';
import { seedMaskConfigs as seedMaskConfigsFn } from '../io/live2d/rig/maskConfigs.js';
import { seedPhysicsRules as seedPhysicsRulesFn } from '../io/live2d/rig/physicsConfig.js';
import { seedBoneConfig as seedBoneConfigFn } from '../io/live2d/rig/boneConfig.js';
import { seedVariantFadeRules as seedVariantFadeRulesFn } from '../io/live2d/rig/variantFadeRules.js';
import { seedEyeClosureConfig as seedEyeClosureConfigFn } from '../io/live2d/rig/eyeClosureConfig.js';
import { seedRotationDeformerConfig as seedRotationDeformerConfigFn } from '../io/live2d/rig/rotationDeformerConfig.js';
import { seedAutoRigConfig as seedAutoRigConfigFn } from '../io/live2d/rig/autoRigConfig.js';
import {
  seedFaceParallax as seedFaceParallaxFn,
  clearFaceParallax as clearFaceParallaxFn,
} from '../io/live2d/rig/faceParallaxStore.js';
import {
  seedBodyWarpChain as seedBodyWarpChainFn,
  clearBodyWarp as clearBodyWarpFn,
} from '../io/live2d/rig/bodyWarpStore.js';
import {
  seedRigWarps as seedRigWarpsFn,
  clearRigWarps as clearRigWarpsFn,
} from '../io/live2d/rig/rigWarpsStore.js';
import { uid } from '../lib/ids.js';

/**
 * Deep clone an object, preserving TypedArrays.
 * Safe for use with Immer draft proxies.
 */
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
export const useProjectStore = create((set) => ({
  project: {
    version: "0.1",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' },
    textures: [],     // { id, source (data URI or Blob URL) }
    nodes: [],        // flat array — see node schemas below
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
    animations: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    faceParallax: null,
    bodyWarp: null,
    rigWarps: {},
  },

  // Versions used to trigger rendering passes independently of React
  versionControl: {
    geometryVersion: 0,
    transformVersion: 0,
    textureVersion: 0,
  },

  hasUnsavedChanges: false,

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
   */
  reparentNode: (nodeId, newParentId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node) node.parent = newParentId ?? null;
    state.versionControl.transformVersion++;
  })),
  /**
   * Animation CRUD
   */
  createAnimation: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const id = uid();
    state.project.animations.push({
      id,
      name:        name ?? `Animation ${state.project.animations.length + 1}`,
      duration:    2000,
      fps:         24,
      tracks:      [],
      audioTracks: [],
    });
  })),

  renameAnimation: (id, newName) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const anim = state.project.animations.find(a => a.id === id);
    if (anim) anim.name = newName;
  })),

  deleteAnimation: (id) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    state.project.animations = state.project.animations.filter(a => a.id !== id);
  })),

  /** Create a new blend shape on a part node */
  createBlendShape: (nodeId, name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node || !node.mesh) return;
    const id = uid();
    const deltas = node.mesh.vertices.map(() => ({ dx: 0, dy: 0 }));
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

  /** Reset project to empty state */
  resetProject: () => {
    clearHistory();
    return set(produce((state) => {
      state.project.canvas   = { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' };
      state.project.textures = [];
      state.project.nodes    = [];
      state.project.parameters = [];
      state.project.physics_groups = [];
      state.project.animations = [];
      state.project.maskConfigs = [];
      state.project.physicsRules = [];
      state.project.boneConfig = null;
      state.project.variantFadeRules = null;
      state.project.eyeClosureConfig = null;
      state.project.rotationDeformerConfig = null;
      state.project.autoRigConfig = null;
      state.project.faceParallax = null;
      state.project.bodyWarp = null;
      state.project.rigWarps = {};
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
    }));
  },

  /** Load a deserialized project from file */
  loadProject: (projectData) => {
    // Idempotent — the file loader (projectFile.loadProject) has already
    // migrated, but call again here to defend against direct callers.
    migrateProject(projectData);
    clearHistory();
    return set(produce((state) => {
      state.project.version = projectData.version;
      state.project.schemaVersion = projectData.schemaVersion;
      state.project.canvas = projectData.canvas;
      state.project.textures = projectData.textures;
      state.project.nodes = projectData.nodes;
      state.project.animations = projectData.animations;
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
      state.project.faceParallax = projectData.faceParallax ?? null;
      state.project.bodyWarp = projectData.bodyWarp ?? null;
      state.project.rigWarps = projectData.rigWarps ?? {};
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
  seedParameters: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedParametersFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.maskConfigs` from the auto-rig heuristic (Stage 3).
   * Iris↔eyewhite pairings (variant-aware) are baked into project state.
   * Destructive: overwrites whatever was there.
   */
  seedMaskConfigs: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedMaskConfigsFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.physicsRules` from DEFAULT_PHYSICS_RULES (Stage 6).
   * boneOutputs are resolved against the project's groups (boneRole
   * lookup) and flattened into outputs[]. Destructive.
   */
  seedPhysicsRules: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedPhysicsRulesFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.boneConfig` from defaults (Stage 7). Currently sets
   * `bakedKeyformAngles` to [-90, -45, 0, 45, 90]. Destructive.
   */
  seedBoneConfig: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedBoneConfigFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.variantFadeRules` from defaults (Stage 5). Currently
   * sets `backdropTags` to the canonical Hiyori-style list (face, ears,
   * front+back hair). Destructive.
   */
  seedVariantFadeRules: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedVariantFadeRulesFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.eyeClosureConfig` from defaults (Stage 5). Currently
   * sets per-side eyelash/eyewhite/irides closureTags + lashStripFrac=0.06
   * + binCount=6. Destructive.
   */
  seedEyeClosureConfig: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedEyeClosureConfigFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.rotationDeformerConfig` from defaults (Stage 8). Sets
   * `skipRotationRoles=['torso','eyes','neck']`, `paramAngleRange=±30`,
   * `groupRotation` 1:1 ±30, `faceRotation` ±10° on ±30 keys. Destructive.
   */
  seedRotationDeformerConfig: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedRotationDeformerConfigFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.autoRigConfig` from defaults (Stage 2). Three sections —
   * bodyWarp (HIP/FEET fallbacks, BX/BY/Breath margins, upper-body shape),
   * faceParallax (depth coefficients, protection per tag, eye/squash amps,
   * super-groups), neckWarp (tilt fraction). Destructive.
   */
  seedAutoRigConfig: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedAutoRigConfigFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.faceParallax` from a pre-computed spec (Stage 4).
   * Caller is responsible for producing the spec — typically via
   * `buildFaceParallaxSpec(...)` with current mesh / bbox / pivot
   * inputs. Destructive: overwrites prior storage.
   */
  seedFaceParallax: (spec) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedFaceParallaxFn(draft.project, spec);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Clear `project.faceParallax` to revert to the heuristic generator
   * path. Use after PSD reimport invalidates stored vertex deltas.
   */
  clearFaceParallax: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      clearFaceParallaxFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.bodyWarp` from a pre-computed chain (Stage 10).
   * Caller is responsible for producing the chain — typically via
   * `buildBodyWarpChain(...)` with current mesh / canvas / body-anatomy
   * inputs. Destructive: overwrites prior storage.
   */
  seedBodyWarp: (chain) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedBodyWarpChainFn(draft.project, chain);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Clear `project.bodyWarp` to revert to the heuristic generator
   * path. Use after PSD reimport invalidates stored vertex deltas
   * or body silhouette anchors.
   */
  clearBodyWarp: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      clearBodyWarpFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Seed `project.rigWarps` from a pre-computed `partId → spec` map
   * (or iterable of specs with `targetPartId`) — Stage 9b. Caller is
   * typically a rig-init flow that runs `generateCmo3` once and
   * harvests `rigSpec.warpDeformers` filtered to per-mesh entries.
   * Destructive: overwrites the entire stored map.
   */
  seedRigWarps: (rigWarps) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      seedRigWarpsFn(draft.project, rigWarps);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Clear `project.rigWarps` to revert to the heuristic shiftFn
   * path. Use after PSD reimport invalidates stored per-vertex
   * deltas or any binding-axis change.
   */
  clearRigWarps: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      clearRigWarpsFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Stage 1b — orchestrator that seeds every native-rig store from a
   * single harvest pass. Caller (UI: ParametersPanel "Initialize Rig"
   * button) supplies the harvest result from
   * `initializeRigFromProject(project, images)`. Single snapshot covers
   * all writes so undo reverts the whole init in one step.
   *
   * Existing seeded data is overwritten — the harvest already ran the
   * heuristics with `null` keyform-bearing inputs, so the result reflects
   * the current mesh geometry.
   *
   * @param {{
   *   faceParallaxSpec: object|null,
   *   bodyWarpChain: object|null,
   *   rigWarps: Map<string,object>,
   * }} harvest
   */
  seedAllRig: (harvest) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const proj = draft.project;
      // Config-only seeders (no keyforms). All idempotent.
      seedParametersFn(proj);
      seedMaskConfigsFn(proj);
      seedPhysicsRulesFn(proj);
      seedBoneConfigFn(proj);
      seedVariantFadeRulesFn(proj);
      seedEyeClosureConfigFn(proj);
      seedRotationDeformerConfigFn(proj);
      seedAutoRigConfigFn(proj);
      // Keyform-bearing seeders. Each only fires when the harvester
      // actually produced a value — buildBodyWarpChain returns null for
      // models without ParamBodyAngleZ/Y, faceParallax is null when no
      // face-tagged meshes exist, etc.
      if (harvest?.faceParallaxSpec) {
        seedFaceParallaxFn(proj, harvest.faceParallaxSpec);
      } else {
        clearFaceParallaxFn(proj);
      }
      if (harvest?.bodyWarpChain) {
        seedBodyWarpChainFn(proj, harvest.bodyWarpChain);
      } else {
        clearBodyWarpFn(proj);
      }
      if (harvest?.rigWarps && harvest.rigWarps.size > 0) {
        seedRigWarpsFn(proj, harvest.rigWarps);
      } else {
        clearRigWarpsFn(proj);
      }
      draft.hasUnsavedChanges = true;
    });
  }),

  /**
   * Stage 1b — clear all keyform-bearing stores (faceParallax,
   * bodyWarp, rigWarps) so the export pipeline falls back to the
   * inline heuristics. Config-only seeded fields (parameters, masks,
   * physics rules, etc.) are left intact.
   */
  clearRigKeyforms: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      clearFaceParallaxFn(draft.project);
      clearBodyWarpFn(draft.project);
      clearRigWarpsFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /** Update canvas properties */
  updateCanvas: (partial) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    Object.assign(state.project.canvas, partial);
  })),

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

      // Duplicate animation tracks for all duplicated nodes
      for (const [oldId, newId] of idsToMap) {
        for (const anim of proj.animations) {
          const tracks = anim.tracks.filter(t => t.nodeId === oldId);
          for (const track of tracks) {
            anim.tracks.push({
              ...deepClone(track),
              nodeId: newId,
            });
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

      // Remove nodes
      proj.nodes = proj.nodes.filter(n => !idsToDelete.has(n.id));

      // Remove textures
      proj.textures = proj.textures.filter(t => !idsToDelete.has(t.id));

      // Remove animation tracks
      for (const anim of proj.animations) {
        anim.tracks = anim.tracks.filter(t => !idsToDelete.has(t.nodeId));
      }

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
}));
