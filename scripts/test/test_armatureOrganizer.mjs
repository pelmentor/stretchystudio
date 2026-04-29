// v3 Phase 0F.27 - tests for the pure helpers in src/io/armatureOrganizer.js
//
// Skipping the heavy DWPose / buildArmatureNodes paths that need
// realistic skeleton fixtures. Locking down the small composable
// helpers: analyzeGroups (group inventory from layer map),
// getSkeletonFromNodes (boneRole → pivot extraction),
// autoRearrangeLayers (eyewhite-on-top-of-irides reorder),
// matchTag, detectCharacterFormat (re-tested here against
// armatureOrganizer's own KNOWN_TAGS list).
//
// Run: node scripts/test/test_armatureOrganizer.mjs

import {
  matchTag,
  detectCharacterFormat,
  analyzeGroups,
  getSkeletonFromNodes,
  autoRearrangeLayers,
} from '../../src/io/armatureOrganizer.js';

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

// ── matchTag (armatureOrganizer's own copy) ──────────────────────

{
  assert(matchTag('face') === 'face', 'matchTag: face exact');
  assert(matchTag('Face') === 'face', 'matchTag: case-insensitive');
  // armatureOrganizer's KNOWN_TAGS lists 'handwear-l' as its own entry,
  // so the exact-match loop returns 'handwear-l' (NOT 'handwear').
  // This is intentional - the side suffix matters for downstream rigging.
  assert(matchTag('handwear-l') === 'handwear-l',
    'matchTag: handwear-l preserved (KNOWN_TAGS entry)');
  // Names ending in space/hyphen/underscore + side go through the prefix
  // match instead — but 'handwear_2' doesn't match 'handwear' if 'handwear-2'
  // isn't in KNOWN_TAGS. Test the prefix path with a known-base + suffix:
  assert(matchTag('eyewhite-foo') === 'eyewhite-foo' || matchTag('eyewhite-foo') === 'eyewhite',
    'matchTag: prefix or specific accepted');
  assert(matchTag('random') === null, 'matchTag: unknown → null');
  assert(matchTag('') === null, 'matchTag: empty');
  assert(matchTag(null) === null || matchTag(null) === undefined, 'matchTag: null → no match');
}

// ── detectCharacterFormat ────────────────────────────────────────

{
  const layers = [
    { name: 'face' }, { name: 'mouth' }, { name: 'irides-l' }, { name: 'irides-r' },
  ];
  assert(detectCharacterFormat(layers) === true, 'detect: 4 tags → true');
  assert(detectCharacterFormat([{name:'a'}]) === false, 'detect: 1 layer → false');
  assert(detectCharacterFormat([]) === false, 'detect: empty → false');
}

// ── analyzeGroups ────────────────────────────────────────────────

{
  // All present, arms/legs/feet split
  const layerMap = {
    face: {}, 'front hair': {}, topwear: {}, bottomwear: {},
    'handwear-l': {}, 'handwear-r': {},
    'legwear-l': {}, 'legwear-r': {},
    'footwear-l': {}, 'footwear-r': {},
  };
  const groups = analyzeGroups(layerMap);
  assert(groups.head === true, 'analyzeGroups: head present');
  assert(groups.torso === true, 'analyzeGroups: torso present');
  assert(groups.hips === true, 'analyzeGroups: hips present');
  assert(groups.arms === 'split', 'analyzeGroups: arms split');
  assert(groups.legs === 'split', 'analyzeGroups: legs split');
  assert(groups.feet === 'split', 'analyzeGroups: feet split');
}

{
  // Merged (no -l/-r): single 'handwear' is present
  const layerMap = {
    face: {}, topwear: {}, handwear: {}, legwear: {}, footwear: {},
  };
  const groups = analyzeGroups(layerMap);
  assert(groups.arms === 'merged', 'analyzeGroups: arms merged');
  assert(groups.legs === 'merged', 'analyzeGroups: legs merged');
  assert(groups.feet === 'merged', 'analyzeGroups: feet merged');
}

{
  // Partial: only one side
  const layerMap = { 'handwear-l': {} };
  const groups = analyzeGroups(layerMap);
  assert(groups.arms === 'partial', 'analyzeGroups: only left → partial');
}

{
  // Missing: nothing
  const layerMap = {};
  const groups = analyzeGroups(layerMap);
  assert(groups.head === false, 'analyzeGroups: head missing');
  assert(groups.arms === 'missing', 'analyzeGroups: arms missing');
}

