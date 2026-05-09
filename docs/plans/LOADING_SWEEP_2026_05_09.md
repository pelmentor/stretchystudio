# Loading-page sweep — 2026-05-09 (Phase A2)

Continuation of Phase A's loading work that landed earlier the same
day (commits `6653926` + four memory/render/runtime/pipeline phases,
recorded in [PERFORMANCE_AUDIT_2026_05_09.md](./PERFORMANCE_AUDIT_2026_05_09.md)).
Phase A pruned mechanical wins (lazy modals/editors/fonts, dead deps);
this Phase A2 pass targets the residual eager surface that mechanical
pruning couldn't reach. Working rule throughout: **RULE №1 — no
quick-and-dirty fixes**.

## Goal

User asked: "How can we drastically improve LOADING PAGE time of
Stretchy Studios? Per rule №1, big changes are ok." After Phase A
the eager bundle was 321 kB gzip and the browser still showed a
blank page until JS finished parsing. The mandate was architectural,
not mechanical: shell-first render, store-init lazyness, route/
workspace splits, PWA caching.

## Audit dimensions

Three parallel read-only agents:

1. **Bundle / boot path** — `dist/` chunk inspection, trace from
   `main.jsx` → first canvas render, identify what synchronous work
   blocks first paint and which eager imports are non-essential.
2. **Architectural opportunities** — high-leverage changes the
   mechanical sweep couldn't reach: shell-first render, store-init
   lazyness, PWA, idle prefetch, critical CSS, React 18+ features.
3. **Asset pipeline** — fonts, CSS, icons, public assets, network
   waterfall, cache headers, wasm/binary handling.

The synthesised punch list lives below.

## Punch-list status

Format: `[STATUS] ID — short` (file:line) — note. STATUS is one of
`SHIPPED` / `N/A` / `⏳DEFERRED⏳`. Commit refs link to the
loading-sweep commits.

### Bundle / boot path

| ID | Item | Files | Status |
|---|---|---|---|
| BL1 | `armatureOrganizer.js` (744 lines) eager-imported by CanvasViewport (`detectCharacterFormat`) + SkeletonOverlay (`SKELETON_CONNECTIONS`) just for boot-light constants | [src/io/armatureMeta.js](../../src/io/armatureMeta.js) (new), [armatureOrganizer.js](../../src/io/armatureOrganizer.js) (re-exports) | SHIPPED `7e264a9` |
| BL2 | `initRig.js` static-imported by `rigSpecStore.js:5` + `RigService.js:26` — drags the entire cmo3/moc3/can3 binary writer + exporter graph onto the eager path | [src/store/rigSpecStore.js](../../src/store/rigSpecStore.js), [src/services/RigService.js](../../src/services/RigService.js) (`_harvestPipeline()`) | SHIPPED `7e264a9` |
| BL3 | `Topbar.jsx` eager-imports `PreferencesModal` (themePresets + KeymapModal + i18n) and `NewProjectDialog` (projectTemplates) | [src/v3/shell/Topbar.jsx](../../src/v3/shell/Topbar.jsx) (lazy + open-gated) | SHIPPED `df44ccf` |
| BL4 | `CanvasViewport.jsx:33` eagerly imports `PsdImportService` (only used on PSD drop) | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (`await import` at drop branch) | SHIPPED `df44ccf` |
| BL5 | `vite-plugin-pwa` not in use; SW deferral comment in `index.html:8-12` left repeat visits paying full network cost | [vite.config.js](../../vite.config.js), [src/lib/swRegister.jsx](../../src/lib/swRegister.jsx) | SHIPPED `7b896e5` |
| BL6 | Vite copying `ort-wasm-*.{wasm,mjs,js}` (~25 MB) into `dist/` despite runtime CDN redirect | [vite.config.js](../../vite.config.js) (`dropOrtWasm` plugin) | SHIPPED `df44ccf` |
| BL7 | `@fontsource/<family>` default entry pulls 8 subsets × 2 styles per family (~7 MB unused WOFF2s) | [src/contexts/ThemeProvider.jsx](../../src/contexts/ThemeProvider.jsx) (`/latin.css` only) | SHIPPED `df44ccf` |
| BL8 | First click on Save / Open / Properties pays 50-200ms network round-trip per chunk | [src/lib/idlePrefetch.js](../../src/lib/idlePrefetch.js) (new) | SHIPPED `43349cc` |
| BL9 | Browser shows blank `#root` until JS bundle finishes evaluating (~1.5-3s on slow devices) | [index.html](../../index.html) (inline shell + theme variables + sync theme-class resolver) | SHIPPED `5761970` |
| BL10 | `projectStore.js` eagerly imports 11 seed modules just because Topbar reads `hasUnsavedChanges` | [src/store/projectStoreSeeds.js](../../src/store/projectStoreSeeds.js) (new), seedAllRig + 11 actions → async | SHIPPED `8364cb7` |
| BL11 | `projectStore.js` eagerly imports 7 rig-peer modules (migrations, meshSync, deformerNodeSync, artMeshRuntimeSync, paramReferences, paramSchemaDrift, meshSignature) | [src/store/projectStoreRigPeers.js](../../src/store/projectStoreRigPeers.js) (new), [projectSchemaVersion.js](../../src/store/projectSchemaVersion.js) (tiny constant) | SHIPPED `0a232cd` |
| - | Workspace-scoped editor loading (only active-workspace tabs trigger import on boot) | n/a | N/A — verified Vite + React.lazy + Area.jsx already do this; modulepreload only the 5 vendor chunks |

