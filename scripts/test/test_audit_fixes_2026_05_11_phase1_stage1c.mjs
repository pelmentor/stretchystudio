// Phase 1 Stage 1.C audit-fix sweep — pin every FIX in place against
// regression. Sister to scripts/test/test_audit_fixes_2026_05_11_phase1_stage1ab.mjs.
//
// One block per gap: G-N (architecture audit) or D-N (Blender-fidelity
// audit). Combines source-file string-grep checks (catches doc/comment
// regressions) + functional behaviour tests (catches semantic regressions).
//
// Run: node scripts/test/test_audit_fixes_2026_05_11_phase1_stage1c.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getActionUsers,
  assignAction,
  unassignAction,
  cloneAction,
  deleteAction,
} from '../../src/anim/actionRegistry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}

function makeProject() {
  return {
    schemaVersion: 36,
    actions: [
      {
        id: 'a1',
        name: 'Idle',
        fps: 60,
        duration: 1000,
        fcurves: [{
          id: 'fc1',
          rnaPath: 'objects["__params__"].values["X"]',
          arrayIndex: 0,
          keyforms: [{ time: 0, value: 0, easing: 'linear', type: 'linear' }],
          modifiers: [],
          extrapolation: 'linear',
        }],
        audioTracks: [],
        flag: 0,
        meta: { source: 'authored' },
      },
    ],
    nodes: [
      {
        id: 'arm',
        type: 'group',
        animData: {
          actionId: null,
          actionInfluence: 1,
          actionBlendmode: 'replace',
          actionExtendmode: 'hold',
          slotHandle: 0,
          nlaTracks: [],
          drivers: [],
          flag: 0,
        },
      },
    ],
  };
}

// ── G-1/D-2: deep-clone driver.variables + per-variable target ──────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix G-1/D-2'),
    'G-1/D-2: breadcrumb to deep-driver-clone fix retained');
  assert(/variables: Array\.isArray\(fc\.driver\.variables\)/.test(src),
    'G-1/D-2: cloneAction explicitly walks driver.variables[]');
  assert(/target: \{ \.\.\.v\.target \}/.test(src),
    'G-1/D-2: cloneAction explicitly clones per-variable target');

  // Functional: deep-clone independence
  const project = makeProject();
  project.actions[0].fcurves[0].driver = {
    expression: 'var',
    variables: [{ name: 'var', target: { id: 'arm', rnaPath: 'pose.rotation' } }],
  };
  const clone = cloneAction(project, 'a1');
  assert(clone.fcurves[0].driver.variables !== project.actions[0].fcurves[0].driver.variables,
    'G-1/D-2: variables array reference fresh');
  assert(clone.fcurves[0].driver.variables[0].target !== project.actions[0].fcurves[0].driver.variables[0].target,
    'G-1/D-2: per-variable target reference fresh');
  clone.fcurves[0].driver.variables[0].target.rnaPath = 'pose.x';
  assert(project.actions[0].fcurves[0].driver.variables[0].target.rnaPath === 'pose.rotation',
    'G-1/D-2: source unaffected by clone-side target mutation');
}

// ── G-3: projectStore.deleteAction resets activeActionId on match ───────────
{
  const src = readFileSync(join(repoRoot, 'src/store/projectStore.js'), 'utf8');
  assert(src.includes('Audit-fix G-3'),
    'G-3: breadcrumb to cross-store cascade retained');
  assert(src.includes("from './animationStore.js'"),
    'G-3: projectStore imports animationStore for cross-store cascade');
  assert(/animState\.activeActionId === id/.test(src),
    'G-3: deleteAction thunk checks activeActionId vs deleted id');
  assert(/animState\.setActiveActionId\(null\)/.test(src),
    'G-3: deleteAction thunk resets activeActionId to null');
}

// ── G-4: projectStore exposes assignAction/unassignAction/cloneAction thunks
{
  const src = readFileSync(join(repoRoot, 'src/store/projectStore.js'), 'utf8');
  assert(/assignAction: \(objectId, actionId, slot/.test(src),
    'G-4: assignAction thunk shipped');
  assert(/unassignAction: \(objectId\)/.test(src),
    'G-4: unassignAction thunk shipped');
  assert(/cloneAction: \(actionId, newName\)/.test(src),
    'G-4: cloneAction thunk shipped');
  assert(src.includes('registryAssignAction(state.project'),
    'G-4: assignAction thunk delegates to registry');
  assert(src.includes('registryUnassignAction(state.project'),
    'G-4: unassignAction thunk delegates to registry');
  assert(src.includes('registryCloneAction(state.project'),
    'G-4: cloneAction thunk delegates to registry');
}

// ── G-5: cloneAction returns the clone object (not just id) ─────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix G-5'),
    'G-5: breadcrumb to return-shape change retained');
  assert(src.includes('@returns {object|null}'),
    'G-5: JSDoc reflects new return type');

  const project = makeProject();
  const clone = cloneAction(project, 'a1');
  assert(clone && typeof clone === 'object' && typeof clone.id === 'string',
    'G-5: cloneAction returns the cloned action object');
  assert(project.actions[1] === clone,
    'G-5: returned object IS the appended one (no extra find needed)');
}

// ── D-6: integer guard on slot ──────────────────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-6'),
    'D-6: breadcrumb to slot integer guard retained');
  assert(/Number\.isInteger\(slot\)/.test(src),
    'D-6: assignAction guards slot via Number.isInteger');

  const project = makeProject();
  assert(assignAction(project, 'arm', 'a1', 1.5) === false, 'D-6: float slot rejected');
  assert(assignAction(project, 'arm', 'a1', -1) === false, 'D-6: negative slot rejected');
  assert(assignAction(project, 'arm', 'a1', NaN) === false, 'D-6: NaN slot rejected');
  assert(project.nodes[0].animData.actionId === null,
    'D-6: bad slot leaves animData untouched');
}

