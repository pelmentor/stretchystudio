// @ts-check

/**
 * Blender-faithful property row.
 *
 * Mirrors Blender's `layout.use_property_split = True` convention from
 * `release/scripts/startup/bl_ui/properties_*.py` (every Properties
 * panel sets this on the first line of `draw()`). The split factor
 * `UI_ITEM_PROP_SEP_DIVIDE = 0.4f` (interface_layout.cc:79) gives the
 * label column 40 % and the control column 60 % of the row width.
 *
 * Children render into the right-hand control cell. The primitive
 * owns label typography + alignment, so every property row across
 * Properties looks identical regardless of the input widget inside.
 *
 * @module v3/editors/properties/primitives/PropertyRow
 */

/**
 * @param {Object} props
 * @param {string} props.label
 * @param {string=} props.title       Tooltip on the label cell (the
 *                                    "what is this property" hint;
 *                                    Blender shows it as a tooltip).
 * @param {React.ReactNode} props.children  Control widget(s).
 * @param {boolean=} props.alignTop   When the control is multi-line
 *                                    (e.g. a small list), align the
 *                                    label to the top instead of
 *                                    centre. Default false.
 */
export function PropertyRow({ label, title, children, alignTop }) {
  return (
    <div
      className={
        `grid grid-cols-[2fr_3fr] gap-2 ${alignTop ? 'items-start pt-1' : 'items-center'} min-h-[24px] text-xs`
      }
    >
      <span
        className="text-[10.5px] text-muted-foreground truncate"
        title={title ?? label}
      >
        {label}
      </span>
      <div className="min-w-0 flex flex-col gap-1">{children}</div>
    </div>
  );
}
