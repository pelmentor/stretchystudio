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
//      direct mirror; cites _animated_id_context_property = "object"
//      (D-8); carries bone-animation deviation callout (D-4); cites
//      slot-selector deferral (D-3); references ≥2 peer subclasses.
//   6. ANIMATION_BLENDER_PARITY_PLAN.md no longer asserts Animation
//      panel "is in Data tab" or "awaits a dedicated 'Animation' tab".
//   7. Past close-outs (1E, 1F-pre, 1F, 1F-post) carry the
//      RE-RESOLUTION annotation pointing at this sub-session's
//      close-out doc — banner present AND misread body scrubbed (G-6).
//   9. Source files carry post-audit refinements: D-2 (bl_order
//      reframed second-to-last), D-7 (ButtonsPanel bases inlined),
//      D-9 (bl_label/bl_options inheritance vs bl_context override),
//      G-10/D-1 (count corrected ~16→20), D-6 (latent armature gap).
//  10. AnimDataSection.jsx D-5 wording softened ("conflates Object +
//      ObData" claim removed; meshData IS a separate node type).
//  11. STAGE1E close-out's audit-fix table cell (G-3) + sweep
//      paragraph (G-4) annotated with RE-RESOLVED.
//  12. STAGE1F_PRE preamble line (G-5) updated.
//  13. Past close-outs Recommended-order lines (G-2) drop B/C entries.
//
// Run: node scripts/test/test_audit_fixes_2026_05_12_phase1_stage1e_d1_reresolution.mjs

import { readFileSync } from 'node:fs';
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
  // Defensive — proves the Object tab survived the 2026-05-16 UI
  // Blender-fidelity sweep that renamed the id from 'item' → 'object'
  // (BCONTEXT_OBJECT canonical Blender enum name).
  assert(/id:\s*'object'/.test(src),
    '1.B: PROPERTIES_TABS contains an "object" tab (renamed from "item" in 2026-05-16 F-3 sweep)');
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
  // 5.D: require ≥2 distinct peer subclass citations (tightened
  // post-audit G-8 — old version was an OR over 4 alternatives that
  // would pass on a single match). The multi-tab landscape brief is
  // the strongest parity signal — keeping at least 2 here ensures a
  // future trim doesn't erode the landscape silently.
  const subclassNames = [
    /DATA_PT_armature_animation/,
    /DATA_PT_mesh_animation/,
    /DATA_PT_camera_animation/,
    /MATERIAL_PT_animation/,
    /WORLD_PT_animation/,
    /SCENE_PT_animation/,
    /TEXTURE_PT_animation/,
    /PARTICLE_PT_animation/,
  ];
  const hits = subclassNames.filter((re) => re.test(flat)).length;
  assert(hits >= 2,
    `5.D: AnimDataSection JSDoc references ≥2 peer Animation panel subclasses (found ${hits} of ${subclassNames.length})`);
  // 5.E: cite _animated_id_context_property = "object" — the
  // strongest parity citation per audit D-8.
  assert(/_animated_id_context_property\s*=\s*"object"/.test(flat),
    '5.E: AnimDataSection JSDoc cites _animated_id_context_property = "object" (D-8)');
  // 5.F: bone-animation deviation callout (audit D-4).
  assert(/[Bb]one-animation deviation/.test(flat),
    '5.F: AnimDataSection JSDoc carries the bone-animation deviation callout (D-4)');
  // 5.G: slot-selector deferral callout (audit D-3).
  assert(/template_action.*half|slot selector.*deferred|template_search.*NOT mirrored/i.test(flat),
    '5.G: AnimDataSection JSDoc clarifies the slot-selector half is deferred (D-3)');
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
//        (positive: banner present + link present)
//        (negative G-6: misread body recommendation REMOVED — banner-
//        only annotation passed audit G-1 because past sweep didn't
//        scrub the body, so this pin enforces removal going forward.)

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
    // Positive — banner + link must be present.
    assert(/RE-RESOLVED 2026-05-12/.test(src),
      `7.${tag}: ${tag} carries the D-1 RE-RESOLVED 2026-05-12 annotation`);
    assert(/SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION\.md/.test(src),
      `7.${tag}-link: ${tag} links to the new RE-RESOLUTION close-out`);
    // Negative (G-6) — the misread body recommendation must be SCRUBBED.
    // Three signature phrases from the original body:
    assert(!/Add a new top-level Properties tab `'animation'`/m.test(src),
      `7.${tag}-no-tab-pitch: ${tag} no longer pitches "Add a new top-level Properties tab 'animation'"`);
    assert(!/Move `'animData'` out of the Item tab `sectionIds`/m.test(src),
      `7.${tag}-no-move-pitch: ${tag} no longer pitches "Move 'animData' out of the Item tab sectionIds"`);
    assert(!/Mirrors Blender's `PropertiesAnimationMixin\.bl_context = "data"`\s+(more faithfully|pattern more faithfully)/m.test(src),
      `7.${tag}-no-mirror-pitch: ${tag} no longer asserts "Mirrors PropertiesAnimationMixin.bl_context = 'data' more faithfully"`);
  }
}

// ---- 9. Source files carry the post-audit refinements (D-2 / D-7 / D-9 / G-10) ----

