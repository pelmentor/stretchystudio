/**
 * Rotation deformer rig builders. Pure data — produces `RotationDeformerSpec`
 * entries from project-state inputs; no XML / no binary emission.
 *
 * @module io/live2d/rig/rotationDeformers
 */

/**
 * Face Rotation deformer — head tilts on Z (ParamAngleZ). Pivot lives at
 * the chin in canvas space; the rotation magnitude defaults to ±10° even
 * when the param is pushed to its full ±30 range (mirrors Hiyori).
 *
 * Chain integration: FaceRotation parents at BodyXWarp universally and
 * works in BodyXWarp-local 0..1 coordinates.
 *
 * # Why the rotation-parent branch is gone (2026-06-04 follow-up to bug-04)
 *
 * Pre-fix this builder accepted `parentType: 'rotation'` and produced
 * `parent.id = GroupRotation_<headGroupId>` for callers whose head group
 * had a rotation deformer. But per the 2026-05-23 RotationDeformer→bone
 * refactor + RULE-№4 meta (SS IS Blender; Cubism = addon),
 * `GroupRotation_*` no longer reifies as a node in `project.nodes` — the
 * head group is now a BONE. Bug-04 (`0ed9f5c`) fixed the call site
 * (`emitFaceRotation` always passes `parentType: 'warp'`); this commit
 * retires the dead builder branch per RULE-№2 (no migration baggage),
 * sibling to the NeckWarp closure (`ed3094f`).
 *
 * @param {Object} input
 * @param {number} input.facePivotCanvasX
 * @param {number} input.facePivotCanvasY
 * @param {(cx:number)=>number} input.canvasToBodyXX
 * @param {(cy:number)=>number} input.canvasToBodyXY
 * @param {number[]} [input.paramKeys] - Stage 8: ParamAngleZ keys (default [-30,0,30])
 * @param {number[]} [input.angles] - Stage 8: actual rotation angles per key
 *   (default [-10,0,10] — Hiyori ±10° cap). Must be same length as paramKeys.
 * @returns {{spec: import('./rigSpec.js').RotationDeformerSpec}}
 */
export function buildFaceRotationSpec(input) {
  const {
    facePivotCanvasX, facePivotCanvasY,
    canvasToBodyXX, canvasToBodyXY,
    paramKeys = [-30, 0, 30],
    angles    = [-10, 0, 10],
  } = input;

  if (paramKeys.length !== angles.length) {
    throw new Error(
      `[buildFaceRotationSpec] paramKeys (${paramKeys.length}) and angles `
      + `(${angles.length}) must have the same length`,
    );
  }

  const pivotX = canvasToBodyXX(facePivotCanvasX);
  const pivotY = canvasToBodyXY(facePivotCanvasY);

  /** @type {import('./rigSpec.js').RotationDeformerSpec} */
  const spec = {
    id: 'FaceRotation',
    name: 'Face Rotation',
    parent: { type: 'warp', id: 'BodyXWarp' },
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
 * `ParamRotation_<sanitized-group-name>` over its standard param range
 * mapped to deformer rotation angles. Default mapping is 1:1 ±30° — for
 * a ±30 param value, deformer rotates ±30°. Parented to ROOT (deferred
 * re-parenting attaches them under the body warp chain after the chain
 * emits).
 *
 * @param {Object} input
 * @param {string} input.id      RigSpec id, e.g. "GroupRotation_neck"
 * @param {string} input.name    Display name, e.g. "Rotation neck"
 * @param {string} input.paramId The driving rotation param id.
 * @param {{x:number, y:number}} input.pivotCanvas
 *   Pivot point in canvas pixels. Translator converts to parent's local
 *   frame at emission time.
 * @param {number[]} [input.paramKeys] - Stage 8: param value keyform stops
 *   (default [-30,0,30]).
 * @param {number[]} [input.angles] - Stage 8: deformer rotation angle per
 *   key (default [-30,0,30] — 1:1 mapping). Must match paramKeys length.
 * @returns {{spec: import('./rigSpec.js').RotationDeformerSpec}}
 */
export function buildGroupRotationSpec(input) {
  const {
    id, name, paramId, pivotCanvas,
    paramKeys = [-30, 0, 30],
    angles    = [-30, 0, 30],
  } = input;

  if (paramKeys.length !== angles.length) {
    throw new Error(
      `[buildGroupRotationSpec] paramKeys (${paramKeys.length}) and angles `
      + `(${angles.length}) must have the same length`,
    );
  }

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
