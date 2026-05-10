// Toolset Plan Phase 6 audit-fix sweep — regression pins.
//
// Verifies the audit-fix sweep landed correctly. Each test pins one
// specific gap from `AUDIT_2026_05_10_TOOLSET_PHASE6_ARCH.md` or
// `AUDIT_2026_05_10_TOOLSET_PHASE6_BLENDER.md` so a future regression
// re-introducing the bug fails this suite.
//
// Run: node scripts/test/test_audit_fixes_2026_05_10_phase6.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}`);
}
function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

// ─── G-1 — apply.armatureModifier exec is no longer async ───────────
{
  const regSrc = read('src/v3/operators/registry.js');
  // Eager static import lives at the top of the file.
  assert(/import \{ applyArmatureModifier \} from '\.\.\/\.\.\/services\/ArmatureModifierService\.js';/.test(regSrc),
    'G-1: registry eagerly imports applyArmatureModifier');
  // The dynamic await import is gone.
  assert(!/await import\(['"]\.\.\/\.\.\/services\/ArmatureModifierService\.js/.test(regSrc),
    'G-1: dynamic await import removed');
  // The exec for apply.armatureModifier is no longer declared async.
  // Conservative regex: find the operator block by id and check that its
  // exec is not declared `async`.
  const block = /id:\s*'apply\.armatureModifier'[\s\S]{0,2000}?exec:\s*(\w+)?\s*\(/.exec(regSrc);
  assert(block, 'G-1: apply.armatureModifier block found');
  if (block) {
    assert(block[1] !== 'async', `G-1: exec is sync (got modifier "${block[1] ?? '<none>'}")`);
  }
  // Audit-fix banner mentions G-1.
  assert(/Audit fix G-1/.test(regSrc), 'G-1: registry banner cites fix');
}

// ─── G-2 — apply.poseAsRest gates on editMode !== 'animation' ───────
{
  const regSrc = read('src/v3/operators/registry.js');
  const block = /id:\s*'apply\.poseAsRest'[\s\S]{0,2500}?exec:/.exec(regSrc);
  assert(block, 'G-2: apply.poseAsRest block found');
  if (block) {
    assert(/editor\.editMode\s*===\s*['"]animation['"]/.test(block[0])
      && /return false/.test(block[0]),
      'G-2: available() refuses op when editMode === "animation"');
  }
  assert(/Audit fix G-2/.test(regSrc), 'G-2: registry banner cites fix');
}

// ─── G-3 — CircleSelectOverlay caches worldMatrices across paint ─────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  // Cache refs declared
  assert(/worldMatricesRef\s*=\s*useRef/.test(overlay),
    'G-3: worldMatricesRef declared');
  assert(/cachedProjectRef\s*=\s*useRef/.test(overlay),
    'G-3: cachedProjectRef declared');
  // Caches populated at stroke-start
  assert(/computeWorldMatrices\(cachedProjectRef\.current\.nodes\)/.test(overlay),
    'G-3: stroke-start populates worldMatrices cache');
  // runPaintTick reads the cached refs
  assert(/worldMatricesRef\?\.current/.test(overlay),
    'G-3: runPaintTick reads worldMatrices via ref');
  // Caches cleared at stroke-end
  assert(/worldMatricesRef\.current\s*=\s*null[\s\S]{0,300}cachedProjectRef\.current\s*=\s*null/.test(overlay),
    'G-3: stroke-end clears caches');
  assert(/Audit fix G-3/.test(overlay), 'G-3: overlay banner cites fix');
}

// ─── G-4 — CircleSelectOverlay swallows operator chords ─────────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  assert(/Audit fix G-4/.test(overlay), 'G-4: overlay banner cites fix');
  // The onKeyDown handler MUST contain a catch-all stopPropagation
  // outside of any specific-key branch. We verify by extracting the
  // onKeyDown block and confirming it has more than one
  // `e.stopPropagation()` call (one per explicit branch + the catch-all).
  // Use a stop-anchor: the next `function` keyword or end-of-effect.
  const start = overlay.indexOf('function onKeyDown(e)');
  assert(start >= 0, 'G-4: onKeyDown found');
  if (start >= 0) {
    // Slice 2 KB ahead — generous bound for the handler body.
    const slice = overlay.slice(start, start + 2000);
    const stopPropCount = (slice.match(/e\.stopPropagation\(\)/g) || []).length;
    assert(stopPropCount >= 3,
      `G-4: onKeyDown has ≥3 stopPropagation() calls (Esc/Enter, C-toggle, catch-all), got ${stopPropCount}`);
  }
}

// ─── G-5 — onContextMenu calls stopPropagation ──────────────────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  const ctx = /function onContextMenu\(e\)\s*\{[\s\S]*?\n\s*\}/.exec(overlay);
  assert(ctx, 'G-5: onContextMenu found');
  if (ctx) {
    assert(/e\.preventDefault\(\)/.test(ctx[0])
      && /e\.stopPropagation\(\)/.test(ctx[0]),
      'G-5: onContextMenu calls both preventDefault + stopPropagation');
  }
  assert(/Audit fix G-5/.test(overlay), 'G-5: overlay banner cites fix');
}

// ─── G-6 — apply.poseAsRest wraps in beginBatch/endBatch ────────────
{
  const regSrc = read('src/v3/operators/registry.js');
  const block = /id:\s*'apply\.poseAsRest'[\s\S]*?label:\s*'Apply Pose As Rest'[\s\S]*?exec:\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\}\s*,\s*\n\s*\}\)/.exec(regSrc);
  assert(block, 'G-6: apply.poseAsRest block found');
  if (block) {
    assert(/beginBatch\(project\)/.test(block[0]),
      'G-6: exec calls beginBatch');
    assert(/endBatch\(\)/.test(block[0]),
      'G-6: exec calls endBatch in finally');
  }
  assert(/Audit fix G-6/.test(regSrc), 'G-6: registry banner cites fix');
}

