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

import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore.js';

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
        <ContentForMode editMode={editMode} />
      </div>
    </div>
  );
}
