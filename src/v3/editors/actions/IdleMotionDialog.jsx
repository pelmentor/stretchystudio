// @ts-check
/**
 * GAP-017 Phase A — generate idle motion in-app.
 *
 * Modal that wraps `io/live2d/idle/builder.js:buildMotion3` with a tiny form
 * (preset, personality, duration, fps, seed). On submit it produces a fresh
 * v3 action populated with parameter fcurves and switches to it.
 *
 * Plan: docs/FEATURE_GAPS.md → GAP-017. Backend was Phase 0 (motion3 builder
 * is pure JS); this surface puts it inside SS so the user no longer needs to
 * run `/idle` slash command + import.
 *
 * Output → v3 action fcurves:
 *   - One FCurve per animated paramId, built via `buildParamFCurve`.
 *   - Keyform shape: `{time:ms, value, easing, type}` (normalised by helper).
 *   - `paramKeyframes` from buildMotion3 is already in ms (motionLib uses
 *     durationMs everywhere) so no time conversion needed.
 *
 * @module v3/editors/actions/IdleMotionDialog
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
import { buildMotion3, PRESETS, PRESET_NAMES, PERSONALITY_PRESETS } from '../../../io/live2d/idle/builder.js';
import { buildParamFCurve } from '../../../anim/animationFCurve.js';
import { sanitizeName } from '../../../io/live2d/exporter.js';
import { uniqueName } from '../../../lib/uniqueName.js';

// shadcn/ui forwardRef components ship without JSX-typed declarations — cast
// via `any` so tsc accepts children/className. Same pattern as ActionsEditor's
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
  // User-typed motion name. Empty = use the auto-suggested name derived
  // from preset+personality (shown as the input's placeholder).
  const [name, setName] = useState('');
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);

  // Auto-suggested action name — mirrors the legacy default (`Idle (calm)`
  // / `Listening (energetic)` / etc.). Used as the input placeholder so the
  // user sees what they'll get if they don't type anything.
  const presetLabel = PRESETS[preset]?.label ?? preset;
  const autoName = `${presetLabel} (${personality})`;
  // Live filename preview — shows the user the exact `.motion3.json` file
  // that this motion will become at export. Matches `sanitizeName` in
  // exporter.js (single source of truth — same function imported here).
  const previewName = (name.trim() || autoName);
  const previewFilename = `${sanitizeName(previewName)}.motion3.json`;

  function reset() {
    setPreset('idle');
    setPersonality('calm');
    setDurationSec(8);
    setFps(30);
    setSeed(1);
    setName('');
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
      // physics tick. v50 (2026-06-08): pull from per-node physicsModifier
      // entries on project.nodes; each modifier has a single output.
      const physicsOutputIds = new Set();
      for (const node of project.nodes ?? []) {
        if (!Array.isArray(node?.modifiers)) continue;
        for (const mod of node.modifiers) {
          if (!mod || mod.type !== 'physicsModifier') continue;
          if (mod.output?.paramId) physicsOutputIds.add(mod.output.paramId);
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
      // into FCurves targeting `objects["__params__"].values["<paramId>"]`.
      // `buildParamFCurve` normalises keyforms (defaults easing → 'linear',
      // derives `type` from easing) and returns null on empty input.
      const fcurves = [];
      for (const id of result.animatedIds) {
        const kfs = result.paramKeyframes.get(id);
        if (!kfs || kfs.length < 2) continue;
        const fc = buildParamFCurve(id, kfs);
        if (fc) fcurves.push(fc);
      }

      // Create the action, then update its fcurves via the store. Two-step
      // because createAction only takes a name argument.
      //
      // Name resolution: user-typed value wins; empty falls back to the
      // auto-suggested `${presetLabel} (${personality})`. Collisions get
      // a Blender-style `.001` suffix so two motions never share an action
      // name — which would silently collide on the exported filename
      // (exporter.js:251-252 derives the .motion3.json name from
      // `sanitizeName(action.name)`; same-name actions would overwrite).
      const desiredName = (name.trim() || autoName);
      const existingNames = new Set((project.actions ?? []).map((a) => a.name));
      const finalName = uniqueName(desiredName, existingNames);
      const beforeIds = new Set((project.actions ?? []).map((a) => a.id));

      useProjectStore.getState().createAction(finalName);

      const projectAfter = useProjectStore.getState().project;
      const created = (projectAfter.actions ?? []).find((a) => !beforeIds.has(a.id));
      if (!created) throw new Error('createAction did not produce a new entry');

      // Patch fcurves + duration directly via produce-style update.
      useProjectStore.setState((s) => ({
        ...s,
        project: {
          ...s.project,
          actions: s.project.actions.map((a) =>
            a.id === created.id
              ? { ...a, fcurves, duration: durationSec * 1000, fps }
              : a
          ),
          // Don't bump hasUnsavedChanges separately — createAction
          // already did, and the patch is part of the same logical action.
        },
      }));

      // Switch to the new action + route to Animation workspace.
      // (BFA-001: editorMode is derived from activeWorkspace; setWorkspace
      // captures the rest pose on the staging→animation transition.)
      const finalAction = useProjectStore.getState().project.actions.find((a) => a.id === created.id);
      if (finalAction) useAnimationStore.getState().switchAction(finalAction);
      useUIV3Store.getState().setWorkspace('animation');

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
            adds it as a new action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 items-start gap-3">
            <Label htmlFor="idle-name" className="pt-2">Name</Label>
            <div className="col-span-2 grid gap-1">
              <Input
                id="idle-name"
                type="text"
                placeholder={autoName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
              <p className="text-xs text-muted-foreground font-mono truncate">
                → motion/{previewFilename}
              </p>
            </div>
          </div>

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
