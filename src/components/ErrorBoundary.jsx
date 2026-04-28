/**
 * Shared ErrorBoundary used by both the v2 EditorLayout root and the
 * v3 AppShell + each Area inside it (Pillar K + Pillar S).
 *
 * Before this, v2 had zero error boundaries: any thrown render error
 * killed the entire app and the user lost in-progress edits. Now a
 * boundary at the v2 root catches it and surfaces a recoverable
 * panel; v3 wraps each editor Area so one broken editor doesn't
 * cascade to the rest of the workspace.
 *
 * Class component because the React error-boundary contract still
 * requires `getDerivedStateFromError` / `componentDidCatch`.
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
      // eslint-disable-next-line no-console
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
