// Toolset Phase 1.A — Edit-Mode box select (verts inside the rect for
// the active part).
//
// Run: node scripts/test/test_boxSelect_editMode.mjs

import { verticesInRect } from '../../src/io/hitTest.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function arrEq(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

// ── Test 1: object-shape verts, simple rect picks 2 of 4 ──
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  // Rect (50, -50)-(150, 50) — picks v1 (100,0). v0 outside (-50<0,
  // but x=0 inside? actually 0 < 50 → outside). v1 (100, 0) → inside.
  // v2 (100,100) → outside (y=100 > 50). v3 (0, 100) → outside.
  const idx = verticesInRect(verts, 50, -50, 150, 50);
  assert(arrEq(idx, [1]), 'Test 1: 1 vert inside');
}

// ── Test 2: rect covers all → all indices ──
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const idx = verticesInRect(verts, -10, -10, 110, 110);
  assert(arrEq(idx, [0, 1, 2, 3]), 'Test 2: all verts inside');
}

// ── Test 3: rect covers none → empty ──
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const idx = verticesInRect(verts, 200, 200, 300, 300);
  assert(arrEq(idx, []), 'Test 3: no verts inside');
}

// ── Test 4: flat-array verts (same shape as chainEval output) ──
{
  const verts = [0, 0, 100, 0, 100, 100, 0, 100];
  // Rect (50, -50)-(150, 150) — picks v1 (100, 0) and v2 (100, 100).
  const idx = verticesInRect(verts, 50, -50, 150, 150);
  assert(arrEq(idx, [1, 2]), 'Test 4: flat-array picks v1+v2');
}

// ── Test 5: rect normalized when min > max ──
{
  const verts = [{ x: 50, y: 50 }];
  const idx = verticesInRect(verts, 100, 100, 0, 0);
  assert(arrEq(idx, [0]), 'Test 5: rect normalized');
}

// ── Test 6: edge-inclusive (vert on rect boundary counts) ──
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  // Rect (0, 0)-(100, 0) — v0 and v1 both on boundary.
  const idx = verticesInRect(verts, 0, 0, 100, 0);
  assert(arrEq(idx, [0, 1]), 'Test 6: edge-inclusive');
}

// ── Test 7: indices returned in ascending order ──
{
  const verts = [
    { x: 100, y: 100 },
    { x: 0,   y: 0   },
    { x: 50,  y: 50  },
    { x: 200, y: 200 },
  ];
  // Rect (-10, -10)-(150, 150) — picks v0, v1, v2.
  const idx = verticesInRect(verts, -10, -10, 150, 150);
  assert(arrEq(idx, [0, 1, 2]), 'Test 7: ascending indices');
}

// ── Test 8: empty input → empty ──
{
  const idx = verticesInRect([], 0, 0, 100, 100);
  assert(arrEq(idx, []), 'Test 8: empty verts → empty');
}

// ── Test 9: replace modifier (set new vertex selection) ──
{
  // The store's `setVertexSelectionForPart` with the rect result IS the
  // replace operation; we just confirm the indices are correct here.
  const verts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }];
  const inside = verticesInRect(verts, 25, 25, 75, 75);
  assert(arrEq(inside, [1]), 'Test 9: replace candidate');
}

// ── Test 10: add modifier (union with existing) ──
{
  // Caller composes: existing ∪ inside.
  const existing = new Set([0, 2]);
  const verts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }];
  const inside = verticesInRect(verts, 25, 25, 75, 75);
  const merged = new Set([...existing, ...inside]);
  assert(merged.size === 3 && merged.has(0) && merged.has(1) && merged.has(2),
    'Test 10: add merged');
}

// ── Test 11: subtract modifier (existing minus inside) ──
{
  // Caller composes: existing − inside.
  const existing = new Set([0, 1, 2]);
  const verts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }];
  const inside = verticesInRect(verts, 25, 25, 75, 75);
  const after = new Set([...existing].filter((i) => !inside.includes(i)));
  assert(after.size === 2 && after.has(0) && after.has(2) && !after.has(1),
    'Test 11: subtract removes only matched');
}

// ── Test 12: nullish/undefined inputs are defensive no-ops ──
{
  assert(arrEq(verticesInRect(null, 0, 0, 100, 100), []), 'Test 12: null verts');
  assert(arrEq(verticesInRect(undefined, 0, 0, 100, 100), []), 'Test 12: undef verts');
}

console.log(`boxSelect_editMode: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
