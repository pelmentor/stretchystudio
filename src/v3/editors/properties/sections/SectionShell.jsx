// @ts-check

/**
 * Blender-faithful section shell.
 *
 * Mirrors Blender's panel chrome from the default theme:
 *   - `panel_header == panel_back == 0x3d3d3dff` (header bg same as
 *     body bg — no contrast band; the header reads as a flat strip
 *     marked only by the chevron + icon + label and a thin outline)
 *   - `panel_outline = 0xffffff11` (faint border)
 *   - `panel_text  = 0xe6e6e6ff`
 * Source: `release/datafiles/userdef/userdef_default_theme.c:280-287`.
 *
 * Pre-2026-05-08 SS used `bg-muted/50` for the header band, which is
 * a Blender deviation (Blender's header is FLAT, not contrasted).
 * Flattened in the Properties tab-axis port.
 *
 * Section-collapse state lives in `editorStore.propertiesSectionsCollapsed`
 * (a Set<string>) so the user's preference persists across selections.
 *
 * @module v3/editors/properties/sections/SectionShell
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../../../../store/editorStore.js';

/**
 * @param {Object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {React.ReactNode=} props.icon
 * @param {React.ReactNode} props.children
 */
export function SectionShell({ id, label, icon, children }) {
  const collapsed = useEditorStore(
    (s) => s.propertiesSectionsCollapsed?.has?.(id) === true,
  );
  const toggle = useEditorStore((s) => s.togglePropertiesSection);

  return (
    <div className="flex flex-col border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => toggle(id)}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide font-medium text-foreground/85 hover:bg-muted/30 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {icon ? (
          <span className="text-muted-foreground/90 flex items-center">{icon}</span>
        ) : null}
        <span>{label}</span>
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-1 px-2 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
}
