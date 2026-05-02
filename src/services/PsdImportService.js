// @ts-check

/**
 * v3 GAP-001 — PSD import wizard action service.
 *
 * Centralises the wizard's lifecycle actions (cancel / finalize /
 * reorder / applyRig / skip / complete / back / splitParts /
 * updatePsd) that previously lived as nine `useCallback` handlers in
 * `CanvasViewport.jsx`. Lifting them out lets the wizard mount at
 * AppShell level — closer to other modal/banner chrome — and the
 * canvas only owns its WebGL concerns.
 *
 * Side-effect imperatives that are physically tied to the WebGL
 * context (texture uploads, mesh-worker dispatch) stay in
 * CanvasViewport but are reachable here through `captureStore`'s
 * registered callbacks. CanvasViewport publishes
 * `setFinalizePsdImport` / `setAutoMeshAllParts` on mount; this
 * service reads them off the store at action time.
 *
 * @module services/PsdImportService
 */

import { useWizardStore } from '../store/wizardStore.js';
import { useEditorStore } from '../store/editorStore.js';
import { useProjectStore } from '../store/projectStore.js';
import { useSelectionStore } from '../store/selectionStore.js';
import { useCaptureStore } from '../store/captureStore.js';
import { applySplits } from '../components/canvas/viewport/applySplits.js';
import { findAncestorGroupsForCleanup } from '../components/canvas/viewport/rigGroupCleanup.js';
import { normalizeVariants } from '../io/variantNormalizer.js';
import { uid } from '../lib/ids.js';

/** Default transform for new group nodes. Mirrors CanvasViewport's
 *  `DEFAULT_TRANSFORM` constant — kept in sync. */
const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0, rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

/** Capture the current project as a JSON snapshot (for the wizard's
 *  Back button). Idempotent — only takes one snapshot per wizard run.
 *  Cleared on `complete` / `cancel`. */
function captureSnapshotIfNeeded() {
  const cur = useWizardStore.getState().preImportSnapshot;
  if (cur) return;
  useWizardStore.getState().setPreImportSnapshot(
    JSON.stringify(useProjectStore.getState().project),
  );
}

/** Clear all transient interaction state that the user may have
 *  accumulated during the wizard. Same cleanup BUG-012 added to the
 *  prior in-CanvasViewport handlers. */
function resetInteractionState() {
  useEditorStore.setState({
    selection: [],
    editMode: null,
    activeBlendShapeId: null,
  });
  useSelectionStore.getState().clear();
}

/** Cancel the wizard mid-flight (review step). Drops the pending PSD
 *  without touching the project. */
export function cancel() {
  useWizardStore.getState().reset();
}

/** Finalize PSD import WITH a generated rig (groupDefs + assignments).
 *  Runs the canvas-side `finalizePsdImport` to mutate project.nodes,
 *  then transitions the wizard to the `adjust` step where the user
 *  can drag joints. */
export function finalize(groupDefs, assignments, meshAllParts) {
  const wiz = useWizardStore.getState();
  const psd = wiz.pendingPsd;
  if (!psd) return;
  captureSnapshotIfNeeded();
  const fpi = useCaptureStore.getState().finalizePsdImport;
  if (fpi) fpi(psd.psdW, psd.psdH, psd.layers, psd.partIds, groupDefs, assignments);
  wiz.setMeshAllParts(meshAllParts);
  useEditorStore.getState().setViewLayers({ skeleton: true });
  useEditorStore.getState().enterEditMode('skeleton');
  wiz.setStep('adjust');
}

/** Enter the "reorder" step. Imports the layers as parts (no rig)
 *  so the user can drag-reorder them in the Outliner before joining
 *  the wizard's adjust step. */
export function reorder() {
  const wiz = useWizardStore.getState();
  const psd = wiz.pendingPsd;
  if (!psd) return;
  captureSnapshotIfNeeded();
  const fpi = useCaptureStore.getState().finalizePsdImport;
  if (fpi) fpi(psd.psdW, psd.psdH, psd.layers, psd.partIds, [], null);
  wiz.setStep('reorder');
}

/** Apply a rig to already-imported part nodes (used when the user
 *  reaches reorder → "Auto-rig" without re-importing). Mutates
 *  project.nodes in place: deletes any prior auto-generated groups,
 *  creates new ones, reassigns part parents + draw orders. */
