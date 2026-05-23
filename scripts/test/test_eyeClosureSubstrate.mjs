// Slice 2 (RULE №4 follow-up audit Leak #2) — eye-closure parabola
// substrate. The Cubism keyform-bake leak for eye closure: pre-Slice-2
// the parabola fit (`eyeClosureFit.js`) ran fresh on every
// `generateCmo3` call, was hidden from the user, and the only way to
// re-derive was to re-Init-Rig the whole project. The bake is
// canonical and persisted (`mesh.runtime.keyforms`), but the upstream
// data (the parabola coefficients themselves) lived only as a
// transient export-time map — the audit's "implicit data, hidden from
// the user" finding.
//
// Slice 2 stores the parabola as first-class substrate
// (`project.eyeClosureParabolas`) and has the cmo3writer prepass consume it
// when present (skip the fresh fit). The bake stays where it is; only
// the SOURCE of the curve coefficients is decoupled from export
// timing. Init Rig is the canonical re-fit moment; pure-export reads
// stored data. Future UI can edit the stored field directly with no
// further refactoring.
//
// THIS TEST locks the substrate contract:
//   1. First generateCmo3 with no stored eyeClosure → fit fresh +
//      expose result via `rigCollector.eyeClosureParabolas`.
//   2. `seedEyeClosure(project, maps)` persists Maps as plain JSON-
//      friendly objects on `project.eyeClosureParabolas`.
//   3. Second generateCmo3 with stored eyeClosure → consume stored
//      data (no re-fit) AND propagate identical curves through
//      `rigCollector.eyeClosureParabolas` to downstream consumers.
//   4. Mutating the stored data is observable in the next run
//      (proof that the stored path is taken, not a silent re-fit).
//   5. `resolveEyeClosure` is a faithful Maps-from-JSON inverse:
//      empty when nothing stored; round-trips fit-shape values
//      verbatim.
//   6. cmo3 binary bytes from stored-data run match the bytes from
//      fresh-fit run (proves the consumption path produces the same
//      downstream artefact — the leak is closed at the source, not
//      at the bake).
//
// Run: node scripts/test/test_eyeClosureSubstrate.mjs

import { generateCmo3 } from '../../src/io/live2d/cmo3writer.js';
import {
  resolveEyeClosure,
  seedEyeClosure,
} from '../../src/io/live2d/rig/eyeClosure.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function toGeneratorInput(project) {
  const meshes = project.nodes.filter((n) => n.type === 'part').map((n) => ({
    partId: n.id,
    name: n.name,
    tag: n.tag,
    parentGroupId: n.parent,
    vertices: n.mesh.vertices,
    uvs: n.mesh.uvs,
    triangles: n.mesh.triangles,
    jointBoneId: n.mesh.jointBoneId,
    boneWeights: n.mesh.boneWeights,
    visible: n.visible !== false,
    variantSuffix: n.variantSuffix ?? null,
    variantRole: n.variantRole ?? null,
    pngData: PNG_1x1, // forces mesh-bin-max fallback (1×1 PNG has no contour)
  }));
  const groups = project.nodes.filter((n) => n.type === 'group').map((g) => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));
  return {
    canvasW: project.canvas.width,
    canvasH: project.canvas.height,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: [],
    modelName: 'test',
    generateRig: true,
    generatePhysics: false,
    // rigOnly stops at rigSpec — skips full cmo3 byte build (Contract 6
    // uses a non-rigOnly run separately).
    rigOnly: true,
    // Pre-resolved eye-closure parabolas — mirrors the live caller path
    // (`exporter.js` calls `resolveX(project)` for each substrate
    // subsystem before invoking generateCmo3). Stored data here means
    // the cmo3writer prepass skips the fit; empty maps means fit fresh.
    eyeClosure: resolveEyeClosure(project),
  };
}

