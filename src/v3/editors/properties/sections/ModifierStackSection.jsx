// @ts-check

/**
 * V2 Phase D-5 — Modifier Stack section.
 *
 * Per-part Properties panel section that mirrors Blender's modifier
 * stack UI (`reference/blender/scripts/startup/bl_ui/properties_data_modifier.py`):
 *
 *   - One row per modifier in `part.modifiers[]`, leaf-first order.
 *   - `enabled` toggle (eye icon equivalent).
 *   - Per-modifier mode chips: REALTIME / RENDER / EDITMODE.
 *   - `synthetic` badge for v21-migration body-warp inserts.
 *   - Reorder (move up / move down) — bumps `tagProjectMutation` so
 *     the depgraph rebuilds the affected stack.
 *
 * Visible when the active node is a part with non-empty `modifiers[]`.
 * Hidden for legacy projects pre-v20 (no modifier stack).
 *
 * @module v3/editors/properties/sections/ModifierStackSection
 */

import { Wrench, Eye, Camera, Pencil, Plus, MoreVertical, Trash2, Diamond } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { modifierRefId } from '../../../../store/warpLatticeAccess.js';
import { SectionShell } from './SectionShell.jsx';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
} from '../../../../store/migrations/v21_modifier_mode_flags.js';
import { applyArmatureModifier, bindArmatureModifier } from '../../../../services/ArmatureModifierService.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function ModifierStackSection({ nodeId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  );
  const updateProject = useProjectStore((s) => s.updateProject);

  if (!node || node.type !== 'part') return null;
  const stack = Array.isArray(node.modifiers) ? node.modifiers : [];
  // Cubism Adapter REVERT (2026-05-09 afternoon): "Add Modifier →
  // Armature" is now offered for ANY meshed part with a bone-group
  // ancestor (mirrors Blender — adding an Armature modifier to a
  // mesh is always legal regardless of whether the mesh has vertex
  // groups yet). With no vertex groups the modifier renders as a
  // no-op (the part rigid-follows via the overlay-matrix path); once
  // the user paints weights via Weight Paint mode, the composition
  // decision flips from `'overlay'` to `'lbs'` and LBS activates.
  //
  // Section is now ALWAYS rendered for parts (mirrors Blender — the
  // wrench tab on every mesh is the "Add Modifier" entry point).
  // The Add Modifier button below is enabled when there's a bone-
  // group ancestor; otherwise it's disabled with an explanatory
  // tooltip. Never returns null for a meshed part.
  const project = useProjectStore.getState().project;
  const nearestBoneAncestor = (() => {
    const byId = new Map(project.nodes.map((n) => [n.id, n]));
    let cur = node.parent ? byId.get(node.parent) : null;
    while (cur && !(cur.type === 'group' && cur.boneRole)) {
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    return cur ?? null;
  })();
  const meshJointBoneId = typeof node.mesh?.jointBoneId === 'string' && node.mesh.jointBoneId.length > 0
    ? node.mesh.jointBoneId : null;
  const meshBoneWeights = Array.isArray(node.mesh?.boneWeights) ? node.mesh.boneWeights : null;
  const canBindArmature = !!nearestBoneAncestor
    && !stack.some((m) => m?.type === 'armature');

  /** @param {(modifiers: Array<any>) => void} fn */
  function patchModifiers(fn) {
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      if (!n || !Array.isArray(n.modifiers)) return;
      fn(n.modifiers);
    });
  }

  function toggleEnabled(idx) {
    patchModifiers((mods) => {
      const m = mods[idx];
      if (!m) return;
      m.enabled = m.enabled === false ? true : false;
    });
  }

  function toggleModeBit(idx, bit) {
    patchModifiers((mods) => {
      const m = mods[idx];
      if (!m) return;
      const cur = typeof m.mode === 'number'
        ? m.mode
        : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
      m.mode = (cur & bit) ? (cur & ~bit) : (cur | bit);
    });
  }

  function moveUp(idx) {
    if (idx <= 0) return;
    patchModifiers((mods) => {
      const t = mods[idx - 1];
      mods[idx - 1] = mods[idx];
      mods[idx] = t;
    });
  }

  function moveDown(idx) {
    patchModifiers((mods) => {
      if (idx >= mods.length - 1) return;
      const t = mods[idx + 1];
      mods[idx + 1] = mods[idx];
      mods[idx] = t;
    });
  }

  return (
    <SectionShell id="modifierStack" label="Modifier Stack" icon={<Wrench size={11} />}>
      <AddModifierButton
        canBindArmature={canBindArmature}
        weightCount={meshBoneWeights?.length ?? 0}
        jointBoneId={meshJointBoneId ?? nearestBoneAncestor?.id ?? null}
        jointBoneRole={nearestBoneAncestor?.boneRole ?? null}
        onAddArmature={() => bindArmatureModifier(nodeId)}
      />
      {stack.length === 0 && (
        <div className="text-[11px] text-muted-foreground mt-1">
          {canBindArmature
            ? 'No modifiers yet. Use Add Modifier above to bind an Armature.'
            : nearestBoneAncestor
              ? 'Armature already bound on this part.'
              : 'No bone-group ancestor — Armature modifier needs a bone to follow.'}
        </div>
      )}
      {stack.length > 0 && (
        <div className="text-[11px] text-muted-foreground mb-1 mt-1">
          Leaf-first order — modifiers[0] is the innermost / closest to the part.
        </div>
      )}
      {stack.map((mod, idx) => {
        // M5 (RULE-№4, 2026-05-23): the rotation-display filter was retired.
        // Post-RULE-№4 v44 migration (`migrations/groupRotationToBone.js`)
        // removes every `GroupRotation_*` deformer node from `project.nodes`
        // BEFORE `synthesizeModifierStacks` runs in seedAllRig
        // (`projectStore.js:1646` migrate → 1653 synth), so the synth's
        // chain-walk never encounters a rotation deformer and no
        // `mod.type === 'rotation'` entry is ever emitted into
        // `part.modifiers[]` for any project that has completed Init Rig.
        // The `GroupRotation` export adapter
        // (`synthesizeGroupRotationDeformers.js`) is transient-only — it
        // produces rotation nodes for the export pipeline but never mutates
        // `project.nodes`. The previous silent filter (`if (mod.type ===
        // 'rotation') return null`) was dead code; deleted along with its
        // explanatory comment block. If a degenerate pre-v44 fixture ever
        // surfaces a rotation entry, `typeBadge` below will display it
        // honestly instead of hiding it.
        const mode = typeof mod.mode === 'number'
          ? mod.mode
          : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
        const enabled = mod.enabled !== false;
        const isArmature = mod.type === 'armature';
        const isLattice = mod.type === 'lattice';
        // v43 — a lattice modifier references its cage OBJECT via `objectId`;
        // warp/rotation via `deformerId`. Resolve either via the seam.
        const refId = modifierRefId(mod);
        // Armature rows display the joint bone role (e.g. "leftElbow")
        // and the parent bone role (e.g. "leftArm" → leftElbow) instead
        // of raw bone GUIDs. Mirrors Blender's modifier panel which
        // shows the bound armature Object's name. Lattice rows show the
        // referenced cage object's name (Blender's `LatticeModifierData.object`).
        const labelText = (() => {
          if (mod.type === 'armature') {
            const j = mod.data?.jointBoneRole ?? 'bone';
            const p = mod.data?.parentBoneRole;
            return p ? `${p} → ${j}` : j;
          }
          if (isLattice) {
            const obj = refId ? nodes.find((n) => n?.id === refId) : null;
            return obj?.name ?? refId ?? '<missing>';
          }
          return refId ?? '<missing>';
        })();
        const typeBadge = isArmature ? 'Armature' : isLattice ? 'Lattice' : (mod.type ?? '—');
        return (
          <div
            key={`${refId ?? 'unk'}-${idx}`}
            className="flex items-center gap-1 text-xs h-7 px-1 rounded bg-muted/30"
          >
            <button
              type="button"
              className={`w-5 h-5 shrink-0 text-[10px] border rounded ${enabled ? 'bg-primary/20 border-primary text-foreground' : 'bg-transparent border-border text-muted-foreground'}`}
              title={enabled ? 'Disable modifier' : 'Enable modifier'}
              onClick={() => toggleEnabled(idx)}
            >
              {enabled ? '✓' : '×'}
            </button>
            <span className={`text-[10px] w-12 shrink-0 uppercase ${isArmature ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
              {typeBadge}
            </span>
            <span className="text-xs flex-1 truncate font-mono" title={refId ?? undefined}>
              {labelText}
            </span>
            {mod.synthetic === true && (
              <span
                className="text-[9px] px-1 rounded bg-warning/20 text-warning border border-warning/40"
                title="Synthesized by v21 migration (body-warp fallback)"
              >
                synth
              </span>
            )}
            {/*
              Display-mode toggles. Match Blender's modifier panel
              header row (`reference/blender/source/blender/modifiers/intern/MOD_ui_common.cc:417-421`,
              in `modifier_panel_header`):
                - Eye (RESTRICT_VIEW_OFF) → show_viewport (gates depgraph viewport eval)
                - Camera (RESTRICT_RENDER_OFF) → show_render (gates the export pass)
                - Pencil (EDITMODE_HLT) → show_in_editmode (gates whether the
                  modifier deforms the part while a mesh-edit mode is active)
              Tooltips mirror Blender's `rna_modifier.cc` property strings.
            */}
            <ModeBitIcon
              icon={<Eye size={11} />}
              active={(mode & MODIFIER_MODE_REALTIME) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_REALTIME)}
              title="Display modifier in viewport"
            />
            <ModeBitIcon
              icon={<Camera size={11} />}
              active={(mode & MODIFIER_MODE_RENDER) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_RENDER)}
              title="Use modifier during render"
            />
            <ModeBitIcon
              icon={<Pencil size={11} />}
              active={(mode & MODIFIER_MODE_EDITMODE) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_EDITMODE)}
              title="Display modifier in Edit mode"
            />
            {/* Edit deformation — jump to this deformer's keyform editor.
                A part carries no param-effect data of its own (it's
                deformed by parent deformers), so "how does BodyAngleZ
                move this part" is edited on the deformer. Selecting it
                switches Properties to its Deformer Keyforms grid (set the
                bound param to the value, then "Edit keyform" → drag the
                warp/rotation handles on canvas). Armature rows have no
                keyform grid (bone pose, not keyforms) so they're skipped. */}
            {!isArmature && refId && (
              <button
                type="button"
                className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded border border-border bg-transparent hover:bg-muted text-muted-foreground"
                title={isLattice
                  ? 'Edit deformation — jump to this Lattice object (cage + keyforms)'
                  : "Edit deformation — jump to this deformer's keyform editor"}
                // v43 — a lattice modifier targets a first-class OBJECT
                // (select as 'object'); warp/rotation target a deformer node.
                onClick={() => useSelectionStore.getState().select(
                  { type: isLattice ? 'object' : 'deformer', id: refId }, 'replace')}
              >
                <Diamond size={11} />
              </button>
            )}
            <ModifierRowMenu
              isArmature={isArmature}
              canMoveUp={idx > 0}
              canMoveDown={idx < stack.length - 1}
              onApply={isArmature ? () => applyArmatureModifier(nodeId) : null}
              onMoveUp={() => moveUp(idx)}
              onMoveDown={() => moveDown(idx)}
              onDelete={() => patchModifiers((mods) => { mods.splice(idx, 1); })}
            />
          </div>
        );
      })}
    </SectionShell>
  );
}

/**
 * Display-mode icon toggle. Mirrors Blender's modifier panel where
 * each modifier row exposes Eye / Camera / Edit-mode icons for its
 * `show_viewport` / `show_render` / `show_in_editmode` flags
 * (`reference/blender/scripts/startup/bl_ui/properties_data_modifier.py`).
 *
 * @param {{icon: import('react').ReactElement, active: boolean, onClick: () => void, title: string}} props
 */
function ModeBitIcon({ icon, active, onClick, title }) {
  return (
    <button
      type="button"
      className={`w-5 h-5 shrink-0 inline-flex items-center justify-center rounded border ${active ? 'bg-primary/30 border-primary text-foreground' : 'bg-transparent border-border text-muted-foreground'}`}
      title={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/**
 * Per-modifier dropdown menu — the kebab on the right of each row.
 * Mirrors Blender's modifier dropdown (caret in the panel header)
 * which exposes Apply / Duplicate / Move / Delete. SS today supports:
 *   - Apply (Armature only — the only modifier with a deform-bake)
 *   - Move up / down
 *   - Delete
 *
 * Outside-click dismiss: a window-level pointerdown listener that
 * closes the menu when the user clicks anywhere outside the menu's
 * own subtree. Standard popover pattern.
 */
function ModifierRowMenu({ isArmature, canMoveUp, canMoveDown, onApply, onMoveUp, onMoveDown, onDelete }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) { setOpen(false); return; }
      if (!target.closest('[data-modifier-row-menu="open"]')) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, { capture: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, [open]);
  return (
    <div className="relative" data-modifier-row-menu={open ? 'open' : 'closed'}>
      <button
        type="button"
        className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded border border-border bg-transparent hover:bg-muted text-muted-foreground"
        title="Modifier menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 min-w-[10rem] rounded border border-border bg-popover shadow-md py-1 text-xs">
          {isArmature && onApply && (
            <button
              type="button"
              className="w-full text-left px-2 py-1 hover:bg-muted"
              title="Bake the current pose into mesh.vertices and remove the modifier (vertex groups stay; mirrors Blender's modifier dropdown → Apply)"
              onClick={() => { setOpen(false); onApply(); }}
            >
              Apply
            </button>
          )}
          <button
            type="button"
            className="w-full text-left px-2 py-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!canMoveUp}
            onClick={() => { setOpen(false); onMoveUp(); }}
          >
            Move up
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!canMoveDown}
            onClick={() => { setOpen(false); onMoveDown(); }}
          >
            Move down
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="w-full text-left px-2 py-1 hover:bg-destructive/20 text-destructive flex items-center gap-1"
            onClick={() => { setOpen(false); onDelete(); }}
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Add Modifier" button at the top of the stack section. Blender
 * shows a popover listing every available modifier type
 * (`ModifierAddMenu` in `properties_data_modifier.py`). SS today only
 * supports Armature as a manually-addable type — warps/rotations
 * come from rig synth — so the popover collapses to a single entry.
 *
 * Visible iff the part has bind data (`canBindArmature`). Disabled-
 * gated when no addable type is available so the affordance is
 * always present in the panel chrome (the user knows where Add
 * Modifier lives even when they can't currently add one).
 */
function AddModifierButton({ canBindArmature, weightCount, jointBoneId, jointBoneRole, onAddArmature }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) { setOpen(false); return; }
      if (!target.closest('[data-add-modifier-popover="open"]')) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, { capture: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, [open]);
  const enabled = canBindArmature;
  return (
    <div className="relative" data-add-modifier-popover={open ? 'open' : 'closed'}>
      <button
        type="button"
        className={`w-full px-2 h-6 text-[11px] border rounded text-left inline-flex items-center gap-1 ${enabled ? 'border-primary/60 bg-primary/10 hover:bg-primary/20 text-foreground' : 'border-border bg-transparent text-muted-foreground cursor-not-allowed'}`}
        title={enabled
          ? 'Add a modifier from the list below (mirrors Blender Properties → Modifiers → Add Modifier)'
          : 'No addable modifier types — the part has no bone-group ancestor, and warp/rotation modifiers come from rig synth'}
        disabled={!enabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={11} />
        Add Modifier
      </button>
      {open && enabled && (
        <div className="absolute left-0 right-0 top-7 z-50 rounded border border-border bg-popover shadow-md py-1 text-xs">
          <button
            type="button"
            className="w-full text-left px-2 py-1 hover:bg-muted inline-flex items-center gap-2"
            title={weightCount > 0
              ? `Re-bind Armature modifier to existing vertex groups (${weightCount} weights → bone ${jointBoneRole ?? jointBoneId}).`
              : `Add empty Armature modifier (target bone: ${jointBoneRole ?? jointBoneId}). The part rigid-follows the bone via the overlay path until you paint vertex weights via Weight Paint mode — then LBS activates.`}
            onClick={() => { setOpen(false); onAddArmature(); }}
          >
            <Wrench size={11} />
            Armature
          </button>
        </div>
      )}
    </div>
  );
}
