// Bone-chain diagnostic unit test. Asserts each anomaly flag fires on
// a synthetic project shape designed to trigger it.

import { runBoneChainDiagnostic } from '../../src/io/live2d/rig/boneChainDiagnostic.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// Build a project with a bone + a part that follows it via LBS.
function makeProject({ bones = [], parts = [], parameters = [] }) {
  const nodes = [];
  for (const b of bones) {
    nodes.push({
      id: b.id, type: 'group', name: b.name ?? b.id, parent: b.parent ?? null,
      boneRole: b.role ?? b.id, transform: { pivotX: 0, pivotY: 0 },
    });
  }
  for (const p of parts) {
    nodes.push({
      id: p.id, type: 'part', name: p.name ?? p.id, parent: p.parent ?? null,
      mesh: p.mesh ?? { vertices: [{ x: 0, y: 0 }] },
      modifiers: p.modifiers,
    });
  }
  return { canvas: { width: 1024, height: 1024 }, nodes, parameters };
}

// Suppress the diagnostic logger so test output is clean.
const logCapture = [];
process.env.STRETCHY_LOG_INTERCEPT = '1';

// ── §1 — clean project, LBS path ──────────────────────────────────

{
  const project = makeProject({
    bones: [{ id: 'g_rightArm', name: 'rightArm', role: 'rightArm' }],
    parts: [{
      id: 'p_arm', parent: 'g_rightArm',
      mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], jointBoneId: 'g_rightArm', boneWeights: [1, 1] },
      modifiers: [{ type: 'armature', deformerId: 'g_rightArm', enabled: true, data: { jointBoneId: 'g_rightArm' } }],
    }],
    parameters: [{ id: 'ParamRotation_rightArm', role: 'bone' }],
  });
  const mirror = new Map([['g_rightArm', 'ParamRotation_rightArm']]);
  const r = runBoneChainDiagnostic(project, { byBone: mirror });
  eq(r.boneCount, 1, '§1 — boneCount');
  eq(r.anomalyCount, 0, '§1 — no anomalies on clean LBS chain');
  eq(r.strandedBones, [], '§1 — no stranded');
  eq(r.missingParam, [], '§1 — no missing param');
  eq(r.missingMirror, [], '§1 — no missing mirror');
}

// ── §2 — STRANDED bone (no parts follow it) ──────────────────────

{
  const project = makeProject({
    bones: [{ id: 'g_orphan', name: 'orphan', role: 'orphan' }],
    parts: [],
    parameters: [{ id: 'ParamRotation_orphan', role: 'bone' }],
  });
  const mirror = new Map([['g_orphan', 'ParamRotation_orphan']]);
  const r = runBoneChainDiagnostic(project, { byBone: mirror });
  ok(r.strandedBones.includes('orphan'), '§2 — orphan bone flagged STRANDED');
  ok(r.anomalyCount >= 1, '§2 — anomaly count ≥ 1');
}

// ── §3 — MISSING_PARAM (paramSpec didn't emit ParamRotation_<bone>) ──

{
  const project = makeProject({
    bones: [{ id: 'g_unparam', name: 'unparam', role: 'unparam' }],
    parts: [{
      id: 'p1', parent: 'g_unparam',
      mesh: { vertices: [{ x: 0, y: 0 }] },
    }],
    parameters: [],  // no ParamRotation_unparam
  });
  const r = runBoneChainDiagnostic(project, null);  // null mirror — UNCHECKED
  ok(r.missingParam.includes('unparam'), '§3 — unparam flagged MISSING_PARAM');
}

// ── §4 — MISSING_MIRROR (param exists but registry empty for it) ──

{
  const project = makeProject({
    bones: [{ id: 'g_mismatch', name: 'mismatch', role: 'mismatch' }],
    parts: [{ id: 'p1', parent: 'g_mismatch', mesh: { vertices: [{ x: 0, y: 0 }] } }],
    parameters: [{ id: 'ParamRotation_mismatch', role: 'bone' }],
  });
  // Mirror EMPTY — param exists, but no registry entry.
  const r = runBoneChainDiagnostic(project, { byBone: new Map() });
  ok(r.missingMirror.includes('mismatch'), '§4 — mismatch flagged MISSING_MIRROR');
}

// ── §5 — overlay path (parts parented to bone, no weights) ──

{
  const project = makeProject({
    bones: [{ id: 'g_head', name: 'head', role: 'head' }],
    parts: [
      // child of head bone, no weights → overlay
      { id: 'p_face', parent: 'g_head', mesh: { vertices: [{ x: 0, y: 0 }] } },
    ],
    parameters: [{ id: 'ParamRotation_head', role: 'bone' }],
  });
  const mirror = new Map([['g_head', 'ParamRotation_head']]);
  const r = runBoneChainDiagnostic(project, { byBone: mirror });
  eq(r.anomalyCount, 0, '§5 — clean overlay chain has no anomalies');
}

// ── §6 — INCOMPLETE_ARM_MODS (some LBS parts missing armature modifier) ──

{
  const project = makeProject({
    bones: [{ id: 'g_arm', name: 'arm', role: 'leftArm' }],
    parts: [
      {
        id: 'p_with_mod', parent: 'g_arm',
        mesh: { vertices: [{ x: 0, y: 0 }], jointBoneId: 'g_arm', boneWeights: [1] },
        modifiers: [{ type: 'armature', deformerId: 'g_arm', enabled: true, data: { jointBoneId: 'g_arm' } }],
      },
      {
        id: 'p_no_mod', parent: 'g_arm',
        mesh: { vertices: [{ x: 0, y: 0 }], jointBoneId: 'g_arm', boneWeights: [1] },
        modifiers: [],  // missing!
      },
    ],
    parameters: [{ id: 'ParamRotation_arm', role: 'bone' }],
  });
  const mirror = new Map([['g_arm', 'ParamRotation_arm']]);
  const r = runBoneChainDiagnostic(project, { byBone: mirror });
  ok(r.incompleteArmMods.includes('arm'), '§6 — arm flagged INCOMPLETE_ARM_MODS');
}

console.log(`boneChainDiagnostic: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
