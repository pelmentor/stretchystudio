// Phase 1 Stage 1.E D-1 RE-RESOLUTION audit-pin (2026-05-12).
//
// The Stage 1.E close-out's Audit-fix D-1 (`docs/plans/SESSION_CLOSEOUT_
// 2026_05_11_PHASE1_STAGE1E.md`) deferred a "dedicated Animation tab"
// follow-up on the premise that Blender's Animation panel "lives in
// the Data tab via PropertiesAnimationMixin.bl_context = 'data'".
//
// That premise was a misread. `PropertiesAnimationMixin.bl_context =
// "data"` (`reference/blender/scripts/startup/bl_ui/space_properties.py:124`)
// is the mixin's *default*; every concrete subclass overrides it via
// its ButtonsPanel base. `OBJECT_PT_animation` (`properties_object.
// py:618`) inherits `ObjectButtonsPanel.bl_context = "object"` (same
// file line 18) — Blender registers the Object-datablock's Animation
// panel on the **Object** tab, same role as SS's "Item" tab. SS's
// existing Item-tab placement IS the Blender-faithful mirror; Blender
// has no dedicated Animation tab in its Properties navigation.
//
// This pin asserts:
//   1. Item tab carries 'animData' at the LAST position
//      (mirrors `bl_order = PropertyPanel.bl_order - 1`).
//   2. PROPERTIES_TABS does NOT contain a peer 'animation' tab id
//      (Blender has no such tab — adding one would be SS-invented).
//   3. propertiesTabRegistry.jsx Item-tab JSDoc cites
//      `OBJECT_PT_animation` + `properties_object.py:618` +
//      `ObjectButtonsPanel.bl_context = "object"` + the multi-tab
//      landscape (DATA_PT_*_animation / MATERIAL_PT_animation /
//      WORLD_PT_animation / SCENE_PT_animation).
//   4. propertiesTabRegistry.jsx Item-tab JSDoc no longer carries the
//      "dedicated Animation tab" / "peer of Item" framing.
//   5. AnimDataSection.jsx JSDoc cites `OBJECT_PT_animation` as the
//      direct mirror.
//   6. ANIMATION_BLENDER_PARITY_PLAN.md no longer asserts Animation
//      panel "is in Data tab" or "awaits a dedicated 'Animation' tab".
//   7. Past close-outs (1E, 1F-pre, 1F, 1F-post) carry the
//      RE-RESOLUTION annotation pointing at this sub-session's
//      close-out doc.
//
// Run: node scripts/test/test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Note: PROPERTIES_TABS is in a `.jsx` source — Node can't import
// JSX directly, so we string-parse the registry instead. This matches
// the Stage 1.E audit-pin's pattern.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function assertEq(a, b, name) {
  if (a === b || JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`);
}
function readSrc(rel) { return readFileSync(join(REPO, rel), 'utf8'); }

// Flatten JSDoc/line-comment continuations + CRLF so cross-platform
// regex matches work against multi-line prose.
function flatJsdoc(src) {
  return src
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\*\s*/g, ' ')
    .replace(/\n\s*\/\/\s*/g, ' ');
}

// ---- 1. Item tab still carries 'animData' at LAST position ----

{
  const src = readSrc('src/v3/editors/properties/propertiesTabRegistry.jsx');
  // Item tab sectionIds: ['transform', 'visibility', 'partInfo', 'animData']
  // animData MUST be the last entry — mirrors bl_order = PropertyPanel.bl_order - 1.
  assert(
    /sectionIds:\s*\[\s*'transform',\s*'visibility',\s*'partInfo',\s*'animData'\s*\]/.test(src),
    '1.A: Item tab sectionIds = [transform, visibility, partInfo, animData] (animData LAST)',
  );
  // Defensive — pre-rewrite the line was identical, so this also
  // proves the section list survived the doc-only rewrite.
  assert(/id:\s*'item'/.test(src),
    '1.B: PROPERTIES_TABS contains an "item" tab');
}

// ---- 2. NO dedicated 'animation' Properties tab ----

{
  const src = readSrc('src/v3/editors/properties/propertiesTabRegistry.jsx');
  // No tab object with id: 'animation' — we'd add one if Resume Path B
  // had been implemented. Blender has no dedicated Animation tab.
  assert(!/id:\s*'animation'/.test(src),
    '2.A: PROPERTIES_TABS does NOT contain a peer "animation" tab (no `id: \'animation\'`)');
  // Also assert no tab object literally labelled "Animation"
  // (`label: 'Animation'` would be the dedicated-tab label).
  assert(!/^\s*label:\s*'Animation',\s*$/m.test(src),
    '2.B: PROPERTIES_TABS does NOT contain a tab object with `label: \'Animation\'`');
}

// ---- 3. propertiesTabRegistry.jsx cites OBJECT_PT_animation + multi-tab landscape ----

