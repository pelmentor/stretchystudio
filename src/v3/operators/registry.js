// @ts-check

/**
 * v3 Phase 0A - Operator registry.
 *
 * Plan §6: every user-triggerable action is defined as an operator —
 * a `{id, label, exec}` bundle (plus optional `pollContext`,
 * `modalSpec`, `undoLabel`). Editors / menus / keymap entries all
 * reference operators by id; the registry is the single source of
 * truth for what the app can do.
 *
 * Phase 0A ships only a tiny set of shell-level operators (workspace
 * switch, reset workspace) so the dispatcher has something to invoke.
 * Phase 1+ adds editor-specific operators (select-all, delete,
 * transform, …) and modal operators (drag, lasso) once the editors
 * become real.
 *
 * @module v3/operators/registry
 */

import { useUIV3Store } from '../../store/uiV3Store.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { toast } from '../../hooks/use-toast.js';
import { undo, redo, undoCount, redoCount, beginBatch } from '../../store/undoHistory.js';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { useCommandPaletteStore } from '../../store/commandPaletteStore.js';
import { useHelpModalStore } from '../../store/helpModalStore.js';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useCmo3InspectStore } from '../../store/cmo3InspectStore.js';
import { useBoxSelectStore } from '../../store/boxSelectStore.js';
import { useCircleSelectStore } from '../../store/circleSelectStore.js';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useSubdivideStore } from '../../store/subdivideStore.js';
import { mergeAtCenter, mergeAtCursor, mergeAtFirst, mergeAtLast, mergeByDistance, mergeCollapse } from './edit/merge.js';
import { dissolveVertices } from './edit/dissolve.js';
import { subdivide } from './edit/subdivide.js';
import { extrude, countSelectedBoundary } from './edit/extrude.js';
// Phase 7.A — Object Mode tools (Snap / Mirror / Parent / Set Origin).
// Eager-import per audit lesson G-1 (`async exec` leaks unhandled rejections
// when the dispatcher fires `op.exec(...)` non-await).
import * as objectSnap from './object/snap.js';
import * as objectMirror from './object/mirror.js';
import * as objectParent from './object/parent.js';
import * as objectSetOrigin from './object/setOrigin.js';
// Phase 7.B — Weight Paint tools (Sample / Mirror / Normalize). Same
// eager-import discipline as 7.A — operator dispatcher fires
// `op.exec(...)` without await.
import * as wpSample from './weightPaint/sample.js';
import * as wpMirror from './weightPaint/mirror.js';
import * as wpNormalize from './weightPaint/normalize.js';
// Phase 7.C — Pose Mode tools (Clear Loc/Rot/Scale, Clear All variants,
// Select Mirror, Mirror Pose, Copy/Paste Pose). Same eager-import
// discipline as 7.A/B (sister audit lesson G-1 — async exec leaks
// unhandled rejections through the dispatcher's non-await
// `op.exec(...)` call site).
import * as poseClear from './pose/clearTransform.js';
import * as poseMirror from './pose/mirror.js';
import { duplicate } from './edit/duplicate.js';
import {
  selectLinkedFromVertex,
  selectLinkedExpandSelection,
} from './select/linked.js';
import { applyTopologyOp } from './edit/applyTopologyOp.js';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { discardBatch, endBatch } from '../../store/undoHistory.js';
import { buildVertexAdjacency } from '../../lib/proportionalEdit.js';
import { hitTestVertices } from '../../io/hitTest.js';
import { clientToCanvasXY } from '../editors/viewport/viewportMath.js';
// Audit fix G-1 — eager-import the Armature Modifier service so
// `apply.armatureModifier`'s exec is synchronous. Pre-fix the dynamic
// `await import(...)` made the operator async; the dispatcher fires
// `op.exec(...)` without await, so any error after the await would be
// an unhandled rejection invisible to the user. Eager-import keeps the
// dispatcher's existing try/catch in scope and removes a foot-gun.
// Bundle-weight cost is the service's transitive imports (selectRigSpec
// + chainEval + boneOverlayMatrix + boneSkinning) which are already
// pulled in by CanvasViewport's eager import path — net no new chunks.
import { applyArmatureModifier } from '../../services/ArmatureModifierService.js';
import { computeWorldMatrices } from '../../renderer/transforms.js';
import { readPoseValue } from '../../renderer/animationEngine.js';
import {
  getMesh,
  getDataKind,
} from '../../store/objectDataAccess.js';
import {
  modeCompatTest,
  MODE_EDIT,
  MODE_POSE,
  MODE_WEIGHT_PAINT,
} from '../../modes/modeCompat.js';

/**
 * @typedef {Object} OperatorContext
 * @property {string|null} editorType  - the editor that triggered the op (null = shell)
 *
 * @typedef {Object} OperatorDef
 * @property {string} id
 * @property {string} label
 * @property {(ctx: OperatorContext) => boolean} [available]  - gate (defaults to always)
 * @property {(ctx: OperatorContext) => void} exec
 */

/** @type {Map<string, OperatorDef>} */
const operators = new Map();

/**
 * @param {OperatorDef} def
 */
export function registerOperator(def) {
  if (!def?.id) throw new Error('Operator must have an id');
  if (operators.has(def.id)) {
    throw new Error(`Operator ${def.id} already registered`);
  }
  operators.set(def.id, def);
}

/** @param {string} id */
export function getOperator(id) {
  return operators.get(id) ?? null;
}

/** All registered operators (snapshot - caller must not mutate). */
export function listOperators() {
  return [...operators.values()];
}

/** Test-only: drop everything (Vitest's beforeEach typically calls this). */
export function _resetOperatorsForTests() {
  operators.clear();
  registerBuiltins();
}

// ── Built-in shell operators ─────────────────────────────────────────

const WORKSPACE_IDS = ['default', 'animation'];

