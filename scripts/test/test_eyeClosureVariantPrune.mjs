// Slice 3 (RULE №4 follow-up audit Blender-fidelity HIGH-5, deferred
// from Slice 2) — eager cleanup of orphaned variant parabolas.
//
// # Background
//
// Slice 2 (`fd9115f`) promoted the eye-closure parabola fit to
// first-class substrate at
// `project.eyeClosureParabolas.variantParabolaPerSideAndSuffix['<side>|<suffix>']`.
// `seedEyeClosure` performs a full REPLACE on every Init Rig, so the
// stored variant map exactly mirrors the variant meshes present at
// Init Rig time. Between deletion of the last variant mesh for a
// suffix and the next Init Rig, the stale entry sits in memory —
// the Blender-fidelity audit's HIGH-5 reference-counting gap.
//
// Slice 3 adds an eager prune-on-delete hook: when a part node is
// deleted via `deleteNode`, any variant suffix that's no longer
// referenced by ANY remaining part gets dropped from
// `variantParabolaPerSideAndSuffix`. Reference-counting integrity:
// the store reflects the variant lifecycle moment-to-moment, not
// "eventually consistent at next Init Rig".
//
// # Contract
//
//   1. Deleting the LAST variant mesh for a suffix prunes that
//      suffix's `'<side>|<suffix>'` entries from
//      `variantParabolaPerSideAndSuffix`. Both 'l|suffix' AND
//      'r|suffix' get cleaned (the suffix is the lookup key, not the
//      side).
//   2. Deleting a variant mesh while a SIBLING with the same suffix
//      remains: NO prune (refCount > 0). The remaining sibling keeps
//      the parabola alive.
//   3. Deleting a NON-variant part: no-op on
//      `variantParabolaPerSideAndSuffix`.
//   4. `baseParabolaPerSide` (the 'l'/'r' base parabolas) is NEVER
//      touched by this prune — only the variant map.
//   5. Safe when `project.eyeClosureParabolas` is `undefined` (lazy-
//      init case) or has empty maps.
//   6. The pure helper `pruneOrphanedVariantParabolas(project)` is
//      idempotent — running it twice produces the same result.
//
// Run: node scripts/test/test_eyeClosureVariantPrune.mjs

import { pruneOrphanedVariantParabolas } from '../../src/io/live2d/rig/eyeClosurePrune.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}

const FIT = (a) => ({ a, b: 0, c: 410, xMid: 400, xScale: 100, sourceTag: 'eyewhite', sampleSource: 'mesh-bin-max', xMin: 300, xMax: 500, sampleCount: 3 });

function buildProjectWithVariants(variantParts) {
  return {
    canvas: { width: 1280, height: 1280 },
    parameters: [],
    nodes: [
      { id: 'eyewhite-l', type: 'part', name: 'eyewhite-l', tag: 'eyewhite-l' },
      { id: 'eyewhite-r', type: 'part', name: 'eyewhite-r', tag: 'eyewhite-r' },
      ...variantParts,
    ],
    eyeClosureParabolas: {
      baseParabolaPerSide: { l: FIT(-10), r: FIT(-10) },
      variantParabolaPerSideAndSuffix: {
        'l|smile': FIT(-12), 'r|smile': FIT(-12),
        'l|angry': FIT(-8),  'r|angry': FIT(-8),
      },
    },
  };
}

// ── Contract 1: delete LAST variant mesh for 'smile' → 'smile' entries pruned ─

{
  const project = buildProjectWithVariants([
    // 'smile' has ONE remaining variant mesh.
    { id: 'eyewhite-l.smile', type: 'part', name: 'eyewhite-l.smile',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'smile' },
    // 'angry' has TWO; one is enough to keep its parabola alive.
    { id: 'eyewhite-l.angry', type: 'part', name: 'eyewhite-l.angry',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'angry' },
    { id: 'eyewhite-r.angry', type: 'part', name: 'eyewhite-r.angry',
      tag: 'eyewhite-r', variantOf: 'eyewhite-r', variantSuffix: 'angry' },
  ]);

  // Simulate the deleteNode side-effect: remove the 'smile' variant
  // from project.nodes BEFORE calling prune (mirrors the real call
  // sequence in projectStore.js's deleteNode).
  project.nodes = project.nodes.filter((n) => n.id !== 'eyewhite-l.smile');
  pruneOrphanedVariantParabolas(project);

  const variantKeys = Object.keys(project.eyeClosureParabolas.variantParabolaPerSideAndSuffix).sort();
  assertEq(variantKeys, ['l|angry', 'r|angry'],
    'Contract 1: last-of-suffix delete prunes BOTH sides of that suffix');
  // 'angry' is still active via two siblings — its parabolas remain.
  assert('l|angry' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix,
    'Contract 1: angry still active → parabola kept');
}

