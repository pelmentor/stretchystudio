/**
 * v3 Phase 1G — Library save/load dialog.
 *
 * Mounted at AppShell level; opened by `file.saveToLibrary` /
 * `file.loadFromLibrary` operators via `useLibraryDialogStore`.
 *
 * Two modes:
 *  - 'save' — text field for project name (defaulted to current
 *    project's name + timestamp), Save button calls
 *    PersistenceService.saveProjectRecord with a `null` id (always
 *    creates a new record). Phase 5 adds "overwrite existing record"
 *    once a `currentProjectId` ref is in place.
 *  - 'load' — list of saved records sorted by updatedAt desc, with
 *    per-row Open / Delete buttons. Open path:
 *    `loadProjectRecord` → `deserializeProject(record.blob)` →
 *    `projectStore.loadProject(project)`.
 *
 * Phase 5 supersedes this with a full ProjectGallery (thumbnails +
 * search + tags). For now this is the minimum viable surface to
 * close the gap left by v2 retirement.
 *
 * @module v3/shell/LibraryDialog
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import {
  serializeProject,
  deserializeProject,
  saveProjectRecord,
  loadProjectRecord,
  listSavedProjects,
  deleteProjectRecord,
} from '../../services/PersistenceService.js';

export function LibraryDialog() {
  const mode = useLibraryDialogStore((s) => s.mode);
  const close = useLibraryDialogStore((s) => s.close);

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        {mode === 'save' ? <SavePanel onDone={close} /> : null}
        {mode === 'load' ? <LoadPanel onDone={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function defaultName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `project-${stamp}`;
}

function SavePanel({ onDone }) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = useProjectStore.getState().project;
      const blob = await serializeProject(project);
      // Empty thumbnail string — Phase 5 will capture canvas frames.
      await saveProjectRecord(null, trimmed, blob, '');
      useProjectStore.setState({ hasUnsavedChanges: false });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save to Library</DialogTitle>
        <DialogDescription>
          Stores the current project in this browser's IndexedDB. No
          file is written; export to .stretch via Save (Ctrl+S) for a
          portable copy.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="library-name">Name</label>
        <Input
          id="library-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        {error ? (
          <span className="text-xs text-destructive mt-1">{error}</span>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}

function formatTimestamp(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

function LoadPanel({ onDone }) {
  const [records, setRecords] = useState(/** @type {Array<any>} */ ([]));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await listSavedProjects();
      setRecords(list ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleOpen(id) {
    setBusyId(id);
    setError(null);
    try {
      const record = await loadProjectRecord(id);
      if (!record?.blob) {
        throw new Error('Record has no blob');
      }
      const { project } = await deserializeProject(record.blob);
      useProjectStore.getState().loadProject(project);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusyId(null);
    }
  }

  async function handleDelete(id) {
    setBusyId(id);
    setError(null);
    try {
      await deleteProjectRecord(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Open from Library</DialogTitle>
        <DialogDescription>
          Projects saved in this browser. Phase 5 adds thumbnails and
          a visual gallery.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-72 overflow-auto border border-border rounded">
        {loading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>
        ) : records.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No saved projects.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {records.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{r.name || '(unnamed)'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatTimestamp(r.updatedAt)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId !== null}
                  onClick={() => handleOpen(r.id)}
                >
                  Open
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busyId !== null}
                  onClick={() => handleDelete(r.id)}
                  title="Delete this saved project"
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