function registerBuiltins() {
  for (const id of WORKSPACE_IDS) {
    registerOperator({
      id: `workspace.set.${id}`,
      label: `Switch to ${id} workspace`,
      exec: () => useUIV3Store.getState().setWorkspace(id),
    });
  }

  registerOperator({
    id: 'workspace.reset',
    label: 'Reset active workspace layout',
    exec: () => useUIV3Store.getState().resetWorkspace(),
  });

  // Undo / redo. Wires through the operator dispatcher so future
  // modal operators (drag, lasso) can transparently capture the same
  // Ctrl+Z chord when they own the global modifier surface.
  registerOperator({
    id: 'app.undo',
    label: 'Undo',
    available: () => undoCount() > 0,
    exec: () => {
      const project = useProjectStore.getState().project;
      const updateProject = useProjectStore.getState().updateProject;
      undo(project, (snapshot) => {
        updateProject((proj) => {
          Object.assign(proj, snapshot);
        }, { skipHistory: true });
      });
    },
  });

  registerOperator({
    id: 'app.redo',
    label: 'Redo',
    available: () => redoCount() > 0,
    exec: () => {
      const project = useProjectStore.getState().project;
      const updateProject = useProjectStore.getState().updateProject;
      redo(project, (snapshot) => {
        updateProject((proj) => {
          Object.assign(proj, snapshot);
        }, { skipHistory: true });
      });
    },
  });

  // File save. Phase 5 — opens the Save modal (gallery + library +
  // download tab + thumbnail). The modal handles `.stretch` download
  // and library overwrite paths; this operator just wakes it up.
  registerOperator({
    id: 'file.save',
    label: 'Save Project',
    exec: () => useLibraryDialogStore.getState().openSave(),
  });

  // Selection: deselect-all. Esc is the universal Blender gesture
  // for "drop everything." Implemented as a no-op when nothing is
  // selected so the keystroke doesn't shadow the dispatcher's
  // editable-target check noisily.
  registerOperator({
    id: 'selection.clear',
    label: 'Deselect All',
    available: () => useSelectionStore.getState().items.length > 0,
    exec: () => {
      useSelectionStore.getState().clear();
      useEditorStore.getState().setSelection([]);
    },
  });

  // Selection: select-all toggle. Blender's `A` keymap — if anything
  // is currently selected, deselect everything; else select every
  // visible meshed part. Mirrors the result into the legacy
  // editorStore.selection slot so Properties panes / GizmoOverlay
  // pick up the active head.
  //
  // Toolset Phase 0.C — when Edit Mode is active on a meshed part with
  // the `select` tool, A scopes to that part's vertex set instead
  // (Blender pattern: A in Edit Mode toggles ALL the active mesh's
  // vertices). Object selection is left alone in that branch.
  registerOperator({
    id: 'selection.selectAllToggle',
    label: 'Select All / Deselect All',
    exec: () => {
      const editor = useEditorStore.getState();
      if (editor.editMode === 'edit' && editor.toolMode === 'select') {
        const activePartId = editor.selection?.[0];
        if (typeof activePartId !== 'string' || activePartId.length === 0) return;
        const project = useProjectStore.getState().project;
        const node = project?.nodes?.find((n) => n?.id === activePartId);
        if (!node || node.type !== 'part') return;
        // Vertex count is the mesh's authored rest array length — what
        // every Edit-Mode op dispatches against. Avoid pulling chainEval
        // here; the rest mesh is the canonical edit-mode target.
        const vertCount = Array.isArray(node.mesh?.vertices) ? node.mesh.vertices.length : 0;
        if (vertCount === 0) return;
        const cur = editor.selectedVertexIndices.get(activePartId);
        if (cur && cur.size > 0) {
          editor.deselectAllVertices(activePartId);
        } else {
          editor.selectAllVertices(activePartId, vertCount);
        }
        return;
      }
      const sel = useSelectionStore.getState();
      if (sel.items.length > 0) {
        sel.clear();
        useEditorStore.getState().setSelection([]);
        return;
      }
      const project = useProjectStore.getState().project;
      const partIds = (project?.nodes ?? [])
        .filter((n) => n?.type === 'part' && n.visible !== false)
        .map((n) => n.id);
      if (partIds.length === 0) return;
      sel.select(partIds.map((id) => ({ type: 'part', id })), 'replace');
      // Legacy slot tracks the active head only.
      useEditorStore.getState().setSelection([partIds[partIds.length - 1]]);
    },
  });

  // Toolset Phase 0.C — Alt+A "deselect all" (Blender pattern).
  // Mode-aware: in Edit Mode + select tool clears the vertex selection
  // for the active part; otherwise clears object selection (mirrors
  // Escape, but the Blender muscle memory expects Alt+A specifically).
  registerOperator({
    id: 'selection.deselectAll',
    label: 'Deselect All',
    exec: () => {
      const editor = useEditorStore.getState();
      if (editor.editMode === 'edit' && editor.toolMode === 'select') {
        const activePartId = editor.selection?.[0];
        if (typeof activePartId === 'string' && activePartId.length > 0) {
          editor.deselectAllVertices(activePartId);
        } else {
          editor.clearAllVertexSelections();
        }
        return;
      }
      const sel = useSelectionStore.getState();
      if (sel.items.length === 0 && (editor.selection?.length ?? 0) === 0) return;
      sel.clear();
      editor.setSelection([]);
    },
  });

  // Delete the active selection. Only operates on project nodes
  // (parts + groups); deformer / parameter delete needs Phase 2 / 5
  // editor support to keep references coherent. After delete,
  // selection clears so the empty Properties pane signals the action
  // succeeded.
  registerOperator({
    id: 'selection.delete',
    label: 'Delete Selection',
    available: () => {
      const items = useSelectionStore.getState().items;
      return items.some((it) => it.type === 'part' || it.type === 'group');
    },
    exec: () => {
      const items = useSelectionStore.getState().items;
      const targetIds = items
        .filter((it) => it.type === 'part' || it.type === 'group')
        .map((it) => it.id);
      if (targetIds.length === 0) return;
      // Delete in a single immer batch by chaining deleteNode calls;
      // each call independently snapshots for undo. For multi-select
      // we accept N undo entries because group of N is rare.
      const deleteNode = useProjectStore.getState().deleteNode;
      for (const id of targetIds) deleteNode(id);
      useSelectionStore.getState().clear();
    },
  });

  // Frame-to-selected: center the viewport on the active selection's
  // mesh bounding box at current zoom. Period (.) is the Blender
  // muscle memory binding. Walks selectionStore → projectStore for
  // the part's mesh.vertices; we use the rest mesh rather than rig-
  // evaluated verts because:
  //   - the rest bbox stays stable across param scrubbing;
  //   - reading rig-evaluated verts would couple the operator to the
  //     viewport's per-frame scratch buffers.
  // Selecting a group has no centroid; we fall back to walking the
  // group's descendant parts and union their bboxes.
  registerOperator({
    id: 'view.frameSelected',
    label: 'Frame Selected',
    available: () => {
      const items = useSelectionStore.getState().items;
      return items.some((it) => it.type === 'part' || it.type === 'group');
    },
    exec: () => {
      const items = useSelectionStore.getState().items;
      const target = items.findLast?.((it) => it.type === 'part' || it.type === 'group')
        ?? findLastFrameTarget(items);
      if (!target) return;
      const project = useProjectStore.getState().project;
      const bbox = computeNodeBbox(project, target.id);
      if (!bbox) return;

      // canvas dimensions: query the DOM rather than thread a viewport
      // ref through the operator system. The v3 shell only mounts one
      // CanvasViewport at a time so the first canvas wins.
      const canvas = typeof document !== 'undefined'
        ? /** @type {HTMLCanvasElement|null} */ (document.querySelector('canvas'))
        : null;
      if (!canvas) return;
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      if (vw === 0 || vh === 0) return;

      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      const editor = useEditorStore.getState();
      // GAP-010 Phase B — frame-selection operates on the edit
      // Viewport tab; livePreview's framing is the user's read-only
      // "what does this look like at runtime" view and shouldn't be
      // moved by editor operators.
      const zoom = editor.viewByMode.viewport.zoom;
      editor.setView('viewport', {
        panX: vw / 2 - cx * zoom,
        panY: vh / 2 - cy * zoom,
      });
    },
  });

  // Toggle visibility on the active selection's project nodes.
  registerOperator({
    id: 'selection.toggleVisibility',
    label: 'Toggle Visibility',
    available: () => {
      const items = useSelectionStore.getState().items;
      return items.some((it) => it.type === 'part' || it.type === 'group');
    },
    exec: () => {
      const items = useSelectionStore.getState().items;
      const targetIds = items
        .filter((it) => it.type === 'part' || it.type === 'group')
        .map((it) => it.id);
      if (targetIds.length === 0) return;
      useProjectStore.getState().updateProject((proj) => {
        for (const id of targetIds) {
          const n = proj.nodes.find((nn) => nn.id === id);
          if (n) n.visible = n.visible === false ? true : false;
        }
      });
    },
  });

  // file.new — clear the current project to its empty initial state.
  // Wraps `projectStore.resetProject` so the same code path that
  // initializes the store at first load runs here. Selection is
  // dropped; live param values are reset.
  registerOperator({
    id: 'file.new',
    label: 'New Project',
    exec: () => {
      // reset rigSpec cache + paramValues so a stale rig from a prior
      // session doesn't render against the empty project.
      useSelectionStore.getState().clear();
      useProjectStore.getState().resetProject();
    },
  });

  // Export. Phase 5 — opens the Export modal with format choices.
  // The modal owns the runExport flow + download; this operator
  // just wakes it up. Available gating still lives here so toolbar /
  // keymap can grey out the button when there's nothing to export.
  registerOperator({
    id: 'file.export',
    label: 'Export Live2D',
    available: () => {
      const partCount = (useProjectStore.getState().project.nodes ?? [])
        .filter((n) => n?.type === 'part').length;
      return partCount > 0;
    },
    exec: () => useExportModalStore.getState().openExport(),
  });

  // File load. Phase 5 — opens the Load modal (gallery + import-file
  // tile). Selecting a card calls `loadProject` and sets
  // `currentLibraryId`; selecting "Import Project" runs the file
  // picker for `.stretch`.
  registerOperator({
    id: 'file.load',
    label: 'Open Project',
    exec: () => useLibraryDialogStore.getState().openLoad(),
  });

  // Phase 5 — opens the Cmo3 inspector modal. Read-only first cut of the
  // round-trip work: reverse-parses the CAFF container + scans main.xml
  // for canvas / parameter / part / texture metadata. Full project ingest
  // (vertex arrays, deformer chains, keyforms) is a follow-on sweep.
  registerOperator({
    id: 'file.inspectCmo3',
    label: 'Inspect .cmo3 file…',
    exec: () => useCmo3InspectStore.getState().openInspect(),
  });

  // Phase 3E — F3 command palette. Wakes up the cmdk-backed search
  // dialog mounted at the AppShell level. The dialog itself runs
  // the picked operator on Enter/click, so this op is just a toggle
  // entry point for the keymap.
  registerOperator({
    id: 'app.commandPalette',
    label: 'Operator Search…',
    exec: () => useCommandPaletteStore.getState().toggle(),
  });

  // Phase 4E — F1 help / quick reference modal.
  registerOperator({
    id: 'app.help',
    label: 'Help / Quick Reference',
    exec: () => useHelpModalStore.getState().toggle(),
  });

  // Phase 2H — Modal G/R/S transform operators. Each captures the
  // selection's current transforms and hands off to
  // ModalTransformOverlay which owns mouse + key handling until
  // commit/cancel. Available only when at least one part / group is
  // selected.
  function beginModalTransform(/** @type {'translate'|'rotate'|'scale'} */ kind) {
    const items = useSelectionStore.getState().items;
    const targetIds = items
      .filter((it) => it.type === 'part' || it.type === 'group')
      .map((it) => it.id);
    if (targetIds.length === 0) return;
    // Modal G/R/S writes pose-shape values for bones. Rest editing is
    // not a separate mode anymore (Armature Edit Mode was collapsed
    // into Pose Mode 2026-05-06; rest pivot edits go through Apply
    // Pose As Rest after posing).
    const project = useProjectStore.getState().project;
    const worldMap = computeWorldMatrices(project.nodes);
    /** @type {Map<string, {x:number,y:number,rotation:number,scaleX:number,scaleY:number}>} */
    const original = new Map();
    let pivotX = 0, pivotY = 0;
    let count = 0;
    for (const id of targetIds) {
      const node = project.nodes.find((n) => n.id === id);
      if (!node) continue;
      original.set(id, {
        x:        readPoseValue(node, 'x'),
        y:        readPoseValue(node, 'y'),
        rotation: readPoseValue(node, 'rotation'),
        scaleX:   readPoseValue(node, 'scaleX'),
        scaleY:   readPoseValue(node, 'scaleY'),
      });
      // Modal pivot center: for bones, use world-space pivot (where the
      // joint is on canvas). For non-bones, average their canvas-space
      // anchor (transform.x/y) — same heuristic the original code used,
      // just routed through the world matrix so the answer is correct
      // for nested non-bones too.
      const wm = worldMap.get(id);
      if (wm) {
        const isBone = node.type === 'group' && !!node.boneRole;
        const px = isBone ? (node.transform?.pivotX ?? 0) : (node.transform?.x ?? 0);
        const py = isBone ? (node.transform?.pivotY ?? 0) : (node.transform?.y ?? 0);
        pivotX += wm[0] * px + wm[3] * py + wm[6];
        pivotY += wm[1] * px + wm[4] * py + wm[7];
      }
      count += 1;
    }
    if (original.size === 0) return;
    pivotX /= count;
    pivotY /= count;

    // Open an undo batch so a single Ctrl+Z undoes the whole modal
    // session; ModalTransformOverlay closes the batch on commit /
    // cancel. Mid-modal mousemove writes still hit projectStore but
    // are silenced by isBatching().
    beginBatch(project);

    // Activation point: cursor position at the time of the keystroke.
    // The dispatcher doesn't surface the cursor, so we use the last
    // mousemove via a window-level cache. Falling back to (0,0) keeps
    // math sane until the user moves the mouse.
    const startMouse = lastMousePos();

    useModalTransformStore.getState().begin({
      kind,
      startMouse,
      pivotCanvas: { x: pivotX, y: pivotY },
      original,
    });
  }

  registerOperator({
    id: 'transform.translate',
    label: 'Grab / Move (G)',
    available: () => useSelectionStore.getState().items.some(
      (it) => it.type === 'part' || it.type === 'group',
    ),
    exec: () => beginModalTransform('translate'),
  });

  // Edit mode toggle. Tab — Blender's universal "enter / exit edit
  // mode" gesture. Selection-driven: a meshed part enters mesh edit, a
  // bone-role group enters pose mode. Already in edit mode → exits.
  // Workspace does NOT gate this (matches Blender — workspace is
  // layout-only). BlendShape edit needs to know which shape, so it's
  // NOT bound here; user enters from BlendShapeTab's Edit button.
  registerOperator({
    id: 'mode.editToggle',
    label: 'Toggle Edit Mode (Tab)',
    available: () => true,  // always available — exec handles feedback
    exec: () => {
      const ed = useEditorStore.getState();
      // Tab toggles Object Mode ↔ Edit Mode for the active selection
      // (Blender's universal pattern: Tab enters OB_MODE_EDIT for
      // whatever the active object's data type is):
      //   meshed part   → Edit Mode (vertex / UV editing)
      //   bone group    → Edit Mode (bone REST pivot drag)
      //   already in any edit mode → exit to Object Mode
      //
      // Pose Mode (armature-specific) is reached via the ModePill
      // dropdown, NOT Tab — matching Blender, where Tab on an
      // armature enters Edit Mode and Ctrl+Tab toggles Pose. Pose
      // remains its own slot value (`'pose'`).
      if (ed.editMode) {
        ed.exitEditMode();
        return;
      }
      const active = useSelectionStore.getState().getActive();
      if (!active) {
        toast({
          title: 'Nothing to edit',
          description: 'Select a meshed part or bone group, then press Tab.',
        });
        return;
      }
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === active.id);
      if (!node) return;
      const dataKind = getDataKind(node, project);

      // Phase 2 — route mode entry through `modeCompatTest(dataKind, mode)`
      // instead of the legacy `if (active.type === 'part') ...` chain. Adding
      // a new editable data kind (e.g. sculpt mode, curve edit) becomes a
      // one-line table edit in `src/modes/modeCompat.js`; this dispatcher
      // picks it up automatically.
      const mesh = getMesh(node, project);

      if (dataKind === 'mesh' && modeCompatTest(dataKind, MODE_EDIT) && mesh) {
        // Mesh Edit Mode requires real mesh data (a meshed part). Pre-mesh
        // PSD layers fall through to the no-edit-mode toast below.
        useEditorStore.getState().setSelection([active.id]);
        ed.enterEditMode(MODE_EDIT);
      } else if (dataKind === 'armature' && modeCompatTest(dataKind, MODE_EDIT)) {
        // Edit Mode on an armature = REST pivot drag. Pose Mode is the
        // animation-overlay flow, available via ModePill.
        if (!ed.viewLayers.skeleton) ed.setViewLayers({ skeleton: true });
        ed.enterEditMode(MODE_EDIT);
      } else if (modeCompatTest(dataKind, MODE_POSE)) {
        // Defensive fallback — armatures with Edit disabled in their
        // compat set fall back to Pose. Today's compat set lists both
        // so this branch is unreachable; kept for future dataKinds.
        if (!ed.viewLayers.skeleton) ed.setViewLayers({ skeleton: true });
        ed.enterEditMode(MODE_POSE);
      } else if (modeCompatTest(dataKind, MODE_WEIGHT_PAINT)
                 && (mesh?.boneWeights || mesh?.jointBoneId
                     || (mesh?.weightGroups && Object.keys(mesh.weightGroups).length > 0))) {
        // V4 Phase 4b — Tab on a weight-bound part with no mesh data falls
        // here only when the mesh edit branch above was rejected. The primary
        // entry point for weight paint is the Vertex Groups section's "Edit
        // Weights" button; Tab with mesh+weights still enters mesh edit per
        // the branch above (Blender's one-mode-per-Tab pattern, dedicated
        // cycle for Weight Paint).
        useEditorStore.getState().setSelection([active.id]);
        useProjectStore.getState().ensureWeightGroupsForPart(active.id);
        ed.enterEditMode('weightPaint');
      } else {
        toast({
          title: 'No edit mode for this selection',
          description: dataKind === 'mesh'
            ? 'This part has no mesh — generate one before entering Edit Mode.'
            : dataKind === 'empty'
              ? 'Plain groups have no edit mode — bone-role groups enter Pose Mode.'
              : dataKind === 'deformer'
                ? 'Deformers are edited via the Properties panel, not Edit Mode.'
                : `Selection type "${active.type}" has no edit context.`,
        });
      }
    },
  });
  registerOperator({
    id: 'transform.rotate',
    label: 'Rotate (R)',
    available: () => useSelectionStore.getState().items.some(
      (it) => it.type === 'part' || it.type === 'group',
    ),
    exec: () => beginModalTransform('rotate'),
  });
  registerOperator({
    id: 'transform.scale',
    label: 'Scale (S)',
    available: () => useSelectionStore.getState().items.some(
      (it) => it.type === 'part' || it.type === 'group',
    ),
    exec: () => beginModalTransform('scale'),
  });
  // Toolset Phase 1.A — `B` chord opens the modal box-select overlay.
  // The overlay (`BoxSelectOverlay`) owns mouse + key handling until
  // commit / cancel; this operator just seeds the modal store with
  // the captured starting cursor + the mode (object vs edit + active
  // partId, captured at activation so a mode-switch mid-drag doesn't
  // redirect the eventual commit).
  //
  // Available from any context — Blender's `B` works in Object Mode
  // (selects parts), Edit Mode (selects verts), and even Pose Mode
  // (selects bones; not implemented in this phase). When no editor
  // can consume the selection, the overlay no-ops on commit.
  registerOperator({
    id: 'selection.boxSelect',
    label: 'Box Select (B)',
    available: () => true,
    exec: () => {
      const editor = useEditorStore.getState();
      const isEditModeOnPart = editor.editMode === 'edit'
        && typeof editor.selection?.[0] === 'string'
        && editor.selection[0].length > 0;
      useBoxSelectStore.getState().begin({
        kind: 'box',
        mode: isEditModeOnPart ? 'edit' : 'object',
        editPartId: isEditModeOnPart ? editor.selection[0] : null,
        startClient: lastMousePos(),
      });
    },
  });

  // BVR-007 — N-panel toggle. Blender's `N` keybind shows / hides the
  // right-edge tool-settings panel. Always available (no selection
  // gate); the panel itself decides what to render based on mode.
  registerOperator({
    id: 'panel.toolSettingsToggle',
    label: 'Toggle Tool Settings (N)',
    available: () => true,
    exec: () => useEditorStore.getState().toggleToolPanel(),
  });

  // ── Toolset Phase 4 — Topology operators ─────────────────────────
  // Merge / Dissolve / Subdivide require Edit Mode + a meshed-part
  // selection + (for merge/subdivide) a non-empty vertex selection.
  // The five merge variants all share the `editModeWithSelectedVerts`
  // gate; the dispatch logic differs per mode (centroid / cursor /
  // active vert / threshold / connected component).

  /** Returns the meshed-part id we should operate on, or null. */
  function activeEditPart() {
    const editor = useEditorStore.getState();
    if (editor.editMode !== 'edit') return null;
    const partId = editor.selection?.[0];
    if (typeof partId !== 'string' || partId.length === 0) return null;
    const project = useProjectStore.getState().project;
    const node = project?.nodes?.find((n) => n.id === partId);
    if (!node || node.type !== 'part' || !node.mesh) return null;
    return partId;
  }

  /** Available iff we have an Edit Mode part with ≥`min` selected verts. */
  function topologyAvailable(min) {
    const partId = activeEditPart();
    if (!partId) return false;
    const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
    return !!sel && sel.size >= min;
  }

  registerOperator({
    id: 'edit.mergeMenu',
    label: 'Merge… (M)',
    available: () => topologyAvailable(1),
    exec: () => {
      // Open the popover at the current mouse position (client-px).
      // canvasCursor is the same point translated to canvas-local px so
      // the "At Cursor" branch can target it later.
      const partId = activeEditPart();
      if (!partId) return;
      const client = lastMousePos();
      // Translate client → canvas-local using the canvas DOM rect +
      // current view (panX, panY, zoom). The first canvas wins (matches
      // view.frameSelected).
      const canvas = typeof document !== 'undefined'
        ? /** @type {HTMLCanvasElement|null} */ (document.querySelector('canvas'))
        : null;
      let canvasCursor = null;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const editor = useEditorStore.getState();
        const view = editor.viewByMode.viewport;
        const cx = (client.x - rect.left - view.panX) / view.zoom;
        const cy = (client.y - rect.top  - view.panY) / view.zoom;
        canvasCursor = { x: cx, y: cy };
      }
      useEditMenuStore.getState().openMerge({ cursor: client, canvasCursor });
    },
  });

  /** Run a merge variant on the active edit part. The variant
   *  function returns a TopologyOpResult (or null if there's nothing
   *  to merge); we apply it via the shared dispatcher. */
  function runMergeVariant(variantFn) {
    const partId = activeEditPart();
    if (!partId) return;
    const project = useProjectStore.getState().project;
    const node = project.nodes.find((n) => n.id === partId);
    if (!node?.mesh) return;
    const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
    if (!sel || sel.size === 0) return;
    const result = variantFn(node.mesh, sel);
    if (!result) return;
    applyTopologyOp(partId, result);
  }

  registerOperator({
    id: 'edit.merge.atCenter',
    label: 'Merge — At Center',
    available: () => topologyAvailable(2),
    exec: () => runMergeVariant((mesh, sel) => mergeAtCenter(mesh, sel)),
  });

  registerOperator({
    id: 'edit.merge.atCursor',
    label: 'Merge — At Cursor',
    available: () => topologyAvailable(1),
    exec: () => {
      const cursor = useEditMenuStore.getState().canvasCursor;
      if (!cursor) return;
      runMergeVariant((mesh, sel) => mergeAtCursor(mesh, sel, cursor));
    },
  });

  registerOperator({
    id: 'edit.merge.atLast',
    label: 'Merge — At Last',
    available: () => {
      if (!topologyAvailable(2)) return false;
      const av = useEditorStore.getState().activeVertex;
      const partId = activeEditPart();
      return !!av && av.partId === partId;
    },
    exec: () => {
      const av = useEditorStore.getState().activeVertex;
      if (!av) return;
      runMergeVariant((mesh, sel) => mergeAtLast(mesh, sel, av.vertIndex));
    },
  });

  // Audit fix D-3 — `MERGE_FIRST` ("At First") matches Blender's M-menu.
  // SS doesn't track per-vert selection-history, so "first" = first
  // entry in Set iteration order. Set iteration is insertion-order, so
  // for click-built selections the order matches click history; for
  // box/lasso-built selections it matches geometry-scan order. This is
  // a v1 deviation — Blender's `em->bm->selected.first` is strict
  // selection-history. Documented in `mergeAtFirst` JSDoc.
  registerOperator({
    id: 'edit.merge.atFirst',
    label: 'Merge — At First',
    available: () => topologyAvailable(2),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size < 2) return;
      const firstVertIdx = sel.values().next().value;
      if (typeof firstVertIdx !== 'number') return;
      runMergeVariant((mesh, s) => mergeAtFirst(mesh, s, firstVertIdx));
    },
  });

  registerOperator({
    id: 'edit.merge.byDistance',
    label: 'Merge — By Distance',
    available: () => topologyAvailable(2),
    exec: () => {
      // v1 simplification: prompt for a threshold via window.prompt.
      // The proper threshold-modal popup is a Phase 4 follow-on
      // (mirroring Blender's redo-panel pattern). Default value
      // matches Blender's `MERGE_DIST` of 0.0001 in Blender units —
      // we use 1.0 px since SS meshes operate on canvas px.
      const input = typeof window !== 'undefined'
        ? window.prompt('Merge distance (canvas px):', '1.0')
        : '1.0';
      if (input == null) return; // user cancelled
      const threshold = parseFloat(input);
      if (!Number.isFinite(threshold) || threshold <= 0) return;
      runMergeVariant((mesh, sel) => mergeByDistance(mesh, sel, threshold));
    },
  });

  registerOperator({
    id: 'edit.merge.collapse',
    label: 'Merge — Collapse',
    available: () => topologyAvailable(2),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      if (!node?.mesh) return;
      const adj = buildVertexAdjacency(
        node.mesh.triangles.flat(),
        node.mesh.vertices.length,
      );
      runMergeVariant((mesh, sel) => mergeCollapse(mesh, sel, adj));
    },
  });

  // Dissolve Vertices — single-button op (Blender's menu has only
  // one valid item in our model since faces aren't a thing in SS).
  registerOperator({
    id: 'edit.dissolveVerts',
    label: 'Dissolve Vertices (Ctrl+X)',
    available: () => topologyAvailable(1),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      if (!node?.mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const result = dissolveVertices(node.mesh, sel);
      if (!result) {
        toast({
          title: 'Cannot dissolve',
          description: 'Selection would leave fewer than 3 vertices, or no triangles to refill.',
        });
        return;
      }
      applyTopologyOp(partId, result);
    },
  });

  // Subdivide selected triangles. Reads `cuts` + `smoothness` from
  // `subdivideStore` (driven by the N-panel sliders). v1 doesn't
  // ship the post-op modifier panel — settings are sticky between
  // invocations instead. The user picks values, presses Subdivide,
  // and the op runs once with those settings.
  registerOperator({
    id: 'edit.subdivide',
    label: 'Subdivide Selected',
    available: () => topologyAvailable(2),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      if (!node?.mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const { cuts, smoothness } = useSubdivideStore.getState();
      const result = subdivide(node.mesh, sel, { cuts, smoothness });
      if (!result) {
        toast({
          title: 'Nothing to subdivide',
          description: 'No triangle has ≥2 selected vertices.',
        });
        return;
      }
      applyTopologyOp(partId, result);
    },
  });

  // ── Toolset Phase 5 — Extrude ────────────────────────────────────
  // Blender's `E` chord. Duplicates the selected boundary verts +
  // bridges them with quad strips, then enters Modal G in vertex mode
  // so the user drags the new strip to its final position. Esc cancels
  // the entire op (including the topology change) via discardBatch.
  registerOperator({
    id: 'edit.extrude',
    label: 'Extrude (E)',
    available: () => topologyAvailable(1),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      if (!node?.mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      // Diagnose first so we toast cleanly instead of silently no-opping
      // when the user has only interior verts selected.
      //
      // Audit fix D-2 — toast wording was previously "Cannot extrude",
      // misleadingly suggesting extrude is broken. Blender's
      // `edbm_extrude_mesh:373-378` would dispatch interior-only
      // selections to `extrude_verts_indiv` (wire-edge extension),
      // but Live2D meshes are triangle-only so wire-edges are
      // unusable downstream — this is a Live2D data-model
      // limitation, NOT an SS bug. Reword to make that explicit.
      const boundaryCount = countSelectedBoundary(node.mesh, sel);
      if (boundaryCount === 0) {
        toast({
          title: 'Interior-vert extrude not supported',
          description: 'Live2D meshes need triangles, so wire-edge extrusion (Blender\'s MESH_OT_extrude_verts_indiv) doesn\'t apply. Select a vertex on the mesh\'s outer boundary.',
        });
        return;
      }
      const result = extrude(node.mesh, sel);
      if (!result) return;
      // Open a batch so the topology change + the modal drag collapse
      // to ONE undo entry. discardBatch on cancel rolls back BOTH in
      // one swoop (no redo-stack pollution).
      beginBatch(project);

      // Audit fix G-2 — `applyTopologyOp` returns false when the part
      // disappears between the gate check and the dispatch (defensive
      // — not reachable today, but a future async mutator could trigger
      // it). Pre-fix: the batch was left dangling (no endBatch / no
      // discardBatch), and the snapshot pushed by `beginBatch` would
      // surface as a stale undo entry on the next user undo. Drop the
      // batch via `discardBatch` so the snapshot pops cleanly.
      const ok = applyTopologyOp(partId, result);
      if (!ok) {
        discardBatch(() => {});
        return;
      }

      // Capture original positions for the new verts (== source vert
      // positions, since extrude duplicates at the same coords). The
      // modal needs these to revert on Esc-mid-drag (before discardBatch
      // wipes the entire batch — discardBatch handles cancellation, the
      // original Map handles per-frame delta math).
      const newProject = useProjectStore.getState().project;
      const newNode = newProject.nodes.find((n) => n.id === partId);
      const newMesh = newNode?.mesh;
      if (!newMesh) {
        // Same defensive close as above — between applyTopologyOp and
        // here, the part could in theory vanish. Discard the batch.
        discardBatch(() => {});
        return;
      }
      /** @type {Map<number, {x:number,y:number,restX:number,restY:number}>} */
      const original = new Map();
      const overrideSel = result.selectionOverride ?? new Set();
      for (const idx of overrideSel) {
        const v = newMesh.vertices[idx];
        if (!v) continue;
        original.set(idx, {
          x:     v.x,
          y:     v.y,
          restX: v.restX ?? v.x,
          restY: v.restY ?? v.y,
        });
      }

      // Pivot center for the modal HUD = centroid of new verts.
      let cx = 0, cy = 0, n = 0;
      for (const o of original.values()) { cx += o.x; cy += o.y; n++; }
      const pivot = n > 0
        ? { x: cx / n, y: cy / n }
        : { x: 0, y: 0 };

      useModalVertexTransformStore.getState().begin({
        kind: 'translate',
        partId,
        startMouse: lastMousePos(),
        pivotCanvas: pivot,
        original,
        vertIndices: new Set(overrideSel),
        rollbackOnCancel: true,
      });
    },
  });

  // ── Toolset Phase 6 — Select Linked / Duplicate / Apply / Circle ──
  // Cluster of small cross-mode wins that share the existing operator
  // + popover + modal-overlay infrastructure.

  /** Translate a client-px point to canvas-local coords using the
   *  active viewport's pan + zoom. Returns null when the canvas DOM
   *  isn't available (test environment) or the viewport view slot is
   *  missing. Centralizes the same pattern used by edit.mergeMenu.
   *
   *  Audit fix G-8 — math itself is delegated to `clientToCanvasXY`
   *  in `viewportMath.js`. This wrapper only handles the DOM/store
   *  query the math helper deliberately doesn't depend on (so the
   *  math stays unit-testable without DOM). */
  function clientToCanvas(client) {
    if (typeof document === 'undefined') return null;
    const canvas = /** @type {HTMLCanvasElement|null} */ (document.querySelector('canvas'));
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const view = useEditorStore.getState().viewByMode?.viewport;
    if (!view) return null;
    const [x, y] = clientToCanvasXY(rect, view, client.x, client.y);
    return { x, y };
  }

  // Phase 6.A — Select Linked (cursor): hit-test the nearest vert from
  // the cursor on the active edit part, then flood-fill from it.
  // Mirrors Blender's `MESH_OT_select_linked_pick`
  // (audit D-9 cite fix: `editmesh_select.cc:4503-4536` operator def +
  // `:4467-4501` exec + `:4383-4465` invoke / cursor hit-test path).
  // Threshold uses the same world-space radius as Phase 0.B's vertex
  // click hit-test (so the user-tunable selection feels consistent).
  //
  // Audit fix D-2 — `runSelectLinkedCursor(deselect)` factors the
  // common path so the `L` (select) and `Shift+L` (deselect) chords
  // share one implementation. Mirrors Blender's
  // `RNA_def_boolean(ot->srna, "deselect", false, …)` on the same
  // `MESH_OT_select_linked_pick` operator (`editmesh_select.cc:4520`).
  function runSelectLinkedCursor(deselect) {
    const partId = activeEditPart();
    if (!partId) return;
    const project = useProjectStore.getState().project;
    const node = project.nodes.find((n) => n.id === partId);
    if (!node?.mesh) return;
    const canvasCursor = clientToCanvas(lastMousePos());
    if (!canvasCursor) return;
    const view = useEditorStore.getState().viewByMode?.viewport;
    const zoom = view?.zoom ?? 1;
    const threshold = 16 / zoom;
    const seedIdx = hitTestVertices(node.mesh.vertices, canvasCursor.x, canvasCursor.y, threshold);
    if (seedIdx < 0) {
      toast({
        title: 'No vertex under cursor',
        description: deselect
          ? 'Hover near a vertex on the active mesh, then press Shift+L.'
          : 'Hover near a vertex on the active mesh, then press L.',
      });
      return;
    }
    const linked = selectLinkedFromVertex(node.mesh, seedIdx);
    if (!linked || linked.size === 0) return;
    const editor = useEditorStore.getState();
    if (deselect) {
      // Subtract `linked` from the current selection. Mirrors Blender's
      // `edbm_select_linked_pick_ex` flipping `sel` in the BMW walker.
      const cur = editor.selectedVertexIndices.get(partId) ?? new Set();
      const next = new Set(cur);
      for (const i of linked) next.delete(i);
      editor.setVertexSelectionForPart(partId, next);
      // Active vert: drop if it was in the deselected ring.
      if (editor.activeVertex?.partId === partId
          && linked.has(editor.activeVertex.vertIndex)) {
        editor.deselectVertex(partId, editor.activeVertex.vertIndex);
      }
      return;
    }
    editor.setVertexSelectionForPart(partId, linked);
    editor.selectVertex(partId, seedIdx, /* additive */ true);
  }

  registerOperator({
    id: 'select.linked.cursor',
    label: 'Select Linked (under cursor) (L)',
    available: () => activeEditPart() !== null,
    exec: () => runSelectLinkedCursor(/* deselect */ false),
  });

  // Audit fix D-2 — Blender binds Shift+L to the same operator with
  // `deselect=True`. Sibling operator here keeps the chord-to-operator
  // mapping straightforward (one chord = one operator id).
  registerOperator({
    id: 'select.linked.cursor.deselect',
    label: 'Deselect Linked (under cursor) (Shift+L)',
    available: () => activeEditPart() !== null,
    exec: () => runSelectLinkedCursor(/* deselect */ true),
  });

  // Phase 6.A — Select Linked (expand): expand each vertex in the
  // current selection to its full connected component. Mirrors
  // Blender's `MESH_OT_select_linked` (`Ctrl+L` chord, no popup).
  registerOperator({
    id: 'select.linked.expand',
    label: 'Select Linked (expand selection) (Ctrl+L)',
    available: () => topologyAvailable(1),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      if (!node?.mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const expanded = selectLinkedExpandSelection(node.mesh, sel);
      if (!expanded) return;
      useEditorStore.getState().setVertexSelectionForPart(partId, expanded);
    },
  });

  // Phase 6.B — Duplicate (`Shift+D`). Mode-aware dispatch:
  //   - Edit Mode + selected verts → topology op (atomic with modal G,
  //     same pattern as Phase 5 extrude). `discardBatch` rolls back
  //     BOTH the topology change AND the drag on Esc.
  //   - Object Mode + selected nodes → recursive `duplicateNode` × N,
  //     then start node-level Modal G translate. NON-atomic per
  //     Blender's `OBJECT_OT_duplicate_move` macro semantics: Esc
  //     during translate keeps the duplicates, drops just the drag.
  //     User Ctrl+Z again to remove the dups.
  //
  // ┌──────────────┬──────────────────────────────────┬──────────────────────────────┐
  // │ Mode         │ Esc-mid-translate behaviour      │ Source                       │
  // ├──────────────┼──────────────────────────────────┼──────────────────────────────┤
  // │ Edit Mode    │ Rolls back BOTH dup AND drag     │ SS Phase 5 D-1 atomic deviation │
  // │ Object Mode  │ Keeps dup, drops drag only       │ Blender macro semantics      │
  // └──────────────┴──────────────────────────────────┴──────────────────────────────┘
  //
  // Audit D-6 (DOCUMENT-AS-DEVIATION) — the cross-mode INCONSISTENCY
  // is deliberate but will surprise Blender users who hit Esc-mid-
  // translate in one mode after using the other. Edit Mode atomic was
  // the Phase 5 D-1 call ("aborting a single intentional gesture");
  // Object Mode non-atomic matches Blender's macro
  // (`mesh_ops.cc:235-242` + `object_ops.cc:306-314`). Both are valid;
  // the asymmetry is the cost of mixing Phase 5's UX choice with
  // Blender parity here. Bringing Object Mode into the atomic camp would
  // need `rollbackOnCancel` on `modalTransformStore` (currently only
  // exists on `modalVertexTransformStore`). Deferred — the data-loss
  // cost of "keeps dup" is one Ctrl+Z away.
  registerOperator({
    id: 'edit.duplicate',
    label: 'Duplicate (Shift+D)',
    available: () => {
      const editor = useEditorStore.getState();
      if (editor.editMode === 'edit') {
        return topologyAvailable(1);
      }
      // Object Mode: needs at least one part / group selected.
      return useSelectionStore.getState().items.some(
        (it) => it.type === 'part' || it.type === 'group',
      );
    },
    exec: () => {
      const editor = useEditorStore.getState();
      if (editor.editMode === 'edit') {
        // ── Edit Mode branch ──
        const partId = activeEditPart();
        if (!partId) return;
        const project = useProjectStore.getState().project;
        const node = project.nodes.find((n) => n.id === partId);
        if (!node?.mesh) return;
        const sel = editor.selectedVertexIndices.get(partId);
        if (!sel || sel.size === 0) return;
        const result = duplicate(node.mesh, sel);
        if (!result) return;
        beginBatch(project);
        const ok = applyTopologyOp(partId, result);
        if (!ok) {
          discardBatch(() => {});
          return;
        }
        // Capture original positions for the new dup verts. Same pattern
        // as Phase 5 extrude: dups start at source positions, modal G
        // translates them away.
        const newProject = useProjectStore.getState().project;
        const newNode = newProject.nodes.find((n) => n.id === partId);
        const newMesh = newNode?.mesh;
        if (!newMesh) {
          discardBatch(() => {});
          return;
        }
        /** @type {Map<number, {x:number,y:number,restX:number,restY:number}>} */
        const original = new Map();
        const overrideSel = result.selectionOverride ?? new Set();
        for (const idx of overrideSel) {
          const v = newMesh.vertices[idx];
          if (!v) continue;
          original.set(idx, {
            x:     v.x,
            y:     v.y,
            restX: v.restX ?? v.x,
            restY: v.restY ?? v.y,
          });
        }
        let cx = 0, cy = 0, n = 0;
        for (const o of original.values()) { cx += o.x; cy += o.y; n++; }
        const pivot = n > 0 ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
        useModalVertexTransformStore.getState().begin({
          kind: 'translate',
          partId,
          startMouse: lastMousePos(),
          pivotCanvas: pivot,
          original,
          vertIndices: new Set(overrideSel),
          rollbackOnCancel: true,
        });
        return;
      }

      // ── Object Mode branch ──
      const items = useSelectionStore.getState().items;
      const targetIds = items
        .filter((it) => it.type === 'part' || it.type === 'group')
        .map((it) => it.id);
      if (targetIds.length === 0) return;
      const projectStore = useProjectStore.getState();
      // Snapshot pre-dup node ids so we can identify the new ones via
      // diff (`duplicateNode` doesn't return a mapping, and refactoring
      // it to return one would touch a much larger surface). `nodes` is
      // an Array — Set membership is O(1), the diff is one pass.
      const preIds = new Set(projectStore.project.nodes.map((n) => n.id));
      for (const id of targetIds) {
        projectStore.duplicateNode(id);
      }
      const postNodes = useProjectStore.getState().project.nodes;
      /** @type {string[]} */
      const newIds = [];
      for (const n of postNodes) {
        if (!preIds.has(n.id)) newIds.push(n.id);
      }
      if (newIds.length === 0) return;
      // Filter to "root" duplicates — those whose parent is NOT itself
      // a freshly-duplicated node. Children inherit the move via the
      // parent transform; selecting only the roots avoids a Modal G
      // double-applying the delta to grandchildren.
      const newIdSet = new Set(newIds);
      const rootDupIds = newIds.filter((id) => {
        const node = postNodes.find((nn) => nn.id === id);
        return !node?.parent || !newIdSet.has(node.parent);
      });
      if (rootDupIds.length === 0) return;
      // Selection update: replace with the root duplicates so Modal G
      // operates on them. Mirror the result into both the new
      // selectionStore (canonical) and the legacy editorStore.selection
      // slot (for Properties pane heads).
      useSelectionStore.getState().select(
        rootDupIds.map((id) => {
          const node = postNodes.find((nn) => nn.id === id);
          return { type: node?.type ?? 'part', id };
        }),
        'replace',
      );
      useEditorStore.getState().setSelection(rootDupIds);
      // Hand off to Modal G translate. This opens its own batch — the
      // duplicateNode mutations are already persisted (one undo entry
      // each, before the batch), and the translate becomes a separate
      // undo entry on commit. Matches Blender's `OBJECT_OT_duplicate_move`
      // macro: Esc-mid-drag keeps the dups, Ctrl+Z reverses the dup.
      beginModalTransform('translate');
    },
  });

  // Phase 6.C — Apply menu (`Ctrl+A`). Opens the Apply popover anchored
  // at the cursor. Items dispatch to existing operators; the menu just
  // lists what's currently applicable and routes the click.
  //
  // Mirrors Blender's `OBJECT_MT_object_apply` / `VIEW3D_MT_object_apply`
  // popups (`reference/blender/scripts/startup/bl_ui/space_view3d.py:6280+`).
  // The available items differ per mode; the menu component reads
  // operator availability and greys non-applicable rows.
  registerOperator({
    id: 'apply.menu',
    label: 'Apply… (Ctrl+A)',
    available: () => {
      const editor = useEditorStore.getState();
      // Pose Mode → Apply Pose As Rest is the canonical use.
      if (editor.editMode === 'pose') return true;
      // Object Mode → Apply Modifier on a selected part with modifiers.
      const items = useSelectionStore.getState().items;
      const project = useProjectStore.getState().project;
      return items.some((it) => {
        if (it.type !== 'part') return false;
        const node = project.nodes.find((n) => n.id === it.id);
        return Array.isArray(node?.modifiers) && node.modifiers.length > 0;
      });
    },
    exec: () => {
      useEditMenuStore.getState().openApply({ cursor: lastMousePos() });
    },
  });

  registerOperator({
    id: 'apply.poseAsRest',
    label: 'Apply Pose As Rest',
    available: () => {
      // Audit fix G-2 — animation mode guard. Pre-fix the legacy UI
      // button at CanvasViewport.jsx:3531-3534 had this check; the Phase
      // 6 operator did not. `Ctrl+A` at a non-zero scrubber position
      // bakes the motion3.json-offset pose into rest, corrupting rest
      // positions permanently — and combined with G-6 (no undo path),
      // this was a silent data-loss vector reachable from the default
      // keymap. Refuse the op when an animation is being scrubbed.
      const editor = useEditorStore.getState();
      if (editor.editMode === 'animation') return false;
      // Available iff there's at least one bone in the project (so the
      // op has something to bake). Same check the existing UI button uses.
      const project = useProjectStore.getState().project;
      return (project?.nodes ?? []).some(
        (n) => n.type === 'group' && !!n.boneRole,
      );
    },
    exec: () => {
      // Audit fix G-6 — wrap in beginBatch/endBatch so the operation is
      // undo-able. Pre-fix `applyPoseAsRest()` set state via a direct
      // immer.produce call (bypassing updateProject), so no snapshot was
      // pushed and Ctrl+Z post-Apply was a no-op. The legacy UI button
      // had the same gap, but Phase 6 made it reachable from a keymap
      // chord without any modal confirmation. Wrapping at the operator
      // level (rather than touching applyPoseAsRest itself) keeps the
      // store function unchanged for the legacy callers.
      const project = useProjectStore.getState().project;
      beginBatch(project);
      try {
        useProjectStore.getState().applyPoseAsRest();
      } finally {
        endBatch();
      }
      toast({
        title: 'Pose applied as rest',
        description: 'Bone pose channels zeroed; rest geometry now reflects the posed shape.',
      });
    },
  });

  registerOperator({
    id: 'apply.armatureModifier',
    label: 'Apply Armature Modifier',
    available: () => {
      // Available iff at least one selected part has an armature modifier.
      const items = useSelectionStore.getState().items;
      const project = useProjectStore.getState().project;
      return items.some((it) => {
        if (it.type !== 'part') return false;
        const node = project.nodes.find((n) => n.id === it.id);
        return Array.isArray(node?.modifiers)
          && node.modifiers.some((m) => m?.type === 'armature');
      });
    },
    exec: () => {
      const items = useSelectionStore.getState().items;
      const project = useProjectStore.getState().project;
      const targetIds = items
        .filter((it) => it.type === 'part')
        .filter((it) => {
          const node = project.nodes.find((n) => n.id === it.id);
          return Array.isArray(node?.modifiers)
            && node.modifiers.some((m) => m?.type === 'armature');
        })
        .map((it) => it.id);
      if (targetIds.length === 0) return;
      // Audit fix G-7 — wrap the per-part loop in a single batch so
      // multi-part bakes collapse to ONE undo entry. Pre-fix each
      // applyArmatureModifier(id) was its own snapshot; undoing a 3-part
      // bake required 3× Ctrl+Z. Single batch matches Edit Mode duplicate
      // pattern and Blender's macro semantics.
      beginBatch(project);
      let bakedCount = 0;
      try {
        for (const id of targetIds) {
          const result = applyArmatureModifier(id);
          if (result.baked) bakedCount++;
        }
      } finally {
        endBatch();
      }
      toast({
        title: bakedCount === targetIds.length
          ? `Applied Armature modifier on ${bakedCount} part(s)`
          : `Applied on ${bakedCount} of ${targetIds.length} part(s)`,
        description: 'Posed deformation baked into rest mesh; modifier removed.',
      });
    },
  });

  // Phase 6.D — Circle Select (`C`). Modal cursor-circle paint
  // selection. Mirrors Blender's `VIEW3D_OT_select_circle` (default
  // keymap: `C` chord). The overlay (`CircleSelectOverlay`) owns the
  // mouse + key lifecycle from here; this op just seeds the modal.
  registerOperator({
    id: 'selection.circleSelect',
    label: 'Circle Select (C)',
    available: () => true,
    exec: () => {
      const editor = useEditorStore.getState();
      const isEditModeOnPart = editor.editMode === 'edit'
        && typeof editor.selection?.[0] === 'string'
        && editor.selection[0].length > 0;
      useCircleSelectStore.getState().begin({
        mode: isEditModeOnPart ? 'edit' : 'object',
        editPartId: isEditModeOnPart ? editor.selection[0] : null,
        cursorClient: lastMousePos(),
      });
    },
  });

  // ── Toolset Phase 7.A — Object Mode tools ──────────────────────────

  // 7.A.1 — Snap menu (`Shift+S`). Opens the SnapMenu popover anchored
  // at the mouse cursor; click an item to commit. Blender's
  // `VIEW3D_MT_snap_pie` (`scripts/startup/bl_ui/space_view3d.py:6377+`).
  registerOperator({
    id: 'object.snap.menu',
    label: 'Snap Menu (Shift+S)',
    exec: () => {
      useEditMenuStore.getState().openSnap({ cursor: lastMousePos() });
    },
  });

  // The 9 individual snap operators. Each is also command-palette callable.
  registerOperator({
    id: 'object.snap.selectionToCursor',
    label: 'Selection to Cursor',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0,
    exec: () => objectSnap.snapSelectionToCursor(),
  });
  registerOperator({
    id: 'object.snap.selectionToCursorKeepOffset',
    label: 'Selection to Cursor (Keep Offset)',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0,
    exec: () => objectSnap.snapSelectionToCursorKeepOffset(),
  });
  registerOperator({
    id: 'object.snap.selectionToGrid',
    label: 'Selection to Grid',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0,
    exec: () => objectSnap.snapSelectionToGrid(),
  });
  registerOperator({
    id: 'object.snap.selectionToWorldOrigin',
    label: 'Selection to World Origin',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0,
    exec: () => objectSnap.snapSelectionToWorldOrigin(),
  });
  registerOperator({
    id: 'object.snap.selectionToActive',
    label: 'Selection to Active',
    available: () => {
      const sel = objectSnap.eligibleSelection();
      return sel.nodeIds.length >= 2 && sel.activeId !== null;
    },
    exec: () => objectSnap.snapSelectionToActive(),
  });
  registerOperator({
    id: 'object.snap.cursorToWorldOrigin',
    label: 'Cursor to World Origin',
    exec: () => objectSnap.snapCursorToWorldOrigin(),
  });
  registerOperator({
    id: 'object.snap.cursorToSelected',
    label: 'Cursor to Selected',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0,
    exec: () => objectSnap.snapCursorToSelected(),
  });
  registerOperator({
    id: 'object.snap.cursorToGrid',
    label: 'Cursor to Grid',
    exec: () => objectSnap.snapCursorToGrid(),
  });
  registerOperator({
    id: 'object.snap.cursorToActive',
    label: 'Cursor to Active',
    available: () => objectSnap.eligibleSelection().activeId !== null,
    exec: () => objectSnap.snapCursorToActive(),
  });

  // 7.A.2 — Mirror selected (`Ctrl+M` → axis-pick popover → X/Y/Z).
  // Two-step modal: chord opens MirrorAxisMenu; click or bare-letter
  // X/Y/Z commits via mirrorSelected(axis).
  registerOperator({
    id: 'object.mirror.menu',
    label: 'Mirror Menu (Ctrl+M)',
    exec: () => {
      useEditMenuStore.getState().openMirrorAxis({ cursor: lastMousePos() });
    },
  });
  registerOperator({
    id: 'object.mirror.x',
    label: 'Mirror Selected (X axis)',
    exec: () => objectMirror.mirrorSelected('x'),
  });
  registerOperator({
    id: 'object.mirror.y',
    label: 'Mirror Selected (Y axis)',
    exec: () => objectMirror.mirrorSelected('y'),
  });

  // 7.A.3 — Set Parent (`Ctrl+P`). Active = LAST selected; every other
  // selected node gets re-parented to active. Reuses `reparentNode`'s
  // cycle + type validation. Keeps visual transform by default.
  registerOperator({
    id: 'object.parent.set',
    label: 'Set Parent (Ctrl+P)',
    available: () => {
      const items = useSelectionStore.getState().items ?? [];
      return items.filter((it) => it?.type === 'part' || it?.type === 'group').length >= 2;
    },
    exec: () => {
      const r = objectParent.setParent({ keepTransform: true });
      if (r.parented === 0 && r.skipped > 0) {
        toast({ title: 'No valid parent target',
                description: 'Cycle / type-mismatch rejected the reparent.' });
      }
    },
  });

  // 7.A.4 — Clear Parent (`Alt+P`). Opens the three-option popover
  // (Clear / Clear and Keep Transform / Clear Inverse).
  registerOperator({
    id: 'object.parent.clearMenu',
    label: 'Clear Parent (Alt+P)',
    available: () => {
      const items = useSelectionStore.getState().items ?? [];
      return items.some((it) => it?.type === 'part' || it?.type === 'group');
    },
    exec: () => {
      useEditMenuStore.getState().openClearParent({ cursor: lastMousePos() });
    },
  });

  // 7.A.5 — Set Origin (right-click submenu). Surfaced via ContextMenu
  // (Object Mode → Set Origin). Could also bind a chord later; Blender
  // exposes it via Object → Set Origin only (no default chord).
  registerOperator({
    id: 'object.setOrigin.menu',
    label: 'Set Origin Menu',
    available: () => {
      const items = useSelectionStore.getState().items ?? [];
      return items.some((it) => it?.type === 'part');
    },
    exec: () => {
      useEditMenuStore.getState().openSetOrigin({ cursor: lastMousePos() });
    },
  });

  // ── Toolset Phase 7.B — Weight Paint tools ──────────────────────────

  // 7.B.1 — Sample Weight (`Shift+X`). Eyedropper picks the closest
  // vertex's weight in the active group → writes `editorStore.brushWeight`.
  // Blender source: `PAINT_OT_weight_sample`
  // (`reference/blender/source/blender/editors/sculpt_paint/mesh/paint_vertex_weight_ops.cc:278`,
  // invoke at `:172`). Keymap: `Shift+X` per `blender_default.py:5136`.
  registerOperator({
    id: 'weightPaint.sample',
    label: 'Sample Weight (Shift+X)',
    // Audit fix G-6: was returning true for non-meshed parts (group
    // node selected) — operator appeared callable in the command
    // palette but always silently no-oped. Now matches sibling
    // mirror/normalize gates: requires a meshed part.
    available: () => {
      const editor = useEditorStore.getState();
      const partId = editor.selection?.[0];
      if (editor.editMode !== 'weightPaint') return false;
      if (typeof partId !== 'string') return false;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n?.id === partId);
      if (!node || node.type !== 'part') return false;
      const mesh = getMesh(node, project);
      return !!(mesh && Array.isArray(mesh.vertices) && mesh.vertices.length > 0);
    },
    exec: () => {
      wpSample.sampleWeightFromGlobalCursor(lastMousePos());
    },
  });

  // 7.B.3 — Mirror Weights. Two operators surface both pairing modes
  // (topology + byName); both run on the active part. Blender source:
  // `OBJECT_OT_vertex_group_mirror`
  // (`reference/blender/source/blender/editors/object/object_vgroup.cc:3707`).
  // No chord — surfaced via N-panel button + command palette.
  // Audit fix D-3: pre-fix the operator id was `weightPaint.mirror.byTopology`
  // and label "Mirror Weights (Topology, X axis)". Blender's `use_topology`
  // flag is the OPPOSITE of position-match (true = graph walk; false =
  // coordinate match). SS uses coordinate-match here, which is Blender's
  // DEFAULT — so the correct name is `byPosition`. Per Rule №2 (no
  // migration baggage) the old id is dropped without an alias.
  registerOperator({
    id: 'weightPaint.mirror.byPosition',
    label: 'Mirror Weights (By Position, X axis)',
    available: () => wpMirror.eligibleForMirror({ mode: 'position' }),
    exec: () => {
      const r = wpMirror.mirrorWeights({ axis: 'x', mode: 'position' });
      if (r.skipped || r.mirrored === 0) {
        toast({
          title: 'Mirror Weights — nothing to mirror',
          description: r.vertexPairs === 0
            ? 'No mirror-vertex pairs found on the active mesh.'
            : 'No active weight group / no eligible target.',
        });
      }
    },
  });
  registerOperator({
    id: 'weightPaint.mirror.byName',
    label: 'Mirror Weights (By Group Name, X axis)',
    available: () => wpMirror.eligibleForMirror({ mode: 'byName' }),
    exec: () => {
      const r = wpMirror.mirrorWeights({ axis: 'x', mode: 'byName' });
      if (r.skipped || r.mirrored === 0) {
        toast({
          title: 'Mirror Weights — no matching group pairs',
          description:
            'Pair groups via L/R marker (e.g. arm_L ↔ arm_R, L_arm ↔ R_arm, LEFT ↔ RIGHT).',
        });
      }
    },
  });

  // 7.B.5 — Normalize All Vertex Groups. Per-vertex divide by sum so all
  // groups together total 1.0. Blender source:
  // `OBJECT_OT_vertex_group_normalize_all`
  // (`reference/blender/source/blender/editors/object/object_vgroup.cc:3219`,
  // exec at `:3173`). Audit-fixed binding: NO chord (Blender's `Ctrl+N`
  // collides with SS's `file.new`). Surfaced via N-panel button + command
  // palette.
  registerOperator({
    id: 'weightPaint.normalizeAll',
    label: 'Normalize All Vertex Groups',
    available: () => wpNormalize.eligibleForNormalize(),
    exec: () => {
      const r = wpNormalize.normalizeAllWeights();
      if (r.skipped) {
        toast({
          title: 'Normalize All — nothing to normalize',
          description: 'Active part has no weight groups, or all weights are zero.',
        });
      } else if (r.normalized === 0) {
        toast({
          title: 'Normalize All — already normalized',
          description: `${r.zeroSumVerts ?? 0} zero-sum vertices skipped.`,
        });
      }
    },
  });

  // ── Phase 7.C — Pose Mode tools ─────────────────────────────────────
  //
  // Mode-gated: every operator's `available` callback rejects unless
  // `editorStore.editMode === 'pose'`. Outside Pose Mode, the chord
  // silently no-ops (Blender pattern — chords are armed by mode and
  // bare letters elsewhere don't shadow Pose-only chords).
  //
  // Audit-fixed bindings (per plan §8 Phase 7 — Pose Mode table):
  //   Alt+G/R/S         → clear selected loc/rot/scale
  //   Alt+Shift+G/R/S   → clear ALL bones loc/rot/scale (3 separate chords)
  //   Ctrl+Shift+M      → select mirror partners
  //   Ctrl+Shift+V      → mirror-paste (Blender's actual pose-mirror chord)
  //   Ctrl+C / Ctrl+V   → copy / paste (Pose Mode only)
  const inPoseMode = () => useEditorStore.getState().editMode === 'pose';

  registerOperator({
    id: 'pose.clearLocation',
    label: 'Clear Pose Location (Alt+G)',
    available: () => inPoseMode() && poseClear.hasSelectedBones(),
    exec: () => {
      const r = poseClear.clearPoseLocation();
      if (r.skipped) {
        toast({
          title: 'Clear Pose Location — no bones selected',
          description: 'Select bone(s) in Pose Mode first.',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.clearRotation',
    label: 'Clear Pose Rotation (Alt+R)',
    available: () => inPoseMode() && poseClear.hasSelectedBones(),
    exec: () => {
      const r = poseClear.clearPoseRotation();
      if (r.skipped) {
        toast({
          title: 'Clear Pose Rotation — no bones selected',
          description: 'Select bone(s) in Pose Mode first.',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.clearScale',
    label: 'Clear Pose Scale (Alt+S)',
    available: () => inPoseMode() && poseClear.hasSelectedBones(),
    exec: () => {
      const r = poseClear.clearPoseScale();
      if (r.skipped) {
        toast({
          title: 'Clear Pose Scale — no bones selected',
          description: 'Select bone(s) in Pose Mode first.',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.clearAllLocation',
    label: 'Clear All Pose Locations (Shift+Alt+G)',
    available: () => inPoseMode() && poseClear.hasAnyBones(),
    exec: () => {
      const r = poseClear.clearAllPose('location');
      if (r.skipped) {
        toast({
          title: 'Clear All Pose Locations — no bones in project',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.clearAllRotation',
    label: 'Clear All Pose Rotations (Shift+Alt+R)',
    available: () => inPoseMode() && poseClear.hasAnyBones(),
    exec: () => {
      const r = poseClear.clearAllPose('rotation');
      if (r.skipped) {
        toast({
          title: 'Clear All Pose Rotations — no bones in project',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.clearAllScale',
    label: 'Clear All Pose Scales (Shift+Alt+S)',
    available: () => inPoseMode() && poseClear.hasAnyBones(),
    exec: () => {
      const r = poseClear.clearAllPose('scale');
      if (r.skipped) {
        toast({
          title: 'Clear All Pose Scales — no bones in project',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.selectMirror',
    label: 'Select Mirror Bones (Ctrl+Shift+M)',
    available: () => inPoseMode() && poseMirror.eligibleForSelectMirror(),
    exec: () => {
      const r = poseMirror.poseSelectMirror();
      if (r.skipped) {
        toast({
          title: 'Select Mirror — no bones selected',
          description: 'Select bone(s) in Pose Mode first.',
        });
        return;
      }
      // Audit-fix G-5: surface missing partners on partial success too.
      // Pre-fix this branch only fired when `added === 0` — when SOME
      // partners were added and others were missing, the missing roles
      // were silently dropped. Mirrors Blender's POSE_OT_select_mirror
      // which reports missing partners regardless of partial success.
      if (r.missing.length > 0) {
        toast({
          title: r.added > 0
            ? 'Select Mirror — some partners missing'
            : 'Select Mirror — no mirror partners found',
          description: `Role(s) without mirror: ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? '…' : ''}`,
        });
      }
    },
  });

  registerOperator({
    id: 'pose.copy',
    label: 'Copy Pose (Ctrl+C)',
    available: () => inPoseMode() && poseMirror.eligibleForCopy(),
    exec: () => {
      const r = poseMirror.poseCopy();
      if (r.copied === 0) {
        toast({
          title: 'Copy Pose — no bones selected',
          description: 'Select bone(s) in Pose Mode first.',
        });
      }
    },
  });

  registerOperator({
    id: 'pose.paste',
    label: 'Paste Pose (Ctrl+V)',
    available: () => inPoseMode() && poseMirror.eligibleForPaste({ flipped: false }),
    exec: () => {
      const r = poseMirror.posePaste({ flipped: false });
      if (r.skipped) {
        toast({
          title: 'Paste Pose — clipboard empty or no bones selected',
          description: 'Use Ctrl+C on a posed selection first.',
        });
      } else if (r.pasted === 0 && r.unmatchedRoles.length > 0) {
        toast({
          title: 'Paste Pose — no matching bone roles',
          description: `Clipboard roles not found in selection: ${r.unmatchedRoles.slice(0, 3).join(', ')}${r.unmatchedRoles.length > 3 ? '…' : ''}`,
        });
      }
    },
  });

  registerOperator({
    id: 'pose.mirrorPose',
    label: 'Mirror Pose (Ctrl+Shift+V)',
    available: () => inPoseMode() && poseMirror.eligibleForPaste({ flipped: true }),
    exec: () => {
      const r = poseMirror.poseMirrorPaste();
      if (r.skipped) {
        toast({
          title: 'Mirror Pose — clipboard empty or no mirrorable bones selected',
          description: 'Copy a pose first, then select bone(s) with left*/right* roles.',
        });
      } else if (r.pasted === 0 && r.unmatchedRoles.length > 0) {
        toast({
          title: 'Mirror Pose — no matching mirror partners',
          description: `Mirrored roles not in clipboard: ${r.unmatchedRoles.slice(0, 3).join(', ')}${r.unmatchedRoles.length > 3 ? '…' : ''}`,
        });
      }
    },
  });
}

/** @type {{x:number, y:number}} */
let _lastMouse = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    _lastMouse = { x: e.clientX, y: e.clientY };
  }, { capture: true, passive: true });
}
function lastMousePos() {
  return { ..._lastMouse };
}

/**
 * Compute the rest-mesh bounding box for a node id. For parts:
 * union of mesh.vertices. For groups: union of every descendant
 * part's bbox. Returns null when the node has no geometry to
 * frame against.
 */
function computeNodeBbox(project, nodeId) {
  const node = project?.nodes?.find((n) => n.id === nodeId);
  if (!node) return null;
  /** @type {{minX:number, minY:number, maxX:number, maxY:number}} */
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  function unionPartVerts(part) {
    const verts = part?.mesh?.vertices;
    if (!Array.isArray(verts)) return;
    for (const v of verts) {
      const x = v?.x ?? v?.restX ?? 0;
      const y = v?.y ?? v?.restY ?? 0;
      if (x < bbox.minX) bbox.minX = x;
      if (y < bbox.minY) bbox.minY = y;
      if (x > bbox.maxX) bbox.maxX = x;
      if (y > bbox.maxY) bbox.maxY = y;
    }
  }

  if (node.type === 'part') {
    unionPartVerts(node);
  } else {
    // Walk descendants depth-first to find every part under this group.
    const stack = [node.id];
    const seen = new Set();
    while (stack.length > 0) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of project.nodes) {
        if (c.parent === id) {
          if (c.type === 'part') unionPartVerts(c);
          else stack.push(c.id);
        }
      }
    }
  }

  if (bbox.minX === Infinity) return null;
  return bbox;
}

/** findLast polyfill for environments without Array.prototype.findLast. */
function findLastFrameTarget(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'part' || it.type === 'group') return it;
  }
  return null;
}

registerBuiltins();