// ── Contract 2: delete one of two variants → no prune (refCount still > 0) ─

{
  const project = buildProjectWithVariants([
    { id: 'eyewhite-l.smile', type: 'part', name: 'eyewhite-l.smile',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'smile' },
    { id: 'eyewhite-r.smile', type: 'part', name: 'eyewhite-r.smile',
      tag: 'eyewhite-r', variantOf: 'eyewhite-r', variantSuffix: 'smile' },
  ]);
  project.nodes = project.nodes.filter((n) => n.id !== 'eyewhite-l.smile');
  pruneOrphanedVariantParabolas(project);

  // 'smile' is still active via eyewhite-r.smile → parabolas kept.
  assert('l|smile' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix,
    'Contract 2: sibling-still-references → l|smile kept');
  assert('r|smile' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix,
    'Contract 2: sibling-still-references → r|smile kept');
}

// ── Contract 3: delete non-variant part → no-op on variant map ─

{
  const project = buildProjectWithVariants([
    { id: 'eyewhite-l.smile', type: 'part', name: 'eyewhite-l.smile',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'smile' },
  ]);
  // Add a non-variant part and remove a base eyewhite (also non-variant).
  project.nodes.push({ id: 'face', type: 'part', name: 'face', tag: 'face' });
  project.nodes = project.nodes.filter((n) => n.id !== 'face');
  pruneOrphanedVariantParabolas(project);

  // 'smile' suffix is still in use — kept.
  // 'angry' has no remaining variant mesh in this fixture → pruned.
  assert('l|smile' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix,
    'Contract 3: non-variant delete didn\'t remove still-referenced smile');
  assert(!('l|angry' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix),
    'Contract 3: angry has no remaining variant mesh in fixture → pruned (orthogonal to non-variant delete)');
}

// ── Contract 4: baseParabolaPerSide is never touched ─

{
  const project = buildProjectWithVariants([
    { id: 'eyewhite-l.smile', type: 'part', name: 'eyewhite-l.smile',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'smile' },
  ]);
  project.nodes = project.nodes.filter((n) => n.id !== 'eyewhite-l.smile');
  pruneOrphanedVariantParabolas(project);

  assert(!!project.eyeClosureParabolas.baseParabolaPerSide?.l,
    'Contract 4: baseParabolaPerSide.l untouched');
  assert(!!project.eyeClosureParabolas.baseParabolaPerSide?.r,
    'Contract 4: baseParabolaPerSide.r untouched');
}

// ── Contract 5: safe when no eyeClosureParabolas / empty maps ─

{
  // Field absent.
  const proj1 = { canvas: { width: 100, height: 100 }, nodes: [] };
  pruneOrphanedVariantParabolas(proj1);
  assert(proj1.eyeClosureParabolas === undefined,
    'Contract 5a: no eyeClosureParabolas → field stays undefined (no invented shape)');

  // Field present, variant map empty.
  const proj2 = {
    canvas: { width: 100, height: 100 }, nodes: [],
    eyeClosureParabolas: { baseParabolaPerSide: { l: FIT(-10) }, variantParabolaPerSideAndSuffix: {} },
  };
  pruneOrphanedVariantParabolas(proj2);
  assertEq(proj2.eyeClosureParabolas.variantParabolaPerSideAndSuffix, {},
    'Contract 5b: empty variant map → empty');
  assert(!!proj2.eyeClosureParabolas.baseParabolaPerSide.l,
    'Contract 5b: base kept on empty-variant project');

  // Null project / non-object — must not crash. Slice-3 audit-fix
  // LOW-3 (2026-05-23): per-arm try/catch + named assert so a throw
  // in one arm registers as a named test failure instead of a process
  // crash that hides the other arms' results.
  const noThrow = (fn, name) => {
    try { fn(); assert(true, name); }
    catch (err) { assert(false, `${name} — threw: ${err?.message ?? err}`); }
  };
  noThrow(() => pruneOrphanedVariantParabolas(null),
    'Contract 5c: pruneOrphanedVariantParabolas(null) does not throw');
  noThrow(() => pruneOrphanedVariantParabolas(undefined),
    'Contract 5d: pruneOrphanedVariantParabolas(undefined) does not throw');
  noThrow(() => pruneOrphanedVariantParabolas('not-a-project'),
    'Contract 5e: pruneOrphanedVariantParabolas("not-a-project") does not throw');
}

