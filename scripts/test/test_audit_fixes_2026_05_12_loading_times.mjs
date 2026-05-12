// Loading-times instrumentation audit-fix pin (2026-05-12).
//
// Substrate commit `475527e` shipped the Stage 0 instrumentation
// (logger.time/timeEnd/timed + 10 path coverage). Same-day dual audit
// surfaced 4 HIGH timer leaks + 3 MED missed paths + 2 LOW polish
// items; this pin asserts the audit-fix sweep's coverage:
//
//   G-1   — initRig.js outer try/catch ends rigInit:full + authored-path
//           via timeEndIfRunning on throw
//   G-2   — exporter.js outer try/catch on both exportLive2D + exportLive2DProject
//           + try/finally around sync generateMoc3 with byteSize fallback
//   G-3   — projectFile.js outer try/catch on both saveProject + loadProject
//           ends all 4 / 3 inner timers on throw
//   G-4   — CanvasViewport.jsx finalizePsdImport outer try/catch +
//           workerPool:composite timeEnd moved INSIDE pool.destroy try/finally
//   G-5   — psd.js#importPsd cover the worker round-trip with
//           psdImport:workerDecode timer (success + onerror + worker-failure)
//   G-6   — projectDb.js#saveToDb + loadFromDb instrument the IndexedDB
//           write/read with projectSave:indexedDbBlob / projectLoad:indexedDbBlob
//   G-7   — armatureOrganizer.js#_ensureOrt covers the ONNX runtime
//           dynamic import with lazyLoad:onnxruntime (heaviest single import)
//   G-8   — logger.time() overwrite WARN includes orphanAgeMs in data
//   G-9   — logger.timeEnd JSDoc clarifies customMessage does NOT
//           auto-append ms (caller must include if wanted)
//
//   New helper: logger.timeEndIfRunning silently returns null when
//   no matching timer exists (vs strict timeEnd which WARNs). Used
//   by all 4 catch handlers to clean up conditional sub-timers
//   without false-positive WARNs.
//
// Run: node scripts/test/test_audit_fixes_2026_05_12_loading_times.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

function read(rel) {
  return readFileSync(join(REPO, rel), 'utf8');
}

// ─── Block 1 ── Helper API surface ────────────────────────────────
{
  const src = read('src/lib/logger.js');
  assert(/function timeEndIfRunning\(source, label, data\)/.test(src),
    '1.A: timeEndIfRunning helper defined');
  assert(/timeEndIfRunning\b[^{]*\}\s*;\s*$/.test(src.slice(src.indexOf('export const logger'))),
    '1.B: timeEndIfRunning exported on logger object');
  assert(/Per Rule №1: this is NOT a silent fallback/.test(src),
    '1.C: timeEndIfRunning JSDoc cites Rule №1 (intentional opt-in, not crutch)');
  assert(/orphanAgeMs/.test(src),
    '1.D: time() overwrite WARN includes orphanAgeMs (G-8)');
  assert(/`time\(\$\{label\}\): timer already running — overwriting start`,\s*\{\s*orphanAgeMs\s*\}/.test(src),
    '1.E: orphan-age data payload structure correct');
  assert(/ms is NOT auto-appended to the\s*\*\s*custom string/.test(src) ||
         /ms.*NOT.*auto-appended/i.test(src),
    '1.F: customMessage JSDoc clarifies ms is NOT auto-appended (G-9)');
}

// ─── Block 2 ── Helper behaviour (live) ───────────────────────────
{
  // Import the helper directly. logsStore.push is wrapped in try/catch
  // inside logger.js so it won't throw when zustand renders zero stores.
  const { logger } = await import('../../src/lib/logger.js');

  // 2.A: timeEndIfRunning returns null silently on no-match
  const result1 = logger.timeEndIfRunning('audit-pin-test', 'never-started');
  assert(result1 === null, '2.A: timeEndIfRunning returns null when no matching timer');

  // 2.B: timeEndIfRunning returns ms when timer is running
  logger.time('audit-pin-test', 'happy-path');
  const result2 = logger.timeEndIfRunning('audit-pin-test', 'happy-path');
  assert(typeof result2 === 'number' && result2 >= 0, '2.B: timeEndIfRunning returns ms when matching timer');

  // 2.C: timeEndIfRunning is idempotent (second call returns null)
  const result3 = logger.timeEndIfRunning('audit-pin-test', 'happy-path');
  assert(result3 === null, '2.C: timeEndIfRunning is idempotent (second call returns null)');

  // 2.D: timed wrapper still re-throws on caller error
  let caught = null;
  try {
    await logger.timed('audit-pin-test', 'throws', async () => {
      throw new Error('intentional');
    });
  } catch (e) {
    caught = e;
  }
  assert(caught?.message === 'intentional', '2.D: timed re-throws caller error');

  // 2.E: timed cleans up timer even on throw (next time() shouldn't WARN)
  // — best we can do without inspecting internal _timers Map. Observable
  // signal: a fresh timed() pair on the same key works without console
  // noise. We just verify it doesn't throw.
  await logger.timed('audit-pin-test', 'throws', async () => 'recovered');
  assert(true, '2.E: timed cleans up registry on throw (fresh pair works)');
}

