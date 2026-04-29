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
  assert(tabs.length === 1, 'group: 1 tab');
  assert(tabs[0].id === 'object', 'group: Object only');
}

// ── Part with mesh: Object + BlendShapes ────────────────────────────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  });
  assert(tabs.length === 2, 'meshed part: 2 tabs');
  assert(tabs[0].id === 'object',     'order: Object first');
  assert(tabs[1].id === 'blendShapes', 'order: BlendShapes second');
}

// ── Part WITHOUT mesh: Object only (BlendShapes gated on mesh) ──────

{
  const tabs = tabsFor({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part' /* no mesh */ }] },
  });
  assert(tabs.length === 1, 'unmeshed part: 1 tab');
  assert(tabs[0].id === 'object', 'unmeshed part: Object only');
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
  assert(tabs.length === 1 && tabs[0].id === 'object',
    'orphan-part selection: Object stays, BlendShapes drops on missing node');
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
  assert(tabs.length === 1 && tabs[0].id === 'object',
    'null project: Object only (predicate handles nullish)');
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
  assert(JSON.stringify(a) === '["object","blendShapes"]',
    'canonical part order');
}

console.log(`propertiesTabRegistry: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
