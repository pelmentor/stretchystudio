/**
 * v3 — top header bar.
 *
 * Single-row layout: left → bold "Stretchy Studio" + version badge
 * + file action strip (New / Save / Open / Export / Canvas Props /
 * Settings); center → workspace pills (Edit / Pose / Animation),
 * Setup⇄Animate pill, Undo / Redo, Hot Reload pill; right → gesture
 * hints + Reset Pose.
 *
 * Workspace pills are PURELY layout — clicking them changes which
 * panels are visible and nothing else. Setup⇄Animate (the
 * `editorMode` axis) is its own pill; the Blender-style edit slot
 * (`editMode`: mesh / skeleton / blendShape) lives on the canvas
 * Mode pill. All three axes are independent.
 *
 * @module v3/shell/Topbar
 */

import { useState } from 'react';
import {
  FilePlus, Save, FolderOpen, Download, Settings2,
  SquareChartGantt, Undo2, Redo2, Link2, Unlink,
} from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../../components/ui/tooltip.jsx';
import { cn } from '../../lib/utils.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useAssetHotReloadStore } from '../../store/assetHotReloadStore.js';
import { logger } from '../../lib/logger.js';
import { undoCount, redoCount } from '../../store/undoHistory.js';
import { getOperator } from '../operators/registry.js';
import { isSupported as hotReloadSupported, pickFolderAndWatch } from '../../io/assetHotReload.js';
import { CanvasPropertiesPopover } from './CanvasPropertiesPopover.jsx';
import { PreferencesModal } from './PreferencesModal.jsx';
import { NewProjectDialog } from './NewProjectDialog.jsx';
import { setEditorMode as serviceSetEditorMode } from '../../services/EditorModeService.js';

/** @typedef {{ id: string, label: string, tip: string }} WorkspaceTab */

/** @type {WorkspaceTab[]} */
const WORKSPACES = [
  { id: 'edit',      label: 'Edit',
    tip: 'Edit — panels for setup work: Outliner, Logs, Parameters, Properties.' },
  { id: 'pose',      label: 'Pose',
    tip: 'Pose — same panels as Edit; named for posing workflow.' },
  { id: 'animation', label: 'Animation',
    tip: 'Animation — adds a timeline area at the bottom for keyframing.' },
];

