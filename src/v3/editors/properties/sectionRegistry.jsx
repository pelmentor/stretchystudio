// @ts-check

/**
 * V4 Phase 1 — Properties section registry.
 *
 * Replaces `tabRegistry.jsx`. Where the old registry produced a single
 * tab strip (one tab visible at a time), the new one produces a list
 * of contextually-visible sections that render simultaneously in a
 * single scrollable column — Blender's Properties Editor pattern.
 *
 * Each entry has:
 *   - id        — stable key (used for collapse persistence in
 *                 editorStore.propertiesSectionsCollapsed and as the
 *                 SectionShell id).
 *   - label     — fallback section label (the SectionShell inside each
 *                 component owns the user-facing label).
 *   - isVisible — pure predicate: does this section apply to the
 *                 current selection + project state?
 *   - render    — () => JSX
 *
 * Order in the array is the canonical top-to-bottom order, locked in
 * V4_BLENDER_PARITY_PLAN §3:
 *
 *   Transform · Visibility · Part Info · Mesh · Shape Keys ·
 *   Mask · Variant · Bone · Physics · Deformer · Bindings · Keyforms ·
 *   Parameter · Rig Stages
 *
 * Visibility rules collapse to: only show a section when the data it
 * edits exists on the selected node (or, for Track 3 keyform edit
 * authoring, is being authored).
 *
 * @module v3/editors/properties/sectionRegistry
 */

import { TransformSection } from './sections/TransformSection.jsx';
import { VisibilitySection } from './sections/VisibilitySection.jsx';
import { PartInfoSection } from './sections/PartInfoSection.jsx';
import { ModifierStackSection } from './sections/ModifierStackSection.jsx';
import { BoneSection } from './sections/BoneSection.jsx';
import { DeformerInfoSection } from './sections/DeformerInfoSection.jsx';
import { DeformerBindingsSection } from './sections/DeformerBindingsSection.jsx';
import { DeformerKeyformsSection } from './sections/DeformerKeyformsSection.jsx';
import { VertexGroupsSection } from './sections/VertexGroupsSection.jsx';
import {
  MeshSection,
  ShapeKeysSection,
  MaskSection,
  VariantSection,
  PhysicsSection,
  ParameterSection,
  RigStagesSection,
} from './sections/WrappedTabSections.jsx';
import { getMesh, isBoneGroup } from '../../../store/objectDataAccess.js';

/**
 * @typedef {Object} SectionContext
 * @property {{type:string, id:string}} active
 * @property {object} project
 *
 * @typedef {Object} SectionDef
 * @property {string} id
 * @property {string} label
 * @property {(ctx: SectionContext) => boolean} isVisible
 * @property {(ctx: SectionContext) => JSX.Element} render
 */

/** @type {SectionDef[]} */
export const PROPERTIES_SECTIONS = [
  {
    id: 'transform',
    label: 'Transform',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
    render: ({ active }) => <TransformSection nodeId={active.id} />,
  },
  {
    id: 'visibility',
    label: 'Visibility',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
    render: ({ active }) => <VisibilitySection nodeId={active.id} />,
  },
  {
    id: 'partInfo',
    label: 'Part Info',
    isVisible: ({ active }) => active.type === 'part',
    render: ({ active }) => <PartInfoSection nodeId={active.id} />,
  },
  {
    id: 'modifierStack',
    label: 'Modifier Stack',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return Array.isArray(node?.modifiers) && node.modifiers.length > 0;
    },
    render: ({ active }) => <ModifierStackSection nodeId={active.id} />,
  },
  {
    id: 'mesh',
    label: 'Mesh',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!getMesh(node, project);
    },
    render: ({ active }) => <MeshSection nodeId={active.id} />,
  },
  {
    // Visible for ANY meshed part (not just bone-bound ones) — discovery
    // matters more than chrome economy here. Parts without bone-binding
    // render the section with an empty-state hint explaining what
    // bone-binding is + how the auto-rig sets it. Pre-2026-05-05 the
    // gate was `meshHasVertexGroups(node)` which made the section
    // invisible on most parts and the user couldn't find Weight Paint.
    id: 'vertexGroups',
    label: 'Vertex Groups',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!getMesh(node, project);
    },
    render: ({ active }) => <VertexGroupsSection nodeId={active.id} />,
  },
  {
    id: 'shapeKeys',
    label: 'Shape Keys',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!getMesh(node, project);
    },
    render: ({ active }) => <ShapeKeysSection nodeId={active.id} />,
  },
  {
    id: 'mask',
    label: 'Mask Config',
    isVisible: ({ active }) => active.type === 'part',
    render: ({ active }) => <MaskSection nodeId={active.id} />,
  },
  {
    id: 'variant',
    label: 'Variant',
    isVisible: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const nodes = project?.nodes ?? [];
      const node = nodes.find((n) => n?.id === active.id);
      if (!node) return false;
      if (node.variantOf) return true;
      return nodes.some((n) => n?.variantOf === active.id);
    },
    render: ({ active }) => <VariantSection nodeId={active.id} />,
  },
  {
    id: 'bone',
    label: 'Bone',
    isVisible: ({ active, project }) => {
      if (active.type !== 'group') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return isBoneGroup(node);
    },
    render: ({ active }) => <BoneSection nodeId={active.id} />,
  },
  {
    id: 'physics',
    label: 'Physics',
    isVisible: ({ active, project }) => {
      if (active.type !== 'group') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return isBoneGroup(node);
    },
    render: ({ active }) => <PhysicsSection nodeId={active.id} />,
  },
  {
    id: 'deformerInfo',
    label: 'Deformer',
    isVisible: ({ active }) => active.type === 'deformer',
    render: ({ active }) => <DeformerInfoSection deformerId={active.id} />,
  },
  {
    id: 'deformerBindings',
    label: 'Bindings',
    isVisible: ({ active }) => active.type === 'deformer',
    render: ({ active }) => <DeformerBindingsSection deformerId={active.id} />,
  },
  {
    id: 'deformerKeyforms',
    label: 'Keyforms',
    isVisible: ({ active }) => active.type === 'deformer',
    render: ({ active }) => <DeformerKeyformsSection deformerId={active.id} />,
  },
  {
    id: 'parameter',
    label: 'Parameter',
    isVisible: ({ active }) => active.type === 'parameter',
    render: ({ active }) => <ParameterSection parameterId={active.id} />,
  },
  {
    id: 'rigStages',
    label: 'Rig Stages',
    isVisible: ({ active }) => active.type === 'part' || active.type === 'group',
    render: () => <RigStagesSection />,
  },
];

/**
 * Compute the visible section list for a given selection + project
 * snapshot. Output order is the canonical PROPERTIES_SECTIONS order.
 *
 * @param {SectionContext} ctx
 * @returns {SectionDef[]}
 */
export function sectionsFor(ctx) {
  return PROPERTIES_SECTIONS.filter((s) => {
    try { return s.isVisible(ctx); } catch { return false; }
  });
}
