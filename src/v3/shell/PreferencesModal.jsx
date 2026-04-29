/**
 * v3 Phase 1H — Preferences modal (restored from upstream).
 *
 * Restored after v2 retirement deleted the old `PreferencesModal`.
 * Trimmed to the essentials that ThemeProvider actually exposes:
 *
 *   - Theme mode: light / dark / system
 *   - Theme preset picker (opens existing ThemeSelectModal flow)
 *   - Font family + size
 *
 * The `appearance.font.advanced` and `interface.layout` tabs from
 * upstream's PreferencesModal aren't restored — appearance.font.advanced
 * exposed weight / line-height controls that ThemeProvider doesn't
 * support, and interface.layout was a Blender-style "saved layouts"
 * concept that v3's workspace tabs already cover.
 *
 * @module v3/shell/PreferencesModal
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Slider } from '../../components/ui/slider.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select.jsx';
import { Sun, Moon, Monitor, Palette, Settings2, Keyboard } from 'lucide-react';
import { useTheme, AVAILABLE_FONTS } from '../../contexts/ThemeProvider.jsx';
import { lightThemePresets, darkThemePresets } from '../../lib/themePresets.js';
import { useState } from 'react';
import { KeymapModal } from './KeymapModal.jsx';

export function PreferencesModal({ open, onOpenChange }) {
  const {
    themeMode, setThemeMode,
    openThemeModal,
    setLightTheme, setDarkTheme,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
  } = useTheme();
  const [keymapOpen, setKeymapOpen] = useState(false);

  const isDark =
    themeMode === 'dark' ||
    (themeMode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  function pickThemePreset() {
    openThemeModal(
      isDark
        ? { title: 'Select Dark Theme', themes: darkThemePresets, onSelect: setDarkTheme }
        : { title: 'Select Light Theme', themes: lightThemePresets, onSelect: setLightTheme },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            Preferences
          </DialogTitle>
          <DialogDescription>
            Theme and typography. Saved per-browser via localStorage.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          <Section label="Theme mode">
            <div className="flex gap-1">
              <ModeButton
                active={themeMode === 'light'}
                onClick={() => setThemeMode('light')}
                icon={<Sun size={14} />}
                label="Light"
              />
              <ModeButton
                active={themeMode === 'dark'}
                onClick={() => setThemeMode('dark')}
                icon={<Moon size={14} />}
                label="Dark"
              />
              <ModeButton
                active={themeMode === 'system'}
                onClick={() => setThemeMode('system')}
                icon={<Monitor size={14} />}
                label="System"
              />
            </div>
          </Section>

          <Section label={`Color preset (${isDark ? 'dark' : 'light'})`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={pickThemePreset}
            >
              <Palette size={14} />
              Pick preset…
            </Button>
          </Section>

          <Section label="Font">
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_FONTS.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-xs">
                    {f.label ?? f.name ?? f.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section label={`Font size — ${fontSize}px`}>
            <Slider
              min={11}
              max={20}
              step={1}
              value={[fontSize]}
              onValueChange={(v) => setFontSize(v[0])}
            />
          </Section>

          <Section label="Keyboard">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setKeymapOpen(true)}
            >
              <Keyboard size={14} />
              View shortcuts…
            </Button>
          </Section>
        </div>
      </DialogContent>
      <KeymapModal open={keymapOpen} onOpenChange={setKeymapOpen} />
    </Dialog>
  );
}

function Section({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex-1 h-8 rounded text-xs flex items-center justify-center gap-1.5 transition-colors ' +
        (active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/40 text-muted-foreground hover:bg-muted/60')
      }
    >
      {icon}
      {label}
    </button>
  );
}
