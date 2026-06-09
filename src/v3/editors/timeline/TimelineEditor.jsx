import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useAnimationStore } from '@/store/animationStore';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { beginBatch, endBatch } from '@/store/undoHistory';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { toast } from '@/hooks/use-toast';
import { Copy, Clipboard, Trash2, Music, X, Settings } from 'lucide-react';
import {
  buildParamFCurve,
  buildNodeFCurve,
  decodeFCurveTarget,
  fcurveTargetsParam,
  fcurveTargetsNode,
  makeBezTripleKeyform,
} from '@/anim/animationFCurve';
import { getActiveSceneAction } from '@/anim/sceneAction';
import {
  captureActiveKeyformObject,
  relocateActiveKeyformByObject,
} from '@/anim/fcurveActiveKeyform';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ──────────────────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────────────────── */

const LABEL_W = 140;  // px — fixed node-name column width
const ROW_H = 22;   // px — height of each track row
const RULER_H = 20;   // px — height of the time ruler
const TRACK_PAD = 16;   // px — padding inside track area so edge frames don't clip

/* ──────────────────────────────────────────────────────────────────────────
   Small helpers
────────────────────────────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 9); }

/** Clamp a number to [min, max] */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** Frame number from time (ms) */
function msToFrame(ms, fps) { return Math.round((ms / 1000) * Math.max(1, fps)); }

/** Time (ms) from frame number */
function frameToMs(frame, fps) { return (frame / Math.max(1, fps)) * 1000; }