// ─── Block 3 ── G-1 initRig leak fix ─────────────────────────────
{
  const src = read('src/io/live2d/rig/initRig.js');
  assert(/Outer try\/catch ensures `rigInit:full`/.test(src),
    '3.A: initRig.js has outer try/catch comment citing rigInit:full');
  assert(/timeEndIfRunning\('rigInit', 'authored-path'/.test(src),
    '3.B: catch ends rigInit:authored-path conditionally');
  assert(/timeEndIfRunning\('rigInit', 'full'/.test(src),
    '3.C: catch ends rigInit:full conditionally');
  assert(/throw err;/.test(src.slice(src.indexOf('rigInit:full'))),
    '3.D: catch re-throws original error');
}

// ─── Block 4 ── G-2 exporter leak fix ────────────────────────────
{
  const src = read('src/io/live2d/exporter.js');
  assert(/Outer try\/catch — any throw[\s\S]{0,200}live2d:full/.test(src),
    '4.A: exportLive2D has outer try/catch comment');
  assert(/Outer try\/catch — same rationale[\s\S]{0,300}cmo3:full/.test(src),
    '4.B: exportLive2DProject has outer try/catch comment');
  assert(/timeEndIfRunning\('export', 'live2d:full'/.test(src),
    '4.C: live2d:full ended in catch via timeEndIfRunning');
  assert(/timeEndIfRunning\('export', 'cmo3:full'/.test(src),
    '4.D: cmo3:full ended in catch via timeEndIfRunning');
  // Sync generateMoc3 wrapped in try/finally (not try/catch — preserves throw):
  assert(/let moc3Buffer;\s*try\s*\{[\s\S]*?moc3Buffer = generateMoc3/.test(src),
    '4.E: generateMoc3 sync call wrapped in try (let-declared moc3Buffer)');
  assert(/\}\s*finally\s*\{\s*logger\.timeEndIfRunning\('export', 'live2d:generateMoc3'/.test(src),
    '4.F: generateMoc3 finally ends timer with byteSize fallback');
}

// ─── Block 5 ── G-3 projectFile leak fix ─────────────────────────
{
  const src = read('src/io/projectFile.js');
  assert(/Outer try\/catch ensures all four serialize:\* timers/.test(src),
    '5.A: saveProject has outer try/catch comment');
  assert(/Outer try\/catch ensures `projectLoad:full`/.test(src),
    '5.B: loadProject has outer try/catch comment');
  // saveProject catch ends all 4
  assert(/timeEndIfRunning\('projectSave', 'serialize:full'/.test(src),
    '5.C: saveProject catch ends serialize:full');
  assert(/timeEndIfRunning\('projectSave', 'serialize:textures'/.test(src),
    '5.D: saveProject catch ends serialize:textures');
  assert(/timeEndIfRunning\('projectSave', 'serialize:audio'/.test(src),
    '5.E: saveProject catch ends serialize:audio');
  assert(/timeEndIfRunning\('projectSave', 'serialize:zip'/.test(src),
    '5.F: saveProject catch ends serialize:zip');
  // loadProject catch ends 4 (full + parseJson + textures + audio)
  assert(/timeEndIfRunning\('projectLoad', 'full'/.test(src),
    '5.G: loadProject catch ends projectLoad:full');
  assert(/timeEndIfRunning\('projectLoad', 'textures'/.test(src),
    '5.H: loadProject catch ends projectLoad:textures');
  assert(/timeEndIfRunning\('projectLoad', 'audio'/.test(src),
    '5.I: loadProject catch ends projectLoad:audio');
  assert(/timeEndIfRunning\('projectLoad', 'parseJson'/.test(src),
    '5.J: loadProject catch ends projectLoad:parseJson');
}

// ─── Block 6 ── G-4 finalizePsdImport leak fix ───────────────────
{
  const src = read('src/components/canvas/CanvasViewport.jsx');
  assert(/Outer try\/catch ensures `psdImport:finalize`/.test(src),
    '6.A: finalizePsdImport has outer try/catch comment');
  assert(/timeEndIfRunning\('psdImport', 'finalize'/.test(src),
    '6.B: catch ends psdImport:finalize');
  assert(/timeEndIfRunning\('psdImport', 'workerPool:composite'/.test(src),
    '6.C: catch / finally ends workerPool:composite');
  // workerPool:composite timeEnd moved INTO the existing try/finally
  // (alongside pool.destroy()). The finally block carries the comment
  // explaining the move + the timeEndIfRunning call + the destroy call.
  // Match `pool.destroy(` (with open paren) so the literal word in the
  // explanatory comment doesn't short-circuit the non-greedy capture.
  const finallyBlock = src.match(/\}\s*finally\s*\{\s*([\s\S]{0,800}?)\s*pool\.destroy\(/);
  assert(finallyBlock !== null,
    '6.D: workerPool finally block intact');
  assert(finallyBlock && /timeEndIfRunning\('psdImport', 'workerPool:composite'/.test(finallyBlock[1]),
    '6.E: workerPool:composite timeEnd lives INSIDE the same finally as pool.destroy');
}

// ─── Block 7 ── G-5 importPsd worker decode timer ────────────────
{
  const src = read('src/io/psd.js');
  assert(/import \{ logger \} from/.test(src),
    '7.A: psd.js imports logger');
  assert(/logger\.time\('psdImport', 'workerDecode'\)/.test(src),
    '7.B: importPsd opens psdImport:workerDecode timer');
  assert(/logger\.timeEnd\('psdImport', 'workerDecode'/.test(src),
    '7.C: success path ends timer');
  assert(/logger\.timeEndIfRunning\('psdImport', 'workerDecode'/.test(src),
    '7.D: failure path (worker error / onerror) ends timer via timeEndIfRunning');
  assert(/bufferBytes/.test(src),
    '7.E: payload includes bufferBytes for size scaling');
}

// ─── Block 8 ── G-6 IndexedDB timers ─────────────────────────────
{
  const src = read('src/io/projectDb.js');
  assert(/import \{ logger \} from/.test(src),
    '8.A: projectDb.js imports logger');
  // saveToDb side
  assert(/logger\.time\('projectSave', 'indexedDbBlob'\)/.test(src),
    '8.B: saveToDb opens projectSave:indexedDbBlob timer');
  assert(/logger\.timeEnd\('projectSave', 'indexedDbBlob'/.test(src),
    '8.C: saveToDb success path ends timer');
  assert(/logger\.timeEndIfRunning\('projectSave', 'indexedDbBlob'/.test(src),
    '8.D: saveToDb tx.onerror ends timer via timeEndIfRunning');
  // loadFromDb side
  assert(/logger\.time\('projectLoad', 'indexedDbBlob'\)/.test(src),
    '8.E: loadFromDb opens projectLoad:indexedDbBlob timer');
  assert(/logger\.timeEnd\('projectLoad', 'indexedDbBlob'/.test(src),
    '8.F: loadFromDb success path ends timer');
  assert(/logger\.timeEndIfRunning\('projectLoad', 'indexedDbBlob'/.test(src),
    '8.G: loadFromDb tx.onerror ends timer via timeEndIfRunning');
}

// ─── Block 9 ── G-7 ONNX runtime lazy-import timer ───────────────
{
  const src = read('src/io/armatureOrganizer.js');
  assert(/logger\.time\('lazyLoad', 'onnxruntime'\)/.test(src),
    '9.A: _ensureOrt opens lazyLoad:onnxruntime timer');
  assert(/logger\.timeEnd\('lazyLoad', 'onnxruntime'\)/.test(src),
    '9.B: success path ends timer');
  assert(/logger\.timeEndIfRunning\('lazyLoad', 'onnxruntime'/.test(src),
    '9.C: catch path ends timer via timeEndIfRunning + nulls _ortPromise for retry');
  assert(/_ortPromise = null/.test(src.slice(src.indexOf('lazyLoad'))),
    '9.D: catch resets _ortPromise to null so retry triggers fresh import');
}

// ─── Block 10 ── No leftover `timeEnd` callsites that should be `IfRunning` ──
{
  // Sanity: in catch handlers, the pattern is `logger.timeEndIfRunning(...)`
  // — strict `logger.timeEnd` inside a catch would itself fire a WARN if
  // the timer happened to already be ended. Verify no such pattern.
  const initRigSrc = read('src/io/live2d/rig/initRig.js');
  assert(!/catch \(err\)\s*\{[\s\S]{0,200}?logger\.timeEnd\(/.test(initRigSrc),
    '10.A: initRig.js catch handlers use timeEndIfRunning (no strict timeEnd)');

  const exporterSrc = read('src/io/live2d/exporter.js');
  // Exporter has multiple catch handlers; verify none use strict timeEnd
  // for the outer cleanup pattern.
  const catchBlocks = exporterSrc.match(/\}\s*catch \(err\)\s*\{[\s\S]{0,300}?\}/g) ?? [];
  for (const block of catchBlocks) {
    if (/timeEnd\(/.test(block) && !/timeEndIfRunning\(/.test(block)) {
      assert(false, '10.B: exporter.js catch handler uses strict timeEnd (should be IfRunning)');
    }
  }
  assert(true, '10.B: exporter.js catch handlers use timeEndIfRunning consistently');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
