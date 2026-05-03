// @ts-nocheck

/**
 * v3 GAP-016 Phase A — View Layers picker.
 *
 * @ts-nocheck because the underlying shadcn/Radix forwardRef components
 * (Checkbox, Button, PopoverContent) ship without JSDoc props types, so
 * tsc reports false-positive "Property 'checked' does not exist" errors
 * on every prop. Runtime is fine; the popover is small enough that the
 * type loss is acceptable here. Other shell files use the same escape.
 *
 * Single popover surface for every overlay/visualization toggle that
 * previously lived in scattered headers, store flags, and the deleted
 * CoordSpaceOverlay. Compact checkbox list grouped by Mesh / Rig /
 * Edit, with quick-toggle preset buttons at the bottom.
 *
 * State source of truth: `editorStore.viewLayers` map for visualization
 * + `editorStore.editMode` for the contextual edit slot. Workspace
 * policy dims/disables rows the active workspace forbids (e.g.
 * wireframe in Layout/Animation/Pose, skeleton edit outside Rigging)
 * without mutating stored values, so flipping back to a permissive
 * workspace restores the user's setup.
 *
 * Phase B (future, deferred): named user presets, per-area scoping.
 *
 * @module v3/shell/ViewLayersPopover
 */

import { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Checkbox } from '../../components/ui/checkbox.jsx';
import { Slider } from '../../components/ui/slider.jsx';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';

/**
 * @param {Object} props
 * @param {string} props.label
 * @param {boolean} props.checked
 * @param {(next:boolean)=>void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.hint]
 */
function LayerRow({ label, checked, onChange, disabled, hint }) {
  return (
    <label
      className={
        'flex items-center gap-2 text-[11px] py-0.5 cursor-pointer select-none ' +
        (disabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-foreground')
      }
      title={hint}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => !disabled && onChange(!!v)}
      />
      <span className="flex-1">{label}</span>
    </label>
  );
}

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {React.ReactNode} props.children
 */
