// @ts-nocheck

/**
 * v3 GAP-008 Phase B — Init Rig subsystems opt-out UI.
 *
 * Renders a 7-checkbox popover bound to
 * `project.autoRigConfig.subsystems`. The data layer + filter logic was
 * shipped in Phase A (initRig.harvestSeedFromRigSpec post-rigSpec
 * filter + seedPhysicsRules rule-name prefix filter); this is the UI
 * surface that lets users actually flip the flags before clicking Init
 * Rig.
 *
 * Headline use case: short-hair / buzz-cut characters where the
 * auto-detected hair rig produces unwanted sway. Uncheck "Hair rig",
 * click Init Rig, get a hair-free build with no pendulum physics.
 *
 * @module v3/editors/parameters/InitRigOptionsPopover
 */

import { Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover.jsx';
import { Checkbox } from '../../../components/ui/checkbox.jsx';
import { useProjectStore } from '../../../store/projectStore.js';
import { resolveAutoRigConfig } from '../../../io/live2d/rig/autoRigConfig.js';

const SUBSYSTEM_ROWS = [
  { key: 'faceRig',     label: 'Face / head rig',  hint: 'Face parallax warp + face rotation deformers + neck warp' },
  { key: 'eyeRig',      label: 'Eye rig',          hint: 'Eye closure parabolas + iris gaze + eyeball rotation' },
  { key: 'mouthRig',    label: 'Mouth rig',        hint: 'Mouth open / form rig warps' },
  { key: 'hairRig',     label: 'Hair rig',         hint: 'Front + back hair sway warps + hair pendulum physics' },
  { key: 'clothingRig', label: 'Clothing rig',     hint: 'Topwear / bottomwear / legwear sway + clothing physics' },
  { key: 'bodyWarps',   label: 'Body warps',       hint: 'Body angle X / Y / Z deformer chain + breath warp' },
  { key: 'armPhysics',  label: 'Arm physics',      hint: 'Arm elbow pendulum sway' },
];

export function InitRigOptionsPopover() {
  // Selector must return a stable reference — `resolveAutoRigConfig`
  // clones, so calling it inside the selector creates a fresh object
  // on every render and breaks Zustand's useSyncExternalStore snapshot
  // stability (infinite re-render loop). Select the raw stored slot
  // and resolve outside.
  const storedAutoRigConfig = useProjectStore((s) => s.project.autoRigConfig);
  const updateProject = useProjectStore((s) => s.updateProject);
  const subsystems = resolveAutoRigConfig({ autoRigConfig: storedAutoRigConfig }).subsystems;

  function setFlag(key, value) {
    updateProject((project) => {
      if (!project.autoRigConfig) project.autoRigConfig = {};
      if (!project.autoRigConfig.subsystems) project.autoRigConfig.subsystems = {};
      project.autoRigConfig.subsystems[key] = !!value;
    });
  }

  function setAll(value) {
    updateProject((project) => {
      if (!project.autoRigConfig) project.autoRigConfig = {};
      const next = {};
      for (const row of SUBSYSTEM_ROWS) next[row.key] = !!value;
      project.autoRigConfig.subsystems = next;
    });
  }

  const enabledCount = SUBSYSTEM_ROWS.filter((r) => subsystems[r.key] !== false).length;
  const allOn = enabledCount === SUBSYSTEM_ROWS.length;
  const allOff = enabledCount === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] hover:text-foreground transition-colors"
          title="Choose which rig subsystems Initialize Rig should generate."
        >
          <Settings2 size={10} />
          <span>{enabledCount}/{SUBSYSTEM_ROWS.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Init Rig subsystems
        </div>
        <div className="space-y-0.5">
          {SUBSYSTEM_ROWS.map((row) => {
            const checked = subsystems[row.key] !== false;
            return (
              <label
                key={row.key}
                className="flex items-center gap-2 text-[11px] py-0.5 cursor-pointer select-none hover:text-foreground"
                title={row.hint}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => setFlag(row.key, v)}
                />
                <span className="flex-1">{row.label}</span>
              </label>
            );
          })}
        </div>
        <div className="pt-2 border-t border-border/50 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAll(true)}
            disabled={allOn}
            className="text-[10px] px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            disabled={allOff}
            className="text-[10px] px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            None
          </button>
          <span className="flex-1" />
          <span className="text-[9px] text-muted-foreground/70">
            Saved on project
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/80 leading-snug">
          Re-run Initialize Rig to apply changes.
        </div>
      </PopoverContent>
    </Popover>
  );
}
