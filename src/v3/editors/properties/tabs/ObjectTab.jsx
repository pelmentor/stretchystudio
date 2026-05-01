// @ts-check

/**
 * v3 Phase 1B — ObjectTab: name, transform, opacity, visibility.
 *
 * Renders for any selected `part` or `group`. The transform fields
 * map directly to `node.transform` ({x, y, rotation, scaleX, scaleY,
 * pivotX, pivotY}). Each commit goes through `updateProject` so it's
 * undoable.
 *
 * Phase 1B follow-up tabs (Mesh / BlendShape / Deformer / etc.)
 * gate on type — ObjectTab is the always-present tab and the
 * fallback when a more specific tab doesn't apply.
 *
 * @module v3/editors/properties/tabs/ObjectTab
 */

import { useProjectStore } from '../../../../store/projectStore.js';
import { NumberField } from '../fields/NumberField.jsx';
import { TextField } from '../fields/TextField.jsx';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';

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
export function ObjectTab({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );
  const updateProject = useProjectStore((s) => s.updateProject);

  if (!node) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Selected item is no longer in the project.
      </div>
    );
  }

  /** @param {(n:any) => void} fn */
  function patch(fn) {
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      if (n) fn(n);
    });
  }

  const t = node.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
  const opacity = typeof node.opacity === 'number' ? node.opacity : 1;
  const visible = node.visible !== false;

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section label={node.type === 'group' ? 'Group' : 'Part'}>
        <TextField
          label="Name"
          value={node.name ?? ''}
          onCommit={(v) => patch((n) => { n.name = v; })}
        />
        <div className="flex items-center gap-2 text-xs h-7">
          <span className="w-20 shrink-0 text-muted-foreground">Visible</span>
          <button
            type="button"
            className="h-6 px-2 rounded border border-border bg-muted/40 hover:bg-muted/60 flex items-center gap-1.5 text-foreground"
            onClick={() => patch((n) => { n.visible = !visible; })}
          >
            {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            <span>{visible ? 'Visible' : 'Hidden'}</span>
          </button>
        </div>
        <NumberField
          label="Opacity"
          value={opacity}
          step={0.05}
          min={0}
          max={1}
          precision={2}
          onCommit={(v) => patch((n) => { n.opacity = v; })}
        />
      </Section>

      <Section label="Transform">
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
      </Section>

      <Section label="Pivot">
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
        {/* GAP-014 — single-click revert when transform got nudged into a
            bad state. Plain <button> (matches the Visible/Hidden toggle
            above) instead of the Button component so the file's
            // @ts-check directive doesn't trip on Button's forwardRef
            children inference. Goes through patch so it's undoable. */}
        <button
          type="button"
          className="h-7 mt-1 px-2 text-[11px] rounded border border-border bg-muted/40 hover:bg-muted/60 flex items-center justify-center gap-1.5 text-foreground"
          onClick={() => patch((n) => { n.transform = { ...IDENTITY_TRANSFORM }; })}
        >
          <RotateCcw size={11} />
          <span>Reset Transform</span>
        </button>
      </Section>

      {node.type === 'part' ? (
        <Section label="Part">
          <Row label="Draw order">
            <NumberField
              label=""
              value={typeof node.draw_order === 'number' ? node.draw_order : 0}
              step={1}
              precision={0}
              onCommit={(v) => patch((n) => { n.draw_order = v; })}
            />
          </Row>
          <Row label="Vertices">
            <span className="text-xs text-foreground tabular-nums">
              {node.mesh?.vertices?.length ?? 0}
            </span>
          </Row>
          <Row label="Triangles">
            <span className="text-xs text-foreground tabular-nums">
              {node.mesh?.triangles ? node.mesh.triangles.length / 3 : 0}
            </span>
          </Row>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-7">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  );
}