function Section({ title, children }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ViewLayersPopover() {
  const viewLayers = useEditorStore((s) => s.viewLayers);
  const setViewLayers = useEditorStore((s) => s.setViewLayers);

  // Phase B — named user presets (persisted to localStorage).
  const userPresets = usePreferencesStore((s) => s.viewLayerPresets);
  const setUserPreset = usePreferencesStore((s) => s.setViewLayerPreset);
  const deleteUserPreset = usePreferencesStore((s) => s.deleteViewLayerPreset);
  const [presetDraftName, setPresetDraftName] = useState('');

  const userPresetNames = Object.keys(userPresets).sort();

  function saveCurrentAs(name) {
    setUserPreset(name, viewLayers);
    setPresetDraftName('');
  }

  function applyUserPreset(name) {
    const layers = userPresets[name];
    if (!layers) return;
    setViewLayers(layers);
  }

  /** Standard view: image + edge outline + skeleton (no diagnostic chrome). */
  function presetClean() {
    setViewLayers({
      image: true,
      wireframe: false,
      vertices: false,
      edgeOutline: true,
      skeleton: true,
      irisClipping: true,
      warpGrids: false,
      rotationPivots: false,
    });
  }

  /** Modeling preset: wireframe + vertices + edge outline; no skeleton. */
  function presetModeling() {
    setViewLayers({
      image: true,
      wireframe: true,
      vertices: true,
      edgeOutline: true,
      skeleton: false,
      irisClipping: true,
      warpGrids: false,
      rotationPivots: false,
    });
  }

  /** Rig diagnostics preset: warp grids + rotation pivots + skeleton. */
  function presetDiagnostics() {
    setViewLayers({
      ...viewLayers,
      wireframe: false,
      vertices: false,
      edgeOutline: true,
      skeleton: true,
      warpGrids: true,
      rotationPivots: true,
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="absolute top-2 right-32 z-10 h-8 px-3 gap-1.5
                     bg-card/85 backdrop-blur-md
                     border border-border/60 hover:border-primary/40
                     text-foreground/80 hover:text-foreground hover:bg-card/95
                     shadow-md hover:shadow-lg hover:shadow-primary/10
                     transition-all duration-150
                     font-medium"
          title="View layers"
        >
          <Layers className="h-3.5 w-3.5" />
          <span className="text-[11px] tracking-wide">Layers</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-60 p-3 space-y-3">
        <Section title="Mesh">
          <LayerRow
            label="Image"
            checked={viewLayers.image}
            onChange={(v) => setViewLayers({ image: v })}
          />
          <LayerRow
            label="Wireframe"
            checked={!!viewLayers.wireframe}
            hint="Show triangulation lines on every mesh. In Edit Mode the active part's wireframe is always on regardless."
            onChange={(v) => setViewLayers({ wireframe: v })}
          />
          <LayerRow
            label="Vertices"
            checked={!!viewLayers.vertices}
            hint="Show vertex points on every mesh. In Edit Mode the active part's vertices are always on."
            onChange={(v) => setViewLayers({ vertices: v })}
          />
          <LayerRow
            label="Edge outline"
            checked={viewLayers.edgeOutline}
            onChange={(v) => setViewLayers({ edgeOutline: v })}
          />
        </Section>

        <Section title="Rig">
          <LayerRow
            label="Skeleton"
            checked={viewLayers.skeleton}
            onChange={(v) => setViewLayers({ skeleton: v })}
          />
          <LayerRow
            label="Iris clipping"
            checked={viewLayers.irisClipping}
            onChange={(v) => setViewLayers({ irisClipping: v })}
          />
          <LayerRow
            label="Warp grids"
            checked={viewLayers.warpGrids}
            onChange={(v) => setViewLayers({ warpGrids: v })}
          />
          {viewLayers.warpGrids && (
            <div className="pl-6 pr-1 pt-0.5 pb-1 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/80 w-12 shrink-0">Opacity</span>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[viewLayers.warpGridsOpacity ?? 0.5]}
                onValueChange={(v) => setViewLayers({ warpGridsOpacity: v[0] })}
                className="flex-1"
              />
              <span className="text-[10px] text-muted-foreground/80 w-7 text-right tabular-nums">
                {Math.round((viewLayers.warpGridsOpacity ?? 0.5) * 100)}%
              </span>
            </div>
          )}
          <LayerRow
            label="Rotation pivots"
            checked={viewLayers.rotationPivots}
            onChange={(v) => setViewLayers({ rotationPivots: v })}
          />
        </Section>

        {/* Edit Mode controls live in the canvas-overlay Mode pill (top-left)
            — Layers is now pure visualization. Lock Object Modes
            preference moved with the Mode pill since it's a behaviour
            preference, not a display toggle. */}

        <div className="pt-2 border-t border-border/50 flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Built-in</div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={presetClean}
              className="text-[10px] px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              Clean
            </button>
            <button
              type="button"
              onClick={presetModeling}
              className="text-[10px] px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              Modeling
            </button>
            <button
              type="button"
              onClick={presetDiagnostics}
              className="text-[10px] px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              Diagnostics
            </button>
          </div>

          {/* GAP-016 Phase B — user-saved presets. Persisted to
              localStorage via preferencesStore. Click name to apply,
              X to delete. Save form below. */}
          {userPresetNames.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-1">My presets</div>
              <div className="flex flex-wrap gap-1">
                {userPresetNames.map((name) => (
                  <span key={name} className="inline-flex items-center gap-0.5 rounded bg-muted/40 hover:bg-muted/70 transition-colors">
                    <button
                      type="button"
                      onClick={() => applyUserPreset(name)}
                      className="text-[10px] px-2 py-0.5"
                      title="Apply preset"
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUserPreset(name)}
                      className="px-1 py-0.5 hover:text-destructive transition-colors"
                      title="Delete preset"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}

          <form
            className="flex items-center gap-1 mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (presetDraftName.trim()) saveCurrentAs(presetDraftName);
            }}
          >
            <input
              type="text"
              value={presetDraftName}
              onChange={(e) => setPresetDraftName(e.target.value)}
              placeholder="Save as…"
              className="flex-1 text-[10px] px-2 py-0.5 rounded bg-muted/30 border border-border/50 focus:border-primary/50 outline-none"
              maxLength={40}
            />
            <button
              type="submit"
              disabled={!presetDraftName.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-primary/15 hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}
