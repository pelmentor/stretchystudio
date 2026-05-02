// GAP-001 — PsdImportService unit tests.
//
// Verifies wizard-action lifecycle on the data-layer side:
//   - start opens the wizard at 'review'
//   - cancel resets the wizard cleanly
//   - finalize / reorder snapshot the project (idempotent — only first
//     finalize captures the snapshot)
//   - back rolls the project back to the snapshot
//   - splitParts / updatePsd patch pendingPsd via wizardStore
//   - skip / complete reset wizard + clear interaction state
//
// Canvas-side imperatives (finalizePsdImport / autoMeshAllParts) are
// mocked through captureStore — the test asserts the bridge is called
// with the expected arguments, but doesn't exercise WebGL.
//
// Run: node scripts/test/test_PsdImportService.mjs

import { useWizardStore } from '../../src/store/wizardStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { useCaptureStore } from '../../src/store/captureStore.js';
import * as PsdImportService from '../../src/services/PsdImportService.js';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

const finalizeCalls = [];
const autoMeshCalls = [];
function installBridges() {
  finalizeCalls.length = 0;
  autoMeshCalls.length = 0;
  useCaptureStore.getState().setFinalizePsdImport(
    (...args) => { finalizeCalls.push(args); },
  );
  useCaptureStore.getState().setAutoMeshAllParts(
    () => { autoMeshCalls.push(true); },
  );
}

function uninstallBridges() {
  useCaptureStore.getState().setFinalizePsdImport(null);
  useCaptureStore.getState().setAutoMeshAllParts(null);
}

function resetAllStores() {
  useWizardStore.getState().reset();
  useProjectStore.setState({
    project: {
      schemaVersion: 12,
      canvas: { width: 800, height: 600 },
      nodes: [],
      parameters: [],
      animations: [],
    },
  });
  useEditorStore.setState({
    selection: [],
    editMode: null,
    activeBlendShapeId: null,
  });
  useSelectionStore.getState().clear?.();
}

const samplePsd = () => ({
  psdW: 800,
  psdH: 1024,
  layers: [{ name: 'face' }, { name: 'irides-l' }],
  partIds: ['p-face', 'p-iris'],
});

// ── start: opens wizard at review with pendingPsd ──────────────────
{
  resetAllStores();
  const psd = samplePsd();
  PsdImportService.start(psd);
  assert(useWizardStore.getState().pendingPsd === psd, 'start: pendingPsd stored');
  assert(useWizardStore.getState().step === 'review', 'start: step=review');
}

// ── cancel: resets wizard, project untouched ───────────────────────
{
  resetAllStores();
  PsdImportService.start(samplePsd());
  PsdImportService.cancel();
  assert(useWizardStore.getState().pendingPsd === null, 'cancel: pendingPsd null');
  assert(useWizardStore.getState().step === null, 'cancel: step null');
}

// ── finalize: calls bridge, advances to adjust, snapshots project ──
{
  resetAllStores();
  installBridges();
  const psd = samplePsd();
  PsdImportService.start(psd);
  PsdImportService.finalize([{ id: 'g1', name: 'body' }], new Map(), true);
  assert(finalizeCalls.length === 1, 'finalize: bridge called once');
  const args = finalizeCalls[0];
  assert(args[0] === psd.psdW && args[1] === psd.psdH,
    'finalize: bridge got psdW/psdH');
  assert(args[2] === psd.layers && args[3] === psd.partIds,
    'finalize: bridge got layers/partIds');
  assert(args[4].length === 1 && args[4][0].id === 'g1',
    'finalize: bridge got groupDefs');
  assert(useWizardStore.getState().step === 'adjust',
    'finalize: step → adjust');
  assert(useWizardStore.getState().preImportSnapshot != null,
    'finalize: preImportSnapshot captured');
  assert(useWizardStore.getState().meshAllParts === true,
    'finalize: meshAllParts stored');
  assert(useEditorStore.getState().viewLayers.skeleton === true,
    'finalize: skeleton layer turned on');
  assert(useEditorStore.getState().editMode === 'skeleton',
    'finalize: skeleton edit mode on');
  uninstallBridges();
}

