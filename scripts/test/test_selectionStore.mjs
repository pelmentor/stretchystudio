// v3 Phase 0A — selectionStore tests.
// Run: node scripts/test_selectionStore.mjs

import { useSelectionStore } from '../../src/store/selectionStore.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function get() { return useSelectionStore.getState(); }

function reset() {
  get().clear();
}

const partA = { type: 'part', id: 'a' };
const partB = { type: 'part', id: 'b' };
const paramX = { type: 'parameter', id: 'x' };

// ── Initial empty ───────────────────────────────────────────────────

{
  reset();
  assert(get().items.length === 0, 'initial selection empty');
  assert(get().getActive() === null, 'getActive null when empty');
}

// ── replace ─────────────────────────────────────────────────────────

{
  reset();
  get().select(partA);
  assert(get().items.length === 1, 'replace: 1 item');
  assert(get().items[0].id === 'a', 'replace: item is partA');
  assert(get().getActive().id === 'a', 'replace: active = partA');

  get().select(partB);
  assert(get().items.length === 1, 'replace: still 1 item after second replace');
  assert(get().items[0].id === 'b', 'replace: replaced with partB');
}

// ── add ─────────────────────────────────────────────────────────────

{
  reset();
  get().select(partA);
  get().select(partB, 'add');
  assert(get().items.length === 2, 'add: 2 items');
  assert(get().getActive().id === 'b', 'add: active = last added');

  // Adding an existing item moves it to active position
  get().select(partA, 'add');
  assert(get().items.length === 2, 'add existing: still 2 items (deduped)');
  assert(get().getActive().id === 'a', 'add existing: now active');
}

// ── toggle ──────────────────────────────────────────────────────────

{
  reset();
  get().select(partA, 'toggle');
  assert(get().items.length === 1, 'toggle on empty: adds');
  get().select(partA, 'toggle');
  assert(get().items.length === 0, 'toggle on selected: removes');

  get().select(partA);
  get().select(partB, 'toggle');
  assert(get().items.length === 2, 'toggle adds second');
  get().select(partA, 'toggle');
  assert(get().items.length === 1, 'toggle removes first');
  assert(get().items[0].id === 'b', 'toggle leaves remaining');
}

// ── isSelected / cross-type ─────────────────────────────────────────

{
  reset();
  get().select([partA, paramX], 'replace');
  assert(get().isSelected(partA), 'isSelected partA');
  assert(get().isSelected(paramX), 'isSelected paramX');
  assert(!get().isSelected(partB), 'partB not selected');
  // Same id, different type → not selected
  assert(!get().isSelected({ type: 'group', id: 'a' }), 'cross-type id collision rejected');
}

// ── extend (caller-resolved range) ──────────────────────────────────

{
  reset();
  get().select([partA, partB, paramX], 'extend');
  assert(get().items.length === 3, 'extend: 3 items');
  assert(get().getActive().id === 'x', 'extend: last is active');
}

// ── clear ───────────────────────────────────────────────────────────

{
  get().select([partA, partB], 'replace');
  get().clear();
  assert(get().items.length === 0, 'clear: empty');
}

console.log(`selectionStore: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
