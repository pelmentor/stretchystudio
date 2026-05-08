// @ts-check

/**
 * V4 Phase 1 — Visibility / Opacity section.
 *
 * Lifted out of `ObjectTab`. Owns the `visible` toggle + `opacity`
 * slider for any selected part or group.
 *
 * @module v3/editors/properties/sections/VisibilitySection
 */

import { Eye, EyeOff } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { Slider as SliderImpl } from '../../../../components/ui/slider.jsx';
import { logger } from '../../../../lib/logger.js';
import { SectionShell } from './SectionShell.jsx';
import { PropertyRow } from '../primitives/PropertyRow.jsx';

/** Radix Slider primitive — typed via cast since the shadcn export
 *  doesn't ship JSX-typed declarations. Same pattern as ParamRow. */
/** @type {React.ComponentType<{min:number,max:number,step:number,value:number[],onValueChange:(v:number[])=>void,className?:string}>} */
const Slider = /** @type {any} */ (SliderImpl);

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function VisibilitySection({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );
  const updateProject = useProjectStore((s) => s.updateProject);

  if (!node) return null;

  /** @param {(n:any) => void} fn */
  function patch(fn) {
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      if (n) fn(n);
    });
  }

  const opacity = typeof node.opacity === 'number' ? node.opacity : 1;
  const visible = node.visible !== false;

  return (
    <SectionShell id="visibility" label="Visibility" icon={<Eye size={11} />}>
      <PropertyRow label="Visible">
        <button
          type="button"
          className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 flex items-center gap-1.5 text-foreground self-start"
          onClick={() => patch((n) => { n.visible = !visible; })}
        >
          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
          <span>{visible ? 'Visible' : 'Hidden'}</span>
        </button>
      </PropertyRow>
      {/* BUG-005 fix — opacity is a 0..1 range, native fit for a drag
          slider. The previous `NumberField` was an edit-and-commit
          spinner: clicking the ▲/▼ arrows updated the input visually
          but only committed on blur, so the renderer never saw the
          change while the user was actively bumping the value. The
          Radix Slider commits on every onValueChange, matching the
          "drag to apply" mental model. */}
      <PropertyRow label="Opacity">
        <div className="flex items-center gap-2 w-full">
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[opacity]}
            onValueChange={([v]) => {
              logger.debug('opacityCommit', `${node.type} ${node.id} → ${v}`, {
                nodeId: node.id,
                nodeType: node.type,
                previousOpacity: opacity,
                nextOpacity: v,
              });
              patch((n) => { n.opacity = v; });
            }}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums text-foreground/85 text-[11px]">
            {opacity.toFixed(2)}
          </span>
        </div>
      </PropertyRow>
    </SectionShell>
  );
}
