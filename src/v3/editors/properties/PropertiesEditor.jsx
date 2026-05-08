// @ts-check

/**
 * Blender-port — Properties editor with a tab axis (`space_buttons`
 * pattern from `source/blender/editors/space_buttons/space_buttons.cc`).
 *
 * Layout:
 *   [breadcrumb header           ]
 *   [tab bar | tab content scroll]
 *
 * Tab axis is the left-side icon strip (`PropertiesTabBar`). The active
 * tab determines which sections from `sectionRegistry` render in the
 * scroll area on the right. Sections inside a tab still use
 * `SectionShell` for collapse — Blender's nested-panel pattern (a tab
 * shows several panels, each individually collapsible).
 *
 * Sticky-tab semantics: the user's chosen tab persists across selection
 * changes. When the current tab is no longer visible for the new
 * selection, we fall forward to the first visible tab without mutating
 * the sticky preference — re-selecting a node of the original kind
 * brings the user's preferred tab back.
 *
 * @module v3/editors/properties/PropertiesEditor
 */

import { useEffect, useMemo } from 'react';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { PropertiesTabBar } from './PropertiesTabBar.jsx';
import { tabsFor, sectionsForTab } from './propertiesTabRegistry.jsx';

export function PropertiesEditor() {
  const items = useSelectionStore((s) => s.items);
  const project = useProjectStore((s) => s.project);
  const stickyTab = useEditorStore((s) => s.propertiesActiveTab);
  const setActiveTab = useEditorStore((s) => s.setPropertiesActiveTab);

  const active = items.length > 0 ? items[items.length - 1] : null;

  const visibleTabs = useMemo(
    () => (active ? tabsFor({ active, project }) : []),
    [active, project],
  );

  // Effective active tab — the sticky pref if it's still visible,
  // otherwise fall forward to the first visible tab (Blender behaviour
  // when context changes; the sticky pref isn't overwritten so coming
  // back to the original selection kind restores it).
  const effectiveTab = useMemo(() => {
    if (visibleTabs.length === 0) return null;
    if (visibleTabs.some((t) => t.id === stickyTab)) return stickyTab;
    return visibleTabs[0].id;
  }, [visibleTabs, stickyTab]);

  // When the user moves to a new selection where the sticky tab is
  // hidden, surface the fall-forward tab as the active selection so a
  // subsequent click on a tab button still feels coherent (without this,
  // clicking the same tab the user can already "see active" would do
  // nothing because the slot already had a different value).
  useEffect(() => {
    if (effectiveTab && effectiveTab !== stickyTab) {
      setActiveTab(effectiveTab);
    }
  }, [effectiveTab, stickyTab, setActiveTab]);

  // Hooks must run before any conditional return — `visibleTabIds`
  // is consumed by the JSX below the `if (!active)` early-out path.
  const visibleTabIds = useMemo(
    () => new Set(visibleTabs.map((t) => t.id)),
    [visibleTabs],
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

  const sections = effectiveTab
    ? sectionsForTab({ active, project }, effectiveTab)
    : [];

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

      <div className="flex-1 min-h-0 flex flex-row">
        <PropertiesTabBar visibleTabIds={visibleTabIds} />
        <div className="flex-1 min-w-0 overflow-auto flex flex-col">
          {sections.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">
              No properties to show for this tab.
            </div>
          ) : (
            sections.map((sec) => (
              <div key={sec.id}>{sec.render({ active, project })}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
