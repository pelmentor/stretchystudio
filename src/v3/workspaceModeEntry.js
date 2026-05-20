// @ts-check

/**
 * Workspace → editor-mode coupling (UI Blender-parity Slice E).
 *
 * Blender associates a mode with each workspace (`WorkSpace.object_mode`):
 * activating the Sculpting workspace enters Sculpt, Texture/Weight Paint
 * enters paint, etc. SS workspaces had been pure layout presets since
 * 2026-05-02 (mode followed selection only). This restores the headline
 * Blender behaviour for the **edit-purpose** workspaces.
 *
 * Design (deliberately conservative):
 *   - Only the unambiguous edit-purpose workspaces map to a mode
 *     (`modeling→edit`, `rigging→pose`, `weightPaint→weightPaint`,
 *     `sculpt→sculpt`). `layout` / `animation` are left UNCOUPLED — we do
 *     NOT force Object Mode on them, so switching to Animation to scrub a
 *     timeline never yanks you out of Pose/Edit mid-workflow. (Blender's
 *     `object_mode` is really the *last* mode used on a workspace, not a
 *     hard lock; a fixed map for the edit workspaces is the safe subset.)
 *   - Selection-gated: the mode is entered only if the active selection
 *     SUPPORTS it (a mesh for sculpt, an armature for pose, …), mirroring
 *     the Tab operator's gating. If it doesn't, the current mode is left
 *     untouched rather than forced.
 *
 * @module v3/workspaceModeEntry
 */

import { useEditorStore } from '../store/editorStore.js';
import { useSelectionStore } from '../store/selectionStore.js';
import { useProjectStore } from '../store/projectStore.js';
import { getMesh, getDataKind } from '../store/objectDataAccess.js';
import {
  modeCompatTest,
  MODE_EDIT,
  MODE_POSE,
  MODE_WEIGHT_PAINT,
  MODE_SCULPT,
} from '../modes/modeCompat.js';

/** workspace id → canonical editor mode. Absent ⇒ no coupling. */
const WORKSPACE_MODE = Object.freeze({
  modeling:    MODE_EDIT,
  rigging:     MODE_POSE,
  weightPaint: MODE_WEIGHT_PAINT,
  sculpt:      MODE_SCULPT,
  // layout / animation intentionally omitted — no forced mode change.
});

/**
 * Does the selected node support entering `mode`? Mirrors the Tab
 * operator's per-mode requirements (mesh data for edit/sculpt, weights
 * for weight paint, armature for pose).
 *
 * @param {object|null|undefined} node
 * @param {object|null|undefined} project
 * @param {string} mode
 * @returns {boolean}
 */
export function selectionSupportsMode(node, project, mode) {
  if (!node) return false;
  const dataKind = getDataKind(node, project);
  if (!modeCompatTest(dataKind, mode)) return false;
  const mesh = getMesh(node, project);
  if (mode === MODE_EDIT) return dataKind === 'armature' || !!mesh;
  if (mode === MODE_SCULPT) return !!mesh;
  if (mode === MODE_POSE) return dataKind === 'armature';
  if (mode === MODE_WEIGHT_PAINT) {
    return !!(mesh?.boneWeights || mesh?.jointBoneId
      || (mesh?.weightGroups && Object.keys(mesh.weightGroups).length > 0));
  }
  return true;
}

/**
 * Enter the workspace's canonical mode if the active selection supports
 * it. No-op for uncoupled workspaces, no selection, unsupported
 * selection, or when already in the target mode. Called by
 * `uiV3Store.setWorkspace` AFTER the workspace switch commits.
 *
 * @param {string} workspaceId
 */
export function applyWorkspaceMode(workspaceId) {
  const target = WORKSPACE_MODE[workspaceId];
  if (!target) return; // uncoupled workspace — leave mode as-is

  const ed = useEditorStore.getState();
  if (ed.editMode === target) return; // already there

  const active = useSelectionStore.getState().getActive?.();
  if (!active?.id) return; // nothing to enter a mode on

  const project = useProjectStore.getState().project;
  const node = project?.nodes?.find((n) => n?.id === active.id);
  if (!selectionSupportsMode(node, project, target)) return;

  // Pose / armature work needs the skeleton overlay visible so bones
  // render (mirrors the Tab operator + ModePill).
  if (target === MODE_POSE && !ed.viewLayers?.skeleton) {
    ed.setViewLayers({ skeleton: true });
  }
  ed.setSelection([active.id]);
  ed.enterEditMode(target);
}
