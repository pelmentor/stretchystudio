// @ts-nocheck

/**
 * ModePill — canvas top-left overlay surfacing the contextual edit
 * mode. Blender's pattern: Object Mode / Edit Mode / Pose Mode /
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
 *   - Pose Mode        — bone-role group selected (was "Skeleton Edit"
 *                        pre-2026-05-06; renamed to match Blender's
 *                        OB_MODE_POSE in `DNA_object_enums.h`)
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

import { ChevronDown, Box, Pencil, Bone, Sparkles, Circle, Brush, Hand } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Checkbox } from '../../components/ui/checkbox.jsx';
import { useEditorStore } from '../../store/editorStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useUIV3Store, selectEditorMode } from '../../store/uiV3Store.js';
import {
  getMesh,
  isMeshedPart,
  isBoneGroup,
  getDataKind,
} from '../../store/objectDataAccess.js';
import {
  modeCompatTest,
  MODE_EDIT,
  MODE_POSE,
  MODE_WEIGHT_PAINT,
  MODE_BLEND_SHAPE,
  MODE_SCULPT,
} from '../../modes/modeCompat.js';

/** Resolve the active selection's project node + the modes it supports. */
function describeSelection() {
  const active = useSelectionStore.getState().getActive();
  if (!active) return { active: null, node: null, kind: 'none', dataKind: null, hasWeights: false };
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n.id === active.id) ?? null;
  if (!node) return { active, node: null, kind: 'unknown', dataKind: null, hasWeights: false };
  // V4 Phase 4b — meshed parts with bone-binding data (legacy
  // `boneWeights` / `jointBoneId` from auto-rig OR modern `weightGroups`)
  // qualify for Weight Paint. Surface as a separate flag so the
  // dropdown can enable Edit Mode AND Weight Paint independently.
  const mesh = getMesh(node, project);
  const hasWeights = !!(
    mesh && (
      mesh.boneWeights
      || mesh.jointBoneId
      || (mesh.weightGroups && Object.keys(mesh.weightGroups).length > 0)
    )
  );
  // Phase 2 — `dataKind` is the canonical Blender-shape classifier;
  // `kind` is the legacy SS string kept for narrower copy switches
  // (e.g. distinguishing "meshed yet?" from "is part?"). Both stay
  // through the migration; `dataKind` drives modeCompatTest, `kind`
  // drives ModePill's hint copy.
  const dataKind = getDataKind(node, project);
  if (isMeshedPart(node, project)) return { active, node, kind: 'meshedPart', dataKind, hasWeights };
  if (isBoneGroup(node))           return { active, node, kind: 'boneGroup', dataKind, hasWeights: false };
  return { active, node, kind: 'other', dataKind, hasWeights: false };
}

