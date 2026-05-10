// Toolset Plan Phase 6.C — Apply menu store + edit-menu kind dispatch.
//
// Verifies `editMenuStore.openApply(...)` + the popover state model
// shared with Merge:
//   - openApply sets kind='apply' + cursor; clears canvasCursor.
//   - openMerge sets kind='merge' + cursor + canvasCursor.
//   - close() resets all three slots.
//   - Successive opens replace state (no leak from prior open).
//
// Run: node scripts/test/test_apply_menu_store.mjs

import { useEditMenuStore } from '../../src/store/editMenuStore.js';
import { useCircleSelectStore } from '../../src/store/circleSelectStore.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}

// 1. Initial state: nothing open.
{
  const s = useEditMenuStore.getState();
  s.close();
  const s2 = useEditMenuStore.getState();
  assert(s2.kind === null, 'initial kind=null');
  assert(s2.cursor === null, 'initial cursor=null');
  assert(s2.canvasCursor === null, 'initial canvasCursor=null');
}

// 2. openApply sets kind=apply + cursor.
{
  useEditMenuStore.getState().openApply({ cursor: { x: 100, y: 200 } });
  const s = useEditMenuStore.getState();
  assert(s.kind === 'apply', `kind=apply, got ${s.kind}`);
  assert(s.cursor?.x === 100 && s.cursor?.y === 200,
    `cursor = (100,200), got ${JSON.stringify(s.cursor)}`);
  assert(s.canvasCursor === null,
    `apply doesn't set canvasCursor, got ${JSON.stringify(s.canvasCursor)}`);
}

// 3. close() resets.
{
  useEditMenuStore.getState().close();
  const s = useEditMenuStore.getState();
  assert(s.kind === null && s.cursor === null && s.canvasCursor === null,
    'close() resets all slots');
}

// 4. openMerge then openApply replaces state (no leftover canvasCursor).
{
  useEditMenuStore.getState().openMerge({
    cursor: { x: 10, y: 10 },
    canvasCursor: { x: 100, y: 100 },
  });
  let s = useEditMenuStore.getState();
  assert(s.kind === 'merge' && s.canvasCursor !== null,
    'merge open with canvasCursor set');
  useEditMenuStore.getState().openApply({ cursor: { x: 20, y: 20 } });
  s = useEditMenuStore.getState();
  assert(s.kind === 'apply', 'kind switched to apply');
  assert(s.canvasCursor === null,
    `apply replaces canvasCursor with null, got ${JSON.stringify(s.canvasCursor)}`);
  assert(s.cursor?.x === 20 && s.cursor?.y === 20,
    `apply has new cursor, got ${JSON.stringify(s.cursor)}`);
}

// 5. openMerge with no canvasCursor defaults to null.
{
  useEditMenuStore.getState().close();
  useEditMenuStore.getState().openMerge({
    cursor: { x: 5, y: 5 },
    canvasCursor: null,
  });
  const s = useEditMenuStore.getState();
  assert(s.canvasCursor === null, 'openMerge with null canvasCursor → null');
}

// ── circleSelectStore sanity ─────────────────────────────────────

// 6. Initial: not active.
{
  useCircleSelectStore.getState().cancel();
  const s = useCircleSelectStore.getState();
  assert(s.active === false, 'initial active=false');
  assert(s.painting === false, 'initial painting=false');
}

// 7. begin sets active + mode + editPartId + cursor.
{
  useCircleSelectStore.getState().begin({
    mode: 'edit',
    editPartId: 'p1',
    cursorClient: { x: 50, y: 60 },
  });
  const s = useCircleSelectStore.getState();
  assert(s.active === true, 'begin → active');
  assert(s.mode === 'edit', `mode=edit, got ${s.mode}`);
  assert(s.editPartId === 'p1', `editPartId=p1, got ${s.editPartId}`);
  assert(s.cursorClient?.x === 50, 'cursor set');
  assert(s.painting === false, 'begin doesn\'t auto-paint');
}

// 8. setRadius clamps min/max.
{
  useCircleSelectStore.getState().setRadius(2);  // below MIN_RADIUS_PX=4
  let s = useCircleSelectStore.getState();
  assert(s.radiusPx === 4, `min clamp to 4, got ${s.radiusPx}`);
  useCircleSelectStore.getState().setRadius(9999);  // above MAX=512
  s = useCircleSelectStore.getState();
  assert(s.radiusPx === 512, `max clamp to 512, got ${s.radiusPx}`);
  useCircleSelectStore.getState().setRadius(64);
  s = useCircleSelectStore.getState();
  assert(s.radiusPx === 64, 'normal value passes through');
}

// 9. startPaint / endPaint state transitions.
{
  useCircleSelectStore.getState().startPaint('subtract');
  let s = useCircleSelectStore.getState();
  assert(s.painting === true && s.paintMode === 'subtract',
    `startPaint sets painting + mode, got painting=${s.painting} paintMode=${s.paintMode}`);
  useCircleSelectStore.getState().endPaint();
  s = useCircleSelectStore.getState();
  assert(s.painting === false && s.paintMode === null,
    `endPaint clears, got painting=${s.painting} paintMode=${s.paintMode}`);
  // Active should still be true (endPaint doesn't exit modal).
  assert(s.active === true, 'endPaint stays modal');
}

// 10. cancel clears everything.
{
  useCircleSelectStore.getState().cancel();
  const s = useCircleSelectStore.getState();
  assert(s.active === false, 'cancel → not active');
  assert(s.mode === null, 'cancel → mode null');
  assert(s.editPartId === null, 'cancel → editPartId null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
