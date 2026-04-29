/**
 * v3 Phase 5 — `.cmo3` inspector modal.
 *
 * First cut of the round-trip work. Pairs the CAFF unpacker
 * (`io/live2d/caffUnpacker.js`) with the metadata reader
 * (`io/live2d/cmo3Inspect.js`) and surfaces the snapshot in a single
 * dialog: drop a `.cmo3`, see canvas dimensions, parameter list, part
 * counts, embedded textures, and any structural warnings the parser
 * emitted.
 *
 * What it does NOT do (yet) — those are follow-on sweeps:
 *   - Build an SS project from the parsed XML (full ingest)
 *   - Resolve deformer chains / keyform grids
 *   - Render thumbnails of the embedded PNGs
 *
 * @module v3/shell/Cmo3InspectModal
 */

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.jsx';
import { Button } from '../../components/ui/button.jsx';
import { ScrollArea } from '../../components/ui/scroll-area.jsx';
import { FileSearch, AlertTriangle, RotateCcw, Download } from 'lucide-react';
import { inspectCmo3 } from '../../io/live2d/cmo3Inspect.js';
import { importCmo3 } from '../../io/live2d/cmo3Import.js';
import { useCmo3InspectStore } from '../../store/cmo3InspectStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useRigSpecStore } from '../../store/rigSpecStore.js';

