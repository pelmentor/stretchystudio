// @ts-check

/**
 * v3 Phase 1B — Properties editor with internal tab strip.
 *
 * Reads the active item from `selectionStore`. The tabRegistry tells
 * us which Plan §4.2 tabs apply for that selection + project state;
 * we render an in-Properties OPNsense-style mini-tab-strip and the
 * active tab's body underneath.
 *
 * Why a per-Properties tab strip on top of the area-level AreaTabBar:
 * the AreaTabBar swaps EDITORS (Outliner ↔ Parameters); the
 * Properties tab strip swaps the SUBJECT TAB inside the same editor
 * (Object ↔ BlendShapes ↔ Mesh ↔ ...). Different concept, separate
 * strip.
 *
 * @module v3/editors/properties/PropertiesEditor
 */

import { useState, useMemo, useEffect } from 'react';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { tabsFor } from './tabRegistry.jsx';

export function PropertiesEditor() {
  const items = useSelectionStore((s) => s.items);
  const project = useProjectStore((s) => s.project);

  const active = items.length > 0 ? items[items.length - 1] : null;

  const tabs = useMemo(
    () => (active ? tabsFor({ active, project }) : []),
    [active, project],
  );

  // Per-selection-type "last selected tab" memory: pick the first
  // applicable tab on selection-type change; preserve user's choice
  // within a stable selection. Active tab is keyed by selection
  // type so swapping between e.g. parts doesn't reset to Object
  // every time.
  const [activeTabsByType, setActiveTabsByType] = useState(/** @type {Record<string, string>} */ ({}));

  useEffect(() => {
    if (!active || tabs.length === 0) return;
    const current = activeTabsByType[active.type];
    if (!current || !tabs.some((t) => t.id === current)) {
      setActiveTabsByType((prev) => ({ ...prev, [active.type]: tabs[0].id }));
    }
  }, [active, tabs, activeTabsByType]);

  if (!active) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        <span>Select something to inspect.</span>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="h-full w-full flex flex-col">
        {items.length > 1 ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border bg-muted/20">
            {items.length} items selected — editing active ({active.type}: {active.id})
          </div>
        ) : null}
        <div className="p-3 text-xs text-muted-foreground">
          Properties for type{' '}
          <code className="text-foreground">{active.type}</code> coming in
          a later Phase 1B substage.
        </div>
      </div>
    );
  }

  const activeTabId = activeTabsByType[active.type] ?? tabs[0].id;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="h-full w-full flex flex-col">
      {items.length > 1 ? (
        <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border bg-muted/20">
          {items.length} items selected — editing active ({active.type}: {active.id})
        </div>
      ) : null}
      {tabs.length > 1 ? (
        <PropertiesTabStrip
          tabs={tabs}
          activeId={activeTab.id}
          onSelect={(id) =>
            setActiveTabsByType((prev) => ({ ...prev, [active.type]: id }))
          }
        />
      ) : null}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab.render({ active, project })}
      </div>
    </div>
  );
}

function PropertiesTabStrip({ tabs, activeId, onSelect }) {
  return (
    <div className="relative h-7 flex items-end pl-1 pr-1 bg-muted/10 border-b border-border select-none shrink-0">
      <div className="absolute left-0 right-0 bottom-0 h-px bg-border pointer-events-none" />
      <div className="flex items-end gap-0">
        {tabs.map((t) => {
          const on = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              role="tab"
              aria-selected={on}
              className={
                'relative h-6 px-2.5 text-[11px] flex items-center gap-1 ' +
                'border border-b-0 rounded-t-sm -mb-px transition-colors ' +
                (on
                  ? 'bg-background text-foreground border-border z-10'
                  : 'bg-muted/20 text-muted-foreground border-transparent ' +
                    'hover:bg-muted/40 hover:text-foreground')
              }
            >
              {on ? (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 top-0 h-0.5 bg-primary rounded-t-sm"
                />
              ) : null}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
