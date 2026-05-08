/**
 * SkeletonOverlay — SVG overlay drawn on top of the WebGL canvas.
 *
 * Shows the armature skeleton (bone lines + joint circles) derived from group
 * nodes that have a `boneRole` property.  In skeletonEditMode, joints are
 * draggable: dragging a joint updates that group node's pivotX/pivotY in the
 * project store, which immediately changes where that bone rotates.
 *
 * Coordinate transform:
 *   image-space (px)  →  canvas CSS px:  cssX = px * zoom + panX
 *   canvas CSS px     →  image-space:    px  = (cssX - panX) / zoom
 */

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { useAnimationStore } from '@/store/animationStore';
import { useParamValuesStore } from '@/store/paramValuesStore';
import { useRigSpecStore } from '@/store/rigSpecStore';
import { useSelectionStore } from '@/store/selectionStore';
import { SKELETON_CONNECTIONS } from '@/io/armatureOrganizer';
import {
  computeWorldMatrices, mat3Identity,
  preparePoseTranslate, applyPoseTranslate,
} from '@/renderer/transforms';
import { computePoseOverrides, applyOverrideToNode } from '@/renderer/animationEngine';
import { useToast } from '@/hooks/use-toast';
import { beginBatch, endBatch } from '@/store/undoHistory';
import { sanitisePartName } from '@/lib/partId';
import { logger } from '@/lib/logger';
import {
  isBoneGroup,
  isMeshedPart,
  getMesh,
  getBoneRole,
} from '@/store/objectDataAccess';

// Colour palette
const COLOUR_NORMAL = '#ef4444';      // red — not in edit mode
const COLOUR_EDIT   = '#facc15';      // yellow — edit mode ready to drag
const COLOUR_DRAG   = '#22d3ee';      // cyan — currently dragging
// Outliner ↔ canvas selection sync — bones the user picked in the
// Outliner Skeleton tab (or via canvas click) get the sky-blue accent
// + a soft halo ring so they pop against the red/yellow joint dots.
const COLOUR_SELECTED = '#38bdf8';    // sky-400
const LINE_COLOUR   = 'rgba(34,211,238,0.55)';

const JOINT_RADIUS_NORMAL = 5;
const JOINT_RADIUS_EDIT   = 8;

