// @ts-check

/**
 * v3 Phase 1B — BlendShapeTab.
 *
 * Sub-tab of Properties shown when a `part` is selected and that
 * part has at least one blend shape attached. Lists each shape with
 * its name, current influence value, and edit / delete buttons.
 *
 * Edits go through the existing projectStore actions
 * (createBlendShape / deleteBlendShape / setBlendShapeValue) so the
 * undo / animation / GPU-upload pipeline stays unchanged. The brush-
 * based delta editor (v2 toolbar gesture) is not in this tab — that
 * needs the v2 viewport edit-mode plumbing; lands as a Phase 2C
 * substage.
 *
 * @module v3/editors/properties/tabs/BlendShapeTab
 */

import { useProjectStore } from '../../../../store/projectStore.js';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { TextField } from '../fields/TextField.jsx';
import { NumberField } from '../fields/NumberField.jsx';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function BlendShapeTab({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );
  const updateProject     = useProjectStore((s) => s.updateProject);
  const createBlendShape  = useProjectStore((s) => s.createBlendShape);
  const deleteBlendShape  = useProjectStore((s) => s.deleteBlendShape);
  const setBlendShapeValue = useProjectStore((s) => s.setBlendShapeValue);

  if (!node || node.type !== 'part') {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Selected item is not a part.
      </div>
    );
  }
  if (!node.mesh) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Part has no mesh — generate one before adding blend shapes.
      </div>
    );
  }

  const shapes = node.blendShapes ?? [];
  const values = node.blendShapeValues ?? {};

  function renameShape(shapeId, newName) {
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      const s = n?.blendShapes?.find((ss) => ss.id === shapeId);
      if (s) s.name = newName;
    });
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section
        label={`Blend Shapes (${shapes.length})`}
        icon={<Sparkles size={11} />}
        action={
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            onClick={() => createBlendShape(nodeId, `Key ${shapes.length + 1}`)}
            title="Add a new blend shape (zero deltas)"
          >
            <Plus size={11} /> add
          </button>
        }
      >
        {shapes.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            No blend shapes. Click <em>add</em> to create one.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {shapes.map((shape) => (
              <ShapeRow
                key={shape.id}
                shape={shape}
                value={values[shape.id] ?? 0}
                onRename={(name) => renameShape(shape.id, name)}
                onSetValue={(v) => setBlendShapeValue(nodeId, shape.id, v)}
                onDelete={() => deleteBlendShape(nodeId, shape.id)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function ShapeRow({ shape, value, onRename, onSetValue, onDelete }) {
  return (
    <div className="flex flex-col gap-1 p-1.5 rounded bg-card/30 border border-border/60">
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <TextField label="Name" value={shape.name ?? ''} onCommit={onRename} />
        </div>
        <button
          type="button"
          className="h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
          onClick={onDelete}
          title="Delete blend shape"
          aria-label="Delete blend shape"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <NumberField
        label="Influence"
        value={value}
        step={0.05}
        min={0}
        max={1}
        precision={2}
        onCommit={onSetValue}
      />
      <div className="text-[10px] text-muted-foreground/70 px-0.5">
        deltas: {shape.deltas?.length ?? 0}
      </div>
    </div>
  );
}

function Section({ label, icon = null, action = null, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
          {label}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
