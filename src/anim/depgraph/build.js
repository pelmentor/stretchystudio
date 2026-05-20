// @ts-check

/**
 * DepGraph build pass.
 *
 * Phase D-1 of the V2 plan. Adapted from Blender's
 * `depsgraph_build.cc` two-pass model
 * (`reference/blender/source/blender/depsgraph/intern/builder/`):
 *
 *   pass 1: build_nodes()      — create every IDNode, ComponentNode,
 *                                 OperationNode the graph needs.
 *   pass 2: build_relations()  — add relations between operations.
 *
 * # SS deviations
 *
 * - **No copy-on-eval.** Blender's depgraph builder creates evaluated
 *   ID copies (`id_cow`) so the eval thread can mutate them safely.
 *   SS is single-threaded and pure-eval — kernels read from the live
 *   `project` object directly, no copy step.
 * - **Coarser ID granularity.** Blender treats every Object, Mesh,
 *   Material, Action as its own IDNode. SS treats parts and deformers
 *   as IDNodes; param-values live on a single synthetic IDNode
 *   (`__params__`); the playhead is `__time__`.
 * - **Phase D-1 is structure-only.** OperationNode `evaluate`
 *   callbacks are null. Phase D-2 (`kernels/{time,param,fcurve,driver}`)
 *   wires them in.
 * - **No cycle solver yet.** The build pass detects cycles via DFS +
 *   tags the offending Relation with `RelationFlag.CYCLIC`. Cycle
 *   breaking (Blender's "kill the lowest-priority edge") is deferred
 *   to a later sub-phase.
 *
 * @module anim/depgraph/build
 */

import {
  DepGraph,
  NodeType,
  OperationCode,
  RelationFlag,
} from './types.js';
import { decodeFCurveTarget } from '../animationFCurve.js';
import {
  isWarpLatticeNode,
  isRotationDeformerNode,
  isChainDeformerNode,
} from '../../store/warpLatticeAccess.js';

/** Synthetic IDNode ids for the depgraph's bookkeeping IDs. */
export const TIME_ID_REF = '__time__';
export const PARAM_ID_REF = '__params__';
export const ACTION_ID_REF = '__action__';

/**
 * @typedef {object} BuildOptions
 * @property {object|null} [action] - active action datablock
 *   (project.actions[i]) — used to wire ANIMATION_TRACK_EVAL nodes,
 *   one per fcurve. Pass null for static-rig graphs.
 */

/**
 * Build the dependency graph for a project.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {BuildOptions} [opts]
 * @returns {DepGraph}
 */
export function buildDepGraph(project, opts = {}) {
  const graph = new DepGraph();
  buildNodes(graph, project, opts);
  buildRelations(graph, project, opts);
  detectCycles(graph);
  return graph;
}

/**
 * Pass 1 — populate IDNodes / ComponentNodes / OperationNodes. No
 * relations yet.
 *
 * @param {DepGraph} graph
 * @param {object} project
 * @param {BuildOptions} opts
 */
