// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 3D — Animation F-curve editor.
 *
 * Plots one track's value over TIME (motion3 model, not keyform
 * interpolation) as a continuous curve. Picks the track based on
 * the active selection — currently:
 *
 *   - selection.parameter → animation track with `paramId === id`
 *   - selection.part / group → first track with `nodeId === id`
 *     (the "first" picks `x` arbitrarily; user can scroll for more
 *     in a future polish pass)
 *
 * Shows the easing curve interpolated between every keyframe via
 * the live `interpolateTrack()` helper, so easing changes in
 * Timeline reflect here on the next render. Click a keyframe
 * diamond to seek; click anywhere on the curve area to seek too.
 *
 * Read-only first cut. Drag-handle bezier editing is the polish
 * phase that earns `v3-phase-3-complete`.
 *
 * @module v3/editors/fcurve/FCurveEditor
 */

import { useMemo } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import { Activity } from 'lucide-react';

const SAMPLES = 240;
const PAD_X = 28;
const PAD_TOP = 12;
const PAD_BOTTOM = 18;

export function FCurveEditor() {
  const project = useProjectStore((s) => s.project);
  const activeAnimId = useAnimationStore((s) => s.activeAnimationId);
  const currentTime  = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
  const selection = useSelectionStore((s) => s.items);

  const anim = useMemo(
    () => (project.animations ?? []).find((a) => a.id === activeAnimId) ?? null,
    [project.animations, activeAnimId],
  );

  const track = useMemo(() => pickTrack(anim, selection), [anim, selection]);
  const duration = Math.max(1, anim?.duration ?? 1000);
  const sampled = useMemo(
    () => (track?.keyframes?.length ? sampleCurve(track, duration) : null),
    [track, duration],
  );

  if (!anim) {
    return (
      <Wrapper title="F-curve" subtitle="No animation active">
        <Empty msg="Create or select an animation in the Animations panel." />
      </Wrapper>
    );
  }

  if (!track || !track.keyframes || track.keyframes.length === 0 || !sampled) {
    const sub = track
      ? 'Track is empty — drop a keyframe in the Timeline first.'
      : 'Select a parameter or part with keyframes to plot.';
    return (
      <Wrapper title="F-curve" subtitle={describeSelection(selection, project)}>
        <Empty msg={sub} />
      </Wrapper>
    );
  }

  return (
    <Wrapper
      title="F-curve"
      subtitle={`${track.label} · ${track.keyframes.length} keyframes · ${(duration / 1000).toFixed(1)}s`}
    >
      <Plot
        sampled={sampled}
        keyframes={track.keyframes}
        duration={duration}
        currentTime={currentTime}
        onSeek={setCurrentTime}
      />
    </Wrapper>
  );
}

function Wrapper({ title, subtitle, children }) {
  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0 flex items-center gap-1.5 bg-muted/30">
        <Activity size={11} className="text-muted-foreground" />
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="text-[10px] text-muted-foreground/70 ml-2 truncate">{subtitle}</span>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center text-xs text-muted-foreground italic">
      {msg}
    </div>
  );
}

