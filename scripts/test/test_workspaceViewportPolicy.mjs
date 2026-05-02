// Workspace viewport policy unit tests (BUG-012).
//
// Verifies that the per-workspace gate behaves as documented:
//   - Layout / Animation / Pose force wireframe + vertices off and
//     meshEditMode off, regardless of user toggles
//   - Modeling / Rigging honour user toggles
//   - Edge outline + image visibility + iris clipping pass through
//     untouched in every workspace (selection feedback / non-mesh-edit
//     concerns)
//
// Run: node scripts/test/test_workspaceViewportPolicy.mjs

import {
  WORKSPACE_POLICY,
  applyWorkspacePolicy,
  isMeshEditAllowed,
} from '../../src/v3/shell/workspaceViewportPolicy.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── Policy table: every workspace defined ────────────────────────────
{
  for (const ws of ['layout', 'modeling', 'rigging', 'animation', 'pose']) {
    assert(WORKSPACE_POLICY[ws] !== undefined, `policy table covers ${ws}`);
    assert(typeof WORKSPACE_POLICY[ws].allowMeshEdit === 'boolean',
      `policy ${ws}: allowMeshEdit is bool`);
    assert(typeof WORKSPACE_POLICY[ws].allowWireframeViz === 'boolean',
      `policy ${ws}: allowWireframeViz is bool`);
  }
}

// ── Layout: object-level workspace, no mesh viz / mesh edit ─────────
{
  const userOverlays = {
    showImage: true,
    showWireframe: true,    // user toggled on
    showVertices: true,     // user toggled on
    showEdgeOutline: true,
    irisClipping: true,
  };
  const eff = applyWorkspacePolicy(userOverlays, true, 'layout');
  assert(eff.overlays.showImage === true,         'layout: showImage passthrough');
  assert(eff.overlays.showWireframe === false,    'layout: showWireframe forced off');
  assert(eff.overlays.showVertices === false,     'layout: showVertices forced off');
  assert(eff.overlays.showEdgeOutline === true,   'layout: showEdgeOutline passthrough (selection feedback)');
  assert(eff.overlays.irisClipping === true,      'layout: irisClipping passthrough');
  assert(eff.meshEditMode === false,              'layout: meshEditMode forced off even when set');
  // User's stored values are NOT mutated.
  assert(userOverlays.showWireframe === true,
    'layout: input overlays unchanged (user prefs preserved)');
}

// ── Modeling: full mesh-edit toolkit ─────────────────────────────────
{
  const userOverlays = {
    showWireframe: true,
    showVertices: true,
    showEdgeOutline: false,
    irisClipping: true,
    showImage: true,
  };
  const eff = applyWorkspacePolicy(userOverlays, true, 'modeling');
  assert(eff.overlays.showWireframe === true,    'modeling: showWireframe honoured');
  assert(eff.overlays.showVertices === true,     'modeling: showVertices honoured');
  assert(eff.meshEditMode === true,              'modeling: meshEditMode honoured');
}

// ── Modeling: user toggles off, policy doesn't force on ──────────────
{
  const userOverlays = {
    showWireframe: false,
    showVertices: false,
    showEdgeOutline: false,
    irisClipping: true,
    showImage: true,
  };
  const eff = applyWorkspacePolicy(userOverlays, false, 'modeling');
  assert(eff.overlays.showWireframe === false, 'modeling: respects user-off wireframe');
  assert(eff.overlays.showVertices === false,  'modeling: respects user-off vertices');
  assert(eff.meshEditMode === false,           'modeling: respects user-off meshEditMode');
}

// ── Rigging: same permissive behaviour as Modeling ───────────────────
{
  const eff = applyWorkspacePolicy(
    { showWireframe: true, showVertices: true },
    true,
    'rigging',
  );
  assert(eff.overlays.showWireframe === true, 'rigging: showWireframe honoured');
  assert(eff.overlays.showVertices === true,  'rigging: showVertices honoured');
  assert(eff.meshEditMode === true,           'rigging: meshEditMode honoured');
}

