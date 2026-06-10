// @ts-check

/**
 * v3 Phase 1D — Single parameter row, Blender Shape-Keys-style slider.
 *
 * Visual model mirrors Blender's `layout.prop(kb, "value")` row in the
 * Shape Keys panel (`reference/blender/scripts/startup/bl_ui/
 * properties_data_mesh.py:265-292`): one composite horizontal bar that
 * combines name, value, and the slider track into a single visual
 * element. The fill renders left→right based on `(value-min)/range`
 * just like Blender's `uiBut` "BUT_TYPE_NUMSLI". Clicking anywhere on
 * the bar drag-scrubs the value (Radix's slider supports
 * click-to-set + drag-to-scrub out of the box).
 *
 * A small leftmost dot indicates animation state:
 *   - green dot  ▎the param has an fcurve in the active action
 *   - dim dot    ▎no fcurve (Blender's "not animated" state)
 *
 * Press `I` while hovering the row to insert a keyframe at the current
 * scrubber time. Mirrors Blender's per-button I-key (UI keymap binds
 * `ANIM_OT_keyframe_insert_button` to `I` over any animatable button —
 * `editors/animation/keyframing_ops_rna.cc::ANIM_OT_keyframe_insert_button`).
 * The hover handler is owned by `ParametersEditor` (one window listener
 * instead of N per-row listeners); this row only updates the parent's
 * `hoveredParamIdRef` on pointerenter/leave.
 *
 * @module v3/editors/parameters/ParamRow
 */

import { memo, useState } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Trash2, Check, X } from 'lucide-react';
import { useParamValuesStore } from '../../../store/paramValuesStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { getEditorMode } from '../../../store/uiV3Store.js';
import { autoKeyParamProperty, findParamFCurve } from '../../../renderer/animationEngine.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { logger } from '../../../lib/logger.js';

// BUG-015 instrumentation — only the BodyAngle params get logged so the
// Logs panel stays uncluttered. paramSet (in paramValuesStore) NOT firing
// during a livePreview drag pinned the bug to the slider→store boundary;
// these two probes split that boundary in two.
const TRACED_PARAMS = new Set(['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']);

/**
 * @param {Object} props
 * @param {import('./groupBuilder.js').ParamSpecLike} props.param
 * @param {boolean} props.selected
 * @param {boolean} props.isKeyed
 *   true iff the active action has an fcurve for this param — drives
 *   the leftmost animated-state dot.
 * @param {React.MutableRefObject<string|null>} props.hoveredParamIdRef
 *   Shared with ParametersEditor for the window-level I-key handler.
 */
