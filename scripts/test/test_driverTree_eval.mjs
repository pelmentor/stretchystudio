// Phase N-2 — DriverTree eval byte-equivalence vs evaluateDriver.
//
// Compiles a driver expression into a graph, evaluates the graph,
// and compares the result to `evaluateDriver` running the same
// expression directly. Both pipelines must agree to within float
// epsilon for every supported expression form.
//
// Run: node scripts/test/test_driverTree_eval.mjs

import { compileDriverTree } from '../../src/anim/nodetree/driverCompile.js';
import { evalNodeTree } from '../../src/anim/nodetree/eval.js';
import { evaluateDriver } from '../../src/anim/driver.js';
import '../../src/anim/nodetree/nodes/drivers.js';

let passed = 0;
let failed = 0;

function assertNear(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} (|${a} - ${b}| > ${eps})`);
}

function rnaPathFor(id) {
  return `objects['__params__'].values['${id}']`;
}

/**
 * Run BOTH pipelines on the same expression + project state.
 * Compare outputs.
 */
function runBoth(expression, variables, project, eps = 1e-9, label = '') {
  const driver = { type: 'scripted', expression, variables };
  const reference = evaluateDriver(driver, { project });
  const tree = compileDriverTree('Y', driver);
  const overrides = new Map();
  evalNodeTree(tree, { project, paramOverrides: overrides });
  const candidate = overrides.get('Y');
  assertNear(candidate, reference, eps,
    `${label} (graph=${candidate}, ref=${reference})`);
}

// ---- Identity ----

runBoth(
  'a',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: 7 }] },
  1e-9, 'identity: a',
);

// ---- Arithmetic ----

runBoth(
  'a + b',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 3 }, { id: 'B', default: 4 }] },
  1e-9, 'a + b',
);

runBoth(
  'a - b',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 10 }, { id: 'B', default: 3 }] },
  1e-9, 'a - b',
);

runBoth(
  'a * b',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 6 }, { id: 'B', default: 7 }] },
  1e-9, 'a * b',
);

runBoth(
  'a / b',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 10 }, { id: 'B', default: 4 }] },
  1e-9, 'a / b',
);

// ---- Math built-ins ----

runBoth(
  'sin(a)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: 0.5 }] },
  1e-9, 'sin(a)',
);

runBoth(
  'cos(a)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: 0.5 }] },
  1e-9, 'cos(a)',
);

runBoth(
  'abs(a)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: -3 }] },
  1e-9, 'abs(a)',
);

runBoth(
  'sqrt(a)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: 16 }] },
  1e-9, 'sqrt(a)',
);

runBoth(
  'min(a, b)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 7 }, { id: 'B', default: 3 }] },
  1e-9, 'min(a, b)',
);

runBoth(
  'max(a, b)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 7 }, { id: 'B', default: 3 }] },
  1e-9, 'max(a, b)',
);

runBoth(
  'clamp(a, 0, 10)',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } }],
  { parameters: [{ id: 'A', default: 25 }] },
  1e-9, 'clamp(a, 0, 10)',
);

// ---- Compound expressions ----

runBoth(
  '(a + b) / 2',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 6 }, { id: 'B', default: 4 }] },
  1e-9, 'mean (a+b)/2',
);

runBoth(
  'sin(a) * cos(b) + 0.5',
  [{ name: 'a', target: { rnaPath: rnaPathFor('A') } },
   { name: 'b', target: { rnaPath: rnaPathFor('B') } }],
  { parameters: [{ id: 'A', default: 0.3 }, { id: 'B', default: 0.7 }] },
  1e-9, 'sin·cos + 0.5',
);

runBoth(
  'PI * 2',
  [],
  { parameters: [] },
  1e-9, 'PI literal',
);

// ---- Result ----

console.log(`driverTree_eval: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
