// Tests for src/store/migrations/v21_modifier_mode_flags.js.
// Run: node scripts/test/test_migration_v21.mjs
// Exits non-zero on first failure.

import {
  CURRENT_SCHEMA_VERSION,
  migrateProject,
} from '../../src/store/projectMigrations.js';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
  DEFAULT_MIGRATED_MODE,
  findInnermostBodyWarpId,
  migrateModifierModeFlags,
} from '../../src/store/migrations/v21_modifier_mode_flags.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ----- Mode bitmask values match DNA -----

assertEq(MODIFIER_MODE_REALTIME, 1 << 0, 'mode REALTIME = 1<<0 (DNA:131)');
assertEq(MODIFIER_MODE_RENDER,   1 << 1, 'mode RENDER = 1<<1 (DNA:132)');
assertEq(MODIFIER_MODE_EDITMODE, 1 << 2, 'mode EDITMODE = 1<<2 (DNA:133)');
assertEq(DEFAULT_MIGRATED_MODE, MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER,
  'default = REALTIME|RENDER (no EDITMODE — pre-v21 didn\'t eval in mesh-edit)');

// ----- Existing modifier records get flags back-filled -----

{
  const project = {
    nodes: [
      {
        id: 'face',
        type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'FaceParallaxWarp', enabled: true },
          { type: 'rotation', deformerId: 'FaceRotation', enabled: true },
        ],
      },
    ],
  };
  migrateModifierModeFlags(project);
  const m = project.nodes[0].modifiers;
  assertEq(m[0].mode, DEFAULT_MIGRATED_MODE, 'v21: face[0] mode back-filled');
  assertEq(m[0].enabled, true,                'v21: face[0] enabled preserved');
  assertEq(m[0].showInEditor, true,           'v21: face[0] showInEditor back-filled');
  assertEq(m[1].mode, DEFAULT_MIGRATED_MODE, 'v21: face[1] mode back-filled');
}

// ----- Pre-existing numeric `mode` is NOT overwritten -----

{
  const project = {
    nodes: [
      {
        id: 'face',
        type: 'part',
        modifiers: [
          { type: 'warp', deformerId: 'X', enabled: true, mode: MODIFIER_MODE_RENDER },
        ],
      },
    ],
  };
  migrateModifierModeFlags(project);
  assertEq(project.nodes[0].modifiers[0].mode, MODIFIER_MODE_RENDER,
    'v21: pre-existing mode preserved (idempotent)');
}

// ----- Synthetic body-warp insert when stack is empty AND chain exists -----

{
  const project = {
    nodes: [
      // Body warp chain: BodyZ → BodyY → Breath → BodyX (BodyX is leaf).
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      // Part with no rigParent — today rides body chain implicitly.
      { id: 'shirt', type: 'part' },
    ],
  };
  assertEq(findInnermostBodyWarpId(project), 'BodyXWarp',
    'innermost = BodyXWarp (chain leaf with no body-warp child)');
  migrateModifierModeFlags(project);
  const stack = project.nodes.find((n) => n.id === 'shirt').modifiers;
  assert(Array.isArray(stack) && stack.length === 1,
    'v21: synthetic body-warp inserted on empty stack');
  assertEq(stack[0].deformerId, 'BodyXWarp', 'synthetic targets innermost');
  assertEq(stack[0].type, 'warp',           'synthetic type=warp');
  assertEq(stack[0].synthetic, true,        'synthetic carries marker flag');
  assertEq(stack[0].mode, DEFAULT_MIGRATED_MODE, 'synthetic mode = REALTIME|RENDER');
}

// ----- 3-spec body chain (no BodyX) — Breath becomes innermost -----

{
  const project = {
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY' },
      { id: 'shirt', type: 'part' },
    ],
  };
  assertEq(findInnermostBodyWarpId(project), 'BreathWarp',
    '3-spec chain: innermost = Breath (no BodyX)');
  migrateModifierModeFlags(project);
  assertEq(project.nodes.find((n) => n.id === 'shirt').modifiers[0].deformerId,
    'BreathWarp', 'synthetic targets Breath when no BodyX');
}

