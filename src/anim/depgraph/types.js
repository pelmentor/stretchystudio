// @ts-check

/**
 * DepGraph data structures.
 *
 * Phase D-1 of the V2 plan. Loose port of Blender's depsgraph node
 * hierarchy (`reference/blender/source/blender/depsgraph/intern/node/`).
 *
 * # Type hierarchy
 *
 * - `Node` (base): name + type + inlinks[] + outlinks[] + custom_flags.
 *   Adapted from `deg_node.hh:159-219`. SS skips Blender's `Stats`
 *   block and `init`/`tag_update` virtuals — eval is a pure function
 *   pass, no per-node mutable evaluator state.
 *
 * - `IDNode extends Node`: a per-ID-block container. Adapted from
 *   `deg_node_id.hh:38-138`. SS uses string `idType` + `idRef` (the
 *   project node id) instead of Blender's `ID_Type` enum + raw
 *   pointer. `components` is a Map<string, ComponentNode> keyed by
 *   `${type}::${name}`.
 *
 * - `ComponentNode extends Node`: a per-aspect-of-an-ID bucket
 *   (PARAMETERS, ANIMATION, TRANSFORM, GEOMETRY, ARMATURE). Adapted
 *   from `deg_node_component.hh:33-155`. SS skips Blender's
 *   `entry_operation` / `exit_operation` linking — every operation in
 *   a component is a graph node and inlinks are explicit.
 *
 * - `OperationNode extends Node`: the evaluation atom. Adapted from
 *   `deg_node_operation.hh:257-305`. Carries `evaluate(ctx)` callback
 *   + `numLinksPending` + `scheduled` + `opcode`. SS `evaluate` is a
 *   pure JS function `(ctx) => any` — outputs land in `ctx.outputs`
 *   keyed by op id.
 *
 * - `Relation`: edge from->to. Adapted from
 *   `depsgraph_relation.hh:35-49`. Carries `flag` bitmask
 *   (`RELATION_FLAG_CYCLIC` etc.). The relation is shared between
 *   `from.outlinks` and `to.inlinks` (one allocation, two pointers).
 *
 * # NodeType subset
 *
 * SS skips most of Blender's NodeType enum (no SEQUENCER, COMPOSITOR,
 * SHADING, AUDIO, ...). The kept subset:
 *
 * - `UNDEFINED` — fallback / error sentinel
 * - `OPERATION` — leaf eval node
 * - `TIMESOURCE` — playhead (one per graph)
 * - `ID_REF` — project IDNode root
 * - `PARAMETERS` — paramValues + driver outputs
 * - `ANIMATION` — FCurves + track strips
 * - `TRANSFORM` — bone pose / part transform
 * - `GEOMETRY` — mesh + modifier stack
 * - `ARMATURE` — bone hierarchy data (future)
 *
 * # OperationCode subset
 *
 * The opcodes SS ships in V2:
 *
 * - `TIME_TICK` — read playhead from animationStore
 * - `PARAM_EVAL` — read paramValueStore (or driver override)
 * - `FCURVE_EVAL` — `evaluateFCurve(track, time)`
 * - `DRIVER_EVAL` — `evaluateDriver(driver, ctx)`
 * - `KEYFORM_EVAL` — per warp / rotation, `cellSelect` + interpolate
 * - `MATRIX_BUILD` — rotation deformer matrix construction
 * - `GEOMETRY_EVAL_DEFORMED` — per part, iterate modifier stack
 * - `GRID_LIFT_TO_PARENT` — per warp, lift rest to parent's frame
 * - `ROTATION_SETUP_PROBE` — FD-Jacobian for rotation deformer
 * - `PHYSICS_EVAL` — per physics rule, tickPhysics
 * - `ANIMATION_TRACK_EVAL` — per track, compute paramOverride / poseOverride
 *
 * @module anim/depgraph/types
 */

/** Meta-classification per `deg_node.hh:34-46`. */
export const NodeClass = Object.freeze({
  GENERIC:   /** @type {const} */ ('GENERIC'),
  COMPONENT: /** @type {const} */ ('COMPONENT'),
  OPERATION: /** @type {const} */ ('OPERATION'),
});

/** SS subset of Blender's `NodeType` enum (`deg_node.hh:49-149`). */
export const NodeType = Object.freeze({
  UNDEFINED:  'UNDEFINED',
  OPERATION:  'OPERATION',
  TIMESOURCE: 'TIMESOURCE',
  ID_REF:     'ID_REF',
  PARAMETERS: 'PARAMETERS',
  ANIMATION:  'ANIMATION',
  TRANSFORM:  'TRANSFORM',
  GEOMETRY:   'GEOMETRY',
  ARMATURE:   'ARMATURE',
});

