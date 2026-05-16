// @ts-check

/**
 * FCurveHeader — area-header chrome for the F-curve editor.
 *
 * Mirrors Blender's `GRAPH_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_graph.py:44`) which
 * lays out `template_header()` → mode picker → `GRAPH_MT_editor_menus`
 * collapsible (View / Select / Marker / Channel / Key) plus
 * Normalize toggle, snap pills, proportional-edit pill, and filter
 * popover.
 *
 * SS's F-curve editor is read-only (see `FCurveEditor.jsx` JSDoc —
 * "drag-handle bezier editing is the polish phase that earns
 * `v3-phase-3-complete`"). F2-1 lifts the inline `<Wrapper>` title
 * strip out of the body and ships a View menu with the operators we
 * have today. Channel / Key / Marker menus are deferred per Rule №1.
 *
 * @module v3/headers/FCurveHeader
 */

import { useMemo } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { getActiveSceneAction } from '../../anim/sceneAction.js';
import {
  decodeFCurveTarget,
  fcurveTargetsParam,
} from '../../anim/animationFCurve.js';
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
  const ctx = { editorType: 'fcurve' };
  if (op.available && !op.available(ctx)) return false;
  try { op.exec(ctx); } catch { /* operator logs its own errors */ }
  return true;
}

function isAvailable(opId) {
  const op = getOperator(opId);
  if (!op) return false;
  if (!op.available) return true;
  return op.available({ editorType: 'fcurve' });
}

export function FCurveHeader() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const selection = useSelectionStore((s) => s.items);

  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  const subtitle = useMemo(() => {
    if (!action) return 'No animation active';
    const duration = Math.max(1, action.duration ?? 1000);
    const picked = pickPickedLabel(action, selection, project);
    if (picked) {
      return `${picked.label} · ${picked.keyformCount} keyframes · ${(duration / 1000).toFixed(1)}s`;
    }
    if (!selection.length) return 'No selection — pick a parameter or part';
    const last = selection[selection.length - 1];
    return describeLast(last, project);
  }, [action, selection, project]);

  return (
    <div
      className="border-b border-border bg-muted/30 flex items-center
                 px-2 py-1 gap-1.5 text-[11px] select-none shrink-0"
    >
      <Activity size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        F-curve
      </span>
      <span className="text-[10px] text-muted-foreground/70 ml-1 truncate">{subtitle}</span>
      <span className="flex-1" />

      {/* View menu — Blender's GRAPH_MT_view (space_graph.py:207). */}
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

function pickPickedLabel(action, selection, project) {
  if (!action?.fcurves) return null;
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i];
    if (sel.type === 'parameter') {
      const fc = action.fcurves.find((f) => fcurveTargetsParam(f, sel.id));
      if (fc) return { label: `param:${sel.id}`, keyformCount: (fc.keyforms ?? []).length };
    }
    if (sel.type === 'part' || sel.type === 'group') {
      const fc = action.fcurves.find((f) => {
        const t = decodeFCurveTarget(f);
        return t?.kind === 'node' && t.nodeId === sel.id;
      });
      if (fc) {
        const t = decodeFCurveTarget(fc);
        const property = t?.kind === 'node' ? t.property : '?';
        return { label: `${sel.type}:${sel.id} · ${property}`, keyformCount: (fc.keyforms ?? []).length };
      }
    }
  }
  return null;
}

function describeLast(sel, project) {
  if (sel.type === 'parameter') {
    const p = (project.parameters ?? []).find((pp) => pp.id === sel.id);
    return `Param: ${p?.name ?? sel.id}`;
  }
  if (sel.type === 'part' || sel.type === 'group') {
    const n = (project.nodes ?? []).find((nn) => nn.id === sel.id);
    return `${sel.type}: ${n?.name ?? sel.id}`;
  }
  return sel.type;
}
