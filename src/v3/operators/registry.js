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
import { undo, redo, undoCount, redoCount, beginBatch } from '../../store/undoHistory.js';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { useCommandPaletteStore } from '../../store/commandPaletteStore.js';
import { useHelpModalStore } from '../../store/helpModalStore.js';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useCmo3InspectStore } from '../../store/cmo3InspectStore.js';

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

const WORKSPACE_IDS = ['layout', 'modeling', 'rigging', 'pose', 'animation'];

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
    exec: () => useSelectionStore.getState().clear(),
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
      const zoom = editor.view.zoom;
      editor.setView({
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

    const project = useProjectStore.getState().project;
    /** @type {Map<string, any>} */
    const original = new Map();
    let pivotX = 0, pivotY = 0;
    for (const id of targetIds) {
      const node = project.nodes.find((n) => n.id === id);
      if (!node?.transform) continue;
      original.set(id, { ...node.transform });
      pivotX += node.transform.x ?? 0;
      pivotY += node.transform.y ?? 0;
    }
    if (original.size === 0) return;
    pivotX /= original.size;
    pivotY /= original.size;

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
