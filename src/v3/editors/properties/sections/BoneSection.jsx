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

import { useMemo } from 'react';
import { Bone } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { SectionShell } from './SectionShell.jsx';
import { PropertyRow } from '../primitives/PropertyRow.jsx';
import { isBoneGroup, getBoneRole } from '../../../../store/objectDataAccess.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function BoneSection({ nodeId }) {
  const nodes = useProjectStore((s) => s.project.nodes);
  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  );

  if (!isBoneGroup(node)) return null;

  return (
    <SectionShell id="bone" label="Bone" icon={<Bone size={11} />}>
      <PropertyRow label="Role">
        <code className="text-[11px] text-foreground">{getBoneRole(node)}</code>
      </PropertyRow>
      {typeof node.boneSegmentIndex === 'number' ? (
        <PropertyRow label="Segment">
          <span className="text-[11px] text-foreground tabular-nums">
            {node.boneSegmentIndex}
          </span>
        </PropertyRow>
      ) : null}
      {node.parent ? (
        <PropertyRow label="Parent">
          <span className="text-[11px] text-foreground truncate" title={node.parent}>
            {node.parent}
          </span>
        </PropertyRow>
      ) : null}
    </SectionShell>
  );
}
