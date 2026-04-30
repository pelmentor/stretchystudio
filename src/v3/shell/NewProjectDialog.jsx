// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 5 — New Project dialog with template picker.
 *
 * Replaces the previous AlertDialog confirmation. Lists every
 * registered project template; the user picks one and clicks
 * "Create" to reset the workspace + apply the template's mutator.
 *
 * When the current project has unsaved changes (`hasUnsavedChanges`)
 * a warning banner appears at the top — the user can still proceed
 * but is reminded that the work will be lost.
 *
 * @module v3/shell/NewProjectDialog
 */

import { useState, useEffect } from 'react';
import * as DialogImpl from '../../components/ui/dialog.jsx';
import { Button as ButtonImpl } from '../../components/ui/button.jsx';
import { useProjectStore } from '../../store/projectStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { listTemplates, getTemplate } from '../templates/projectTemplates.js';
import { AlertTriangle, FilePlus } from 'lucide-react';
import { useT } from '../../i18n/index.js';

/** @type {Record<string, React.ComponentType<any>>} */
const D = /** @type {any} */ (DialogImpl);
const {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} = D;
/** @type {React.ComponentType<any>} */
const Button = /** @type {any} */ (ButtonImpl);

export function NewProjectDialog({ open, onOpenChange }) {
  const dirty = useProjectStore((s) => s.hasUnsavedChanges);
  const resetProject = useProjectStore((s) => s.resetProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const clearSelection = useSelectionStore((s) => s.clear);

  const templates = listTemplates();
  const [pickedId, setPickedId] = useState('empty');
  const labels = {
    title:           useT('newProject.title'),
    subtitle:        useT('newProject.subtitle'),
    dirtyWarning:    useT('newProject.dirtyWarning'),
    cancel:          useT('action.cancel'),
    create:          useT('action.create'),
  };

  // Reset selection when reopening so we don't carry stale state.
  useEffect(() => {
    if (open) setPickedId('empty');
  }, [open]);

  function applyAndClose() {
    const tpl = getTemplate(pickedId);
    if (!tpl) return;
    clearSelection();
    resetProject();
    // Templates layer changes onto a freshly-reset project. The
    // mutator runs via updateProject so versionControl ticks for us
    // and the canvas update propagates to subscribed components.
    updateProject((proj) => {
      tpl.apply(proj);
    }, { skipHistory: true });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus size={16} className="text-primary" />
            {labels.title}
          </DialogTitle>
          <DialogDescription>
            {labels.subtitle}
          </DialogDescription>
        </DialogHeader>

        {dirty ? (
          <div className="flex items-start gap-2 p-2 rounded border border-amber-500/30 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-500">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {labels.dirtyWarning}
            </span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 my-2">
          {templates.map((tpl) => {
            const active = tpl.id === pickedId;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setPickedId(tpl.id)}
                className={
                  'flex flex-col items-start gap-1 p-3 rounded border text-left cursor-pointer transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/30')
                }
              >
                <span className="text-sm font-semibold text-foreground">{tpl.name}</span>
                <span className="text-xs text-muted-foreground">{tpl.description}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
          <Button onClick={applyAndClose}>{labels.create}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
