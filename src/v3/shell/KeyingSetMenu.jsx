// @ts-check
/* eslint-disable react/prop-types */

/**
 * Animation Phase 7 Slice 7.C - Keying Set popover menu.
 *
 * Mounts at `editMenuStore.kind === 'keyingSet'`. Lists every built-in
 * + user-defined keying set from `listKeyingSets(project)` in the
 * canonical menu order. Default-highlighted set is computed at open
 * time via `pickDefaultKeyingSet` (Object → LocRotScale, Bone →
 * Rotation, BlendShape mode → BlendShape).
 *
 * Click → `execApplyKeyingSet(set.id)` (non-sticky; matches Blender's
 * `ANIM_OT_keyframe_insert_by_name` at `editors/animation/keyframing.cc:479-502`).
 * Esc / outside-click closes without invoking.
 *
 * Active set indicator + toggle (Slice 7.I) -- each row's leading dot
 * is a button: filled (●) when `project.activeKeyingSetId` matches the
 * row, hollow (○) otherwise. Clicking it dispatches
 * `execSetActiveKeyingSet(set.id)` (set, or toggle-off if already
 * active) WITHOUT closing the menu, so the user sees the indicator
 * flip and can still insert. Clicking the label area inserts via
 * `execApplyKeyingSet` as before. The active set drives auto-key's
 * `'activeSet'` mode (`pickActiveSetIdForAutoKey`).
 *
 * Pattern matches `ApplyMenu.jsx` + `SnapMenu.jsx` -- the popover
 * shape (fixed-position, Esc + outside-click) is shared infrastructure
 * across all `editMenuStore.kind` variants.
 *
 * Mirrors Blender's `insert_key_menu_invoke` menu layout at
 * `keyframing.cc:531-558` (popup_menu with one item per visible KS),
 * adapted for SS's Radix-free popover host.
 *
 * @module v3/shell/KeyingSetMenu
 */

import { useEffect, useMemo, useRef } from 'react';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { listKeyingSets } from '../../anim/keyingSets.js';
import { pickDefaultKeyingSet } from '../../anim/keyingSetDefault.js';
import { execApplyKeyingSet, execSetActiveKeyingSet } from '../operators/insertKey.js';

export function KeyingSetMenu() {
  const kind = useEditMenuStore((s) => s.kind);
  const cursor = useEditMenuStore((s) => s.cursor);
  const close = useEditMenuStore((s) => s.close);
  const project = useProjectStore((s) => s.project);
  // Selection + editMode are read in a snapshot, not subscribed -- the
  // menu's lifetime is too short to need re-render on selection change
  // (it closes on outside-click / pick). Computing the default set
  // here keeps the picker pure + testable.
  const selection = useEditorStore((s) => s.selection);
  const editMode = useEditorStore((s) => s.editMode);
  const activeBlendShapeId = useEditorStore((s) => s.activeBlendShapeId);
  const ref = useRef(null);

  // `listKeyingSets` allocates a fresh array per call -- memoise on
  // `[project]` to avoid the filter-in-selector trap from
  // `feedback_filter_in_selector` (the trap fires when this menu is
  // open AND a parent re-renders for any reason).
  const sets = useMemo(
    () => (project ? listKeyingSets(project) : []),
    [project],
  );
  const defaultId = useMemo(
    () => pickDefaultKeyingSet({ project, selection, editMode, activeBlendShapeId }),
    [project, selection, editMode, activeBlendShapeId],
  );
  const activeId = project?.activeKeyingSetId ?? null;

  useEffect(() => {
    if (kind !== 'keyingSet') return;
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [kind, close]);

  if (kind !== 'keyingSet' || !cursor) return null;

  const menuWidth = 240;
  const menuHeightApprox = Math.min(420, 36 + sets.length * 26);
  const x = Math.max(0, Math.min(window.innerWidth - menuWidth, cursor.x + 8));
  const y = Math.max(0, Math.min(window.innerHeight - menuHeightApprox, cursor.y + 8));

  function run(setId) {
    execApplyKeyingSet(setId);
    close();
  }

  // Set-active toggle (Slice 7.I). Does NOT close the menu -- the user
  // sees the ●/○ indicator flip and can still pick a set to insert.
  function toggleActive(e, setId) {
    e.stopPropagation();
    execSetActiveKeyingSet(setId);
  }

  return (
    <div
      ref={ref}
      className="fixed z-[110] min-w-[220px] rounded-md border border-border bg-popover shadow-lg py-1"
      style={{ left: x, top: y, maxHeight: '70vh', overflowY: 'auto' }}
      role="menu"
      aria-label="Keying Sets"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        Insert Keyframe
      </div>
      {sets.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">
          No keying sets registered
        </div>
      ) : (
        sets.map((set) => {
          const isDefault = set.id === defaultId;
          const isActive = set.id === activeId;
          return (
            <div
              key={set.id}
              role="menuitem"
              className="w-full flex items-center pr-2"
            >
              <button
                type="button"
                className={
                  'w-6 shrink-0 py-1 text-center text-[11px] rounded-sm cursor-pointer '
                  + 'hover:bg-accent hover:text-accent-foreground '
                  + (isActive ? 'text-accent-foreground' : 'text-muted-foreground')
                }
                onClick={(e) => toggleActive(e, set.id)}
                aria-pressed={isActive}
                aria-label={isActive ? 'Clear active keying set' : 'Set as active keying set'}
                title={isActive
                  ? 'Clear active keying set'
                  : "Set as active keying set (auto-key 'Active Set' mode)"}
              >
                {isActive ? '●' : '○'}
              </button>
              <button
                type="button"
                className={
                  'flex-1 text-left text-[12px] pl-1 pr-2 py-1 flex items-center gap-2 rounded-sm '
                  + 'cursor-pointer hover:bg-accent hover:text-accent-foreground '
                  + (isDefault ? 'font-medium' : '')
                }
                onClick={() => run(set.id)}
                title={set.description ?? ''}
              >
                <span className="flex-1">{set.label ?? set.id}</span>
                {!set.isBuiltin && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    user
                  </span>
                )}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
