// v3 Phase 0A / 1A.UX — uiV3Store tests (tabs-per-area shape).
// Updated 2026-05-02 — workspaces collapsed from 5 to 3 (edit / pose /
// animation). Layout / Modeling / Rigging merged into 'edit'.
// Updated 2026-05-03 — collapsed 3 → 2 (default / animation). 'edit' and
// 'pose' merged into 'default' since they had identical layouts.
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
  useUIV3Store.getState().setWorkspace('default');
  useUIV3Store.getState().resetWorkspace();
}

// ── Initial state ───────────────────────────────────────────────────

{
  const s = useUIV3Store.getState();
  assert(s.activeWorkspace === 'default', 'initial workspace = default');
  assert(Object.keys(s.workspaces).length === 2, '2 workspace presets');
  const wsKeys = Object.keys(s.workspaces).sort();
  assert(JSON.stringify(wsKeys) === '["animation","default"]',
    'workspace keys = [animation, default]');

  // Default layout: leftTop / leftBottom / center / rightTop / rightBottom.
  // Both side columns are vertical splits.
  const ws = s.workspaces.default;
  assert(ws.areas.length === 5, 'default has 5 areas');
  const ids = ws.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop","rightBottom","rightTop"]',
    'default area ids = [center, leftBottom, leftTop, rightBottom, rightTop]');

  const leftTop = ws.areas.find((a) => a.id === 'leftTop');
  assert(leftTop?.tabs.length === 1 && leftTop.tabs[0].editorType === 'outliner',
    'leftTop single tab = outliner');

  const leftBottom = ws.areas.find((a) => a.id === 'leftBottom');
  assert(leftBottom?.tabs.length === 1 && leftBottom.tabs[0].editorType === 'logs',
    'leftBottom single tab = logs');

  // 2026-05-02 — Live Preview is the second tab on every center area; the
  // user clicks it to flip the same canvas into live mode (no canvas split).
  const center = ws.areas.find((a) => a.id === 'center');
  assert(center?.tabs.length === 2, 'center has 2 tabs');
  assert(center?.tabs[0].editorType === 'viewport', 'center tab[0] = viewport');
  assert(center?.tabs[1].editorType === 'livePreview', 'center tab[1] = livePreview');
  assert(center?.activeTabId === center.tabs[0].id, 'center starts on viewport');

  const rightTop = ws.areas.find((a) => a.id === 'rightTop');
  assert(rightTop?.tabs.length === 1 && rightTop.tabs[0].editorType === 'parameters',
    'rightTop single tab = parameters');

  const rightBottom = ws.areas.find((a) => a.id === 'rightBottom');
  assert(rightBottom?.tabs.length === 1 && rightBottom.tabs[0].editorType === 'properties',
    'rightBottom single tab = properties');
}

// ── Animation workspace adds timeline; center hosts the same 2 tabs ─

{
  const s = useUIV3Store.getState();
  const anim = s.workspaces.animation;
  assert(anim.areas.length === 6, 'animation has 6 areas');
  const ids = anim.areas.map((a) => a.id).sort();
  assert(JSON.stringify(ids) === '["center","leftBottom","leftTop","rightBottom","rightTop","timeline"]',
    'animation area ids = [left halves, center, right halves, timeline]');
  const tl = anim.areas.find((a) => a.id === 'timeline');
  assert(tl?.tabs[0]?.editorType === 'timeline',
    'animation timeline area hosts timeline editor');
  // 2026-05-02 — Live Preview is a tab on the center area (no centerRight split).
  const c = anim.areas.find((a) => a.id === 'center');
  assert(c?.tabs.length === 2, 'animation center has 2 tabs');
  assert(c?.tabs[0].editorType === 'viewport' && c?.tabs[1].editorType === 'livePreview',
    'animation center tabs = [viewport, livePreview]');
  // rightBottom in animation workspace pairs Animations + Properties.
  const rb = anim.areas.find((a) => a.id === 'rightBottom');
  assert(rb?.tabs.length === 2, 'animation rightBottom has 2 tabs');
  const rbTypes = rb.tabs.map((t) => t.editorType);
  assert(JSON.stringify(rbTypes) === '["animations","properties"]',
    'animation rightBottom = [animations, properties]');
}

