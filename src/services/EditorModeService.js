// @ts-check

/**
 * EditorModeService — wraps `editorStore.setEditorMode` with the
 * captureRestPose side-effect that fires on a staging→animation
 * transition.
 *
 * Why a service: the trigger is "user enters Animate", not "user
 * clicks a workspace". Two callers exist today (Topbar Setup/Animate
 * pill, AnimationsEditor "edit this animation" path), and any future
 * caller (operator, keymap, programmatic) gets the same behaviour
 * by going through this function.
 *
 * @module services/EditorModeService
 */

import { useEditorStore } from '../store/editorStore.js';
import { useProjectStore } from '../store/projectStore.js';
import { useAnimationStore } from '../store/animationStore.js';

/**
 * Set the editor mode + capture the rest pose snapshot if this is a
 * staging→animation transition. Idempotent on no-op transitions
 * (animation→animation, staging→staging) so callers don't have to
 * gate themselves.
 *
 * @param {'staging'|'animation'} mode
 */
export function setEditorMode(mode) {
  const prev = useEditorStore.getState().editorMode;
  if (prev === mode) return;
  useEditorStore.getState().setEditorMode(mode);

  if (prev === 'staging' && mode === 'animation') {
    const project = useProjectStore.getState().project;
    const captureRestPose = useAnimationStore.getState().captureRestPose;
    if (project?.nodes && typeof captureRestPose === 'function') {
      captureRestPose(project.nodes);
    }
  }
}
