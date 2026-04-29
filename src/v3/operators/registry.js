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
import { undo, redo, undoCount, redoCount } from '../../store/undoHistory.js';
import {
  serializeProject,
  deserializeProject,
} from '../../services/PersistenceService.js';
import { runExport } from '../../services/ExportService.js';

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

  // File save / load. Phase 5 will replace the trivial "browser
  // download" save with the SaveModal flow (project-library record,
  // thumbnail capture, name field). Until then this keeps v3 unblocked
  // for round-trip testing.
  registerOperator({
    id: 'file.save',
    label: 'Save Project (.stretch)',
    exec: async () => {
      try {
        const project = useProjectStore.getState().project;
        const blob = await serializeProject(project);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `project-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.stretch`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so Safari has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        useProjectStore.setState({ hasUnsavedChanges: false });
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[file.save] failed:', err);
      }
    },
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

  // Load textures from a project's texture entries into HTMLImageElements.
  // Mirrors the v2 ExportModal pattern. Helper exists here rather than in
  // ExportService because services should stay browser-DOM-free where
  // possible (PersistenceService loads zip blobs, but exports require
  // images on the actual <img> code path).
  /** @returns {Promise<Map<string, HTMLImageElement>>} */
  async function loadProjectTextures(project) {
    /** @type {Map<string, HTMLImageElement>} */
    const images = new Map();
    for (const tex of project?.textures ?? []) {
      if (!tex?.source) continue;
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images.set(tex.id, img); resolve(undefined); };
        img.onerror = (err) => reject(err);
        img.src = tex.source;
      });
    }
    return images;
  }

  /** Trigger a download from a Blob. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Export the model. Default format is 'live2d-full' (cmo3 + rig +
  // physics + motions, the most useful for round-trip in Cubism
  // Editor). Phase 5 will surface the format choice (cmo3 vs runtime
  // moc3 zip) through a proper export dialog; for now Ctrl+E gives
  // the user the editable cmo3 path which is what they want during
  // iteration.
  registerOperator({
    id: 'file.export',
    label: 'Export Live2D',
    available: () => {
      const partCount = (useProjectStore.getState().project.nodes ?? [])
        .filter((n) => n?.type === 'part').length;
      return partCount > 0;
    },
    exec: async () => {
      try {
        const project = useProjectStore.getState().project;
        const images = await loadProjectTextures(project);
        const res = await runExport({
          format: 'live2d-full',
          images,
          extra: { generateRig: true },
        });
        if (!res.ok || !res.blob) {
          if (typeof console !== 'undefined') console.error('[file.export] failed:', res.error);
          return;
        }
        const baseName = (project.name || 'model').trim() || 'model';
        const isZip = res.blob.type === 'application/zip'
          || res.blob.type === 'application/x-zip-compressed';
        const ext = isZip ? '_live2d.zip' : '.cmo3';
        downloadBlob(res.blob, baseName + ext);
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[file.export] threw:', err);
      }
    },
  });

  registerOperator({
    id: 'file.load',
    label: 'Load Project (.stretch)',
    exec: () => {
      // Programmatic file picker: must run in a user-gesture call
      // stack to be allowed. The operator dispatcher fires from a
      // keydown listener, which qualifies. Toolbar buttons that call
      // this operator also qualify (button click is a user gesture).
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.stretch,.zip';
      input.style.display = 'none';
      input.onchange = async (e) => {
        const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        try {
          const data = await deserializeProject(file);
          useProjectStore.getState().loadProject(data);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[file.load] failed:', err);
        }
      };
      document.body.appendChild(input);
      input.click();
    },
  });
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
