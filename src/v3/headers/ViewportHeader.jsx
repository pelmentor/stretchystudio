// @ts-check

/**
 * ViewportHeader — area-header chrome for the Viewport editor.
 *
 * Mirrors Blender's `VIEW3D_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_view3d.py:702`).
 * Blender's header lays out as: Mode picker → orientation/snap controls
 * → View / Select / Add / Object menus.
 *
 * F-1 sweep first commit ships the architecture + a starter menu set:
 *   - Mode picker (mode label only — full mode dropdown still lives on
 *     the floating ModePill canvas overlay; this header pill is a
 *     read-only mirror until ModePill is refactored into a shared
 *     subcomponent we can mount in both places per Rule №1)
 *   - View menu (Frame Selected — `view.frameSelected`)
 *   - Select menu (Select All / Deselect All / Box / Circle / Toggle Visibility)
 *   - Object menu (Snap submenu trigger / Mirror submenu trigger /
 *     Set Parent / Clear Parent / Set Origin)
 *
 * Subsequent commits will: (a) lift ModePill into a shared
 * ModeSelector component, (b) add transform-orientation + snap pills
 * to the middle of the header, (c) wire the Add menu (Blender's
 * `VIEW3D_MT_add` — needs a node-creation operator surface in SS that
 * doesn't exist yet, see audit finding F-8).
 *
 * @module v3/headers/ViewportHeader
 */

import { useCallback } from 'react';
import { ChevronDown, Check, Square, Crosshair, Dot, Target, RotateCcw, Anchor } from 'lucide-react';
import { makeHeaderOperators } from './headerOperators.js';
import { ModePill } from '../shell/ModePill.jsx';
import { ViewLayersPopover } from '../shell/ViewLayersPopover.jsx';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useUIV3Store, selectEditorMode } from '../../store/uiV3Store.js';
import { useProjectStore } from '../../store/projectStore.js';
import { resetPoseDraft, resetToRestPose } from '../../services/PoseService.js';
import { logger } from '../../lib/logger.js';
import { TRANSFORM_PIVOT_ITEMS } from '../transformPivot.js';
import * as DropdownImpl from '../../components/ui/dropdown-menu.jsx';

/** @type {Record<string, React.ComponentType<any>>} */
const Dd = /** @type {any} */ (DropdownImpl);
const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} = Dd;

// F2-1 audit-fix sweep (ARCH-3) — shared runOperator/isAvailable pair
// bound to this editor's type. Pre-sweep this header inlined a verbatim
// copy of the same helper functions; lifted into `headerOperators.js`
// alongside the parallel copies in TimelineHeader / DopesheetHeader /
// FCurveHeader so a single source defines the dispatch contract.
const { runOperator, isAvailable } = makeHeaderOperators('viewport');

