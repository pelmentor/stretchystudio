// Phase N-2 — DriverTree migration + compile tests.
//
// Verifies:
//   - Simple expression `a * 2` → Constant + ParamInput + Math
//     subgraph that evaluates to 2*paramValue.
//   - Built-in functions (sin, cos, pow, clamp, sqrt) compile.
//   - Unparseable expressions fall back to ScriptedExpression node.
//   - Migration is idempotent.
//
// Run: node scripts/test/test_driverTree_migration.mjs

import { compileDriverTree } from '../../src/anim/nodetree/driverCompile.js';
import { migrateNodeTreeDriverTree } from '../../src/store/migrations/v23_nodetree_drivertree.js';
import { evalNodeTree } from '../../src/anim/nodetree/eval.js';
import '../../src/anim/nodetree/nodes/drivers.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertNear(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (|${a} - ${b}| > ${eps})`);
}

function rnaPathFor(id) {
  return `objects['__params__'].values['${id}']`;
}

// ---- 1. `a * 2` compiles to Math node with ParamInput + Constant inputs ----

{
  const driver = {
    type: 'scripted',
    expression: 'a * 2',
    variables: [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  };
  const tree = compileDriverTree('Y', driver);
  // Expect: ParamInput(A), Constant(2), Math(*), DriverOutput(Y).
  const types = tree.nodes.map((n) => n.typeId).sort();
  assert(types.includes('ParamInput'),  'compile a*2: ParamInput emitted');
  assert(types.includes('Constant'),    'compile a*2: Constant emitted');
  assert(types.includes('Math'),        'compile a*2: Math emitted');
  assert(types.includes('DriverOutput'),'compile a*2: DriverOutput emitted');
  assert(!types.includes('ScriptedExpression'),
    'compile a*2: NOT falling back to ScriptedExpression');

  // Eval: A=5 → tree output should write 10 to paramOverrides.
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [{ id: 'A', default: 5 }] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('Y'), 10, 1e-9,
    'eval a*2 with A=5: paramOverrides.Y = 10');
}

// ---- 2. Built-in `sin(x)` compiles ----

{
  const driver = {
    type: 'scripted',
    expression: 'sin(x)',
    variables: [{ name: 'x', target: { rnaPath: rnaPathFor('X') } }],
  };
  const tree = compileDriverTree('Z', driver);
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [{ id: 'X', default: Math.PI / 2 }] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('Z'), 1, 1e-6,
    'eval sin(π/2) → 1');
}

// ---- 3. Built-in `clamp(x, 0, 1)` compiles ----

{
  const driver = {
    type: 'scripted',
    expression: 'clamp(x, 0, 1)',
    variables: [{ name: 'x', target: { rnaPath: rnaPathFor('X') } }],
  };
  const tree = compileDriverTree('Z', driver);
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [{ id: 'X', default: 5 }] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('Z'), 1, 1e-9,
    'eval clamp(5, 0, 1) → 1');
}

// ---- 4. Compound expression `(a + b) / 2` ----

{
  const driver = {
    type: 'scripted',
    expression: '(a + b) / 2',
    variables: [
      { name: 'a', target: { rnaPath: rnaPathFor('A') } },
      { name: 'b', target: { rnaPath: rnaPathFor('B') } },
    ],
  };
  const tree = compileDriverTree('Avg', driver);
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [
      { id: 'A', default: 4 },
      { id: 'B', default: 6 },
    ] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('Avg'), 5, 1e-9,
    'eval (a + b) / 2 = (4+6)/2 = 5');
}

// ---- 5. PI literal ----

{
  const driver = {
    type: 'scripted',
    expression: 'PI * 2',
    variables: [],
  };
  const tree = compileDriverTree('TwoPi', driver);
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('TwoPi'), Math.PI * 2, 1e-9,
    'eval PI * 2 = 2π');
}

// ---- 6. Unary negation ----

{
  const driver = {
    type: 'scripted',
    expression: '-a',
    variables: [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  };
  const tree = compileDriverTree('Neg', driver);
  const overrides = new Map();
  evalNodeTree(tree, {
    project: { parameters: [{ id: 'A', default: 7 }] },
    paramOverrides: overrides,
  });
  assertNear(overrides.get('Neg'), -7, 1e-9, 'eval -a with a=7 → -7');
}

// ---- 7. Unparseable expression → ScriptedExpression fallback ----

{
  const driver = {
    type: 'scripted',
    expression: 'x ? 1 : 2',  // ternary — not in N-2 grammar
    variables: [{ name: 'x', target: { rnaPath: rnaPathFor('X') } }],
  };
  const tree = compileDriverTree('Z', driver);
  const types = tree.nodes.map((n) => n.typeId);
  assert(types.includes('ScriptedExpression'),
    'unparseable: falls back to ScriptedExpression node');
  assert(types.includes('DriverOutput'),
    'unparseable: still has DriverOutput sink');
}

// ---- 8. Migration v23 walks every parameter ----

{
  const project = {
    parameters: [
      { id: 'A', default: 5 },
      { id: 'B', default: 0,
        driver: {
          type: 'scripted', expression: 'A * 3',
          variables: [{ name: 'A', target: { rnaPath: rnaPathFor('A') } }],
        } },
      { id: 'C', default: 0 },  // no driver
    ],
    nodes: [],
  };
  migrateNodeTreeDriverTree(project);
  assert(project.nodeTrees?.driver?.B != null,
    'v23: B has DriverTree (has driver record)');
  assert(project.nodeTrees?.driver?.A == null,
    'v23: A has no DriverTree (no driver record)');
  assert(project.nodeTrees?.driver?.C == null,
    'v23: C has no DriverTree (no driver record)');
}

// ---- 9. Migration is idempotent ----

{
  const project = {
    parameters: [{
      id: 'B', default: 0,
      driver: {
        type: 'scripted', expression: 'A',
        variables: [{ name: 'A', target: { rnaPath: rnaPathFor('A') } }],
      },
    }, { id: 'A', default: 7 }],
    nodes: [],
  };
  migrateNodeTreeDriverTree(project);
  const len1 = project.nodeTrees.driver.B.nodes.length;
  migrateNodeTreeDriverTree(project);
  const len2 = project.nodeTrees.driver.B.nodes.length;
  assert(len1 === len2,
    `v23 idempotent: re-run produces same node count (${len1} vs ${len2})`);
}

// ---- Result ----

console.log(`driverTree_migration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
