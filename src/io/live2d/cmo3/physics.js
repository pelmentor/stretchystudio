/**
 * Physics emitter for .cmo3 export.
 *
 * Writes a `CPhysicsSettingsSourceSet` under the CModelSource root — the same
 * block Cubism Editor uses to store pendulum simulations. Each setting maps
 * a chain of input parameters (head/body angles) through a 2-vertex pendulum
 * onto one output parameter, producing lagged/damped motion.
 *
 * The runtime derives `.physics3.json` from this block when the user exports
 * for the SDK. The cmo3 authoring format is the source of truth.
 *
 * Rule → wire correspondence: physics only causes VISIBLE motion when the
 * output parameter already has a warp / rotation deformer keyformed on it.
 * We ship rules only for outputs with existing warp bindings in cmo3writer:
 *   - ParamHairFront (warped by the 'front hair' tag entry in TAG_PARAM_BINDINGS)
 *   - ParamHairBack  ('back hair')
 *   - ParamSkirt     (new — matching warp binding added in cmo3writer's
 *                     TAG_PARAM_BINDINGS for the 'bottomwear' tag)
 *
 * Extra rules can be appended to PHYSICS_RULES; each is automatically skipped
 * if its output parameter isn't present in the project (paramDefs) or if no
 * mesh carries its `requireTag`.
 *
 * Reverse-engineered from reference/live2d-sample/Hiyori/cmo3_extracted/main.xml
 * lines 128753–130446. Parameter guids and types match Hiyori's numbers so the
 * default feel is close to Cubism's sample-model tuning.
 *
 * @module io/live2d/cmo3/physics
 */

import { uuid } from '../xmlbuilder.js';

/**
 * Format a float so integers get a trailing `.0`, matching Hiyori's XML
 * where `<f>` values are always written with at least one decimal. Java
 * accepts both forms, but matching the reference keeps diffs readable.
 */
