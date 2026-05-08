// @ts-check

/**
 * Blender-faithful sub-panel.
 *
 * Maps Blender's `bl_parent_id` nesting pattern (e.g. `OBJECT_PT_delta_transform`
 * with `bl_parent_id = "OBJECT_PT_transform"` in
 * `properties_object.py:86-89`). Sub-panels share the parent's
 * collapse state but tint their body with `panel_sub_back =
 * 0x0000001f` (12 % black overlay) per
 * `release/datafiles/userdef/userdef_default_theme.c:280-287`.
 *
 * Use this for nested groupings inside a top-level section — e.g.
 * "Pose" sub-panel inside the Bone section, or "Bake Settings"
 * inside Modifiers. Top-level sections still use `SectionShell`.
 *
 * @module v3/editors/properties/primitives/SubPanel
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * @param {Object} props
 * @param {string} props.label
 * @param {React.ReactNode=} props.icon
 * @param {boolean=} props.defaultOpen   Default true (mirrors Blender's
 *                                       sub-panel default-open behaviour
 *                                       unless `bl_options = {'DEFAULT_CLOSED'}`).
 * @param {React.ReactNode} props.children
 */
export function SubPanel({ label, icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col rounded-sm bg-foreground/[0.04] border border-border/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium text-foreground/85 hover:bg-foreground/[0.04] select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {icon ? <span className="text-muted-foreground/90">{icon}</span> : null}
        <span>{label}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 px-2 py-1.5">{children}</div>
      ) : null}
    </div>
  );
}