### Asset pipeline

| ID | Item | Files | Status |
|---|---|---|---|
| AS1 | 25 MB ort-wasm in dist (already covered above) | — | SHIPPED `df44ccf` |
| AS2 | Font subset to latin only (already covered above) | — | SHIPPED `df44ccf` |
| AS3 | Critical-CSS extraction | n/a | ⏳DEFERRED⏳ — agent estimated 0.5-1 kB gzip win, not worth the effort |
| AS4 | Cache-Control immutable headers | host config | DEPLOYMENT — set at hosting layer; PWA precache makes this redundant for repeat visits anyway |
| AS5 | 7 unused Radix wrappers (`accordion`, `alert-dialog`, `aspect-ratio`, `avatar`, `hover-card`, `menubar`, `navigation-menu`, `progress`) | n/a | OBSERVED — already tree-shaken by Vite, contribute 0 wire bytes; node_modules-only bloat |

### Architectural

| ID | Item | Files | Status |
|---|---|---|---|
| AR1 | Pre-React static shell + inline theme | [index.html](../../index.html) | SHIPPED `5761970` |
| AR2 | Workspace-scoped editor loading | n/a | N/A — already covered by `lazy()` + Vite |
| AR3 | projectStore lite/full split | seeds + rig-peers + tiny constant | SHIPPED `8364cb7` + `0a232cd` |
| AR4 | PWA via vite-plugin-pwa | [vite.config.js](../../vite.config.js), [src/lib/swRegister.jsx](../../src/lib/swRegister.jsx) | SHIPPED `7b896e5` |
| AR5 | Idle prefetch | [src/lib/idlePrefetch.js](../../src/lib/idlePrefetch.js) | SHIPPED `43349cc` |
| AR6 | `react-resizable-panels` boot-time skeleton | [src/v3/shell/AreaTree.jsx](../../src/v3/shell/AreaTree.jsx) | ⏳DEFERRED⏳ — ~10-15 kB gzip + ~20ms layout work; medium risk (panel autosave restoration must still trigger) |
| AR7 | `rigSpecStore` module-level subscribers (lines 219, 247) keeping `selectRigSpec` + `physicsConfig` eager | [src/store/rigSpecStore.js](../../src/store/rigSpecStore.js) | ⏳DEFERRED⏳ — small win; subscribers themselves are dormant, only the static imports matter |
| AR8 | Per-vendor splitting (vendor-react, vendor-radix further) | [vite.config.js](../../vite.config.js) | ⏳DEFERRED⏳ — trades cache locality for HTTP fan-out, unclear net win |

## Validation

Each commit gated against tsc + relevant test suites + production
build before landing:

| Commit | tsc | build | tests |
|---|---|---|---|
| `7e264a9` (armatureMeta + initRig) | clean | clean | typecheck, harvestCache 11/11, rigStageOps 18/18, runStageIntegration 31/31 |
| `df44ccf` (Topbar + ort-wasm + fonts) | clean | clean | typecheck — eager 322→242 kB gzip after this commit |
| `43349cc` (idle prefetch) | clean | clean | typecheck |
| `5761970` (static shell) | clean | clean | typecheck — dist/index.html shell embedded at build time |
| `8364cb7` (seed deferral) | clean | clean | editorStore 87/87, initRig 60/60, projectRoundTrip 41/41, saveLoadRigSpec 19/19, rigStageOps 18/18, runStageIntegration 31/31, harvestCache 11/11 |
| `0a232cd` (rig peers + schema-version split) | clean | clean | projectRoundTrip 41/41, saveLoadRigSpec 19/19, editorStore 87/87, migrations 135/135, rigStageOps 18/18, initRig 60/60 |
| `7b896e5` (PWA) | clean | clean | typecheck — `dist/sw.js` + `dist/workbox-*.js` emitted; precache 9 entries (~800 KiB) |

