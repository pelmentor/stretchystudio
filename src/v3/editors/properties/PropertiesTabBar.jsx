// @ts-check

/**
 * Blender-port — Properties tab bar.
 *
 * Vertical icon strip on the left edge of the Properties editor.
 * Mirrors Blender's `space_buttons` `RGN_TYPE_NAV_BAR` region
 * (`source/blender/editors/space_buttons/space_buttons.cc:1153-1161`).
 *
 * Active-tab tint uses Blender's `panel_active = 0x4772b3ff` selection
 * blue (`release/datafiles/userdef/userdef_default_theme.c:280-287`),
 * mapped to our theme via the `bg-primary/15` + `text-primary` pair so
 * it follows the user's chosen accent in `discord-light` / `dark` etc.
 *
 * Tab visibility is data-driven from `propertiesTabRegistry.tabsFor`.
 * Hidden tabs aren't rendered (Blender hides irrelevant context tabs;
 * does not gray them).
 *
 * @module v3/editors/properties/PropertiesTabBar
 */

import { Fragment } from 'react';
import { useEditorStore } from '../../../store/editorStore.js';
import { PROPERTIES_TABS } from './propertiesTabRegistry.jsx';

/**
 * @param {Object} props
 * @param {Set<string>} props.visibleTabIds   Pre-computed by the parent
 *                                            (PropertiesEditor) from the
 *                                            current selection so we
 *                                            don't subscribe to project
 *                                            state in this leaf.
 * @param {string|null} [props.effectiveTab]  The currently-rendered tab.
 *                                            Falls back to the sticky
 *                                            pref when the parent's
 *                                            sticky tab is hidden in
 *                                            the current context.
 *                                            Highlight follows what's
 *                                            ACTUALLY showing, not what
 *                                            the user previously clicked.
 */
export function PropertiesTabBar({ visibleTabIds, effectiveTab }) {
  const stickyTab = useEditorStore((s) => s.propertiesActiveTab);
  const setActiveTab = useEditorStore((s) => s.setPropertiesActiveTab);
  const highlightTab = effectiveTab ?? stickyTab;

  // Track whether ANY visible tab has been rendered yet so a leading
  // separator on a hidden subgroup doesn't ghost a divider above the
  // first-visible tab (e.g. when the entire Blender-faithful subgroup
  // is invisible for the current selection).
  let renderedAny = false;
  return (
    <div className="w-8 shrink-0 border-r border-border bg-muted/20 flex flex-col items-stretch py-1 gap-0.5">
      {PROPERTIES_TABS.map((tab) => {
        if (!visibleTabIds.has(tab.id)) return null;
        const isActive = tab.id === highlightTab;
        const showSeparator = tab.separatorBefore && renderedAny;
        renderedAny = true;
        return (
          <Fragment key={tab.id}>
            {showSeparator && (
              <div
                aria-hidden="true"
                className="mx-1.5 my-0.5 h-px bg-border/60"
              />
            )}
            <button
              type="button"
              title={tab.label}
              onClick={() => setActiveTab(tab.id)}
              className={
                `mx-0.5 h-7 flex items-center justify-center rounded-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`
              }
            >
              {tab.icon}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
