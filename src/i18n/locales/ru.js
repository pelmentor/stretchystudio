// @ts-check

/**
 * v3 Phase 4J — Russian (ru) locale.
 *
 * Translations for the keys that have been wrapped in `useT()` /
 * `t()` so far. Strings not present here fall back to English via
 * the lookup chain in `src/i18n/index.js`.
 *
 * Adding strings: append a key here matching the canonical key in
 * the EN dictionary. The wrap pattern (`useT('palette.placeholder')`)
 * doesn't need to change in components.
 *
 * @module i18n/locales/ru
 */

/** @type {Record<string, string>} */
export const RU = {
  // F3 command palette
  'palette.placeholder':            'Поиск операторов…',
  'palette.empty':                  'Нет совпадений.',
  'palette.group.recent':           'Недавние',
  'palette.group.all':              'Все операторы',

  // F1 help modal
  'help.title':                     'Stretchy Studio — справочник',
  'help.subtitle':                  'Нажмите F1 чтобы открыть снова. F3 открывает поиск операторов.',
  'help.section.workspaces':        'Рабочие пространства',
  'help.section.shortcuts':         'Часто используемые сочетания',
  'help.viewAllShortcuts':          'Все сочетания…',
  'help.close':                     'Закрыть',

  // Export modal
  'export.title':                   'Экспорт Live2D-модели',
  'export.subtitle':                'Выберите формат. Авто-риг каждый раз перегенерируется из PSD-разметки и тегов проекта.',
  'export.format.full.title':       'Live2D Runtime + Авто-риг',
  'export.format.runtime.title':    'Live2D Runtime (без рига)',
  'export.format.cmo3.title':       'Cubism Source (.cmo3)',
  'export.button.cancel':           'Отмена',
  'export.button.confirm':          'Экспорт',
  'export.validation.allClear':     'Проект готов к экспорту.',
  'export.validation.override':     'Экспортировать всё равно — я знаю что делаю.',

  // Generic action labels
  'action.save':                    'Сохранить',
  'action.load':                    'Открыть',
  'action.export':                  'Экспорт',
  'action.delete':                  'Удалить',
  'action.cancel':                  'Отмена',
  'action.confirm':                 'Подтвердить',
  'action.create':                  'Создать',
  'action.rename':                  'Переименовать',

  // New project dialog
  'newProject.title':               'Новый проект',
  'newProject.subtitle':            'Выберите начальный шаблон. Каждый меняет размер канваса и имя проекта; всё остальное остаётся пустым.',
  'newProject.dirtyWarning':        'Текущий проект имеет несохранённые изменения. Они будут потеряны. Сначала сохраните через Ctrl+S или "Сохранить в библиотеку".',

  // Keymap modal
  'keymap.title':                   'Клавиатурные сочетания',
  'keymap.subtitle':                'Сочетания по умолчанию. Кастомизация ждёт пер-юзер хранения keymap.',
  'keymap.filter.placeholder':      'Фильтр по действию или сочетанию…',
  'keymap.empty':                   'Ничего не соответствует "{filter}".',
  'keymap.col.action':              'Действие',
  'keymap.col.shortcut':            'Сочетание',

  // Preferences modal
  'prefs.title':                    'Настройки',
  'prefs.subtitle':                 'Тема и типографика. Сохраняются в localStorage браузера.',
  'prefs.themeMode':                'Тема',
  'prefs.themeMode.light':          'Светлая',
  'prefs.themeMode.dark':           'Тёмная',
  'prefs.themeMode.system':         'Системная',
  'prefs.colorPreset.dark':         'Цветовая схема (тёмная)',
  'prefs.colorPreset.light':        'Цветовая схема (светлая)',
  'prefs.colorPreset.pick':         'Выбрать…',
  'prefs.font':                     'Шрифт',
  'prefs.fontSize':                 'Размер шрифта',
  'prefs.keyboard':                 'Клавиатура',
  'prefs.viewShortcuts':            'Все сочетания…',
  'prefs.language':                 'Язык',
  'prefs.ai':                       'AI-функции',
  'prefs.ai.enable':                'Включить AI-авториг (DWPose)',
  'prefs.ai.note':                  'Выключение скрывает кнопку AI-авторига и не подгружает ~15 МБ ONNX runtime + DWPose. Ручной риг и эвристический скелет работают без него.',
};
