import { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useParamValuesStore } from '@/store/paramValuesStore';
import { useRigSpecStore } from '@/store/rigSpecStore';
import { useRigEvalStore } from '@/store/rigEvalStore';
import { MODIFIER_MODE_EDITMODE } from '@/store/migrations/v21_modifier_mode_flags';
import { useUIV3Store, selectEditorMode, getEditorMode } from '@/store/uiV3Store';
import { useSelectionStore } from '@/store/selectionStore';
import { useBoxSelectStore } from '@/store/boxSelectStore';
import { useEditMenuStore } from '@/store/editMenuStore';
// Workspace policy module deleted 2026-05-02 — workspaces no longer
// gate modes or visualizations (Blender pattern: workspace = layout
// preset + default editorMode, nothing more). `editor.editMode` and
// `editor.viewLayers` are read directly.
// Phase 0.D.0 of Animation Blender-Parity Plan (2026-05-10) — depgraph
// production wire-in. `evalProjectFrameViaDepgraph` routes every art
// mesh through the depgraph's ART_MESH_EVAL op (with bone post-chain
// composition inside the kernel). It is the sole viewport eval path;
// the legacy chainEval `evalRig` opt-out (`evalEngine: 'classic'`) was
// removed in the Phase 7 close-out per Rule №2 (no migration baggage).
import { evalProjectFrameViaDepgraph } from '@/anim/depgraph/evalProjectFrame';
import {
  createPhysicsState,
  tickPhysics,
  buildParamSpecs,
} from '@/io/live2d/runtime/physicsTick';
import { EyeBlinkDriver, resolveEyeBlinkParamIds } from '@/io/live2d/runtime/eyeBlink';
import { computePoseOverrides, computeParamOverrides } from '@/renderer/animationEngine';
import { insertAllPropertyKeyframes } from '@/renderer/insertAllProperties';
import { getActiveSceneAction } from '@/anim/sceneAction';
// Phase 0.B of Animation Blender-Parity Plan (2026-05-09) — driver pass.
// `evaluateProjectDrivers` walks every `param.driver` (and future
// `node.transformDrivers`) and returns a Map<rnaPath, value>. Phase 0
// scope: only param drivers reach the eval substrate; transform-driver
// wiring lands with the depgraph default-flip in Phase 0.D.0.
import { evaluateProjectDrivers, driverOverridesToParamMap } from '@/anim/driverPass';
import { runAutoKey, getAutoKeyMode } from '@/anim/autoKeyDispatch';
import { insertKeyformAtInAction, INSERTKEY_FLAGS } from '@/anim/insertKeyframe';
import { frameToMs, msToFrame } from '@/lib/timeMath';
// Phase 7 Slice 7.E -- K-key first-use toast emitted from the K-key
// handler below (post-guards, pre-recipe). `toast` is fire-and-forget;
// suppression is gated by `preferences.kKeyFirstUseShown`.
import { toast } from '@/hooks/use-toast';
import { useModalVertexTransformStore } from '@/store/modalVertexTransformStore';
import { useModalTransformStore } from '@/store/modalTransformStore';
import { ScenePass } from '@/renderer/scenePass';
// `importPsd` is dynamic-imported inside `processPsdFile` — keeps
// ag-psd (and its inflate dependency) out of the boot bundle until
// the user actually drops a PSD onto the canvas.
import { detectCharacterFormat } from '@/io/armatureMeta';
import SkeletonOverlay from '@/components/canvas/SkeletonOverlay';
import { FpsOverlay } from '@/components/canvas/FpsOverlay';
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
import { hitTestParts, hitTestPartsAll, cycleHitsAfterActive, hitTestVertices, buildVertexAdjacency, shortestPathBetweenVertices } from '@/io/hitTest';
import { meshSignature, signaturesEqual } from '@/io/meshSignature';
import { captureExportFrame as captureExportFrameImpl } from '@/components/canvas/viewport/captureExportFrame';
import {
  isBoneGroup,
  isMeshedPart,
  getMesh,
  setMesh,
  clearMesh,
  getBoneRole,
  getBonePose,
} from '@/store/objectDataAccess';
import { isLatticeCageObject } from '@/store/warpLatticeAccess';
import {
  getOrBuildAdjacency,
  computeProportionalWeights,
  nextFalloff,
} from '@/lib/proportionalEdit';
import { getBrushById, smoothTick } from '@/lib/sculpt';
import { setSceneRef } from '@/lib/sceneRegistry';
import {
  childBoneRoleFor,
  computeSkinWeights,
  computeMeshCentroid,
} from '@/components/canvas/viewport/meshPostProcess';
import { routeImport } from '@/components/canvas/viewport/fileRouting';
import { findAncestorGroupsForCleanup } from '@/components/canvas/viewport/rigGroupCleanup';
import { applySplits } from '@/components/canvas/viewport/applySplits';
import { downsampleAlphaMask } from '@/components/canvas/viewport/alphaMask';
import { retriangulate } from '@/mesh/generate';
import { createMeshWorkerPool } from '@/mesh/workerPool';
import { GizmoOverlay } from '@/components/canvas/GizmoOverlay';
import { Cursor2DOverlay } from '@/components/canvas/Cursor2DOverlay';
// `saveProject` / `loadProject` are dynamic-imported inside the save
// and load handlers — keeps jszip out of the boot bundle.
import { normalizeVariants } from '@/io/variantNormalizer';

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
  // Toolset Phase 4 audit fix G-3 — per-part mesh-signature cache so the
  // mesh sync re-uploads when topology changes (Phase 4 ops, undo of a
  // topology op, save+load round-trip). The pre-fix `!hasMesh()` guard
  // skipped re-upload after undo because the GPU still HAS a mesh —
  // just a stale one with the post-op IBO. Signature comparison catches
  // every divergence via `meshSignature(mesh) === lastUploaded`.
  const lastUploadedMeshSigRef = useRef(new Map()); // Map<partId, MeshSignature>
  // PERF-4 — typed-array cache for mesh UV uploads. Keyed by the source
  // m.uvs array identity (WeakMap can't key on plain Arrays, so use a
  // plain Map; GC pressure is bounded by mesh count, not by frames).
  const uvTypedCacheRef = useRef(new Map());
  // Identity-keyed `nodeId → node` cache. Rebuilds only when
  // `project.nodes` identity changes (post-edit). Before this cache, the
  // rAF tick built a fresh Map per frame AND did `nodes.find` linear
  // scans in the GPU upload loop — ~20k pointer comparisons per frame
  // on a 100-part rig.
  const nodesByIdCacheRef = useRef({ nodes: null, map: new Map() });
  // Phase 7.A audit fix G-2 — `meshSignature` hashes vertex COUNT + tri count
  // + UV hash but not vertex XY positions, so an in-place positional shift
  // (e.g. `applySetOrigin` rewriting `mesh.vertices` to compensate for a
  // gizmo move) leaves `signaturesEqual` returning true → no re-upload. We
  // track `versionControl.geometryVersion` per part as a side channel:
  // when the project's counter has advanced past what we last uploaded,
  // bypass the signature guard. Mutators that change vertex positions
  // already bump `vc.geometryVersion++` (applySetOrigin, dispatchMeshWorker,
  // applyTopologyOp), so this is a tap on the existing signal.
  const lastUploadedGeomVersionRef = useRef(new Map()); // Map<partId, number>
  // M7b — pre-mesh alpha hit-test now uses 256² downsampled `Uint8Array`
  // masks (~64 KB each) instead of canvas-sized RGBA `ImageData`
  // (~64 MB at 4K). Wizard reorder/adjust hit-test reads
  // `sampleAlphaMask(record, x, y)`.
  const imageDataMapRef = useRef(new Map()); // Map<partId, AlphaMaskRecord>
  const dragRef = useRef(null);   // { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY }
  const panRef = useRef(null);   // { startX, startY, panX0, panY0 }
  // Audit 4 #2 (2026-05-16) — RMB context menu drag-vs-click discriminator.
  // RMB-drag continues to pan (preserves SS muscle memory). RMB-press
  // without motion opens the per-`editMode` context menu (Blender's
  // `VIEW3D_MT_<mode>_context_menu` family). Without this ref the
  // browser-`contextmenu` event — which fires *after* `pointerup` on
  // Windows — can't distinguish "user finished panning" from "user
  // clicked right mouse to summon menu". Threshold is 4 px (same
  // drag-vs-click tolerance the box-select overlay uses).
  //
  // Deviation note per `feedback_blender_reference_strict.md`: Blender's
  // modern default keymap (`left-select`, since 2.80) maps RMB → context
  // menu and MMB-drag → pan. SS deviates by keeping RMB-drag = pan
  // because (a) MMB isn't universally present on user mice (laptop
  // trackpads, Apple Magic Mouse), and (b) pre-Audit-4 SS shipped with
  // RMB-pan since v0.1, so changing the gesture would invalidate every
  // user's muscle memory. The 4 px threshold is the compromise: a clean
  // RMB click still summons the context menu, but a deliberate RMB-drag
  // keeps panning.
  const rmbDraggedRef = useRef(false);
  // Set true when a Shift+RMB press placed the 2D cursor, so the trailing
  // `contextmenu` event suppresses the menu (the gesture was a cursor set,
  // not a context-menu request).
  const cursorPlacedRef = useRef(false);
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
  const toolMode = useEditorStore((s) => s.toolMode);
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
    toolMode,
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

  // Auto-key `record` mode session state. Tracks the last frame number
  // we wrote keys at (so we don't write the same frame 4× per playback
  // second at 60 Hz rAF / 24 fps action) and whether we've already
  // taken an undo snapshot for the current recording session (so Ctrl+Z
  // returns to the pre-record state instead of stepping through every
  // recorded frame). Reset on every play→stop transition.
  const recordSessionRef = useRef(/** @type {{lastFrame: number, snapshotTaken: boolean} | null} */ (null));

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
  // Blender-parity click-cycle through overlapping parts. When the user
  // clicks at (~) the same screen position as the previous click, advance
  // to the next part behind the currently active one. Reset state is
  // implicit: a click whose screen distance from `clientX/Y` exceeds the
  // threshold gets treated as a fresh pick (top-of-stack). Matches
  // `view3d_select.cc:2384-2391` (mouse_select_eval_buffer cycle logic).
  const clickCycleRef = useRef(/** @type {{clientX:number, clientY:number} | null} */(null));
  // BUG-015 instrumentation — throttle for the BodyAngle eval-watch log.
  const lastBodyAngleLogTimestampRef = useRef(0);
  // 2026-06-10 Kora bones-don't-move bug — throttle the empty-registry warn
  // so the eval tick doesn't flood the log panel when no bones map.
  const lastBoneMirrorEmptyLogTimestampRef = useRef(0);
  // Toolset Phase 1.B — lasso candidate state (deferred Ctrl+LMB).
  // On Ctrl+LMB-down we don't know yet whether this is a lasso (drag)
  // or a click-time op (Edit Mode shortest-path-pick / Object-Mode
  // no-op). Stash the candidate; threshold-cross in onPointerMove
  // promotes to the lasso modal, pointerup-without-cross runs the
  // click fallback.
  const lassoCandidateRef = useRef(/** @type {null | {startClient:{x:number,y:number}, mode:'object'|'edit', editPartId:string|null, onClickFallback:(()=>void)|null, gestureModifier:'add'|'subtract'|null}} */ (null));

  // Stable refs for imperative callbacks.
  //
  // editorRef carries the FULL editor store (not the partial render-time
  // `editorState` facade) so event handlers can read any store field
  // without the facade needing to know about it. Subscription pattern
  // mirrors `animRef` above (L256-257). Critical: facade-only mode
  // ("editorRef.current = editorState") was the root cause of a Phase 3
  // arch-audit HIGH (sculpt UI was dead because facade missed `sculpt`),
  // and silently broke Phase 0 toolMode reads + Edit-Mode brushHardness
  // + autoKeyframe — all four fixed in one shot by switching here.
  const editorRef = useRef(useEditorStore.getState());
  const projectRef = useRef(project);
  const isDark = themeMode === 'system' ? osTheme === 'dark' : themeMode === 'dark';
  const isDarkRef = useRef(isDark);

  // Update refs synchronously in render to ensure event handlers see latest state
  projectRef.current = project;
  isDarkRef.current = isDark;

  useEffect(() => { isDirtyRef.current = true; }, [project, isDark]);
  useEffect(() => { isDirtyRef.current = true; }, [paramValues]);
  // Subscribe-driven editorRef — keeps the ref pointing at the live
  // store snapshot regardless of which fields React renders react to.
  // Without this, event handlers read whatever subset the render-time
  // facade carries, missing any field added since the facade was last
  // updated (Phase 3 arch-audit G-1).
  useEffect(() => useEditorStore.subscribe((s) => { editorRef.current = s; }), []);
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
          // MEM-05 — poison the retry by recording the source as
          // attempted; without this, a failed decode would re-fire on
          // every project mutation (deps include project.nodes +
          // versionControl.textureVersion) since lastUploadedSourcesRef
          // never advances.
          img.onerror = (err) => {
            logger.warn('viewportGL', `texture decode failed for ${node.id}`, {
              partId: node.id,
              source: sourceToUpload,
              err: String(err),
            });
            lastUploadedSourcesRef.current.set(node.id, sourceToUpload);
          };
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

      // 2. Mesh Sync — re-upload when the GPU has no mesh OR when the
      // mesh signature has diverged from what we last uploaded. The
      // signature compares vertexCount + triCount + a positional UV
      // hash, so any topology mutation (Phase 4 Merge/Dissolve/Subdivide,
      // add_vertex, remove_vertex, undo of any of them, save+load
      // round-trip) trips the divergence and triggers a re-upload.
      // Audit fix G-3 — pre-fix the guard was `!hasMesh()` which only
      // fired on first upload, leaving stale GPU geometry after undo
      // of a topology op.
      const nodeMesh = getMesh(node, project);
      const hasMeshGpu = scene.parts.hasMesh(node.id);
      if (nodeMesh) {
        const lastSig = lastUploadedMeshSigRef.current.get(node.id);
        const curSig = meshSignature(nodeMesh);
        // Audit fix G-2 — also bypass signature guard when the project's
        // geometry version has advanced past what we last uploaded for
        // this part. Catches in-place vertex-position mutations
        // (Set Origin's vertex compensation) that don't change the
        // signature shape.
        const lastGv = lastUploadedGeomVersionRef.current.get(node.id) ?? -1;
        const gvNow = versionControl.geometryVersion ?? 0;
        const gvAdvanced = gvNow !== lastGv;
        if (!hasMeshGpu || !signaturesEqual(curSig, lastSig) || gvAdvanced) {
          scene.parts.uploadMesh(node.id, nodeMesh);
          lastUploadedMeshSigRef.current.set(node.id, curSig);
          lastUploadedGeomVersionRef.current.set(node.id, gvNow);
          isDirtyRef.current = true;
        }
      } else if (!hasMeshGpu && node.imageWidth && node.imageHeight) {
        scene.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
        isDirtyRef.current = true;
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
        lastUploadedMeshSigRef.current.delete(partId);
        lastUploadedGeomVersionRef.current.delete(partId);
        isDirtyRef.current = true;
      }
    }
  }, [project.nodes, project.textures, versionControl.textureVersion, versionControl.geometryVersion]);

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

    // Phase 4 — register the scene with the global registry so keymap
    // operators (Merge / Dissolve / Subdivide) can re-upload mesh data
    // after a topology mutation. Cleanup below clears the registration.
    // `_recordMeshUpload` lets applyTopologyOp seed the sig cache after
    // its post-op upload so the sync-useEffect doesn't double-upload
    // (audit fix G-3 sister).
    setSceneRef({
      parts:       sceneRef.current.parts,
      _markDirty:  () => { isDirtyRef.current = true; },
      _recordMeshUpload: (partId, sig) => {
        lastUploadedMeshSigRef.current.set(partId, sig);
      },
    });

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

    // GL-03 — WebGL context loss handlers. Pre-fix a driver reset
    // (Windows TDR, tab backgrounded too long on mobile, Chrome per-tab
    // GPU eviction under memory pressure) invalidated every cached
    // VAO / VBO / IBO / texture in PartRenderer._parts; subsequent
    // draws emitted INVALID_OPERATION with no recovery path. Now we
    // halt the rAF on loss and re-init the scene + clear upload caches
    // on restored so the sync useEffect repopulates from project state.
    const onContextLost = (e) => {
      e.preventDefault();
      logger.warn('viewportGL', 'WebGL2 context lost — halting rAF until restore', {});
      cancelAnimationFrame(rafRef.current);
    };
    const onContextRestored = () => {
      logger.warn('viewportGL', 'WebGL2 context restored — rebuilding scene', {});
      try {
        sceneRef.current?.destroy?.();
      } catch { /* may already be lost */ }
      try {
        sceneRef.current = new ScenePass(gl);
      } catch (err) {
        logger.error('viewportGL', `ScenePass re-init after restore failed: ${err?.message ?? err}`, { err: String(err) });
        return;
      }
      setSceneRef({
        parts:       sceneRef.current.parts,
        _markDirty:  () => { isDirtyRef.current = true; },
        _recordMeshUpload: (partId, sig) => {
          lastUploadedMeshSigRef.current.set(partId, sig);
        },
      });
      // Force the sync effect to re-upload everything from project state.
      lastUploadedSourcesRef.current.clear();
      lastUploadedMeshSigRef.current.clear();
      lastUploadedGeomVersionRef.current.clear();
      uvTypedCacheRef.current.clear();
      isDirtyRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // GL-04 — tab-hidden visibility reset. Browsers suspend rAF when
    // hidden; `lastPhysicsTimestampRef` retained the LAST timestamp from
    // before the tab hid, so on resume `(timestamp - lastTs)/1000` was
    // the entire wall-clock pause. The internal clamps capped the step
    // at 0.5s but a 0.5s pendulum step is still a multi-frame jump
    // producing a visible whip. Zero the timestamp on hide so the first
    // post-resume frame's dt math short-circuits to 0.
    const onVisibilityChange = () => {
      if (document.hidden) {
        lastPhysicsTimestampRef.current = 0;
        eyeBlinkRef.current?.reset?.();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

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
      // fcurves whose rnaPath decodes to a parameter target (Live2D
      // parameter curves — motion3json + can3writer already export
      // these); the result is merged into the working values so
      // chainEval sees the animated dial position. We also push the
      // merged values into paramValuesStore so the ParametersEditor
      // sliders track playback.
      // Animation playback overlay. Pre-fix this was gated to
      // `editorMode === 'animation'` only — so pressing Space on the
      // Layout tab toggled `animationStore.isPlaying` (the operator
      // fired correctly), the playhead advanced, but the canvas
      // showed no animation because computeParamOverrides was never
      // called. Now we additionally run the overlay whenever playback
      // is active, regardless of workspace. Scrubbing in the animation
      // editor still applies overrides (the original mode gate); the
      // new disjunct lets Space play actually animate the model on
      // Layout / Live Preview / any other tab.
      const _anim = animRef.current;
      if (getEditorMode() === 'animation' || _anim.isPlaying) {
        const _proj = projectRef.current;
        // Stage 1.E: scene-bound action wins over UI-store fallback.
        const _activeAction = getActiveSceneAction(_proj, _anim.activeActionId);
        if (_activeAction) {
          const _endMs = (_anim.endFrame / _anim.fps) * 1000;
          const paramOv = computeParamOverrides(_activeAction, _anim.currentTime, _anim.loopKeyframes, _endMs);
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
      // Phase 0 scope: only param drivers reach the eval substrate via
      // this merge. The returned map is projected to `paramId → value`
      // via `driverOverridesToParamMap` and merged into `valuesForEval`.
      // Transform drivers (which would mutate `node.transform.<field>`
      // per-frame) are picked up by the depgraph's TRANSFORM_COMPOSE op
      // inside `evalProjectFrameViaDepgraph` below (Phase 0.D.0), not by
      // this pre-eval param merge.
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
          // mutate projectStore each frame. Mutating projectStore from
          // here triggers `rigSpecStore`'s subscriber (`rigSpecStore.js:265`)
          // which calls `selectRigSpec(newProject)` and writes a fresh
          // rigSpec object. CanvasViewport's per-frame check
          // `physicsRigSpecRef.current !== _rigSpecForPhysics` (line 884)
          // would then see the new rigSpec identity every frame and
          // recreate `cubismPhysicsKernel` state — wiping the pendulum
          // velocity for EVERY rule (arms, hair, clothing, breath).
          // Bone-mirror physics outputs reach `bone.pose.rotation` via
          // the live `poseOverrides` Map injected into evalProjectFrame
          // below — that's the Blender-driver-overlay path the depgraph
          // already understands, no projectStore mutation needed.
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

            // AutoKey `record` mode — snapshot the just-written driver
            // values into the active action's fcurves at the playhead's
            // frame-snapped time. The user-facing contract is "when
            // I'm on Live Preview with record mode on, the drivers I see
            // get keyed". Hard gates kept minimal:
            //   - `editor.autoKeyframe` ON (the red record-dot — explicit
            //     consent that ANY auto-key should fire)
            //   - mode is 'record' (the dropdown next to the dot)
            //   - an action is bound to the scene (else nothing to write)
            // Soft gates dropped: editor-mode workspace (record makes
            // sense anywhere the Live Preview surface runs) and isPlaying
            // (recording while paused just replace-in-place at the current
            // frame — useful as a "live snapshot per scrub position").
            const _projForKey = projectRef.current;
            const _shouldRecord = _projForKey
              && editorRef.current?.autoKeyframe
              && getAutoKeyMode(_projForKey) === 'record';
            if (_shouldRecord) {
              const _anim = animRef.current;
              const _action = getActiveSceneAction(_projForKey, _anim.activeActionId);
              if (_action) {
                const _fps = _action.fps ?? _anim.fps ?? 24;
                const _frame = msToFrame(_anim.currentTime, _fps);
                const _snappedMs = frameToMs(_frame, _fps);
                const _session = recordSessionRef.current;
                // No per-frame dedup gate. Pre-fix the block only fired
                // when `_session.lastFrame !== _frame` — fine during
                // ACTIVE PLAYBACK (the playhead advances → new frame
                // each tick), but a record-mode user "performing" the
                // character (Live Preview + cursor drive, no Space-play)
                // sat on a single frame the whole time. Result: only
                // frame 0 ever got keyed; every later driver change was
                // silently dropped.
                // Now we write on EVERY tick the outer `realCount > 0`
                // gate (line ~985) confirms driver values actually
                // changed. `insertKeyformAtInAction` with NOFLAGS
                // REPLACES the existing key at `_snappedMs`, so staying
                // on one frame refines that frame's key (no spam);
                // playback still naturally produces one key per
                // advancing frame.
                const _firstWriteOfSession = !_session?.snapshotTaken
                  || _session.actionId !== _action.id;
                // First write of a session keeps history so Ctrl+Z
                // restores the pre-record state; subsequent writes
                // skipHistory so a 600-frame record doesn't make
                // 600 undo entries.
                useProjectStore.getState().updateProject((p) => {
                  const a = (p.actions ?? []).find((x) => x.id === _action.id);
                  if (!a) return;
                  // Iterate the FULL `updates` set (every live-preview
                  // driver's value this frame), NOT `realUpdates` (the
                  // epsilon-filtered changed-only subset). `realUpdates`
                  // is the right gate for `setMany` — no store write
                  // when value is unchanged — but it's WRONG for record
                  // keying: if ParamAngleX is held at 5 while ParamBreath
                  // moves on a sine, only ParamBreath would get a key
                  // this frame and ParamAngleX would keep its last key
                  // at some earlier frame. On playback, interpolation
                  // between sparse per-param keys distorts the recorded
                  // trajectory (phantom motion for params that were
                  // actually constant). Recording is "snapshot every
                  // driver at this frame", not "snapshot drivers that
                  // changed". `insertKeyformAtInAction` with NOFLAGS
                  // replaces the existing key at this time, so the
                  // store stays compact (one key per frame per driver).
                  for (const paramId of Object.keys(updates)) {
                    const rnaPath = `objects["__params__"].values["${paramId}"]`;
                    insertKeyformAtInAction(a, rnaPath, _snappedMs, updates[paramId], INSERTKEY_FLAGS.NOFLAGS);
                  }
                }, { skipHistory: !_firstWriteOfSession });
                recordSessionRef.current = {
                  snapshotTaken: true,
                  actionId: _action.id,
                };
              }
            } else if (recordSessionRef.current) {
              // Any gate (dot OFF / mode changed away from record / no
              // action) closes the session, so a future re-arm gets its
              // own pre-record undo snapshot.
              recordSessionRef.current = null;
            }
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
        // Stage 1.E: scene-bound action wins over UI-store fallback.
        const activeAction = getActiveSceneAction(proj, anim.activeActionId);

        let poseOverrides = null;
        if (getEditorMode() === 'animation') {
          // Base: keyform-interpolated values
          const endMs = (anim.endFrame / anim.fps) * 1000;
          poseOverrides = computePoseOverrides(activeAction, anim.currentTime, anim.loopKeyframes, endMs);
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

        // Live-preview bone-mirror overlay (2026-06-03 bug-06 fix). Every
        // bone-mirror param (`ParamRotation_<bone>`) gets injected as a
        // `{rotation: paramValue}` pose override so the depgraph's
        // TRANSFORM_COMPOSE seeds the bone's pose from the live param
        // value WITHOUT mutating `bone.pose.rotation` in projectStore.
        //
        // Mutating projectStore from a per-frame driver would re-fire
        // `rigSpecStore.js:265`'s subscriber, regenerate the rigSpec
        // object identity, and reset `cubismPhysicsKernel` state via
        // the identity check at line 884 — every rule's pendulum
        // velocity would zero out each frame, producing the saturate-
        // to-min/max jitter pattern. The driver-overlay path is the
        // Blender-native equivalent: `bone.pose.rotation` is the user's
        // authored channel; live runtime drivers (physics, anim
        // playback) ride on top via the override Map. See
        // [[physics-bone-mirror-overlay]].
        //
        // Animation mode (above) wins on the same bone: if the action
        // already set a `rotation` override, we skip — keyframe authoring
        // is more explicit than live physics overlay.
        if (previewModeRef.current) {
          const _boneMirror = useParamValuesStore.getState().boneMirror?.byParam;
          if (_boneMirror && _boneMirror.size > 0) {
            for (const [paramId, boneId] of _boneMirror) {
              const v = valuesForEval[paramId];
              if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
              if (!poseOverrides) poseOverrides = new Map();
              const existing = poseOverrides.get(boneId);
              if (existing && typeof existing === 'object' && 'rotation' in existing) continue;
              poseOverrides.set(boneId, { ...(existing ?? {}), rotation: v });
            }
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
        // Identity-keyed node-by-id Map. Used by the rigSpec frames loop
        // below (was rebuilt every frame at line ~1280) AND by the GPU
        // upload loop further down (which used `nodes.find` linear
        // scans). One cached map serves both call sites.
        const _projForNodes = projectRef.current;
        const _nbiCache = nodesByIdCacheRef.current;
        if (_nbiCache.nodes !== _projForNodes.nodes) {
          _nbiCache.nodes = _projForNodes.nodes;
          _nbiCache.map = new Map();
          for (const _n of _projForNodes.nodes) _nbiCache.map.set(_n.id, _n);
        }
        const nodesById = _nbiCache.map;

        // BONE → PARAM mirror. SS's auto-rig wires the body's
        // deformation via `ParamRotation_<bone>` parameters that drive
        // Cubism warps; the bone itself is "just a mirror" of the
        // param (per [[physics-bone-mirror-overlay]]). The existing
        // PARAM → BONE overlay (a few lines above, preview-mode only)
        // handles physics/breath fanning out to bone pose. THIS pass
        // handles the OPPOSITE direction: when the user keyframes a
        // bone OR drags it in pose mode, the bone's effective rotation
        // is mirrored into the corresponding `ParamRotation_<bone>` so
        // the warp evaluator sees the rotated value and the mesh
        // deforms. Without this, bone keyframes leave the bone visually
        // rotated in the skeleton overlay but the mesh stays at rest —
        // the symptom the user reported as "armature moves, layers
        // don't follow."
        //
        // Effective rotation source priority:
        //   1. `poseOverrides[boneId].rotation` — action fcurve + user
        //      draftPose (covers animation playback + animation-mode
        //      drag).
        //   2. `node.pose.rotation` — committed staging-mode drag (which
        //      writes via `writePoseValues` direct to projectStore).
        //
        // Mirrors valuesForEval only (the eval working copy); does NOT
        // write to paramValuesStore, so we don't churn the store per
        // tick. This matches the runtime-driver pattern from the
        // physics-bone-mirror revert: overlay at eval setup, no
        // projectStore fan-out.
        const _byBoneMirror = useParamValuesStore.getState().boneMirror?.byBone;
        const _byParamMirror = useParamValuesStore.getState().boneMirror?.byParam;
        // Diagnostic — log once-per-second when the registry is EMPTY so the
        // "bones don't move the layers" failure mode is visible without
        // requiring the user to dig through rigSpecStore logs.
        if (!_byBoneMirror || _byBoneMirror.size === 0) {
          const _now = timestamp;
          if (_now - lastBoneMirrorEmptyLogTimestampRef.current > 5000) {
            lastBoneMirrorEmptyLogTimestampRef.current = _now;
            logger.warn('boneMirrorEval',
              'BONE → PARAM mirror SKIPPED: registry empty (no bone → ParamRotation_* mapping). Bone rotation will not deform the mesh.',
              {
                boneMirrorByBoneSize: _byBoneMirror?.size ?? 0,
                hint: 'Check rigSpecStore log for "setBoneMirrorRegistry: 0 entries" — it details why.',
              });
          }
        }
        if (_byBoneMirror && _byBoneMirror.size > 0) {
          // Animation mode vs staging mode source priority:
          //   - Animation mode: ONLY mirror when poseOverrides carries an
          //     explicit rotation (bone fcurve OR draftPose drag). Without
          //     this gate, the fallback to `bone.pose.rotation = 0` would
          //     overwrite the procedural `ParamRotation_<bone>` fcurve seed
          //     with rest pose for every bone that isn't currently keyed —
          //     killing the procedural Idle motion.
          //   - Staging mode (no action playing): fall back to
          //     `bone.pose.rotation` so direct pose-drag (writePoseValues)
          //     reaches the param without going through an fcurve.
          const _isAnimMode = getEditorMode() === 'animation';
          let _mutated = false;
          let _merged = valuesForEval;
          for (const [boneId, paramId] of _byBoneMirror) {
            let rotation;
            const ov = poseOverrides?.get(boneId);
            if (ov && typeof ov === 'object' && typeof ov.rotation === 'number'
                && Number.isFinite(ov.rotation)) {
              rotation = ov.rotation;
            } else if (!_isAnimMode) {
              const bone = nodesById.get(boneId);
              if (!bone) continue;
              const p = getBonePose(bone);
              const r = p?.rotation;
              if (typeof r !== 'number' || !Number.isFinite(r)) continue;
              rotation = r;
            } else {
              continue;
            }
            if (valuesForEval[paramId] === rotation) continue;
            if (!_mutated) { _merged = { ...valuesForEval }; _mutated = true; }
            _merged[paramId] = rotation;
          }
          if (_mutated) valuesForEval = _merged;
        }

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
          // Production eval — `evalProjectFrameViaDepgraph` (Phase 0.D.0
          // wire-in + Phase 0.D armature port). The legacy `evalEngine:
          // 'classic'` opt-out (chainEval `evalRig` viewport path) was
          // removed in the Phase 7 close-out per Rule №2 (no migration
          // baggage). The depgraph kernels port `evalArtMeshFrame` and
          // run bone post-chain composition (LBS / overlay) inside
          // `kernelArtMeshEval`, so the post-loop pass below no longer
          // double-composes.
          // A cache hit is only valid when it already carries the lifted
          // grids the overlay needs; otherwise toggling warp grids on for a
          // static (cache-hit) rig would leave the overlay empty until the
          // next param change.
          if (cache.rigSpec === _rigSpec && cache.paramValues === valuesForEval && cache.frames !== null
              && cache.poseOverrides === poseOverrides
              && (!_wantLifted || cache.liftedGrids)) {
            frames = cache.frames;
            if (_wantLifted && cache.liftedGrids) {
              useRigEvalStore.getState().setLiftedGrids(cache.liftedGrids);
            }
          } else {
            const evalOut = _wantLifted ? { liftedGrids: new Map() } : null;
            // Propagate action + currentTime so the depgraph's
            // ANIMATION_TRACK_EVAL / FCURVE_EVAL kernels see the playhead
            // (audit fix G-8). Without these the depgraph would always
            // evaluate at t=0 and its animation kernels would be dead code.
            // `liftedGrids` (when the overlay is mounted) is filled by the
            // runner from the depgraph's GRID_LIFT_TO_PARENT outputs.
            frames = evalProjectFrameViaDepgraph(projectRef.current, valuesForEval, {
              action: activeAction,
              timeMs: anim.currentTime,
              liftedGrids: evalOut?.liftedGrids,
              // Bone-mirror priority gate — see CanvasViewport's
              // BONE → PARAM block above + the kernel-side gate in
              // anim/depgraph/kernels/animation.js. When a procedural
              // `ParamRotation_<bone>` fcurve and the user's bone fcurve
              // both exist, the kernel skips the param write so the
              // pre-eval seed survives.
              boneMirrorByParam: _byParamMirror ?? undefined,
              // Source keyform data from the rigSpec so modifier-toggle
              // reprojection (selectRigSpec `needsReproject`) is honoured —
              // raw `mesh.runtime` keyforms stay in the baked leaf frame.
              rigSpec: _rigSpec,
              // Animated bone/part pose (action fcurves + draftPose) →
              // TRANSFORM_COMPOSE seeds skinning from these, so the mesh
              // follows the skeleton during playback AND live posing.
              poseOverrides,
            });
            lastEvalCacheRef.current = {
              rigSpec: _rigSpec, paramValues: valuesForEval, frames,
              liftedGrids: evalOut?.liftedGrids ?? null,
              poseOverrides,
            };
            // Publish to rigEvalStore so WarpDeformerOverlay sees the
            // current-frame lattice positions for every warp (including
            // nested normalised-0to1 ones, which the Phase 1 overlay
            // skipped entirely) — the depgraph composes these as
            // GRID_LIFT_TO_PARENT outputs, surfaced via the runner's
            // `liftedGrids` out-param above.
            useRigEvalStore.getState().setLiftedGrids(evalOut?.liftedGrids ?? null);
            // BUG-015 instrumentation — once-per-second snapshot of the
            // ParamBodyAngle{X,Y,Z} values that just went into the
            // depgraph eval. Helps the user repro "BodyAngle slider
            // doesn't move anything" by showing: did the eval see the
            // user's slider write? did it produce a non-zero output?
            // Throttled so a continuous param sweep doesn't drown the
            // Logs panel.
            const _now = timestamp;
            if (_now - lastBodyAngleLogTimestampRef.current > 1000) {
              const bz = valuesForEval.ParamBodyAngleZ ?? 0;
              const by = valuesForEval.ParamBodyAngleY ?? 0;
              const bx = valuesForEval.ParamBodyAngleX ?? 0;
              if (bz !== 0 || by !== 0 || bx !== 0) {
                logger.debug('depgraphBodyAngle',
                  `depgraph eval sees BodyAngle X=${bx.toFixed(2)} Y=${by.toFixed(2)} Z=${bz.toFixed(2)}`,
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
          // immediately. The eval walks rigSpec.artMeshes baked at Init
          // Rig time; once the user moves a vertex those keyforms are stale,
          // and the rig override would re-upload the stale verts every
          // frame, hiding the edit. Re-baking the keyforms mid-drag is
          // expensive — the V3 re-rig flow's Refit All (or per-stage
          // rebake) is the path to refresh the rig once the user is done.
          // Other parts stay on rig output as usual; only the selected
          // part being edited drops out.
          const _ed_mesh = editorRef.current;
          // `nodesById` is now hoisted + identity-cached above (see the
          // `_nbiCache` block at the top of this `if (isDirtyRef...)`
          // branch). Single shared Map.get is O(1) here and in the GPU
          // upload loop further down.
          // Force the actively-edited part to render at its REST `mesh.vertices`
          // (camera-only) in BOTH Edit and Weight-Paint modes. WeightPaintOverlay
          // (and the brush hit-test) project rest `mesh.vertices`; without this
          // the GL drew the part POSED (rig output) while the weight dots sat at
          // rest — the "phantom vertices on the rest pose while the arm is posed"
          // report. Pinning the part to rest makes mesh + dots share one source.
          //
          // EXCEPTION — Blender's "Show in Edit Mode" (MODE_EDITMODE / pencil):
          // when a modifier on the edited part has that bit set, the part is
          // shown DEFORMED while editing (rig-driven), not rest-pinned. The
          // rest-position vertex/weight handles over the deformed mesh ARE the
          // Blender edit-not-on-cage behavior (handles edit the original verts;
          // the displayed result is post-modifier). Default (bit off, the
          // DEFAULT_MIGRATED_MODE) keeps the clean rest-pin.
          const _isMeshEditMode = _ed_mesh.editMode === 'edit' || _ed_mesh.editMode === 'weightPaint';
          const _editSelId =
            (_isMeshEditMode && Array.isArray(_ed_mesh.selection) && _ed_mesh.selection.length > 0)
              ? _ed_mesh.selection[0]
              : null;
          const _editSelNode = _editSelId ? nodesById.get(_editSelId) : null;
          const _showDeformedInEdit = Array.isArray(_editSelNode?.modifiers)
            && _editSelNode.modifiers.some(
              (m) => m && ((typeof m.mode === 'number' ? m.mode : 0) & MODIFIER_MODE_EDITMODE) !== 0,
            );
          const _meshEditingPartId = (_editSelId && !_showDeformedInEdit) ? _editSelId : null;
          for (const f of frames) {
            assertPartId(f.id, 'evalRig frame.id');
            if (f.id === _meshEditingPartId) {
              // PP1-008(b) — push the part's LIVE `mesh.vertices` through
              // the override path so the GL buffer re-uploads EVERY frame.
              // The rig keyforms are stale mid-edit, so we skip rig output;
              // but a bare `continue` (no override) left re-upload to
              // chance — only the drag-direct-upload and the
              // `meshOverriddenParts` restore branch ever refreshed the
              // buffer, so a COMMITTED edit didn't reach the GPU until a
              // mode change forced a fresh upload. That was the "phantom":
              // the camera-only vertex dots (`VertexSelectionOverlay`,
              // which draws `mesh.vertices × zoom + pan`) moved live while
              // the frozen mesh buffer stayed put — and "Tab twice snaps
              // the mesh to the dots" because re-entering Edit Mode hits
              // the restore branch on its first frame.
              //
              // `mesh.vertices` are canvas-px (.x/.y) — the SAME array the
              // dots project. Keep the part rig-driven so scenePass draws
              // it CAMERA-ONLY too (`scenePass.js:231`, no worldMatrix);
              // mesh and dots then share one source of truth and cannot
              // diverge. The blend-shape loop below still composes deltas
              // on top of this base when an active shape is being painted.
              const _editNode = nodesById.get(f.id);
              const _editMesh = _editNode ? getMesh(_editNode, projectRef.current) : null;
              if (_editMesh && Array.isArray(_editMesh.vertices)) {
                if (!poseOverrides) poseOverrides = new Map();
                const existing = poseOverrides.get(f.id) ?? {};
                if (!existing.mesh_verts) {
                  poseOverrides.set(f.id, { ...existing, mesh_verts: _editMesh.vertices });
                }
              }
              rigDrivenParts.add(f.id);
              continue;
            }
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
            // Bone post-chain composition (LBS per-vertex skinning /
            // rigid overlay / none) runs inside `kernelArtMeshEval`
            // against TRANSFORM_COMPOSE outputs (Phase 0.D armature
            // port), so `frames` arrive already post-skin. The legacy
            // re-skin pass that the classic `evalRig` viewport path
            // needed was removed in the Phase 7 close-out (Rule №2).
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
        // PERF-4 — cache the typed-array UV view per source-array identity.
        // Pre-fix every override frame allocated a fresh Float32Array
        // (uvLength*4 bytes × overridden parts × 60Hz). UVs are static for
        // the mesh; reuse the cache until the source array changes.
        const uvCache = uvTypedCacheRef.current;
        const toTypedUVs = (uvs) => {
          if (uvs instanceof Float32Array) return uvs;
          let cached = uvCache.get(uvs);
          if (!cached || cached.length !== uvs.length) {
            cached = new Float32Array(uvs);
            uvCache.set(uvs, cached);
          }
          return cached;
        };
        if (poseOverrides) {
          for (const [nodeId, ov] of poseOverrides) {
            if (!ov.mesh_verts) continue;
            newMeshOverridden.add(nodeId);
            finalVerts.set(nodeId, ov.mesh_verts);
            const node = nodesById.get(nodeId);
            const m = getMesh(node, projectRef.current);
            if (m) {
              sceneRef.current.parts.uploadPositions(nodeId, ov.mesh_verts, toTypedUVs(m.uvs));
            }
          }
        }
        for (const nodeId of meshOverriddenParts.current) {
          if (!newMeshOverridden.has(nodeId)) {
            // Override removed — restore base mesh from projectStore
            const node = nodesById.get(nodeId);
            const m = getMesh(node, projectRef.current);
            if (m) {
              sceneRef.current.parts.uploadPositions(nodeId, m.vertices, toTypedUVs(m.uvs));
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
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
      // GL-06 — clear upload-cache refs so a fresh GL context (next
      // mount) doesn't read stale partId→sig entries from a prior
      // session. Pre-fix imageDataMapRef was cleared but the upload-cache
      // trio + uv typed cache persisted.
      lastUploadedSourcesRef.current.clear();
      lastUploadedMeshSigRef.current.clear();
      lastUploadedGeomVersionRef.current.clear();
      uvTypedCacheRef.current.clear();
      // Phase 4 — clear the global scene registry so a stale `parts`
      // pointer doesn't survive the WebGL context teardown.
      setSceneRef(null);
    };
  }, []);

  /* ── Mark dirty when editor view / viewLayers / selection changes ──── */
  useEffect(() => { isDirtyRef.current = true; },
    [view, selection, viewLayers, editMode, activeBlendShapeId]);

  /* ── Edit Mode exit → re-derive the rig from the edited base mesh ─────
       Blender's flow on leaving Edit Mode: the edited cage is written
       back to the base mesh, the depsgraph is flagged, and the modifier
       stack RE-EVALUATES on the new base (`ED_object_editmode_exit` →
       `BKE_mesh_*` → `DEG_id_tag_update`). SS bakes the deformation into
       `mesh.runtime.keyforms` (parent-deformer-local) at Init Rig, so a
       rest-cage edit shows live in Edit Mode (PP1-008(b) draws
       `mesh.vertices`) but Object Mode keeps drawing the stale baked
       keyforms until they're re-derived. We mirror Blender by re-running
       the rig refit (the tested keyform-derivation pipeline) when the
       edited part's rest mesh actually changed — scoped to a real change
       so merely entering/leaving Edit Mode is free. `refitAll('merge')`
       preserves pose, params, and `_userAuthored` rig entries.

       This is the proper adaptation of Blender's exit→re-eval (Rule №1):
       it reuses the pipeline that already projects canvas-px verts into
       each parent deformer's local frame, rather than hand-rolling that
       projection here. */
  const editMeshSnapRef = useRef(/** @type {{partId:string, verts:any}|null} */ (null));
  useEffect(() => {
    if (editMode === 'edit') {
      // Entering: snapshot the active part's vertex-array reference.
      const partId = editorRef.current.selection?.[0];
      const node = partId ? projectRef.current.nodes.find((n) => n.id === partId) : null;
      const m = node ? getMesh(node, projectRef.current) : null;
      editMeshSnapRef.current = (partId && m && Array.isArray(m.vertices))
        ? { partId, verts: m.vertices }
        : null;
      return;
    }
    // Leaving Edit Mode (editMode now null / pose / etc).
    const snap = editMeshSnapRef.current;
    editMeshSnapRef.current = null;
    if (!snap) return;
    const node = projectRef.current.nodes.find((n) => n.id === snap.partId);
    const m = node ? getMesh(node, projectRef.current) : null;
    if (!m) return;
    // immer replaces the vertices array on any vertex mutation, so a
    // reference change = the rest cage was edited this session.
    const meshChanged = m.vertices !== snap.verts;
    const isRigged = !!(m.runtime && Array.isArray(m.runtime.keyforms) && m.runtime.keyforms.length > 0);
    if (!meshChanged || !isRigged) return;
    import('@/services/RigService').then(({ refitAll }) => refitAll({ mode: 'merge' }))
      .then((r) => {
        if (r?.ok) logger.info('editMeshRefit', `Rig refit after rest-mesh edit on ${snap.partId}`);
        else logger.warn('editMeshRefit', `Rig refit after rest-mesh edit failed: ${r?.error ?? 'unknown'}`);
      })
      .catch((err) => logger.warn('editMeshRefit', `Rig refit threw: ${err?.message ?? String(err)}`));
    toast({ description: 'Rig refit to match your mesh edit', duration: 1800 });
  }, [editMode]);

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
      // Brush keys [/] adjust radius. Active in Edit Mode only when the
      // Brush tool is armed (deform sub-mode OR shape-paint with active
      // blend shape) — gated on toolMode so the keys are inert under the
      // Select tool (default since Slice A).
      const brushActive = editMode === 'edit'
        && ((editorRef.current.toolMode === 'brush'
             && (meshSubMode === 'deform' || !!editorRef.current.activeBlendShapeId))
            || editorRef.current.toolMode === 'smooth');
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
      // Audit-fix H-1 (Phase 7.D sweep): `e.target?.tagName` — synthetic
      // events dispatched via `runAutoKey('all')` set `event.target` to
      // `window`, which has no `tagName`. The pre-fix bare `.tagName`
      // matched the sister keydown handler at :1393 which already uses
      // `?.`; 7.D made this path live on every auto-key tick in 'all'
      // mode, exposing the inconsistency.
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;

      const ed = editorRef.current;
      const anim = useAnimationStore.getState();
      // Silent return for SYNTHETIC K events (`runAutoKey('all')` fires
      // through here every tick when auto-key Mode = All); only the user-
      // initiated press deserves diagnostic toasts. Same convention as
      // the K-first-use toast gate below.
      if (getEditorMode() !== 'animation') {
        if (!e.__ssAutoKey) {
          toast({
            title: 'Insert Keyframe (K)',
            description: 'Switch to the Animation workspace to insert keyframes.',
          });
        }
        return;
      }

      const proj = projectRef.current;
      if (proj.actions.length === 0) {
        if (!e.__ssAutoKey) {
          toast({
            title: 'Insert Keyframe (K)',
            description: 'No action exists. Click "+ New" in the Footer to create one.',
          });
        }
        return;
      }

      // Stage 1.E: scene-bound action wins over UI-store fallback;
      // only fall back to first action when neither resolves.
      const actionId = getActiveSceneAction(proj, anim.activeActionId)?.id ?? proj.actions[0]?.id;
      if (!actionId) {
        if (!e.__ssAutoKey) {
          toast({
            title: 'Insert Keyframe (K)',
            description: 'No active action — pick one in the Footer action picker.',
          });
        }
        return;
      }

      // Animation Phase 7 Slice 7.G — K-rebind preference. When the user
      // opts into Blender's "K always prompts" semantic
      // (`preferencesStore.kKeyOpensMenu`), a MANUAL K opens the I-menu
      // keying-set picker instead of running the legacy "insert all
      // properties" fan-out below. Mirrors Blender's K → `anim.
      // keyframe_insert_menu` (always_prompt=True) at
      // `keymap_data/blender_default.py:4536`.
      //
      // Synthetic K events from `runAutoKey('all')` carry `__ssAutoKey`
      // and MUST NOT be re-routed — auto-key's 'all' mode depends on this
      // handler performing the fan-out, not popping a menu. So the rebind
      // only fires for genuine user K-presses.
      if (!e.__ssAutoKey && usePreferencesStore.getState().kKeyOpensMenu) {
        const c = lastCursorRef.current;
        useEditMenuStore.getState().openKeyingSet({ cursor: { x: c.clientX, y: c.clientY } });
        return;
      }

      let selectedIds = ed.selection;
      if (selectedIds.length === 0) {
        if (!e.__ssAutoKey) {
          toast({
            title: 'Insert Keyframe (K)',
            description: 'Nothing selected — click a part or bone first, then press K.',
          });
        }
        return;
      }

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

      // Animation Phase 7 Slice 7.E -- K-key first-use toast. Pointer
      // to the new I-key menu shipped in 7.C. Fires AFTER every guard
      // has passed (preview mode + editable target + animation mode +
      // actions exist + selection non-empty) so the toast only appears
      // when K actually performs keyframe-insertion work.
      //
      // `e.__ssAutoKey` sentinel: synthetic K events dispatched by
      // `runAutoKey('all')` (see `src/anim/autoKeyDispatch.js`) carry
      // this flag so the toast skips the auto-key path -- the user
      // didn't press K manually, they dragged a bone with auto-key
      // on. Showing the "Press I to pick a keying set" pointer in
      // that case would be confusing.
      //
      // The prefs flag is sparse-stored as a single boolean in
      // localStorage (`v3.prefs.kKeyFirstUseShown`). Once true, the
      // toast suppresses for all future sessions on this device.
      if (!e.__ssAutoKey) {
        const prefs = usePreferencesStore.getState();
        if (!prefs.kKeyFirstUseShown) {
          toast({
            // Audit-fix MED-1 (sweep #82): "Active Set" was not a built-in
            // label — the I-menu lists real set names (Location / Rotation
            // / Scale / Location, Rotation & Scale / Blend Shapes / All
            // Parameters / Available + any user-defined). Examples use
            // actual labels so users searching the menu find them.
            title: 'K — Insert all properties',
            description: 'Press I to pick a specific keying set (Location / Rotation / All Parameters / …).',
          });
          prefs.setKKeyFirstUseShown(true);
        }
      }

      const currentTimeMs = anim.currentTime;

      // Pre-compute effective values for each selected node:
      // draftPose (drag) > current keyform > node.transform
      const activeActionObj = proj.actions.find(a => a.id === actionId) ?? null;
      const endMs = (anim.endFrame / anim.fps) * 1000;
      const keyframeOverrides = computePoseOverrides(activeActionObj, currentTimeMs, anim.loopKeyframes, endMs);
      const startMs = (anim.startFrame / anim.fps) * 1000;

      // Slice 7.G — the per-node "insert every property" fan-out now lives
      // in the pure, unit-tested `insertAllPropertyKeyframes` helper.
      updateProject((p) => {
        insertAllPropertyKeyframes(p, {
          actionId,
          selectedIds,
          currentTimeMs,
          startMs,
          keyframeOverrides,
          restPose: anim.restPose,
          draftPose: anim.draftPose,
        });
      });

      // Clear draft for committed nodes so the keyframe value takes over
      for (const nodeId of selectedIds) {
        anim.clearDraftPoseForNode(nodeId);
      }

      // Success feedback — synthetic K events (auto-key 'all' mode) stay
      // silent so the user isn't toast-flooded during drag-driven
      // continuous auto-key, but manual K-presses now confirm what
      // landed. Pre-fix the handler succeeded silently which felt
      // identical to a silent bail.
      if (!e.__ssAutoKey) {
        const fps = useAnimationStore.getState().fps;
        const frame = Math.round((currentTimeMs / 1000) * Math.max(1, fps));
        const nodeLabel = selectedIds.length === 1
          ? (proj.nodes.find((n) => n.id === selectedIds[0])?.name ?? selectedIds[0])
          : `${selectedIds.length} nodes`;
        toast({
          title: 'Insert Keyframe (K)',
          description: `Keyed all properties on ${nodeLabel} at frame ${frame}`,
        });
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

          // Toolset Phase 0.F — topology change. Vertex count + indexing
          // change completely on remesh; existing `selectedVertexIndices`
          // entries would point at random vertices. Invalidate before the
          // user sees stale selection (audit fix: this path was missing
          // the invalidation hook the add_vertex / remove_vertex paths
          // already use).
          useEditorStore.getState().invalidateVertexSelectionForPart(partId);

          // Compute skin weights if this part belongs to a limb.
          const parentGroup = proj.nodes.find(n => n.id === node.parent);
          const childRole = childBoneRoleFor(getBoneRole(parentGroup));
          if (childRole && parentGroup) {
            const jointBone = proj.nodes.find(n => n.parent === parentGroup.id && getBoneRole(n) === childRole);
            const newMesh = getMesh(node, proj);
            if (jointBone && newMesh) {
              newMesh.boneWeights = computeSkinWeights(vertices, parentGroup, jointBone);
              newMesh.jointBoneId = jointBone.id;
              logger.info('skinning', `${node.name} → ${childRole} (${vertices.length} verts)`, { nodeId: node.id, childRole, vertCount: vertices.length });
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
      // WORKER-003 — surface the worker failure via logger.error so it
      // lands in the in-app Logs panel; clear the stale seq entry so
      // a retry path is consistent. Pre-fix a bare console.error left
      // the part with its old mesh silently + accumulating stale seqs
      // in meshDispatchSeqRef every session.
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('meshWorker', `mesh worker failed for ${partId}: ${errMsg}`, {
        partId, err: errMsg,
      });
      meshDispatchSeqRef.current.delete(partId);
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
    img.onerror = (err) => {
      // WORKER-006 — surface the failure so a missing/corrupt PNG does
      // not look like a successful no-op (remeshPart never updates the
      // mesh otherwise).
      logger.error('remeshPart', `texture decode failed for ${partId}`, {
        partId, source: tex.source, err: String(err),
      });
    };
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
    img.onerror = (err) => {
      // WORKER-006 — surface the decode failure and revoke the blob
      // URL so a corrupt PNG does not leak a blob for the session.
      logger.error('importPng', `PNG decode failed: ${file.name}`, {
        file: file.name, err: String(err),
      });
      URL.revokeObjectURL(url);
    };
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
    logger.time('psdImport', 'finalize');
    // Outer try/catch ensures `psdImport:finalize` (and the inner
    // `workerPool:composite` if a worker rejects after pool dispatch)
    // cannot leak on throw — PSD import is a high-likelihood failure
    // path (huge files, OOM, worker crash) and a leaked timer would
    // silently break the next import's baseline.
    try {
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
    logger.time('psdImport', 'workerPool:composite');
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
      // End the composite timer in the SAME finally as pool.destroy so a
      // worker rejection cleans both up before propagating to the outer
      // catch. Previously this lived after the try block and leaked on
      // dispatch failure.
      logger.timeEndIfRunning('psdImport', 'workerPool:composite', { layers: layers.length });
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
      img2.onerror = (err) => {
        // WORKER-006 — psdImport worst case: failing composited PNG
        // would otherwise leave the GPU mesh unset with no log.
        logger.error('psdImport', `composited PNG decode failed for ${partId}`, {
          partId, err: String(err),
        });
      };
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
    logger.timeEnd('psdImport', 'finalize', {
      psd: { w: psdW, h: psdH },
      layers: layers.length,
      groups: groupDefs.length,
      assigned: assignments?.size ?? 0,
    });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.timeEndIfRunning('psdImport', 'workerPool:composite', { error: errorMsg });
      logger.timeEndIfRunning('psdImport', 'finalize', { error: errorMsg });
      throw err;
    }
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
    let url = null;
    try {
      const { saveProject } = await import('@/io/projectFile');
      const blob = await saveProject(projectRef.current);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project.stretch';
      a.click();
      // MEM-09 — synchronous revoke after a.click() can race the download
      // on slow systems (Chrome can abort because the URL is gone before
      // the browser captures the bytes). Match the 1.5s delay used by
      // ExportModal.jsx + SaveModal.jsx.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* */ } }, 1500);
    } catch (err) {
      // Defensive: if saveProject threw after createObjectURL but
      // before click(), still revoke so the blob does not leak.
      if (url) { try { URL.revokeObjectURL(url); } catch { /* */ } }
      logger.error('saveProject', `Failed to save project: ${err?.message ?? err}`, { err: String(err) });
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
      // GL-06 — same as handleReset: drop the upload-cache trio + uv
      // typed cache so the post-load sync effect re-uploads every part
      // from project state instead of skipping on stale sig matches.
      lastUploadedSourcesRef.current.clear();
      lastUploadedMeshSigRef.current.clear();
      lastUploadedGeomVersionRef.current.clear();
      uvTypedCacheRef.current.clear();
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

  // Audit 4 #2 (2026-05-16) — RMB context menu per `editMode`.
  // - Always suppress the browser's default menu (we don't want it on
  //   the canvas regardless of branch).
  // - Suppress SS's menu on the Live Preview surface (GAP-010 — read-only).
  // - Suppress SS's menu if the most recent RMB press was a drag (pan
  //   gesture); the `rmbDraggedRef` flag was set in `onPointerMove`
  //   above. Reset the flag after each `contextmenu` event so a brand
  //   new RMB press starts clean.
  // - Otherwise open `editMenuStore.canvasContextMenu` at the cursor;
  //   `CanvasContextMenu.jsx` reads `editorStore.editMode` to dispatch
  //   the per-mode item set (Object / Edit-mesh / Edit-armature / Pose
  //   / Weight Paint) — analog of Blender's
  //   `VIEW3D_MT_<mode>_context_menu` family.
  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    // Shift+RMB just placed the 2D cursor — swallow the menu it would
    // otherwise summon.
    if (cursorPlacedRef.current) {
      cursorPlacedRef.current = false;
      return;
    }
    if (rmbDraggedRef.current) {
      rmbDraggedRef.current = false;
      return;
    }
    if (previewModeRef.current) return;
    useEditMenuStore.getState().openCanvasContextMenu({
      cursor: { x: e.clientX, y: e.clientY },
    });
  }, []);

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
    // A modal G/R/S transform (vertex or object) owns the pointer until
    // it commits/cancels. The modal commits on a window `mousedown`
    // (capture), which fires AFTER this React `pointerdown` — and a
    // `mousedown` stopPropagation can't block a `pointerdown` (separate
    // event stream). So without bailing here, the commit click first runs
    // a vertex pick / empty-canvas deselect (line ~2615), dropping the
    // selection through a transform — Blender keeps the selection after
    // G/R/S. Ignore the pointerdown; let the modal's own handler commit.
    if (useModalVertexTransformStore.getState().kind !== null
        || useModalTransformStore.getState().kind !== null) {
      return;
    }
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

    // Blender 2D-cursor placement — Shift+RMB sets the cursor at the
    // clicked canvas point. Matches Blender's default `cursor_set_event`
    // (`blender_default.py:172` — `view3d.cursor3d` on RIGHTMOUSE+shift in
    // the LMB-select preset). Intercept BEFORE the pan branch (RMB pans)
    // and flag the trailing contextmenu to suppress its menu. View-only —
    // never on the read-only Live Preview surface.
    if (e.button === 2 && e.shiftKey && !previewModeRef.current) {
      const [cx, cy] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);
      useProjectStore.getState().setProjectCursor(cx, cy);
      cursorPlacedRef.current = true;
      isDirtyRef.current = true;
      e.preventDefault();
      return;
    }

    // Middle mouse (1) or right mouse (2) or alt+left → pan / zoom
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      // Audit 4 #2 — reset the RMB drag-vs-click flag on every RMB press
      // so a fresh `contextmenu` event sees a clean slate. The flag
      // flips true only if the user moves > threshold below.
      if (e.button === 2) rmbDraggedRef.current = false;
      if (e.ctrlKey) {
        // Ctrl + Middle/Right drag → Zoom
        // Audit 4 #2 post-ship arch fix — `button: e.button` is required
        // here too. The pointermove drag-detection guard reads
        // `panRef.current.button === 2`; without it, Ctrl+RMB-zoom
        // gestures never flip `rmbDraggedRef.current` and the trailing
        // `contextmenu` event (fires after Ctrl+RMB release on Windows)
        // would open the per-mode menu at the end of every zoom.
        panRef.current = {
          mode: 'zoom',
          startX: e.clientX,
          startY: e.clientY,
          zoom0: view.zoom,
          panX0: view.panX,
          panY0: view.panY,
          button: e.button,
        };
      } else {
        // Regular Middle/Right drag → Pan
        panRef.current = {
          mode: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          panX0: view.panX,
          panY0: view.panY,
          // Audit 4 #2 — record originating button so pointermove can
          // tag RMB pans as "this was a drag" once motion crosses 4 px.
          button: e.button,
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

    // Cursor tool — plain LMB places the 2D cursor (Blender's
    // `builtin.cursor`; the always-on Shift+RMB shortcut also works). Runs
    // before the mode-specific dispatch so it works in every mode,
    // including Pose (where the skeleton overlay otherwise claims LMB).
    if (editorRef.current.toolMode === 'cursor') {
      const [ccx, ccy] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);
      useProjectStore.getState().setProjectCursor(ccx, ccy);
      isDirtyRef.current = true;
      e.preventDefault();
      return;
    }

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
    // Stage 1.E: scene-bound action wins over UI-store fallback.
    const activeAction = isAnimMode
      ? getActiveSceneAction(proj, animNow.activeActionId)
      : null;
    const kfOverrides = isAnimMode ? computePoseOverrides(activeAction, animNow.currentTime) : null;
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

    // Toolset Plan Phase 3 — Sculpt Mode stroke begin. Sibling to the
    // Edit-Mode brush dispatch below; sculpt brushes operate on the same
    // mesh data but with cursor-centered falloff (vs Edit-Mode brush's
    // anchor-from-picked-vertex). LMB starts a stroke; pointermove
    // accumulates per-tick brush displacements; pointerup commits one
    // undo entry for the whole stroke.
    //
    // Safety net (audit G-2): sculpt mutates the rest mesh. The ModePill
    // row already disables Sculpt entry while in Animation editor mode,
    // but if a stale editMode='sculpt' carries over into animation
    // editor (workspace switch keeps editMode), refuse the stroke here.
    if (editMode === 'sculpt'
        && currentSelection.length > 0
        && e.button === 0
        && getEditorMode() !== 'animation') {
      const selNode = effectiveNodes.find(n => n.id === currentSelection[0] && (isMeshedPart(n, proj) || (isLatticeCageObject(n) && !!getMesh(n, proj))));
      const selMesh = selNode ? getMesh(selNode, proj) : null;
      if (selNode && selMesh) {
        const wm = worldMatrices.get(selNode.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);
        const sculptCfg = editorRef.current.sculpt ?? {};
        // Convert canvas-px brush size to mesh-local (≈ world) units.
        // SS parts typically have identity scale on their worldMatrix,
        // so world ≈ local; for the rare scaled part this drifts but
        // stays usable. Same convention as the Edit-Mode brush.
        const sizeLocal = (sculptCfg.size ?? 80) / view.zoom;
        // Adjacency reused via WeakMap cache on the indices array
        // (proportionalEdit.getOrBuildAdjacency); same path Edit-Mode
        // proportional editing uses, so successive Sculpt strokes on the
        // same part hit the cache after the first build.
        const adjacency = getOrBuildAdjacency(selMesh.triangles ?? [], selMesh.vertices.length);
        // Origin vertex (closest to cursor) drives connectedOnly BFS.
        // Walking once at stroke start matches Blender's "Use Connected
        // Only" — the brush footprint is anchored to the start picked
        // patch even if the user drags off it.
        let originIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < selMesh.vertices.length; i++) {
          const dx = selMesh.vertices[i].x - lx;
          const dy = selMesh.vertices[i].y - ly;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            originIdx = i;
          }
        }
        dragRef.current = {
          mode:           'sculpt',
          partId:         selNode.id,
          adjacency,
          originIdx:      originIdx >= 0 ? originIdx : null,
          prevCursor:     null,
          // Stroke-begin cursor in mesh-local. Used by anchored brushes
          // (Grab — Blender semantic: brush radius stays anchored at
          // the click point even as the cursor drags off it) AND by
          // every brush as the source of "total delta since stroke
          // begin" (for `cache->grab_delta` style accumulation).
          startCursor:    { x: lx, y: ly },
          firstTick:      true,
          // Snapshot of vertex positions at stroke begin. Anchored
          // brushes (Blender Grab) read these — verts are repositioned
          // to `orig + total_delta * falloff` each tick, NOT
          // incrementally mutated. Live-cursor brushes (Smooth/Pinch)
          // ignore this and read `mesh.vertices` directly.
          origVerts:      selMesh.vertices.map((v) => ({ x: v.x, y: v.y })),
          // UVs don't change during a sculpt stroke (sculpt is
          // position-only). Snapshot once at stroke begin so per-tick
          // GPU upload doesn't allocate a fresh Float32Array each move.
          allUvs:         new Float32Array(selMesh.uvs),
          // Cache the inverse world matrix at stroke begin — onPointerMove
          // converts cursor world→local on every tick, and recomputing
          // worldMatrices per move is expensive (chains the whole tree).
          // Stays accurate for the duration of the stroke since the
          // part's transform doesn't move while the user is dragging.
          iwm,
          // Ctrl-at-press is locked for the whole stroke. Blender's
          // `paint_stroke.cc:868` reads `RNA_enum_get(op->ptr, "mode")`
          // ONCE at LMB-press; the modal handler doesn't toggle invert
          // mid-stroke. Audit D-4: SS pre-fix was reading e.ctrlKey
          // per-tick which let users flip Pinch ↔ Magnify mid-drag.
          ctrlAtStart:    e.ctrlKey || e.metaKey,
          startSizeLocal: sizeLocal,
        };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'crosshair';
      }
      return;
    }

    if (meshEditActive && currentSelection.length > 0) {
      const selNode = effectiveNodes.find(n => n.id === currentSelection[0] && (isMeshedPart(n, proj) || (isLatticeCageObject(n) && !!getMesh(n, proj))));
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
          // Toolset Phase 1.B — Ctrl+LMB is the lasso gesture-starter.
          // Defer dispatch so onPointerMove can promote on threshold
          // cross. The click fallback runs at onPointerUp:
          //   - vertex hit + active vertex set → BFS shortest-path-pick
          //   - vertex hit + no active or unreachable → plain select
          //   - empty canvas → no-op (don't deselect; user might be
          //     starting a lasso to ADD verts to the selection)
          //
          // CRITICAL: this branch runs BEFORE the `idx < 0` deselect
          // path so empty-canvas Ctrl+LMB-drag opens the lasso modal
          // (audit fix: Edit-Mode lasso-from-empty-canvas was blocked
          // by deselect-all swallowing the gesture).
          if (e.ctrlKey || e.metaKey) {
            const partId = selNode.id;
            const verts0 = verts;
            const tris0 = selMesh.triangles ?? [];
            const clickedIdx = idx;
            const onClickFallback = clickedIdx < 0
              ? null  // empty-canvas Ctrl+click is a no-op (cancelled gesture)
              : () => {
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
              // Toolset Phase 1.B-fix — Ctrl is the gesture-starter for
              // lasso so it can't double as a commit-time modifier.
              // Capture intent at pointerdown: Shift held alongside Ctrl
              // → 'add'; Ctrl-only → null (defaults to 'replace' on
              // commit). 'subtract' lasso isn't reachable in Edit Mode
              // (Alt+LMB is pan); use box-Ctrl for that semantic.
              gestureModifier: e.shiftKey ? 'add' : null,
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          if (idx < 0) {
            // LMB on empty space → deselect all for this part. Matches
            // Object Mode click-to-deselect behaviour. Shift+LMB on
            // empty space is a no-op (don't accidentally drop a careful
            // multi-select build).
            if (!e.shiftKey) editorActions.deselectAllVertices(selNode.id);
            return;
          }
          if (e.shiftKey) {
            editorActions.toggleVertexSelection(selNode.id, idx);
            return;
          }
          editorActions.selectVertex(selNode.id, idx, /* additive */ false);
          return;
        }

        // v43 — a Lattice (warp) cage has a FIXED rows×cols topology the
        // Cubism exporter requires; adding/removing control points breaks
        // it. Block the topology tools on a cage (moving existing control
        // points via 'select'/drag stays allowed). Mirrors the guard in
        // applyTopologyOp for subdivide/merge/dissolve/extrude.
        if ((toolMode === 'add_vertex' || toolMode === 'remove_vertex')
            && selNode?.type === 'object' && selNode?.objectKind === 'lattice') {
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
        } else if (toolMode === 'smooth') {
          // Edit-Mode Smooth brush — Laplacian relax on the rest mesh,
          // reusing Sculpt's `smoothTick` (lib/sculpt). Cursor-centered
          // falloff like the deform brush; one Laplacian pass per tick so
          // holding the stroke accumulates smoothing. Operates on
          // mesh.vertices (canvas-px) — same space as the deform brush.
          const adjacency = getOrBuildAdjacency(selMesh.triangles ?? [], selMesh.vertices.length);
          dragRef.current = {
            mode:           'editSmooth',
            partId:         selNode.id,
            adjacency,
            iwm,
            // brushSize is canvas-px; convert to mesh-local (≈ world)
            // like the deform brush + sculpt stroke do.
            startSizeLocal: (editorRef.current.brushSize ?? 80) / view.zoom,
            allUvs:         new Float32Array(selMesh.uvs),
            firstTick:      true,
          };
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = 'crosshair';
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
              // Undo batching (mirrors the sculpt-stroke pattern): the
              // FIRST project-writing tick snapshots the pre-stroke state,
              // every subsequent tick passes skipHistory. Without this each
              // per-tick updateProject pushed its own snapshot, flooding the
              // 50-entry history with sub-pixel micro-steps — so Ctrl+Z
              // reverted one imperceptible tick AND evicted all real undo
              // states. One stroke now = one undo entry. The draft-pose
              // branch (animation mode) never writes the project, so it
              // doesn't consume firstTick.
              firstTick: true,
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
    //
    // Phase 1.B-fix — Shift held alongside Ctrl is captured as
    // `gestureModifier: 'add'`; Ctrl-only defaults to 'replace' at
    // commit. Alt is excluded (Alt+LMB is pan).
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      lassoCandidateRef.current = {
        startClient: { x: e.clientX, y: e.clientY },
        mode: 'object',
        editPartId: null,
        onClickFallback: null,
        gestureModifier: e.shiftKey ? 'add' : null,
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
    // Frames may be null when no rig is built yet; hitTest*
    // falls back to rest mesh + worldMatrices.
    //
    // Blender-parity cycle-pick: when this click is at (~) the same
    // screen position as the previous one and is a plain (non-Shift)
    // select, gather ALL hits and rotate to the next part behind the
    // currently active one. A click further than the 4-px² threshold
    // resets to top-of-stack (Blender's WM_EVENT_CURSOR_MOTION_THRESHOLD).
    const cachedFrames = lastEvalCacheRef.current?.frames ?? null;
    const isMulti = e.shiftKey;
    const hitOpts = {
      worldMatrices,
      imageDataMap: imageDataMapRef.current,
      // Final per-part verts the renderer last drew. Includes
      // chainEval + two-bone LBS + blend shapes — i.e. what the
      // user actually sees. Hit-test prefers these over chainEval
      // frames so a posed limb is selectable at its visible
      // location (BUG-026 fix, 2026-05-08).
      finalVertsByPartId: lastFinalVertsRef.current,
    };

    let hitId = null;
    const prevClick = clickCycleRef.current;
    const sameSpot = !isMulti && prevClick
      && ((e.clientX - prevClick.clientX) ** 2 + (e.clientY - prevClick.clientY) ** 2) <= 16;
    if (sameSpot) {
      const allHits = hitTestPartsAll(proj, cachedFrames, worldX, worldY, hitOpts);
      if (allHits.length > 0) {
        const activeRef = useSelectionStore.getState().getActive();
        const activeId = activeRef && activeRef.type === 'part' ? activeRef.id : null;
        hitId = cycleHitsAfterActive(allHits, activeId);
      }
    } else {
      hitId = hitTestParts(proj, cachedFrames, worldX, worldY, hitOpts);
    }

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
      clickCycleRef.current = { clientX: e.clientX, clientY: e.clientY };
    } else if (!isMulti) {
      setSelection([]);
      useSelectionStore.getState().clear();
      clickCycleRef.current = null;
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
          gestureModifier: lc.gestureModifier ?? null,
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

      // Audit 4 #2 — once RMB-originated motion crosses the drag-vs-click
      // threshold, mark `rmbDraggedRef` so the trailing `contextmenu` event
      // suppresses the per-mode menu (we treat this as a pan gesture).
      if (panRef.current.button === 2 && !rmbDraggedRef.current
          && Math.hypot(dx, dy) > 4) {
        rmbDraggedRef.current = true;
      }

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
      // Brush cursor active in Edit Mode ONLY when the Brush tool is armed
      // (deform sub-mode OR shape-paint when an active shape is set). Folded
      // 2026-05-07; toolMode gate added 2026-05-20 — after Slice A made
      // Select the default Edit-Mode tool, the brush radius circle was still
      // showing under the Select tool because the gate ignored toolMode.
      const inDeformMode = editMode === 'edit'
        && ((editorRef.current.toolMode === 'brush'
             && (editorRef.current.meshSubMode === 'deform'
                 || !!editorRef.current.activeBlendShapeId))
            || editorRef.current.toolMode === 'smooth');
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

    // ── Sculpt stroke (Sculpt Mode brush dispatch) ─────────────────────────
    // Toolset Plan Phase 3.I — read the active brush impl from the
    // sculpt registry, build per-tick options, dispatch the brush, write
    // returned positions. Per-tick writes use `skipHistory: true` after
    // the first non-empty tick so the whole stroke collapses into one
    // undo entry (the first tick's pre-mutation snapshot).
    //
    // GPU upload pattern (audit G-3): build `newVerts` in-memory, apply
    // brush deltas, upload to GPU, THEN call updateProject. Reading
    // back from `projectRef.current` after updateProject would be one
    // render behind (projectRef is assigned at render, not at set()),
    // introducing a 1-frame visual lag.
    if (dragRef.current.mode === 'editSmooth') {
      // Edit-Mode Smooth brush tick — one Laplacian pass per move,
      // cursor-centered falloff. Writes BOTH pose (x/y) and rest
      // (restX/restY) like the modal vertex transform (audit G-1) so the
      // rig sees the relaxed cage; the edit→Object refit on Tab-out then
      // re-derives keyforms. One stroke = one undo entry (firstTick).
      if (editorRef.current.editMode !== 'edit') return;
      const drag = dragRef.current;
      const proj = projectRef.current;
      const node = proj.nodes.find((n) => n.id === drag.partId);
      const mesh = getMesh(node, proj);
      if (!node || !mesh) return;
      const [lx, ly] = worldToLocal(worldX, worldY, drag.iwm);
      const result = smoothTick({
        verts:     mesh.vertices,
        cursor:    { x: lx, y: ly },
        size:      drag.startSizeLocal,
        strength:  0.5,
        falloff:   'smooth',
        adjacency: drag.adjacency,
        iterations: 1,
      });
      if (result.size === 0) return;
      const newVerts = mesh.vertices.map((v) => ({ ...v }));
      for (const [idx, p] of result) {
        if (idx >= 0 && idx < newVerts.length) {
          newVerts[idx].x = p.x; newVerts[idx].y = p.y;
          newVerts[idx].restX = p.x; newVerts[idx].restY = p.y;
        }
      }
      sceneRef.current?.parts.uploadPositions(drag.partId, newVerts, drag.allUvs);
      isDirtyRef.current = true;
      const skipHistory = !drag.firstTick;
      drag.firstTick = false;
      updateProject((proj2) => {
        const n2 = proj2.nodes.find((nn) => nn.id === drag.partId);
        const m2 = getMesh(n2, proj2);
        if (!m2) return;
        for (const [idx, p] of result) {
          if (idx >= 0 && idx < m2.vertices.length) {
            m2.vertices[idx].x = p.x; m2.vertices[idx].y = p.y;
            m2.vertices[idx].restX = p.x; m2.vertices[idx].restY = p.y;
          }
        }
      }, { skipHistory });
      return;
    }

    if (dragRef.current.mode === 'sculpt') {
      // Mode-change abort (audit G-4): if the user Tab'd out of Sculpt
      // mid-stroke, drop any further brush ticks even though the
      // pointermove still fires (pointer capture is still on the
      // canvas). The pointerup cleanup zeroes dragRef anyway; this just
      // stops the brush from mutating verts during the orphan window.
      if (editorRef.current.editMode !== 'sculpt') return;
      const drag = dragRef.current;
      const sculptCfg = editorRef.current.sculpt ?? {};
      const brush = getBrushById(sculptCfg.activeBrush ?? 'grab');
      const proj = projectRef.current;
      const node = proj.nodes.find((n) => n.id === drag.partId);
      const mesh = getMesh(node, proj);
      if (!node || !mesh) return;

      const [lx, ly] = worldToLocal(worldX, worldY, drag.iwm);

      // Brush footprint in mesh-local units. Use the start-of-stroke
      // size so mid-stroke zoom doesn't stretch the brush — matches
      // Blender's sculpt brush size lock at stroke begin.
      const sizeLocal = drag.startSizeLocal;

      const tickResult = brush.tick({
        verts:         mesh.vertices,
        // Grab brush requires the original verts (anchored Blender
        // semantics — see lib/sculpt/grab.js); other brushes ignore.
        origVerts:     drag.origVerts,
        cursor:        { x: lx, y: ly },
        // For Grab: total accumulated delta from stroke start (not
        // per-tick). Blender's `cache->grab_delta` is the running total
        // since stroke begin, applied to ORIG positions each tick.
        startCursor:   drag.startCursor,
        prevCursor:    drag.prevCursor,
        size:          sizeLocal,
        strength:      sculptCfg.strength ?? 0.5,
        falloff:       sculptCfg.falloff ?? 'smooth',
        adjacency:     drag.adjacency,
        connectedOnly: !!sculptCfg.connectedOnly,
        originIdx:     drag.originIdx,
        iterations:    sculptCfg.iterations ?? 1,
        // Ctrl is locked at stroke begin (audit D-4 — Blender's
        // `toggle_settings.invert` is set ONCE at LMB-press, not
        // re-read per-tick). Mid-stroke key changes are ignored.
        ctrl:          drag.ctrlAtStart,
        // Anchored brushes (Grab) recenter the brush radius at the
        // start cursor; live-cursor brushes (Smooth/Pinch) read this
        // as null and use `cursor` instead.
        anchorCursor:  drag.startCursor,
      });
      drag.prevCursor = { x: lx, y: ly };

      if (tickResult.size === 0) return;

      // Build new verts in-memory and upload to GPU first, then
      // updateProject. Avoids the projectRef-stale-until-render lag.
      const newVerts = mesh.vertices.map((v) => ({ ...v }));
      for (const [idx, p] of tickResult) {
        if (idx >= 0 && idx < newVerts.length) {
          newVerts[idx].x = p.x;
          newVerts[idx].y = p.y;
        }
      }
      sceneRef.current?.parts.uploadPositions(drag.partId, newVerts, drag.allUvs);
      isDirtyRef.current = true;

      // First non-empty tick: write WITH history (push pre-stroke
      // snapshot once). Subsequent ticks: skipHistory:true so the
      // whole stroke collapses to one undo entry restoring pre-stroke
      // verts. Note: Grab brush's first tick is empty (no prevCursor),
      // so this fires on the SECOND pointermove for Grab — the
      // pre-stroke verts are unchanged at that point so the snapshot
      // captures the right baseline.
      const skipHistory = !drag.firstTick;
      drag.firstTick = false;
      // MESH-002 — write rest position alongside live position in
      // Edit Mode (the rest-editing context). Pre-fix sculpt strokes
      // only updated {x,y}; pose evaluation re-skinned from unchanged
      // restX/restY, immediately undoing the sculpt visually on the
      // next param change. Object-shape vertices carry restX/restY;
      // flat-shape (test fixtures) doesn't have them — skip there.
      const writeRest = editorRef.current.editMode === 'edit';
      updateProject((proj2) => {
        const n2 = proj2.nodes.find((nn) => nn.id === drag.partId);
        const m2 = getMesh(n2, proj2);
        if (!m2) return;
        for (const [idx, p] of tickResult) {
          if (idx >= 0 && idx < m2.vertices.length) {
            const v = m2.vertices[idx];
            v.x = p.x;
            v.y = p.y;
            if (writeRest && typeof v === 'object' && 'restX' in v) {
              v.restX = p.x;
              v.restY = p.y;
            }
          }
        }
      }, { skipHistory });
      return;
    }

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

      // First project-writing tick of the stroke snapshots the pre-stroke
      // state for undo; the rest skip (one stroke = one undo entry).
      const skipHistory = !dragRef.current.firstTick;

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
        }, { skipHistory });
        dragRef.current.firstTick = false;
        return;
      }

      // In animation mode + deform: store to draftPose — don't bake into base mesh.
      // The user will press K to commit as a keyframe. No project write, so
      // this never consumes the stroke's firstTick undo snapshot.
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
      }, { skipHistory });
      dragRef.current.firstTick = false;
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
      // Audit G-7: sculpt strokes don't go through draftPose (sculpt is
      // a rest-mesh edit; G-2 blocks animation-mode entry). The
      // synthetic K dispatch is the Edit-Mode brush's "auto-commit
      // draftPose to keyframe" path; sculpt has no draftPose to commit.
      const wasSculpt = dragRef.current.mode === 'sculpt';
      dragRef.current = null;
      canvas.style.cursor = '';
      // Audit-fix H-2 (Phase 7.D sweep): canvas-direct drag-end auto-key
      // was missed in the initial 7.D sweep — SkeletonOverlay + GizmoOverlay
      // were migrated to runAutoKey but this third trigger site kept the
      // raw synthetic-K dispatch, silently bypassing the mode dropdown.
      // Migrating to runAutoKey gives 'activeSet' / 'available' modes
      // effect on canvas-level drags.
      if (!wasSculpt
          && editorRef.current.autoKeyframe
          && getEditorMode() === 'animation') {
        runAutoKey(useProjectStore.getState().project);
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
    // GL-06 — pre-fix the upload-cache trio + uv typed cache pinned
    // entries for deleted partIds across the reset, plus on partId
    // re-use a freshly-uploaded GL resource may have been skipped
    // because the cache claimed it was already current.
    lastUploadedSourcesRef.current.clear();
    lastUploadedMeshSigRef.current.clear();
    lastUploadedGeomVersionRef.current.clear();
    uvTypedCacheRef.current.clear();

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

  /* ── Hit-context bridge for the box / lasso select overlay ──────────── */
  // Toolset Phase 1.A — the AppShell-mounted `BoxSelectOverlay`
  // (handles both kinds via boxSelectStore.kind) needs the latest
  // chainEval frames + composed verts to project its modal rect /
  // polygon through what the user actually sees. Refs are component-
  // internal so we publish a getter closure (returns fresh values on
  // each call) into captureStore. CanvasArea wires this through
  // hitContextRef same shape as exportCaptureRef so unmount cleanup
  // is symmetric.
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
          cursor: !previewMode && editorState.editMode === 'edit'
            && ((editorState.toolMode === 'brush'
                 && (editorState.meshSubMode === 'deform' || !!editorState.activeBlendShapeId))
                || editorState.toolMode === 'smooth') ? 'none' : toolCursor,
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

      {/* Blender-style 2D scene cursor (Shift+S target / optional pivot). */}
      {!previewMode && <Cursor2DOverlay />}

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


      {/* Layers picker + Reset/Apply Pose cluster relocated to the
          Viewport area header (`v3/headers/ViewportHeader.jsx`
          PoseControls), matching Blender's VIEW3D_HT_header. It reads
          editorMode / project / pose actions from the stores directly,
          so nothing pose-control-related is mounted on the canvas now. */}

      {/* GAP-001 — PSD import wizard now mounts at AppShell level
          (`v3/shell/PsdImportWizard.jsx`) and reads `wizardStore`
          directly. The canvas exposes its imperative bridges
          (finalizePsdImport / autoMeshAllParts) through `captureStore`
          via the effect in this component. */}

      <FpsOverlay />

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
