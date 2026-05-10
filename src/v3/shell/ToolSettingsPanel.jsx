// @ts-nocheck

/**
 * BVR-007 — N-panel (Blender's right-edge tool / item settings panel).
 *
 * Sits on the canvas's right edge. Mode-driven content:
 *   - mesh / blendShape / weightPaint → brush settings (size, hardness)
 *   - skeleton                        → Pose Mode hint (no settings yet)
 *   - object mode / null              → empty state
 *
 * Companion to the left-edge `CanvasToolbar` (T-panel = tool **picker**).
 * This is the N-panel = tool **settings**. Keeps the canvas chrome
 * Blender-shaped and gives mode-specific knobs a dedicated home,
 * rather than dropping them into ModePill popovers / floating overlays.
 *
 * Visibility tracks `editorStore.toolPanelVisible`. Toggleable via the
 * `panel.toolSettingsToggle` operator (N keybind). Mounts only on the
 * edit Viewport tab — Live Preview is read-only.
 *
 * @module v3/shell/ToolSettingsPanel
 */

import { ChevronRight, ChevronLeft, Magnet } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { SCULPT_BRUSHES } from '../../lib/sculpt/index.js';
import { FALLOFF_CYCLE } from '../../lib/proportionalEdit.js';

/** Section header — same band style as Properties SectionShell. */
function SectionHeader({ label }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide font-medium text-foreground bg-muted/50 select-none">
      <span>{label}</span>
    </div>
  );
}

function NumberSlider({ label, value, min, max, step, onChange, unit }) {
  return (
    <label className="flex items-center gap-2 text-[11px] py-1">
      <span className="w-20 text-muted-foreground select-none">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5"
      />
      <span className="w-12 text-right tabular-nums text-foreground/85">
        {value.toFixed(step && step < 1 ? 2 : 0)}{unit ?? ''}
      </span>
    </label>
  );
}

function BrushSection() {
  const brushSize     = useEditorStore((s) => s.brushSize);
  const brushHardness = useEditorStore((s) => s.brushHardness);
  const setBrush      = useEditorStore((s) => s.setBrush);
  return (
    <div>
      <SectionHeader label="Brush" />
      <div className="px-2 py-2 flex flex-col gap-1">
        <NumberSlider
          label="Size"
          value={brushSize}
          min={5}
          max={300}
          step={1}
          unit="px"
          onChange={(v) => setBrush({ brushSize: v })}
        />
        <NumberSlider
          label="Hardness"
          value={brushHardness}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setBrush({ brushHardness: v })}
        />
      </div>
    </div>
  );
}

