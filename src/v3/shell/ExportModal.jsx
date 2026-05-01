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

import { useEffect, useMemo, useState } from 'react';
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
import {
  Loader2, Download, Box, FileArchive, Layers, Bone,
  AlertTriangle, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { runExport } from '../../services/ExportService.js';
import { loadProjectTextures } from '../../io/imageHelpers.js';
import { validateProjectForExport } from '../../io/exportValidation.js';

const FORMAT_OPTIONS = [
  {
    id: 'live2d-full',
    title: 'Live2D Runtime + Auto Rig',
    blurb:
      'Runtime zip with auto-generated warp/rotation deformers, physics, and idle motions. Best for testing in a viewer.',
    icon: Layers,
    extra: { generateRig: true },
    supportsDataLayerPicker: true,
  },
  {
    id: 'live2d-runtime',
    title: 'Live2D Runtime (no rig)',
    blurb: 'moc3 + model3 + textures. Ships an existing rig as-is, no auto-generation.',
    icon: FileArchive,
    extra: { generateRig: false },
    supportsDataLayerPicker: true,
  },
  {
    id: 'cmo3',
    title: 'Cubism Source (.cmo3)',
    blurb: 'Editable source file for Cubism Editor. Best for hand-tuning the rig.',
    icon: Box,
    extra: {},
    supportsDataLayerPicker: true,
  },
  {
    id: 'spine',
    title: 'Spine 4.0 (.json + textures)',
    blurb: 'Skeleton JSON + per-part PNGs zip for Spine runtimes. Inherited from upstream — does not use the Cubism rig data layer.',
    icon: Bone,
    extra: {},
    supportsDataLayerPicker: false,
  },
];

/**
 * GAP-009 — data-layer source. The radio buttons inside the modal let
 * the user pick which inputs feed the Cubism writer:
 *
 *   - 'project'        — use seeded rig from Init Rig + UI customisations
 *                        (the default; "use my edits")
 *   - 'auto-regenerate' — ignore seeded rig, run a fresh harvest from
 *                        PSD geometry. Equivalent to upstream pre-v3
 *                        cmo3writer behaviour. Useful for: clean
 *                        baseline regeneration, sanity-check exports,
 *                        regression-testing heuristic changes, recovery
 *                        from a bad rig-edit state.
 *
 * Translates to `extra.forceRegenerate = (dataLayer === 'auto-regenerate')`
 * which exporter.js routes through resolveAllKeyformSpecs.
 */
const DATA_LAYER_OPTIONS = [
  { id: 'project',         title: 'Project edits',          blurb: 'Use my customisations from the editor (seeded rig + manual tweaks).' },
  { id: 'auto-regenerate', title: 'Regenerate from PSD',    blurb: 'Ignore seeded rig data, derive fresh from PSD geometry. Equivalent to upstream\'s cmo3 path.' },
];

export function ExportModal() {
  const open = useExportModalStore((s) => s.open);
  const close = useExportModalStore((s) => s.close);
  // Subscribing to the project ensures validation re-runs as the
  // user fixes issues without closing/reopening the modal — the
  // hasUnsavedChanges flag flips on every edit so this is essentially
  // free.
  const project = useProjectStore((s) => s.project);
  const [format, setFormat] = useState('live2d-full');
  const [dataLayer, setDataLayer] = useState('project');  // GAP-009
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [overrideErrors, setOverrideErrors] = useState(false);

  const formatOpt = useMemo(() => FORMAT_OPTIONS.find((o) => o.id === format), [format]);
  const showDataLayerPicker = formatOpt?.supportsDataLayerPicker === true;

  const validation = useMemo(
    () => (open ? validateProjectForExport(project) : { errors: [], warnings: [] }),
    [open, project],
  );

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    setOverrideErrors(false);
  }, [open]);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const project = useProjectStore.getState().project;
      const images = await loadProjectTextures(project);
      const opt = FORMAT_OPTIONS.find((o) => o.id === format);
      // GAP-009 — picker only applies when the format supports it.
      const extra = opt?.supportsDataLayerPicker
        ? { ...(opt?.extra ?? {}), forceRegenerate: dataLayer === 'auto-regenerate' }
        : (opt?.extra ?? {});
      const res = await runExport({
        format,
        images,
        extra,
      });
      if (!res.ok || !res.blob) {
        setError(res.error ?? 'Export failed without an error message.');
        setBusy(false);
        return;
      }
      const baseName = (project.name || 'model').trim() || 'model';
      const isZip = res.blob.type === 'application/zip'
        || res.blob.type === 'application/x-zip-compressed';
      const ext = format === 'spine'
        ? '_spine.zip'                                    // GAP-005 Spine target
        : (isZip ? '_live2d.zip' : '.cmo3');
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

        {/* GAP-009 — data-layer picker. Only shown for Cubism formats
            that thread `forceRegenerate` through resolveAllKeyformSpecs. */}
        {showDataLayerPicker ? (
          <div className="border border-border rounded p-2.5 mt-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Rig data source
            </div>
            <RadioGroup value={dataLayer} onValueChange={(v) => setDataLayer(v)} className="flex flex-col gap-1.5">
              {DATA_LAYER_OPTIONS.map((opt) => {
                const active = dataLayer === opt.id;
                return (
                  <Label
                    key={opt.id}
                    htmlFor={`datalayer-${opt.id}`}
                    className={
                      'flex items-start gap-2 p-2 rounded cursor-pointer transition-colors text-xs ' +
                      (active ? 'bg-primary/5' : 'hover:bg-muted/30')
                    }
                  >
                    <RadioGroupItem id={`datalayer-${opt.id}`} value={opt.id} className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{opt.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{opt.blurb}</div>
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>
        ) : null}

        <ValidationPanel
          result={validation}
          override={overrideErrors}
          onOverrideChange={setOverrideErrors}
        />

        {error ? (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            onClick={handleExport}
            disabled={busy || (validation.errors.length > 0 && !overrideErrors)}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Phase 4F preflight panel. Mounted between the format radio and
 * the action footer. The "Export anyway" checkbox is hidden when
 * there are no errors (warnings never block).
 *
 * Click on an issue with a `nodeId` selects that node so the user
 * jumps straight to it after closing the modal.
 *
 * @param {{
 *   result: { errors: any[], warnings: any[] },
 *   override: boolean,
 *   onOverrideChange: (b: boolean) => void
 * }} props
 */
function ValidationPanel({ result, override, onOverrideChange }) {
  const { errors, warnings } = result;
  const select = useSelectionStore((s) => s.select);

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500 border border-emerald-500/30 rounded p-2 bg-emerald-500/5">
        <CheckCircle2 size={14} />
        Project looks ready to export.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
      {errors.map((iss, i) => (
        <IssueRow key={`e${i}`} issue={iss} onJump={(id) => select({ type: 'part', id }, 'replace')} />
      ))}
      {warnings.map((iss, i) => (
        <IssueRow key={`w${i}`} issue={iss} onJump={(id) => select({ type: 'part', id }, 'replace')} />
      ))}

      {errors.length > 0 ? (
        <Label className="flex items-center gap-2 text-xs cursor-pointer mt-1 select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-destructive"
            checked={override}
            onChange={(e) => onOverrideChange(e.target.checked)}
          />
          Export anyway — I know what I'm doing.
        </Label>
      ) : null}
    </div>
  );
}

function IssueRow({ issue, onJump }) {
  const isError = issue.level === 'error';
  const Icon = isError ? AlertCircle : AlertTriangle;
  const tone = isError
    ? 'text-destructive border-destructive/30 bg-destructive/5'
    : 'text-amber-700 dark:text-amber-500 border-amber-500/30 bg-amber-500/5';
  return (
    <button
      type="button"
      onClick={() => issue.nodeId && onJump(issue.nodeId)}
      disabled={!issue.nodeId}
      className={
        'flex items-start gap-2 text-xs border rounded p-2 text-left transition-colors ' +
        tone +
        (issue.nodeId ? ' hover:bg-opacity-100 cursor-pointer' : ' cursor-default')
      }
      title={issue.nodeId ? 'Click to select the offending node' : undefined}
    >
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <div>{issue.message}</div>
        <div className="text-[10px] opacity-60 font-mono mt-0.5">{issue.code}</div>
      </div>
    </button>
  );
}
