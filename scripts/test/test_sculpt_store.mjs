// Toolset Plan Phase 3 — Sculpt-mode store integration.
//
// Verifies the editorStore.sculpt slot defaults, the setSculpt
// deep-merge writer, the SCULPT_BRUSHES registry shape +
// getBrushById fallback, and that enterEditMode('sculpt') is
// whitelisted with toolMode → 'brush'.
//
// Run: node scripts/test/test_sculpt_store.mjs

import { useEditorStore } from '../../src/store/editorStore.js';
import { SCULPT_BRUSHES, getBrushById, brushFalloffWeights } from '../../src/lib/sculpt/index.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// ── 1: Default sculpt slot shape ─────────────────────────────────────
{
  const sc = useEditorStore.getState().sculpt;
  assert(sc != null, 'sculpt slot exists');
  assert(sc.activeBrush === 'grab', 'default activeBrush = grab');
  assert(typeof sc.size === 'number' && sc.size > 0, 'default size > 0');
  assert(typeof sc.strength === 'number' && sc.strength >= 0 && sc.strength <= 1,
    'default strength in [0, 1]');
  assert(typeof sc.falloff === 'string', 'default falloff is a string');
  assert(typeof sc.iterations === 'number' && sc.iterations >= 1,
    'default iterations >= 1');
  assert(sc.connectedOnly === false, 'default connectedOnly = false');
}

// ── 2: setSculpt is partial-merge ────────────────────────────────────
{
  const before = { ...useEditorStore.getState().sculpt };
  useEditorStore.getState().setSculpt({ size: 120 });
  const after = useEditorStore.getState().sculpt;
  assert(after.size === 120, 'setSculpt({size}) updates size');
  assert(after.activeBrush === before.activeBrush,
    'setSculpt does not clobber activeBrush');
  assert(after.strength === before.strength,
    'setSculpt does not clobber strength');
  assert(after.falloff === before.falloff,
    'setSculpt does not clobber falloff');
  // Restore
  useEditorStore.getState().setSculpt({ size: before.size });
}

// ── 3: SCULPT_BRUSHES registry has the 3 documented brushes ──────────
{
  const ids = SCULPT_BRUSHES.map((b) => b.id);
  assert(SCULPT_BRUSHES.length === 3, 'three sculpt brushes registered');
  assert(ids.includes('grab'), 'grab brush registered');
  assert(ids.includes('smooth'), 'smooth brush registered');
  assert(ids.includes('pinch'), 'pinch brush registered');
  for (const b of SCULPT_BRUSHES) {
    assert(typeof b.tick === 'function', `brush ${b.id} has tick fn`);
    assert(typeof b.label === 'string' && b.label.length > 0,
      `brush ${b.id} has label`);
  }
}

// ── 4: getBrushById returns the right brush ──────────────────────────
{
  const grab = getBrushById('grab');
  assert(grab.id === 'grab', 'getBrushById("grab") → grab');
  const smooth = getBrushById('smooth');
  assert(smooth.id === 'smooth', 'getBrushById("smooth") → smooth');
}

// ── 5: getBrushById falls back to grab on unknown id ─────────────────
{
  const unk = getBrushById('does-not-exist');
  assert(unk.id === 'grab', 'unknown brush id falls back to grab (Blender default-brush behaviour)');
}

// ── 6: enterEditMode('sculpt') is whitelisted, toolMode → 'brush' ────
{
  const ed = useEditorStore.getState();
  const prevMode = ed.editMode;
  const prevTool = ed.toolMode;
  ed.enterEditMode('sculpt');
  const next = useEditorStore.getState();
  assert(next.editMode === 'sculpt', 'editMode = sculpt after enterEditMode');
  assert(next.toolMode === 'brush', 'toolMode = brush in Sculpt Mode');
  ed.exitEditMode();
  const back = useEditorStore.getState();
  assert(back.editMode === null, 'exitEditMode clears editMode');
  // sculpt slot survives the mode round-trip
  assert(back.sculpt != null, 'sculpt slot persists across exit');
}

// ── 7: brushFalloffWeights — cursor-centered, falloff-curved ─────────
{
  const verts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
  const w = brushFalloffWeights({
    verts,
    cursor: { x: 0, y: 0 },
    size:   10,
    falloff: 'linear',
  });
  // d=0  → t=0   → w=1
  // d=5  → t=0.5 → w=0.5
  // d=10 → t=1   → w=0 (excluded by `d >= size`)
  assert(approx(w[0], 1, 1e-6), 'd=0 → weight 1 (linear)');
  assert(approx(w[1], 0.5, 1e-6), 'd=5/10 → weight 0.5 (linear)');
  assert(approx(w[2], 0, 1e-6), 'd=size → weight 0 (excluded)');
}

// ── 8: brushFalloffWeights — connectedOnly without adjacency = 0 ─────
{
  const verts = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  const w = brushFalloffWeights({
    verts,
    cursor: { x: 0, y: 0 },
    size:   10,
    falloff: 'constant',
    connectedOnly: true,
    adjacency: null,
    originIdx: 0,
  });
  assert(w[0] === 0 && w[1] === 0,
    'connectedOnly without adjacency → no verts weighted (safe default)');
}

// ── 9: brushFalloffWeights — connectedOnly restricts to BFS reachables ─
{
  const verts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
  // Disconnected: {0} alone, {1,2} pair
  const adjacency = [new Set(), new Set([2]), new Set([1])];
  const w = brushFalloffWeights({
    verts,
    cursor:        { x: 0, y: 0 },
    size:          50,
    falloff:       'constant',
    connectedOnly: true,
    adjacency,
    originIdx:     0,
  });
  assert(w[0] === 1, 'connectedOnly origin vert weighted');
  assert(w[1] === 0 && w[2] === 0,
    'connectedOnly: other component zeroed even though within radius');
}

// ── 10: brushFalloffWeights — size <= 0 → all zero ──────────────────
{
  const verts = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  const w = brushFalloffWeights({
    verts,
    cursor: { x: 0, y: 0 },
    size:   0,
    falloff: 'constant',
  });
  assert(w[0] === 0 && w[1] === 0, 'size=0 → no verts weighted');
}

console.log(`\nsculpt_store: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
