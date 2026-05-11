// Pose Read/Write Canonicalisation Plan — v19 channels-shape end-to-end test.
//
// Verifies that every consolidated writer + reader respects the v19
// `node.pose.channels[boneId]` envelope. Without this test, the
// channels-shape branch of `setBonePose` / `setBonePoseField` /
// `ensureBonePoseChannel` is exercised only by unit tests in
// `test_pose_writer_helpers.mjs`; this test pushes the full project →
// writer → reader → render path through both shapes so any regression
// (e.g. a writer that bypasses the helper, a reader that reads
// `node.pose.field` directly) surfaces here.
//
// Run: node scripts/test/test_pose_write_v19_shape.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useEditorStore } from '../../src/store/editorStore.js';
import { useSelectionStore } from '../../src/store/selectionStore.js';
import { clearHistory } from '../../src/store/undoHistory.js';
import { getBonePose, isBoneGroup } from '../../src/store/objectDataAccess.js';
import { computeWorldMatrices } from '../../src/renderer/transforms.js';
import { writePoseValues, readPoseValue } from '../../src/renderer/animationEngine.js';
import { clearPoseLocation, clearPoseRotation, clearPoseScale } from '../../src/v3/operators/pose/clearTransform.js';
import { posePaste, poseCopy, flipPoseX } from '../../src/v3/operators/pose/mirror.js';
import { resetToRestPose } from '../../src/services/PoseService.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a project with one bone in v19 channels-shape, one in flat shape. */
function seedMixedShape() {
  clearHistory();
  useProjectStore.setState({
    project: {
      version: '0.1', schemaVersion: 34,
      canvas: { width: 800, height: 600 },
      textures: [], animations: [], parameters: [], physics_groups: [],
      versionControl: { geometryVersion: 0, transformVersion: 0 },
      nodes: [
        // v19 channels-shape: pose envelope + channels[boneId]
        {
          id: 'b-channels', type: 'group', boneRole: 'leftElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 200 },
          pose: { channels: { 'b-channels': { rotation: 0.7, x: 25, y: -10, scaleX: 1.3, scaleY: 0.9 } } },
        },
        // v17/v18 flat shape: pose direct on node
        {
          id: 'b-flat', type: 'group', boneRole: 'rightElbow', parent: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 200, pivotY: 200 },
          pose: { rotation: -0.4, x: -15, y: 5, scaleX: 0.85, scaleY: 1.1 },
        },
      ],
    },
    versionControl: { geometryVersion: 0, transformVersion: 0 },
    hasUnsavedChanges: false,
  });
  useEditorStore.setState({ editMode: 'pose', selection: [] });
  useSelectionStore.setState({ items: [
    { type: 'group', id: 'b-channels' }, { type: 'group', id: 'b-flat' },
  ] });
  useParamValuesStore.setState({ values: {}, boneMirror: { byParam: new Map(), byBone: new Map() } });
}

function getNode(id) {
  return useProjectStore.getState().project.nodes.find((n) => n.id === id);
}

// ── 1. getBonePose reads identical values from both shapes ───────────────────
{
  seedMixedShape();
  const fromCh = getBonePose(getNode('b-channels'));
  assert(near(fromCh.rotation, 0.7), `1: channels read rotation 0.7 → got ${fromCh.rotation}`);
  assert(near(fromCh.x, 25), `1a: channels read x 25 → got ${fromCh.x}`);
  assert(near(fromCh.scaleX, 1.3), `1b: channels read scaleX 1.3 → got ${fromCh.scaleX}`);

  const fromFlat = getBonePose(getNode('b-flat'));
  assert(near(fromFlat.rotation, -0.4), '1c: flat read rotation -0.4');
  assert(near(fromFlat.x, -15), '1d: flat read x -15');
}

