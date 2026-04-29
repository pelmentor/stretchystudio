// @ts-check

/**
 * v3 Phase 0A — Per-area editor type selector.
 *
 * Tiny dropdown above each Area lets the user swap which editor
 * type renders there (Blender's "area type" selector, top-left of
 * every panel). Phase 1+ adds per-editor actions (filter buttons,
 * mode toggles) to the right side of the bar.
 *
 * @module v3/shell/EditorHeader
 */

import { useUIV3Store } from '../../store/uiV3Store.js';
import { EDITOR_REGISTRY, EDITOR_TYPES } from './editorRegistry.js';

/**
 * @param {Object} props
 * @param {string} props.areaId
 * @param {import('../../store/uiV3Store.js').EditorType} props.editorType
 */
export function EditorHeader({ areaId, editorType }) {
  const setAreaEditor = useUIV3Store((s) => s.setAreaEditor);
  return (
    <div className="flex items-center gap-2 px-2 h-7 border-b border-border bg-muted/30 select-none">
      <select
        className="text-xs bg-transparent outline-none cursor-pointer"
        value={editorType}
        onChange={(e) =>
          setAreaEditor(
            areaId,
            /** @type {import('../../store/uiV3Store.js').EditorType} */ (e.target.value),
          )
        }
        aria-label="Editor type"
      >
        {EDITOR_TYPES.map((t) => (
          <option key={t} value={t}>{EDITOR_REGISTRY[t].label}</option>
        ))}
      </select>
    </div>
  );
}
