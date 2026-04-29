// v3 Phase 0A — Operator registry + keymap chord tests.
// Dispatcher itself binds `window` listeners which require a DOM —
// covered by Vitest + jsdom (Phase 0E). Here we test the pure pieces.
//
// Run: node scripts/test_v3Operators.mjs

import { getOperator, listOperators, registerOperator } from '../../src/v3/operators/registry.js';
import { DEFAULT_KEYMAP, chordOf } from '../../src/v3/keymap/default.js';
import { useUIV3Store } from '../../src/store/uiV3Store.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

// ── registry: built-ins exist ───────────────────────────────────────

{
  for (const ws of ['layout', 'modeling', 'rigging', 'pose', 'animation']) {
    const op = getOperator(`workspace.set.${ws}`);
    assert(op !== null, `built-in workspace.set.${ws} registered`);
    assert(op.label.includes(ws), `built-in workspace.set.${ws} label OK`);
  }
  assert(getOperator('workspace.reset') !== null, 'built-in workspace.reset registered');
}

// ── registry: duplicate id rejected ─────────────────────────────────

assertThrows(
  () => registerOperator({ id: 'workspace.reset', label: 'dup', exec: () => {} }),
  'duplicate operator id throws',
);

// ── registry: invalid def rejected ──────────────────────────────────

assertThrows(
  () => registerOperator({ label: 'no id', exec: () => {} }),
  'operator without id throws',
);

// ── registry: list returns all ──────────────────────────────────────

{
  const all = listOperators();
  assert(all.length >= 6, 'listOperators returns ≥ 6 (5 workspaces + reset)');
  assert(all.every(o => typeof o.exec === 'function'), 'all ops have exec()');
}

// ── operator exec actually mutates store ────────────────────────────

{
  useUIV3Store.getState().setWorkspace('layout');
  const before = useUIV3Store.getState().activeWorkspace;
  assert(before === 'layout', 'pre-exec: layout');

  getOperator('workspace.set.rigging').exec({ editorType: null });
  assert(useUIV3Store.getState().activeWorkspace === 'rigging', 'exec: switched to rigging');

  getOperator('workspace.set.layout').exec({ editorType: null });
  assert(useUIV3Store.getState().activeWorkspace === 'layout', 'exec: back to layout');
}

// ── keymap: chord builder ───────────────────────────────────────────

{
  const e1 = { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, code: 'KeyZ' };
  assert(chordOf(e1) === 'Ctrl+KeyZ', 'chordOf: Ctrl+KeyZ');

  const e2 = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, code: 'Backspace' };
  assert(chordOf(e2) === 'Ctrl+Shift+Backspace', 'chordOf: canonical modifier order');

  const e3 = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, code: 'KeyA' };
  assert(chordOf(e3) === 'KeyA', 'chordOf: bare key');

  const e4 = { ctrlKey: true, shiftKey: false, altKey: true, metaKey: true, code: 'Tab' };
  assert(chordOf(e4) === 'Ctrl+Alt+Meta+Tab', 'chordOf: skips false modifiers, keeps order');
}

// ── keymap: defaults map to registered operators ────────────────────

{
  for (const [chord, opId] of Object.entries(DEFAULT_KEYMAP)) {
    const op = getOperator(opId);
    assert(op !== null, `keymap[${chord}] → registered op ${opId}`);
  }
}

// ── undo / redo operators ──────────────────────────────────────────

{
  const undoOp = getOperator('app.undo');
  const redoOp = getOperator('app.redo');
  assert(undoOp !== null, 'app.undo registered');
  assert(redoOp !== null, 'app.redo registered');

  // available() honours the empty-history state
  assert(undoOp.available({ editorType: null }) === false,
    'app.undo unavailable on empty history');
  assert(redoOp.available({ editorType: null }) === false,
    'app.redo unavailable on empty history');
}

// ── undo / redo bindings present ───────────────────────────────────

{
  assert(DEFAULT_KEYMAP['Ctrl+KeyZ'] === 'app.undo', 'Ctrl+Z → undo');
  assert(DEFAULT_KEYMAP['Meta+KeyZ'] === 'app.undo', 'Meta+Z → undo (mac)');
  assert(DEFAULT_KEYMAP['Ctrl+Shift+KeyZ'] === 'app.redo', 'Ctrl+Shift+Z → redo');
  assert(DEFAULT_KEYMAP['Ctrl+KeyY'] === 'app.redo', 'Ctrl+Y → redo (windows)');
}

// ── selection.clear / file.new bindings + behavior ─────────────────

{
  assert(DEFAULT_KEYMAP['Escape'] === 'selection.clear', 'Esc → selection.clear');
  assert(DEFAULT_KEYMAP['Ctrl+KeyN'] === 'file.new', 'Ctrl+N → file.new');

  const op = getOperator('selection.clear');
  assert(op !== null, 'selection.clear registered');

  // Empty selection → unavailable
  const { useSelectionStore } = await import('../../src/store/selectionStore.js');
  useSelectionStore.getState().clear();
  assert(op.available({ editorType: null }) === false,
    'selection.clear unavailable when empty');

  useSelectionStore.getState().select({ type: 'part', id: 'p1' });
  assert(op.available({ editorType: null }) === true,
    'selection.clear available after select');

  op.exec({ editorType: null });
  assert(useSelectionStore.getState().items.length === 0,
    'selection.clear empties the store');
}

console.log(`v3Operators: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