export function ViewportHeader() {
  const onFrameSelected = useCallback(() => runOperator('view.frameSelected'), []);
  const onSelectAll     = useCallback(() => runOperator('selection.selectAllToggle'), []);
  const onDeselectAll   = useCallback(() => runOperator('selection.deselectAll'), []);
  const onBoxSelect     = useCallback(() => runOperator('selection.boxSelect'), []);
  const onCircleSelect  = useCallback(() => runOperator('selection.circleSelect'), []);
  const onToggleVis     = useCallback(() => runOperator('selection.toggleVisibility'), []);
  const onDelete        = useCallback(() => runOperator('selection.delete'), []);
  const onSnapMenu      = useCallback(() => runOperator('object.snap.menu'), []);
  const onMirrorMenu    = useCallback(() => runOperator('object.mirror.menu'), []);
  const onParentSet     = useCallback(() => runOperator('object.parent.set'), []);
  const onParentClear   = useCallback(() => runOperator('object.parent.clearMenu'), []);
  const onSetOrigin     = useCallback(() => runOperator('object.setOrigin.menu'), []);

  return (
    <div
      className="border-b border-border bg-muted/20 flex items-center
                 px-1.5 py-1 gap-1 text-[11px] select-none"
    >
      {/* Interactive mode selector — Blender's VIEW3D_HT_header mode
          picker (`space_view3d.py:847`). Relocated here from the floating
          canvas overlay (UI Blender-parity Slice C). Carries the mode
          dropdown + (in Edit Mode) the proportional-edit toggle. */}
      <ModePill />

      <div className="w-px h-4 bg-border/50 mx-0.5" aria-hidden="true" />

      {/* View menu — Blender's VIEW3D_MT_view */}
      <HeaderMenu label="View">
        <DropdownMenuItem
          disabled={!isAvailable('view.frameSelected')}
          onSelect={onFrameSelected}
          className="text-[11px]"
        >
          Frame Selected <kbd className="ml-auto opacity-60">.</kbd>
        </DropdownMenuItem>
      </HeaderMenu>

      {/* Select menu — Blender's VIEW3D_MT_select_<mode> */}
      <HeaderMenu label="Select">
        <DropdownMenuItem
          disabled={!isAvailable('selection.selectAllToggle')}
          onSelect={onSelectAll}
          className="text-[11px]"
        >
          All <kbd className="ml-auto opacity-60">A</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isAvailable('selection.deselectAll')}
          onSelect={onDeselectAll}
          className="text-[11px]"
        >
          None <kbd className="ml-auto opacity-60">Alt A</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isAvailable('selection.boxSelect')}
          onSelect={onBoxSelect}
          className="text-[11px]"
        >
          Box Select <kbd className="ml-auto opacity-60">B</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isAvailable('selection.circleSelect')}
          onSelect={onCircleSelect}
          className="text-[11px]"
        >
          Circle Select <kbd className="ml-auto opacity-60">C</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isAvailable('selection.toggleVisibility')}
          onSelect={onToggleVis}
          className="text-[11px]"
        >
          Toggle Visibility <kbd className="ml-auto opacity-60">H</kbd>
        </DropdownMenuItem>
      </HeaderMenu>

      {/* Object menu — Blender's VIEW3D_MT_object */}
      <HeaderMenu label="Object">
        <DropdownMenuItem
          disabled={!isAvailable('object.snap.menu')}
          onSelect={onSnapMenu}
          className="text-[11px]"
        >
          Snap… <kbd className="ml-auto opacity-60">Shift S</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isAvailable('object.mirror.menu')}
          onSelect={onMirrorMenu}
          className="text-[11px]"
        >
          Mirror… <kbd className="ml-auto opacity-60">Ctrl M</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isAvailable('object.parent.set')}
          onSelect={onParentSet}
          className="text-[11px]"
        >
          Parent → Set <kbd className="ml-auto opacity-60">Ctrl P</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isAvailable('object.parent.clearMenu')}
          onSelect={onParentClear}
          className="text-[11px]"
        >
          Parent → Clear <kbd className="ml-auto opacity-60">Alt P</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isAvailable('object.setOrigin.menu')}
          onSelect={onSetOrigin}
          className="text-[11px]"
        >
          Set Origin…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isAvailable('selection.delete')}
          onSelect={onDelete}
          className="text-[11px] text-destructive"
        >
          Delete <kbd className="ml-auto opacity-60">X</kbd>
        </DropdownMenuItem>
      </HeaderMenu>

      {/* Flexible spacer — centres the transform-tools cluster in the
          header, matching Blender's VIEW3D_HT_header where the
          orientation / pivot / snap / proportional group floats in the
          middle between the menus and the right-side overlay controls. */}
      <div className="flex-1" aria-hidden="true" />

      {/* Transform-tools cluster — Blender places the transform
          orientation / pivot point / snap / proportional-edit controls
          in the middle of VIEW3D_HT_header (`space_view3d.py`). SS only
          has the Pivot Point pill so far
          (`scene.tool_settings.transform_pivot_point`); orientation +
          snap pills are future additions to this same group. */}
      <PivotPill />

      <div className="flex-1" aria-hidden="true" />

      {/* Right-aligned cluster — View Layers + Reset/Apply Pose. Relocated
          from the floating top-right canvas overlay into the header to
          match Blender's VIEW3D_HT_header (overlay/gizmo popovers sit on
          the right of the viewport header). */}
      <PoseControls />
    </div>
  );
}

/**
 * Right-side header cluster: View Layers popover + Reset Pose (mode-aware)
 * + an Apply-Pose-As-Rest dropdown. Reads `editorMode` / project / pose
 * actions straight from the stores, so it carries no props and can live
 * in the header instead of the canvas overlay. Hidden until a project
 * has nodes (nothing to reset on an empty scene).
 */
