// @ts-check

/**
 * v3 Phase 1D — Single parameter row with name + slider + readout.
 *
 * Reads the live dial position from `paramValuesStore` and writes
 * back through `setParamValue` on every change. The CanvasViewport
 * tick consumes the same store via evalRig, so dragging here drives
 * the deform within the same frame.
 *
 * Step is adaptive (matches v2 ParametersPanel): wide ranges (≥5)
 * step by 1; sub-5 ranges by 0.01. Display precision tracks step.
 *
 * @module v3/editors/parameters/ParamRow
 */

import { useParamValuesStore } from '../../../store/paramValuesStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { getEditorMode } from '../../../store/uiV3Store.js';
import { setParamKeyframeAt } from '../../../renderer/animationEngine.js';
import { Slider as SliderImpl } from '../../../components/ui/slider.jsx';
import { logger } from '../../../lib/logger.js';

// BUG-015 instrumentation — only the BodyAngle params get logged so the
// Logs panel stays uncluttered. paramSet (in paramValuesStore) NOT firing
// during a livePreview drag pinned the bug to the slider→store boundary;
// these two probes split that boundary in two.
const TRACED_PARAMS = new Set(['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']);

// slider.jsx is a forwardRef without JSDoc, so tsc can't see its
// passthrough props. Cast to a permissive type — runtime stays the
// same Radix Slider.
/** @type {React.ComponentType<{min:number,max:number,step:number,value:number[],onValueChange:(v:number[])=>void,onPointerDown?:(e:React.PointerEvent)=>void}>} */
const Slider = /** @type {any} */ (SliderImpl);

/**
 * @param {Object} props
 * @param {import('./groupBuilder.js').ParamSpecLike} props.param
 */
export function ParamRow({ param }) {
  const value = useParamValuesStore((s) => s.values[param.id] ?? param.default ?? 0);
  const setParamValue = useParamValuesStore((s) => s.setParamValue);
  const select = useSelectionStore((s) => s.select);
  // Treat the active selection's id as "selected" for this row.
  const activeId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'parameter') return items[i].id;
    }
    return null;
  });
  const selected = activeId === param.id;

  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const range = max - min;
  const step = range >= 5 ? 1 : 0.01;
  const fmt  = step >= 1 ? Number(value).toFixed(0) : Number(value).toFixed(2);

  /** Reset this param to its default value. Used by both the
   *  right-click context menu and the readout double-click. */
  function resetToDefault() {
    const def = typeof param.default === 'number' ? param.default : 0;
    setParamValue(param.id, def);
  }

  return (
    <div
      className={
        'flex flex-col gap-1 px-2 py-1 rounded transition-colors cursor-default ' +
        (selected ? 'bg-primary/15' : 'hover:bg-muted/30')
      }
      // Click anywhere on the row (except the slider thumb itself) → select.
      onClick={(e) => {
        // Skip clicks on the Radix slider thumb / track so dragging
        // doesn't fight selection.
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[role="slider"], [data-orientation]')) return;
        /** @type {'replace'|'add'|'toggle'} */
        let modifier = 'replace';
        if (e.shiftKey) modifier = 'add';
        else if (e.ctrlKey || e.metaKey) modifier = 'toggle';
        select({ type: 'parameter', id: param.id }, modifier);
      }}
      // Right-click → reset to default. Bypasses the browser's
      // default context menu so the user gets one-action reset
      // without leaving the keyboard / mouse.
      onContextMenu={(e) => {
        e.preventDefault();
        resetToDefault();
      }}
      // Double-click on the row also resets — the readout area
      // catches its own double-click below for the same gesture
      // when the slider would otherwise eat the event.
      onDoubleClick={(e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[role="slider"], [data-orientation]')) return;
        resetToDefault();
      }}
      title="Right-click or double-click to reset to default"
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate font-medium" title={param.id}>
          {param.name || param.id}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums font-mono text-[10px]">
          {fmt}
          <span className="text-muted-foreground/50 ml-1">
            [{min}, {max}]
          </span>
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onPointerDown={TRACED_PARAMS.has(param.id) ? () => {
          logger.debug('paramRow', `${param.id} pointerDown`, { id: param.id, currentValue: value });
        } : undefined}
        onValueChange={([v]) => {
          if (TRACED_PARAMS.has(param.id)) {
            logger.debug('paramRow', `${param.id} onValueChange → ${v}`, { id: param.id, v, prev: value });
          }
          setParamValue(param.id, v);
          // Auto-keyframe in animation mode: write a keyframe on the
          // parameter track at the current playhead time. The
          // animation tick reads `paramId` tracks via
          // `computeParamOverrides` and feeds them into chainEval.
          const ed = useEditorStore.getState();
          if (getEditorMode() !== 'animation' || !ed.autoKeyframe) return;
          const an = useAnimationStore.getState();
          const proj = useProjectStore.getState().project;
          const activeAnim = proj.animations.find((a) => a.id === an.activeAnimationId);
          if (!activeAnim) return;
          useProjectStore.getState().updateProject((p) => {
            const a = p.animations.find((aa) => aa.id === activeAnim.id);
            if (a) setParamKeyframeAt(a, param.id, an.currentTime, v, 'ease-both');
          });
        }}
      />
    </div>
  );
}
