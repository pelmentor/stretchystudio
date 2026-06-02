// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 — Topbar File menu.
 *
 * Replaces the prior 6-icon strip with a single dropdown structured
 * after Blender's `INFO_MT_file` menu (`reference/blender/scripts/
 * startup/bl_ui/space_topbar.py:157-215`).
 *
 * Items dispatch through the operator registry — same code path as
 * the keymap dispatcher, so the menu and the chord (Ctrl+N / Ctrl+S /
 * Ctrl+Shift+S / Ctrl+O / Ctrl+E) can never drift. Operators carry
 * their own `available()` gates; the menu reflects them via
 * `disabled`.
 *
 * Open Recent ▶ submenu loads the IndexedDB project library on mount
 * (cheap — it's metadata-only) and renders up to 8 most-recent
 * records. Clicking a row re-uses `loadFromLibrary` so a subsequent
 * Save overwrites the same record (matches LoadModal's gallery card
 * click).
 *
 * Save / Open icons stay visible as muscle-memory affordances on the
 * menu trigger row — but only the dirty-dot indicator survives from
 * the prior strip; everything else is inside the dropdown.
 *
 * @module v3/shell/FileMenu
 */

import { useEffect, useState, useRef } from 'react';
import {
  FileText,
  FilePlus,
  FolderOpen,
  Save,
  SaveAll,
  Download,
  Image,
  FileSearch,
  Settings2,
  ChevronDown,
  Clock,
} from 'lucide-react';
import { Button as ButtonImpl } from '../../components/ui/button.jsx';
import * as DropdownImpl from '../../components/ui/dropdown-menu.jsx';
import { cn } from '../../lib/utils.js';

/** shadcn primitives are typed too narrowly to accept JSX children
 *  through the forwardRef wrapper; cast through `any` per the
 *  Sel/Pop/Chk pattern used elsewhere in the v3 shell. */
/** @type {React.ComponentType<any>} */
const Button = /** @type {any} */ (ButtonImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Dd = /** @type {any} */ (DropdownImpl);
const {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} = Dd;
import { getOperator } from '../operators/registry.js';
import { reportOpFailure } from '../operators/reportOpFailure.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { listSavedProjects } from '../../services/PersistenceService.js';
import { loadFromLibrary } from '../../services/projectLibrary.js';

/** Max entries shown under "Open Recent ▶". Blender's default is 10
 *  (preferences `recent_files`); we keep it at 8 to stay short on a
 *  small dropdown. */
const RECENT_LIMIT = 8;

function runOp(id) {
  const op = getOperator(id);
  if (!op) return;
  if (op.available && !op.available({ editorType: null })) return;
  try { op.exec({ editorType: null }); }
  catch (err) { reportOpFailure('FileMenu', err, { opId: id }); }
}

function isOpAvailable(id) {
  const op = getOperator(id);
  if (!op) return false;
  if (!op.available) return true;
  return !!op.available({ editorType: null });
}

/**
 * Open Recent submenu — loads metadata lazily on first hover. Returns
 * a stable list (sorted most-recent first by PersistenceService).
 */
function RecentSubmenu({ onClose }) {
  const [items, setItems] = useState(/** @type {Array<{id:string,name:string,updatedAt?:number}>} */ ([]));
  const [loaded, setLoaded] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loaded || loadingRef.current) return;
    loadingRef.current = true;
    listSavedProjects().then((rows) => {
      setItems(Array.isArray(rows) ? rows.slice(0, RECENT_LIMIT) : []);
      setLoaded(true);
    }).catch(() => {
      setItems([]);
      setLoaded(true);
    });
  }, [loaded]);

  async function handlePick(rec) {
    onClose?.();
    try {
      await loadFromLibrary(rec.id);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[FileMenu] open recent failed:', err);
    }
  }

  if (!loaded) {
    return <DropdownMenuItem disabled className="text-muted-foreground">Loading…</DropdownMenuItem>;
  }
  if (items.length === 0) {
    return <DropdownMenuItem disabled className="text-muted-foreground italic">(no recent projects)</DropdownMenuItem>;
  }
  return (
    <>
      {items.map((rec) => (
        <DropdownMenuItem
          key={rec.id}
          onSelect={() => handlePick(rec)}
          className="gap-2"
        >
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate max-w-[20rem]">{rec.name}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** @param {{ onOpenPreferences: () => void }} props */
export function FileMenu({ onOpenPreferences }) {
  const dirty = useProjectStore((s) => s.hasUnsavedChanges);
  // Keep undo / redo / save-availability re-renders in sync — same
  // pattern as Topbar's existing project subscription.
  useProjectStore((s) => s.project);
  const [open, setOpen] = useState(false);

  const exportEnabled = isOpAvailable('file.export');
  const importPsdEnabled = isOpAvailable('file.importPsd');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-full px-2 rounded-none border-l border-r flex items-center gap-1.5 text-[13px] font-medium hover:bg-muted',
            'data-[state=open]:bg-muted',
          )}
          title="File"
        >
          <FileText className="h-4 w-4" />
          <span>File</span>
          {dirty ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-primary ml-0.5"
              title="Unsaved changes"
            />
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        {/* Blender INFO_MT_file order: New / Open / Open Recent / Revert. */}
        <DropdownMenuItem onSelect={() => runOp('file.new')} className="gap-2">
          <FilePlus className="h-4 w-4" />
          New Project
          <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runOp('file.load')} className="gap-2">
          <FolderOpen className="h-4 w-4" />
          Open…
          <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Clock className="h-4 w-4" />
            Open Recent
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="min-w-[18rem]">
              {open ? <RecentSubmenu onClose={() => setOpen(false)} /> : null}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Save / Save As. Save reuses the linked record; Save As forces
            a fresh entry. Both wake the same SaveModal — the modal reads
            `libraryDialogStore.saveAs` non-reactively at open time. */}
        <DropdownMenuItem onSelect={() => runOp('file.save')} className="gap-2">
          <Save className="h-4 w-4" />
          Save
          <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runOp('file.saveAs')} className="gap-2">
          <SaveAll className="h-4 w-4" />
          Save As…
          <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Import / Export. Blender splits Import as a submenu (per file
            type) — SS only ships PSD ingest today, so a single item is
            faithful in spirit and avoids a one-entry submenu. When other
            ingest paths land (PNG sequence, sprite sheet) lift to a sub
            mirroring TOPBAR_MT_file_import. */}
        <DropdownMenuItem
          onSelect={() => runOp('file.importPsd')}
          disabled={!importPsdEnabled}
          className="gap-2"
        >
          <Image className="h-4 w-4" />
          Import PSD…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => runOp('file.export')}
          disabled={!exportEnabled}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export Live2D…
          <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => runOp('file.inspectCmo3')} className="gap-2">
          <FileSearch className="h-4 w-4" />
          Inspect .cmo3…
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => onOpenPreferences?.()} className="gap-2">
          <Settings2 className="h-4 w-4" />
          Preferences
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
