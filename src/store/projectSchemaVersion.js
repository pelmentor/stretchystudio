// @ts-check

/**
 * Tiny schema-version constant separated from `projectMigrations.js`
 * so the eager bundle (projectStore initial state needs this number)
 * doesn't pull in the 11 migration modules + deformerNodeSync graph.
 *
 * Phase A2 loading sweep (2026-05-09).
 *
 * Adding a migration: bump this number AND add the migration entry in
 * `projectMigrations.js`. The migrations module re-exports this same
 * constant for back-compat.
 *
 * @module store/projectSchemaVersion
 */

export const CURRENT_SCHEMA_VERSION = 33;