{
  const reg = readSrc('src/v3/editors/properties/propertiesTabRegistry.jsx');
  const flat = flatJsdoc(reg);
  // D-2: bl_order reframed (second-to-last in Blender, last in SS).
  assert(/second-to-last/.test(flat),
    '9.A: propertiesTabRegistry JSDoc reframes Blender position as "second-to-last" (D-2)');
  assert(/OBJECT_PT_custom_props/.test(flat),
    '9.B: propertiesTabRegistry JSDoc cites OBJECT_PT_custom_props as the actual last-in-tab (D-2)');
  // D-7: ButtonsPanel bases inlined for one-stop verification.
  assert(/ObjectButtonsPanel.*ArmatureButtonsPanel|ArmatureButtonsPanel.*ObjectButtonsPanel/s.test(reg),
    '9.C: propertiesTabRegistry JSDoc inlines the ButtonsPanel base alongside each subclass citation (D-7)');
  // D-9: bl_label/bl_options inheritance vs bl_context override called out.
  assert(/`bl_label = "Animation"`\s+and\s+`bl_options = \{'DEFAULT_CLOSED'\}`\s+ARE inherited/.test(flat),
    '9.D: propertiesTabRegistry JSDoc clarifies bl_label/bl_options are inherited from mixin (D-9)');
  // G-10/D-1: count corrected to 20 (was "~16").
  assert(/20 total across `properties_\*\.py`|20 subclasses/.test(flat),
    '9.E: propertiesTabRegistry JSDoc cites the correct subclass count (20, was "~16")');
  assert(!/~16 subclasses/.test(reg),
    '9.F: propertiesTabRegistry JSDoc no longer carries the "~16 subclasses" undercount');
  // D-6: latent Data-tab armature gap callout.
  assert(/[Ll]atent Data-tab gap/.test(flat),
    '9.G: propertiesTabRegistry JSDoc carries the latent Data-tab armature gap callout (D-6)');
}

// ---- 10. AnimDataSection.jsx carries the post-audit refinements ----

{
  const sec = readSrc('src/v3/editors/properties/sections/AnimDataSection.jsx');
  // D-1/G-10 count
  assert(!/~16 subclasses/.test(sec),
    '10.A: AnimDataSection JSDoc no longer carries the "~16 subclasses" undercount');
  // D-5: soften "conflates Object + ObData"
  assert(!/SS conflates Object \+ ObData/.test(sec),
    '10.B: AnimDataSection JSDoc no longer claims "SS conflates Object + ObData" (D-5 — meshData IS a separate node type)');
}

// ---- 11. STAGE1E close-out audit-fix table cell + sweep paragraph annotated (G-3 / G-4) ----

{
  const stage1e = readSrc('docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md');
  // G-3 — table cell carries the RE-RESOLVED annotation
  assert(/\| D-1 \| HIGH→MED \| Blender-fidelity \|.*RE-RESOLVED 2026-05-12/.test(stage1e),
    '11.A: STAGE1E.md audit-fix table cell for D-1 carries the RE-RESOLVED 2026-05-12 annotation (G-3)');
  // G-4 — sweep paragraph notes RE-RESOLUTION (flatten LF/CRLF + multi-line prose)
  const stage1eFlat = stage1e.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
  assert(/D-1 specifically gets a documented Stage 1\.F \+ Phase 2 entry-gate deferral pending dedicated\s+"Animation" Properties tab\.\s+\(D-1 RE-RESOLVED 2026-05-12/.test(stage1eFlat),
    '11.B: STAGE1E.md audit-fix-sweep paragraph annotates the D-1 deferral as RE-RESOLVED (G-4)');
}

// ---- 12. STAGE1F_PRE preamble line annotated (G-5) ----

{
  const stage1fPre = readSrc('docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md');
  assert(!/D-1 follow-up\s+\(Properties dedicated Animation tab\) remains queued/.test(stage1fPre),
    '12.A: STAGE1F_PRE.md preamble no longer claims "D-1 follow-up remains queued" (G-5)');
  assert(/Stage 1\.E's D-1\s+follow-up was RE-RESOLVED 2026-05-12/.test(stage1fPre),
    '12.B: STAGE1F_PRE.md preamble announces the D-1 RE-RESOLUTION (G-5)');
}

// ---- 13. Past close-outs no longer recommend B/C in Recommended-order (G-2) ----

{
  // STAGE1E.md — Resume Path C is RE-RESOLVED, recommended order should not include C
  const stage1e = readSrc('docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md');
  assert(/A → B\.\s+NodeTree retirement is the smallest decoupled chunk/.test(stage1e),
    '13.A: STAGE1E.md Recommended order is now "A → B" (was "A → B → C") (G-2)');
  // STAGE1F_PRE.md — Resume Path B is RE-RESOLVED, recommended order should not include B
  const stage1fPre = readSrc('docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F_PRE.md');
  assert(/A → C\.\s+The Phase 1 exit gate/.test(stage1fPre),
    '13.B: STAGE1F_PRE.md Recommended order is now "A → C" (was "A → B → C") (G-2)');
  // STAGE1F.md — Resume Path B is RE-RESOLVED
  const stage1f = readSrc('docs/plans/SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1F.md');
  assert(/A → C → D\.\s+Phase 1\.G is the Phase 1 ship gate/.test(stage1f),
    '13.C: STAGE1F.md Recommended order is now "A → C → D" (was "A → (B || C) → D") (G-2)');
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
