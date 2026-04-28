import React from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useParamValuesStore } from '@/store/paramValuesStore';
import { useRigSpecStore } from '@/store/rigSpecStore';
import { initializeRigFromProject } from '@/io/live2d/rig/initRig';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Wand2, Trash2, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

/**
 * Parameters panel — rig actions plus live param scrubber.
 *
 * Top section: "Initialize Rig" (runs harvester + seedAllRig + caches the
 * rigSpec for the v2 evaluator) and "Clear Rig Keyforms" (drops faceParallax
 * / bodyWarp / rigWarps so the export pipeline falls back to inline
 * heuristics). Confirmation dialogs gate both when seeded data already
 * exists since both are destructive.
 *
 * Expanded section (R8): one slider per `project.parameters` entry. Sliders
 * read/write `paramValuesStore`; the CanvasViewport tick consumes the same
 * store via `evalRig`, so dragging deforms the mesh in real time. A "reset
 * to defaults" action restores every dial to its parameter spec default.
 */
export function ParametersPanel() {
  const project = useProjectStore(s => s.project);
  const seedAllRig = useProjectStore(s => s.seedAllRig);
  const clearRigKeyforms = useProjectStore(s => s.clearRigKeyforms);

  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirmInit, setConfirmInit] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const params = project.parameters ?? [];
  const meshCount = (project.nodes ?? []).filter(n => n.type === 'part' && n.mesh).length;
  const hasFaceParallax = !!project.faceParallax;
  const hasBodyWarp = !!project.bodyWarp;
  const rigWarpCount = Object.keys(project.rigWarps ?? {}).length;
  const hasAnyRigSeed = hasFaceParallax || hasBodyWarp || rigWarpCount > 0;

  const runInit = async () => {
    setBusy(true);
    try {
      const harvest = await initializeRigFromProject(project);
      seedAllRig(harvest);
      // v2 R1 — also cache the full rigSpec for the live evaluator. Same
      // harvest result; we bypass `useRigSpecStore.buildRigSpec` because
      // it would re-run the full rig generator a second time.
      useRigSpecStore.setState({
        rigSpec: harvest.rigSpec ?? null,
        isBuilding: false,
        lastBuiltGeometryVersion:
          useProjectStore.getState().versionControl?.geometryVersion ?? 0,
        error: null,
      });
      // R8 — seed live param values from the freshly baked param spec so
      // the scrubber sliders start at their canonical defaults rather than
      // whatever stale values were left over from a prior project. Initialize
      // is intentionally destructive, so clobbering existing dial positions
      // is the right call here.
      const paramsAfterSeed =
        harvest.rigSpec?.parameters ?? useProjectStore.getState().project.parameters ?? [];
      useParamValuesStore.getState().resetToDefaults(paramsAfterSeed);
      const summary = [];
      if (harvest.faceParallaxSpec) summary.push('face parallax');
      if (harvest.bodyWarpChain) summary.push('body warp chain');
      if (harvest.rigWarps.size > 0) summary.push(`${harvest.rigWarps.size} per-mesh rig warps`);
      toast.success(
        summary.length > 0
          ? `Rig initialized — baked ${summary.join(', ')}.`
          : 'Rig initialized — no keyform-bearing deformers were generated for this model.',
      );
    } catch (err) {
      console.error('[ParametersPanel] initializeRigFromProject failed:', err);
      toast.error(`Rig init failed: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleInitClick = () => {
    if (hasAnyRigSeed) setConfirmInit(true);
    else runInit();
  };

  const handleClearClick = () => {
    if (hasAnyRigSeed) setConfirmClear(true);
  };

  if (meshCount === 0) return null;

  return (
    <div className="flex flex-col border-l border-b bg-card">
      <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
        <button
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Parameters
          <span className="text-[10px] font-mono text-muted-foreground/70">
            ({params.length})
          </span>
        </button>
      </div>

      <div className="p-2.5 flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8 text-xs gap-1.5"
            onClick={handleInitClick}
            disabled={busy}
            title="Run the rig generators against current geometry and bake all configs + keyforms into the project."
          >
            <Wand2 size={13} />
            {busy ? 'Initializing…' : 'Initialize Rig'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={handleClearClick}
            disabled={busy || !hasAnyRigSeed}
            title="Drop stored faceParallax / bodyWarp / rigWarps. Configs (params, masks, physics) are kept."
          >
            <Trash2 size={13} />
            Clear
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono text-muted-foreground">
          <span className={hasFaceParallax ? 'text-foreground' : ''}>
            face: {hasFaceParallax ? 'baked' : 'inline'}
          </span>
          <span className={hasBodyWarp ? 'text-foreground' : ''}>
            body: {hasBodyWarp ? 'baked' : 'inline'}
          </span>
          <span className={rigWarpCount > 0 ? 'text-foreground' : ''}>
            warps: {rigWarpCount > 0 ? rigWarpCount : 'inline'}
          </span>
        </div>

        {expanded && (
          <div className="border-t border-border/40 pt-2 mt-1 flex flex-col gap-2">
            {params.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                No parameters yet. Click &ldquo;Initialize Rig&rdquo; to generate the standard set.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-1">
                  <span>{params.length} params · live preview</span>
                  <button
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                    onClick={() => useParamValuesStore.getState().resetToDefaults(params)}
                    title="Reset every slider back to its parameter's default value."
                  >
                    <RotateCcw size={10} />
                    reset to defaults
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
                  {params.map(p => (
                    <ParamSliderRow key={p.id} param={p} />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmInit} onOpenChange={setConfirmInit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-initialize rig?</AlertDialogTitle>
            <AlertDialogDescription>
              This will re-run the rig generators against the current mesh
              geometry and overwrite the stored face parallax, body warp
              chain, and per-mesh rig warps. Other configs (parameters,
              masks, physics rules) are also reseeded. Use after a PSD
              reimport or after editing tags.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmInit(false); runInit(); }}>
              Re-initialize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear rig keyforms?</AlertDialogTitle>
            <AlertDialogDescription>
              This drops the stored face parallax, body warp chain, and
              per-mesh rig warps. The export pipeline will fall back to
              the inline heuristics so subsequent exports still produce a
              valid model — useful when stored deltas have gone stale
              (e.g., after a PSD reimport with a re-meshed silhouette).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClear(false);
                clearRigKeyforms();
                // v2 R1 — drop the cache so a future evaluator rebuild
                // picks up the cleared (heuristic-only) state.
                useRigSpecStore.getState().invalidate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear keyforms
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * R8 — single-row slider for one rig parameter. Reads the live dial position
 * from `paramValuesStore`, falls back to `param.default` when unset (handles
 * "open project, then expand panel before any drag has happened"), and writes
 * back through `setParamValue` on every change. The CanvasViewport tick reads
 * the same store via its `paramValuesRef`, so dragging here drives evalRig
 * → mesh deform within the same frame.
 *
 * Step is adaptive: integer-step for wide ranges (typical Cubism axes like
 * ParamAngleX [-30, 30]), 0.01 for sub-5 ranges (open/close params [0, 1]).
 * The displayed value precision tracks the step so 0.50 doesn't render as 1
 * on a 0..1 slider.
 */
function ParamSliderRow({ param }) {
  const value = useParamValuesStore(s => s.values[param.id] ?? param.default ?? 0);
  const setParamValue = useParamValuesStore(s => s.setParamValue);
  const range = (param.max ?? 0) - (param.min ?? 0);
  const step = range >= 5 ? 1 : 0.01;
  const fmt = step >= 1 ? Number(value).toFixed(0) : Number(value).toFixed(2);

  return (
    <li className="flex flex-col gap-1 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="truncate font-medium" title={param.id}>
          {param.name || param.id}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {fmt}
          <span className="text-muted-foreground/50 ml-1">[{param.min}, {param.max}]</span>
        </span>
      </div>
      <Slider
        min={param.min}
        max={param.max}
        step={step}
        value={[value]}
        onValueChange={([v]) => setParamValue(param.id, v)}
      />
    </li>
  );
}
