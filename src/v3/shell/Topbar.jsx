/**
 * v3 — top header bar.
 *
 * Single-row layout: left → bold "Stretchy Studio" + version badge
 * + File menu dropdown + Canvas Properties popover; center → 6
 * workspace pills (Layout / Modeling / Rigging / Weight / Sculpt /
 * Animation) + Undo/Redo; right → Hot Reload pill + gesture hint.
 *
 * The 6-icon File strip (New / Save / Open / Export / Canvas Props /
 * Settings) was replaced 2026-05-16 (audit 4 #3) with a structured
 * `<FileMenu>` dropdown mirroring Blender's INFO_MT_file. Canvas
 * Properties stays as a discrete icon — it's a render-context
 * control, not a file-context one.
 *
 * Workspace pills are layout presets. The Setup/Animate axis is
 * derived from the active workspace (BFA-001 — Layout → 'staging',
 * Animation → 'animation'); the Blender-style edit slot (`editMode`:
 * mesh / skeleton / blendShape) lives on the canvas Mode pill, on
 * its own axis.
 *
 * @module v3/shell/Topbar
 */

import { useState, lazy, Suspense } from 'react';
import {
  SquareChartGantt, Undo2, Redo2, Link2, Unlink,
} from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../../components/ui/tooltip.jsx';
import { cn } from '../../lib/utils.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useUIV3Store } from '../../store/uiV3Store.js';
import { useNewProjectDialogStore } from '../../store/newProjectDialogStore.js';
import { useAssetHotReloadStore } from '../../store/assetHotReloadStore.js';
import { logger } from '../../lib/logger.js';
import { undoCount, redoCount } from '../../store/undoHistory.js';
import { getOperator } from '../operators/registry.js';
import { isSupported as hotReloadSupported, pickFolderAndWatch } from '../../io/assetHotReload.js';
import { CanvasPropertiesPopover } from './CanvasPropertiesPopover.jsx';
import { FileMenu } from './FileMenu.jsx';

// Phase A2 (2026-05-09) — `PreferencesModal` (themePresets + KeymapModal
// + i18n graph) and `NewProjectDialog` (projectTemplates) are open-gated
// + lazy. Mount only when their open flag flips true; until then they
// don't ship in the eager chunk. CanvasPropertiesPopover stays eager —
// its graph is already in the eager bundle (Popover + form primitives).
const PreferencesModal = lazy(() =>
  import('./PreferencesModal.jsx').then((m) => ({ default: m.PreferencesModal })),
);
const NewProjectDialog = lazy(() =>
  import('./NewProjectDialog.jsx').then((m) => ({ default: m.NewProjectDialog })),
);

/** @typedef {{ id: string, label: string, tip: string }} WorkspaceTab */

/** @type {WorkspaceTab[]} */
// 6 workspaces shipped 2026-05-16 (audit F-2 expansion): mirrors the
// Blender General-template workspace tabs minus the surfaces that don't
// apply to a 2D rigging tool (no UV / Texture / Shading / Compositing
// / Geometry Nodes / Scripting workspaces).
const WORKSPACES = [
  { id: 'layout',      label: 'Layout',
    tip: 'Layout — generalist surface: Outliner, Logs, Viewport (+Live Preview), Parameters, Properties.' },
  { id: 'modeling',    label: 'Modeling',
    tip: 'Modeling — mesh-edit focus: Outliner left, full-bleed Viewport, Properties right.' },
  { id: 'rigging',     label: 'Rigging',
    tip: 'Rigging — bone authoring: Outliner, Viewport, Parameters + Properties. No Live Preview.' },
  { id: 'weightPaint', label: 'Weight',
    tip: 'Weight Paint — vertex weight authoring: Outliner, Viewport, Properties. Brush settings live in N-panel.' },
  { id: 'sculpt',      label: 'Sculpt',
    tip: 'Sculpt — minimal chrome around full-bleed Viewport. Brush settings in N-panel.' },
  { id: 'animation',   label: 'Animation',
    tip: 'Animation — adds Timeline / Dopesheet / FCurve at the bottom for keyframing.' },
];

export function Topbar() {
  // Subscribing to `project` keeps undoCount() / redoCount() in sync —
  // every project mutation pushes a snapshot, so any time the stack
  // changes the project reference also changes and we re-render.
  useProjectStore((s) => s.project);
  const activeWorkspace  = useUIV3Store((s) => s.activeWorkspace);
  const setWorkspace     = useUIV3Store((s) => s.setWorkspace);
  const hotReloadStatus  = useAssetHotReloadStore((s) => s.status);
  const newProjectOpen   = useNewProjectDialogStore((s) => s.open);
  const closeNewProject  = useNewProjectDialogStore((s) => s.close);

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
   * Switch workspace. Layout + (BFA-001) the editorMode derivation.
   *
   * Workspaces are layout-only for editor state — `editMode`, `selection`,
   * and `activeBlendShapeId` persist across switches verbatim. The
   * Setup/Animate axis is now derived from the active workspace itself
   * (Default → 'staging', Animation → 'animation' via `selectEditorMode`)
   * — there is no separate `editorMode` slot any more, so the previous
   * Setup/Animate pill is gone.
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

  return (
    <header className="h-10 border-b flex items-center px-4 shrink-0 bg-card gap-3 relative">
      {/* Left: logo + version badge + File menu + Canvas Properties.
          The 6-icon strip was replaced 2026-05-16 (audit 4 #3) with a
          structured dropdown mirroring Blender's INFO_MT_file. Canvas
          Properties stays as a discrete icon — it's a render-context
          control, not a file-context one (Blender keeps it in the
          Render Properties tab). */}
      <div className="flex items-center gap-3 h-full">
        <span className="font-semibold text-sm select-none tracking-tight">Stretchy Studio</span>
        <span className="text-xs text-muted-foreground border border-border/50 px-1.5 py-0.5 font-mono">v0.3</span>

        <div className="flex h-full items-stretch ml-1 mr-2">
          <FileMenu onOpenPreferences={() => setPrefsOpen(true)} />
          <CanvasPropertiesPopover>
            <Button
              variant="ghost" size="icon"
              className="h-full w-9 rounded-none border-r hover:bg-muted"
              title="Canvas Properties"
            >
              <SquareChartGantt className="h-4 w-4" />
            </Button>
          </CanvasPropertiesPopover>
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

          {/* Setup/Animate pill removed 2026-05-03. `editorMode` is now
              derived from the active workspace: Default → 'staging',
              Animation → 'animation'. The dual axis was a crutch — the
              user always wanted Animate while in the Animation workspace
              and Setup elsewhere. setWorkspace now drives the mode in
              uiV3Store; nothing else writes editorMode in the topbar. */}

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

      {prefsOpen ? (
        <Suspense fallback={null}>
          <PreferencesModal open={prefsOpen} onOpenChange={setPrefsOpen} />
        </Suspense>
      ) : null}
      {newProjectOpen ? (
        <Suspense fallback={null}>
          <NewProjectDialog
            open={newProjectOpen}
            onOpenChange={(o) => { if (!o) closeNewProject(); }}
          />
        </Suspense>
      ) : null}
    </header>
  );
}