export function buildNodes(graph, project, opts) {
  // Time source — the playhead. One per graph.
  const timeId = graph.addIdNode(TIME_ID_REF, 'time');
  graph.timeSource = timeId;
  const timeComp = timeId.addComponent(NodeType.PARAMETERS);
  timeComp.addOperation(OperationCode.TIME_TICK);

  // Parameter values bag — single synthetic IDNode hosting one
  // PARAM_EVAL op per parameter. Blender models each driven property
  // as its own RNA path; SS lifts them into one ID for now (the
  // PARAM_EVAL tag IS the parameterId).
  const paramId = graph.addIdNode(PARAM_ID_REF, 'params');
  const paramComp = paramId.addComponent(NodeType.PARAMETERS);
  for (const param of project.parameters ?? []) {
    if (!param?.id) continue;
    paramComp.addOperation(OperationCode.PARAM_EVAL, param.id);
  }

  // Per-deformer IDNodes. Each warp / rotation deformer gets its own
  // IDNode with KEYFORM_EVAL + (rotations also) MATRIX_BUILD,
  // GRID_LIFT_TO_PARENT, ROTATION_SETUP_PROBE.
  for (const node of project.nodes ?? []) {
    if (!isChainDeformerNode(node)) continue;
    const idNode = graph.addIdNode(node.id, 'deformer');
    const geom = idNode.addComponent(NodeType.GEOMETRY);
    geom.addOperation(OperationCode.KEYFORM_EVAL);
    if (isRotationDeformerNode(node)) {
      geom.addOperation(OperationCode.MATRIX_BUILD);
      geom.addOperation(OperationCode.ROTATION_SETUP_PROBE);
    } else {
      geom.addOperation(OperationCode.GRID_LIFT_TO_PARENT);
    }
  }

  // Per-part IDNodes. GEOMETRY_EVAL_DEFORMED iterates the modifier
  // stack at eval time. The TRANSFORM op for parts/groups is added
  // separately below at lines 124-135 (Phase 0.C — TRANSFORM_COMPOSE
  // for constraints).
  // Phase 0.D.0 — ART_MESH_EVAL is the production-shape op that emits
  // {id, vertexPositions, opacity, drawOrder} matching evalRig.
  for (const node of project.nodes ?? []) {
    if (!node || node.type !== 'part') continue;
    const idNode = graph.addIdNode(node.id, 'part');
    const geom = idNode.addComponent(NodeType.GEOMETRY);
    geom.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
    geom.addOperation(OperationCode.ART_MESH_EVAL);
  }

  // Phase 0.C — Object IDNodes carrying TRANSFORM_COMPOSE. Every
  // node that can hold a transform (parts + groups) gets one. Bones
  // are `type: 'group'` with `boneRole`; the kernel reads pose vs
  // transform based on that flag. Constraints can reference both
  // kinds, so we wire all of them uniformly.
  for (const node of project.nodes ?? []) {
    if (!node) continue;
    if (node.type !== 'part' && node.type !== 'group') continue;
    const idNode = graph.addIdNode(node.id, node.type);
    const xform = idNode.addComponent(NodeType.TRANSFORM);
    xform.addOperation(OperationCode.TRANSFORM_COMPOSE);
  }

  // FCurve / Driver / Animation operations — only when an active
  // action is provided. One ANIMATION_TRACK_EVAL op per fcurve, tagged
  // by the fcurve's rnaPath so the kernel can match by string equality
  // (post-v36 the rnaPath IS the canonical target identifier).
  const action = opts.action;
  if (action) {
    const animIdNode = graph.addIdNode(ACTION_ID_REF, 'action');
    const animComp = animIdNode.addComponent(NodeType.ANIMATION);
    for (const fc of action.fcurves ?? []) {
      if (typeof fc?.rnaPath !== 'string' || fc.rnaPath.length === 0) continue;
      animComp.addOperation(OperationCode.ANIMATION_TRACK_EVAL, fc.rnaPath);
    }
  }

  // Drivers — per parameter that carries a driver. The DRIVER_EVAL
  // op overrides the keyframe value emitted by FCURVE_EVAL.
  for (const param of project.parameters ?? []) {
    if (!param?.id) continue;
    if (!param.driver) continue;
    paramComp.addOperation(OperationCode.DRIVER_EVAL, param.id);
  }

  // Physics rules — one PHYSICS_EVAL per rule. Input/output param
  // wiring lands in pass 2.
  if (Array.isArray(project.physicsRules) && project.physicsRules.length > 0) {
    const physicsId = graph.addIdNode('__physics__', 'physics');
    const physicsComp = physicsId.addComponent(NodeType.PARAMETERS);
    for (const rule of project.physicsRules) {
      if (!rule?.id) continue;
      physicsComp.addOperation(OperationCode.PHYSICS_EVAL, rule.id);
    }
  }
}

/**
 * Pass 2 — wire relations between operations. Each relation domain
 * lives in its own builder for diff-readability.
 *
 * @param {DepGraph} graph
 * @param {object} project
 * @param {BuildOptions} opts
 */