const CurveIcon = ({ type, className = '' }) => {
  let pathD = '';
  if (type === 'linear') pathD = 'M 2 14 L 14 2';
  else if (type === 'ease-in') pathD = 'M 2 14 C 14 14, 14 14, 14 2';
  else if (type === 'ease-out') pathD = 'M 2 14 C 2 2, 2 2, 14 2';
  else if (type === 'stepped') pathD = 'M 2 14 L 14 14 L 14 2';
  else pathD = 'M 2 14 C 8 14, 8 2, 14 2'; // ease-both / ease

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={cn('stroke-current fill-none', className)}>
      <path d={pathD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   useAudioSync — Web Audio API playback sync

   Key design: effect only watches isPlaying / animation.id, NOT currentTime.
   currentTime is read via ref so it's fresh at the moment play is pressed
   without causing the effect to re-fire every rAF frame. Watching the
   resolved animation's id (rather than the raw UI-store activeActionId)
   covers Stage 1.E scene-binding changes — the user binding a different
   action to `__scene__` flips animation.id and restarts audio cleanly.
────────────────────────────────────────────────────────────────────────── */
// Caller passes the FIELDS it has subscribed to — was previously taking
// the whole `animStore` (post-perf-refactor TimelineEditor no longer
// subscribes to the whole store, so the bare `animStore` reference
// became undefined). `isPlaying` + `loopCount` drive the play/stop
// effect; `currentTime` is read lazily via getState() when audio
// actually starts so it doesn't need to be a dep.
function useAudioSync(animation, isPlaying, loopCount) {
  const audioCtxRef    = useRef(null);
  const buffersRef     = useRef(new Map()); // trackId → AudioBuffer
  const sourcesRef     = useRef(new Map()); // trackId → active AudioBufferSourceNode
  const animationRef   = useRef(animation); // always-fresh animation, not a reactive dep

  // Update refs every render so effects always read the latest values
  animationRef.current   = animation;

  // MEM-02 — mount-once cleanup. Pre-fix each TimelineEditor unmount
  // leaked one AudioContext (browsers cap at ~6 concurrent before
  // suspending new ones). Closing the context releases its real-time
  // audio thread + WebAudio graph.
  useEffect(() => () => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(err => {
        logger.warn('timeline', `AudioContext.close failed: ${err?.message ?? err}`, { err: String(err) });
      });
    }
    buffersRef.current.clear();
    sourcesRef.current.clear();
    audioCtxRef.current = null;
  }, []);

  // MEM-02 follow-up — prune buffersRef entries for tracks that have been
  // removed from the animation. Without this the Map only grows; deleted
  // tracks pin their AudioBuffers (often multi-MB decoded PCM) for the
  // editor's lifetime.
  useEffect(() => {
    const liveIds = new Set((animation?.audioTracks ?? []).map(t => t.id));
    for (const id of buffersRef.current.keys()) {
      if (!liveIds.has(id)) buffersRef.current.delete(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation?.audioTracks?.length, animation?.id]);

  // ── 1. Decode buffers when new tracks with audio appear ───────────────
  //    Stable dep: track IDs + sourceUrls joined — avoids object identity churn
  const trackSourceKey = (animation?.audioTracks ?? [])
    .map(t => `${t.id}:${t.sourceUrl ?? ''}`)
    .join('|');

  useEffect(() => {
    const tracks = animationRef.current?.audioTracks ?? [];
    if (!tracks.length) return;

    let ctx = audioCtxRef.current;
    if (!ctx) { ctx = new AudioContext(); audioCtxRef.current = ctx; }

    for (const track of tracks) {
      if (!track.sourceUrl || buffersRef.current.has(track.id)) continue;
      fetch(track.sourceUrl)
        .then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { buffersRef.current.set(track.id, buf); })
        .catch(e => {
          // Audio decode failure means the user's motion has a missing
          // or broken audio track — they need to know. Per RULE-№1 +
          // feedback_in_app_logging: log AND toast.
          const message = /** @type {any} */ (e)?.message ?? String(e);
          logger.error('timeline', `audio decode failed for track ${track.id}: ${message}`, { trackId: track.id, sourceUrl: track.sourceUrl, err: String(e) });
          toast({
            variant: 'destructive',
            title: 'Audio track failed to load',
            description: `${track.id}: ${message}`,
          });
        });
    }
  }, [trackSourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Stop helper ─────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    sourcesRef.current.forEach(src => {
      try { src.stop(); } catch (err) {
        // AudioBufferSourceNode.stop on an already-stopped source
        // throws InvalidStateError. That's expected in our usage (a
        // toggle-while-stopping race) and recovery is "do nothing",
        // but per RULE-№1 the failure must be observable rather than
        // silently swallowed. Logger only — no toast for an expected
        // race condition.
        logger.warn('timeline', `AudioBufferSourceNode.stop failed (likely double-stop): ${/** @type {any} */ (err)?.message ?? err}`, { err: String(err) });
      }
    });
    sourcesRef.current.clear();
  }, []);

  // ── 3. Play/stop — ONLY fires on isPlaying toggle or animation switch ──
  //    animation object intentionally NOT in deps (object ref changes every frame
  //    during drags/updates and would cause runaway restarts). Read via ref instead.
  useEffect(() => {
    if (!isPlaying) {
      stopAll();
      return;
    }

    const tracks = animationRef.current?.audioTracks ?? [];
    if (!tracks.length) return;

    let ctx = audioCtxRef.current;
    if (!ctx) { ctx = new AudioContext(); audioCtxRef.current = ctx; }

    const startAll = async () => {
      if (ctx.state === 'suspended') await ctx.resume();
      stopAll();

      // Read currentTime lazily here (when play actually starts) so
      // we don't need to keep a per-render ref subscription.
      const nowMs = useAnimationStore.getState().currentTime;

      for (const track of tracks) {
        if (!track.sourceUrl) continue;
        const buffer = buffersRef.current.get(track.id);
        if (!buffer) continue;

        const audioStartMs    = track.audioStartMs   ?? 0;
        const audioEndMs      = track.audioEndMs      ?? buffer.duration * 1000;
        const timelineStartMs = track.timelineStartMs ?? 0;
        const timelineEndMs   = timelineStartMs + (audioEndMs - audioStartMs);

        if (nowMs >= timelineEndMs) continue;

        const offsetInAudioMs = Math.max(0, audioStartMs + Math.max(0, nowMs - timelineStartMs));
        if (offsetInAudioMs >= audioEndMs) continue;

        const playDurationSec = (audioEndMs - offsetInAudioMs) / 1000;
        const delaySec        = Math.max(0, (timelineStartMs - nowMs) / 1000);

        try {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(ctx.currentTime + delaySec, offsetInAudioMs / 1000, playDurationSec);
          sourcesRef.current.set(track.id, source);
        } catch (e) {
          console.error(`Audio start error (${track.id}):`, e);
        }
      }
    };

    startAll().catch(e => console.error('Audio startAll error:', e));
    return () => { stopAll(); };
  // loopCount increments in animationStore.tick on each loop — causes audio restart from top
  }, [isPlaying, animation?.id, loopCount, stopAll]); // NOT animation, NOT currentTime
}

/* ──────────────────────────────────────────────────────────────────────────
   AudioTrackModal — edit audio track parameters using shadcn Dialog
────────────────────────────────────────────────────────────────────────── */
function AudioTrackModal({ track, animation, update, isOpen, onClose }) {
  // Local state to hold edits before saving (all in ms internally)
  const [name, setName] = useState(track.name);
  const [startOffset, setStartOffset] = useState(track.timelineStartMs);
  const [audioStartMs, setAudioStartMs] = useState(track.audioStartMs ?? 0);
  const [duration, setDuration] = useState((track.audioEndMs ?? track.audioDurationMs) - (track.audioStartMs ?? 0));

  // Sync state when modal opens or track changes
  useEffect(() => {
    if (isOpen) {
      setName(track.name);
      setStartOffset(track.timelineStartMs);
      setAudioStartMs(track.audioStartMs ?? 0);
      setDuration((track.audioEndMs ?? track.audioDurationMs) - (track.audioStartMs ?? 0));
    }
  }, [isOpen, track]);

  const handleSave = () => {
    update(p => {
      const act = p.actions.find(a => a.id === animation.id);
      if (act) {
        const t = act.audioTracks.find(at => at.id === track.id);
        if (t) {
          t.name = name || 'Untitled Audio';
          t.timelineStartMs = Math.round(Math.max(0, startOffset));
          t.audioStartMs = Math.round(Math.max(0, audioStartMs));
          t.audioEndMs = Math.round(Math.max(audioStartMs + 100, audioStartMs + duration));
        }
      }
    });
    onClose();
  };

  const maxAudio = track.audioDurationMs ?? 0;
  const timelineEndMs = animation?.duration ?? 2000;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Music className="w-5 h-5 text-primary" />
            <span>Audio Settings</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Track Name */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold tracking-tight">Track Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Background Music"
              className="h-9 font-medium"
            />
          </div>

          <div className="border-t border-border/50 my-2" />

          {/* Timeline Start Offset */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Timeline Start</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((startOffset / 1000).toFixed(2))}
                  onChange={e => setStartOffset((parseFloat(e.target.value) || 0) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={0}
              max={timelineEndMs}
              step={1}
              value={[startOffset]}
              onValueChange={([v]) => setStartOffset(v)}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Where on the animation timeline the audio begins.</p>
          </div>

          {/* Audio Start Trim */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Audio Clip Start</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((audioStartMs / 1000).toFixed(2))}
                  onChange={e => setAudioStartMs((parseFloat(e.target.value) || 0) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={0}
              max={Math.max(maxAudio - 100, 0)}
              step={1}
              value={[audioStartMs]}
              onValueChange={([v]) => {
                const newVal = v;
                setAudioStartMs(newVal);
                // Ensure duration + start doesn't exceed total
                if (newVal + duration > maxAudio) {
                  setDuration(maxAudio - newVal);
                }
              }}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Trim from the beginning of the source audio file.</p>
          </div>

          {/* Duration */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold tracking-tight">Play Duration</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={Number((duration / 1000).toFixed(2))}
                  onChange={e => setDuration((parseFloat(e.target.value) || 0.1) * 1000)}
                  className="w-24 h-8 text-right font-mono"
                />
                <span className="text-xs text-muted-foreground uppercase font-medium">s</span>
              </div>
            </div>
            <Slider
              min={100}
              max={Math.max(maxAudio - audioStartMs, 100)}
              step={1}
              value={[duration]}
              onValueChange={([v]) => setDuration(v)}
              className="py-1"
            />
            <p className="text-[10px] text-muted-foreground italic">Total time this audio clip will play for.</p>
          </div>

          {/* Audio Info Card */}
          <div className="p-3 bg-muted/40 rounded-lg border border-border/50 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Source Duration</span>
              <span className="font-mono">{(maxAudio / 1000).toFixed(2)} s</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Audio Segment</span>
              <span className="font-mono text-primary">{(audioStartMs / 1000).toFixed(2)} → {((audioStartMs + duration) / 1000).toFixed(2)} s</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Timeline Span</span>
              <span className="font-mono text-primary">{(startOffset / 1000).toFixed(2)} → {((startOffset + duration) / 1000).toFixed(2)} s</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all border border-transparent hover:border-border"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:shadow-[0_0_15px_rgba(var(--primary),0.4)] transition-all"
          >
            Apply Changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
   AudioTrackRow — audio track with upload or clip display
────────────────────────────────────────────────────────────────────────── */
function AudioTrackRow({
  track,
  animation,
  update,
  frameToPercentage,
  xToFrame,
  startFrame,
  endFrame,
  totalFrames,
  fps,
}) {
  const fileInputRef = useRef(null);
  const [draggingHandle, setDraggingHandle] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const timelineEndMs = (animation?.duration ?? 2000);

  const handleUpload = async (file) => {
    const url = URL.createObjectURL(file);
    // MEM-11 — close the decode-only AudioContext after use. Pre-fix
    // each audio-track import leaked one AudioContext (separately from
    // the playback context in MEM-02). Chrome caps total live contexts
    // at ~6; after that the next `new AudioContext()` throws
    // InvalidStateError. try/finally guarantees close even on decode
    // error.
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      const audioDurationMs = buffer.duration * 1000;
      const clipEndMs = Math.min(audioDurationMs, timelineEndMs);

      update(p => {
        const act = p.actions.find(a => a.id === animation.id);
        if (act) {
          const t = act.audioTracks.find(at => at.id === track.id);
          if (t) {
            t.sourceUrl = url;
            t.mimeType = file.type;
            t.audioDurationMs = audioDurationMs;
            t.audioStartMs = 0;
            t.audioEndMs = clipEndMs;
            t.timelineStartMs = 0;
          }
        }
      });
    } catch (err) {
      logger.error('timeline', `Failed to decode audio: ${err?.message ?? err}`, {
        file: file.name,
        err: String(err),
      });
      toast({ variant: 'destructive', title: 'Audio decode failed', description: String(err?.message ?? err) });
      URL.revokeObjectURL(url);
    } finally {
      if (ctx.state !== 'closed') {
        ctx.close().catch(err => {
          logger.warn('timeline', `decode-only AudioContext.close failed: ${err?.message ?? err}`, { err: String(err) });
        });
      }
    }
  };

  const handleLeftDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('left');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origStart = track.audioStartMs ?? 0;
    const origTimelineStart = track.timelineStartMs ?? 0;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const act = p.actions.find(a => a.id === animation.id);
        if (act) {
          const t = act.audioTracks.find(at => at.id === track.id);
          if (t) {
            const minDelta = Math.max(-origTimelineStart, -origStart); // keep both ≥ 0
            const maxDelta = (t.audioEndMs ?? t.audioDurationMs) - origStart - 100;
            const clampedDelta = Math.max(minDelta, Math.min(deltaMs, maxDelta));
            t.audioStartMs    = origStart + clampedDelta;
            t.timelineStartMs = origTimelineStart + clampedDelta;
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const handleRightDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('right');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origEnd = track.audioEndMs;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const act = p.actions.find(a => a.id === animation.id);
        if (act) {
          const t = act.audioTracks.find(at => at.id === track.id);
          if (t) {
            const audioStart = t.audioStartMs ?? 0;
            const maxEnd = t.audioDurationMs ?? 0;
            const minEnd = audioStart + 100;
            const clampedEnd = Math.max(minEnd, Math.min(origEnd + deltaMs, maxEnd));
            t.audioEndMs = clampedEnd;
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const handleBarDrag = useCallback((e) => {
    if (!track.sourceUrl) return;
    e.stopPropagation(); // Prevent playhead seeking
    setDraggingHandle('body');
    beginBatch(useProjectStore.getState().project);

    const startX = e.clientX;
    const startFrame = xToFrame(startX);
    const origStart = track.timelineStartMs ?? 0;

    const handleMove = (ev) => {
      const currentFrame = xToFrame(ev.clientX);
      const frameDelta = currentFrame - startFrame;
      const deltaMs = frameToMs(frameDelta, fps);

      update(p => {
        const act = p.actions.find(a => a.id === animation.id);
        if (act) {
          const t = act.audioTracks.find(at => at.id === track.id);
          if (t) {
            t.timelineStartMs = Math.max(0, origStart + deltaMs);
          }
        }
      }, { skipHistory: true });
    };

    const handleUp = () => {
      endBatch();
      setDraggingHandle(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [track, animation, update, xToFrame, fps]);

  const audioDuration = track.audioDurationMs ?? 0;
  const audioStart = track.audioStartMs ?? 0;
  const audioEnd = track.audioEndMs ?? audioDuration;
  const playableMs = audioEnd - audioStart;
  const timelineStart = track.timelineStartMs ?? 0;
  const timelineEnd = timelineStart + playableMs;

  const startFramePos = msToFrame(timelineStart, fps);
  const endFramePos = msToFrame(timelineEnd, fps);
  const leftPercent = (startFramePos - startFrame) / totalFrames * 100;
  const rightPercent = (endFramePos - startFrame) / totalFrames * 100;

  const deleteTrack = () => {
    update(p => {
      const act = p.actions.find(a => a.id === animation.id);
      if (act) {
        act.audioTracks = act.audioTracks.filter(at => at.id !== track.id);
      }
    });
  };

  return (
    <>
      <div className="flex border-b border-border/30 relative text-[11px] bg-muted/5" style={{ height: ROW_H }}>
        {/* Label column */}
        <div className="flex items-center justify-between px-2 border-r border-border/30 shrink-0 text-muted-foreground overflow-hidden sticky left-0 z-30 bg-card/80 backdrop-blur-sm shadow-[1px_0_2px_rgba(0,0,0,0.1)]" style={{ width: LABEL_W, minWidth: LABEL_W }}>
          <span className="truncate text-xs font-medium">{track.name}</span>
          <div className="flex gap-0.5 ml-1">
            <button onClick={() => setShowModal(true)} className="p-0.5 hover:text-primary transition-colors" title="Audio settings">
              <Settings size={12} />
            </button>
            <button onClick={deleteTrack} className="p-0.5 hover:text-destructive transition-colors" title="Delete audio track">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Track area */}
        <div className="relative flex-1 overflow-visible">
        <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
          {!track.sourceUrl ? (
            <div className="flex items-center justify-center h-full">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] px-2 py-1 rounded bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary transition-colors"
              >
                Upload audio
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
                className="hidden"
              />
            </div>
          ) : (
            <div
              onPointerDown={handleBarDrag}
              className="absolute top-1/2 -translate-y-1/2 h-3 bg-primary/30 border border-primary/50 rounded transition-all"
              style={{
                left: `${leftPercent}%`,
                right: `${100 - rightPercent}%`,
                cursor: draggingHandle === 'body' ? 'grabbing' : 'grab',
              }}
              title={`${track.name} — drag to move, drag edges to trim`}
            >
              {/* Left handle */}
              <div
                onPointerDown={handleLeftDrag}
                className="absolute top-0 bottom-0 -left-1 w-2 bg-primary/60 hover:bg-primary cursor-ew-resize rounded-l"
                style={{ cursor: draggingHandle === 'left' ? 'grabbing' : 'ew-resize' }}
              />
              {/* Right handle */}
              <div
                onPointerDown={handleRightDrag}
                className="absolute top-0 bottom-0 -right-1 w-2 bg-primary/60 hover:bg-primary cursor-ew-resize rounded-r"
                style={{ cursor: draggingHandle === 'right' ? 'grabbing' : 'ew-resize' }}
              />
            </div>
          )}
        </div>
        </div>
      </div>

      <AudioTrackModal
        track={track}
        animation={animation}
        update={update}
        fps={fps}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   TimelineEditor — main component (restored from upstream
   TimelinePanel.jsx, adapted for v3 shell — 2026-04-29).

   Functionality kept verbatim: drag-keyframe, multi-select + box-select,
   copy/paste, easing context menu, audio tracks, loop markers. The
   transport bar (play/pause, frame/start/end/FPS fields, speed,
   loop-keyframes, auto-key, audio-add, action picker, new/import,
   K-hint) was lifted to the global Footer in Round 7 (FID-A.2,
   2026-05-16) — see [`PlaybackControls.jsx`](../../shell/PlaybackControls.jsx).
   Imports use the `@/` Vite alias same as upstream. Exported as
   `TimelineEditor` (was `TimelinePanel`) so the v3 editorRegistry
   mapping continues to work without renames.

   Audit-fix D-7 Stage 1.E — the action picker / new / import / unlink cluster in `PlaybackControls.jsx` (lifted from this file in Round 7, FID-A.2) parallels Blender's `template_action` UI helper, which wraps the same animated-id-rebind affordance in a single layout primitive. See `scripts/startup/bl_ui/space_dopesheet.py:313` (`_draw_action_selector` classmethod) which calls `row.template_action(animated_id, new="action.new", unlink="action.unlink")` to render the picker for the Dope-Sheet's active animated id. SS's split (picker in PlaybackControls, keyframe surface here) keeps the timeline panel focused on keyframe editing while the transport row owns the action selector — same separation of concerns Blender achieves by putting `template_action` in the header row.
────────────────────────────────────────────────────────────────────────── */

/**
 * Standalone playhead line + triangle head. Subscribes to `currentTime`
 * internally so a tick re-renders only this 1-pixel vertical span, not
 * the entire timeline.
 *
 * @param {{startFrame: number, totalFrames: number, fps: number}} props
 */
function TimelinePlayhead({ startFrame, totalFrames, fps }) {
  const currentTime = useAnimationStore((s) => s.currentTime);
  const currentFrame = msToFrame(currentTime, fps);
  const frac = (currentFrame - startFrame) / totalFrames;
  if (frac < 0 || frac > 1) return null;
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none z-40"
      style={{ left: `calc(${LABEL_W + TRACK_PAD}px + ${frac * 100}% - ${(LABEL_W + 2 * TRACK_PAD) * frac}px)` }}
    >
      <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0
        border-l-[4px] border-l-transparent
        border-r-[4px] border-r-transparent
        border-t-[6px] border-t-primary" />
    </div>
  );
}

export function TimelineEditor() {
  // Pre-fix: `const anim = useAnimationStore()` subscribed to the WHOLE
  // animation store with no selector. Every `currentTime` tick (60 Hz
  // during playback) triggered a full re-render of the entire timeline
  // — ruler, all rows, every keyframe diamond, the audio waveform — on
  // a 240-frame record-mode action that was the dominant cost in the
  // Viewport tab (~10 fps observed). Now we subscribe field-by-field to
  // only the slowly-changing fields; `currentTime` lives in tiny
  // subscriber subcomponents that own just the playhead line + frame
  // counter, so a tick re-renders only those few elements.
  const fps             = useAnimationStore((s) => s.fps);
  const animEndFrame    = useAnimationStore((s) => s.endFrame);
  const animStartFrame  = useAnimationStore((s) => s.startFrame);
  const activeActionId  = useAnimationStore((s) => s.activeActionId);
  const loopKeyframes   = useAnimationStore((s) => s.loopKeyframes);
  // Audio sync needs to react to play/pause + each loop wrap. These
  // are infrequent transitions (toggle on Space, ~1/sec at most for
  // loop), so subscribing here doesn't put us back in the per-tick
  // re-render hole.
  const isPlaying       = useAnimationStore((s) => s.isPlaying);
  const loopCount       = useAnimationStore((s) => s.loopCount);
  // Action functions — zustand returns stable refs across renders so
  // subscribing to them is identity-free; this just lets us call them
  // ergonomically without `useAnimationStore.getState().fn(...)` at
  // every call site. Used by callbacks below.
  const animSeekFrame         = useAnimationStore((s) => s.seekFrame);
  const animSetActiveActionId = useAnimationStore((s) => s.setActiveActionId);
  const animSetFps            = useAnimationStore((s) => s.setFps);
  const animSetEndFrame       = useAnimationStore((s) => s.setEndFrame);
  const proj = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateProject);
  const sel = useEditorStore(s => s.selection);

  const trackAreaRef = useRef(null);
  const rulerRef = useRef(null);

  // State for selection and clipboard
  const [selectedKeyframes, setSelectedKeyframes] = useState(new Set()); // Set of "nodeId:timeMs"
  const [selectionBox, setSelectionBox] = useState(null); // {x, y, w, h}
  const [clipboard, setClipboard] = useState(null); // { properties: { prop: val }, easing: string }

  // Ref to manage drag states without re-rendering continuously
  const dragCtx = useRef({
    type: null, // "playhead", "keyframe", "box", "loopStart", "loopEnd"
    startX: 0,
    startY: 0,
    startScrollX: 0,
    startScrollY: 0,
    startFrame: 0,
    origKeyframes: [], // [{ nodeId, origTimeMs, props: [{propName, origTimeMs}] }]
  });

  /* ── Active action object ───────────────────────────────────────────── */
  // Stage 1.E: scene-bound action wins over UI-store fallback. Once the
  // user binds an action to `__scene__` via the Actions panel, the timeline
  // focuses on that action — the UI store is only consulted when the
  // scene has no binding (most projects pre-Stage-1.E start state).
  const animation = useMemo(
    () => getActiveSceneAction(proj, activeActionId),
    [proj.nodes, proj.actions, activeActionId]
  );

  /* ── Derived values ─────────────────────────────────────────────────── */
  // NOTE: `currentFrame` derived from `anim.currentTime` is intentionally
  // NOT computed at the parent level — that'd re-render the whole editor
  // on every tick. The playhead line subscribes to currentTime via
  // `<TimelinePlayhead>` below; per-cell "at-playhead" highlights were
  // dropped (they strobed across keys 60 Hz during playback anyway).
  const endFrame = Math.max(1, animEndFrame);
  const startFrame = Math.max(0, animStartFrame);
  const totalFrames = Math.max(endFrame - startFrame, 1);
  const labelStep = totalFrames <= 48 ? 2 : totalFrames <= 120 ? 5 : totalFrames <= 240 ? 10 : totalFrames <= 480 ? 20 : 50;

  /* ── KeyG = modal grab on selected keyforms (Blender parity) ────────── */
  // Press G with one or more keyforms selected → enter modal grab.
  // Cursor X movement translates the selection in real time (mutates
  // kf.time directly via skipHistory updates; original positions are
  // snapshot on entry and restored on cancel). Commit: LMB / Enter /
  // G again. Cancel: RMB / Esc. Mirrors `transform.transform mode='TIME_TRANSLATE'`
  // (`keymap_data/blender_default.py:2718-2719`) — the dopesheet's
  // modal grab op. Capture-phase listener + stopImmediatePropagation
  // so the global dispatcher's `selection.delete` / etc. don't fire on
  // chord overlap.
  const grabStateRef = useRef(/** @type {null | {anchorX:number, origByItem:Array<{rowKey:string,paramId:string|null,trackNodeId:string|null,prop:string|null,origTimeMs:number}>}} */ (null));
  const lastPointerXRef = useRef(/** @type {number|null} */ (null));
  // Track latest pointer X over the editor for the G anchor.
  useEffect(() => {
    const onMove = (e) => { lastPointerXRef.current = e.clientX; };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  // Refs the keydown closure needs to read at fire time.
  const animationRefForG = useRef(animation);
  const selectedKeyframesRefForG = useRef(selectedKeyframes);
  const fpsRefForG = useRef(fps);
  useEffect(() => { animationRefForG.current = animation; }, [animation]);
  useEffect(() => { selectedKeyframesRefForG.current = selectedKeyframes; }, [selectedKeyframes]);
  useEffect(() => { fpsRefForG.current = fps; }, [fps]);
  useEffect(() => {
    const exitGrab = (commit) => {
      const g = grabStateRef.current;
      if (!g) return;
      if (!commit) {
        // Cancel — restore original times for every grabbed kf.
        update((p) => {
          const a = getActiveSceneAction(p, activeActionId);
          if (!a) return;
          for (const item of g.origByItem) {
            const fc = item.paramId
              ? a.fcurves.find((f) => fcurveTargetsParam(f, item.paramId))
              : a.fcurves.find((f) => {
                  const t = decodeFCurveTarget(f);
                  return t?.kind === 'node' && t.nodeId === item.trackNodeId && t.property === item.prop;
                });
            if (!fc) continue;
            // The kf was renamed by mutating .time; we tracked the
            // CURRENT time on `g` so find by that and restore.
            const kf = fc.keyforms.find((k) => k.time === item.currentTimeMs);
            if (kf) kf.time = item.origTimeMs;
          }
          for (const f of a.fcurves) {
            const cap = captureActiveKeyformObject(f);
            f.keyforms.sort((k1, k2) => k1.time - k2.time);
            relocateActiveKeyformByObject(a, f.id, cap);
          }
        }, { skipHistory: true });
      }
      endBatch();
      grabStateRef.current = null;
      window.removeEventListener('pointermove', onPtrMove, true);
      window.removeEventListener('pointerdown', onPtrDown, true);
      window.removeEventListener('keydown', onModalKey, true);
    };
    const onPtrMove = (ev) => {
      const g = grabStateRef.current;
      if (!g) return;
      const dragFrameDelta = xToFrame(ev.clientX) - xToFrame(g.anchorX);
      if (dragFrameDelta === g.lastDelta) return;
      g.lastDelta = dragFrameDelta;
      const nextSel = new Set();
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        for (const item of g.origByItem) {
          const fc = item.paramId
            ? a.fcurves.find((f) => fcurveTargetsParam(f, item.paramId))
            : a.fcurves.find((f) => {
                const t = decodeFCurveTarget(f);
                return t?.kind === 'node' && t.nodeId === item.trackNodeId && t.property === item.prop;
              });
          if (!fc) continue;
          const kf = fc.keyforms.find((k) => k.time === item.currentTimeMs);
          if (!kf) continue;
          const newFrame = msToFrame(item.origTimeMs, fpsRefForG.current) + dragFrameDelta;
          const newTime = frameToMs(newFrame, fpsRefForG.current);
          kf.time = newTime;
          item.currentTimeMs = newTime;
          nextSel.add(`${item.rowKey}:${newTime}`);
        }
        for (const f of a.fcurves) {
          const cap = captureActiveKeyformObject(f);
          f.keyforms.sort((k1, k2) => k1.time - k2.time);
          relocateActiveKeyformByObject(a, f.id, cap);
        }
      }, { skipHistory: true });
      if (nextSel.size > 0) setSelectedKeyframes(nextSel);
    };
    const onPtrDown = (ev) => {
      if (!grabStateRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      // LMB (button 0) commits; RMB (button 2) cancels. Anything else
      // is ignored.
      if (ev.button === 0) exitGrab(true);
      else if (ev.button === 2) exitGrab(false);
    };
    const onModalKey = (ev) => {
      if (!grabStateRef.current) return;
      if (ev.code === 'Enter' || ev.code === 'KeyG') {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        exitGrab(true);
      } else if (ev.code === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        exitGrab(false);
      }
    };
    const onKeyG = (ev) => {
      if (!hoverRef.current) return;
      if (ev.code !== 'KeyG') return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
      const t = /** @type {HTMLElement|null} */ (ev.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (grabStateRef.current) return;
      const sel = selectedKeyframesRefForG.current;
      if (!sel || sel.size === 0) return;
      const anim = animationRefForG.current;
      if (!anim) return;
      const anchorX = lastPointerXRef.current;
      if (typeof anchorX !== 'number') return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      // Snapshot origin times for every kf currently selected.
      const origByItem = [];
      for (const fc of anim.fcurves) {
        const target = decodeFCurveTarget(fc);
        if (!target) continue;
        const fcurveRowKey = target.kind === 'param' ? `param:${target.paramId}` : `node:${target.nodeId}`;
        for (const kf of fc.keyforms) {
          if (sel.has(`${fcurveRowKey}:${kf.time}`)) {
            origByItem.push({
              rowKey: fcurveRowKey,
              paramId: target.kind === 'param' ? target.paramId : null,
              trackNodeId: target.kind === 'node' ? target.nodeId : null,
              prop: target.kind === 'node' ? target.property : null,
              origTimeMs: kf.time,
              currentTimeMs: kf.time,
            });
          }
        }
      }
      if (origByItem.length === 0) return;
      beginBatch(useProjectStore.getState().project);
      grabStateRef.current = { anchorX, origByItem, lastDelta: 0 };
      window.addEventListener('pointermove', onPtrMove, true);
      window.addEventListener('pointerdown', onPtrDown, true);
      window.addEventListener('keydown', onModalKey, true);
    };
    window.addEventListener('keydown', onKeyG, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyG, { capture: true });
      // If unmounting mid-grab, restore + cleanup.
      if (grabStateRef.current) exitGrab(false);
    };
  }, [activeActionId, update]);

  /* ── KeyA = select-all keyforms inside this editor ──────────────────── */
  // Pre-fix Timeline had no KeyA binding, so the user's Blender muscle-
  // memory press went straight through to the global operator
  // dispatcher (`src/v3/operators/dispatcher.js`) → which fired
  // `selection.selectAllToggle` (PROJECT NODE scope), wrong target.
  // Symptom: "A doesn't select my keys, then I try Box-select, miss
  // off-screen rows, drag the partial selection, and the unmoved keys
  // pop up during playback and break the animation." Fix: hover-gated
  // KeyA that walks every trackRow's every keyform and pushes a single
  // `${rowKey}:${time}` entry into `selectedKeyframes`. Capture-phase
  // listener with stopPropagation/stopImmediatePropagation prevents
  // the project-scope `selectAllToggle` from also firing.
  const hoverRef = useRef(false);
  // Keep a ref to the latest rows so the window keydown handler (whose
  // closure captures values at mount) reads the current row list.
  const trackRowsRefForA = useRef([]);
  useEffect(() => {
    const onKeyA = (e) => {
      if (!hoverRef.current) return;
      if (e.code !== 'KeyA') return;
      // Skip modifier combos — Ctrl/Cmd+A is "add to existing" in IC
      // preset etc.; bare A is the toggle. Leave the modifier variants
      // for future presets (Slice 5.AA-style resolver).
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const rows = trackRowsRefForA.current;
      if (!rows || rows.length === 0) return;
      // Toggle semantics: if anything selected → clear; else select-all.
      setSelectedKeyframes((prev) => {
        if (prev.size > 0) return new Set();
        const next = new Set();
        for (const row of rows) {
          if (!row?.rowKey || !Array.isArray(row.times)) continue;
          for (const t of row.times) next.add(`${row.rowKey}:${t}`);
        }
        return next;
      });
    };
    window.addEventListener('keydown', onKeyA, { capture: true });
    return () => window.removeEventListener('keydown', onKeyA, { capture: true });
  }, []);

  /* ── Auto-select action when one exists ──────────────────────────────── */
  // Stage 1.E: only auto-select when neither scene-binding nor UI-store
  // resolves an action. If the scene is already bound, that wins — no
  // need to write the UI store too (its purpose is the fallback when no
  // scene binding exists).
  useEffect(() => {
    if (animation) return;
    if (proj.actions.length === 0) return;
    animSetActiveActionId(proj.actions[0].id);
    const a = proj.actions[0];
    animSetFps(a.fps ?? 24);
    animSetEndFrame(Math.round(((a.duration ?? 2000) / 1000) * (a.fps ?? 24)));
  }, [proj.actions, animation]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── ANIM-1 — clear local selection state on action switch ─────────── */
  // Pre-fix `selectedKeyframes` (Set of opaque "rowKey:timeMs" ids) was
  // never pruned across action change; Delete/Copy/Paste walked the
  // NEW action's fcurves with stale ids that could collide on identical
  // (param, timeMs) keys, wiping the wrong keys silently.
  useEffect(() => {
    setSelectedKeyframes(new Set());
    setSelectionBox(null);
    setClipboard(null);
  }, [activeActionId, animation?.id]);

  // Audio sync hook
  useAudioSync(animation, isPlaying, loopCount);

  /* ── Timeline pixel helpers ─────────────────────────────────────────── */
  // clientX to global frame mapping, respecting zoom
  const xToFrame = useCallback((clientX) => {
    if (!rulerRef.current) return startFrame;
    const rect = rulerRef.current.getBoundingClientRect();
    // width is the inner width of ruler track (zoom factored in since ruler scales)
    const localX = clientX - rect.left - TRACK_PAD;
    const trackW = rect.width - 2 * TRACK_PAD;
    const frac = clamp(localX / trackW, 0, 1);
    return Math.round(startFrame + frac * totalFrames);
  }, [startFrame, totalFrames]);

  // Frame to percentage width for positioning
  const frameToPercentage = useCallback((frame) => {
    const frac = (frame - startFrame) / totalFrames;
    return `${frac * 100}%`;
  }, [startFrame, totalFrames]);

  /* ── Drag Handlers ──────────────────────────────────────────────────── */

  // Playhead dragging
  const onRulerPointerDown = useCallback((e) => {
    dragCtx.current = { type: 'playhead' };
    const frame = xToFrame(e.clientX);
    animSeekFrame(clamp(frame, startFrame, endFrame));

    const handleMove = (ev) => {
      const frame = xToFrame(ev.clientX);
      animSeekFrame(clamp(frame, startFrame, endFrame));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [xToFrame, animSeekFrame, startFrame, endFrame]);

  // Keyframe clicking & dragging
  // 2026-04-29: `rowKey` (`node:<id>` | `param:<id>`) replaces the
  // legacy `nodeId` argument so param-track keyframes can be selected,
  // dragged, copy/pasted and deleted through the same code path. The
  // selection ID is `${rowKey}:${timeMs}`; the drag context's
  // origKeyframes carries the rowKey so the find-track step inside
  // handleMove can dispatch on `paramId` vs `nodeId+property`.
  const onKeyframePointerDown = useCallback((e, rowKey, timeMs) => {
    e.stopPropagation();

    const id = `${rowKey}:${timeMs}`;
    let newSel = new Set(selectedKeyframes);

    // Shift click toggles selection
    if (e.shiftKey) {
      if (newSel.has(id)) newSel.delete(id);
      else newSel.add(id);
      setSelectedKeyframes(newSel);
    }
    // Normal click selects only this, unless it's already selected
    else {
      if (!newSel.has(id)) {
        newSel = new Set([id]);
        setSelectedKeyframes(newSel);
      }
    }

    // Prepare drag context — store enough info to re-find each fcurve.
    const orig = [];
    if (animation) {
      for (const fc of animation.fcurves) {
        const target = decodeFCurveTarget(fc);
        if (!target) continue;
        const fcurveRowKey = target.kind === 'param' ? `param:${target.paramId}` : `node:${target.nodeId}`;
        for (const kf of fc.keyforms) {
          if (newSel.has(`${fcurveRowKey}:${kf.time}`)) {
            orig.push(target.kind === 'param'
              ? { rowKey: fcurveRowKey, paramId: target.paramId, origTimeMs: kf.time }
              : { rowKey: fcurveRowKey, trackNodeId: target.nodeId, prop: target.property, origTimeMs: kf.time }
            );
          }
        }
      }
    }

    dragCtx.current = {
      type: 'keyframe',
      startX: e.clientX,
      startFrame: msToFrame(timeMs, fps),
      origKeyframes: orig,
    };

    beginBatch(useProjectStore.getState().project);

    const handleMove = (ev) => {
      const dragFrameDelta = xToFrame(ev.clientX) - dragCtx.current.startFrame;
      if (dragFrameDelta !== 0) {
        let nextSel = new Set();
        update((p) => {
          const a = getActiveSceneAction(p, activeActionId);
          if (!a) return;
          for (const item of dragCtx.current.origKeyframes) {
            const fc = item.paramId
              ? a.fcurves.find(f => fcurveTargetsParam(f, item.paramId))
              : a.fcurves.find(f => {
                  const t = decodeFCurveTarget(f);
                  return t?.kind === 'node' && t.nodeId === item.trackNodeId && t.property === item.prop;
                });
            if (fc) {
              const kf = fc.keyforms.find(k => k.time === item.origTimeMs);
              if (kf) {
                const newFrame = Math.max(0, msToFrame(item.origTimeMs, fps) + dragFrameDelta);
                kf.time = frameToMs(newFrame, fps);
                nextSel.add(`${item.rowKey}:${kf.time}`);
              }
            }
          }
          // Sort fcurves by time to ensure play engine doesn't trip up.
          // Audit-fix HIGH-A3 (Slice 5.H dual-audit 2026-05-16) —
          // per-tick sort across ALL fcurves used to drift
          // `activeKeyformIndex` whenever a dragged kf crossed a
          // neighbor; the Graph Editor highlight would jump to a
          // different kf each pointer-move tick. Mirror the
          // FCurveEditor capture/relocate pattern so the active
          // index stays pinned to its object identity through reorder.
          for (const f of a.fcurves) {
            const capturedActive = captureActiveKeyformObject(f);
            f.keyforms.sort((k1, k2) => k1.time - k2.time);
            relocateActiveKeyformByObject(a, f.id, capturedActive);
          }
        }, { skipHistory: true });

        // Update selection to match new times
        if (nextSel.size > 0) {
          setSelectedKeyframes(nextSel);
          dragCtx.current.origKeyframes = dragCtx.current.origKeyframes.map(item => {
            const newFrame = Math.max(0, msToFrame(item.origTimeMs, fps) + dragFrameDelta);
            return { ...item, origTimeMs: frameToMs(newFrame, fps) };
          });
          dragCtx.current.startFrame += dragFrameDelta;
        }
      }
    };

    const handleUp = () => {
      endBatch();
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

  }, [selectedKeyframes, animation, activeActionId, fps, xToFrame, update]);

  // Box Selection
  const onTrackAreaPointerDown = useCallback((e) => {
    if (e.target.closest('.keyframe-diamond') || e.target.closest('.ruler-track')) return;
    if (!trackAreaRef.current) return;

    // Seek current frame to clicked position (if in track area, not labels)
    const rulerRect = rulerRef.current?.getBoundingClientRect();
    if (rulerRect && e.clientX >= rulerRect.left) {
      const frame = xToFrame(e.clientX);
      animSeekFrame(clamp(frame, startFrame, endFrame));
    }

    // Deselect if clicking empty space without shift
    if (!e.shiftKey) setSelectedKeyframes(new Set());

    const rect = trackAreaRef.current.getBoundingClientRect();
    dragCtx.current = {
      type: 'box',
      startX: e.clientX,
      startY: e.clientY,
      rectLeft: rect.left + LABEL_W, // Track area only
      rectTop: rect.top,
      startScrollX: trackAreaRef.current.scrollLeft,
      startScrollY: trackAreaRef.current.scrollTop
    };

    setSelectionBox({
      x: e.clientX - rect.left - LABEL_W + dragCtx.current.startScrollX,
      y: e.clientY - rect.top + dragCtx.current.startScrollY,
      w: 0,
      h: 0
    });

    const handleMove = (ev) => {
      const dx = ev.clientX - dragCtx.current.startX;
      const dy = ev.clientY - dragCtx.current.startY;

      const scrollDx = trackAreaRef.current.scrollLeft - dragCtx.current.startScrollX;
      const scrollDy = trackAreaRef.current.scrollTop - dragCtx.current.startScrollY;

      // Calculate Box rect in scrollable content coordinates
      let bx = dragCtx.current.startX - dragCtx.current.rectLeft + dragCtx.current.startScrollX;
      let by = dragCtx.current.startY - dragCtx.current.rectTop + dragCtx.current.startScrollY;
      let bw = dx + scrollDx;
      let bh = dy + scrollDy;

      if (bw < 0) { bx += bw; bw = Math.abs(bw); }
      if (bh < 0) { by += bh; bh = Math.abs(bh); }

      setSelectionBox({ x: bx, y: by, w: bw, h: bh });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragCtx.current.type = null;

      // Perform Intersection test
      if (animation) {
        setSelectionBox(prevBox => {
          if (prevBox && prevBox.w > 5 && prevBox.h > 5) {
            let newSel = new Set(e.shiftKey ? selectedKeyframes : []);

            // Iterate the same row order as the visible UI
            // (param rows then node rows) so selection-box geometry
            // matches what the user sees.
            const orderedRowKeys = [];
            const seen = new Set();
            for (const fc of animation.fcurves) {
              const target = decodeFCurveTarget(fc);
              if (!target) continue;
              const k = target.kind === 'param' ? `param:${target.paramId}` : `node:${target.nodeId}`;
              if (!seen.has(k)) { seen.add(k); orderedRowKeys.push(k); }
            }

            for (let rIndex = 0; rIndex < orderedRowKeys.length; rIndex++) {
              const rowKey = orderedRowKeys[rIndex];
              const rowY = RULER_H + (rIndex * ROW_H);

              if (rowY + ROW_H > prevBox.y && rowY < prevBox.y + prevBox.h) {
                const wantParam = rowKey.startsWith('param:');
                const targetId = wantParam ? rowKey.slice('param:'.length) : rowKey.slice('node:'.length);
                const fcurvesForRow = animation.fcurves.filter(fc => {
                  const target = decodeFCurveTarget(fc);
                  if (!target) return false;
                  return wantParam
                    ? target.kind === 'param' && target.paramId === targetId
                    : target.kind === 'node' && target.nodeId === targetId;
                });
                const times = [...new Set(fcurvesForRow.flatMap(fc => fc.keyforms.map(k => k.time)))];

                for (const timeMs of times) {
                  const frame = msToFrame(timeMs, fps);
                  const frac = (frame - startFrame) / totalFrames;
                  if (frac >= 0 && frac <= 1) {
                    const trackW = rulerRef.current?.getBoundingClientRect().width - 2 * TRACK_PAD;
                    if (trackW) {
                      const kfX = TRACK_PAD + (frac * trackW);
                      if (kfX > prevBox.x && kfX < prevBox.x + prevBox.w) {
                        newSel.add(`${rowKey}:${timeMs}`);
                      }
                    }
                  }
                }
              }
            }
            setSelectedKeyframes(newSel);
          }
          return null;
        });
      } else {
        setSelectionBox(null);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [animation, startFrame, endFrame, totalFrames, fps, selectedKeyframes, xToFrame, animSeekFrame]);

  /* ── Clipboard Actions ──────────────────────────────────────────────── */
  // Copy now keyed by rowKey rather than nodeId. Param-row clipboard
  // captures the parameter's value at that time (single property);
  // node-row clipboard captures all properties at that time as before.
  const copyKeyframe = useCallback((rowKey, timeMs) => {
    if (!animation) return;
    if (rowKey.startsWith('param:')) {
      const paramId = rowKey.slice('param:'.length);
      const fc = animation.fcurves.find(f => fcurveTargetsParam(f, paramId));
      const kf = fc?.keyforms.find(k => k.time === timeMs);
      if (!kf) return;
      setClipboard({ kind: 'param', paramId, value: kf.value, easing: kf.interpolation ?? 'linear', sourceActionId: activeActionId });
      return;
    }
    const nodeId = rowKey.slice('node:'.length);
    const props = {};
    let easing = 'linear';
    for (const fc of animation.fcurves) {
      const target = decodeFCurveTarget(fc);
      if (!target || target.kind !== 'node' || target.nodeId !== nodeId) continue;
      const kf = fc.keyforms.find(k => k.time === timeMs);
      if (kf) {
        props[target.property] = kf.value;
        easing = kf.interpolation ?? 'linear';
      }
    }
    if (Object.keys(props).length > 0) {
      setClipboard({ kind: 'node', properties: props, easing, sourceActionId: activeActionId, sourceNodeIds: [...sel] });
    }
  }, [animation]);

  const pasteKeyframes = useCallback(() => {
    if (!clipboard || !animation) return;
    // ANIM-5 — refuse cross-action paste with a toast. Pre-fix the
    // clipboard captured only the payload; pasting after switching
    // active actions silently keyed into the wrong action.
    if (clipboard.sourceActionId && clipboard.sourceActionId !== activeActionId) {
      toast({
        variant: 'destructive',
        title: 'Cross-action paste blocked',
        description: 'Copied keyform belongs to a different action. Switch back or copy fresh in this action.',
      });
      return;
    }

    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const timeMs = useAnimationStore.getState().currentTime;

      if (clipboard.kind === 'param') {
        let fc = a.fcurves.find(f => fcurveTargetsParam(f, clipboard.paramId));
        if (!fc) {
          fc = buildParamFCurve(clipboard.paramId, [
            { time: timeMs, value: clipboard.value, easing: clipboard.easing },
          ]);
          if (fc) a.fcurves.push(fc);
          return;
        }
        const existingIdx = fc.keyforms.findIndex(kf => kf.time === timeMs);
        const newKf = makeBezTripleKeyform({ time: timeMs, value: clipboard.value, easing: clipboard.easing });
        if (!newKf) return;
        if (existingIdx >= 0) {
          fc.keyforms[existingIdx] = newKf;
        } else {
          fc.keyforms.push(newKf);
          fc.keyforms.sort((a, b) => a.time - b.time);
        }
        return;
      }

      // Legacy node-property clipboard targets selected nodes.
      if (sel.length === 0) return;
      for (const nodeId of sel) {
        for (const [prop, value] of Object.entries(clipboard.properties ?? {})) {
          let fc = a.fcurves.find(f => {
            const t = decodeFCurveTarget(f);
            return t?.kind === 'node' && t.nodeId === nodeId && t.property === prop;
          });
          if (!fc) {
            fc = buildNodeFCurve(nodeId, prop, [
              { time: timeMs, value, easing: clipboard.easing },
            ]);
            if (fc) a.fcurves.push(fc);
            continue;
          }
          const existingIdx = fc.keyforms.findIndex(kf => kf.time === timeMs);
          const newKf = makeBezTripleKeyform({ time: timeMs, value, easing: clipboard.easing });
          if (!newKf) continue;
          if (existingIdx >= 0) {
            fc.keyforms[existingIdx] = newKf;
          } else {
            fc.keyforms.push(newKf);
            fc.keyforms.sort((a, b) => a.time - b.time);
          }
        }
      }
    });
    // currentTime is read via getState() inside the callback body —
    // not a dep so a playhead tick doesn't bust this memo.
  }, [clipboard, animation, sel, activeActionId, update]);

  /* ── Delete Selection ────────────────────────────────────────────────── */
  const deleteSelectedKeyframes = useCallback(() => {
    if (selectedKeyframes.size === 0) return;

    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      for (const fc of a.fcurves) {
        const target = decodeFCurveTarget(fc);
        if (!target) continue;
        const fcurveRowKey = target.kind === 'param' ? `param:${target.paramId}` : `node:${target.nodeId}`;
        // Audit-fix HIGH-A2 (Slice 5.H dual-audit 2026-05-16) — capture
        // active object pre-filter so it tracks through deletion. If the
        // active kf was deleted, `relocateActiveKeyformByObject` clears
        // the field; if it survived, the field re-points at the new
        // index. Mirrors Blender's `fcurve.cc:1768-1770` per-deletion
        // active-clear, applied as a single capture/relocate pair.
        const capturedActive = captureActiveKeyformObject(fc);
        fc.keyforms = fc.keyforms.filter(kf => !selectedKeyframes.has(`${fcurveRowKey}:${kf.time}`));
        relocateActiveKeyformByObject(a, fc.id, capturedActive);
      }
      a.fcurves = a.fcurves.filter(f => f.keyforms.length > 0);
    });
    setSelectedKeyframes(new Set());
  }, [update, activeActionId, selectedKeyframes]);

  // Keybindings
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      // ANIM-11 — also gate on contentEditable elements + active text
      // selection so Ctrl+C/V/Z in a future rich-text panel or editable
      // SVG <text> doesn't get hijacked by the timeline. Mirror of
      // DopesheetEditor's pattern.
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (target.isContentEditable) return;
      try {
        const sel = window.getSelection?.();
        if (sel && sel.type === 'Range' && !sel.isCollapsed) return;
      } catch { /* defensive */ }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        deleteSelectedKeyframes();
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c') {
          if (selectedKeyframes.size > 0) {
            // Copy the "first" one in selection. Selection IDs are
            // `node:<id>:<time>` or `param:<id>:<time>` — split on the
            // last `:` to keep the kind prefix intact.
            const first = selectedKeyframes.values().next().value;
            const lastColon = first.lastIndexOf(':');
            const rowKey = first.slice(0, lastColon);
            const timeMsStr = first.slice(lastColon + 1);
            copyKeyframe(rowKey, parseFloat(timeMsStr));
          }
        } else if (e.key === 'v') {
          pasteKeyframes();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedKeyframes, selectedKeyframes, copyKeyframe, pasteKeyframes]);


  /* ── Context Menu Actions ────────────────────────────────────────── */
  const setEasingAt = useCallback((rowKey, timeMs, easingType) => {
    const targetId = `${rowKey}:${timeMs}`;
    const applyTo = selectedKeyframes.has(targetId) ? selectedKeyframes : new Set([targetId]);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      for (const fc of a.fcurves) {
        const target = decodeFCurveTarget(fc);
        if (!target) continue;
        const fcurveRowKey = target.kind === 'param' ? `param:${target.paramId}` : `node:${target.nodeId}`;
        for (let i = 0; i < fc.keyforms.length; i++) {
          const kf = fc.keyforms[i];
          if (applyTo.has(`${fcurveRowKey}:${kf.time}`)) {
            // Re-mint the keyform via the BezTriple factory so the
            // legacy easing-name vocabulary the UI dropdown emits maps
            // through the canonical legacy → interpolation table.
            const next = makeBezTripleKeyform({ time: kf.time, value: kf.value, easing: easingType });
            if (next) fc.keyforms[i] = next;
          }
        }
      }
    });
  }, [selectedKeyframes, activeActionId, update]);

  const removeKeyframeAt = useCallback((rowKey, timeMs) => {
    const targetId = `${rowKey}:${timeMs}`;
    if (selectedKeyframes.has(targetId)) {
      deleteSelectedKeyframes();
    } else {
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const wantParam = rowKey.startsWith('param:');
        const lookupId = wantParam ? rowKey.slice('param:'.length) : rowKey.slice('node:'.length);
        for (const fc of a.fcurves) {
          const matches = wantParam
            ? fcurveTargetsParam(fc, lookupId)
            : fcurveTargetsNode(fc, lookupId);
          if (!matches) continue;
          // Audit-fix HIGH-A2 (Slice 5.H dual-audit 2026-05-16) —
          // sister of the bulk-delete site above. Single-keyform
          // delete must also track active through the filter.
          const capturedActive = captureActiveKeyformObject(fc);
          fc.keyforms = fc.keyforms.filter(kf => kf.time !== timeMs);
          relocateActiveKeyformByObject(a, fc.id, capturedActive);
        }
        a.fcurves = a.fcurves.filter(f => f.keyforms.length > 0);
      });
    }
  }, [selectedKeyframes, deleteSelectedKeyframes, activeActionId, update]);

  /* ── Build track rows ────────────────────────────────────────────────── */
  // Rows include both NODE-targeted fcurves (objects["<nodeId>"].<prop>:
  // x/y/rotation/scaleX/scaleY/opacity/mesh_verts/blendShape) and
  // PARAM-targeted fcurves (objects["__params__"].values["<paramId>"] —
  // Live2D parameter animation, the v3 main goal). Each row carries
  // `rowKey` (`node:<id>` or `param:<id>`) and `kind` (`'node'|'param'`);
  // all downstream handlers dispatch on these so a single drag-select
  // machinery covers both. fcurve targets are decoded via
  // `decodeFCurveTarget` (see anim/animationFCurve.js).
  const trackRows = useMemo(() => {
    if (!animation) return [];
    const nodeMap = new Map(proj.nodes.map(n => [n.id, n]));
    const paramMap = new Map((proj.parameters ?? []).map((p) => [p.id, p]));
    const byNode = new Map();
    const byParam = new Map();

    for (const fc of animation.fcurves) {
      const target = decodeFCurveTarget(fc);
      if (!target) continue;
      if (target.kind === 'param') {
        if (!byParam.has(target.paramId)) byParam.set(target.paramId, []);
        byParam.get(target.paramId).push(fc);
      } else {
        if (!byNode.has(target.nodeId)) byNode.set(target.nodeId, []);
        byNode.get(target.nodeId).push(fc);
      }
    }

    function buildRow(rowKey, kind, name, fcurves) {
      const times = [...new Set(fcurves.flatMap(f => f.keyforms.map(kf => kf.time)))].sort((a, b) => a - b);
      const easingByTime = {};
      for (const time of times) {
        for (const f of fcurves) {
          const kf = f.keyforms.find(k => k.time === time);
          if (kf) { easingByTime[time] = kf.interpolation || 'bezier'; break; }
        }
      }
      return { rowKey, kind, name, fcurves, times, easingByTime };
    }

    const nodeRows = Array.from(byNode.entries()).map(
      ([nodeId, fcurves]) => buildRow(
        `node:${nodeId}`, 'node',
        nodeMap.get(nodeId)?.name ?? nodeId,
        fcurves,
      ),
    );
    const paramRows = Array.from(byParam.entries()).map(
      ([paramId, fcurves]) => buildRow(
        `param:${paramId}`, 'param',
        paramMap.get(paramId)?.name ?? paramId,
        fcurves,
      ),
    );
    // Param rows above node rows so the rig animation surface is
    // visually emphasised when a project uses both.
    return [...paramRows, ...nodeRows];
  }, [animation, proj.nodes, proj.parameters]);

  // Keep the KeyA window-handler's row snapshot fresh without making
  // it a dep (the handler is mount-once, never re-attaches).
  trackRowsRefForA.current = trackRows;

  /* ── Ruler tick marks ────────────────────────────────────────────────── */
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let f = Math.floor(startFrame); f <= Math.ceil(endFrame); f++) {
      ticks.push(f);
    }
    return ticks;
  }, [startFrame, endFrame]);

  /* ── No action state ─────────────────────────────────────────────────── */
  const hasAnimation = proj.actions.length > 0;

  return (
    <div
      className="flex flex-col h-full select-none text-xs"
      onPointerEnter={() => { hoverRef.current = true; }}
      onPointerLeave={() => { hoverRef.current = false; }}
    >

      {/* Transport bar lifted to Footer's <PlaybackControls /> in
          Round 7 (FID-A.2, 2026-05-16). All transport controls
          (play/pause, frame/start/end fields, FPS, speed, loop,
          auto-key, audio, action picker, new/import) now live in
          the global Footer center spacer. TimelineEditor renders
          only the track area below. */}

      <div
        className="flex-1 overflow-auto relative select-none"
        ref={trackAreaRef}
        onPointerDown={onTrackAreaPointerDown}
      >
        {trackRows.length === 0 && (animation?.audioTracks?.length ?? 0) === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground/60">
              {hasAnimation
                ? 'Select a node and press K to add keyframes or click 🎵 in the Footer to add audio'
                : 'Click "+ New" in the Footer transport to create an animation'}
            </p>
          </div>
        ) : (
          <div className="relative min-w-full isolate" style={{ minHeight: RULER_H + (trackRows.length + (animation?.audioTracks?.length ?? 0)) * ROW_H }}>

            {/* Selection Box */}
            {selectionBox && (
              <div
                className="absolute border border-primary bg-primary/20 pointer-events-none z-50 mix-blend-screen"
                style={{
                  left: selectionBox.x + LABEL_W, top: selectionBox.y,
                  width: selectionBox.w, height: selectionBox.h
                }}
              />
            )}

            {/* Ruler */}
            <div
              className="sticky top-0 z-40 flex bg-card border-b border-border ruler-track"
              style={{ height: RULER_H }}
              onPointerDown={onRulerPointerDown}
            >
              {/* Label column placeholder */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W }} className="border-r border-border shrink-0 sticky left-0 z-50 bg-card" />

              {/* Tick marks — padded inner wrapper so edges don't clip */}
              <div className="relative flex-1 overflow-hidden cursor-col-resize ruler-track" ref={rulerRef}>
                <div className="absolute inset-y-0 pointer-events-none" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                  {rulerTicks.map(f => {
                    const isLabel = f % labelStep === 0;
                    return (
                      <div
                        key={f}
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: frameToPercentage(f), transform: 'translateX(-50%)' }}
                      >
                        <div className="w-px bg-border/40" style={{ height: isLabel ? 8 : 4, marginTop: isLabel ? 0 : 4 }} />
                        {isLabel && (
                          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
                            {f}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Frame Dividers (Subtle Vertical Grid) */}
            <div className="absolute inset-0 pointer-events-none" style={{ top: RULER_H, left: LABEL_W }}>
              <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                {rulerTicks.map(f => (
                  <div
                    key={f}
                    className="absolute top-0 bottom-0 w-px bg-border/10"
                    style={{ left: frameToPercentage(f) }}
                  />
                ))}
              </div>
            </div>

            {/* Track rows */}
            {trackRows.map((row, ri) => (
              <div
                key={row.rowKey}
                className={[
                  'flex border-b border-border/30 relative text-[11px]',
                  // Highlight when the underlying node/parameter is selected
                  // in the editor selection (Outliner / ParamRow click).
                  row.kind === 'node' && sel.includes(row.rowKey.slice('node:'.length))
                    ? 'bg-primary/5'
                    : 'hover:bg-muted/20',
                ].join(' ')}
                style={{ height: ROW_H }}
              >
                {/* Node label */}
                <div
                  className="flex items-center px-2 border-r border-border/30 shrink-0 text-muted-foreground overflow-hidden sticky left-0 z-30 bg-card/80 backdrop-blur-sm shadow-[1px_0_2px_rgba(0,0,0,0.1)]"
                  style={{ width: LABEL_W, minWidth: LABEL_W }}
                  title={row.name}
                >
                  <span className="truncate">{row.name}</span>
                </div>

                {/* Keyframe diamonds — padded inner wrapper */}
                <div className="relative flex-1 overflow-visible">
                  <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                    {/* Curve interpolation lines */}
                    <svg className="absolute inset-y-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                      {row.times.map((tA, i) => {
                         if (i >= row.times.length - 1) return null;
                         const tB = row.times[i+1];
                         const fA = msToFrame(tA, fps);
                         const fB = msToFrame(tB, fps);
                         const perA = (fA - startFrame) / totalFrames * 100;
                         const perB = (fB - startFrame) / totalFrames * 100;
                         if (perA > 100 || perB < 0) return null; // out of view
                         
                         const easing = row.easingByTime[tA];
                         let pathD = `M ${Math.max(-10, perA)} 5 L ${Math.min(110, perB)} 5`; // simple fallback

                         // v39 interpolation enum: 'constant'/'linear'/'bezier'.
                         // Slice 2.D will read per-keyform handles to draw
                         // proper asymmetric ease-in/ease-out glyphs again.
                         if (easing === 'constant') {
                           pathD = `M ${perA} 8 L ${perB} 8 L ${perB} 2`;
                         } else if (easing === 'linear') {
                           pathD = `M ${perA} 8 L ${perB} 2`;
                         } else {
                           // 'bezier' (or unknown) defaults to smooth ease-both glyph
                           pathD = `M ${perA} 8 C ${perA + (perB-perA)*0.5} 8, ${perA + (perB-perA)*0.5} 2, ${perB} 2`;
                         }
                         
                         return <path key={`curve-${tA}`} d={pathD} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                      })}
                      
                      {/* Loop segment curve */}
                      {loopKeyframes && row.times.length > 0 && (() => {
                        const tLast = row.times[row.times.length - 1];
                        const tEnd = frameToMs(endFrame, fps);
                        if (tLast >= tEnd) return null;

                        const fA = msToFrame(tLast, fps);
                        const fB = endFrame;
                        const perA = (fA - startFrame) / totalFrames * 100;
                        const perB = (fB - startFrame) / totalFrames * 100;
                        
                        // We wrap back to the value of the first keyframe (represented as height 2)
                        const easing = row.easingByTime[tLast] || 'bezier';
                        let pathD;
                        if (easing === 'constant') {
                          pathD = `M ${perA} 8 L ${perB} 8 L ${perB} 2`;
                        } else if (easing === 'linear') {
                          pathD = `M ${perA} 8 L ${perB} 2`;
                        } else {
                          // 'bezier' (or unknown) defaults to smooth ease-both glyph
                          pathD = `M ${perA} 8 C ${perA + (perB-perA)*0.5} 8, ${perA + (perB-perA)*0.5} 2, ${perB} 2`;
                        }
                        
                        return <path key="curve-loop" d={pathD} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" strokeDasharray="4 2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                      })()}
                    </svg>

                    {row.times.map(timeMs => {
                      const frame = msToFrame(timeMs, fps);
                      // No `if (frac < 0 || frac > 1) return null` clip.
                      // Pre-fix, dragging keyframes past frame 0 or past
                      // endFrame made the diamonds disappear visually
                      // even though their data still existed — so they
                      // played back wrong (key was there in the data,
                      // contributing to the curve, but the user couldn't
                      // see or grab them to drag back). Blender renders
                      // out-of-range keys at negative/over-100% positions
                      // and the user pans the timeline to see them; SS
                      // now does the same — the track area has horizontal
                      // overflow, so off-range diamonds sit just past the
                      // visible edge. Still keyed via the box-select +
                      // KeyA operators (those walk row.times directly,
                      // not the rendered DOM).
                      const isSelected = selectedKeyframes.has(`${row.rowKey}:${timeMs}`);

                      return (
                        <ContextMenu key={timeMs}>
                          <ContextMenuTrigger>
                            <div
                              title={`Frame ${frame} — click to select, drag to move`}
                              onPointerDown={(e) => onKeyframePointerDown(e, row.rowKey, timeMs)}
                              className={[
                                'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 cursor-ew-resize',
                                'rotate-45 border transition-colors z-20 keyframe-diamond',
                                isSelected ? 'bg-primary border-primary shadow-[0_0_4px_rgba(255,255,255,0.5)]'
                                  : 'bg-background border-primary/60 hover:bg-primary/40',
                              ].join(' ')}
                              style={{ left: frameToPercentage(frame) }}
                            />
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onSelect={() => copyKeyframe(row.rowKey, timeMs)}>
                              <Copy className="w-3 h-3 mr-2 opacity-70" />
                              Copy
                            </ContextMenuItem>
                            <ContextMenuItem disabled={!clipboard} onSelect={pasteKeyframes}>
                              <Clipboard className="w-3 h-3 mr-2 opacity-70" />
                              Paste
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => setEasingAt(row.rowKey, timeMs, 'linear')}>
                              <CurveIcon type="linear" className="mr-2 opacity-70" />
                              Linear
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.rowKey, timeMs, 'ease-both')}>
                              <CurveIcon type="ease-both" className="mr-2 opacity-70" />
                              Ease Both
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.rowKey, timeMs, 'ease-in')}>
                              <CurveIcon type="ease-in" className="mr-2 opacity-70" />
                              Ease In
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.rowKey, timeMs, 'ease-out')}>
                              <CurveIcon type="ease-out" className="mr-2 opacity-70" />
                              Ease Out
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEasingAt(row.rowKey, timeMs, 'stepped')}>
                              <CurveIcon type="stepped" className="mr-2 opacity-70" />
                              Stepped
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-destructive" onSelect={() => removeKeyframeAt(row.rowKey, timeMs)}>
                              <Trash2 className="w-3 h-3 mr-2 opacity-70" />
                              Remove
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}

                    {/* Phantom Loop Keyframe */}
                    {loopKeyframes && row.times.length > 0 && !row.times.includes(frameToMs(endFrame, fps)) && (
                      <div
                        title={`Loop wrap-around: references first keyframe at frame ${msToFrame(row.times[0], fps)}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border border-primary/40 border-dashed bg-transparent z-10 pointer-events-none"
                        style={{ left: frameToPercentage(endFrame) }}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Audio track rows */}
            {(animation?.audioTracks ?? []).map((audioTrack) => (
              <AudioTrackRow
                key={audioTrack.id}
                track={audioTrack}
                animation={animation}
                update={update}
                frameToPercentage={frameToPercentage}
                xToFrame={xToFrame}
                startFrame={startFrame}
                endFrame={endFrame}
                totalFrames={totalFrames}
                fps={fps}
              />
            ))}

            {/* Playhead — vertical line spanning ruler + all rows.
                Extracted into a tiny subscriber subcomponent so a
                `currentTime` tick re-renders ONLY this line + triangle,
                not the entire timeline. */}
            {(trackRows.length > 0 || (animation?.audioTracks?.length ?? 0) > 0) && (
              <TimelinePlayhead
                startFrame={startFrame}
                totalFrames={totalFrames}
                fps={fps}
              />
            )}

          </div>
        )}
      </div>

      {/* ── Keyframe Context Menu ───────────────────────────────────────── */}
      {/* Context menu replaced by Radix UI ContextMenu above */}
    </div>
  );
}
