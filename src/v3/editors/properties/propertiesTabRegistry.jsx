// @ts-check

/**
 * Blender-port — Properties tab registry.
 *
 * Mirrors Blender's `space_buttons` tab axis (the vertical icon strip
 * registered as `RGN_TYPE_NAV_BAR` in
 * `source/blender/editors/space_buttons/space_buttons.cc:1153-1161`,
 * with tabs added via `add_tab(...)` calls at lines 218-252 grouped by
 * `BCONTEXT_SEPARATOR` spacers).
 *
 * Each tab maps to a *bucket of sections* from `sectionRegistry.jsx`.
 * The section registry remains the single source of truth for
 * "does this section apply to the current selection?" — a tab is
 * visible when at least one of its sections is visible. This keeps
 * the tab bar self-syncing as section predicates evolve.
 *
 * Tab ordering follows Blender's grouping:
 *   1. Item                          (Object — Transform / Visibility / Info)
 *   2. Modifiers                     (Modifier stack)
 *   3. Object Data                   (Mesh / Vertex Groups / Shape Keys / Mask)
 *   4. Variant                       (SS-specific — variant↔base linking)
 *   5. Bone                          (bone-group rest + pose)
 *   6. Physics                       (Cubism pendulum config)
 *   7. Deformer                      (info / bindings / keyforms)
 *   8. Parameter                     (range / default)
 *   9. Rig                           (rig stage runners)
 *
 * @module v3/editors/properties/propertiesTabRegistry
 */

