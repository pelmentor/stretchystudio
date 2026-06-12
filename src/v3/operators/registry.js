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

import { useUIV3Store, getEditorMode } from '../../store/uiV3Store.js';
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
import { useCaptureStore } from '../../store/captureStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { useNewProjectDialogStore } from '../../store/newProjectDialogStore.js';
import { useBoxSelectStore } from '../../store/boxSelectStore.js';
import { useCircleSelectStore } from '../../store/circleSelectStore.js';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useSubdivideStore } from '../../store/subdivideStore.js';
import { mergeAtCenter, mergeAtCursor, mergeAtFirst, mergeAtLast, mergeByDistance, mergeCollapse } from './edit/merge.js';
import { dissolveVertices } from './edit/dissolve.js';
import { deleteVertices } from './edit/deleteVerts.js';
import { cutMeshAlongLine } from './edit/knife.js';
import { subdivide } from './edit/subdivide.js';
import { extrude, countSelectedBoundary } from './edit/extrude.js';
import { autoSkinAllParts } from '../../io/live2d/rig/autoSkinning.js';
import { applyBakePhysics } from './bakePhysics.js';
import { getActiveSceneAction } from '../../anim/sceneAction.js';
import { logger } from '../../lib/logger.js';

/** Dedupe signature for the transform.rotate diagnostic. Spamming R
 *  should log once per distinct selection shape, not every press. */
let _lastTransformRotateSig = null;
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
// Animation Phase 7 Slice 7.C -- Insert Keyframe operators (I-key
// menu + per-set apply). Eager-import per the same async-leak rule
// as 7.A/B/C above (the dispatcher fires `op.exec(...)` without await).
import { registerInsertKeyOperators } from './insertKey.js';
import { duplicate } from './edit/duplicate.js';
import {
  selectLinkedFromVertex,
  selectLinkedExpandSelection,
} from './select/linked.js';
import { applyTopologyOp } from './edit/applyTopologyOp.js';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
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