// ── G-10: dead defensive re-bind block removed ──────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  // The pre-fix comment mentioned "Re-bind in case `actions` was a fresh array"
  assert(!src.includes('Re-bind in case'),
    'G-10: dead defensive re-bind comment removed');
  assert(!/if \(!Array\.isArray\(project\.actions\)\) project\.actions = actions/.test(src),
    'G-10: dead re-bind statement removed');
}

// ── D-1: cloneAction parity-scope deviation documented ──────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-1'),
    'D-1: breadcrumb to clone parity-scope deviation retained');
  assert(src.includes('Phase 4') && src.includes('Phase 6'),
    'D-1: deviation flags Phase 4 NLA + Phase 6 groups follow-up');
}

// ── D-4: assignAction Blender-skipped behaviours documented ─────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-4'),
    'D-4: breadcrumb to skipped-vs-Blender notes retained');
  assert(src.includes('last_slot_identifier'),
    'D-4: deviation lists skipped slot-identifier mirror');
  assert(src.includes('NLA tweak'),
    'D-4: deviation lists NLA tweak-mode guard');
  assert(src.includes('reference count'),
    'D-4: deviation lists reference counting');
}

// ── D-5: unassignAction return divergence from Blender documented ───────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-5'),
    'D-5: breadcrumb to return-divergence documented');
  assert(src.includes("anim_data.cc"),
    'D-5: deviation cites Blender source');
}

// ── D-7: meta.source SS extension documented ────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-7'),
    'D-7: breadcrumb to meta.source SS-extension note retained');
}

// ── D-9: __scene__ read/write asymmetry documented ──────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix D-9'),
    'D-9: breadcrumb to __scene__ asymmetry note retained');
}

// ── G-2/D-8: nlaTracks Phase-4 cascade TODO note ────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix G-2/D-8'),
    'G-2/D-8: breadcrumb to nlaTracks-cascade Phase-4 deferral retained');
  assert(src.includes('nlaTracks'),
    'G-2/D-8: deferral note names nlaTracks');
}

// ── G-6: getActionUsers immer warning strengthened ──────────────────────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix G-6'),
    'G-6: breadcrumb to immer-warning JSDoc retained');
  assert(src.includes('Mutation warning'),
    'G-6: warning header surfaces in JSDoc');
}

// ── G-7: assignAction symmetry note (per-Object policy preserved) ───────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  assert(src.includes('Audit-fix G-7'),
    'G-7: breadcrumb to symmetry note retained');
  assert(src.includes('per-Object') && src.includes('PRESERVED'),
    'G-7: note explains why fields are preserved');

  // Functional: per-Object policy survives re-assign
  const project = makeProject();
  project.nodes[0].animData.actionInfluence = 0.42;
  assignAction(project, 'arm', 'a1');
  assert(project.nodes[0].animData.actionInfluence === 0.42,
    'G-7: actionInfluence policy preserved across assign');
}

// ── D-3: plan doc signatures updated ────────────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md'), 'utf8');
  assert(src.includes('cloneAction(project, actionId, newName) → object | null'),
    'D-3: plan §1.C reflects cloneAction returns action object');
  assert(src.includes('assignAction(project, objectId, actionId, slot=0) → boolean'),
    'D-3: plan §1.C reflects assignAction returns boolean');
  assert(src.includes('matches Blender bool assign_action'),
    'D-3: plan §1.C documents the Blender-faithful boolean returns');
}

// ── D-10: plan doc Stage 1.E entry-gate sub-section ─────────────────────────
{
  const src = readFileSync(join(repoRoot, 'docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md'), 'utf8');
  assert(src.includes('Stage 1.E entry gate'),
    'D-10: plan §1.C lists Stage 1.E consumers (entry-gate sub-section)');
}

// ── G-9: file header documents cloneAction return-shape divergence ──────────
{
  const src = readFileSync(join(repoRoot, 'src/anim/actionRegistry.js'), 'utf8');
  // The new header section "Return shapes follow the Blender helpers'
  // contract rather than the plan's prose" covers this.
  assert(src.includes("Return shapes follow the Blender helpers"),
    'G-9: header documents return-shape divergence from plan');
  assert(src.includes('bpy.data.actions["X"].copy()'),
    'G-9: cloneAction return-shape change tied to Blender Python parity');
}

// ── Functional integration: full lifecycle through projectStore-style flow ──
{
  // Mirror the projectStore thunks' pattern (mutation in place is OK
  // here; we don't have immer in the test harness).
  const project = makeProject();
  // Assign
  assignAction(project, 'arm', 'a1');
  assert(project.nodes[0].animData.actionId === 'a1', 'integ: assigned');
  // Clone
  const clone = cloneAction(project, 'a1');
  assert(getActionUsers(project, clone.id).length === 0,
    'integ: clone unbound');
  assert(getActionUsers(project, 'a1').length === 1,
    'integ: source binding preserved');
  // Delete the SOURCE — cascade should clear arm's binding
  const r = deleteAction(project, 'a1');
  assert(r.removed === true && r.cascaded === 1,
    'integ: delete cascades to bound Object');
  assert(project.nodes[0].animData.actionId === null,
    'integ: arm now unbound');
  // Clone survived
  assert(project.actions.find((a) => a.id === clone.id),
    'integ: clone unaffected by source delete');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'));
process.exit(failed > 0 ? 1 : 0);
