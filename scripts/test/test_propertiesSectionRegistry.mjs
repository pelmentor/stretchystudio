// V4 Phase 1 — tests for src/v3/editors/properties/sectionRegistry.jsx
//
// Locks in the predicate logic that decides which Properties sections
// show for a given selection / project state. Replaces the previous
// test_propertiesTabRegistry.mjs (single-tab-strip era).
//
// Run: node scripts/test/test_propertiesSectionRegistry.mjs
//
// We can't import the production registry because it loads JSX (each
// SectionDef.render returns JSX nodes that need a React renderer).
// Instead, replicate the predicate table here verbatim. If the
// production registry's predicates drift from this list, drift surfaces
// as a coverage gap — the regression value is in pinning the contract,
// not duplicating render code.

const SECTIONS = [
  {
    id: 'transform',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
  },
  {
    id: 'visibility',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
  },
  {
    id: 'partInfo',
    isVisible: ({ active }) => active.type === 'part',
  },
  {
    id: 'mesh',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.mesh;
    },
  },
  {
    id: 'vertexGroups',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.mesh;
    },
  },
  {
    id: 'shapeKeys',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.mesh;
    },
  },
  {
    id: 'mask',
    isVisible: ({ active }) => active.type === 'part',
  },
  {
    id: 'variant',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const nodes = project?.nodes ?? [];
      const node = nodes.find((n) => n?.id === active.id);
      if (!node) return false;
      if (node.variantOf) return true;
      return nodes.some((n) => n?.variantOf === active.id);
    },
  },
  {
    id: 'bone',
    isVisible: ({ active, project }) => {
      if (active.type !== 'group') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.boneRole;
    },
  },
  {
    id: 'physics',
    isVisible: ({ active, project }) => {
      if (active.type !== 'group') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.boneRole;
    },
  },
  {
    id: 'deformerInfo',
    isVisible: ({ active }) => active.type === 'deformer',
  },
  {
    id: 'deformerBindings',
    isVisible: ({ active }) => active.type === 'deformer',
  },
  {
    id: 'deformerKeyforms',
    isVisible: ({ active }) => active.type === 'deformer',
  },
  {
    id: 'parameter',
    isVisible: ({ active }) => active.type === 'parameter',
  },
  {
    id: 'rigStages',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
  },
];

function sectionsFor(ctx) {
  return SECTIONS.filter((s) => {
    try { return s.isVisible(ctx); } catch { return false; }
  });
}

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function ids(ctx) {
  return sectionsFor(ctx).map((s) => s.id);
}

// ── Group selection (no boneRole): Transform · Visibility · Rig Stages ──

{
  const got = ids({
    active: { type: 'group', id: 'g1' },
    project: { nodes: [{ id: 'g1', type: 'group' }] },
  });
  assert(JSON.stringify(got) === '["transform","visibility","rigStages"]',
    'plain group: 3 sections in canonical order');
}

// ── Group with boneRole: + Bone + Physics ───────────────────────────

{
  const got = ids({
    active: { type: 'group', id: 'leftElbow' },
    project: { nodes: [{ id: 'leftElbow', type: 'group', boneRole: 'leftElbow' }] },
  });
  assert(JSON.stringify(got) === '["transform","visibility","bone","physics","rigStages"]',
    'bone group: Transform · Visibility · Bone · Physics · Rig Stages');
}

// ── Part with mesh (any state): Vertex Groups always visible ──────

{
  // Post-2026-05-05: Vertex Groups visible for any meshed part —
  // empty-state in the section explains how to bind. Discovery >
  // chrome economy.
  const got = ids({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  });
  assert(JSON.stringify(got) ===
    '["transform","visibility","partInfo","mesh","vertexGroups","shapeKeys","mask","rigStages"]',
    'meshed part: 8 sections (vertexGroups always shows when mesh exists)');
}

// ── Part with bone weights: same set as no-weight meshed part ─────

