// @ts-check

/**
 * v3 Phase 1B — Reusable numeric input.
 *
 * Stateful "edit-and-commit" semantics: typing updates the local
 * draft, but the parent only sees the new value when the user
 * blurs or hits Enter. This prevents the project from snapshotting
 * an undo entry per keystroke (would explode the 50 MB undo budget
 * Pillar M added) while keeping the input responsive.
 *
 * @module v3/editors/properties/fields/NumberField
 */

import { useState, useEffect, useRef } from 'react';
import { PropertyRow } from '../primitives/PropertyRow.jsx';

/**
 * @param {Object} props
 * @param {string}   props.label
 * @param {number}   props.value
 * @param {(v:number) => void} props.onCommit
 * @param {number=}  props.step
 * @param {number=}  props.min
 * @param {number=}  props.max
 * @param {number=}  props.precision   - decimals shown when not focused (default 2)
 * @param {boolean=} props.disabled
 * @param {string=}  props.title       - tooltip for the label cell
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  precision = 2,
  disabled,
  title,
}) {
  const [draft, setDraft] = useState(formatValue(value, precision));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // External value changes (animation playback, undo) overwrite the
  // draft only while the user isn't actively editing. Without this
  // guard, every store update during a drag would clobber the
  // half-typed value.
  useEffect(() => {
    if (!editing) setDraft(formatValue(value, precision));
  }, [value, precision, editing]);

  function commit() {
    setEditing(false);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      // Reject NaN — restore display to last known value.
      setDraft(formatValue(value, precision));
      return;
    }
    let next = parsed;
    if (typeof min === 'number' && next < min) next = min;
    if (typeof max === 'number' && next > max) next = max;
    if (next !== value) onCommit(next);
    else setDraft(formatValue(value, precision));
  }

  return (
    <PropertyRow label={label} title={title}>
      <input
        ref={inputRef}
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        className="w-full h-6 px-1.5 rounded bg-muted/40 border border-border text-foreground tabular-nums focus:outline-none focus:border-primary"
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
            setDraft(formatValue(value, precision));
            inputRef.current?.blur();
          }
        }}
      />
    </PropertyRow>
  );
}

/**
 * @param {number} v
 * @param {number} precision
 * @returns {string}
 */
function formatValue(v, precision) {
  if (!Number.isFinite(v)) return '0';
  // Trim trailing zeros so 1.00 → 1 but 1.50 → 1.5
  const s = v.toFixed(precision);
  return s.replace(/\.?0+$/, '') || '0';
}
