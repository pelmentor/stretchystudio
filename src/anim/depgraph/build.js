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

/** Synthetic IDNode ids for the depgraph's bookkeeping IDs. */
export const TIME_ID_REF = '__time__';
export const PARAM_ID_REF = '__params__';
export const ANIMATION_ID_REF = '__animation__';

/**
 * @typedef {object} BuildOptions
 * @property {object|null} [animation] - active animation clip
 *   (project.animations[i]) — used to wire ANIMATION_TRACK_EVAL nodes.
 *   Pass null for static-rig graphs.
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
    if (!node || node.type !== 'deformer') continue;
    const idNode = graph.addIdNode(node.id, 'deformer');
    const geom = idNode.addComponent(NodeType.GEOMETRY);
    geom.addOperation(OperationCode.KEYFORM_EVAL);
    if (node.deformerKind === 'rotation') {
      geom.addOperation(OperationCode.MATRIX_BUILD);
      geom.addOperation(OperationCode.ROTATION_SETUP_PROBE);
    } else {
      geom.addOperation(OperationCode.GRID_LIFT_TO_PARENT);
    }
  }

  // Per-part IDNodes. GEOMETRY_EVAL_DEFORMED iterates the modifier
  // stack at eval time. TRANSFORM op reserved for parts that have
  // bone-driven transforms (Phase D-3a will populate it).
  for (const node of project.nodes ?? []) {
    if (!node || node.type !== 'part') continue;
    const idNode = graph.addIdNode(node.id, 'part');
    const geom = idNode.addComponent(NodeType.GEOMETRY);
    geom.addOperation(OperationCode.GEOMETRY_EVAL_DEFORMED);
  }

  // FCurve / Driver / Animation operations — only when an active
  // animation is provided.
  const anim = opts.animation;
  if (anim) {
    const animIdNode = graph.addIdNode(ANIMATION_ID_REF, 'animation');
    const animComp = animIdNode.addComponent(NodeType.ANIMATION);
    for (const track of anim.tracks ?? []) {
      if (!track?.targetId) continue;
      const tag = `${track.targetId}/${track.property ?? 'value'}`;
      animComp.addOperation(OperationCode.ANIMATION_TRACK_EVAL, tag);
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
  const animIdNode = graph.findIdNode(ANIMATION_ID_REF, 'animation');
  if (!animIdNode) return;
  const animComp = animIdNode.findComponent(NodeType.ANIMATION);
  if (!animComp) return;
  for (const op of animComp.operations.values()) {
    if (op.opcode === OperationCode.ANIMATION_TRACK_EVAL ||
        op.opcode === OperationCode.FCURVE_EVAL) {
      graph.addRelation(timeOp, op, 'time -> track');
    }
  }
}

/**
 * ANIMATION_TRACK_EVAL → target's PARAM_EVAL (or part's TRANSFORM,
 * for pose tracks). Each track outputs a value that overrides the
 * downstream eval.
 *
 * Adapted from `build_animdata_action` —
 * `reference/blender/source/blender/depsgraph/intern/builder/deg_builder_relations.cc`
 * (the action's fcurves create OperationDescriptor edges to the
 * driven property's owner Component).
 */
function buildAnimationRelations(graph, project, opts) {
  const anim = opts.animation;
  if (!anim) return;
  const animIdNode = graph.findIdNode(ANIMATION_ID_REF, 'animation');
  if (!animIdNode) return;
  const animComp = animIdNode.findComponent(NodeType.ANIMATION);
  if (!animComp) return;
  const paramComp = graph.findIdNode(PARAM_ID_REF, 'params')?.findComponent(NodeType.PARAMETERS);
  for (const track of anim.tracks ?? []) {
    if (!track?.targetId) continue;
    const tag = `${track.targetId}/${track.property ?? 'value'}`;
    const trackOp = animComp.findOperation(OperationCode.ANIMATION_TRACK_EVAL, tag);
    if (!trackOp) continue;
    // Target is a parameter? wire to PARAM_EVAL.
    const paramOp = paramComp?.findOperation(OperationCode.PARAM_EVAL, track.targetId);
    if (paramOp) {
      graph.addRelation(trackOp, paramOp, 'track -> param');
    }
    // TRANSFORM target — Phase D-3a will wire pose tracks into
    // per-part TRANSFORM ops once they exist.
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
      //   `objects['__params__'].values['<id>']`
      const m = /objects\['__params__'\]\.values\['([^']+)'\]/.exec(rnaPath);
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
    if (!node || node.type !== 'deformer') continue;
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
    if (node.deformerKind === 'rotation') {
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
        if (typeof node.parent === 'string' && node.parent.length > 0) {
          const parentId = graph.findIdNode(node.parent, 'deformer');
          const parentGeom = parentId?.findComponent(NodeType.GEOMETRY);
          const parentLift = parentGeom?.findOperation(OperationCode.GRID_LIFT_TO_PARENT);
          if (parentLift) {
            graph.addRelation(parentLift, liftOp, 'parent lift -> child lift');
          }
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
    if (!evalOp) continue;
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
        graph.addRelation(defOp, evalOp, `modifier ${mod.deformerId} -> part`);
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
