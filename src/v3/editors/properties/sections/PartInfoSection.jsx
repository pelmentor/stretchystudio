// @ts-check

/**
 * V4 Phase 1 — Part Info section.
 *
 * Read-mostly summary card for parts: draw_order (editable), vertex
 * count, triangle count. Lifted out of the bottom sub-card of
 * `ObjectTab`. Visible only for `type:'part'`.
 *
 * @module v3/editors/properties/sections/PartInfoSection
 */

import { useProjectStore } from '../../../../store/projectStore.js';
import { NumberField } from '../fields/NumberField.jsx';
import { SectionShell } from './SectionShell.jsx';
import { getMesh } from '../../../../store/objectDataAccess.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function PartInfoSection({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );
  const updateProject = useProjectStore((s) => s.updateProject);

  if (!node || node.type !== 'part') return null;

  function patch(fn) {
    updateProject((proj) => {
      const n = proj.nodes.find((nn) => nn.id === nodeId);
      if (n) fn(n);
    });
  }

  const mesh = getMesh(node);

  return (
    <SectionShell id="partInfo" label="Part Info">
      <div className="flex items-center gap-2 text-xs h-7">
        <span className="w-20 shrink-0 text-muted-foreground">Draw order</span>
        <div className="flex-1 flex items-center">
          <NumberField
            label=""
            value={typeof node.draw_order === 'number' ? node.draw_order : 0}
            step={1}
            precision={0}
            onCommit={(v) => patch((n) => { n.draw_order = v; })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs h-6">
        <span className="w-20 shrink-0 text-muted-foreground">Vertices</span>
        <span className="text-xs text-foreground tabular-nums">
          {mesh?.vertices?.length ?? 0}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs h-6">
        <span className="w-20 shrink-0 text-muted-foreground">Triangles</span>
        <span className="text-xs text-foreground tabular-nums">
          {mesh?.triangles ? mesh.triangles.length / 3 : 0}
        </span>
      </div>
    </SectionShell>
  );
}