// ── No workspace ships a centerRight slot — single canvas, tabbed swap ──

{
  const s = useUIV3Store.getState();
  for (const wsKey of /** @type {const} */ (['default', 'animation'])) {
    const ws = s.workspaces[wsKey];
    const cr = ws.areas.find((a) => a.id === 'centerRight');
    assert(!cr, `${wsKey} has no centerRight area (Live Preview rides as a tab on center)`);
  }
}

// ── setWorkspace switches active workspace ──────────────────────────

{
  reset();
  useUIV3Store.getState().setWorkspace('animation');
  assert(useUIV3Store.getState().activeWorkspace === 'animation', 'setWorkspace → animation');
  useUIV3Store.getState().setWorkspace('default');
  assert(useUIV3Store.getState().activeWorkspace === 'default', 'setWorkspace → default');
}

// ── Blender contract: workspace switch does NOT touch editMode ──────
//
// "Modes are in every window and don't change between windows." —
// user 2026-05-02. Workspaces are PURELY layout presets; modes
// (mesh / skeleton / blendShape) live on `editorStore.editMode` and
// must persist across workspace transitions.

{
  reset();
  const { useEditorStore } = await import('../../src/store/editorStore.js');

  // Enter mesh edit, then walk through every workspace and verify
  // editMode is preserved at each step.
  useEditorStore.setState({
    selection: ['part-1'],
    editMode: 'mesh',
    meshSubMode: 'deform',
  });

  for (const wsId of /** @type {const} */ (['default', 'animation', 'default', 'animation'])) {
    useUIV3Store.getState().setWorkspace(wsId);
    assert(useEditorStore.getState().editMode === 'mesh',
      `workspace switch → ${wsId}: editMode='mesh' preserved`);
    assert(useEditorStore.getState().selection[0] === 'part-1',
      `workspace switch → ${wsId}: selection preserved`);
  }

  // Same contract for skeleton edit
  useEditorStore.setState({
    selection: ['bone-1'],
    editMode: 'skeleton',
  });
  useUIV3Store.getState().setWorkspace('animation');
  assert(useEditorStore.getState().editMode === 'skeleton',
    'workspace switch: skeleton edit preserved');

  // ... and blendShape edit
  useEditorStore.setState({
    selection: ['part-2'],
    editMode: 'blendShape',
    activeBlendShapeId: 'shape-1',
  });
  useUIV3Store.getState().setWorkspace('default');
  assert(useEditorStore.getState().editMode === 'blendShape',
    'workspace switch: blendShape edit preserved');
  assert(useEditorStore.getState().activeBlendShapeId === 'shape-1',
    'workspace switch: activeBlendShapeId preserved');

  // Reset for any subsequent tests
  useEditorStore.setState({ selection: [], editMode: null, activeBlendShapeId: null });
}

// ── PP2 — workspace DRIVES editorMode (Setup/Animate pill removed) ──
//
// Default workspace → 'staging'. Animation workspace → 'animation'.
// One axis instead of two; user always wanted them in lockstep.

{
  reset();
  const { useEditorStore } = await import('../../src/store/editorStore.js');

  useUIV3Store.getState().setWorkspace('default');
  assert(useEditorStore.getState().editorMode === 'staging',
    'workspace default → editorMode staging');

  useUIV3Store.getState().setWorkspace('animation');
  assert(useEditorStore.getState().editorMode === 'animation',
    'workspace animation → editorMode animation');

  useUIV3Store.getState().setWorkspace('default');
  assert(useEditorStore.getState().editorMode === 'staging',
    'workspace default again → editorMode staging again');

  // Reset
  useEditorStore.setState({ editorMode: 'staging' });
}

