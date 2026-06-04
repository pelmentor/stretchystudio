// Tests for migration v49 — variant `visible:false` → `visible:true, opacity:0`
// (bug-08 closure). Run: node scripts/test/test_migrationV49.mjs

import { migrateVariantVisibleToOpacity } from '../../src/store/migrations/v49_variant_visible_to_opacity.js';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../../src/store/projectMigrations.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

// ── 1. Direct migrator: null / empty / no-nodes are safe no-ops ──────
{
  assert(migrateVariantVisibleToOpacity(null) === null,
    '1: null project returns null safely');
  assert(migrateVariantVisibleToOpacity({}).nodes === undefined,
    '1: empty project safe');
  const p = { nodes: [] };
  eq(JSON.stringify(migrateVariantVisibleToOpacity(p)), JSON.stringify(p),
    '1: empty nodes array is a no-op');
}

// ── 2. Variant with `visible:false` flips to `visible:true, opacity:0` ─
{
  const project = {
    nodes: [
      { id: 'p_smile', type: 'part', variantSuffix: 'smile', variantOf: 'p_face',
        visible: false, mesh: { vertices: [] } },
    ],
  };
  migrateVariantVisibleToOpacity(project);
  eq(project.nodes[0].visible, true, '2: variant.visible flipped to true');
  eq(project.nodes[0].opacity, 0, '2: variant.opacity set to 0');
  eq(project.nodes[0].variantSuffix, 'smile', '2: variantSuffix preserved');
  eq(project.nodes[0].variantOf, 'p_face', '2: variantOf preserved');
}

// ── 3. Variant already at v49 shape (visible:true, opacity:0): no-op ──
{
  const project = {
    nodes: [
      { id: 'p_smile', type: 'part', variantSuffix: 'smile',
        visible: true, opacity: 0 },
    ],
  };
  const before = JSON.stringify(project);
  migrateVariantVisibleToOpacity(project);
  eq(JSON.stringify(project), before, '3: idempotent on v49-shape variant');
}

// ── 4. Variant with visible:undefined (== true by default) + missing opacity ─
//    Forces opacity:0 to match the rest-state contract.
{
  const project = {
    nodes: [
      { id: 'p_smile', type: 'part', variantSuffix: 'smile' /* no visible, no opacity */ },
    ],
  };
  migrateVariantVisibleToOpacity(project);
  eq(project.nodes[0].opacity, 0,
    '4: variant without explicit visible:false still gets opacity:0 enforced');
  assert(project.nodes[0].visible !== false,
    '4: visibility stays at default (undefined === !== false)');
}

// ── 5. Non-variant part with `visible:false` is left alone ───────────
//    The user's explicit hide on a non-variant is honored.
{
  const project = {
    nodes: [
      { id: 'p_face', type: 'part', visible: false, opacity: 1 },
    ],
  };
  const before = JSON.stringify(project);
  migrateVariantVisibleToOpacity(project);
  eq(JSON.stringify(project), before,
    '5: non-variant visible:false is preserved (user intent)');
}

// ── 6. Group node with variantSuffix-like field is left alone ────────
{
  const project = {
    nodes: [
      { id: 'g1', type: 'group', name: 'group_smile', visible: false /* not a part */ },
    ],
  };
  const before = JSON.stringify(project);
  migrateVariantVisibleToOpacity(project);
  eq(JSON.stringify(project), before, '6: type !== part is a no-op');
}

// ── 7. Variant with empty-string variantSuffix is not a real variant ─
{
  const project = {
    nodes: [
      { id: 'p_smile', type: 'part', variantSuffix: '', visible: false },
    ],
  };
  const before = JSON.stringify(project);
  migrateVariantVisibleToOpacity(project);
  eq(JSON.stringify(project), before, '7: empty variantSuffix not migrated');
}

// ── 8. Multiple variants in a single project ─────────────────────────
{
  const project = {
    nodes: [
      { id: 'p_face', type: 'part', visible: true },
      { id: 'p_smile', type: 'part', variantSuffix: 'smile', variantOf: 'p_face', visible: false },
      { id: 'p_frown', type: 'part', variantSuffix: 'frown', variantOf: 'p_face', visible: false },
      { id: 'p_blink', type: 'part', variantSuffix: 'blink', variantOf: 'p_face',
        visible: true, opacity: 0 /* already v49 */ },
    ],
  };
  migrateVariantVisibleToOpacity(project);
  eq(project.nodes[0].visible, true, '8: base p_face untouched');
  eq(project.nodes[0].opacity, undefined, '8: base p_face opacity untouched');
  eq(project.nodes[1].visible, true, '8: p_smile flipped');
  eq(project.nodes[1].opacity, 0, '8: p_smile opacity set');
  eq(project.nodes[2].visible, true, '8: p_frown flipped');
  eq(project.nodes[2].opacity, 0, '8: p_frown opacity set');
  eq(project.nodes[3].visible, true, '8: p_blink stays at v49');
  eq(project.nodes[3].opacity, 0, '8: p_blink opacity stays 0');
}

// ── 9. Full migrateProject: pre-v49 save bumps to current ────────────
{
  const project = {
    schemaVersion: 48,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#fff' },
    textures: [], nodes: [
      { id: 'p_face', type: 'part', visible: true, mesh: { vertices: [] } },
      { id: 'p_smile', type: 'part', variantSuffix: 'smile', variantOf: 'p_face',
        visible: false, mesh: { vertices: [] } },
    ], animations: [], parameters: [], physics_groups: [],
  };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `9: bumps to current (${CURRENT_SCHEMA_VERSION}), got ${project.schemaVersion}`);
  assert(CURRENT_SCHEMA_VERSION >= 49, '9: CURRENT_SCHEMA_VERSION advanced to at least 49');
  eq(project.nodes[1].visible, true, '9: variant.visible flipped');
  eq(project.nodes[1].opacity, 0, '9: variant.opacity set');
}

// ── 10. CURRENT_SCHEMA_VERSION sanity ───────────────────────────────
{
  // Catches drift where the constant in projectSchemaVersion.js is
  // bumped but the corresponding MIGRATIONS[N] entry is never added
  // (or vice versa). Walks one fresh project through migrateProject and
  // asserts the final version matches the constant exactly.
  const project = { schemaVersion: 1 };
  migrateProject(project);
  eq(project.schemaVersion, CURRENT_SCHEMA_VERSION,
    `10: walker reaches CURRENT_SCHEMA_VERSION=${CURRENT_SCHEMA_VERSION}`);
}

console.log(`\nmigrationV49: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
