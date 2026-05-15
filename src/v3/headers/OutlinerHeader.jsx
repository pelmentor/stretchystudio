// @ts-check

/**
 * OutlinerHeader — area-header chrome for the Outliner editor.
 *
 * Mirrors Blender's `OUTLINER_HT_header`
 * (`reference/blender/scripts/startup/bl_ui/space_outliner.py:22`)
 * which renders the display-mode dropdown + search input + filter
 * popover at the area's top edge. SS's pre-2026-05-16 outliner
 * inlined this header inside the editor body; F-1 lifts it into the
 * per-area Header slot so the chrome layers correctly with the Area
 * tab bar and matches Blender's `*_HT_header` per-area pattern.
 *
 * State source-of-truth lives on `editorStore` (slots `outlinerMode`,
 * `outlinerSearchQuery`, `outlinerShowSelectedOnly`, `outlinerHideHidden`)
 * so both this header and the OutlinerEditor body subscribe
 * independently — neither owns the state.
 *
 * @module v3/headers/OutlinerHeader
 */

import { useMemo } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useRigSpecStore } from '../../store/rigSpecStore.js';
import { isBoneGroup } from '../../store/objectDataAccess.js';
import * as SelectImpl from '../../components/ui/select.jsx';
import * as PopoverImpl from '../../components/ui/popover.jsx';
import * as CheckboxImpl from '../../components/ui/checkbox.jsx';

// shadcn/ui parts — same forwardRef-typing cast pattern as OutlinerEditor.
/** @type {Record<string, React.ComponentType<any>>} */
const Sel = /** @type {any} */ (SelectImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Pop = /** @type {any} */ (PopoverImpl);
/** @type {Record<string, React.ComponentType<any>>} */
const Chk = /** @type {any} */ (CheckboxImpl);
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = Sel;
const { Popover, PopoverContent, PopoverTrigger } = Pop;
const { Checkbox } = Chk;

/**
 * Display-mode dropdown options. View Layer matches Blender's
 * `SO_VIEW_LAYER` (`reference/blender/source/blender/makesdna/
 * DNA_space_enums.h:230`); Armature + Deformer Graph are SS-specific
 * tree shapes (deferred F-4 work folds Armature into a filter axis
 * inside OUTLINER_PT_filter).
 */
const MODES = /** @type {const} */ ([
  { id: 'viewLayer', label: 'View Layer' },
  { id: 'skeleton',  label: 'Armature' },
  { id: 'rig',       label: 'Deformer Graph' },
]);

export function OutlinerHeader() {
  const mode = useEditorStore((s) => s.outlinerMode);
  const setMode = useEditorStore((s) => s.setOutlinerMode);
  const query = useEditorStore((s) => s.outlinerSearchQuery);
  const setQuery = useEditorStore((s) => s.setOutlinerSearchQuery);
  const showSelectedOnly = useEditorStore((s) => s.outlinerShowSelectedOnly);
  const setShowSelectedOnly = useEditorStore((s) => s.setOutlinerShowSelectedOnly);
  const hideHidden = useEditorStore((s) => s.outlinerHideHidden);
  const setHideHidden = useEditorStore((s) => s.setOutlinerHideHidden);

  const nodes = useProjectStore((s) => s.project.nodes);
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  const rigAvailable = !!rigSpec;
  const skeletonAvailable = useMemo(
    () => nodes.some((n) => isBoneGroup(n)),
    [nodes],
  );

  const filterActive = showSelectedOnly || hideHidden;

  return (
    <div className="border-b border-border bg-muted/20 flex flex-col text-xs">
      <div className="flex items-center px-1.5 pt-1.5">
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger
            className="h-6 px-2 text-[11px] gap-1 bg-transparent border-0
                       hover:bg-background/50 focus:ring-0 focus:ring-offset-0
                       w-auto min-w-[110px]"
            aria-label="Outliner display scope"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-[180px]">
            {MODES.map((m) => {
              const disabled =
                (m.id === 'rig' && !rigAvailable)
                || (m.id === 'skeleton' && !skeletonAvailable);
              return (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  disabled={disabled}
                  className="text-[11px]"
                >
                  {m.label}
                  {disabled && m.id === 'rig' ? ' (no rig built)' : null}
                  {disabled && m.id === 'skeleton' ? ' (no armature)' : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center px-2 py-1 gap-1.5">
        <Search size={11} className="text-muted-foreground shrink-0" />
        <input
          type="text"
          value={query}
          placeholder="Search…"
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 h-6 px-1 bg-transparent border-0 text-[11px] focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="clear search"
          >
            <X size={11} />
          </button>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Filter"
              title="Filter"
              className={`shrink-0 transition-colors ${
                filterActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Filter size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2 text-[11px]">
            <div className="font-medium text-muted-foreground pb-1.5">Filter</div>
            <label className="flex items-center gap-2 py-0.5 cursor-pointer">
              <Checkbox
                checked={showSelectedOnly}
                onCheckedChange={(v) => setShowSelectedOnly(v === true)}
              />
              <span>Show Selected Only</span>
            </label>
            <label className="flex items-center gap-2 py-0.5 cursor-pointer">
              <Checkbox
                checked={hideHidden}
                onCheckedChange={(v) => setHideHidden(v === true)}
              />
              <span>Hide Hidden</span>
            </label>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
