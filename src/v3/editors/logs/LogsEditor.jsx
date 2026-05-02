// @ts-check

/**
 * v3 — Logs panel.
 *
 * Renders the in-memory ring buffer from `useLogsStore`. Newest
 * entries at the bottom (auto-scroll); each entry shows level,
 * source, message, and an expandable JSON view of `data` if
 * present. Toolbar has Copy All + Clear.
 *
 * Pipeline modules write here via `lib/logger.js` — see the docstring
 * there for source-name conventions.
 *
 * Auto-scroll only happens when the user is already near the bottom;
 * if they've scrolled up to read older entries, new entries don't
 * yank them away.
 *
 * @module v3/editors/logs/LogsEditor
 */

import { useEffect, useRef, useState } from 'react';
import { Trash2, ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { useLogsStore } from '../../../store/logsStore.js';

/** @typedef {import('../../../store/logsStore.js').LogEntry} LogEntry */

const LEVEL_BADGE = {
  debug: 'text-muted-foreground',
  info:  'text-foreground',
  warn:  'text-amber-500',
  error: 'text-destructive',
};

/**
 * Whole-row tint for warn / error so a malformed-rig warn or pipeline
 * error is impossible to miss in a wall of debug entries. Info/debug
 * entries inherit the default foreground, keeping signal density low.
 *
 * `font-semibold` for errors only — bold + red tint matches the
 * "stop, this is bad" affordance from compiler/runtime errors.
 */
const ROW_TINT = {
  debug: '',
  info:  '',
  warn:  'text-amber-500',
  error: 'text-destructive font-semibold',
};

export function LogsEditor() {
  const entries = useLogsStore((s) => s.entries);
  const clear   = useLogsStore((s) => s.clear);

  // Auto-scroll only if the user is already pinned near the bottom.
  const scrollRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const slack = 16; // px
    pinnedRef.current = el.scrollHeight - (el.scrollTop + el.clientHeight) <= slack;
  }

  return (
    <div className="h-full w-full flex flex-col text-xs">
      <Toolbar entries={entries} onClear={clear} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-auto font-mono"
      >
        {entries.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground select-none">
            No log entries yet.
          </div>
        ) : (
          entries.map((e) => <Row key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}

function Toolbar({ entries, onClear }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  async function onCopy() {
    const text = entries.map(formatEntryForCopy).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
    } catch (_err) {
      // Fallback: hidden textarea + execCommand.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
      } catch (_err2) { /* ignore */ }
    }
  }

  return (
    <div className="border-b border-border bg-muted/20 px-2 py-1 flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider select-none">
        Logs
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums select-none ml-auto">
        {entries.length}
      </span>
      <button
        type="button"
        onClick={onCopy}
        disabled={entries.length === 0}
        title="Copy all logs to clipboard"
        className="h-5 px-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground rounded-sm hover:bg-background/60 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={entries.length === 0}
        title="Clear log"
        className="h-5 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-sm hover:bg-background/60 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function Row({ entry }) {
  const [open, setOpen] = useState(false);
  const hasData = entry.data !== undefined;
  const ts = formatTs(entry.ts);
  const tint = ROW_TINT[entry.level] ?? '';
  return (
    <div className={`border-b border-border/30 hover:bg-muted/20 px-2 py-0.5 ${tint}`}>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          disabled={!hasData}
          onClick={() => setOpen((v) => !v)}
          className={
            'shrink-0 w-3 h-4 inline-flex items-center justify-center ' +
            (hasData ? 'text-muted-foreground hover:text-foreground' : 'opacity-30')
          }
          aria-label={hasData ? (open ? 'Collapse' : 'Expand') : 'No payload'}
        >
          {hasData ? (open ? <ChevronDown size={9} /> : <ChevronRight size={9} />) : null}
        </button>
        <span className="text-muted-foreground tabular-nums shrink-0">{ts}</span>
        <span className={`shrink-0 ${LEVEL_BADGE[entry.level]} uppercase font-mono text-[10px] w-9`}>
          {entry.level}
        </span>
        <span className={`shrink-0 font-mono text-[11px] w-28 truncate ${tint || 'text-primary/80'}`}>
          {entry.source}
        </span>
        <span className="flex-1 min-w-0 break-words">{entry.message}</span>
      </div>
      {hasData && open ? (
        <pre className="ml-[5.5rem] mt-0.5 mb-1 px-2 py-1 bg-muted/30 rounded-sm overflow-x-auto text-[10px] leading-tight whitespace-pre-wrap">
          {safeStringify(entry.data)}
        </pre>
      ) : null}
    </div>
  );
}

function formatTs(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatEntryForCopy(e) {
  const head = `${formatTs(e.ts)} ${e.level.toUpperCase().padEnd(5)} ${e.source} — ${e.message}`;
  if (e.data === undefined) return head;
  return head + '\n' + safeStringify(e.data);
}

function safeStringify(v) {
  try {
    return JSON.stringify(v, replacer, 2);
  } catch (_err) {
    return String(v);
  }
}

function replacer(_key, value) {
  // Typed-array friendly preview — show kind + length, then a head.
  if (value instanceof Float32Array || value instanceof Float64Array
   || value instanceof Uint8Array   || value instanceof Uint16Array
   || value instanceof Int16Array   || value instanceof Int32Array) {
    const head = Array.from(value.slice(0, 16));
    return { __typed: value.constructor.name, length: value.length, head };
  }
  return value;
}