// ── reorder: idempotent snapshot — second finalize doesn't overwrite ──
{
  resetAllStores();
  installBridges();
  PsdImportService.start(samplePsd());
  PsdImportService.reorder();
  const snap1 = useWizardStore.getState().preImportSnapshot;
  assert(useWizardStore.getState().step === 'reorder', 'reorder: step=reorder');
  assert(snap1 != null, 'reorder: snapshot captured');
  // Mutate project, then finalize — snapshot must NOT be overwritten.
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: [{ id: 'mutated', type: 'part' }],
    },
  });
  PsdImportService.finalize([], new Map(), true);
  const snap2 = useWizardStore.getState().preImportSnapshot;
  assert(snap2 === snap1,
    'finalize after reorder: original snapshot preserved (not re-captured)');
  uninstallBridges();
}

// ── back: rolls project back to snapshot, returns to review ────────
{
  resetAllStores();
  installBridges();
  PsdImportService.start(samplePsd());
  // Pre-finalize state.
  const originalNodes = useProjectStore.getState().project.nodes;
  PsdImportService.finalize([], new Map(), true);
  // Pretend the canvas added some nodes (which finalize would normally do).
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      nodes: [{ id: 'wizard-added' }],
    },
  });
  PsdImportService.back();
  assert(useWizardStore.getState().step === 'review', 'back: step=review');
  assert(useWizardStore.getState().preImportSnapshot === null,
    'back: snapshot cleared');
  // Project rolled back to snapshot.
  assert(useProjectStore.getState().project.nodes.length === originalNodes.length,
    'back: project rolled back');
  assert(useEditorStore.getState().editMode === null,
    'back: edit mode exited');
  assert(useEditorStore.getState().viewLayers.skeleton === false,
    'back: skeleton layer off');
  uninstallBridges();
}

// ── skip: bridge call + reset + interaction-state cleanup ─────────
{
  resetAllStores();
  installBridges();
  // Set some "dirty" interaction state to verify cleanup.
  useEditorStore.setState({
    editMode: 'mesh',
    selection: ['something'],
    activeBlendShapeId: 'shape-1',
  });
  PsdImportService.start(samplePsd());
  PsdImportService.skip(false);
  assert(finalizeCalls.length === 1, 'skip: bridge called for finalize');
  assert(useWizardStore.getState().step === null, 'skip: wizard reset');
  assert(useEditorStore.getState().editMode === null,
    'skip: editMode cleared');
  assert(useEditorStore.getState().selection.length === 0,
    'skip: selection cleared');
  assert(useEditorStore.getState().activeBlendShapeId === null,
    'skip: activeBlendShapeId cleared');
  // meshAllParts=false → autoMesh NOT triggered
  assert(autoMeshCalls.length === 0, 'skip(false): autoMesh NOT called');
  uninstallBridges();
}

// ── skip(true): triggers autoMesh after a tick ────────────────────
{
  resetAllStores();
  installBridges();
  PsdImportService.start(samplePsd());
  PsdImportService.skip(true);
  // The service uses setTimeout to give finalize a tick to flush.
  await new Promise((r) => setTimeout(r, 150));
  assert(autoMeshCalls.length === 1, 'skip(true): autoMesh called after tick');
  uninstallBridges();
}

// ── complete: respects meshAllParts override + clears state ────────
{
  resetAllStores();
  installBridges();
  PsdImportService.start(samplePsd());
  // Walk through finalize → adjust to set up state.
  PsdImportService.finalize([], new Map(), true);
  // User clicks Finish; meshAllParts arg overrides stored value.
  PsdImportService.complete(false);
  assert(autoMeshCalls.length === 0,
    'complete(false): autoMesh NOT called');
  assert(useWizardStore.getState().step === null, 'complete: wizard reset');
  uninstallBridges();
}

// ── splitParts / updatePsd patch pendingPsd ───────────────────────
{
  resetAllStores();
  PsdImportService.start(samplePsd());
  // Patch new layers + partIds.
  PsdImportService.updatePsd({
    layers: [{ name: 'face' }, { name: 'irides-l' }, { name: 'irides-r' }],
    partIds: ['p-face', 'p-iris-l', 'p-iris-r'],
  });
  const cur = useWizardStore.getState().pendingPsd;
  assert(cur.layers.length === 3, 'updatePsd: layers patched');
  assert(cur.psdW === 800, 'updatePsd: psdW preserved (not in patch)');
}

console.log(`\nPsdImportService: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
