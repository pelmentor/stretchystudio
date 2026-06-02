# Session aggregate — 2026-06-02 round-2

Second `Workflow` audit over the modalities the round-1 critic flagged as uncovered, plus autonomous fix sweep. 16 commits, **27 / 35 confirmed findings shipped end-to-end**. Tracking doc: [AUDIT_2026_06_02_R2_MISSING_MODALITIES.md](AUDIT_2026_06_02_R2_MISSING_MODALITIES.md).

## Phase 1 — round-2 workflow

User: **"go"** — proceed with the second-round workflow flagged by the round-1 critic.

**Workflow shape** (`wf_13a3aa07-109`, 193 agents, ~8.7M tokens, 25 min):

```
phase('Find')   — 6 parallel finders (perf-gpu / data-integrity /
                  workers-async / undo-memory / depgraph-core / security)
phase('Verify') — 3 lenses per finding (existence / severity / context),
                  default refuted=true, survives if ≤1 of 3 refutes
phase('Critic') — completeness critic on confirmed set + missed-category list
```

**Result:** 62 raw → **35 confirmed / 27 refuted** (44% pruning). Slightly lower pruning than round-1 (50%) because these dimensions touch less-documented surfaces — context lens had fewer "documented as deferred" hits to land on.

Critic flagged 16 additional categories not yet covered (live2d-json-subformats, CI infra, cross-store, build-tooling, ui-edge-cases, etc.). Strong round-3 recommendation.

## Phase 2 — autonomous fix sweep

User had pre-stated **"автономно фикси"** standing → ship through the punch list without re-prompting.

### Commits chronology

| # | Commit | Author | Item(s) | Net |
|---|--------|--------|---------|-----|
| 1 | `053eaeb` | pelmentor | tracking doc | +100 |
| 2 | `5d5c5af` | Claude | DEPGRAPH-EVAL-01 — surface kernel exceptions | +17 -2 |
| 3 | `c323d7a` | pelmentor | F1 — project.cursor save/load | +18 |
| 4 | `10169b0` | Claude | F6 — writeF32 throw on non-finite | +14 -1 |
| 5 | `ee39d8a` | pelmentor | SEC-001 — CAFF parser bounds | +22 |
| 6 | `be96b06` | Claude | WORKER-001 — replace dead worker | +26 -3 |
| 7 | `bdd1a24` | pelmentor | WORKER-002/-004/-007 batch | +23 -3 |
| 8 | `4d8c516` | Claude | WORKER-003/-006/-008 + MEM-05/-09 batch | +63 -5 |
| 9 | `28e9ed7` | pelmentor | MEM-01 — deleteNode blob revoke | +11 |
| 10 | `d0051ce` | Claude | MEM-02 + MEM-11 — AudioContext lifecycle | +45 -1 |
| 11 | `88fd2b3` | pelmentor | PERF-2 + SEC-004 + SEC-006 + PERF-8 — orphan blobs | +25 -1 |
| 12 | `f3060ff` | Claude | PERF-4 — typed UV cache | +20 -2 |
| 13 | `b194a42` | pelmentor | PERF-1 + DEPGRAPH-FRAME-01 — memoize buildDepGraph | +37 -1 |
| 14 | `95aa073` | Claude | DEPGRAPH-BUILD-03 — nodesById map | +16 -2 |
| 15 | `47e50f8` | pelmentor | F5 + PERSIST-01 — duplicateProject tx | +24 -13 |
| 16 | `75e0437` | Claude | SEC-005 + SEC-007 — driver tokens + PSD iter | +57 -35 |

**Net:** ~+390 LOC substantive fixes / new guards / lifecycle helpers, ~−70 LOC of broken / unsafe patterns retired.

### Items closed

- **RULE-№1 (silent fallbacks):** DEPGRAPH-EVAL-01 (depgraph kernel swallow), F6 (writeF32 NaN guard), WORKER-003/-006/-008 (worker / decode error escalation), MEM-05 (Image onerror).
- **RULE-№1 (no-op-on-error contracts):** WORKER-001 (dead worker reuse), WORKER-002 (unawait), WORKER-004 (silent no-op), WORKER-007 (sticky rejection memo), F5 / PERSIST-01 (IndexedDB tx race).
- **Memory lifecycle:** MEM-01 (deleteNode blob revoke), MEM-02 + MEM-11 (AudioContext close + buffersRef prune), MEM-09 (save URL timing), PERF-2 + SEC-004 + SEC-006 + PERF-8 (orphan blob URL revoke across 3 sites).
- **Perf (hot path):** PERF-1 + DEPGRAPH-FRAME-01 (buildDepGraph memo), DEPGRAPH-BUILD-03 (nodesById map), PERF-4 (typed UV cache).
- **Data integrity:** F1 (cursor persistence), F5 / PERSIST-01 (duplicateProject race), F6.
- **Security:** SEC-001 (CAFF bounds), SEC-005 (driver token list widening), SEC-007 (PSD iterative walk).

