// @ts-nocheck

/**
 * ModePill — canvas top-left overlay surfacing the contextual edit
 * mode. Blender's pattern: Object Mode / Edit Mode / Skeleton Edit /
 * Blend Shape Paint as a dropdown rooted at the active selection.
 *
 * The pill is the discoverable affordance for edit modes — Tab still
 * works as a keybind, but the user shouldn't have to know that to
 * find the feature. Mounts only on the edit Viewport tab (not Live
 * Preview — modes are meaningless there).
 *
 * Selection drives which rows are enabled:
 *   - Object Mode      — always available
 *   - Edit Mode (mesh) — meshed part selected
 *   - Skeleton Edit    — bone-role group selected
 *   - Blend Shape Paint — meshed part with blendShapes (sub-list of
 *                          shapes; each one enters editMode='blendShape'
 *                          with that shape as activeBlendShapeId)
 *
 * Lock Object Modes preference (Blender's option, default ON) lives
 * here in the dropdown footer — contextually next to mode controls,
 * not in the visualization-only Layers popover.
 *
 * @module v3/shell/ModePill
 */

import { ChevronDown, Box, Pencil, Bone, Sparkles, Circle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Checkbox } from '../../components/ui/checkbox.jsx';
import { useEditorStore } from '../../store/editorStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';

/** Resolve the active selection's project node + the modes it supports. */
function describeSelection() {
  const active = useSelectionStore.getState().getActive();
  if (!active) return { active: null, node: null, kind: 'none' };
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n.id === active.id) ?? null;
  if (!node) return { active, node: null, kind: 'unknown' };
  if (active.type === 'part' && node.mesh) return { active, node, kind: 'meshedPart' };
  if (active.type === 'group' && node.boneRole) return { active, node, kind: 'boneGroup' };
  return { active, node, kind: 'other' };
}

const MODE_META = {
  null:        { label: 'Object Mode',  icon: Box },
  mesh:        { label: 'Edit Mode',    icon: Pencil },
  skeleton:    { label: 'Skeleton',     icon: Bone },
  blendShape:  { label: 'Blend Shape',  icon: Sparkles },
};

function ModeRow({ icon: Icon, label, checked, onSelect, disabled, hint }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onSelect && onSelect()}
      className={
        'flex items-center gap-2 text-[11px] py-1 px-1 w-full text-left select-none rounded ' +
        (disabled
          ? 'opacity-40 cursor-not-allowed'
          : checked
            ? 'bg-primary/15 text-foreground cursor-pointer'
            : 'hover:bg-muted/40 text-foreground/85 hover:text-foreground cursor-pointer')
      }
      title={hint}
    >
      <span className="w-3 flex justify-center">
        {checked ? <span className="block w-1.5 h-1.5 rounded-full bg-primary" /> : null}
      </span>
      <Icon className="h-3 w-3 opacity-70" />
      <span className="flex-1">{label}</span>
    </button>
  );
}

