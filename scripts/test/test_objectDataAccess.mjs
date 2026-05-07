// Phase 1A — Tests for src/store/objectDataAccess.js
//
// Verifies the compat-helper layer reads v17 nodes correctly. Phase 1B
// will add v18 cases; for now every assertion is on the current shape.
//
// Run: node scripts/test/test_objectDataAccess.mjs

import {
  isObject,
  isMeshedPart,
  isBoneGroup,
  isPlainGroup,
  isDeformer,
  getMesh,
  getMeshOpts,
  getMeshVertices,
  getMeshTriangles,
  getBlendShapes,
  getBlendShapeValues,
  getBoneRole,
  getBoneRestPivot,
  getBonePose,
  getTransform,
} from '../../src/store/objectDataAccess.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const meshedPart = {
  id: 'p1', type: 'part', name: 'face', parent: 'g1',
  draw_order: 0, opacity: 1, visible: true, clip_mask: null,
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 200 },
  meshOpts: { alphaThreshold: 0.5, smoothPasses: 2, gridSpacing: 30, edgePadding: 4, numEdgePoints: 16 },
  mesh: {
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    uvs:      [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }],
    triangles: [0, 1, 2],
    edgeIndices: [0, 1, 1, 2, 2, 0],
  },
  blendShapes: [{ id: 'smile', name: 'Smile', deltas: [{ dx: 0, dy: 0 }] }],
  blendShapeValues: { smile: 0 },
};

const unmeshedPart = {
  id: 'p2', type: 'part', name: 'hair', parent: 'g1',
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  mesh: null,
  meshOpts: null,
  blendShapes: [],
  blendShapeValues: {},
};

const boneNeck = {
  id: 'g1', type: 'group', name: 'neck', parent: 'g0', boneRole: 'neck',
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 300 },
  pose:      { rotation: 0.5, x: 12, y: -3, scaleX: 1.05, scaleY: 1 },
};

const boneNoPose = {
  id: 'g2', type: 'group', name: 'head', parent: 'g1', boneRole: 'head',
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 200 },
  // pose missing — getBonePose should synthesise identity
};

const plainGroup = {
  id: 'g3', type: 'group', name: 'Folder', parent: null,
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
};

const warpDeformer = {
  id: 'd1', type: 'deformer', deformerKind: 'warp', name: 'BodyWarp',
  parent: null, gridSize: { rows: 4, cols: 4 },
  baseGrid: new Float32Array(32), bindings: [], keyforms: [],
};

// ── Type predicates ───────────────────────────────────────────────────────

assert(isObject(meshedPart) === true,  'isObject: meshed part');
assert(isObject(boneNeck)   === true,  'isObject: bone group');
assert(isObject(plainGroup) === true,  'isObject: plain group');
assert(isObject(warpDeformer) === false, 'isObject: deformer is not an object');
assert(isObject(null)       === false, 'isObject: null');
assert(isObject(undefined)  === false, 'isObject: undefined');
assert(isObject({})         === false, 'isObject: empty object (no type)');

assert(isMeshedPart(meshedPart) === true,  'isMeshedPart: part with mesh');
assert(isMeshedPart(unmeshedPart) === false, 'isMeshedPart: part without mesh');
assert(isMeshedPart(unmeshedPart, null, { requireMesh: false }) === true,
       'isMeshedPart: part without mesh, requireMesh=false');
assert(isMeshedPart(boneNeck) === false,   'isMeshedPart: bone is not a meshed part');
assert(isMeshedPart(plainGroup) === false, 'isMeshedPart: plain group is not a meshed part');

assert(isBoneGroup(boneNeck)    === true,  'isBoneGroup: group with boneRole');
assert(isBoneGroup(plainGroup)  === false, 'isBoneGroup: group without boneRole');
assert(isBoneGroup(meshedPart)  === false, 'isBoneGroup: part is not a bone');
assert(isBoneGroup(warpDeformer) === false, 'isBoneGroup: deformer is not a bone');

assert(isPlainGroup(plainGroup) === true,  'isPlainGroup: group without boneRole');
assert(isPlainGroup(boneNeck)   === false, 'isPlainGroup: bone IS a group with role, NOT plain');

assert(isDeformer(warpDeformer) === true,  'isDeformer: deformer node');
assert(isDeformer(meshedPart)   === false, 'isDeformer: part');
assert(isDeformer(boneNeck)     === false, 'isDeformer: bone');

// ── Mesh accessors ────────────────────────────────────────────────────────

assert(getMesh(meshedPart) === meshedPart.mesh,
       'getMesh: returns the mesh sub-object identity (no copy)');