export function buildRelations(graph, project, opts) {
  buildTimeRelations(graph, project, opts);
  buildAnimationRelations(graph, project, opts);
  buildDriverRelations(graph, project, opts);
  buildDeformerChainRelations(graph, project, opts);
  buildPartModifierRelations(graph, project, opts);
  buildPhysicsRelations(graph, project, opts);
  buildConstraintRelations(graph, project, opts);
}

/**
 * Phase 0.C — Per-Object TRANSFORM_COMPOSE relations. Each constraint
 * that references a `targetId` adds a `target.TRANSFORM_COMPOSE → owner.TRANSFORM_COMPOSE`
 * edge so the depgraph topology guarantees target-first ordering. The
 * kernel substitutes the target's composed transform when the
 * constraint evaluator reads the target node — matching Blender's
 * `BKE_constraints_solve` iteration where each Object resolves
 * against already-resolved targets.
 *
 * Cycle case: when two objects' constraints reference each other, the
 * cycle detector flags the offending edges. Eval falls back to the
 * authored transform (constraint evaluator passes through unchanged
 * if its target output isn't yet in `ctx.outputs`).
 */
function buildConstraintRelations(graph, project, opts) {
  for (const node of project.nodes ?? []) {
    if (!node) continue;
    if (node.type !== 'part' && node.type !== 'group') continue;
    const ownerId = graph.findIdNode(node.id, node.type);
    const ownerXform = ownerId?.findComponent(NodeType.TRANSFORM);
    const ownerCompose = ownerXform?.findOperation(OperationCode.TRANSFORM_COMPOSE);
    if (!ownerCompose) continue;
    const constraints = Array.isArray(node.constraints) ? node.constraints : [];
    for (const con of constraints) {
      const targetId = con?.payload?.targetId;
      if (typeof targetId !== 'string' || targetId.length === 0) continue;
      // Look up the target's TRANSFORM_COMPOSE op. The target may be
      // a part or a group; try both.
      const targetIdNodePart  = graph.findIdNode(targetId, 'part');
      const targetIdNodeGroup = graph.findIdNode(targetId, 'group');
      const targetIdNode = targetIdNodePart ?? targetIdNodeGroup;
      const targetXform = targetIdNode?.findComponent(NodeType.TRANSFORM);
      const targetCompose = targetXform?.findOperation(OperationCode.TRANSFORM_COMPOSE);
      if (!targetCompose) continue;
      graph.addRelation(targetCompose, ownerCompose, 'constraint target -> owner');
    }
  }
}

/**
 * TIME_TICK → every FCURVE_EVAL / ANIMATION_TRACK_EVAL.
 *
 * Adapted from Blender's `build_animdata` time relation (the time
 * source is the implicit upstream of every FCurve evaluation).
 */
function buildTimeRelations(graph, project, opts) {
  const timeOp = graph.timeSource?.findComponent(NodeType.PARAMETERS)
    ?.findOperation(OperationCode.TIME_TICK);
  if (!timeOp) return;
  const animIdNode = graph.findIdNode(ACTION_ID_REF, 'action');
  if (!animIdNode) return;
  const animComp = animIdNode.findComponent(NodeType.ANIMATION);
  if (!animComp) return;
  for (const op of animComp.operations.values()) {
    if (op.opcode === OperationCode.ANIMATION_TRACK_EVAL ||
        op.opcode === OperationCode.FCURVE_EVAL) {
      graph.addRelation(timeOp, op, 'time -> fcurve');
    }
  }
}

/**
 * ANIMATION_TRACK_EVAL → target's PARAM_EVAL (or part's TRANSFORM,
 * for pose fcurves). Each fcurve outputs a value that overrides the
 * downstream eval.
 *
 * Adapted from `build_animdata_action` —
 * `reference/blender/source/blender/depsgraph/intern/builder/deg_builder_relations.cc`
 * (the action's fcurves create OperationDescriptor edges to the
 * driven property's owner Component).
 */
