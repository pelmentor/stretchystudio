// @ts-check

/**
 * v3 Phase 5 — Project templates registry.
 *
 * Each template is a thin descriptor + `apply(project)` that mutates
 * a freshly-reset project state. Templates are intentionally
 * additive, not full project authors:
 *
 *   - `apply` runs AFTER `resetProject()`, so we know the project
 *     is in its empty default before any template tweak.
 *   - Templates only configure shell-level state today (canvas
 *     size + name). Future templates can layer in starter
 *     parameters, physics groups, mask configs, etc.
 *   - Template id is stable across versions so user-saved
 *     "starting from this template" data can persist later.
 *
 * Adding a template: append a new entry below. No registration
 * boilerplate — `listTemplates()` walks the array.
 *
 * @module v3/templates/projectTemplates
 */

/**
 * @typedef {Object} ProjectTemplate
 * @property {string} id          - stable identifier, used in localStorage / library
 * @property {string} name        - user-facing label
 * @property {string} description - one-line blurb shown in the New dialog
 * @property {(project: any) => void} apply - mutate a freshly-reset project
 */

/** @type {ProjectTemplate[]} */
const TEMPLATES = [
  {
    id: 'empty',
    name: 'Empty Project',
    description: 'Default 800×600 canvas. Start from scratch with PSD import.',
    apply: () => { /* empty — resetProject already gives this */ },
  },
  {
    id: 'square-1024',
    name: 'Square 1024×1024',
    description: 'Equal-aspect canvas — good for sticker sets and emoji packs.',
    apply: (project) => {
      project.canvas.width = 1024;
      project.canvas.height = 1024;
      project.name = 'Untitled (Square)';
    },
  },
  {
    id: 'portrait-1080-1920',
    name: 'Portrait HD 1080×1920',
    description: 'Mobile-portrait ratio for vertical video and Live2D streaming overlays.',
    apply: (project) => {
      project.canvas.width = 1080;
      project.canvas.height = 1920;
      project.name = 'Untitled (Portrait)';
    },
  },
  {
    id: 'landscape-1920-1080',
    name: 'Landscape FHD 1920×1080',
    description: 'Standard 16:9 canvas — desktop / OBS scenes / wide format.',
    apply: (project) => {
      project.canvas.width = 1920;
      project.canvas.height = 1080;
      project.name = 'Untitled (Landscape)';
    },
  },
];

/** All templates in registration order. Caller must not mutate. */
export function listTemplates() {
  return TEMPLATES;
}

/**
 * @param {string} id
 * @returns {ProjectTemplate|null}
 */
export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