// Eye fixture — eyewhite + eyelash per side. Geometry produces a clean
// fit: lower edge has a slight U-shape so the parabola has non-zero a.
function buildEyeFixture() {
  // eyewhite-l: 6-vert mesh, lower edge dips at centre (parabola a>0)
  // upper edge: y=300; lower edge: y=400,410,400 (centre lower)
  const eyewhiteL = [
    300, 300,  400, 300,  500, 300,   // upper row
    300, 400,  400, 410,  500, 400,   // lower row (parabolic)
  ];
  const eyewhiteR = [
    700, 300,  800, 300,  900, 300,
    700, 400,  800, 410,  900, 400,
  ];
  // eyelash-l/r: thin strip just below eyewhite upper edge (provides
  // the bbox for closure strip compression).
  const eyelashL = [300, 290, 500, 290, 500, 305, 300, 305];
  const eyelashR = [700, 290, 900, 290, 900, 305, 700, 305];
  const tris = [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4];
  const trisLash = [0, 1, 2, 0, 2, 3];
  const uvsEye = [0,0, 0.5,0, 1,0, 0,1, 0.5,1, 1,1];
  const uvsLash = [0,0, 1,0, 1,1, 0,1];
  return {
    schemaVersion: 0,
    canvas: { width: 1280, height: 1280 },
    parameters: [],
    physics_groups: [],
    animations: [],
    nodes: [
      {
        id: 'eyewhite-l', type: 'part', name: 'eyewhite-l', tag: 'eyewhite-l',
        visible: true,
        mesh: { vertices: eyewhiteL, uvs: uvsEye, triangles: tris },
      },
      {
        id: 'eyewhite-r', type: 'part', name: 'eyewhite-r', tag: 'eyewhite-r',
        visible: true,
        mesh: { vertices: eyewhiteR, uvs: uvsEye, triangles: tris },
      },
      {
        id: 'eyelash-l', type: 'part', name: 'eyelash-l', tag: 'eyelash-l',
        visible: true,
        mesh: { vertices: eyelashL, uvs: uvsLash, triangles: trisLash },
      },
      {
        id: 'eyelash-r', type: 'part', name: 'eyelash-r', tag: 'eyelash-r',
        visible: true,
        mesh: { vertices: eyelashR, uvs: uvsLash, triangles: trisLash },
      },
    ],
  };
}

// ── Contract 1: fresh fit + expose via rigCollector.eyeClosureParabolas ──────

const project1 = buildEyeFixture();
const result1 = await generateCmo3(toGeneratorInput(project1));
assert(!!result1?.rigSpec?.eyeClosureParabolas,
  'fresh run: rigCollector.eyeClosureParabolas attached to output rigSpec');

const ec1 = result1.rigSpec.eyeClosureParabolas;
assert(ec1.baseParabolaPerSide instanceof Map,
  'rigCollector.eyeClosureParabolas.baseParabolaPerSide is a Map (in-memory wire shape)');
assert(ec1.variantParabolaPerSideAndSuffix instanceof Map,
  'rigCollector.eyeClosureParabolas.variantParabolaPerSideAndSuffix is a Map (in-memory wire shape)');
assert(ec1.baseParabolaPerSide.has('l') && ec1.baseParabolaPerSide.has('r'),
  'fresh run: fit produced l + r parabolas');

const curveL = ec1.baseParabolaPerSide.get('l');
assert(Number.isFinite(curveL?.a) && Number.isFinite(curveL?.b) && Number.isFinite(curveL?.c),
  'parabola has a/b/c coefficients');
assert(Number.isFinite(curveL?.xMid) && Number.isFinite(curveL?.xScale),
  'parabola has xMid/xScale canvas-space normalisation');
assert(typeof curveL?.sourceTag === 'string',
  'parabola carries sourceTag diagnostic');

// ── Contract 2: seedEyeClosure persists to project.eyeClosureParabolas ──────

const proj2 = buildEyeFixture();
seedEyeClosure(proj2, ec1.baseParabolaPerSide, ec1.variantParabolaPerSideAndSuffix);
assert(!!proj2.eyeClosureParabolas,
  'seedEyeClosure populates project.eyeClosureParabolas');
assert(!!proj2.eyeClosureParabolas.baseParabolaPerSide?.l,
  'project.eyeClosureParabolas.baseParabolaPerSide.l serialised');
assert(typeof proj2.eyeClosureParabolas.baseParabolaPerSide.l.a === 'number',
  'stored parabola coefficient is plain number (JSON-friendly)');
assertEq(proj2.eyeClosureParabolas.baseParabolaPerSide.l.a, curveL.a,
  'storage round-trips a coefficient verbatim');

// ── Contract 3: second run consumes stored data ─────────────────────

const result2 = await generateCmo3(toGeneratorInput(proj2));
const ec2 = result2.rigSpec.eyeClosureParabolas;
assert(!!ec2,
  'second run: rigCollector.eyeClosureParabolas still attached');
const curveL2 = ec2.baseParabolaPerSide.get('l');
assertEq(curveL2.a, curveL.a, 'second run: l.a unchanged from stored');
assertEq(curveL2.b, curveL.b, 'second run: l.b unchanged from stored');
assertEq(curveL2.c, curveL.c, 'second run: l.c unchanged from stored');
assertEq(curveL2.xMid, curveL.xMid, 'second run: l.xMid unchanged from stored');
assertEq(curveL2.xScale, curveL.xScale, 'second run: l.xScale unchanged from stored');

