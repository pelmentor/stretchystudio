// v3 Phase 0F.38 - tests for src/io/live2d/physics3json.js
//
// generatePhysics3Json builds the runtime physics manifest. Several
// gates filter rules out (UI-disabled categories, tag requirements,
// missing param refs). A bug here means physics either dies on a
// missing param OR silently runs rules the user disabled.
//
// Run: node scripts/test/test_physics3json.mjs

import { generatePhysics3Json } from '../../src/io/live2d/physics3json.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeRule(overrides = {}) {
  return {
    id: 'PS_Test',
    name: 'Test',
    category: 'hair',
    requireTag: null,
    requireAnyTag: null,
    inputs: [
      { paramId: 'ParamAngleZ', weight: 60, type: 'SRC_TO_G_ANGLE', isReverse: false },
    ],
    outputs: [
      { paramId: 'ParamHairFront', vertexIndex: 1, scale: 1.0, isReverse: false },
    ],
    vertices: [
      { x: 0, y: 0, mobility: 1, delay: 1, acceleration: 1, radius: 0 },
      { x: 0, y: 5, mobility: 0.95, delay: 0.9, acceleration: 1.5, radius: 3 },
    ],
    normalization: {
      posMin: -10, posMax: 10, posDef: 0,
      angleMin: -10, angleMax: 10, angleDef: 0,
    },
    ...overrides,
  };
}

// ── Empty rules → header-only output ─────────────────────────────

{
  const r = generatePhysics3Json({});
  assert(r.Version === 3, 'empty: Version = 3');
  assert(r.Meta.PhysicsSettingCount === 0, 'empty: PhysicsSettingCount=0');
  assert(Array.isArray(r.PhysicsSettings) && r.PhysicsSettings.length === 0,
    'empty: PhysicsSettings = []');
}

// ── Basic rule conversion ─────────────────────────────────────────

{
  const r = generatePhysics3Json({
    paramDefs: [
      { id: 'ParamAngleZ' },
      { id: 'ParamHairFront' },
    ],
    meshes: [],
    rules: [makeRule()],
  });
  assert(r.PhysicsSettings.length === 1, 'basic: 1 setting');
  const s = r.PhysicsSettings[0];
  assert(s.Id === 'PS_Test', 'basic: Id pass-through');
  assert(s.Input.length === 1, 'basic: 1 Input');
  assert(s.Input[0].Source.Id === 'ParamAngleZ', 'basic: Input.Source.Id');
  assert(s.Input[0].Type === 'Angle',
    'basic: SRC_TO_G_ANGLE → "Angle"');
  assert(s.Input[0].Weight === 60, 'basic: Input.Weight');
  assert(s.Output.length === 1, 'basic: 1 Output');
  assert(s.Output[0].Destination.Id === 'ParamHairFront',
    'basic: Output.Destination.Id');
  assert(s.Output[0].Weight === 100, 'basic: Output.Weight = 100 (constant)');
  assert(s.Vertices.length === 2, 'basic: vertices preserved');
  assert(s.Vertices[1].Position.Y === 5, 'basic: vertex Y');
  assert(s.Vertices[1].Delay === 0.9, 'basic: vertex Delay');
  assert(s.Normalization.Position.Minimum === -10,
    'basic: Position.Minimum');
}

// ── Input type mapping ────────────────────────────────────────────

{
  for (const [src, expected] of [
    ['SRC_TO_X', 'X'],
    ['SRC_TO_Y', 'Y'],
    ['SRC_TO_G_ANGLE', 'Angle'],
  ]) {
    const r = generatePhysics3Json({
      paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
      rules: [makeRule({
        inputs: [{ paramId: 'ParamAngleZ', weight: 50, type: src }],
      })],
    });
    if (r.PhysicsSettings[0].Input[0].Type !== expected) {
      failed++; console.error(`FAIL: type ${src} → ${expected}`); break;
    }
  }
  passed++;

  // Unknown type defaults to 'Angle'
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    rules: [makeRule({
      inputs: [{ paramId: 'ParamAngleZ', weight: 50, type: 'BANANA' }],
    })],
  });
  assert(r.PhysicsSettings[0].Input[0].Type === 'Angle',
    'type: unknown → Angle default');
}

// ── Reflect (isReverse) ───────────────────────────────────────────

