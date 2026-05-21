// Phase 3a — depgraph parity for warps-as-Lattice-objects (v43).
//
// The depgraph relation/eval passes (build.js, kernels/artMesh.js,
// kernels/geometry.js, modifierTypeInfo.js) used to key warp modifiers on
// `mod.deformerId`. After the v43 flip a warp modifier is
// `{type:'lattice', objectId}` (no deformerId), so those sites now resolve
// via `modifierRefId`. This test proves:
//   1. PARITY — a part deformed by a legacy `{type:'warp', deformerId}`
//      modifier produces byte-identical depgraph output to the SAME project
//      migrated to the lattice shape (`migrateLatticeSubstrate`).
//   2. PER-PART DISABLE — disabling a lattice modifier changes the output
//      (proves the modifier is actually wired + honored, not silently
//      skipped as it was pre-fix).
//
// Run: node scripts/test/test_depgraph_lattice.mjs

import { buildDepGraph } from '../../src/anim/depgraph/build.js';
import { evalDepGraph } from '../../src/anim/depgraph/eval.js';
import { migrateLatticeSubstrate } from '../../src/store/migrations/v43_lattice_substrate.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function evalPartOutputs(project) {
  const graph = buildDepGraph(project, {});
  const ctx = evalDepGraph(graph, { project, timeMs: 0, paramOverrides: new Map() });
  const out = {};
  for (const [name, value] of ctx.outputs) {
    if (name.includes('p/GEOMETRY/GEOMETRY_EVAL_DEFORMED')) {
      out.geometry = value?.positions ? Array.from(value.positions) : null;
      out.trace = value?.modifierTrace ?? null;
    }
    if (name.includes('p/GEOMETRY/ART_MESH_EVAL')) {
      out.artMesh = value?.vertexPositions ? Array.from(value.vertexPositions) : null;
    }
  }
  return out;
}

// A root warp with a non-trivial keyform grid (shifts the right edge),
// + a part whose verts ride it via an explicit warp modifier.
function makeLegacyProject(warpEnabled = true) {
  return {
    canvas: { width: 100, height: 100, x: 0, y: 0 },
    parameters: [],
    nodes: [
      { id: 'W', type: 'deformer', deformerKind: 'warp', parent: null,
        gridSize: { rows: 1, cols: 1 },
        baseGrid: [0, 0, 100, 0, 0, 100, 100, 100],
        localFrame: 'canvas-px',
        bindings: [],
        keyforms: [{ keyTuple: [], positions: [0, 0, 130, 0, 0, 100, 130, 100], opacity: 1 }],
        isQuadTransform: false },
      { id: 'p', type: 'part', name: 'p',
        rigParent: 'W',
        mesh: {
          vertices: [25, 25, 75, 75], uvs: [], triangles: [],
          runtime: {
            parent: { type: 'warp', id: 'W' },
            bindings: [],
            keyforms: [{ keyTuple: [], vertexPositions: [25, 25, 75, 75], opacity: 1 }],
          },
        },
        modifiers: [{ type: 'warp', deformerId: 'W', enabled: warpEnabled }] },
    ],
    animations: [], physicsRules: [],
  };
}

// ---- 1. PARITY: legacy vs migrated-to-lattice produce identical output ----
{
  const legacy = makeLegacyProject(true);
  const lattice = clone(legacy);
  migrateLatticeSubstrate(lattice);

  // Sanity: the migration actually flipped the warp + modifier.
  const wObj = lattice.nodes.find((n) => n.id === 'W');
  assert(wObj?.type === 'object' && wObj?.objectKind === 'lattice',
    'migration: W is a lattice object');
  const cage = lattice.nodes.find((n) => n.id === 'W__cage');
  assert(!!cage && cage.type === 'meshData', 'migration: cage meshData present');
  const pMod = lattice.nodes.find((n) => n.id === 'p')?.modifiers?.[0];
  assert(pMod?.type === 'lattice' && pMod?.objectId === 'W',
    'migration: part modifier is {type:lattice, objectId:W}');

  const a = evalPartOutputs(legacy);
  const b = evalPartOutputs(lattice);

  assert(Array.isArray(a.geometry) && Array.isArray(b.geometry),
    'both produce GEOMETRY_EVAL_DEFORMED positions');
  assert(JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
    `GEOMETRY parity legacy==lattice (a=${JSON.stringify(a.geometry)} b=${JSON.stringify(b.geometry)})`);
  // ART_MESH_EVAL is the live deform path; it must match too.
  assert(JSON.stringify(a.artMesh) === JSON.stringify(b.artMesh),
    `ART_MESH parity legacy==lattice (a=${JSON.stringify(a.artMesh)} b=${JSON.stringify(b.artMesh)})`);
  // The warp must actually have deformed something (else the test is vacuous).
  assert(JSON.stringify(b.artMesh) !== JSON.stringify([25, 25, 75, 75]),
    'lattice warp actually deformed the part verts (non-vacuous)');

  // The lattice modifier is applied in the geometry trace (not skipped as
  // "missing deformer ref" / "unknown type").
  const applied = (b.trace ?? []).find((t) => t.deformerId === 'W');
  assert(applied && applied.applied === true,
    'lattice modifier traced as applied (not skipped)');
}

// ---- 2. PER-PART DISABLE: disabling the lattice modifier changes output ----
{
  const enabled = clone(makeLegacyProject(true));
  migrateLatticeSubstrate(enabled);
  const disabled = clone(makeLegacyProject(false));
  migrateLatticeSubstrate(disabled);
  // Confirm the migrated modifier carried the enabled:false through.
  const dMod = disabled.nodes.find((n) => n.id === 'p')?.modifiers?.[0];
  assert(dMod?.type === 'lattice' && dMod?.enabled === false,
    'migration preserved enabled:false on the lattice modifier');

  const e = evalPartOutputs(enabled);
  const d = evalPartOutputs(disabled);
  assert(JSON.stringify(e.artMesh) !== JSON.stringify(d.artMesh),
    'disabling the lattice modifier yields different deformed output (honored, not skipped)');
}

console.log(`depgraph_lattice: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
