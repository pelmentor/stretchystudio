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
 * SS-specific controls NOT in Blender's `playback_controls` (audit-fix
 * B1: Repeat / loop toggle added to this list — previously surfaced
 * without acknowledgment, which `feedback_blender_reference_strict`
 * forbids):
 *
 *   - **Repeat (loop toggle)** — no equivalent in
 *     `playback_controls`; loop mode lives in the `TIME_PT_playback`
 *     popover at `space_time.py:245`
 *     (`col.prop(scene, "playback_loop_mode", text="Loop")`). SS surfaces
 *     it as a top-level button for one-click access.
 *   - **FPS field** — Blender keeps fps in scene props, exposed via
 *     `TIME_PT_playback` popover, not as a top-level transport control.
 *   - **Speed slider** — no Blender equivalent; SS playback-speed
 *     multiplier.
 *   - **Loop Keyframes toggle** — no Blender equivalent; interpolates
 *     last-kf back to first-kf for seamless loops.
 *   - **Audio track button** — Blender's audio is sequencer-only; SS
 *     supports per-action audio tracks.
 *   - **Action picker / + New / Import** — Blender's `template_action`
 *     lives in the dopesheet HEADER
 *     (`space_dopesheet.py:322` via `DOPESHEET_HT_editor_buttons`), not
 *     in playback_controls. SS collapses both into one row for
 *     compactness.
 *   - **K-hint pill** — SS-specific keyboard discoverability affordance.
 *
 * All these are kept as part of the lift because they were previously
 * co-located in the same `TimelineEditor` transport row and splitting
 * them would scatter related controls. Documented as deliberate SS
 * extensions, NOT Blender port omissions.
 *
 * Blender controls in `playback_controls` (`space_time.py:40-136`) that
 * are NOT ported (audit-fix B2-B8: all six absences now acknowledged
 * per `feedback_blender_reference_strict` — silent omissions are the
 * exact pattern that rule was written to forbid):
 *
 *   - **`TIME_PT_playback` leading popover** (`space_time.py:52-55`) —
 *     Blender's first control in playback_controls. Hosts Limit-to-Frame-
 *     Range, Allow-Preroll, Follow-Current-Frame, Play-In editor scoping.
 *     SS has no equivalent surface; deliberate omission, no SS analog
 *     planned today.
 *   - **`TIME_PT_keyframing_settings` popover next to auto-key**
 *     (`space_time.py:59-64`) — Blender renders a `KEYTYPE_{...}_VEC`
 *     icon popover alongside the auto-key toggle for keyframe-type
 *     selection. SS uses a single global keyframe type today; not
 *     ported.
 *   - **`TIME_PT_auto_keyframing` popover next to auto-key**
 *     (`space_time.py:75-79`) — Blender's auto-key toggle is paired
 *     with this popover (subordinate panel, `sub.active =
 *     use_keyframe_insert_auto`). SS has only the toggle; not ported.
 *   - **`screen.keyframe_jump` PREV/NEXT-keyframe** (`space_time.py:83`
 *     + `:101`) — Blender's transport has FOUR jump controls (first,
 *     prev-kf, next-kf, last); SS has only first + last. Adding prev/
 *     next-kf requires a per-action keyframe-list iteration primitive in
 *     animationStore; deferred.
 *   - **Time-jump cluster** (`space_time.py:104-108`) — `screen.time_jump
 *     backward=True/False` + `TIME_PT_jump` popover (step-N-frames). SS
 *     uses scrubbing + Frame numeric field for the same workflow; the
 *     fixed-step buttons are not ported.
 *   - **Playhead-snap toggle** (`space_time.py:110-114`) —
 *     `tool_settings.use_snap_playhead` + `TIME_PT_playhead_snapping`
 *     popover. SS has no playhead-snap concept today; not ported.
 *   - **`use_preview_range` toggle + dual binding**
 *     (`space_time.py:127-136`) — Blender's Start/End fields switch
 *     between scene range and preview range via a toggle. SS has a
 *     single scene-range only; the SS Start/End fields always bind
 *     scene range.
 *   - **`PLAY_REVERSE`** (`space_time.py:94`) — Blender shows
 *     PLAY_REVERSE + PLAY concurrently when stopped (except in JACK
 *     A/V sync mode). SS has bidirectional Play/Pause only; reverse-
 *     play requires a `playReverse` action on animationStore (deferred).
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
  ChevronDown,
  Pencil,
  X,
} from 'lucide-react';
import { parseMotion3Json } from '../../io/live2d/motion3jsonImport.js';
import { uniqueName } from '../../lib/uniqueName.js';
import { getActiveSceneAction, getSceneAction } from '../../anim/sceneAction.js';
import { AUTOKEY_MODES, getAutoKeyMode } from '../../anim/autoKeyDispatch.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu.jsx';

