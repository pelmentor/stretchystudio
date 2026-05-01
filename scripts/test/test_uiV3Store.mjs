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

  // Default layout (post-2026-04-30): leftTop / leftBottom / center / rightTop / rightBottom.
  // Both side columns are vertical splits. Outliner top + Logs bottom on the left.
  // Parameters top + Properties bottom on the right.
  const ws = s.workspaces.layout;
  assert(ws.areas.length === 5, 'layout has 5 areas');
  const ids = ws.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop","rightBottom","rightTop"]',
    'layout area ids = [center, leftBottom, leftTop, rightBottom, rightTop]');

  const leftTop = ws.areas.find((a) => a.id === 'leftTop');
  assert(leftTop?.tabs.length === 1 && leftTop.tabs[0].editorType === 'outliner',
    'leftTop single tab = outliner');

  const leftBottom = ws.areas.find((a) => a.id === 'leftBottom');
  assert(leftBottom?.tabs.length === 1 && leftBottom.tabs[0].editorType === 'logs',
    'leftBottom single tab = logs');

  const center = ws.areas.find((a) => a.id === 'center');
  assert(center?.tabs.length === 1 && center.tabs[0].editorType === 'viewport',
    'center single tab = viewport');

  const rightTop = ws.areas.find((a) => a.id === 'rightTop');
  assert(rightTop?.tabs.length === 1 && rightTop.tabs[0].editorType === 'parameters',
    'rightTop single tab = parameters');

  const rightBottom = ws.areas.find((a) => a.id === 'rightBottom');
  assert(rightBottom?.tabs.length === 1 && rightBottom.tabs[0].editorType === 'properties',
    'rightBottom single tab = properties');
}

// ── Animation workspace adds timeline area ──────────────────────────

{
  const s = useUIV3Store.getState();
  const anim = s.workspaces.animation;
  assert(anim.areas.length === 6, 'animation has 6 areas');
  const ids = anim.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop","rightBottom","rightTop","timeline"]',
    'animation area ids include left halves, right halves, center, timeline');
  const tl = anim.areas.find((a) => a.id === 'timeline');
  assert(tl?.tabs[0]?.editorType === 'timeline',
    'animation timeline area hosts timeline editor');
  // rightBottom in animation workspace pairs Animations + Properties.
  const rb = anim.areas.find((a) => a.id === 'rightBottom');
  assert(rb?.tabs.length === 2, 'animation rightBottom has 2 tabs');
  const rbTypes = rb.tabs.map((t) => t.editorType);
  assert(JSON.stringify(rbTypes) === '["animations","properties"]',
    'animation rightBottom = [animations, properties]');
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
  assert(after.tabs.length === 1, 'tab count preserved (single-tab area)');
}

// ── setAreaActiveTab switches the visible tab ───────────────────────

{
  reset();
  // Default layout's leftTop is single-tab; spin up a second tab on
  // rightBottom to exercise the multi-tab switch path.
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rightBottom = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
  const second = rightBottom.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('rightBottom', second.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
  assert(after.activeTabId === second.id, 'setAreaActiveTab updates id');
  // Switching to an unknown tab id is a no-op.
  useUIV3Store.getState().setAreaActiveTab('rightBottom', 'nonexistent-tab-id');
  const after2 = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
  assert(after2.activeTabId === second.id,
    'setAreaActiveTab with unknown tab id = no-op');
}

// ── addTab appends and activates ────────────────────────────────────

{
  reset();
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rb = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
  assert(rb.tabs.length === 2, 'addTab appended');
  assert(rb.tabs[1].editorType === 'parameters', 'new tab type correct');
  assert(rb.activeTabId === rb.tabs[1].id, 'new tab is active');
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
  // Add a second tab to rightBottom so we have something to remove,
  // switch to it, then remove it. After: original tab is active.
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rightBottom = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
  const paramsTab = rightBottom.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('rightBottom', paramsTab.id);
  useUIV3Store.getState().removeTab('rightBottom', paramsTab.id);
  const after = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightBottom');
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