// ── setAreaEditor swaps the active tab's editor type ────────────────

{
  reset();
  // leftTop active tab should be the first one (outliner).
  const before = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'leftTop');
  const beforeActiveType = before.tabs.find((t) => t.id === before.activeTabId).editorType;
  assert(beforeActiveType === 'outliner', 'pre: leftTop active = outliner');

  useUIV3Store.getState().setAreaEditor('leftTop', 'properties');
  const after = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'leftTop');
  const afterActiveType = after.tabs.find((t) => t.id === after.activeTabId).editorType;
  assert(afterActiveType === 'properties', 'setAreaEditor swaps active tab type');
  assert(after.tabs.length === 1, 'tab count preserved (single-tab area)');
}

// ── setAreaActiveTab switches the visible tab ───────────────────────

{
  reset();
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rightBottom = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  const second = rightBottom.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('rightBottom', second.id);
  const after = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  assert(after.activeTabId === second.id, 'setAreaActiveTab updates id');
  // Switching to an unknown tab id is a no-op.
  useUIV3Store.getState().setAreaActiveTab('rightBottom', 'nonexistent-tab-id');
  const after2 = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  assert(after2.activeTabId === second.id,
    'setAreaActiveTab with unknown tab id = no-op');
}

// ── addTab appends and activates ────────────────────────────────────

{
  reset();
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rb = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  assert(rb.tabs.length === 2, 'addTab appended');
  assert(rb.tabs[1].editorType === 'parameters', 'new tab type correct');
  assert(rb.activeTabId === rb.tabs[1].id, 'new tab is active');
}

// ── removeTab keeps single-tab areas alive ──────────────────────────

{
  reset();
  const lt = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'leftTop');
  useUIV3Store.getState().removeTab('leftTop', lt.tabs[0].id);
  const after = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'leftTop');
  assert(after.tabs.length === 1, 'cannot remove last remaining tab');
}

// ── removeTab activates left neighbour when the active is removed ───

{
  reset();
  useUIV3Store.getState().addTab('rightBottom', 'parameters');
  const rightBottom = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  const paramsTab = rightBottom.tabs[1];
  useUIV3Store.getState().setAreaActiveTab('rightBottom', paramsTab.id);
  useUIV3Store.getState().removeTab('rightBottom', paramsTab.id);
  const after = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'rightBottom');
  assert(after.tabs.length === 1, 'tab removed');
  assert(after.activeTabId === after.tabs[0].id,
    'active fell back to remaining tab');
}

// ── resetWorkspace restores defaults ────────────────────────────────

{
  reset();
  useUIV3Store.getState().setAreaEditor('center', 'properties');
  useUIV3Store.getState().resetWorkspace();
  const center = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'center');
  assert(center.tabs[0].editorType === 'viewport',
    'resetWorkspace restored center = viewport');
}

// ── setAreaEditor on missing area is no-op ──────────────────────────

{
  reset();
  const before = JSON.stringify(useUIV3Store.getState().workspaces.default);
  useUIV3Store.getState().setAreaEditor('does-not-exist', 'outliner');
  const after = JSON.stringify(useUIV3Store.getState().workspaces.default);
  assert(before === after, 'setAreaEditor on missing id: no change');
}

// ── getActiveTab convenience ────────────────────────────────────────

{
  reset();
  const leftTop = useUIV3Store.getState().workspaces.default.areas.find((a) => a.id === 'leftTop');
  const t = getActiveTab(leftTop);
  assert(t?.editorType === 'outliner', 'getActiveTab returns active tab');
  assert(getActiveTab(null) === null, 'getActiveTab(null) = null');
  assert(getActiveTab({}) === null, 'getActiveTab({}) = null');
  assert(getActiveTab({ tabs: [] }) === null, 'getActiveTab(empty tabs) = null');
}

console.log(`uiV3Store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
