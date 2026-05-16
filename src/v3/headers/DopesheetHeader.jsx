// @ts-check

/**
 * DopesheetHeader — area-header chrome for the Dopesheet editor.
 *
 * Mirrors Blender's `DOPESHEET_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_dopesheet.py:199`)
 * which lays out `template_header()` → mode picker → `DOPESHEET_MT_editor_menus`
 * collapsible (View / Select / Marker / Channel / Key) plus per-mode
 * filter / snap / overlay strips.
 *
 * SS's Dopesheet is a read-only fcurve-density inspector — most of
 * Blender's edit-side menus (Key / Channel / Marker) have no operators
 * to wire today. F2-1 lifts the inline `<DopeHeader>` title strip
 * (icon + name + subtitle) out of `DopesheetEditor.jsx`'s body and
 * adds a single View menu with the operators SS already exposes
 * (`view.frameSelected` per `space_dopesheet.py:446` `action.view_selected`).
 *
 * Editor-specific frame fits (`action.view_all`, `action.view_frame`)
 * are deferred — they need a fcurve-coordinate viewport-fit handler
 * the Dopesheet body doesn't expose yet. Stubbed entries would violate
 * Rule №1; we ship only honest wires.
 *
 * @module v3/headers/DopesheetHeader
 */

import { useMemo } from 'react';
import { Film, ChevronDown } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { getActiveSceneAction } from '../../anim/sceneAction.js';
import { decodeFCurveTarget } from '../../anim/animationFCurve.js';
import { getOperator } from '../operators/registry.js';
import * as DropdownImpl from '../../components/ui/dropdown-menu.jsx';

/** @type {Record<string, React.ComponentType<any>>} */
const Dd = /** @type {any} */ (DropdownImpl);
const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} = Dd;

function runOperator(opId) {
  const op = getOperator(opId);
  if (!op) return false;
  const ctx = { editorType: 'dopesheet' };
  if (op.available && !op.available(ctx)) return false;
  try { op.exec(ctx); } catch { /* operator logs its own errors */ }
  return true;
}

function isAvailable(opId) {
  const op = getOperator(opId);
  if (!op) return false;
  if (!op.available) return true;
  return op.available({ editorType: 'dopesheet' });
}

export function DopesheetHeader() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);

  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  const subtitle = useMemo(() => {
    if (!action) return 'No animation active';
    const fcurveCount = (action.fcurves ?? []).filter((fc) => decodeFCurveTarget(fc)).length;
    const duration = Math.max(1, action.duration ?? 1000);
    return `${action.name ?? '(unnamed)'} · ${fcurveCount} fcurves · ${(duration / 1000).toFixed(1)}s`;
  }, [action]);

  return (
    <div
      className="border-b border-border bg-muted/30 flex items-center
                 px-2 py-1 gap-1.5 text-[11px] select-none shrink-0"
    >
      <Film size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Dopesheet
      </span>
      <span className="text-[10px] text-muted-foreground/70 ml-1 truncate">{subtitle}</span>
      <span className="flex-1" />

      {/* View menu — Blender's DOPESHEET_MT_view (space_dopesheet.py:432). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="px-1.5 py-0.5 rounded-sm hover:bg-background/60
                       focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60
                       flex items-center gap-0.5 text-foreground/80"
          >
            View
            <ChevronDown size={10} className="opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem
            disabled={!isAvailable('view.frameSelected')}
            onSelect={() => runOperator('view.frameSelected')}
            className="text-[11px]"
          >
            Frame Selected <kbd className="ml-auto opacity-60">.</kbd>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
