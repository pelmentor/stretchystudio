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
import { Sun, Moon, Monitor, Palette, Settings2, Keyboard, Cpu, Languages } from 'lucide-react';
import { useTheme, AVAILABLE_FONTS } from '../../contexts/ThemeProvider.jsx';
import { lightThemePresets, darkThemePresets } from '../../lib/themePresets.js';
import { useState } from 'react';
import { KeymapModal } from './KeymapModal.jsx';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useI18n, AVAILABLE_LOCALES, useT } from '../../i18n/index.js';

export function PreferencesModal({ open, onOpenChange }) {
  const {
    themeMode, setThemeMode,
    openThemeModal,
    setLightTheme, setDarkTheme,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
  } = useTheme();
  const [keymapOpen, setKeymapOpen] = useState(false);
  const mlEnabled = usePreferencesStore((s) => s.mlEnabled);
  const setMlEnabled = usePreferencesStore((s) => s.setMlEnabled);
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);

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

  // Subscribe to locale so labels re-render when the user switches it.
  // useT() encapsulates the subscribe; pulling labels through useT keeps
  // them reactive without spreading a manual `useI18n((s) => s.locale)`
  // across every line.
  const labels = {
    title:               useT('prefs.title'),
    subtitle:            useT('prefs.subtitle'),
    themeMode:           useT('prefs.themeMode'),
    light:               useT('prefs.themeMode.light'),
    dark:                useT('prefs.themeMode.dark'),
    system:              useT('prefs.themeMode.system'),
    presetDark:          useT('prefs.colorPreset.dark'),
    presetLight:         useT('prefs.colorPreset.light'),
    pickPreset:          useT('prefs.colorPreset.pick'),
    font:                useT('prefs.font'),
    fontSize:            useT('prefs.fontSize'),
    keyboard:            useT('prefs.keyboard'),
    viewShortcuts:       useT('prefs.viewShortcuts'),
    language:            useT('prefs.language'),
    ai:                  useT('prefs.ai'),
    aiEnable:            useT('prefs.ai.enable'),
    aiNote:              useT('prefs.ai.note'),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            {labels.title}
          </DialogTitle>
          <DialogDescription>
            {labels.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          <Section label={labels.themeMode}>
            <div className="flex gap-1">
              <ModeButton
                active={themeMode === 'light'}
                onClick={() => setThemeMode('light')}
                icon={<Sun size={14} />}
                label={labels.light}
              />
              <ModeButton
                active={themeMode === 'dark'}
                onClick={() => setThemeMode('dark')}
                icon={<Moon size={14} />}
                label={labels.dark}
              />
              <ModeButton
                active={themeMode === 'system'}
                onClick={() => setThemeMode('system')}
                icon={<Monitor size={14} />}
                label={labels.system}
              />
            </div>
          </Section>

          <Section label={isDark ? labels.presetDark : labels.presetLight}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={pickThemePreset}
            >
              <Palette size={14} />
              {labels.pickPreset}
            </Button>
          </Section>

          <Section label={labels.font}>
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

          <Section label={`${labels.fontSize} — ${fontSize}px`}>
            <Slider
              min={11}
              max={20}
              step={1}
              value={[fontSize]}
              onValueChange={(v) => setFontSize(v[0])}
            />
          </Section>

          <Section label={labels.keyboard}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setKeymapOpen(true)}
            >
              <Keyboard size={14} />
              {labels.viewShortcuts}
            </Button>
          </Section>

          <Section label={labels.language}>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <Languages size={12} className="text-muted-foreground" />
                    {AVAILABLE_LOCALES.find((l) => l.id === locale)?.label ?? locale}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_LOCALES.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section label={labels.ai}>
            <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={mlEnabled}
                onChange={(e) => setMlEnabled(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 rounded border border-border"
              />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <Cpu size={12} className="text-muted-foreground" />
                  {labels.aiEnable}
                </span>
                <span className="text-[10px] text-muted-foreground leading-snug">
                  {labels.aiNote}
                </span>
              </span>
            </label>
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
