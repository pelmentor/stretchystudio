// v3 Phase 0B — Service-layer surface tests.
//
// Covers the pure pieces of the service layer (preflight, format
// detection, error normalisation). The store-bound wrappers and
// actual writer integration are exercised by browser tests in
// Phase 0E (Vitest + jsdom).
//
// Run: node scripts/test/test_services.mjs

import { preflightBuildRigFor } from '../../src/services/RigService.js';
import { preflightExportFor } from '../../src/services/ExportService.js';
import { detectImportFormat, importFile } from '../../src/services/ImportService.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── RigService preflight ────────────────────────────────────────────

{
  const r = preflightBuildRigFor(null);
  assert(r.ok === false, 'preflight: null project → fail');
  assert(r.reasons.some(s => /no project/.test(s)), 'preflight: null mentions project');
}

{
  const empty = { canvas: { width: 800, height: 600 }, nodes: [] };
  const r = preflightBuildRigFor(empty);
  assert(r.ok === false, 'preflight: no parts → fail');
  assert(r.reasons.some(s => /no part/.test(s)), 'preflight: reason mentions parts');
}

{
  const p = {
    canvas: { width: 800, height: 600 },
    nodes: [{ id: 'a', type: 'part', name: 'p' }],
  };
  const r = preflightBuildRigFor(p);
  assert(r.ok === true, 'preflight: 1 part + canvas → pass');
  assert(r.reasons.length === 0, 'preflight: no reasons when ok');
}

{
  const p = {
    canvas: { width: 0, height: 0 },
    nodes: [{ id: 'a', type: 'part' }],
  };
  const r = preflightBuildRigFor(p);
  assert(r.ok === false, 'preflight: zero canvas → fail');
  assert(r.reasons.some(s => /canvas/.test(s)), 'preflight: reason mentions canvas');
}

{
  // Both reasons surface together
  const r = preflightBuildRigFor({ canvas: {}, nodes: [] });
  assert(r.reasons.length >= 2, 'preflight: collects all reasons (no-parts + no-canvas)');
}

// ── ExportService preflight ─────────────────────────────────────────

{
  const ok = {
    canvas: { width: 800, height: 600 },
    nodes: [{ id: 'a', type: 'part' }],
  };
  assert(preflightExportFor(ok, 'cmo3').ok, 'preflight cmo3: ok');
  assert(preflightExportFor(ok, 'live2d-runtime').ok, 'preflight live2d-runtime: ok');
  assert(preflightExportFor(ok, 'live2d-full').ok, 'preflight live2d-full: ok');

  const bogus = preflightExportFor(ok, 'bogus');
  assert(bogus.ok === false, 'preflight bogus format: fail');
  assert(bogus.reasons.some(s => /unsupported/.test(s)), 'preflight bogus: reason mentions unsupported');
}

{
  const r = preflightExportFor(null, 'cmo3');
  assert(r.ok === false, 'preflight: null project → fail');
}

// ── ImportService format detection ──────────────────────────────────

{
  const file = (name) => ({ name });
  assert(detectImportFormat(file('hello.stretch')) === 'stretch', 'detect: .stretch');
  assert(detectImportFormat(file('img.psd')) === 'psd', 'detect: .psd');
  assert(detectImportFormat(file('foo.cmo3')) === 'cmo3', 'detect: .cmo3');
  assert(detectImportFormat(file('weird.bin')) === 'unknown', 'detect: unknown ext');
  assert(detectImportFormat({}) === 'unknown', 'detect: file without name');
  assert(detectImportFormat(null) === 'unknown', 'detect: null');
  assert(detectImportFormat(file('UPPERCASE.STRETCH')) === 'stretch', 'detect: case-insensitive');
}

// ── ImportService non-stretch formats are gated ─────────────────────

await (async () => {
  const r = await importFile({ name: 'foo.psd' });
  assert(!r.ok && r.format === 'psd', 'importFile psd: gated until Phase 1');
  assert(/Phase 1/.test(r.error ?? ''), 'importFile psd: error mentions Phase 1');

  const r2 = await importFile({ name: 'unknown.txt' });
  assert(!r2.ok && r2.format === 'unknown', 'importFile unknown: rejected');
})();

console.log(`services: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
