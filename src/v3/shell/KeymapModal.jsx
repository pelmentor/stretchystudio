/**
 * v3 Phase 6 — Keyboard Shortcuts viewer.
 *
 * Read-only first cut: lists every chord → operator mapping with the
 * operator's label. Filter by free-text. Editing the keymap is
 * deferred until per-user persistence lands; for now this is the
 * "what does this app respond to?" reference the user can pull up
 * from the Preferences modal.
 *
 * @module v3/shell/KeymapModal
 */

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.jsx';
import { Input } from '../../components/ui/input.jsx';
import { DEFAULT_KEYMAP } from '../keymap/default.js';
import { getOperator } from '../operators/registry.js';

const MOD_LABELS = {
  Ctrl: 'Ctrl',
  Meta: '⌘',
  Shift: 'Shift',
  Alt: 'Alt',
};

const KEY_LABELS = {
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F', KeyG: 'G',
  KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N',
  KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T', KeyU: 'U',
  KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y', KeyZ: 'Z',
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  Backspace: '⌫', Delete: 'Del', Escape: 'Esc',
  Period: '.', NumpadDecimal: 'Num.',
};

function prettyChord(chord) {
  return chord.split('+').map((part) => MOD_LABELS[part] ?? KEY_LABELS[part] ?? part).join(' + ');
}

export function KeymapModal({ open, onOpenChange }) {
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return Object.entries(DEFAULT_KEYMAP)
      .map(([chord, opId]) => {
        const op = getOperator(opId);
        return { chord, opId, label: op?.label ?? opId };
      })
      .filter((r) => {
        if (!f) return true;
        return r.chord.toLowerCase().includes(f)
          || r.opId.toLowerCase().includes(f)
          || r.label.toLowerCase().includes(f);
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[70vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Default bindings. Customisation is deferred until per-user keymap persistence lands.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b shrink-0 bg-muted/10">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action or chord…"
            className="h-9"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-auto p-4">
          {rows.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground italic p-6">
              No shortcuts match "{filter}".
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium pb-2 px-2 w-1/2">Action</th>
                  <th className="text-left font-medium pb-2 px-2">Shortcut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => (
                  <tr key={r.chord} className="hover:bg-muted/20">
                    <td className="py-1.5 px-2">
                      <div className="font-medium text-foreground">{r.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.opId}</div>
                    </td>
                    <td className="py-1.5 px-2 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/40 text-[11px]">
                        {prettyChord(r.chord)}
                      </kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
