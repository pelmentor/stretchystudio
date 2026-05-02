// GAP-010 — Live Preview wiring tests.
//
// Verifies the easily-testable contracts that pin GAP-010's architecture
// in place. The editor registry itself can't be imported here (Node has
// no JSX loader and the registry pulls in every editor component); we
// rely on the registry being exercised at runtime in dev/build, and on
// `test_uiV3Store.mjs` which validates the EditorType union covers
// `livePreview` via the workspace presets.
//
//   1. The pose / animation workspace presets include a centerRight
//      slot whose initial tab is livePreview (so the user gets the
//      side-by-side view by default in workspaces where watching the
//      rig sway is the point).
//   2. The layout / modeling / rigging presets stay edit-only (no
//      centerRight slot, so live drivers never run while the user is
//      structuring or rigging).
//   3. editorStore no longer carries the obsolete `livePreviewActive`
//      / `setLivePreviewActive` / `editParamSnapshot` triple — drivers
//      are bound to the LivePreviewCanvas component's mount lifetime,
//      not a global flag.
//   4. The tab system lets the user swap any area to host livePreview
//      manually (escape hatch for workspaces that don't preset it).
//
// Run: node scripts/test/test_livePreviewWiring.mjs

import { useUIV3Store } from '../../src/store/uiV3Store.js';
import { useEditorStore } from '../../src/store/editorStore.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}

// ── 1. Pose / animation presets include centerRight = livePreview ─────
{
  const s = useUIV3Store.getState();
  for (const wsKey of /** @type {const} */ (['pose', 'animation'])) {
    const ws = s.workspaces[wsKey];
    const cr = ws.areas.find((a) => a.id === 'centerRight');
    assert(!!cr, `${wsKey} workspace: has centerRight slot`);
    assert(cr?.tabs.length === 1, `${wsKey} workspace: centerRight has exactly 1 tab`);
    assert(cr?.tabs[0]?.editorType === 'livePreview',
      `${wsKey} workspace: centerRight initial tab = livePreview`);
    assert(cr?.activeTabId === cr?.tabs[0]?.id,
      `${wsKey} workspace: centerRight activeTabId points at the livePreview tab`);
  }
}

// ── 2. Edit-focused workspaces stay drivers-off (no centerRight) ──────
{
  const s = useUIV3Store.getState();
  for (const wsKey of /** @type {const} */ (['layout', 'modeling', 'rigging'])) {
    const ws = s.workspaces[wsKey];
    const cr = ws.areas.find((a) => a.id === 'centerRight');
    assert(!cr, `${wsKey} workspace: no centerRight slot — drivers never auto-run`);
  }
}

// ── 3. editorStore: livePreviewActive triple is gone ──────────────────
{
  const s = useEditorStore.getState();
  assert(s.livePreviewActive === undefined,
    'editorStore: livePreviewActive removed (drivers gate on component mount)');
  assert(s.setLivePreviewActive === undefined,
    'editorStore: setLivePreviewActive removed');
  assert(s.editParamSnapshot === undefined,
    'editorStore: editParamSnapshot removed (no snapshot/restore needed)');
}

// ── 4. Tab system can host livePreview anywhere via setAreaEditor ─────
// The user can swap any area's active tab to livePreview manually, even
// in workspaces that don't preset it. This is the escape hatch for
// users who want preview in (e.g.) modeling temporarily.
{
  useUIV3Store.getState().setWorkspace('layout');
  useUIV3Store.getState().resetWorkspace();
  useUIV3Store.getState().setAreaEditor('rightTop', 'livePreview');
  const rt = useUIV3Store.getState().workspaces.layout.areas.find((a) => a.id === 'rightTop');
  const active = rt.tabs.find((t) => t.id === rt.activeTabId);
  assert(active?.editorType === 'livePreview',
    'setAreaEditor: any area can host livePreview as its active tab');
  // Reset so subsequent tests aren't polluted.
  useUIV3Store.getState().resetWorkspace();
}

console.log(`livePreviewWiring: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