{
  // Head triggers on any of: face / front hair / back hair / headwear
  assert(analyzeGroups({ headwear: {} }).head === true, 'head: headwear alone triggers');
  assert(analyzeGroups({ 'back hair': {} }).head === true, 'head: back hair alone triggers');
  assert(analyzeGroups({ topwear: {} }).head === false, 'head: torsowear is not head');
}

// ── getSkeletonFromNodes ─────────────────────────────────────────

{
  const nodes = [
    { type: 'group', boneRole: 'leftElbow',  transform: { pivotX: 100, pivotY: 200 } },
    { type: 'group', boneRole: 'rightKnee',  transform: { pivotX: 300, pivotY: 400 } },
    { type: 'group', boneRole: null,         transform: { pivotX: 999, pivotY: 999 } }, // skipped: no boneRole
    { type: 'part',  boneRole: 'leftElbow',  transform: { pivotX: 0,   pivotY: 0   } }, // skipped: not group
    { type: 'group',                          transform: { pivotX: 5,   pivotY: 6   } }, // skipped: no boneRole
  ];
  const sk = getSkeletonFromNodes(nodes);
  assertEq(sk.leftElbow, { x: 100, y: 200 }, 'skeleton: leftElbow extracted');
  assertEq(sk.rightKnee, { x: 300, y: 400 }, 'skeleton: rightKnee extracted');
  assert(!('null' in sk), 'skeleton: null boneRole skipped');
  assert(Object.keys(sk).length === 2, 'skeleton: only group-with-boneRole extracted');
}

{
  // Empty input → empty result
  assertEq(getSkeletonFromNodes([]), {}, 'skeleton: empty nodes → empty');
}

// ── autoRearrangeLayers ─────────────────────────────────────────

{
  // No eye layers → returns null (no change)
  const layers = [{ name: 'face' }, { name: 'mouth' }];
  const partIds = ['p0', 'p1'];
  assert(autoRearrangeLayers(layers, partIds) === null, 'autoRearrange: no eyes → null');
}

{
  // eyewhite already on top of irides → no change → null
  // PSD order: index 0 is TOP. Irides above eyewhite means
  // irides has lower index. So [iris, eyewhite] needs no rearrange.
  const layers = [{ name: 'irides' }, { name: 'eyewhite' }, { name: 'face' }];
  const partIds = ['p0', 'p1', 'p2'];
  assert(autoRearrangeLayers(layers, partIds) === null,
    'autoRearrange: irides already on top → null');
}

{
  // eyewhite on top → rearrange so irides moves above eyewhite
  const layers = [
    { name: 'eyewhite' },   // index 0 = top
    { name: 'irides' },
    { name: 'face' },
  ];
  const partIds = ['pE', 'pI', 'pF'];
  const result = autoRearrangeLayers(layers, partIds);
  assert(result !== null, 'autoRearrange: needs change → returns object');
  // After rearrange: irides must come before eyewhite
  const iridesIdx = result.layers.findIndex(l => l.name === 'irides');
  const eyewhiteIdx = result.layers.findIndex(l => l.name === 'eyewhite');
  assert(iridesIdx < eyewhiteIdx, 'autoRearrange: irides now before eyewhite');
  // partIds correspondingly reordered
  assert(result.partIds[iridesIdx] === 'pI', 'autoRearrange: irides partId tracked');
  assert(result.partIds[eyewhiteIdx] === 'pE', 'autoRearrange: eyewhite partId tracked');
}

{
  // Per-side: eyewhite-l on top of irides-l, but irides-r on top of eyewhite-r
  // Only the broken side gets rearranged.
  const layers = [
    { name: 'eyewhite-l' },  // 0 — l side broken, top
    { name: 'irides-l' },     // 1
    { name: 'irides-r' },     // 2 — r side already correct (irides above eyewhite)
    { name: 'eyewhite-r' },   // 3
  ];
  const partIds = ['pEL', 'pIL', 'pIR', 'pER'];
  const result = autoRearrangeLayers(layers, partIds);
  assert(result !== null, 'autoRearrange: per-side broken → reorder');
  const iLIdx = result.layers.findIndex(l => l.name === 'irides-l');
  const eLIdx = result.layers.findIndex(l => l.name === 'eyewhite-l');
  assert(iLIdx < eLIdx, 'autoRearrange: per-side l fixed');
}

console.log(`armatureOrganizer: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
