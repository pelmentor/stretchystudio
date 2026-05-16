// @ts-nocheck
/* eslint-disable react/prop-types */

/**
 * PlaybackControls — Round 7 FID-A.2 transport-row lift (2026-05-16).
 *
 * Hosts what used to be `TimelineEditor`'s top transport bar
 * (`TimelineEditor.jsx` pre-lift lines 1383-1637): play / pause,
 * first / last frame, repeat, frame / start / end / fps fields, speed
 * slider, loop-keyframes, auto-key, audio track, action picker,
 * new / import buttons, K-hint pill.
 *
 * Lifted into the global Footer's center spacer per the queued
 * FID-A.2 plan from Round 4 / Round 6 close-out docs. Mirrors
 * Blender's `DOPESHEET_HT_playback_controls` and
 * `GRAPH_HT_playback_controls`
 * (`reference/blender/scripts/startup/bl_ui/space_dopesheet.py:351-358`
 * + `reference/blender/scripts/startup/bl_ui/space_graph.py:113-124`),
 * which both delegate to `playback_controls(layout, context)` at
 * `reference/blender/scripts/startup/bl_ui/space_time.py:40-136`.
 *
 * **Blender-fidelity deviation (documented, NOT a stub):** Blender
 * mounts `playback_controls` as a per-editor `bl_region_type = 'FOOTER'`
 * region — visible only when the corresponding editor (Dopesheet,
 * Graph, Sequencer) is the active area. SS mounts it in the GLOBAL
 * `Footer` (which itself mirrors Blender's `STATUSBAR_HT_header`).
 * Trade-off:
 *
 *   - SS gain: transport is always accessible regardless of active
 *     area or workspace, which matches the user's typical workflow
 *     (scrub in Pose workspace while looking at Viewport canvas).
 *   - Blender gain: transport is editor-scoped (e.g., Sequencer-
 *     specific extras) and the global status bar stays uncluttered.
 *
 * SS does not have per-Area FOOTER region infrastructure today
 * (Area.jsx has only a HEADER row + a content body). Adding one
 * would mean inventing a new Area sub-region pattern — large change.
 * Lifting into the existing global Footer was the queued plan and
 * preserves Blender's "transport lives at the bottom" intent without
 * inventing a new region primitive.
 *
 * SS-specific controls NOT in Blender's `playback_controls`:
 *
 *   - FPS field (Blender keeps fps in scene props, exposed via
 *     `TIME_PT_playback` popover, not as a top-level transport
 *     control).
 *   - Speed slider (no Blender equivalent; SS playback-speed
 *     multiplier).
 *   - Loop Keyframes toggle (no Blender equivalent; interpolates
 *     last-kf back to first-kf for seamless loops).
 *   - Audio track button (Blender's audio is sequencer-only;
 *     SS supports per-action audio tracks).
 *   - Action picker / + New / Import (Blender's `template_action`
 *     lives in the dopesheet HEADER, not playback_controls; SS
 *     collapses both into one row for compactness).
 *   - K-hint pill (SS-specific keyboard discoverability affordance).
 *
 * All these are kept as part of the lift because they were
 * previously co-located in the same `TimelineEditor` transport row
 * and splitting them would scatter related controls. Documented as
 * a deliberate SS extension, not a Blender port omission.
 *
 * Per Rule №1 (no quick-and-dirty fixes): behavior preserved
 * verbatim from the pre-lift implementation. No new abstractions
 * introduced beyond the file split. All callbacks
 * (`togglePlay`/`stop`/`lastFrame`/`ensureAnimation`/
 * `createAnimation`/`importMotionFile`) moved with the JSX so the
 * lift is reference-clean.
 *
 * Per Rule №2 (no migration baggage): the source row in
 * `TimelineEditor.jsx` is deleted in the same commit; no shim,
 * no transitional re-export, no "kept for compat" comment.
 *
 * @module v3/shell/PlaybackControls
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useAnimationStore } from '../../store/animationStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { cn } from '../../lib/utils.js';
import { clamp, msToFrame } from '../../lib/timeMath.js';
import {
  Disc,
  RotateCcw,
  Repeat,
  SkipBack,
  SkipForward,
  Music,
  Upload,
} from 'lucide-react';
import { parseMotion3Json } from '../../io/live2d/motion3jsonImport.js';
import { getActiveSceneAction, getSceneAction } from '../../anim/sceneAction.js';

function uid() { return Math.random().toString(36).slice(2, 9); }

/* ──────────────────────────────────────────────────────────────────────────
   Transport button (play/pause/stop/loop icons) — lifted verbatim from
   TimelineEditor.jsx pre-lift lines 63-81. Only consumer was the
   transport row that now lives here; co-located.
────────────────────────────────────────────────────────────────────────── */
function TransportBtn({ onClick, active, title, children, className = '', disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center w-6 h-6 rounded text-xs transition-colors',
        active
          ? (className.includes('bg-') ? '' : 'bg-primary text-primary-foreground')
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'opacity-30 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Tiny numeric field — lifted verbatim from TimelineEditor.jsx pre-lift
   lines 101-128. Only consumer was the transport row.
────────────────────────────────────────────────────────────────────────── */
function NumField({ label, value, onChange, min, max, step = 1, className = '', tip }) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => { setLocal(String(value)); }, [value]);

  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(clamp(n, min ?? -Infinity, max ?? Infinity));
    else setLocal(String(value));
  };

  return (
    <label className={`flex items-center gap-1 ${className}`} title={tip}>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap select-none">{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        className="w-12 h-5 text-[11px] text-center bg-input border border-border rounded px-1 py-0 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   PlaybackControls — main export. Subscribes to the same stores
   `TimelineEditor` used for its transport row.

   Subscription notes (per `feedback_filter_in_selector` rule):
   `useAnimationStore()` without a selector returns the whole store —
   this matches pre-lift behavior (TimelineEditor did the same). The
   tighter selector forms aren't applied here because the transport
   reads ~10 slots and a partial extraction would be harder to keep
   in sync. Audit-fix sweep can narrow these if perf shows a real
   issue.
────────────────────────────────────────────────────────────────────────── */
export function PlaybackControls() {
  const anim = useAnimationStore();
  const proj = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateProject);
  const autoKeyframe = useEditorStore(s => s.autoKeyframe);
  const setAutoKeyframe = useEditorStore(s => s.setAutoKeyframe);

  const motionFileRef = useRef(null);

  /* ── Active action object ───────────────────────────────────────────── */
  // Same getActiveSceneAction semantics as TimelineEditor: scene
  // binding wins over UI-store fallback (Stage 1.E). Re-resolved on
  // every render since this component re-subscribes to all the same
  // slots; useMemo would gain little and add a dep-array maintenance
  // burden.
  const animation = getActiveSceneAction(proj, anim.activeActionId);

  /* ── Derived values ─────────────────────────────────────────────────── */
  const fps = anim.fps;
  const currentFrame = msToFrame(anim.currentTime, fps);
  const endFrame = Math.max(1, anim.endFrame);
  const startFrame = Math.max(0, anim.startFrame);
  const hasAnimation = proj.actions.length > 0;

  /* ── Create a default action if none ────────────────────────────────── */
  const ensureAnimation = useCallback(() => {
    if (proj.actions.length > 0) return proj.actions[0].id;
    const id = uid();
    update((p) => {
      p.actions.push({
        id,
        name: 'Action 1',
        duration: 2000,
        fps: 24,
        fcurves: [],
        audioTracks: [],
        flag: 0,
        meta: { createdAt: null, modifiedAt: null, source: 'authored' },
      });
    });
    anim.setActiveActionId(id);
    anim.setFps(24);
    anim.setEndFrame(48);
    return id;
  }, [proj.actions, update, anim]);

  /* ── Import .motion3.json as a new action clip ──────────────────────── */
  const importMotionFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      window.alert(`Could not read ${file.name}.`);
    };
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const baseName = file.name.replace(/\.motion3\.json$/i, '').replace(/\.json$/i, '');
        const { action, warnings } = parseMotion3Json(text, { uid, name: baseName });
        update((p) => {
          p.actions.push(action);
        });
        anim.setActiveActionId(action.id);
        anim.setFps(action.fps);
        anim.setEndFrame(Math.round((action.duration / 1000) * action.fps));
        anim.seekFrame(0);
        if (warnings.length > 0) {
          window.alert(
            `Imported "${action.name}" with ${action.fcurves.length} fcurve(s).\n` +
            `${warnings.length} warning(s):\n` +
            warnings.slice(0, 6).join('\n') +
            (warnings.length > 6 ? `\n…+${warnings.length - 6} more` : '')
          );
        }
      } catch (err) {
        window.alert(`Import failed: ${(err && err.message) || err}`);
      }
    };
    reader.readAsText(file);
  }, [update, anim]);

  /* ── Create a fresh action regardless of existing ones ──────────────── */
  const createAnimation = useCallback(() => {
    const id = uid();
    const n = proj.actions.length + 1;
    update((p) => {
      p.actions.push({
        id,
        name: `Action ${n}`,
        duration: 2000,
        fps: 24,
        fcurves: [],
        audioTracks: [],
        flag: 0,
        meta: { createdAt: null, modifiedAt: null, source: 'authored' },
      });
    });
    anim.setActiveActionId(id);
    anim.setFps(24);
    anim.setEndFrame(48);
    anim.seekFrame(0);
    return id;
  }, [proj.actions.length, update, anim]);

  /* ── Transport callbacks ────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    ensureAnimation();
    if (anim.isPlaying) anim.pause();
    else anim.play();
  }, [anim, ensureAnimation]);

  const stop = useCallback(() => {
    anim.stop();
  }, [anim]);

  const lastFrame = useCallback(() => {
    anim.seekFrame(endFrame);
  }, [anim, endFrame]);

  return (
    <div className="flex items-center gap-2 px-2 min-w-0 overflow-x-auto">
      {/* First Frame */}
      <TransportBtn disabled={!hasAnimation} onClick={stop} title="First Frame">
        <SkipBack size={14} />
      </TransportBtn>

      {/* Play / Pause */}
      <TransportBtn disabled={!hasAnimation} onClick={togglePlay} active={anim.isPlaying} title={anim.isPlaying ? 'Pause' : 'Play'}>
        {anim.isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
            <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="2,1 9,5 2,9" />
          </svg>
        )}
      </TransportBtn>

      {/* Last Frame */}
      <TransportBtn disabled={!hasAnimation} onClick={lastFrame} title="Last Frame">
        <SkipForward size={14} />
      </TransportBtn>

      {/* Repeat */}
      <TransportBtn disabled={!hasAnimation} onClick={() => anim.setLoop(!anim.loop)} active={anim.loop} title="Repeat">
        <Repeat size={14} />
      </TransportBtn>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Frame fields */}
      <NumField
        label="Frame"
        value={currentFrame}
        min={startFrame}
        max={endFrame}
        onChange={(v) => anim.seekFrame(v)}
        tip="The current playback frame."
      />
      <NumField
        label="Start"
        value={startFrame}
        min={0}
        max={endFrame - 1}
        onChange={(v) => anim.setStartFrame(v)}
        tip="The first frame of the animation loop."
      />
      <NumField
        label="End"
        value={endFrame}
        min={startFrame + 1}
        onChange={(v) => {
          anim.setEndFrame(v);
          if (animation) {
            update((p) => {
              const a = getActiveSceneAction(p, anim.activeActionId);
              if (a) a.duration = (v / (a.fps ?? 24)) * 1000;
            });
          }
        }}
        tip="The last frame of the animation loop."
      />

      <div className="w-px h-4 bg-border mx-1" />

      <NumField
        label="FPS"
        value={fps}
        min={1}
        max={120}
        onChange={(v) => {
          anim.setFps(v);
          if (animation) {
            update((p) => {
              const a = getActiveSceneAction(p, anim.activeActionId);
              if (a) {
                a.fps = v;
                a.duration = (endFrame / v) * 1000;
              }
            });
          }
        }}
        tip="Frames per second — determines playback granularity."
      />

      {/* Speed slider */}
      <label className="flex items-center gap-1 ml-1" title="Playback speed multiplier.">
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">Speed</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={anim.speed}
          onChange={e => anim.setSpeed(parseFloat(e.target.value))}
          className="w-16 h-1 accent-primary"
        />
        <span className="text-[10px] text-muted-foreground w-6">{anim.speed.toFixed(1)}×</span>
      </label>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Loop Keyframes */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => anim.setLoopKeyframes && anim.setLoopKeyframes(!anim.loopKeyframes)}
        active={anim.loopKeyframes}
        title="Loop Keyframes: When active, the animation will interpolate from the last keyframe back to the first keyframe for a seamless loop."
      >
        <RotateCcw size={14} />
      </TransportBtn>

      {/* Auto Keyframe — Blender-style red record dot. Off by default
          (BFA-002): the canonical insert path is the K shortcut; this
          toggle opts the user into "any property change writes a key
          at the playhead", matching Blender's Auto-Keying. */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => setAutoKeyframe(!autoKeyframe)}
        active={autoKeyframe}
        className={autoKeyframe ? 'animate-recording' : ''}
        title="Auto-Keying: when on, every property change writes a keyframe at the playhead. Off by default — press K to insert manually."
      >
        <Disc size={14} strokeWidth={2} />
      </TransportBtn>

      {/* Add Audio Track */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => {
          const name = window.prompt('Audio track name:', `Audio ${(animation?.audioTracks?.length ?? 0) + 1}`);
          if (name) {
            update((p) => {
              const a = getActiveSceneAction(p, anim.activeActionId);
              if (a) {
                a.audioTracks.push({
                  id: uid(),
                  name,
                  sourceUrl: null,
                  mimeType: '',
                  audioDurationMs: 0,
                  audioStartMs: 0,
                  audioEndMs: null,
                  timelineStartMs: 0,
                });
              }
            });
          }
        }}
        title={!hasAnimation ? "Create an animation first to add audio" : "Add audio track"}
      >
        <Music size={14} />
      </TransportBtn>

      {/* Animation switcher — dropdown when ≥1 animation exists, lets user
          A/B between motions for multi-motion preview. Stage 1.E scene-
          binding semantics preserved (writes both UI store + scene's
          assignAction when scene is bound). See `TimelineEditor.jsx`'s
          pre-lift comment for the full Blender-fidelity rationale
          (template_action writes its pinned datablock; SS's "pinned"
          datablock IS the scene when bound). */}
      {hasAnimation ? (
        <select
          value={animation?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const a = proj.actions.find((x) => x.id === id);
            anim.setActiveActionId(id);
            if (getSceneAction(proj)) {
              useProjectStore.getState().assignAction('__scene__', id, 0);
            }
            if (a) {
              const f = a.fps ?? 24;
              anim.setFps(f);
              anim.setEndFrame(Math.round(((a.duration ?? 2000) / 1000) * f));
              anim.seekFrame(0);
            }
          }}
          className="h-6 text-[10px] px-1 rounded border border-border bg-background text-foreground max-w-[140px]"
          title="Active action — switch to preview a different motion. (Re-binds Scene when one is bound.)"
        >
          {proj.actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.id}
            </option>
          ))}
        </select>
      ) : null}

      {/* New animation — always creates a fresh clip; existing ones remain
          available via the switcher above. */}
      <button
        onClick={hasAnimation ? createAnimation : ensureAnimation}
        className={
          hasAnimation
            ? 'text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors'
            : 'text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors'
        }
        title="Create a new empty animation clip"
      >
        + New
      </button>

      {/* Import .motion3.json — adds the file as a new clip and switches
          the timeline to it. Warnings surfaced via alert. */}
      <button
        onClick={() => motionFileRef.current?.click()}
        className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors inline-flex items-center gap-1"
        title="Import a .motion3.json file as a new animation clip"
      >
        <Upload size={10} /> Import
      </button>
      <input
        ref={motionFileRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importMotionFile(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* K key hint */}
      <span className="text-[10px] text-muted-foreground border border-border/40 px-1 py-0.5 font-mono" title="Press K to keyframe selected nodes">
        K
      </span>
    </div>
  );
}
