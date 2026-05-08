// @ts-check

/**
 * V4 Phase 1 — thin wrappers that pull existing tab components into the
 * Properties layout. Each wrapper slaps a `SectionShell` around the
 * existing tab so it looks like a collapsible section in the stack.
 *
 * Where the underlying tab carries its own internal padding / sub-cards,
 * we strip the SectionShell body padding via the `-mx-2 -mb-2` bleed so
 * the inner chrome reads through cleanly.
 *
 * Icons match the Properties tab-axis registry — when the tab axis
 * surfaces "Object Data" with a Database icon, the sections inside use
 * the matching downstream icons (Triangle for Mesh, Sparkles for Shape
 * Keys, etc.) so the user can scan at a glance.
 *
 * @module v3/editors/properties/sections/WrappedTabSections
 */

import {
  Triangle,
  Sparkles,
  Scissors,
  UserCircle2,
  Zap,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
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
    <SectionShell id="mesh" label="Mesh" icon={<Triangle size={11} />}>
      <div className="-mx-2 -mb-2"><MeshTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function ShapeKeysSection({ nodeId }) {
  return (
    <SectionShell id="shapeKeys" label="Shape Keys" icon={<Sparkles size={11} />}>
      <div className="-mx-2 -mb-2"><BlendShapeTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function MaskSection({ nodeId }) {
  return (
    <SectionShell id="mask" label="Mask Config" icon={<Scissors size={11} />}>
      <div className="-mx-2 -mb-2"><MaskTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function VariantSection({ nodeId }) {
  return (
    <SectionShell id="variant" label="Variant" icon={<UserCircle2 size={11} />}>
      <div className="-mx-2 -mb-2"><VariantTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ nodeId: string }} props */
export function PhysicsSection({ nodeId }) {
  return (
    <SectionShell id="physics" label="Physics" icon={<Zap size={11} />}>
      <div className="-mx-2 -mb-2"><PhysicsTab nodeId={nodeId} /></div>
    </SectionShell>
  );
}

/** @param {{ parameterId: string }} props */
export function ParameterSection({ parameterId }) {
  return (
    <SectionShell id="parameter" label="Parameter" icon={<SlidersHorizontal size={11} />}>
      <div className="-mx-2 -mb-2"><ParameterTab parameterId={parameterId} /></div>
    </SectionShell>
  );
}

export function RigStagesSection() {
  return (
    <SectionShell id="rigStages" label="Rig Stages" icon={<Workflow size={11} />}>
      <div className="-mx-2 -mb-2"><RigStagesTab /></div>
    </SectionShell>
  );
}
