// @ts-check

/**
 * v3 Phase 1B — Reusable text input with edit-and-commit.
 *
 * Same draft + commit-on-blur/Enter pattern as NumberField so a
 * rename doesn't snapshot per keystroke.
 *
 * @module v3/editors/properties/fields/TextField
 */

import { useState, useEffect, useRef } from 'react';

/**
 * @param {Object} props
 * @param {string}   props.label
 * @param {string}   props.value
 * @param {(v:string) => void} props.onCommit
 * @param {boolean=} props.disabled
 */
export function TextField({ label, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '') && next.length > 0) onCommit(next);
    else setDraft(value ?? '');
  }

  return (
    <label className="flex items-center gap-2 text-xs h-7">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={disabled}
        className="flex-1 h-6 px-1.5 rounded bg-muted/40 border border-border text-foreground focus:outline-none focus:border-primary"
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            setEditing(false);
            setDraft(value ?? '');
            inputRef.current?.blur();
          }
        }}
      />
    </label>
  );
}
