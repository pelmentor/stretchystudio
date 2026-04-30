// @ts-check

/**
 * v3 Phase 4J — i18n scaffold.
 *
 * No actual translations shipped yet — this is just the extraction
 * surface that future translators (or an automated extraction tool)
 * can target. The pattern is intentionally minimal:
 *
 *   import { t } from '@/i18n';
 *   <button>{t('export.button.label')}</button>
 *
 * Rules:
 *   - Keys are dot-separated namespaces. Lead with the editor /
 *     surface (`export.`, `palette.`, `properties.mesh.`).
 *   - Default locale (`en`) lives inline so a missing translation
 *     never returns an undefined or empty string — it returns the
 *     English source.
 *   - `setLocale('ru')` switches the active dictionary; the
 *     `useLocale` hook below re-renders subscribers when it changes.
 *
 * react-intl was considered but dropped for first cut:
 *   - 60+ KB gzip is heavy for just a key→string lookup.
 *   - Plural / date formatting is not on the immediate roadmap
 *     (every UI string we have today is a literal sentence).
 *   - When complex formatting becomes a requirement we swap the
 *     `t()` implementation; call sites stay the same.
 *
 * @module i18n
 */

import { create } from 'zustand';

/**
 * @typedef {Record<string, string>} LocaleDict
 *
 * @typedef {Object} I18nState
 * @property {string} locale
 * @property {Record<string, LocaleDict>} dictionaries
 * @property {(locale: string) => void} setLocale
 * @property {(locale: string, dict: LocaleDict) => void} registerDictionary
 */

/**
 * Default English dictionary. Keys land here as we extract strings
 * from components; the lookup falls back to the key when nothing
 * matches so a missing translation is visible (not blank).
 *
 * @type {LocaleDict}
 */
const EN = {
  // F3 command palette
  'palette.placeholder':            'Search operators…',
  'palette.empty':                  'No operator matches.',
  'palette.group.recent':           'Recent',
  'palette.group.all':              'All operators',

  // F1 help modal
  'help.title':                     'Stretchy Studio — Quick Reference',
  'help.subtitle':                  'Press F1 anywhere to reopen this. F3 brings up the operator search palette.',
  'help.section.workspaces':        'Workspaces',
  'help.section.shortcuts':         'Common shortcuts',
  'help.viewAllShortcuts':          'View all shortcuts…',
  'help.close':                     'Close',

  // Export modal
  'export.title':                   'Export Live2D Model',
  'export.subtitle':                "Pick the output format. Auto-rig regenerates the rig from the project's PSD layout + tag annotations on every export.",
  'export.format.full.title':       'Live2D Runtime + Auto Rig',
  'export.format.runtime.title':    'Live2D Runtime (no rig)',
  'export.format.cmo3.title':       'Cubism Source (.cmo3)',
  'export.button.cancel':           'Cancel',
  'export.button.confirm':          'Export',
  'export.validation.allClear':     'Project looks ready to export.',
  'export.validation.override':     "Export anyway — I know what I'm doing.",

  // Generic action labels
  'action.save':                    'Save',
  'action.load':                    'Open',
  'action.export':                  'Export',
  'action.delete':                  'Delete',
  'action.cancel':                  'Cancel',
  'action.confirm':                 'Confirm',
  'action.create':                  'Create',
  'action.rename':                  'Rename',

  // New project dialog
  'newProject.title':               'New Project',
  'newProject.subtitle':            'Pick a starting template. Each template tweaks canvas size and project name; everything else stays empty.',
  'newProject.dirtyWarning':        'The current project has unsaved changes. They will be lost. Save first via Ctrl+S or "Save to library" before proceeding.',

  // Keymap modal
  'keymap.title':                   'Keyboard Shortcuts',
  'keymap.subtitle':                'Default bindings. Customisation is deferred until per-user keymap persistence lands.',
  'keymap.filter.placeholder':      'Filter by action or chord…',
  'keymap.empty':                   'No shortcuts match "{filter}".',
  'keymap.col.action':              'Action',
  'keymap.col.shortcut':            'Shortcut',

  // Preferences modal
  'prefs.title':                    'Preferences',
  'prefs.subtitle':                 'Theme and typography. Saved per-browser via localStorage.',
  'prefs.themeMode':                'Theme mode',
  'prefs.themeMode.light':          'Light',
  'prefs.themeMode.dark':           'Dark',
  'prefs.themeMode.system':         'System',
  'prefs.colorPreset.dark':         'Color preset (dark)',
  'prefs.colorPreset.light':        'Color preset (light)',
  'prefs.colorPreset.pick':         'Pick preset…',
  'prefs.font':                     'Font',
  'prefs.fontSize':                 'Font size',
  'prefs.keyboard':                 'Keyboard',
  'prefs.viewShortcuts':            'View shortcuts…',
  'prefs.language':                 'Language',
  'prefs.ai':                       'AI features',
  'prefs.ai.enable':                'Enable AI auto-rig (DWPose)',
  'prefs.ai.note':                  'Off hides the AI Auto-Rig button and avoids loading the ~15 MB ONNX runtime + DWPose model. Manual rigging + heuristic skeleton estimation still work.',
};

// Eagerly register every shipped non-English locale so a user
// switching via Preferences (4J follow-up) finds something already
// loaded. Locales are tiny key→string maps; one bundle-time import
// per language is fine.
import { RU } from './locales/ru.js';

/** Locales that PreferencesModal exposes in its switcher. */
export const AVAILABLE_LOCALES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
]);

const LOCALE_KEY = 'v3.prefs.locale';

function loadLocale() {
  if (typeof localStorage === 'undefined') return 'en';
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (raw === 'en' || raw === 'ru') return raw;
  } catch { /* ignore */ }
  return 'en';
}

function saveLocale(locale) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* ignore */ }
}

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<I18nState>>} */
export const useI18n = create((set) => ({
  locale: loadLocale(),
  dictionaries: { en: EN, ru: RU },

  setLocale: (locale) => set((state) => {
    if (!state.dictionaries[locale]) return state;
    saveLocale(locale);
    return { locale };
  }),

  registerDictionary: (locale, dict) => set((state) => ({
    dictionaries: {
      ...state.dictionaries,
      [locale]: { ...(state.dictionaries[locale] ?? {}), ...dict },
    },
  })),
}));

/**
 * Look up a string by key. Falls back through:
 *   1. active locale's dictionary
 *   2. English dictionary
 *   3. the raw key (so missing keys are visible during dev)
 *
 * @param {string} key
 * @returns {string}
 */
export function t(key) {
  const { locale, dictionaries } = useI18n.getState();
  return dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? key;
}

/**
 * Hook for reactive translation lookup. Re-renders the caller when
 * the locale changes. Use this in components — `t()` is for
 * non-component code (operators, config defaults).
 *
 * @param {string} key
 * @returns {string}
 */
export function useT(key) {
  const locale = useI18n((s) => s.locale);
  const dictionaries = useI18n((s) => s.dictionaries);
  return dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? key;
}
