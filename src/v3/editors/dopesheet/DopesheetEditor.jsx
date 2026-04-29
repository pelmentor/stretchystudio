// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 3B — Dopesheet editor.
 *
 * Sibling to TimelineEditor, focused on keyframe DENSITY rather than
 * playback scrubbing. One row per track, ticks at the times their
 * keyframes live. Click a tick to jump the playhead. Read-only on
 * the keyframe values themselves — editing still happens through
 * the timeline / animation mode + auto-keyframe.
 *
 * The point of this view is "what does this animation actually do at
 * a glance" — does this motion fire on every frame, or just at start
 * and end? Are the params evenly distributed? You can answer those
 * questions in 0.5s here vs. scrolling through Timeline's 22px rows.
 *
 * Track ordering: parameter tracks first (alphabetical by id), then
 * node tracks grouped by node, then by property within node. That
 * groups everything driving the same dial together.
 *
 * @module v3/editors/dopesheet/DopesheetEditor
 */

import { useMemo, useRef } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { Film } from 'lucide-react';

const LABEL_W = 180;
const ROW_H   = 18;
const RULER_H = 16;

export function DopesheetEditor() {
  const project = useProjectStore((s) => s.project);
  const activeAnimId = useAnimationStore((s) => s.activeAnimationId);
  const currentTime  = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);

  const anim = useMemo(
    () => (project.animations ?? []).find((a) => a.id === activeAnimId) ?? null,
    [project.animations, activeAnimId],
  );

  const rows = useMemo(() => buildRows(anim, project), [anim, project]);
  const trackAreaRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  if (!anim) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <DopeHeader title="Dopesheet" subtitle="No animation active" />
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">
          Create or select an animation in the Animations panel.
        </div>
      </div>
    );
  }

  const duration = Math.max(1, anim.duration ?? 1000);

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <DopeHeader
        title="Dopesheet"
        subtitle={`${anim.name ?? '(unnamed)'} · ${rows.length} tracks · ${(duration / 1000).toFixed(1)}s`}
      />

      <div className="flex-1 overflow-auto">
        <div className="flex flex-col">
          <Ruler
            duration={duration}
            currentTime={currentTime}
            onSeek={(ms) => setCurrentTime(ms)}
          />
          <div ref={trackAreaRef}>
            {rows.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                Animation has no tracks yet — drop into the Timeline + use auto-keyframe.
              </div>
            ) : (
              rows.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  duration={duration}
                  currentTime={currentTime}
                  onSeek={setCurrentTime}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DopeHeader({ title, subtitle }) {
  return (
    <div className="px-3 py-2 border-b shrink-0 flex items-center gap-1.5 bg-muted/30">
      <Film size={11} className="text-muted-foreground" />
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <span className="text-[10px] text-muted-foreground/70 ml-2 truncate">{subtitle}</span>
    </div>
  );
}

function Ruler({ duration, currentTime, onSeek }) {
  const ticks = useMemo(() => buildRulerTicks(duration), [duration]);
  return (
    <div
      className="sticky top-0 z-10 bg-card border-b flex"
      style={{ height: RULER_H }}
    >
      <div className="shrink-0 border-r" style={{ width: LABEL_W }} />
      <div
        className="relative flex-1 cursor-crosshair"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const ms = (x / rect.width) * duration;
          onSeek(Math.max(0, Math.min(duration, ms)));
        }}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute top-0 bottom-0 w-px bg-border/50"
            style={{ left: `${(t / duration) * 100}%` }}
          />
        ))}
        {ticks.map((t) => (
          <span
            key={`l-${t}`}
            className="absolute top-0 text-[9px] text-muted-foreground/70 -translate-x-1/2 px-0.5"
            style={{ left: `${(t / duration) * 100}%` }}
          >
            {(t / 1000).toFixed(1)}
          </span>
        ))}
        <span
          className="absolute top-0 bottom-0 w-px bg-primary"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Row({ row, duration, currentTime, onSeek }) {
  return (
    <div
      className="flex items-center border-b border-border/40 hover:bg-muted/20"
      style={{ height: ROW_H }}
    >
      <div
        className="shrink-0 px-2 truncate text-[10px] border-r flex items-center gap-1.5"
        style={{ width: LABEL_W }}
        title={row.tooltip}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${row.kindColor}`}
          aria-hidden
        />
        <span className="truncate">{row.label}</span>
        <span className="text-muted-foreground tabular-nums ml-auto">{row.keyframes.length}</span>
      </div>
      <div
        className="relative flex-1 h-full"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          onSeek((x / rect.width) * duration);
        }}
      >
        {row.keyframes.map((kf, i) => {
          const left = (kf.time / duration) * 100;
          const isHot = Math.abs(kf.time - currentTime) < 1;
          return (
            <span
              key={i}
              className={
                'absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 ring-1 ring-card cursor-pointer ' +
                (isHot ? 'bg-primary ring-primary/40' : 'bg-amber-500/80 hover:bg-amber-400')
              }
              style={{ left: `calc(${left}% - 4px)` }}
              title={`${kf.time.toFixed(0)}ms · ${formatValue(kf.value)}`}
              onClick={(e) => { e.stopPropagation(); onSeek(kf.time); }}
            />
          );
        })}
        <span
          className="absolute top-0 bottom-0 w-px bg-primary/60 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function buildRows(anim, project) {
  if (!anim?.tracks) return [];
  const nodeNameById = new Map((project.nodes ?? []).map((n) => [n.id, n.name ?? n.id]));
  const paramNameById = new Map((project.parameters ?? []).map((p) => [p.id, p.name ?? p.id]));

  const paramRows = [];
  const nodeRows = [];
  for (const t of anim.tracks) {
    const kfs = (t.keyframes ?? []).map((kf) => ({ time: kf.time ?? 0, value: kf.value }));
    if (t.paramId) {
      paramRows.push({
        key: `param:${t.paramId}`,
        label: paramNameById.get(t.paramId) ?? t.paramId,
        tooltip: `Parameter ${t.paramId}`,
        kindColor: 'bg-purple-500',
        keyframes: kfs,
      });
    } else if (t.nodeId) {
      nodeRows.push({
        key: `node:${t.nodeId}:${t.property}`,
        label: `${nodeNameById.get(t.nodeId) ?? t.nodeId} · ${t.property}`,
        tooltip: `Node ${t.nodeId} · ${t.property}`,
        kindColor: 'bg-cyan-500',
        keyframes: kfs,
      });
    }
  }
  paramRows.sort((a, b) => a.label.localeCompare(b.label));
  nodeRows.sort((a, b) => a.label.localeCompare(b.label));
  return [...paramRows, ...nodeRows];
}

function buildRulerTicks(duration) {
  // Aim for 5–10 labelled ticks regardless of duration.
  const target = 8;
  const raw = duration / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(pow, Math.round(raw / pow) * pow);
  const out = [];
  for (let t = 0; t <= duration + 0.5; t += step) out.push(t);
  return out;
}

function formatValue(v) {
  if (typeof v === 'number') return v.toFixed(2);
  if (Array.isArray(v)) return `[${v.map((n) => Number(n).toFixed(2)).join(', ')}]`;
  return String(v);
}