/** Human-readable labels for the auto-key mode dropdown. */
const AUTOKEY_MODE_LABELS = Object.freeze({
  all:        'AutoKey: All Properties',
  activeSet:  'AutoKey: Active Keying Set',
  available:  'AutoKey: Available',
});

/** Per-mode tooltip / description text (shown below the radio item). */
const AUTOKEY_MODE_DESCRIPTIONS = Object.freeze({
  all:       'Key every property of the selection (current SS behaviour).',
  activeSet: 'Key only the active keying set (or LocRotScale if none).',
  available: 'Key only properties that already have an F-Curve.',
});

function uid() { return Math.random().toString(36).slice(2, 9); }

/* ──────────────────────────────────────────────────────────────────────────
   Transport button (play/pause/stop/loop icons) — lifted verbatim from
   TimelineEditor.jsx pre-lift lines 63-81. Only consumer was the
   transport row that now lives here; co-located.
────────────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────────────
   Animation Phase 7 Slice 7.D — Auto-key mode dropdown.

   Sits next to the AutoKey toggle (red disc). Picks one of three modes,
   stored on `project.autoKeyMode` (sparse; default `'all'`):

     • All Properties    — current SS behaviour (every prop of selection)
     • Active Keying Set — only the active KS (or LocRotScale if none)
     • Available         — only properties with existing F-Curves

   Mirrors Blender's `AUTOKEY_FLAG_ONLYKEYINGSET` / `AUTOKEY_FLAG_INSERTAVAILABLE`
   bits at `DNA_userdef_types.h:278-293` (see `runAutoKey` JSDoc for
   dispatch mapping).

   The dropdown trigger is intentionally a small chevron-only button so
   the AutoKey toggle keeps the dominant visual weight — mode picking
   is a one-off setup gesture, not a per-session interaction.
────────────────────────────────────────────────────────────────────────── */
function AutoKeyModeDropdown({ disabled, project, update }) {
  const mode = getAutoKeyMode(project);

  function setMode(next) {
    // Audit-fix M-3 (Phase 7.D sweep): `{skipHistory: true}` — auto-key
    // mode is a UI preference, not animation data. Pushing an undo
    // snapshot per dropdown selection eats a Ctrl+Z slot that should
    // undo the last keyframe insertion (and Radix's RadioGroup fires
    // onValueChange even when the user clicks the currently-selected
    // item, so a no-op selection would also burn an undo slot pre-fix).
    // Blender stores autokey_mode in user prefs, never on undo stack.
    update((p) => {
      // Sparse storage — only persist the field when the user picks a
      // non-default value. Rule №2 compliance: project files saved
      // before 7.D have no `autoKeyMode` field and behave as 'all'.
      if (next === 'all') {
        delete p.autoKeyMode;
      } else {
        p.autoKeyMode = next;
      }
    }, { skipHistory: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Auto-Key mode: ${AUTOKEY_MODE_LABELS[mode]}`}
          className={cn(
            'flex items-center justify-center w-4 h-6 rounded-l-none rounded-r text-xs transition-colors -ml-1',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            disabled && 'opacity-30 cursor-not-allowed pointer-events-none',
          )}
        >
          <ChevronDown size={10} strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Auto-Key Mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
          {AUTOKEY_MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="flex-col items-start gap-0 py-2">
              <span className="text-[12px] leading-tight">{AUTOKEY_MODE_LABELS[m]}</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {AUTOKEY_MODE_DESCRIPTIONS[m]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
   PlaybackControls — main export.

   **Audit-fix HIGH-A1 (Round 7 audit-fix sweep):** narrow primitive
   subscriptions per slot. The pre-fix `useAnimationStore()` (no selector)
   form caused a 60 Hz re-render of the WHOLE Footer + PlaybackControls
   subtree during playback in EVERY workspace — because `animationStore.tick`
   replaces `currentTime` / `_lastTimestamp` / `loopCount` every rAF frame,
   and the lift moved this subscription from a workspace-gated mount
   (TimelineEditor) into the always-mounted global Footer. The narrowed
   subscriptions below pull only what the JSX renders, and method calls
   reach `useAnimationStore.getState()` lazily inside callbacks (zustand
   method refs are stable; getState returns the latest store state at
   call time).
────────────────────────────────────────────────────────────────────────── */
export function PlaybackControls() {
  // Primitive subscriptions — Object.is stable, re-render only on
  // semantic change. `currentTime` IS one of the rAF-mutated slots,
  // but we need it for the Frame field display, so re-renders during
  // playback are intentional (and now scoped to PlaybackControls, not
  // its parent Footer subtree).
  const activeActionId = useAnimationStore(s => s.activeActionId);
  const currentTime    = useAnimationStore(s => s.currentTime);
  const isPlaying      = useAnimationStore(s => s.isPlaying);
  const loop           = useAnimationStore(s => s.loop);
  const loopKeyframes  = useAnimationStore(s => s.loopKeyframes);
  const fps            = useAnimationStore(s => s.fps);
  const animStartFrame = useAnimationStore(s => s.startFrame);
  const animEndFrame   = useAnimationStore(s => s.endFrame);
  const speed          = useAnimationStore(s => s.speed);

  const proj = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateProject);
  const autoKeyframe = useEditorStore(s => s.autoKeyframe);
  const setAutoKeyframe = useEditorStore(s => s.setAutoKeyframe);

  const motionFileRef = useRef(null);

  /* ── Inline rename state for the active-action picker ──────────────────
   * Mirrors Blender's `uiTemplateID` widget (action selector in the dope
   * sheet header): the active datablock's name is itself an editable text
   * field. Click the pencil (or hit F2 with the timeline focused) to swap
   * the `<select>` for an `<input>`. Enter commits, Escape cancels, blur
   * commits. Same `.001` collision-suffix as the idle motion dialog —
   * shared `uniqueName` util.
   *
   * Blender reference:
   *   - source/blender/editors/interface/templates/interface_template_id.cc
   *   - F2 → UI_OT_view_item_rename
   *     (scripts/presets/keyconfig/keymap_data/blender_default.py:1074)
   */
  const [renamingActionId, setRenamingActionId] = useState(
    /** @type {string | null} */ (null)
  );
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  /* ── Active action object ───────────────────────────────────────────── */
  // Same getActiveSceneAction semantics as TimelineEditor: scene
  // binding wins over UI-store fallback (Stage 1.E). Re-resolved on
  // every render since this component re-subscribes to all the same
  // slots; useMemo would gain little and add a dep-array maintenance
  // burden.
  const animation = getActiveSceneAction(proj, activeActionId);

  const beginRename = useCallback(() => {
    if (!animation) return;
    setRenamingActionId(animation.id);
    setRenameDraft(animation.name ?? '');
  }, [animation]);

  const commitRename = useCallback(() => {
    if (!renamingActionId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) {
      const current = proj.actions.find((a) => a.id === renamingActionId);
      // Skip the store write when the name is unchanged — avoids a
      // spurious undo entry for a no-op edit.
      if (current && current.name !== trimmed) {
        const taken = new Set(
          proj.actions
            .filter((a) => a.id !== renamingActionId)
            .map((a) => a.name)
        );
        const final = uniqueName(trimmed, taken);
        useProjectStore.getState().renameAction(renamingActionId, final);
      }
    }
    setRenamingActionId(null);
    setRenameDraft('');
  }, [renamingActionId, renameDraft, proj.actions]);

  const cancelRename = useCallback(() => {
    setRenamingActionId(null);
    setRenameDraft('');
  }, []);

  /* ── Unbind / delete active action — Blender's `template_action` X ───
   * Plain click: unbind the action from the scene's animData AND clear
   * the UI-store fallback. The action stays in `project.actions[]`
   * (recoverable via the picker). Mirrors Blender's
   * `ANIM_OT_clear_action` (`source/blender/editors/animation/anim_ops.cc`).
   *
   * Shift+Click: also delete the action object entirely. Blender
   * spells this "reduce user count to 0" — same end result for SS
   * since we don't surface a user-count UI; the action object is gone
   * either way.
   */
  const unbindAction = useCallback(() => {
    useProjectStore.getState().unassignAction('__scene__');
    useAnimationStore.getState().setActiveActionId(null);
    useAnimationStore.getState().stop();
  }, []);

  const deleteActiveAction = useCallback(() => {
    if (!animation) return;
    if (!window.confirm(`Delete action "${animation.name ?? animation.id}"? This removes its keyframes from the project. Cannot be undone except via Ctrl+Z.`)) {
      return;
    }
    useProjectStore.getState().unassignAction('__scene__');
    useProjectStore.getState().deleteAction(animation.id);
  }, [animation]);

  // Auto-focus + select-all when entering rename mode. Mirrors Blender's
  // begin-rename behaviour (input gets focus, full name selected so the
  // user can either edit-in-place or type-to-replace).
  useEffect(() => {
    if (!renamingActionId) return;
    const el = renameInputRef.current;
    if (el) { el.focus(); el.select(); }
  }, [renamingActionId]);

  // F2 — Blender's universal rename shortcut. Wired to the active
  // action when nothing editable is focused (so it doesn't fire while
  // the user is typing in some other input). Gate matches Blender's
  // `view_item_begin_rename` which is a UI-level operator: it only
  // fires when the cursor is over a renameable widget.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key !== 'F2' || e.repeat) return;
      if (!animation) return;
      const tgt = /** @type {HTMLElement | null} */ (e.target);
      if (tgt && (
        tgt.tagName === 'INPUT'
        || tgt.tagName === 'TEXTAREA'
        || tgt.tagName === 'SELECT'
        || tgt.isContentEditable
      )) return;
      e.preventDefault();
      beginRename();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [animation, beginRename]);

  /* ── Derived values ─────────────────────────────────────────────────── */
  const currentFrame = msToFrame(currentTime, fps);
  const endFrame = Math.max(1, animEndFrame);
  const startFrame = Math.max(0, animStartFrame);
  const hasAnimation = proj.actions.length > 0;

  /* ── Create a default action if none ────────────────────────────────── */
  // Audit-fix HIGH-A1: methods reached via `useAnimationStore.getState()`
  // — zustand method refs are stable, so we don't add the store to
  // useCallback deps (omitting it avoids re-creating these callbacks
  // every time a subscribed slot changes).
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
    const a = useAnimationStore.getState();
    a.setActiveActionId(id);
    a.setFps(24);
    a.setEndFrame(48);
    return id;
  }, [proj.actions, update]);

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
        const a = useAnimationStore.getState();
        a.setActiveActionId(action.id);
        a.setFps(action.fps);
        a.setEndFrame(Math.round((action.duration / 1000) * action.fps));
        a.seekFrame(0);
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
  }, [update]);

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
    const a = useAnimationStore.getState();
    a.setActiveActionId(id);
    a.setFps(24);
    a.setEndFrame(48);
    a.seekFrame(0);
    return id;
  }, [proj.actions.length, update]);

  /* ── Transport callbacks ────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    ensureAnimation();
    const a = useAnimationStore.getState();
    if (a.isPlaying) a.pause();
    else a.play();
  }, [ensureAnimation]);

  const stop = useCallback(() => {
    useAnimationStore.getState().stop();
  }, []);

  const lastFrame = useCallback(() => {
    useAnimationStore.getState().seekFrame(endFrame);
  }, [endFrame]);

  return (
    <div className="flex items-center gap-2 px-2 min-w-0 overflow-x-auto">
      {/* First Frame */}
      <TransportBtn disabled={!hasAnimation} onClick={stop} title="First Frame">
        <SkipBack size={14} />
      </TransportBtn>

      {/* Play / Pause */}
      <TransportBtn disabled={!hasAnimation} onClick={togglePlay} active={isPlaying} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? (
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
      <TransportBtn disabled={!hasAnimation} onClick={() => useAnimationStore.getState().setLoop(!loop)} active={loop} title="Repeat">
        <Repeat size={14} />
      </TransportBtn>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Frame fields */}
      <NumField
        label="Frame"
        value={currentFrame}
        min={startFrame}
        max={endFrame}
        onChange={(v) => useAnimationStore.getState().seekFrame(v)}
        tip="The current playback frame."
      />
      <NumField
        label="Start"
        value={startFrame}
        min={0}
        max={endFrame - 1}
        onChange={(v) => useAnimationStore.getState().setStartFrame(v)}
        tip="The first frame of the animation loop."
      />
      <NumField
        label="End"
        value={endFrame}
        min={startFrame + 1}
        onChange={(v) => {
          useAnimationStore.getState().setEndFrame(v);
          if (animation) {
            update((p) => {
              const a = getActiveSceneAction(p, activeActionId);
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
          useAnimationStore.getState().setFps(v);
          if (animation) {
            update((p) => {
              const a = getActiveSceneAction(p, activeActionId);
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
          value={speed}
          onChange={e => useAnimationStore.getState().setSpeed(parseFloat(e.target.value))}
          className="w-16 h-1 accent-primary"
        />
        <span className="text-[10px] text-muted-foreground w-6">{speed.toFixed(1)}×</span>
      </label>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Loop Keyframes */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => {
          const a = useAnimationStore.getState();
          if (a.setLoopKeyframes) a.setLoopKeyframes(!loopKeyframes);
        }}
        active={loopKeyframes}
        title="Loop Keyframes: When active, the animation will interpolate from the last keyframe back to the first keyframe for a seamless loop."
      >
        <RotateCcw size={14} />
      </TransportBtn>

      {/* Auto Keyframe — Blender-style red record dot. Off by default
          (BFA-002): the canonical insert path is the K shortcut; this
          toggle opts the user into "any property change writes a key
          at the playhead", matching Blender's Auto-Keying.

          Phase 7 Slice 7.D — paired with the AutoKeyModeDropdown
          immediately to the right. The toggle is the on/off switch;
          the dropdown picks WHICH mode of auto-key runs. Mode is
          stored on `project.autoKeyMode` (sparse, default `'all'`). */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => setAutoKeyframe(!autoKeyframe)}
        active={autoKeyframe}
        className={autoKeyframe ? 'animate-recording' : ''}
        title="Auto-Keying: when on, every property change writes a keyframe at the playhead. Off by default — press K to insert manually."
      >
        <Disc size={14} strokeWidth={2} />
      </TransportBtn>

      <AutoKeyModeDropdown disabled={!hasAnimation} project={proj} update={update} />

      {/* Add Audio Track */}
      <TransportBtn
        disabled={!hasAnimation}
        onClick={() => {
          const name = window.prompt('Audio track name:', `Audio ${(animation?.audioTracks?.length ?? 0) + 1}`);
          if (name) {
            update((p) => {
              const a = getActiveSceneAction(p, activeActionId);
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
          binding semantics: writes the UI-store activeActionId AND, when
          the scene already binds an action via `__scene__`, re-binds the
          scene to the new id so the picker's pick is treated as user
          intent (otherwise the scene-resolution gate would silently
          override it).

          **Blender-fidelity rationale (Audit-fix D-7 Stage 1.E — kept
          as-is, NOT removed).** Blender's `template_action(animated_id,
          ...)` writes ONLY to `animated_id.animation_data.action`
          (`reference/blender/scripts/startup/bl_ui/space_dopesheet.py:313`).
          For SS, the timeline picker's "pinned" datablock IS the scene
          when the scene is bound — `getActiveSceneAction` resolves to
          scene's action. So picking a different id here writing to
          scene's adt mirrors Blender's template_action writing to its
          pinned datablock; it is NOT the auto-broadcast
          `ANIM_OT_replace_action` op (`source/blender/editors/animation/
          anim_ops.cc:1389`) which Blender exposes as a separate explicit
          operator. Inlined here in audit-fix B9 — previously deferred to
          a "see TimelineEditor.jsx's pre-lift comment" cite that no
          longer exists after the row was lifted. */}
      {hasAnimation ? (
        renamingActionId && renamingActionId === animation?.id ? (
          /* Inline rename mode (Blender uiTemplateID: active datablock
             name is the editable text field). Enter commits, Escape
             cancels, blur commits — matches Blender's text-button
             button_func_rename_full_set handler. */
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
            maxLength={120}
            className="h-6 text-[10px] px-1 rounded border border-primary bg-background text-foreground max-w-[140px]"
            title="Enter = commit, Escape = cancel"
          />
        ) : (
          <>
            <select
              value={animation?.id ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                if (id === '') {
                  unbindAction();
                  return;
                }
                const a = proj.actions.find((x) => x.id === id);
                const animApi = useAnimationStore.getState();
                animApi.setActiveActionId(id);
                if (getSceneAction(proj)) {
                  useProjectStore.getState().assignAction('__scene__', id, 0);
                }
                if (a) {
                  const f = a.fps ?? 24;
                  animApi.setFps(f);
                  animApi.setEndFrame(Math.round(((a.duration ?? 2000) / 1000) * f));
                  animApi.seekFrame(0);
                }
              }}
              onDoubleClick={animation ? beginRename : undefined}
              className="h-6 text-[10px] px-1 rounded border border-border bg-background text-foreground max-w-[140px]"
              title="Active action — switch to preview a different motion. Pick (none) to free the timeline. Double-click (or F2) to rename. (Re-binds Scene when one is bound.)"
            >
              <option value="">(none)</option>
              {proj.actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={beginRename}
              disabled={!animation}
              className={cn(
                'h-6 px-1 rounded border border-border text-muted-foreground inline-flex items-center transition-colors',
                animation ? 'hover:bg-muted/50 hover:text-foreground' : 'opacity-30 cursor-not-allowed',
              )}
              title="Rename action (F2)"
              aria-label="Rename active action"
            >
              <Pencil size={10} />
            </button>
            {/* Unlink — Blender's `template_action` X button. Plain click
                clears the binding so the timeline is "free"; Shift+Click
                also removes the action object from the project. */}
            <button
              type="button"
              onClick={(e) => {
                if (e.shiftKey) deleteActiveAction();
                else unbindAction();
              }}
              disabled={!animation}
              className={cn(
                'h-6 px-1 rounded border border-border text-muted-foreground inline-flex items-center transition-colors',
                animation ? 'hover:bg-destructive/15 hover:text-destructive hover:border-destructive/40' : 'opacity-30 cursor-not-allowed',
              )}
              title="Unbind action from timeline (Shift+Click: delete the action entirely)"
              aria-label="Unbind active action"
            >
              <X size={10} />
            </button>
          </>
        )
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