## Numbers

**Eager bundle (gzipped, sum of 5 vendor chunks + index):**
- Pre-Phase-A baseline (2026-05-09 morning): ~531 kB
- Phase A landed: 321 kB (-40%)
- **Phase A2 landed: 226 kB (-30% on top of Phase A; -57% vs baseline)**

**Per-chunk delta over Phase A2:**

| Chunk | Phase A | Phase A2 | Δ |
|---|---|---|---|
| `index-*.js` | 197 kB gzip | 101 kB gzip | -96 kB |
| `vendor-*.js` (sum of 5) | 124 kB gzip | 125 kB gzip | +1 kB (Suspense glue) |
| **eager total** | **321 kB** | **226 kB** | **-95 kB** |
| `initRig-*.js` (new lazy) | n/a | 66 kB gzip | new |
| `dist/` artifact (raw) | ~30 MB | 6.9 MB | -23 MB (ort-wasm + font subsets dropped) |

**Time-to-first-pixel (estimates, not measurements — verify with Lighthouse):**

| Network/device | Pre-A2 | Post-A2 | Why |
|---|---|---|---|
| Fast desktop, fiber | ~1.5-2s blank → app | ~150ms shell → ~700ms app | Static shell paints after HTML parse, doesn't wait on JS |
| Mid-tier laptop, decent wifi | ~2-3s blank → app | ~150ms shell → ~1s app | Shell first; JS evaluates underneath |
| Slow 3G mobile | ~6-10s blank → app | ~500ms shell → ~3-4s app | Shell paints once HTML lands; JS download still slow but user sees "the app loaded" |

**Repeat-visit time (PWA Workbox precache):**
- ~100-300ms to fully interactive regardless of network — even offline.
- Precache list: `index.html` + eager `index-*.js` + eager `vendor-*.js` + CSS (~800 KiB across 9 entries).
- Lazy chunks runtime-cache (`CacheFirst`, 30d expiration) on first fetch.
- New deploys ship a new SW; user gets the "Update available" toast in the lower-right and stays on the cached old version until they click Reload (no mid-session asset swap).

**Specific user actions:**
- **Init Rig click:** previously eager. Now ~50-200ms network round-trip on first click (66 kB gzip `initRig-*.js` chunk fetch); negligible vs. the multi-second harvest itself.
- **Save / Open / Settings / New / Properties tab:** idle-prefetched via `requestIdleCallback` post-paint. Cached by the time the user clicks. ~0ms perceived open.
- **PSD drop:** PsdImportService now dynamic — first drop pays ~30-100ms network round-trip before the worker fires.

## Architecture decisions made

1. **`armatureOrganizer.js` split.** Boot-light constants
   (`KNOWN_TAGS`, `matchTag`, `detectCharacterFormat`,
   `SKELETON_CONNECTIONS`) extracted to new
   [armatureMeta.js](../../src/io/armatureMeta.js).
   `armatureOrganizer.js` re-exports them for back-compat; new code
   targets `@/io/armatureMeta` directly. Eager consumers (CanvasViewport,
   SkeletonOverlay) flipped to the new path.

2. **`_harvestPipeline()` in RigService.** Memoised dynamic import of
   `initRig` + `imageHelpers`. Concurrent callers share a single
   import promise. `memoInitializeRigFromProject` (P4 from the perf
   audit) reuses the loader for its first await.

3. **`loadSeedModule()` in projectStoreSeeds.** Memoised parallel
   import of 11 seed-module ESM. seedAllRig + 11 individual seed
   actions converted to async; RigService callers add `await`.

4. **`loadRigPeers()` in projectStoreRigPeers.** Same shape as the
   seed loader, for 7 rig-peer modules: meshSignature, meshSync,
   deformerNodeSync, artMeshRuntimeSync, paramReferences,
   paramSchemaDrift, projectMigrations. loadProject + weight-paint
   actions converted to async; LoadModal / Cmo3InspectModal / direct
   CanvasViewport callers add `await`.

5. **`projectSchemaVersion.js`.** Tiny side-effect-free file that
   exports just `CURRENT_SCHEMA_VERSION = 32`. projectStore reads it
   for initial state without dragging the migrations graph.
   `projectMigrations.js` imports + re-exports for back-compat.