/** SS opcodes for `OperationNode.opcode`. */
export const OperationCode = Object.freeze({
  TIME_TICK:              'TIME_TICK',
  PARAM_EVAL:             'PARAM_EVAL',
  FCURVE_EVAL:            'FCURVE_EVAL',
  DRIVER_EVAL:            'DRIVER_EVAL',
  KEYFORM_EVAL:           'KEYFORM_EVAL',
  MATRIX_BUILD:           'MATRIX_BUILD',
  GEOMETRY_EVAL_DEFORMED: 'GEOMETRY_EVAL_DEFORMED',
  GRID_LIFT_TO_PARENT:    'GRID_LIFT_TO_PARENT',
  ROTATION_SETUP_PROBE:   'ROTATION_SETUP_PROBE',
  PHYSICS_EVAL:           'PHYSICS_EVAL',
  ANIMATION_TRACK_EVAL:   'ANIMATION_TRACK_EVAL',
});

/** Relation flag bitmask per `depsgraph_relation.hh:17-32`. */
export const RelationFlag = Object.freeze({
  /** Cycle-breaker mark (`RELATION_FLAG_CYCLIC`). */
  CYCLIC:     1 << 0,
  /** Update flush will not go through this relation. */
  NO_FLUSH:   1 << 1,
  /** Indestructible by cycle solver — equivalent to `RELATION_FLAG_GODMODE`. */
  GODMODE:    1 << 4,
});

/**
 * Edge from `from` to `to`. `to` depends on `from`. The same Relation
 * instance is referenced by `from.outlinks` and `to.inlinks`.
 */
export class Relation {
  /**
   * @param {Node} from
   * @param {Node} to
   * @param {string} name - debug label
   */
  constructor(from, to, name) {
    /** @type {Node} */
    this.from = from;
    /** @type {Node} */
    this.to = to;
    /** @type {string} */
    this.name = name;
    /** @type {number} */
    this.flag = 0;
  }
}

/**
 * Base depgraph node. Every IDNode / ComponentNode / OperationNode
 * extends this.
 */
export class Node {
  /**
   * @param {string} name - identifier (unique within graph)
   * @param {typeof NodeType[keyof typeof NodeType]} type
   */
  constructor(name, type) {
    /** @type {string} */
    this.name = name;
    /** @type {typeof NodeType[keyof typeof NodeType]} */
    this.type = type;
    /** @type {Relation[]} - relations where this node is `to` */
    this.inlinks = [];
    /** @type {Relation[]} - relations where this node is `from` */
    this.outlinks = [];
    /** @type {number} - generic flag store for traversal algorithms */
    this.customFlags = 0;
  }

  /** @returns {typeof NodeClass[keyof typeof NodeClass]} */
  getClass() { return NodeClass.GENERIC; }
}

/**
 * Per-ID container. SS IDs are project, individual parts, deformers,
 * the param-values bag, animations.
 */
export class IDNode extends Node {
  /**
   * @param {string} idRef - project node id (or '__params__' / '__time__')
   * @param {string} idType - 'project' | 'part' | 'deformer' | 'param' | 'animation'
   */
  constructor(idRef, idType) {
    super(`ID:${idType}:${idRef}`, NodeType.ID_REF);
    /** @type {string} */
    this.idRef = idRef;
    /** @type {string} */
    this.idType = idType;
    /** @type {Map<string, ComponentNode>} - keyed by `${type}::${name}` */
    this.components = new Map();
  }

  getClass() { return NodeClass.GENERIC; }

  /**
   * @param {typeof NodeType[keyof typeof NodeType]} type
   * @param {string} [name]
   * @returns {ComponentNode|null}
   */
  findComponent(type, name = '') {
    return this.components.get(`${type}::${name}`) ?? null;
  }

  /**
   * @param {typeof NodeType[keyof typeof NodeType]} type
   * @param {string} [name]
   * @returns {ComponentNode}
   */
  addComponent(type, name = '') {
    const key = `${type}::${name}`;
    let comp = this.components.get(key);
    if (comp) return comp;
    comp = new ComponentNode(this, type, name);
    this.components.set(key, comp);
    return comp;
  }
}

/**
 * A per-aspect bucket inside an IDNode. Owns OperationNodes for that
 * aspect; aspects are the Blender Component types — TRANSFORM,
 * GEOMETRY, PARAMETERS, ANIMATION, ARMATURE.
 */
export class ComponentNode extends Node {
  /**
   * @param {IDNode} owner
   * @param {typeof NodeType[keyof typeof NodeType]} type
   * @param {string} [subname]
   */
  constructor(owner, type, subname = '') {
    super(`${owner.idRef}/${type}${subname ? `:${subname}` : ''}`, type);
    /** @type {IDNode} */
    this.owner = owner;
    /** @type {string} */
    this.subname = subname;
    /** @type {Map<string, OperationNode>} - keyed by `${opcode}::${tag}` */
    this.operations = new Map();
  }

