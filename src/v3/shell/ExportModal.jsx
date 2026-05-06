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
  Loader2, Download, Box, Layers, Bone, Film, Image as ImageIcon, Activity,
  AlertTriangle, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { useCaptureStore } from '../../store/captureStore.js';
import { runExport } from '../../services/ExportService.js';
import { loadProjectTextures } from '../../io/imageHelpers.js';
import { validateProjectForExport } from '../../io/exportValidation.js';
import {
  computeExportFrameSpecs,
  computeAnalyticalBounds,
  resolveAnimations,
  exportFrames,
} from '../../io/exportAnimation.js';
import { generateMotion3Json } from '../../io/live2d/motion3json.js';

/**
 * Format options grouped by section. Each `groupId` clusters cards
 * under a section header in the UI; the radio group itself is still
 * one (only one format selected at a time).
 *
 * Live2D section:
 *   - Runtime (.moc3.zip) — bundle of moc3 + model3 + cdi3 + physics3 +
 *     motion3 + texture atlas. Ready to drop into a viewer / engine.
 *   - Project (.cmo3)     — single-file Cubism Editor source.
 *
 * The legacy 'live2d-runtime' format (no auto-rig) is still callable
 * from operators / API but no longer surfaced in the UI — the rig
 * data source picker covers the "use my edits as-is" use case
 * cleanly without a second top-level option.
 */
const FORMAT_OPTIONS = [
  {
    id: 'live2d-full',
    groupId: 'live2d',
    title: 'Runtime (.moc3.zip)',
    blurb: 'moc3 + model3 + cdi3 + physics3 + textures. Drop into a Cubism viewer or engine.',
    icon: Layers,
    extra: { generateRig: true },
    supportsDataLayerPicker: true,
  },
  {
    id: 'cmo3',
    groupId: 'live2d',
    title: 'Project (.cmo3)',
    blurb: 'Single-file Cubism Editor source. Best for hand-tuning the rig.',
    icon: Box,
    extra: {},
    supportsDataLayerPicker: true,
  },
  // 2026-05-05 — standalone .motion3.json zip. The Runtime export
  // already bundles motion3 files for every project animation, but
  // sometimes the user wants just the motions (drop into an existing
  // Cubism rig, share a motion library, etc.) without re-exporting
  // the whole model. Honours the animation target picker (Current /
  // All / specific). No rig writer involved → no data-layer picker.
  {
    id: 'motion3',
    groupId: 'live2d',
    title: 'Animations (.motion3.json zip)',
    blurb: 'Per-animation Cubism motion files only — drop into an existing model. Use the animation picker below.',
    icon: Activity,
    extra: {},
    supportsDataLayerPicker: false,
  },
  {
    id: 'spine',
    groupId: 'other',
    title: 'Spine 4.0 (.json + textures)',
    blurb: 'Skeleton JSON + per-part PNGs zip for Spine runtimes. Does not use the Cubism rig data layer.',
    icon: Bone,
    extra: {},
    supportsDataLayerPicker: false,
  },
  // 2026-05-05 — frame export ports from upstream's ExportModal. Both
  // formats render the canvas via `captureStore.captureExportFrame`
  // (CanvasArea publishes the bridge on mount), then bundle via
  // `exportFrames`. The Cubism rig data layer is not relevant for
  // frame output, so `supportsDataLayerPicker: false`.
  {
    id: 'sequence',
    groupId: 'frames',
    title: 'PNG sequence (zip)',
    blurb: 'One PNG per frame, grouped by animation in a zip. Drop into After Effects / Spine / a video encoder.',
    icon: Film,
    extra: {},
    supportsDataLayerPicker: false,
  },
  {
    id: 'single-frame',
    groupId: 'frames',
    title: 'Single frame (PNG)',
    blurb: 'One PNG at the chosen frame index. Useful for thumbnails or marketing stills.',
    icon: ImageIcon,
    extra: {},
    supportsDataLayerPicker: false,
  },
];

/** Section headers, rendered in this order. */
const FORMAT_GROUPS = [
  { id: 'live2d', label: 'Live2D' },
  { id: 'frames', label: 'Frames / images' },
  { id: 'other',  label: 'Other formats' },
];

/** Frame-output formats. Image-only — gif / webm / mp4 would need
 *  encoder bundles we don't ship today. */
const FRAME_FORMAT_OPTIONS = [
  { id: 'png',  title: 'PNG',  blurb: 'Lossless, transparent BG supported.' },
  { id: 'webp', title: 'WEBP', blurb: 'Smaller than PNG, transparent BG supported.' },
  { id: 'jpg',  title: 'JPG',  blurb: 'Smallest. No transparency — set a solid bg color below.' },
];

