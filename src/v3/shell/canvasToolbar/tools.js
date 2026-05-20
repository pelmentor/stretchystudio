// @ts-check

/**
 * Canvas toolbar declarative tool table.
 *
 * Mirrors Blender's left-edge T-panel: a list of tools per edit mode
 * the active edit mode advertises. CanvasToolbar reads
 * `editMode → tools` here and renders one icon button per entry.
 *
 * Two `kind`s of entry:
 *   - `tool`     — sticky. Click sets `editorStore.toolMode` to this
 *                   id; the canvas dispatch (`CanvasViewport.onPointerDown`)
 *                   reads `toolMode` to decide what a click does.
 *   - `operator` — momentary. Click fires the named operator from the
 *                   v3 registry (e.g. `transform.translate` opens the
 *                   modal G transform). Active state never sticks; the
 *                   modal owns the gesture and commits / cancels.
 *
 * Tools that don't have a backing handler yet (Knife, Smooth, …) are
 * NOT listed here — plan §"Anti-crutch checklist" forbids phantom
 * tools. Add them to this table in the same sweep that wires the
 * handler.
 *
 * Hotkeys listed are the existing keymap chord (Object Mode G/R/S
 * already fire the operators). The toolbar shows them as a hint in
 * the tooltip; it does NOT register new chords here.
 *
 * @module v3/shell/canvasToolbar/tools
 */

import {
  MousePointer2,
  Move,
  RotateCcw,
  Maximize,
  Brush,
  PlusCircle,
  MinusCircle,
  Bone,
  Sparkles,
  Hand,
  Waves,
  ChevronsLeftRight,
  Crosshair,
} from 'lucide-react';

/**
 * @typedef {('select' | 'cursor' | 'add_vertex' | 'remove_vertex' | 'brush' | 'joint_drag')} ToolModeId
 *
 * Four button kinds:
 *   - `tool`         — sticky, writes to `editorStore.toolMode`. Mutually
 *                       exclusive within the mode list.
 *   - `operator`     — momentary, fires a v3 registry operator on click.
 *                       Active state never sticks.
 *   - `toggle`       — sticky boolean orthogonal to the active tool.
 *                       `toggleId` names the preference slot the toolbar
 *                       reads/writes (see `CanvasToolbar`'s switch). Used
 *                       for state that stacks on top of any tool, e.g.
 *                       Blender's proportional-edit `O` mode.
 *   - `sculpt_brush` — sticky, writes to `editorStore.sculpt.activeBrush`.
 *                       Mutually exclusive within the Sculpt-mode entry
 *                       list. `toolMode` stays at `'brush'` for the whole
 *                       mode; the brush id is a sub-state. Mirrors
 *                       Blender's brush-tool list in Sculpt Mode header.
 *
 * @typedef {Object} ToolEntry
 * @property {string}                          id        - unique within the mode list
 * @property {'tool'|'operator'|'toggle'|'sculpt_brush'} kind
 * @property {ToolModeId | string}             [toolModeId]   - for kind='tool'
 * @property {string}                          [operatorId]   - for kind='operator'
 * @property {string}                          [toggleId]     - for kind='toggle'
 * @property {string}                          [sculptBrushId] - for kind='sculpt_brush'
 * @property {string}                          label
 * @property {React.ComponentType<any>}        icon
 * @property {string}                          [hotkey]   - display only
 * @property {string}                          [hint]
 * @property {boolean}                         [divider]  - render a divider above this entry
 */

