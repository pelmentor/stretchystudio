import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import {
  exportFrames,
  computeExportFrameSpecs,
  computeAnalyticalBounds,
  resolveAnimations,
} from '@/io/exportAnimation';
import { exportLive2D, exportLive2DProject } from '@/io/live2d';

export function ExportModal({ open, onClose, captureRef, projectName, projectId }) {
  // Form state
  const [type, setType] = useState('sequence');
  const [format, setFormat] = useState('png');
  const [animTarget, setAnimTarget] = useState('current');
  const [exportFps, setExportFps] = useState(24);
  const [frameIndex, setFrameIndex] = useState(0);
  const [imageContains, setImageContains] = useState('canvas_area');
  const [outputScale, setOutputScale] = useState(100);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [exportDest, setExportDest] = useState('zip');
  const [modelName, setModelName] = useState('model');
  const [atlasSize, setAtlasSize] = useState(2048);
  const [generateRig, setGenerateRig] = useState(true);
  const [generatePhysics, setGeneratePhysics] = useState(true);
  // Per-category toggles (on = category emitted, off = all rules in that
  // category skipped). Use case: characters like shelby with a buzz cut
  // still have `front hair` / `back hair` tags, so the requireTag auto-skip
  // doesn't catch them — user has to manually opt out of hair physics.
  const [physicsHair, setPhysicsHair] = useState(true);
  const [physicsClothing, setPhysicsClothing] = useState(true);
  const [physicsBust, setPhysicsBust] = useState(true);
  const [physicsArms, setPhysicsArms] = useState(true);
  // Procedural motion synthesis (cmo3 project export) — bundles selected
  // motions into .can3 (editable in Cubism Editor's Animation workspace) and
  // alongside as runtime .motion3.json files. Each motion has independent
  // enabled/personality/duration settings. See src/io/live2d/idle/builder.js.
  const [motionConfigs, setMotionConfigs] = useState({
    idle:            { enabled: false, personality: 'calm',    duration: 8 },
    listening:       { enabled: false, personality: 'calm',    duration: 6 },
    talkingIdle:     { enabled: false, personality: 'calm',    duration: 8 },
    embarrassedHold: { enabled: false, personality: 'nervous', duration: 4 },
  });
  const updateMotionConfig = useCallback((preset, patch) => {
    setMotionConfigs(prev => ({ ...prev, [preset]: { ...prev[preset], ...patch } }));
  }, []);
  // Track whether user has explicitly edited the model-name field. While
  // untouched, the field auto-syncs to the current project's name on every
  // open — so loading a new project and then exporting shows the right default.
  const [modelNameTouched, setModelNameTouched] = useState(false);

  // Progress state
  const [progress, setProgress] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  // Store access
  const project = useProjectStore(s => s.project);
  const animStore = useAnimationStore();

  // Sync defaults when modal opens
  useEffect(() => {
    if (!open) return;
    if (project.animations.length === 0) {
      setAnimTarget('staging');
    } else if (animTarget === 'current' && !animStore.activeAnimationId) {
      // If no active anim, just keep it on what it determines or staging if empty
    }
    const activeAnim = project.animations.find(a => a.id === animStore.activeAnimationId);
    setExportFps(activeAnim?.fps ?? animStore.fps ?? 24);
    const hasBg = project.canvas.bgEnabled;
    setBgMode(hasBg ? 'custom' : 'transparent');
    setBgColor(project.canvas.bgColor ?? '#ffffff');
    // Default model name to the loaded project name (sanitized for filename
    // safety). Only applies while the user hasn't manually edited the field.
    if (!modelNameTouched) {
      const candidate = (projectName || '').trim();
      const sanitized = candidate
        ? candidate.replace(/[\\/:*?"<>|]/g, '').trim() || 'model'
        : 'model';
      setModelName(sanitized);
    }
  }, [open, project, animStore, animTarget, projectName, modelNameTouched]);

  // Reset manual-edit tracker when a new project loads so its name gets
  // auto-applied the next time the modal opens.
  useEffect(() => {
    setModelNameTouched(false);
  }, [projectId]);

  const handleLive2DExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    setProgress({ current: 0, total: 1, label: 'Loading textures...' });

    try {
      // Load texture images from blob URLs
      const images = new Map();
      for (const tex of project.textures) {
        if (!tex.source) continue;
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => { images.set(tex.id, img); resolve(); };
          img.onerror = reject;
          img.src = tex.source;
        });
      }

      const name = modelName.trim() || 'model';

      // Common: derive physics disabled categories + motion preset list from
      // the UI state. Both export paths (project + runtime) consume the same
      // shapes.
      const physicsDisabledCategories = [
        !physicsHair && 'hair',
        !physicsClothing && 'clothing',
        !physicsBust && 'bust',
        !physicsArms && 'arms',
      ].filter(Boolean);
      const motionPresets = Object.entries(motionConfigs)
        .filter(([, cfg]) => cfg.enabled)
        .map(([preset, cfg]) => ({
          preset,
          personality: cfg.personality,
          durationSec: cfg.duration,
        }));

      if (type === 'live2d_project') {
        // .cmo3 project export (editable in Cubism Editor)
        const blob = await exportLive2DProject(project, images, {
          modelName: name,
          generateRig,
          generatePhysics,
          physicsDisabledCategories,
          motionPresets,
          onProgress: (msg) =>
            setProgress(p => (p ? { ...p, label: msg } : null)),
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Exporter bundles as ZIP when animations OR rig debug log are present.
        // Detect via MIME type: zips come back as application/zip, bare .cmo3 as octet-stream.
        const isZip = blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed';
        const hasAnims = project.animations?.length > 0;
        a.download = (isZip || hasAnims || generateRig) ? `${name}_live2d.zip` : `${name}.cmo3`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // .moc3 runtime export (ZIP — Ren'Py / SDK ready, no Cubism Editor required)
        const blob = await exportLive2D(project, images, {
          modelName: name,
          atlasSize,
          exportMotions: true,
          generatePhysics,
          physicsDisabledCategories,
          motionPresets,
          onProgress: (msg) =>
            setProgress(p => (p ? { ...p, label: msg } : null)),
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_live2d.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }

      setProgress(null);
      setIsExporting(false);
      onClose();
    } catch (err) {
      console.error('[Live2D Export] Failed:', err);
      setExportError(err.message || 'Export failed');
      setProgress(null);
      setIsExporting(false);
    }
  }, [project, modelName, atlasSize, type, generateRig, generatePhysics, physicsHair, physicsClothing, physicsBust, physicsArms, motionConfigs, onClose]);

  const handleExport = useCallback(async () => {
    if (type === 'live2d' || type === 'live2d_project') {
      return handleLive2DExport();
    }

    if (!captureRef?.current) {
      console.error('[Export] captureRef not available');
      return;
    }

    setIsExporting(true);
    setProgress({ current: 0, total: 1, label: 'Preparing...' });

    try {
      // Resolve which animations to export
      const animsToExport = resolveAnimations(
        project.animations,
        animTarget,
        animStore.activeAnimationId
      );

      if (type === 'spine') {
        const { exportToSpine } = await import('@/io/exportSpine');
        const zipBlob = await exportToSpine({
          project,
          onProgress: label => setProgress(p => p ? { ...p, label } : { current: 1, total: 1, label })
        });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spine_export.zip';
        a.click();
        URL.revokeObjectURL(url);
        setProgress(null);
        setIsExporting(false);
        return;
      }

      if (animsToExport.length === 0) {
        setProgress(null);
        setIsExporting(false);
        alert('No target selected to export');
        return;
      }

      // Compute frame specs
      const frameSpecs = computeExportFrameSpecs({
        type,
        animsToExport,
        exportFps,
        frameIndex,
      });

      // Compute export dimensions
      const scale = outputScale / 100;
      let cropOffset = null;
      let exportW, exportH;

      if (imageContains === 'min_image_area') {
        const bounds = computeAnalyticalBounds(project);
        exportW = Math.round(
          (bounds?.width ?? project.canvas.width) * scale
        );
        exportH = Math.round(
          (bounds?.height ?? project.canvas.height) * scale
        );
        cropOffset = bounds ? { x: bounds.x, y: bounds.y } : null;
      } else {
        exportW = Math.round(project.canvas.width * scale);
        exportH = Math.round(project.canvas.height * scale);
      }

      // Capture each frame
      const frameDataItems = [];
      const total = frameSpecs.length;

      for (let i = 0; i < total; i++) {
        const spec = frameSpecs[i];
        setProgress({
          current: i + 1,
          total,
          label: `${spec.animName} — frame ${spec.frameIndex + 1}`,
        });

        const dataUrl = captureRef.current({
          animId: spec.animId,
          timeMs: spec.timeMs,
          bgEnabled: bgMode === 'custom',
          bgColor,
          exportWidth: exportW,
          exportHeight: exportH,
          format,
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

        // Yield to browser for rAF and UI updates
        await new Promise(r => setTimeout(r, 0));
      }

      // Export to ZIP or Folder
      setProgress({
        current: total,
        total,
        label: 'Writing output...',
      });

      await exportFrames({
        frames: frameDataItems,
        format,
        exportDest,
        onProgress: msg =>
          setProgress(p => (p ? { ...p, label: msg } : null)),
      });

      setProgress(null);
      setIsExporting(false);
    } catch (err) {
      console.error('[Export] Failed:', err);
      setExportError(err.message || 'Export failed');
      setProgress(null);
      setIsExporting(false);
    }
  }, [
    captureRef,
    project,
    animStore,
    type,
    format,
    animTarget,
    exportFps,
    frameIndex,
    imageContains,
    outputScale,
    bgMode,
    bgColor,
    exportDest,
    onClose,
    handleLive2DExport,
  ]);

  const isLive2D = type === 'live2d' || type === 'live2d_project';
  const isSpine = type === 'spine';
  const showFpsInput = type === 'sequence';
  const showFrameInput = type === 'single_frame';
  const hasFolderSupport = 'showDirectoryPicker' in window;
  const showJpgWarning = format === 'jpg' && bgMode === 'transparent' && !isLive2D && !isSpine;

  // Calculate range for frame slider
  const targetAnims = resolveAnimations(
    project.animations,
    animTarget,
    animStore.activeAnimationId
  );
  const maxDuration =
    targetAnims.length > 0
      ? Math.max(...targetAnims.map(a => a.duration ?? 2000))
      : 0;
  // Frames are calculated as durationMs / 1000 * fps
  // Mimic computeExportFrameSpecs logic for consistency
  const totalFrames =
    targetAnims.length > 0
      ? Math.max(1, Math.round((maxDuration / 1000) * exportFps))
      : 0;
  const maxFrameIndex = Math.max(0, totalFrames - 1);
  const hasFrames = totalFrames > 0;

  // Clamp frameIndex if range changes
  useEffect(() => {
    if (frameIndex > maxFrameIndex) {
      setFrameIndex(maxFrameIndex);
    }
  }, [maxFrameIndex, frameIndex]);

  return (
    <Dialog open={open} onOpenChange={v => {
      if (!v && !isExporting) onClose();
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Section 1: Type + Format */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={type} onValueChange={v => { setType(v); setExportError(null); }} disabled={isExporting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequence">Sequence</SelectItem>
                  <SelectItem value="single_frame">Single Frame</SelectItem>
                  <SelectItem value="live2d_project">Live2D Project</SelectItem>
                  <SelectItem value="live2d">Live2D Runtime ⚠️</SelectItem>
                  <SelectItem value="spine">Spine (4.0+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isLive2D && !isSpine && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Format</Label>
                <Select value={format} onValueChange={setFormat} disabled={isExporting}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="webp">WEBP</SelectItem>
                    <SelectItem value="jpg">JPG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Live2D-specific options */}
          {isLive2D && (
            <>
              <Separator />
              <div className="space-y-3">
                {type === 'live2d' && (
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/50 dark:border-emerald-800/40">
                    <span className="font-bold block mb-0.5">Production runtime</span>
                    Outputs <code>.moc3</code> + <code>model3.json</code> + <code>physics3.json</code> + <code>cdi3.json</code> + textures + selected procedural motions in one zip — load <code>model3.json</code> in Ren&apos;Py / Cubism SDK directly. No Cubism Editor round-trip required.
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Model Name</Label>
                  <Input
                    className="h-8 text-xs"
                    value={modelName}
                    onChange={e => {
                      setModelName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'));
                      setModelNameTouched(true);
                    }}
                    disabled={isExporting}
                    placeholder="model"
                  />
                </div>
                {type !== 'live2d_project' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Atlas Size</Label>
                    <Select value={String(atlasSize)} onValueChange={v => setAtlasSize(Number(v))} disabled={isExporting}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1024">1024</SelectItem>
                        <SelectItem value="2048">2048</SelectItem>
                        <SelectItem value="4096">4096</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {type === 'live2d_project' && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="generateRig"
                      checked={generateRig}
                      onCheckedChange={setGenerateRig}
                      disabled={isExporting}
                      className="mt-0.5"
                    />
                    <Label htmlFor="generateRig" className="text-xs cursor-pointer leading-relaxed">
                      Generate standard Live2D rig
                      <span className="block text-muted-foreground font-normal">
                        Adds warp deformers, standard parameters (ParamAngleX/Y/Z, ParamBody, etc.), and face-part deformer hierarchy
                      </span>
                    </Label>
                  </div>
                )}
                {/* Physics options: shown for runtime always, and for project-export when rig is on
                    (project export wraps physics inside the cmo3 only when rig is generated). */}
                {(type === 'live2d' || (type === 'live2d_project' && generateRig)) && (
                  <>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="generatePhysics"
                        checked={generatePhysics}
                        onCheckedChange={setGeneratePhysics}
                        disabled={isExporting}
                        className="mt-0.5"
                      />
                      <Label htmlFor="generatePhysics" className="text-xs cursor-pointer leading-relaxed">
                        Generate physics (hair + clothing swing, bust wobble)
                        <span className="block text-muted-foreground font-normal">
                          Adds pendulum simulations. Rules auto-skip when the matching tag isn&apos;t present,
                          so bare-armed / skirtless characters drop unused rules on their own.
                        </span>
                      </Label>
                    </div>
                    {generatePhysics && (
                      <div className="ml-6 space-y-1 border-l-2 border-muted pl-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsHair"
                            checked={physicsHair}
                            onCheckedChange={setPhysicsHair}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsHair" className="text-xs cursor-pointer">
                            Hair (front / back). <span className="text-muted-foreground">Turn off for buzz-cut / short-hair characters.</span>
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsClothing"
                            checked={physicsClothing}
                            onCheckedChange={setPhysicsClothing}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsClothing" className="text-xs cursor-pointer">
                            Clothing (shirt hem + sleeves, skirt, pants).
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsBust"
                            checked={physicsBust}
                            onCheckedChange={setPhysicsBust}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsBust" className="text-xs cursor-pointer">
                            Bust wobble. <span className="text-muted-foreground">Turn off for male / flat-chest characters.</span>
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="physicsArms"
                            checked={physicsArms}
                            onCheckedChange={setPhysicsArms}
                            disabled={isExporting}
                          />
                          <Label htmlFor="physicsArms" className="text-xs cursor-pointer">
                            Arm sway (forearm lags body roll/tilt).
                          </Label>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {(type === 'live2d_project' || type === 'live2d') && (() => {
                  const motionRows = [
                    { id: 'idle',            label: 'Idle',         badge: 'loop', desc: 'Default rest — head wander, breath, blinks' },
                    { id: 'listening',       label: 'Listening',    badge: 'loop', desc: 'Attentive pose with periodic acknowledgement nods' },
                    { id: 'talkingIdle',     label: 'Talking idle', badge: 'loop', desc: 'Speech-rhythm mouth + emphasis tilts and brow raises' },
                    { id: 'embarrassedHold', label: 'Embarrassed',  badge: 'hold', desc: 'Sustained shy pose — head down, eyes away, blush' },
                  ];
                  const enabledCount = motionRows.filter(r => motionConfigs[r.id]?.enabled).length;
                  const setAll = (val) => {
                    setMotionConfigs(prev => {
                      const out = { ...prev };
                      for (const r of motionRows) out[r.id] = { ...prev[r.id], enabled: val };
                      return out;
                    });
                  };
                  return (
                    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                          Procedural animations
                          <span className="text-muted-foreground font-normal ml-1">
                            ({enabledCount} of {motionRows.length} enabled)
                          </span>
                        </Label>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setAll(true)}
                            disabled={isExporting}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setAll(false)}
                            disabled={isExporting}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-muted-foreground"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      {/* Stable layout: every row shows the same controls (checkbox, label,
                          personality, duration). Disabled rows fade — no expand/collapse, no
                          layout shift. Column header keeps the alignment self-documenting. */}
                      <div className="grid grid-cols-[auto_1fr_8rem_8rem] gap-2 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        <span />
                        <span>Motion</span>
                        <span>Personality</span>
                        <span>Loop duration</span>
                      </div>
                      <div className="space-y-1.5">
                        {motionRows.map(row => {
                          const cfg = motionConfigs[row.id];
                          const checkboxId = `motion_${row.id}`;
                          return (
                            <div
                              key={row.id}
                              className={cn(
                                "rounded px-2 py-1.5 transition-colors",
                                cfg.enabled
                                  ? "bg-background/80 ring-1 ring-border/40"
                                  : "opacity-60"
                              )}
                            >
                              <div className="grid grid-cols-[auto_1fr_8rem_8rem] items-start gap-2">
                                <Checkbox
                                  id={checkboxId}
                                  checked={cfg.enabled}
                                  onCheckedChange={v => updateMotionConfig(row.id, { enabled: !!v })}
                                  disabled={isExporting}
                                  className="mt-0.5"
                                />
                                <Label htmlFor={checkboxId} className="text-xs cursor-pointer leading-tight">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="font-medium">{row.label}</span>
                                    <span className={cn(
                                      "text-[9px] px-1 py-px rounded font-normal uppercase tracking-wide",
                                      row.badge === 'loop'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    )}>
                                      {row.badge}
                                    </span>
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground font-normal mt-0.5">
                                    {row.desc}
                                  </span>
                                </Label>
                                <Select
                                  value={cfg.personality}
                                  onValueChange={v => updateMotionConfig(row.id, { personality: v })}
                                  disabled={isExporting || !cfg.enabled}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="calm">Calm</SelectItem>
                                    <SelectItem value="energetic">Energetic</SelectItem>
                                    <SelectItem value="tired">Tired</SelectItem>
                                    <SelectItem value="nervous">Nervous</SelectItem>
                                    <SelectItem value="confident">Confident</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={String(cfg.duration)}
                                  onValueChange={v => updateMotionConfig(row.id, { duration: Number(v) })}
                                  disabled={isExporting || !cfg.enabled}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="4">4 sec</SelectItem>
                                    <SelectItem value="6">6 sec</SelectItem>
                                    <SelectItem value="8">8 sec</SelectItem>
                                    <SelectItem value="12">12 sec</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Always rendered to keep layout stable; visibility hidden when nothing selected. */}
                      <p
                        className={cn(
                          "text-[10px] text-muted-foreground italic leading-relaxed",
                          enabledCount === 0 && "invisible"
                        )}
                      >
                        Each enabled motion becomes its own scene in the .can3 — editable in Cubism Editor before you export runtime files.
                      </p>
                    </div>
                  );
                })()}
                <div className="text-xs text-muted-foreground px-2 py-1.5 rounded bg-muted/50">
                  {type === 'live2d_project' ? (
                    <><span className="font-medium">Live2D Cubism .cmo3</span> — project file editable in Cubism Editor 5.0. Each mesh gets its own texture.</>
                  ) : (
                    <><span className="font-medium">Live2D Cubism V4 runtime</span> — SDK 4.0 / Ren&apos;Py / Web SDK ready. Includes moc3, model3.json, physics3.json, cdi3.json, textures, and selected procedural motions registered in model3 for auto-load.</>
                  )}
                </div>
              </div>
            </>
          )}

          {!isLive2D && <Separator />}

          {/* Sections 2-4: frame export options (hidden for Live2D) */}
          {!isLive2D && (<>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Animation</Label>
                <Select value={animTarget} onValueChange={setAnimTarget} disabled={isExporting}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staging">Staging</SelectItem>
                    {project.animations.length > 0 && <SelectItem value="current">Current</SelectItem>}
                    {project.animations.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                    {project.animations.length > 1 && (
                      <SelectItem value="all">All</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {showFpsInput && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">FPS</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={exportFps}
                    min={1}
                    max={120}
                    onChange={e =>
                      setExportFps(Math.max(1, Number(e.target.value)))
                    }
                    disabled={isExporting}
                  />
                </div>
              )}

              {showFrameInput && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Frame</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[frameIndex]}
                      min={0}
                      max={maxFrameIndex}
                      step={1}
                      onValueChange={([v]) => setFrameIndex(v)}
                      disabled={isExporting || !hasFrames}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      className="h-8 text-xs w-20"
                      value={frameIndex}
                      min={0}
                      max={maxFrameIndex}
                      onChange={e =>
                        setFrameIndex(
                          Math.min(maxFrameIndex, Math.max(0, Number(e.target.value)))
                        )
                      }
                      disabled={isExporting || !hasFrames}
                    />
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {isSpine && (
              <div className="text-[11px] leading-relaxed text-muted-foreground bg-accent/20 p-3 rounded-md border border-accent/20 space-y-1.5">
                <p className="font-semibold text-foreground/90">How to import to Spine:</p>
                <ol className="list-decimal list-inside space-y-1 ml-0.5">
                  <li>Unzip the exported <strong>.zip</strong> file</li>
                  <li>In Spine, go to <strong>Spine menu &gt; Import Data...</strong></li>
                  <li>Select the <strong>.json</strong> file from the unzipped folder</li>
                </ol>
              </div>
            )}

            {/* Section 3: Image area, scale, BG */}
            {!isSpine && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Image Contains
                  </Label>
                  <Select
                    value={imageContains}
                    onValueChange={setImageContains}
                    disabled={isExporting}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="canvas_area">Canvas area</SelectItem>
                      <SelectItem value="min_image_area">Min image area</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Output Scale (%)
                  </Label>
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    value={outputScale}
                    min={1}
                    max={400}
                    onChange={e =>
                      setOutputScale(Math.max(1, Number(e.target.value)))
                    }
                    disabled={isExporting}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Background
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={bgMode}
                      onValueChange={setBgMode}
                      disabled={isExporting}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transparent">Transparent</SelectItem>
                        <SelectItem value="custom">Custom color</SelectItem>
                      </SelectContent>
                    </Select>
                    {bgMode === 'custom' && (
                      <input
                        type="color"
                        value={bgColor}
                        className="h-8 w-10 rounded border border-input cursor-pointer p-0.5 bg-background"
                        onChange={e => setBgColor(e.target.value)}
                        disabled={isExporting}
                      />
                    )}
                  </div>
                </div>

                {showJpgWarning && (
                  <div className="text-xs text-yellow-600 dark:text-yellow-500 px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/20">
                    JPG doesn&apos;t support transparency — pixels will be black.
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Section 4: Export destination */}
            {!isSpine && type !== 'single_frame' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Export to</Label>
                <RadioGroup
                  value={exportDest}
                  onValueChange={setExportDest}
                  disabled={isExporting}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="zip" id="dest-zip" disabled={isExporting} />
                    <Label
                      htmlFor="dest-zip"
                      className="text-xs cursor-pointer"
                    >
                      ZIP file
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem
                      value="folder"
                      id="dest-folder"
                      disabled={!hasFolderSupport || isExporting}
                    />
                    <Label
                      htmlFor="dest-folder"
                      className={cn(
                        'text-xs cursor-pointer',
                        (!hasFolderSupport || isExporting) &&
                        'opacity-40 cursor-not-allowed'
                      )}
                    >
                      Folder
                      {!hasFolderSupport && (
                        <span className="ml-1 text-muted-foreground">
                          (not supported)
                        </span>
                      )}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </>)}

          {/* Error display */}
          {exportError && (
            <div className="text-xs text-red-600 dark:text-red-400 px-2 py-1.5 rounded bg-red-50 dark:bg-red-900/20">
              <span className="font-medium">Export failed:</span> {exportError}
            </div>
          )}

          {/* Progress bar */}
          {progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.label}</span>
                <span>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <Progress
                value={Math.round((progress.current / progress.total) * 100)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
