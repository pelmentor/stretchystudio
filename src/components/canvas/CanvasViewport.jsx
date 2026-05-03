import { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useParamValuesStore } from '@/store/paramValuesStore';
import { useRigSpecStore } from '@/store/rigSpecStore';
import { useUIV3Store } from '@/store/uiV3Store';
import { useSelectionStore } from '@/store/selectionStore';
// Workspace policy module deleted 2026-05-02 — workspaces no longer
// gate modes or visualizations (Blender pattern: workspace = layout
// preset + default editorMode, nothing more). `editor.editMode` and
// `editor.viewLayers` are read directly.
import { evalRig } from '@/io/live2d/runtime/evaluator/chainEval';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
} from '@/io/live2d/runtime/physicsTick';
import { computePoseOverrides, computeParamOverrides, KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe } from '@/renderer/animationEngine';
import { ScenePass } from '@/renderer/scenePass';
import { importPsd } from '@/io/psd';
import { detectCharacterFormat } from '@/io/armatureOrganizer';
import SkeletonOverlay from '@/components/canvas/SkeletonOverlay';
import { useWizardStore } from '@/store/wizardStore';
import { useCaptureStore } from '@/store/captureStore';
import * as PsdImportService from '@/services/PsdImportService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { computeWorldMatrices, mat3Inverse, mat3Identity } from '@/renderer/transforms';
import { assertPartId } from '@/lib/partId';
import { uid } from '@/lib/ids';
import { logger } from '@/lib/logger';
import {
  clientToCanvasSpace,
  worldToLocal,
  findNearestVertex,
  brushWeight,
  sampleAlpha,
  computeImageBounds,
  basename,
  computeSmartMeshOpts,
  zoomAroundCursor,
} from '@/components/canvas/viewport/helpers';
import { hitTestParts } from '@/io/hitTest';
import { captureExportFrame as captureExportFrameImpl } from '@/components/canvas/viewport/captureExportFrame';
import {
  getOrBuildAdjacency,
  computeProportionalWeights,
  nextFalloff,
} from '@/lib/proportionalEdit';
import {
  childBoneRoleFor,
  computeSkinWeights,
  computeMeshCentroid,
} from '@/components/canvas/viewport/meshPostProcess';
import { routeImport } from '@/components/canvas/viewport/fileRouting';
import { findAncestorGroupsForCleanup } from '@/components/canvas/viewport/rigGroupCleanup';
import { applySplits } from '@/components/canvas/viewport/applySplits';
import { retriangulate } from '@/mesh/generate';
import { GizmoOverlay } from '@/components/canvas/GizmoOverlay';
import { saveProject, loadProject } from '@/io/projectFile';
import { normalizeVariants } from '@/io/variantNormalizer';
import { resetPoseDraft, resetToRestPose } from '@/services/PoseService';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { RotateCcw } from 'lucide-react';

/* ──────────────────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────────────────── */