function ModeHint({ title, body }) {
  return (
    <div>
      <SectionHeader label="Mode" />
      <div className="px-2 py-2 text-[11px]">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground/85 leading-snug mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function ContentForMode({ editMode }) {
  if (editMode === 'edit' || editMode === 'weightPaint') {
    return <BrushSection />;
  }
  if (editMode === 'sculpt') {
    return <SculptSection />;
  }
  if (editMode === 'pose') {
    return (
      <ModeHint
        title="Pose Mode"
        body="Drag joints / rotation handles to pose bones. G / R / S also edit pose. Apply Pose As Rest bakes the current pose into rest."
      />
    );
  }
  return (
    <div className="px-2 py-3 text-[11px] text-muted-foreground/80 leading-snug">
      Tool settings appear here when an edit mode is active. Press Tab on a
      meshed part or bone-role group to enter one.
    </div>
  );
}

/** Toolset Plan Phase 3.F — Sculpt Mode brush settings.
 *
 *  Brush picker mirrors the T-panel toolbar (clicking either updates
 *  `sculpt.activeBrush`). Size / Strength / Falloff are shared across
 *  all three brushes; Iterations is Smooth-only and hides for the
 *  others. Connected-only toggles BFS-restricted radius (Blender's
 *  "Use Connected Only" sculpt option). */
function SculptSection() {
  const sculpt = useEditorStore((s) => s.sculpt);
  const setSculpt = useEditorStore((s) => s.setSculpt);
  const activeBrush = sculpt?.activeBrush ?? 'grab';
  const isSmooth = activeBrush === 'smooth';
  return (
    <div>
      <SectionHeader label="Sculpt" />
      <div className="px-2 py-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-20 text-muted-foreground select-none">Brush</span>
          <select
            value={activeBrush}
            onChange={(e) => setSculpt({ activeBrush: e.target.value })}
            className="flex-1 h-6 bg-background border border-border rounded px-1 text-[11px]"
          >
            {SCULPT_BRUSHES.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </label>
        <NumberSlider
          label="Size"
          value={sculpt?.size ?? 80}
          min={5}
          max={300}
          step={1}
          unit="px"
          onChange={(v) => setSculpt({ size: v })}
        />
        <NumberSlider
          label="Strength"
          value={sculpt?.strength ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setSculpt({ strength: v })}
        />
        <label className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-20 text-muted-foreground select-none">Falloff</span>
          <select
            value={sculpt?.falloff ?? 'smooth'}
            onChange={(e) => setSculpt({ falloff: e.target.value })}
            className="flex-1 h-6 bg-background border border-border rounded px-1 text-[11px]"
          >
            {FALLOFF_CYCLE.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        {isSmooth && (
          <NumberSlider
            label="Iterations"
            value={sculpt?.iterations ?? 1}
            min={1}
            max={10}
            step={1}
            onChange={(v) => setSculpt({ iterations: v })}
          />
        )}
        <label className="flex items-center gap-2 text-[11px] py-0.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!sculpt?.connectedOnly}
            onChange={(e) => setSculpt({ connectedOnly: e.target.checked })}
            className="h-3 w-3"
          />
          <span className="text-foreground/85">Connected only</span>
        </label>
      </div>
    </div>
  );
}

/** Toolset Plan Phase 2.E — Snap section. Visible in all modes since
 *  modal G/R/S is reachable from Object Mode + every Edit Mode (Blender
 *  parity). Master toggle + per-mode toggles + value inputs + target
 *  dropdown. Each control writes through `setSnap` (deep-merge). */
function SnapSection() {
  const snap = usePreferencesStore((s) => s.snap);
  const setSnap = usePreferencesStore((s) => s.setSnap);
  const masterOn = !!snap?.enabled;
  return (
    <div>
      <SectionHeader label="Snap" />
      <div className="px-2 py-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[11px] py-0.5 cursor-pointer">
          <input
            type="checkbox"
            checked={masterOn}
            onChange={(e) => setSnap({ enabled: e.target.checked })}
            className="h-3 w-3"
          />
          <Magnet className="h-3 w-3 text-foreground/70" />
          <span className="font-medium text-foreground">Snap During Transform</span>
        </label>

        <div className={`flex flex-col gap-1.5 mt-1 ${masterOn ? '' : 'opacity-60'}`}>
          {/* Vertex snap (auto-engages during Modal G when master on). */}
          <SnapModeRow
            label="Vertex"
            mode="vertex"
            valueKey="threshold"
            valueLabel="px"
            min={1}
            max={64}
            step={1}
            snap={snap}
            setSnap={setSnap}
          />
          {/* Grid snap (engages on Shift during Modal G). */}
          <SnapModeRow
            label="Grid"
            mode="grid"
            valueKey="increment"
            valueLabel="px"
            min={1}
            max={256}
            step={1}
            snap={snap}
            setSnap={setSnap}
          />
          {/* Increment snap drives Modal R (degrees) AND Modal S
              (value/100 = scale step). Audit fix G-8: surface BOTH
              bindings in the same row so editing "5°" also visibly sets
              "0.05× scale step". */}
          <SnapIncrementRow snap={snap} setSnap={setSnap} />

          <label className="flex items-center gap-2 text-[11px] py-0.5">
            <span className="w-20 text-muted-foreground select-none">Target</span>
            <select
              value={snap?.target ?? 'closest'}
              onChange={(e) => setSnap({ target: e.target.value })}
              className="flex-1 h-6 bg-background border border-border rounded px-1 text-[11px]"
            >
              <option value="closest">Closest</option>
              <option value="center">Center</option>
              <option value="median">Median</option>
              <option value="active">Active</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

/** Audit fix G-8 — Increment row surfaces BOTH the rotation step (in
 *  degrees) and the derived scale step (`value/100 ×`) so editing the
 *  value doesn't silently change scale behaviour. */
function SnapIncrementRow({ snap, setSnap }) {
  const cfg = snap?.modes?.increment ?? {};
  const enabled = !!cfg.enabled;
  const value = cfg.value ?? 5;
  const scaleStep = (value / 100).toFixed(2);
  return (
    <div className="flex items-center gap-2 text-[11px] py-0.5">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setSnap({ modes: { increment: { enabled: e.target.checked } } })}
        className="h-3 w-3"
      />
      <span className="w-16 text-muted-foreground select-none">Increment</span>
      <input
        type="number"
        min={1}
        max={90}
        step={1}
        value={value}
        disabled={!enabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          setSnap({ modes: { increment: { value: n } } });
        }}
        className="w-14 h-6 bg-background border border-border rounded px-1 text-[11px] tabular-nums"
      />
      <span className="text-muted-foreground/70">°R · ×{scaleStep}S</span>
    </div>
  );
}

/** Per-mode snap row — checkbox + numeric value. The mode key is the
 *  child of `snap.modes`; valueKey selects which numeric prop to edit
 *  (`threshold` for vertex, `increment` for grid, `value` for
 *  increment). */
function SnapModeRow({ label, mode, valueKey, valueLabel, min, max, step, snap, setSnap }) {
  const cfg = snap?.modes?.[mode] ?? {};
  const enabled = !!cfg.enabled;
  const value = cfg[valueKey] ?? min;
  return (
    <div className="flex items-center gap-2 text-[11px] py-0.5">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setSnap({ modes: { [mode]: { enabled: e.target.checked } } })}
        className="h-3 w-3"
      />
      <span className="w-16 text-muted-foreground select-none">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          setSnap({ modes: { [mode]: { [valueKey]: n } } });
        }}
        className="w-14 h-6 bg-background border border-border rounded px-1 text-[11px] tabular-nums"
      />
      <span className="text-muted-foreground/70">{valueLabel}</span>
    </div>
  );
}

export function ToolSettingsPanel() {
  const visible  = useEditorStore((s) => s.toolPanelVisible);
  const editMode = useEditorStore((s) => s.editMode);
  const toggle   = useEditorStore((s) => s.toggleToolPanel);

  // Collapsed: vertically-centered chevron on the right edge — matches
  // Blender's N-panel toggle position. Clear of the Reset Pose / View
  // Layers cluster at top-2 right-2.
  if (!visible) {
    return (
      <button
        type="button"
        onClick={toggle}
        title="Show tool settings (N)"
        className="absolute top-1/2 right-2 -translate-y-1/2 z-10 h-7 w-7 flex items-center justify-center rounded
                   bg-card/85 backdrop-blur-md border border-border/60
                   text-foreground/70 hover:text-foreground hover:border-primary/40
                   shadow-md transition-all duration-150"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
    );
  }

  // Expanded: still starts below the Reset Pose row, full panel down to
  // the canvas bottom.
  return (
    <div
      className="absolute top-12 right-2 bottom-2 z-10 w-56 flex flex-col
                 bg-card/85 backdrop-blur-md border border-border/60
                 rounded shadow-md text-xs"
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/40 select-none">
        <span className="text-[10px] uppercase tracking-wide font-medium text-foreground">
          Tool Settings
        </span>
        <button
          type="button"
          onClick={toggle}
          title="Hide tool settings (N)"
          className="h-5 w-5 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        <SnapSection />
        <ContentForMode editMode={editMode} />
      </div>
    </div>
  );
}
