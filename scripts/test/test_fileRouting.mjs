// v3 Phase 0F.5 - file routing tests
// Run: node scripts/test/test_fileRouting.mjs

import { routeImport } from '../../src/components/canvas/viewport/fileRouting.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeHandlers() {
  return {
    calls: [],
    importStretch(f) { this.calls.push(['stretch', f.name]); },
    importPsd(f)     { this.calls.push(['psd', f.name]); },
    importPng(f)     { this.calls.push(['png', f.name]); },
  };
}

// .stretch
{
  const h = makeHandlers();
  const result = routeImport({ name: 'p.stretch', type: '' }, h);
  assert(result === true, '.stretch returns true');
  assert(h.calls.length === 1 && h.calls[0][0] === 'stretch', '.stretch routed to importStretch');
}

// .psd
{
  const h = makeHandlers();
  routeImport({ name: 'IMG.psd', type: '' }, h);
  assert(h.calls[0][0] === 'psd', '.psd routed (case-insensitive ext)');
}

// image/png
{
  const h = makeHandlers();
  routeImport({ name: 'foo.png', type: 'image/png' }, h);
  assert(h.calls[0][0] === 'png', 'image/png mime routed');
}

// image/jpeg also routes through png handler
{
  const h = makeHandlers();
  routeImport({ name: 'foo.jpg', type: 'image/jpeg' }, h);
  assert(h.calls[0][0] === 'png', 'image/jpeg routed (importPng handles all images)');
}

// Unknown — returns false, no handler invoked
{
  const h = makeHandlers();
  const result = routeImport({ name: 'foo.txt', type: 'text/plain' }, h);
  assert(result === false, 'unknown returns false');
  assert(h.calls.length === 0, 'unknown: no handler invoked');
}

// null / undefined — safe
{
  const h = makeHandlers();
  assert(routeImport(null, h) === false, 'null file returns false');
  assert(routeImport(undefined, h) === false, 'undefined file returns false');
  assert(h.calls.length === 0, 'null/undef: no handlers invoked');
}

// File without name property — safe
{
  const h = makeHandlers();
  const result = routeImport({ type: 'image/png' }, h);
  assert(result === true, 'file with type but no name still routes via mime');
  assert(h.calls[0][0] === 'png', 'no-name + image mime → png handler');
}

// .stretch wins over image mime (stretch first)
{
  const h = makeHandlers();
  routeImport({ name: 'foo.stretch', type: 'image/png' }, h);
  assert(h.calls[0][0] === 'stretch', '.stretch beats image/png mime');
}

console.log(`fileRouting: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