function Plot({ sampled, keyframes, duration, currentTime, onSeek }) {
  const { values, minV, maxV } = sampled;

  // Map (time, value) → svg coords. SVG is laid out via 100% width /
  // viewBox — we keep math in the unit grid then let CSS scale.
  function tx(time) { return PAD_X + (time / duration) * (1000 - PAD_X * 2); }
  function ty(v) {
    const range = (maxV - minV) || 1;
    const norm = (v - minV) / range;
    return PAD_TOP + (1 - norm) * (300 - PAD_TOP - PAD_BOTTOM);
  }

  const polyPoints = useMemo(() => {
    return values
      .map(({ t, v }) => `${tx(t).toFixed(1)},${ty(v).toFixed(2)}`)
      .join(' ');
    // tx/ty depend on duration, minV, maxV — captured per-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, duration, minV, maxV]);

  function handleSvgClick(e) {
    const svg = /** @type {SVGSVGElement} */ (e.currentTarget);
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const tNorm = (x - PAD_X) / (1000 - PAD_X * 2);
    const ms = Math.max(0, Math.min(duration, tNorm * duration));
    onSeek(ms);
  }

  return (
    <div className="w-full h-full p-2">
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        className="w-full h-full cursor-crosshair"
        onClick={handleSvgClick}
      >
        {/* axes */}
        <line x1={PAD_X} y1={PAD_TOP} x2={PAD_X} y2={300 - PAD_BOTTOM}
          stroke="currentColor" className="text-border" strokeWidth={1} />
        <line x1={PAD_X} y1={300 - PAD_BOTTOM} x2={1000 - PAD_X} y2={300 - PAD_BOTTOM}
          stroke="currentColor" className="text-border" strokeWidth={1} />

        {/* min/max value labels */}
        <text x={PAD_X - 4} y={PAD_TOP + 8} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{maxV.toFixed(2)}</text>
        <text x={PAD_X - 4} y={300 - PAD_BOTTOM} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{minV.toFixed(2)}</text>

        {/* time labels (4 ticks) */}
        {[0, 0.33, 0.67, 1].map((p) => (
          <text key={p}
            x={tx(p * duration)} y={300 - 4} textAnchor="middle" fontSize={10}
            className="fill-muted-foreground font-mono">
            {((p * duration) / 1000).toFixed(1)}s
          </text>
        ))}

        {/* zero line if straddling */}
        {minV < 0 && maxV > 0 ? (
          <line x1={PAD_X} y1={ty(0)} x2={1000 - PAD_X} y2={ty(0)}
            stroke="currentColor" className="text-border/60" strokeDasharray="2 2" strokeWidth={1} />
        ) : null}

        {/* curve */}
        <polyline
          points={polyPoints}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth={1.5}
        />

        {/* keyframe diamonds */}
        {keyframes.map((kf, i) => {
          if (typeof kf.value !== 'number') return null;
          const x = tx(kf.time);
          const y = ty(kf.value);
          return (
            <g
              key={i}
              transform={`translate(${x}, ${y})`}
              onClick={(e) => { e.stopPropagation(); onSeek(kf.time); }}
              className="cursor-pointer"
            >
              <rect x={-3} y={-3} width={6} height={6}
                transform="rotate(45)"
                fill="currentColor"
                className="text-amber-500"
                stroke="white"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* playhead */}
        <line
          x1={tx(currentTime)} y1={PAD_TOP}
          x2={tx(currentTime)} y2={300 - PAD_BOTTOM}
          stroke="currentColor"
          className="text-primary/70"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function pickTrack(anim, selection) {
  if (!anim?.tracks) return null;

  // Walk most-recent selection first so a fresh click overrides
  // whatever was selected before.
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i];
    if (sel.type === 'parameter') {
      const t = anim.tracks.find((tr) => tr.paramId === sel.id);
      if (t) return { ...t, label: `param:${sel.id}` };
    }
    if (sel.type === 'part' || sel.type === 'group') {
      const t = anim.tracks.find((tr) => tr.nodeId === sel.id);
      if (t) return { ...t, label: `${sel.type}:${sel.id} · ${t.property}` };
    }
  }
  return null;
}

function describeSelection(selection, project) {
  if (!selection.length) return 'No selection — pick a parameter or part';
  const last = selection[selection.length - 1];
  if (last.type === 'parameter') {
    const p = (project.parameters ?? []).find((pp) => pp.id === last.id);
    return `Param: ${p?.name ?? last.id}`;
  }
  if (last.type === 'part' || last.type === 'group') {
    const n = (project.nodes ?? []).find((nn) => nn.id === last.id);
    return `${last.type}: ${n?.name ?? last.id}`;
  }
  return last.type;
}

function sampleCurve(track, duration) {
  const values = [];
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * duration;
    const v = interpolateTrack(track.keyframes, t);
    if (typeof v !== 'number') continue;
    values.push({ t, v });
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  // Pad zero-range so the curve isn't a flat line glued to an axis.
  if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
  if (minV === maxV) { minV -= 0.5; maxV += 0.5; }
  // Add a small headroom so the curve doesn't kiss the box edges.
  const span = maxV - minV;
  minV -= span * 0.05;
  maxV += span * 0.05;
  return { values, minV, maxV };
}
