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
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useSubdivideStore } from '../../store/subdivideStore.js';
import { mergeAtCenter, mergeAtCursor, mergeAtFirst, mergeAtLast, mergeByDistance, mergeCollapse } from './edit/merge.js';
import { dissolveVertices } from './edit/dissolve.js';
import { subdivide } from './edit/subdivide.js';
import { extrude, countSelectedBoundary } from './edit/extrude.js';
import { applyTopologyOp } from './edit/applyTopologyOp.js';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { discardBatch } from '../../store/undoHistory.js';
import { buildVertexAdjacency } from '../../lib/proportionalEdit.js';
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
  // bone-role group enters skeleton edit. Already in edit mode → exits.
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