export default function CanvasViewport({
  // Imperative refs are populated by `<CanvasArea>` (shell/CanvasArea.jsx),
  // which hosts a single CanvasViewport instance shared between the
  // `viewport` and `livePreview` tabs. External code (Inspector remesh,
  // save/load toolbar, export pipeline, thumbnail capture) drives viewport-
  // owned actions through these refs. Every `*Ref.current = …` assignment
  // site is guarded `if (xxxRef)`, so omission is safe.
  remeshRef = null, deleteMeshRef = null,
  saveRef = null, loadRef = null, resetRef = null,
  exportCaptureRef = null, thumbCaptureRef = null,
  previewMode = false,
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  const workersRef = useRef(new Map());  // Map<partId, Worker> for concurrent mesh generation
  const lastUploadedSourcesRef = useRef(new Map()); // Map<partId, string> (source URI)
  const imageDataMapRef = useRef(new Map()); // Map<partId, ImageData> for alpha-based picking
  const dragRef = useRef(null);   // { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY }
  const panRef = useRef(null);   // { startX, startY, panX0, panY0 }
  // Phase 5 touch+pen — multi-pointer tracking. activePointersRef holds every
  // pointer currently down (mouse / touch / pen) so we can detect 2-finger
  // pinch. gestureRef is non-null only while a multi-touch gesture is running.
  const activePointersRef = useRef(new Map());  // Map<pointerId, {x,y,type}>
  const gestureRef = useRef(null);  // { mode:'pinch', startDist, startMidX, startMidY, panX0, panY0, zoom0 }
  const isDirtyRef = useRef(true);
  const brushCircleRef = useRef(null);   // SVG <circle> for brush cursor — mutated directly for perf
  const propEditCircleRef = useRef(null); // GAP-015 — proportional-edit influence ring
  // PP1-008(b) — F→scroll→click radius adjust mode. While `active`, wheel
  // events update proportionalEdit.radius and the next click commits +
  // exits. ESC restores `startRadius` and exits without committing.
  // `anchorClientX/Y` is captured at F-press for the Blender-faithful
  // cursor-distance gesture (radius = distance(cursor, anchor) / zoom).
  // Lives in a ref so the wheel/pointer handlers see the live state
  // without triggering re-renders on every frame.
  const radiusAdjustModeRef = useRef({
    active: false,
    startRadius: null,
    anchorClientX: null,
    anchorClientY: null,
  });
  // Latest pointer position over the canvas, refreshed on every move so
  // F-press can snapshot it as the radius-adjust anchor. Lives outside
  // React to avoid re-rendering on mouse movement.
  const lastCursorRef = useRef({ clientX: 0, clientY: 0 });
  const meshOverriddenParts = useRef(new Set()); // parts whose GPU mesh was overridden last frame
  const fileInputRef = useRef(null);

  // GAP-001 — PSD import wizard state lives in `wizardStore` and the
  // wizard component itself is mounted at AppShell level. This canvas
  // only retains the per-canvas drop confirmation dialog state.
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  const project = useProjectStore(s => s.project);
  const versionControl = useProjectStore(s => s.versionControl);
  const updateProject = useProjectStore(s => s.updateProject);
  const resetProject = useProjectStore(s => s.resetProject);
  const editorState = useEditorStore();
  const setBrush = useEditorStore(s => s.setBrush);
  const { setSelection } = editorState;

  // GAP-010 Phase B — `view` is per-mode. CanvasViewport derives its
  // mode from the `previewMode` prop and routes every read/write
  // through `viewByMode[modeKey]` / `setView(modeKey, partial)`.
  const modeKey = previewMode ? 'livePreview' : 'viewport';
  // PP2-007 — the WebGL init `useEffect(..., [])` captures `modeKey`
  // in its rAF-tick closure once at mount. CanvasArea reuses the same
  // CanvasViewport instance for both Viewport and Live Preview tabs
  // (so the GL context survives tab toggles); without a ref, the tick
  // keeps reading `viewByMode[<initial modeKey>]` while the pan/zoom
  // handlers correctly write to `viewByMode[<current modeKey>]`.
  // Result: gestures land in the right slot but the renderer reads
  // from the wrong one — pan/zoom feel dead. The ref lets the tick
  // re-read the current key on every frame.
  const modeKeyRef = useRef(modeKey);
  modeKeyRef.current = modeKey;
  const view = editorState.viewByMode[modeKey];
  /** @param {{zoom?:number,panX?:number,panY?:number}} partial */
  const setView = useCallback(
    (partial) => editorState.setView(modeKey, partial),
    [modeKey, editorState.setView],
  );
  const { themeMode, osTheme } = useTheme();

  const animStore = useAnimationStore();
  const animRef = useRef(animStore);
  animRef.current = animStore;

  // R0 — live param values from the rig evaluator (drives the test slider).
  // Consumed by the tick directly via ref; effect below marks dirty on change.
  const paramValues = useParamValuesStore(s => s.values);
  const paramValuesRef = useRef(paramValues);
  paramValuesRef.current = paramValues;

  // R6 — rigSpec session cache (built by v3 ParametersEditor's "Initialize Rig" button).
  // When non-null, the tick runs the full evaluator chain instead of
  // R0's hardcoded test translation.
  const rigSpec = useRigSpecStore(s => s.rigSpec);
  const rigSpecRef = useRef(rigSpec);
  rigSpecRef.current = rigSpec;

  // Active workspace — only used for the proportional-edit gate now
  // (deletion of `workspaceViewportPolicy` 2026-05-02 means no other
  // call sites read this). Workspaces are layout-only; modes are
  // independent.
  const activeWorkspace = useUIV3Store((s) => s.activeWorkspace);
  const activeWorkspaceRef = useRef(activeWorkspace);
  activeWorkspaceRef.current = activeWorkspace;

  // GAP-010 — Live Preview surface gate. When this CanvasViewport instance
  // is mounted by `<LivePreviewCanvas>`, `previewMode` is true: live drivers
  // (physics + breath + cursor look) run continuously while this instance
  // is alive, and editing affordances (mesh edit, drag-to-pivot, gizmo,
  // skeleton overlay, wizard, drop hint, brush) are suppressed. The plain
  // viewport editor mounts with `previewMode=false` and never runs drivers
  // or shows the cursor-look LMB cursor — its only job is static editing.
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;

  // R9 — pendulum physics state. Recreated whenever the rigSpec
  // changes (auto-invalidated by rigSpecStore on geometry edits).
  // `physicsStateRef.current` is null when there's no rigSpec or when
  // `rigSpec.physicsRules` is empty.
  const physicsStateRef = useRef(null);
  const physicsRigSpecRef = useRef(null);            // rigSpec object ref the state was built against
  const physicsParamSpecsRef = useRef(null);         // memoised paramSpecs map
  const lastPhysicsTimestampRef = useRef(0);         // last rAF timestamp physics consumed

  // GAP-010 — Live Preview drivers (physics + breath + cursor look). These
  // refs are only meaningful when `previewMode` is true (i.e. this instance
  // is the LivePreviewCanvas surface). breathPhase advances 2π every
  // `BREATH_CYCLE_SEC` and feeds `0.5 + 0.5*sin(phase)` into ParamBreath.
  // lookRef tracks LMB-cursor position for the same tick.
  const breathPhaseRef = useRef(0);
  const lookRef = useRef({ active: false, clientX: 0, clientY: 0 });
  // Cubism-style damped follow target. CubismTargetPoint pattern:
  // when LMB is held, target = normalized cursor; on release, target
  // snaps to (0, 0) so the head/iris/body smoothly damp toward
  // neutral over ~half a second. Without this the character froze
  // at the last cursor position instead of returning to rest pose
  // like Cubism Viewer does.
  const lookDampRef = useRef({ x: 0, y: 0 });

  // Phase -1D — set of partIds that evalRig produced but no node
  // matched. Used to dedupe console warnings (only log once per ID
  // per session). Cleared on rigSpec change so a fresh init is loud
  // again.
  const missingFrameIds = useRef(new Set());

  // R10 — evalRig memoization. The chain evaluator is cheap (~0.1
  // ms/frame on a Hiyori-scale rig) but it's still wasted work when
  // nothing's moving (camera pan, overlay toggle, animation tick that
  // didn't actually advance, …). When the (rigSpec, paramValues)
  // pair is identity-stable since the last evalRig call, reuse the
  // cached frames and skip the recompute.
  const lastEvalCacheRef = useRef({ rigSpec: null, paramValues: null, frames: null });
  // BUG-015 instrumentation — throttle for the BodyAngle eval-watch log.
  const lastBodyAngleLogTimestampRef = useRef(0);

  // Stable refs for imperative callbacks
  const editorRef = useRef(editorState);
  const projectRef = useRef(project);
  const isDark = themeMode === 'system' ? osTheme === 'dark' : themeMode === 'dark';
  const isDarkRef = useRef(isDark);

  // Update refs synchronously in render to ensure event handlers see latest state
  editorRef.current = editorState;
  projectRef.current = project;
  isDarkRef.current = isDark;

  useEffect(() => { isDirtyRef.current = true; }, [project, isDark]);
  useEffect(() => { isDirtyRef.current = true; }, [paramValues]);
  useEffect(() => {
    isDirtyRef.current = true;
    // Phase -1D: reset the missing-frame warning dedupe so a fresh
    // Initialize Rig (or rigSpec replacement) re-surfaces any partId
    // mismatches.
    missingFrameIds.current.clear();
  }, [rigSpec]);

  // BUG-020 — flip the dirty bit on every CSS-box change so the next
  // rAF tick re-runs `scenePass.draw`, which re-syncs `canvas.width`
  // / `canvas.height` to the new client size. Without this the
  // drawingbuffer stays at the previous size and the browser stretches
  // the bitmap to fit the new CSS box → visible aspect distortion
  // during a panel-resize drag (`react-resizable-panels` resizes the
  // wrapper but never tells us). Also covers DPR changes when the
  // window crosses between monitors with different scaling — the
  // resulting client-size delta surfaces the same way.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      isDirtyRef.current = true;
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  
  /* ── GPU Sync: Ensure nodes in store have matching WebGL resources ── */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const node of project.nodes) {
      if (node.type !== 'part') continue;

      // 1. Texture Sync
      const texEntry = project.textures.find(t => t.id === node.id);
      if (texEntry) {
        const isUploaded = scene.parts.hasTexture(node.id);
        const lastSource = lastUploadedSourcesRef.current.get(node.id);
        const sourceChanged = lastSource !== texEntry.source;

        if (!isUploaded || sourceChanged) {
          const sourceToUpload = texEntry.source;
          const img = new Image();
          img.onload = () => {
            // Check if node still exists and still lacks texture or source changed (concurrency)
            if (sceneRef.current?.parts) {
              const currentTex = projectRef.current.textures.find(t => t.id === node.id);
              if (currentTex?.source === sourceToUpload) {
                sceneRef.current.parts.uploadTexture(node.id, img);
                lastUploadedSourcesRef.current.set(node.id, sourceToUpload);
                
                // Maintain imageDataMapRef for alpha picking
                const off = document.createElement('canvas');
                off.width = img.width; off.height = img.height;
                const ctx = off.getContext('2d');
                ctx.drawImage(img, 0, 0);
                imageDataMapRef.current.set(node.id, ctx.getImageData(0, 0, img.width, img.height));
                
                isDirtyRef.current = true;
              }
            }
          };
          img.src = sourceToUpload;
        }
      }

      // 2. Mesh Sync
      if (!scene.parts.hasMesh(node.id)) {
        if (node.mesh) {
          scene.parts.uploadMesh(node.id, node.mesh);
          isDirtyRef.current = true;
        } else if (node.imageWidth && node.imageHeight) {
          scene.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
          isDirtyRef.current = true;
        }
      }
    }
  }, [project.nodes, project.textures, versionControl.textureVersion]);

  const centerView = useCallback((contentW, contentH) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (vw === 0 || vh === 0) return;

    const zoom = editorRef.current.viewByMode[modeKey].zoom;
    setView({
      panX: vw / 2 - (contentW / 2) * zoom,
      panY: vh / 2 - (contentH / 2) * zoom,
    });
    isDirtyRef.current = true;
  }, [setView, modeKey]);

  // Auto-center view when entering the reorder or adjust steps.
  // GAP-001 — wizard state moved to wizardStore (was editorStore + local).
  const _wizardStep = useWizardStore((s) => s.step);
  const _wizardPsd  = useWizardStore((s) => s.pendingPsd);
  useEffect(() => {
    if (_wizardStep === 'reorder' || _wizardStep === 'adjust') {
      const { psdW, psdH } = _wizardPsd || {};
      if (psdW && psdH) {
        // Wait a tick for sidebars to appear/animate before centering
        const timer = setTimeout(() => {
          centerView(psdW, psdH);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [_wizardStep, _wizardPsd, centerView]);

  // Center view on initial mount
  useEffect(() => {
    const cw = projectRef.current.canvas.width;
    const ch = projectRef.current.canvas.height;
    // Use a small timeout to ensure the layout has settled and clientWidth/Height are correct
    const timer = setTimeout(() => centerView(cw, ch), 50);
    return () => clearTimeout(timer);
  }, [centerView]);

  /* ── WebGL init ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, stencil: true, preserveDrawingBuffer: true });
    if (!gl) { console.error('[CanvasViewport] WebGL2 not supported'); return; }

    try {
      sceneRef.current = new ScenePass(gl);
    } catch (err) {
      console.error('[CanvasViewport] ScenePass init failed:', err);
      return;
    }

    // BUG-001 instrumentation — log GL context init + cleanup so the
    // recurring "character disappears on workspace switch" report can
    // be traced. Every Viewport mount creates a new GL context (the
    // previous one's textures + scene state are gone); the disappear
    // symptom is consistent with this when we don't re-upload after
    // workspace re-mount. The Logs panel will show whether mount fires
    // on the disappear repro.
    logger.debug('viewportGL', 'WebGL2 context initialised', {
      contextLost: gl.isContextLost?.() ?? false,
      glVersion: gl.getParameter(gl.VERSION),
      glRenderer: gl.getParameter(gl.RENDERER),
    });

    const tick = (timestamp) => {
      // Advance animation playback and mark dirty if time moved
      const moved = animRef.current.tick(timestamp);
      if (moved) isDirtyRef.current = true;

      // GAP-010 — Live Preview drivers gate. Physics, breath, and cursor
      // head-tracking only run when this CanvasViewport instance was
      // mounted in `previewMode` (i.e. it's the LivePreviewCanvas surface).
      // The plain Viewport editor passes `previewMode=false` and stays
      // static so the user can scrub a parameter slider without the dial
      // bouncing under live drivers. Drivers are bound to the surface's
      // mount lifetime — closing the Live Preview tab stops every driver.
      let valuesForEval = paramValuesRef.current;
      const _rigSpecForPhysics = rigSpecRef.current;
      const physicsRules = _rigSpecForPhysics?.physicsRules;
      const livePreview = previewModeRef.current;

      // Animation mode — overlay parameter keyforms from the timeline
      // BEFORE live-preview drivers run. computeParamOverrides walks
      // tracks where `paramId` is set (Live2D parameter curves —
      // motion3json + can3writer already export these); the result is
      // merged into the working values so chainEval sees the animated
      // dial position. We also push the merged values into
      // paramValuesStore so the ParametersEditor sliders track playback.
      if (editorRef.current.editorMode === 'animation') {
        const _anim = animRef.current;
        const _proj = projectRef.current;
        const _activeAnim = _proj.animations.find((a) => a.id === _anim.activeAnimationId) ?? null;
        if (_activeAnim) {
          const _endMs = (_anim.endFrame / _anim.fps) * 1000;
          const paramOv = computeParamOverrides(_activeAnim, _anim.currentTime, _anim.loopKeyframes, _endMs);
          if (paramOv.size > 0) {
            const merged = { ...valuesForEval };
            const updates = {};
            for (const [paramId, val] of paramOv) {
              if (merged[paramId] !== val) updates[paramId] = val;
              merged[paramId] = val;
            }
            valuesForEval = merged;
            if (Object.keys(updates).length > 0) {
              useParamValuesStore.getState().setMany(updates);
              isDirtyRef.current = true;
            }
          }
        }
      }

      if (livePreview) {
        const updates = {};

        // Breath — auto-cycle ParamBreath. Period matches Cubism Web
        // Framework's `CubismBreath` standard wiring for ParamBreath
        // (cycle=3.2345s, offset=0.5, peak=0.5) so our live preview
        // stays phase-synced with Cubism Viewer running the same model.
        // Phase advances by dt; offset 0.5, amplitude 0.5 so the curve
        // sits in [0,1]. Free-runs across mounts so toggling Live
        // Preview off/on doesn't snap the breath back to phase 0.
        if (lastPhysicsTimestampRef.current !== 0) {
          const dtBreath = Math.min(0.5, Math.max(0, (timestamp - lastPhysicsTimestampRef.current) / 1000));
          breathPhaseRef.current += dtBreath * (2 * Math.PI / 3.2345);
        }
        const breathV = 0.5 + 0.5 * Math.sin(breathPhaseRef.current);
        updates.ParamBreath = breathV;

        // Cursor look — Cubism-style damped follow. CubismTargetPoint:
        // target = normalized cursor while LMB is held, target = (0,0)
        // on release. Damped value chases target each frame; on
        // release the head/iris/body smoothly return to rest pose.
        // Half-life ≈ 100ms with a per-frame damping factor that's
        // dt-aware so behaviour is frame-rate independent.
        //
        //   ParamAngleX/Y/Z  ±30°  (head turn / tilt / roll)
        //   ParamEyeBallX/Y  ±1    (iris follows the same target)
        //   ParamBodyAngleX/Y/Z  ±10°  (body leans 1/3 of head)
        //
        // Without damping the character froze at the last cursor
        // position when the user released LMB; user 2026-05-02
        // wanted Cubism Viewer parity ("matches cubism behaviour
        // PERFECTLY") which means smooth return to neutral.
        let targetX = 0;
        let targetY = 0;
        if (lookRef.current.active && canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const nx = ((lookRef.current.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = ((lookRef.current.clientY - rect.top) / rect.height) * 2 - 1;
            targetX = Math.max(-1, Math.min(1, nx));
            targetY = Math.max(-1, Math.min(1, ny));
          }
        }
        // Per-frame damping. half-life = 0.1s → α = 1 - 0.5^(dt/half).
        // dt comes from the same lastPhysicsTimestampRef the breath
        // cycle uses; on the very first frame dt is 0 (no movement).
        const _dtLook = lastPhysicsTimestampRef.current !== 0
          ? Math.min(0.5, Math.max(0, (timestamp - lastPhysicsTimestampRef.current) / 1000))
          : 0;
        const _alpha = 1 - Math.pow(0.5, _dtLook / 0.1);
        lookDampRef.current.x += (targetX - lookDampRef.current.x) * _alpha;
        lookDampRef.current.y += (targetY - lookDampRef.current.y) * _alpha;
        const cx = lookDampRef.current.x;
        const cy = lookDampRef.current.y;
        updates.ParamAngleX = cx * 30;
        updates.ParamAngleY = -cy * 30; // cursor up → look up
        updates.ParamAngleZ = cx * 30;
        updates.ParamEyeBallX = cx;
        updates.ParamEyeBallY = -cy; // cursor up → iris up
        updates.ParamBodyAngleX = cx * 10;
        updates.ParamBodyAngleY = -cy * 10;
        updates.ParamBodyAngleZ = cx * 10;

        // Physics — rebuild state on rigSpec identity change, then
        // integrate one tick and queue outputs that actually moved.
        if (Array.isArray(physicsRules) && physicsRules.length > 0) {
          if (physicsRigSpecRef.current !== _rigSpecForPhysics) {
            physicsStateRef.current = createPhysicsState(physicsRules);
            physicsParamSpecsRef.current = buildParamSpecs(
              _rigSpecForPhysics.parameters?.length
                ? _rigSpecForPhysics.parameters
                : projectRef.current.parameters,
            );
            physicsRigSpecRef.current = _rigSpecForPhysics;
            lastPhysicsTimestampRef.current = timestamp;
          }
          const lastTs = lastPhysicsTimestampRef.current || timestamp;
          const dtSec = Math.min(0.5, Math.max(0, (timestamp - lastTs) / 1000));

          // Apply breath/look updates onto the working copy BEFORE
          // physics runs so pendulum rules see the live driver values
          // (e.g. body sway can react to head-turn).
          const working = { ...paramValuesRef.current, ...updates };
          const r = tickPhysics(
            physicsStateRef.current,
            physicsRules,
            working,
            physicsParamSpecsRef.current,
            dtSec,
          );
          if (r.outputsChanged > 0) {
            for (const rule of physicsRules) {
              for (const out of rule.outputs ?? []) {
                if (!out?.paramId) continue;
                if (working[out.paramId] !== paramValuesRef.current[out.paramId]) {
                  updates[out.paramId] = working[out.paramId];
                }
              }
            }
          }
          valuesForEval = working;
        } else {
          // No physics rules — just merge the breath/look updates into
          // the eval snapshot for this frame.
          valuesForEval = { ...paramValuesRef.current, ...updates };
          physicsRigSpecRef.current = null;
          physicsStateRef.current = null;
        }

        lastPhysicsTimestampRef.current = timestamp;

        if (Object.keys(updates).length > 0) {
          useParamValuesStore.getState().setMany(updates);
          isDirtyRef.current = true;
        }
      } else {
        // Edit mode — reset physics state + clock so a future toggle
        // back to live preview starts clean (no accumulated dt jump).
        physicsRigSpecRef.current = null;
        physicsStateRef.current = null;
        lastPhysicsTimestampRef.current = 0;
      }

      if (isDirtyRef.current && sceneRef.current) {
        // Compute pose overrides from current animation state
        const anim = animRef.current;
        const proj = projectRef.current;
        const activeAnim = proj.animations.find(a => a.id === anim.activeAnimationId) ?? null;

        let poseOverrides = null;
        if (editorRef.current.editorMode === 'animation') {
          // Base: keyframe-interpolated values
          const endMs = (anim.endFrame / anim.fps) * 1000;
          poseOverrides = computePoseOverrides(activeAnim, anim.currentTime, anim.loopKeyframes, endMs);
          // Overlay: draftPose (uncommitted drag) takes priority
          if (anim.draftPose.size > 0) {
            poseOverrides = new Map(poseOverrides);
            for (const [nodeId, draft] of anim.draftPose) {
              const existing = poseOverrides.get(nodeId) ?? {};
              poseOverrides.set(nodeId, { ...existing, ...draft });
            }
          }
        }

        // Always apply draftPose mesh_verts for GPU upload — this handles elbow/knee skinning
        // in staging mode where poseOverrides would otherwise be null.
        if (anim.draftPose.size > 0) {
          for (const [nodeId, draft] of anim.draftPose) {
            if (!draft.mesh_verts) continue;
            if (!poseOverrides) poseOverrides = new Map();
            // Don't clobber transform overrides already set by animation mode above
            const existing = poseOverrides.get(nodeId) ?? {};
            if (!existing.mesh_verts) poseOverrides.set(nodeId, { ...existing, mesh_verts: draft.mesh_verts });
          }
        }

        // R6 — Native rig evaluation. When a rigSpec is cached, walk every
        // art mesh's parent chain (warp/rotation deformers) under current
        // paramValues and produce final canvas-px vertex positions. The
        // result feeds poseOverrides.mesh_verts so subsequent passes
        // (blendShape, puppet warp) compose ON TOP rather than starting
        // from rest. Skipped entirely when rigSpec is null (user hasn't
        // clicked Initialize Rig yet, or just clicked Clear).
        //
        // -1B fix: evalRig output is in canvas-px (absolute), but
        // scenePass normally applies `worldMatrix(part)` at draw time
        // (part's PSD-derived translation/rotation/scale). For
        // rig-driven verts that's a double transform — arms fly off,
        // pieces shrink. We collect the set of parts that are rig-only
        // and pass it down so scenePass uses identity matrix for them.
        // Parts that subsequently get blend-shape or puppet-warp output
        // composed on top get removed from the set (their final verts
        // mix part-local deltas in, so worldMatrix application is the
        // closest-correct behavior; mixed-mode composition is a Phase 0
        // coord-space refactor concern, not -1B scope).
        const rigDrivenParts = new Set();
        const _rigSpec = rigSpecRef.current;
        if (_rigSpec && Array.isArray(_rigSpec.artMeshes) && _rigSpec.artMeshes.length > 0) {
          // valuesForEval == post-physics working copy when physics ran
          // this frame, otherwise the unchanged store snapshot. The
          // memoization below is identity-keyed: physics' working copy
          // is a fresh `{...}` each frame so it always misses (correct
          // — outputs changed); the static snapshot reuses the same
          // store object until setParamValue/setMany fires.
          const cache = lastEvalCacheRef.current;
          let frames;
          if (cache.rigSpec === _rigSpec && cache.paramValues === valuesForEval && cache.frames !== null) {
            frames = cache.frames;
          } else {
            frames = evalRig(_rigSpec, valuesForEval);
            lastEvalCacheRef.current = { rigSpec: _rigSpec, paramValues: valuesForEval, frames };
            // BUG-015 instrumentation — once-per-second snapshot of the
            // ParamBodyAngle{X,Y,Z} values that just went into evalRig +
            // the resulting top-row vertex displacement on a sentinel
            // mesh. Helps the user repro "BodyAngle slider doesn't move
            // anything" by showing: did evalRig see the user's slider
            // write? did it produce a non-zero output? Throttled so a
            // continuous param sweep doesn't drown the Logs panel.
            const _now = timestamp;
            if (_now - lastBodyAngleLogTimestampRef.current > 1000) {
              const bz = valuesForEval.ParamBodyAngleZ ?? 0;
              const by = valuesForEval.ParamBodyAngleY ?? 0;
              const bx = valuesForEval.ParamBodyAngleX ?? 0;
              if (bz !== 0 || by !== 0 || bx !== 0) {
                logger.debug('evalRigBodyAngle',
                  `evalRig sees BodyAngle X=${bx.toFixed(2)} Y=${by.toFixed(2)} Z=${bz.toFixed(2)}`,
                  {
                    paramBodyAngleX: bx,
                    paramBodyAngleY: by,
                    paramBodyAngleZ: bz,
                    livePreview: previewModeRef.current,
                    frameCount: frames.length,
                  });
                lastBodyAngleLogTimestampRef.current = _now;
              }
            }
          }
          // PP1-008(a) — while the user is mesh-editing a part, skip the
          // rig override for THAT part so their vertex edits are visible
          // immediately. evalRig walks rigSpec.artMeshes baked at Init Rig
          // time; once the user moves a vertex those keyforms are stale,
          // and the rig override would re-upload the stale verts every
          // frame, hiding the edit. Re-baking the keyforms mid-drag is
          // expensive — the V3 re-rig flow's Refit All (or per-stage
          // rebake) is the path to refresh the rig once the user is done.
          // Other parts stay on rig output as usual; only the selected
          // part being edited drops out.
          const _ed_mesh = editorRef.current;
          const _meshEditingPartId =
            (_ed_mesh.editMode === 'mesh' && Array.isArray(_ed_mesh.selection) && _ed_mesh.selection.length > 0)
              ? _ed_mesh.selection[0]
              : null;
          for (const f of frames) {
            assertPartId(f.id, 'evalRig frame.id');
            if (f.id === _meshEditingPartId) continue;
            const node = projectRef.current.nodes.find(n => n.id === f.id);
            if (!node?.mesh) {
              // Phase -1D: log once per missing partId in dev so the
              // crisis class (frame.id ≠ any node.id) stops being
              // silent. Production builds skip without noise.
              if (import.meta.env?.DEV && !missingFrameIds.current.has(f.id)) {
                missingFrameIds.current.add(f.id);
                console.warn(
                  `[evalRig] frame partId ${JSON.stringify(f.id)} has no matching node — frame dropped`,
                );
              }
              continue;
            }
            // Convert flat Float32Array [x,y, ...] → Array<{x, y}> for the
            // existing GPU upload pipeline.
            const verts = new Array(f.vertexPositions.length / 2);
            for (let i = 0; i < verts.length; i++) {
              verts[i] = { x: f.vertexPositions[i * 2], y: f.vertexPositions[i * 2 + 1] };
            }
            if (!poseOverrides) poseOverrides = new Map();
            const existing = poseOverrides.get(f.id) ?? {};
            // Don't overwrite an animation/draft override that's already there;
            // those are the user's explicit edit. Rig eval is the default base.
            if (!existing.mesh_verts) {
              const update = { ...existing, mesh_verts: verts };
              // Variant fade fix (2026-04-29): chainEval returns a per-mesh
              // opacity from cellSelect-blended keyforms (variant fade-in,
              // base crossfade-out, etc). Without writing it to poseOverrides
              // the renderer falls back to `node.opacity = 1`, so the variant
              // mesh is permanently visible at full opacity regardless of
              // Param<Suffix>. Honor existing.opacity if a draft/keyframe
              // already set it.
              if (existing.opacity === undefined && typeof f.opacity === 'number') {
                update.opacity = f.opacity;
              }
              poseOverrides.set(f.id, update);
              rigDrivenParts.add(f.id);
            }
          }
        }

        // Apply blend shapes — compute blended vertex positions for nodes with active influences.
        // Composition note (R6 fix): start from any existing `mesh_verts`
        // (rig eval / draft / animation) and add blend deltas on top.
        // Previously this loop always started from `v.restX, v.restY` and
        // overwrote any prior mesh_verts — that's wrong once rig eval is
        // active because it reverts the rig deformation.
        const ed = editorRef.current;
        for (const node of projectRef.current.nodes) {
          if (node.type !== 'part' || !node.mesh || !node.blendShapes?.length) continue;
          const draft = anim.draftPose.get(node.id);
          const kfOv = poseOverrides?.get(node.id);

          let hasInfluence = false;
          const influences = node.blendShapes.map(shape => {
            // During blend-shape edit mode, always show the active shape
            // at full influence so the user paints visible deltas.
            if (ed.editMode === 'blendShape' && ed.activeBlendShapeId === shape.id) {
              hasInfluence = true;
              return 1.0;
            }
            const prop = `blendShape:${shape.id}`;
            const v = draft?.[prop] ?? kfOv?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
            if (v !== 0) hasInfluence = true;
            return v;
          });
          if (!hasInfluence) continue;

          // Read current verts (rig-eval / draft / etc.) or fall back to rest.
          const baseVerts = kfOv?.mesh_verts ?? node.mesh.vertices;
          const blendedVerts = baseVerts.map((v, i) => {
            let bx = v.x ?? v.restX;
            let by = v.y ?? v.restY;
            for (let j = 0; j < node.blendShapes.length; j++) {
              const d = node.blendShapes[j].deltas[i];
              if (d) { bx += d.dx * influences[j]; by += d.dy * influences[j]; }
            }
            return { x: bx, y: by };
          });

          if (!poseOverrides) poseOverrides = new Map();
          const existing = poseOverrides.get(node.id) ?? {};
          poseOverrides.set(node.id, { ...existing, mesh_verts: blendedVerts });
          // -1B: blend overwrote rig-eval output → final verts now
          // include part-local deltas, so worldMatrix application is
          // the right call. Drop from rigDrivenParts.
          rigDrivenParts.delete(node.id);
        }

        // Upload mesh vertex overrides BEFORE drawing so the GPU buffers are
        // current for this frame's draw call. Previously uploads happened after
        // draw, causing a one-frame lag that made undo show the pre-undo mesh
        // for one frame (visible as a flicker when selection changes triggered
        // additional redraws).
        const newMeshOverridden = new Set();
        if (poseOverrides) {
          for (const [nodeId, ov] of poseOverrides) {
            if (!ov.mesh_verts) continue;
            newMeshOverridden.add(nodeId);
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            if (node?.mesh) {
              sceneRef.current.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(node.mesh.uvs));
            }
          }
        }
        for (const nodeId of meshOverriddenParts.current) {
          if (!newMeshOverridden.has(nodeId)) {
            // Override removed — restore base mesh from projectStore
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            if (node?.mesh) {
              sceneRef.current.parts.uploadPositions(nodeId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
            }
          }
        }
        meshOverriddenParts.current = newMeshOverridden;

        // GAP-010 Phase B — scenePass expects `editor.view` to be a
        // single per-frame view object; resolve it from this canvas's
        // active mode key. Workspace policy module deleted 2026-05-02:
        // viewLayers + editMode pass through unchanged.
        // PP2-007 — read modeKey via ref so this tick honours the
        // CURRENT preview/edit tab, not the one that was active at
        // mount time (CanvasArea shares this instance across tabs).
        const _ed = editorRef.current;
        const _modeKey = modeKeyRef.current;
        const editorForDraw = {
          ..._ed,
          view: _ed.viewByMode[_modeKey],
        };
        // PP2-008 — ParamOpacity is the canonical Live2D global-opacity
        // slider. Mesh keyform bindings can't drive it (their default is
        // a single keyform at 1.0), so it's applied as a uniform draw-
        // time multiplier instead.
        const _gOpacity = paramValuesRef.current?.ParamOpacity;
        const globalOpacity = (typeof _gOpacity === 'number') ? _gOpacity : 1;
        sceneRef.current.draw(projectRef.current, editorForDraw, isDarkRef.current, poseOverrides, { rigDrivenParts, globalOpacity });

        isDirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      // BUG-001 instrumentation — when the Viewport area re-mounts on
      // workspace/tab switch, we lose every GPU upload. Log so the
      // disappear-on-switch repro shows whether teardown is firing
      // adjacent to the user's switch.
      logger.debug('viewportGL', 'WebGL2 context destroyed (cleanup)', {
        scene: !!sceneRef.current,
      });
      cancelAnimationFrame(rafRef.current);
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, []);

  /* ── Mark dirty when editor view / viewLayers / selection changes ──── */
  useEffect(() => { isDirtyRef.current = true; },
    [view, editorState.selection, editorState.viewLayers,
    editorState.editMode, editorState.activeBlendShapeId]);

  /* ── PP2-007 — mark dirty when the canvas tab toggles (modeKey flips).
       The shared CanvasViewport instance has a different `view` slot per
       tab; without an explicit dirty flag the rAF tick happily re-uses
       its last-rendered output, so the freshly-active tab's pan/zoom
       state doesn't paint until something else triggers a redraw. */
  useEffect(() => { isDirtyRef.current = true; }, [modeKey]);

  /* ── Mark dirty when workspace changes (BUG-012 policy may flip) ─────── */
  useEffect(() => { isDirtyRef.current = true; }, [activeWorkspace]);

  /* ── Mark dirty when animation time or draft pose changes ───────────── */
  useEffect(() => { isDirtyRef.current = true; }, [animStore.currentTime]);
  useEffect(() => { isDirtyRef.current = true; }, [animStore.draftPose]);

  /* ── [ / ] brush size shortcuts (only in deform edit mode or blend shape edit mode) ────────────── */
  useEffect(() => {
    // GAP-010 — Live Preview surface is read-only; don't bind window-level
    // keyboard shortcuts on it (would also double-fire if both surfaces are
    // mounted simultaneously).
    if (previewMode) return;
    const handler = (e) => {
      const { editMode, meshSubMode, brushSize } = editorRef.current;
      const brushActive = (editMode === 'mesh' && meshSubMode === 'deform')
        || editMode === 'blendShape';
      if (!brushActive) return;
      if (e.key === '[') setBrush({ brushSize: Math.max(5, brushSize - 5) });
      else if (e.key === ']') setBrush({ brushSize: Math.min(300, brushSize + 5) });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setBrush, previewMode]);

  /* ── PP1-008(b) — exit F-mode radius adjust when leaving mesh edit ── */
  useEffect(() => {
    if (editorState.editMode !== 'mesh' && radiusAdjustModeRef.current.active) {
      radiusAdjustModeRef.current.active = false;
      radiusAdjustModeRef.current.startRadius = null;
      radiusAdjustModeRef.current.anchorClientX = null;
      radiusAdjustModeRef.current.anchorClientY = null;
      isDirtyRef.current = true;
    }
  }, [editorState.editMode]);

  /* ── GAP-015 — Blender-style proportional-edit hotkeys ───────────────── */
  // O           — toggle proportional editing on/off
  // Shift+O     — cycle falloff curve (smooth → sphere → root → linear → sharp → invSquare → constant)
  // Alt+O       — toggle connected-only mode
  // Ctrl+[ / ]  — shrink / grow proportional radius (mesh-local units)
  //
  // Only active when proportional editing makes sense: in Modeling/Rigging
  // workspaces, outside of input fields, and not on the Live Preview
  // surface. Brush mode keeps `[` / `]` for its own radius — Ctrl
  // disambiguates so the two coexist.
  useEffect(() => {
    if (previewMode) return;
    const handler = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      const ws = activeWorkspaceRef.current;
      if (ws !== 'default') return;
      const prefs = usePreferencesStore.getState();
      const setPE = prefs.setProportionalEdit;
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        const cur = prefs.proportionalEdit;
        if (e.shiftKey) {
          setPE({ falloff: nextFalloff(cur.falloff) });
          logger.debug('proportionalEdit', `falloff → ${nextFalloff(cur.falloff)}`);
        } else if (e.altKey) {
          setPE({ connectedOnly: !cur.connectedOnly });
          logger.debug('proportionalEdit', `connectedOnly → ${!cur.connectedOnly}`);
        } else {
          setPE({ enabled: !cur.enabled });
          logger.debug('proportionalEdit', `enabled → ${!cur.enabled}`);
        }
      } else if (e.ctrlKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const cur = prefs.proportionalEdit;
        const step = Math.max(5, cur.radius * 0.1);
        const next = e.key === '[' ? Math.max(5, cur.radius - step) : cur.radius + step;
        setPE({ radius: next });
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // PP1-008(b) — F enters radius-adjust mode. Only meaningful in
        // mesh edit; otherwise no-op (don't claim F globally). Captures
        // the current radius so ESC can restore it. The cursor anchor
        // is intentionally left null and snapshotted on the FIRST
        // pointermove after F-press — this avoids using the stale
        // (0,0) lastCursorRef when the user entered mesh-edit via the
        // outliner / ModePill without first hovering the canvas.
        // Toggling F again before committing exits without changing
        // radius. Wheel adjustments still work alongside the gesture.
        if (editorRef.current.editMode !== 'mesh') return;
        e.preventDefault();
        if (radiusAdjustModeRef.current.active) {
          radiusAdjustModeRef.current.active = false;
          radiusAdjustModeRef.current.startRadius = null;
          radiusAdjustModeRef.current.anchorClientX = null;
          radiusAdjustModeRef.current.anchorClientY = null;
        } else {
          radiusAdjustModeRef.current.active = true;
          radiusAdjustModeRef.current.startRadius = prefs.proportionalEdit.radius;
          radiusAdjustModeRef.current.anchorClientX = null;
          radiusAdjustModeRef.current.anchorClientY = null;
        }
        isDirtyRef.current = true;
      } else if (e.key === 'Escape' && radiusAdjustModeRef.current.active) {
        // PP1-008(b) — ESC cancels: restore the radius captured at F-press.
        e.preventDefault();
        const start = radiusAdjustModeRef.current.startRadius;
        if (typeof start === 'number') setPE({ radius: start });
        radiusAdjustModeRef.current.active = false;
        radiusAdjustModeRef.current.startRadius = null;
        radiusAdjustModeRef.current.anchorClientX = null;
        radiusAdjustModeRef.current.anchorClientY = null;
        isDirtyRef.current = true;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewMode]);

  /* ── K key — insert keyframes for selected nodes at current time ─────── */
  useEffect(() => {
    // GAP-010 — see brush-shortcut effect above. Same reasoning.
    if (previewMode) return;
    const handler = (e) => {
      if (e.key !== 'k' && e.key !== 'K') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const ed = editorRef.current;
      const anim = useAnimationStore.getState();
      if (ed.editorMode !== 'animation') return;

      const proj = projectRef.current;
      if (proj.animations.length === 0) return;

      const animId = anim.activeAnimationId ?? proj.animations[0]?.id;
      if (!animId) return;

      let selectedIds = ed.selection;
      if (selectedIds.length === 0) return;

      // Expand selection to include dependent parts for JS skinning joints
      const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
      const extraIds = new Set();
      for (const selectedId of selectedIds) {
        const node = proj.nodes.find(n => n.id === selectedId);
        if (node && JSKinningRoles.has(node.boneRole)) {
          for (const pt of proj.nodes) {
            if (pt.type === 'part' && pt.mesh?.jointBoneId === selectedId) {
              extraIds.add(pt.id);
            }
          }
        }
      }
      if (extraIds.size > 0) {
        selectedIds = Array.from(new Set([...selectedIds, ...extraIds]));
      }

      const currentTimeMs = anim.currentTime;

      // Pre-compute effective values for each selected node:
      // draftPose (drag) > current keyframe > node.transform
      const activeAnimObj = proj.animations.find(a => a.id === animId) ?? null;
      const endMs = (anim.endFrame / anim.fps) * 1000;
      const keyframeOverrides = computePoseOverrides(activeAnimObj, currentTimeMs, anim.loopKeyframes, endMs);

      updateProject((p) => {
        const animation = p.animations.find(a => a.id === animId);
        if (!animation) return;

        for (const nodeId of selectedIds) {
          const node = p.nodes.find(n => n.id === nodeId);
          if (!node) continue;

          const startMs = (anim.startFrame / anim.fps) * 1000;
          const rest = anim.restPose.get(nodeId);
          const draft = anim.draftPose.get(nodeId);
          const kfValues = keyframeOverrides.get(nodeId);

          for (const prop of KEYFRAME_PROPS) {
            // Read value from highest-priority source: draft > current keyframe > base transform
            let value;
            if (draft && draft[prop] !== undefined) {
              value = draft[prop];
            } else if (kfValues && kfValues[prop] !== undefined) {
              value = kfValues[prop];
            } else {
              value = getNodePropertyValue(node, prop);
            }

            let track = animation.tracks.find(t => t.nodeId === nodeId && t.property === prop);
            const isNewTrack = !track;
            if (!track) {
              track = { nodeId, property: prop, keyframes: [] };
              animation.tracks.push(track);
            }

            // Auto-insert a rest-pose keyframe at startFrame when this is the
            // first keyframe for this track and we're past the start.
            if (isNewTrack && currentTimeMs > startMs && rest) {
              const baseVal = prop === 'opacity' ? (rest.opacity ?? 1)
                : (rest[prop] ?? (prop === 'scaleX' || prop === 'scaleY' ? 1 : 0));
              upsertKeyframe(track.keyframes, startMs, baseVal, 'linear');
            }

            upsertKeyframe(track.keyframes, currentTimeMs, value, 'linear');
          }

          // ── mesh_verts keyframe (deform mode) ───────────────────────────
          // Only create/update if the node actually has a mesh deform in draft,
          // or if a mesh_verts track already exists. This prevents accidental
          // mesh_verts keyframes from blocking blend shape animation.
          if (node.type === 'part' && node.mesh) {
            const hasMeshDeform = draft?.mesh_verts !== undefined;
            let meshTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'mesh_verts');

            if (hasMeshDeform || meshTrack) {
              const meshVerts = draft?.mesh_verts
                ?? kfValues?.mesh_verts
                ?? node.mesh.vertices.map(v => ({ x: v.x, y: v.y }));

              const isNewMeshTrack = !meshTrack;
              if (!meshTrack) {
                meshTrack = { nodeId, property: 'mesh_verts', keyframes: [] };
                animation.tracks.push(meshTrack);
              }

              // Auto-insert base-mesh keyframe at startFrame if this is the first keyframe
              if (isNewMeshTrack && currentTimeMs > startMs) {
                const baseVerts = node.mesh.vertices.map(v => ({ x: v.x, y: v.y }));
                upsertKeyframe(meshTrack.keyframes, startMs, baseVerts, 'linear');
              }

              upsertKeyframe(meshTrack.keyframes, currentTimeMs, meshVerts, 'linear');
            }
          }

          // ── blend shape influence keyframes ───────────────────────────────
          if (node.type === 'part' && node.blendShapes?.length) {
            for (const shape of node.blendShapes) {
              const prop = `blendShape:${shape.id}`;
              const value = draft?.[prop] ?? kfValues?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;

              let track = animation.tracks.find(t => t.nodeId === nodeId && t.property === prop);
              const isNewTrack = !track;
              if (!track) {
                track = { nodeId, property: prop, keyframes: [] };
                animation.tracks.push(track);
              }

              // Auto-insert rest-pose keyframe at startFrame if this is the first keyframe
              if (isNewTrack && currentTimeMs > startMs && rest) {
                upsertKeyframe(track.keyframes, startMs, node.blendShapeValues?.[shape.id] ?? 0, 'linear');
              }

              upsertKeyframe(track.keyframes, currentTimeMs, value, 'linear');
            }
          }

        }
      });

      // Clear draft for committed nodes so the keyframe value takes over
      for (const nodeId of selectedIds) {
        anim.clearDraftPoseForNode(nodeId);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateProject, previewMode]);

  /* ── Mesh worker dispatch ────────────────────────────────────────────── */
  const dispatchMeshWorker = useCallback((partId, imageData, opts) => {
    // Terminate any previous worker for this part
    const existingWorker = workersRef.current.get(partId);
    if (existingWorker) existingWorker.terminate();

    const worker = new Worker(new URL('@/mesh/worker.js', import.meta.url), { type: 'module' });
    workersRef.current.set(partId, worker);

    worker.onmessage = (e) => {
      if (!e.data.ok) { console.error('[MeshWorker]', e.data.error); return; }
      const { vertices, uvs, triangles, edgeIndices } = e.data;

      const scene = sceneRef.current;
      if (scene) {
        scene.parts.uploadMesh(partId, { vertices, uvs, triangles, edgeIndices });
        isDirtyRef.current = true;
      }

      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (node) {
          // Clear blend shapes on remesh since vertex count/order changed
          if (node.blendShapes?.length > 0) {
            console.warn(`[Stretchy] Blend shapes on "${node.name}" cleared after remesh — topology changed.`);
            node.blendShapes = [];
            node.blendShapeValues = {};
          }

          node.mesh = { vertices, uvs: Array.from(uvs), triangles, edgeIndices };

          // Compute skin weights if this part belongs to a limb.
          const parentGroup = proj.nodes.find(n => n.id === node.parent);
          const childRole = childBoneRoleFor(parentGroup?.boneRole);
          if (childRole && parentGroup) {
            const jointBone = proj.nodes.find(n => n.parent === parentGroup.id && n.boneRole === childRole);
            if (jointBone) {
              node.mesh.boneWeights = computeSkinWeights(vertices, parentGroup, jointBone);
              node.mesh.jointBoneId = jointBone.id;
              console.log(`[Skinning] ${node.name} → ${childRole} (${vertices.length} verts)`);
            }
          }

          // If the pivot is at the default (0,0), auto-center to the mesh bounds.
          if (node.transform && node.transform.pivotX === 0 && node.transform.pivotY === 0) {
            const c = computeMeshCentroid(vertices);
            if (c) {
              node.transform.pivotX = c.cx;
              node.transform.pivotY = c.cy;
            }
          }
        }
      });

      // Clean up the worker from the map when done
      workersRef.current.delete(partId);
    };

    worker.postMessage({ imageData, opts });
  }, [updateProject]);

  /* ── Remesh selected part with given opts ────────────────────────────── */
  const remeshPart = useCallback((partId, opts) => {
    const proj = projectRef.current;
    const node = proj.nodes.find(n => n.id === partId);
    if (!node) return;

    const tex = proj.textures.find(t => t.id === partId);
    if (!tex) return;

    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      dispatchMeshWorker(partId, imageData, opts);
    };
    img.src = tex.source;
  }, [dispatchMeshWorker]);

  useEffect(() => { if (remeshRef) remeshRef.current = remeshPart; }, [remeshRef, remeshPart]);

  /* ── Auto-mesh all unmeshed parts with smart sizing ─────────────────────── */
  const autoMeshAllParts = useCallback(() => {
    const proj = projectRef.current;
    const parts = proj.nodes.filter(n => n.type === 'part' && !n.mesh);
    for (const node of parts) {
      const opts = computeSmartMeshOpts(node.imageBounds);
      remeshPart(node.id, opts);
    }
  }, [remeshPart]);

  /* ── Delete mesh for a part ──────────────────────────────────────────────── */
  const deleteMeshForPart = useCallback((partId) => {
    const node = projectRef.current.nodes.find(n => n.id === partId);
    if (!node) return;

    // Clear mesh from project store
    updateProject((p) => {
      const n = p.nodes.find(x => x.id === partId);
      if (n) n.mesh = null;
    });
  }, [updateProject]);

  useEffect(() => { if (deleteMeshRef) deleteMeshRef.current = deleteMeshForPart; }, [deleteMeshRef, deleteMeshForPart]);

  /* ── PNG import helper ───────────────────────────────────────────────── */
  const importPng = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const partId = uid();
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Store imageData for alpha-based picking
      imageDataMapRef.current.set(partId, imageData);

      // Compute bounding box from opaque pixels
      const imageBounds = computeImageBounds(imageData);

      updateProject((proj, ver) => {
        proj.canvas.width = img.width;
        proj.canvas.height = img.height;
        proj.textures.push({ id: partId, source: url });
        proj.nodes.push({
          id: partId,
          type: 'part',
          name: basename(file.name),
          parent: null,
          draw_order: proj.nodes.filter(n => n.type === 'part').length,
          opacity: 1,
          visible: true,
          clip_mask: null,
          transform: { ...DEFAULT_TRANSFORM(), pivotX: img.width / 2, pivotY: img.height / 2 },
          meshOpts: null,
          mesh: null,
          imageWidth: img.width,
          imageHeight: img.height,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: img.width, maxY: img.height },
        });
        ver.textureVersion++;
      });

      centerView(img.width, img.height);

      const scene = sceneRef.current;
      if (scene) {
        scene.parts.uploadTexture(partId, img);
        scene.parts.uploadQuadFallback(partId, img.width, img.height);
        isDirtyRef.current = true;
      }
    };
    img.src = url;
  }, [updateProject, centerView]);

  /* ── PSD import: finalize (shared by all import paths) ──────────────────── */
  const finalizePsdImport = useCallback((psdW, psdH, layers, partIds, groupDefs, assignments) => {
    const setExpandedGroups = useEditorStore.getState().setExpandedGroups;
    const setActiveLayerTab = useEditorStore.getState().setActiveLayerTab;

    // Auto-expand all new groups and switch to Groups tab
    if (groupDefs.length > 0) {
      setExpandedGroups(groupDefs.map(g => g.id));
      setActiveLayerTab('groups');
    }

    updateProject((proj, ver) => {
      proj.canvas.width = psdW;
      proj.canvas.height = psdH;

      // Create group nodes first (so parent IDs exist when parts reference them)
      for (const g of groupDefs) {
        proj.nodes.push({
          id: g.id,
          type: 'group',
          name: g.name,
          parent: g.parentId,
          opacity: 1,
          visible: true,
          boneRole: g.boneRole ?? null,
          transform: {
            ...DEFAULT_TRANSFORM(),
            pivotX: g.pivotX ?? 0,
            pivotY: g.pivotY ?? 0,
          },
        });
      }

      layers.forEach((layer, i) => {
        const partId = partIds[i];
        const off = document.createElement('canvas');
        off.width = psdW; off.height = psdH;
        const ctx = off.getContext('2d');
        const tmp = document.createElement('canvas');
        tmp.width = layer.width; tmp.height = layer.height;
        tmp.getContext('2d').putImageData(layer.imageData, 0, 0);
        ctx.drawImage(tmp, layer.x, layer.y);
        const fullImageData = ctx.getImageData(0, 0, psdW, psdH);

        // Store imageData synchronously for alpha-based picking
        imageDataMapRef.current.set(partId, fullImageData);

        // Compute bounding box from opaque pixels
        const imageBounds = computeImageBounds(fullImageData);

        off.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          updateProject((p2) => {
            const t = p2.textures.find(t => t.id === partId);
            if (t) t.source = url;
          });
          const img2 = new Image();
          img2.onload = () => {
            const scene = sceneRef.current;
            if (scene) {
              scene.parts.uploadTexture(partId, img2);
              scene.parts.uploadQuadFallback(partId, psdW, psdH);
              isDirtyRef.current = true;
            }
          };
          img2.src = url;
        }, 'image/png');

        const assignment = assignments?.get(i);
        proj.textures.push({ id: partId, source: '' });
        proj.nodes.push({
          id: partId,
          type: 'part',
          name: layer.name,
          parent: assignment?.parentGroupId ?? null,
          draw_order: assignment?.drawOrder ?? (layers.length - 1 - i),
          opacity: layer.opacity,
          visible: layer.visible,
          clip_mask: null,
          transform: { ...DEFAULT_TRANSFORM(), pivotX: psdW / 2, pivotY: psdH / 2 },
          meshOpts: null,
          mesh: null,
          imageWidth: psdW,
          imageHeight: psdH,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: psdW, maxY: psdH },
        });
      });

      // Single source of truth for .smile / .sad / .angry variants:
      // pair them with their base, reparent to match, and renumber
      // draw_order so each variant sits immediately on top of its base.
      normalizeVariants(proj);

      ver.textureVersion++;
    });

    centerView(psdW, psdH);
  }, [updateProject, centerView]);

  /* ── GAP-001 — Wizard handlers lifted out. The wizard mounts at
        AppShell level (`v3/shell/PsdImportWizard.jsx`) and dispatches
        through `services/PsdImportService`, which calls back into
        this canvas through the `captureStore` bridges below. */
  useEffect(() => {
    const cs = useCaptureStore.getState();
    cs.setFinalizePsdImport(finalizePsdImport);
    cs.setAutoMeshAllParts(autoMeshAllParts);
    return () => {
      const cur = useCaptureStore.getState();
      cur.setFinalizePsdImport(null);
      cur.setAutoMeshAllParts(null);
    };
  }, [finalizePsdImport, autoMeshAllParts]);

  /* ── Save/Load project ────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    try {
      const blob = await saveProject(projectRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project.stretch';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to save project:', err);
    }
  }, []);

  useEffect(() => { if (saveRef) saveRef.current = handleSave; }, [saveRef, handleSave]);

  const handleLoadProject = useCallback(async (file) => {
    if (!file) return;
    try {
      const { project: loadedProject, images } = await loadProject(file);

      // Destroy all GPU resources
      if (sceneRef.current) {
        sceneRef.current.parts.destroyAll();
      }

      // Load project into store
      useProjectStore.getState().loadProject(loadedProject);

      // Rebuild imageDataMapRef from loaded textures
      imageDataMapRef.current.clear();
      for (const [partId, img] of images) {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        imageDataMapRef.current.set(partId, imageData);
      }

      // Re-upload to GPU
      for (const node of loadedProject.nodes) {
        if (node.type !== 'part') continue;
        if (images.has(node.id)) {
          sceneRef.current?.parts.uploadTexture(node.id, images.get(node.id));
        }
        if (node.mesh) {
          sceneRef.current?.parts.uploadMesh(node.id, node.mesh);
        } else if (node.imageWidth && node.imageHeight) {
          sceneRef.current?.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
        }
      }

      // Reset animation playback state
      useAnimationStore.getState().resetPlayback?.();

      // Reset editor selection
      useEditorStore.getState().setSelection([]);

      isDirtyRef.current = true;

      // Center the loaded project view
      const cw = loadedProject.canvas?.width || 800;
      const ch = loadedProject.canvas?.height || 600;
      centerView(cw, ch);
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }, [centerView]);

  useEffect(() => {
    if (loadRef) loadRef.current = handleLoadProject;
  }, [loadRef, handleLoadProject]);

  /* ── PSD import helper ───────────────────────────────────────────────── */
  const processPsdFile = useCallback((file) => {
    file.arrayBuffer().then((buffer) => {
      let parsed;
      try { parsed = importPsd(buffer); }
      catch (err) { console.error('[PSD Import]', err); return; }

      const { width: psdW, height: psdH, layers } = parsed;
      if (!layers.length) return;

      const partIds = layers.map(() => uid());

      if (detectCharacterFormat(layers)) {
        // See-through character detected → open import wizard.
        // GAP-001 — wizard mounts at AppShell level; we just kick it off.
        PsdImportService.start({ psdW, psdH, layers, partIds });
      } else {
        finalizePsdImport(psdW, psdH, layers, partIds, [], null);
      }
    });
  }, [finalizePsdImport]);

  const importPsdFile = useCallback((file) => {
    const proj = projectRef.current;
    if (proj.nodes.length > 0) {
      setPendingFile(file);
      setConfirmWipeOpen(true);
    } else {
      processPsdFile(file);
    }
  }, [processPsdFile]);

  const importStretchFile = useCallback((file) => {
    const proj = projectRef.current;
    if (proj.nodes.length > 0) {
      setPendingFile(file);
      setConfirmWipeOpen(true);
    } else {
      handleLoadProject(file);
    }
  }, [handleLoadProject]);

  const handleConfirmWipe = useCallback(() => {
    if (pendingFile) {
      const isStretch = pendingFile.name.toLowerCase().endsWith('.stretch');
      resetProject();
      animRef.current.resetPlayback();

      if (isStretch) {
        handleLoadProject(pendingFile);
      } else {
        processPsdFile(pendingFile);
      }
      setPendingFile(null);
    }
    setConfirmWipeOpen(false);
  }, [pendingFile, processPsdFile, handleLoadProject, resetProject]);

  /* ── Drag-and-drop ───────────────────────────────────────────────────── */
  const onDrop = useCallback((e) => {
    e.preventDefault();
    // GAP-010 — Live Preview surface is read-only. File-routing belongs to
    // the editing Viewport; ignore drops here so the user can't accidentally
    // load a project into the preview pane.
    if (previewModeRef.current) return;
    routeImport(e.dataTransfer.files[0], {
      importStretch: importStretchFile,
      importPsd: importPsdFile,
      importPng,
    });
  }, [importPng, importPsdFile, importStretchFile]);

  const onDragOver = useCallback((e) => { e.preventDefault(); }, []);

  const onContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  /* ── Wheel: zoom (or live-radius adjust during proportional drag) ──── */
  const onWheel = useCallback((e) => {
    e.preventDefault();

    // PP1-008(b) — F-mode radius adjust. While active (no drag yet), wheel
    // updates proportionalEdit.radius without zooming the canvas. The
    // user commits the new radius with a click (handled in onPointerDown)
    // or restores the original with ESC.
    if (radiusAdjustModeRef.current.active) {
      const prefs = usePreferencesStore.getState();
      const cur = prefs.proportionalEdit;
      const step = Math.max(2, cur.radius * 0.1);
      const next = e.deltaY < 0 ? cur.radius + step : Math.max(5, cur.radius - step);
      prefs.setProportionalEdit({ radius: next });
      isDirtyRef.current = true;
      return;
    }

    // GAP-015 — When a proportional-edit drag is in flight, divert the
    // wheel delta to live radius adjustment AND recompute weights
    // against the rest snapshot captured at drag start (so each tick
    // is recomputed from the canonical mesh, not whatever the
    // in-flight deformation has produced — otherwise the deformation
    // drifts cumulatively). Matches Blender's MMB-scroll ergonomics.
    const drag = dragRef.current;
    if (drag?.proportional?.fullVertSnap && drag.partId != null && drag.vertexIndex != null) {
      const prefs = usePreferencesStore.getState();
      const cur = prefs.proportionalEdit;
      const step = Math.max(2, cur.radius * 0.1);
      const next = e.deltaY < 0 ? cur.radius + step : Math.max(5, cur.radius - step);
      prefs.setProportionalEdit({ radius: next });
      const restSnapshot = drag.proportional.fullVertSnap;
      const weights = computeProportionalWeights({
        vertices: restSnapshot,
        originIdx: drag.vertexIndex,
        radius: next,
        falloff: cur.falloff,
        connectedOnly: cur.connectedOnly,
        adjacency: drag.proportional.adjacency,
      });
      const affected = [];
      for (let i = 0; i < weights.length; i++) {
        if (weights[i] > 0) {
          affected.push({
            index: i,
            startX: restSnapshot[i].x,
            startY: restSnapshot[i].y,
            weight: weights[i],
          });
        }
      }
      drag.proportional.affected = affected;
      isDirtyRef.current = true;
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const next = zoomAroundCursor(
      editorRef.current.viewByMode[modeKey],
      e.deltaY,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    setView(next);
    isDirtyRef.current = true;
  }, [setView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [onWheel, onContextMenu]);

  /* ── Pointer events ──────────────────────────────────────────────────── */
  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    const view = editorRef.current.viewByMode[modeKey];

    // PP1-008(b) — F-mode radius adjust: a click commits the new radius
    // and exits the mode. Swallow this event so it doesn't also trigger
    // a vertex pick or pan/zoom gesture.
    if (radiusAdjustModeRef.current.active && e.button === 0) {
      radiusAdjustModeRef.current.active = false;
      radiusAdjustModeRef.current.startRadius = null;
      radiusAdjustModeRef.current.anchorClientX = null;
      radiusAdjustModeRef.current.anchorClientY = null;
      isDirtyRef.current = true;
      e.preventDefault();
      return;
    }

    // Phase 5 touch+pen — track every pointer that lands on the canvas.
    // When two touch pointers are active simultaneously, switch into a
    // pinch+pan gesture and bail before the single-pointer code runs. We
    // refuse to enter pinch while a vertex/brush drag is in flight to
    // avoid corrupting in-progress mesh edits.
    activePointersRef.current.set(e.pointerId, {
      x: e.clientX, y: e.clientY, type: e.pointerType,
    });
    const pts = [...activePointersRef.current.values()];
    if (
      pts.length >= 2 &&
      !dragRef.current &&
      pts.slice(0, 2).every((p) => p.type === 'touch')
    ) {
      // Cancel any in-flight panRef from the first finger so it doesn't
      // also try to pan; gestureRef takes over.
      if (panRef.current) {
        panRef.current = null;
      }
      const a = pts[0];
      const b = pts[1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.max(1, Math.hypot(dx, dy)),
        startMidX: (a.x + b.x) / 2,
        startMidY: (a.y + b.y) / 2,
        panX0: view.panX,
        panY0: view.panY,
        zoom0: view.zoom,
      };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Middle mouse (1) or right mouse (2) or alt+left → pan / zoom
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      if (e.ctrlKey) {
        // Ctrl + Middle/Right drag → Zoom
        panRef.current = {
          mode: 'zoom',
          startX: e.clientX,
          startY: e.clientY,
          zoom0: view.zoom,
          panX0: view.panX,
          panY0: view.panY
        };
      } else {
        // Regular Middle/Right drag → Pan
        panRef.current = {
          mode: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          panX0: view.panX,
          panY0: view.panY
        };
      }
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = e.ctrlKey ? 'zoom-in' : 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    // GAP-010 — On the Live Preview surface, LMB-drag drives cursor look
    // (writes ParamAngleX/Y/Z each frame). The plain Viewport never enters
    // this path — its LMB starts vertex/part picking instead.
    if (previewModeRef.current && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      lookRef.current = { active: true, clientX: e.clientX, clientY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
      isDirtyRef.current = true;
      // BUG-015 instrumentation — confirm cursor-look engages only on canvas-
      // initiated pointerdown. If this fires when the user is dragging a
      // BodyAngle slider, the canvas is swallowing pointer events and Radix
      // never sees the drag.
      logger.debug('lookRef', 'cursor-look engaged', {
        pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
      });
      return;
    }

    // Live Preview surface — block any further pointer-down behaviour
    // (no part picking, no mesh edit, no skeleton drag, no pivot edit).
    // Only pan/zoom (handled above) and cursor look (handled above) run.
    if (previewModeRef.current) return;

    const proj = projectRef.current;

    // Skeleton-edit mode delegates the entire canvas pointer-down
    // surface to SkeletonOverlay (joint dragging). Bail so click-to-
    // select doesn't fight for the same gesture. In Object Mode, the
    // overlay only claims its own painted handles via stopPropagation,
    // so clicks elsewhere fall through to click-to-select below.
    const hasArmature = proj.nodes.some(n => n.type === 'group' && n.boneRole);
    if (editorRef.current.editMode === 'skeleton' && hasArmature) return;

    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);

    // Build effective nodes: apply animation pose overrides so world matrices
    // and vertex positions match what is visually displayed on the canvas.
    const animNow = animRef.current;
    const isAnimMode = editorRef.current.editorMode === 'animation';
    const activeAnim = isAnimMode
      ? (proj.animations.find(a => a.id === animNow.activeAnimationId) ?? null)
      : null;
    const kfOverrides = isAnimMode ? computePoseOverrides(activeAnim, animNow.currentTime) : null;
    const ANIM_TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

    const effectiveNodes = (isAnimMode && (kfOverrides?.size || animNow.draftPose.size))
      ? proj.nodes.map(node => {
        const kfOv = kfOverrides?.get(node.id);
        const drOv = animNow.draftPose.get(node.id);
        if (!kfOv && !drOv) return node;
        const tr = { ...node.transform };
        if (kfOv) { for (const k of ANIM_TRANSFORM_KEYS) { if (kfOv[k] !== undefined) tr[k] = kfOv[k]; } }
        if (drOv) { for (const k of ANIM_TRANSFORM_KEYS) { if (drOv[k] !== undefined) tr[k] = drOv[k]; } }
        return {
          ...node,
          transform: tr,
          opacity: drOv?.opacity ?? kfOv?.opacity ?? node.opacity,
          visible: drOv?.visible ?? kfOv?.visible ?? node.visible,
        };
      })
      : proj.nodes;

    // Compute world matrices once for picking — from effective (animated) transforms
    const worldMatrices = computeWorldMatrices(effectiveNodes);

    // Get parts sorted by draw order descending (front to back) for correct hit testing
    const sortedParts = effectiveNodes
      .filter(n => n.type === 'part')
      .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

    // ── Mesh / blendShape edit: vertex drag scoped to the selected
    //    part. Tool dispatch via `toolMode`:
    //      'brush' (default)  → multi-vertex deform (or UV adjust
    //                            when meshSubMode === 'adjust')
    //      'add_vertex'        → click adds a vertex at cursor
    //      'remove_vertex'     → click removes the nearest vertex
    const { toolMode } = editorRef.current;
    const editMode = editorRef.current.editMode;
    const meshEditActive = editMode === 'mesh' || editMode === 'blendShape';
    const currentSelection = editorRef.current.selection ?? [];
    if (meshEditActive && currentSelection.length > 0) {
      const selNode = effectiveNodes.find(n => n.id === currentSelection[0] && n.type === 'part' && n.mesh);
      if (selNode) {
        const wm = worldMatrices.get(selNode.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);

        if (toolMode === 'add_vertex') {
          // Compute new mesh data first, then upload and persist atomically
          const newVerts = [...selNode.mesh.vertices, { x: lx, y: ly, restX: lx, restY: ly }];
          const oldUvs = selNode.mesh.uvs;
          const newUvs = new Float32Array(oldUvs.length + 2);
          newUvs.set(oldUvs);
          newUvs[oldUvs.length] = lx / (selNode.imageWidth ?? 1);
          newUvs[oldUvs.length + 1] = ly / (selNode.imageHeight ?? 1);
          const result = retriangulate(newVerts, newUvs, selNode.mesh.edgeIndices);

          // Upload to GPU immediately (no stale ref)
          sceneRef.current?.parts.uploadMesh(selNode.id, {
            vertices: result.vertices,
            uvs: result.uvs,
            triangles: result.triangles,
            edgeIndices: result.edgeIndices,
          });
          isDirtyRef.current = true;

          // Persist to store
          updateProject((proj2) => {
            const node = proj2.nodes.find(n => n.id === selNode.id);
            if (!node?.mesh) return;
            node.mesh.vertices = result.vertices;
            node.mesh.uvs = Array.from(result.uvs);
            node.mesh.triangles = result.triangles;
          });

        } else if (toolMode === 'remove_vertex') {
          const idx = findNearestVertex(selNode.mesh.vertices, lx, ly, 14 / view.zoom);
          if (idx >= 0 && selNode.mesh.vertices.length > 3) {
            // Compute new mesh data first
            const newVerts = selNode.mesh.vertices.filter((_, i) => i !== idx);
            const oldUvs = selNode.mesh.uvs;
            const newUvs = new Float32Array(oldUvs.length - 2);
            for (let i = 0; i < idx; i++) { newUvs[i * 2] = oldUvs[i * 2]; newUvs[i * 2 + 1] = oldUvs[i * 2 + 1]; }
            for (let i = idx; i < newVerts.length; i++) { newUvs[i * 2] = oldUvs[(i + 1) * 2]; newUvs[i * 2 + 1] = oldUvs[(i + 1) * 2 + 1]; }
            const oldEdge = selNode.mesh.edgeIndices ?? new Set();
            const newEdge = new Set();
            for (const ei of oldEdge) {
              if (ei < idx) newEdge.add(ei);
              else if (ei > idx) newEdge.add(ei - 1);
            }
            const result = retriangulate(newVerts, newUvs, newEdge);

            // Upload to GPU immediately
            sceneRef.current?.parts.uploadMesh(selNode.id, {
              vertices: result.vertices,
              uvs: result.uvs,
              triangles: result.triangles,
              edgeIndices: newEdge,
            });
            isDirtyRef.current = true;

            // Persist to store
            updateProject((proj2) => {
              const node = proj2.nodes.find(n => n.id === selNode.id);
              if (!node?.mesh) return;
              node.mesh.vertices = result.vertices;
              node.mesh.uvs = Array.from(result.uvs);
              node.mesh.triangles = result.triangles;
              node.mesh.edgeIndices = newEdge;
            });
          }
        } else {
          // Default select tool in deform mode: brush-based multi-vertex drag
          const { brushSize, brushHardness, meshSubMode } = editorRef.current;
          const worldRadius = brushSize / view.zoom;

          // Use the effective (pose-overridden) vertex positions so the brush
          // hits where the mesh is visually displayed, not the base mesh.
          let effectiveVerts =
            animNow.draftPose.get(selNode.id)?.mesh_verts
            ?? kfOverrides?.get(selNode.id)?.mesh_verts
            ?? selNode.mesh.vertices;

          // In blend shape edit mode, apply existing deltas (active shape at full influence)
          // so each drag continues from the visually correct position, not from rest.
          if (editorRef.current.editMode === 'blendShape' && selNode.blendShapes?.length) {
            const activeShapeId = editorRef.current.activeBlendShapeId;
            effectiveVerts = selNode.mesh.vertices.map((v, i) => {
              let bx = v.restX, by = v.restY;
              for (const shape of selNode.blendShapes) {
                const d = shape.deltas[i];
                if (!d) continue;
                const inf = shape.id === activeShapeId
                  ? 1.0  // active shape always at full influence during editing
                  : (selNode.blendShapeValues?.[shape.id] ?? 0);
                bx += d.dx * inf;
                by += d.dy * inf;
              }
              return { x: bx, y: by };
            });
          }

          const affected = [];
          for (let i = 0; i < effectiveVerts.length; i++) {
            const dx = effectiveVerts[i].x - lx, dy = effectiveVerts[i].y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const w = meshSubMode === 'deform'
              ? brushWeight(dist, worldRadius, brushHardness)
              : (dist <= 14 / view.zoom ? 1 : 0); // adjust: exact vertex pick
            if (w > 0) affected.push({ index: i, startX: effectiveVerts[i].x, startY: effectiveVerts[i].y, weight: w });
          }
          if (affected.length > 0 || meshSubMode === 'deform') {
            dragRef.current = {
              mode: 'brush',
              partId: selNode.id,
              startWorldX: worldX,
              startWorldY: worldY,
              // Snapshot of effective vertex positions at drag start
              verticesSnap: effectiveVerts.map(v => ({ ...v })),
              allUvs: new Float32Array(selNode.mesh.uvs),
              imageWidth: selNode.imageWidth,
              imageHeight: selNode.imageHeight,
              affected,
              iwm,
            };
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'crosshair';
          }
        }
      }
      // In edit mode, never change selection or interact with other layers
      return;
    }

    // Click-to-select (Object Mode). Triangle hit-test against
    // rig-evaluated vertex positions so the click matches what the
    // user actually sees rendered (not the rest mesh). Plan:
    // docs/CLICK_TO_SELECT_PLAN.md.
    //
    // In edit modes (mesh / skeleton / blendShape) clicks already
    // belong to the mode-specific gesture and never reach this branch
    // — the meshEditActive block above handles mesh/blendShape vertex
    // drag, the skeleton-overlay branch above handles bone joints.
    //
    // Frames may be null when no rig is built yet; hitTestParts
    // falls back to rest mesh + worldMatrices.
    const cachedFrames = lastEvalCacheRef.current?.frames ?? null;
    const hitId = hitTestParts(
      proj,
      cachedFrames,
      worldX,
      worldY,
      { worldMatrices },
    );
    const isMulti = e.shiftKey;
    if (hitId) {
      if (isMulti) {
        useSelectionStore.getState().select({ type: 'part', id: hitId }, 'toggle');
        // Mirror the universal store's active item back into the
        // legacy node-id slot. Most consumers (Properties panes,
        // GizmoOverlay) only look at selection[0]; the universal
        // store carries the full multi-select truth.
        const active = useSelectionStore.getState().getActive();
        setSelection(active && active.type === 'part' ? [active.id] : []);
      } else {
        setSelection([hitId]);
        useSelectionStore.getState().select({ type: 'part', id: hitId }, 'replace');
      }
    } else if (!isMulti) {
      setSelection([]);
      useSelectionStore.getState().clear();
    }
  }, [setSelection, updateProject]);

  const onPointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    const view = editorRef.current.viewByMode[modeKey];

    // Phase 5 touch+pen — keep the active-pointer map fresh for in-flight
    // gestures. Reading the very latest screen positions for both fingers
    // each frame is what makes pinch-zoom feel anchored to the touch points.
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX, y: e.clientY, type: e.pointerType,
      });
    }
    if (gestureRef.current && gestureRef.current.mode === 'pinch') {
      const pts = [...activePointersRef.current.values()];
      if (pts.length < 2) {
        // One finger lifted before pointerup fired (or pointercancel raced).
        // Wait for the up handler to drop us out of pinch mode.
      } else {
        const a = pts[0];
        const b = pts[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const g = gestureRef.current;
        const factor = dist / g.startDist;
        const newZoom = Math.max(0.05, Math.min(20, g.zoom0 * factor));

        // Zoom around the gesture's starting midpoint so the content under
        // the centre of the two fingers stays put, then translate the view
        // by however far the midpoint has slid since gesture start (the
        // two-finger pan component).
        const rect = canvas.getBoundingClientRect();
        const ax = g.startMidX - rect.left;
        const ay = g.startMidY - rect.top;
        const newPanX = ax - (ax - g.panX0) * (newZoom / g.zoom0)
          + (midX - g.startMidX);
        const newPanY = ay - (ay - g.panY0) * (newZoom / g.zoom0)
          + (midY - g.startMidY);
        setView({ zoom: newZoom, panX: newPanX, panY: newPanY });
        isDirtyRef.current = true;
        return;
      }
    }

    // Phase 1F.6 — Live Preview cursor look update.
    if (lookRef.current.active) {
      lookRef.current.clientX = e.clientX;
      lookRef.current.clientY = e.clientY;
      isDirtyRef.current = true;
      return;
    }

    // Pan or Zoom
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;

      if (panRef.current.mode === 'zoom') {
        const { zoom0, panX0, panY0, startX, startY } = panRef.current;
        // Dragging up = zoom in, dragging down = zoom out
        const factor = Math.exp(-dy * 0.01);
        const newZoom = Math.max(0.05, Math.min(20, zoom0 * factor));

        // Zoom relative to the point where the drag started
        const mx = startX - canvas.getBoundingClientRect().left;
        const my = startY - canvas.getBoundingClientRect().top;
        const newPanX = mx - (mx - panX0) * (newZoom / zoom0);
        const newPanY = my - (my - panY0) * (newZoom / zoom0);

        setView({ zoom: newZoom, panX: newPanX, panY: newPanY });
      } else {
        setView({ panX: panRef.current.panX0 + dx, panY: panRef.current.panY0 + dy });
      }
      isDirtyRef.current = true;
      return;
    }

    // Update brush circle cursor position (direct DOM, no React re-render)
    if (brushCircleRef.current) {
      const editMode = editorRef.current.editMode;
      const inDeformMode = (editMode === 'mesh' && editorRef.current.meshSubMode === 'deform')
        || editMode === 'blendShape';
      if (inDeformMode) {
        const rect = canvas.getBoundingClientRect();
        brushCircleRef.current.setAttribute('cx', e.clientX - rect.left);
        brushCircleRef.current.setAttribute('cy', e.clientY - rect.top);
        brushCircleRef.current.setAttribute('visibility', 'visible');
      } else {
        brushCircleRef.current.setAttribute('visibility', 'hidden');
      }
    }

    // GAP-015 — proportional-edit influence ring. Visible whenever the
    // user has proportional editing enabled in a permissive workspace.
    // Radius is in mesh-local units; we scale by view.zoom to render
    // in screen-px (mesh-local-to-screen scale ≈ image scale × zoom,
    // but since meshes ride the canvas axes view.zoom is sufficient
    // for an indicator). Brushed mesh-edit and proportional edit can
    // coexist — both rings visible if both modes are on.
    // PP1-008(b) — keep the most recent cursor position so an F press
    // can snapshot it as the radius-adjust anchor. Outside the canvas
    // event flow this stays stale, but F is gated on mesh edit which
    // implies the user has been interacting with the canvas.
    lastCursorRef.current.clientX = e.clientX;
    lastCursorRef.current.clientY = e.clientY;

    // PP1-008(b) — Blender-faithful gesture: while the radius-adjust
    // mode is active, cursor distance from the anchor (F-press point)
    // sets the proportional-edit radius. The anchor is snapshotted on
    // the first pointermove after F-press, not at the keydown itself —
    // that way users who entered mesh-edit via outliner / ModePill
    // (without hovering the canvas first) still get a sane anchor at
    // the position where their cursor actually arrives. Wheel still
    // nudges the value alongside; last gesture wins.
    const radiusMode = radiusAdjustModeRef.current;
    if (radiusMode.active) {
      if (radiusMode.anchorClientX === null) {
        radiusMode.anchorClientX = e.clientX;
        radiusMode.anchorClientY = e.clientY;
      } else {
        const dxAnchor = e.clientX - radiusMode.anchorClientX;
        const dyAnchor = e.clientY - radiusMode.anchorClientY;
        const screenDist = Math.hypot(dxAnchor, dyAnchor);
        const zoomNow = editorRef.current.viewByMode[modeKey].zoom;
        const meshRadius = Math.max(5, screenDist / Math.max(0.0001, zoomNow));
        usePreferencesStore.getState().setProportionalEdit({ radius: meshRadius });
      }
      isDirtyRef.current = true;
    }

    if (propEditCircleRef.current) {
      const peCfg = usePreferencesStore.getState().proportionalEdit;
      // Proportional edit + F-mode only mean something inside mesh edit;
      // gating on `editMode === 'mesh'` (rather than the whole workspace)
      // hides the ring during Object Mode, the PSD import wizard, and any
      // other context where the user can't actually deform a mesh —
      // previously the ring showed across the entire Default workspace,
      // including the reorder/adjust wizard steps where it was confusing.
      const inMeshEdit = editorRef.current.editMode === 'mesh';
      const showRing = inMeshEdit && (peCfg?.enabled || radiusMode.active);
      if (showRing) {
        const rect = canvas.getBoundingClientRect();
        const screenR = peCfg.radius * editorRef.current.viewByMode[modeKey].zoom;
        // Blender pattern: while the gesture is live, the ring is anchored
        // at the F-press point (the cursor traces the ring's edge so the
        // user "draws" the radius). Outside F-mode the ring follows the
        // cursor as before, since proportional-edit's normal preview is
        // a brush-like indicator at the active vertex location.
        const ringX = (radiusMode.active && typeof radiusMode.anchorClientX === 'number')
          ? radiusMode.anchorClientX - rect.left
          : e.clientX - rect.left;
        const ringY = (radiusMode.active && typeof radiusMode.anchorClientY === 'number')
          ? radiusMode.anchorClientY - rect.top
          : e.clientY - rect.top;
        propEditCircleRef.current.setAttribute('cx', ringX);
        propEditCircleRef.current.setAttribute('cy', ringY);
        propEditCircleRef.current.setAttribute('r', screenR);
        propEditCircleRef.current.setAttribute('visibility', 'visible');
      } else {
        propEditCircleRef.current.setAttribute('visibility', 'hidden');
      }
    }

    // Vertex / brush drag
    if (!dragRef.current) return;
    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);

    const { meshSubMode } = editorRef.current;

    // ── Brush deform (edit mode, deform sub-mode) ──────────────────────────
    if (dragRef.current.mode === 'brush') {
      const { partId, startWorldX, startWorldY, verticesSnap, allUvs, affected,
        imageWidth, imageHeight, iwm } = dragRef.current;

      const worldDx = worldX - startWorldX;
      const worldDy = worldY - startWorldY;
      const localDx = iwm[0] * worldDx + iwm[3] * worldDy;
      const localDy = iwm[1] * worldDx + iwm[4] * worldDy;

      // Build full vertex array from snapshot with weighted deltas applied
      const newVerts = verticesSnap.map(v => ({ ...v }));
      for (const { index, startX, startY, weight } of affected) {
        if (meshSubMode === 'adjust') {
          newVerts[index].x = startX + localDx * weight;
          newVerts[index].y = startY + localDy * weight;
        } else {
          newVerts[index].x = startX + localDx * weight;
          newVerts[index].y = startY + localDy * weight;
        }
      }

      // GPU upload from freshly computed data (no stale ref)
      sceneRef.current?.parts.uploadPositions(partId, newVerts, allUvs);
      isDirtyRef.current = true;

      // Blend shape edit mode — write to shape key deltas instead of mesh or draftPose
      if (editorRef.current.editMode === 'blendShape') {
        const shapeId = editorRef.current.activeBlendShapeId;
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === partId);
          const shape = node?.blendShapes?.find(s => s.id === shapeId);
          if (!shape) return;
          for (const { index, weight } of affected) {
            const nx = verticesSnap[index].x + localDx * weight;
            const ny = verticesSnap[index].y + localDy * weight;
            shape.deltas[index] = {
              dx: nx - node.mesh.vertices[index].restX,
              dy: ny - node.mesh.vertices[index].restY,
            };
          }
        });
        return;
      }

      // In animation mode + deform: store to draftPose — don't bake into base mesh.
      // The user will press K to commit as a keyframe.
      if (editorRef.current.editorMode === 'animation' && meshSubMode === 'deform') {
        animRef.current.setDraftPose(partId, { mesh_verts: newVerts.map(v => ({ x: v.x, y: v.y })) });
        return;
      }

      // Staging mode (or adjust sub-mode): persist directly to the base mesh
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        for (const { index, startX, startY, weight } of affected) {
          const nx = startX + localDx * weight;
          const ny = startY + localDy * weight;
          node.mesh.vertices[index].x = nx;
          node.mesh.vertices[index].y = ny;
          if (meshSubMode === 'adjust') {
            node.mesh.uvs[index * 2] = nx / (imageWidth ?? 1);
            node.mesh.uvs[index * 2 + 1] = ny / (imageHeight ?? 1);
          }
        }
      });
      return;
    }

    // ── Single-vertex drag (non-edit-mode path) ────────────────────────────
    const { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY,
      imageWidth, imageHeight, iwm, proportional } = dragRef.current;

    const worldDx = worldX - startWorldX;
    const worldDy = worldY - startWorldY;
    const localDx = iwm[0] * worldDx + iwm[3] * worldDy;
    const localDy = iwm[1] * worldDx + iwm[4] * worldDy;

    if (meshSubMode === 'adjust') {
      // GAP-015 — adjust mode is UV remap only; proportional editing
      // doesn't apply (the UI gesture is "exact vertex pick", not "drag
      // and let neighbours follow").
      const newLocalX = startLocalX + localDx;
      const newLocalY = startLocalY + localDy;
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        node.mesh.vertices[vertexIndex].x = newLocalX;
        node.mesh.vertices[vertexIndex].y = newLocalY;
        node.mesh.uvs[vertexIndex * 2] = newLocalX / (imageWidth ?? 1);
        node.mesh.uvs[vertexIndex * 2 + 1] = newLocalY / (imageHeight ?? 1);
      });
    } else if (proportional) {
      // GAP-015 — pull every affected vertex along with its captured
      // weight. Origin gets weight 1 → moves the full delta; rim
      // vertices get weight ≈0 → barely move; mid-falloff vertices
      // follow the curve. Snapshots taken at drag start, so dragging
      // is stable even when intermediate updateProject calls trigger
      // re-renders.
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        const verts = node.mesh.vertices;
        for (const a of proportional.affected) {
          verts[a.index].x = a.startX + localDx * a.weight;
          verts[a.index].y = a.startY + localDy * a.weight;
        }
      });
    } else {
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        node.mesh.vertices[vertexIndex].x = startLocalX + localDx;
        node.mesh.vertices[vertexIndex].y = startLocalY + localDy;
      });
    }

    const scene = sceneRef.current;
    if (scene) {
      const node = projectRef.current.nodes.find(n => n.id === partId);
      if (node?.mesh) {
        scene.parts.uploadPositions(partId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
        isDirtyRef.current = true;
      }
    }
  }, [updateProject, setView]);

  const onPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    // Phase 5 touch+pen — drop this pointer from the active map. setPointer-
    // Capture was never called for touch pointers in the gesture path, so
    // releasePointerCapture would throw NotFoundError on those. Guard it.
    activePointersRef.current.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }

    // If a pinch gesture was active and we're now down to <2 fingers, end
    // the gesture cleanly. The remaining finger (if any) will not start a
    // new single-pointer drag — the user has to lift fully and re-touch.
    if (gestureRef.current && activePointersRef.current.size < 2) {
      gestureRef.current = null;
      canvas.style.cursor = '';
      return;
    }

    // Phase 1F.6 — End cursor look. The next tick will see active=false
    // and stop pushing ParamAngleX/Y/Z; the head freezes at its last
    // value (physics damping then carries it back to rest naturally
    // when those rules exist).
    if (lookRef.current.active) {
      lookRef.current.active = false;
      canvas.style.cursor = '';
      logger.debug('lookRef', 'cursor-look released', { pointerId: e.pointerId });
      return;
    }

    if (panRef.current) {
      panRef.current = null;
      canvas.style.cursor = '';
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      canvas.style.cursor = '';
      if (editorRef.current.autoKeyframe && editorRef.current.editorMode === 'animation') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    }
  }, []);

  /* ── File Upload Handlers ───────────────────────────────────────────── */
  const handlePanelClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    routeImport(e.target.files?.[0], {
      importStretch: importStretchFile,
      importPsd: importPsdFile,
      importPng,
    });
    // Clear input so same file can be uploaded again if needed.
    e.target.value = '';
  }, [importStretchFile, importPsdFile, importPng]);

  /**
   * Reset the current project to empty state.
   */
  const handleReset = useCallback(() => {
    // 1. Destroy GPU resources
    if (sceneRef.current) {
      sceneRef.current.parts.destroyAll();
    }

    // 2. Clear store
    useProjectStore.getState().resetProject();

    // 3. Clear local cache
    imageDataMapRef.current.clear();

    // 4. Reset editor state
    useAnimationStore.getState().resetPlayback?.();
    useEditorStore.getState().setSelection([]);

    isDirtyRef.current = true;

    // 5. Center view
    centerView(800, 600);
  }, [centerView]);

  useEffect(() => {
    if (resetRef) resetRef.current = handleReset;
  }, [resetRef, handleReset]);

  /**
   * Capture a thumbnail of the current staging area.
   */
  const captureStaging = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Create an offscreen canvas for downsizing
    const off = document.createElement('canvas');
    const MAX_W = 400;
    const scale = Math.min(1, MAX_W / canvas.width);
    off.width = canvas.width * scale;
    off.height = canvas.height * scale;

    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, off.width, off.height);

    return off.toDataURL('image/webp', 0.8);
  }, []);

  useEffect(() => {
    if (thumbCaptureRef) thumbCaptureRef.current = captureStaging;
  }, [thumbCaptureRef, captureStaging]);

  /* ── Export frame capture ────────────────────────────────────────────── */
  const captureExportFrame = useCallback((opts) => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return null;
    const _gOpacity = paramValuesRef.current?.ParamOpacity;
    const globalOpacity = (typeof _gOpacity === 'number') ? _gOpacity : 1;
    const dataUrl = captureExportFrameImpl(
      {
        canvas,
        scene,
        editor: editorRef.current,
        project: projectRef.current,
        isDark: isDarkRef.current,
        globalOpacity,
      },
      opts,
    );
    // Mark dirty so rAF restores the live canvas size on the next tick.
    isDirtyRef.current = true;
    return dataUrl;
  }, []);

  useEffect(() => { if (exportCaptureRef) exportCaptureRef.current = captureExportFrame; }, [exportCaptureRef, captureExportFrame]);

  /* ── Cursor style ────────────────────────────────────────────────────── */
  const toolCursor = 'crosshair';

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-[#1a1a1a]"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{
          cursor: !previewMode && editorState.editMode === 'mesh' && editorState.meshSubMode === 'deform' ? 'none' : toolCursor,
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseLeave={() => brushCircleRef.current?.setAttribute('visibility', 'hidden')}
      />

      {/* Brush cursor circle — shown in deform edit mode, positioned via direct DOM updates. */}
      {/* GAP-015 — separate proportional-edit indicator ring (Blender's `O`-mode cursor). */}
      {/* GAP-010 — suppressed on the Live Preview surface (no editing). */}
      {!previewMode && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <circle
            ref={brushCircleRef}
            cx={0} cy={0}
            r={editorState.brushSize}
            fill="none"
            stroke="white"
            strokeWidth="1"
            strokeDasharray="4 3"
            visibility="hidden"
          />
          <circle
            ref={propEditCircleRef}
            cx={0} cy={0}
            r={0}
            fill="none"
            stroke="rgb(255, 200, 80)"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            visibility="hidden"
          />
        </svg>
      )}

      {/* Transform gizmo SVG overlay — hidden when skeleton is showing AND exists. */}
      {/* GAP-010 — never on the Live Preview surface; preview is read-only. */}
      {!previewMode && (!editorState.viewLayers.skeleton || !project.nodes.some(n => n.type === 'group' && n.boneRole)) && <GizmoOverlay />}

      {/* Armature skeleton overlay (staging mode, when rig exists). */}
      {/* GAP-010 — never on the Live Preview surface. */}
      {!previewMode && (
        <SkeletonOverlay
          view={view}
          editorMode={editorState.editorMode}
          showSkeleton={editorState.viewLayers.skeleton}
          skeletonEditMode={editorState.editMode === 'skeleton'}
        />
      )}


      {/* Drop hint overlay — edit Viewport only; Live Preview never invites uploads. */}
      {!previewMode && project.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".stretch,.psd,image/*"
            className="hidden"
          />
          <div
            onClick={handlePanelClick}
            className="max-w-md w-full flex flex-col items-center gap-8 p-10 rounded-[3rem] 
                       border border-border/40 bg-card/30 backdrop-blur-2xl 
                       hover:bg-card/40 hover:border-primary/30 hover:scale-[1.01]
                       transition-all duration-300 group cursor-pointer shadow-2xl ring-1 ring-white/5
                       animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out pointer-events-auto"
          >
            {/* Upload Button */}
            <div className="w-24 h-24 rounded-[2rem] bg-primary/10 flex items-center justify-center 
                            border border-primary/20 group-hover:bg-primary/20 group-hover:scale-110 
                            transition-all duration-500 shadow-xl shadow-primary/10">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-primary">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div className="space-y-3">
              <p className="text-3xl font-bold tracking-tight text-foreground/90 leading-tight">
                Drop or <span className="text-primary">click</span> to upload a <br />
                <span className="text-foreground underline underline-offset-8 decoration-primary/30">.stretch</span> or <span className="text-foreground underline underline-offset-8 decoration-primary/30">PSD/PNG</span>
              </p>
              <p className="text-sm text-muted-foreground/60 select-none">
                Character rigging and animation in seconds.
              </p>
            </div>

            {/* Separator */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

            {/* Help / Guidance Card Section */}
            <div className="w-full space-y-4 pt-2">
              <h3 className="text-xs font-bold text-foreground/70 uppercase tracking-widest">Don't have a layered PSD?</h3>

              <a
                href="https://huggingface.co/spaces/24yearsold/see-through-demo"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl 
                           bg-primary text-primary-foreground text-xs font-black 
                           hover:brightness-110 active:scale-[0.98] transition-all 
                           shadow-lg shadow-primary/25"
              >
                LAYER-IFY YOUR IMAGE <br /> (Free HuggingFace Space)
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-80">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>

              <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-[280px] mx-auto pointer-events-auto">
                Provided by the authors of <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer" className="text-primary/80 hover:underline font-medium" onClick={(e) => e.stopPropagation()}>See-through</a>,
                an AI model that automatically decomposes single character illustrations into ready-to-animate layers.
              </p>
            </div>
          </div>
        </div>
      )}


      {/* GAP-006 — Reset Pose, top-right viewport corner. Visible on the edit
          Viewport whenever a project is loaded. Behaviour depends on mode:
            - Animation mode → `resetPoseDraft()`  (clear draftPose + paramValues; keyframes survive)
            - Staging mode    → `resetToRestPose()` (above + bone-group transforms)
          Hidden on the Live Preview surface (read-only).
          Replaced the prior chains-bar + dump diagnostic that lived in this
          slot — that signal moved to the Logs panel (`chainDiagnose` source)
          per user direction 2026-05-02. */}
      {!previewMode && project.nodes.length > 0 && (
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary" size="sm"
                className="absolute top-2 right-2 z-10 h-8 px-3 gap-1.5
                           bg-card/85 backdrop-blur-md
                           border border-border/60 hover:border-primary/40
                           text-foreground/80 hover:text-foreground hover:bg-card/95
                           shadow-md hover:shadow-lg hover:shadow-primary/10
                           transition-all duration-150
                           font-medium"
                onClick={() => {
                  const mode = editorState.editorMode;
                  if (mode === 'animation') resetPoseDraft();
                  else resetToRestPose();
                  logger.debug('resetPose', `Reset Pose triggered (mode=${mode})`, {
                    editorMode: mode,
                    paramsReset: project?.parameters?.length ?? 0,
                  });
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="text-[11px] tracking-wide">Reset Pose</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {editorState.editorMode === 'animation'
                ? 'Clear unsaved pose + reset parameters. Keyframes kept.'
                : 'Reset bones + parameters to rest. Part transforms kept (use Properties → Reset Transform).'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* GAP-001 — PSD import wizard now mounts at AppShell level
          (`v3/shell/PsdImportWizard.jsx`) and reads `wizardStore`
          directly. The canvas exposes its imperative bridges
          (finalizePsdImport / autoMeshAllParts) through `captureStore`
          via the effect in this component. */}

      {/* Wipe project confirmation */}
      <AlertDialog open={confirmWipeOpen} onOpenChange={setConfirmWipeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe current project?</AlertDialogTitle>
            <AlertDialogDescription>
              Importing a new project or PSD will permanently delete all existing layers,
              meshes, and animations in your current project. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmWipe} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Wipe & Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
