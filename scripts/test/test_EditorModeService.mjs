// EditorModeService — wraps setEditorMode + captureRestPose trigger.
//
// Verifies:
//   - setEditorMode flips editorStore.editorMode
//   - staging→animation transition fires captureRestPose
//   - animation→staging or no-op transitions DO NOT fire captureRestPose
//   - the trigger fires regardless of caller (this is the whole point
//     of the service — both Topbar pill and AnimationsEditor go through
//     here)
//
// Run: node scripts/test/test_EditorModeService.mjs

import { setEditorMode } from '../../src/services/EditorModeService.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useProjectStore } from '../../src/store/projectStore.js';
import { useAnimationStore } from '../../src/store/animationStore.js';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Spy on captureRestPose to count invocations
const captureCalls = [];
function installSpy() {
  captureCalls.length = 0;
  useAnimationStore.setState({
    captureRestPose: (nodes) => { captureCalls.push(nodes); },
  });
}

function reset() {
  installSpy();
  useEditorStore.setState({ editorMode: 'staging' });
  useProjectStore.setState({
    project: {
      schemaVersion: 12,
      canvas: { width: 800, height: 600 },
      nodes: [{ id: 'n1', type: 'part' }],
      parameters: [],
      animations: [],
    },
  });
}

// ── staging → animation: captureRestPose fires ─────────────────────
{
  reset();
  setEditorMode('animation');
  assert(useEditorStore.getState().editorMode === 'animation',
    'staging→animation: editorMode flipped');
  assert(captureCalls.length === 1,
    'staging→animation: captureRestPose called once');
}

// ── animation → staging: captureRestPose does NOT fire ─────────────
{
  reset();
  useEditorStore.setState({ editorMode: 'animation' });
  installSpy();  // reset spy after the manual setState
  setEditorMode('staging');
  assert(useEditorStore.getState().editorMode === 'staging',
    'animation→staging: editorMode flipped');
  assert(captureCalls.length === 0,
    'animation→staging: captureRestPose NOT called');
}

// ── No-op transition (staging→staging): nothing fires ──────────────
{
  reset();
  setEditorMode('staging');
  assert(useEditorStore.getState().editorMode === 'staging',
    'staging→staging: editorMode unchanged');
  assert(captureCalls.length === 0,
    'staging→staging: captureRestPose NOT called');
}

// ── Repeated calls: captureRestPose only fires on TRANSITION ──────
{
  reset();
  setEditorMode('animation');
  assert(captureCalls.length === 1, 'first staging→animation: 1 call');
  setEditorMode('animation');  // no-op
  assert(captureCalls.length === 1,
    'animation→animation: still 1 call (no double-snapshot)');
  setEditorMode('staging');
  setEditorMode('animation');  // second transition
  assert(captureCalls.length === 2,
    'second staging→animation: 2 calls total');
}

// ── Project missing entirely: captureRestPose is gracefully skipped ───
// (matches Topbar's prior `project?.nodes` guard — empty nodes array is
// fine, captureRestPose handles it; only a fully-missing project skips.)
{
  reset();
  useProjectStore.setState({ project: null });
  setEditorMode('animation');
  assert(useEditorStore.getState().editorMode === 'animation',
    'no project: editorMode still flipped');
  assert(captureCalls.length === 0,
    'no project: captureRestPose skipped (nothing to snapshot)');
}

console.log(`EditorModeService: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