// ----- No body-warp chain → empty stack stays empty -----

{
  const project = {
    nodes: [{ id: 'rogue', type: 'part' }],
  };
  assertEq(findInnermostBodyWarpId(project), null,
    'no body-warp chain → null innermost');
  migrateModifierModeFlags(project);
  assertEq(project.nodes[0].modifiers, undefined,
    'no chain: empty stack stays empty (no synthetic insert)');
}

// ----- Non-empty stack ignores synthetic insert path -----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      {
        id: 'face',
        type: 'part',
        modifiers: [{ type: 'warp', deformerId: 'FaceParallaxWarp', enabled: true }],
      },
    ],
  };
  migrateModifierModeFlags(project);
  const stack = project.nodes.find((n) => n.id === 'face').modifiers;
  assertEq(stack.length, 1, 'face: non-empty stack stays length 1');
  assertEq(stack[0].deformerId, 'FaceParallaxWarp', 'face: original deformer preserved');
  assert(!stack[0].synthetic, 'face: not marked synthetic');
}

// ----- Idempotency: re-run produces no new synthetic entries -----

{
  const project = {
    nodes: [
      { id: 'BodyXWarp', type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'shirt', type: 'part' },
    ],
  };
  migrateModifierModeFlags(project);
  const beforeLen = project.nodes.find((n) => n.id === 'shirt').modifiers.length;
  migrateModifierModeFlags(project);
  const afterLen = project.nodes.find((n) => n.id === 'shirt').modifiers.length;
  assertEq(beforeLen, 1, 'idempotency: first run inserted 1 synthetic');
  assertEq(afterLen,  1, 'idempotency: second run did not duplicate');
}

// ----- End-to-end via migrateProject (v0 → CURRENT_SCHEMA_VERSION) -----

{
  const project = {
    nodes: [
      { id: 'BodyWarpZ',  type: 'deformer', deformerKind: 'warp', parent: null },
      { id: 'BodyWarpY',  type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpZ' },
      { id: 'BreathWarp', type: 'deformer', deformerKind: 'warp', parent: 'BodyWarpY' },
      { id: 'BodyXWarp',  type: 'deformer', deformerKind: 'warp', parent: 'BreathWarp' },
      // Part with rigParent → gets stack from v20, then mode flags from v21.
      { id: 'face', type: 'part', rigParent: 'BodyXWarp',
        mesh: { vertices: [], uvs: [], triangles: [] } },
      // Part WITHOUT rigParent → empty stack from v20, synthetic from v21.
      { id: 'shirt', type: 'part',
        mesh: { vertices: [], uvs: [], triangles: [] } },
    ],
  };
  migrateProject(project);
  assertEq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    'v0→current: schemaVersion = CURRENT_SCHEMA_VERSION');
  const face = project.nodes.find((n) => n.id === 'face');
  const shirt = project.nodes.find((n) => n.id === 'shirt');
  assert(Array.isArray(face.modifiers) && face.modifiers.length === 4,
    'e2e: face stack length = 4 (BodyX → Breath → BodyY → BodyZ chain)');
  assertEq(face.modifiers[0].mode, DEFAULT_MIGRATED_MODE,
    'e2e: face[0] mode = REALTIME|RENDER');
  // v43 — warp modifiers become lattice modifiers that reference the cage
  // object via `objectId` (not `deformerId`).
  assertEq(face.modifiers[0].objectId, 'BodyXWarp',
    'e2e: face[0] = BodyXWarp (leaf-first iteration)');
  assertEq(face.modifiers[3].objectId, 'BodyWarpZ',
    'e2e: face[3] = BodyWarpZ (root last)');
  assert(!face.modifiers[0].synthetic, 'e2e: face[0] NOT marked synthetic');
  assert(Array.isArray(shirt.modifiers) && shirt.modifiers.length === 1,
    'e2e: shirt got synthetic body-warp');
  assertEq(shirt.modifiers[0].synthetic, true,
    'e2e: shirt modifier marked synthetic');
}

// ----- Result -----

console.log(`migration_v21: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
