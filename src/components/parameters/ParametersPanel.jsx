import React from 'react';
import { useProjectStore } from '@/store/projectStore';
import { initializeRigFromProject } from '@/io/live2d/rig/initRig';
import { Button } from '@/components/ui/button';
import { Wand2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
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
 * Stage 1b — Parameters panel. Read-only summary of `project.parameters`
 * plus the two rig-init actions: "Initialize Rig" (runs harvester +
 * seedAllRig) and "Clear Rig Keyforms" (drops faceParallax / bodyWarp /
 * rigWarps so the export pipeline falls back to inline heuristics).
 *
 * Confirmation dialogs gate both actions when seeded data already exists,
 * since both are destructive (init re-bakes against current geometry,
 * clear discards stored keyforms).
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
          <div className="border-t border-border/40 pt-2 mt-1">
            {params.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                No parameters yet. Click &ldquo;Initialize Rig&rdquo; to generate the standard set.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                {params.map(p => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-muted/40 transition-colors"
                  >
                    <span className="truncate font-medium" title={p.id}>
                      {p.name || p.id}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      [{p.min}, {p.max}] · {p.default}
                    </span>
                  </li>
                ))}
              </ul>
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
              onClick={() => { setConfirmClear(false); clearRigKeyforms(); }}
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