// ── Contract 6: idempotence ─────────────────────────────────────────

{
  const project = buildProjectWithVariants([
    { id: 'eyewhite-l.smile', type: 'part', name: 'eyewhite-l.smile',
      tag: 'eyewhite-l', variantOf: 'eyewhite-l', variantSuffix: 'smile' },
  ]);
  project.nodes = project.nodes.filter((n) => n.id !== 'eyewhite-l.smile');
  pruneOrphanedVariantParabolas(project);
  const after1 = JSON.stringify(project.eyeClosureParabolas);
  pruneOrphanedVariantParabolas(project);
  const after2 = JSON.stringify(project.eyeClosureParabolas);
  assertEq(after1, after2,
    'Contract 6: pruneOrphanedVariantParabolas is idempotent');
}

// Contract 7 RETIRED (Slice 4 / v46, 2026-05-23): the `variantRole`
// alias was retired by `v46_variant_role_alias_retirement.js` —
// `variantSuffix` is now the canonical and only suffix field. The
// pre-Slice-4 contract that pinned variantRole back-compat is gone
// because no live project node carries variantRole post-v46.
// Kept as a tombstone so future readers don't re-add it.

// Contract 8 (2026-05-24 RULE-№4 Slice-3 follow-on): normalizeVariants
// is the OTHER mutation path that can drop a `variantSuffix` from a
// part — when the name no longer matches a variant pattern, or when
// the base part is missing. Slice 3's deleteNode prune handled
// node-removal; this contract pins that normalizeVariants ALSO prunes
// orphaned parabola entries at the end of its pass. Scenario: PSD
// re-import after an Init Rig dropped a variant part — normalizeVariants
// drops the variantSuffix; the parabola entry would otherwise leak.
{
  const { normalizeVariants } = await import('../../src/io/variantNormalizer.js');
  // Project: face base + base.smile variant, parabolas populated.
  // Re-import drops the variant from the layer set; normalizeVariants
  // doesn't see the .smile part anymore. (We simulate this by removing
  // the variant part from the project BEFORE re-running normalizeVariants —
  // the field-drop branch at variantNormalizer.js:110/118 only fires
  // when the part is STILL present but has lost its variant pattern.)
  // The realistic re-import scenario: variant part removed entirely.
  // For this contract we use the explicit normalizeVariants entry — the
  // important assertion is "the prune runs at the end."
  const project = {
    nodes: [
      { id: 'face', type: 'part', name: 'face', visible: true },
      // a leftover variant-looking part whose base has been REMOVED →
      // findBasePart returns null → orphan → variantSuffix dropped.
      { id: 'gone.smile', type: 'part', name: 'gone.smile', visible: true,
        variantSuffix: 'smile', variantOf: 'gone-was-here' },
    ],
    eyeClosureParabolas: {
      baseParabolaPerSide: {
        l: { coeffs: [1, 0, 0] },
        r: { coeffs: [1, 0, 0] },
      },
      variantParabolaPerSideAndSuffix: {
        'l|smile': { coeffs: [1, 0, 0] },
        'r|smile': { coeffs: [1, 0, 0] },
      },
    },
  };
  normalizeVariants(project);
  // The orphan branch drops variantSuffix from 'gone.smile' — now no
  // part references suffix 'smile'. Prune at end of normalizeVariants
  // should have cleared both variant parabola entries.
  assert(
    !('l|smile' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix),
    'Contract 8: normalizeVariants prune drops l|smile after variantSuffix drop',
  );
  assert(
    !('r|smile' in project.eyeClosureParabolas.variantParabolaPerSideAndSuffix),
    'Contract 8: normalizeVariants prune drops r|smile after variantSuffix drop',
  );
  // Base parabolas untouched.
  assert(
    !!project.eyeClosureParabolas.baseParabolaPerSide?.l,
    'Contract 8: base parabolas survive normalizeVariants prune',
  );
}

console.log(`\neyeClosureVariantPrune: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
