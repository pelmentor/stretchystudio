// @ts-check

/**
 * V4 Phase 1 — Transform section.
 *
 * Lifted out of `ObjectTab` (which previously held Object/Transform/Pivot
 * as inline sub-cards). This section owns: name, position, rotation,
 * scale, pivot, and the Reset Transform button. Visible whenever a
 * `part` or `group` is selected.
 *
 * @module v3/editors/properties/sections/TransformSection
 */

import { useMemo } from 'react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { NumberField } from '../fields/NumberField.jsx';
import { TextField } from '../fields/TextField.jsx';
import { Move, RotateCcw } from 'lucide-react';
import { SectionShell } from './SectionShell.jsx';

/** Identity transform — `node.transform` value after Reset Transform. */
const IDENTITY_TRANSFORM = Object.freeze({
  x: 0, y: 0, rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function TransformSection({ nodeId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
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

  const t = node.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };

  return (
    <SectionShell id="transform" label="Transform" icon={<Move size={11} />}>
      <TextField
        label="Name"
        value={node.name ?? ''}
        onCommit={(v) => patch((n) => { n.name = v; })}
      />
      <NumberField
        label="X"
        value={t.x ?? 0}
        step={1}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).x = v; })}
      />
      <NumberField
        label="Y"
        value={t.y ?? 0}
        step={1}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).y = v; })}
      />
      <NumberField
        label="Rotation"
        value={t.rotation ?? 0}
        step={1}
        precision={1}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).rotation = v; })}
      />
      <NumberField
        label="Scale X"
        value={t.scaleX ?? 1}
        step={0.05}
        precision={3}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).scaleX = v; })}
      />
      <NumberField
        label="Scale Y"
        value={t.scaleY ?? 1}
        step={0.05}
        precision={3}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).scaleY = v; })}
      />
      <NumberField
        label="Pivot X"
        value={t.pivotX ?? 0}
        step={1}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).pivotX = v; })}
      />
      <NumberField
        label="Pivot Y"
        value={t.pivotY ?? 0}
        step={1}
        onCommit={(v) => patch((n) => { (n.transform ??= {}).pivotY = v; })}
      />
      <button
        type="button"
        className="h-7 mt-1 px-2 text-[11px] rounded border border-border bg-muted/40 hover:bg-muted/60 flex items-center justify-center gap-1.5 text-foreground"
        onClick={() => patch((n) => { n.transform = { ...IDENTITY_TRANSFORM }; })}
      >
        <RotateCcw size={11} />
        <span>Reset Transform</span>
      </button>
    </SectionShell>
  );
}
