// @ts-check

/**
 * V4 Phase 1 — Properties editor with stacked, contextual sections.
 *
 * Replaces the per-Properties tab strip with a Blender-style scrollable
 * column of collapsible sections. Visibility per section is decided
 * via `sectionRegistry.sectionsFor(ctx)`; all visible sections render
 * simultaneously so the user can see Transform + Mesh + Shape Keys at
 * a glance instead of tabbing between them.
 *
 * Header row at the top: a one-line breadcrumb naming the active node
 * and its type (Blender's Properties Editor mirrors this with an icon
 * + name + parent jump).
 *
 * @module v3/editors/properties/PropertiesEditor
 */

import { useMemo } from 'react';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { sectionsFor } from './sectionRegistry.jsx';

export function PropertiesEditor() {
  const items = useSelectionStore((s) => s.items);
  const project = useProjectStore((s) => s.project);

  const active = items.length > 0 ? items[items.length - 1] : null;

  const sections = useMemo(
    () => (active ? sectionsFor({ active, project }) : []),
    [active, project],
  );

  if (!active) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        <span>Select something to inspect.</span>
      </div>
    );
  }

  const activeNode = active.type === 'part' || active.type === 'group' || active.type === 'deformer'
    ? (project?.nodes ?? []).find((n) => n?.id === active.id) ?? null
    : null;
  const headerName =
    active.type === 'parameter'
      ? active.id
      : (activeNode?.name ?? active.id);
  const headerType = active.type === 'deformer' && activeNode?.deformerKind === 'rotation'
    ? 'rotation'
    : active.type;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b border-border bg-muted/20 shrink-0">
        <div className="text-[11px] text-foreground truncate flex items-center gap-1.5">
          <span className="font-medium">{headerName}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{headerType}</span>
        </div>
        {items.length > 1 ? (
          <div className="text-[10px] text-muted-foreground">
            {items.length} items selected — editing active
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {sections.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            Properties for type{' '}
            <code className="text-foreground">{active.type}</code> coming in
            a later phase.
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.id}>{sec.render({ active, project })}</div>
          ))
        )}
      </div>
    </div>
  );
}
