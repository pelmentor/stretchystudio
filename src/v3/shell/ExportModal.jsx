/**
 * v3 Phase 5 — Export options modal.
 *
 * Three formats supported by ExportService:
 *  - `cmo3`         — Cubism Editor source file. Re-import for
 *                     hand-editing the rig.
 *  - `live2d-runtime` — runtime-only zip (moc3, model3, etc.) with no
 *                     rig generation. Smallest, fastest.
 *  - `live2d-full`  — runtime zip + auto-generated rig + physics +
 *                     motions. Default; most useful for testing.
 *
 * Wired through `useExportModalStore` so the toolbar / keymap can
 * call a single `openExport()` regardless of where the request came
 * from. Triggers `runExport` with the selected format and routes the
 * blob through the same `downloadBlob` helper the operator uses.
 *
 * @module v3/shell/ExportModal
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
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Loader2, Download, Box, FileArchive, Layers } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { runExport } from '../../services/ExportService.js';
import { loadProjectTextures } from '../../io/imageHelpers.js';

const FORMAT_OPTIONS = [
  {
    id: 'live2d-full',
    title: 'Live2D Runtime + Auto Rig',
    blurb:
      'Runtime zip with auto-generated warp/rotation deformers, physics, and idle motions. Best for testing in a viewer.',
    icon: Layers,
    extra: { generateRig: true },
  },
  {
    id: 'live2d-runtime',
    title: 'Live2D Runtime (no rig)',
    blurb: 'moc3 + model3 + textures. Ships an existing rig as-is, no auto-generation.',
    icon: FileArchive,
    extra: { generateRig: false },
  },
  {
    id: 'cmo3',
    title: 'Cubism Source (.cmo3)',
    blurb: 'Editable source file for Cubism Editor. Best for hand-tuning the rig.',
    icon: Box,
    extra: {},
  },
];

export function ExportModal() {
  const open = useExportModalStore((s) => s.open);
  const close = useExportModalStore((s) => s.close);
  const [format, setFormat] = useState('live2d-full');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const project = useProjectStore.getState().project;
      const images = await loadProjectTextures(project);
      const opt = FORMAT_OPTIONS.find((o) => o.id === format);
      const res = await runExport({
        format,
        images,
        extra: opt?.extra ?? {},
      });
      if (!res.ok || !res.blob) {
        setError(res.error ?? 'Export failed without an error message.');
        setBusy(false);
        return;
      }
      const baseName = (project.name || 'model').trim() || 'model';
      const isZip = res.blob.type === 'application/zip'
        || res.blob.type === 'application/x-zip-compressed';
      const ext = isZip ? '_live2d.zip' : '.cmo3';
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseName + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={16} className="text-primary" />
            Export Live2D Model
          </DialogTitle>
          <DialogDescription>
            Pick the output format. Auto-rig regenerates the rig from the project's PSD layout +
            tag annotations on every export.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={format} onValueChange={(v) => setFormat(v)} className="flex flex-col gap-2 my-2">
          {FORMAT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = format === opt.id;
            return (
              <Label
                key={opt.id}
                htmlFor={`export-${opt.id}`}
                className={
                  'flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/30')
                }
              >
                <RadioGroupItem id={`export-${opt.id}`} value={opt.id} className="mt-0.5" />
                <Icon size={18} className={active ? 'text-primary' : 'text-muted-foreground'} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">{opt.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.blurb}</div>
                </div>
              </Label>
            );
          })}
        </RadioGroup>

        {error ? (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={handleExport} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