import {
  Box,
  Wrench,
  Database,
  Bone,
  Zap,
  UserCircle2,
  Grid3x3,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import { PROPERTIES_SECTIONS, sectionsFor } from './sectionRegistry.jsx';

/**
 * @typedef {import('./sectionRegistry.jsx').SectionContext} SectionContext
 * @typedef {import('./sectionRegistry.jsx').SectionDef} SectionDef
 *
 * @typedef {Object} TabDef
 * @property {string} id
 * @property {string} label
 * @property {React.ReactNode} icon
 * @property {string[]} sectionIds      Ordered list of section ids that
 *                                      live under this tab. Render order
 *                                      matches.
 */

/** @type {TabDef[]} */
export const PROPERTIES_TABS = [
  {
    id: 'item',
    label: 'Item',
    icon: <Box size={14} />,
    // Stage 1.E — `animData` lives under Item (the Object-level
    // metadata tab) so per-Object Action bindings appear alongside
    // transform / visibility / part info. Last position because it
    // mirrors Blender's `bl_order = PropertyPanel.bl_order - 1` —
    // "just above the Custom Properties" panel (SS has no Custom
    // Properties section, so last-in-tab is the equivalent slot).
    //
    // **Blender mirror (Audit-fix D-1 Stage 1.E — RE-RESOLVED
    // 2026-05-12).** The actual Blender mirror is `OBJECT_PT_animation`
    // (`reference/blender/scripts/startup/bl_ui/properties_object.py:618`),
    // which inherits `ObjectButtonsPanel` (`bl_context = "object"`,
    // same file line 18) — Blender registers the Object-datablock's
    // Animation panel on the **Object** tab, not the Data tab. SS's
    // "Item" tab IS Blender's "Object" tab in everything but the label,
    // so Item-tab placement of `animData` is the direct Blender mirror.
    //
    // The mixin (`PropertiesAnimationMixin` at
    // `space_properties.py:124`) defaults to `bl_context = "data"`, but
    // every concrete subclass overrides `bl_context` via its
    // ButtonsPanel base. The mixin's `bl_context` is a placeholder, not
    // the canonical mount-point. Per-datablock-type subclasses:
    //   - `OBJECT_PT_animation`           → Object tab (`bl_context="object"`)
    //   - `DATA_PT_armature_animation`    → Data tab   (`bl_context="data"`)
    //   - `DATA_PT_mesh_animation`        → Data tab
    //   - `DATA_PT_camera_animation`      → Data tab
    //   - `MATERIAL_PT_animation`         → Material tab
    //   - `WORLD_PT_animation`            → World tab
    //   - `SCENE_PT_animation`            → Scene tab
    //   - … (~16 subclasses total across `properties_*.py`)
    //
    // For SS, `node.animData` lives on the Object datablock (parts +
    // groups are Object selectables per Stage 1.A `objectDataAccess.
    // isObject(node)`); there is no separate "data" datablock layer
    // (SS conflates Object + ObData), so `OBJECT_PT_animation` →
    // **Item tab** is the only Blender-faithful mount. The Stage 1.E
    // close-out's "dedicated Animation tab" Resume path was based on
    // a misread of the mixin default — Blender has no dedicated
    // Animation tab in its Properties navigation.
    sectionIds: ['transform', 'visibility', 'partInfo', 'animData'],
  },
  {
    id: 'modifiers',
    label: 'Modifiers',
    icon: <Wrench size={14} />,
    sectionIds: ['modifierStack'],
  },
  {
    id: 'data',
    label: 'Object Data',
    icon: <Database size={14} />,
    sectionIds: ['mesh', 'vertexGroups', 'shapeKeys', 'mask'],
  },
  {
    id: 'variant',
    label: 'Variant',
    icon: <UserCircle2 size={14} />,
    sectionIds: ['variant'],
  },
  {
    id: 'bone',
    label: 'Bone',
    icon: <Bone size={14} />,
    sectionIds: ['bone'],
  },
  {
    id: 'physics',
    label: 'Physics',
    icon: <Zap size={14} />,
    sectionIds: ['physics'],
  },
  {
    id: 'deformer',
    label: 'Deformer',
    icon: <Grid3x3 size={14} />,
    sectionIds: ['deformerInfo', 'deformerBindings', 'deformerKeyforms'],
  },
  {
    id: 'parameter',
    label: 'Parameter',
    icon: <SlidersHorizontal size={14} />,
    sectionIds: ['parameter'],
  },
  {
    id: 'rig',
    label: 'Rig',
    icon: <Workflow size={14} />,
    sectionIds: ['rigStages'],
  },
];

// Compile-time sanity: every sectionId named above must resolve in the
// underlying section registry. Catches drift when a section is renamed
// without updating the tab map. Throws at module load — in DEV the
// failure is loud; in prod the bundler will error before shipping.
const _knownSectionIds = new Set(PROPERTIES_SECTIONS.map((s) => s.id));
for (const tab of PROPERTIES_TABS) {
  for (const sid of tab.sectionIds) {
    if (!_knownSectionIds.has(sid)) {
      throw new Error(
        `[propertiesTabRegistry] tab "${tab.id}" references unknown section "${sid}"`,
      );
    }
  }
}

/**
 * Compute the set of tabs that should appear in the nav bar for a
 * given selection + project snapshot. A tab is visible when at least
 * one of its bound sections is visible.
 *
 * @param {SectionContext} ctx
 * @returns {TabDef[]}
 */
export function tabsFor(ctx) {
  const visibleSectionIds = new Set(sectionsFor(ctx).map((s) => s.id));
  return PROPERTIES_TABS.filter((t) =>
    t.sectionIds.some((sid) => visibleSectionIds.has(sid)),
  );
}

/**
 * Resolve the visible section list for a specific tab in the current
 * selection context. Output order matches `tab.sectionIds`.
 *
 * @param {SectionContext} ctx
 * @param {string} tabId
 * @returns {SectionDef[]}
 */
export function sectionsForTab(ctx, tabId) {
  const tab = PROPERTIES_TABS.find((t) => t.id === tabId);
  if (!tab) return [];
  const visibleSections = sectionsFor(ctx);
  /** @type {SectionDef[]} */
  const out = [];
  for (const sid of tab.sectionIds) {
    const sec = visibleSections.find((s) => s.id === sid);
    if (sec) out.push(sec);
  }
  return out;
}