function buildAnimationRelations(graph, project, opts) {
  const action = opts.action;
  if (!action) return;
  const animIdNode = graph.findIdNode(ACTION_ID_REF, 'action');
  if (!animIdNode) return;
  const animComp = animIdNode.findComponent(NodeType.ANIMATION);
  if (!animComp) return;
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')?.findComponent(NodeType.PARAMETERS);
  for (const fc of action.fcurves ?? []) {
    if (typeof fc?.rnaPath !== 'string' || fc.rnaPath.length === 0) continue;
    const trackOp = animComp.findOperation(OperationCode.ANIMATION_TRACK_EVAL, fc.rnaPath);
    if (!trackOp) continue;
    const target = decodeFCurveTarget(fc);
    if (!target) continue;
    if (target.kind === 'param') {
      const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, target.paramId);
      if (paramOp) {
        graph.addRelation(trackOp, paramOp, 'fcurve -> param');
      }
    } else if (target.kind === 'node' && target.property !== 'mesh_verts') {
      // Pose / transform fcurve → the owner's TRANSFORM_COMPOSE, so the
      // track evaluates BEFORE the transform composes and the animated
      // pose seeds the constraint stack (→ bone skinning sees it). Before
      // this, ANIMATION_TRACK_EVAL wrote `ctx.poseOverrides` but nothing
      // read it — bone/part pose animation moved the skeleton overlay but
      // never reached the mesh (the long-deferred "Phase D-5" wiring).
      // `mesh_verts` fcurves are excluded: those don't compose a
      // transform — the viewport applies them as a post-eval vertex
      // override (poseOverrides.mesh_verts → GPU upload).
      const ownerIdNode = graph.findIdNode(target.nodeId, 'part')
        ?? graph.findIdNode(target.nodeId, 'group');
      const ownerCompose = ownerIdNode
        ?.findComponent(NodeType.TRANSFORM)
        ?.findOperation(OperationCode.TRANSFORM_COMPOSE);
      if (ownerCompose) {
        graph.addRelation(trackOp, ownerCompose, 'fcurve -> transform');
      }
    }
  }
}

/**
 * For each driver, wire DRIVER_EVAL ← variable PARAM_EVAL inputs and
 * DRIVER_EVAL → target PARAM_EVAL output. Drivers run AFTER the
 * target's FCURVE_EVAL so the driver value overrides the keyframe.
 *
 * Adapted from
 * `deg_builder_relations_drivers.cc:build_driver_relations` — the
 * driver IS-A relation between the driven property and each variable
 * source target.
 */
function buildDriverRelations(graph, project, opts) {
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')?.findComponent(NodeType.PARAMETERS);
  if (!paramComp) return;
  for (const param of project.parameters ?? []) {
    if (!param?.id || !param.driver) continue;
    const driverOp = paramComp.findOperation(OperationCode.DRIVER_EVAL, param.id);
    const targetOp = paramComp.findOperation(OperationCode.PARAM_EVAL, param.id);
    if (!driverOp || !targetOp) continue;
    graph.addRelation(driverOp, targetOp, 'driver -> param');
    for (const v of param.driver.variables ?? []) {
      const rnaPath = v?.target?.rnaPath ?? '';
      // Phase D-1 only handles the canonical params bag rnaPath shape:
      //   `objects["__params__"].values["<id>"]`
      const m = /objects\["__params__"\]\.values\["([^"]+)"\]/.exec(rnaPath);
      if (!m) continue;
      const sourceParamId = m[1];
      const sourceOp = paramComp.findOperation(OperationCode.PARAM_EVAL, sourceParamId);
      if (sourceOp) {
        graph.addRelation(sourceOp, driverOp, 'var -> driver');
      }
    }
  }
}

/**
 * For every deformer, wire its KEYFORM_EVAL inputs (binding params)
 * and parent-chain edges:
 *
 *   PARAM_EVAL (binding) → KEYFORM_EVAL (deformer)
 *   parent's KEYFORM_EVAL → child's KEYFORM_EVAL (chain order)
 *   warp KEYFORM_EVAL → GRID_LIFT_TO_PARENT (per-deformer)
 *   rotation KEYFORM_EVAL → MATRIX_BUILD (per rotation)
 *   parent's GRID_LIFT_TO_PARENT → rotation's ROTATION_SETUP_PROBE
 *
 * Adapted from `build_object_data_geometry_datablock` modifier-chain
 * + `build_animdata_drivers` for binding params.
 */
