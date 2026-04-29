// @ts-check

/**
 * v3 Phase 3E — F3 operator search palette.
 *
 * Blender's F3 popup: fuzzy-search every operator by its
 * user-facing label, run with Enter / click. cmdk handles the
 * actual filter ranking + keyboard navigation. We layer:
 *
 *   - Recently used group (max 5, persisted via
 *     `commandPaletteStore` → localStorage). Skipped when filtered.
 *   - "All operators" group with chord hint shown when one exists.
 *   - Greyed (unavailable) operators stay listed but disabled, with
 *     the reason being whatever `op.available()` returns; we don't
 *     try to invent a tooltip.
 *
 * Implementation note: cmdk sets `data-[disabled=true]` on its own;
 * once we set the `disabled` prop on `CommandItem` it stops onSelect
 * from firing.
 *
 * @module v3/shell/CommandPalette
 */
/* eslint-disable react/prop-types */

import { useMemo } from 'react';
import { listOperators, getOperator } from '../operators/registry.js';
import { useCommandPaletteStore } from '../../store/commandPaletteStore.js';
import { DEFAULT_KEYMAP } from '../keymap/default.js';
import { useT } from '../../i18n/index.js';
import * as CommandImpl from '../../components/ui/command.jsx';

// shadcn cmdk wrappers are forwardRefs without exported JSDoc — tsc
// can't see their props. Cast through one alias so all parts stay
// permissive at runtime they're the same components.
/** @type {Record<string, React.ComponentType<any>>} */
const CMD = /** @type {any} */ (CommandImpl);
const {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} = CMD;

/**
 * Map each operator id → first chord that resolves to it. We invert
 * the keymap once on mount; the keymap is static so memoising on
 * empty deps is fine. Multiple chords (Ctrl+Z + Meta+Z) collapse to
 * the first one — the modal's just a hint, not a rebind UI.
 */
function buildOpToChord() {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const [chord, opId] of Object.entries(DEFAULT_KEYMAP)) {
    if (!m.has(opId)) m.set(opId, prettifyChord(chord));
  }
  return m;
}

function prettifyChord(chord) {
  return chord
    .split('+')
    .map((part) => {
      if (part === 'Meta')   return navigator.platform?.toLowerCase().includes('mac') ? '⌘' : 'Meta';
      if (part === 'Ctrl')   return 'Ctrl';
      if (part === 'Shift')  return 'Shift';
      if (part === 'Alt')    return 'Alt';
      if (part.startsWith('Key'))    return part.slice(3);
      if (part.startsWith('Digit'))  return part.slice(5);
      if (part === 'Period')         return '.';
      if (part === 'NumpadDecimal')  return 'Num.';
      return part;
    })
    .join('+');
}

export function CommandPalette() {
  const open    = useCommandPaletteStore((s) => s.open);
  const close   = useCommandPaletteStore((s) => s.close);
  const recents = useCommandPaletteStore((s) => s.recents);
  const markUsed = useCommandPaletteStore((s) => s.markUsed);
  // Phase 4J — i18n: every user-facing string in this component
  // routes through the t() lookup. Default English dictionary lives
  // in src/i18n/index.js; future translators register additional
  // locales via registerDictionary().
  const tPlaceholder = useT('palette.placeholder');
  const tEmpty       = useT('palette.empty');
  const tRecent      = useT('palette.group.recent');
  const tAll         = useT('palette.group.all');

  // Listing operators returns a snapshot, not a subscription, so we
  // re-derive only when the modal opens. Operators don't get
  // registered/unregistered after AppShell mounts so this is safe.
  const allOps = useMemo(
    () => (open ? listOperators() : []),
    [open],
  );
  const opToChord = useMemo(buildOpToChord, []);

  // Esc / outside click already close the dialog. We just need to
  // run the operator + close on select. cmdk passes the value back
  // verbatim so we use the operator id as the value.
  function runOperator(opId) {
    const op = getOperator(opId);
    close();
    if (!op) return;
    if (op.available && !op.available({ editorType: null })) return;
    markUsed(opId);
    try {
      op.exec({ editorType: null });
    } catch (err) {
      console.error(`[op ${opId}] failed via palette`, err);
    }
  }

  // The CommandDialog wraps cmdk in our shadcn Dialog — its
  // onOpenChange fires on Esc + scrim click + the X button.
  return (
    <CommandDialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <CommandInput placeholder={tPlaceholder} autoFocus />
      <CommandList>
        <CommandEmpty>{tEmpty}</CommandEmpty>

        {recents.length > 0 ? (
          <CommandGroup heading={tRecent}>
            {recents
              .map((id) => allOps.find((o) => o.id === id))
              .filter(Boolean)
              .map((op) => (
                <PaletteItem
                  key={`recent-${op.id}`}
                  op={op}
                  chord={opToChord.get(op.id)}
                  onPick={runOperator}
                />
              ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading={tAll}>
          {allOps.map((op) => (
            <PaletteItem
              key={op.id}
              op={op}
              chord={opToChord.get(op.id)}
              onPick={runOperator}
            />
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function PaletteItem({ op, chord, onPick }) {
  const available = !op.available || op.available({ editorType: null });
  return (
    <CommandItem
      value={`${op.label} ${op.id}`}
      onSelect={() => available && onPick(op.id)}
      disabled={!available}
    >
      <span className="flex-1 truncate">
        {op.label}
        <span className="ml-2 text-[10px] text-muted-foreground/70 font-mono">
          {op.id}
        </span>
      </span>
      {chord ? <CommandShortcut>{chord}</CommandShortcut> : null}
    </CommandItem>
  );
}
