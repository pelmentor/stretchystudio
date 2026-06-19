// Regression: Apply Pose as Rest must behave like Blender's "Apply Pose as
// Rest Pose": (A) appearance UNCHANGED, (B) bone poses zeroed, (C) mesh still
// driven by the bones afterwards (rig kept). Pre-fix the bake used the part's
// single world matrix uniformly, ignoring per-vertex boneWeights, so weight-0
// verts rotated -> the mesh JUMPED on apply (~13px on a bent limb).
//
// Run: node scripts/test/test_applyPoseAsRestBlender.mjs

import { useProjectStore } from '../../src/store/projectStore.js';
import { useParamValuesStore } from '../../src/store/paramValuesStore.js';
import { evalProjectFrameViaDepgraph } from '../../src/anim/depgraph/evalProjectFrame.js';

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); console.error('FAIL: ' + n); } };

function mk(poseRot) {
  return {
    version: '0.1', schemaVersion: 51, canvas: { width: 1280, height: 1280 }, textures: [], parameters: [],
    versionControl: { geometryVersion: 0 }, hasUnsavedChanges: false,
    nodes: [
      { id: 'leftArm', type: 'group', boneRole: 'leftArm', name: 'leftArm', parent: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 600 },
        pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'leftElbow', type: 'group', boneRole: 'leftElbow', name: 'leftElbow', parent: 'leftArm',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 400, pivotY: 800 },
        pose: { rotation: poseRot, x: 0, y: 0, scaleX: 1, scaleY: 1 } },
      { id: 'hw', type: 'part', name: 'handwear-l', parent: 'leftElbow',
        mesh: {
          vertices: [ {x:380,y:800,restX:380,restY:800},{x:420,y:800,restX:420,restY:800},
                      {x:380,y:1000,restX:380,restY:1000},{x:420,y:1000,restX:420,restY:1000} ],
          uvs:[0,0,1,0,0,1,1,1], triangles:[[0,1,2],[1,3,2]],
          boneWeights:[0,0,1,1], jointBoneId:'leftElbow',
          runtime:{ bindings:[], keyforms:[{keyTuple:[],opacity:1,
            vertexPositions:[380,800,420,800,380,1000,420,1000]}] } },
        modifiers:[{type:'armature',deformerId:'leftElbow',enabled:true,mode:3,
          data:{jointBoneId:'leftElbow',parentBoneId:'leftArm'}}] },
    ],
  };
}
const evalHw = () => Array.from(evalProjectFrameViaDepgraph(useProjectStore.getState().project, {}).find(x=>x.id==='hw').vertexPositions);
const maxd = (a,b) => { let m=0; for(let i=0;i<a.length;i++) m=Math.max(m,Math.abs(a[i]-b[i])); return m; };

useProjectStore.setState({ project: mk(40) });
useParamValuesStore.setState({ values: {} });

const before = evalHw();                 // posed viewport (the user sees this)
useProjectStore.getState().applyPoseAsRest();
const after = evalHw();                   // immediately after apply

// (A) appearance unchanged (Blender: skeleton + mesh stay put).
ok(maxd(before, after) < 1.0, `(A) appearance UNCHANGED after apply (maxDelta=${maxd(before,after).toFixed(3)}px, was ~13 pre-fix)`);

// (B) bone pose zeroed.
const elbow = useProjectStore.getState().project.nodes.find(n=>n.id==='leftElbow');
ok(elbow.pose.rotation === 0, '(B) elbow pose zeroed');

// rest geometry baked (restX moved to posed) so Init Rig / export keep it.
const hw = useProjectStore.getState().project.nodes.find(n=>n.id==='hw');
ok(Math.abs(hw.mesh.vertices[3].restX - before[6]) < 1.0 && Math.abs(hw.mesh.vertices[3].restY - before[7]) < 1.0,
  '(rest) restX/restY baked to the posed geometry (survives Init Rig + export)');
ok((hw.modifiers??[]).some(m=>m.type==='armature') && Array.isArray(hw.mesh.boneWeights),
  '(rig) armature modifier + boneWeights KEPT (still skinned)');

// (C) re-posable: setting a NEW elbow pose moves the mesh from its new rest.
useProjectStore.getState().updateProject((p)=>{p.nodes.find(n=>n.id==='leftElbow').pose.rotation=25;});
const reposed = evalHw();
ok(maxd(reposed, after) > 1.0, `(C) re-posable: bone still drives the mesh (moveDelta=${maxd(reposed,after).toFixed(3)}px)`);

console.log(`\napplyPoseAsRestBlender: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); fails.forEach(f=>console.log('  - '+f)); process.exit(1); }