function f(n) {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * @typedef {Object} PhysicsInputSpec
 * @property {string} paramId - Source parameter ID (must exist in paramDefs)
 * @property {'SRC_TO_X'|'SRC_TO_Y'|'SRC_TO_G_ANGLE'} type
 * @property {number} weight - 0..100
 * @property {boolean} [isReverse=false]
 */

/**
 * @typedef {Object} PhysicsVertexSpec
 * @property {number} x
 * @property {number} y
 * @property {number} mobility - 0..1, how much this vertex swings vs stays put
 * @property {number} delay    - 0..1, phase lag
 * @property {number} acceleration - typically 1.0..2.0
 * @property {number} radius
 */

/**
 * @typedef {Object} PhysicsOutputSpec
 * @property {string} paramId      - Destination parameter ID
 * @property {number} vertexIndex  - Which pendulum vertex drives this output
 *                                   (1..N-1; later = more lag)
 * @property {number} scale        - Max angle (degrees) at full swing.
 *                                   For outputs that drive a CRotationDeformer's
 *                                   angle param (ParamRotation_*) this is
 *                                   literally the max rotation in degrees.
 *                                   For outputs into a ±1 sway param clamp on ±1.
 * @property {boolean} [isReverse] - Mirror the output sign. Used for
 *                                   symmetric cross-body outputs (e.g. right arm
 *                                   mirrored from left arm's pendulum tap).
 */

/**
 * @typedef {Object} PhysicsBoneOutputSpec
 * @property {string} boneRole     - Group `boneRole` (e.g. 'leftElbow'); emitter
 *                                   resolves to the group's auto-generated
 *                                   `ParamRotation_<sanitizedGroupName>` param.
 * @property {number} vertexIndex
 * @property {number} scale        - Degrees at full pendulum swing.
 * @property {boolean} [isReverse]
 */

/**
 * @typedef {Object} PhysicsRule
 * @property {string} id        - Editor ID (e.g. "PhysicsSetting1")
 * @property {string} name      - Human-readable name
 * @property {string} [outputParamId]  - Legacy single-output: destination param ID.
 *                                       Ignored when `outputs` is present.
 * @property {number} [outputScale]    - Legacy single-output: max angle at full swing
 * @property {PhysicsOutputSpec[]} [outputs] - Multi-output: one pendulum drives
 *                                             multiple params at different vertex
 *                                             indices (snake-chain cascade).
 *                                             Takes precedence over outputParamId.
 * @property {string|null} [requireTag] - Skip rule if no mesh has this tag (null = always emit). Takes precedence over requireAnyTag.
 * @property {string[]|null} [requireAnyTag] - Skip rule unless ≥1 of these tags is present.
 * @property {'hair'|'clothing'|'bust'|'arms'} category - UI-level group for enable toggles
 * @property {PhysicsInputSpec[]} inputs
 * @property {PhysicsVertexSpec[]} vertices - typically 2 (root + tip); longer for snake chains
 * @property {{posMin:number,posMax:number,posDef:number,angleMin:number,angleMax:number,angleDef:number}} normalization
 */

/**
 * Resolve a rule to its list of `{paramId, vertexIndex, scale, isReverse}` outputs.
 * `boneOutputs` are resolved against the `groups` list (looked up by boneRole) —
 * each becomes an output into that group's `ParamRotation_<name>` param.
 */
function ruleOutputs(rule, groups) {
  const out = [];
  if (rule.outputs && rule.outputs.length > 0) {
    for (const o of rule.outputs) {
      out.push({ paramId: o.paramId, vertexIndex: o.vertexIndex, scale: o.scale, isReverse: !!o.isReverse });
    }
  } else if (rule.outputParamId) {
    // Legacy single-output: tap the pendulum tip at the configured outputScale.
    out.push({
      paramId: rule.outputParamId,
      vertexIndex: rule.vertices.length - 1,
      scale: rule.outputScale,
      isReverse: false,
    });
  }
  if (rule.boneOutputs && rule.boneOutputs.length > 0 && Array.isArray(groups)) {
    const byRole = new Map();
    for (const g of groups) {
      if (g && g.boneRole) byRole.set(g.boneRole, g);
    }
    for (const b of rule.boneOutputs) {
      const g = byRole.get(b.boneRole);
      if (!g) continue; // bone absent on this character — silently skip
      const sanitized = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
      out.push({
        paramId: `ParamRotation_${sanitized}`,
        vertexIndex: b.vertexIndex,
        scale: b.scale,
        isReverse: !!b.isReverse,
      });
    }
  }
  return out;
}

/** @type {PhysicsRule[]} */
export const PHYSICS_RULES = [
  // ── Hair Front: short strand, follows head yaw/tilt + slight body lean ──
  // Warp binding: cmo3writer TAG_PARAM_BINDINGS['front hair'] sways tips on
  // ±1. Pendulum length=3 (Hiyori default for front strands).
  {
    id: 'PhysicsSetting1',
    name: 'Hair Front',
    outputParamId: 'ParamHairFront',
    outputScale: 1.522,
    requireTag: 'front hair',
    category: 'hair',
    inputs: [
      { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
      { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 3,  mobility: 0.95, delay: 0.9, acceleration: 1.5, radius: 3 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Hair Back: longer strand, dominant body-angle driver ──
  // Warp binding: TAG_PARAM_BINDINGS['back hair']. Pendulum length=15 — long
  // back hair has much longer lag than front strands.
  {
    id: 'PhysicsSetting2',
    name: 'Hair Back',
    outputParamId: 'ParamHairBack',
    outputScale: 2.061,
    requireTag: 'back hair',
    category: 'hair',
    inputs: [
      { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
      { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 15, mobility: 0.95, delay: 0.8, acceleration: 1.5, radius: 15 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -30, angleDef: 0, angleMax: 30,
    },
  },

  // ── Skirt sway: hem swings with body lean ──
  // Warp binding: TAG_PARAM_BINDINGS['bottomwear'] — bottom (hem) row sways
  // ±1 while waist row stays pinned. Body-only drivers (hair doesn't drive
  // skirt; skirt is attached to body, not head).
  {
    id: 'PhysicsSetting3',
    name: 'Skirt',
    outputParamId: 'ParamSkirt',
    outputScale: 1.434,
    requireTag: 'bottomwear',
    category: 'clothing',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 100 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0, delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 10, mobility: 0.9, delay: 0.6, acceleration: 1.5, radius: 10 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Shirt hem sway: topwear bottom edge flutters with body lean ──
  // Warp binding: TAG_PARAM_BINDINGS['topwear']. Shorter pendulum (y=6) +
  // medium delay (0.7) than skirt — fitted shirts snap back faster than
  // flowing skirts. Useful fallback when the character's topwear is a single
  // mesh covering torso+sleeves (common; PSD split for proper sleeve physics
  // is a separate infra task).
  {
    id: 'PhysicsSetting4',
    name: 'Shirt',
    outputParamId: 'ParamShirt',
    outputScale: 1.0,
    requireTag: 'topwear',
    category: 'clothing',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 100 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0, mobility: 1.0, delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 6, mobility: 0.9, delay: 0.7, acceleration: 1.5, radius: 6 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Pants hem sway: legwear bottom edge flutters with body lean ──
  // Warp binding: TAG_PARAM_BINDINGS['legwear']. Longer pendulum (y=12) +
  // faster delay (0.5) — heavier fabric, less snappy. Output scale 0.8 caps
  // the max swing to match pants' real-world tight-at-ankle behavior; flared
  // / wide-leg designs can be bumped upward per-character if needed.
  {
    id: 'PhysicsSetting5',
    name: 'Pants',
    outputParamId: 'ParamPants',
    outputScale: 0.8,
    requireTag: 'legwear',
    category: 'clothing',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 100 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 12, mobility: 0.85, delay: 0.5, acceleration: 1.5, radius: 12 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Bust wobble: chest area bulges up/down when body tilts ──
  // Warp binding: TAG_PARAM_BINDINGS['topwear'] (second entry in bindings[]).
  // Short pendulum (y=3) + low delay (0.4) + high accel (2.0) = snappy
  // jiggle response classic to anime bust physics. The warp itself only
  // shifts the mid-row / center-column region so shoulders and hem stay
  // pinned — no layer-exposure risk.
  {
    id: 'PhysicsSetting6',
    name: 'Bust',
    outputParamId: 'ParamBust',
    outputScale: 1.0,
    requireTag: 'topwear',
    category: 'bust',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 100 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
      { paramId: 'ParamBodyAngleY', type: 'SRC_TO_X',       weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0, mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 3, mobility: 0.95, delay: 0.4, acceleration: 2.0, radius: 3 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Arm sway: elbow-driven pendulum on body tilt/roll ──
  //
  // Physics taps the EXISTING bone rotation deformers directly on both arms
  // (`ParamRotation_leftElbow` / `ParamRotation_rightElbow`). No rigWarp, no
  // shiftFn, no synthetic sway param — Cubism rotates the forearm subtree
  // around each bone's canonical pivot when the param moves, exactly the
  // way pose animation uses these deformers.
  //
  // Why elbow and not shoulder: shoulder rotation moves the entire arm
  // including the attachment point, which reads as the body itself shifting.
  // Elbow rotates only forearm + hand around the elbow pivot — correct
  // inertial sway.
  //
  // Pendulum is SHORT (y=0..10, 3 verts) for in-phase response with body
  // motion — a longer pendulum (Alexia's y=42) has a slow natural period
  // that arrives AFTER the body settles, reading as "arm bouncing on still
  // torso." Short+damped = in-phase, settles in ~0.3 s.
  //
  // scale=4° at full pendulum swing is ~13% slider travel on the ±30° rotation
  // param → subtle inertial sway, reads as breath/life (user-confirmed
  // "то, что надо" at scale=4). Right side uses isReverse=true so body roll
  // sways both forearms in the same canvas direction.
  //
  // A true snake-whip (5 stacked rotation deformers per arm like Alexia's
  // PS11/PS12 on ArtMesh135/136/165/166) was attempted and reverted — it
  // would require mesh segmentation (splitting handwear into N sub-meshes,
  // each bone-skinned to its own chain joint) to avoid the single-mesh
  // "rigid rotation per joint" problem. Auto-segmenting without visible
  // seams is substantial rigger work; single-elbow sway was kept as the
  // robust baseline.
  {
    id: 'PhysicsSetting_ArmSnake',
    name: 'Arm Sway',
    requireAnyTag: ['handwear', 'handwear-l', 'handwear-r'],
    category: 'arms',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 50  },
      { paramId: 'ParamBodyAngleY', type: 'SRC_TO_X',       weight: 50  },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.00, delay: 1.0, acceleration: 1.0, radius: 0  },
      { x: 0, y: 4,  mobility: 0.95, delay: 0.5, acceleration: 1.2, radius: 4  },
      { x: 0, y: 10, mobility: 0.90, delay: 0.5, acceleration: 1.5, radius: 10 },
    ],
    boneOutputs: [
      { boneRole: 'leftElbow',  vertexIndex: 2, scale: 4.0, isReverse: false },
      { boneRole: 'rightElbow', vertexIndex: 2, scale: 4.0, isReverse: true  },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },
];

/**
 * Emit a `CPhysicsSettingsSourceSet` into `parent`.
 *
 * @param {import('../xmlbuilder.js').XmlBuilder} x
 * @param {Object} ctx
 * @param {Object} ctx.parent          - XML node to append the set to (usually `model`)
 * @param {Array<{pid:string,id:string}>} ctx.paramDefs - From generateCmo3
 * @param {Iterable<{tag:string|null}>} ctx.meshes      - For requireTag gating
 * @param {Object|null} [ctx.rigDebugLog]               - Optional diagnostic sink
 * @param {Set<string>|null} [ctx.disabledCategories]   - Category names to skip (e.g. new Set(['hair']))
 * @returns {{emittedCount:number, skipped:Array<{id:string,reason:string}>}}
 */
export function emitPhysicsSettings(x, {
  parent, paramDefs, meshes, groups = [], rigDebugLog = null, disabledCategories = null,
}) {
  const pidByParamId = new Map();
  for (const p of paramDefs) pidByParamId.set(p.id, p.pid);

  const tagsPresent = new Set();
  for (const m of meshes || []) {
    if (m && m.tag) tagsPresent.add(m.tag);
  }

  const rulesToEmit = [];
  const skipped = [];
  for (const rule of PHYSICS_RULES) {
    if (disabledCategories && rule.category && disabledCategories.has(rule.category)) {
      skipped.push({ id: rule.id, reason: `category '${rule.category}' disabled in UI` });
      continue;
    }
    // Tag gating first — cheaper than output resolution and gives clearer
    // skip reasons (a rule for which no tagged mesh exists shouldn't be
    // reported as "missing output param" just because we also happen not
    // to have its output params defined).
    if (rule.requireTag && !tagsPresent.has(rule.requireTag)) {
      skipped.push({ id: rule.id, reason: `no mesh with tag '${rule.requireTag}'` });
      continue;
    }
    if (rule.requireAnyTag && !rule.requireAnyTag.some(t => tagsPresent.has(t))) {
      skipped.push({
        id: rule.id,
        reason: `no mesh with any of tags [${rule.requireAnyTag.join(', ')}]`,
      });
      continue;
    }
    const outs = ruleOutputs(rule, groups);
    if (outs.length === 0) {
      skipped.push({ id: rule.id, reason: 'no resolvable outputs (no matching boneRoles + no paramId)' });
      continue;
    }
    const missingOut = outs.find(o => !pidByParamId.has(o.paramId));
    if (missingOut) {
      skipped.push({ id: rule.id, reason: `missing output param ${missingOut.paramId}` });
      continue;
    }
    // All input parameters must exist — skip rules with dangling refs.
    const missingInput = rule.inputs.find(inp => !pidByParamId.has(inp.paramId));
    if (missingInput) {
      skipped.push({ id: rule.id, reason: `missing input param ${missingInput.paramId}` });
      continue;
    }
    rulesToEmit.push({ rule });
  }

  const set = x.sub(parent, 'CPhysicsSettingsSourceSet', { 'xs.n': 'physicsSettingsSourceSet' });
  const list = x.sub(set, 'carray_list', {
    'xs.n': '_sourceCubismPhysics', count: String(rulesToEmit.length),
  });

  for (const { rule } of rulesToEmit) {
    emitOneSetting(x, list, rule, pidByParamId, groups);
  }

  // `selectedCubismPhysics` is the Editor's "current selection" state; Hiyori
  // emits a fresh uuid that doesn't match any setting guid. Safe to mint a
  // random one — the field isn't referenced elsewhere in the model tree.
  x.sub(set, 'CPhysicsSettingsGuid', {
    'xs.n': 'selectedCubismPhysics',
    uuid: uuid(),
    note: 'physics-selection',
  });
  x.sub(set, 'null', { 'xs.n': 'settingFPS' });

  if (rigDebugLog) {
    rigDebugLog.physics = {
      emittedCount: rulesToEmit.length,
      emittedIds: rulesToEmit.map(r => r.rule.id),
      skipped,
    };
  }

  return { emittedCount: rulesToEmit.length, skipped };
}

/** Emit a single CPhysicsSettingsSource node into `list`. */
function emitOneSetting(x, list, rule, pidByParamId, groups) {
  const src = x.sub(list, 'CPhysicsSettingsSource');
  x.sub(src, 's', { 'xs.n': 'name' }).text = rule.name;
  x.sub(src, 'CPhysicsSettingsGuid', {
    'xs.n': 'guid', uuid: uuid(), note: rule.name,
  });
  x.sub(src, 'CPhysicsSettingId', { 'xs.n': 'id', idstr: rule.id });

  // ── Inputs ──
  const inputsNode = x.sub(src, 'carray_list', {
    'xs.n': 'inputs', count: String(rule.inputs.length),
  });
  for (const inp of rule.inputs) {
    const inpNode = x.sub(inputsNode, 'CPhysicsInput');
    x.sub(inpNode, 'CPhysicsDataGuid', {
      'xs.n': 'guid', uuid: uuid(), note: `in_${rule.id}_${inp.paramId}`,
    });
    x.subRef(inpNode, 'CParameterGuid', pidByParamId.get(inp.paramId), { 'xs.n': 'source' });
    x.sub(inpNode, 'f', { 'xs.n': 'angleScale' }).text = '0.0';
    const ts = x.sub(inpNode, 'GVector2', { 'xs.n': 'translationScale' });
    x.sub(ts, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(ts, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.sub(inpNode, 'f', { 'xs.n': 'weight' }).text = f(inp.weight);
    x.sub(inpNode, 'CPhysicsSourceType', { 'xs.n': 'type', v: inp.type });
    x.sub(inpNode, 'b', { 'xs.n': 'isReverse' }).text = inp.isReverse ? 'true' : 'false';
  }

  // ── Outputs ──
  // One pendulum can drive multiple destination params, each tapping a
  // different vertex index and with its own scale. Alexia uses this for
  // snake chains (PhysicsSetting9/10/11/12): vertex 1 drives the upper
  // joint with a tiny scale, successive joints read later vertices with
  // progressively larger scales, producing a lag-and-grow whip.
  const outs = ruleOutputs(rule, groups);
  const outputsNode = x.sub(src, 'carray_list', {
    'xs.n': 'outputs', count: String(outs.length),
  });
  for (let oi = 0; oi < outs.length; oi++) {
    const o = outs[oi];
    const outPid = pidByParamId.get(o.paramId);
    const outNode = x.sub(outputsNode, 'CPhysicsOutput');
    x.sub(outNode, 'CPhysicsDataGuid', {
      'xs.n': 'guid', uuid: uuid(), note: `out_${rule.id}_${o.paramId}`,
    });
    x.subRef(outNode, 'CParameterGuid', outPid, { 'xs.n': 'destination' });
    x.sub(outNode, 'i', { 'xs.n': 'vertexIndex' }).text = String(o.vertexIndex);
    const outTs = x.sub(outNode, 'GVector2', { 'xs.n': 'translationScale' });
    x.sub(outTs, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(outTs, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.sub(outNode, 'f', { 'xs.n': 'angleScale' }).text = f(o.scale);
    x.sub(outNode, 'f', { 'xs.n': 'weight' }).text = '100.0';
    x.sub(outNode, 'CPhysicsSourceType', { 'xs.n': 'type', v: 'SRC_TO_G_ANGLE' });
    x.sub(outNode, 'b', { 'xs.n': 'isReverse' }).text = o.isReverse ? 'true' : 'false';
  }

  // ── Vertices (pendulum chain) ──
  const vxNode = x.sub(src, 'carray_list', {
    'xs.n': 'vertices', count: String(rule.vertices.length),
  });
  for (let i = 0; i < rule.vertices.length; i++) {
    const vs = rule.vertices[i];
    const v = x.sub(vxNode, 'CPhysicsVertex');
    x.sub(v, 'CPhysicsDataGuid', {
      'xs.n': 'guid', uuid: uuid(), note: `v${i}_${rule.id}`,
    });
    const pos = x.sub(v, 'GVector2', { 'xs.n': 'position' });
    x.sub(pos, 'f', { 'xs.n': 'x' }).text = f(vs.x);
    x.sub(pos, 'f', { 'xs.n': 'y' }).text = f(vs.y);
    x.sub(v, 'f', { 'xs.n': 'mobility' }).text = f(vs.mobility);
    x.sub(v, 'f', { 'xs.n': 'delay' }).text = f(vs.delay);
    x.sub(v, 'f', { 'xs.n': 'acceleration' }).text = f(vs.acceleration);
    x.sub(v, 'f', { 'xs.n': 'radius' }).text = f(vs.radius);
  }

  // ── Normalization (editor's per-setting scalar ranges) ──
  const n = rule.normalization;
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionValueMax' }).text = f(n.posMax);
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionValueMin' }).text = f(n.posMin);
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionDefaultValue' }).text = f(n.posDef);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleValueMax' }).text = f(n.angleMax);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleValueMin' }).text = f(n.angleMin);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleDefaultValue' }).text = f(n.angleDef);
}