function buildDeformerChainRelations(graph, project, opts) {
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')?.findComponent(NodeType.PARAMETERS);
  for (const node of project.nodes ?? []) {
    if (!isChainDeformerNode(node)) continue;
    const defId = graph.findIdNode(node.id, 'deformer');
    if (!defId) continue;
    const geom = defId.findComponent(NodeType.GEOMETRY);
    if (!geom) continue;
    const keyformOp = geom.findOperation(OperationCode.KEYFORM_EVAL);
    if (!keyformOp) continue;

    // Bindings → keyform.
    for (const b of node.bindings ?? []) {
      if (!b?.parameterId) continue;
      const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, b.parameterId);
      if (paramOp) {
        graph.addRelation(paramOp, keyformOp, 'param -> keyform');
      }
    }

    // Per-deformer geometry op chaining.
    if (isRotationDeformerNode(node)) {
      const matrixOp = geom.findOperation(OperationCode.MATRIX_BUILD);
      const setupOp = geom.findOperation(OperationCode.ROTATION_SETUP_PROBE);
      if (matrixOp) {
        // Matrix reads keyform AND setup (D-3b: setup output drives
        // canvas-final mode; D-3a fallback uses keyform alone).
        graph.addRelation(keyformOp, matrixOp, 'keyform -> matrix');
        if (setupOp) {
          graph.addRelation(setupOp, matrixOp, 'setup -> matrix');
        }
      }
      if (setupOp) {
        // Setup reads keyform (for pivot/angle) plus parent's chain output.
        graph.addRelation(keyformOp, setupOp, 'keyform -> setup');
        if (typeof node.parent === 'string' && node.parent.length > 0) {
          const parentId = graph.findIdNode(node.parent, 'deformer');
          const parentGeom = parentId?.findComponent(NodeType.GEOMETRY);
          const parentLift = parentGeom?.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
          if (parentLift) {
            graph.addRelation(parentLift, setupOp, 'parent lift -> rotation setup');
          }
          // If parent is rotation, the setup walks the chain via its
          // matrix; depend on parent's MATRIX_BUILD too.
          const parentMatrix = parentGeom?.findOperation(OperationCode.MATRIX_BUILD);
          if (parentMatrix) {
            graph.addRelation(parentMatrix, setupOp, 'parent matrix -> rotation setup');
          }
        }
      }
    } else {
      // Warp.
      const liftOp = geom.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
      if (liftOp) {
        graph.addRelation(keyformOp, liftOp, 'keyform -> grid lift');
        // The kernel walks the project parent chain at eval time
        // (gridLift.js): for each rotation ancestor it reads MATRIX_BUILD
        // and continues up; for each warp ancestor it reads
        // GRID_LIFT_TO_PARENT and breaks. Mirror that walk in the build
        // so topological order materialises every dependency the kernel
        // will read. Without these edges, MATRIX_BUILD can run AFTER the
        // child lift and the kernel falls through to "no matrix yet" →
        // returns the unlifted pivot-relative grid (V2 close-out bug:
        // per-part RigWarp_* diverges by ~canvasW/2).
        let cursorId = typeof node.parent === 'string' ? node.parent : null;
        let safety = 32;
        while (cursorId && safety-- > 0) {
          const ancestor = project.nodes?.find((n) => n?.id === cursorId);
          if (!isChainDeformerNode(ancestor)) break;
          const ancestorIdNode = graph.findIdNode(cursorId, 'deformer');
          const ancestorGeom = ancestorIdNode?.findComponent(NodeType.GEOMETRY);
          if (!ancestorGeom) break;
          if (isWarpLatticeNode(ancestor)) {
            const ancestorLift = ancestorGeom.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
            if (ancestorLift) {
              graph.addRelation(ancestorLift, liftOp, 'parent lift -> child lift');
            }
            break; // warp ancestor's lifted grid collapses the chain
          }
          if (isRotationDeformerNode(ancestor)) {
            const ancestorMatrix = ancestorGeom.findOperation(OperationCode.MATRIX_BUILD);
            if (ancestorMatrix) {
              graph.addRelation(ancestorMatrix, liftOp, 'rotation matrix -> child lift');
            }
            // Continue walking up: the kernel keeps applying rotation
            // matrices until it finds a canvas-final break or a warp
            // ancestor. We can't know `isCanvasFinal` at build time, so
            // walk conservatively to the first warp ancestor or root.
            cursorId = typeof ancestor.parent === 'string' ? ancestor.parent : null;
            continue;
          }
          break;
        }
      }
    }
  }
}