// ── 2. clearPoseLocation: channels-shape envelope survives ──────────────────
{
  seedMixedShape();
  clearPoseLocation();
  const ch = getNode('b-channels');
  assert(ch.pose.channels !== undefined, '2: channels envelope intact after clear');
  assert(near(ch.pose.channels['b-channels'].x, 0), '2a: channels.x cleared');
  assert(near(ch.pose.channels['b-channels'].y, 0), '2b: channels.y cleared');
  // rotation + scale untouched
  assert(near(ch.pose.channels['b-channels'].rotation, 0.7), '2c: channels.rotation preserved');
  assert(near(ch.pose.channels['b-channels'].scaleX, 1.3), '2d: channels.scaleX preserved');
  // No flat-shape leak onto envelope.
  assert(ch.pose.rotation === undefined, '2e: NO flat-shape leak on envelope');

  const flat = getNode('b-flat');
  assert(near(flat.pose.x, 0), '2f: flat.x cleared');
  assert(near(flat.pose.rotation, -0.4), '2g: flat.rotation preserved');
}

// ── 3. clearPoseRotation: channels rotation cleared ─────────────────────────
{
  seedMixedShape();
  clearPoseRotation();
  const ch = getNode('b-channels');
  assert(near(ch.pose.channels['b-channels'].rotation, 0), '3: channels rotation cleared');
  assert(near(ch.pose.channels['b-channels'].x, 25), '3a: channels.x preserved');
}

// ── 4. clearPoseScale: channels scale cleared ───────────────────────────────
{
  seedMixedShape();
  clearPoseScale();
  const ch = getNode('b-channels');
  assert(near(ch.pose.channels['b-channels'].scaleX, 1), '4: channels scaleX cleared');
  assert(near(ch.pose.channels['b-channels'].scaleY, 1), '4a: channels scaleY cleared');
  assert(near(ch.pose.channels['b-channels'].rotation, 0.7), '4b: channels.rotation preserved');
}

// ── 5. computeWorldMatrices reads channels-shape correctly ──────────────────
{
  seedMixedShape();
  const wm = computeWorldMatrices(useProjectStore.getState().project.nodes);
  const m = wm.get('b-channels');
  assert(m !== undefined, '5: world matrix exists for channels-shape bone');
  // The world matrix should reflect rotation 0.7 + translation. If the
  // pose was read as identity (the bug this whole plan fixes),
  // m[0]=cos(0)=1 and m[6]=pivotX=100. With rotation 0.7, m[0]≈cos(0.7)≈0.764.
  assert(!near(m[0], 1, 1e-3), `5a: channels-shape pose actually applied (m[0]=${m[0]} should ≠ 1)`);
}

// ── 6. readPoseValue (animationEngine) reads channels-shape ─────────────────
{
  seedMixedShape();
  const rot = readPoseValue(getNode('b-channels'), 'rotation');
  assert(near(rot, 0.7), `6: readPoseValue rotation from channels → got ${rot}`);
  const sx = readPoseValue(getNode('b-channels'), 'scaleX');
  assert(near(sx, 1.3), `6a: readPoseValue scaleX from channels → got ${sx}`);
}

// ── 7. writePoseValues (animationEngine) writes through helper ──────────────
{
  seedMixedShape();
  const ch = getNode('b-channels');
  // Use immer-free direct mutation (writePoseValues works on a node ref
  // — we're testing the helper, not the immer wrapper).
  writePoseValues(ch, { rotation: 1.5, x: 99 });
  assert(ch.pose.channels !== undefined, '7: writePoseValues preserves channels envelope');
  assert(near(ch.pose.channels['b-channels'].rotation, 1.5), '7a: channels.rotation written');
  assert(near(ch.pose.channels['b-channels'].x, 99), '7b: channels.x written');
  assert(near(ch.pose.channels['b-channels'].scaleX, 1.3), '7c: channels.scaleX preserved');
}

