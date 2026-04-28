// v3 Phase 0F.15 - tests for src/io/psdOrganizer.js
//
// PSD layer naming conventions are the contract between the user's
// PSD file and the rig auto-builder. Untested until now; the rules
// (which suffix is a variant, which name is a tag, which combination
// triggers the import wizard) are the kind of contract that gets
// silently broken by a regex tweak.
//
// Run: node scripts/test/test_psdOrganizer.mjs

import {
  variantParamId,
  extractVariant,
  matchTag,
  detectCharacterFormat,
  KNOWN_TAGS,
} from '../../src/io/psdOrganizer.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
}

// ── KNOWN_TAGS sanity ──────────────────────────────────────────────

assert(Array.isArray(KNOWN_TAGS) && KNOWN_TAGS.length > 0, 'KNOWN_TAGS exists');
assert(KNOWN_TAGS.includes('face'), 'KNOWN_TAGS contains face');
assert(KNOWN_TAGS.includes('eyewhite'), 'KNOWN_TAGS contains eyewhite');

// ── variantParamId ─────────────────────────────────────────────────

assert(variantParamId('smile') === 'ParamSmile', 'variantParamId: smile → ParamSmile');
assert(variantParamId('summer') === 'ParamSummer', 'variantParamId: summer → ParamSummer');
assert(variantParamId('SMILE') === 'ParamSmile', 'variantParamId: SMILE → ParamSmile (lowercase rest)');
assert(variantParamId('') === null, 'variantParamId: empty → null');
assert(variantParamId(null) === null, 'variantParamId: null → null');
assert(variantParamId(undefined) === null, 'variantParamId: undefined → null');
assert(variantParamId('a') === 'ParamA', 'variantParamId: single char (no slice issue)');

// ── extractVariant ─────────────────────────────────────────────────

{
  // Documented examples from the JSDoc
  assertEq(extractVariant('mouth.smile'), { baseName: 'mouth', variant: 'smile' },
    'extractVariant: mouth.smile');
  assertEq(extractVariant('topwear.summer'), { baseName: 'topwear', variant: 'summer' },
    'extractVariant: topwear.summer');
  assertEq(extractVariant('topwear-l.winter'), { baseName: 'topwear-l', variant: 'winter' },
    'extractVariant: hyphenated base + variant');
  assertEq(extractVariant('topwear'), { baseName: 'topwear', variant: null },
    'extractVariant: no dot → no variant');
  assertEq(extractVariant('face.shadow'), { baseName: 'face', variant: 'shadow' },
    'extractVariant: face.shadow');
  assertEq(extractVariant('hair.2'), { baseName: 'hair.2', variant: null },
    'extractVariant: numeric suffix → not a variant');
  assertEq(extractVariant('foo.l'), { baseName: 'foo.l', variant: null },
    'extractVariant: 1-char suffix → not a variant');
  assertEq(extractVariant('foo.v1'), { baseName: 'foo.v1', variant: null },
    'extractVariant: 2-char suffix → not a variant');
}

{
  // Lowercase variant
  assertEq(extractVariant('mouth.SMILE'), { baseName: 'mouth', variant: 'smile' },
    'extractVariant: variant lowercased');
  assertEq(extractVariant('Mouth.smile'), { baseName: 'Mouth', variant: 'smile' },
    'extractVariant: base case preserved');

  // Multi-dot - only last dot considered
  assertEq(extractVariant('a.b.cosplay'), { baseName: 'a.b', variant: 'cosplay' },
    'extractVariant: multi-dot → split on last');

  // Edge cases
  assertEq(extractVariant(''), { baseName: '', variant: null },
    'extractVariant: empty string');
  assertEq(extractVariant(null), { baseName: '', variant: null },
    'extractVariant: null → empty base, no variant');
  assertEq(extractVariant(undefined), { baseName: '', variant: null },
    'extractVariant: undefined → empty base, no variant');
  assertEq(extractVariant('  spaces  .smile'), { baseName: 'spaces  ', variant: 'smile' },
    'extractVariant: only the leading whitespace is trimmed (slice preserves the rest)');

  // Leading dot (hidden file style) — lastDot at 0 means no variant
  assertEq(extractVariant('.smile'), { baseName: '.smile', variant: null },
    'extractVariant: leading dot → no variant');

  // Suffix with leading underscore is allowed by regex
  assertEq(extractVariant('foo._private'), { baseName: 'foo', variant: '_private' },
    'extractVariant: underscore-led suffix accepted');

  // Suffix starting with digit is NOT allowed
  assertEq(extractVariant('foo.1summer'), { baseName: 'foo.1summer', variant: null },
    'extractVariant: digit-led suffix rejected');
}

// ── matchTag ───────────────────────────────────────────────────────

{
  // Exact matches
  assert(matchTag('face') === 'face', 'matchTag: face exact');
  assert(matchTag('eyewhite') === 'eyewhite', 'matchTag: eyewhite exact');
  assert(matchTag('back hair') === 'back hair', 'matchTag: back hair exact (with space)');
  assert(matchTag('Face') === 'face', 'matchTag: case-insensitive');
}

{
  // Prefix matches with separator
  assert(matchTag('face-l') === 'face', 'matchTag: face-l → face');
  assert(matchTag('face-r') === 'face', 'matchTag: face-r → face');
  assert(matchTag('eyewhite_inner') === 'eyewhite', 'matchTag: eyewhite_inner → eyewhite');
}

{
  // Variants pair with base tag
  assert(matchTag('mouth.smile') === 'mouth', 'matchTag: variant pairs with base');
  assert(matchTag('topwear-l.winter') === 'topwear', 'matchTag: variant on hyphenated base');
}

{
  // Non-tag names
  assert(matchTag('random_layer') === null, 'matchTag: random → null');
  assert(matchTag('background') === null, 'matchTag: background → null');
  assert(matchTag('') === null, 'matchTag: empty → null');
}

{
  // 'handwear' shouldn't match against 'face' just because 'face' is shorter
  // (this is the "exact-first" guard)
  assert(matchTag('handwear-l') === 'handwear', 'matchTag: handwear-l → handwear (not just hand)');
}

// ── detectCharacterFormat ──────────────────────────────────────────

{
  // 4+ tagged layers → true
  const layers = [
    { name: 'face' }, { name: 'eyewhite-l' }, { name: 'eyewhite-r' },
    { name: 'mouth' }, { name: 'random_thing' },
  ];
  assert(detectCharacterFormat(layers) === true, 'detect: 4 tags → true');
}

{
  // 3 or fewer → false
  const layers = [
    { name: 'face' }, { name: 'mouth' }, { name: 'random' },
  ];
  assert(detectCharacterFormat(layers) === false, 'detect: 3 tags → false');
}

{
  // Empty / no tagged → false
  assert(detectCharacterFormat([]) === false, 'detect: empty → false');
  assert(detectCharacterFormat([{ name: 'a' }, { name: 'b' }, { name: 'c' }]) === false,
    'detect: no tags → false');
}

{
  // Exactly 4 → true (boundary)
  const layers = [
    { name: 'face' }, { name: 'mouth' }, { name: 'irides-l' }, { name: 'irides-r' },
  ];
  assert(detectCharacterFormat(layers) === true, 'detect: exactly 4 → true');
}

console.log(`psdOrganizer: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
