// v28 migration — fold deformer-node state into Object.modifiers[i].data.
//
// BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.A. Tests:
//   1. Each modifier entry referencing a deformer node gets a `data` sub-object
//      with the node's state (warp + rotation, full field list).
//   2. Idempotent.
//   3. Phase 3.C state (deformer node already deleted): existing
//      `modifier.data` is preserved; missing data stays missing.
//   4. Defensive — empty / null inputs survive.
//
// Run: node scripts/test/test_migration_v28.mjs

import { migrateModifierDataFold } from '../../src/store/migrations/v28_modifier_data_fold.js';
import { getModifierData } from '../../src/store/objectDataAccess.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}

// ---- 1. Warp deformer fold ----
{
  const project = {
    nodes: [
      {
        id: 'p1', type: 'part', name: 'face',
        modifiers: [{ type: 'warp', deformerId: 'w1', enabled: true }],
      },
      {
        id: 'w1', type: 'deformer', deformerKind: 'warp',
        name: 'FaceParallaxWarp',
        gridSize: { rows: 5, cols: 5 },
        baseGrid: [0, 0,  1, 0,  0, 1,  1, 1],
        bindings: [{ parameterId: 'ParamAngleX', keys: [-30, 0, 30] }],
        keyforms: [{ keyTuple: [0], positions: [0, 0,  1, 0], opacity: 1 }],
        isLocked: false,
        isQuadTransform: false,
        localFrame: 'normalised-0to1',
        visible: true,
      },
    ],
  };
  migrateModifierDataFold(project);
  const mod = project.nodes[0].modifiers[0];
  assert(mod.data, 'warp: modifier.data populated');
  assert(mod.data.name === 'FaceParallaxWarp', 'warp: name copied');
  assertEq(mod.data.gridSize, { rows: 5, cols: 5 }, 'warp: gridSize copied');
  assertEq(mod.data.baseGrid, [0, 0, 1, 0, 0, 1, 1, 1], 'warp: baseGrid copied');
  assert(Array.isArray(mod.data.bindings) && mod.data.bindings.length === 1,
    'warp: bindings copied');
  assert(Array.isArray(mod.data.keyforms) && mod.data.keyforms.length === 1,
    'warp: keyforms copied');
  assert(mod.data.localFrame === 'normalised-0to1', 'warp: localFrame copied');
}

// ---- 2. Rotation deformer fold ----
{
  const project = {
    nodes: [
      {
        id: 'p1', type: 'part', name: 'arm',
        modifiers: [{ type: 'rotation', deformerId: 'r1', enabled: true }],
      },
      {
        id: 'r1', type: 'deformer', deformerKind: 'rotation',
        name: 'Rotation_leftElbow',
        baseAngle: 0,
        handleLengthOnCanvas: 200,
        circleRadiusOnCanvas: 100,
        bindings: [{ parameterId: 'ParamRotation_leftElbow', keys: [-90, 0, 90] }],
        keyforms: [{ keyTuple: [0], angle: 0, originX: 100, originY: 200, opacity: 1 }],
        isLocked: false,
        useBoneUiTestImpl: true,
      },
    ],
  };
  migrateModifierDataFold(project);
  const mod = project.nodes[0].modifiers[0];
  assert(mod.data, 'rotation: modifier.data populated');
  assert(mod.data.name === 'Rotation_leftElbow', 'rotation: name copied');
  assert(mod.data.baseAngle === 0, 'rotation: baseAngle copied');
  assert(mod.data.handleLengthOnCanvas === 200, 'rotation: handleLengthOnCanvas copied');
  assert(mod.data.circleRadiusOnCanvas === 100, 'rotation: circleRadiusOnCanvas copied');
  assert(Array.isArray(mod.data.bindings) && mod.data.bindings.length === 1,
    'rotation: bindings copied');
  assert(Array.isArray(mod.data.keyforms) && mod.data.keyforms.length === 1,
    'rotation: keyforms copied');
  // Warp-only fields must NOT appear on rotation modifier.data.
  assert(mod.data.gridSize === undefined, 'rotation: gridSize NOT copied');
  assert(mod.data.baseGrid === undefined, 'rotation: baseGrid NOT copied');
}

