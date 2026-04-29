// v3 Phase 1A - tests for src/v3/editors/outliner/filters.js
// Run: node scripts/test/test_outlinerFilters.mjs

import { buildOutlinerTree, walkOutlinerTree } from '../../src/v3/editors/outliner/treeBuilder.js';
import { filterOutlinerTree } from '../../src/v3/editors/outliner/filters.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function fixture() {
  return [
    { id: 'back',  type: 'part',  name: 'Back',  parent: null,   draw_order: 0 },
    { id: 'body',  type: 'group', name: 'Body',  parent: null },
    { id: 'torso', type: 'part',  name: 'Torso', parent: 'body', draw_order: 10 },
    { id: 'head',  type: 'group', name: 'Head',  parent: 'body' },
    { id: 'eye_l', type: 'part',  name: 'EyeL',  parent: 'head', draw_order: 20 },
    { id: 'eye_r', type: 'part',  name: 'EyeR',  parent: 'head', draw_order: 21 },
    { id: 'front', type: 'part',  name: 'Front', parent: null,   draw_order: 30 },
  ];
}

// ── Empty / passthrough ────────────────────────────────────────────

{
  const tree = buildOutlinerTree(fixture());
  assert(filterOutlinerTree(tree, '').length === tree.length, 'empty query → unchanged');
  assert(filterOutlinerTree(tree, '   ').length === tree.length, 'whitespace query → unchanged');
  assert(filterOutlinerTree(tree, null).length === tree.length, 'null query → unchanged');
  assert(filterOutlinerTree(tree, undefined).length === tree.length, 'undefined query → unchanged');
}

// ── Self-match retains row ─────────────────────────────────────────

{
  const tree = buildOutlinerTree(fixture());
  const filtered = filterOutlinerTree(tree, 'back');
  // Only 'Back' matches; no children kept; no other roots kept.
  const ids = [];
  walkOutlinerTree(filtered, (n) => ids.push(n.id));
  assert(ids.length === 1 && ids[0] === 'back', 'single self-match');
}

// ── Descendant match keeps ancestors ───────────────────────────────

{
  const tree = buildOutlinerTree(fixture());
  const filtered = filterOutlinerTree(tree, 'eyeL');
  const ids = [];
  walkOutlinerTree(filtered, (n) => ids.push(n.id));
  // Match is 'eye_l'; ancestors body + head should be kept (so user
  // sees where the match sits). eye_r should be dropped.
  assert(ids.includes('eye_l'), 'descendant match present');
  assert(ids.includes('head'), 'parent of match kept');
  assert(ids.includes('body'), 'grandparent of match kept');
  assert(!ids.includes('eye_r'), 'sibling not matching dropped');
  assert(!ids.includes('torso'), 'sibling not matching dropped (torso under body)');
  assert(!ids.includes('front'), 'unrelated root dropped');
  assert(!ids.includes('back'), 'unrelated root dropped (back)');
}

// ── Case-insensitive ───────────────────────────────────────────────

{
  const tree = buildOutlinerTree(fixture());
  const lower = filterOutlinerTree(tree, 'eye');
  const upper = filterOutlinerTree(tree, 'EYE');
  const mixed = filterOutlinerTree(tree, 'eYe');
  const idsLower = [];
  walkOutlinerTree(lower, (n) => idsLower.push(n.id));
  const idsUpper = [];
  walkOutlinerTree(upper, (n) => idsUpper.push(n.id));
  const idsMixed = [];
  walkOutlinerTree(mixed, (n) => idsMixed.push(n.id));
  assert(JSON.stringify(idsLower) === JSON.stringify(idsUpper),
    'case-insensitive: lower === upper');
  assert(JSON.stringify(idsLower) === JSON.stringify(idsMixed),
    'case-insensitive: lower === mixed');
  // Both eye_l and eye_r match
  assert(idsLower.includes('eye_l') && idsLower.includes('eye_r'),
    'both EyeL + EyeR match "eye"');
}

// ── ID fallback when name is empty ─────────────────────────────────

{
  const tree = buildOutlinerTree([
    { id: 'special-id', type: 'part', name: '', parent: null, draw_order: 0 },
    { id: 'normal', type: 'part', name: 'Normal', parent: null, draw_order: 1 },
  ]);
  const filtered = filterOutlinerTree(tree, 'special');
  const ids = [];
  walkOutlinerTree(filtered, (n) => ids.push(n.id));
  assert(ids.includes('special-id'), 'fallback: id matches when name empty');
  assert(!ids.includes('normal'), 'no name match');
}

// ── No matches → empty result ──────────────────────────────────────

{
  const tree = buildOutlinerTree(fixture());
  const filtered = filterOutlinerTree(tree, 'zzz-no-match');
  assert(filtered.length === 0, 'no match → empty');
}

// ── Output ─────────────────────────────────────────────────────────

console.log(`outlinerFilters: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