function PoseControls() {
  const editorMode = useUIV3Store(selectEditorMode);
  const nodeCount = useProjectStore((s) => s.project?.nodes?.length ?? 0);
  if (nodeCount === 0) return null;

  const onResetPose = () => {
    if (editorMode === 'animation') resetPoseDraft();
    else resetToRestPose();
    logger.debug('resetPose', `Reset Pose triggered (mode=${editorMode})`, { editorMode });
  };
  const onApplyPoseAsRest = () => {
    // Bakes the current pose into descendant mesh rest verts + bone
    // pivots. Disabled in animation mode (would shift geometry at a
    // non-zero playback time).
    if (editorMode === 'animation') {
      logger.warn('applyPoseAsRest', 'Skipped: animation mode (switch to Default to bake pose)');
      return;
    }
    useProjectStore.getState().applyPoseAsRest();
    logger.info('applyPoseAsRest', 'Applied current pose as the new rest pose');
  };

  return (
    <div className="ml-auto flex items-center gap-1">
      <ViewLayersPopover />
      <div className="flex items-center">
        <button
          type="button"
          onClick={onResetPose}
          title={editorMode === 'animation'
            ? 'Clear unsaved pose + reset parameters. Keyframes kept.'
            : 'Reset bones + parameters to rest. Part transforms kept (use Properties → Reset Transform).'}
          className="h-6 pl-1.5 pr-2 rounded-l-sm flex items-center gap-1
                     text-foreground/80 hover:text-foreground hover:bg-background/60
                     focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="text-[11px] tracking-wide">Reset Pose</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Pose menu"
              className="h-6 px-0.5 rounded-r-sm flex items-center
                         text-foreground/70 hover:text-foreground hover:bg-background/60
                         focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
            >
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuItem
              disabled={editorMode === 'animation'}
              onSelect={onApplyPoseAsRest}
              className="text-[11px] gap-2 items-start"
            >
              <Anchor className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-70" />
              <span className="flex-1">
                <span className="font-medium block">Apply Pose As Rest</span>
                <span className="text-muted-foreground/85 text-[10px] leading-snug block mt-0.5">
                  {editorMode === 'animation'
                    ? 'Switch to Default workspace first'
                    : 'Bakes current pose into mesh rest + bone pivots. Visual unchanged. Drag bones from new neutral.'}
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** lucide stand-ins for Blender's pivot icons (ICON_PIVOT_*). */
const PIVOT_ICONS = {
  BOUNDING_BOX_CENTER: Square,
  CURSOR: Crosshair,
  MEDIAN_POINT: Dot,
  ACTIVE_ELEMENT: Target,
};

/**
 * Transform Pivot Point pill — icon trigger + dropdown of the supported
 * pivot modes (`v3/transformPivot.js`). Reads/writes the persisted
 * `preferencesStore.transformPivot`. The active mode shows its icon on
 * the trigger and a check in the menu.
 */
function PivotPill() {
  const pivot = usePreferencesStore((s) => s.transformPivot);
  const setPivot = usePreferencesStore((s) => s.setTransformPivot);
  const ActiveIcon = PIVOT_ICONS[pivot] ?? Dot;
  const activeItem = TRANSFORM_PIVOT_ITEMS.find((it) => it.id === pivot);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Transform Pivot Point: ${activeItem?.label ?? ''}`}
          aria-label="Transform Pivot Point"
          className="px-1 py-0.5 rounded-sm hover:bg-background/60
                     focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60
                     flex items-center gap-0.5 text-foreground/80"
        >
          <ActiveIcon size={14} />
          <ChevronDown size={10} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {TRANSFORM_PIVOT_ITEMS.map((it) => {
          const Icon = PIVOT_ICONS[it.id] ?? Dot;
          const checked = it.id === pivot;
          return (
            <DropdownMenuItem
              key={it.id}
              onSelect={() => setPivot(it.id)}
              title={it.description}
              className="text-[11px] gap-2"
            >
              <Icon size={13} className="opacity-80" />
              {it.label}
              {checked ? <Check size={12} className="ml-auto opacity-80" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compact header menu trigger button — same shape as Blender's header
 * menu items (label only, chevron on focus, dropdown on click).
 */
function HeaderMenu({ label, children }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="px-1.5 py-0.5 rounded-sm hover:bg-background/60
                     focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60
                     flex items-center gap-0.5 text-foreground/80"
        >
          {label}
          <ChevronDown size={10} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
