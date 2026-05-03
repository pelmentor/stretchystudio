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
} from 'lucide-react';

/**
 * @typedef {('select' | 'add_vertex' | 'remove_vertex' | 'brush' | 'joint_drag')} ToolModeId
 *
 * Three button kinds:
 *   - `tool`     — sticky, writes to `editorStore.toolMode`. Mutually
 *                   exclusive within the mode list.
 *   - `operator` — momentary, fires a v3 registry operator on click.
 *                   Active state never sticks.
 *   - `toggle`   — sticky boolean orthogonal to the active tool.
 *                   `toggleId` names the preference slot the toolbar
 *                   reads/writes (see `CanvasToolbar`'s switch). Used
 *                   for state that stacks on top of any tool, e.g.
 *                   Blender's proportional-edit `O` mode.
 *
 * @typedef {Object} ToolEntry
 * @property {string}                          id        - unique within the mode list
 * @property {'tool'|'operator'|'toggle'}      kind
 * @property {ToolModeId | string}             [toolModeId] - for kind='tool'
 * @property {string}                          [operatorId] - for kind='operator'
 * @property {string}                          [toggleId]   - for kind='toggle'
 * @property {string}                          label
 * @property {React.ComponentType<any>}        icon
 * @property {string}                          [hotkey]   - display only
 * @property {string}                          [hint]
 * @property {boolean}                         [divider]  - render a divider above this entry
 */

/** @type {Record<'object'|'mesh'|'skeleton'|'blendShape', ToolEntry[]>} */
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
    {
      id: 'joint_drag',
      kind: 'tool',
      toolModeId: 'joint_drag',
      label: 'Joint Drag',
      icon: Bone,
      hint: 'Drag joints to move bone pivots',
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
};

/**
 * Resolve which tool table to render for the current `editMode`.
 *
 * @param {null | 'mesh' | 'skeleton' | 'blendShape'} editMode
 * @returns {ToolEntry[]}
 */
export function toolsFor(editMode) {
  if (editMode === 'mesh') return TOOLS_BY_MODE.mesh;
  if (editMode === 'skeleton') return TOOLS_BY_MODE.skeleton;
  if (editMode === 'blendShape') return TOOLS_BY_MODE.blendShape;
  return TOOLS_BY_MODE.object;
}
