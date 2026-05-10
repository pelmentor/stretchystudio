// Toolset Plan Phase 2.C/F — selection-anchor target modes.
//
// Audit-revised post Phase 2 (D-3): `pickSelectionAnchor` now matches
// Blender's `SCE_SNAP_SOURCE_*` semantics — `closest` finds the
// selection vertex / bbox-corner GEOMETRICALLY NEAREST the snap
// target, not "the cursor IS the anchor". Legacy `computeSelectionAnchor`
// kept for one release; deprecated.
//
// Also covers `enumerateSelectionAnchorVerts` — Object Mode bbox/centroid
// per part, bone pivot per bone group, Edit Mode active-vert-first.
//
// Run: node scripts/test/test_snap_target_modes.mjs

import {
  pickSelectionAnchor,
  enumerateSelectionAnchorVerts,
  computeSelectionAnchor,
} from '../../src/lib/snap/snapMath.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// ─── pickSelectionAnchor (Blender-faithful) ──────────────────────────

const verts = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
  { x: 50, y: 100 },  // outlier — pulls bbox center but not the median
];

// 'closest': nearest selection vert to snap target
{
  // Target at (12, 12) — A[0]@(10,10) is nearest (~2.83 away).
  const r = pickSelectionAnchor(verts, 'closest', { snapTarget: { x: 12, y: 12 } });
  assert(r.x === 10 && r.y === 10, 'closest: target (12,12) → A[0]@(10,10)');
  // Target at (49, 99) — outlier (50,100) is nearest.
  const r2 = pickSelectionAnchor(verts, 'closest', { snapTarget: { x: 49, y: 99 } });
  assert(r2.x === 50 && r2.y === 100, 'closest: target (49,99) → outlier@(50,100)');
  // No snapTarget → first vert fallback.
  const r3 = pickSelectionAnchor(verts, 'closest', {});
  assert(r3.x === 10 && r3.y === 10, 'closest: no target → first vert');
}

// 'closest' with empty selection → cursor fallback
{
  const r = pickSelectionAnchor([], 'closest', { snapTarget: { x: 50, y: 50 }, cursor: { x: 0, y: 0 } });
  assert(r.x === 0 && r.y === 0, 'closest empty: anchor = cursor');
}

// 'center': AABB midpoint
{
  // bbox: x in [10,50], y in [10,100] → center (30, 55)
  const r = pickSelectionAnchor(verts, 'center', {});
  assert(close(r.x, 30), `center.x = 30, got ${r.x}`);
  assert(close(r.y, 55), `center.y = 55, got ${r.y}`);
}

// 'median': per-axis median (5 verts → index 2)
{
  // x sorted: [10, 10, 30, 30, 50] → median = 30
  // y sorted: [10, 10, 30, 30, 100] → median = 30
  const r = pickSelectionAnchor(verts, 'median', {});
  assert(close(r.x, 30), `median.x = 30, got ${r.x}`);
  assert(close(r.y, 30), `median.y = 30, got ${r.y}`);
}

// 'active': first entry of anchorVerts (caller's contract)
{
  const r = pickSelectionAnchor(verts, 'active', {});
  assert(r.x === 10 && r.y === 10, 'active: returns first vert');
}

// Empty fallback for non-closest modes too
{
  const r = pickSelectionAnchor([], 'center', { cursor: { x: 7, y: 8 } });
  assert(r.x === 7 && r.y === 8, 'center empty: anchor = cursor');
  const r2 = pickSelectionAnchor([], 'median', { cursor: { x: 7, y: 8 } });
  assert(r2.x === 7 && r2.y === 8, 'median empty: anchor = cursor');
  const r3 = pickSelectionAnchor([], 'active', { cursor: { x: 7, y: 8 } });
  assert(r3.x === 7 && r3.y === 8, 'active empty: anchor = cursor');
}

// NaN / null filtering
{
  const dirty = [
    { x: 10, y: 10 },
    { x: NaN, y: 10 },
    { x: 30, y: 30 },
    null,
    undefined,
  ];
  const r = pickSelectionAnchor(dirty, 'center', {});
  // bbox: x in [10,30], y in [10,30] → center (20, 20)
  assert(close(r.x, 20) && close(r.y, 20), 'NaN/null filtered out of bbox');
}

// Unknown target → first vert fallback
{
  const r = pickSelectionAnchor(verts, 'bogus', {});
  assert(r.x === 10 && r.y === 10, 'unknown target → first vert');
}

// ─── enumerateSelectionAnchorVerts ────────────────────────────────────

// Object Mode meshed part — emits centroid + 4 bbox corners (5 anchors)
{
  const project = {
    nodes: [
      { id: 'A', type: 'part', mesh: { vertices: [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 },
      ] } },
    ],
  };
  const sel = [{ id: 'A', type: 'part' }];
  const anchors = enumerateSelectionAnchorVerts(project, sel, { editMode: 'object' });
  assert(anchors.length === 5, `meshed part → 5 anchors (centroid + 4 corners), got ${anchors.length}`);
  // Centroid first (50, 25)
  assert(anchors[0].x === 50 && anchors[0].y === 25, 'first anchor = centroid');
  // Then 4 corners — bbox is (0,0)-(100,50)
  const cornerSet = anchors.slice(1).map((a) => `${a.x},${a.y}`).sort();
  assert(JSON.stringify(cornerSet) === JSON.stringify(['0,0', '0,50', '100,0', '100,50']),
    'corners are bbox 0,0 100,0 100,50 0,50');
}

