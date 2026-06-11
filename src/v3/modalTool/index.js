// @ts-check

/**
 * Modal-tool framework — public surface.
 *
 * Consumers should import from this module rather than the internal
 * `store.js` / `useModalTool.js` / `InputDispatcher.jsx` so the
 * implementation can be refactored without churn at call sites.
 *
 * @module v3/modalTool
 */

export { useModalToolStore } from './store.js';
export { useModalTool } from './useModalTool.js';
export { ModalToolInputDispatcher } from './InputDispatcher.jsx';
