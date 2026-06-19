// Regression: Apply-Armature must bake into the REST geometry (restX/restY),
// not just the transient x/y. PSD-imported verts carry restX/restY as the
// canonical rest pose; resetToRestPose (PoseService.js) restores x=restX, and
// the exporter (exporter.js buildMeshesForRig) reads `v.restX ?? v.x`. If Apply
// writes only x/y, the baked shape survives in the viewport but is DISCARDED by
// the next Init Rig (reset snaps x back to restX) AND by export (reads restX) —
// "the arm snaps back to pre-bake shape" (2026-06-19).
//
// Run: node scripts/test/test_applyArmatureBakesRest.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { applyArmatureModifier } from '../../src/services/ArmatureModifierService.js';
import { computeBoneWorldMatrices } from '../../src/renderer/boneOverlayMatrix.js';
import { applyTwoBoneSkinningObj } from '../../src/renderer/boneSkinning.js';

let passed = 0, failed = 0;
const fail = [];
const assert = (c, n) => { if (c) passed++; else { failed++; fail.push(n); console.error(`FAIL: ${n}`); } };
const approx = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

// Bone-baked handwear, leftArm posed 90°, verts carry restX/restY (PSD import).
useProjectStore.setState({
  project: {
    version: '0.1', schemaVersion: 51,
    canvas: { width: 1280, height: 1280 }, textures: [], parameters: [],
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        pose: { rotation: 90, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow', parent: 'leftArm',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 100, pivotY: 0 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'handwear-l', type: 'part', name: 'handwear-l', parent: 'leftArm',
        mesh: {
          vertices: [
            { x: 200, y: 0, restX: 200, restY: 0 },
            { x: 1, y: 0, restX: 1, restY: 0 },
          ],
          triangles: [], boneWeights: [1, 1], jointBoneId: 'leftElbow',
        },
        modifiers: [
          { type: 'armature', deformerId: 'leftElbow', enabled: true, mode: 3,
            data: { jointBoneId: 'leftElbow', jointBoneRole: 'leftElbow',
              parentBoneId: 'leftArm', parentBoneRole: 'leftArm', deformFlag: 1, vertexGroupName: '' } },
        ] },
    ],
  },
});
useParamValuesStore.setState({ values: {} });

// Independent expected bake (what the viewport shows under the 90° pose).
const project = useProjectStore.getState().project;
const expected = project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
const bw = computeBoneWorldMatrices(project.nodes);
applyTwoBoneSkinningObj(expected, bw.get('leftArm'), bw.get('leftElbow'), [1, 1]);

const result = applyArmatureModifier('handwear-l');
assert(result.baked === true, `baked=true (got ${JSON.stringify(result)})`);

const verts = useProjectStore.getState().project.nodes.find((n) => n.id === 'handwear-l').mesh.vertices;

// x/y baked (this already worked).
assert(approx(verts[0].x, expected[0].x) && approx(verts[0].y, expected[0].y), 'x/y baked to posed geometry');

// THE FIX: restX/restY must ALSO be the baked geometry, else reset + export revert.
assert(approx(verts[0].restX, expected[0].x), `restX baked (got ${verts[0].restX}, want ${expected[0].x.toFixed(3)})`);
assert(approx(verts[0].restY, expected[0].y), `restY baked (got ${verts[0].restY}, want ${expected[0].y.toFixed(3)})`);
assert(approx(verts[1].restX, expected[1].x), `v1 restX baked (got ${verts[1].restX}, want ${expected[1].x.toFixed(3)})`);

// Simulate the two consumers that snapped back:
//   export → buildMeshesForRig reads `v.restX ?? v.x`
//   Init Rig → resetToRestPose sets `v.x = v.restX`
const exportReadX = verts[0].restX ?? verts[0].x;
assert(approx(exportReadX, expected[0].x), `export reads baked geometry (restX ?? x = ${exportReadX})`);
const afterResetX = verts[0].restX; // resetToRestPose does v.x = v.restX
assert(approx(afterResetX, expected[0].x), `Init Rig reset keeps baked geometry (x←restX = ${afterResetX})`);

console.log(`\napplyArmatureBakesRest: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('FAILURES:'); for (const f of fail) console.log('  - ' + f); process.exit(1); }
