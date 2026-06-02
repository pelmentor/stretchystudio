// @ts-check

import { logger } from '../../lib/logger.js';
import { toast } from '../../hooks/use-toast.js';

/**
 * `reportOpFailure(source, err, meta)` — canonical error escalation for
 * operator invokers (menus, palettes, keymap dispatch).
 *
 * # Why this exists
 *
 * Pre-fix the shell menus (`FileMenu`, `ApplyMenu`, `CanvasContextMenu`,
 * `MergeMenu`, `SnapMenu`, `ClearParentMenu`, `CommandPalette`) caught
 * operator failures with bare `console.error(...)`. That makes the
 * failure invisible to the user (DevTools is dev-only) AND invisible to
 * the in-app Logs panel — a failed user-invoked operator looked
 * indistinguishable from a successful no-op. RULE-№1 + the audit's
 * `feedback_in_app_logging` directive: route through `logger.error` so
 * the in-app Logs panel sees the failure, AND surface a toast so the
 * user actually knows their action failed.
 *
 * # Contract
 *
 * - `source`: short subsystem tag used as the logger source + toast
 *   title prefix. Conventionally the menu / surface name
 *   (`'FileMenu'`, `'CommandPalette'`, …).
 * - `err`: the thrown value. Coerced to a message string; not re-thrown.
 * - `meta.opId`: when present, labels which operator failed (toast +
 *   logger get `op <opId> exec failed: ...`).
 * - `meta` is forwarded to `logger.error` as structured data after
 *   appending `err: String(err)`.
 *
 * @param {string} source
 * @param {unknown} err
 * @param {{opId?: string} & Record<string, unknown>} [meta]
 */
export function reportOpFailure(source, err, meta = {}) {
  const message = /** @type {any} */ (err)?.message ?? String(err);
  const opLabel = meta.opId ? `op ${meta.opId}` : 'operator';
  logger.error(source, `${opLabel} exec failed: ${message}`, { ...meta, err: String(err) });
  toast({
    variant: 'destructive',
    title: `${source}: ${opLabel} failed`,
    description: message,
  });
}