// ── 8. resetToRestPose: zeroes both shapes uniformly ────────────────────────
{
  seedMixedShape();
  resetToRestPose();
  const ch = getNode('b-channels');
  const flat = getNode('b-flat');
  assert(ch.pose.channels !== undefined, '8: channels envelope intact after reset');
  assert(near(ch.pose.channels['b-channels'].rotation, 0), '8a: channels reset rotation');
  assert(near(ch.pose.channels['b-channels'].x, 0), '8b: channels reset x');
  assert(near(ch.pose.channels['b-channels'].scaleX, 1), '8c: channels reset scaleX');
  assert(near(flat.pose.rotation, 0), '8d: flat reset rotation');
  assert(near(flat.pose.scaleX, 1), '8e: flat reset scaleX');
}

// ── 9. poseCopy + posePaste: round-trips through both shapes ────────────────
{
  seedMixedShape();
  // Copy the channels-shape bone's pose, paste it onto the flat-shape bone.
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b-channels' }] });
  poseCopy();

  // Now paste onto the flat-shape bone (rightElbow). Roles differ so
  // un-flipped paste won't match — use flipped to map leftElbow → rightElbow.
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b-flat' }] });
  const r = posePaste({ flipped: true });
  assert(r.pasted === 1, `9: 1 paste, got ${r.pasted}`);

  const flat = getNode('b-flat');
  // X-flipped: source x=25 → -25; rotation 0.7 → -0.7
  assert(near(flat.pose.x, -25), `9a: flat.x = -25 (mirrored from 25), got ${flat.pose.x}`);
  assert(near(flat.pose.rotation, -0.7), `9b: flat.rotation = -0.7 (mirrored from 0.7)`);
  // y unchanged by X-flip
  assert(near(flat.pose.y, -10), `9c: flat.y = -10 (unchanged), got ${flat.pose.y}`);
  // scale unchanged by X-flip
  assert(near(flat.pose.scaleX, 1.3), `9d: flat.scaleX = 1.3 (unchanged)`);
}

// ── 10. Mixed-shape paste: channels-shape envelope survives a paste ─────────
{
  seedMixedShape();
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b-flat' }] });
  poseCopy();
  useSelectionStore.setState({ items: [{ type: 'group', id: 'b-channels' }] });
  posePaste({ flipped: true });

  const ch = getNode('b-channels');
  assert(ch.pose.channels !== undefined, '10: paste preserves channels envelope on target');
  // X-flipped from flat (-15, -0.4 rotation): x → 15, rotation → 0.4
  assert(near(ch.pose.channels['b-channels'].x, 15), `10a: channels.x = 15 (mirrored from -15)`);
  assert(near(ch.pose.channels['b-channels'].rotation, 0.4), `10b: channels.rotation = 0.4 (mirrored from -0.4)`);
  // y unchanged: source flat.y = 5
  assert(near(ch.pose.channels['b-channels'].y, 5), `10c: channels.y = 5 (unchanged)`);
}

// ── 11. flipPoseX is shape-agnostic ─────────────────────────────────────────
{
  const p = { rotation: 0.5, x: 30, y: -10, scaleX: 1.5, scaleY: 0.9 };
  const f = flipPoseX(p);
  assert(near(f.rotation, -0.5), '11: flipPoseX rotation negated');
  assert(near(f.x, -30), '11a: flipPoseX x negated');
  assert(near(f.y, -10), '11b: flipPoseX y unchanged');
  assert(near(f.scaleX, 1.5), '11c: flipPoseX scaleX unchanged');
}

// ── 12. paramValuesStore.syncFromProject reads channels-shape rotation ──────
{
  seedMixedShape();
  // Register a bone-mirror entry for the channels-shape bone.
  const byParam = new Map([['ParamRotation_leftElbow', 'b-channels']]);
  const byBone = new Map([['b-channels', 'ParamRotation_leftElbow']]);
  useParamValuesStore.setState({ values: {}, boneMirror: { byParam, byBone } });
  useParamValuesStore.getState().syncFromProject();
  const v = useParamValuesStore.getState().values['ParamRotation_leftElbow'];
  // Pre-fix: read returned 0 (channels-shape unreachable). Post-fix:
  // returns 0.7 from channels[boneId].rotation.
  assert(near(v, 0.7), `12: param mirror reads channels rotation 0.7 → got ${v}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map(f => '  - ' + f).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