/** @type {Record<'object'|'mesh'|'skeleton'|'blendShape'|'sculpt', ToolEntry[]>} */
export const TOOLS_BY_MODE = {
  object: [
    {
      id: 'select',
      kind: 'tool',
      toolModeId: 'select',
      label: 'Select',
      icon: MousePointer2,
      hint: 'Click parts to select; Shift-click to multi-select',
    },
    {
      id: 'cursor',
      kind: 'tool',
      toolModeId: 'cursor',
      label: '2D Cursor',
      icon: Crosshair,
      hint: 'Click to place the 2D cursor (Shift+RMB also works in any tool)',
    },
    {
      id: 'transform.translate',
      kind: 'operator',
      operatorId: 'transform.translate',
      label: 'Move',
      icon: Move,
      hotkey: 'G',
      hint: 'Move the selection (G)',
      divider: true,
    },
    {
      id: 'transform.rotate',
      kind: 'operator',
      operatorId: 'transform.rotate',
      label: 'Rotate',
      icon: RotateCcw,
      hotkey: 'R',
      hint: 'Rotate the selection (R)',
    },
    {
      id: 'transform.scale',
      kind: 'operator',
      operatorId: 'transform.scale',
      label: 'Scale',
      icon: Maximize,
      hotkey: 'S',
      hint: 'Scale the selection (S)',
    },
  ],

  mesh: [
    // Toolset Phase 0.E — Select is the new default Edit-Mode tool
    // (Blender pattern). LMB picks a vertex, Shift+LMB toggles, Ctrl+LMB
    // selects shortest topology path, empty-canvas LMB deselects all.
    {
      id: 'select',
      kind: 'tool',
      toolModeId: 'select',
      label: 'Select',
      icon: MousePointer2,
      hint: 'Click vertices to select (Shift toggle, Ctrl shortest path, A select-all)',
    },
    {
      id: 'cursor',
      kind: 'tool',
      toolModeId: 'cursor',
      label: '2D Cursor',
      icon: Crosshair,
      hint: 'Click to place the 2D cursor (Shift+RMB also works in any tool)',
    },
    {
      id: 'brush',
      kind: 'tool',
      toolModeId: 'brush',
      label: 'Brush',
      icon: Brush,
      hint: 'Multi-vertex deform brush (UV adjust when meshSubMode=adjust)',
    },
    {
      id: 'add_vertex',
      kind: 'tool',
      toolModeId: 'add_vertex',
      label: 'Add Vertex',
      icon: PlusCircle,
      hint: 'Click to add a vertex at the cursor',
      divider: true,
    },
    {
      id: 'remove_vertex',
      kind: 'tool',
      toolModeId: 'remove_vertex',
      label: 'Remove Vertex',
      icon: MinusCircle,
      hint: 'Click to remove the nearest vertex',
    },
    // PP1-008(c) — Proportional-edit toggle relocated to ModePill (right
    // of the edit-mode picker), matching Blender's header layout where
    // proportional-edit is a sibling of the mode dropdown rather than
    // a brush option in the T-panel.
  ],

  skeleton: [
    // Slice D — Select is the Blender-faithful pose tool (Blender's pose
    // default is select_box): click a bone to select, then transform via
    // G/R/S, box-select via B, select-all via A. Joint Drag (SS-original,
    // still the auto-armed default for now) keeps direct drag-to-pose.
    {
      id: 'select',
      kind: 'tool',
      toolModeId: 'select',
      label: 'Select',
      icon: MousePointer2,
      hint: 'Click bones to select (B box-select, A select-all); transform with G / R / S',
    },
    {
      id: 'cursor',
      kind: 'tool',
      toolModeId: 'cursor',
      label: '2D Cursor',
      icon: Crosshair,
      hint: 'Click to place the 2D cursor (Shift+RMB also works in any tool)',
    },
    {
      id: 'joint_drag',
      kind: 'tool',
      toolModeId: 'joint_drag',
      label: 'Joint Drag',
      icon: Bone,
      hint: 'Drag joints directly to pose bones',
    },
    {
      id: 'transform.translate',
      kind: 'operator',
      operatorId: 'transform.translate',
      label: 'Move',
      icon: Move,
      hotkey: 'G',
      hint: 'Move the selected bone (G)',
      divider: true,
    },
    {
      id: 'transform.rotate',
      kind: 'operator',
      operatorId: 'transform.rotate',
      label: 'Rotate',
      icon: RotateCcw,
      hotkey: 'R',
      hint: 'Rotate the selected bone (R)',
    },
    {
      id: 'transform.scale',
      kind: 'operator',
      operatorId: 'transform.scale',
      label: 'Scale',
      icon: Maximize,
      hotkey: 'S',
      hint: 'Scale the selected bone (S)',
    },
  ],

  blendShape: [
    {
      id: 'brush',
      kind: 'tool',
      toolModeId: 'brush',
      label: 'Brush',
      icon: Sparkles,
      hint: 'Paint deltas onto the active blend shape',
    },
  ],

  sculpt: [
    // Toolset Plan Phase 3 — three Blender-faithful sculpt brushes.
    // Each entry writes `editorStore.sculpt.activeBrush`; the canvas
    // pointer dispatch reads that field to pick the brush impl. The
    // `toolMode` slot stays at `'brush'` for the entire Sculpt Mode.
    {
      id: 'sculpt.grab',
      kind: 'sculpt_brush',
      sculptBrushId: 'grab',
      label: 'Grab',
      icon: Hand,
      hint: 'Drag verts within the brush radius — falloff feathers the rim',
    },
    {
      id: 'sculpt.smooth',
      kind: 'sculpt_brush',
      sculptBrushId: 'smooth',
      label: 'Smooth',
      // Audit D-10: prior Smile icon read as facial expression, not as
      // averaging / smoothing. Waves visually conveys the noise → flat
      // semantic.
      icon: Waves,
      hint: 'Laplacian smoothing — verts move toward the average of their neighbours',
    },
    {
      id: 'sculpt.pinch',
      kind: 'sculpt_brush',
      sculptBrushId: 'pinch',
      label: 'Pinch',
      // Audit D-10: prior Minimize icon read as window-collapse control.
      // ChevronsLeftRight literally points two arrows toward each other
      // (= squeeze/pinch).
      icon: ChevronsLeftRight,
      hint: 'Stroke-aligned squeeze — verts pull perpendicular to stroke direction (Ctrl: Magnify)',
    },
  ],
};

/**
 * Resolve which tool table to render for the current `editMode`.
 *
 * Edit Mode dispatches by `activeBlendShapeId`: when set, the brush
 * paints shape deltas (Blender pattern — Edit Mode + active-shape
 * pointer); when null, the mesh-vertex tools (brush / add / remove)
 * apply.
 *
 * @param {null | 'edit' | 'pose' | 'sculpt' | 'weightPaint'} editMode
 * @param {string | null} [activeBlendShapeId]
 * @returns {ToolEntry[]}
 */
export function toolsFor(editMode, activeBlendShapeId = null) {
  if (editMode === 'edit') {
    return activeBlendShapeId ? TOOLS_BY_MODE.blendShape : TOOLS_BY_MODE.mesh;
  }
  if (editMode === 'pose')   return TOOLS_BY_MODE.skeleton;
  if (editMode === 'sculpt') return TOOLS_BY_MODE.sculpt;
  return TOOLS_BY_MODE.object;
}