// ─── G-7 — apply.armatureModifier loop wrapped in batch ─────────────
{
  const regSrc = read('src/v3/operators/registry.js');
  // Find the apply.armatureModifier id, then walk forward up to the
  // next `registerOperator(` call (or 3 KB) for the block body.
  const idIdx = regSrc.indexOf("id: 'apply.armatureModifier'");
  assert(idIdx >= 0, 'G-7: apply.armatureModifier id present');
  if (idIdx >= 0) {
    const slice = regSrc.slice(idIdx, idIdx + 3000);
    // Loop must be inside the block, with a beginBatch BEFORE it and
    // endBatch AFTER it (the loop reference confirms we found the
    // right block, not adjacent code).
    const hasBegin = /beginBatch\(project\)/.test(slice);
    const hasLoop  = /for \(const id of targetIds\)/.test(slice);
    const hasEnd   = /endBatch\(\)/.test(slice);
    assert(hasBegin && hasLoop && hasEnd,
      `G-7: block has beginBatch (${hasBegin}) + loop (${hasLoop}) + endBatch (${hasEnd})`);
  }
  assert(/Audit fix G-7/.test(regSrc), 'G-7: registry banner cites fix');
}

// ─── G-8 — clientToCanvas extracted to shared helper ────────────────
{
  // The shared helper file exists.
  const helperSrc = read('src/v3/editors/viewport/viewportMath.js');
  assert(/export function clientToCanvasXY/.test(helperSrc),
    'G-8: viewportMath.js exports clientToCanvasXY');
  // BoxSelectOverlay and CircleSelectOverlay both import from it.
  const boxSrc = read('src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx');
  const circSrc = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  assert(/from '\.\.\/viewportMath\.js'/.test(boxSrc),
    'G-8: BoxSelectOverlay imports from shared viewportMath.js');
  assert(/from '\.\.\/viewportMath\.js'/.test(circSrc),
    'G-8: CircleSelectOverlay imports from shared viewportMath.js');
  // Local function definitions removed.
  assert(!/^function clientToCanvas\b/m.test(boxSrc),
    'G-8: BoxSelectOverlay no longer defines local clientToCanvas');
  assert(!/^function clientToCanvas\b/m.test(circSrc),
    'G-8: CircleSelectOverlay no longer defines local clientToCanvas');
  // Registry's wrapper delegates to clientToCanvasXY
  const regSrc = read('src/v3/operators/registry.js');
  assert(/clientToCanvasXY\(rect, view, client\.x, client\.y\)/.test(regSrc),
    'G-8: registry wrapper delegates to clientToCanvasXY');
}

