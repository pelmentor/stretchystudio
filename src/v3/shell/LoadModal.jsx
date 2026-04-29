/**
 * v3 Phase 5 — Load modal with library gallery + import-file tile.
 *
 * Adapted from upstream's `src/components/load/LoadModal.jsx`. Wired
 * into the v3 shell via `useLibraryDialogStore` (mode='load').
 *
 * Two paths:
 *  - Click a gallery card → load that record (sets currentLibraryId
 *    so subsequent saves overwrite it);
 *  - Click the dashed tile → file picker for a `.stretch` import
 *    (currentLibraryId is cleared — disk-loaded projects are
 *    unanchored until the user explicitly Saves to Library).
 *
 * The dialog assumes the project store's `loadProject` already
 * handles fresh state (history clear + version bumps); here we just
 * call `deserializeProject` and dispatch the result.
 *
 * @module v3/shell/LoadModal
 */

import { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.jsx';
import { ScrollArea } from '../../components/ui/scroll-area.jsx';
import { Plus } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import {
  deserializeProject,
  loadProjectRecord,
} from '../../services/PersistenceService.js';
import { ProjectGallery } from './ProjectGallery.jsx';

export function LoadModal({ open, onOpenChange }) {
  const fileInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  async function loadFromRecord(rec) {
    try {
      const full = await loadProjectRecord(rec.id);
      if (!full?.blob) return;
      const { project } = await deserializeProject(full.blob);
      useProjectStore.getState().loadProject(project);
      // Re-anchor to this library record so a subsequent save
      // overwrites it (matches upstream's setCurrentDbProjectId flow).
      useProjectStore.setState({ currentLibraryId: rec.id });
      onOpenChange(false);
    } catch (err) {
      console.error('[LoadModal] failed to load record:', err);
    }
  }

  async function loadFromFile(file) {
    try {
      const { project } = await deserializeProject(file);
      useProjectStore.getState().loadProject(project);
      // Disk-loaded projects start unlinked — loadProject already
      // cleared currentLibraryId; leave it that way.
      onOpenChange(false);
    } catch (err) {
      console.error('[LoadModal] failed to load file:', err);
    }
  }

  function handleFileChange(e) {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    if (!/\.(stretch|zip)$/i.test(file.name)) return;
    loadFromFile(file);
    // Reset the input so the same file can be reselected next time.
    /** @type {HTMLInputElement} */ (e.target).value = '';
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle>Load Project</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 px-6 border-b bg-muted/10 shrink-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Project Library
            </h2>
          </div>

          <ScrollArea className="flex-1">
            <ProjectGallery
              onSelect={loadFromRecord}
              header={
                <div
                  className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-all group aspect-[4/3] bg-muted/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <p className="text-xs font-semibold">Import Project</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Select .stretch file</p>
                  <input
                    type="file"
                    accept=".stretch,.zip"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              }
            />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
