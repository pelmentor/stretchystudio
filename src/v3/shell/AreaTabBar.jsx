// @ts-check

/**
 * v3 1A.UX — OPNsense-style tab strip for an Area.
 *
 * Rendered above the editor body. Each tab is a chip; the active
 * one has a brighter "card" background that visually merges into
 * the panel below (no bottom border) — the OPNsense convention.
 *
 * Inactive tabs sit on the muted strip with muted text. Hover
 * brightens them but keeps the merge effect reserved for active.
 *
 * `+` button at the end opens a tiny popover to add another editor
 * tab to this area; `×` on the active tab (only when there's more
 * than one) removes it. Single-tab areas hide the close button.
 *
 * @module v3/shell/AreaTabBar
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { EDITOR_REGISTRY, EDITOR_TYPES } from './editorRegistry.js';

/**
 * @param {Object} props
 * @param {import('../../store/uiV3Store.js').AreaSlot} props.area
 */
export function AreaTabBar({ area }) {
  const setAreaActiveTab = useUIV3Store((s) => s.setAreaActiveTab);
  const addTab           = useUIV3Store((s) => s.addTab);
  const removeTab        = useUIV3Store((s) => s.removeTab);
  const [addOpen, setAddOpen] = useState(false);

  const tabs = area?.tabs ?? [];
  const activeId = area?.activeTabId;

  return (
    <div className="relative h-7 flex items-end pl-1 pr-1 bg-muted/20 border-b border-border select-none">
      {/* Bottom seam — the line every inactive tab visually sits on. */}
      <div className="absolute left-0 right-0 bottom-0 h-px bg-border pointer-events-none" />

      <div className="flex items-end gap-0">
        {tabs.map((tab) => {
          const entry = EDITOR_REGISTRY[tab.editorType];
          const label = entry?.label ?? tab.editorType;
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAreaActiveTab(area.id, tab.id)}
              role="tab"
              aria-selected={active}
              className={
                'relative h-6 px-3 text-[11px] flex items-center gap-1.5 ' +
                'border border-b-0 rounded-t-sm -mb-px transition-colors ' +
                (active
                  ? 'bg-background text-foreground border-border z-10'
                  : 'bg-muted/30 text-muted-foreground border-transparent ' +
                    'hover:bg-muted/60 hover:text-foreground')
              }
            >
              {/* Active tab top accent — primary-color stripe matches */}
              {/* OPNsense's "selected" visual cue. */}
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 top-0 h-0.5 bg-primary rounded-t-sm"
                />
              ) : null}
              <span>{label}</span>
              {active && tabs.length > 1 ? (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${label} tab`}
                  className="text-muted-foreground hover:text-foreground -mr-1.5 ml-0.5 inline-flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(area.id, tab.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      e.preventDefault();
                      removeTab(area.id, tab.id);
                    }
                  }}
                >
                  <X size={10} />
                </span>
              ) : null}
            </button>
          );
        })}

        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            title="Add editor tab"
            aria-label="Add tab"
            className={
              'h-6 w-6 ml-0.5 -mb-px flex items-center justify-center rounded-sm ' +
              'text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors'
            }
          >
            <Plus size={11} />
          </button>
          {addOpen ? (
            <div
              className="absolute left-0 top-7 z-30 min-w-[10rem] py-1 rounded-md border border-border bg-popover shadow-md text-xs"
              onMouseLeave={() => setAddOpen(false)}
            >
              {EDITOR_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    addTab(area.id, t);
                    setAddOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1 hover:bg-muted/60 text-foreground"
                >
                  {EDITOR_REGISTRY[t].label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