// ─── D-1 — Circle Select wheel direction flipped ────────────────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  // The fix is `dir = e.deltaY < 0 ? -1 : +1;` (wheel-up SHRINKS).
  assert(/Audit fix D-1/.test(overlay), 'D-1: overlay banner cites fix');
  const wheelHandler = /function onWheel\(e\)\s*\{[\s\S]*?\n\s*\}/.exec(overlay);
  assert(wheelHandler, 'D-1: onWheel function found');
  if (wheelHandler) {
    assert(/e\.deltaY\s*<\s*0\s*\?\s*-1\s*:\s*\+1/.test(wheelHandler[0]),
      'D-1: wheel-up (deltaY<0) maps to -1 (shrink)');
    // The old wrong cite "wheel up = larger radius" must be gone.
    assert(!/wheel up\s*=\s*larger radius/i.test(wheelHandler[0]),
      'D-1: false "wheel up = larger" comment removed');
  }
}

// ─── D-2 — Shift+L deselect-linked-cursor operator + chord ──────────
{
  const regSrc = read('src/v3/operators/registry.js');
  assert(/id:\s*'select\.linked\.cursor\.deselect'/.test(regSrc),
    'D-2: select.linked.cursor.deselect operator registered');
  assert(/runSelectLinkedCursor\(.*deselect.*true\s*\*\/\s*true\)/.test(regSrc)
    || /runSelectLinkedCursor\(\s*\/\*\s*deselect\s*\*\/\s*true\)/.test(regSrc),
    'D-2: deselect path invokes runSelectLinkedCursor(true)');
  const kmSrc = read('src/v3/keymap/default.js');
  assert(/'Shift\+KeyL':\s*'select\.linked\.cursor\.deselect'/.test(kmSrc),
    'D-2: keymap binds Shift+KeyL → select.linked.cursor.deselect');
  assert(/Audit fix D-2/.test(regSrc), 'D-2: registry banner cites fix');
}

// ─── D-5 — MMB-down starts subtract paint stroke ────────────────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  assert(/Audit fix D-5/.test(overlay), 'D-5: overlay banner cites fix');
  // onMouseDown handles button 0 AND button 1, with MMB → subtract.
  const md = /function onMouseDown\(e\)\s*\{[\s\S]*?\n\s*\}/.exec(overlay);
  assert(md, 'D-5: onMouseDown found');
  if (md) {
    assert(/e\.button\s*===\s*0/.test(md[0]) && /e\.button\s*===\s*1/.test(md[0]),
      'D-5: onMouseDown handles both LMB (0) and MMB (1)');
  }
}

// ─── D-9 — linked.js cite updated to :4503-4536 + :4467-4501 ────────
{
  const linkedSrc = read('src/v3/operators/select/linked.js');
  assert(/editmesh_select\.cc:4503-4536/.test(linkedSrc),
    'D-9: linked.js cites :4503-4536 (operator def)');
  // The follow-on cite uses the bare-suffix shorthand `:4467-4501`
  // since it's adjacent to the full file path on the prior line.
  assert(/:4467-4501/.test(linkedSrc),
    'D-9: linked.js cites :4467-4501 (exec)');
  assert(/editmesh_select\.cc:4383-4465/.test(linkedSrc),
    'D-9: linked.js cites :4383-4465 (invoke / cursor hit-test)');
  // Old wrong cite acknowledged as historical context.
  assert(/Audit D-9 corrected/.test(linkedSrc),
    'D-9: linked.js notes audit fix in banner');
}

