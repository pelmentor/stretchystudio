// @ts-check

/**
 * v3 Phase 3 — Animations list panel.
 *
 * Lists every animation on the project, with create / rename /
 * delete actions and click-to-switch. Mirrors upstream's
 * `AnimationListPanel.jsx` behaviour: editing a name is inline,
 * deleting prompts via AlertDialog, the active row is highlighted.
 *
 * Mounted as its own editor (`animations` in editorRegistry) so the
 * Animation workspace can show it next to the Timeline. The default
 * animation workspace puts Outliner / Parameters / Properties on
 * the left and Animations as a tab in the leftBottom area, but a
 * user can drop it anywhere via the area-header dropdown.
 *
 * @module v3/editors/animations/AnimationsEditor
 */

import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Film, Sparkles } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useUIV3Store } from '../../../store/uiV3Store.js';
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

export function AnimationsEditor() {
  const animations = useProjectStore((s) => s.project.animations ?? []);
  const createAnimation = useProjectStore((s) => s.createAnimation);
  const renameAnimation = useProjectStore((s) => s.renameAnimation);
  const deleteAnimation = useProjectStore((s) => s.deleteAnimation);

  const activeId = useAnimationStore((s) => s.activeAnimationId);
  const switchAnimation = useAnimationStore((s) => s.switchAnimation);

  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editValue, setEditValue] = useState('');
  const [deleteId, setDeleteId] = useState(/** @type {string|null} */ (null));
  const [showIdleDialog, setShowIdleDialog] = useState(false);

  function startEdit(a) {
    setEditingId(a.id);
    setEditValue(a.name ?? '');
  }
  function commitEdit() {
    if (editingId && editValue.trim()) renameAnimation(editingId, editValue.trim());
    setEditingId(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteAnimation(deleteId);
    if (deleteId === activeId) {
      const remaining = animations.filter((a) => a.id !== deleteId);
      switchAnimation(remaining[0] ?? null);
    }
    setDeleteId(null);
  }

  return (
    <>
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Film size={11} className="text-muted-foreground" />
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Animations ({animations.length})
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
                // After creating, the new animation lands at the end of
                // project.animations. Pick it up from the freshly-read
                // store and dispatch switchAnimation so playback +
                // timeline focus on it. Also force the Animation
                // workspace + editorMode so the user actually sees the
                // timeline they just made.
                createAnimation();
                const list = useProjectStore.getState().project.animations ?? [];
                const created = list[list.length - 1];
                if (created) switchAnimation(created);
                // setWorkspace drives editorMode via EditorModeService —
                // captureRestPose runs on the staging→animation transition.
                useUIV3Store.getState().setWorkspace('animation');
              }}
              title="Create new animation"
              aria-label="Create new animation"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {animations.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground italic">
                No animations. Click + to create one.
              </p>
            </div>
          ) : (
            <ul className="space-y-px">
              {animations.map((anim) => {
                const isActive = anim.id === activeId;
                const isEditing = anim.id === editingId;
                return (
                  <li
                    key={anim.id}
                    className={
                      'group flex items-center px-3 py-1.5 cursor-pointer transition-colors ' +
                      (isActive
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : 'hover:bg-muted/40 border-l-2 border-transparent')
                    }
                    onClick={() => !isEditing && switchAnimation(anim)}
                  >
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
                        <span className="flex-1 truncate text-xs text-foreground" title={anim.name ?? anim.id}>
                          {anim.name ?? '(unnamed)'}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums mr-2">
                          {Math.round((anim.duration ?? 0) / 1000 * 10) / 10}s
                        </span>
                        <button
                          type="button"
                          className="h-5 w-5 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded transition"
                          onClick={(e) => { e.stopPropagation(); startEdit(anim); }}
                          aria-label="Rename animation"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          type="button"
                          className="h-5 w-5 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition"
                          onClick={(e) => { e.stopPropagation(); setDeleteId(anim.id); }}
                          aria-label="Delete animation"
                        >
                          <Trash2 size={10} />
                        </button>
                      </>
                    )}
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
            <AlertDialogTitle>Delete animation?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the animation and all of its tracks. Cannot be undone via this dialog;
              use Ctrl+Z afterwards if you change your mind.
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
