// @ts-check

/**
 * Blender-style mode compatibility table — port of
 * `mode_compat_test` from `reference/blender/source/blender/editors/object/object_modes.cc`
 * (lines 103–154 in the local clone).
 *
 * # The problem this exists to solve
 *
 * Pre-Phase-2, ModePill / Tab keybind / mode dispatcher each hard-coded
 * "is this mode legal for this selection?" via `if (active.type === 'part')
 * ... else if (active.type === 'group') ...` chains. That worked for the
 * three modes we had, but adding any new mode (sculpt, vertex paint,
 * texture paint, or — eventually — a recovered Armature Edit) means
 * touching every branch of every dispatcher. Worse, the dispatcher logic
 * lived in different files, so two of them could subtly disagree about
 * whether Edit Mode applies to a bone (Pre-Phase-2: ModePill said no,
 * Tab said no, but the global `editorStore.setEditMode('mesh')` was
 * happy to accept the value anyway → ghost state).
 *
 * Phase 2 centralises the compatibility table here. Callers ask
 * `modeCompatTest(dataKind, mode)` and trust the result. Adding a new
 * mode is a single-line table edit; the dispatchers all pick it up.
 *
 * # Deliberate divergences from Blender's table
 *
 * Blender's source allows `OB_MODE_EDIT | OB_MODE_POSE` for `OB_ARMATURE`
 * (object_modes.cc:132–136). SS collapsed Armature Edit into Pose Mode
 * 2026-05-06 (commit `9df561f`); re-added it 2026-05-07 (Blender Armature
 * Alignment plan) with distinct rest-pivot-edit semantics that don't
 * overlap Pose Mode's animation-overlay semantics.
 *
 * SS adds `MODE_BLEND_SHAPE` to the `mesh` row; Blender doesn't have a
 * dedicated mode for shape-key painting (it lives inside Edit Mode +
 * Sculpt Mode's "use shape key" toggle). We surface it as a top-level
 * mode for discoverability.
 *
 * SS `mesh` row also lists `MODE_SCULPT`, `MODE_VERTEX_PAINT`,
 * `MODE_TEXTURE_PAINT` to match Blender's table, but the operators
 * aren't implemented yet — `modeCompatTest('mesh', 'sculpt') === true`
 * is "the table allows it"; entering the mode still requires a real
 * operator (none exists today).
 *
 * # SS mode names
 *
 * Today's `editorStore.editMode` slot uses string identifiers that don't
 * line up 1:1 with Blender's `OB_MODE_*` enum values. We keep SS's
 * names so the migration is a drop-in:
 *
 *   - `null`         — Blender's `OB_MODE_OBJECT`. The "no edit mode"
 *                       state, where transform gizmos drag whole
 *                       objects.
 *   - `'edit'`       — Blender's universal `OB_MODE_EDIT`. Renamed
 *                       from legacy `'mesh'` 2026-05-07 to match
 *                       Blender's taxonomy: one mode value, dispatch
 *                       editor by the active object's dataKind. Works
 *                       for both `mesh` and `armature` (and future
 *                       `curve`) dataKinds.
 *   - `'skeleton'`   — Blender's `OB_MODE_POSE`. SS originally called
 *                       this Skeleton Edit, then collapsed Armature
 *                       Edit into Pose Mode (2026-05-06 commit
 *                       `9df561f`); the slot kept the legacy name.
 *   - `'weightPaint'` — Blender's `OB_MODE_WEIGHT_PAINT`.
 *   - `'blendShape'`  — SS-specific. Blender ships shape-key painting
 *                       inside Edit Mode + a "Sculpt mode on shape key"
 *                       toggle; SS surfaces it as a top-level mode for
 *                       discoverability.
 *
 * # What's NOT here yet
 *
 * - **Sculpt / Vertex Paint / Texture Paint** — defined in the table
 *   below as compatible with `'mesh'` data, but not yet implemented.
 *   `modeCompatTest('mesh', 'sculpt')` returns `true` but no operator
 *   actually enters the mode. Adds when implementations land.
 * - **Armature Edit** — collapsed into Pose Mode 2026-05-06. The table
 *   doesn't list `OB_MODE_EDIT` for armatures so a future re-introduce
 *   needs an explicit table edit + UX policy decision.
 * - **Per-object mode storage** — today `editorStore.editMode` is one
 *   global slot (Blender pattern: per-object `Object.mode`). Phase 2b
 *   will flip the storage.
 *
 * @module modes/modeCompat
 */

