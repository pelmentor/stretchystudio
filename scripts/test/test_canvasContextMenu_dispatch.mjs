// Audit 4 #2 (2026-05-16) — CanvasContextMenu integrity.
//
// Verifies:
//   1. `pickItemSet(editMode, dataKind)` returns a non-empty item set
//      for every supported (editMode, dataKind) tuple.
//   2. Every operator id referenced in every item set resolves against
//      the live `v3/operators/registry.js` registry (catches typos +
//      operator removals).
//   3. The five branches (Object / Edit-mesh / Edit-armature / Pose /
//      Weight Paint) all dispatch distinct item sets.
//
// Run: node scripts/test/test_canvasContextMenu_dispatch.mjs

import { pickItemSet } from '../../src/v3/shell/canvasContextMenuItems.js';
import { getOperator } from '../../src/v3/operators/registry.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

const branches = [
  { name: 'Object',         args: [null,          null]        },
  { name: 'Edit-mesh',      args: ['edit',        'mesh']      },
  { name: 'Edit-armature',  args: ['edit',        'armature']  },
  { name: 'Pose',           args: ['pose',        null]        },
  { name: 'WeightPaint',    args: ['weightPaint', null]        },
];

// 1. Every branch returns a populated set.
for (const b of branches) {
  const { items, heading } = pickItemSet(...b.args);
  assert(Array.isArray(items) && items.length > 0, `${b.name}: non-empty items`);
  assert(typeof heading === 'string' && heading.length > 0, `${b.name}: has heading`);
}

// 2. Every operator id referenced resolves in the registry.
for (const b of branches) {
  const { items } = pickItemSet(...b.args);
  for (const it of items) {
    if (it.separator) continue;
    const op = getOperator(it.id);
    assert(!!op, `${b.name}: operator '${it.id}' is registered`);
  }
}

// 3. Branches produce distinct item-id signatures (no two branches
//    accidentally rendering the same list).
const sigs = new Map();
for (const b of branches) {
  const { items } = pickItemSet(...b.args);
  const sig = items.filter((it) => !it.separator).map((it) => it.id).join('|');
  sigs.set(b.name, sig);
}
// Object vs Edit-mesh must differ; Pose vs Object must differ; etc.
const sigArr = [...sigs.entries()];
for (let i = 0; i < sigArr.length; i++) {
  for (let j = i + 1; j < sigArr.length; j++) {
    const [aName, aSig] = sigArr[i];
    const [bName, bSig] = sigArr[j];
    assert(aSig !== bSig, `branch '${aName}' differs from '${bName}'`);
  }
}

// 4. Fallback path — unknown editMode lands in Object branch.
{
  const { heading } = pickItemSet('unknownMode', null);
  assert(heading === 'Object', `unknown editMode → Object fallback (got ${heading})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
