// Tests for canonicalize.mjs. Run with: node scripts/native-rig-diff/test_canonicalize.mjs
// Exits non-zero on first failure.

import {
  canonicalizeUuids,
  canonicalizeTimestamps,
  canonicalize,
  canonicalizeJson,
} from './canonicalize.mjs';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, name) {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr === eStr) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  expected: ${eStr}`);
    console.error(`  actual:   ${aStr}`);
  }
}

// ---- UUID remap ----

{
  const input = 'foo a1b2c3d4-1234-5678-9abc-def012345678 bar';
  const { canonical, remap } = canonicalizeUuids(input);
  assertEq(canonical, 'foo uuid_0001 bar', 'single uuid → uuid_0001');
  assertEq(remap.size, 1, 'remap has one entry');
}

{
  const u1 = 'a1b2c3d4-1234-5678-9abc-def012345678';
  const u2 = 'b2c3d4e5-2345-6789-abcd-ef0123456789';
  const input = `<a id="${u1}"/> <b id="${u2}"/> <c id="${u1}"/>`;
  const { canonical } = canonicalizeUuids(input);
  // First-occurrence ordering: u1 → uuid_0001, u2 → uuid_0002, u1 reuses uuid_0001
  assertEq(
    canonical,
    `<a id="uuid_0001"/> <b id="uuid_0002"/> <c id="uuid_0001"/>`,
    'first-occurrence ordering preserved'
  );
}

{
  // Two different "exports" with structurally identical UUIDs but different
  // randomUUID() draws should canonicalize to the same string.
  const exportA = 'parent=aaaaaaaa-1111-2222-3333-444444444444 child=bbbbbbbb-5555-6666-7777-888888888888 ref=aaaaaaaa-1111-2222-3333-444444444444';
  const exportB = 'parent=cccccccc-9999-aaaa-bbbb-cccccccccccc child=dddddddd-eeee-ffff-0000-111111111111 ref=cccccccc-9999-aaaa-bbbb-cccccccccccc';
  const ca = canonicalizeUuids(exportA).canonical;
  const cb = canonicalizeUuids(exportB).canonical;
  assertEq(ca, cb, 'structurally-identical-uuid texts canonicalize equal');
}

// ---- Timestamp canonicalization ----

{
  const input = '<Timestamp>2026-04-27T14:32:11.123Z</Timestamp>';
  const out = canonicalizeTimestamps(input);
  assertEq(out, '<Timestamp><ISO_TIMESTAMP></Timestamp>', 'ISO with millis blanked');
}

{
  const input = '<Timestamp>2026-04-27T14:32:11Z</Timestamp>';
  const out = canonicalizeTimestamps(input);
  assertEq(out, '<Timestamp><ISO_TIMESTAMP></Timestamp>', 'ISO without millis blanked');
}

{
  const input = '"id":"__motion_idle_1714234567890"';
  const out = canonicalizeTimestamps(input);
  assertEq(out, '"id":"__motion_idle_<TS>"', 'motion id timestamp blanked');
}

{
  const input = '"id":"__motion_TalkingIdle_1714234567890"';
  const out = canonicalizeTimestamps(input);
  assertEq(out, '"id":"__motion_TalkingIdle_<TS>"', 'CamelCase preset name preserved');
}

// ---- Combined canonicalize ----

{
  const u = 'aaaaaaaa-1111-2222-3333-444444444444';
  const input = `<x id="${u}" t="2026-04-27T14:32:11.000Z" m="__motion_idle_1714234567890"/>`;
  const { canonical } = canonicalize(input);
  assertEq(
    canonical,
    `<x id="uuid_0001" t="<ISO_TIMESTAMP>" m="__motion_idle_<TS>"/>`,
    'all three transforms applied'
  );
}

// ---- JSON canonicalization ----

{
  const input = {
    Version: 3,
    Meta: { exportedAt: '2026-04-27T14:32:11Z' },
    Curves: [
      { Id: '__motion_idle_1714234567890' },
      { Target: 'Parameter', Id: 'ParamAngleX' },
    ],
    Refs: { partGuid: 'aaaaaaaa-1111-2222-3333-444444444444' },
  };
  const { canonical, uuidRemap } = canonicalizeJson(input);
  assertEq(canonical.Version, 3, 'numbers untouched');
  assertEq(canonical.Meta.exportedAt, '<ISO_TIMESTAMP>', 'JSON timestamp blanked');
  assertEq(canonical.Curves[0].Id, '__motion_idle_<TS>', 'JSON motion id blanked');
  assertEq(canonical.Curves[1].Id, 'ParamAngleX', 'non-uuid string passthrough');
  assertEq(canonical.Refs.partGuid, 'uuid_0001', 'JSON uuid remapped');
  assertEq(uuidRemap.size, 1, 'JSON remap captured uuid');
}

{
  // Structurally identical JSON with different UUIDs canonicalizes equal.
  const a = {
    parts: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'head' }],
    refs: { headPart: 'aaaaaaaa-1111-2222-3333-444444444444' },
  };
  const b = {
    parts: [{ id: 'bbbbbbbb-5555-6666-7777-888888888888', name: 'head' }],
    refs: { headPart: 'bbbbbbbb-5555-6666-7777-888888888888' },
  };
  const ca = JSON.stringify(canonicalizeJson(a).canonical);
  const cb = JSON.stringify(canonicalizeJson(b).canonical);
  assertEq(ca, cb, 'structurally-equal JSON canonicalizes equal across uuid draws');
}

// ---- Negative: non-uuid hex strings should NOT be touched ----

{
  // Common false positive: 32-hex-digit strings without hyphens. The regex
  // requires hyphens, so 32-char hashes don't match.
  const input = 'sha256=a1b2c3d4123456789abcdef012345678abcdef0123456789a1b2c3d4e5f6';
  const { canonical } = canonicalizeUuids(input);
  assertEq(canonical, input, '32-char hashes without uuid hyphens not touched');
}

{
  // A short hex string in a parameter value should not be touched.
  const input = '<param value="0xdeadbeef"/>';
  const { canonical } = canonicalizeUuids(input);
  assertEq(canonical, input, 'short hex values not touched');
}

// ---- Summary ----

console.log(`canonicalize: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
