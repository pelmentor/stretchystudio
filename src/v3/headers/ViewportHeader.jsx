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
import { ChevronDown } from 'lucide-react';
import { getOperator } from '../operators/registry.js';
import { useEditorStore } from '../../store/editorStore.js';
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

/**
 * Run an operator by id. Returns whether the run actually fired (which
 * we use to dim disabled menu items via the operator's `available`).
 *
 * @param {string} opId
 * @returns {boolean}
 */
function runOperator(opId) {
  const op = getOperator(opId);
  if (!op) return false;
  // Header menus run in a UI context with `editorType='viewport'` so
  // operators that gate on context can opt in. Dispatcher uses null
  // for the global keymap path; we pass 'viewport' here so future
  // header-scoped ops can disambiguate.
  const ctx = { editorType: 'viewport' };
  if (op.available && !op.available(ctx)) return false;
  try {
    op.exec(ctx);
  } catch {
    // Operators are responsible for their own error logging via
    // logger.error — swallow here so a thrown menu click doesn't
    // crash the header.
  }
  return true;
}

/**
 * Read whether an operator is currently available without running it.
 * @param {string} opId
 */
function isAvailable(opId) {
  const op = getOperator(opId);
  if (!op) return false;
  if (!op.available) return true;
  return op.available({ editorType: 'viewport' });
}

const MODE_LABELS = {
  object:     'Object Mode',
  edit:       'Edit Mode',
  pose:       'Pose Mode',
  weightPaint: 'Weight Paint',
  sculpt:     'Sculpt Mode',
  blendShape: 'Blend Shape Paint',
};

export function ViewportHeader() {
  const editMode = useEditorStore((s) => s.editMode);
  const modeLabel = MODE_LABELS[editMode] ?? 'Object Mode';

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
      {/* Mode label (read-only mirror — full mode dropdown still lives
          on the floating ModePill canvas overlay). */}
      <div
        className="px-2 py-0.5 rounded-sm bg-background/40 text-foreground
                   border border-border/40"
        title="Active edit mode (change via the canvas Mode pill or Tab keybind)"
      >
        {modeLabel}
      </div>

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
    </div>
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
