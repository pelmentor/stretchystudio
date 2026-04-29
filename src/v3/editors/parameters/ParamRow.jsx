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
import { Slider as SliderImpl } from '../../../components/ui/slider.jsx';

// slider.jsx is a forwardRef without JSDoc, so tsc can't see its
// passthrough props. Cast to a permissive type — runtime stays the
// same Radix Slider.
/** @type {React.ComponentType<{min:number,max:number,step:number,value:number[],onValueChange:(v:number[])=>void}>} */
const Slider = /** @type {any} */ (SliderImpl);

/**
 * @param {Object} props
 * @param {import('./groupBuilder.js').ParamSpecLike} props.param
 */
export function ParamRow({ param }) {
  const value = useParamValuesStore((s) => s.values[param.id] ?? param.default ?? 0);
  const setParamValue = useParamValuesStore((s) => s.setParamValue);

  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const range = max - min;
  const step = range >= 5 ? 1 : 0.01;
  const fmt  = step >= 1 ? Number(value).toFixed(0) : Number(value).toFixed(2);

  return (
    <div className="flex flex-col gap-1 px-2 py-1 rounded hover:bg-muted/30 transition-colors">
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
        onValueChange={([v]) => setParamValue(param.id, v)}
      />
    </div>
  );
}
