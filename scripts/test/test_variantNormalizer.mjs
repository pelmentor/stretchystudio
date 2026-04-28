// v3 Phase 0F.16 - tests for src/io/variantNormalizer.js
//
// variantNormalizer is the single source of truth for variant ↔ base
// pairing in the SS data model. After PSD import + rigging, it
// guarantees every `.smile` / `.summer` / etc. variant sits in the
// SAME parent group as its base sibling and renders immediately on
// top via draw_order. Three memory entries warn that bugs here cause
// visible "variant covers base" / "midpoint translucency" problems.
//
// Run: node scripts/test/test_variantNormalizer.mjs

import { normalizeVariants } from '../../src/io/variantNormalizer.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// Suppress orphan warnings during the test run
const originalWarn = console.warn;
console.warn = () => {};

const part = (id, name, parent, drawOrder, extras = {}) => ({
  id, type: 'part', name, parent: parent ?? null,
  draw_order: drawOrder ?? 0,
  ...extras,
});

// ── Defensive ──────────────────────────────────────────────────────

{
  const r = normalizeVariants(null);
  assert(r.pairings.length === 0 && r.orphans.length === 0, 'null project: empty result');
}

{
  const r = normalizeVariants({});
  assert(r.pairings.length === 0 && r.orphans.length === 0, 'empty project: empty result');
}

{
  const r = normalizeVariants({ nodes: [] });
  assert(r.pairings.length === 0 && r.orphans.length === 0, 'empty nodes: empty result');
}

// ── Single base+variant pair ───────────────────────────────────────

{
  const project = {
    nodes: [
      part('m', 'mouth', 'g1', 0),
      part('ms', 'mouth.smile', 'g2', 5),
    ],
  };
  const r = normalizeVariants(project);
  assert(r.pairings.length === 1, 'single pair: 1 pairing');
  assert(r.orphans.length === 0, 'single pair: no orphans');
  assert(project.nodes[1].variantOf === 'm', 'variant.variantOf = base.id');
  assert(project.nodes[1].variantSuffix === 'smile', 'variant.variantSuffix = smile');
  assert(project.nodes[1].parent === 'g1', 'variant reparented to base parent');
  assert(project.nodes[1].draw_order > project.nodes[0].draw_order,
    'variant renumbered above base');
}

// ── Multiple variants of same base stack predictably ──────────────

{
  const project = {
    nodes: [
      part('m',  'mouth',         'g', 0),
      part('mc', 'mouth.cry',     'g', 1),  // lower draw_order
      part('ms', 'mouth.smile',   'g', 9),
    ],
  };
  const r = normalizeVariants(project);
  assert(r.pairings.length === 2, '2 variants → 2 pairings');
  // Both reparented (already on g, no-op)
  assert(project.nodes[1].variantOf === 'm', 'cry: variantOf set');
  assert(project.nodes[2].variantOf === 'm', 'smile: variantOf set');
  // Variants stack in their existing relative order (cry was below smile)
  assert(project.nodes[1].draw_order < project.nodes[2].draw_order,
    'sibling variant order preserved (cry < smile)');
}

// ── Orphan variant (no base) ───────────────────────────────────────

{
  const project = {
    nodes: [
      part('o', 'orphan.smile', 'g', 0),
    ],
  };
  const r = normalizeVariants(project);
  assert(r.pairings.length === 0, 'orphan: no pairings');
  assert(r.orphans.length === 1, 'orphan: counted');
  assert(!('variantOf' in project.nodes[0]), 'orphan: no variantOf written');
}

// ── Stale variant fields cleared when name no longer matches ──────

{
  const project = {
    nodes: [
      part('a', 'plain', null, 0, { variantOf: 'b', variantSuffix: 'old' }),
      part('b', 'other', null, 1),
    ],
  };
  normalizeVariants(project);
  assert(!('variantOf' in project.nodes[0]),
    'stale variantOf cleared when name has no variant suffix');
  assert(!('variantSuffix' in project.nodes[0]), 'stale variantSuffix cleared');
}

// ── Reparenting moves variant under base's parent ──────────────────

{
  const project = {
    nodes: [
      part('b',  'base',        'parentA', 0),
      part('v',  'base.smile',  'parentB', 1), // wrong parent before
    ],
  };
  normalizeVariants(project);
  assert(project.nodes[1].parent === 'parentA', 'variant reparented to base parent');
}

// ── Idempotence ────────────────────────────────────────────────────

{
  const project = {
    nodes: [
      part('m', 'mouth', 'g', 0),
      part('ms', 'mouth.smile', 'g', 1),
    ],
  };
  normalizeVariants(project);
  const after1 = JSON.stringify(project.nodes);
  normalizeVariants(project);
  const after2 = JSON.stringify(project.nodes);
  assert(after1 === after2, 'idempotent: 2nd call is no-op');
}

// ── Full draw_order renumbering scope ──────────────────────────────

{
  // Three plain parts + one variant; final draw_orders should be
  // consecutive integers starting at 0, with the variant placed
  // immediately after its base.
  const project = {
    nodes: [
      part('a',  'a',           null, 0),
      part('m',  'mouth',       null, 1),
      part('z',  'z',           null, 2),
      part('ms', 'mouth.smile', null, 3),
    ],
  };
  normalizeVariants(project);
  // After normalize: orders should be {a:0, mouth:1, mouth.smile:2, z:3}
  // because mouth.smile gets fractional 1.001 → after sort it's between m and z.
  const a  = project.nodes.find(n => n.id === 'a');
  const m  = project.nodes.find(n => n.id === 'm');
  const ms = project.nodes.find(n => n.id === 'ms');
  const z  = project.nodes.find(n => n.id === 'z');
  assert(a.draw_order === 0, 'renumber: a → 0');
  assert(m.draw_order === 1, 'renumber: mouth → 1');
  assert(ms.draw_order === 2, 'renumber: mouth.smile → 2 (immediately after base)');
  assert(z.draw_order === 3, 'renumber: z → 3');
}

// ── Case-insensitive name match for base lookup ───────────────────

{
  const project = {
    nodes: [
      part('m',  'Mouth',         null, 0), // base name capitalised
      part('ms', 'mouth.smile',   null, 1),
    ],
  };
  const r = normalizeVariants(project);
  assert(r.pairings.length === 1, 'case-insensitive base match: paired');
  assert(project.nodes[1].variantOf === 'm', 'matched against capitalised base');
}

// ── Visible/meshed candidate preferred when multiple bases exist ──

{
  const project = {
    nodes: [
      part('m1', 'mouth', null, 0, { visible: false }),
      part('m2', 'mouth', null, 1, { visible: true, mesh: {} }),
      part('ms', 'mouth.smile', null, 2),
    ],
  };
  const r = normalizeVariants(project);
  assert(r.pairings.length === 1, 'duplicate-name bases: still 1 pairing');
  assert(project.nodes[2].variantOf === 'm2',
    'duplicate-name bases: visible+meshed preferred over hidden');
}

console.warn = originalWarn;

console.log(`variantNormalizer: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