/** Animation target options. */
const ANIM_TARGET_OPTIONS = [
  { id: 'current', title: 'Current animation' },
  { id: 'all',     title: 'All animations' },
  { id: 'staging', title: 'Staging (pose preview)' },
];

/** Output-area options — full canvas vs analytical bounds (tight crop). */
const IMAGE_CONTAINS_OPTIONS = [
  { id: 'canvas_area',    title: 'Canvas area',          blurb: 'Match the project canvas dimensions.' },
  { id: 'min_image_area', title: 'Tight crop',           blurb: 'Crop to the bounding box of all visible parts.' },
];

/** Tiny helper — push a blob through an `<a download>` click. Shared by
 *  the live2d / spine path (existing) and the new motion3 path. */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

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
  const activeAnimationId = useAnimationStore((s) => s.activeAnimationId);
  const [format, setFormat] = useState('live2d-full');
  const [dataLayer, setDataLayer] = useState('project');  // GAP-009
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(/** @type {{current:number,total:number,label:string}|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [overrideErrors, setOverrideErrors] = useState(false);

  // 2026-05-05 — frame-export controls. Only visible when a frame
  // format ('sequence' / 'single-frame') is selected.
  const [animTarget, setAnimTarget] = useState('current');
  const [exportFps, setExportFps] = useState(24);
  const [frameIndex, setFrameIndex] = useState(0);
  const [imageContains, setImageContains] = useState('canvas_area');
  const [outputScale, setOutputScale] = useState(100);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [frameFormat, setFrameFormat] = useState('png');
  const [exportDest, setExportDest] = useState('zip');

  const formatOpt = useMemo(() => FORMAT_OPTIONS.find((o) => o.id === format), [format]);
  const showDataLayerPicker = formatOpt?.supportsDataLayerPicker === true;
  const isFrameFormat = formatOpt?.groupId === 'frames';
  const isSequence = format === 'sequence';
  const isSingleFrame = format === 'single-frame';
  const isMotion3 = format === 'motion3';
  // Animation picker is shared between frame formats and motion3.
  const showAnimationPicker = isFrameFormat || isMotion3;

  const validation = useMemo(
    () => (open ? validateProjectForExport(project) : { errors: [], warnings: [] }),
    [open, project],
  );

  // Frame-range derivation for the single-frame slider.
  const targetAnims = useMemo(
    () => resolveAnimations(project.animations ?? [], animTarget, activeAnimationId),
    [project.animations, animTarget, activeAnimationId],
  );
  const maxDuration = targetAnims.length > 0
    ? Math.max(...targetAnims.map((a) => a.duration ?? 2000))
    : 0;
  const totalFrames = targetAnims.length > 0
    ? Math.max(1, Math.round((maxDuration / 1000) * exportFps))
    : 0;
  const maxFrameIndex = Math.max(0, totalFrames - 1);

  useEffect(() => {
    if (frameIndex > maxFrameIndex) setFrameIndex(maxFrameIndex);
  }, [maxFrameIndex, frameIndex]);

  // Sync defaults on open: pull fps from active animation, bg from
  // canvas, and bounce animTarget to 'staging' if no animations exist.
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    setOverrideErrors(false);
    setProgress(null);
    if ((project.animations ?? []).length === 0) {
      setAnimTarget('staging');
    }
    const activeAnim = (project.animations ?? []).find((a) => a.id === activeAnimationId);
    if (activeAnim?.fps && Number.isFinite(activeAnim.fps)) {
      setExportFps(activeAnim.fps);
    }
    const hasBg = project.canvas?.bgEnabled === true;
    setBgMode(hasBg ? 'custom' : 'transparent');
    setBgColor(project.canvas?.bgColor ?? '#ffffff');
  }, [open, project, activeAnimationId]);

  async function handleExport() {
    if (isFrameFormat) {
      return handleFrameExport();
    }
    if (isMotion3) {
      return handleMotion3Export();
    }
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

  /**
   * 2026-05-05 — frame export handler. Mirrors the upstream
   * `handleExport` flow for type='sequence' / type='single_frame':
   *   1. Resolve animations to render via `resolveAnimations`.
   *   2. Compute frame specs (one per (anim, frameIndex)).
   *   3. Compute output canvas size from `imageContains` + `outputScale`.
   *   4. For each spec, call `captureStore.captureExportFrame` to
   *      render the rig into an offscreen canvas at the chosen size +
   *      bg + crop and get a data URL.
   *   5. Bundle via `exportFrames` (single-file download for one frame,
   *      zip otherwise).
   */
  async function handleFrameExport() {
    setBusy(true);
    setError(null);
    setProgress({ current: 0, total: 1, label: 'Preparing…' });
    try {
      const proj = useProjectStore.getState().project;
      const captureFrame = useCaptureStore.getState().captureExportFrame;
      if (typeof captureFrame !== 'function') {
        setError('Canvas viewport is not mounted — open the Viewport tab and try again.');
        setBusy(false);
        setProgress(null);
        return;
      }
      const animsToExport = resolveAnimations(
        proj.animations ?? [], animTarget, activeAnimationId,
      );
      if (animsToExport.length === 0) {
        setError('No animations selected to export.');
        setBusy(false);
        setProgress(null);
        return;
      }
      const specs = computeExportFrameSpecs({
        type: isSingleFrame ? 'single_frame' : 'sequence',
        animsToExport,
        exportFps,
        frameIndex,
      });

      // Output dimensions + crop.
      const scale = outputScale / 100;
      let cropOffset = null;
      let exportW;
      let exportH;
      if (imageContains === 'min_image_area') {
        const bounds = computeAnalyticalBounds(proj);
        exportW = Math.round((bounds?.width ?? proj.canvas?.width ?? 0) * scale);
        exportH = Math.round((bounds?.height ?? proj.canvas?.height ?? 0) * scale);
        cropOffset = bounds ? { x: bounds.x, y: bounds.y } : null;
      } else {
        exportW = Math.round((proj.canvas?.width ?? 0) * scale);
        exportH = Math.round((proj.canvas?.height ?? 0) * scale);
      }

      const frameDataItems = [];
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        setProgress({
          current: i + 1,
          total: specs.length,
          label: `${spec.animName} — frame ${spec.frameIndex + 1} / ${specs.length}`,
        });
        const dataUrl = captureFrame({
          animId: spec.animId,
          timeMs: spec.timeMs,
          bgEnabled: bgMode === 'custom',
          bgColor,
          exportWidth: exportW,
          exportHeight: exportH,
          format: frameFormat,
          quality: 0.92,
          cropOffset,
        });
        if (dataUrl) {
          frameDataItems.push({
            animName: spec.animName,
            frameIndex: spec.frameIndex,
            dataUrl,
          });
        }
        // Yield to the browser so rAF + UI updates can paint.
        await new Promise((r) => setTimeout(r, 0));
      }

      setProgress({ current: specs.length, total: specs.length, label: 'Writing output…' });
      await exportFrames({
        frames: frameDataItems,
        format: frameFormat,
        exportDest,
        onProgress: (msg) => setProgress((p) => p ? { ...p, label: msg } : null),
      });

      setProgress(null);
      setBusy(false);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
      setBusy(false);
    }
  }

  /**
   * 2026-05-05 — standalone .motion3.json zip export. Iterates the
   * animations the user picked (Current / All / specific id), runs
   * `generateMotion3Json` on each, and bundles them as a zip with
   * `<sanitizedAnimName>.motion3.json` files.
   *
   * No rig writer involved — pure conversion of the project's
   * animation tracks into Cubism's segment-encoded curve format.
   * If the user picked a single animation and only one survives the
   * generator, we download it directly instead of zipping.
   */
  async function handleMotion3Export() {
    setBusy(true);
    setError(null);
    setProgress({ current: 0, total: 1, label: 'Resolving animations…' });
    try {
      const proj = useProjectStore.getState().project;
      const animsToExport = resolveAnimations(
        proj.animations ?? [], animTarget, activeAnimationId,
      ).filter((a) => a && a.id !== 'staging');  // staging has no tracks; skip

      if (animsToExport.length === 0) {
        setError('No animations to export. Create one first or pick a different target.');
        setBusy(false);
        setProgress(null);
        return;
      }

      const baseName = (proj.name || 'model').trim() || 'model';
      const safe = (s) => (s ?? 'animation')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

      // Single anim → direct download.
      if (animsToExport.length === 1) {
        const anim = animsToExport[0];
        setProgress({ current: 1, total: 1, label: `Generating ${anim.name}…` });
        const json = generateMotion3Json(anim);
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `${safe(anim.name)}.motion3.json`);
        setProgress(null);
        setBusy(false);
        close();
        return;
      }

      // Multi-anim → zip.
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let i = 0; i < animsToExport.length; i++) {
        const anim = animsToExport[i];
        setProgress({
          current: i + 1,
          total: animsToExport.length,
          label: `Generating ${anim.name} (${i + 1}/${animsToExport.length})`,
        });
        const json = generateMotion3Json(anim);
        zip.file(`${safe(anim.name)}.motion3.json`, JSON.stringify(json, null, 2));
        // Yield to the browser so the progress bar paints.
        await new Promise((r) => setTimeout(r, 0));
      }
      setProgress({ current: animsToExport.length, total: animsToExport.length, label: 'Generating zip…' });
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, `${baseName}_motions.zip`);

      setProgress(null);
      setBusy(false);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
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

        <RadioGroup value={format} onValueChange={(v) => setFormat(v)} className="flex flex-col gap-3 my-2">
          {FORMAT_GROUPS.map((group) => {
            const items = FORMAT_OPTIONS.filter((o) => o.groupId === group.id);
            if (items.length === 0) return null;
            return (
              <div key={group.id} className="flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 px-0.5">
                  {group.label}
                </div>
                <div className="flex flex-col gap-1.5">
                  {items.map((opt) => {
                    const Icon = opt.icon;
                    const active = format === opt.id;
                    return (
                      <Label
                        key={opt.id}
                        htmlFor={`export-${opt.id}`}
                        className={
                          'flex items-start gap-3 p-2.5 rounded border cursor-pointer transition-colors ' +
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
                </div>
              </div>
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

        {/* 2026-05-05 — frame export controls. Visible when the
            selected format is in the 'frames' group. Pixel-faithful to
            upstream's animation export UI. Live2D validation is
            irrelevant for frame output (no rig writer involved), so
            the panel below renders unconditionally; if errors exist
            they don't block frame export. */}
        {isFrameFormat ? (
          <FrameExportControls
            project={project}
            isSequence={isSequence}
            isSingleFrame={isSingleFrame}
            animTarget={animTarget}
            setAnimTarget={setAnimTarget}
            exportFps={exportFps}
            setExportFps={setExportFps}
            frameIndex={frameIndex}
            setFrameIndex={setFrameIndex}
            maxFrameIndex={maxFrameIndex}
            totalFrames={totalFrames}
            imageContains={imageContains}
            setImageContains={setImageContains}
            outputScale={outputScale}
            setOutputScale={setOutputScale}
            bgMode={bgMode}
            setBgMode={setBgMode}
            bgColor={bgColor}
            setBgColor={setBgColor}
            frameFormat={frameFormat}
            setFrameFormat={setFrameFormat}
            exportDest={exportDest}
            setExportDest={setExportDest}
          />
        ) : null}

        {/* motion3 needs only the animation picker — no fps / scale /
            bg / format controls (the format is JSON-segment-encoded
            curves, not pixels). Compact panel below the format radio. */}
        {isMotion3 ? (
          <Motion3ExportControls
            project={project}
            animTarget={animTarget}
            setAnimTarget={setAnimTarget}
          />
        ) : null}

        {/* Validation only matters for Live2D / Spine paths — frame
            output skips the rig writer entirely. Hide it for frame
            formats so the user isn't blocked on irrelevant warnings. */}
        {!isFrameFormat ? (
          <ValidationPanel
            result={validation}
            override={overrideErrors}
            onOverrideChange={setOverrideErrors}
          />
        ) : null}

        {error ? (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            {error}
          </div>
        ) : null}

        {progress ? (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground border border-border rounded p-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="truncate">{progress.label}</span>
              <span className="tabular-nums shrink-0 ml-2">
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            onClick={handleExport}
            disabled={busy || (!isFrameFormat && validation.errors.length > 0 && !overrideErrors)}
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

/**
 * 2026-05-05 — Frame export option panel. Surfaces:
 *   - Animation target (current / all / staging) + per-anim picker
 *     when project.animations has more than one animation.
 *   - FPS (sequence only).
 *   - Frame index slider (single-frame only).
 *   - Output framing (canvas-area vs tight-crop).
 *   - Output scale (25 / 50 / 100 / 200%).
 *   - Background mode (transparent vs custom solid color).
 *   - Output format (png / webp / jpg).
 *   - Output destination (zip — always for sequence; auto-skipped for
 *     single-frame which becomes a direct download).
 *
 * Pure presentation — all state lives in the parent ExportModal.
 *
 * @param {Object} props
 */
function FrameExportControls(props) {
  const {
    project,
    isSequence, isSingleFrame,
    animTarget, setAnimTarget,
    exportFps, setExportFps,
    frameIndex, setFrameIndex,
    maxFrameIndex, totalFrames,
    imageContains, setImageContains,
    outputScale, setOutputScale,
    bgMode, setBgMode, bgColor, setBgColor,
    frameFormat, setFrameFormat,
    exportDest, setExportDest,
  } = props;

  const animations = project.animations ?? [];
  const hasFolderPicker = typeof window !== 'undefined'
    && typeof window.showDirectoryPicker === 'function';

  return (
    <div className="border border-border rounded p-3 mt-1 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Frame export options
      </div>

      {/* Animation target */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Animation</label>
          <select
            value={animTarget}
            onChange={(e) => setAnimTarget(e.target.value)}
            className="h-8 px-2 rounded border border-border bg-background text-xs"
          >
            {ANIM_TARGET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.title}</option>
            ))}
            {animations.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Format */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Format</label>
          <select
            value={frameFormat}
            onChange={(e) => setFrameFormat(e.target.value)}
            className="h-8 px-2 rounded border border-border bg-background text-xs"
          >
            {FRAME_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* FPS — sequence only */}
      {isSequence ? (
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-20">Frames / sec</label>
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={exportFps}
            onChange={(e) => setExportFps(Math.max(1, Math.min(60, Number(e.target.value) || 24)))}
            className="h-7 w-20 px-2 rounded border border-border bg-background text-xs tabular-nums"
          />
          <span className="text-[10px] text-muted-foreground">
            {totalFrames > 0 ? `${totalFrames} frames per anim` : ''}
          </span>
        </div>
      ) : null}

      {/* Frame index slider — single frame only */}
      {isSingleFrame ? (
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-20">Frame #</label>
          <input
            type="range"
            min={0}
            max={maxFrameIndex}
            step={1}
            value={frameIndex}
            onChange={(e) => setFrameIndex(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-[10px] tabular-nums w-16 text-right text-muted-foreground">
            {frameIndex + 1} / {totalFrames || 1}
          </span>
        </div>
      ) : null}

      {/* Framing + scale */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Output area</label>
          <select
            value={imageContains}
            onChange={(e) => setImageContains(e.target.value)}
            className="h-8 px-2 rounded border border-border bg-background text-xs"
            title={IMAGE_CONTAINS_OPTIONS.find((o) => o.id === imageContains)?.blurb}
          >
            {IMAGE_CONTAINS_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Scale: {outputScale}%</label>
          <input
            type="range"
            min={25}
            max={200}
            step={25}
            value={outputScale}
            onChange={(e) => setOutputScale(Number(e.target.value))}
            className="h-8 accent-primary"
          />
        </div>
      </div>

      {/* Background */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground w-20">Background</label>
        <select
          value={bgMode}
          onChange={(e) => setBgMode(e.target.value)}
          className="h-7 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="transparent">Transparent</option>
          <option value="custom">Custom color</option>
        </select>
        {bgMode === 'custom' ? (
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="h-7 w-10 rounded border border-border bg-background cursor-pointer"
          />
        ) : null}
        {frameFormat === 'jpg' && bgMode === 'transparent' ? (
          <span className="text-[10px] text-amber-500 ml-auto">
            JPG has no transparency — will render black.
          </span>
        ) : null}
      </div>

      {/* Destination — sequence only (single-frame is always direct download) */}
      {isSequence ? (
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-20">Destination</label>
          <select
            value={exportDest}
            onChange={(e) => setExportDest(e.target.value)}
            className="h-7 px-2 rounded border border-border bg-background text-xs"
          >
            <option value="zip">Zip download</option>
            {hasFolderPicker ? (
              <option value="folder">Pick a folder…</option>
            ) : null}
          </select>
          {!hasFolderPicker ? (
            <span className="text-[10px] text-muted-foreground">
              (folder picker unavailable in this browser)
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 2026-05-05 — Motion3 export option panel. Animations only — no
 * pixel controls. Surfaces the same animation target picker as
 * `FrameExportControls` but skips fps / scale / bg / format /
 * destination since they're irrelevant for JSON output.
 *
 * @param {{
 *   project: object,
 *   animTarget: string,
 *   setAnimTarget: (v: string) => void,
 * }} props
 */
function Motion3ExportControls({ project, animTarget, setAnimTarget }) {
  const animations = project.animations ?? [];
  const targetCount = animations.length;
  return (
    <div className="border border-border rounded p-3 mt-1 flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Cubism animations
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground w-20 shrink-0">Pick</label>
        <select
          value={animTarget}
          onChange={(e) => setAnimTarget(e.target.value)}
          className="h-8 flex-1 px-2 rounded border border-border bg-background text-xs"
        >
          {ANIM_TARGET_OPTIONS.filter((o) => o.id !== 'staging').map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.title}</option>
          ))}
          {animations.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {targetCount === 0
          ? 'No animations in this project yet — create one in the Animation workspace.'
          : `Project has ${targetCount} animation${targetCount === 1 ? '' : 's'}. One animation → direct .motion3.json download. Multiple → zip.`}
      </div>
    </div>
  );
}
