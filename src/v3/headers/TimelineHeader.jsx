// @ts-check

/**
 * TimelineHeader — area-header chrome for the Timeline editor.
 *
 * Blender's Timeline is a sub-mode of the Dopesheet editor (`st.mode ===
 * 'TIMELINE'`); its header is `DOPESHEET_HT_header` branching to
 * `playback_controls(layout, context)` + a collapsible menu with only
 * View + Marker (`space_dopesheet.py:208-217` + `:401-414`). SS splits
 * Timeline and Dopesheet into separate editor types, so this header
 * mirrors only the TIMELINE-mode subset:
 *
 *   - "Timeline" name + active-action subtitle (frame range / fps)
 *   - View menu (Frame Selected — operator already exists)
 *
 * The fat transport bar (play / pause / frame fields / fps / speed /
 * loop / auto-key / audio) stays in the editor body for now: lifting
 * it into the header would compete with the canvas-area chrome budget
 * and disrupt the user's muscle memory for transport-row position.
 * Blender embeds playback controls in the same header strip, but their
 * `Header` is a single horizontal row — SS's two-stripe layout (area
 * header + transport row) reads cleaner at SS's narrower default
 * Timeline area width.
 *
 * F-1 / Audit-4 #1 status-bar follow-on (FID-A.2): Blender also
 * registers `DOPESHEET_HT_playback_controls` and
 * `GRAPH_HT_playback_controls` as FOOTER-region headers (see
 * `space_dopesheet.py:351-358` and `space_graph.py:113-124`). These
 * are the natural target when SS's status bar / Footer.jsx lift lands
 * — at that point the transport can move from the editor body into
 * a footer region the AppShell owns, mirroring Blender's two-region
 * model (HEADER on top, FOOTER on bottom).
 *
 * The View menu surfaces SS's unified `view.frameSelected` op
 * (`registry.js:393`) — the analog of Blender's per-space
 * `action.view_selected` / `graph.view_selected` / `node.view_selected`,
 * consolidated into one because SS's frame target is a Part/Group bbox
 * regardless of editor space (FID-A.1).
 *
 * @module v3/headers/TimelineHeader
 */

import { useMemo } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore.js';
import { useAnimationStore } from '../../store/animationStore.js';
import { getActiveSceneAction } from '../../anim/sceneAction.js';
import { makeHeaderOperators } from './headerOperators.js';
import * as DropdownImpl from '../../components/ui/dropdown-menu.jsx';

/** @type {Record<string, React.ComponentType<any>>} */
const Dd = /** @type {any} */ (DropdownImpl);
const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} = Dd;

const { runOperator, isAvailable } = makeHeaderOperators('timeline');

export function TimelineHeader() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const startFrame = useAnimationStore((s) => s.startFrame);
  const endFrame = useAnimationStore((s) => s.endFrame);
  const fps = useAnimationStore((s) => s.fps);

  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  const subtitle = useMemo(() => {
    if (!action) return 'No animation active — create one in the Actions panel';
    const name = action.name ?? '(unnamed)';
    return `${name} · ${startFrame}–${endFrame} @ ${fps}fps`;
  }, [action, startFrame, endFrame, fps]);

  return (
    <div
      className="border-b border-border bg-muted/30 flex items-center
                 px-2 py-1 gap-1.5 text-[11px] select-none shrink-0"
    >
      <Clock size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Timeline
      </span>
      <span className="text-[10px] text-muted-foreground/70 ml-1 truncate">{subtitle}</span>
      <span className="flex-1" />

      {/* View menu — Blender's TIMELINE-mode menu set (View + Marker; Marker deferred). */}
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
