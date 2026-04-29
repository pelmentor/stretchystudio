// @ts-check

/**
 * v3 Phase 1B — VariantTab.
 *
 * Read-only inspector for variant relationships between parts. Two
 * directions:
 *
 *   - The selected part is a VARIANT of another part (`variantOf`
 *     set): show the base, the suffix, the auto-registered driving
 *     parameter `Param<Suffix>`, and the canonical fade rule
 *     (variant 0→1 linear, base 1→0 linear unless backdrop).
 *
 *   - The selected part is a BASE that has variants pointing at it:
 *     list each child variant + suffix, surface backdrop status (no
 *     base-fade for face/ears/front-hair/back-hair tags).
 *
 * Editing variants in v3 is a Phase 5+ "asset library" / sticker
 * overlay concern — this tab is the diagnostic surface so users can
 * understand *why* a base or variant fades (or doesn't) without
 * leaving v3.
 *
 * The plan-of-record fade semantics live in
 * `feedback_variant_plateau_ramp` (memory): variant: 2-keyform
 * linear 0→1 on Param<Suffix>; non-backdrop base: 2-keyform linear
 * 1→0 on the same param; backdrops never fade.
 *
 * @module v3/editors/properties/tabs/VariantTab
 */

import { Layers, Eye, Link, ArrowRight } from 'lucide-react';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { matchTag } from '../../../../io/armatureOrganizer.js';
import { DEFAULT_BACKDROP_TAGS } from '../../../../io/live2d/rig/variantFadeRules.js';

/**
 * @param {Object} props
 * @param {string} props.nodeId
 */
export function VariantTab({ nodeId }) {
  const nodes = useProjectStore((s) => s.project?.nodes ?? []);
  const variantFadeRules = useProjectStore((s) => s.project?.variantFadeRules);
  const setSelection = useSelectionStore((s) => s.setSelection);

  const node = nodes.find((n) => n?.id === nodeId);
  if (!node) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Node not found.
      </div>
    );
  }

  const backdropTags = resolveBackdropTags(variantFadeRules);

  // Variant-child branch: this node points at a base.
  if (node.variantOf) {
    const base = nodes.find((n) => n?.id === node.variantOf);
    return (
      <div className="flex flex-col gap-1.5 p-2 overflow-auto">
        <Section label="Variant of base" icon={<Layers size={11} />}>
          <Row label="Base part">
            <PartLink node={base} fallbackId={node.variantOf} onSelect={setSelection} />
          </Row>
          <Row label="Suffix">
            <span className="text-xs text-foreground font-mono">
              .{node.variantSuffix ?? '—'}
            </span>
          </Row>
          <Row label="Driving param">
            <code className="text-xs text-foreground font-mono">
              Param{capitalize(node.variantSuffix ?? '')}
            </code>
          </Row>
        </Section>

        <FadeRuleSection
          isVariant
          baseIsBackdrop={base ? isBackdropPart(base, backdropTags) : false}
        />
      </div>
    );
  }

  // Base branch: list any variants that target this node.
  const children = nodes.filter((n) => n?.variantOf === nodeId);
  if (children.length > 0) {
    const isBackdrop = isBackdropPart(node, backdropTags);
    return (
      <div className="flex flex-col gap-1.5 p-2 overflow-auto">
        <Section label={`Has ${children.length} variant${children.length === 1 ? '' : 's'}`} icon={<Layers size={11} />}>
          {isBackdrop ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <Eye size={11} />
              backdrop tag — base never fades, variants layer on top
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              non-backdrop — base fades 1→0 on driving param while variant fades 0→1
            </div>
          )}
        </Section>

        <Section label="Variants">
          <div className="flex flex-col gap-1">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelection([{ type: 'part', id: c.id }])}
                className="flex items-center justify-between gap-2 text-[11px] font-mono px-1.5 py-1 rounded hover:bg-muted/40 transition-colors text-left"
                title={`Open ${c.name ?? c.id}`}
              >
                <span className="text-foreground truncate">{c.name ?? c.id}</span>
                <span className="flex items-center gap-1 text-muted-foreground shrink-0">
                  <span>.{c.variantSuffix ?? '?'}</span>
                  <ArrowRight size={10} />
                  <code>Param{capitalize(c.variantSuffix ?? '')}</code>
                </span>
              </button>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  // Defensive — `applies()` shouldn't let us land here, but keep a
  // sane empty state in case of stale selection on a node that was
  // mid-edit when the variant link was dropped.
  return (
    <div className="p-3 text-xs text-muted-foreground">
      No variant relationship.
    </div>
  );
}

function FadeRuleSection({ isVariant, baseIsBackdrop }) {
  return (
    <Section label="Fade rule" icon={<Link size={11} />}>
      {isVariant ? (
        <>
          <Row label="This part">
            <span className="text-[11px] text-foreground">
              opacity 0 → 1 (linear, on driving param)
            </span>
          </Row>
          <Row label="Base">
            {baseIsBackdrop ? (
              <span className="text-[11px] text-emerald-400">
                backdrop — stays at 1 (never fades)
              </span>
            ) : (
              <span className="text-[11px] text-foreground">
                opacity 1 → 0 (linear crossfade)
              </span>
            )}
          </Row>
        </>
      ) : null}
    </Section>
  );
}

function PartLink({ node, fallbackId, onSelect }) {
  if (!node) {
    return (
      <span className="text-xs text-destructive font-mono">
        {fallbackId} (missing)
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect([{ type: 'part', id: node.id }])}
      className="text-xs text-foreground underline-offset-2 hover:underline truncate text-left"
      title={`Open ${node.name ?? node.id}`}
    >
      {node.name ?? node.id}
    </button>
  );
}

function Section({ label, icon = null, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}

/**
 * @param {{backdropTags?: string[]}|null|undefined} variantFadeRules
 * @returns {string[]}
 */
function resolveBackdropTags(variantFadeRules) {
  if (
    variantFadeRules &&
    Array.isArray(variantFadeRules.backdropTags) &&
    variantFadeRules.backdropTags.length > 0
  ) {
    return variantFadeRules.backdropTags;
  }
  return [...DEFAULT_BACKDROP_TAGS];
}

/**
 * @param {{name?: string}} node
 * @param {string[]} backdropTags
 */
function isBackdropPart(node, backdropTags) {
  const tag = matchTag(node?.name ?? '');
  return tag != null && backdropTags.includes(tag);
}

/** Suffix style: 'smile' → 'Smile', 'happy_blink' → 'HappyBlink'. */
function capitalize(s) {
  if (!s) return '';
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}
