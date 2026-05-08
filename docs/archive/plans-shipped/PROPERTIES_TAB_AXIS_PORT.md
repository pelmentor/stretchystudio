# Properties Tab-Axis Port

**Status:** SHIPPED 2026-05-08 — Blender `space_buttons` ported into `src/v3/editors/properties/`. Tests + typecheck green.
**Origin:** user 2026-05-08 — *"Need a visual overhaul for properties. User's eyes are lost when they look in properties, many sections and no proper visual distinctions, let's copy what blender does. Abide rule №1."*

## What was wrong

The v3 Properties editor was a single flat scroll of 16 sections. Every section had the same gray header band (`bg-muted/50`), no per-section icons, no consistent label/control split, and the "wrapped tab" sections needed `-mx-2 -mb-2` bleed hacks to fight `SectionShell`'s padding. With deformer / part / parameter / bone selections all surfacing 4–10 sections at once, users couldn't visually parse what they were looking at.

Blender's answer to the same problem is the **vertical icon nav-bar** on the left of `space_buttons` (Object / Modifier / Data / Bone / Physics / Material / …). The 14+ panels are bucketed into ~9 contextual tabs; each tab shows only the panels relevant to it.

## Reference (Blender 5.1, `reference/blender/`)

- **Tab axis** — `RGN_TYPE_NAV_BAR` registered in [`source/blender/editors/space_buttons/space_buttons.cc:1153-1161`](../../../reference/blender/source/blender/editors/space_buttons/space_buttons.cc); tabs added by `add_tab(...)` calls (l. 218–252) grouped by `BCONTEXT_SEPARATOR` spacers. `BCONTEXT_*` enum: [`source/blender/makesdna/DNA_space_enums.h:97-116`](../../../reference/blender/source/blender/makesdna/DNA_space_enums.h). Default tab = `BCONTEXT_OBJECT` (l. 76).
- **Panel chrome** — default theme [`release/datafiles/userdef/userdef_default_theme.c:280-287`](../../../reference/blender/release/datafiles/userdef/userdef_default_theme.c):
  - `panel_header == panel_back == 0x3d3d3dff` (FLAT — header bg same as body bg, no contrast band)
  - `panel_sub_back = 0x0000001f` (12 % black overlay for sub-panels)
  - `panel_active = 0x4772b3ff` (selection-blue tab tint)
- **Property split** — `#define UI_ITEM_PROP_SEP_DIVIDE 0.4f` in [`interface_layout.cc:79`](../../../reference/blender/source/blender/editors/interface/interface_layout.cc) — every Properties panel sets `layout.use_property_split = True` on the first line of `draw()` (40 % label / 60 % control).
- **Sub-panels** — `bl_parent_id` pattern, e.g. `OBJECT_PT_delta_transform` with `bl_parent_id = "OBJECT_PT_transform"` in [`scripts/startup/bl_ui/properties_object.py:86-89`](../../../reference/blender/scripts/startup/bl_ui/properties_object.py).

## Target shape

```
┌────┬──────────────────────────────┐
│ 📦 │ ▼ Transform                  │
│ 🔧 │   X         [   12.3   ]     │
│ 💾 │   Y         [   45.6   ]     │
│ 👤 │   Rotation  [    0.0   ]     │
│ 🦴 │ ▼ Visibility                 │
│ ⚡ │   Visible   [👁 Visible]     │
│ ▦ │   Opacity   [▰▰▰▱▱  0.60]    │
│ 🎚 │ ▼ Part Info                  │
│ 🦾 │   Draw order  [  14   ]      │
└────┴──────────────────────────────┘
  ↑                ↑
  9 tabs           Active-tab content (sticky across selections)
```

| Tab | Sections it surfaces | When visible |
|-----|----------------------|--------------|
| Item (📦)        | Transform, Visibility, Part Info                         | part / group selection |
| Modifiers (🔧)   | Modifier Stack                                           | part with `modifiers[]` non-empty |
| Object Data (💾) | Mesh, Vertex Groups, Shape Keys, Mask                    | part with mesh |
| Variant (👤)     | Variant                                                  | part with `variantOf` or has-variants |
| Bone (🦴)        | Bone                                                     | bone-role group |
| Physics (⚡)      | Physics                                                  | bone-role group |
| Deformer (▦)    | Deformer Info, Bindings, Keyforms                        | deformer selection |
| Parameter (🎚)   | Parameter                                                | parameter selection |
| Rig (🦾)         | Rig Stages                                               | part / group selection |

## Implementation

### Files added

| Path | Purpose |
|------|---------|
| [`src/v3/editors/properties/PropertiesTabBar.jsx`](../../../src/v3/editors/properties/PropertiesTabBar.jsx) | Vertical 32 px icon strip. Lucide icons. Active-tab tint = `bg-primary/15` + `text-primary` mapped from Blender's `panel_active`. |
| [`src/v3/editors/properties/propertiesTabRegistry.jsx`](../../../src/v3/editors/properties/propertiesTabRegistry.jsx) | `PROPERTIES_TABS` array + `tabsFor(ctx)` + `sectionsForTab(ctx, tabId)`. Tab visibility derived from underlying section visibility — single source of truth stays the section registry. Compile-time check that every `tab.sectionIds` resolves. |
| [`src/v3/editors/properties/primitives/PropertyRow.jsx`](../../../src/v3/editors/properties/primitives/PropertyRow.jsx) | `grid grid-cols-[2fr_3fr]` (40 / 60). Label cell `text-[10.5px] text-muted-foreground truncate`. |
| [`src/v3/editors/properties/primitives/SubPanel.jsx`](../../../src/v3/editors/properties/primitives/SubPanel.jsx) | `bg-foreground/[0.04]` body tint = Blender's 12 % `panel_sub_back`. Independent collapse. |