assert(getMesh(unmeshedPart) === null,    'getMesh: null for unmeshed part');
assert(getMesh(boneNeck) === null,        'getMesh: null for bone');
assert(getMesh(warpDeformer) === null,    'getMesh: null for deformer');
assert(getMesh(null) === null,            'getMesh: null for null');

assert(getMeshOpts(meshedPart) === meshedPart.meshOpts, 'getMeshOpts: identity');
assert(getMeshOpts(unmeshedPart) === null, 'getMeshOpts: null for unmeshed (meshOpts: null)');
assert(getMeshOpts(boneNeck) === null,    'getMeshOpts: null for bone');

assert(getMeshVertices(meshedPart) === meshedPart.mesh.vertices,
       'getMeshVertices: identity to mesh.vertices');
assert(getMeshVertices(unmeshedPart) === null, 'getMeshVertices: null for unmeshed');
assert(getMeshVertices(boneNeck) === null, 'getMeshVertices: null for bone');

assert(getMeshTriangles(meshedPart) === meshedPart.mesh.triangles,
       'getMeshTriangles: identity to mesh.triangles');
assert(getMeshTriangles(unmeshedPart) === null, 'getMeshTriangles: null for unmeshed');

// ── Blend shapes ──────────────────────────────────────────────────────────

assert(getBlendShapes(meshedPart) === meshedPart.blendShapes,
       'getBlendShapes: identity to part.blendShapes');
assert(Array.isArray(getBlendShapes(unmeshedPart)) && getBlendShapes(unmeshedPart).length === 0,
       'getBlendShapes: empty array for part with no shapes');
assert(getBlendShapes(boneNeck) === null, 'getBlendShapes: null for bone');

assert(getBlendShapeValues(meshedPart) === meshedPart.blendShapeValues,
       'getBlendShapeValues: identity to part.blendShapeValues');
assert(getBlendShapeValues(boneNeck) === null, 'getBlendShapeValues: null for bone');

// ── Bone accessors ────────────────────────────────────────────────────────

assert(getBoneRole(boneNeck) === 'neck',     'getBoneRole: returns role string');
assert(getBoneRole(plainGroup) === null,     'getBoneRole: null for plain group');
assert(getBoneRole(meshedPart) === null,     'getBoneRole: null for part');
assert(getBoneRole(warpDeformer) === null,   'getBoneRole: null for deformer');

const restPivot = getBoneRestPivot(boneNeck);
assert(restPivot && restPivot.x === 400 && restPivot.y === 300,
       'getBoneRestPivot: returns {x,y} matching transform.pivotX/Y');
assert(getBoneRestPivot(plainGroup) === null, 'getBoneRestPivot: null for plain group');
assert(getBoneRestPivot(meshedPart) === null, 'getBoneRestPivot: null for part');

const pose = getBonePose(boneNeck);
assert(pose && pose.rotation === 0.5 && pose.x === 12 && pose.y === -3
            && pose.scaleX === 1.05 && pose.scaleY === 1,
       'getBonePose: reflects the pose record');
const synthesizedPose = getBonePose(boneNoPose);
assert(synthesizedPose
       && synthesizedPose.rotation === 0
       && synthesizedPose.x === 0
       && synthesizedPose.y === 0
       && synthesizedPose.scaleX === 1
       && synthesizedPose.scaleY === 1,
       'getBonePose: synthesises identity for bone missing pose');
assert(getBonePose(plainGroup) === null, 'getBonePose: null for plain group');
assert(getBonePose(meshedPart) === null, 'getBonePose: null for part');

// ── Generic transform ────────────────────────────────────────────────────

assert(getTransform(meshedPart) === meshedPart.transform, 'getTransform: identity for part');
assert(getTransform(boneNeck) === boneNeck.transform,     'getTransform: identity for bone');
assert(getTransform(plainGroup) === plainGroup.transform, 'getTransform: identity for plain group');
assert(getTransform(warpDeformer) === undefined ? false : true,
       'getTransform: deformer transform passes through unchanged (whatever it has)');
assert(getTransform(null) === null, 'getTransform: null for null');

// ── Defensive shape: helpers tolerate missing fields ─────────────────────

const malformed = { id: 'x', type: 'part' /* no mesh, no transform */ };
assert(getMesh(malformed) === null,         'getMesh: null when mesh field absent');
assert(getMeshOpts(malformed) === null,     'getMeshOpts: null when meshOpts field absent');
assert(getBlendShapes(malformed) === null,  'getBlendShapes: null when blendShapes absent');
assert(getTransform(malformed) === null,    'getTransform: null when transform absent');

console.log(`objectDataAccess: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
