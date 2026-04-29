/**
 * v3 Phase 5 — Save modal with library gallery + download tab.
 *
 * Adapted from upstream's `src/components/save/SaveModal.jsx`. Wired
 * into the v3 shell via `useLibraryDialogStore` (mode='save'). The
 * gallery click overwrites that record (after a confirm dialog); the
 * Save button creates a new record (or downloads a `.stretch` file
 * when the Download tab is active).
 *
 * Thumbnail capture comes from `useCaptureStore`, which the active
 * `ViewportEditor` publishes on mount. If no viewport is mounted yet
 * (e.g. fresh session, no project), the thumbnail is left empty —
 * gallery cards fall back to the FileArchive icon.
 *
 * @module v3/shell/SaveModal
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs.jsx';
import { ScrollArea } from '../../components/ui/scroll-area.jsx';
import { Loader2, Download, Library, AlertTriangle } from 'lucide-react';
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
import { useProjectStore } from '../../store/projectStore.js';
import { useCaptureStore } from '../../store/captureStore.js';
import {
  serializeProject,
  saveProjectRecord,
  loadProjectRecord,
} from '../../services/PersistenceService.js';
import { ProjectGallery } from './ProjectGallery.jsx';

export function SaveModal({ open, onOpenChange }) {
  const [name, setName] = useState('');
  const [saveMode, setSaveMode] = useState(/** @type {'library'|'download'} */ ('library'));
  const [isSaving, setIsSaving] = useState(false);
  const [overwriteProject, setOverwriteProject] = useState(/** @type {any|null} */ (null));
  const [libraryProjects, setLibraryProjects] = useState(/** @type {Array<any>} */ ([]));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  // When the dialog opens, default the name to the linked record's
  // name (if any) so re-saving on top of an existing record is the
  // one-click path. Falls back to the project's display name or a
  // timestamp if nothing else is available.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setIsSaving(false);
    const linkedId = useProjectStore.getState().currentLibraryId;
    if (linkedId) {
      loadProjectRecord(linkedId).then((rec) => {
        if (rec?.name) setName(rec.name);
        else setName(defaultName());
      }).catch(() => setName(defaultName()));
    } else {
      setName(defaultName());
    }
  }, [open]);

  function captureThumbnail() {
    try {
      return useCaptureStore.getState().captureThumbnail?.() ?? '';
    } catch (err) {
      console.error('[SaveModal] thumbnail capture failed:', err);
      return '';
    }
  }

  async function executeSave(idToUse, nameToUse, mode) {
    setIsSaving(true);
    setError(null);
    try {
      const project = useProjectStore.getState().project;
      const blob = await serializeProject(project);

      if (mode === 'download') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nameToUse.trim()}.stretch`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        useProjectStore.setState({ hasUnsavedChanges: false });
        onOpenChange(false);
      } else {
        const thumbnail = captureThumbnail();
        const savedId = await saveProjectRecord(idToUse, nameToUse.trim(), blob, thumbnail);
        useProjectStore.setState({ hasUnsavedChanges: false, currentLibraryId: savedId });
        onOpenChange(false);
      }
    } catch (err) {
      console.error('[SaveModal] save failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  function handleSaveNew() {
    if (!name.trim()) return;
    if (saveMode === 'library') {
      const trimmed = name.trim().toLowerCase();
      const existing = libraryProjects.find((p) => p.name.toLowerCase() === trimmed);
      // If a record with the same name already exists AND it isn't the
      // currently-linked one, prompt before overwriting. Re-saving on
      // top of the linked record is silent (Ctrl+S muscle memory).
      const linkedId = useProjectStore.getState().currentLibraryId;
      if (existing && existing.id !== linkedId) {
        setOverwriteProject(existing);
        return;
      }
      executeSave(linkedId ?? null, name, 'library');
      return;
    }
    executeSave(null, name, saveMode);
  }

  function confirmOverwrite() {
    if (!overwriteProject) return;
    executeSave(overwriteProject.id, overwriteProject.name, 'library');
    setOverwriteProject(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle>Save Project</DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="p-6 border-b bg-muted/20 shrink-0">
              <div className="flex flex-col gap-4 max-w-lg">
                <div className="grid gap-2">
                  <Label htmlFor="v3-save-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Project Name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="v3-save-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter project name..."
                      className="h-10"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isSaving && name.trim()) {
                          e.preventDefault();
                          handleSaveNew();
                        }
                      }}
                    />
                    <Button onClick={handleSaveNew} disabled={isSaving || !name.trim()} className="shrink-0 h-10 px-6">
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                  {error ? (
                    <span className="text-xs text-destructive">{error}</span>
                  ) : null}
                </div>

                <Tabs value={saveMode} onValueChange={(v) => setSaveMode(/** @type {any} */ (v))} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 h-12">
                    <TabsTrigger value="library" className="flex items-center gap-2 text-sm font-medium h-10">
                      <Library className="h-4 w-4" />
                      Save to Library
                    </TabsTrigger>
                    <TabsTrigger value="download" className="flex items-center gap-2 text-sm font-medium h-10">
                      <Download className="h-4 w-4" />
                      Download File
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <ProjectGallery
                className="bg-muted/5"
                onSelect={(p) => setOverwriteProject(p)}
                onProjectsLoaded={setLibraryProjects}
              />
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!overwriteProject}
        onOpenChange={(o) => !o && setOverwriteProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Overwrite project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to overwrite <strong>&ldquo;{overwriteProject?.name}&rdquo;</strong>?
              This will replace the project data and thumbnail in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmOverwrite}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function defaultName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `project-${stamp}`;
}