export function ModePill() {
  const editMode = useEditorStore((s) => s.editMode);
  const activeBlendShapeId = useEditorStore((s) => s.activeBlendShapeId);
  const enterEditMode = useEditorStore((s) => s.enterEditMode);
  const exitEditMode = useEditorStore((s) => s.exitEditMode);
  const setSelection = useEditorStore((s) => s.setSelection);
  const viewLayers = useEditorStore((s) => s.viewLayers);
  const setViewLayers = useEditorStore((s) => s.setViewLayers);

  const lockObjectModes = usePreferencesStore((s) => s.lockObjectModes);
  const setLockObjectModes = usePreferencesStore((s) => s.setLockObjectModes);

  // Subscribe to selectionStore so the dropdown re-renders when the
  // user picks a different node.
  useSelectionStore((s) => s.items);

  const { active, node, kind } = describeSelection();

  const meta = MODE_META[editMode ?? 'null'] ?? MODE_META.null;
  const PillIcon = meta.icon;

  // Mode label gets a "(shape name)" suffix when in blend-shape edit
  // so the user always knows which shape they're painting.
  let pillLabel = meta.label;
  if (editMode === 'blendShape' && activeBlendShapeId && node?.blendShapes) {
    const shape = node.blendShapes.find((s) => s.id === activeBlendShapeId);
    if (shape) pillLabel = `Blend Shape: ${shape.name}`;
  }

  function enterMesh() {
    if (!active) return;
    setSelection([active.id]);
    enterEditMode('mesh');
  }
  function enterSkeleton() {
    if (!viewLayers.skeleton) setViewLayers({ skeleton: true });
    enterEditMode('skeleton');
  }
  function enterBlendShape(shapeId) {
    if (!active) return;
    setSelection([active.id]);
    enterEditMode('blendShape', { blendShapeId: shapeId });
  }

  const blendShapes = (kind === 'meshedPart' && Array.isArray(node?.blendShapes))
    ? node.blendShapes
    : [];

  // PP1-008(c) — proportional-edit toggle moves out of the left T-panel
  // toolbar (which was confusing since it implied a "brush option") and
  // sits to the right of the ModePill, mirroring Blender's header layout
  // where the proportional-edit button is a sibling of the mode picker.
  const peEnabled = usePreferencesStore((s) => s.proportionalEdit?.enabled ?? false);
  const setProportionalEdit = usePreferencesStore((s) => s.setProportionalEdit);
  const showProportionalToggle = editMode === 'mesh';

  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-3 gap-1.5
                     bg-card/85 backdrop-blur-md
                     border border-border/60 hover:border-primary/40
                     text-foreground/80 hover:text-foreground hover:bg-card/95
                     shadow-md hover:shadow-lg hover:shadow-primary/10
                     transition-all duration-150 font-medium"
          title="Edit mode (Tab)"
        >
          <PillIcon className="h-3.5 w-3.5" />
          <span className="text-[11px] tracking-wide">{pillLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-60 p-2 space-y-0.5">
        {/* PP1-006 — disabled rows had only a `title` tooltip; that's
            invisible until you hover-and-wait, so first-time users hit
            the "modes are greyed out, must be broken" cliff. Surface an
            always-visible hint at the top whenever the active selection
            doesn't qualify for any edit mode. */}
        {kind !== 'meshedPart' && kind !== 'boneGroup' && (
          <div
            className="text-[10px] text-muted-foreground/85 italic
                       bg-muted/30 border border-border/50 rounded
                       px-2 py-1.5 mb-1 leading-snug"
          >
            Select a meshed part to enter Edit Mode, or a bone group for Skeleton Edit.
          </div>
        )}
        <ModeRow
          icon={Box}
          label="Object Mode"
          checked={!editMode}
          onSelect={exitEditMode}
          hint="Select and arrange whole pieces"
        />
        <ModeRow
          icon={Pencil}
          label="Edit Mode"
          checked={editMode === 'mesh'}
          disabled={kind !== 'meshedPart'}
          hint={
            kind === 'meshedPart'
              ? 'Edit vertex positions / UVs of the selected part'
              : 'Select a meshed part to enter Edit Mode'
          }
          onSelect={enterMesh}
        />
        <ModeRow
          icon={Bone}
          label="Skeleton Edit"
          checked={editMode === 'skeleton'}
          disabled={kind !== 'boneGroup'}
          hint={
            kind === 'boneGroup'
              ? 'Drag bone joints to reposition pivots'
              : 'Select a bone-role group to enter Skeleton Edit'
          }
          onSelect={enterSkeleton}
        />

        {blendShapes.length > 0 && (
          <div className="pt-1 mt-1 border-t border-border/40">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 px-1 mb-0.5">
              Blend Shape Paint
            </div>
            {blendShapes.map((shape) => (
              <ModeRow
                key={shape.id}
                icon={Sparkles}
                label={shape.name}
                checked={editMode === 'blendShape' && activeBlendShapeId === shape.id}
                onSelect={() => enterBlendShape(shape.id)}
                hint={`Paint deltas onto ${shape.name}`}
              />
            ))}
          </div>
        )}

        <div className="pt-2 mt-1 border-t border-border/40 px-1">
          <label className="flex items-center gap-2 text-[11px] py-0.5 cursor-pointer select-none hover:text-foreground"
            title="Blender behaviour: while in edit mode, clicks on other pieces are ignored. Tab out first to switch.">
            <Checkbox
              checked={lockObjectModes}
              onCheckedChange={(v) => setLockObjectModes(!!v)}
            />
            <span className="flex-1">Lock object modes</span>
          </label>
        </div>
      </PopoverContent>
    </Popover>
      {showProportionalToggle && (
        <button
          type="button"
          aria-pressed={peEnabled}
          onClick={() => setProportionalEdit({ enabled: !peEnabled })}
          title="Proportional Edit (O) — drag pulls neighbours along. Shift+O cycles falloff, Alt+O toggles connected-only, F enters radius-adjust mode (scroll OR move cursor to size, click to commit)."
          className={
            'h-8 w-8 flex items-center justify-center rounded-md ' +
            'bg-card/85 backdrop-blur-md border shadow-md transition-all duration-150 ' +
            (peEnabled
              ? 'border-primary/50 text-primary hover:border-primary/70 hover:bg-card/95'
              : 'border-border/60 text-foreground/70 hover:text-foreground hover:border-primary/40 hover:bg-card/95')
          }
        >
          <Circle className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