/**
 * Object Mode — the "no edit mode" state. SS represents this as
 * `editorStore.editMode === null`. Exported as a named constant so
 * callers can use `MODE_OBJECT` instead of bare `null` for clarity.
 */
export const MODE_OBJECT = null;

/** Blender's universal `OB_MODE_EDIT`. Editor behaviour dispatches by
 *  the active object's data type:
 *    - mesh data     → vertex / UV / triangulation editing
 *    - armature data → bone REST pivot drag (writes node.transform.pivotX/Y)
 *    - curve data    → control-point editing (unimplemented)
 *  Renamed from legacy `MODE_EDIT_MESH` 2026-05-07; the string value is
 *  now `'edit'` (was `'mesh'`). The v25 schema migration rewrites
 *  stored editMode values. */
export const MODE_EDIT = 'edit';
/** @deprecated Use MODE_EDIT. Kept as a value-identical alias for any
 *  call-sites that haven't migrated yet. */
export const MODE_EDIT_MESH = MODE_EDIT;

/** Pose Mode — bone pose drag / rotation, writes to `node.pose.*`. */
export const MODE_POSE = 'skeleton';

/** Weight Paint — per-vertex bone-weight brush. */
export const MODE_WEIGHT_PAINT = 'weightPaint';

/** Blend Shape — paint vertex deltas into a shape key. */
export const MODE_BLEND_SHAPE = 'blendShape';

/** Sculpt — high-density mesh sculpt brushes (unimplemented). */
export const MODE_SCULPT = 'sculpt';

/** Vertex Paint — per-vertex colour brush (unimplemented). */
export const MODE_VERTEX_PAINT = 'vertexPaint';

/** Texture Paint — UV-mapped texture brush (unimplemented). */
export const MODE_TEXTURE_PAINT = 'texturePaint';

/**
 * Compatibility table. `dataKind → Set<mode>`.
 *
 * Every kind allows `MODE_OBJECT` implicitly — that's the default and
 * doesn't need to be listed (the test below short-circuits on it).
 *
 * @type {Record<string, Set<unknown>>}
 */
const COMPAT = {
  mesh: new Set([
    MODE_EDIT,
    MODE_WEIGHT_PAINT,
    MODE_BLEND_SHAPE,
    MODE_SCULPT,
    MODE_VERTEX_PAINT,
    MODE_TEXTURE_PAINT,
  ]),
  armature: new Set([
    MODE_EDIT,   // Blender's universal Edit Mode — bone REST pivot drag.
    MODE_POSE,
  ]),
  empty: new Set([
    // Empties only allow Object Mode. Plain organisational groups
    // (folders) inherit this.
  ]),
  // Deformers aren't Objects in Blender's sense but we surface them
  // here so SelectionStore→ModePill can branch cleanly without falling
  // into 'empty' (which would also be correct, but less intentional).
  deformer: new Set([]),
};

/**
 * Mirror of Blender's `mode_compat_test` — returns true when `mode` is
 * legal for an object whose data-block kind is `dataKind`.
 *
 * `MODE_OBJECT` (null) is universally legal — every data-block can
 * exit edit modes back to Object Mode. Unknown `dataKind` returns
 * false for safety (defensive: `if (!modeCompatTest(...)) reject`).
 *
 * @param {string|null|undefined} dataKind
 * @param {*} mode
 * @returns {boolean}
 */
export function modeCompatTest(dataKind, mode) {
  if (mode === MODE_OBJECT || mode === null || mode === undefined) return true;
  if (!dataKind) return false;
  const set = COMPAT[dataKind];
  if (!set) return false;
  return set.has(mode);
}

/**
 * List the modes this `dataKind` allows (excluding `MODE_OBJECT`,
 * which is universal). Useful for ModePill / dropdown UIs that want
 * to enumerate available modes.
 *
 * Returns a fresh array; callers can sort / filter freely.
 *
 * @param {string|null|undefined} dataKind
 * @returns {Array<*>}
 */
export function modesForDataKind(dataKind) {
  if (!dataKind) return [];
  const set = COMPAT[dataKind];
  if (!set) return [];
  return [...set];
}