/**
 * Per part: every modifier in the stack contributes one upstream
 * dependency to the part's GEOMETRY_EVAL_DEFORMED op. Order is
 * leaf-first (matches `Object.modifiers[]` array order — see
 * `synthesizeModifierStacks`).
 *
 * Modifier `enabled` flag IS honoured at relation-build time: a
 * disabled modifier doesn't contribute a relation, so the depgraph
 * topology shrinks. Mode-bitmask (REALTIME / RENDER) is checked at
 * eval time, not build time, because the same graph serves both
 * purposes — see `kernels/geometry.js` (Phase D-3a).
 *
 * Adapted from `build_object_data_geometry` — the modifier stack
 * iteration that wires each ModifierData's evaluate op to the
 * geometry component's GEOMETRY_EVAL.
 */
function buildPartModifierRelations(graph, project, opts) {
  for (const part of project.nodes ?? []) {
    if (!part || part.type !== 'part') continue;
    const partId = graph.findIdNode(part.id, 'part');
    const partGeom = partId?.findComponent(NodeType.GEOMETRY);
    const evalOp = partGeom?.findOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
    const artMeshOp = partGeom?.findOperation(OperationCode.ART_MESH_EVAL);
    if (!evalOp && !artMeshOp) continue;
    const stack = Array.isArray(part.modifiers) ? part.modifiers : [];
    for (const mod of stack) {
      if (!mod?.deformerId || mod.enabled === false) continue;
      const defId = graph.findIdNode(mod.deformerId, 'deformer');
      const defGeom = defId?.findComponent(NodeType.GEOMETRY);
      if (!defGeom) continue;
      const defOp = mod.type === 'rotation'
        ? defGeom.findOperation(OperationCode.MATRIX_BUILD)
        : defGeom.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
      if (defOp) {
        if (evalOp) {
          graph.addRelation(defOp, evalOp, `modifier ${mod.deformerId} -> part`);
        }
        if (artMeshOp) {
          graph.addRelation(defOp, artMeshOp, `modifier ${mod.deformerId} -> art mesh`);
        }
      }
      // Phase 0.D.0 — ART_MESH_EVAL also reads KEYFORM_EVAL when the
      // chain is broken (warp's lifted grid is null) so depend on it
      // too. Cheap because it's the same defGeom we already looked up.
      if (artMeshOp) {
        const keyOp = defGeom.findOperation(OperationCode.KEYFORM_EVAL);
        if (keyOp) {
          graph.addRelation(keyOp, artMeshOp, `modifier ${mod.deformerId} keyform -> art mesh`);
        }
      }
    }
    // Phase 0.D.0 — every PARAM_EVAL feeds ART_MESH_EVAL via the
    // mesh's own bindings (cellSelect on runtime.bindings). Adding a
    // blanket edge from the param component would create one
    // dependency per param; cheaper to gate by `runtime.bindings[].parameterId`.
    if (artMeshOp) {
      const paramIdNode = graph.findIdNode(PARAM_ID_REF, 'params');
      const paramComp = paramIdNode?.findComponent(NodeType.PARAMETERS);
      const meshBindings = Array.isArray(part.mesh?.runtime?.bindings)
        ? part.mesh.runtime.bindings : [];
      const seenParamIds = new Set();
      for (const b of meshBindings) {
        if (!b?.parameterId || seenParamIds.has(b.parameterId)) continue;
        seenParamIds.add(b.parameterId);
        const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, b.parameterId);
        if (paramOp) {
          graph.addRelation(paramOp, artMeshOp, `param ${b.parameterId} -> art mesh`);
        }
      }
    }
    // Implicit deformer parent chain — bone-baked parts (handwear /
    // legwear) carry a `Rotation_*` / `GroupRotation_*` parent in
    // `mesh.runtime.parent` that is NOT present in `modifiers[]`.
    // `kernelArtMeshEval` walks that chain at eval time; without the
    // matching build edges the part's ART_MESH_EVAL op has no upstream
    // dependency, lands in the initial ready set, and runs BEFORE the
    // rotation's MATRIX_BUILD exists — so the kernel finds no matrix and
    // the chain is never applied (verts stay pivot-relative → the part
    // renders at the canvas origin). Mirror the warp-chain walk in
    // `buildDeformerChainRelations`: edge from every ancestor's
    // MATRIX_BUILD (rotation) / GRID_LIFT_TO_PARENT + KEYFORM_EVAL (warp)
    // until the first warp ancestor or root. Detection mirrors
    // selectRigSpec's `cachedRefInModifiers`.
    if (artMeshOp) {
      const implicitParent = part.mesh?.runtime?.parent;
      const implicitParentId = (implicitParent && implicitParent.type !== 'root'
        && typeof implicitParent.id === 'string' && implicitParent.id.length > 0)
        ? implicitParent.id
        : null;
      const inModifiers = !!implicitParentId
        && stack.some((m) => m && m.deformerId === implicitParentId);
      if (implicitParentId && !inModifiers) {
        let cursorId = implicitParentId;
        let safety = 32;
        while (cursorId && safety-- > 0) {
          const ancestor = project.nodes?.find((n) => n?.id === cursorId);
          if (!isChainDeformerNode(ancestor)) break;
          const ancestorIdNode = graph.findIdNode(cursorId, 'deformer');
          const ancestorGeom = ancestorIdNode?.findComponent(NodeType.GEOMETRY);
          if (!ancestorGeom) break;
          if (isWarpLatticeNode(ancestor)) {
            const ancestorLift = ancestorGeom.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
            if (ancestorLift) {
              graph.addRelation(ancestorLift, artMeshOp, `implicit parent ${cursorId} lift -> art mesh`);
            }
            const ancestorKey = ancestorGeom.findOperation(OperationCode.KEYFORM_EVAL);
            if (ancestorKey) {
              graph.addRelation(ancestorKey, artMeshOp, `implicit parent ${cursorId} keyform -> art mesh`);
            }
            break; // warp ancestor's lifted grid collapses the chain
          }
          if (isRotationDeformerNode(ancestor)) {
            const ancestorMatrix = ancestorGeom.findOperation(OperationCode.MATRIX_BUILD);
            if (ancestorMatrix) {
              graph.addRelation(ancestorMatrix, artMeshOp, `implicit parent ${cursorId} matrix -> art mesh`);
            }
            cursorId = typeof ancestor.parent === 'string' ? ancestor.parent : null;
            continue;
          }
          break;
        }
      }
    }
    // Phase 0.D — bone post-chain composition reads bone WORLD matrices
    // built from TRANSFORM_COMPOSE outputs along the bone parent chain.
    // Add an edge from every relevant bone's TRANSFORM_COMPOSE op to
    // this part's ART_MESH_EVAL so eval order materialises the inputs
    // the kernel will read at runtime.
    //
    // "Relevant" bones for a part:
    //   1. Every bone-group ancestor in the project tree (covers the
    //      rigid-follow / overlay path: parts whose nearest ancestor is
    //      a bone group, no Armature modifier, no boneWeights).
    //   2. The Armature modifier's `data.jointBoneId` + the joint's
    //      bone-group ancestor chain (covers the LBS path: parts with
    //      `boneWeights` + an enabled Armature modifier; the joint may
    //      not be the part's project-tree ancestor when the part hangs
    //      off a non-bone group).
    //   3. The Armature modifier's `data.parentBoneId` (typically the
    //      joint's parent — already covered by #2 when the bone tree
    //      has them stacked, but defensive in case the user wired an
    //      unrelated parent).
    if (artMeshOp) {
      const seenBoneIds = new Set();
      const addBoneAndAncestors = (startBoneId) => {
        let cur = startBoneId;
        let safety = 32;
        while (cur && safety-- > 0) {
          if (seenBoneIds.has(cur)) break;
          const node = project.nodes?.find((n) => n?.id === cur);
          if (!node) break;
          if (node.type !== 'group' || !node.boneRole) {
            // Walk up through visual folders without recording them.
            cur = typeof node.parent === 'string' ? node.parent : null;
            continue;
          }
          seenBoneIds.add(cur);
          const boneIdNode = graph.findIdNode(cur, 'group');
          const boneXform = boneIdNode?.findComponent(NodeType.TRANSFORM);
          const boneCompose = boneXform?.findOperation(OperationCode.TRANSFORM_COMPOSE);
          if (boneCompose) {
            graph.addRelation(boneCompose, artMeshOp, `bone ${cur} -> art mesh`);
          }
          cur = typeof node.parent === 'string' ? node.parent : null;
        }
      };
      addBoneAndAncestors(part.parent);
      for (const mod of stack) {
        if (!mod || mod.type !== 'armature' || mod.enabled === false) continue;
        const jointBoneId = mod.data?.jointBoneId
          ?? part?.mesh?.jointBoneId
          ?? null;
        if (jointBoneId) addBoneAndAncestors(jointBoneId);
        const parentBoneId = mod.data?.parentBoneId ?? null;
        if (parentBoneId) addBoneAndAncestors(parentBoneId);
      }
    }
  }
}

