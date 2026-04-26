/**
 * Rotation deformer rig builders. Pure data — produces `RotationDeformerSpec`
 * entries from project-state inputs; no XML / no binary emission.
 *
 * @module io/live2d/rig/rotationDeformers
 */

/**
 * Face Rotation deformer — head tilts on Z (ParamAngleZ). Pivot lives at
 * the chin in canvas space; the rotation magnitude is capped at ±10° even
 * when the param is pushed to its full ±30 range (mirrors Hiyori).
 *
 * Chain integration: when the head group has its own rotation deformer
 * (from the deferred ParamRotation_<groupName> pass), face-rotation parents
 * to that and works in pivot-relative pixels. Otherwise it parents to the
 * Body X Warp in normalised 0..1.
 *
 * @param {Object} input
 * @param {number} input.facePivotCanvasX
 * @param {number} input.facePivotCanvasY
 * @param {('rotation'|'warp')} input.parentType
 * @param {string} input.parentDeformerId
 * @param {{x:number, y:number}|null} input.parentPivotCanvas
 *   Required when parentType==='rotation'.
 * @param {(cx:number)=>number} input.canvasToBodyXX
 * @param {(cy:number)=>number} input.canvasToBodyXY
 * @returns {{spec: import('./rigSpec.js').RotationDeformerSpec}}
 */
export function buildFaceRotationSpec(input) {
  const {
    facePivotCanvasX, facePivotCanvasY,
    parentType, parentDeformerId,
    parentPivotCanvas = null,
    canvasToBodyXX, canvasToBodyXY,
  } = input;

  const isUnderRotation = parentType === 'rotation';
  if (isUnderRotation && !parentPivotCanvas) {
    throw new Error(
      "[buildFaceRotationSpec] parentType='rotation' requires parentPivotCanvas",
    );
  }

  const pivotX = isUnderRotation
    ? facePivotCanvasX - parentPivotCanvas.x
    : canvasToBodyXX(facePivotCanvasX);
  const pivotY = isUnderRotation
    ? facePivotCanvasY - parentPivotCanvas.y
    : canvasToBodyXY(facePivotCanvasY);

  // Param keys vs deformer rotation angles. ParamAngleZ ranges ±30; we
  // cap actual rotation at ±10° to keep proportions believable.
  const paramKeys = [-30, 0, 30];
  const angles    = [-10, 0, 10];

  /** @type {import('./rigSpec.js').RotationDeformerSpec} */
  const spec = {
    id: 'FaceRotation',
    name: 'Face Rotation',
    parent: { type: parentType, id: parentDeformerId },
    bindings: [{
      parameterId: 'ParamAngleZ',
      keys: paramKeys,
      interpolation: 'LINEAR',
    }],
    keyforms: paramKeys.map((k, i) => ({
      keyTuple: [k],
      angle: angles[i],
      originX: pivotX,
      originY: pivotY,
      scale: 1.0,
      reflectX: false,
      reflectY: false,
      opacity: 1,
    })),
    baseAngle: 0,
    handleLengthOnCanvas: 200,
    circleRadiusOnCanvas: 100,
    isVisible: true,
    isLocked: false,
    useBoneUiTestImpl: true,
  };

  return { spec };
}

/**
 * Group Rotation deformer — one per non-bone, non-skipped group. Drives
 * `ParamRotation_<sanitized-group-name>` over its standard ±30 range mapped
 * to ±30° rotation. Parented to ROOT (deferred re-parenting attaches them
 * under the body warp chain after the chain emits).
 *
 * @param {Object} input
 * @param {string} input.id      RigSpec id, e.g. "GroupRotation_neck"
 * @param {string} input.name    Display name, e.g. "Rotation neck"
 * @param {string} input.paramId The driving rotation param id.
 * @param {{x:number, y:number}} input.pivotCanvas
 *   Pivot point in canvas pixels. Translator converts to parent's local
 *   frame at emission time.
 * @returns {{spec: import('./rigSpec.js').RotationDeformerSpec}}
 */
export function buildGroupRotationSpec(input) {
  const { id, name, paramId, pivotCanvas } = input;

  // Group rotations follow Hiyori's convention: ±30° mapping for ±30 param.
  const paramKeys = [-30, 0, 30];
  const angles    = [-30, 0, 30];

  /** @type {import('./rigSpec.js').RotationDeformerSpec} */
  const spec = {
    id,
    name,
    // Initial parent is ROOT — the body-warp chain re-parents these later
    // (see cmo3writer line ~3533). Translator uses spec.parent at emission
    // time, AFTER re-parenting completes.
    parent: { type: 'root', id: null },
    bindings: [{
      parameterId: paramId,
      keys: paramKeys,
      interpolation: 'LINEAR',
    }],
    keyforms: paramKeys.map((k, i) => ({
      keyTuple: [k],
      angle: angles[i],
      // Pivot stored in CANVAS frame. Translator converts to whatever the
      // CURRENT parent expects (canvas-px for root, normalised for warp,
      // pivot-relative for rotation).
      originX: pivotCanvas.x,
      originY: pivotCanvas.y,
      scale: 1.0,
      reflectX: false,
      reflectY: false,
      opacity: 1,
    })),
    baseAngle: 0,
    handleLengthOnCanvas: 200,
    circleRadiusOnCanvas: 100,
    isVisible: true,
    isLocked: false,
    useBoneUiTestImpl: true,
  };

  return { spec };
}