const MODE_META = {
  null:         { label: 'Object Mode',    icon: Box },
  edit:         { label: 'Edit Mode',      icon: Pencil },
  pose:         { label: 'Pose Mode',      icon: Bone },
  weightPaint:  { label: 'Weight Paint',   icon: Brush },
  sculpt:       { label: 'Sculpt Mode',    icon: Hand },
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
  const setActiveBlendShape = useEditorStore((s) => s.setActiveBlendShape);
  const enterEditMode = useEditorStore((s) => s.enterEditMode);
  const exitEditMode = useEditorStore((s) => s.exitEditMode);
  const setSelection = useEditorStore((s) => s.setSelection);
  const viewLayers = useEditorStore((s) => s.viewLayers);
  const setViewLayers = useEditorStore((s) => s.setViewLayers);

  const lockObjectModes = usePreferencesStore((s) => s.lockObjectModes);
  const setLockObjectModes = usePreferencesStore((s) => s.setLockObjectModes);

  // Toolset Phase 3 audit-fix G-2: Sculpt mutates the rest mesh; in
  // Animation editor mode that mutation would corrupt rest pose
  // permanently (no draftPose route — sculpt is a rest-mesh operation,
  // not a per-keyframe deformation). Disable the row with a clear hint.
  const editorMode = useUIV3Store(selectEditorMode);
  const sculptBlockedByAnimMode = editorMode === 'animation';

  // Controlled open so Ctrl+Tab (the `mode.menu` operator) can pop the
  // menu without a click — Blender's `view3d.object_mode_pie_or_toggle`
  // analog. A click on the trigger still toggles via onOpenChange.
  const modeMenuOpen = useUIV3Store((s) => s.modeMenuOpen);
  const setModeMenuOpen = useUIV3Store((s) => s.setModeMenuOpen);

  // Subscribe to selectionStore so the dropdown re-renders when the
  // user picks a different node.
  useSelectionStore((s) => s.items);

  const { active, node, kind, dataKind, hasWeights } = describeSelection();
  const ensureWeightGroupsForPart = useProjectStore((s) => s.ensureWeightGroupsForPart);

  const meta = MODE_META[editMode ?? 'null'] ?? MODE_META.null;
  const PillIcon = meta.icon;

  // Mode label gets a "(Shape: name)" suffix when in Edit Mode with
  // an active blend shape so the user always knows which shape they're
  // painting. Folded 2026-05-07 — Blender's pattern: shape-key paint
  // lives inside Edit Mode, not as a peer mode.
  let pillLabel = meta.label;
  if (editMode === 'edit' && activeBlendShapeId && node?.blendShapes) {
    const shape = node.blendShapes.find((s) => s.id === activeBlendShapeId);
    if (shape) pillLabel = `Edit Mode (Shape: ${shape.name})`;
  }

  function enterEdit() {
    if (!active) return;
    setSelection([active.id]);
    // For armature dataKind, Edit Mode wants the skeleton overlay visible
    // so joint drag targets render.
    if (kind === 'boneGroup' && !viewLayers.skeleton) setViewLayers({ skeleton: true });
    enterEditMode(MODE_EDIT);
  }
  function enterSkeleton() {
    if (!viewLayers.skeleton) setViewLayers({ skeleton: true });
    enterEditMode(MODE_POSE);
  }
  function enterBlendShape(shapeId) {
    if (!active) return;
    setSelection([active.id]);
    enterEditMode('blendShape', { blendShapeId: shapeId });
  }
  function enterWeightPaint() {
    if (!active) return;
    setSelection([active.id]);
    // Lazy-migrate legacy boneWeights → modern weightGroups so the
    // brush has somewhere to write into.
    ensureWeightGroupsForPart(active.id);
    enterEditMode('weightPaint');
  }
  function enterSculpt() {
    if (!active) return;
    setSelection([active.id]);
    enterEditMode('sculpt');
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
  const showProportionalToggle = editMode === MODE_EDIT;

  // Picking a mode closes the menu (matches a Blender mode-pie pick;
  // important now that Ctrl+Tab opens it via keyboard). The lock-modes
  // toggle is a setting and intentionally keeps the menu open.
  const pick = (fn) => () => { fn(); setModeMenuOpen(false); };

  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
    <Popover open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
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
            Select a meshed part to enter Edit Mode, or a bone group for Pose Mode.
          </div>
        )}
        <ModeRow
          icon={Box}
          label="Object Mode"
          checked={!editMode}
          onSelect={pick(exitEditMode)}
          hint="Select and arrange whole pieces"
        />
        <ModeRow
          icon={Pencil}
          label="Edit Mode"
          checked={editMode === MODE_EDIT}
          disabled={!modeCompatTest(dataKind, MODE_EDIT)}
          hint={
            kind === 'meshedPart'
              ? 'Edit vertex positions / UVs of the selected part'
              : kind === 'boneGroup'
                // Blender's universal OB_MODE_EDIT — for armatures it
                // edits the bone REST pivots (writes node.transform.pivotX/Y).
                // Pose Mode (separate slot) is for animation overlay.
                ? 'Edit bone REST pivots — drag writes node.transform.pivotX/Y'
                : 'Select a meshed part or bone-role group to enter Edit Mode'
          }
          onSelect={pick(enterEdit)}
        />
        <ModeRow
          icon={Bone}
          label="Pose Mode"
          checked={editMode === MODE_POSE}
          disabled={!modeCompatTest(dataKind, MODE_POSE)}
          hint={
            kind === 'boneGroup'
              ? 'Pose bones — drag joints / rotate. Writes to node.pose.*. Apply Pose As Rest available.'
              : 'Select a bone-role group to enter Pose Mode'
          }
          onSelect={pick(enterSkeleton)}
        />
        <ModeRow
          icon={Brush}
          label="Weight Paint"
          checked={editMode === 'weightPaint'}
          disabled={!modeCompatTest(dataKind, MODE_WEIGHT_PAINT) || !hasWeights}
          hint={
            kind !== 'meshedPart'
              ? 'Select a meshed part to paint weights'
              : !hasWeights
                ? 'This mesh has no bone-binding yet (auto-rig sets it on handwear / arm parts; manual binding lands in a follow-up)'
                : 'Paint per-vertex weights for the active vertex group'
          }
          onSelect={pick(enterWeightPaint)}
        />
        <ModeRow
          icon={Hand}
          label="Sculpt Mode"
          checked={editMode === 'sculpt'}
          disabled={!modeCompatTest(dataKind, MODE_SCULPT) || sculptBlockedByAnimMode}
          hint={
            sculptBlockedByAnimMode
              ? 'Sculpt edits the rest mesh — exit the Animation editor first (sculpt mutations during animation would corrupt rest pose)'
              : kind !== 'meshedPart'
                ? 'Select a meshed part to sculpt'
                : 'Brush deform — Grab / Smooth / Pinch (Ctrl: Magnify) over mesh vertices'
          }
          onSelect={pick(enterSculpt)}
        />

        {/* Active shape-key picker — Blender pattern: shape painting
            lives inside Edit Mode + an active-shape pointer. Each row
            is a shortcut: "enter Edit Mode + set this shape active"
            (or just "set active" if already in Edit Mode). Selecting
            "(none)" clears the pointer so the brush paints rest verts. */}
        {blendShapes.length > 0 && (
          <div className="pt-1 mt-1 border-t border-border/40">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 px-1 mb-0.5">
              Active Shape (Edit Mode)
            </div>
            <ModeRow
              icon={Pencil}
              label="(none — paint rest)"
              checked={editMode === 'edit' && !activeBlendShapeId}
              onSelect={() => {
                if (editMode === 'edit') setActiveBlendShape(null);
                else enterEdit();
              }}
              hint="Edit Mode without an active shape — brush paints rest vertex positions"
            />
            {blendShapes.map((shape) => (
              <ModeRow
                key={shape.id}
                icon={Sparkles}
                label={shape.name}
                checked={editMode === 'edit' && activeBlendShapeId === shape.id}
                onSelect={pick(() => enterBlendShape(shape.id))}
                hint={`Edit Mode + paint deltas onto ${shape.name}`}
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