// ─── D-10 — CircleSelectOverlay cite updated to :5706-5725 ──────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  assert(/view3d_select\.cc:5706-5725/.test(overlay),
    'D-10: overlay cites :5706-5725 (operator def)');
  assert(/wm_gesture_ops\.cc:349-447/.test(overlay),
    'D-10: overlay cites wm_gesture_ops.cc:349-447 (modal lifecycle)');
  assert(/Audit fix D-10/.test(overlay) || /Audit D-10 corrected/.test(overlay),
    'D-10: overlay banner cites fix');
}

// ─── D-11 — ApplyMenu cite + class-name fix ─────────────────────────
{
  const apply = read('src/v3/shell/ApplyMenu.jsx');
  assert(/space_view3d\.py:3193-3258/.test(apply),
    'D-11: ApplyMenu cites :3193-3258 (object_apply)');
  assert(/space_view3d\.py:[^0-9]?4393-4406/.test(apply)
    || /:4393-4406/.test(apply),
    'D-11: ApplyMenu cites :4393-4406 (pose_apply)');
  assert(/VIEW3D_MT_object_apply/.test(apply),
    'D-11: ApplyMenu uses correct class name VIEW3D_MT_object_apply');
  // The invented `OBJECT_MT_object_apply` name appears in the audit
  // banner as historical context only ("which doesn't exist in
  // Blender — the class is `VIEW3D_MT_object_apply`"). What we DON'T
  // want is the invented name as a primary cite or label. Verify the
  // mention is paired with the historical-context phrasing.
  if (/OBJECT_MT_object_apply/.test(apply)) {
    assert(/doesn't exist in Blender/.test(apply),
      'D-11: invented name only mentioned as historical context');
  }
}

// ─── D-12 — Ctrl+L Object Mode no-op deviation documented ───────────
{
  const kmSrc = read('src/v3/keymap/default.js');
  assert(/Audit D-12/.test(kmSrc) || /VIEW3D_MT_make_links/.test(kmSrc),
    'D-12: keymap doc references Make Links / D-12 deviation');
}

// ─── D-3 + D-4 — linked.js documents delimit + vert-only deviations ─
{
  const linkedSrc = read('src/v3/operators/select/linked.js');
  assert(/Audit D-3/.test(linkedSrc), 'D-3: linked.js banner cites delimit deviation');
  assert(/Audit D-4/.test(linkedSrc), 'D-4: linked.js banner cites vert-only deviation');
  assert(/select_linked_delimit_test/.test(linkedSrc),
    'D-3: linked.js mentions Blender delimit walker');
  assert(/unified_findnearest/.test(linkedSrc),
    'D-4: linked.js mentions Blender unified_findnearest');
}

// ─── D-6 — registry documents cross-mode atomic-vs-non-atomic ───────
{
  const regSrc = read('src/v3/operators/registry.js');
  assert(/Audit D-6/.test(regSrc), 'D-6: registry banner cites cross-mode deviation');
}

// ─── D-7 — ApplyMenu documents coverage gap ─────────────────────────
{
  const apply = read('src/v3/shell/ApplyMenu.jsx');
  assert(/Audit D-7/.test(apply), 'D-7: ApplyMenu banner cites coverage gap');
  assert(/VIEW3D_MT_pose_apply/.test(apply),
    'D-7: ApplyMenu mentions Blender Pose Mode menu');
}

// ─── D-8 — overlay documents bare-C off-toggle as SS-only ───────────
{
  const overlay = read('src/v3/editors/viewport/overlays/CircleSelectOverlay.jsx');
  assert(/Audit D-8|SS-only off-toggle/.test(overlay),
    'D-8: overlay banner cites SS-only toggle');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:'); for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