const WORKSPACE_IDS = ['layout', 'modeling', 'rigging', 'weightPaint', 'sculpt', 'animation'];

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

  // F-2 sweep — Ctrl+PageUp / Ctrl+PageDown workspace cycle
  // (Blender's `screen.workspace_cycle`, `blender_default.py:823-825`).
  // Wraps both directions.
  registerOperator({
    id: 'workspace.cycle.next',
    label: 'Next workspace',
    exec: () => {
      const cur = useUIV3Store.getState().activeWorkspace;
      const idx = WORKSPACE_IDS.indexOf(cur);
      const next = WORKSPACE_IDS[(idx + 1 + WORKSPACE_IDS.length) % WORKSPACE_IDS.length];
      useUIV3Store.getState().setWorkspace(next);
    },
  });
  registerOperator({
    id: 'workspace.cycle.prev',
    label: 'Previous workspace',
    exec: () => {
      const cur = useUIV3Store.getState().activeWorkspace;
      const idx = WORKSPACE_IDS.indexOf(cur);
      const prev = WORKSPACE_IDS[(idx - 1 + WORKSPACE_IDS.length) % WORKSPACE_IDS.length];
      useUIV3Store.getState().setWorkspace(prev);
    },
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

  // Timeline play / pause. Mirrors Blender's `screen.animation_play`
  // (the default Spacebar action in the "Blender" keymap preset). Bare
  // Space toggles playback from anywhere — the dispatcher already skips
  // editable targets, so it won't fire while typing in a field. Selects
  // the first action as active when one exists but none is active yet, so
  // the playhead has something to drive; never auto-creates an action
  // (that's the transport "+"/ensureAnimation flow), so Space stays a
  // pure transport toggle.
  registerOperator({
    id: 'anim.play',
    label: 'Play Animation',
    exec: () => {
      const a = useAnimationStore.getState();
      if (a.isPlaying) {
        a.pause();
        return;
      }
      if (!a.activeActionId) {
        const actions = useProjectStore.getState().project?.actions;
        if (Array.isArray(actions) && actions.length > 0 && actions[0]?.id) {
          a.setActiveActionId(actions[0].id);
        }
      }
      a.play();
    },
  });

  // Bake Physics onto the active action. Steps the cubismPhysicsKernel
  // through the action's frame range at fixed dt, sampling the input
  // fcurves (head/body/arm rotations the user authored) and writing the
  // resulting hair/clothing/sway output values back as fresh fcurves on
  // the SAME action. Existing fcurves on the output paramIds are
  // REPLACED (clear + re-emit) so re-baking doesn't double-stack curves;
  // non-output fcurves (the user's input curves) are preserved.
  //
  // After baking, the action is self-contained: PNG sequence / motion3
  // / NLA all see the physics behaviour without needing a live tick.
  // This is the user-facing answer to "physics doesn't auto-key from
  // AutoKey" — instead of a per-frame online capture (which fights the
  // viewport cache + introduces feedback loops), bake offline against
  // the authored animation.
  registerOperator({
    id: 'anim.bakePhysics',
    label: 'Bake Physics onto Active Action',
    available: () => {
      const proj = useProjectStore.getState().project;
      if (!proj) return false;
      const active = getActiveSceneAction(proj, useAnimationStore.getState().activeActionId);
      return !!active;
    },
    exec: () => {
      const proj = useProjectStore.getState().project;
      if (!proj) {
        toast({ title: 'No project', description: 'Open or create a project first.' });
        return;
      }
      const active = getActiveSceneAction(proj, useAnimationStore.getState().activeActionId);
      if (!active) {
        toast({ title: 'No active action', description: 'Select an action to bake into.' });
        return;
      }
      const t0 = Date.now();
      let bakeResult = null;
      useProjectStore.getState().updateProject((p) => {
        bakeResult = applyBakePhysics(p, active.id, {
          frameStartMs: typeof active.frameStart === 'number' ? active.frameStart : 0,
          frameEndMs: typeof active.frameEnd === 'number'
            ? active.frameEnd
            : (typeof active.duration === 'number' ? active.duration : 2000),
          stepMs: 1000 / (typeof active.fps === 'number' && active.fps > 0 ? active.fps : 24),
          preRollMs: 500,
        });
      });
      if (!bakeResult) {
        toast({
          title: 'Bake failed',
          description: 'Could not bake — see Logs panel for details.',
          variant: 'destructive',
        });
        logger.warn('bakePhysics', `applyBakePhysics returned null for actionId=${active.id}`);
        return;
      }
      const r = /** @type {any} */ (bakeResult);
      if (r.ruleCount === 0) {
        toast({
          title: 'Nothing to bake',
          description: 'No physics rules in this project.',
        });
        return;
      }
      const ms = Date.now() - t0;
      logger.info('bakePhysics',
        `Baked ${r.sampleCount} sample(s) × ${r.outputParamIds.length} output(s) `
        + `= ${r.keysWritten} key(s) onto "${active.name ?? active.id}" in ${ms}ms`,
        { actionId: active.id, ...r, durationMs: ms });
      toast({
        title: 'Physics baked',
        description: `${r.keysWritten} keys across ${r.outputParamIds.length} params, ${r.sampleCount} samples.`,
      });
    },
  });

  // File save. Mirrors Blender's `wm.save_mainfile` two-path semantics
  // (`wm_files.cc:5007-5066`): when the project is anchored to an
  // existing library record (`currentLibraryId` set), Ctrl+S runs a
  // SILENT overwrite via `quickSaveLinked()` — no modal pops. When
  // unlinked (fresh project or freshly-loaded from disk), the modal
  // opens for name entry. Audit-fix sweep (FID-A.6) — prior to this
  // the modal always popped, which forced an extra click on every
  // Ctrl+S and broke muscle memory for any user expecting one-keystroke
  // overwrite.
  registerOperator({
    id: 'file.save',
    label: 'Save Project',
    exec: () => {
      const linkedId = useProjectStore.getState().currentLibraryId;
      if (linkedId) {
        // Fire-and-log — quickSaveLinked owns the projectSave timer
        // shape, so we don't await (lets the keystroke return
        // immediately). Errors are surfaced via the logger.warn inside
        // saveLibraryRecord's catch; the modal fallback below isn't
        // triggered because a transient IndexedDB failure is the
        // user's problem to retry, not auto-escalate to a name dialog.
        //
        // Returns false when the linked record was deleted out-from-
        // under us by another tab — in that case fall back to the
        // modal so the user can re-save under a new name.
        import('../../services/projectLibrary.js').then(({ quickSaveLinked }) => {
          quickSaveLinked().then((didSave) => {
            if (!didSave) useLibraryDialogStore.getState().openSave();
          }).catch(() => {
            // Logging already happened inside saveLibraryRecord; the
            // user sees a console warn. No modal escalation here.
          });
        });
        return;
      }
      useLibraryDialogStore.getState().openSave();
    },
  });

  // File Save As — Ctrl+Shift+S (Blender's wm.save_as_mainfile,
  // `space_topbar.py:176`). Opens the same Save modal but with the
  // `saveAs` flag flipped: name field empty, the save always creates a
  // new library record (ignores any current linkedId). Same overwrite-
  // confirm prompt fires if the typed name collides with an existing
  // record.
  registerOperator({
    id: 'file.saveAs',
    label: 'Save Project As…',
    exec: () => useLibraryDialogStore.getState().openSaveAs(),
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
        // B-2 (R4) — use getMesh so post-v18 parts (geometry on a
        // sibling meshData node) get the right vertex count. Pre-fix
        // KeyA in Edit Mode was a silent no-op on every part.
        const mesh = getMesh(node, project);
        const vertCount = Array.isArray(mesh?.vertices) ? mesh.vertices.length : 0;
        if (vertCount === 0) return;
        const cur = editor.selectedVertexIndices.get(activePartId);
        if (cur && cur.size > 0) {
          editor.deselectAllVertices(activePartId);
        } else {
          editor.selectAllVertices(activePartId, vertCount);
        }
        return;
      }
      // Phase 4 paint-fidelity follow-up — Pose Mode bone-scoped A.
      // Blender's pose_mode_keymap binds A to `pose.select_all` which
      // toggles every bone in the armature. SS pre-fix fell through to
      // the Object Mode branch below, which (a) cleared bone selection
      // if anything was selected, then (b) on next press selected all
      // PARTS in the project instead of bones — both wrong for Pose Mode.
      // Now: if any bone is selected → clear; else → select all visible
      // bone groups.
      if (editor.editMode === 'pose') {
        const project = useProjectStore.getState().project;
        const boneIds = (project?.nodes ?? [])
          .filter((n) => n && n.type === 'group'
            && typeof n.boneRole === 'string' && n.boneRole.length > 0
            && n.visible !== false)
          .map((n) => n.id);
        if (boneIds.length === 0) return;
        const sel = useSelectionStore.getState();
        const selectedBones = sel.items.filter((it) =>
          it?.type === 'group' && boneIds.includes(it.id));
        if (selectedBones.length > 0) {
          // Some bones selected → deselect. Mirror Blender's "first
          // press of A clears if any selected, second press selects all."
          sel.clear();
          useEditorStore.getState().setSelection([]);
          return;
        }
        sel.select(boneIds.map((id) => ({ type: 'group', id })), 'replace');
        // Legacy slot — active head is the last bone (matches the Object
        // Mode branch convention).
        useEditorStore.getState().setSelection([boneIds[boneIds.length - 1]]);
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
      // Phase 4 paint-fidelity follow-up — Pose Mode bone-scoped Alt+A.
      // Mirrors Blender's `pose.select_all(action='DESELECT')`. In Pose
      // Mode this should ONLY clear bone selection — leaving Object
      // selection alone matters if a user had selected an armature root
      // then entered Pose Mode (the armature stays selected as the
      // active object, and Alt+A only nukes per-bone selection within).
      // SS's selectionStore is unified, so distinguishing "bone vs
      // part" selection inside requires filtering — clear only group
      // items with a boneRole.
      if (editor.editMode === 'pose') {
        const project = useProjectStore.getState().project;
        const isBone = (it) => {
          if (it?.type !== 'group') return false;
          const node = project?.nodes?.find((n) => n?.id === it.id);
          return !!node && typeof node.boneRole === 'string' && node.boneRole.length > 0;
        };
        const sel = useSelectionStore.getState();
        const nonBoneItems = sel.items.filter((it) => !isBone(it));
        if (nonBoneItems.length === sel.items.length) return; // nothing bone-y selected
        sel.select(nonBoneItems, 'replace');
        editor.setSelection(nonBoneItems.length > 0
          ? [nonBoneItems[nonBoneItems.length - 1].id]
          : []);
        return;
      }
      const sel = useSelectionStore.getState();
      if (sel.items.length === 0 && (editor.selection?.length ?? 0) === 0) return;
      sel.clear();
      editor.setSelection([]);
    },
  });

  // Phase 4 paint-fidelity follow-up — Ctrl+I invert selection.
  // Polymorphic by mode (Blender's same-chord-different-target
  // pattern):
  //
  //   - Edit Mode + select tool → `mesh.select_all(action='INVERT')`.
  //     Active vertex stays if still selected, else clears.
  //   - Pose Mode → `pose.select_all(action='INVERT')` scoped to
  //     visible bones in the project. Non-bone items (parts, armature
  //     roots) untouched.
  //   - Object Mode → `object.select_all(action='INVERT')` over
  //     visible parts. Non-part items untouched.
  //
  // The polymorphism mirrors selection.selectAllToggle's structure —
  // each mode reads its canonical selection store + writes back the
  // complement.
  registerOperator({
    id: 'selection.invert',
    label: 'Invert Selection',
    exec: () => {
      const editor = useEditorStore.getState();
      if (editor.editMode === 'edit' && editor.toolMode === 'select') {
        const activePartId = editor.selection?.[0];
        if (typeof activePartId !== 'string' || activePartId.length === 0) return;
        const project = useProjectStore.getState().project;
        const node = project?.nodes?.find((n) => n?.id === activePartId);
        if (!node || node.type !== 'part') return;
        const mesh = getMesh(node, project);
        const vertCount = Array.isArray(mesh?.vertices) ? mesh.vertices.length : 0;
        if (vertCount === 0) return;
        editor.invertVertexSelection(activePartId, vertCount);
        return;
      }
      if (editor.editMode === 'pose') {
        const project = useProjectStore.getState().project;
        const boneIds = (project?.nodes ?? [])
          .filter((n) => n && n.type === 'group'
            && typeof n.boneRole === 'string' && n.boneRole.length > 0
            && n.visible !== false)
          .map((n) => n.id);
        if (boneIds.length === 0) return;
        const sel = useSelectionStore.getState();
        const selectedBoneIds = new Set(
          sel.items.filter((it) => it?.type === 'group' && boneIds.includes(it.id))
            .map((it) => it.id),
        );
        const nonBoneItems = sel.items.filter((it) =>
          !(it?.type === 'group' && boneIds.includes(it.id)));
        const invertedBoneItems = boneIds
          .filter((id) => !selectedBoneIds.has(id))
          .map((id) => ({ type: 'group', id }));
        const finalItems = [...nonBoneItems, ...invertedBoneItems];
        sel.select(finalItems, 'replace');
        useEditorStore.getState().setSelection(finalItems.length > 0
          ? [finalItems[finalItems.length - 1].id]
          : []);
        return;
      }
      // Object Mode (or any non-edit non-pose) — invert visible parts.
      const project = useProjectStore.getState().project;
      const partIds = (project?.nodes ?? [])
        .filter((n) => n?.type === 'part' && n.visible !== false)
        .map((n) => n.id);
      if (partIds.length === 0) return;
      const sel = useSelectionStore.getState();
      const selectedPartIds = new Set(
        sel.items.filter((it) => it?.type === 'part' && partIds.includes(it.id))
          .map((it) => it.id),
      );
      const nonPartItems = sel.items.filter((it) =>
        !(it?.type === 'part' && partIds.includes(it.id)));
      const invertedPartItems = partIds
        .filter((id) => !selectedPartIds.has(id))
        .map((id) => ({ type: 'part', id }));
      const finalItems = [...nonPartItems, ...invertedPartItems];
      sel.select(finalItems, 'replace');
      useEditorStore.getState().setSelection(finalItems.length > 0
        ? [finalItems[finalItems.length - 1].id]
        : []);
    },
  });

  // Delete the active selection. Polymorphic by mode (Blender's X
  // pattern — same chord, different operator per workspace mode):
  //
  //   - Edit Mode with vertex selection → drop verts + incident tris
  //     via `deleteVertices` topology op (routes through `applyTopologyOp`
  //     so the rig-refit-on-exit toast fires same as other topology
  //     ops). Standalone `edit.deleteVerts` op below is the same
  //     payload exposed for the command palette + menus.
  //   - Object Mode with part/group selection → delete those nodes
  //     via `useProjectStore.deleteNode`. Selection clears so the empty
  //     Properties pane signals the action succeeded.
  //
  // Deformer / parameter delete is still out-of-scope (needs Phase 2 / 5
  // editor support to keep references coherent).
  registerOperator({
    id: 'selection.delete',
    label: 'Delete Selection',
    available: () => {
      // Edit Mode vertex path takes priority over Object Mode node path.
      const partId = activeEditPart();
      if (partId) {
        const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
        if (sel && sel.size > 0) return true;
      }
      const items = useSelectionStore.getState().items;
      return items.some((it) => it.type === 'part' || it.type === 'group');
    },
    exec: () => {
      const partId = activeEditPart();
      if (partId) {
        const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
        if (sel && sel.size > 0) {
          const project = useProjectStore.getState().project;
          const node = project?.nodes?.find((n) => n.id === partId);
          const mesh = getMesh(node, project);
          if (!mesh) return;
          const result = deleteVertices(mesh, sel);
          if (!result) return;
          applyTopologyOp(partId, result);
          return;
        }
      }
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

  // file.new — opens the New Project template picker (mounts in
  // Topbar.jsx, gated by `newProjectDialogStore.open`). The dialog
  // owns reset + template-apply + dirty-warning UX. The chord
  // (Ctrl+N), command palette, and File menu all route through here
  // so the user always sees the same picker — fixes the pre-existing
  // chord-vs-button asymmetry (chord used to silently `resetProject`
  // and bypass the unsaved-changes warning).
  registerOperator({
    id: 'file.new',
    label: 'New Project',
    exec: () => useNewProjectDialogStore.getState().openDialog(),
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

  // Import PSD. Spawns a transient `<input type="file" accept=".psd">`
  // element, parses the chosen file, then routes either to the wizard
  // (character-format PSDs — `detectCharacterFormat` true) or directly
  // to `finalizePsdImport` (plain PSDs without skeleton tags). Mirrors
  // the empty-canvas drop-zone code path in CanvasViewport's
  // `processPsdFile` callback so the two entrypoints stay in sync.
  //
  // Available only when CanvasViewport has published its
  // `finalizePsdImport` callback to captureStore — without that, the
  // non-character path can't run. The character path doesn't strictly
  // need it (PsdImportService.start drives the wizard) but we gate
  // both branches uniformly to avoid surprising the user with a half-
  // working menu entry.
  registerOperator({
    id: 'file.importPsd',
    label: 'Import PSD…',
    available: () => typeof useCaptureStore.getState().finalizePsdImport === 'function',
    exec: () => {
      if (typeof document === 'undefined') return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.psd';
      input.style.display = 'none';
      document.body.appendChild(input);

      // Audit-fix sweep — the prior implementation only removed the
      // input from the DOM inside the change handler, so a user who
      // opened the picker then cancelled left an orphan `<input>`
      // mounted forever (browsers don't fire `change` on cancel).
      // Each subsequent invocation leaked another node.
      //
      // Cleanup now runs from THREE paths:
      //   1. change   — the picked-a-file happy path
      //   2. cancel   — modern Chromium fires this when the user
      //                 dismisses the OS picker (Chrome 113+ / Edge /
      //                 Brave; safe-no-op elsewhere)
      //   3. window.focus fallback — fires when the browser regains
      //                 focus after the picker closes. We schedule a
      //                 setTimeout(0) so a same-tick `change` event
      //                 wins (its handler removes the input first);
      //                 otherwise the focus path catches the cancel
      //                 case in Firefox / Safari that don't fire
      //                 `cancel`.
      let cleaned = false;
      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        window.removeEventListener('focus', onFocus, true);
        if (input.parentNode) input.parentNode.removeChild(input);
      }
      function onFocus() {
        // Defer so a same-tick `change` event wins and removes the
        // input via its own handler; we only run if no file was
        // picked.
        setTimeout(() => {
          if (!cleaned && (!input.files || input.files.length === 0)) cleanup();
        }, 0);
      }
      window.addEventListener('focus', onFocus, true);
      input.addEventListener('cancel', cleanup, { once: true });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) return;
        try {
          const buffer = await file.arrayBuffer();
          const [{ importPsd }, { detectCharacterFormat }, { uid }] = await Promise.all([
            import('../../io/psd.js'),
            import('../../io/armatureMeta.js'),
            import('../../lib/ids.js'),
          ]);
          const parsed = await importPsd(buffer);
          const { width: psdW, height: psdH, layers } = parsed;
          if (!Array.isArray(layers) || layers.length === 0) return;
          const partIds = layers.map(() => uid());
          if (detectCharacterFormat(layers)) {
            const { start } = await import('../../services/PsdImportService.js');
            start({ psdW, psdH, layers, partIds });
          } else {
            const fpi = useCaptureStore.getState().finalizePsdImport;
            if (fpi) await fpi(psdW, psdH, layers, partIds, [], null);
          }
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[file.importPsd]', err);
        }
      }, { once: true });
      input.click();
    },
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
    /** Canvas-space anchor per target (bones → world joint, others →
     *  world transform.x/y), collected so the pivot mode can pick median
     *  / bbox / active without a second pass. */
    const anchors = [];
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
      // Anchor: for bones, the world-space joint (where it sits on
      // canvas); for non-bones, the world-mapped transform.x/y — routed
      // through the world matrix so nested non-bones are correct too.
      const wm = worldMap.get(id);
      if (wm) {
        const isBone = node.type === 'group' && !!node.boneRole;
        const px = isBone ? (node.transform?.pivotX ?? 0) : (node.transform?.x ?? 0);
        const py = isBone ? (node.transform?.pivotY ?? 0) : (node.transform?.y ?? 0);
        anchors.push({ id, x: wm[0] * px + wm[3] * py + wm[6], y: wm[1] * px + wm[4] * py + wm[7] });
      }
    }
    if (original.size === 0) return;

    // Rotate/scale pivot per the active Transform Pivot Point preference
    // (`v3/transformPivot.js`). In Object Mode the pivot maps mouse
    // motion to the rotation angle / scale magnitude (each part still
    // spins about its own origin — ModalTransformOverlay never orbits
    // positions), so the modes differ in feel rather than final layout;
    // the same datum logic is shared with the vertex path for
    // consistency. Median is the centroid + the fallback for a modeless
    // datum (cursor unset / no anchors).
    const pivotMode = usePreferencesStore.getState().transformPivot;
    let mx = 0, my = 0;
    for (const a of anchors) { mx += a.x; my += a.y; }
    const nAnchors = anchors.length || 1;
    let pivotX = mx / nAnchors, pivotY = my / nAnchors;
    if (anchors.length > 0) {
      if (pivotMode === 'BOUNDING_BOX_CENTER') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const a of anchors) {
          if (a.x < minX) minX = a.x;
          if (a.x > maxX) maxX = a.x;
          if (a.y < minY) minY = a.y;
          if (a.y > maxY) maxY = a.y;
        }
        pivotX = (minX + maxX) / 2;
        pivotY = (minY + maxY) / 2;
      } else if (pivotMode === 'CURSOR') {
        const c = project.cursor;
        if (c && typeof c.x === 'number') { pivotX = c.x; pivotY = c.y; }
      } else if (pivotMode === 'ACTIVE_ELEMENT') {
        // Active = selection head (targetIds[0]); falls back to the first
        // resolvable anchor when the head had no world matrix.
        const head = anchors.find((a) => a.id === targetIds[0]) ?? anchors[0];
        pivotX = head.x;
        pivotY = head.y;
      }
    }

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

  /**
   * Edit-Mode vertex G/R/S. In Edit Mode the transform operators act on
   * the SELECTED VERTICES of the active part (Blender's editmesh G/R/S),
   * not the part's object transform — so they hand off to the
   * vertex-level `ModalVertexTransformOverlay` instead of
   * `beginModalTransform`. Rotate/scale pivot is the median of the
   * selected verts (Blender's default "Median Point" pivot).
   *
   * Returns true when the gesture was consumed (i.e. we ARE in Edit
   * Mode) — even on a no-op (no verts selected) — so the caller does NOT
   * fall through to the object-mode transform, which would wrongly move
   * the whole part. Returns false only outside Edit Mode.
   *
   * @param {'translate'|'rotate'|'scale'} kind
   * @returns {boolean}
   */
  function beginVertexModalTransform(kind) {
    const editor = useEditorStore.getState();
    if (editor.editMode !== 'edit') return false;
    const partId = editor.selection?.[0];
    if (typeof partId !== 'string' || partId.length === 0) return true;
    const selSet = editor.selectedVertexIndices?.get(partId);
    if (!selSet || selSet.size === 0) {
      toast({ description: 'No vertices selected', duration: 1500 });
      return true;
    }
    const project = useProjectStore.getState().project;
    const node = project?.nodes?.find((n) => n?.id === partId);
    const mesh = node ? getMesh(node, project) : null;
    if (!mesh || !Array.isArray(mesh.vertices)) return true;

    /** @type {Map<number, {x:number,y:number,restX:number,restY:number}>} */
    const original = new Map();
    let cx = 0, cy = 0, n = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const idx of selSet) {
      const v = mesh.vertices[idx];
      if (!v) continue;
      original.set(idx, { x: v.x, y: v.y, restX: v.restX ?? v.x, restY: v.restY ?? v.y });
      cx += v.x; cy += v.y; n += 1;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    if (n === 0) return true;

    // Rotate/scale pivot per the active Transform Pivot Point preference
    // (Blender's VIEW3D_HT_header pivot dropdown — `v3/transformPivot.js`).
    // Median = centroid of the selected verts (Blender default); bounding
    // box = AABB centre; cursor = the 2D cursor; active = the active
    // (last-clicked) vertex. Each falls back to the median when its datum
    // is absent (cursor unset / active vertex not in this selection). All
    // points are canvas-px — the same space the verts + cursor live in.
    const pivotMode = usePreferencesStore.getState().transformPivot;
    const median = { x: cx / n, y: cy / n };
    let pivotCanvas = median;
    if (pivotMode === 'BOUNDING_BOX_CENTER') {
      pivotCanvas = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    } else if (pivotMode === 'CURSOR') {
      const c = project.cursor;
      pivotCanvas = (c && typeof c.x === 'number') ? { x: c.x, y: c.y } : median;
    } else if (pivotMode === 'ACTIVE_ELEMENT') {
      const av = editor.activeVertex;
      const avVert = (av && av.partId === partId && selSet.has(av.vertIndex))
        ? mesh.vertices[av.vertIndex]
        : null;
      pivotCanvas = avVert ? { x: avVert.x, y: avVert.y } : median;
    }

    // One undo entry for the whole modal session; the overlay closes the
    // batch on commit and `discardBatch`-rolls-back on Esc (clean cancel,
    // no redo/undo pollution — same path the extrude→translate flow uses).
    // The edited part renders camera-only during the edit (CanvasViewport
    // PP1-008 keeps its rig-driven flag) and its `mesh.vertices` are
    // canvas-px, so the pivot + deltas stay in canvas space — no
    // inverse-world mapping needed.
    beginBatch(project);
    useModalVertexTransformStore.getState().begin({
      kind,
      partId,
      startMouse: lastMousePos(),
      pivotCanvas,
      original,
      vertIndices: new Set(selSet),
      rollbackOnCancel: true,
    });
    return true;
  }

  registerOperator({
    id: 'transform.translate',
    label: 'Grab / Move (G)',
    available: () => useEditorStore.getState().editMode === 'edit'
      || useSelectionStore.getState().items.some(
        (it) => it.type === 'part' || it.type === 'group',
      ),
    exec: () => { if (!beginVertexModalTransform('translate')) beginModalTransform('translate'); },
  });

  // Edit mode toggle. Tab — Blender's universal "enter / exit edit
  // mode" gesture. Selection-driven: a meshed part enters mesh edit, a
  // bone-role group enters pose mode. Already in edit mode → exits.
  // Workspace does NOT gate this (matches Blender — workspace is
  // layout-only). BlendShape edit needs to know which shape, so it's
  // NOT bound here; user enters from BlendShapeTab's Edit button.
  //
  // Ctrl+Tab — INTENTIONAL DEVIATION from Blender per user request
  // (2026-06-04 audit fix). Blender's `Ctrl+Tab` binds to
  // `view3d.object_mode_pie_or_toggle` (a PIE menu showing
  // Object/Edit/Pose for armatures — the user picks). SS chose
  // armature-direct Pose toggle because:
  //   (a) SS has no pie-menu infra (RULE-№2: don't ship one just for
  //       this chord),
  //   (b) The user explicitly asked for "ctrl+tab → pose when armature
  //       selected" muscle memory.
  // Non-armature selections still fall back to the ModePill mode menu.
  // Calling this "Blender pattern" without qualification would mislead
  // future readers — Blender actually shows a pie menu for every type
  // including armatures. The audit (2026-06-04) caught the prior
  // attribution; this comment corrects it.
  registerOperator({
    id: 'mode.menu',
    label: 'Pose Mode / Mode Menu (Ctrl+Tab)',
    available: () => true,
    exec: () => {
      // Armature-direct path — Ctrl+Tab on an armature/bone selection
      // toggles Pose Mode directly (see header for why this deviates
      // from Blender's pie). If already in Pose Mode on this armature,
      // exit back to Object Mode; if in a different edit mode (e.g.
      // mesh edit), still switch to Pose; otherwise enter Pose.
      const ed = useEditorStore.getState();
      const active = useSelectionStore.getState().getActive();
      if (active) {
        const project = useProjectStore.getState().project;
        const node = project?.nodes?.find((n) => n.id === active.id);
        if (node) {
          const dataKind = getDataKind(node, project);
          if (dataKind === 'armature' && modeCompatTest(dataKind, MODE_POSE)) {
            if (ed.editMode === MODE_POSE) {
              ed.exitEditMode();
              return;
            }
            if (!ed.viewLayers.skeleton) ed.setViewLayers({ skeleton: true });
            useEditorStore.getState().setSelection([active.id]);
            ed.enterEditMode(MODE_POSE);
            return;
          }
        }
      }
      // Fallback for non-armature selections — pop the ModePill mode
      // menu so the user can still pick a mode. If the pill isn't
      // mounted (non-viewport tab) the flag is a harmless no-op.
      useUIV3Store.getState().setModeMenuOpen(true);
    },
  });
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
      } else if (modeCompatTest(dataKind, MODE_WEIGHT_PAINT)) {
        // V4 Phase 4b — Tab on a meshed part where the Edit branch
        // above was rejected (no mesh data yet). 2026-06-11: the
        // weights-presence gate was dropped here too so unweighted
        // parts can still reach Weight Paint via Tab; the inner
        // `ensureWeightGroupsForPart` action auto-binds to the
        // nearest bone via the closest-bone heuristic, so the user
        // doesn't need to manually bind first. Matches Blender's
        // "Parent → Armature Deform with Automatic Weights" semantic.
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
    available: () => useEditorStore.getState().editMode === 'edit'
      || useSelectionStore.getState().items.some(
        (it) => it.type === 'part' || it.type === 'group',
      ),
    exec: () => {
      // 2026-06-10 diagnostic — user report "R on a bone doesn't
      // rotate the skeleton at all, only the visual gizmo works".
      // Log the state every R-key invocation so the failure mode
      // is one log line away. Deduped by selection-shape signature
      // so spamming R doesn't flood.
      const _ed = useEditorStore.getState();
      const _sel = useSelectionStore.getState().items;
      const _sig = `${_ed.editMode ?? 'object'}|${_sel.map((it) => `${it?.type}:${it?.id}`).join(',')}`;
      if (_sig !== _lastTransformRotateSig) {
        _lastTransformRotateSig = _sig;
        const proj = useProjectStore.getState().project;
        const targets = _sel
          .filter((it) => it?.type === 'part' || it?.type === 'group')
          .map((it) => {
            const node = proj?.nodes?.find((n) => n?.id === it.id);
            return {
              id: it.id,
              type: it.type,
              isBone: node ? (node.type === 'group' && typeof node.boneRole === 'string') : null,
              boneRole: node?.boneRole ?? null,
              name: node?.name ?? null,
            };
          });
        logger.info('transformRotate',
          `R-key: editMode=${_ed.editMode ?? 'object'}, ${targets.length} target(s)`,
          {
            editMode: _ed.editMode ?? 'object',
            selectionItems: _sel.length,
            targets,
            editorStoreSelection: _ed.selection,
            hint: targets.length === 0
              ? (_ed.selection?.length > 0
                ? 'editorStore.selection has ids but selectionStore.items has no part/group entries — selection is split between stores. selectBoneInBothStores fixes this; verify the click path.'
                : 'No part/group selected. Click a bone in pose mode first.')
              : 'Selection looks correct — modal should engage on the next pointer move.',
          });
      }
      if (!beginVertexModalTransform('rotate')) beginModalTransform('rotate');
    },
  });
  registerOperator({
    id: 'transform.scale',
    label: 'Scale (S)',
    available: () => useEditorStore.getState().editMode === 'edit'
      || useSelectionStore.getState().items.some(
        (it) => it.type === 'part' || it.type === 'group',
      ),
    exec: () => { if (!beginVertexModalTransform('scale')) beginModalTransform('scale'); },
  });
  // Toolset Phase 1.A — `B` chord opens the modal box-select overlay.
  // The overlay (`BoxSelectOverlay`) owns mouse + key handling until
  // commit / cancel; this operator just seeds the modal store with
  // the captured starting cursor + the mode (object vs edit + active
  // partId, captured at activation so a mode-switch mid-drag doesn't
  // redirect the eventual commit).
  //
  // Hover-gated: only fires when the cursor is over the canvas
  // viewport (`data-editor-type="viewport"`). Blender achieves this via
  // per-space keymaps — its B-key is bound separately in `view3d`,
  // `action`, `time`, `graph`, `nla`, etc. SS uses a single global
  // dispatcher, so we gate at `available()` time using the
  // `hoveredEditorType()` helper: pressing B over the Timeline /
  // Dopesheet / FCurve / Parameters panels falls through without
  // engaging the viewport box-select (pre-fix it bled through, selecting
  // parts hidden behind those panels — user report 2026-06-10).
  // Selections that live OUTSIDE the canvas (timeline keyframes,
  // dopesheet keyframes) get their own box-select via mouse-drag in
  // those editors — see TimelineEditor's `onTrackAreaPointerDown`.
  registerOperator({
    id: 'selection.boxSelect',
    label: 'Box Select (B)',
    available: () => {
      const t = hoveredEditorType();
      // Null = unannotated area (popovers, app shell margins) — allow
      // through, matches the pre-fix "always available" path for those
      // edge cases. The blockers we care about (timeline / dopesheet /
      // fcurve / nla / parameters / outliner) are all annotated.
      return t === null || t === 'viewport';
    },
    exec: () => {
      const editor = useEditorStore.getState();
      const isEditModeOnPart = editor.editMode === 'edit'
        && typeof editor.selection?.[0] === 'string'
        && editor.selection[0].length > 0;
      // Blender-faithful: `arm()` puts the modal in "waiting for LMB-down"
      // state — no anchor at B-press time. The overlay's onMouseDown
      // handler calls `anchor(client)` on first LMB-down, mirroring
      // Blender's `Gesture Box` modal map (`BEGIN` action fires on
      // LEFTMOUSE PRESS, not on operator invoke; see
      // `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:6265`).
      useBoxSelectStore.getState().arm({
        kind: 'box',
        mode: isEditModeOnPart ? 'edit' : 'object',
        editPartId: isEditModeOnPart ? editor.selection[0] : null,
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

  /** Returns the meshed-part id we should operate on, or null.
   *  Reads geometry via `getMesh(node, project)` so post-v18 parts
   *  (geometry on a sibling `meshData` node via `node.dataId`, not
   *  inline `node.mesh`) resolve. Pre-fix (R4 cascade miss 2026-06-04)
   *  every Edit-Mode topology operator silently no-op'd on v18 projects
   *  because the `!node.mesh` check was true for every post-migration
   *  part — Delete / X / M / K / E / Ctrl+X / L all dropped to no-ops
   *  the moment the user loaded a saved project. */
  function activeEditPart() {
    const editor = useEditorStore.getState();
    if (editor.editMode !== 'edit') return null;
    const partId = editor.selection?.[0];
    if (typeof partId !== 'string' || partId.length === 0) return null;
    const project = useProjectStore.getState().project;
    const node = project?.nodes?.find((n) => n.id === partId);
    if (!node || node.type !== 'part') return null;
    if (!getMesh(node, project)) return null;
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
    const mesh = getMesh(node, project);
    if (!mesh) return;
    const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
    if (!sel || sel.size === 0) return;
    const result = variantFn(mesh, sel);
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
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const adj = buildVertexAdjacency(
        mesh.triangles.flat(),
        mesh.vertices.length,
      );
      runMergeVariant((m, sel) => mergeCollapse(m, sel, adj));
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
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const result = dissolveVertices(mesh, sel);
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

  // Delete Vertices — Blender's `MESH_OT_delete` (type='VERTS') branch
  // of the X-menu. Drops verts + every triangle incident to any of them
  // and leaves holes. Bare X / Delete / Backspace route here in Edit
  // Mode via `selection.delete`'s polymorphic dispatch; this standalone
  // op is exposed for the command palette + future X-menu UI.
  registerOperator({
    id: 'edit.deleteVerts',
    label: 'Delete Vertices (X)',
    available: () => topologyAvailable(1),
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const result = deleteVertices(mesh, sel);
      if (!result) {
        toast({
          title: 'Cannot delete vertices',
          description: 'Selection would leave fewer than 3 vertices, or every triangle is incident to a deletion.',
        });
        return;
      }
      applyTopologyOp(partId, result);
    },
  });

  // Knife — straight-line cut between two selected vertices. Every
  // triangle the cut line crosses is subdivided; new verts are
  // allocated at each edge intersection (UVs linearly interpolated;
  // adjacent triangles share the intersection vert so the mesh doesn't
  // tear). v1 requires the user to pre-select exactly 2 verts; the
  // interactive click-A-then-click-B modal is a follow-up slice
  // (mirrors how Merge — At Cursor pre-shipped the variant before the
  // popover UI).
  //
  // Blender chord parity: `KeyK` = `MESH_OT_knife_tool` (interactive
  // modal in Blender — `editmesh_knife.cc`). SS v1 fires the direct
  // cut on the current 2-vert selection because we don't have the
  // BVH-snapped modal preview yet.
  registerOperator({
    id: 'edit.knife',
    label: 'Knife (K)',
    available: () => {
      if (!topologyAvailable(2)) return false;
      const partId = activeEditPart();
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      // v1 requires EXACTLY 2 verts — the cut is one straight segment.
      // Multi-segment paths come later.
      return !!sel && sel.size === 2;
    },
    exec: () => {
      const partId = activeEditPart();
      if (!partId) return;
      const project = useProjectStore.getState().project;
      const node = project.nodes.find((n) => n.id === partId);
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size !== 2) return;
      const [a, b] = sel.values();
      const result = cutMeshAlongLine(mesh, a, b);
      if (!result) {
        toast({
          title: 'Cannot knife',
          description: 'The cut line does not cross any interior triangles (vertices may already be edge-adjacent).',
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
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const { cuts, smoothness } = useSubdivideStore.getState();
      const result = subdivide(mesh, sel, { cuts, smoothness });
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
      const mesh = getMesh(node, project);
      if (!mesh) return;
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
      const boundaryCount = countSelectedBoundary(mesh, sel);
      if (boundaryCount === 0) {
        toast({
          title: 'Interior-vert extrude not supported',
          description: 'Live2D meshes need triangles, so wire-edge extrusion (Blender\'s MESH_OT_extrude_verts_indiv) doesn\'t apply. Select a vertex on the mesh\'s outer boundary.',
        });
        return;
      }
      const result = extrude(mesh, sel);
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
      const newMesh = getMesh(newNode, newProject);
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
    const mesh = getMesh(node, project);
    if (!mesh) return;
    const canvasCursor = clientToCanvas(lastMousePos());
    if (!canvasCursor) return;
    const view = useEditorStore.getState().viewByMode?.viewport;
    const zoom = view?.zoom ?? 1;
    const threshold = 16 / zoom;
    const seedIdx = hitTestVertices(mesh.vertices, canvasCursor.x, canvasCursor.y, threshold);
    if (seedIdx < 0) {
      toast({
        title: 'No vertex under cursor',
        description: deselect
          ? 'Hover near a vertex on the active mesh, then press Shift+L.'
          : 'Hover near a vertex on the active mesh, then press L.',
      });
      return;
    }
    const linked = selectLinkedFromVertex(mesh, seedIdx);
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
      const mesh = getMesh(node, project);
      if (!mesh) return;
      const sel = useEditorStore.getState().selectedVertexIndices.get(partId);
      if (!sel || sel.size === 0) return;
      const expanded = selectLinkedExpandSelection(mesh, sel);
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
        const mesh = getMesh(node, project);
        if (!mesh) return;
        const sel = editor.selectedVertexIndices.get(partId);
        if (!sel || sel.size === 0) return;
        const result = duplicate(mesh, sel);
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
        const newMesh = getMesh(newNode, newProject);
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
      // Animation mode guard. The legacy UI button (ViewportHeader.jsx:233,
      // formerly CanvasViewport.jsx:3531) reads `editorMode` from
      // `useUIV3Store(selectEditorMode)`, which IS 'animation' when the
      // Animation workspace is active. The Phase 6 G-2 audit-fix intended
      // to copy that guard onto the operator but wrote
      // `useEditorStore.getState().editMode === 'animation'` — that store's
      // `editMode` slot is `'edit'` / `'pose'` / `'sculpt'` / `'weightPaint'`,
      // NEVER `'animation'` (animation is a workspace concept on uiV3Store,
      // not an editor mode on editorStore). So the guard was always-false
      // and the silent data-loss vector remained open from the default
      // keymap. Fixed 2026-06-12 to read the workspace-derived editorMode
      // via `getEditorMode()`.
      if (getEditorMode() === 'animation') return false;
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
  //
  // 2026-06-12 — same hoveredEditorType() gate as selection.boxSelect.
  // Pre-fix `available: () => true` let C-key bleed through to non-
  // viewport editors (Timeline / Dopesheet / FCurve / Parameters /
  // Outliner). Pressing C over the Dopesheet would engage circle-select
  // on the WRONG canvas and trap input until cancelled — same class as
  // the B-key bleed bug that was fixed earlier. Missed in the original
  // hover-gate sweep because boxSelect had a user-visible repro and
  // circleSelect didn't (C is less-used and the bug was silent).
  registerOperator({
    id: 'selection.circleSelect',
    label: 'Circle Select (C)',
    available: () => {
      const t = hoveredEditorType();
      // Null = unannotated area (popovers, app shell margins) — allow
      // through, mirrors box-select's null-allow behavior.
      return t === null || t === 'viewport';
    },
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
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0
      || objectSnap.editVertexSelection() !== null,
    exec: () => objectSnap.snapSelectionToCursor(),
  });
  registerOperator({
    id: 'object.snap.selectionToCursorKeepOffset',
    label: 'Selection to Cursor (Keep Offset)',
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0
      || objectSnap.editVertexSelection() !== null,
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
    available: () => objectSnap.eligibleSelection().nodeIds.length > 0
      || objectSnap.editVertexSelection() !== null,
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

  // Rig — Auto-Skin Unwired Bones. Explicit user-triggered pass
  // (2026-06-10 Kora bug fix follow-up). Walks every meshed part and
  // assigns rigid `[1, 1, …]` LBS weights + `jointBoneId` to the
  // spatially-nearest bone IF the part has no existing skinning
  // binding AND no bone-group ancestor in `node.parent` chain. See
  // `src/io/live2d/rig/autoSkinning.js` for the heuristic + the three
  // skip predicates. Pre-fix the PSD-import wizard only wired the
  // four limb blend zones (elbow/knee) — every other bone (shoulder,
  // head, neck, torso, eyes) had zero parts pointing at it, so
  // rotating them in pose mode rotated the skeleton overlay but the
  // mesh stayed at rest. Running this operator on an already-imported
  // character closes that gap. Idempotent — re-running is a no-op
  // (every part already has weights or a bone ancestor).
  //
  // Not auto-applied via migration (that would silently mutate saved
  // projects — RULE №2). Explicit user trigger only.
  registerOperator({
    id: 'rig.autoSkinUnwiredBones',
    label: 'Auto-Skin Unwired Bones to Nearest Bone',
    available: () => {
      const proj = useProjectStore.getState().project;
      return !!proj && Array.isArray(proj.nodes) && proj.nodes.length > 0;
    },
    exec: () => {
      const store = useProjectStore.getState();
      const proj = store.project;
      if (!proj) {
        toast({
          title: 'Auto-Skin Unwired Bones',
          description: 'No project loaded.',
        });
        return;
      }
      /** @type {{partsScanned: number, partsAssigned: number, byBone: Record<string, number>}} */
      let summary = { partsScanned: 0, partsAssigned: 0, byBone: {} };
      store.updateProject((draft) => {
        summary = autoSkinAllParts(draft);
      });
      if (summary.partsAssigned === 0) {
        toast({
          title: 'Auto-Skin Unwired Bones',
          description: `Nothing to skin — all ${summary.partsScanned} parts already have a binding or a bone ancestor.`,
        });
        return;
      }
      const byBoneEntries = Object.entries(summary.byBone);
      const top = byBoneEntries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([boneId, n]) => {
          const node = (proj.nodes ?? []).find((x) => x?.id === boneId);
          return `${node?.name ?? boneId}: ${n}`;
        })
        .join(', ');
      toast({
        title: 'Auto-Skin Unwired Bones',
        // 2026-06-11 audit-fix I4 — Init Rig now generates
        // ParamRotation_<bone> for EVERY bone with boneRole (paramSpec
        // second pass added in cbce63f), not just bones with weighted
        // meshes. So the param entries already exist post-Init-Rig
        // regardless of whether this operator runs. The remaining
        // benefit of running Init Rig after auto-skin is rebuilding
        // the modifier stacks: synthesizeModifierStacks appends the
        // Armature modifier when a mesh has both jointBoneId AND
        // boneWeights, which is what makes pickBonePostChainComposition
        // return 'lbs'. Without the rebuild, parts stay on the overlay
        // path.
        description: `Skinned ${summary.partsAssigned} of ${summary.partsScanned} parts — ${top}${byBoneEntries.length > 4 ? '…' : ''}. Click Initialize Rig to rebuild the modifier stacks (adds Armature modifier per LBS-bound part).`,
      });
    },
  });

  // Animation Phase 7 Slice 7.C -- Insert Keyframe (I-key menu +
  // per-set apply). Delegates registration to insertKey.js so the
  // wiring lives next to the live-value resolver + applyKeyingSet
  // call site rather than ballooning this registry file further.
  registerInsertKeyOperators(registerOperator, lastMousePos);
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
 * Find the editor type the cursor is currently over by walking up from
 * `document.elementFromPoint(lastMouse)` to the closest ancestor with a
 * `data-editor-type` attribute. Returns `null` when the cursor isn't
 * over any annotated editor (e.g. over a popover, app shell chrome, or
 * an editor that hasn't been tagged yet).
 *
 * Used by chord-fired operators that should only be available when
 * the cursor is over a specific editor — Blender mirrors this via its
 * per-space keymaps (the B-key in the 3D View runs `view3d.select_box`,
 * in the Action Editor runs `action.select_box`, etc.). SS uses a
 * single global dispatcher, so we gate at `available()` time instead
 * of branching keymaps; same end-user behaviour.
 *
 * @returns {string|null}
 */
function hoveredEditorType() {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(_lastMouse.x, _lastMouse.y);
  if (!el) return null;
  const tagged = el.closest('[data-editor-type]');
  if (!tagged) return null;
  return tagged.getAttribute('data-editor-type');
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
