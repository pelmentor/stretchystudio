/**
 * v3 Phase 0A — Top workspace switcher + integrated toolbar.
 *
 * Tabs along the top of the shell select the active workspace
 * preset (Layout / Modeling / Rigging / Pose / Animation). Right
 * side hosts a toolbar restored from upstream's EditorLayout header
 * (2026-04-29 user feedback: keep the upstream button suite, merge
 * our v3 additions in):
 *
 *   File group:  New · Open file · Save file · Library Open · Library Save · Export
 *   Canvas:      Canvas Properties popover
 *   History:     Undo · Redo
 *   Settings:    Preferences
 *
 * "New" guards the project with an AlertDialog when there are
 * existing nodes — same pattern as upstream — so an accidental
 * click doesn't blow away in-progress work.
 *
 * @module v3/shell/WorkspaceTabs
 */

import { useState } from 'react';
import {
  Save, FolderOpen, Undo2, Redo2, Download, Library, FilePlus, Settings2,
} from 'lucide-react';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useProjectStore } from '../../store/projectStore.js';
import { getOperator } from '../operators/registry.js';
import { CanvasPropertiesPopover } from './CanvasPropertiesPopover.jsx';
import { PreferencesModal } from './PreferencesModal.jsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.jsx';

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
  const dirty = useProjectStore((s) => s.hasUnsavedChanges);
  const nodeCount = useProjectStore((s) => s.project?.nodes?.length ?? 0);

  const [confirmNew, setConfirmNew] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

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

  function handleNewClick() {
    if (nodeCount > 0) setConfirmNew(true);
    else runOp('file.new');
  }

  return (
    <div className="relative flex items-end pl-2 pr-1 h-9 bg-muted/40 select-none">
      <div className="absolute left-0 right-0 bottom-0 h-px bg-border pointer-events-none" />

      <span className="text-xs font-semibold mr-3 mb-2 text-muted-foreground self-end">v3</span>

      <div className="flex items-end gap-0">
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setWorkspace(tab.id)}
              role="tab"
              aria-selected={on}
              aria-current={on ? 'page' : undefined}
              className={
                'relative h-7 px-3 text-xs flex items-center ' +
                'border border-b-0 rounded-t-sm -mb-px transition-colors ' +
                (on
                  ? 'bg-background text-foreground border-border z-10'
                  : 'bg-muted/30 text-muted-foreground border-transparent ' +
                    'hover:bg-muted/60 hover:text-foreground')
              }
            >
              {on ? (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 top-0 h-0.5 bg-primary rounded-t-sm"
                />
              ) : null}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto mb-1 flex items-center gap-0.5">
        <ToolbarButton title="New project (Ctrl+N)" onClick={handleNewClick}>
          <FilePlus size={14} />
        </ToolbarButton>
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
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton
          title="Open from library (IndexedDB)"
          onClick={() => runOp('file.loadFromLibrary')}
        >
          <Library size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Save to library (IndexedDB)"
          onClick={() => runOp('file.saveToLibrary')}
        >
          <Library size={14} />
          <span className="ml-0.5 text-[10px] leading-none">+</span>
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton
          title="Export Live2D (.cmo3 + rig) — Ctrl+E"
          onClick={() => runOp('file.export')}
        >
          <Download size={14} />
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <CanvasPropertiesPopover />
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton title="Undo (Ctrl+Z)" onClick={() => runOp('app.undo')}>
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton title="Redo (Ctrl+Shift+Z)" onClick={() => runOp('app.redo')}>
          <Redo2 size={14} />
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton title="Preferences" onClick={() => setPrefsOpen(true)}>
          <Settings2 size={14} />
        </ToolbarButton>
      </div>

      <PreferencesModal open={prefsOpen} onOpenChange={setPrefsOpen} />

      <AlertDialog open={confirmNew} onOpenChange={setConfirmNew}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the current project?</AlertDialogTitle>
            <AlertDialogDescription>
              {dirty
                ? 'There are unsaved changes. They will be lost. Save first via Ctrl+S or "Save to library", or proceed and start fresh.'
                : 'The current project will be cleared from the workspace. This does not affect saved files or library records.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => runOp('file.new')}>
              Start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