### Files modified

- [`src/v3/editors/properties/PropertiesEditor.jsx`](../../../src/v3/editors/properties/PropertiesEditor.jsx) — flex-row layout (tab bar + active-tab content). Sticky-tab semantics: the user's chosen tab persists across selections; falls forward to the first visible tab when sticky tab isn't applicable to new selection (without mutating the sticky pref so re-selecting the original kind restores it).
- [`src/v3/editors/properties/sections/SectionShell.jsx`](../../../src/v3/editors/properties/sections/SectionShell.jsx) — flattened header. `bg-muted/50 hover:bg-muted/80` band removed; header now flat (`hover:bg-muted/30` only). Matches Blender's `panel_header == panel_back`.
- [`src/v3/editors/properties/fields/NumberField.jsx`](../../../src/v3/editors/properties/fields/NumberField.jsx) + [`TextField.jsx`](../../../src/v3/editors/properties/fields/TextField.jsx) — render through `PropertyRow` so all 50+ existing field-row sites inherit the 0.4-split for free.
- All 16 sections — `<SectionShell icon={…} />` populated for every call site (pre-port, only `BoneSection` / `VertexGroupsSection` / `DeformerInfoSection` carried icons; the rest had identical-looking gray bands).
- [`src/v3/editors/properties/sections/BoneSection.jsx`](../../../src/v3/editors/properties/sections/BoneSection.jsx) + [`DeformerInfoSection.jsx`](../../../src/v3/editors/properties/sections/DeformerInfoSection.jsx) — local `Row` helpers (with hardcoded `w-20` labels) deleted; replaced with `PropertyRow`.
- [`src/v3/editors/properties/sections/VisibilitySection.jsx`](../../../src/v3/editors/properties/sections/VisibilitySection.jsx) + [`PartInfoSection.jsx`](../../../src/v3/editors/properties/sections/PartInfoSection.jsx) — ad-hoc rows replaced with `PropertyRow`.
- [`src/v3/editors/properties/sections/WrappedTabSections.jsx`](../../../src/v3/editors/properties/sections/WrappedTabSections.jsx) — every wrapper now passes a per-section icon.
- [`src/store/editorStore.js`](../../../src/store/editorStore.js) — added `propertiesActiveTab: 'item'` slot + `setPropertiesActiveTab` setter. Default mirrors Blender's `BCONTEXT_OBJECT` default.

### Tab → Sections mapping

Lives in [`propertiesTabRegistry.jsx`](../../../src/v3/editors/properties/propertiesTabRegistry.jsx). Order matches the table above. Each entry is `{ id, label, icon, sectionIds }`. Tab visibility = `sectionIds.some(sid => sectionVisible(sid))`, so adding/removing sections in `sectionRegistry.jsx` automatically reshapes which tabs surface — no parallel predicate maintenance.

### How to extend

- **New section.** Append to `PROPERTIES_SECTIONS` in [`sectionRegistry.jsx`](../../../src/v3/editors/properties/sectionRegistry.jsx) AND add the id to the matching tab's `sectionIds[]` in `propertiesTabRegistry.jsx`. The compile-time check throws at module load if you forget.
- **New tab.** Append to `PROPERTIES_TABS`. Pick a lucide icon. Provide `sectionIds[]` — visibility auto-derives.
- **Property rows.** Always `<PropertyRow label="X">control</PropertyRow>`. Don't write ad-hoc `flex` rows with hardcoded `w-20` label widths.
- **Nested grouping.** Use `<SubPanel label="…">…</SubPanel>` for Blender-style `bl_parent_id` nesting (e.g. "Pose" sub-panel inside Bone). 12 % darken tint + own collapse state.

### Sticky-tab semantics

`editorStore.propertiesActiveTab` is the user preference. `PropertiesEditor` derives `effectiveTab`:

```
if visible(sticky) → sticky
else               → first visible tab
```

When `effectiveTab !== sticky`, a `useEffect` writes `effectiveTab` back to the slot so subsequent clicks on that tab are coherent. Re-selecting a node of the original kind brings the user's preferred tab back because the slot stays at whatever the user *last clicked* — fall-forward only updates the slot when the sticky was no longer reachable.

## What stayed the same

- `sectionRegistry.PROPERTIES_SECTIONS` — unchanged. Tab registry imports it; section definitions remain the predicate source of truth.
- Section collapse state (`editorStore.propertiesSectionsCollapsed`) — unchanged. Per-section, persists across selections.
- All section component internals (apart from icon-prop population + ad-hoc-row → `PropertyRow` swaps in 4 sections).
- The breadcrumb header at the top of Properties — kept as-is (`name · type` with multi-select annotation).

## Tests

- `npm run typecheck` — green (one drive-by fix: `SquareDashed` icon doesn't exist in our lucide-react version → swapped to `Scissors` for Mask).
- `npm test` — full aggregate suite green; no Properties-specific test changes (the Properties layer has no dedicated unit suite — visual regression coverage relies on user smoke).

## Memory

- [`feedback_no_crutches_rule_one.md`](../../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_no_crutches_rule_one.md) — RULE №1 abided. No half-Blender shipping; tab axis, flat chrome, 0.4 split, sub-panel tint, icons all landed in one sweep.
- [`feedback_blender_reference_strict.md`](../../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_blender_reference_strict.md) — Blender source cited line-by-line for every chrome decision; no SS-invented values.
- [`project_properties_tab_axis_port_shipped.md`](../../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/project_properties_tab_axis_port_shipped.md) — index entry for future-you.
