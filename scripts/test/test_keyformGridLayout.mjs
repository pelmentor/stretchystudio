// V4 Phase 3a — tests for src/v3/editors/properties/sections/keyformGridLayout.js
//
// Locks in the grid-layout algorithm (1D row, 2D matrix, ND flat-list,
// active-cell detection, missing keyform tolerance). Phase 3b will
// add drag-to-edit on top of this layout — the layout itself stays
// stable.
//
// Run: node scripts/test/test_keyformGridLayout.mjs

import {
  buildKeyformGridLayout,
  findKeyform,
  computeActiveKeyTuple,
} from '../../src/v3/editors/properties/sections/keyformGridLayout.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── empty bindings → kind:'empty' ──────────────────────────────────

{
  const layout = buildKeyformGridLayout([], [], {});
  assert(layout.kind === 'empty', 'no bindings: kind="empty"');
}

{
  const layout = buildKeyformGridLayout(null, null, null);
  assert(layout.kind === 'empty', 'null inputs: kind="empty"');
}

// ── 1D layout ───────────────────────────────────────────────────────

{
  const bindings = [{ parameterId: 'ParamHairFront', keys: [-1, 0, 1] }];
  const keyforms = [
    { keyTuple: [-1], positions: 'A' },
    { keyTuple: [0],  positions: 'B' },
    { keyTuple: [1],  positions: 'C' },
  ];
  const layout = buildKeyformGridLayout(bindings, keyforms, { ParamHairFront: 0 });
  assert(layout.kind === '1d', '1 binding: kind="1d"');
  assert(layout.cells.length === 3, '1d: one cell per key');
  assert(layout.cells[0].keyform?.positions === 'A', '1d[0]: matches keyform at -1');
  assert(layout.cells[1].keyform?.positions === 'B', '1d[1]: matches keyform at 0');
  assert(layout.cells[2].keyform?.positions === 'C', '1d[2]: matches keyform at 1');
  assert(layout.cells[1].active === true, '1d: active cell at current value');
  assert(layout.cells[0].active === false && layout.cells[2].active === false,
    '1d: only one active cell');
}

{
  // Missing keyforms tolerated (e.g. user added a key but Init Rig
  // hasn't regen'd yet).
  const bindings = [{ parameterId: 'P', keys: [-1, 0, 1] }];
  const keyforms = [
    { keyTuple: [-1] },
    { keyTuple: [1] },
  ];
  const layout = buildKeyformGridLayout(bindings, keyforms, {});
  assert(layout.cells.length === 3, '1d missing-keyform: still cells per key');
  assert(layout.cells[1].keyform === null,
    '1d missing-keyform: cell.keyform === null when no match');
}

{
  // Off-key paramValue: no active cell.
  const bindings = [{ parameterId: 'P', keys: [-1, 0, 1] }];
  const layout = buildKeyformGridLayout(bindings, [], { P: 0.42 });
  assert(layout.cells.every((c) => c.active === false),
    '1d off-key value: no active cell');
}

// ── 2D layout (FaceParallax-style cartesian product) ───────────────

{
  const bindings = [
    { parameterId: 'ParamAngleX', keys: [-30, 0, 30] },
    { parameterId: 'ParamAngleY', keys: [-30, 0, 30] },
  ];
  const keyforms = [
    { keyTuple: [-30, -30] }, { keyTuple: [0, -30] }, { keyTuple: [30, -30] },
    { keyTuple: [-30, 0] },   { keyTuple: [0, 0]   }, { keyTuple: [30, 0]   },
    { keyTuple: [-30, 30] },  { keyTuple: [0, 30]  }, { keyTuple: [30, 30]  },
  ];
  const layout = buildKeyformGridLayout(bindings, keyforms,
    { ParamAngleX: 0, ParamAngleY: 0 });
  assert(layout.kind === '2d', '2 bindings: kind="2d"');
  assert(layout.rows.length === 3, '2d: 3 rows for 3 keysY');
  assert(layout.rows[0].length === 3, '2d: 3 cols for 3 keysX');
  // Active cell at (1,1) — center.
  assert(layout.rows[1][1].active === true, '2d: active cell at center');
  assert(layout.rows[0][0].active === false, '2d: corner not active');
  // Cell (0,0) = (kx=-30, ky=-30).
  assert(JSON.stringify(layout.rows[0][0].keyTuple) === '[-30,-30]',
    '2d: row 0 col 0 = (-30, -30)');
  assert(JSON.stringify(layout.rows[2][2].keyTuple) === '[30,30]',
    '2d: row 2 col 2 = (30, 30)');
  // Every cell finds its matching keyform.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert(layout.rows[r][c].keyform !== null,
        `2d: cell (${r},${c}) has matching keyform`);
    }
  }
}