### Architectural shifts

1. **Depgraph kernel exceptions are loud.** `eval.js` now routes failing kernels through `logger.error('depgraph', ...)` with a per-eval-run dedupe Set so a per-frame failure does not flood the ring buffer. The Logs panel names the failing opcode + op name. Pre-fix: bare `catch {}` → undefined, no log entry, faintly-wrong viewport.

2. **buildDepGraph memoized by project identity.** Module-level `WeakMap<project, Map<action|'none', DepGraph>>` cache in `evalProjectFrame.js`. Immer's structural-sharing guarantee means new project ref ⇒ cache miss, otherwise reuse. Eliminates the per-frame O(N nodes) × 2 passes + DFS cycle detection that dominated viewport playback cost on Hiyori-class rigs.

3. **Worker pool resurrection.** psdFinalize pool now replaces a worker after `onerror` (terminate → spawn replacement → bind same handlers → re-enqueue). Pre-fix the pool kept handing jobs to a dead worker; every queued Promise hung forever after one crash.

4. **Operator-error escalation extended to runtime.** Beyond the round-1 menu-invoker `reportOpFailure` substrate, this round added `logger.error(...)` + toast routing at: `dispatchMeshWorker` reject path, all four `new Image()` decode sites in CanvasViewport, `RigService` import retry, TimelineEditor audio decode, `handleSave` catch. Failed runtime work no longer looks like successful no-ops.

5. **Blob URL lifecycle hardened end-to-end.** Three sites previously leaked blob URLs per import/decode/delete: `deleteNode` (per-part), `cmo3Import` (per-orphan-PNG), `projectFile.loadProject` (per-corrupt-texture-throw). Now all three revoke. Combined with MEM-02 / MEM-11 AudioContext cleanup, the editor's session-long resource bookkeeping closes the obvious leaks.

6. **CAFF parser defends against malicious input.** `readBytes` rejects `pos+len > buf`; per-entry table read validates `startPos in [0, buf)` and `startPos+storedLen <= buf` before seek+read. A crafted `.cmo3` can no longer OOM the tab via a multi-GB varint length.

## RULE-№5 alternation

Strictly maintained Claude ↔ pelmentor across all 16 commits this round. (Pelmentor on tracking doc, then alternating one-per-commit through close-out.)

## Open work — for next session

### Deferred (8 items)

See [AUDIT_2026_06_02_R2_MISSING_MODALITIES.md](AUDIT_2026_06_02_R2_MISSING_MODALITIES.md) "Deferred" section for full reasons:

- **PERF-3** moc3 `BinaryWriter` Uint8Array refactor
- **PERF-5** FCurveEditor Plot memoization (component split)
- **PERF-6** texture sync in-flight dedup
- **PERF-7** PerformanceEditor ring buffer (low impact)
- **WORKER-010** swRegister AbortController (doc-as-intentional; no behavioural bug)
- **MEM-03** undo-history blob URL refcount (design needed)
- **DEPGRAPH-BUILD-01** driver node-property variables (substrate change)
- **STORE-03** `applyPoseAsRest` overlay-followed parts (needs overlay-bake design)

### Round-3 candidates (per critic)

Rank-ordered: live2d-json-subformats / CI / cross-store / build-tooling / ui-edge-cases. Top 5 likely produces 25-40 fresh findings per critic estimate.

### Blocked on user (unchanged from round-1)

- **bug-03 Shelby handwear bbox** — I-14/I-15 invariants shipped 2026-05-26 but not yet exercised. User re-run Init Rig deterministically names the next code-level action.
- **bug-01 BUG-015 BodyAngle** — needs real drag-repro in Logs panel.

## Resume hint for next Claude

Per RULE-№5 alternation: last commit was Claude `75e0437`. Next commit must be pelmentor.

**Highest-ROI starting points (in order of safety):**
1. Wait for user to re-run Init Rig → I-14/I-15 surfaces bug-03 root cause deterministically.
2. Pick one DEFERRED item — each is well-scoped, single substrate.
3. Launch round-3 Workflow over the top-5 critic-flagged categories (~150 agents, ~20 min).

Do NOT speculate on handwear without the re-run, do NOT decide unilaterally on substantial refactors (god-class splits, MOC3 BinaryWriter refactor) — ask the user.