// Object Mode bone group — emits pivot only
{
  const project = {
    nodes: [
      { id: 'B', type: 'group', boneRole: 'spine', transform: { pivotX: 250, pivotY: 380 } },
    ],
  };
  const anchors = enumerateSelectionAnchorVerts(project, [{ id: 'B', type: 'group' }], { editMode: 'object' });
  assert(anchors.length === 1, `bone → 1 anchor (pivot), got ${anchors.length}`);
  assert(anchors[0].x === 250 && anchors[0].y === 380, 'bone anchor = pivot');
}

// Object Mode unmeshed part with imageBounds — corners + centroid
{
  const project = {
    nodes: [
      { id: 'A', type: 'part', imageBounds: { left: 100, top: 200, width: 50, height: 30 } },
    ],
  };
  const anchors = enumerateSelectionAnchorVerts(project, [{ id: 'A', type: 'part' }], { editMode: 'object' });
  assert(anchors.length === 5, `imageBounds → 5 anchors, got ${anchors.length}`);
  // Centroid (125, 215)
  assert(anchors[0].x === 125 && anchors[0].y === 215, 'imageBounds centroid');
}

// Object Mode meshless + boundless — single transform.x/y point
{
  const project = {
    nodes: [
      { id: 'X', type: 'part', transform: { x: 7, y: 8 } },
    ],
  };
  const anchors = enumerateSelectionAnchorVerts(project, [{ id: 'X', type: 'part' }], { editMode: 'object' });
  assert(anchors.length === 1, 'no geometry → 1 anchor (transform.x/y)');
  assert(anchors[0].x === 7 && anchors[0].y === 8, 'transform.x/y anchor');
}

// Edit Mode — selected verts of active part, active first
{
  const project = {
    nodes: [
      { id: 'A', type: 'part', mesh: { vertices: [
        { x: 0, y: 0 },          // index 0
        { x: 100, y: 0 },        // index 1
        { x: 100, y: 100 },      // index 2 — active
        { x: 0, y: 100 },        // index 3
      ] } },
    ],
  };
  const editorState = {
    editMode: 'edit',
    activeVertex: { partId: 'A', vertIndex: 2 },
    selectedVertexIndices: new Map([['A', new Set([0, 2, 3])]]),
  };
  const anchors = enumerateSelectionAnchorVerts(project, [], editorState);
  // Active first; then sorted selection minus active.
  assert(anchors.length === 3, `Edit mode → 3 anchors, got ${anchors.length}`);
  assert(anchors[0].x === 100 && anchors[0].y === 100, 'active vert (idx 2) is first');
  const rest = anchors.slice(1).map((a) => `${a.x},${a.y}`).sort();
  assert(JSON.stringify(rest) === JSON.stringify(['0,0', '0,100']),
    'remaining selection in vert-index order');
}

// Edit Mode with no selection / empty active — fall through to Object-mode logic
{
  const project = {
    nodes: [{ id: 'A', type: 'part', mesh: { vertices: [{ x: 5, y: 5 }] } }],
  };
  const anchors = enumerateSelectionAnchorVerts(
    project, [{ id: 'A', type: 'part' }],
    { editMode: 'edit', activeVertex: null, selectedVertexIndices: new Map() },
  );
  // No edit-mode anchors → falls through to Object-mode bbox path.
  // Single-vert mesh: bbox is (5,5)-(5,5), 5 anchors all at (5,5).
  assert(anchors.length === 5, 'edit-mode empty selection falls through to Object Mode bbox path');
}

// Empty inputs degrade safely
{
  assert(enumerateSelectionAnchorVerts(null, []).length === 0, 'null project → empty');
  assert(enumerateSelectionAnchorVerts({ nodes: [] }, []).length === 0, 'no nodes → empty');
  assert(enumerateSelectionAnchorVerts({ nodes: [{ id: 'A', type: 'part' }] }, [{ id: 'B' }]).length === 0,
    'unknown selection ref → empty');
}

// ─── Legacy computeSelectionAnchor (deprecated, but still exported) ──

{
  // Legacy 'closest' returns cursor verbatim
  const r = computeSelectionAnchor(verts, 'closest', { cursor: { x: 5, y: 6 } });
  assert(r.x === 5 && r.y === 6, 'legacy: closest = cursor');
  // Legacy 'active' returns activeVert
  const r2 = computeSelectionAnchor(verts, 'active', { activeVert: { x: 99, y: 88 }, cursor: { x: 0, y: 0 } });
  assert(r2.x === 99 && r2.y === 88, 'legacy: active returns activeVert');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
