// @ts-check

/**
 * Lock-down test for v3/editors/timeline/trackListBuilder.js.
 *
 * Covers:
 *   - empty inputs (both null/empty tracks and empty nodes)
 *   - basic transform property (label = "<nodeName> · <prop>")
 *   - mesh_verts → "mesh"
 *   - blendShape:<id> with a matching blendShapes entry → uses shape name
 *   - blendShape:<id> with no matching entry → falls back to id
 *   - sort: rows ordered by node order in `nodes` array, then property
 *   - unknown nodeId falls back to nodeId as label, sorts to end
 *   - bad keyframes payload (non-array) coerces to []
 *   - row id is unique per (nodeId, property, index)
 */

import { buildTrackList, formatPropertyLabel } from '../../src/v3/editors/timeline/trackListBuilder.js';

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${err?.message ?? err}`);
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label ?? 'eq'}\n  actual:   ${a}\n  expected: ${b}`);
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg ?? 'expected truthy');
}

// ── buildTrackList ───────────────────────────────────────────────────

check('empty tracks → []', () => {
  eq(buildTrackList([], []), []);
});

check('null tracks treated as empty', () => {
  eq(buildTrackList(null, [{ id: 'n1' }]), []);
});

check('null nodes does not throw', () => {
  const rows = buildTrackList([{ nodeId: 'n1', property: 'x', keyframes: [] }], null);
  eq(rows.length, 1);
  // Unknown node: label uses nodeId, prop unchanged
  eq(rows[0].label, 'n1 · x');
});

check('basic transform property → "<name> · <prop>"', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'x', keyframes: [{ time: 0, value: 0 }] }],
    [{ id: 'n1', name: 'Hair' }],
  );
  eq(rows.length, 1);
  eq(rows[0].label, 'Hair · x');
  eq(rows[0].keyframes.length, 1);
});

check('mesh_verts → "mesh"', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'mesh_verts', keyframes: [] }],
    [{ id: 'n1', name: 'Face' }],
  );
  eq(rows[0].label, 'Face · mesh');
});

check('blendShape:<id> uses shape name when present', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'blendShape:bs1', keyframes: [] }],
    [{ id: 'n1', name: 'Mouth', blendShapes: [{ id: 'bs1', name: 'Smile' }] }],
  );
  eq(rows[0].label, 'Mouth · blendshape · Smile');
});

check('blendShape:<id> falls back to id when shape absent', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'blendShape:bsX', keyframes: [] }],
    [{ id: 'n1', name: 'Mouth', blendShapes: [] }],
  );
  eq(rows[0].label, 'Mouth · blendshape · bsX');
});

check('rows sort by node order, then property', () => {
  const tracks = [
    { nodeId: 'n2', property: 'x', keyframes: [] },
    { nodeId: 'n1', property: 'rotation', keyframes: [] },
    { nodeId: 'n1', property: 'opacity', keyframes: [] },
    { nodeId: 'n2', property: 'y', keyframes: [] },
  ];
  const nodes = [{ id: 'n1', name: 'A' }, { id: 'n2', name: 'B' }];
  const rows = buildTrackList(tracks, nodes);
  eq(rows.map((r) => r.label), [
    'A · opacity',
    'A · rotation',
    'B · x',
    'B · y',
  ]);
});

check('unknown nodeId sorts to end and uses nodeId as label', () => {
  const tracks = [
    { nodeId: 'ghost', property: 'x', keyframes: [] },
    { nodeId: 'n1', property: 'y', keyframes: [] },
  ];
  const nodes = [{ id: 'n1', name: 'A' }];
  const rows = buildTrackList(tracks, nodes);
  eq(rows.map((r) => r.label), ['A · y', 'ghost · x']);
});

check('bad keyframes coerced to []', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'x', keyframes: 'not-an-array' }],
    [{ id: 'n1', name: 'A' }],
  );
  eq(rows[0].keyframes, []);
});

check('row id is unique per (nodeId, property, index)', () => {
  const rows = buildTrackList(
    [
      { nodeId: 'n1', property: 'x', keyframes: [] },
      { nodeId: 'n1', property: 'x', keyframes: [] },
    ],
    [{ id: 'n1', name: 'A' }],
  );
  ok(rows[0].id !== rows[1].id, 'duplicate ids');
});

check('node without `name` falls back to id', () => {
  const rows = buildTrackList(
    [{ nodeId: 'abc', property: 'x', keyframes: [] }],
    [{ id: 'abc' }],
  );
  eq(rows[0].label, 'abc · x');
});

check('returned rows expose only {id, label, keyframes}', () => {
  const rows = buildTrackList(
    [{ nodeId: 'n1', property: 'x', keyframes: [] }],
    [{ id: 'n1', name: 'A' }],
  );
  const keys = Object.keys(rows[0]).sort();
  eq(keys, ['id', 'keyframes', 'label']);
});

// ── formatPropertyLabel ───────────────────────────────────────────────

check('formatPropertyLabel passes through unknown property', () => {
  eq(formatPropertyLabel('rotation', { id: 'n', blendShapes: [] }), 'rotation');
});

check('formatPropertyLabel handles non-string', () => {
  // @ts-expect-error intentional bad input
  eq(formatPropertyLabel(42, undefined), '42');
});

check('formatPropertyLabel: blendShape with undefined node falls back to id', () => {
  eq(formatPropertyLabel('blendShape:bs1', undefined), 'blendshape · bs1');
});

console.log(`trackListBuilder: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