export function Topbar() {
  const dirty            = useProjectStore((s) => s.hasUnsavedChanges);
  // Subscribing to `project` keeps undoCount() / redoCount() in sync —
  // every project mutation pushes a snapshot, so any time the stack
  // changes the project reference also changes and we re-render.
  const project          = useProjectStore((s) => s.project);
  const editorMode       = useEditorStore((s) => s.editorMode);
  const activeWorkspace  = useUIV3Store((s) => s.activeWorkspace);
  const setWorkspace     = useUIV3Store((s) => s.setWorkspace);
  const hotReloadStatus  = useAssetHotReloadStore((s) => s.status);

  const [confirmNew, setConfirmNew] = useState(false);
  const [prefsOpen,  setPrefsOpen]  = useState(false);

  const canUndo = undoCount() > 0;
  const canRedo = redoCount() > 0;

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

  /**
   * Switch workspace. ONLY layout — no mode side-effects.
   *
   * Blender contract (user 2026-05-02): workspaces are layout-only.
   * NOTHING in editorStore changes when a workspace pill is clicked.
   * `editMode`, `editorMode`, `selection`, and `activeBlendShapeId`
   * all persist verbatim. The Setup/Animate (`editorMode`) axis has
   * its own pill (handled by `setEditorMode` from EditorModeService);
   * the Blender-style `editMode` axis has the canvas Mode pill.
   *
   * @param {WorkspaceTab} tab
   */
  function handleWorkspaceClick(tab) {
    // BUG-001 instrumentation — workspace switch is the recurring
    // "character disappears" trigger. Log the transition so the Logs
    // panel captures sequence for diagnosis.
    logger.debug('workspaceSwitch',
      `${activeWorkspace ?? '(none)'} → ${tab.id}`,
      {
        previousWorkspace: activeWorkspace,
        nextWorkspace: tab.id,
      },
    );

    setWorkspace(tab.id);
  }

  async function handleHotReloadClick() {
    const store = useAssetHotReloadStore.getState();
    if (store.handle) { store.stop(); return; }
    if (!hotReloadSupported()) {
      window.alert('Asset hot-reload requires a Chromium-based browser (Chrome / Edge / Brave / Arc).');
      return;
    }
    store.setPending(true);
    try {
      const projectStoreRef = useProjectStore.getState();
      const handle = await pickFolderAndWatch({
        getProject:    () => useProjectStore.getState().project,
        updateProject: (recipe) => projectStoreRef.updateProject(recipe, { skipHistory: true }),
        onChange:      () => useAssetHotReloadStore.getState().bumpLastEvent(),
        onStatus:      (msg) => useAssetHotReloadStore.getState().setMessage(msg),
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

  const stripBtn = 'h-full w-9 rounded-none border-l hover:bg-muted';

  return (
    <header className="h-10 border-b flex items-center px-4 shrink-0 bg-card gap-3 relative">
      {/* Left: logo + version badge + bordered file strip */}
      <div className="flex items-center gap-3 h-full">
        <span className="font-semibold text-sm select-none tracking-tight">Stretchy Studio</span>
        <span className="text-xs text-muted-foreground border border-border/50 px-1.5 py-0.5 font-mono">v0.3</span>

        <div className="flex h-full items-stretch border-l border-r ml-1 mr-2">
          <Button
            variant="ghost" size="icon"
            className="h-full w-9 rounded-none hover:bg-muted"
            onClick={() => setConfirmNew(true)}
            title="New project (Ctrl+N)"
          >
            <FilePlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={cn(stripBtn, 'relative')}
            onClick={() => runOp('file.save')}
            title="Save project (Ctrl+S)"
          >
            <Save className="h-4 w-4" />
            {dirty ? (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary"
              />
            ) : null}
          </Button>
          <Button
            variant="ghost" size="icon"
            className={stripBtn}
            onClick={() => runOp('file.load')}
            title="Open project (Ctrl+O)"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className={stripBtn}
            onClick={() => runOp('file.export')}
            title="Export Live2D (.cmo3 + rig) — Ctrl+E"
          >
            <Download className="h-4 w-4" />
          </Button>
          <CanvasPropertiesPopover>
            <Button
              variant="ghost" size="icon"
              className={stripBtn}
              title="Canvas Properties"
            >
              <SquareChartGantt className="h-4 w-4" />
            </Button>
          </CanvasPropertiesPopover>
          <Button
            variant="ghost" size="icon"
            className={stripBtn}
            onClick={() => setPrefsOpen(true)}
            title="Preferences"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Center: workspace pill + undo/redo, absolutely centered */}
      <TooltipProvider delayDuration={400}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center bg-muted/30 rounded-lg p-0.5 border border-border/40">
          {WORKSPACES.map((tab, i) => {
            const on = tab.id === activeWorkspace;
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => handleWorkspaceClick(tab)}
                    className={cn(
                      'px-3 py-1 rounded-md text-[13px] font-semibold transition-all flex items-center',
                      i > 0 && 'ml-0.5',
                      on
                        ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tab.tip}</TooltipContent>
              </Tooltip>
            );
          })}

          <div className="w-px h-4 bg-border/40 mx-2" />

          {/* Setup/Animate (editorMode) toggle. Independent of workspace
              — clicking a workspace pill no longer changes editorMode.
              The user explicitly picks Setup vs Animate here. Going
              from Setup→Animate captures the current rest pose so
              keyframes don't bake the in-flight pose into rest.
              PP1-005 — small "Mode" label + native `title` tooltips so
              the pair is unmistakably a Setup-vs-Animate toggle (was
              perceived as a non-clickable label without explanation). */}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mr-1.5 select-none">
            Mode
          </span>
          {(/** @type {const} */ (['staging', 'animation'])).map((m, i) => {
            const on = editorMode === m;
            const label = m === 'staging' ? 'Setup' : 'Animate';
            const tip = m === 'staging'
              ? 'Setup — edits modify the rest pose / project structure directly.'
              : 'Animate — edits become timeline keyframes; rest pose is preserved.';
            return (
              <Tooltip key={m}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    title={tip}
                    onClick={() => serviceSetEditorMode(m)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[12px] font-medium transition-all flex items-center',
                      i > 0 && 'ml-0.5',
                      on
                        ? 'bg-primary/80 text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tip}</TooltipContent>
              </Tooltip>
            );
          })}

          <div className="w-px h-4 bg-border/40 mx-2" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 rounded-md hover:bg-muted/80 disabled:opacity-30"
                disabled={!canUndo}
                onClick={() => runOp('app.undo')}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 rounded-md hover:bg-muted/80 disabled:opacity-30 ml-0.5"
                disabled={!canRedo}
                onClick={() => runOp('app.redo')}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Right: spacer + hot reload + gesture hint
          (Reset Pose moved to viewport's top-right corner — see CanvasViewport.jsx) */}
      <div className="flex-1" />

      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={handleHotReloadClick}
            >
              {hotReloadStatus.folderName
                ? <Unlink className="h-3.5 w-3.5" />
                : <Link2  className="h-3.5 w-3.5" />}
              {hotReloadStatus.folderName ? (
                <span className="ml-1 text-[10px] tabular-nums text-primary">
                  {hotReloadStatus.watchedCount}
                </span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hotReloadStatus.folderName
              ? `Watching "${hotReloadStatus.folderName}" (${hotReloadStatus.watchedCount} file${hotReloadStatus.watchedCount === 1 ? '' : 's'}) · click to stop`
              : 'Hot reload — pick a folder of PNGs and the canvas refreshes when files change'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <span className="text-xs text-muted-foreground hidden sm:block ml-1">
        Scroll to zoom · Alt+drag to pan
      </span>

      <PreferencesModal  open={prefsOpen}  onOpenChange={setPrefsOpen} />
      <NewProjectDialog  open={confirmNew} onOpenChange={setConfirmNew} />
    </header>
  );
}
