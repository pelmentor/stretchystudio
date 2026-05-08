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
import { PropertyRow } from '../primitives/PropertyRow.jsx';

/**
 * @param {Object} props
 * @param {string}   props.label
 * @param {string}   props.value
 * @param {(v:string) => void} props.onCommit
 * @param {boolean=} props.disabled
 * @param {string=}  props.title
 */
export function TextField({ label, value, onCommit, disabled, title }) {
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
    <PropertyRow label={label} title={title}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={disabled}
        className="w-full h-6 px-1.5 rounded bg-muted/40 border border-border text-foreground focus:outline-none focus:border-primary"
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
    </PropertyRow>
  );
}
