// v3 Phase 0A — uiV3Store tests.
// Run: node scripts/test_uiV3Store.mjs

import { useUIV3Store } from '../../src/store/uiV3Store.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function reset() {
  // Re-import would create a new store; just reset by calling actions.
  useUIV3Store.getState().setWorkspace('layout');
  useUIV3Store.getState().resetWorkspace();
}

// ── Initial state ───────────────────────────────────────────────────

{
  const s = useUIV3Store.getState();
  assert(s.activeWorkspace === 'layout', 'initial workspace = layout');
  assert(Object.keys(s.workspaces).length === 5, '5 workspace presets');
  for (const wsId of ['layout', 'modeling', 'rigging', 'animation', 'pose']) {
    assert(s.workspaces[wsId]?.areas?.length === 4, `workspace ${wsId} has 4 areas`);
  }
  // Layout default areas have a viewport in TL
  const tl = s.workspaces.layout.areas.find(a => a.id === 'tl');
  assert(tl?.editorType === 'viewport', 'layout TL = viewport');
  // Animation workspace puts timeline in BL
  const animBL = s.workspaces.animation.areas.find(a => a.id === 'bl');
  assert(animBL?.editorType === 'timeline', 'animation BL = timeline');
}

// ── setWorkspace ────────────────────────────────────────────────────

{
  const s = useUIV3Store.getState();
  s.setWorkspace('rigging');
  assert(useUIV3Store.getState().activeWorkspace === 'rigging', 'setWorkspace → rigging');
  s.setWorkspace('layout');
}

// ── setAreaEditor ───────────────────────────────────────────────────

{
  reset();
  useUIV3Store.getState().setAreaEditor('tr', 'parameters');
  const after = useUIV3Store.getState().workspaces.layout.areas.find(a => a.id === 'tr');
  assert(after?.editorType === 'parameters', 'setAreaEditor: layout/tr → parameters');

  // Other workspace untouched
  const rigTR = useUIV3Store.getState().workspaces.rigging.areas.find(a => a.id === 'tr');
  assert(rigTR?.editorType === 'outliner', 'setAreaEditor: rigging untouched');
}

// ── resetWorkspace restores defaults ────────────────────────────────

{
  reset();
  useUIV3Store.getState().setAreaEditor('tl', 'properties');
  useUIV3Store.getState().resetWorkspace();
  const tl = useUIV3Store.getState().workspaces.layout.areas.find(a => a.id === 'tl');
  assert(tl?.editorType === 'viewport', 'resetWorkspace restores layout TL');
}

// ── Selecting a missing area is a no-op (graceful) ──────────────────

{
  reset();
  const before = JSON.stringify(useUIV3Store.getState().workspaces.layout);
  useUIV3Store.getState().setAreaEditor('does-not-exist', 'outliner');
  const after = JSON.stringify(useUIV3Store.getState().workspaces.layout);
  assert(before === after, 'setAreaEditor on missing id: no change');
}

console.log(`uiV3Store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
