/**
 * v3 Phase 0A — Per-area ErrorBoundary (Pillar S).
 *
 * The v2 app had zero error boundaries — any thrown error in a render
 * crashed the entire shell. v3 wraps every editor area so a misbehaving
 * editor degrades to a recoverable error panel, leaving the rest of
 * the workspace usable. This is also where we'll surface "reset this
 * area" / "report bug" affordances later.
 *
 * Class component because the React error-boundary contract still
 * requires `getDerivedStateFromError` / `componentDidCatch`.
 *
 * @module v3/shell/ErrorBoundary
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
      console.error('[v3 ErrorBoundary]', this.props.label ?? 'unknown area', error, info);
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
          <div className="text-xs text-muted-foreground max-w-sm font-mono whitespace-pre-wrap">
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
