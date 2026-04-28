/**
 * v3 shell - re-exports the shared ErrorBoundary from
 * `src/components/ErrorBoundary` so v2 and v3 stay in sync.
 * Phase 0A landed a v3-only one; Phase 0F.6 extracted the shared
 * version under Pillar K.
 *
 * @module v3/shell/ErrorBoundary
 */

export { ErrorBoundary } from '../../components/ErrorBoundary.jsx';