/**
 * Per physics rule, wire input PARAM_EVAL → PHYSICS_EVAL → output
 * PARAM_EVAL. The output side overrides the keyframe value, like a
 * driver.
 *
 * Adapted from `build_object_pointcache` / `build_rigidbody` — Blender's
 * physics caches consume input fields and emit transform/param updates.
 */
function buildPhysicsRelations(graph, project, opts) {
  const physicsId = graph.findIdNode('__physics__', 'physics');
  if (!physicsId) return;
  const physicsComp = physicsId.findComponent(NodeType.PARAMETERS);
  if (!physicsComp) return;
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')?.findComponent(NodeType.PARAMETERS);
  for (const rule of project.physicsRules ?? []) {
    if (!rule?.id) continue;
    const physicsOp = physicsComp.findOperation(OperationCode.PHYSICS_EVAL, rule.id);
    if (!physicsOp) continue;
    for (const inp of rule.inputs ?? []) {
      const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, inp?.paramId);
      if (paramOp) graph.addRelation(paramOp, physicsOp, 'physics input');
    }
    for (const out of rule.outputs ?? []) {
      const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, out?.paramId);
      if (paramOp) graph.addRelation(physicsOp, paramOp, 'physics output');
    }
  }
}

/**
 * DFS-based cycle detection. Tags every Relation that participates in
 * a cycle with `RelationFlag.CYCLIC`. Phase D-1 doesn't BREAK cycles
 * (the eval pass refuses to schedule cyclic ops); a future sub-phase
 * can port Blender's cycle-killer
 * (`deg_builder_cycle.cc:solve_cycles`).
 *
 * @param {DepGraph} graph
 * @returns {{ cyclesFound: number }}
 */
export function detectCycles(graph) {
  /** @type {Set<import('./types.js').Node>} */
  const visiting = new Set();
  /** @type {Set<import('./types.js').Node>} */
  const done = new Set();
  let cyclesFound = 0;

  /** @param {import('./types.js').Node} n @param {import('./types.js').Relation[]} pathRels */
  function dfs(n, pathRels) {
    if (done.has(n)) return;
    if (visiting.has(n)) {
      // Tag every relation along the cycle path back to n.
      for (let i = pathRels.length - 1; i >= 0; i--) {
        pathRels[i].flag |= RelationFlag.CYCLIC;
        if (pathRels[i].from === n) break;
      }
      cyclesFound++;
      return;
    }
    visiting.add(n);
    for (const out of n.outlinks) {
      pathRels.push(out);
      dfs(out.to, pathRels);
      pathRels.pop();
    }
    visiting.delete(n);
    done.add(n);
  }

  for (const op of graph.allOperations()) dfs(op, []);
  return { cyclesFound };
}
