// @ts-check

/**
 * Animation Phase 1 Stage 1.E — Actions list panel.
 *
 * Renamed from `AnimationsEditor` (Stage 1.E directive — the Blender
 * datablock is `Action`, the workspace label "Animation" is the verb;
 * the panel surfaces the noun and should match Blender's naming).
 *
 * Lists every action on the project with create / clone (Duplicate) /
 * rename / delete operations and click-to-switch. Stage 1.E additions
 * over Stage 1.A's panel:
 *
 *   - **Scene-action header.** The `__scene__` pseudo-Object's bound
 *     action (read via `getSceneAction(project)`) is surfaced at the
 *     top of the panel with a one-click bind/unbind affordance. This
 *     is the user's entry-point to "make THIS action the project-wide
 *     animation" — the scene cannot be selected through the Outliner
 *     (Stage 1.D `selectionStore.SelectableType` excludes 'scene'), so
 *     the actions panel owns the scene-binding UI surface.
 *
 *     **Blender-fidelity deviation (Audit-fix D-12 Stage 1.E):** in
 *     Blender, the per-Scene Action picker lives in the Properties
 *     Editor's Scene tab (`SCENE_PT_animation`,
 *     `reference/blender/scripts/startup/bl_ui/properties_scene.py:452`).
 *     SS lacks a Scene tab today (Stage 1.D Audit-fix G-16 — scene
 *     isn't a `SelectableType`), so the affordance lives here as a
 *     pragmatic SS choice. When SS adds a Scene tab in some future
 *     phase, this header MUST move (Rule №2 — no migration baggage).
 *
 *   - **Per-action "Used by" strip.** Each action row shows the
 *     (truncated) list of Objects + Scene that have the action assigned
 *     via `getActionUsers(project, action.id)`.
 *
 *     **Blender-fidelity deviation (Audit-fix D-11 Stage 1.E):** this
 *     is an EXTENSION of Blender's pattern, not a mirror. Blender shows
 *     ONLY a numeric `(N)` user-count pip on the `template_id`
 *     selector (`interface_template_id.cc:1267`); the named-list UI
 *     does not exist in stock Blender. The named list is more
 *     discoverable for SS's small action counts (typically 1–3 per
 *     character) so we surface user names directly.
 *
 *   - **Duplicate command.** New per-row Copy button calls the Stage
 *     1.C `cloneAction` thunk — the clone lands at the end of the list
 *     and becomes the active action.
 *
 *     **Blender-fidelity deviation (Audit-fix D-5 Stage 1.E):** Blender
 *     has no explicit "Duplicate Action" command for the datablock
 *     itself — `ACTION_OT_duplicate` (`action_edit.cc:1097`) duplicates
 *     KEYFRAMES, not the Action ID. The datablock-copy surface in
 *     Blender is the `(N)` user-count pip on `template_id`
 *     (`interface_template_id.cc:1284`), called "Make Single User"
 *     in tooltips — but that's only enabled when `users > 1`. SS's
 *     explicit per-row Copy button is a discoverability win for the
 *     common single-user case where Blender's pip is invisible.
 *     Cloned names use Blender's `.001` convention (Audit-fix D-6 Stage
 *     1.E — implemented in `actionRegistry.cloneAction` via
 *     `nextDotNNNName`).
 *
 * Mounts as the `actions` editor type (renamed from `animations` in
 * `editorRegistry.js` + `uiV3Store.EditorType`). The animation
 * workspace's `rightBottom` area shows it next to Properties; users can
 * drop it anywhere via the area-header dropdown.
 *
 * Audit-fix D-13 (Stage 1.D): when `__scene__` appears in the Used-by
 * list it is rendered as "Scene" (not the raw `__scene__` id) and is
 * grouped first — Blender's Outliner shows scene-bound actions under a
 * separate root above per-Object users.
 *
 * @module v3/editors/actions/ActionsEditor
 */

import { useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Film,
  Sparkles,
  Copy,
  Link2,
  Link2Off,
} from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useUIV3Store } from '../../../store/uiV3Store.js';
import { getActionUsers } from '../../../anim/actionRegistry.js';
import { getSceneAction, getSceneNode } from '../../../anim/sceneAction.js';
import { toast } from '../../../hooks/use-toast.js';
import * as AlertDialogImpl from '../../../components/ui/alert-dialog.jsx';
import { IdleMotionDialog } from './IdleMotionDialog.jsx';

// shadcn/ui alert-dialog parts are forwardRefs without exported
// JSDoc types — tsc can't see their props. Cast through one alias
// so all eight slots stay permissive at runtime they're the same.
/** @type {Record<string, React.ComponentType<any>>} */
const AD = /** @type {any} */ (AlertDialogImpl);
const {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} = AD;

