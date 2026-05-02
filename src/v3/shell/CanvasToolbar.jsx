// @ts-check

/**
 * CanvasToolbar — vertical icon strip on the canvas left edge.
 *
 * Blender's T-panel pattern. Tools are mode-driven: the active edit
 * mode advertises a list of tools (`tools.js` declarative table); the
 * toolbar renders one icon button per entry. Two button kinds:
 *
 *   - `tool`     — sticky. Click sets `editorStore.toolMode` to the
 *                   advertised id. CanvasViewport's pointer dispatch
 *                   reads `toolMode` to decide what a click does.
 *
 *   - `operator` — momentary. Click fires the named operator from
 *                   the v3 registry. Active state never sticks; the
 *                   modal owns the gesture.
 *
 * Object-mode Move / Rotate / Scale are operator buttons today (they
 * fire `transform.translate` / `transform.rotate` / `transform.scale`,
 * matching G/R/S keybinds). Sticky transform tools would need their
 * own gizmo+drag wiring in CanvasViewport, which is deferred per
 * docs/TOOLBAR_PLAN.md.
 *
 * Mounts only on the edit Viewport tab — same gating as ModePill /
 * ViewLayersPopover. Live Preview is read-only.
 *
 * @module v3/shell/CanvasToolbar
 */

import { useEditorStore } from '../../store/editorStore.js';
import { getOperator } from '../operators/registry.js';
import { toolsFor } from './canvasToolbar/tools.js';

function ToolButton({ entry, active, onClick, disabled }) {
  const Icon = entry.icon;
  const tip = entry.hotkey
    ? `${entry.label} (${entry.hotkey})${entry.hint ? ' — ' + entry.hint : ''}`
    : entry.hint
      ? `${entry.label} — ${entry.hint}`
      : entry.label;
  return (
    <button
      type="button"
      title={tip}
      aria-label={entry.label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        'h-8 w-8 flex items-center justify-center rounded transition-colors ' +
        (disabled
          ? 'opacity-30 cursor-not-allowed text-foreground/40'
          : active
            ? 'bg-primary/20 text-primary ring-1 ring-primary/40 cursor-pointer'
            : 'text-foreground/70 hover:text-foreground hover:bg-muted/50 cursor-pointer')
      }
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function CanvasToolbar() {
  const editMode = useEditorStore((s) => s.editMode);
  const toolMode = useEditorStore((s) => s.toolMode);
  const setToolMode = useEditorStore((s) => s.setToolMode);

  const tools = toolsFor(editMode);
  if (!tools || tools.length === 0) return null;

  function activate(entry) {
    if (entry.kind === 'tool') {
      // Click-active again is a no-op in Blender. We emulate by writing
      // the same value (Zustand short-circuits identical updates).
      setToolMode(entry.toolModeId);
      return;
    }
    if (entry.kind === 'operator' && entry.operatorId) {
      const op = getOperator(entry.operatorId);
      if (!op) return;
      if (op.available && !op.available({ editorType: null })) return;
      try {
        op.exec({ editorType: null });
      } catch (err) {
        console.error(`[CanvasToolbar] operator ${entry.operatorId} failed`, err);
      }
    }
  }

  return (
    <div
      className="absolute top-12 left-2 z-10 flex flex-col items-center gap-0.5
                 px-1 py-1 rounded bg-card/85 backdrop-blur-md
                 border border-border/60 shadow-md"
      role="toolbar"
      aria-label="Canvas toolbar"
    >
      {tools.map((entry) => {
        const active = entry.kind === 'tool' && entry.toolModeId === toolMode;
        // Disable operator buttons whose operator isn't available
        // (e.g. transform.translate when nothing is selected). Tool
        // buttons are always clickable.
        let disabled = false;
        if (entry.kind === 'operator' && entry.operatorId) {
          const op = getOperator(entry.operatorId);
          if (op?.available && !op.available({ editorType: null })) {
            disabled = true;
          }
        }
        return (
          <div key={entry.id} className="flex flex-col items-center gap-0.5">
            {entry.divider ? (
              <div className="h-px w-5 bg-border/50 my-1" />
            ) : null}
            <ToolButton
              entry={entry}
              active={active}
              disabled={disabled}
              onClick={() => activate(entry)}
            />
          </div>
        );
      })}
    </div>
  );
}