{
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'A' }, { id: 'B' }],
    rules: [makeRule({
      inputs: [{ paramId: 'A', weight: 50, type: 'SRC_TO_X', isReverse: true }],
      outputs: [{ paramId: 'B', vertexIndex: 1, scale: 1, isReverse: true }],
    })],
  });
  assert(r.PhysicsSettings[0].Input[0].Reflect === true, 'reflect: Input');
  assert(r.PhysicsSettings[0].Output[0].Reflect === true, 'reflect: Output');
}

// ── Param-ref gating ─────────────────────────────────────────────

{
  // Input param missing → rule dropped
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamHairFront' }], // no ParamAngleZ
    rules: [makeRule()],
  });
  assert(r.PhysicsSettings.length === 0, 'gate: missing input param drops rule');
}

{
  // Output param missing → rule dropped
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }], // no ParamHairFront
    rules: [makeRule()],
  });
  assert(r.PhysicsSettings.length === 0, 'gate: missing output param drops rule');
}

{
  // No paramDefs supplied → no gating (all rules pass)
  const r = generatePhysics3Json({ paramDefs: [], rules: [makeRule()] });
  assert(r.PhysicsSettings.length === 1,
    'gate: empty paramDefs → no gating, rule passes');
}

// ── Tag gating ────────────────────────────────────────────────────

{
  // requireTag: rule needs 'face' tag, no mesh has it → dropped
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    meshes: [{ tag: 'arm' }],
    rules: [makeRule({ requireTag: 'face' })],
  });
  assert(r.PhysicsSettings.length === 0, 'tag: requireTag missing → dropped');
}

{
  // requireTag: present → kept
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    meshes: [{ tag: 'face' }],
    rules: [makeRule({ requireTag: 'face' })],
  });
  assert(r.PhysicsSettings.length === 1, 'tag: requireTag present → kept');
}

{
  // requireAnyTag: any in list → kept
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    meshes: [{ tag: 'topwear' }],
    rules: [makeRule({ requireAnyTag: ['face', 'topwear', 'hair'] })],
  });
  assert(r.PhysicsSettings.length === 1, 'tag: requireAnyTag matches → kept');
}

{
  // requireAnyTag: none in list → dropped
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    meshes: [{ tag: 'face' }],
    rules: [makeRule({ requireAnyTag: ['hair', 'topwear'] })],
  });
  assert(r.PhysicsSettings.length === 0, 'tag: requireAnyTag no match → dropped');
}

// ── disabledCategories ────────────────────────────────────────────

{
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    rules: [makeRule({ category: 'hair' })],
    disabledCategories: new Set(['hair']),
  });
  assert(r.PhysicsSettings.length === 0,
    'category: disabled → dropped');
}

{
  // Category not in disabled list → kept
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    rules: [makeRule({ category: 'hair' })],
    disabledCategories: new Set(['bust', 'arm']),
  });
  assert(r.PhysicsSettings.length === 1, 'category: not disabled → kept');
}

// ── Outputs[] empty → rule dropped ────────────────────────────────

{
  const r = generatePhysics3Json({
    paramDefs: [{ id: 'ParamAngleZ' }, { id: 'ParamHairFront' }],
    rules: [makeRule({ outputs: [] })],
  });
  assert(r.PhysicsSettings.length === 0, 'outputs: empty → dropped');
}

// ── Meta totals match content ─────────────────────────────────────

{
  const r = generatePhysics3Json({
    paramDefs: [
      { id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' },
    ],
    rules: [
      makeRule({
        id: 'R1',
        inputs: [{ paramId: 'A', weight: 50, type: 'SRC_TO_X' }],
        outputs: [
          { paramId: 'B', vertexIndex: 0, scale: 1 },
          { paramId: 'C', vertexIndex: 1, scale: 1 },
        ],
      }),
      makeRule({
        id: 'R2',
        inputs: [{ paramId: 'A', weight: 50, type: 'SRC_TO_X' }],
        outputs: [{ paramId: 'D', vertexIndex: 0, scale: 1 }],
      }),
    ],
  });
  assert(r.Meta.PhysicsSettingCount === 2, 'meta: settings count');
  assert(r.Meta.TotalInputCount === 2, 'meta: total inputs (1+1)');
  assert(r.Meta.TotalOutputCount === 3, 'meta: total outputs (2+1)');
  // Note: field is VertexCount (not TotalVertexCount) - matches Cubism's schema.
  assert(r.Meta.VertexCount === 4, 'meta: total vertices (2+2)');
}

console.log(`physics3json: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
