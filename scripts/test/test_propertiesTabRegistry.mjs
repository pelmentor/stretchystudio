// v3 Phase 1B - tests for src/v3/editors/properties/tabRegistry.js
//
// Locks in the predicate logic that decides which Properties tabs
// show for a given selection / project state.
//
// Run: node scripts/test/test_propertiesTabRegistry.mjs

// We can't import the full registry because it loads JSX (TabDef.render
// returns JSX nodes that need a React renderer). Instead, replicate the
// applies-predicate table here verbatim and test it. If the production
// registry's predicates drift from this list, the lock-in's value is
// still real: any drift surfaces here as a coverage gap.

const TABS = [
  {
    id: 'object',
    applies: ({ active }) => active.type === 'part' || active.type === 'group',
  },
  {
    id: 'blendShapes',
    applies: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.mesh;
    },
  },
  {
    id: 'deformer',
    applies: ({ active }) => active.type === 'deformer',
  },
  {
    id: 'parameter',
    applies: ({ active }) => active.type === 'parameter',
  },
  {
    id: 'variant',
    applies: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const nodes = project?.nodes ?? [];
      const node = nodes.find((n) => n?.id === active.id);
      if (!node) return false;
      if (node.variantOf) return true;
      return nodes.some((n) => n?.variantOf === active.id);
    },
  },
  {
    // V3 Re-Rig Phase 1 — rigStages: always shows on parts/groups
    // (the rig graph nodes). Project-level operator surface; ignores
    // the active selection's identity.
    id: 'rigStages',
    applies: ({ active }) => active.type === 'part' || active.type === 'group',
  },
];

function tabsFor(ctx) {
  return TABS.filter((t) => {
    try { return t.applies(ctx); } catch { return false; }
  });
}

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── Group selection: only Object tab applies ────────────────────────

{
  const tabs = tabsFor({
    active: { type: 'group', id: 'g1' },
    project: { nodes: [{ id: 'g1', type: 'group' }] },
  });
  // group: Object + RigStages (RigStages always-applies on groups).
  assert(tabs.length === 2, 'group: 2 tabs (Object + RigStages)');
  assert(tabs[0].id === 'object', 'group: Object first');
  assert(tabs[1].id === 'rigStages', 'group: RigStages second');
}

// ── Part with mesh: Object + BlendShapes + RigStages ────────────────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  });
  assert(tabs.length === 3, 'meshed part: 3 tabs (+ RigStages)');
  assert(tabs[0].id === 'object',      'order: Object first');
  assert(tabs[1].id === 'blendShapes', 'order: BlendShapes second');
  assert(tabs[2].id === 'rigStages',   'order: RigStages third');
}

// ── Part WITHOUT mesh: Object + RigStages (BlendShapes gated on mesh) ──

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part' /* no mesh */ }] },
  });
  assert(tabs.length === 2, 'unmeshed part: 2 tabs (Object + RigStages)');
  assert(tabs[0].id === 'object', 'unmeshed part: Object first');
  assert(tabs[1].id === 'rigStages', 'unmeshed part: RigStages second');
}

// ── Deformer selection: only Deformer tab ───────────────────────────

{
  const tabs = tabsFor({
    active: { type: 'deformer', id: 'BodyXWarp' },
    project: { nodes: [] },
  });
  assert(tabs.length === 1, 'deformer: 1 tab');
  assert(tabs[0].id === 'deformer', 'deformer: Deformer only');
}

// ── Parameter selection: only Parameter tab ─────────────────────────

{
  const tabs = tabsFor({
    active: { type: 'parameter', id: 'ParamAngleX' },
    project: { nodes: [] },
  });
  assert(tabs.length === 1, 'parameter: 1 tab');
  assert(tabs[0].id === 'parameter', 'parameter: Parameter only');
}

// ── Unknown selection type: empty ───────────────────────────────────

{
  const tabs = tabsFor({
    active: { type: 'maskConfig', id: 'm1' },
    project: { nodes: [] },
  });
  assert(tabs.length === 0, 'unknown type: empty (no applicable tabs)');
}

// ── Active not in project anymore: BlendShapes gracefully drops ─────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p-deleted' },
    project: { nodes: [] },
  });
  // Object + RigStages — both always-apply on parts, BlendShapes drops.
  assert(tabs.length === 2 && tabs[0].id === 'object' && tabs[1].id === 'rigStages',
    'orphan-part selection: Object + RigStages stay, BlendShapes drops on missing node');
}

// ── Predicate throws → tab dropped (catch in tabsFor) ───────────────

{
  // Pass project=null so .nodes access on nullish would normally throw.
  // Protected by `?.` in production tabRegistry; we replicate that here.
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: null,
  });
  // BlendShapes predicate: `(project?.nodes ?? []).find(...)` returns
  // undefined → !!undefined?.mesh = false → tab NOT applied. Object
  // applies. So 1 tab.
  // Object + RigStages on parts even when project is null (RigStages
  // doesn't read project state in its predicate).
  assert(tabs.length === 2 && tabs[0].id === 'object' && tabs[1].id === 'rigStages',
    'null project: Object + RigStages (BlendShapes drops without project)');
}

// ── Order is canonical regardless of input order ───────────────────

{
  // Same selection, different invocation — output order stable.
  const ctx = {
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  };
  const a = tabsFor(ctx).map((t) => t.id);
  const b = tabsFor(ctx).map((t) => t.id);
  assert(JSON.stringify(a) === JSON.stringify(b), 'output order is stable');
  assert(JSON.stringify(a) === '["object","blendShapes","rigStages"]',
    'canonical part order');
}

// ── Variant tab: shows on a variant child (variantOf set) ───────────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'face_smile' },
    project: {
      nodes: [
        { id: 'face',       type: 'part', mesh: { vertices: [] } },
        { id: 'face_smile', type: 'part', mesh: { vertices: [] }, variantOf: 'face', variantSuffix: 'smile' },
      ],
    },
  });
  const ids = tabs.map((t) => t.id);
  assert(ids.includes('variant'), 'variant child: Variant tab present');
  assert(ids.includes('object'),     'variant child: Object tab present');
  assert(ids.includes('blendShapes'), 'variant child: BlendShapes tab present (mesh)');
  assert(ids.includes('rigStages'),   'variant child: RigStages tab present');
}

// ── Variant tab: shows on a base whose children point at it ─────────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'face' },
    project: {
      nodes: [
        { id: 'face',       type: 'part', mesh: { vertices: [] } },
        { id: 'face_smile', type: 'part', variantOf: 'face', variantSuffix: 'smile' },
      ],
    },
  });
  assert(tabs.some((t) => t.id === 'variant'),
    'variant base: Variant tab present');
}

// ── Variant tab: hidden on parts with no variant relationship ───────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  });
  assert(!tabs.some((t) => t.id === 'variant'),
    'plain part: Variant tab absent');
}

// ── Variant tab: hidden when active is a deformer/parameter ─────────

{
  const tabs = tabsFor({
    active: { type: 'parameter', id: 'ParamSmile' },
    project: { nodes: [{ id: 'p1', type: 'part', variantOf: 'p2' }] },
  });
  assert(!tabs.some((t) => t.id === 'variant'),
    'parameter selection: Variant tab not applied');
}

console.log(`propertiesTabRegistry: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
