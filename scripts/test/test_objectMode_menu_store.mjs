// Toolset Plan Phase 7.A — editMenuStore extended kinds.
//
// Verifies the four new openers added for Phase 7.A:
//   - openSnap → kind='snap'
//   - openMirrorAxis → kind='mirrorAxis'
//   - openClearParent → kind='clearParent'
//   - openSetOrigin → kind='setOrigin'
//
// And that close() resets them (sister to existing apply/merge tests).
//
// Run: node scripts/test/test_objectMode_menu_store.mjs

import { useEditMenuStore } from '../../src/store/editMenuStore.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

// 1. openSnap
{
  useEditMenuStore.getState().close();
  useEditMenuStore.getState().openSnap({ cursor: { x: 100, y: 200 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'snap', `kind=snap, got ${s.kind}`);
  assert(s.cursor?.x === 100 && s.cursor?.y === 200, 'cursor set');
  assert(s.canvasCursor === null, 'snap has no canvasCursor');
}

// 2. openMirrorAxis
{
  useEditMenuStore.getState().close();
  useEditMenuStore.getState().openMirrorAxis({ cursor: { x: 1, y: 2 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'mirrorAxis', `kind=mirrorAxis, got ${s.kind}`);
  assert(s.cursor?.x === 1, 'cursor set');
}

// 3. openClearParent
{
  useEditMenuStore.getState().close();
  useEditMenuStore.getState().openClearParent({ cursor: { x: 3, y: 4 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'clearParent', `kind=clearParent, got ${s.kind}`);
  assert(s.cursor?.x === 3, 'cursor set');
}

// 4. openSetOrigin
{
  useEditMenuStore.getState().close();
  useEditMenuStore.getState().openSetOrigin({ cursor: { x: 5, y: 6 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'setOrigin', `kind=setOrigin, got ${s.kind}`);
  assert(s.cursor?.x === 5, 'cursor set');
}

// 5. Switching kinds replaces state (no leak)
{
  useEditMenuStore.getState().openMerge({
    cursor: { x: 10, y: 10 },
    canvasCursor: { x: 100, y: 100 },
  });
  useEditMenuStore.getState().openSnap({ cursor: { x: 20, y: 20 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'snap', 'kind switched to snap');
  assert(s.canvasCursor === null, 'canvasCursor reset on switch');
  assert(s.cursor?.x === 20, 'new cursor');
}

// 6. close() resets across all 6 kinds
{
  for (const opener of ['openMerge', 'openApply', 'openSnap', 'openMirrorAxis', 'openClearParent', 'openSetOrigin']) {
    if (opener === 'openMerge') {
      useEditMenuStore.getState().openMerge({ cursor: { x: 0, y: 0 }, canvasCursor: { x: 0, y: 0 } });
    } else {
      useEditMenuStore.getState()[opener]({ cursor: { x: 0, y: 0 } });
    }
    useEditMenuStore.getState().close();
    const s = useEditMenuStore.getState();
    assert(s.kind === null && s.cursor === null && s.canvasCursor === null,
      `close after ${opener} resets all slots`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