{
  const got = ids({
    active: { type: 'part', id: 'p1' },
    project: {
      nodes: [{
        id: 'p1', type: 'part',
        mesh: { vertices: [], boneWeights: [0.5], jointBoneId: 'bone1' },
      }],
    },
  });
  assert(JSON.stringify(got) ===
    '["transform","visibility","partInfo","mesh","vertexGroups","shapeKeys","mask","rigStages"]',
    'weighted part: same canonical order — vertexGroups between mesh and shapeKeys');
}

// ── Part WITHOUT mesh: Mesh + Shape Keys gated off ──────────────────

{
  const got = ids({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part' /* no mesh */ }] },
  });
  assert(JSON.stringify(got) === '["transform","visibility","partInfo","mask","rigStages"]',
    'unmeshed part: Mesh + Shape Keys drop, Mask + Rig Stages stay');
}

// ── Deformer selection: only Deformer trio ──────────────────────────

{
  const got = ids({
    active: { type: 'deformer', id: 'BodyXWarp' },
    project: { nodes: [] },
  });
  assert(JSON.stringify(got) === '["deformerInfo","deformerBindings","deformerKeyforms"]',
    'deformer: Info · Bindings · Keyforms');
}

// ── Parameter selection: only Parameter ─────────────────────────────

{
  const got = ids({
    active: { type: 'parameter', id: 'ParamAngleX' },
    project: { nodes: [] },
  });
  assert(JSON.stringify(got) === '["parameter"]',
    'parameter: Parameter only');
}

// ── Unknown selection type: empty ───────────────────────────────────

{
  const got = ids({
    active: { type: 'maskConfig', id: 'm1' },
    project: { nodes: [] },
  });
  assert(got.length === 0, 'unknown type: empty (no applicable sections)');
}

// ── Active not in project: mesh-gated sections drop, others stay ────

{
  const got = ids({
    active: { type: 'part', id: 'p-deleted' },
    project: { nodes: [] },
  });
  assert(JSON.stringify(got) === '["transform","visibility","partInfo","mask","rigStages"]',
    'orphan-part selection: Mesh + Shape Keys drop on missing node');
}

// ── Predicate gets project=null → mesh/shape gated off, others apply ─

{
  const got = ids({
    active: { type: 'part', id: 'p1' },
    project: null,
  });
  assert(JSON.stringify(got) === '["transform","visibility","partInfo","mask","rigStages"]',
    'null project: Mesh + Shape Keys drop, no throws (catch in sectionsFor)');
}

// ── Variant child: Variant section appears ──────────────────────────

{
  const got = ids({
    active: { type: 'part', id: 'face_smile' },
    project: {
      nodes: [
        { id: 'face',       type: 'part', mesh: { vertices: [] } },
        { id: 'face_smile', type: 'part', mesh: { vertices: [] }, variantOf: 'face', variantSuffix: 'smile' },
      ],
    },
  });
  assert(got.includes('variant'), 'variant child: Variant section visible');
  assert(got.indexOf('variant') === 7,
    'variant child: Variant slots between Mask and Rig Stages (canonical order)');
}

// ── Variant base whose children point at it ─────────────────────────

{
  const got = ids({
    active: { type: 'part', id: 'face' },
    project: {
      nodes: [
        { id: 'face',       type: 'part', mesh: { vertices: [] } },
        { id: 'face_smile', type: 'part', variantOf: 'face', variantSuffix: 'smile' },
      ],
    },
  });
  assert(got.includes('variant'),
    'variant base: Variant section visible');
}

// ── Plain part: no Variant section ──────────────────────────────────

{
  const got = ids({
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  });
  assert(!got.includes('variant'), 'plain part: Variant section absent');
}

// ── Variant gated off when active is parameter / deformer ───────────

{
  const got = ids({
    active: { type: 'parameter', id: 'ParamSmile' },
    project: { nodes: [{ id: 'p1', type: 'part', variantOf: 'p2' }] },
  });
  assert(!got.includes('variant'), 'parameter selection: Variant section not applied');
}

// ── Canonical order is stable ───────────────────────────────────────

{
  const ctx = {
    active: { type: 'part', id: 'p1' },
    project: { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [] } }] },
  };
  const a = ids(ctx);
  const b = ids(ctx);
  assert(JSON.stringify(a) === JSON.stringify(b), 'output order is stable');
}

console.log(`propertiesSectionRegistry: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
