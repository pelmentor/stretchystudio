// @ts-check

/**
 * Visual shell for a Properties section. Blender N-panel pattern:
 * header band on top (muted background, foreground-coloured label),
 * flat body underneath, thin divider between sections via the parent
 * container's stacking. No per-section card/rounded border — the
 * panel reads as one continuous column and sections are demarcated
 * by their header bands alone.
 *
 * Section-collapse state lives in `editorStore.propertiesSectionsCollapsed`
 * (a Set<string>) so the user's preference persists across selections
 * (they almost always want the same sections collapsed regardless of
 * which node is active).
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
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide font-medium text-foreground bg-muted/50 hover:bg-muted/80 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {icon ? <span className="text-muted-foreground/90">{icon}</span> : null}
        <span>{label}</span>
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-1.5 px-2 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
}