// ── Animation: object-level (like Layout) ────────────────────────────
{
  const eff = applyWorkspacePolicy(
    { showWireframe: true, showVertices: true, showEdgeOutline: true },
    true,
    'animation',
  );
  assert(eff.overlays.showWireframe === false,  'animation: showWireframe forced off');
  assert(eff.overlays.showVertices === false,   'animation: showVertices forced off');
  assert(eff.overlays.showEdgeOutline === true, 'animation: showEdgeOutline passthrough');
  assert(eff.meshEditMode === false,            'animation: meshEditMode forced off');
}

// ── Pose: object-level (like Layout) ─────────────────────────────────
{
  const eff = applyWorkspacePolicy(
    { showWireframe: true, showVertices: true },
    true,
    'pose',
  );
  assert(eff.overlays.showWireframe === false, 'pose: showWireframe forced off');
  assert(eff.overlays.showVertices === false,  'pose: showVertices forced off');
  assert(eff.meshEditMode === false,           'pose: meshEditMode forced off');
}

// ── Unknown workspace → permissive fallback (modeling) ───────────────
{
  const eff = applyWorkspacePolicy(
    { showWireframe: true, showVertices: true },
    true,
    'definitely_not_a_workspace',
  );
  assert(eff.overlays.showWireframe === true, 'unknown ws: permissive fallback (wireframe honoured)');
  assert(eff.meshEditMode === true,           'unknown ws: permissive fallback (meshEditMode honoured)');
}

// ── Empty / null overlays ────────────────────────────────────────────
{
  const eff = applyWorkspacePolicy(undefined, false, 'layout');
  assert(typeof eff.overlays === 'object', 'undefined overlays: returns object');
  assert(eff.overlays.showWireframe === false, 'undefined overlays: forced off in layout');
  assert(eff.meshEditMode === false, 'undefined overlays: meshEditMode false');
}
{
  const eff = applyWorkspacePolicy({}, true, 'modeling');
  assert(eff.meshEditMode === true, 'empty overlays + modeling: meshEditMode honoured');
}

// ── isMeshEditAllowed convenience matches the policy table ──────────
{
  // Layout — mesh edit blocked
  assert(isMeshEditAllowed(true, 'layout') === false,
    'isMeshEditAllowed: layout false');
  // Modeling — mesh edit allowed when flag set
  assert(isMeshEditAllowed(true, 'modeling') === true,
    'isMeshEditAllowed: modeling true');
  // Modeling — but stays false when flag itself is off
  assert(isMeshEditAllowed(false, 'modeling') === false,
    'isMeshEditAllowed: modeling false when flag off');
  // Rigging — mesh edit allowed
  assert(isMeshEditAllowed(true, 'rigging') === true,
    'isMeshEditAllowed: rigging true');
  // Animation / Pose — mesh edit blocked
  assert(isMeshEditAllowed(true, 'animation') === false,
    'isMeshEditAllowed: animation false');
  assert(isMeshEditAllowed(true, 'pose') === false,
    'isMeshEditAllowed: pose false');
  // Unknown — permissive
  assert(isMeshEditAllowed(true, 'unknown') === true,
    'isMeshEditAllowed: unknown ws permissive');
  // Null workspace — permissive (modeling fallback)
  assert(isMeshEditAllowed(true, null) === true,
    'isMeshEditAllowed: null ws permissive');
}

// ── No mutation of input overlays across calls ───────────────────────
{
  const userOverlays = { showWireframe: true, showVertices: true };
  applyWorkspacePolicy(userOverlays, true, 'layout');
  applyWorkspacePolicy(userOverlays, true, 'animation');
  applyWorkspacePolicy(userOverlays, true, 'pose');
  assert(userOverlays.showWireframe === true,
    'multi-call: input overlays.showWireframe still true');
  assert(userOverlays.showVertices === true,
    'multi-call: input overlays.showVertices still true');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
