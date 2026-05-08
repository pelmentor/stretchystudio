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

import { Wrench } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { SectionShell } from './SectionShell.jsx';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
  MODIFIER_MODE_EDITMODE,
} from '../../../../store/migrations/v21_modifier_mode_flags.js';
import { applyArmatureModifier } from '../../../../services/ArmatureModifierService.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function ModifierStackSection({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );
  const updateProject = useProjectStore((s) => s.updateProject);

  if (!node || node.type !== 'part') return null;
  const stack = Array.isArray(node.modifiers) ? node.modifiers : [];
  if (stack.length === 0) return null;

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
      <div className="text-[11px] text-muted-foreground mb-1">
        Leaf-first order — modifiers[0] is the innermost / closest to the part.
      </div>
      {stack.map((mod, idx) => {
        const mode = typeof mod.mode === 'number'
          ? mod.mode
          : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
        const enabled = mod.enabled !== false;
        const isArmature = mod.type === 'armature';
        // Armature rows display the joint bone role (e.g. "leftElbow")
        // and the parent bone role (e.g. "leftArm" → leftElbow) instead
        // of raw bone GUIDs. Mirrors Blender's modifier panel which
        // shows the bound armature Object's name.
        const labelText = (() => {
          if (mod.type === 'armature') {
            const j = mod.data?.jointBoneRole ?? 'bone';
            const p = mod.data?.parentBoneRole;
            return p ? `${p} → ${j}` : j;
          }
          return mod.deformerId ?? '<missing>';
        })();
        const typeBadge = isArmature ? 'Armature' : (mod.type ?? '—');
        return (
          <div
            key={`${mod.deformerId ?? 'unk'}-${idx}`}
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
            <span className="text-xs flex-1 truncate font-mono" title={mod.deformerId}>
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
            <ModeBitChip
              label="VP"
              active={(mode & MODIFIER_MODE_REALTIME) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_REALTIME)}
              title="Viewport (REALTIME)"
            />
            <ModeBitChip
              label="EX"
              active={(mode & MODIFIER_MODE_RENDER) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_RENDER)}
              title="Export (RENDER)"
            />
            <ModeBitChip
              label="ED"
              active={(mode & MODIFIER_MODE_EDITMODE) !== 0}
              onClick={() => toggleModeBit(idx, MODIFIER_MODE_EDITMODE)}
              title="Edit Mode (EDITMODE)"
            />
            {isArmature ? (
              <button
                type="button"
                className="px-1 h-5 shrink-0 text-[10px] border border-primary/60 rounded bg-primary/20 text-foreground hover:bg-primary/30"
                title="Apply Armature modifier — bake the current pose into mesh.vertices and remove the modifier (mirrors Blender's modifier dropdown → Apply)"
                onClick={() => applyArmatureModifier(nodeId)}
              >
                Apply
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="w-5 h-5 shrink-0 text-[10px] border border-border rounded bg-transparent hover:bg-muted disabled:opacity-30"
                  title="Move up (toward leaf)"
                  disabled={idx === 0}
                  onClick={() => moveUp(idx)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="w-5 h-5 shrink-0 text-[10px] border border-border rounded bg-transparent hover:bg-muted disabled:opacity-30"
                  title="Move down (toward root)"
                  disabled={idx === stack.length - 1}
                  onClick={() => moveDown(idx)}
                >
                  ↓
                </button>
              </>
            )}
          </div>
        );
      })}
    </SectionShell>
  );
}

/**
 * @param {{label: string, active: boolean, onClick: () => void, title: string}} props
 */
function ModeBitChip({ label, active, onClick, title }) {
  return (
    <button
      type="button"
      className={`w-7 h-5 shrink-0 text-[9px] font-mono rounded border ${active ? 'bg-primary/30 border-primary text-foreground' : 'bg-transparent border-border text-muted-foreground'}`}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
