// @ts-check

/**
 * v3 Phase 1B — Properties editor.
 *
 * Reads the active item from `selectionStore` and dispatches to the
 * appropriate tab. First cut: ObjectTab only (the always-present
 * fallback that shows name / transform / opacity / visibility for
 * any selectable type that has those fields).
 *
 * Plan §4.2 lists 10+ tabs; each gets added here as it lands.
 * Currently other selectable types (parameter, deformer, keyframe,
 * physicsRule, maskConfig, variant) render the empty-state until
 * their tabs ship in Phase 1B subsequent substages and Phase 2
 * editors.
 *
 * @module v3/editors/properties/PropertiesEditor
 */

import { useSelectionStore } from '../../../store/selectionStore.js';
import { ObjectTab } from './tabs/ObjectTab.jsx';

export function PropertiesEditor() {
  const items = useSelectionStore((s) => s.items);
  const active = items.length > 0 ? items[items.length - 1] : null;

  if (!active) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        <span>Select something to inspect.</span>
      </div>
    );
  }

  // Multi-select hint — Plan §4.2 spec says CommonTab will eventually
  // show shared fields for multi-select. For now, surface the count
  // and operate on the active item only.
  const multiHint =
    items.length > 1 ? (
      <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border bg-muted/20">
        {items.length} items selected — editing active ({active.type}: {active.id})
      </div>
    ) : null;

  return (
    <div className="h-full w-full flex flex-col">
      {multiHint}
      <div className="flex-1 min-h-0 overflow-hidden">
        {active.type === 'part' || active.type === 'group' ? (
          <ObjectTab nodeId={active.id} />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">
            Properties for type{' '}
            <code className="text-foreground">{active.type}</code> coming in
            a later Phase 1B substage.
          </div>
        )}
      </div>
    </div>
  );
}