// ---- 3. Idempotent ----
{
  const project = {
    nodes: [
      { id: 'p1', type: 'part', modifiers: [{ type: 'warp', deformerId: 'w1' }] },
      {
        id: 'w1', type: 'deformer', deformerKind: 'warp',
        gridSize: { rows: 5, cols: 5 }, baseGrid: [0],
        keyforms: [], bindings: [],
      },
    ],
  };
  migrateModifierDataFold(project);
  const dataAfterFirst = JSON.stringify(project.nodes[0].modifiers[0].data);
  migrateModifierDataFold(project);
  const dataAfterSecond = JSON.stringify(project.nodes[0].modifiers[0].data);
  assert(dataAfterFirst === dataAfterSecond, 'idempotent: 2nd run produces identical data');
}

// ---- 4. Phase 3.C state — deformer node deleted, mod.data preserved ----
{
  const project = {
    nodes: [
      {
        id: 'p1', type: 'part',
        modifiers: [{
          type: 'warp', deformerId: 'w1',
          data: { name: 'pre-existing', gridSize: { rows: 5, cols: 5 } },
        }],
      },
      // No 'w1' deformer node — Phase 3.C state.
    ],
  };
  migrateModifierDataFold(project);
  assert(project.nodes[0].modifiers[0].data?.name === 'pre-existing',
    'phase 3.C: existing modifier.data preserved when deformer node missing');
}

// ---- 5. Multiple modifiers in one stack ----
{
  const project = {
    nodes: [
      {
        id: 'p1', type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'w1' },
          { type: 'warp', deformerId: 'w2' },
          { type: 'rotation', deformerId: 'r1' },
        ],
      },
      { id: 'w1', type: 'deformer', deformerKind: 'warp', name: 'innermost', gridSize: { rows: 5, cols: 5 } },
      { id: 'w2', type: 'deformer', deformerKind: 'warp', name: 'middle', gridSize: { rows: 5, cols: 5 } },
      { id: 'r1', type: 'deformer', deformerKind: 'rotation', name: 'outermost', baseAngle: 0 },
    ],
  };
  migrateModifierDataFold(project);
  assert(project.nodes[0].modifiers[0].data?.name === 'innermost', 'stack[0] data');
  assert(project.nodes[0].modifiers[1].data?.name === 'middle', 'stack[1] data');
  assert(project.nodes[0].modifiers[2].data?.name === 'outermost', 'stack[2] data');
}

// ---- 6. Defensive ----
{
  migrateModifierDataFold(null);
  passed++;
  migrateModifierDataFold({});
  passed++;
  migrateModifierDataFold({ nodes: [] });
  passed++;
}

// ---- 7. getModifierData helper — modifier.data path ----
{
  const project = { nodes: [] };
  const mod = {
    type: 'warp', deformerId: 'w1',
    data: { name: 'lit', gridSize: { rows: 5, cols: 5 } },
  };
  const data = getModifierData(mod, project);
  assert(data?.name === 'lit',
    'getModifierData: modifier.data path returns the embedded data');
}

// ---- 8. getModifierData helper — fallback path (pre-v28) ----
{
  const project = {
    nodes: [
      { id: 'w1', type: 'deformer', deformerKind: 'warp', name: 'legacy' },
    ],
  };
  const mod = { type: 'warp', deformerId: 'w1' /* no data */ };
  const data = getModifierData(mod, project);
  assert(data?.name === 'legacy',
    'getModifierData: pre-v28 fallback finds the deformer node');
}

// ---- 9. getModifierData helper — defensive misses ----
{
  assert(getModifierData(null, {}) === null, 'getModifierData(null) === null');
  assert(getModifierData({}, {}) === null, 'getModifierData({}) === null (no deformerId)');
  assert(getModifierData({ deformerId: 'missing' }, { nodes: [] }) === null,
    'getModifierData: deformerId not in project → null');
}

console.log(`migration_v28: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
