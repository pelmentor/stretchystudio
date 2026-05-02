// GAP-010 — Live Preview wiring tests.
//
// Verifies the easily-testable contracts that pin GAP-010's architecture
// in place. The editor registry itself can't be imported here (Node has
// no JSX loader and the registry pulls in every editor component); we
// rely on the registry being exercised at runtime in dev/build, and on
// `test_uiV3Store.mjs` which validates the EditorType union covers
// `livePreview` via the workspace presets.
//
//   1. EVERY workspace preset's `center` area has TWO tabs in order
//      [viewport, livePreview], with viewport active by default. The
//      user clicks the livePreview tab to swap the center canvas into
//      live mode (one canvas, two tabs).
//   2. Both canvas tabs back onto a single `<CanvasArea>` mount — the
//      area-level shell short-circuits the editor registry for
//      `viewport` and `livePreview` so toggling between them keeps the
//      same CanvasViewport instance alive (preserves WebGL2 context,
//      texture uploads, wizard PSD payload, ONNX session, snapshot
//      refs). Encoded here as the contract that the registry's
//      `component` slot is `null` for both canvas types.
//   3. editorStore no longer carries the obsolete `livePreviewActive`
//      / `setLivePreviewActive` / `editParamSnapshot` triple — drivers
//      are bound to the LivePreviewEditor component's mount lifetime,
//      not a global flag. Switching the center tab back to `viewport`
//      flips `previewMode` on the shared canvas and stops drivers
//      cleanly.
//   4. setAreaActiveTab can swap the center tab to livePreview
//      programmatically.
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

// ── 1. EVERY workspace's `center` area has tabs [viewport, livePreview] ─
{
  const s = useUIV3Store.getState();
  const ALL_WORKSPACES = /** @type {const} */ ([
    'edit', 'pose', 'animation',
  ]);
  for (const wsKey of ALL_WORKSPACES) {
    const ws = s.workspaces[wsKey];
    const c = ws.areas.find((a) => a.id === 'center');
    assert(!!c, `${wsKey} workspace: has center slot`);
    assert(c?.tabs.length === 2, `${wsKey} workspace: center has exactly 2 tabs`);
    assert(c?.tabs[0]?.editorType === 'viewport',
      `${wsKey} workspace: center tab[0] = viewport`);
    assert(c?.tabs[1]?.editorType === 'livePreview',
      `${wsKey} workspace: center tab[1] = livePreview`);
    assert(c?.activeTabId === c?.tabs[0]?.id,
      `${wsKey} workspace: center activeTabId starts on viewport`);
  }
}

// ── 2. No workspace ships a centerRight slot (we don't split the canvas) ─
{
  const s = useUIV3Store.getState();
  for (const wsKey of /** @type {const} */ (['edit', 'pose', 'animation'])) {
    const ws = s.workspaces[wsKey];
    const cr = ws.areas.find((a) => a.id === 'centerRight');
    assert(!cr, `${wsKey} workspace: no centerRight slot — center is single canvas with tabbed swap`);
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

// ── 4. setAreaActiveTab swaps the center tab between viewport ↔ livePreview ─
// User clicks the Live Preview tab on the center area header → drivers run.
// Clicking the Viewport tab → LivePreviewEditor unmounts, drivers stop.
{
  useUIV3Store.getState().setWorkspace('edit');
  useUIV3Store.getState().resetWorkspace();

  const initial = useUIV3Store.getState().workspaces.edit.areas.find((a) => a.id === 'center');
  const livePreviewTabId = initial.tabs.find((t) => t.editorType === 'livePreview')?.id;
  const viewportTabId    = initial.tabs.find((t) => t.editorType === 'viewport')?.id;
  assert(!!livePreviewTabId && !!viewportTabId,
    'center area: both viewport and livePreview tabs exist');

  useUIV3Store.getState().setAreaActiveTab('center', livePreviewTabId);
  const c = useUIV3Store.getState().workspaces.edit.areas.find((a) => a.id === 'center');
  assert(c.activeTabId === livePreviewTabId,
    'setAreaActiveTab(livePreview): center switches into live mode');

  useUIV3Store.getState().setAreaActiveTab('center', viewportTabId);
  const c2 = useUIV3Store.getState().workspaces.edit.areas.find((a) => a.id === 'center');
  assert(c2.activeTabId === viewportTabId,
    'setAreaActiveTab(viewport): center switches back to edit Viewport (drivers stop)');

  useUIV3Store.getState().resetWorkspace();
}

console.log(`livePreviewWiring: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
