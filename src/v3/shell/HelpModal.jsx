// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 4E — F1 help / quick-reference modal.
 *
 * Static content for the first cut: one section per top-level
 * affordance the user might be looking for. Workspaces, key
 * shortcuts cheat-sheet, link to the full Keymap viewer.
 *
 * Real "context help" (different content per active editor) is
 * deferred — the editor types are stable but their feature surface
 * still moves day-to-day, so static content would rot fast. Once
 * the editors stop changing weekly we'll add per-editor sections
 * that consume a `helpContent.md` MDX bundle.
 *
 * @module v3/shell/HelpModal
 */

import { useState } from 'react';
import * as DialogImpl from '../../components/ui/dialog.jsx';
import { Button as ButtonImpl } from '../../components/ui/button.jsx';
import { useHelpModalStore } from '../../store/helpModalStore.js';
import { KeymapModal } from './KeymapModal.jsx';
import { Keyboard } from 'lucide-react';

/** @type {Record<string, React.ComponentType<any>>} */
const D = /** @type {any} */ (DialogImpl);
const {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} = D;
/** @type {React.ComponentType<any>} */
const Button = /** @type {any} */ (ButtonImpl);

/** @type {Array<{label:string, body:string}>} */
const WORKSPACES = [
  { label: 'Layout',   body: 'Drag-arrange parts on canvas. PSD import lives here.' },
  { label: 'Modeling', body: 'Edit meshes, blend shapes, masks per part. Properties tabs gain Mesh / Mask / BlendShape.' },
  { label: 'Rigging',  body: 'Build the warp / rotation deformer chain + parameters. Auto-rig button regenerates from PSD tags.' },
  { label: 'Pose',     body: 'Single-keyframe authoring of one expression. Animation mode is on so param changes auto-keyframe.' },
  { label: 'Animation', body: 'Multi-keyframe motion3 timeline with the Animations list. Auto-keyframes write at playhead time.' },
];

/** @type {Array<{chord:string, what:string}>} */
const QUICK_CHORDS = [
  { chord: 'F1',         what: 'This help dialog' },
  { chord: 'F3',         what: 'Operator search palette' },
  { chord: 'Ctrl+1..5',  what: 'Switch workspace' },
  { chord: 'Ctrl+S / O', what: 'Save / Open project' },
  { chord: 'Ctrl+E',     what: 'Export Live2D' },
  { chord: 'Ctrl+Z / Y', what: 'Undo / Redo' },
  { chord: 'Esc',        what: 'Deselect everything' },
  { chord: 'H',          what: 'Toggle visibility on selection' },
  { chord: '. (period)', what: 'Frame view to selection' },
];

export function HelpModal() {
  const open  = useHelpModalStore((s) => s.open);
  const close = useHelpModalStore((s) => s.close);
  const [keymapOpen, setKeymapOpen] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Stretchy Studio — Quick Reference</DialogTitle>
            <DialogDescription>
              Press F1 anywhere to reopen this. F3 brings up the operator search palette.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Workspaces
              </h3>
              <ul className="space-y-2">
                {WORKSPACES.map((ws) => (
                  <li key={ws.label} className="text-xs">
                    <div className="font-semibold text-foreground">{ws.label}</div>
                    <div className="text-muted-foreground">{ws.body}</div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Common shortcuts
              </h3>
              <ul className="space-y-1 text-xs">
                {QUICK_CHORDS.map((q) => (
                  <li key={q.chord} className="flex items-baseline gap-3">
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono shrink-0">
                      {q.chord}
                    </kbd>
                    <span className="text-muted-foreground">{q.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setKeymapOpen(true)}>
              <Keyboard size={14} className="mr-2" />
              View all shortcuts…
            </Button>
            <Button onClick={close}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeymapModal open={keymapOpen} onOpenChange={setKeymapOpen} />
    </>
  );
}
