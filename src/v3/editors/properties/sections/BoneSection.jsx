// @ts-check

/**
 * V4 Phase 1 — Bone section.
 *
 * Visible only for `type:'group' && boneRole`. v1 surfaces the bone
 * metadata SS already tracks (boneRole tag, segment index, parent
 * bone). Future tracks (skeleton edit, weight paint) will write here
 * — for v1 it's read-only.
 *
 * @module v3/editors/properties/sections/BoneSection
 */

import { Bone } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { SectionShell } from './SectionShell.jsx';
import { isBoneGroup, getBoneRole } from '../../../../store/objectDataAccess.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function BoneSection({ nodeId }) {
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n.id === nodeId) ?? null,
  );

  if (!isBoneGroup(node)) return null;

  return (
    <SectionShell id="bone" label="Bone" icon={<Bone size={11} />}>
      <Row label="Role">
        <code className="text-xs text-foreground">{getBoneRole(node)}</code>
      </Row>
      {typeof node.boneSegmentIndex === 'number' ? (
        <Row label="Segment">
          <span className="text-xs text-foreground tabular-nums">
            {node.boneSegmentIndex}
          </span>
        </Row>
      ) : null}
      {node.parent ? (
        <Row label="Parent">
          <span className="text-xs text-foreground truncate" title={node.parent}>
            {node.parent}
          </span>
        </Row>
      ) : null}
    </SectionShell>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}
