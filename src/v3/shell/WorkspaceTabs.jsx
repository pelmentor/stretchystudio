// @ts-check

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

import { Save, FolderOpen, Undo2, Redo2 } from 'lucide-react';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useProjectStore } from '../../store/projectStore.js';
import { getOperator } from '../operators/registry.js';

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
  // Subscribe to hasUnsavedChanges so the save button reflects state.
  const dirty = useProjectStore((s) => s.hasUnsavedChanges);

  function runOp(id) {
    const op = getOperator(id);
    if (!op) return;
    if (op.available && !op.available({ editorType: null })) return;
    try {
      op.exec({ editorType: null });
    } catch (err) {
      if (typeof console !== 'undefined') console.error(`[op ${id}] failed:`, err);
    }
  }

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

      <div className="ml-auto flex items-center gap-0.5">
        <ToolbarButton title="Undo (Ctrl+Z)" onClick={() => runOp('app.undo')}>
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton title="Redo (Ctrl+Shift+Z)" onClick={() => runOp('app.redo')}>
          <Redo2 size={14} />
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton
          title="Open project (.stretch) — Ctrl+O"
          onClick={() => runOp('file.load')}
        >
          <FolderOpen size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Save project (.stretch) — Ctrl+S"
          onClick={() => runOp('file.save')}
        >
          <Save size={14} />
          {dirty ? <span className="ml-0.5 text-primary">·</span> : null}
        </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-7 px-2 inline-flex items-center text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-sm transition-colors"
    >
      {children}
    </button>
  );
}
