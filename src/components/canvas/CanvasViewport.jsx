import { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useParamValuesStore } from '@/store/paramValuesStore';
import { useRigSpecStore } from '@/store/rigSpecStore';
import { useRigEvalStore } from '@/store/rigEvalStore';
import { useUIV3Store, selectEditorMode, getEditorMode } from '@/store/uiV3Store';
import { useSelectionStore } from '@/store/selectionStore';
import { useBoxSelectStore } from '@/store/boxSelectStore';
// Workspace policy module deleted 2026-05-02 — workspaces no longer
// gate modes or visualizations (Blender pattern: workspace = layout
// preset + default editorMode, nothing more). `editor.editMode` and
// `editor.viewLayers` are read directly.
import { evalRig } from '@/io/live2d/runtime/evaluator/chainEval';
// Phase 0.D.0 of Animation Blender-Parity Plan (2026-05-10) — depgraph
// production wire-in. `evalProjectFrameViaDepgraph` is a drop-in for
// evalRig that routes every art mesh through the depgraph's
// ART_MESH_EVAL op. Selected via `preferencesStore.evalEngine`.
import { evalProjectFrameViaDepgraph } from '@/anim/depgraph/evalProjectFrame';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
} from '@/io/live2d/runtime/physicsTick';
import { EyeBlinkDriver, resolveEyeBlinkParamIds } from '@/io/live2d/runtime/eyeBlink';
import { computePoseOverrides, computeParamOverrides, KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe } from '@/renderer/animationEngine';
// Phase 0.B of Animation Blender-Parity Plan (2026-05-09) — driver pass.
// `evaluateProjectDrivers` walks every `param.driver` (and future
// `node.transformDrivers`) and returns a Map<rnaPath, value>. Phase 0
// scope: only param drivers reach the eval substrate; transform-driver
// wiring lands with the depgraph default-flip in Phase 0.D.0.
import { evaluateProjectDrivers, driverOverridesToParamMap } from '@/anim/driverPass';
import { ScenePass } from '@/renderer/scenePass';
// `importPsd` is dynamic-imported inside `processPsdFile` — keeps
// ag-psd (and its inflate dependency) out of the boot bundle until
// the user actually drops a PSD onto the canvas.
import { detectCharacterFormat } from '@/io/armatureMeta';
import SkeletonOverlay from '@/components/canvas/SkeletonOverlay';
import { ViewLayersPopover } from '@/v3/shell/ViewLayersPopover';
import { useWizardStore } from '@/store/wizardStore';
import { useCaptureStore } from '@/store/captureStore';
// Phase A2 (2026-05-09) — PsdImportService is only reached on a PSD
// drop event. The service itself imports projectStore + wizardStore +
// captureStore + variantNormalizer + applySplits + rigGroupCleanup;
// dynamic-import keeps that whole graph off the eager path.
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
import { hitTestParts, hitTestVertices, buildVertexAdjacency, shortestPathBetweenVertices } from '@/io/hitTest';
import { captureExportFrame as captureExportFrameImpl } from '@/components/canvas/viewport/captureExportFrame';
import {
  isBoneGroup,
  isMeshedPart,
  getMesh,
  setMesh,
  clearMesh,
  getBoneRole,
} from '@/store/objectDataAccess';
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
import { downsampleAlphaMask } from '@/components/canvas/viewport/alphaMask';
import {
  computeBoneWorldMatrices,
  computeBoneParentMap,
  computeBoneOverlayMatrices,
  applyOverlayMatrixObj,
} from '@/renderer/boneOverlayMatrix';
import { pickBonePostChainComposition } from '@/renderer/bonePostChainComposition';
import { applyTwoBoneSkinningObj } from '@/renderer/boneSkinning';
import { retriangulate } from '@/mesh/generate';
import { createMeshWorkerPool } from '@/mesh/workerPool';
import { GizmoOverlay } from '@/components/canvas/GizmoOverlay';
// `saveProject` / `loadProject` are dynamic-imported inside the save
// and load handlers — keeps jszip out of the boot bundle.
import { normalizeVariants } from '@/io/variantNormalizer';
import { resetPoseDraft, resetToRestPose } from '@/services/PoseService';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RotateCcw, ChevronDown, Anchor } from 'lucide-react';

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
  hitContextRef = null,
  previewMode = false,
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  // Mesh worker pool — long-lived workers reused across remesh calls.
  // Was a Map<partId, Worker> with `new Worker(...)` per-call which on
  // `autoMeshAllParts` spawned N simultaneous workers competing for
  // one CPU and re-parsing the mesh module N times. The per-partId
  // sequence Map drops stale results when a part is remeshed twice
  // before the first job finishes.
  const meshPoolRef = useRef(/** @type {ReturnType<typeof createMeshWorkerPool>|null} */ (null));
  const meshDispatchSeqRef = useRef(/** @type {Map<string, number>} */ (new Map()));
  const lastUploadedSourcesRef = useRef(new Map()); // Map<partId, string> (source URI)
  // M7b — pre-mesh alpha hit-test now uses 256² downsampled `Uint8Array`
  // masks (~64 KB each) instead of canvas-sized RGBA `ImageData`
  // (~64 MB at 4K). Wizard reorder/adjust hit-test reads
  // `sampleAlphaMask(record, x, y)`.
  const imageDataMapRef = useRef(new Map()); // Map<partId, AlphaMaskRecord>
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

  // GAP-010 Phase B — `view` is per-mode. CanvasViewport derives its
  // mode from the `previewMode` prop and routes every read/write
  // through `viewByMode[modeKey]` / `setView(modeKey, partial)`.
  const modeKey = previewMode ? 'livePreview' : 'viewport';

  // Field-level subscriptions — replaces a whole-store `useEditorStore()`
  // that re-rendered this 2700-line component on every editor mutation
  // (brush-stroke draft, hover state, gizmo handle drag, etc.). Now we
  // only re-render when one of these specific fields changes.
  const view = useEditorStore((s) => s.viewByMode[modeKey]);
  const selection = useEditorStore((s) => s.selection);
  const viewLayers = useEditorStore((s) => s.viewLayers);
  const editMode = useEditorStore((s) => s.editMode);
  const activeBlendShapeId = useEditorStore((s) => s.activeBlendShapeId);
  const brushSize = useEditorStore((s) => s.brushSize);
  const meshSubMode = useEditorStore((s) => s.meshSubMode);
  const setViewAction = useEditorStore((s) => s.setView);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setBrush = useEditorStore((s) => s.setBrush);

  // Render-time facade so existing `editorState.xxx` references in the
  // JSX tail continue to resolve to the subscribed values. Reference
  // equality of `editorState` itself is not checked anywhere (verified
  // via grep), so rebuilding the object each render is safe.
  const editorState = {
    viewByMode: { [modeKey]: view },
    selection,
    viewLayers,
    editMode,
    activeBlendShapeId,
    brushSize,
    meshSubMode,
    setSelection,
    setView: setViewAction,
  };
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
  /** @param {{zoom?:number,panX?:number,panY?:number}} partial */
  const setView = useCallback(
    (partial) => setViewAction(modeKey, partial),
    [modeKey, setViewAction],
  );
  const { themeMode, osTheme } = useTheme();

  // Animation store — subscribe to ONLY the two fields that need to
  // mark the rAF dirty. The rAF tick reads everything else through
  // `animRef.current`, kept current by a subscribe-effect that does
  // NOT trigger React re-renders. Was `useAnimationStore()` (whole
  // store) which re-rendered on every animation tick.
  const currentTime = useAnimationStore((s) => s.currentTime);
  const draftPose = useAnimationStore((s) => s.draftPose);
  const animRef = useRef(useAnimationStore.getState());
  useEffect(() => useAnimationStore.subscribe((s) => { animRef.current = s; }), []);

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
  // BFA-001 — editorMode is derived from the workspace; subscribe via
  // the canonical selector so React re-renders push the prop into
  // SkeletonOverlay / GizmoOverlay when the workspace flips.
  const editorMode = useUIV3Store(selectEditorMode);

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
  // Cubism eye-blink driver — port of `CubismEyeBlink` from the Web
  // Framework. Live Preview ticks it on every rAF frame and writes the
  // resulting ParamEyeLOpen / ParamEyeROpen values into the values
  // map. Default state machine: Interval → Closing → Closed → Opening
  // → Interval; ~3.5s mean wait between blinks. Re-armed via
  // `.reset()` whenever the surface re-mounts in livePreview mode so
  // the next blink fires within a few seconds of entering the tab.
  const eyeBlinkRef = useRef(/** @type {EyeBlinkDriver|null} */ (null));
  if (eyeBlinkRef.current === null) {
    eyeBlinkRef.current = new EyeBlinkDriver();
  }
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
  // Latest per-part FINAL canvas-px verts (post chainEval + two-bone
  // LBS + blend shapes), keyed by partId. Stashed so the click-to-
  // select hit-test (`hitTestParts`) can match against the same
  // geometry the renderer just drew. Without this, a click on a
  // posed limb falls through because hit-test sees the rest mesh.
  const lastFinalVertsRef = useRef(/** @type {Map<string, Array<{x:number,y:number}>>} */(new Map()));
  // BUG-015 instrumentation — throttle for the BodyAngle eval-watch log.
  const lastBodyAngleLogTimestampRef = useRef(0);
  // Toolset Phase 1.B — lasso candidate state (deferred Ctrl+LMB).
  // On Ctrl+LMB-down we don't know yet whether this is a lasso (drag)
  // or a click-time op (Edit Mode shortest-path-pick / Object-Mode
  // no-op). Stash the candidate; threshold-cross in onPointerMove
  // promotes to the lasso modal, pointerup-without-cross runs the
  // click fallback.
  const lassoCandidateRef = useRef(/** @type {null | {startClient:{x:number,y:number}, mode:'object'|'edit', editPartId:string|null, onClickFallback:(()=>void)|null}} */ (null));

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
                
                // Maintain imageDataMapRef for alpha picking (M7b: downsampled mask)
                const off = document.createElement('canvas');
                off.width = img.width; off.height = img.height;
                const ctx = off.getContext('2d');
                ctx.drawImage(img, 0, 0);
                imageDataMapRef.current.set(node.id, downsampleAlphaMask(
                  ctx.getImageData(0, 0, img.width, img.height),
                ));
                
                isDirtyRef.current = true;
              }
            }
          };
          img.src = sourceToUpload;
        }
      }

      // 2. Mesh Sync
      if (!scene.parts.hasMesh(node.id)) {
        const nodeMesh = getMesh(node, project);
        if (nodeMesh) {
          scene.parts.uploadMesh(node.id, nodeMesh);
          isDirtyRef.current = true;
        } else if (node.imageWidth && node.imageHeight) {
          scene.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
          isDirtyRef.current = true;
        }
      }
    }

    // 3. GPU resource prune — release VAO/VBO/IBO/texture for any part
    //    no longer present in `project.nodes`. Without this the
    //    PartRenderer's `_parts` Map grows for the lifetime of the
    //    WebGL context (50 imports × 4k texture = ~12 GB GPU pressure
    //    over a session). Same prune for the alpha-picking ImageData
    //    cache and the texture-source memo.
    const liveIds = new Set();
    for (const node of project.nodes) {
      if (node.type === 'part') liveIds.add(node.id);
    }
    for (const partId of [...scene.parts.partIds()]) {
      if (!liveIds.has(partId)) {
        scene.parts.destroyPart(partId);
        imageDataMapRef.current.delete(partId);
        lastUploadedSourcesRef.current.delete(partId);
        isDirtyRef.current = true;
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

    // Mesh worker pool — long-lived workers shared across remesh calls.
    // Lifetime matches the WebGL context (mounted/destroyed together).
    if (!meshPoolRef.current) meshPoolRef.current = createMeshWorkerPool();

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
      if (getEditorMode() === 'animation') {
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
              // Animation playback: write to values map only; don't fan
              // out to bone.pose.rotation. Per-frame projectStore churn
              // would re-render every node-subscriber. Bone canonical
              // truth lives in pose.rotation when user authors; playback
              // just animates the deformer-facing param mirror.
              useParamValuesStore.getState().setMany(updates, { skipBoneMirror: true });
              isDirtyRef.current = true;
            }
          }
        }
      }

      // Phase 0.B of Animation Blender-Parity Plan (2026-05-09) —
      // project-wide driver pass. Walks every `project.parameters[i].driver`
      // (and reserved-for-Phase-1 `node.transformDrivers[<field>]`) and
      // computes their values from `valuesForEval`. Driver outputs override
      // both slider state AND animation keyframes — drivers are the most
      // explicit user authoring. Cheap when there are no drivers
      // (collectDrivers returns []).
      //
      // Phase 0 scope: only param drivers reach the eval substrate. The
      // returned map is projected to `paramId → value` via
      // `driverOverridesToParamMap` and merged into `valuesForEval`.
      // Transform drivers (which would mutate `node.transform.<field>`
      // per-frame) flow through the depgraph branch below — the
      // production wire landed in Phase 0.D.0 (2026-05-10) — so when
      // `evalEngine === 'depgraph'`, transform drivers are picked up
      // via the depgraph's TRANSFORM_COMPOSE op rather than this
      // pre-evalRig merge.
      const _projForDrivers = projectRef.current;
      const _driverOverrides = evaluateProjectDrivers(_projForDrivers, {
        project: _projForDrivers,
        currentValues: valuesForEval,
      });
      if (_driverOverrides.size > 0) {
        const _paramDriverMap = driverOverridesToParamMap(_driverOverrides);
        const _driverParamIds = Object.keys(_paramDriverMap);
        if (_driverParamIds.length > 0) {
          const _merged = { ...valuesForEval };
          for (const pid of _driverParamIds) {
            _merged[pid] = _paramDriverMap[pid];
          }
          valuesForEval = _merged;
          // Mirror to paramValuesStore so the ParametersEditor sliders
          // visualise driver-driven values (parity with animation
          // playback's slider mirror above; same `skipBoneMirror` rule).
          useParamValuesStore.getState().setMany(_paramDriverMap, { skipBoneMirror: true });
          isDirtyRef.current = true;
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

        // Eye blink — Cubism Web Framework's `CubismEyeBlink`. Drives
        // `ParamEyeLOpen` / `ParamEyeROpen` (or whatever the project's
        // `groups.EyeBlink` table names) on a periodic state machine.
        // `dtBlink` shares the same physics-clock derivation so the
        // first frame is dt=0 (no jump on entry to Live Preview).
        const dtBlink = lastPhysicsTimestampRef.current !== 0
          ? Math.min(0.5, Math.max(0, (timestamp - lastPhysicsTimestampRef.current) / 1000))
          : 0;
        const blinkValue = eyeBlinkRef.current.tick(dtBlink);
        const blinkParamIds = resolveEyeBlinkParamIds(projectRef.current);
        for (const paramId of blinkParamIds) {
          updates[paramId] = blinkValue;
        }

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
          // R12: `valuesForEval` is no longer assigned here — it's
          // always `paramValuesRef.current` after the R1 epsilon
          // filter advances the ref below. `working` was a fresh
          // object every frame and made the eval cache (line 802
          // identity check) unreachable in livePreview.
        } else {
          // No physics rules path. Same R12 invariant — no
          // `valuesForEval` assignment here either.
          physicsRigSpecRef.current = null;
          physicsStateRef.current = null;
        }

        lastPhysicsTimestampRef.current = timestamp;

        if (Object.keys(updates).length > 0) {
          // Live preview tick (physics + breath/look): write to values
          // map only; skipBoneMirror so per-frame physics output doesn't
          // mutate projectStore each frame and force every node-subscriber
          // to re-render. Mesh deformation comes from chainEval reading
          // the values map; bone visual handle stays at its authored
          // pose, which is the right thing for runtime physics (it's
          // not user authoring).
          //
          // Filter out keys whose value is bit-identical to (or sub-
          // perceptibly close to) the current store value. Without this
          // gate, every breath/blink/look/physics tick fanned out a
          // setMany even when no value actually changed (e.g. when
          // breath sat at peak with dt < 1ms, or when the user paused
          // the live preview). The eval cache below also keys on the
          // valuesForEval object identity, so unconditional setMany
          // forced a fresh object every frame and made the cache hit
          // path unreachable.
          const PARAM_DELTA_EPSILON = 1e-4;
          const realUpdates = {};
          let realCount = 0;
          for (const k of Object.keys(updates)) {
            const prev = paramValuesRef.current[k] ?? 0;
            if (Math.abs(updates[k] - prev) > PARAM_DELTA_EPSILON) {
              realUpdates[k] = updates[k];
              realCount++;
            }
          }
          if (realCount > 0) {
            useParamValuesStore.getState().setMany(realUpdates, { skipBoneMirror: true });
            // R12: advance the ref synchronously to match the
            // just-written store state. React's re-render commit
            // hasn't fired yet within this rAF tick, so the existing
            // ref-update path lags by one frame; the eval cache fill
            // below stores `paramValues: paramValuesRef.current` and
            // needs the ref to point at the post-setMany values for
            // the next idle frame's identity check to hit.
            paramValuesRef.current = useParamValuesStore.getState().values;
            isDirtyRef.current = true;
          }
        }
        // R12: `valuesForEval` is always `paramValuesRef.current`
        // (post-setMany on real-change frames, unchanged on idle
        // frames). The eval cache below (line ~802) keys on this
        // identity, so idle frames hit the cache and skip evalRig.
        valuesForEval = paramValuesRef.current;
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
        if (getEditorMode() === 'animation') {
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
          // PP2-010 — only collect lifted grids when the warp-grid overlay is
          // actually mounted. Allocates a fresh Map per eval; cheap, but
          // skipping when invisible avoids the per-frame allocation.
          const _wantLifted = !previewModeRef.current
            && (editorRef.current.viewLayers?.warpGrids ?? true);
          if (cache.rigSpec === _rigSpec && cache.paramValues === valuesForEval && cache.frames !== null) {
            frames = cache.frames;
          } else {
            const evalOut = _wantLifted ? { liftedGrids: new Map() } : null;
            // Phase 0.D.0 — branch on `preferencesStore.evalEngine`.
            // `'depgraph'` routes through `evalProjectFrameViaDepgraph`
            // (kernels port `evalArtMeshFrame`); `'classic'` keeps
            // chainEval's evalRig. Both produce the same `ArtMeshFrame[]`
            // shape so the rest of the tick is engine-agnostic.
            const _evalEngine = usePreferencesStore.getState().evalEngine;
            if (_evalEngine === 'depgraph') {
              frames = evalProjectFrameViaDepgraph(projectRef.current, valuesForEval);
            } else {
              frames = evalRig(_rigSpec, valuesForEval, evalOut ? { out: evalOut } : undefined);
            }
            lastEvalCacheRef.current = {
              rigSpec: _rigSpec, paramValues: valuesForEval, frames,
              liftedGrids: evalOut?.liftedGrids ?? null,
            };
            // Publish to rigEvalStore so WarpDeformerOverlay sees the
            // current-frame lattice positions for every warp (including
            // nested normalised-0to1 ones, which the Phase 1 overlay
            // skipped entirely). depgraph branch leaves liftedGrids
            // null for now — overlay falls back to its own probe path.
            useRigEvalStore.getState().setLiftedGrids(evalOut?.liftedGrids ?? null);
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
            (_ed_mesh.editMode === 'edit' && Array.isArray(_ed_mesh.selection) && _ed_mesh.selection.length > 0)
              ? _ed_mesh.selection[0]
              : null;
          // Per-bone WORLD matrix map (composed through bone-group
          // ancestors). Skinning looks up by `jointBoneId` so a part
          // weighted to leftElbow follows leftArm rotations too —
          // leftElbow's WORLD includes leftArm's pose. Reading the
          // bone's own pose alone misses ancestor rotations.
          const boneWorld = computeBoneWorldMatrices(projectRef.current.nodes);
          // Per-bone PARENT bone id map. Two-bone LBS needs the joint
          // bone's parent so weight=0 verts follow the parent's rotation
          // (e.g. rotating leftArm drags the upper-arm vertices weighted
          // to leftArm even though jointBoneId=leftElbow).
          const boneParents = computeBoneParentMap(projectRef.current.nodes);
          // Per-part overlay matrix map for the rigid-follow path
          // (parts with NO vertex groups + NO Armature modifier whose
          // nearest ancestor is a bone group). Reuses the boneWorld
          // map computed above instead of rebuilding it (which is what
          // the bare `computeBoneOverlayMatrices(nodes)` form does).
          const boneOverlay = computeBoneOverlayMatrices(projectRef.current.nodes, boneWorld);
          // Map of nodes by id, used for the per-frame `node` lookup
          // below. Replaces a `projectRef.current.nodes.find(...)` per
          // art mesh per frame (~10k linear comparisons on a 100-part
          // rig); single Map.get is O(1).
          const nodesById = new Map();
          for (const _n of projectRef.current.nodes) nodesById.set(_n.id, _n);
          for (const f of frames) {
            assertPartId(f.id, 'evalRig frame.id');
            if (f.id === _meshEditingPartId) continue;
            const node = nodesById.get(f.id);
            if (!getMesh(node, projectRef.current)) {
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
            // BONE_ARMATURE_INDEPENDENCE (2026-05-08) + Cubism Adapter
            // revert (2026-05-09 afternoon) — composition decision is
            // 3-state, mirroring Blender's two distinct mechanisms:
            //   1. **LBS** — per-vertex weighted skinning when the part
            //      has vertex groups + an enabled Armature modifier.
            //      Mirrors Blender's `pchan_bone_deform`. True skinning
            //      case (limb blend zones via `computeSkinWeights`).
            //   2. **Overlay** — uniform world-matrix multiplication
            //      when the part has NO vertex groups but a bone-group
            //      ancestor (rigid follow). Mirrors Blender's "child of
            //      bone, no Armature modifier" semantics.
            //   3. **None** — Apply Modifier was used (vertex groups
            //      remain but modifier gone — Blender's `Apply` keeps
            //      `me->dvert` but ends bone influence) OR no bone
            //      ancestor at all.
            //
            // The composition decision gates deterministically on
            // (hasWeights, hasModifier, isBoneAncestor). BUG-028's
            // double-composition (overlay AND LBS-baked rest) can't
            // recur because LBS and overlay are mutually exclusive
            // by predicate.
            //
            // Both paths read `node.pose.{rotation,x,y,scaleX,scaleY}`.
            // The bone gesture (SkeletonOverlay) writes pose.rotation;
            // `ParamRotation_<bone>` slider stays independent — its
            // effect is already baked into chainEval's frame output via
            // cellSelect over the param-driven keyforms. So bone-pose
            // composition runs ON TOP of param-driven deformation.
            const partMesh = getMesh(node, projectRef.current);
            // Phase 0.D — when the depgraph engine produced `frames`,
            // bone post-chain composition (LBS / overlay) already ran
            // inside `kernelArtMeshEval` against TRANSFORM_COMPOSE
            // outputs. Re-applying here would double-compose. Classic
            // engine emits PRE-skin verts and still needs this pass.
            if (_evalEngine !== 'depgraph') {
              const composition = pickBonePostChainComposition(node, partMesh);
              if (composition.kind === 'lbs') {
                // Two-bone LBS (mirrors Blender pchan_bone_deform): the
                // joint bone (leftElbow) is the CHILD; its bone-tree parent
                // (leftArm) is the PARENT. weight=0 → parent.world,
                // weight=1 → child.world, mid → lerp.
                const childMatrix = boneWorld.get(composition.jointBoneId);
                const parentBoneId = composition.parentBoneId
                  ?? boneParents.get(composition.jointBoneId) ?? null;
                const parentMatrix = parentBoneId ? boneWorld.get(parentBoneId) ?? null : null;
                applyTwoBoneSkinningObj(verts, parentMatrix, childMatrix, partMesh.boneWeights);
              } else if (composition.kind === 'overlay') {
                // Rigid follow — uniform world-matrix multiplication for
                // parts that follow a bone via parent-chain transform but
                // aren't per-vertex skinned. The overlay map only contains
                // entries for parts whose nearest bone has non-identity
                // pose; identity-pose bones produce a no-op
                // `Map.get(node.id) === undefined` and `applyOverlayMatrixObj`
                // bails on the null-matrix early return.
                applyOverlayMatrixObj(verts, boneOverlay.get(node.id) ?? null);
              }
            }
            // composition.kind === 'none' → no bone-pose composition.
            // Two reasons:
            //   - 'applied': "Apply Modifier" was used. Vertex groups
            //     persist on the mesh datablock; the modifier-removal
            //     ends bone influence (Blender semantic). Part renders
            //     at its baked keyform geometry. Re-bind via
            //     "Add Modifier → Armature" or re-run Init Rig.
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
          if (!isMeshedPart(node, projectRef.current) || !node.blendShapes?.length) continue;
          const draft = anim.draftPose.get(node.id);
          const kfOv = poseOverrides?.get(node.id);

          let hasInfluence = false;
          const influences = node.blendShapes.map(shape => {
            // While painting a shape (Edit Mode + active-shape pointer set),
            // pin the active shape at full influence so the user sees
            // visible deltas as they paint.
            if (ed.editMode === 'edit' && ed.activeBlendShapeId === shape.id) {
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
          const baseVerts = kfOv?.mesh_verts ?? getMesh(node, projectRef.current).vertices;
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
        // Snapshot for the click-to-select hit-test. Same final verts
        // the renderer is about to draw — without this snapshot,
        // hit-test would see chainEval rest geometry while the user
        // sees the LBS-deformed limb (BUG-026, 2026-05-08).
        const finalVerts = lastFinalVertsRef.current;
        finalVerts.clear();
        if (poseOverrides) {
          for (const [nodeId, ov] of poseOverrides) {
            if (!ov.mesh_verts) continue;
            newMeshOverridden.add(nodeId);
            finalVerts.set(nodeId, ov.mesh_verts);
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            const m = getMesh(node, projectRef.current);
            if (m) {
              sceneRef.current.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(m.uvs));
            }
          }
        }
        for (const nodeId of meshOverriddenParts.current) {
          if (!newMeshOverridden.has(nodeId)) {
            // Override removed — restore base mesh from projectStore
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            const m = getMesh(node, projectRef.current);
            if (m) {
              sceneRef.current.parts.uploadPositions(nodeId, m.vertices, new Float32Array(m.uvs));
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
      // Tear down the mesh worker pool. Without this, terminated
      // CanvasViewport mounts (workspace switch, tab swap) would leave
      // their POOL_SIZE workers running indefinitely with their full
      // triangulation state pinned in memory.
      if (meshPoolRef.current) {
        meshPoolRef.current.destroy();
        meshPoolRef.current = null;
      }
      meshDispatchSeqRef.current.clear();
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, []);

  /* ── Mark dirty when editor view / viewLayers / selection changes ──── */
  useEffect(() => { isDirtyRef.current = true; },
    [view, selection, viewLayers, editMode, activeBlendShapeId]);

  /* ── PP2-007 — mark dirty when the canvas tab toggles (modeKey flips).
       The shared CanvasViewport instance has a different `view` slot per
       tab; without an explicit dirty flag the rAF tick happily re-uses
       its last-rendered output, so the freshly-active tab's pan/zoom
       state doesn't paint until something else triggers a redraw. */
  useEffect(() => { isDirtyRef.current = true; }, [modeKey]);

  /* ── Mark dirty when workspace changes (BUG-012 policy may flip) ─────── */
  useEffect(() => { isDirtyRef.current = true; }, [activeWorkspace]);

  /* ── Mark dirty when animation time or draft pose changes ───────────── */
  useEffect(() => { isDirtyRef.current = true; }, [currentTime]);
  useEffect(() => { isDirtyRef.current = true; }, [draftPose]);

  /* ── [ / ] brush size shortcuts (only in deform edit mode or blend shape edit mode) ────────────── */
  useEffect(() => {
    // GAP-010 — Live Preview surface is read-only; don't bind window-level
    // keyboard shortcuts on it (would also double-fire if both surfaces are
    // mounted simultaneously).
    if (previewMode) return;
    const handler = (e) => {
      const { editMode, meshSubMode, brushSize } = editorRef.current;
      // Brush keys [/] adjust radius. Active in Edit Mode (deform sub-mode
      // OR shape-paint with active blend shape).
      const brushActive = editMode === 'edit'
        && (meshSubMode === 'deform' || !!editorRef.current.activeBlendShapeId);
      if (!brushActive) return;
      if (e.key === '[') setBrush({ brushSize: Math.max(5, brushSize - 5) });
      else if (e.key === ']') setBrush({ brushSize: Math.min(300, brushSize + 5) });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setBrush, previewMode]);

  /* ── PP1-008(b) — exit F-mode radius adjust when leaving mesh edit ── */
  useEffect(() => {
    if (editMode !== 'mesh' && radiusAdjustModeRef.current.active) {
      radiusAdjustModeRef.current.active = false;
      radiusAdjustModeRef.current.startRadius = null;
      radiusAdjustModeRef.current.anchorClientX = null;
      radiusAdjustModeRef.current.anchorClientY = null;
      isDirtyRef.current = true;
    }
  }, [editMode]);

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
      if (getEditorMode() !== 'animation') return;

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
        if (node && JSKinningRoles.has(getBoneRole(node))) {
          for (const pt of proj.nodes) {
            const ptMesh = getMesh(pt, proj);
            if (ptMesh?.jointBoneId === selectedId) {
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
          const nodeMesh = getMesh(node, p);
          if (node.type === 'part' && nodeMesh) {
            const hasMeshDeform = draft?.mesh_verts !== undefined;
            let meshTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'mesh_verts');

            if (hasMeshDeform || meshTrack) {
              const meshVerts = draft?.mesh_verts
                ?? kfValues?.mesh_verts
                ?? nodeMesh.vertices.map(v => ({ x: v.x, y: v.y }));

              const isNewMeshTrack = !meshTrack;
              if (!meshTrack) {
                meshTrack = { nodeId, property: 'mesh_verts', keyframes: [] };
                animation.tracks.push(meshTrack);
              }

              // Auto-insert base-mesh keyframe at startFrame if this is the first keyframe
              if (isNewMeshTrack && currentTimeMs > startMs) {
                const baseVerts = nodeMesh.vertices.map(v => ({ x: v.x, y: v.y }));
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
    if (!meshPoolRef.current) return;
    // Per-partId sequence — drop stale results if the user remeshes a
    // part twice before the first job completes (can happen when
    // imageBounds changes mid-meshing).
    const seq = (meshDispatchSeqRef.current.get(partId) ?? 0) + 1;
    meshDispatchSeqRef.current.set(partId, seq);

    meshPoolRef.current.enqueue(partId, imageData, opts).then((data) => {
      if (meshDispatchSeqRef.current.get(partId) !== seq) return;
      const { vertices, uvs, triangles, edgeIndices } = data;

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

          setMesh(node, { vertices, uvs: Array.from(uvs), triangles, edgeIndices }, proj);

          // Compute skin weights if this part belongs to a limb.
          const parentGroup = proj.nodes.find(n => n.id === node.parent);
          const childRole = childBoneRoleFor(getBoneRole(parentGroup));
          if (childRole && parentGroup) {
            const jointBone = proj.nodes.find(n => n.parent === parentGroup.id && getBoneRole(n) === childRole);
            const newMesh = getMesh(node, proj);
            if (jointBone && newMesh) {
              newMesh.boneWeights = computeSkinWeights(vertices, parentGroup, jointBone);
              newMesh.jointBoneId = jointBone.id;
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

      // M7a — drop the imageDataMapRef entry now that this part has a
      // triangulated mesh. hitTest.js prioritises the triangle path
      // ([line 188](../../io/hitTest.js#L188)) over the alpha-sample
      // path; once mesh exists, the imageData entry is dead weight
      // memory (~64 MB per 4K-canvas part). The wizard reorder/adjust
      // step still uses the entry for parts that haven't been meshed
      // yet — those entries persist until their part also gets
      // auto-meshed (at wizard finalize → autoMeshAllParts).
      imageDataMapRef.current.delete(partId);
    }).catch((err) => {
      console.error('[MeshWorker]', err);
    });
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
    const parts = proj.nodes.filter(n => n.type === 'part' && !getMesh(n, proj));
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
      if (n) clearMesh(n, p);
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

      // M7b — store downsampled alpha mask for alpha-based picking
      imageDataMapRef.current.set(partId, downsampleAlphaMask(imageData));

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
  const finalizePsdImport = useCallback(async (psdW, psdH, layers, partIds, groupDefs, assignments) => {
    const setExpandedGroups = useEditorStore.getState().setExpandedGroups;
    const setActiveLayerTab = useEditorStore.getState().setActiveLayerTab;

    // Auto-expand all new groups and switch to Groups tab
    if (groupDefs.length > 0) {
      setExpandedGroups(groupDefs.map(g => g.id));
      setActiveLayerTab('groups');
    }

    // P2 — per-layer compositing + PNG encoding moved to a worker pool.
    // Each worker computes the alpha mask + opaque-pixel bounds inside
    // and returns only those + the PNG buffer (transferable). The
    // canvas-sized RGBA never crosses the main-thread boundary.
    //
    // Layer buffers are CLONED at dispatch (not transferred) because
    // back→re-finalize re-reads pendingPsd.layers; transferring would
    // empty those buffers for the second pass. Clone cost is contained
    // (per-layer-sized, parallelized across workers).
    const { createPsdFinalizeWorkerPool } = await import('@/io/psdFinalizeWorkerPool');
    const pool = createPsdFinalizeWorkerPool();
    /** @type {Array<{layerIndex:number, alphaMask:any, imageBounds:any, url:string}>} */
    const composited = new Array(layers.length);
    try {
      const dispatches = layers.map((layer, i) => {
        const layerData = new Uint8ClampedArray(layer.imageData.data).buffer;
        return pool.enqueue({
          layerData,
          layerW: layer.imageData.width,
          layerH: layer.imageData.height,
          layerX: layer.x,
          layerY: layer.y,
          psdW,
          psdH,
          layerIndex: i,
        }).then((res) => {
          const blob = new Blob([res.pngBuffer], { type: 'image/png' });
          composited[res.layerIndex] = {
            layerIndex: res.layerIndex,
            alphaMask: res.alphaMask,
            imageBounds: res.imageBounds,
            url: URL.createObjectURL(blob),
          };
        });
      });
      await Promise.all(dispatches);
    } finally {
      pool.destroy();
    }

    // Populate alpha-mask cache up front. Hit-test (wizard reorder/
    // adjust steps) reads this map directly.
    for (const c of composited) {
      const partId = partIds[c.layerIndex];
      imageDataMapRef.current.set(partId, c.alphaMask);
    }

    updateProject((proj, ver) => {
      proj.canvas.width = psdW;
      proj.canvas.height = psdH;

      // Create group nodes first (so parent IDs exist when parts reference them)
      for (const g of groupDefs) {
        const isBone = !!g.boneRole;
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
          // Schema v17 — bones carry a separate `pose` slot. Born identity
          // for fresh imports; SkeletonOverlay drags write here.
          ...(isBone
            ? { pose: { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 } }
            : null),
        });
      }

      layers.forEach((layer, i) => {
        const partId = partIds[i];
        const c = composited[i];
        const assignment = assignments?.get(i);
        proj.textures.push({ id: partId, source: c.url });
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
          imageBounds: c.imageBounds || { minX: 0, minY: 0, maxX: psdW, maxY: psdH },
        });
      });

      // Single source of truth for .smile / .sad / .angry variants:
      // pair them with their base, reparent to match, and renumber
      // draw_order so each variant sits immediately on top of its base.
      normalizeVariants(proj);

      ver.textureVersion++;
    });

    // GL upload runs after the project commit so the renderer doesn't
    // try to draw against a not-yet-committed texture entry. Loads in
    // parallel — `Image.onload` fires whenever each PNG decode lands.
    for (const c of composited) {
      const partId = partIds[c.layerIndex];
      const img2 = new Image();
      img2.onload = () => {
        const scene = sceneRef.current;
        if (scene) {
          scene.parts.uploadTexture(partId, img2);
          scene.parts.uploadQuadFallback(partId, psdW, psdH);
          isDirtyRef.current = true;
        }
      };
      img2.src = c.url;
    }

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
      const { saveProject } = await import('@/io/projectFile');
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
      const { loadProject } = await import('@/io/projectFile');
      const { project: loadedProject, images } = await loadProject(file);

      // Destroy all GPU resources
      if (sceneRef.current) {
        sceneRef.current.parts.destroyAll();
      }

      // Load project into store (Phase A2 — async; lazy-loads migrations)
      await useProjectStore.getState().loadProject(loadedProject);

      // Rebuild imageDataMapRef from loaded textures
      imageDataMapRef.current.clear();
      for (const [partId, img] of images) {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        // M7b — store downsampled alpha mask for alpha-based picking
        imageDataMapRef.current.set(partId, downsampleAlphaMask(imageData));
      }

      // Re-upload to GPU
      for (const node of loadedProject.nodes) {
        if (node.type !== 'part') continue;
        if (images.has(node.id)) {
          sceneRef.current?.parts.uploadTexture(node.id, images.get(node.id));
        }
        const loadedMesh = getMesh(node, loadedProject);
        if (loadedMesh) {
          sceneRef.current?.parts.uploadMesh(node.id, loadedMesh);
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
    file.arrayBuffer().then(async (buffer) => {
      const { importPsd } = await import('@/io/psd');
      let parsed;
      try { parsed = await importPsd(buffer); }
      catch (err) { console.error('[PSD Import]', err); return; }

      const { width: psdW, height: psdH, layers } = parsed;
      if (!layers.length) return;

      const partIds = layers.map(() => uid());

      if (detectCharacterFormat(layers)) {
        // See-through character detected → open import wizard.
        // GAP-001 — wizard mounts at AppShell level; we just kick it off.
        const PsdImportService = await import('@/services/PsdImportService');
        PsdImportService.start({ psdW, psdH, layers, partIds });
      } else {
        await finalizePsdImport(psdW, psdH, layers, partIds, [], null);
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
    // PP2-007 — read modeKey via ref so the wheel handler honours the
    // CURRENT canvas tab (Viewport vs Live Preview). The handler's
    // useCallback deps don't list modeKey directly; the ref keeps the
    // read fresh without forcing a re-bind on every tab toggle.
    const next = zoomAroundCursor(
      editorRef.current.viewByMode[modeKeyRef.current],
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
    // PP2-007 — read modeKey via ref so the pan/zoom start positions
    // come from the CURRENT canvas tab. This useCallback's deps don't
    // re-create when modeKey flips, so without the ref the pan would
    // start from the OTHER tab's view and jump on the first frame.
    const view = editorRef.current.viewByMode[modeKeyRef.current];

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
    const hasArmature = proj.nodes.some(n => isBoneGroup(n));
    if (editorRef.current.editMode === 'pose' && hasArmature) return;

    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);

    // Build effective nodes: apply animation pose overrides so world matrices
    // and vertex positions match what is visually displayed on the canvas.
    const animNow = animRef.current;
    const isAnimMode = getEditorMode() === 'animation';
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
    //      'select' (default)  → vertex selection (LMB / Shift-LMB /
    //                            Ctrl-LMB shortest path / empty deselect)
    //      'brush'             → multi-vertex deform (or UV adjust
    //                            when meshSubMode === 'adjust')
    //      'add_vertex'        → click adds a vertex at cursor
    //      'remove_vertex'     → click removes the nearest vertex
    const { toolMode } = editorRef.current;
    const editMode = editorRef.current.editMode;
    // Mesh-edit active = Edit Mode on a meshed part. Folded 2026-05-07:
    // shape-key painting is now Edit Mode + activeBlendShapeId pointer,
    // so the OR-with-'blendShape' is gone — single check suffices.
    const meshEditActive = editMode === 'edit';
    const currentSelection = editorRef.current.selection ?? [];
    if (meshEditActive && currentSelection.length > 0) {
      const selNode = effectiveNodes.find(n => n.id === currentSelection[0] && isMeshedPart(n, proj));
      const selMesh = selNode ? getMesh(selNode, proj) : null;
      if (selNode && selMesh) {
        const wm = worldMatrices.get(selNode.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);

        if (toolMode === 'select') {
          // Toolset Phase 0.B — vertex selection.
          // Threshold: 6px scaled by zoom (matches Blender's vertex
          // pick threshold; same constant the Weight Paint overlay uses
          // for vertex hits at the brush boundary).
          const threshold = 6 / view.zoom;
          // Selection is computed against rest verts in LOCAL space —
          // matches the renderer's vertex render-out, which the next
          // sub-step (VertexSelectionOverlay) projects through the same
          // worldMatrix the user is clicking through. Edits don't move
          // verts under the cursor (Edit Mode shows the rest mesh).
          const verts = selMesh.vertices;
          const idx = hitTestVertices(verts, lx, ly, threshold);
          const editorActions = useEditorStore.getState();
          if (idx < 0) {
            // LMB on empty space → deselect all for this part. Matches
            // Object Mode click-to-deselect behaviour. Shift+LMB on
            // empty space is a no-op (don't accidentally drop a careful
            // multi-select build).
            if (!e.shiftKey) editorActions.deselectAllVertices(selNode.id);
            return;
          }
          if (e.ctrlKey || e.metaKey) {
            // Toolset Phase 1.B — Ctrl+LMB is overloaded: a click runs
            // Blender `mesh.shortest_path_pick` (BFS path from active
            // to clicked); a drag opens the lasso modal. Defer dispatch
            // so onPointerMove can promote on threshold cross and
            // onPointerUp can run the click fallback below.
            const partId = selNode.id;
            const verts0 = verts;
            const tris0 = selMesh.triangles ?? [];
            const clickedIdx = idx;
            const onClickFallback = () => {
              const ed = useEditorStore.getState();
              const av = ed.activeVertex;
              if (av && av.partId === partId && av.vertIndex !== clickedIdx) {
                const adj = buildVertexAdjacency(tris0, verts0.length);
                const path = shortestPathBetweenVertices(adj, av.vertIndex, clickedIdx);
                if (path) {
                  const cur = ed.selectedVertexIndices.get(partId);
                  const merged = new Set(cur ?? []);
                  for (const p of path) merged.add(p);
                  ed.setVertexSelectionForPart(partId, merged);
                  ed.selectVertex(partId, clickedIdx, /* additive */ true);
                  return;
                }
              }
              ed.selectVertex(partId, clickedIdx, /* additive */ false);
            };
            lassoCandidateRef.current = {
              startClient: { x: e.clientX, y: e.clientY },
              mode: 'edit',
              editPartId: partId,
              onClickFallback,
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          if (e.shiftKey) {
            editorActions.toggleVertexSelection(selNode.id, idx);
            return;
          }
          editorActions.selectVertex(selNode.id, idx, /* additive */ false);
          return;
        }

        if (toolMode === 'add_vertex') {
          // Compute new mesh data first, then upload and persist atomically
          const newVerts = [...selMesh.vertices, { x: lx, y: ly, restX: lx, restY: ly }];
          const oldUvs = selMesh.uvs;
          const newUvs = new Float32Array(oldUvs.length + 2);
          newUvs.set(oldUvs);
          newUvs[oldUvs.length] = lx / (selNode.imageWidth ?? 1);
          newUvs[oldUvs.length + 1] = ly / (selNode.imageHeight ?? 1);
          const result = retriangulate(newVerts, newUvs, selMesh.edgeIndices);

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
            const m = getMesh(node, proj2);
            if (!m) return;
            m.vertices = result.vertices;
            m.uvs = Array.from(result.uvs);
            m.triangles = result.triangles;
          });
          // Toolset Phase 0.F — topology changed (vertex count grew).
          // Existing selection indices are still valid (added vertex is
          // appended, prior indices unchanged), but the safe contract
          // is to invalidate so callers don't accumulate stale state.
          useEditorStore.getState().invalidateVertexSelectionForPart(selNode.id);

        } else if (toolMode === 'remove_vertex') {
          const idx = findNearestVertex(selMesh.vertices, lx, ly, 14 / view.zoom);
          if (idx >= 0 && selMesh.vertices.length > 3) {
            // Compute new mesh data first
            const newVerts = selMesh.vertices.filter((_, i) => i !== idx);
            const oldUvs = selMesh.uvs;
            const newUvs = new Float32Array(oldUvs.length - 2);
            for (let i = 0; i < idx; i++) { newUvs[i * 2] = oldUvs[i * 2]; newUvs[i * 2 + 1] = oldUvs[i * 2 + 1]; }
            for (let i = idx; i < newVerts.length; i++) { newUvs[i * 2] = oldUvs[(i + 1) * 2]; newUvs[i * 2 + 1] = oldUvs[(i + 1) * 2 + 1]; }
            const oldEdge = selMesh.edgeIndices ?? new Set();
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
              const m = getMesh(node, proj2);
              if (!m) return;
              m.vertices = result.vertices;
              m.uvs = Array.from(result.uvs);
              m.triangles = result.triangles;
              m.edgeIndices = newEdge;
            });
            // Toolset Phase 0.F — topology changed (vertex count
            // shrank; the removed index made every higher index shift
            // by one). Invalidate so the selection set doesn't point
            // at the wrong vertex after the renumber.
            useEditorStore.getState().invalidateVertexSelectionForPart(selNode.id);
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
            ?? selMesh.vertices;

          // While painting a shape (Edit Mode + active-shape pointer),
          // apply existing deltas so each drag continues from the
          // visually correct position, not from rest.
          if (editorRef.current.editMode === 'edit'
              && editorRef.current.activeBlendShapeId
              && selNode.blendShapes?.length) {
            const activeShapeId = editorRef.current.activeBlendShapeId;
            effectiveVerts = selMesh.vertices.map((v, i) => {
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
              allUvs: new Float32Array(selMesh.uvs),
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

    // Toolset Phase 1.B — Object Mode Ctrl+LMB-drag → lasso select.
    // Defer dispatch (no current click-time op for Ctrl+LMB in Object
    // Mode, so the click fallback is a no-op — pure additive behaviour
    // for a previously ignored modifier). Threshold-cross in
    // onPointerMove promotes to the lasso modal.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      lassoCandidateRef.current = {
        startClient: { x: e.clientX, y: e.clientY },
        mode: 'object',
        editPartId: null,
        onClickFallback: null,
      };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Click-to-select (Object Mode). Triangle hit-test against
    // rig-evaluated vertex positions so the click matches what the
    // user actually sees rendered (not the rest mesh). Plan:
    // docs/archive/plans-shipped/CLICK_TO_SELECT.md.
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
      {
        worldMatrices,
        imageDataMap: imageDataMapRef.current,
        // Final per-part verts the renderer last drew. Includes
        // chainEval + two-bone LBS + blend shapes — i.e. what the
        // user actually sees. Hit-test prefers these over chainEval
        // frames so a posed limb is selectable at its visible
        // location (BUG-026 fix, 2026-05-08).
        finalVertsByPartId: lastFinalVertsRef.current,
      },
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
    // PP2-007 — read modeKey via ref (same reason as onPointerDown).
    const view = editorRef.current.viewByMode[modeKeyRef.current];

    // Toolset Phase 1.B — promote a Ctrl+LMB lasso candidate to the
    // modal once the cursor crosses the drag threshold. Before then
    // the candidate is a click-fallback (Edit-Mode shortest-path-pick
    // / Object-Mode no-op), preserved to onPointerUp.
    const lc = lassoCandidateRef.current;
    if (lc) {
      const dx = e.clientX - lc.startClient.x;
      const dy = e.clientY - lc.startClient.y;
      if (dx * dx + dy * dy > 16) {  // 4px²
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        useBoxSelectStore.getState().begin({
          kind: 'lasso',
          mode: lc.mode,
          editPartId: lc.editPartId,
          startClient: lc.startClient,
        });
        // Replay the move so the path picks up where we left off.
        useBoxSelectStore.getState().update({ x: e.clientX, y: e.clientY });
        lassoCandidateRef.current = null;
      }
      return;
    }

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
      // Brush cursor active in Edit Mode (deform sub-mode OR shape-paint
      // when an active shape is set). Folded 2026-05-07.
      const inDeformMode = editMode === 'edit'
        && (editorRef.current.meshSubMode === 'deform'
            || !!editorRef.current.activeBlendShapeId);
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
      // gating on `editMode === 'edit'` (rather than the whole workspace)
      // hides the ring during Object Mode, the PSD import wizard, and any
      // other context where the user can't actually deform a mesh —
      // previously the ring showed across the entire Default workspace,
      // including the reorder/adjust wizard steps where it was confusing.
      const inMeshEdit = editorRef.current.editMode === 'edit';
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

      // Edit Mode + active shape pointer = paint deltas (Blender pattern).
      // Folded 2026-05-07: pre-fold this branched on `editMode === 'blendShape'`.
      if (editorRef.current.editMode === 'edit' && editorRef.current.activeBlendShapeId) {
        const shapeId = editorRef.current.activeBlendShapeId;
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === partId);
          const m = getMesh(node, proj);
          const shape = node?.blendShapes?.find(s => s.id === shapeId);
          if (!shape || !m) return;
          for (const { index, weight } of affected) {
            const nx = verticesSnap[index].x + localDx * weight;
            const ny = verticesSnap[index].y + localDy * weight;
            shape.deltas[index] = {
              dx: nx - m.vertices[index].restX,
              dy: ny - m.vertices[index].restY,
            };
          }
        });
        return;
      }

      // In animation mode + deform: store to draftPose — don't bake into base mesh.
      // The user will press K to commit as a keyframe.
      if (getEditorMode() === 'animation' && meshSubMode === 'deform') {
        animRef.current.setDraftPose(partId, { mesh_verts: newVerts.map(v => ({ x: v.x, y: v.y })) });
        return;
      }

      // Staging mode (or adjust sub-mode): persist directly to the base mesh
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        const m = getMesh(node, proj);
        if (!m) return;
        for (const { index, startX, startY, weight } of affected) {
          const nx = startX + localDx * weight;
          const ny = startY + localDy * weight;
          m.vertices[index].x = nx;
          m.vertices[index].y = ny;
          if (meshSubMode === 'adjust') {
            m.uvs[index * 2] = nx / (imageWidth ?? 1);
            m.uvs[index * 2 + 1] = ny / (imageHeight ?? 1);
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
        const m = getMesh(node, proj);
        if (!m) return;
        m.vertices[vertexIndex].x = newLocalX;
        m.vertices[vertexIndex].y = newLocalY;
        m.uvs[vertexIndex * 2] = newLocalX / (imageWidth ?? 1);
        m.uvs[vertexIndex * 2 + 1] = newLocalY / (imageHeight ?? 1);
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
        const m = getMesh(node, proj);
        if (!m) return;
        const verts = m.vertices;
        for (const a of proportional.affected) {
          verts[a.index].x = a.startX + localDx * a.weight;
          verts[a.index].y = a.startY + localDy * a.weight;
        }
      });
    } else {
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        const m = getMesh(node, proj);
        if (!m) return;
        m.vertices[vertexIndex].x = startLocalX + localDx;
        m.vertices[vertexIndex].y = startLocalY + localDy;
      });
    }

    const scene = sceneRef.current;
    if (scene) {
      const node = projectRef.current.nodes.find(n => n.id === partId);
      const m = getMesh(node, projectRef.current);
      if (m) {
        scene.parts.uploadPositions(partId, m.vertices, new Float32Array(m.uvs));
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

    // Toolset Phase 1.B — Ctrl+LMB-up without crossing the lasso
    // threshold runs the click fallback (Edit-Mode shortest-path-pick
    // / Object-Mode no-op) and clears the candidate.
    if (lassoCandidateRef.current) {
      const lc = lassoCandidateRef.current;
      lassoCandidateRef.current = null;
      if (lc.onClickFallback) lc.onClickFallback();
      return;
    }

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
      if (editorRef.current.autoKeyframe && getEditorMode() === 'animation') {
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

  /* ── Hit-context bridge for box / lasso select overlays ─────────────── */
  // Toolset Phase 1.A — the AppShell-mounted BoxSelectOverlay /
  // LassoSelectOverlay need the latest chainEval frames + composed
  // verts to project their modal rect / polygon through what the user
  // actually sees. Refs are component-internal so we publish a getter
  // closure (returns fresh values on each call) into captureStore.
  // CanvasArea wires this through hitContextRef same shape as
  // exportCaptureRef so unmount cleanup is symmetric.
  const getHitContext = useCallback(() => ({
    canvasEl: canvasRef.current,
    frames: lastEvalCacheRef.current?.frames ?? null,
    finalVertsByPartId: lastFinalVertsRef.current,
  }), []);
  useEffect(() => { if (hitContextRef) hitContextRef.current = getHitContext; }, [hitContextRef, getHitContext]);

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
          cursor: !previewMode && editorState.editMode === 'edit' && editorState.meshSubMode === 'deform' ? 'none' : toolCursor,
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
      {!previewMode && (!editorState.viewLayers.skeleton || !project.nodes.some(n => isBoneGroup(n))) && <GizmoOverlay />}

      {/* Armature skeleton overlay (staging mode, when rig exists). */}
      {/* GAP-010 — never on the Live Preview surface.
          Wizard "adjust" step forces skeletonEditMode on so joint dots
          accept drags (otherwise pointerDown bails and the click falls
          through to part-pick → user drags the whole limb art instead
          of the elbow joint). Root dot is rendered for the same reason. */}
      {!previewMode && (() => {
        // skeletonEditMode = "joint drags are accepted by the overlay".
        //   - Pose Mode: always (writes node.pose.*).
        //   - Edit Mode (Blender's universal OB_MODE_EDIT) on an
        //     armature dataKind: writes node.transform.pivotX/Y (rest
        //     bind edit). Gated to bone selection so Edit Mode on a
        //     mesh part doesn't accidentally drag nearby joints.
        //   - Wizard "adjust" step: forced on so the user can place
        //     joints during PSD import.
        const headSel = (editorState.selection && editorState.selection.length > 0)
          ? editorState.selection[0] : null;
        const headNode = headSel ? project.nodes.find((n) => n.id === headSel) : null;
        const headIsBone = !!headNode && isBoneGroup(headNode);
        const skeletonEditMode =
          editorState.editMode === 'pose'
          || (editorState.editMode === 'edit' && headIsBone)
          || _wizardStep === 'adjust';
        return (
          <SkeletonOverlay
            view={view}
            editorMode={editorMode}
            showSkeleton={editorState.viewLayers.skeleton}
            skeletonEditMode={skeletonEditMode}
          />
        );
      })()}


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


      {/* Top-right cluster — Layers picker + Pose menu (Reset Pose +
          chevron dropdown for Apply Pose As Rest). Single absolute-
          positioned flex container so siblings can't overlap (was a
          recurring bug when Layers + Reset Pose had separate absolute
          anchors). Hidden on Live Preview (read-only).

          Reset Pose mode-dependent behaviour:
            - Animation mode → `resetPoseDraft()`  (clear draftPose + paramValues; keyframes survive)
            - Staging mode    → `resetToRestPose()` (above + bone-group poses + skinned mesh verts) */}
      {!previewMode && project.nodes.length > 0 && (
        <div className="absolute top-2 right-2 z-10 flex items-stretch gap-1.5">
          <ViewLayersPopover />
          <div className="flex items-stretch gap-px">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary" size="sm"
                  className="h-8 px-3 gap-1.5 rounded-r-none
                             bg-card/85 backdrop-blur-md
                             border border-border/60 hover:border-primary/40
                             text-foreground/80 hover:text-foreground hover:bg-card/95
                             shadow-md hover:shadow-lg hover:shadow-primary/10
                             transition-all duration-150
                             font-medium"
                  onClick={() => {
                    const mode = editorMode;
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
                {editorMode === 'animation'
                  ? 'Clear unsaved pose + reset parameters. Keyframes kept.'
                  : 'Reset bones + parameters to rest. Part transforms kept (use Properties → Reset Transform).'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="secondary" size="sm"
                className="h-8 w-7 px-0 rounded-l-none border-l-0
                           bg-card/85 backdrop-blur-md
                           border border-border/60 hover:border-primary/40
                           text-foreground/80 hover:text-foreground hover:bg-card/95
                           shadow-md hover:shadow-lg hover:shadow-primary/10
                           transition-all duration-150"
                title="Pose menu"
              >
                <ChevronDown className="h-3 w-3 opacity-70" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
              <button
                type="button"
                onClick={() => {
                  // Apply Pose As Rest — bake current pose into descendant
                  // mesh rest verts + bone pivots, zero all bone poses.
                  // Disabled in animation mode (would produce unexpected
                  // shifts at non-zero playback time).
                  if (editorMode === 'animation') {
                    logger.warn('applyPoseAsRest', 'Skipped: animation mode (switch to Default to bake pose)');
                    return;
                  }
                  useProjectStore.getState().applyPoseAsRest();
                  logger.info('applyPoseAsRest', 'Applied current pose as the new rest pose');
                }}
                disabled={editorMode === 'animation'}
                className={
                  'flex items-start gap-2 w-full text-left px-2 py-2 rounded text-[11px] ' +
                  (editorMode === 'animation'
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-muted/40 cursor-pointer')
                }
              >
                <Anchor className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-70" />
                <span className="flex-1">
                  <span className="font-medium block">Apply Pose As Rest</span>
                  <span className="text-muted-foreground/85 text-[10px] leading-snug block mt-0.5">
                    {editorMode === 'animation'
                      ? 'Switch to Default workspace first'
                      : 'Bakes current pose into mesh rest + bone pivots. Visual unchanged. Drag bones from new neutral.'}
                  </span>
                </span>
              </button>
            </PopoverContent>
          </Popover>
          </div>
        </div>
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
