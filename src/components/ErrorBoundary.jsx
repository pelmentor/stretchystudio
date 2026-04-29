// @ts-check

/**
 * Shared ErrorBoundary — wraps the v3 AppShell root and each Area
 * inside it (Pillar K + Pillar S).
 *
 * Class component because the React error-boundary contract still
 * requires `getDerivedStateFromError` / `componentDidCatch`. Per-area
 * boundaries (one per Area inside AreaTree) keep a thrown render
 * error from one editor scoped — the rest of the workspace stays up.
 *
 * Originally introduced for v2 (which had no error boundaries at all)
 * and re-used unchanged when v3 picked up the AppShell. v2 was retired
 * 2026-04-29; the component name stays for the v3-internal callers.
 *
 * @module components/ErrorBoundary
 */

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    /** @type {{error: Error|null}} */
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', this.props.label ?? 'unknown area', error, info);
    }
  }

  /** Allow parent to imperatively reset (e.g. after editor swap). */
  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-4 text-center bg-destructive/5">
          <div className="text-sm font-medium text-destructive">
            {this.props.label ? `${this.props.label}: ` : ''}render error
          </div>
          <div className="text-xs text-muted-foreground max-w-md font-mono whitespace-pre-wrap">
            {this.state.error.message || String(this.state.error)}
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
