/**
 * v3 Phase 1.Timeline — first cut.
 *
 * Replaces the stub TimelineEditor with a real read-only timeline:
 *   - Animation selector + "+ new" button
 *   - Transport bar (Play / Pause / Stop) with frame counter
 *   - Frame ruler with major-tick labels
 *   - One row per track with keyframes drawn as dots at their times
 *   - Click anywhere on the timebar to seek; scrubber line tracks
 *     `animationStore.currentTime`
 *
 * Out of scope for first cut (Phase 3 brings these):
 *   - Drag-keyframe to retime
 *   - Add / delete keyframe operators
 *   - Per-track value graph (curve editor)
 *   - Audio waveform overlays
 *   - Loop range marker drag
 *
 * The CanvasViewport's animation tick already reads `currentTime`
 * from animationStore and applies tracks to the project at render
 * time, so this editor doesn't need to drive the canvas directly —
 * just seek/play/pause and the viewport follows.
 *
 * @module v3/editors/timeline/TimelineEditor
 */

import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, Square, Plus } from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { msToFrame, clamp } from '../../../lib/timeMath.js';
import { buildTrackList } from './trackListBuilder.js';

const FRAME_PX = 12;       // horizontal width of a single frame in the timebar
const TRACK_H = 20;        // pixel height of a track row
const LABEL_W = 160;       // pixel width of the left-side track label column

export function TimelineEditor() {
  const animations = useProjectStore((s) => s.project.animations ?? []);
  const nodes = useProjectStore((s) => s.project.nodes ?? []);
  const createAnimation = useProjectStore((s) => s.createAnimation);

  const activeId = useAnimationStore((s) => s.activeAnimationId);
  const switchAnimation = useAnimationStore((s) => s.switchAnimation);
  const fps = useAnimationStore((s) => s.fps);
  const startFrame = useAnimationStore((s) => s.startFrame);
  const endFrame = useAnimationStore((s) => s.endFrame);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const isPlaying = useAnimationStore((s) => s.isPlaying);
  const play = useAnimationStore((s) => s.play);
  const pause = useAnimationStore((s) => s.pause);
  const stop = useAnimationStore((s) => s.stop);
  const seekFrame = useAnimationStore((s) => s.seekFrame);

  const active = animations.find((a) => a.id === activeId) ?? animations[0] ?? null;

  // Auto-activate the first animation if none is selected (covers the
  // case where the user just opened the Animation workspace and never
  // switched explicitly). Effect rather than setState-during-render so
  // we don't break React's rules.
  useEffect(() => {
    if (active && active.id !== activeId) switchAnimation(active);
  }, [active, activeId, switchAnimation]);

  if (animations.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-xs text-muted-foreground select-none p-3">
        <span>No animations yet.</span>
        <button
          type="button"
          onClick={() => createAnimation('Animation 1')}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 text-xs font-semibold"
        >
          <Plus size={12} />
          New animation
        </button>
        <span className="text-[10px] text-muted-foreground/70 max-w-xs text-center">
          Animation tracks become editable once a clip exists. Phase 3
          will surface keyframe insertion + retiming inline.
        </span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col text-[11px]">
      <Header
        animations={animations}
        active={active}
        onSelect={(id) => {
          const a = animations.find((x) => x.id === id);
          if (a) switchAnimation(a);
        }}
        onCreate={() => createAnimation(`Animation ${animations.length + 1}`)}
        fps={fps}
        startFrame={startFrame}
        endFrame={endFrame}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onPlay={play}
        onPause={pause}
        onStop={stop}
      />
      <Body
        animation={active}
        nodes={nodes}
        fps={fps}
        startFrame={startFrame}
        endFrame={endFrame}
        currentTime={currentTime}
        onSeekFrame={(f) => seekFrame(clamp(f, startFrame, endFrame))}
      />
    </div>
  );
}