6. **PWA via vite-plugin-pwa with `registerType: 'prompt'`.**
   Auto-update would risk swapping assets mid-export / mid-wizard;
   prompt requires explicit user accept.
   [src/lib/swRegister.jsx](../../src/lib/swRegister.jsx)
   `<ServiceWorkerUpdater>` component is itself lazy-loaded so the SW
   glue stays out of the eager bundle.

7. **Pre-React static shell.** Inline HTML/CSS in
   [index.html](../../index.html) renders a 40px topbar + checkered
   canvas placeholder + sidebar outlines using the same CSS variables
   the real theme uses (sourced from `src/index.css`). A synchronous
   `<script>` reads `localStorage.theme_mode` and toggles `.dark` on
   the documentElement BEFORE body renders — eliminates the dark-mode
   flash. React's `createRoot` replaces `#root`'s children on first
   commit; the visual transition is invisible.

## Caveats

- Time numbers above are **estimates from bundle sizes + known browser
  behaviors, not measurements**. Run `npm run build && npm run preview`
  locally and use Chrome DevTools Lighthouse for ground truth.
- Repeat-visit benefits assume the deploy host sets aggressive cache
  headers on `/assets/*` (Vite's hashed filenames make
  `Cache-Control: max-age=31536000, immutable` safe). Without that,
  repeat visits still re-download. Check hosting config.
- The 25 MB `ort-wasm` dropped from `dist/` is **deploy-time** savings
  (faster CI uploads, less storage). Runtime users were always going
  to fetch from the CDN.
- The PWA "Update available" toast means users stay on the cached old
  version until they click Reload. By design (no mid-session
  breakage), but means cache benefit applies only to unchanged
  deploys.

## Deferred work

Three follow-ups identified by agents but not shipped this session:

1. **`react-resizable-panels` boot-time skeleton** —
   [AreaTree.jsx](../../src/v3/shell/AreaTree.jsx) mounts 3
   PanelGroups synchronously; the library runs measurement on mount.
   Replace boot-time render with a CSS-grid skeleton that visually
   matches; swap to Panels after first paint via `startTransition` or
   post-mount lazy import. Win: ~10-15 kB gzip + ~20ms layout.
   Risk: medium (panel autosave restoration must still trigger).
   Effort: 4-6h.

2. **`rigSpecStore` module-level subscribers** — lines 219, 247
   register `useProjectStore.subscribe` at module init. The
   subscribers themselves are dormant until project changes, but the
   static imports they reference (`selectRigSpec`, `physicsConfig`)
   still land in the eager graph. Move into `useEffect` of an
   AppShell-mounted wrapper. Win: small.

3. **Per-vendor splitting** — `vendor-react` (47 kB gzip),
   `vendor-radix` (36 kB gzip) could each split further (e.g.
   react-dom separately from react). Trades cache locality for HTTP
   request fan-out; unclear net win on HTTP/2.

## File index

**New files:**
- [src/io/armatureMeta.js](../../src/io/armatureMeta.js) — boot-light constants
- [src/lib/idlePrefetch.js](../../src/lib/idlePrefetch.js) — `requestIdleCallback` queue
- [src/lib/swRegister.jsx](../../src/lib/swRegister.jsx) — `<ServiceWorkerUpdater>` toast
- [src/store/projectSchemaVersion.js](../../src/store/projectSchemaVersion.js) — tiny constant file
- [src/store/projectStoreSeeds.js](../../src/store/projectStoreSeeds.js) — 11 seed modules lazy loader
- [src/store/projectStoreRigPeers.js](../../src/store/projectStoreRigPeers.js) — 7 rig peer modules lazy loader

**Modified entry points:**
- [index.html](../../index.html) — pre-React shell + theme variables
- [src/main.jsx](../../src/main.jsx) — kicks idle prefetch
- [src/v3/shell/AppShell.jsx](../../src/v3/shell/AppShell.jsx) — mounts `<ServiceWorkerUpdater>`
- [vite.config.js](../../vite.config.js) — VitePWA plugin + dropOrtWasm

**Modified consumers (await async actions):**
- `src/services/RigService.js` — `_harvestPipeline()`, await store actions
- `src/components/canvas/CanvasViewport.jsx` — await `loadProject`, dynamic `PsdImportService`
- `src/v3/shell/LoadModal.jsx` / `Cmo3InspectModal.jsx` — await `loadProject`
- `scripts/test/test_projectRoundTrip.mjs` / `test_saveLoadRigSpec.mjs` — await async store actions

## Closing

Sweep closed 2026-05-09 evening. Working tree clean, 32 commits ahead
of origin pre-doc, 33 commits with this writeup.
