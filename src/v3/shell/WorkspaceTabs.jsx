/**
 * v3 Phase 0A — Top workspace switcher + integrated toolbar.
 *
 * Tabs along the top of the shell select the active workspace
 * preset (Layout / Modeling / Rigging / Pose / Animation). Right
 * side hosts a toolbar restored from upstream's EditorLayout header
 * (Phase 5 update: collapsed Save/Library and Open/Library into
 * single Save and Open buttons that drive the new SaveModal /
 * LoadModal — the modals own the library-vs-download choice now):
 *
 *   File group:  New · Open · Save · Export
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
  Save, FolderOpen, Undo2, Redo2, Download, FilePlus, Settings2,
  Link2, Unlink,
} from 'lucide-react';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useAssetHotReloadStore } from '../../store/assetHotReloadStore.js';
import { getOperator } from '../operators/registry.js';
import { isSupported as hotReloadSupported, pickFolderAndWatch } from '../../io/assetHotReload.js';
import { CanvasPropertiesPopover } from './CanvasPropertiesPopover.jsx';
import { PreferencesModal } from './PreferencesModal.jsx';
import { NewProjectDialog } from './NewProjectDialog.jsx';

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
  const hotReloadStatus = useAssetHotReloadStore((s) => s.status);

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

  async function handleHotReloadClick() {
    const store = useAssetHotReloadStore.getState();
    if (store.handle) {
      store.stop();
      return;
    }
    if (!hotReloadSupported()) {
      window.alert('Asset hot-reload requires a Chromium-based browser (Chrome / Edge / Brave / Arc).');
      return;
    }
    store.setPending(true);
    try {
      const projectStore = useProjectStore.getState();
      const handle = await pickFolderAndWatch({
        getProject: () => useProjectStore.getState().project,
        updateProject: (recipe) => projectStore.updateProject(recipe, { skipHistory: true }),
        onChange: () => useAssetHotReloadStore.getState().bumpLastEvent(),
        onStatus: (msg) => useAssetHotReloadStore.getState().setMessage(msg),
      });
      store.setHandle(handle);
    } catch (err) {
      // The picker rejects with AbortError when the user cancels — silent
      // is the right UX there.
      if (err && err.name !== 'AbortError') {
        store.setMessage(`Hot reload failed: ${(err && err.message) || err}`);
      }
    } finally {
      useAssetHotReloadStore.getState().setPending(false);
    }
  }

  function handleNewClick() {
    // Phase 5 — always open the template picker. The dialog itself
    // shows a dirty-state warning when nodeCount > 0; users with an
    // empty workspace just see the templates and pick one. The old
    // "skip dialog when project is empty" shortcut hid the templates
    // from anyone starting fresh, which is exactly when they're most
    // useful.
    setConfirmNew(true);
    void nodeCount;
  }

  return (
    <div className="relative flex items-end pl-2 pr-1 h-9 pointer-coarse:h-12 bg-muted/40 select-none">
      <div className="absolute left-0 right-0 bottom-0 h-px bg-border pointer-events-none" />

      <span className="text-xs font-semibold mr-3 mb-2 text-muted-foreground self-end">v3</span>

      <div className="flex items-end gap-0">
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setWorkspace(tab.id);
                // Animation workspace flips editorMode so the
                // CanvasViewport tick pulls keyframe overrides + the
                // timeline subscription kicks in. Pose workspace
                // shares 'animation' mode for the same reason — pose
                // is essentially a single-keyframe animation. Other
                // workspaces revert to staging so vertex / param
                // editing happens on the static rest pose.
                const setEditorMode = useEditorStore.getState().setEditorMode;
                if (typeof setEditorMode === 'function') {
                  const animWs = tab.id === 'animation' || tab.id === 'pose';
                  setEditorMode(animWs ? 'animation' : 'staging');
                }
              }}
              role="tab"
              aria-selected={on}
              aria-current={on ? 'page' : undefined}
              className={
                'relative h-7 pointer-coarse:h-10 px-3 pointer-coarse:px-4 text-xs flex items-center ' +
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
          title="Open project — Ctrl+O"
          onClick={() => runOp('file.load')}
        >
          <FolderOpen size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Save project — Ctrl+S"
          onClick={() => runOp('file.save')}
        >
          <Save size={14} />
          {dirty ? <span className="ml-0.5 text-primary">·</span> : null}
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
        <ToolbarButton
          title={
            hotReloadStatus.folderName
              ? `Hot reload — watching "${hotReloadStatus.folderName}" (${hotReloadStatus.watchedCount} file${hotReloadStatus.watchedCount === 1 ? '' : 's'}). Click to stop.`
              : 'Hot reload — pick a folder of PNGs that match part names; the canvas re-renders when any file changes on disk.'
          }
          onClick={handleHotReloadClick}
        >
          {hotReloadStatus.folderName ? <Unlink size={14} /> : <Link2 size={14} />}
          {hotReloadStatus.folderName ? (
            <span className="ml-1 text-[10px] tabular-nums text-primary">
              {hotReloadStatus.watchedCount}
            </span>
          ) : null}
        </ToolbarButton>
        <ToolbarButton title="Preferences" onClick={() => setPrefsOpen(true)}>
          <Settings2 size={14} />
        </ToolbarButton>
      </div>

      <PreferencesModal open={prefsOpen} onOpenChange={setPrefsOpen} />
      <NewProjectDialog open={confirmNew} onOpenChange={setConfirmNew} />
    </div>
  );
}

function ToolbarButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Phase 5 touch+pen: bump to ~44px hit target on coarse pointers
      // (touchscreens / pens) per iOS HIG / Material guidance, while
      // keeping the dense desktop layout for fine pointers.
      className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3 inline-flex items-center text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-sm transition-colors"
    >
      {children}
    </button>
  );
}
