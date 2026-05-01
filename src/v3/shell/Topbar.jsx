/**
 * v3 — top header bar.
 *
 * Single-row layout modeled on upstream's EditorLayout header so
 * users land in a familiar visual language: bold "Stretchy Studio"
 * + boxed version badge on the left, a single bordered strip of
 * file actions (New / Save / Open / Export / Canvas Properties /
 * Settings), a centered workspace pill flanked by Undo/Redo, our
 * Hot Reload pill (ours-only), and the right-side gesture hint.
 *
 * The center pill carries the 5 v3 workspace presets — Layout /
 * Modeling / Rigging / Pose / Animation. Each preset is a panel
 * arrangement consumed by AreaTree (see `uiV3Store.workspaces`),
 * AND it implies an editor mode: Pose+Animation switch the editor
 * to `'animation'` (timeline keyframes record, rest pose is
 * preserved); the other three switch to `'staging'` (edits modify
 * the rest pose / rig directly). The implicit coupling matches the
 * panel layouts themselves — Modeling/Rigging don't expose a
 * timeline, so being "in animation mode while in Modeling" had no
 * observable effect; the previous independent Staging/Animation
 * pill was theoretical UX with no real workflow behind it.
 *
 * `captureRestPose` fires only on the *transition* into animation
 * mode (clicking Pose or Animation while in a staging workspace),
 * so re-clicking the active workspace doesn't re-snapshot the rest
 * pose.
 *
 * @module v3/shell/Topbar
 */

import { useState } from 'react';
import {
  FilePlus, Save, FolderOpen, Download, Settings2,
  SquareChartGantt, Undo2, Redo2, Link2, Unlink, RotateCcw,
} from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../../components/ui/tooltip.jsx';
import { cn } from '../../lib/utils.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { useParamValuesStore } from '../../store/paramValuesStore.js';
import { useAssetHotReloadStore } from '../../store/assetHotReloadStore.js';
import { undoCount, redoCount } from '../../store/undoHistory.js';
import { getOperator } from '../operators/registry.js';
import { isSupported as hotReloadSupported, pickFolderAndWatch } from '../../io/assetHotReload.js';
import { CanvasPropertiesPopover } from './CanvasPropertiesPopover.jsx';
import { PreferencesModal } from './PreferencesModal.jsx';
import { NewProjectDialog } from './NewProjectDialog.jsx';

/** @typedef {{ id: string, label: string, mode: 'staging'|'animation', tip: string }} WorkspaceTab */

/** @type {WorkspaceTab[]} */
const WORKSPACES = [
  { id: 'layout',    label: 'Layout',    mode: 'staging',
    tip: 'Layout — arrange panels and inspect scene structure. Edits target the rest pose.' },
  { id: 'modeling',  label: 'Modeling',  mode: 'staging',
    tip: 'Modeling — edit mesh geometry and topology. Edits target the rest pose.' },
  { id: 'rigging',   label: 'Rigging',   mode: 'staging',
    tip: 'Rigging — set up bones, deformers, and parameter rigs. Edits target the rest pose.' },
  { id: 'pose',      label: 'Pose',      mode: 'animation',
    tip: 'Pose — pose the rig at a single keyframe. Edits become timeline keyframes; rest pose is preserved.' },
  { id: 'animation', label: 'Animation', mode: 'animation',
    tip: 'Animation — author full timelines. Edits become timeline keyframes; rest pose is preserved.' },
];

export function Topbar() {
  const dirty            = useProjectStore((s) => s.hasUnsavedChanges);
  // Subscribing to `project` keeps undoCount() / redoCount() in sync —
  // every project mutation pushes a snapshot, so any time the stack
  // changes the project reference also changes and we re-render.
  const project          = useProjectStore((s) => s.project);
  const editorMode       = useEditorStore((s) => s.editorMode);
  const setEditorMode    = useEditorStore((s) => s.setEditorMode);
  const activeWorkspace  = useUIV3Store((s) => s.activeWorkspace);
  const setWorkspace     = useUIV3Store((s) => s.setWorkspace);
  const captureRestPose  = useAnimationStore((s) => s.captureRestPose);
  const clearDraftPose   = useAnimationStore((s) => s.clearDraftPose);
  const resetParamValues = useParamValuesStore((s) => s.resetToDefaults);
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
   * Switch workspace + sync editorMode. captureRestPose only fires on
   * the staging→animation transition so repeated clicks on the
   * already-active animation-side workspace don't re-snapshot.
   * @param {WorkspaceTab} tab
   */
  function handleWorkspaceClick(tab) {
    setWorkspace(tab.id);
    if (tab.mode !== editorMode) {
      setEditorMode(tab.mode);
      if (tab.mode === 'animation' && project?.nodes && typeof captureRestPose === 'function') {
        captureRestPose(project.nodes);
      }
    }
  }

  /**
   * GAP-006 — Reset to Rest Pose. Animation-mode only.
   *
   * Drops uncommitted draft pose edits and zeros every parameter value
   * to its canonical default. Does NOT touch committed keyframes — the
   * timeline survives. After this, the live preview shows the rest
   * pose plus whatever the keyframes at the current time say.
   *
   * Distinct from GAP-014's per-node Reset Transform which resets ONE
   * node's transform to identity.
   */
  function handleResetRestPose() {
    clearDraftPose();
    resetParamValues(project?.parameters ?? []);
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

      {/* Right: spacer + reset-pose (animation mode) + hot reload + gesture hint */}
      <div className="flex-1" />

      <TooltipProvider delayDuration={400}>
        {/* GAP-006 — visible only in Pose / Animation. Drops draft pose
            edits + zeros paramValues to defaults; committed keyframes
            untouched. */}
        {editorMode === 'animation' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={handleResetRestPose}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="ml-1 text-[11px]">Reset Pose</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Reset to rest pose — clears unsaved pose edits and zeros every parameter to its default. Committed timeline keyframes are kept.
            </TooltipContent>
          </Tooltip>
        ) : null}

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