{
  const flat = flatJsdoc(readSrc('src/v3/editors/properties/propertiesTabRegistry.jsx'));
  assert(/OBJECT_PT_animation/.test(flat),
    '3.A: Item-tab JSDoc cites OBJECT_PT_animation');
  assert(/properties_object\.py:618/.test(flat),
    '3.B: Item-tab JSDoc cites properties_object.py:618 (Blender Object Animation panel)');
  assert(/ObjectButtonsPanel/.test(flat),
    '3.C: Item-tab JSDoc cites ObjectButtonsPanel (the bl_context source)');
  assert(/bl_context\s*=\s*"object"/.test(flat),
    '3.D: Item-tab JSDoc cites bl_context = "object" (Object tab mount)');
  assert(/DATA_PT_armature_animation|DATA_PT_mesh_animation|DATA_PT_camera_animation/.test(flat),
    '3.E: Item-tab JSDoc cites at least one DATA_PT_*_animation subclass (multi-tab landscape)');
  assert(/MATERIAL_PT_animation/.test(flat),
    '3.F: Item-tab JSDoc cites MATERIAL_PT_animation (multi-tab landscape)');
  assert(/SCENE_PT_animation/.test(flat),
    '3.G: Item-tab JSDoc cites SCENE_PT_animation (multi-tab landscape)');
  assert(/RE-RESOLVED 2026-05-12/.test(flat),
    '3.H: Item-tab JSDoc carries RE-RESOLVED 2026-05-12 marker');
}

// ---- 4. propertiesTabRegistry.jsx does NOT carry the "dedicated tab" framing ----

{
  const src = readSrc('src/v3/editors/properties/propertiesTabRegistry.jsx');
  // The phrase "cleaner long-term fix is a dedicated 'Animation' tab"
  // was the misread proposal — must be gone.
  assert(!/cleaner long-term fix is a dedicated "Animation" tab/.test(src),
    '4.A: Item-tab JSDoc no longer pitches "cleaner long-term fix is a dedicated Animation tab"');
  // "Queued behind broader Properties tab refactor; see Stage 1.F + Phase 2"
  // was the deferral language — also gone.
  assert(!/Queued behind broader Properties tab refactor/.test(src),
    '4.B: Item-tab JSDoc no longer carries the "Queued behind broader Properties tab refactor" deferral');
  // Sanity: still calls it "Blender mirror" (positive framing) not "deviation"
  const flat = flatJsdoc(src);
  assert(/Blender mirror/.test(flat),
    '4.C: Item-tab JSDoc reframes the block as "Blender mirror" (was "Blender-fidelity deviation")');
}

// ---- 5. AnimDataSection.jsx JSDoc cites OBJECT_PT_animation ----

{
  const flat = flatJsdoc(readSrc('src/v3/editors/properties/sections/AnimDataSection.jsx'));
  assert(/OBJECT_PT_animation/.test(flat),
    '5.A: AnimDataSection JSDoc cites OBJECT_PT_animation as the Blender mirror');
  assert(/properties_object\.py:618/.test(flat),
    '5.B: AnimDataSection JSDoc cites properties_object.py:618');
  assert(/RE-RESOLVED 2026-05-12/.test(flat),
    '5.C: AnimDataSection JSDoc carries the D-1 RE-RESOLUTION marker');
  // The multi-tab landscape brief should appear (full landscape lives
  // in propertiesTabRegistry.jsx, but the section JSDoc names the
  // pattern at minimum).
  assert(/DATA_PT_armature_animation|DATA_PT_\*_animation|MATERIAL_PT_animation|SCENE_PT_animation/.test(flat),
    '5.D: AnimDataSection JSDoc references at least one peer Animation panel subclass');
}

// ---- 6. ANIMATION plan no longer asserts Animation-in-Data-tab / dedicated-Animation-tab ----

{
  const plan = readSrc('docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md');
  // The misread sentence was: "Audit-fix D-1 deferral — Blender's
  // Animation panel is in Data tab via `bl_context = "data"`"
  assert(!/Audit-fix D-1 deferral — Blender's\s+Animation panel is in Data tab/m.test(plan),
    '6.A: Plan no longer asserts "Audit-fix D-1 deferral — Blender\'s Animation panel is in Data tab"');
  // The deferred-implementation pitch must be gone.
  assert(!/awaits a dedicated "Animation"\s+tab in Stage 1\.F \+ Phase 2 entry-gate/m.test(plan),
    '6.B: Plan no longer pitches "dedicated \'Animation\' tab in Stage 1.F + Phase 2 entry-gate"');
  // Positive: cite OBJECT_PT_animation for the §1.E animData entry.
  const planFlat = plan.replace(/\r\n/g, '\n');
  assert(/OBJECT_PT_animation/.test(planFlat),
    '6.C: Plan §1.E animData entry cites OBJECT_PT_animation');
  // RE-RESOLUTION pointer present.
  assert(/RE-RESOLVED 2026-05-12/.test(planFlat),
    '6.D: Plan §1.E animData entry carries the D-1 RE-RESOLVED 2026-05-12 marker');
}

// ---- 7. Past close-outs carry the RE-RESOLUTION annotation pointer ----

{
  const closeoutDocs = [
    'docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md',
    'docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md',
    'docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md',
    'docs/plans/SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1F_POST.md',
  ];
  for (const rel of closeoutDocs) {
    const src = readSrc(rel);
    const tag = rel.split('/').pop();
    assert(/RE-RESOLVED 2026-05-12/.test(src),
      `7.${tag}: ${tag} carries the D-1 RE-RESOLVED 2026-05-12 annotation`);
    assert(/SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION\.md/.test(src),
      `7.${tag}-link: ${tag} links to the new RE-RESOLUTION close-out`);
  }
}

// Note: this audit-pin does NOT assert existence of
// SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md — that
// doc is the LAST commit in the sub-session per established convention
// (substrate → audit-fix → close-out), so substrate-time test runs
// would fail the existence check. The forward references in past
// close-outs (assertion 7) are sufficient to pin the pointer.

// ---- Summary ----

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
