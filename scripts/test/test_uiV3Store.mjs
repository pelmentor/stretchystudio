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

  // Default layout (post-2026-04-29): leftTop / leftBottom / center.
  // Properties sits in leftBottom; right column is gone.
  const ws = s.workspaces.layout;
  assert(ws.areas.length === 3, 'layout has 3 areas');
  const ids = ws.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop"]',
    'layout area ids = [center, leftBottom, leftTop]');

  const leftTop = ws.areas.find((a) => a.id === 'leftTop');
  assert(Array.isArray(leftTop?.tabs), 'leftTop has tabs');
  assert(leftTop.tabs.length === 2, 'leftTop has 2 tabs (Outliner + Parameters)');
  const leftTopEditors = leftTop.tabs.map((t) => t.editorType);
  assert(JSON.stringify(leftTopEditors) === '["outliner","parameters"]',
    'leftTop tabs = [outliner, parameters]');
  assert(leftTop.activeTabId === leftTop.tabs[0].id,
    'leftTop activeTabId = first tab');

  const leftBottom = ws.areas.find((a) => a.id === 'leftBottom');
  assert(leftBottom?.tabs.length === 1 && leftBottom.tabs[0].editorType === 'properties',
    'leftBottom single tab = properties');

  const center = ws.areas.find((a) => a.id === 'center');
  assert(center?.tabs.length === 1 && center.tabs[0].editorType === 'viewport',
    'center single tab = viewport');
}

// ── Animation workspace adds timeline area ──────────────────────────

{
  const s = useUIV3Store.getState();
  const anim = s.workspaces.animation;
  assert(anim.areas.length === 4, 'animation has 4 areas');
  const ids = anim.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop","timeline"]',
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
  // leftTop active tab should be the first one (outliner).
  const before = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  const beforeActiveType = before.tabs.find((t) => t.id === before.activeTabId).editorType;
  assert(beforeActiveType === 'outliner', 'pre: leftTop active = outliner');

  useUIV3Store.getState().setAreaEditor('leftTop', 'properties');
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
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
  const leftTop = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  const second = leftTop.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('leftTop', second.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  assert(after.activeTabId === second.id, 'setAreaActiveTab updates id');
  // Switching to an unknown tab id is a no-op.
  useUIV3Store.getState().setAreaActiveTab('leftTop', 'nonexistent-tab-id');
  const after2 = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  assert(after2.activeTabId === second.id,
    'setAreaActiveTab with unknown tab id = no-op');
}

// ── addTab appends and activates ────────────────────────────────────

{
  reset();
  useUIV3Store.getState().addTab('leftBottom', 'parameters');
  const lb = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftBottom');
  assert(lb.tabs.length === 2, 'addTab appended');
  assert(lb.tabs[1].editorType === 'parameters', 'new tab type correct');
  assert(lb.activeTabId === lb.tabs[1].id, 'new tab is active');
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
  // leftTop has [outliner, parameters]. Switch to parameters then remove it.
  const leftTop = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  const paramsTab = leftTop.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('leftTop', paramsTab.id);
  useUIV3Store.getState().removeTab('leftTop', paramsTab.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
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
  const leftTop = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'leftTop');
  const t = getActiveTab(leftTop);
  assert(t?.editorType === 'outliner', 'getActiveTab returns active tab');
  assert(getActiveTab(null) === null, 'getActiveTab(null) = null');
  assert(getActiveTab({}) === null, 'getActiveTab({}) = null');
  assert(getActiveTab({ tabs: [] }) === null, 'getActiveTab(empty tabs) = null');
}

console.log(`uiV3Store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
