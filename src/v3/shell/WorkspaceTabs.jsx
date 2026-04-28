/**
 * v3 Phase 0A — Top workspace switcher.
 *
 * Tabs along the top of the shell. Each tab corresponds to a workspace
 * preset (Layout / Modeling / Rigging / Pose / Animation). Clicking a
 * tab swaps the AreaTree to that workspace's saved layout.
 *
 * Plain buttons styled as tabs — no Radix Tabs primitive because
 * keyboard navigation here is going to be governed by the operator
 * dispatcher (Phase 0A.4) once the keymap exists, so we avoid baking
 * Radix's tab-keyboard semantics in.
 *
 * @module v3/shell/WorkspaceTabs
 */

import React from 'react';
import { useUIV3Store } from '../../store/uiV3Store.js';

/** @type {Array<{id: import('../../store/uiV3Store.js').WorkspaceId, label: string}>} */
const TABS = [
  { id: 'layout',    label: 'Layout' },
  { id: 'modeling',  label: 'Modeling' },
  { id: 'rigging',   label: 'Rigging' },
  { id: 'pose',      label: 'Pose' },
  { id: 'animation', label: 'Animation' },
];

export function WorkspaceTabs() {
  const active = useUIV3Store((s) => s.activeWorkspace);
  const setWorkspace = useUIV3Store((s) => s.setWorkspace);

  return (
    <div className="flex items-center gap-0 px-2 h-9 border-b border-border bg-muted/40 select-none">
      <span className="text-xs font-semibold mr-3 text-muted-foreground">v3</span>
      {TABS.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setWorkspace(tab.id)}
            className={
              'px-3 h-7 text-xs rounded-sm transition-colors ' +
              (on
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50')
            }
            aria-current={on ? 'page' : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