export function applyRig(groupDefs, assignments, meshAllParts) {
  const wiz = useWizardStore.getState();
  const psd = wiz.pendingPsd;
  if (!psd) return;

  useProjectStore.getState().updateProject((proj) => {
    const toDelete = findAncestorGroupsForCleanup(proj.nodes, psd.partIds);
    if (toDelete.size > 0) {
      proj.nodes = proj.nodes.filter((n) => !toDelete.has(n.id));
    }
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
    assignments.forEach((assign, index) => {
      const partId = psd.partIds[index];
      const node = proj.nodes.find((n) => n.id === partId);
      if (node) {
        node.parent = assign.parentGroupId;
        node.draw_order = assign.drawOrder;
      }
    });
    // Variants must stay co-parented + restacked after a rig rewrite.
    normalizeVariants(proj);
  });

  if (groupDefs.length > 0) {
    useEditorStore.getState().setExpandedGroups(groupDefs.map((g) => g.id));
    useEditorStore.getState().setActiveLayerTab('groups');
  }
  wiz.setMeshAllParts(meshAllParts);
  useEditorStore.getState().setViewLayers({ skeleton: true });
  useEditorStore.getState().enterEditMode('skeleton');
  wiz.setStep('adjust');
}

/** Skip rigging entirely — finalize as flat parts and mesh-all if
 *  requested. Wizard closes immediately. */
export function skip(meshAllParts) {
  const wiz = useWizardStore.getState();
  const psd = wiz.pendingPsd;
  if (!psd) return;
  const cs = useCaptureStore.getState();
  if (cs.finalizePsdImport) {
    cs.finalizePsdImport(psd.psdW, psd.psdH, psd.layers, psd.partIds, [], null);
  }
  if (meshAllParts && cs.autoMeshAllParts) {
    // Auto-mesh runs after texture uploads complete; let the
    // finalizePsdImport batch flush before kicking it off.
    setTimeout(() => {
      const fn = useCaptureStore.getState().autoMeshAllParts;
      if (fn) fn();
    }, 100);
  }
  wiz.reset();
  resetInteractionState();
}

/** Complete the wizard from the `adjust` step. Runs auto-mesh-all if
 *  the user opted in earlier. */
export function complete(meshAllParts) {
  const wiz = useWizardStore.getState();
  const useMeshAll = meshAllParts ?? wiz.meshAllParts;
  if (useMeshAll) {
    const fn = useCaptureStore.getState().autoMeshAllParts;
    if (fn) fn();
  }
  wiz.reset();
  resetInteractionState();
}

/** Back from `adjust` → `review`. Rolls the project back to the
 *  pre-finalize snapshot so the user can pick a different rig
 *  approach. */
export function back() {
  const wiz = useWizardStore.getState();
  if (wiz.preImportSnapshot) {
    useProjectStore.setState({
      project: JSON.parse(wiz.preImportSnapshot),
    });
    wiz.setPreImportSnapshot(null);
  }
  useEditorStore.getState().exitEditMode();
  useEditorStore.getState().setViewLayers({ skeleton: false });
  wiz.setStep('review');
}

/** Apply L/R splits to merged layers (computed by the wizard's review
 *  step from `splitLayerLR`). Patches `pendingPsd.layers` +
 *  `pendingPsd.partIds` in place. */
export function splitParts(splits) {
  const wiz = useWizardStore.getState();
  const psd = wiz.pendingPsd;
  if (!psd) return;
  const patched = applySplits(psd.layers, psd.partIds, splits, uid);
  wiz.patchPendingPsd(patched);
}

/** Patch arbitrary fields on the pendingPsd (used by autoRearrange to
 *  reorder eye iris layers above eyewhite). */
export function updatePsd(patch) {
  useWizardStore.getState().patchPendingPsd(patch);
}

/** Open the wizard for a freshly-parsed PSD payload. Called by the
 *  PSD-drop router when `detectCharacterFormat(layers)` is true. */
export function start(pendingPsd) {
  const wiz = useWizardStore.getState();
  wiz.setPendingPsd(pendingPsd);
  wiz.setStep('review');
}
