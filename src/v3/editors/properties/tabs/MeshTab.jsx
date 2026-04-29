// @ts-check

/**
 * v3 Phase 1B — MeshTab.
 *
 * Surfaces mesh data for the selected part: vertex / triangle counts,
 * UV bbox, source-PSD layer name, and a Remesh action that defers to
 * the v2 mesh post-processor (the same algorithm the Modeling tab
 * runs). Edit-mode mesh editor is Phase 2A; this tab provides the
 * one-shot regenerate path so newly imported PSD layers get
 * triangulated without reaching for the Modeling workspace.
 *
 * @module v3/editors/properties/tabs/MeshTab
 */

import { useState } from 'react';
import { Loader2, Triangle } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useCaptureStore } from '../../../../store/captureStore.js';
import { Button as ButtonImpl } from '../../../../components/ui/button.jsx';
import { NumberField } from '../fields/NumberField.jsx';

// shadcn/ui's Button is a forwardRef without exported JSDoc, so tsc
// can't see its props. Cast to permissive — runtime stays the same
// component.
/** @type {React.ComponentType<any>} */
const Button = /** @type {any} */ (ButtonImpl);

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function MeshTab({ nodeId }) {
  const node = useProjectStore((s) => s.project.nodes.find((n) => n.id === nodeId) ?? null);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [busy, setBusy] = useState(false);

  if (!node || node.type !== 'part') {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No mesh — Mesh tab is only available for parts.
      </div>
    );
  }

  const mesh = node.mesh ?? null;
  const vertexCount = mesh?.vertices?.length ?? 0;
  const triangleCount = mesh?.triangles ? mesh.triangles.length / 3 : 0;
  // gridSpacing is the per-part remesh knob: larger = coarser grid.
  // computeSmartMeshOpts produces values in the 6..80 range for a
  // typical PSD layer; we pick 30 as a sensible default for the
  // empty-state UI.
  const gridSpacing = typeof node.meshGridSpacing === 'number' ? node.meshGridSpacing : 30;

  // UV bbox sanity-check (helps catch mesh/atlas misalignment quickly).
  let uvBox = null;
  if (mesh?.uvs && mesh.uvs.length > 0) {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < mesh.uvs.length; i++) {
      const uv = mesh.uvs[i];
      const u = uv?.u ?? uv?.[0] ?? 0;
      const v = uv?.v ?? uv?.[1] ?? 0;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    if (Number.isFinite(minU)) uvBox = { minU, minV, maxU, maxV };
  }

  function handleRemesh() {
    if (busy) return;
    const remesh = useCaptureStore.getState().remeshPart;
    if (!remesh) {
      console.warn('[MeshTab] remesh unavailable — viewport not mounted');
      return;
    }
    setBusy(true);
    try {
      // Mesh worker is fire-and-forget; it writes the new mesh back
      // through `updateProject` when finished. Reset the spinner on
      // a short timer so the button re-enables even if the worker
      // never reports back. The opts shape mirrors computeSmartMeshOpts
      // — only gridSpacing is exposed in v3 for now.
      remesh(nodeId, {
        alphaThreshold: 5,
        smoothPasses: 0,
        gridSpacing,
        edgePadding: 8,
        numEdgePoints: 80,
      });
      setTimeout(() => setBusy(false), 600);
    } catch (err) {
      console.error('[MeshTab] remesh failed:', err);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label="Geometry" icon={<Triangle size={11} />}>
        <Row label="Vertices">
          <span className="text-xs text-foreground tabular-nums">{vertexCount}</span>
        </Row>
        <Row label="Triangles">
          <span className="text-xs text-foreground tabular-nums">{triangleCount}</span>
        </Row>
        {uvBox ? (
          <Row label="UV bbox">
            <span className="text-[11px] text-foreground tabular-nums font-mono">
              ({uvBox.minU.toFixed(3)}, {uvBox.minV.toFixed(3)}) → ({uvBox.maxU.toFixed(3)}, {uvBox.maxV.toFixed(3)})
            </span>
          </Row>
        ) : null}
      </Section>

      <Section label="Remesh">
        <NumberField
          label="Grid"
          value={gridSpacing}
          step={1}
          min={6}
          max={80}
          precision={0}
          onCommit={(v) => updateProject((p) => {
            const n = p.nodes.find((nn) => nn.id === nodeId);
            if (n) n.meshGridSpacing = v;
          })}
        />
        <p className="text-[10px] text-muted-foreground leading-snug px-0.5">
          Pixel spacing between interior grid points. Larger = coarser.
          Smart default lives in the 12–60 range.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs mt-1"
          onClick={handleRemesh}
          disabled={busy}
        >
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Regenerate Mesh
        </Button>
      </Section>
    </div>
  );
}

function Section({ label, icon = null, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}
