// Canvas toolbar declarative-table tests.
//
// Run: node scripts/test/test_canvasToolbar.mjs

import { TOOLS_BY_MODE, toolsFor } from '../../src/v3/shell/canvasToolbar/tools.js';
import { getOperator } from '../../src/v3/operators/registry.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

// ── toolsFor resolves to the right table per editMode ───────────────

assert(toolsFor(null)              === TOOLS_BY_MODE.object,     'null  → object table');
assert(toolsFor('edit')            === TOOLS_BY_MODE.mesh,       'edit (no shape)  → mesh table');
assert(toolsFor('edit', 'shape-1') === TOOLS_BY_MODE.blendShape, 'edit + shape ptr → blendShape table');
assert(toolsFor('pose')            === TOOLS_BY_MODE.skeleton,   'pose  → skeleton table');
// Unknown values fall back to object table (defensive).
assert(toolsFor('unknown')         === TOOLS_BY_MODE.object,     'unknown → object table');
assert(toolsFor(undefined)         === TOOLS_BY_MODE.object,     'undef   → object table');

// ── every entry has the required shape ─────────────────────────────

for (const [modeKey, tools] of Object.entries(TOOLS_BY_MODE)) {
  assert(Array.isArray(tools) && tools.length > 0, `${modeKey}: non-empty list`);
  for (const t of tools) {
    assert(typeof t.id === 'string' && t.id.length > 0, `${modeKey}.${t.id}: id`);
    assert(t.kind === 'tool' || t.kind === 'operator' || t.kind === 'toggle' || t.kind === 'sculpt_brush',
      `${modeKey}.${t.id}: kind ∈ {tool,operator,toggle,sculpt_brush}`);
    assert(typeof t.label === 'string' && t.label.length > 0, `${modeKey}.${t.id}: label`);
    assert(typeof t.icon === 'function' || typeof t.icon === 'object',
      `${modeKey}.${t.id}: icon component`);
    if (t.kind === 'tool') {
      assert(typeof t.toolModeId === 'string' && t.toolModeId.length > 0,
        `${modeKey}.${t.id}: toolModeId required for kind=tool`);
    } else if (t.kind === 'operator') {
      assert(typeof t.operatorId === 'string' && t.operatorId.length > 0,
        `${modeKey}.${t.id}: operatorId required for kind=operator`);
    } else if (t.kind === 'sculpt_brush') {
      assert(typeof t.sculptBrushId === 'string' && t.sculptBrushId.length > 0,
        `${modeKey}.${t.id}: sculptBrushId required for kind=sculpt_brush`);
    } else {
      assert(typeof t.toggleId === 'string' && t.toggleId.length > 0,
        `${modeKey}.${t.id}: toggleId required for kind=toggle`);
    }
  }
}

// ── ids are unique within each mode ────────────────────────────────

for (const [modeKey, tools] of Object.entries(TOOLS_BY_MODE)) {
  const ids = new Set();
  for (const t of tools) {
    assert(!ids.has(t.id), `${modeKey}: duplicate id "${t.id}"`);
    ids.add(t.id);
  }
}

// ── operator entries point at registered operators (no phantom ops) ─

for (const [modeKey, tools] of Object.entries(TOOLS_BY_MODE)) {
  for (const t of tools) {
    if (t.kind !== 'operator') continue;
    const op = getOperator(t.operatorId);
    assert(op !== null, `${modeKey}.${t.id}: operator "${t.operatorId}" registered`);
  }
}

// ── Object Mode: select tool is first; transform.* are operators ────

{
  const obj = TOOLS_BY_MODE.object;
  assert(obj[0]?.id === 'select' && obj[0]?.kind === 'tool',
    'object[0] = sticky Select tool');
  const ops = obj.filter((t) => t.kind === 'operator').map((t) => t.operatorId);
  assert(ops.includes('transform.translate'), 'object includes transform.translate');
  assert(ops.includes('transform.rotate'),    'object includes transform.rotate');
  assert(ops.includes('transform.scale'),     'object includes transform.scale');
}

// ── Mesh: select is default (first), then brush, then add/remove.
//        Toolset Phase 0.E flipped the default to `'select'` (Blender
//        pattern: Edit Mode opens with Select active). Brush stays
//        available behind select.
//        PP1-008(c) — proportional-edit toggle relocated out of the
//        T-panel into ModePill (sibling of the edit-mode picker), so
//        the mesh tool list has no toggle entries anymore.

{
  const mesh = TOOLS_BY_MODE.mesh;
  assert(mesh[0]?.toolModeId === 'select', 'mesh[0] = select (Toolset Phase 0.E)');
  const tids = mesh.filter((t) => t.kind === 'tool').map((t) => t.toolModeId);
  assert(tids.includes('select'),        'mesh includes select');
  assert(tids.includes('brush'),         'mesh includes brush');
  assert(tids.includes('add_vertex'),    'mesh includes add_vertex');
  assert(tids.includes('remove_vertex'), 'mesh includes remove_vertex');
  const toggles = mesh.filter((t) => t.kind === 'toggle');
  assert(toggles.length === 0,
    'mesh tools list has no toggle entries (proportionalEdit moved to ModePill)');
}

// ── Skeleton: Select + Joint Drag tools + G/R/S operators (Slice D) ──

{
  const sk = TOOLS_BY_MODE.skeleton;
  // Select is listed first (Blender pose default is select_box); Joint
  // Drag remains the auto-armed default for now (opt-in Select).
  assert(sk[0].toolModeId === 'select', 'skeleton: Select tool listed first');
  assert(sk.some((t) => t.toolModeId === 'joint_drag'), 'skeleton: Joint Drag still present');
  const ops = sk.filter((t) => t.kind === 'operator').map((t) => t.operatorId);
  assert(
    ['transform.translate', 'transform.rotate', 'transform.scale'].every((id) => ops.includes(id)),
    'skeleton: G/R/S transform operators present',
  );
}

// ── BlendShape: only brush ──────────────────────────────────────────

{
  const bs = TOOLS_BY_MODE.blendShape;
  assert(bs.length === 1 && bs[0].toolModeId === 'brush',
    'blendShape: single brush tool');
}

console.log(`canvasToolbar: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
