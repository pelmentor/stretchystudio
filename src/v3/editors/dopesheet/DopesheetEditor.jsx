// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 3B — Dopesheet editor.
 *
 * Sibling to TimelineEditor, focused on keyform DENSITY rather than
 * playback scrubbing. One row per fcurve, ticks at the times their
 * keyforms live. Click a tick to jump the playhead. Read-only on
 * the keyform values themselves — editing still happens through
 * the timeline / animation mode + auto-keyframe.
 *
 * The point of this view is "what does this animation actually do at
 * a glance" — does this motion fire on every frame, or just at start
 * and end? Are the params evenly distributed? You can answer those
 * questions in 0.5s here vs. scrolling through Timeline's 22px rows.
 *
 * Row ordering: parameter fcurves first (alphabetical by id), then
 * node fcurves grouped by node, then by property within node. That
 * groups everything driving the same dial together.
 *
 * # Slice 5.W — row-state styling
 *
 * Row data + filtering are extracted to [./dopesheetRows.js](./dopesheetRows.js)
 * so the React tree only handles presentation. Per-row state:
 *
 *   - **Muted** (`isFCurveEffectivelyMuted` — per-fcurve OR group
 *     cascade): label gets `italic opacity-60`; diamonds drop to
 *     ~0.4 alpha. Sister to the FCurveEditor sidebar / plot styling
 *     (see [src/v3/editors/fcurve/FCurveEditor.jsx:3172](../fcurve/FCurveEditor.jsx#L3172),
 *     [:3328](../fcurve/FCurveEditor.jsx#L3328)). Matches Blender's
 *     mute hint pattern at `graph_draw.cc:1190-1194` (colourless grey
 *     replacement on the plot stroke) — SS uses alpha because the
 *     dopesheet draws pips, not strokes; same visual signal in the
 *     medium the surface actually uses.
 *
 *   - **Hidden** (`isFCurveEffectivelyHidden`): row is filtered out
 *     of the rendered list entirely. Mirrors
 *     `ANIMFILTER_CURVE_VISIBLE` at `anim_filter.cc:1287-1288`. To
 *     un-hide, open FCurveEditor and click the eye glyph there —
 *     same UX as Blender (the sidebar is the un-hide affordance).
 *
 *   - **Active keyform** (`fc.activeKeyformIndex`, Slice 5.H): the
 *     specific keyform pin gets a pale-yellow ring + slight scale.
 *     Mirrors `draw_fcurve_active_vertex` at `graph_draw.cc:241-262`
 *     (`TH_VERTEX_ACTIVE` painted AFTER the regular vertex pass).
 *     SS mirrors via z-ordering — the active diamond is rendered
 *     LAST in each row's keyform loop so it sits on top of any
 *     adjacent diamonds and never gets clipped.
 *
 * @module v3/editors/dopesheet/DopesheetEditor
 */

import { useMemo, useRef } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { buildDopesheetRows } from './dopesheetRows.js';

const LABEL_W = 180;
const ROW_H   = 18;
const RULER_H = 16;

export function DopesheetEditor() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const currentTime  = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);

  // Stage 1.E: scene-bound action wins over UI-store fallback. Dep on
  // `project.nodes` covers the `__scene__` lookup; `project.actions`
  // covers id resolution.
  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  const rows = useMemo(() => buildDopesheetRows(action, project), [action, project]);
  const trackAreaRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  if (!action) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">
          Create or select an action in the Actions panel.
        </div>
      </div>
    );
  }

  const duration = Math.max(1, action.duration ?? 1000);

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
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
                Action has no fcurves yet — drop into the Timeline + use auto-keyframe.
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
  const { isMuted, activeKfIdx } = row;
  // Render the active keyform LAST so its halo sits on top of any
  // adjacent diamonds and never gets clipped. Mirrors Blender's
  // `draw_fcurve_active_vertex` two-pass order at `graph_draw.cc:241-262`.
  const orderedIndices = useMemo(() => {
    const n = row.keyforms.length;
    if (activeKfIdx < 0 || activeKfIdx >= n) {
      return Array.from({ length: n }, (_, i) => i);
    }
    const out = [];
    for (let i = 0; i < n; i++) if (i !== activeKfIdx) out.push(i);
    out.push(activeKfIdx);
    return out;
  }, [row.keyforms.length, activeKfIdx]);

  return (
    <div
      className="flex items-center border-b border-border/40 hover:bg-muted/20"
      style={{ height: ROW_H }}
    >
      <div
        className={
          'shrink-0 px-2 truncate text-[10px] border-r flex items-center gap-1.5 '
          + (isMuted ? 'italic opacity-60' : '')
        }
        style={{ width: LABEL_W }}
        title={row.tooltip}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${row.kindColor}`}
          style={{ opacity: isMuted ? 0.4 : 1 }}
          aria-hidden
        />
        <span className="truncate">{row.label}</span>
        <span className="text-muted-foreground tabular-nums ml-auto">{row.keyforms.length}</span>
      </div>
      <div
        className="relative flex-1 h-full"
        style={{ opacity: isMuted ? 0.4 : 1 }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          onSeek((x / rect.width) * duration);
        }}
      >
        {orderedIndices.map((i) => {
          const kf = row.keyforms[i];
          const left = (kf.time / duration) * 100;
          const isHot = Math.abs(kf.time - currentTime) < 1;
          const isActive = i === activeKfIdx;
          return (
            <span
              key={i}
              className={
                'absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 cursor-pointer '
                + (isActive
                  ? 'ring-2 ring-yellow-300/90 bg-amber-300'
                  : (isHot ? 'bg-primary ring-1 ring-primary/40' : 'bg-amber-500/80 ring-1 ring-card hover:bg-amber-400'))
              }
              style={{ left: `calc(${left}% - 4px)` }}
              title={`${kf.time.toFixed(0)}ms · ${formatValue(kf.value)}${isActive ? ' · active' : ''}`}
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