  getClass() { return NodeClass.COMPONENT; }

  /**
   * @param {typeof OperationCode[keyof typeof OperationCode]} opcode
   * @param {string} [tag]
   * @returns {OperationNode|null}
   */
  findOperation(opcode, tag = '') {
    return this.operations.get(`${opcode}::${tag}`) ?? null;
  }

  /**
   * @param {typeof OperationCode[keyof typeof OperationCode]} opcode
   * @param {string} [tag]
   * @param {((ctx: object) => any)|null} [evaluate]
   * @returns {OperationNode}
   */
  addOperation(opcode, tag = '', evaluate = null) {
    const key = `${opcode}::${tag}`;
    let op = this.operations.get(key);
    if (op) {
      if (evaluate) op.evaluate = evaluate;
      return op;
    }
    op = new OperationNode(this, opcode, tag, evaluate);
    this.operations.set(key, op);
    return op;
  }
}

/**
 * Atomic evaluation operation. The kernel callback `evaluate(ctx)`
 * runs at eval time, with `ctx.outputs` providing upstream op outputs
 * keyed by op `name`.
 */
export class OperationNode extends Node {
  /**
   * @param {ComponentNode} owner
   * @param {typeof OperationCode[keyof typeof OperationCode]} opcode
   * @param {string} tag
   * @param {((ctx: object) => any)|null} evaluate
   */
  constructor(owner, opcode, tag, evaluate) {
    super(`${owner.name}/${opcode}${tag ? `:${tag}` : ''}`, NodeType.OPERATION);
    /** @type {ComponentNode} */
    this.owner = owner;
    /** @type {typeof OperationCode[keyof typeof OperationCode]} */
    this.opcode = opcode;
    /** @type {string} */
    this.tag = tag;
    /** @type {((ctx: object) => any)|null} */
    this.evaluate = evaluate;
    /** @type {number} - decremented as upstream ops complete; ready when 0 */
    this.numLinksPending = 0;
    /** @type {boolean} */
    this.scheduled = false;
    /** @type {number} - extra opcode-specific flags */
    this.flag = 0;
  }

  getClass() { return NodeClass.OPERATION; }

  /** True when there is no callback (relay-only node). */
  isNoop() { return this.evaluate == null; }
}

/**
 * The full graph. Holds IDNodes + the relation list, and offers
 * helpers for adding relations + finding operations across IDs.
 *
 * Phase D-1 — structural only. Eval pass + tagging are added by
 * `eval.js` (Phase D-2).
 */
export class DepGraph {
  constructor() {
    /** @type {Map<string, IDNode>} - keyed by IDNode.name */
    this.idNodes = new Map();
    /** @type {Relation[]} - all relations, owned here for cleanup */
    this.relations = [];
    /** @type {IDNode|null} - the timesource is its own special IDNode */
    this.timeSource = null;
  }

  /**
   * @param {string} idRef
   * @param {string} idType
   * @returns {IDNode}
   */
  addIdNode(idRef, idType) {
    const key = `ID:${idType}:${idRef}`;
    let node = this.idNodes.get(key);
    if (node) return node;
    node = new IDNode(idRef, idType);
    this.idNodes.set(key, node);
    return node;
  }

  /**
   * @param {string} idRef
   * @param {string} idType
   * @returns {IDNode|null}
   */
  findIdNode(idRef, idType) {
    return this.idNodes.get(`ID:${idType}:${idRef}`) ?? null;
  }

  /**
   * Add a Relation from→to. If both endpoints already share a relation
   * with the same `name`, returns the existing one (de-dupe).
   *
   * @param {Node} from
   * @param {Node} to
   * @param {string} name
   * @returns {Relation}
   */
  addRelation(from, to, name) {
    for (const r of from.outlinks) {
      if (r.to === to && r.name === name) return r;
    }
    const rel = new Relation(from, to, name);
    from.outlinks.push(rel);
    to.inlinks.push(rel);
    this.relations.push(rel);
    return rel;
  }

  /**
   * Walk every OperationNode in the graph (across all IDNodes +
   * components). Order is insertion order (the build pass produces
   * stable order); topological iteration is the eval pass's job.
   *
   * @returns {OperationNode[]}
   */
  allOperations() {
    /** @type {OperationNode[]} */
    const out = [];
    for (const idNode of this.idNodes.values()) {
      for (const comp of idNode.components.values()) {
        for (const op of comp.operations.values()) out.push(op);
      }
    }
    return out;
  }
}