function Header({
  animations, active, onSelect, onCreate,
  fps, startFrame, endFrame, currentTime, isPlaying,
  onPlay, onPause, onStop,
}) {
  const currentFrame = msToFrame(currentTime, fps);
  return (
    <div className="px-2 py-1.5 border-b border-border bg-muted/20 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
      <select
        value={active?.id ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
      >
        {animations.map((a) => (
          <option key={a.id} value={a.id}>{a.name || '(unnamed)'}</option>
        ))}
      </select>
      <button
        type="button"
        title="Create new animation"
        onClick={onCreate}
        className="p-1 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
      >
        <Plus size={12} />
      </button>

      <div className="ml-3 flex items-center gap-0.5">
        {isPlaying ? (
          <TransportBtn title="Pause" onClick={onPause}><Pause size={11} /></TransportBtn>
        ) : (
          <TransportBtn title="Play" onClick={onPlay}><Play size={11} /></TransportBtn>
        )}
        <TransportBtn title="Stop" onClick={onStop}><Square size={11} /></TransportBtn>
      </div>

      <span className="ml-3">
        frame <span className="text-foreground">{currentFrame}</span> / {endFrame}
      </span>
      <span>
        ({startFrame}–{endFrame} @ {fps}fps)
      </span>
    </div>
  );
}

function TransportBtn({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}

function Body({ animation, nodes, fps, startFrame, endFrame, currentTime, onSeekFrame }) {
  const tracks = useMemo(
    () => buildTrackList(animation?.tracks ?? [], nodes),
    [animation, nodes],
  );

  const frameCount = Math.max(1, endFrame - startFrame);
  const timebarW = frameCount * FRAME_PX + 1;
  const scrubX = (msToFrame(currentTime, fps) - startFrame) * FRAME_PX;

  const timebarRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  function seekFromPointer(e) {
    const rect = timebarRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const frame = startFrame + Math.round(x / FRAME_PX);
    onSeekFrame(frame);
  }

  function handleTimebarPointerDown(e) {
    seekFromPointer(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleTimebarPointerMove(e) {
    if (e.buttons === 0) return;
    seekFromPointer(e);
  }

  if (tracks.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <Ruler
          ref={timebarRef}
          startFrame={startFrame}
          endFrame={endFrame}
          fps={fps}
          width={timebarW}
          scrubX={scrubX}
          onPointerDown={handleTimebarPointerDown}
          onPointerMove={handleTimebarPointerMove}
        />
        <div className="px-3 py-4 text-[10px] text-muted-foreground">
          {animation
            ? 'No tracks. Tracks appear here once keyframes are recorded — Phase 3 adds keyframe insertion.'
            : 'No animation selected.'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="relative" style={{ width: LABEL_W + timebarW }}>
        <Ruler
          ref={timebarRef}
          startFrame={startFrame}
          endFrame={endFrame}
          fps={fps}
          width={timebarW}
          scrubX={scrubX}
          onPointerDown={handleTimebarPointerDown}
          onPointerMove={handleTimebarPointerMove}
        />

        {tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            startFrame={startFrame}
            endFrame={endFrame}
            fps={fps}
            timebarW={timebarW}
          />
        ))}

        {/* Scrubber line — drawn over rows so it's visible across the
            full visible track stack. Pointer-events:none so it doesn't
            steal clicks from the rows themselves. */}
        <div
          className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
          style={{ left: LABEL_W + scrubX }}
        />
      </div>
    </div>
  );
}

const Ruler = forwardRef(function Ruler(
  { startFrame, endFrame, fps, width, scrubX, onPointerDown, onPointerMove },
  ref,
) {
  // Major every 6 frames at 24fps (~quarter-second), every 4 at lower
  // fps. Keep it heuristic — visual density matters more than perfect
  // ratios.
  const major = fps >= 24 ? 6 : 4;

  /** @type {React.CSSProperties} */
  const styleBg = {
    width,
    backgroundImage:
      `repeating-linear-gradient(to right, transparent 0 ${FRAME_PX - 1}px, hsl(var(--border)) ${FRAME_PX - 1}px ${FRAME_PX}px)`,
  };

  const ticks = [];
  for (let f = startFrame; f <= endFrame; f += major) {
    ticks.push(
      <span
        key={f}
        className="absolute top-0 text-[9px] text-muted-foreground/80 -translate-x-1/2"
        style={{ left: (f - startFrame) * FRAME_PX + 0.5 }}
      >
        {f}
      </span>,
    );
  }

  return (
    <div className="sticky top-0 z-10 flex bg-muted/40 border-b border-border">
      <div className="shrink-0 border-r border-border" style={{ width: LABEL_W }}>
        <span className="block px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
          tracks
        </span>
      </div>
      <div
        ref={ref}
        className="relative h-6 cursor-pointer select-none"
        style={styleBg}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {ticks}
        {/* Live scrubber tick atop the ruler so clicking jumps the head. */}
        <div
          className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
          style={{ left: scrubX }}
        />
      </div>
    </div>
  );
});

function TrackRow({ track, startFrame, endFrame, fps, timebarW }) {
  return (
    <div className="flex border-b border-border/40" style={{ height: TRACK_H }}>
      <div
        className="shrink-0 border-r border-border px-2 flex items-center text-[10px] text-muted-foreground truncate"
        style={{ width: LABEL_W }}
        title={track.label}
      >
        {track.label}
      </div>
      <div className="relative" style={{ width: timebarW }}>
        {track.keyframes.map((kf, i) => {
          const f = msToFrame(kf.time, fps);
          if (f < startFrame || f > endFrame) return null;
          const x = (f - startFrame) * FRAME_PX;
          return (
            <span
              key={i}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-sm bg-foreground/80 border border-background"
              style={{ left: x }}
              title={`frame ${f} → ${formatVal(kf.value)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatVal(v) {
  if (typeof v === 'number') return v.toFixed(2);
  if (Array.isArray(v)) return `[${v.length} values]`;
  if (v == null) return '—';
  return String(v);
}