/**
 * Format a Used-by user list for the per-action strip. The scene
 * (`__scene__`) is rendered as "Scene" and pulled to the front;
 * regular Objects use their `name` field (falling back to the id).
 *
 * @param {Array<{id: string, name?: string}>} users
 * @returns {string}
 */
function formatUsedBy(users) {
  if (!Array.isArray(users) || users.length === 0) return '';
  /** @type {string[]} */
  const labels = [];
  let hasScene = false;
  for (const u of users) {
    if (!u || typeof u !== 'object') continue;
    if (u.id === '__scene__') {
      hasScene = true;
      continue;
    }
    labels.push(typeof u.name === 'string' && u.name.length > 0 ? u.name : u.id);
  }
  if (hasScene) labels.unshift('Scene');
  return labels.join(', ');
}

export function ActionsEditor() {
  // `project.actions` is always an array (default state +
  // migration guarantee); the prior `?? []` returned a fresh empty
  // array on every snapshot, breaking the useSyncExternalStore cache.
  const project = useProjectStore((s) => s.project);
  const actions = useProjectStore((s) => s.project.actions);
  const createAction = useProjectStore((s) => s.createAction);
  const renameAction = useProjectStore((s) => s.renameAction);
  const deleteAction = useProjectStore((s) => s.deleteAction);
  const cloneAction = useProjectStore((s) => s.cloneAction);
  const assignAction = useProjectStore((s) => s.assignAction);
  const unassignAction = useProjectStore((s) => s.unassignAction);

  const activeId = useAnimationStore((s) => s.activeActionId);
  const switchAction = useAnimationStore((s) => s.switchAction);

  // Scene-action selection — `getSceneAction(project)` walks
  // `__scene__.animData.actionId` and resolves in `project.actions[]`.
  // Returning the action object (not the id) lets the header dropdown
  // show the bound name without a second lookup.
  const sceneAction = useMemo(() => getSceneAction(project), [project]);
  const sceneActionId = sceneAction ? sceneAction.id : null;
  const sceneExists = useMemo(() => !!getSceneNode(project), [project]);

  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editValue, setEditValue] = useState('');
  const [deleteId, setDeleteId] = useState(/** @type {string|null} */ (null));
  const [showIdleDialog, setShowIdleDialog] = useState(false);

  function startEdit(a) {
    setEditingId(a.id);
    setEditValue(a.name ?? '');
  }
  function commitEdit() {
    if (editingId && editValue.trim()) renameAction(editingId, editValue.trim());
    setEditingId(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  function confirmDelete() {
    if (!deleteId) return;
    // Audit-fix G-3 Stage 1.E: capture pre-delete user list so the
    // post-delete toast can name what got unbound. Without this, scene-
    // bound actions delete silently — the user clicks Delete on
    // "Used by: Scene" and the scene's `animData.actionId` nulls with no
    // visible feedback.
    const cascadedUsers = formatUsedBy(getActionUsers(project, deleteId));
    deleteAction(deleteId);
    if (deleteId === activeId) {
      const remaining = actions.filter((a) => a.id !== deleteId);
      switchAction(remaining[0] ?? null);
    }
    if (cascadedUsers) {
      toast({
        title: 'Action deleted',
        description: `Unbound from: ${cascadedUsers}`,
      });
    }
    setDeleteId(null);
  }

  /** @param {{id: string, name?: string}} action */
  function duplicate(action) {
    // Audit-fix G-10 Stage 1.E: thunk now returns the full cloned
    // action object (matching the registry's Audit-fix G-5 contract);
    // no extra `actions.find(...)` scan needed.
    const created = cloneAction(action.id);
    if (created) switchAction(created);
  }

  /** @param {string} actionId */
  function bindToScene(actionId) {
    if (!sceneExists) return;
    assignAction('__scene__', actionId, 0);
  }

  function unbindFromScene() {
    if (!sceneExists) return;
    unassignAction('__scene__');
  }

  return (
    <>
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Film size={11} className="text-muted-foreground" />
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Actions ({actions.length})
            </h2>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-muted/60"
              onClick={() => setShowIdleDialog(true)}
              title="Generate idle motion…"
              aria-label="Generate idle motion"
            >
              <Sparkles size={12} />
            </button>
            <button
              type="button"
              className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
              onClick={() => {
                // After creating, the new action lands at the end of
                // project.actions. Pick it up from the freshly-read
                // store and dispatch switchAction so playback +
                // timeline focus on it. Also route to the Animation
                // workspace so the user sees the timeline they just made.
                // (BFA-001: editorMode is derived from activeWorkspace,
                // and setWorkspace itself captures the rest pose on the
                // staging→animation transition.)
                createAction();
                const list = useProjectStore.getState().project.actions ?? [];
                const created = list[list.length - 1];
                if (created) switchAction(created);
                useUIV3Store.getState().setWorkspace('animation');
              }}
              title="Create new action"
              aria-label="Create new action"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        {sceneExists ? (
          <div
            className="px-3 py-1.5 border-b shrink-0 flex items-center gap-1.5 bg-muted/20"
            title={
              sceneAction
                ? `Scene action: ${sceneAction.name ?? sceneAction.id}`
                : 'No action bound to Scene — exporter falls back to UI selection.'
            }
          >
            {sceneAction ? (
              <Link2 size={11} className="text-primary shrink-0" />
            ) : (
              <Link2Off size={11} className="text-muted-foreground shrink-0" />
            )}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
              Scene:
            </span>
            <select
              className="flex-1 h-5 text-[11px] bg-transparent text-foreground focus:outline-none"
              value={sceneActionId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') unbindFromScene();
                else bindToScene(v);
              }}
              aria-label="Bind action to Scene"
            >
              <option value="">(unbound)</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
            </select>
            {sceneAction ? (
              <button
                type="button"
                className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={unbindFromScene}
                title="Unbind action from Scene"
                aria-label="Unbind action from Scene"
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto py-1">
          {actions.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground italic">
                No actions. Click + to create one.
              </p>
            </div>
          ) : (
            <ul className="space-y-px">
              {actions.map((action) => {
                const isActive = action.id === activeId;
                const isSceneBound = action.id === sceneActionId;
                const isEditing = action.id === editingId;
                const usedBy = getActionUsers(project, action.id);
                const usedByLabel = formatUsedBy(usedBy);
                return (
                  <li
                    key={action.id}
                    className={
                      'group flex flex-col px-3 py-1 cursor-pointer transition-colors ' +
                      (isActive
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : 'hover:bg-muted/40 border-l-2 border-transparent')
                    }
                    onClick={() => !isEditing && switchAction(action)}
                  >
                    <div className="flex items-center w-full">
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit();
                              else if (e.key === 'Escape') cancelEdit();
                            }}
                            className="flex-1 h-6 px-1.5 text-xs rounded bg-muted/40 border border-border focus:outline-none focus:border-primary"
                          />
                          <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center text-emerald-500 hover:bg-muted rounded"
                            onClick={commitEdit}
                            aria-label="Confirm rename"
                          >
                            <Check size={11} />
                          </button>
                          <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center text-muted-foreground hover:bg-muted rounded"
                            onClick={cancelEdit}
                            aria-label="Cancel rename"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <>
                          {isSceneBound ? (
                            <Link2
                              size={9}
                              className="text-primary shrink-0 mr-1"
                              aria-label="Bound to Scene"
                            />
                          ) : null}
                          <span className="flex-1 truncate text-xs text-foreground" title={action.name ?? action.id}>
                            {action.name ?? '(unnamed)'}
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums mr-2">
                            {Math.round((action.duration ?? 0) / 1000 * 10) / 10}s
                          </span>
                          <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded transition"
                            onClick={(e) => { e.stopPropagation(); duplicate(action); }}
                            title="Duplicate action"
                            aria-label="Duplicate action"
                          >
                            <Copy size={10} />
                          </button>
                          <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded transition"
                            onClick={(e) => { e.stopPropagation(); startEdit(action); }}
                            aria-label="Rename action"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition"
                            onClick={(e) => { e.stopPropagation(); setDeleteId(action.id); }}
                            aria-label="Delete action"
                          >
                            <Trash2 size={10} />
                          </button>
                        </>
                      )}
                    </div>
                    {!isEditing && usedByLabel ? (
                      <div
                        className="text-[10px] text-muted-foreground truncate pl-0.5"
                        title={`Used by: ${usedByLabel}`}
                      >
                        Used by: {usedByLabel}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <IdleMotionDialog open={showIdleDialog} onOpenChange={setShowIdleDialog} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the action and all of its fcurves. Cannot be undone via this dialog;
              use Ctrl+Z afterwards if you change your mind.
              {deleteId
                ? (() => {
                    // Audit-fix G-3 Stage 1.E: surface bindings BEFORE
                    // delete so the user sees what will be unbound.
                    // Mirrors Blender's "users" pip on the Action ID
                    // template (`interface_template_id.cc:1267`).
                    const users = formatUsedBy(getActionUsers(project, deleteId));
                    return users
                      ? <span className="block mt-2 text-foreground">Currently bound to: {users}.</span>
                      : null;
                  })()
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
