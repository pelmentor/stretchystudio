// @ts-check

/**
 * V4 Phase 1 — thin wrappers that pull existing tab components into the
 * new sectioned Properties layout. The tabs themselves render their own
 * inner sub-section cards (Box / Row / NumberField etc) — they predate
 * Phase 1 and are still useful as integration units. Each wrapper here
 * just slaps a SectionShell around the existing tab so it looks like a
 * collapsible section in the stack.
 *
 * Where a tab's existing chrome would double-up with SectionShell's
 * header, this layer hides it. Where the tab already self-contains all
 * its visual sectioning, we just embed it.
 *
 * @module v3/editors/properties/sections/WrappedTabSections
 */

import { MeshTab } from '../tabs/MeshTab.jsx';
import { BlendShapeTab } from '../tabs/BlendShapeTab.jsx';
import { MaskTab } from '../tabs/MaskTab.jsx';
import { VariantTab } from '../tabs/VariantTab.jsx';
import { PhysicsTab } from '../tabs/PhysicsTab.jsx';
import { ParameterTab } from '../tabs/ParameterTab.jsx';
import { RigStagesTab } from '../tabs/RigStagesTab.jsx';
import { SectionShell } from './SectionShell.jsx';

/** @param {{ nodeId: string }} props */
export function MeshSection({ nodeId }) {
  return (
    <SectionShell id="mesh" label="Mesh">
      <div className="-mx-2 -mb-2"><MeshTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function ShapeKeysSection({ nodeId }) {
  return (
    <SectionShell id="shapeKeys" label="Shape Keys">
      <div className="-mx-2 -mb-2"><BlendShapeTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function MaskSection({ nodeId }) {
  return (
    <SectionShell id="mask" label="Mask Config">
      <div className="-mx-2 -mb-2"><MaskTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function VariantSection({ nodeId }) {
  return (
    <SectionShell id="variant" label="Variant">
      <div className="-mx-2 -mb-2"><VariantTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function PhysicsSection({ nodeId }) {
  return (
    <SectionShell id="physics" label="Physics">
      <div className="-mx-2 -mb-2"><PhysicsTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ parameterId: string }} props */
export function ParameterSection({ parameterId }) {
  return (
    <SectionShell id="parameter" label="Parameter">
      <div className="-mx-2 -mb-2"><ParameterTab parameterId={parameterId} /></div>
    </SectionShell>
  );
}

export function RigStagesSection() {
  return (
    <SectionShell id="rigStages" label="Rig Stages">
      <div className="-mx-2 -mb-2"><RigStagesTab /></div>
    </SectionShell>
  );
}