export function Cmo3InspectModal() {
  const open = useCmo3InspectStore((s) => s.open);
  const close = useCmo3InspectStore((s) => s.close);
  const result = useCmo3InspectStore((s) => s.result);
  const fileName = useCmo3InspectStore((s) => s.fileName);
  const error = useCmo3InspectStore((s) => s.error);
  const pending = useCmo3InspectStore((s) => s.pending);
  const reset = useCmo3InspectStore((s) => s.reset);

  const fileInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  // Stash the raw bytes from the most recent pick so the "Import as new
  // project" button can re-run the parse without forcing the user to
  // re-pick the file. Cleared on `reset`.
  const lastBytesRef = useRef(/** @type {Uint8Array|null} */ (null));
  const [importing, setImporting] = useState(false);

  async function handleFile(file) {
    const store = useCmo3InspectStore.getState();
    store.setPending(file.name);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      lastBytesRef.current = buf;
      const meta = await inspectCmo3(buf);
      store.setResult(file.name, meta);
    } catch (err) {
      lastBytesRef.current = null;
      store.setError(file.name, (err && err.message) || String(err));
    }
  }

  async function handleImportAsProject() {
    const bytes = lastBytesRef.current;
    if (!bytes) return;
    setImporting(true);
    try {
      const { project, warnings, stats } = await importCmo3(bytes);
      useProjectStore.getState().loadProject(project);

      // Auto-build the rigSpec so the v3 viewport picks up parameter
      // bindings immediately — without this the user would see a static
      // reference scene and have to click Initialize Rig themselves to
      // get param-driven deformations. Imported projects already carry
      // rigWarps + boneRoles + maskConfigs + variants, so the writer's
      // rigOnly path produces the rigSpec without prompting.
      const rigSpec = await useRigSpecStore.getState().buildRigSpec();
      const rigSummary = rigSpec
        ? ` · rig: ${rigSpec.warpDeformers?.length ?? 0} warps, ${rigSpec.rotationDeformers?.length ?? 0} rotations, ${rigSpec.artMeshes?.length ?? 0} art meshes`
        : ' · rigSpec build failed (see console)';

      const summary = `Imported ${stats.parts} parts, ${stats.groups} groups, ${stats.textures} textures, ${stats.parameters} parameters${rigSummary}` +
        (warnings.length > 0 ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : '');
      // Use the inspector-store's message channel to surface it. Closes
      // the modal after a brief moment so the user sees the loaded scene.
      window.alert(summary);
      close();
    } catch (err) {
      useCmo3InspectStore.getState().setError(fileName ?? '(unknown)', `import failed: ${(err instanceof Error) ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
    e.target.value = '';
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-primary" />
            Inspect .cmo3
          </DialogTitle>
          <DialogDescription>
            Reads a Cubism Editor project file. Inspect-only first; the
            Import button below loads the geometry / textures / parameters
            as a new SS project. Deformer rig + keyforms + variants stay
            in Cubism — those land in follow-on sweeps.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Pick .cmo3 file…
          </Button>
          {result && !error ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={importing}
              onClick={handleImportAsProject}
            >
              <Download size={12} className="mr-1" />
              {importing ? 'Importing…' : 'Import as new project'}
            </Button>
          ) : null}
          {result || error ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { lastBytesRef.current = null; reset(); }}
            >
              <RotateCcw size={12} className="mr-1" /> Clear
            </Button>
          ) : null}
          {fileName ? (
            <span className="text-xs text-muted-foreground truncate">{fileName}</span>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".cmo3,.can3"
            className="hidden"
            onChange={onPick}
          />
        </div>

        {pending ? (
          <p className="text-xs text-muted-foreground mt-2">Parsing…</p>
        ) : null}

        {error ? (
          <div className="mt-3 p-3 rounded border border-destructive/50 bg-destructive/10">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle size={12} />
              <span className="font-semibold">Parse failed</span>
            </div>
            <p className="text-xs mt-1 font-mono break-all">{error}</p>
          </div>
        ) : null}

        {result ? (
          <ScrollArea className="flex-1 mt-3 pr-2 -mr-2 min-h-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <Field label="Model name" value={result.modelName ?? '(unset)'} />
              <Field label="Canvas" value={`${result.canvasW} × ${result.canvasH}`} />
              <Field label="CModelSource ver" value={String(result.cmodelSourceVersion ?? '?')} />
              <Field label="Parameters" value={String(result.parameterCount)} />
              <Field label="Parts (CArtMesh)" value={String(result.partCount)} />
              <Field label="Groups (CPart)" value={String(result.groupCount)} />
              <Field label="Textures" value={String(result.textureCount)} />
              <Field label="PNGs in archive" value={String(result.pngFiles.length)} />
              {result.scene ? (
                <>
                  <Field
                    label="Warp deformers"
                    value={String(result.scene.deformers.filter((d) => d.kind === 'warp').length)}
                  />
                  <Field
                    label="Rotation deformers"
                    value={String(result.scene.deformers.filter((d) => d.kind === 'rotation').length)}
                  />
                  <Field
                    label="Keyform bindings"
                    value={String(result.scene.keyformBindings.length)}
                  />
                  <Field
                    label="Keyform grids"
                    value={String(result.scene.keyformGrids.length)}
                  />
                </>
              ) : null}
            </div>

            {result.warnings.length > 0 ? (
              <div className="mt-3 p-2 rounded border border-yellow-500/40 bg-yellow-500/5">
                <p className="text-[10px] uppercase tracking-wide text-yellow-700 dark:text-yellow-400 font-semibold mb-1">
                  Warnings
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-400 list-disc pl-4 space-y-0.5">
                  {result.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                Parameter list ({result.parameters.length})
              </p>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="font-normal py-1 pr-2">id</th>
                    <th className="font-normal pr-2">name</th>
                    <th className="font-normal pr-2 text-right">min</th>
                    <th className="font-normal pr-2 text-right">max</th>
                    <th className="font-normal pr-2 text-right">default</th>
                    <th className="font-normal pr-2">type</th>
                  </tr>
                </thead>
                <tbody>
                  {result.parameters.map((p) => (
                    <tr key={p.id} className="border-b border-border/30">
                      <td className="py-0.5 pr-2 truncate max-w-[12em]">{p.id}</td>
                      <td className="pr-2 truncate max-w-[10em]">{p.name}</td>
                      <td className="pr-2 text-right">{p.min}</td>
                      <td className="pr-2 text-right">{p.max}</td>
                      <td className="pr-2 text-right">{p.default}</td>
                      <td className="pr-2 text-muted-foreground">{p.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.scene ? (
              <>
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                    Parts ({result.scene.parts.length})
                  </p>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="font-normal py-1 pr-2">drawableId</th>
                        <th className="font-normal pr-2">name</th>
                        <th className="font-normal pr-2 text-right">verts</th>
                        <th className="font-normal pr-2 text-right">tris</th>
                        <th className="font-normal pr-2">texture</th>
                        <th className="font-normal pr-2">parent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scene.parts.map((p) => (
                        <tr key={p.xsId} className="border-b border-border/30">
                          <td className="py-0.5 pr-2">{p.drawableIdStr}</td>
                          <td className="pr-2 truncate max-w-[12em]">{p.name}</td>
                          <td className="pr-2 text-right">{p.positions.length / 2}</td>
                          <td className="pr-2 text-right">{p.indices.length / 3}</td>
                          <td className="pr-2 text-muted-foreground">{textureLabelFor(p.textureRef, result.scene)}</td>
                          <td className="pr-2 text-muted-foreground">{groupLabelFor(p.parentGuidRef, result.scene)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                      Groups ({result.scene.groups.length})
                    </p>
                    <ul className="text-xs font-mono text-muted-foreground space-y-0.5">
                      {result.scene.groups.map((g) => (
                        <li key={g.xsId}>{g.name || '(unnamed)'}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                      Embedded textures ({result.scene.textures.length})
                    </p>
                    <ul className="text-xs font-mono text-muted-foreground space-y-0.5">
                      {result.scene.textures.map((t) => (
                        <li key={t.xsId}>
                          {t.filePath ?? '(unresolved)'} {t.width > 0 ? `(${t.width}×${t.height})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              result.pngFiles.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                    Embedded PNGs ({result.pngFiles.length})
                  </p>
                  <ul className="text-xs font-mono text-muted-foreground space-y-0.5">
                    {result.pngFiles.map((p) => (<li key={p}>{p}</li>))}
                  </ul>
                </div>
              ) : null
            )}
          </ScrollArea>
        ) : null}

        {!result && !error && !pending ? (
          <p className="text-xs text-muted-foreground mt-3">
            Pick a `.cmo3` (or `.can3`) file to inspect.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function textureLabelFor(ref, scene) {
  if (!ref || !scene) return '-';
  const tex = scene.textures.find((t) => t.xsId === ref);
  if (!tex) return ref;
  if (tex.imageFileIndex !== null) return `tex${tex.imageFileIndex} (${tex.name})`;
  return tex.name || ref;
}

function groupLabelFor(ref, scene) {
  if (!ref || !scene) return '-';
  // Parts reference groups by the group's own CPartGuid xs.ref, not by
  // the CPartSource's xs.id, so join through guidRef.
  const grp = scene.groups.find((g) => g.guidRef === ref || g.xsId === ref);
  return grp ? (grp.name || ref) : ref;
}

function Field({ label, value }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
