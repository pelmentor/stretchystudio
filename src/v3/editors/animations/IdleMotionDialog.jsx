// @ts-check
/**
 * GAP-017 Phase A — generate idle motion in-app.
 *
 * Modal that wraps `io/live2d/idle/builder.js:buildMotion3` with a tiny form
 * (preset, personality, duration, fps, seed). On submit it produces a fresh
 * v3 animation populated with parameter tracks and switches to it.
 *
 * Plan: docs/FEATURE_GAPS.md → GAP-017. Backend was Phase 0 (motion3 builder
 * is pure JS); this surface puts it inside SS so the user no longer needs to
 * run `/idle` slash command + import.
 *
 * Output → v3 animation tracks:
 *   - One track per animated paramId.
 *   - Track shape: `{ paramId, keyframes: [{time:ms, value, easing}] }`.
 *   - `paramKeyframes` from buildMotion3 is already in ms (motionLib uses
 *     durationMs everywhere) so no time conversion needed.
 *
 * @module v3/editors/animations/IdleMotionDialog
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import * as DialogImpl from '../../../components/ui/dialog.jsx';
import * as ButtonImpl from '../../../components/ui/button.jsx';
import * as LabelImpl from '../../../components/ui/label.jsx';
import * as InputImpl from '../../../components/ui/input.jsx';
import * as SelectImpl from '../../../components/ui/select.jsx';
import { useProjectStore } from '../../../store/projectStore.js';
import { useUIV3Store } from '../../../store/uiV3Store.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { setEditorMode as serviceSetEditorMode } from '../../../services/EditorModeService.js';
import { buildMotion3, PRESETS, PRESET_NAMES, PERSONALITY_PRESETS } from '../../../io/live2d/idle/builder.js';

// shadcn/ui forwardRef components ship without JSX-typed declarations — cast
// via `any` so tsc accepts children/className. Same pattern as AnimationsEditor's
// AlertDialog import.
/** @type {Record<string, React.ComponentType<any>>} */
const D = /** @type {any} */ (DialogImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Btn = /** @type {any} */ (ButtonImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Lbl = /** @type {any} */ (LabelImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Inp = /** @type {any} */ (InputImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Sel = /** @type {any} */ (SelectImpl);
const { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } = D;
const { Button } = Btn;
const { Label } = Lbl;
const { Input } = Inp;
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = Sel;

/**
 * @param {{open: boolean, onOpenChange: (b: boolean) => void}} props
 */
export function IdleMotionDialog({ open, onOpenChange }) {
  const [preset, setPreset] = useState('idle');
  const [personality, setPersonality] = useState('calm');
  const [durationSec, setDurationSec] = useState(8);
  const [fps, setFps] = useState(30);
  const [seed, setSeed] = useState(1);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreset('idle');
    setPersonality('calm');
    setDurationSec(8);
    setFps(30);
    setSeed(1);
    setError(null);
    setBusy(false);
  }

  function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const project = useProjectStore.getState().project;
      const paramIds = (project.parameters ?? []).map((p) => p.id).filter(Boolean);
      if (paramIds.length === 0) {
        setError('Project has no parameters yet. Run the PSD wizard or import a model first.');
        setBusy(false);
        return;
      }

      // Physics outputs must NEVER be animated — they're driven by the
      // physics tick. Pull from project.physicsRules (resolved shape).
      const physicsOutputIds = new Set();
      for (const rule of project.physicsRules ?? []) {
        for (const out of rule.outputs ?? []) {
          if (out?.paramId) physicsOutputIds.add(out.paramId);
        }
      }

      const result = buildMotion3({
        preset, paramIds, physicsOutputIds, durationSec, fps, personality, seed,
      });

      if (result.validationErrors && result.validationErrors.length > 0) {
        setError(`Generated motion has validation errors:\n${result.validationErrors.join('\n')}`);
        setBusy(false);
        return;
      }
      if (result.animatedIds.length === 0) {
        setError('No parameters matched the preset. Try a different preset or check the project has standard params.');
        setBusy(false);
        return;
      }

      // Convert paramKeyframes (Map<paramId, [{time:ms, value, easing}]>)
      // into v3 animation tracks.
      const tracks = [];
      for (const id of result.animatedIds) {
        const kfs = result.paramKeyframes.get(id);
        if (!kfs || kfs.length < 2) continue;
        tracks.push({
          paramId: id,
          keyframes: kfs.map((kf) => ({
            time: kf.time,
            value: kf.value,
            easing: kf.easing ?? 'linear',
          })),
        });
      }

      // Create the animation, then update its tracks via the store. Two-step
      // because createAnimation only takes a name argument.
      const presetLabel = PRESETS[preset]?.label ?? preset;
      const name = `${presetLabel} (${personality})`;
      const beforeIds = new Set((project.animations ?? []).map((a) => a.id));

      useProjectStore.getState().createAnimation(name);

      const projectAfter = useProjectStore.getState().project;
      const created = (projectAfter.animations ?? []).find((a) => !beforeIds.has(a.id));
      if (!created) throw new Error('createAnimation did not produce a new entry');

      // Patch tracks + duration directly via produce-style update.
      useProjectStore.setState((s) => ({
        ...s,
        project: {
          ...s.project,
          animations: s.project.animations.map((a) =>
            a.id === created.id
              ? { ...a, tracks, duration: durationSec * 1000, fps }
              : a
          ),
          // Don't bump hasUnsavedChanges separately — createAnimation
          // already did, and the patch is part of the same logical action.
        },
      }));

      // Switch to the new animation + route to Animation workspace + Animate mode.
      const finalAnimation = useProjectStore.getState().project.animations.find((a) => a.id === created.id);
      if (finalAnimation) useAnimationStore.getState().switchAnimation(finalAnimation);
      useUIV3Store.getState().setWorkspace('animation');
      serviceSetEditorMode('animation');

      reset();
      onOpenChange(false);
    } catch (e) {
      setError(/** @type {Error} */ (e).message ?? String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) reset(); onOpenChange(b); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            Generate idle motion
          </DialogTitle>
          <DialogDescription>
            Synthesises a procedural Live2D motion (head wander, breath, blinks…) and
            adds it as a new animation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 items-center gap-3">
            <Label htmlFor="idle-preset">Preset</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger id="idle-preset" className="col-span-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_NAMES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {PRESETS[n]?.label ?? n} <span className="text-muted-foreground text-xs ml-1">— {PRESETS[n]?.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 items-center gap-3">
            <Label htmlFor="idle-personality">Personality</Label>
            <Select value={personality} onValueChange={setPersonality}>
              <SelectTrigger id="idle-personality" className="col-span-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSONALITY_PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 items-center gap-3">
            <Label htmlFor="idle-duration">Duration (s)</Label>
            <Input
              id="idle-duration"
              className="col-span-2"
              type="number"
              min={4} max={15} step={0.5}
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
            />
          </div>

          <div className="grid grid-cols-3 items-center gap-3">
            <Label htmlFor="idle-fps">FPS</Label>
            <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
              <SelectTrigger id="idle-fps" className="col-span-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 (cinematic)</SelectItem>
                <SelectItem value="30">30 (standard)</SelectItem>
                <SelectItem value="60">60 (smooth)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 items-center gap-3">
            <Label htmlFor="idle-seed">Seed</Label>
            <Input
              id="idle-seed"
              className="col-span-2"
              type="number"
              min={1} max={99999} step={1}
              value={seed}
              onChange={(e) => setSeed(Math.max(1, Number(e.target.value) | 0))}
            />
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-line">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
