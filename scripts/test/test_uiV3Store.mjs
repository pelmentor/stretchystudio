// v3 Phase 0A / 1A.UX — uiV3Store tests (tabs-per-area shape).
// Run: node scripts/test/test_uiV3Store.mjs

import { useUIV3Store, getActiveTab } from '../../src/store/uiV3Store.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function reset() {
  useUIV3Store.getState().setWorkspace('layout');
  useUIV3Store.getState().resetWorkspace();
}

// ── Initial state ───────────────────────────────────────────────────

{
  const s = useUIV3Store.getState();
  assert(s.activeWorkspace === 'layout', 'initial workspace = layout');
  assert(Object.keys(s.workspaces).length === 5, '5 workspace presets');

  // Default 3-column layout: left / center / right.
  const ws = s.workspaces.layout;
  assert(ws.areas.length === 3, 'layout has 3 areas');
  const ids = ws.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","left","right"]',
    'layout area ids = [center, left, right]');

  const left = ws.areas.find((a) => a.id === 'left');
  assert(Array.isArray(left?.tabs), 'left has tabs');
  assert(left.tabs.length === 2, 'left has 2 tabs (Outliner + Parameters)');
  const leftEditors = left.tabs.map((t) => t.editorType);
  assert(JSON.stringify(leftEditors) === '["outliner","parameters"]',
    'left tabs = [outliner, parameters]');
  assert(left.activeTabId === left.tabs[0].id,
    'left activeTabId = first tab');

  const center = ws.areas.find((a) => a.id === 'center');
  assert(center?.tabs.length === 1 && center.tabs[0].editorType === 'viewport',
    'center single tab = viewport');

  const right = ws.areas.find((a) => a.id === 'right');
  assert(right?.tabs.length === 1 && right.tabs[0].editorType === 'properties',
    'right single tab = properties');
}

// ── Animation workspace adds timeline area ──────────────────────────

{
  const s = useUIV3Store.getState();
  const anim = s.workspaces.animation;
  assert(anim.areas.length === 4, 'animation has 4 areas');
  const ids = anim.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","left","right","timeline"]',
    'animation area ids include timeline');
  const tl = anim.areas.find((a) => a.id === 'timeline');
  assert(tl?.tabs[0]?.editorType === 'timeline',
    'animation timeline area hosts timeline editor');
}

// ── setWorkspace switches active workspace ──────────────────────────

{
  reset();
  useUIV3Store.getState().setWorkspace('rigging');
  assert(useUIV3Store.getState().activeWorkspace === 'rigging', 'setWorkspace → rigging');
  useUIV3Store.getState().setWorkspace('layout');
}

// ── setAreaEditor swaps the active tab's editor type ────────────────

{
  reset();
  // left active tab should be the first one (outliner).
  const before = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  const beforeActiveType = before.tabs.find((t) => t.id === before.activeTabId).editorType;
  assert(beforeActiveType === 'outliner', 'pre: left active = outliner');

  useUIV3Store.getState().setAreaEditor('left', 'properties');
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  const afterActiveType = after.tabs.find((t) => t.id === after.activeTabId).editorType;
  assert(afterActiveType === 'properties', 'setAreaEditor swaps active tab type');
  // Other tabs untouched
  assert(after.tabs.length === 2, 'tab count preserved');
  const otherTab = after.tabs.find((t) => t.id !== after.activeTabId);
  assert(otherTab.editorType === 'parameters',
    'non-active tab type preserved');
}

// ── setAreaActiveTab switches the visible tab ───────────────────────

{
  reset();
  const left = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  const second = left.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('left', second.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  assert(after.activeTabId === second.id, 'setAreaActiveTab updates id');
  // Switching to an unknown tab id is a no-op.
  useUIV3Store.getState().setAreaActiveTab('left', 'nonexistent-tab-id');
  const after2 = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  assert(after2.activeTabId === second.id,
    'setAreaActiveTab with unknown tab id = no-op');
}

// ── addTab appends and activates ────────────────────────────────────

{
  reset();
  useUIV3Store.getState().addTab('right', 'parameters');
  const right = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'right');
  assert(right.tabs.length === 2, 'addTab appended');
  assert(right.tabs[1].editorType === 'parameters', 'new tab type correct');
  assert(right.activeTabId === right.tabs[1].id, 'new tab is active');
}

// ── removeTab keeps single-tab areas alive ──────────────────────────

{
  reset();
  const center = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'center');
  useUIV3Store.getState().removeTab('center', center.tabs[0].id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'center');
  assert(after.tabs.length === 1, 'cannot remove last remaining tab');
}

// ── removeTab activates left neighbour when the active is removed ───

{
  reset();
  // left has [outliner, parameters]. Switch to parameters then remove it.
  const left = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  const paramsTab = left.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('left', paramsTab.id);
  useUIV3Store.getState().removeTab('left', paramsTab.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  assert(after.tabs.length === 1, 'tab removed');
  assert(after.activeTabId === after.tabs[0].id,
    'active fell back to remaining tab');
}

// ── resetWorkspace restores defaults ────────────────────────────────

{
  reset();
  useUIV3Store.getState().setAreaEditor('center', 'properties');
  useUIV3Store.getState().resetWorkspace();
  const center = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'center');
  assert(center.tabs[0].editorType === 'viewport',
    'resetWorkspace restored center = viewport');
}

// ── setAreaEditor on missing area is no-op ──────────────────────────

{
  reset();
  const before = JSON.stringify(useUIV3Store.getState().workspaces.layout);
  useUIV3Store.getState().setAreaEditor('does-not-exist', 'outliner');
  const after = JSON.stringify(useUIV3Store.getState().workspaces.layout);
  assert(before === after, 'setAreaEditor on missing id: no change');
}

// ── getActiveTab convenience ────────────────────────────────────────

{
  reset();
  const left = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'left');
  const t = getActiveTab(left);
  assert(t?.editorType === 'outliner', 'getActiveTab returns active tab');
  assert(getActiveTab(null) === null, 'getActiveTab(null) = null');
  assert(getActiveTab({}) === null, 'getActiveTab({}) = null');
  assert(getActiveTab({ tabs: [] }) === null, 'getActiveTab(empty tabs) = null');
}

console.log(`uiV3Store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
