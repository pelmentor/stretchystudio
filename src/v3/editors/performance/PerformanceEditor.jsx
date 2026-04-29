// @ts-check

/**
 * v3 Phase 4 — Performance / Profiler editor.
 *
 * Live FPS sampler + project stats. The FPS counter runs its own
 * rAF loop; canvas redraw cadence in CanvasViewport is independent
 * (it only ticks when something changes), so what this editor
 * reports is browser repaint rate — useful for spotting layout
 * jank, DOM overlay re-renders, devtools throttling, but not for
 * profiling the rig evaluator itself. The mesh / vertex counts
 * surface the cost the GPU pays each frame; the rigSpec stats
 * surface the auto-rig output footprint.
 *
 * Phase 4 intentionally keeps this read-only — a true profiler
 * (per-pass timings, draw-call counts, evalRig hot paths) needs
 * GL queries that aren't yet plumbed through CanvasViewport.
 *
 * @module v3/editors/performance/PerformanceEditor
 */

import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useRigSpecStore } from '../../../store/rigSpecStore.js';

export function PerformanceEditor() {
  const project = useProjectStore((s) => s.project);
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  const [fps, setFps] = useState(0);
  const [frameMs, setFrameMs] = useState(0);
  const [history, setHistory] = useState(/** @type {number[]} */ ([]));
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const accumRef = useRef(0);
  const framesRef = useRef(0);

  useEffect(() => {
    function tick(t) {
      if (!lastRef.current) lastRef.current = t;
      const dt = t - lastRef.current;
      lastRef.current = t;
      accumRef.current += dt;
      framesRef.current++;
      if (accumRef.current >= 500) {
        const avgMs = accumRef.current / framesRef.current;
        const computedFps = framesRef.current / (accumRef.current / 1000);
        setFps(Math.round(computedFps));
        setFrameMs(Math.round(avgMs * 10) / 10);
        setHistory((h) => {
          const next = [...h, computedFps];
          if (next.length > 60) next.shift();
          return next;
        });
        accumRef.current = 0;
        framesRef.current = 0;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const stats = collectStats(project, rigSpec);

  return (
    <div className="flex flex-col h-full bg-card overflow-auto">
      <div className="px-3 py-2 border-b shrink-0 flex items-center gap-1.5 bg-muted/30">
        <Activity size={11} className="text-muted-foreground" />
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Performance
        </h2>
      </div>

      <div className="p-3 flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <div>
            <div className="text-3xl font-mono tabular-nums text-foreground">{fps}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">FPS</div>
          </div>
          <div>
            <div className="text-2xl font-mono tabular-nums text-muted-foreground">
              {frameMs.toFixed(1)}
              <span className="text-xs ml-0.5">ms</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              avg frame
            </div>
          </div>
        </div>

        <Sparkline values={history} />

        <Section label="Project">
          <Row label="Nodes" value={project.nodes?.length ?? 0} />
          <Row label="Parts" value={(project.nodes ?? []).filter((n) => n.type === 'part').length} />
          <Row label="Groups" value={(project.nodes ?? []).filter((n) => n.type === 'group').length} />
          <Row label="Textures" value={project.textures?.length ?? 0} />
          <Row label="Animations" value={project.animations?.length ?? 0} />
          <Row label="Parameters" value={project.parameters?.length ?? 0} />
          <Row label="Mask configs" value={project.maskConfigs?.length ?? 0} />
          <Row label="Physics rules" value={project.physicsRules?.length ?? 0} />
        </Section>

        <Section label="Mesh">
          <Row label="Total verts" value={stats.vertCount} />
          <Row label="Total tris" value={stats.triCount} />
          <Row label="Heaviest part" value={stats.heaviest ?? '—'} />
          <Row label="Heaviest verts" value={stats.heaviestVerts ?? 0} />
        </Section>

        <Section label="Rig">
          <Row label="Warp deformers" value={stats.warpCount} />
          <Row label="Rotation deformers" value={stats.rotationCount} />
          <Row label="Art meshes" value={stats.artMeshCount} />
          <Row label="Built rev" value={useRigSpecStore.getState().lastBuiltGeometryVersion} />
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border border-border rounded p-2 bg-muted/10">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Sparkline({ values }) {
  if (!values.length) {
    return (
      <div className="h-12 rounded bg-muted/10 border border-border/40 flex items-center justify-center text-[10px] text-muted-foreground italic">
        Sampling…
      </div>
    );
  }
  const max = Math.max(60, ...values);
  const width = 200;
  const height = 48;
  const step = width / Math.max(1, values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="bg-muted/10 rounded border border-border/40">
      <line x1={0} y1={height - (60 / max) * (height - 4) - 2} x2={width} y2={height - (60 / max) * (height - 4) - 2}
        stroke="rgb(148 163 184 / 0.25)" strokeDasharray="2 2" strokeWidth="1" />
      <path d={path} fill="none" stroke="rgb(56 189 248)" strokeWidth="1.5" />
    </svg>
  );
}

function collectStats(project, rigSpec) {
  let vertCount = 0;
  let triCount = 0;
  let heaviest = null;
  let heaviestVerts = 0;
  for (const node of project.nodes ?? []) {
    if (node.type !== 'part') continue;
    const verts = node.mesh?.vertices?.length ?? 0;
    const tris = node.mesh?.triangles ? node.mesh.triangles.length / 3 : 0;
    vertCount += verts;
    triCount += tris;
    if (verts > heaviestVerts) {
      heaviestVerts = verts;
      heaviest = node.name ?? node.id;
    }
  }
  return {
    vertCount,
    triCount,
    heaviest,
    heaviestVerts,
    warpCount: rigSpec?.warpDeformers?.length ?? 0,
    rotationCount: rigSpec?.rotationDeformers?.length ?? 0,
    artMeshCount: rigSpec?.artMeshes?.length ?? 0,
  };
}