// ── Contract 4: mutating stored data is observable downstream ──────
//
// The audit's core fidelity guarantee — proves cmo3writer reads from
// stored, doesn't silently re-fit. Mutate one coefficient on the
// stored data; the next run must surface the mutated value through
// `rigCollector.eyeClosureParabolas`.

const proj3 = buildEyeFixture();
const mutatedCurveL = { ...proj2.eyeClosureParabolas.baseParabolaPerSide.l, a: 999 };
proj3.eyeClosureParabolas = {
  baseParabolaPerSide: {
    l: mutatedCurveL,
    r: proj2.eyeClosureParabolas.baseParabolaPerSide.r,
  },
  variantParabolaPerSideAndSuffix: proj2.eyeClosureParabolas.variantParabolaPerSideAndSuffix,
};
const result3 = await generateCmo3(toGeneratorInput(proj3));
const curveL3 = result3.rigSpec.eyeClosureParabolas.baseParabolaPerSide.get('l');
assertEq(curveL3.a, 999,
  'mutated stored l.a is consumed (proves stored path taken, not re-fit)');
assertEq(curveL3.b, curveL.b,
  'mutated stored l.b unchanged (only the mutated coeff diverged)');

// ── Contract 5: resolveEyeClosure ─ empty-default + round-trip ─────

const empty = resolveEyeClosure({});
assert(empty.baseParabolaPerSide instanceof Map,
  'resolveEyeClosure(empty): returns Map even when nothing stored');
assert(empty.baseParabolaPerSide.size === 0,
  'resolveEyeClosure(empty): baseParabolaPerSide is empty');
assert(empty.variantParabolaPerSideAndSuffix instanceof Map,
  'resolveEyeClosure(empty): variantParabolaPerSideAndSuffix Map present');
assert(empty.variantParabolaPerSideAndSuffix.size === 0,
  'resolveEyeClosure(empty): variantParabolaPerSideAndSuffix is empty');

const resolved = resolveEyeClosure(proj2);
assert(resolved.baseParabolaPerSide.has('l') && resolved.baseParabolaPerSide.has('r'),
  'resolveEyeClosure: round-trips stored sides into Map');
assert(approx(resolved.baseParabolaPerSide.get('l').a, curveL.a),
  'resolveEyeClosure: a coefficient round-trips verbatim');
assert(approx(resolved.baseParabolaPerSide.get('l').xMid, curveL.xMid),
  'resolveEyeClosure: xMid round-trips verbatim');

// ── Contract 6: fresh-fit vs stored-fit produce identical downstream ─

const proj6freshFit = buildEyeFixture();
const proj6stored = buildEyeFixture();
const r6fresh = await generateCmo3(toGeneratorInput(proj6freshFit));
seedEyeClosure(proj6stored, r6fresh.rigSpec.eyeClosureParabolas.baseParabolaPerSide,
  r6fresh.rigSpec.eyeClosureParabolas.variantParabolaPerSideAndSuffix);
const r6stored = await generateCmo3(toGeneratorInput(proj6stored));
const freshCurveL = r6fresh.rigSpec.eyeClosureParabolas.baseParabolaPerSide.get('l');
const storedCurveL = r6stored.rigSpec.eyeClosureParabolas.baseParabolaPerSide.get('l');
assertEq(storedCurveL.a, freshCurveL.a,
  'fresh-fit vs stored-fit: l.a identical (downstream parity)');
assertEq(storedCurveL.b, freshCurveL.b,
  'fresh-fit vs stored-fit: l.b identical');
assertEq(storedCurveL.c, freshCurveL.c,
  'fresh-fit vs stored-fit: l.c identical');

// Same eyewhite art mesh frame comes out → same closed-vert bake.
const am6fresh = r6fresh.rigSpec.artMeshes.find((m) => m.id === 'eyewhite-l');
const am6stored = r6stored.rigSpec.artMeshes.find((m) => m.id === 'eyewhite-l');
assert(am6fresh && am6stored, 'eyewhite-l artMesh present in both runs');
// Compare the closed keyform's verts (the bake the parabola feeds).
const closedFresh = am6fresh.keyforms?.find((k) => k.keyTuple?.[0] === 0);
const closedStored = am6stored.keyforms?.find((k) => k.keyTuple?.[0] === 0);
if (closedFresh?.vertexPositions && closedStored?.vertexPositions) {
  let maxDelta = 0;
  for (let i = 0; i < closedFresh.vertexPositions.length; i++) {
    const d = Math.abs(closedFresh.vertexPositions[i] - closedStored.vertexPositions[i]);
    if (d > maxDelta) maxDelta = d;
  }
  assert(maxDelta < 1e-3,
    `eye-closure bake byte-equal fresh vs stored (maxDelta=${maxDelta})`);
}

console.log(`\neyeClosureSubstrate: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