function ParamRowImpl({ param, selected, isKeyed, hoveredParamIdRef }) {
  const value = useParamValuesStore((s) => s.values[param.id] ?? param.default ?? 0);
  const setParamValue = useParamValuesStore((s) => s.setParamValue);
  const select = useSelectionStore((s) => s.select);
  const removeParameter = useProjectStore((s) => s.removeParameter);
  const [pendingDelete, setPendingDelete] = useState(false);

  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const range = max - min;
  const step = range >= 5 ? 1 : 0.01;
  const fmt  = step >= 1 ? Number(value).toFixed(0) : Number(value).toFixed(2);

  function resetToDefault() {
    const def = typeof param.default === 'number' ? param.default : 0;
    setParamValue(param.id, def);
  }

  function onValueChange(/** @type {number[]} */ next) {
    const v = next[0];
    if (TRACED_PARAMS.has(param.id)) {
      logger.debug('paramRow', `${param.id} onValueChange → ${v}`, { id: param.id, v, prev: value });
    }
    setParamValue(param.id, v);
    // Auto-keyframe in animation mode. This is Blender's UI-button
    // auto-key path (`button_anim_autokey` → `autokeyframe_property`
    // with `only_if_property_keyed=true`): a slider drag only
    // MAINTAINS an existing param fcurve, never creates one, and is
    // scoped to the touched param alone (NOT routed through
    // `runAutoKey`/`project.autoKeyMode`). The first keyframe is
    // inserted via the I-menu, the per-row I-key, or the AllParams
    // keying set. See `autoKeyParamProperty`.
    const ed = useEditorStore.getState();
    if (getEditorMode() !== 'animation' || !ed.autoKeyframe) return;
    const an = useAnimationStore.getState();
    const proj = useProjectStore.getState().project;
    const activeAction = getActiveSceneAction(proj, an.activeActionId);
    if (!activeAction || !findParamFCurve(activeAction, param.id)) return;
    useProjectStore.getState().updateProject((p) => {
      const a = p.actions.find((aa) => aa.id === activeAction.id);
      if (a) autoKeyParamProperty(a, param.id, an.currentTime, v, 'ease-both');
    });
  }

  return (
    <div
      className={
        'group/row relative flex items-center gap-1 px-2 py-0.5 cursor-default ' +
        (selected ? 'bg-primary/15' : '')
      }
      onPointerEnter={() => { hoveredParamIdRef.current = param.id; }}
      onPointerLeave={() => {
        if (hoveredParamIdRef.current === param.id) hoveredParamIdRef.current = null;
      }}
      onClick={(e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[role="slider"], [data-orientation]')) return;
        /** @type {'replace'|'add'|'toggle'} */
        let modifier = 'replace';
        if (e.shiftKey) modifier = 'add';
        else if (e.ctrlKey || e.metaKey) modifier = 'toggle';
        select({ type: 'parameter', id: param.id }, modifier);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        resetToDefault();
      }}
      onDoubleClick={(e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[role="slider"], [data-orientation]')) return;
        resetToDefault();
      }}
      title={
        (param.name || param.id) +
        ' — hover + press I to keyframe, right-click to reset, drag to scrub'
      }
    >
      {/* Composite slider — Blender Shape Keys row shape. The Radix
          slider primitives provide click-to-set + drag-to-scrub +
          keyboard a11y; the visible chrome is our overlay. The
          SliderThumb is sized to 0px so it doesn't render but Radix
          still tracks pointer/keyboard focus through it. */}
      <SliderPrimitive.Root
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={onValueChange}
        onPointerDown={TRACED_PARAMS.has(param.id) ? () => {
          logger.debug('paramRow', `${param.id} pointerDown`, { id: param.id, currentValue: value });
        } : undefined}
        className="relative flex flex-1 h-6 items-center touch-none select-none"
      >
        <SliderPrimitive.Track className="relative w-full h-full grow rounded-sm border border-border/60 bg-muted/40 overflow-hidden">
          {/* Fill bar — Blender's BUT_TYPE_NUMSLI fill colour, SS
              substitutes a translucent primary. */}
          <SliderPrimitive.Range className="absolute inset-y-0 left-0 bg-primary/35" />
          {/* Animated-state dot. Bright when the active action has an
              fcurve for this param. `pointer-events-none` so it never
              eats slider clicks. */}
          <span
            className={
              'absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none ' +
              (isKeyed ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.55)]' : 'bg-muted-foreground/30')
            }
            aria-hidden="true"
          />
          {/* Name + value overlay. The text container is
              pointer-events-none so the entire bar drags as one
              unit. textShadow keeps labels legible over the fill. */}
          <div className="absolute inset-0 flex items-center pl-4 pr-2 gap-2 text-[11px] pointer-events-none">
            <span
              className="flex-1 truncate font-medium text-foreground/95"
              style={{ textShadow: '0 0 2px rgba(0,0,0,0.75)' }}
            >
              {param.name || param.id}
            </span>
            <span
              className="tabular-nums font-mono text-[10px] text-foreground/90 shrink-0"
              style={{ textShadow: '0 0 2px rgba(0,0,0,0.75)' }}
            >
              {fmt}
              <span className="text-muted-foreground/60 ml-1">
                [{min}, {max}]
              </span>
            </span>
          </div>
        </SliderPrimitive.Track>
        {/* Invisible thumb — keeps Radix's keyboard a11y + focus ring
            working without painting a visible knob. */}
        <SliderPrimitive.Thumb className="block w-0 h-0 focus-visible:outline-none" />
      </SliderPrimitive.Root>
      {/* Delete affordance — only reveals on row hover. Outside the
          slider so it never eats slider clicks. */}
      {pendingDelete ? (
        <span
          className="flex items-center gap-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="p-0.5 rounded hover:bg-destructive/30 text-destructive"
            title="Confirm delete (cascades through bindings, fcurves, physics inputs)"
            onClick={(e) => {
              e.stopPropagation();
              removeParameter(param.id);
              setPendingDelete(false);
            }}
          >
            <Check size={10} />
          </button>
          <button
            type="button"
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground"
            title="Cancel"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDelete(false);
            }}
          >
            <X size={10} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive opacity-0 group-hover/row:opacity-60 hover:opacity-100 transition-opacity shrink-0"
          title="Delete parameter (drops every reference)"
          onClick={(e) => {
            e.stopPropagation();
            setPendingDelete(true);
          }}
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

export const ParamRow = memo(ParamRowImpl);