// Arc handle constants
const ARC_BONE_ROLES = new Set(['torso', 'neck', 'head', 'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'bothArms', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'bothLegs']);

// BLENDER-STYLE BONE INDEPENDENCE (2026-05-08): the
// BONE_ROLE_FALLBACK_PARAM map (was here) is gone. Bone arc gestures
// always write `node.pose.rotation` regardless of whether a matching
// rig param exists. The Parameters panel slider for `ParamRotation_<bone>`
// / `ParamAngleZ` / `ParamBodyAngleZ` remains as the export-driving
// control surface; bone rotation composes on top of it via the render-
// loop bone overlay matrix + per-vertex skinning.
const ARC_RADIUS = 28;      // screen px
const ARC_SWEEP_DEG = 270;  // coverage
const ARC_COLOUR = 'rgba(251,191,36,0.55)';
const ARC_ACTIVE = 'rgba(251,191,36,0.95)';
const ARC_STROKE_W = 5;

/** Convert SVG/CSS coords → image-space */
function toImage(cssX, cssY, zoom, panX, panY) {
  return [(cssX - panX) / zoom, (cssY - panY) / zoom];
}

/** Generate SVG arc path */
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const half = sweepDeg / 2;
  const a1 = (startDeg - half) * (Math.PI / 180);
  const a2 = (startDeg + half) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export default function SkeletonOverlay({ view, editorMode, showSkeleton, skeletonEditMode }) {
  const updateProject  = useProjectStore(s => s.updateProject);
  const nodes          = useProjectStore(s => s.project.nodes);
  const animations     = useProjectStore(s => s.project.animations);

  const selection      = useEditorStore(s => s.selection);
  const setSelection   = useEditorStore(s => s.setSelection);
  // editMode === 'pose' is Pose Mode — the SOLE bone-edit mode.
  // Joint drag writes pose.x/y; rotation arc writes pose.rotation (or the
  // driver param). Object Mode = selection only, no bone interaction.
  const editMode       = useEditorStore(s => s.editMode);
  // Outliner→canvas selection bridge: the universal selectionStore is
  // the canonical truth (Outliner Skeleton tab writes here), the legacy
  // `editorStore.selection` carries the same payload mirrored by
  // CanvasViewport's part-click handler. Read both so a click in
  // EITHER surface highlights the matching joint dot.
  const selectionStoreItems = useSelectionStore(s => s.items);

  // Bone-selection writer: updates BOTH stores so ModePill (universal)
  // and legacy consumers (Properties / Gizmo) agree. Every selection
  // surface in this overlay must call through here — direct
  // `setSelection([id])` only writes the legacy store, leaving Pose Mode
  // greyed out in ModePill (which subscribes to universal only).
  const selectBoneInBothStores = useCallback((nodeId) => {
    setSelection([nodeId]);
    useSelectionStore.getState().select({ type: 'group', id: nodeId }, 'replace');
  }, [setSelection]);
  const animCurrentTime       = useAnimationStore(s => s.currentTime);
  const animActiveAnimationId = useAnimationStore(s => s.activeAnimationId);
  const animDraftPose         = useAnimationStore(s => s.draftPose);
  const animLoopKeyframes     = useAnimationStore(s => s.loopKeyframes);
  const animFps               = useAnimationStore(s => s.fps);
  const animEndFrame          = useAnimationStore(s => s.endFrame);
  const setDraftPose          = useAnimationStore(s => s.setDraftPose);
  const clearDraftPoseForNode = useAnimationStore(s => s.clearDraftPoseForNode);
  // BUG-016 fix — iris controller knob position reads ParamEyeBallX/Y when
  // a rigSpec is present (post-Init-Rig); the param drives the rig's
  // iris-translation keyforms via tagWarpBindings. Pre-Init-Rig the knob
  // falls back to node.transform.x/y so the trackpad is still a usable
  // pose preview before rigging exists.
  const paramEyeBallX = useParamValuesStore(s => s.values.ParamEyeBallX);
  const paramEyeBallY = useParamValuesStore(s => s.values.ParamEyeBallY);
  const hasRigSpec    = useRigSpecStore(s => !!s.rigSpec);

  const dragRef  = useRef(null); // { type: 'joint'|'rotate', nodeId, ... }
  const svgRef   = useRef(null);

  // Stable refs for event handlers (avoid stale closures)
  const viewRef         = useRef(view);
  const editorModeRef   = useRef(editorMode);
  const setDraftPoseRef = useRef(setDraftPose);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { editorModeRef.current = editorMode; }, [editorMode]);
  useEffect(() => { setDraftPoseRef.current = setDraftPose; }, [setDraftPose]);

  const { toast } = useToast();
  useEffect(() => {
    if (selection.length !== 1) return;
    const nodeId = selection[0];
    const node = nodes.find(n => n.id === nodeId);
    if (!isBoneGroup(node)) return;

    const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
    if (JSKinningRoles.has(getBoneRole(node))) {
      const hasDependent = nodes.some(n => isMeshedPart(n) && getMesh(n)?.jointBoneId === node.id);
      if (!hasDependent) {
        toast({
          title: "Limb mesh required",
          description: "To enable rotation: (1) Hide armature, (2) Select the limb layer, (3) Click 'Remesh'."
        });
      }
    }
  }, [selection, nodes, toast]);

  // Compute effective nodes (animation overrides + draft pose).
  // `applyOverrideToNode` routes transform-shape values to pose for
  // bone groups, transform for everything else (schema v17+).
  const effectiveNodes = useMemo(() => {
    if (editorMode !== 'animation') return nodes;
    const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
    const endMs = (animEndFrame / animFps) * 1000;
    const overrides  = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
    const hasDraft   = animDraftPose.size > 0;
    if (!overrides.size && !hasDraft) return nodes;
    return nodes.map(node => {
      const ov = overrides.get(node.id);
      const dr = animDraftPose.get(node.id);
      if (!ov && !dr) return node;
      // Compose: keyframe value first, draft on top (drag overrides
      // keyframe). Both flow through the same bone-aware merge.
      let n = node;
      if (ov) n = applyOverrideToNode(n, ov);
      if (dr) n = applyOverrideToNode(n, dr);
      return n;
    });
  }, [editorMode, nodes, animations, animActiveAnimationId, animCurrentTime, animDraftPose, animLoopKeyframes, animFps, animEndFrame]);

  const boneNodes = React.useMemo(() => {
    const map = {};
    for (const n of effectiveNodes) {
      if (isBoneGroup(n)) map[getBoneRole(n)] = n;
    }
    return map;
  }, [effectiveNodes]);

  /* ── Compute keyframe overrides (before pointer handlers) ── */

  const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
  const endMs = (animEndFrame / animFps) * 1000;
  const keyframeOverrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);

  /* ── Pointer handlers — defined unconditionally (Rules of Hooks) ── */

  const onPointerDown = useCallback((e, nodeId, dragType = 'joint') => {
    if (e.button !== 0) return; // Only handle left-click; middle/right pass through

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (dragType === 'joint') {
      // Joint drag — only active in skeleton edit mode (Pose or Armature
      // Edit). For Pose Mode, capture the rest-world inverse + pivot so
      // the move handler can compute pose.x/y in one matrix-point multiply.
      if (!skeletonEditMode) return;
      const drag = { type: 'joint', nodeId };
      const ed = useEditorStore.getState();
      if (ed.editMode === 'pose') {
        const proj = useProjectStore.getState().project;
        const projNodes = proj?.nodes ?? [];
        const node = projNodes.find((n) => n?.id === nodeId);
        if (node?.transform) {
          const wm = computeWorldMatrices(projNodes);
          const parentWorld = (node.parent && wm.has(node.parent))
            ? wm.get(node.parent)
            : mat3Identity();
          drag.poseSetup = preparePoseTranslate(parentWorld, node.transform);
        }
      }
      dragRef.current = drag;
    } else if (dragType === 'trackpad') {
      if (skeletonEditMode) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      // Calculate trackpad center using base parent transform
      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return;
      let pwm = mat3Identity();
      if (node.parent && worldMap.has(node.parent)) {
         pwm = worldMap.get(node.parent);
      }
      const bx = pwm[0] * node.transform.pivotX + pwm[3] * node.transform.pivotY + pwm[6];
      const by = pwm[1] * node.transform.pivotX + pwm[4] * node.transform.pivotY + pwm[7];
      const { zoom, panX, panY } = viewRef.current;
      const cx = bx * zoom + panX;
      const cy = by * zoom + panY;
      const tpx = cx + 0;
      const tpy = cy - 120; // offset above head

      dragRef.current = {
        type: 'trackpad',
        nodeId,
        tpX: tpx,
        tpY: tpy,
        isAnimMode: editorModeRef.current === 'animation',
      };

      // Mirror to BOTH stores so ModePill enables Pose Mode for the
      // selected bone; legacy `setSelection` alone leaves universal
      // selection empty and ModePill stays greyed out.
      selectBoneInBothStores(nodeId);

      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }

      const dx = cssX - tpx;
      const dy = cssY - tpy;
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40;
      let cxClamp = dx;
      if (cxClamp < -half) cxClamp = -half;
      if (cxClamp > half) cxClamp = half;
      let cyClamp = dy;
      if (cyClamp < -half) cyClamp = -half;
      if (cyClamp > half) cyClamp = half;
      const newX = (cxClamp / half) * MAX_OFFSET;
      const newY = (cyClamp / half) * MAX_OFFSET;

      // BUG-016 fix: write to ParamEyeBallX/Y so the iris controller drives
      // the rig's iris-translation keyforms (built by tagWarpBindings.js as
      // ParamEyeBallX × ParamEyeBallY) AFTER Init Rig has been run. Pre-Init-Rig
      // there's no rigSpec consuming these params, but the simultaneous
      // node.transform.x/y write below keeps the rest-mesh + worldMatrix
      // path working for the no-rig case. Range conversion: trackpad ±40 px
      // → ParamEyeBall ±1 (Cubism convention; ParamEyeBallY positive = look
      // up, hence the negation since screen-y increases downward).
      useParamValuesStore.getState().setMany({
        ParamEyeBallX:  newX / MAX_OFFSET,
        ParamEyeBallY: -newY / MAX_OFFSET,
      });

      if (editorModeRef.current === 'animation') {
         setDraftPoseRef.current(nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === nodeId);
           if (!pn) return;
           if (!pn.transform) pn.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
           pn.transform.x = newX;
           pn.transform.y = newY;
         });
      }
    } else if (dragType === 'rotate') {
      // Rotation arc drag — only in Pose Mode (skeletonEditMode true).
      // Object Mode = selection only, no bone rotation. (Earlier code
      // did the inverse — arcs fired ONLY in Object Mode — which broke
      // Blender semantics; flipped 2026-05-06.)
      if (!skeletonEditMode) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const { zoom, panX, panY } = viewRef.current;

      // Compute pivot screen position using world matrix
      const worldMap = computeWorldMatrices(effectiveNodes);
      const node = effectiveNodes.find(n => n.id === nodeId);
      if (!node) return;
      const wm = worldMap.get(nodeId) ?? mat3Identity();
      const wx = wm[0] * node.transform.pivotX + wm[3] * node.transform.pivotY + wm[6];
      const wy = wm[1] * node.transform.pivotX + wm[4] * node.transform.pivotY + wm[7];
      const pivotScreenX = wx * zoom + panX;
      const pivotScreenY = wy * zoom + panY;

      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const dx = cssX - pivotScreenX;
      const dy = cssY - pivotScreenY;

      // BLENDER-STYLE BONE INDEPENDENCE (2026-05-08): no in-drag
      // per-vertex JS skinning. Render-loop applies skinning every
      // frame from `node.pose.rotation` + `mesh.boneWeights` via
      // `renderer/boneSkinning.js`. The previous in-drag path
      // committed deformed verts to `mesh.vertices` on drag end —
      // destructive baking the user explicitly didn't want. The render-
      // loop path keeps `mesh.vertices` (rest geometry) untouched.
      const dependentParts = [];

      // BLENDER-STYLE BONE INDEPENDENCE (BONE_ARMATURE_INDEPENDENCE plan,
      // 2026-05-08): bone arc gestures write `node.pose.rotation`,
      // never `paramValues.ParamRotation_<bone>`. The param remains a
      // first-class control surface (Parameters slider, animation tracks,
      // Cubism export) but is no longer secretly driven by the bone
      // gesture. Bones and params COEXIST and COMPOSE — bone overlay/
      // skinning multiplies on top of the chainEval output, exactly like
      // Blender's Armature modifier on top of shape keys.
      //
      // The previous "if rotationParamId then write paramValue" branch
      // was the bait-and-switch the user explicitly rejected.
      const startRotation = node.pose?.rotation ?? 0;
      dragRef.current = {
        type: 'rotate',
        nodeId,
        startAngle: Math.atan2(dy, dx),
        startRotation,
        pivotScreenX,
        pivotScreenY,
        isAnimMode: editorModeRef.current === 'animation',
        dependentParts,
      };

      // Select the bone so GizmoOverlay appears, ModePill un-greys
      // Pose Mode, and Properties shows the bone tab.
      selectBoneInBothStores(nodeId);

      if (editorModeRef.current === 'staging') {
        beginBatch(useProjectStore.getState().project);
      }
    }
  }, [skeletonEditMode, effectiveNodes, setSelection, selectBoneInBothStores, animations, animActiveAnimationId, animCurrentTime, animDraftPose]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    if (drag.type === 'joint') {
      // Joint position drag — write target:
      //
      //   skeleton (Pose Mode): write node.pose.x/y in this bone's
      //     parent-rest frame so the joint visually lands at the cursor.
      //     Math: pose.{x,y} = inverse(parentWorld × restM) × target - pivot.
      //     The inverse is captured at drag-start (cached in dragRef) so
      //     mousemove is just one matrix-point multiply.
      //
      //   wizard adjust step (no editMode but skeletonEditMode forced
      //     true via the wizard prop): direct pivotX/Y write — only the
      //     dragged bone moves, no descendant follow, no pose write.
      //     This is the rest-pivot placement gesture for the import
      //     wizard, where parts aren't yet skinned to bones so a pose
      //     write would visually drag children too.
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const { zoom, panX, panY } = viewRef.current;
      const [imgX, imgY] = toImage(cssX, cssY, zoom, panX, panY);
      if (editMode === 'pose' && drag.poseSetup) {
        const { x: newPoseX, y: newPoseY } = applyPoseTranslate(drag.poseSetup, imgX, imgY);
        updateProject((proj) => {
          const node = proj.nodes.find((n) => n.id === drag.nodeId);
          if (!node) return;
          if (!node.pose) {
            node.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
          }
          node.pose.x = newPoseX;
          node.pose.y = newPoseY;
        }, { skipHistory: true });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (node) {
            node.transform.pivotX = imgX;
            node.transform.pivotY = imgY;
          }
        }, { skipHistory: true });
      }
    } else if (drag.type === 'rotate') {
      // Rotation arc drag
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const dx = cssX - drag.pivotScreenX;
      const dy = cssY - drag.pivotScreenY;
      const currentAngle = Math.atan2(dy, dx);
      let delta = (currentAngle - drag.startAngle) * (180 / Math.PI);

      // Shift modifier for 15-degree snapping
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;

      // BLENDER-STYLE BONE INDEPENDENCE: single source of truth is
      // `node.pose.rotation`. The bone is unbounded — clamp the
      // associated `ParamRotation_<bone>` slider via its own min/max
      // when the user drags THE SLIDER, not when they drag the bone.
      // Bones rotate freely (Blender pose mode never clamps a bone
      // rotation by an unrelated shape-key range).
      const newRotation = drag.startRotation + delta;

      // Animation mode auto-keyframe capture path: setDraftPose so the
      // K-keyframe trigger picks up the rotation channel. Pose Mode
      // (staging) writes directly to project.nodes for live render.
      if (drag.isAnimMode) {
        setDraftPoseRef.current(drag.nodeId, { rotation: newRotation });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (!node) return;
          if (!node.pose) node.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
          node.pose.rotation = newRotation;
        }, { skipHistory: true });
      }

      // BLENDER-STYLE BONE INDEPENDENCE (2026-05-08): the in-drag
      // mesh_verts skinning that used to live here is gone. Render-loop
      // applies per-vertex weighted skinning from `node.pose.rotation`
      // (set by `updateProject` above) every frame via
      // `renderer/boneSkinning.js`.
    } else if (drag.type === 'trackpad') {
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      
      const dx = cssX - drag.tpX;
      const dy = cssY - drag.tpY;
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40;
      let cxClamp = dx;
      if (cxClamp < -half) cxClamp = -half;
      if (cxClamp > half) cxClamp = half;
      let cyClamp = dy;
      if (cyClamp < -half) cyClamp = -half;
      if (cyClamp > half) cyClamp = half;
      const newX = (cxClamp / half) * MAX_OFFSET;
      const newY = (cyClamp / half) * MAX_OFFSET;

      // BUG-016 fix — see paired write in onPointerDown trackpad branch.
      useParamValuesStore.getState().setMany({
        ParamEyeBallX:  newX / MAX_OFFSET,
        ParamEyeBallY: -newY / MAX_OFFSET,
      });

      if (drag.isAnimMode) {
         setDraftPoseRef.current(drag.nodeId, { x: newX, y: newY });
      } else {
         updateProject((proj) => {
           const pn = proj.nodes.find(n => n.id === drag.nodeId);
           if (!pn) return;
           // Eyes is a bone group → translation goes into pose, not transform.
           // Pre-Init-Rig the worldMatrix path reads pose-on-bones now; the
           // trackpad's visual feedback follows.
           if (!pn.pose) pn.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
           pn.pose.x = newX;
           pn.pose.y = newY;
         }, { skipHistory: true });
      }
    }
  }, [updateProject, effectiveNodes, animDraftPose, keyframeOverrides]);

  const clearDraftPoseForNodeRef = useRef(clearDraftPoseForNode);
  useEffect(() => { clearDraftPoseForNodeRef.current = clearDraftPoseForNode; }, [clearDraftPoseForNode]);

  const onPointerUp = useCallback(() => {
    endBatch();
    const drag = dragRef.current;
    dragRef.current = null;

    // BLENDER-STYLE BONE INDEPENDENCE (2026-05-08): no destructive
    // mesh.vertices bake on drag end. `node.pose.rotation` carries the
    // rotation; render-loop skinning in `renderer/boneSkinning.js`
    // applies it every frame. Rest geometry stays untouched until the
    // user explicitly invokes `applyPoseAsRest`. Mirrors Blender Pose
    // Mode → Apply Pose As Rest Pose (Ctrl+A → "Apply Pose as Rest").

    // Auto Keyframe trigger
    if (drag && (drag.type === 'rotate' || drag.type === 'trackpad')) {
      if (useEditorStore.getState().autoKeyframe && editorModeRef.current === 'animation') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    }
  }, [updateProject]);


  /* ── Helper: get effective puppet pins with priority (draft > keyframe > base) ── */
  /* ── Early exit (after all hooks) ── */

  const hasArmature = Object.keys(boneNodes).length > 0;
  if (!hasArmature) return null;
  if (!showSkeleton) return null;
  if (editorMode !== 'staging' && editorMode !== 'animation') return null;

  const { zoom, panX, panY } = view;

  /* ── Compute world matrices and helper ── */

  const worldMap = computeWorldMatrices(effectiveNodes);

  function pivotScreenPos(node) {
    const wm = worldMap.get(node.id) ?? mat3Identity();
    const wx = wm[0] * node.transform.pivotX + wm[3] * node.transform.pivotY + wm[6];
    const wy = wm[1] * node.transform.pivotX + wm[4] * node.transform.pivotY + wm[7];
    return [wx * zoom + panX, wy * zoom + panY];
  }

  /* ── Build SVG elements ── */

  const radius = skeletonEditMode ? JOINT_RADIUS_EDIT : JOINT_RADIUS_NORMAL;

  const lines = [];
  for (const [fromRole, toRole] of SKELETON_CONNECTIONS) {
    const from = boneNodes[fromRole];
    const to   = boneNodes[toRole];
    if (!from || !to) continue;
    const [x1, y1] = pivotScreenPos(from);
    const [x2, y2] = pivotScreenPos(to);
    lines.push(
      <line key={`${fromRole}-${toRole}`}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={LINE_COLOUR} strokeWidth={skeletonEditMode ? 2 : 1.5}
        strokeLinecap="round" pointerEvents="none"
      />
    );
  }

  // Union of both selection sources. `editorStore.selection` already
  // carries plain ids; selectionStore's group entries name bones too.
  const selectionSet = new Set(selection ?? []);
  for (const it of selectionStoreItems) {
    if (it && (it.type === 'group' || it.type === 'part') && typeof it.id === 'string') {
      selectionSet.add(it.id);
    }
  }

  const circles = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    // Root is the canvas-level pivot — no rotation arc, no skinning,
    // but it IS a bone in the outliner so it needs a canvas dot too.
    // Renders LARGER than joint dots (Blender's Armature root marker
    // is the biggest bone icon by convention) so it doesn't disappear
    // into busy geometry at the hip pivot.
    const isRoot = role === 'root';
    const [cx, cy] = pivotScreenPos(node);
    const isDragging = dragRef.current?.nodeId === node.id;
    const isSelected = selectionSet.has(node.id);
    const fill = isDragging
      ? COLOUR_DRAG
      : isSelected
        ? COLOUR_SELECTED
        : (skeletonEditMode ? COLOUR_EDIT : COLOUR_NORMAL);
    const dotRadius = isRoot ? Math.max(7, radius * 1.4) : radius;
    if (isSelected && !isDragging) {
      // Soft halo ring — same accent at low opacity, fattens to
      // ~2x the joint radius. Drawn first so the solid dot paints on top.
      circles.push(
        <circle key={`${role}-halo`}
          cx={cx} cy={cy} r={dotRadius * 2}
          fill="none" stroke={COLOUR_SELECTED} strokeOpacity={0.4} strokeWidth={2}
          pointerEvents="none"
        />
      );
    }
    if (isRoot) {
      // Phase 1 (Blender alignment) — render root as an octahedral
      // diamond outline (matches Blender's Armature root marker)
      // instead of a small dot. Larger hit area than the previous
      // 60%-radius dot so it's harder to miss against busy geometry.
      const dHalf = dotRadius * 1.6;
      const points = [
        `${cx},${cy - dHalf}`,
        `${cx + dHalf},${cy}`,
        `${cx},${cy + dHalf}`,
        `${cx - dHalf},${cy}`,
      ].join(' ');
      circles.push(
        <polygon key={role}
          points={points}
          fill={fill} fillOpacity={0.25}
          stroke={COLOUR_SELECTED} strokeWidth={2}
          style={{ cursor: skeletonEditMode ? 'grab' : 'pointer', pointerEvents: 'visiblePainted' }}
          onPointerDown={(e) => onPointerDown(e, node.id, 'joint')}
          onClick={() => {
            if (skeletonEditMode) return;
            selectBoneInBothStores(node.id);
          }}
        />
      );
    } else {
      circles.push(
        <circle key={role}
          cx={cx} cy={cy} r={dotRadius}
          fill={fill} stroke="#000" strokeWidth={1.5}
          style={{ cursor: skeletonEditMode ? 'grab' : 'pointer', pointerEvents: 'visiblePainted' }}
          onPointerDown={(e) => onPointerDown(e, node.id, 'joint')}
          onClick={() => {
            if (skeletonEditMode) return;
            selectBoneInBothStores(node.id);
          }}
        />
      );
    }
    if (skeletonEditMode) {
      // Label under each joint in edit mode for orientation
      const labelY = cy + radius + 11;
      const charWidth = 5.4; // estimate for small font
      const labelWidth = role.length * charWidth + 8;
      const labelHeight = 13;

      circles.push(
        <g key={`${role}-label`}>
          <rect
            x={cx - labelWidth / 2}
            y={labelY - 9.5}
            width={labelWidth}
            height={labelHeight}
            rx={4}
            fill="rgba(0,0,0,0.55)"
            pointerEvents="none"
          />
          <text
            x={cx} y={labelY}
            textAnchor="middle" fontSize={9}
            fill="white" pointerEvents="none"
            style={{ userSelect: 'none', fontWeight: 500 }}
          >
            {role}
          </text>
        </g>
      );
    }
  }

  const arcs = [];
  const trackpads = [];
  for (const [role, node] of Object.entries(boneNodes)) {
    if (role === 'eyes' && !skeletonEditMode) {
      // 2D trackpad slider for eyes
      const parentId = node.parent;
      let pwm = mat3Identity();
      if (parentId && worldMap.has(parentId)) {
         pwm = worldMap.get(parentId);
      }
      const bx = pwm[0] * node.transform.pivotX + pwm[3] * node.transform.pivotY + pwm[6];
      const by = pwm[1] * node.transform.pivotX + pwm[4] * node.transform.pivotY + pwm[7];
      
      const cx = bx * zoom + panX;
      const cy = by * zoom + panY;
      
      const TP_OFFSET_X = 0;
      const TP_OFFSET_Y = -120;
      const tpx = cx + TP_OFFSET_X;
      const tpy = cy + TP_OFFSET_Y;
      
      const TP_SIZE = 80;
      const half = TP_SIZE / 2;
      const MAX_OFFSET = 40;

      // Knob position. Post-Init-Rig (rigSpec present) the trackpad
      // controls ParamEyeBallX/Y; pre-Init-Rig it falls back to the
      // eye-group's pose offset for a worldMatrix-based preview.
      let ex, ey;
      if (hasRigSpec) {
        ex =  (paramEyeBallX ?? 0) * MAX_OFFSET;
        ey = -(paramEyeBallY ?? 0) * MAX_OFFSET;  // ParamEyeBallY positive = look up; screen-y inverts
      } else {
        ex = node.pose?.x ?? 0;
        ey = node.pose?.y ?? 0;
      }

      const knobX = tpx + (ex / MAX_OFFSET) * half;
      const knobY = tpy + (ey / MAX_OFFSET) * half;
      
      const isActive = dragRef.current?.type === 'trackpad' && dragRef.current?.nodeId === node.id;
      
      trackpads.push(
        <g key={`trackpad-${role}`}>
          <text x={tpx} y={tpy - half - 8} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.8)" style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}>
            Iris Offset
          </text>
          <rect
             x={tpx - half} y={tpy - half} width={TP_SIZE} height={TP_SIZE} rx={8}
             fill="rgba(20,20,20,0.75)" stroke="rgba(255,255,255,0.2)" strokeWidth={1}
             style={{ cursor: 'crosshair', pointerEvents: 'visiblePainted' }}
             onPointerDown={(e) => onPointerDown(e, node.id, 'trackpad')}
          />
          <line x1={tpx} y1={tpy - half} x2={tpx} y2={tpy + half} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <line x1={tpx - half} y1={tpy} x2={tpx + half} y2={tpy} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <circle
             cx={knobX} cy={knobY} r={isActive ? 8 : 6}
             fill={isActive ? '#22d3ee' : '#facc15'}
             style={{ pointerEvents: 'none' }}
          />
        </g>
      );
      continue;
    }

    // Render arcs ONLY in Pose Mode. Object Mode shows joint dots for
    // selection but no rotation handles. (Earlier code rendered arcs
    // ONLY in Object Mode — opposite of Blender; flipped 2026-05-06.)
    if (!ARC_BONE_ROLES.has(role) || !skeletonEditMode) continue;
    // Every bone in ARC_BONE_ROLES is draggable and visibly responds:
    // bones with a `ParamRotation_<role>` deformer drive their param
    // and the rig moves via chainEval; bones without a deformer write
    // `node.transform.rotation` and the post-rig bone overlay matrix
    // (renderer/boneOverlayMatrix.js) folds it into canvas-space verts.
    // Pre-Init-Rig the same `node.transform.rotation` propagates via
    // worldMatrix on non-rig-driven parts. Either way the gesture is
    // never silent.
    const [cx, cy] = pivotScreenPos(node);
    const wm = worldMap.get(node.id) ?? mat3Identity();
    // Orient gap along local Y-axis (upward from pivot)
    const arcOrientDeg = Math.atan2(wm[4], wm[3]) * (180 / Math.PI) - 90;
    const isActive = dragRef.current?.type === 'rotate' && dragRef.current?.nodeId === node.id;
    arcs.push(
      <path key={`arc-${role}`}
        d={arcPath(cx, cy, ARC_RADIUS, arcOrientDeg, ARC_SWEEP_DEG)}
        fill="none"
        stroke={isActive ? ARC_ACTIVE : ARC_COLOUR}
        strokeWidth={ARC_STROKE_W}
        strokeLinecap="round"
        style={{ cursor: 'alias', pointerEvents: 'visibleStroke' }}
        onPointerDown={(e) => onPointerDown(e, node.id, 'rotate')}
      />
    );
  }

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {arcs}
        {lines}
        {circles}
        {trackpads}
      </svg>

      {/* Wizard-only instruction banner. The PSD import wizard renders its
          own toolbar (`PsdImportWizard.jsx` Step 3), so we DO NOT render
          this duplicate during the wizard either — keep this component
          quiet and let the wizard own its chrome. Pose / Armature Edit
          modes get their hints via the N-panel ModeHint + ModePill. */}
    </>
  );
}
