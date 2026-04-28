// v3 Phase 0F.10 (Pillar Q) - Lock in the "saveProject doesn't
// mutate its input" contract. The current implementation already
// honours this via spread copies; this test stops a future change
// from regressing it silently.
//
// Run: node scripts/test/test_serializerPurity.mjs
//
// We can't drive saveProject end-to-end in node (it depends on
// fetch() for blob URLs and JSZip's blob output), but we CAN verify
// the structural-purity invariant: deep-equal before == deep-equal
// after, and the input project object reference graph hasn't been
// mutated for the no-fetch path.

import { saveProject } from '../../src/io/projectFile.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Stub out fetch so saveProject runs to completion without network.
// JSZip in node needs Buffer-like inputs for `.file()`; we bypass
// the texture / audio fetch paths entirely by giving the project
// no textures and no audio tracks. The structural-purity invariant
// we want to lock in lives in the spread / map calls in saveProject,
// not in fetch handling.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('test should not reach fetch');
};

// Build a project with the trickiest input shapes saveProject sees:
//   - textures with blob URL sources
//   - audio tracks with sourceUrl
//   - meshes with TypedArray uvs / edgeIndices / boneWeights
function makeProject() {
  const proj = {
    version: '0.1',
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [],
    nodes: [
      {
        id: 'p1', type: 'part', name: 'a', parent: null,
        draw_order: 0, opacity: 1, visible: true, clip_mask: null,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
        meshOpts: null,
        mesh: {
          vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          uvs: new Float32Array([0, 0, 1, 1]),
          triangles: [[0, 1, 0]],
          edgeIndices: new Uint16Array([0, 1, 1, 0]),
          boneWeights: new Float32Array([0.5, 0.5]),
          jointBoneId: 'bone-x',
        },
        blendShapes: [], blendShapeValues: {},
      },
      { id: 'g1', type: 'group', name: 'root', parent: null, opacity: 1, visible: true,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
      },
    ],
    animations: [
      {
        // Audio track without sourceUrl - we want to verify the
        // serializer doesn't reach into it for fetch (otherwise the
        // stub would throw). Tracks with sourceUrl are exercised by
        // the integration tests when a real .stretch save happens
        // in the browser.
        id: 'anim-1', name: 'idle', tracks: [],
        audioTracks: [{ id: 'aud-1' }],
      },
    ],
    parameters: [{ id: 'P1', min: 0, max: 1, default: 0 }],
    physics_groups: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
  };
  return proj;
}

// Stable fingerprint that survives the TypedArray → plain-array
// distinction, since structural equality between Float32Array and
// number[] is what we actually want to verify.
function fingerprint(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && ArrayBuffer.isView(v)) {
      return { __typed: v.constructor.name, data: Array.from(v) };
    }
    return v;
  });
}

// ── Test 1: project object reference unchanged ─────────────────────

{
  const proj = makeProject();
  const before = fingerprint(proj);
  await saveProject(proj);
  const after = fingerprint(proj);
  assert(before === after, 'saveProject does not mutate input project');
}

// ── Test 2: nodes array is the same reference (no replacement) ─────

{
  const proj = makeProject();
  const nodesRef = proj.nodes;
  const meshRef = proj.nodes[0].mesh;
  const audioTrackRef = proj.animations[0].audioTracks[0];
  await saveProject(proj);
  assert(proj.nodes === nodesRef, 'nodes array reference unchanged');
  assert(proj.nodes[0].mesh === meshRef, 'mesh reference unchanged');
  assert(proj.animations[0].audioTracks[0] === audioTrackRef, 'audio track reference unchanged');
}

// ── Test 3: TypedArrays still TypedArrays after save ───────────────

{
  const proj = makeProject();
  await saveProject(proj);
  assert(proj.nodes[0].mesh.uvs instanceof Float32Array, 'mesh.uvs still Float32Array');
  assert(proj.nodes[0].mesh.edgeIndices instanceof Uint16Array, 'mesh.edgeIndices still Uint16Array');
  assert(proj.nodes[0].mesh.boneWeights instanceof Float32Array, 'mesh.boneWeights still Float32Array');
}

// ── Test 4: audio track input shape preserved ─────────────────────

{
  const proj = makeProject();
  proj.animations[0].audioTracks[0].name = 'should-survive';
  await saveProject(proj);
  assert(proj.animations[0].audioTracks[0].name === 'should-survive',
    'audio track properties preserved on input');
  assert(!('_sourceBlob' in proj.animations[0].audioTracks[0]),
    'no _sourceBlob placeholder leaks back to input');
}

// ── Test 5: idempotence ────────────────────────────────────────────

{
  const proj = makeProject();
  const before = fingerprint(proj);
  await saveProject(proj);
  await saveProject(proj);
  await saveProject(proj);
  const after = fingerprint(proj);
  assert(before === after, 'saveProject is idempotent across multiple calls');
}

// Restore fetch
globalThis.fetch = originalFetch;

console.log(`serializerPurity: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
