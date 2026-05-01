/**
 * v3 Phase 1H — Canvas Properties popover (restored from upstream).
 *
 * Exposes width / height / X-Y offset / background-color controls on
 * `project.canvas`. Mirrors upstream's EditorLayout popover but uses
 * v3's projectStore (`updateCanvas` / `useProjectStore`).
 *
 * Trigger is caller-supplied: pass a single React element as
 * `children` and it becomes the PopoverTrigger (asChild). When no
 * children are given, we fall back to the standalone toolbar-style
 * icon button — that path is kept so existing callers keep working
 * but new callers (e.g. Topbar's bordered file strip) can hand in a
 * trigger styled to match their surrounding button group.
 *
 * The "Fit to minimum animation area" button is intentionally omitted
 * for this first restore — it depended on per-frame mesh-bbox math
 * tied to v2's animation tick (computeFitBounds in upstream
 * EditorLayout). Phase 5+ animation work can re-add it as an operator
 * once the Timeline editor has scrub-aware bbox computation.
 *
 * @module v3/shell/CanvasPropertiesPopover
 */

import {
  Popover, PopoverContent, PopoverTrigger,
} from '../../components/ui/popover.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Checkbox } from '../../components/ui/checkbox.jsx';
import { SquareChartGantt } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';

export function CanvasPropertiesPopover({ children }) {
  const canvas = useProjectStore((s) => s.project?.canvas ?? {});
  const updateCanvas = useProjectStore((s) => s.updateCanvas);

  const trigger = children ?? (
    <button
      type="button"
      title="Canvas Properties"
      className="h-7 px-2 inline-flex items-center text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-sm transition-colors"
    >
      <SquareChartGantt size={14} />
    </button>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-3 shadow-2xl border-border/60">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Canvas Properties
        </p>

        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Width"
            value={canvas.width ?? 800}
            min={1}
            onChange={(v) => updateCanvas({ width: Math.max(1, v) })}
          />
          <NumField
            label="Height"
            value={canvas.height ?? 600}
            min={1}
            onChange={(v) => updateCanvas({ height: Math.max(1, v) })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="X Offset"
            value={canvas.x ?? 0}
            onChange={(v) => updateCanvas({ x: v })}
          />
          <NumField
            label="Y Offset"
            value={canvas.y ?? 0}
            onChange={(v) => updateCanvas({ y: v })}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="canvas-bg-enable"
            checked={canvas.bgEnabled ?? false}
            onCheckedChange={(checked) => updateCanvas({ bgEnabled: !!checked })}
          />
          <Label htmlFor="canvas-bg-enable" className="text-xs cursor-pointer">
            Background Color
          </Label>
        </div>

        {canvas.bgEnabled ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={canvas.bgColor ?? '#ffffff'}
              className="h-7 w-8 rounded border border-input cursor-pointer p-0.5 bg-background"
              onChange={(e) => updateCanvas({ bgColor: e.target.value })}
            />
            <span className="text-xs text-muted-foreground font-mono">
              {canvas.bgColor ?? '#ffffff'}
            </span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function NumField({ label, value, min, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-7 text-xs"
        value={value}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