{
  // Off-key in either axis → no active cell.
  const bindings = [
    { parameterId: 'X', keys: [-30, 0, 30] },
    { parameterId: 'Y', keys: [-30, 0, 30] },
  ];
  const layout = buildKeyformGridLayout(bindings, [],
    { X: 0, Y: 12 });  // Y off-key
  const anyActive = layout.rows.some((row) => row.some((c) => c.active));
  assert(!anyActive, '2d: off-key in one axis → no active cell');
}

// ── ND >= 3 falls back to flat-list ─────────────────────────────────

{
  const bindings = [
    { parameterId: 'A', keys: [-1, 0, 1] },
    { parameterId: 'B', keys: [-1, 0, 1] },
    { parameterId: 'C', keys: [-1, 0, 1] },
  ];
  const keyforms = [
    { keyTuple: [-1, -1, -1] },
    { keyTuple: [0, 0, 0] },
    { keyTuple: [1, 1, 1] },
  ];
  const layout = buildKeyformGridLayout(bindings, keyforms,
    { A: 0, B: 0, C: 0 });
  assert(layout.kind === 'flat', '3 bindings: falls back to flat-list');
  assert(layout.cells.length === 3, 'flat: one cell per keyform');
  assert(layout.cells[1].active === true,
    'flat: active cell at matching keyTuple');
}

// ── findKeyform helper ──────────────────────────────────────────────

{
  const kfs = [
    { keyTuple: [-30, -30] },
    { keyTuple: [0, 0] },
    { keyTuple: [30, 30] },
  ];
  assert(findKeyform(kfs, [0, 0])?.keyTuple[0] === 0,
    'findKeyform: exact match');
  assert(findKeyform(kfs, [0, 12]) === null,
    'findKeyform: no match returns null');
  assert(findKeyform(kfs, [0]) === null,
    'findKeyform: arity mismatch returns null');
  assert(findKeyform(kfs, [1e-9, 1e-9])?.keyTuple[0] === 0,
    'findKeyform: epsilon-equal matches');
}

// ── computeActiveKeyTuple ───────────────────────────────────────────

{
  const bindings = [{ parameterId: 'A', keys: [-1, 0, 1] }];
  assert(JSON.stringify(computeActiveKeyTuple(bindings, { A: 0 })) === '[0]',
    'computeActiveKeyTuple: on-key returns tuple');
  assert(computeActiveKeyTuple(bindings, { A: 0.5 }) === null,
    'computeActiveKeyTuple: off-key returns null');
  assert(computeActiveKeyTuple(bindings, {}) === null,
    'computeActiveKeyTuple: missing value returns null');
}

{
  // Multi-binding: ALL must be on-key for the tuple to count.
  const bindings = [
    { parameterId: 'X', keys: [-1, 0, 1] },
    { parameterId: 'Y', keys: [-1, 0, 1] },
  ];
  assert(JSON.stringify(computeActiveKeyTuple(bindings, { X: 0, Y: 1 })) === '[0,1]',
    'computeActiveKeyTuple: both on-key');
  assert(computeActiveKeyTuple(bindings, { X: 0, Y: 0.5 }) === null,
    'computeActiveKeyTuple: one off-key drops the tuple');
}

console.log(`keyformGridLayout: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
