// v3 Phase 0F.36 - tests for src/io/live2d/cdi3json.js
//
// generateCdi3Json builds the display-info JSON that Cubism Viewer
// reads to show human-friendly param / part names. Schema is
// strict: Cubism rejects unknown root fields, refuses files with
// missing Version. Pure data builder, no DOM.
//
// Run: node scripts/test/test_cdi3json.mjs

import { generateCdi3Json } from '../../src/io/live2d/cdi3json.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Empty input → minimal valid result ───────────────────────────

{
  const r = generateCdi3Json({});
  assert(r.Version === 3, 'empty: Version = 3');
  assert(!('Parameters' in r), 'empty: no Parameters key when none provided');
  assert(!('Parts' in r), 'empty: no Parts key when none provided');
}

{
  const r = generateCdi3Json({ parameters: [], parts: [] });
  assert(r.Version === 3, 'empty arrays: Version = 3');
  assert(!('Parameters' in r), 'empty arrays: no Parameters key');
  assert(!('Parts' in r), 'empty arrays: no Parts key');
}

// ── Parameters: id pass-through, name fallback to id ─────────────

{
  const r = generateCdi3Json({
    parameters: [
      { id: 'ParamAngleX', name: 'Angle X' },
      { id: 'ParamSmile' /* no name */ },
    ],
  });
  assert(r.Parameters.length === 2, 'params: 2 entries');
  assert(r.Parameters[0].Id === 'ParamAngleX', 'params: Id pass-through');
  assert(r.Parameters[0].Name === 'Angle X', 'params: Name pass-through');
  assert(r.Parameters[1].Name === 'ParamSmile', 'params: Name fallback to Id');
}

// ── Parameters: groupId emitted only when present ────────────────

{
  const r = generateCdi3Json({
    parameters: [
      { id: 'P1', name: 'P1', groupId: 'GroupA' },
      { id: 'P2', name: 'P2' /* no groupId */ },
    ],
  });
  assert(r.Parameters[0].GroupId === 'GroupA', 'groupId: emitted when present');
  assert(!('GroupId' in r.Parameters[1]), 'groupId: omitted when absent');
}

// ── Parts: same Id/Name fallback semantics ───────────────────────

{
  const r = generateCdi3Json({
    parts: [
      { id: 'PartArmA', name: 'Arm A' },
      { id: 'PartLegB' /* no name */ },
    ],
  });
  assert(r.Parts.length === 2, 'parts: 2 entries');
  assert(r.Parts[0].Id === 'PartArmA', 'parts: Id pass-through');
  assert(r.Parts[0].Name === 'Arm A', 'parts: Name pass-through');
  assert(r.Parts[1].Name === 'PartLegB', 'parts: Name fallback to Id');
}

// ── Combined parameters + parts ──────────────────────────────────

{
  const r = generateCdi3Json({
    parameters: [{ id: 'P', name: 'P' }],
    parts: [{ id: 'X', name: 'X' }],
  });
  assert(r.Version === 3, 'combined: Version');
  assert(r.Parameters.length === 1, 'combined: parameters');
  assert(r.Parts.length === 1, 'combined: parts');
}

// ── JSON-safe (Cubism Viewer reads JSON) ─────────────────────────

{
  const r = generateCdi3Json({
    parameters: [{ id: 'P', name: 'P', groupId: 'G' }],
    parts: [{ id: 'X', name: 'X' }],
  });
  // Stringify and parse back; structure must round-trip
  const round = JSON.parse(JSON.stringify(r));
  assert(round.Version === 3, 'json: Version round-trips');
  assert(round.Parameters[0].Id === 'P', 'json: Parameter Id round-trips');
  assert(round.Parts[0].Name === 'X', 'json: Part Name round-trips');
}

// ── Default name for missing/empty name strings ─────────────────

{
  const r = generateCdi3Json({
    parameters: [
      { id: 'P', name: '' },         // empty name → fallback to id
      { id: 'Q', name: null },       // null name → fallback to id
      { id: 'R', name: undefined },  // undefined → fallback to id
    ],
  });
  assert(r.Parameters[0].Name === 'P', 'name fallback: empty string');
  assert(r.Parameters[1].Name === 'Q', 'name fallback: null');
  assert(r.Parameters[2].Name === 'R', 'name fallback: undefined');
}

// ── Mutation safety: input not modified ──────────────────────────

{
  const inputParams = [{ id: 'P', name: 'P' }];
  const inputParts = [{ id: 'X', name: 'X' }];
  const before = JSON.stringify({ inputParams, inputParts });
  generateCdi3Json({ parameters: inputParams, parts: inputParts });
  const after = JSON.stringify({ inputParams, inputParts });
  assert(before === after, 'mutation: input not modified');
}

console.log(`cdi3json: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
