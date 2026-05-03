# Upstream Parity Audit — Findings

**Status:** ✅ Stage 1 complete 2026-05-03. **Zero unintentional regressions found.** All structural diffs between v3's and upstream's `cmo3writer` are either intentional v3 design changes (with documented reasons) or harness-fixture limitations.

Plan: [UPSTREAM_PARITY_AUDIT.md](UPSTREAM_PARITY_AUDIT.md). Harness: [`scripts/upstream_parity/diff_writers.mjs`](../scripts/upstream_parity/diff_writers.mjs).

## Method

Three synthetic fixtures of increasing scope, all fed to both `v3.generateCmo3` and `upstream.generateCmo3` via dynamic import. After UUID masking and `xs.id`/`xs.ref` normalisation (so renumbering cascades collapse), the resulting `main.xml` is compared line-by-line.

| Fixture | Scope | What it exercises |
|---|---|---|
| `minimal` | 1 mesh, no rig | CAFF packer, XML builder, texture pipeline |
| `two_groups` | 2 meshes / 2 groups, no rig | CPartSource emission, child-of-group mesh handling |
| `with_rig` | 3 tagged meshes (face/body/topwear), `generateRig=true` | body warp chain, FaceParallax (v3-only), per-part rig warps |
| `shelby_like` | 18 tagged meshes covering the full standard tag set, `generateRig=true` | every code path that fires when a "complete" character is exported |

Run any fixture: `node scripts/upstream_parity/diff_writers.mjs <fixture>` (default `minimal`).

## Findings

### F-1 — `<shared>` declaration order: `__RootPart__` / `CBlend_Normal` / `CDeformerGuid:ROOT` / etc. block emitted at different position

**Category:** **Cosmetic / order-only.** Cubism Editor resolves `xs.ref="#N"` regardless of declaration position in `<shared>`; no semantic difference. Confirmed by Cubism Editor accepting both v3 and upstream output without "recovered" status.

**Fixtures affected:** all (`minimal` through `shelby_like`).

**Cause:** v3 emits the bare-root section after parameter/group declarations, while upstream emits it before. Likely a side-effect of the writer's `mainXmlBuilder.js` extraction (one of the v3 refactor sweeps).

**Action:** none. Filing as documented cosmetic diff.

### F-2 — `CParameterGuid:ParamOpacity` declared at different position in `<shared>`

**Category:** **Cosmetic / order-only.** Same reasoning as F-1.

**Fixtures affected:** all (`minimal` through `shelby_like`).

**Cause:** v3's `paramSpec.js` extraction handles `ParamOpacity` separately from the standard params; upstream emits it inline with the other CParameterGuid declarations. Different declaration order, same content.

**Action:** none.

### F-3 — `ParamHairSide` not emitted in v3

**Category:** **Intentional v3 change.**

**Fixtures affected:** `with_rig`, `shelby_like`.

**Documented in:** [`src/io/live2d/rig/paramSpec.js:74`](../src/io/live2d/rig/paramSpec.js#L74):
> `ParamHairSide intentionally removed — declared in pre-refactor cmo3writer but no warp binding or physics rule ever consumed it, so it surfaced as a dead dial in the Parameters panel.`

**Cascading consequences:** Hair Side physics setting also absent in v3 (5 physics settings vs upstream's 7), `parameters.keys` count drops from 23 → 21, RandomPose param list shorter, etc. All trace back to F-3 + F-4.

**Action:** none. Documented decision.

### F-4 — `ParamSkirt`, `ParamShirt`, `ParamPants`, `ParamBust`, hair params gated by `requireTag`

**Category:** **Intentional v3 change.**

**Fixtures affected:** `with_rig` (all clothing/hair params absent — fixture has no matching tags), `shelby_like` (`ParamSkirt` absent — fixture uses `legwear` tag, not `bottomwear`).

**Documented in:** [`src/io/live2d/rig/paramSpec.js:34-44`](../src/io/live2d/rig/paramSpec.js#L34):
> `Each entry may carry requireTag: a tag that some mesh in the project must have for the param to be emitted. Same gating pattern as physics rules. Without this, a character without (say) a skirt mesh still got ParamSkirt registered, polluting the parameter panel with dial positions that drive nothing — see the user report "ParamSkirt without a skirt layer in shelby" (2026-04-30).`

Tags gated:
- `ParamHairFront → 'front hair'`
- `ParamHairBack → 'back hair'`
- `ParamSkirt → 'bottomwear'`
- `ParamShirt → 'topwear'`
- `ParamPants → 'legwear'`
- `ParamBust → 'topwear'`

Upstream emits all of these unconditionally when `generateRig=true`.

**Action:** none. Documented decision; fixed user-reported bug.

### F-5 — Physics not emitted when `physicsRules` is null

**Category:** **Intentional v3 architectural change** (with footgun risk).

**Fixtures affected:** all `generateRig=true` fixtures, when `physicsRules` is not passed.

**Documented in:** [`src/io/live2d/cmo3writer.js:120-123`](../src/io/live2d/cmo3writer.js#L120):
> `// Pre-resolved physics rules (Stage 6 of native rig refactor). boneOutputs already flattened into outputs[]. If absent, callers are expected to pass DEFAULT_PHYSICS_RULES via resolvePhysicsRules (which builds with boneOutputs resolution against project.nodes).`

Production callers ([`exporter.js:532`](../src/io/live2d/exporter.js#L532)) always pass `physicsRules: resolvePhysicsRules(project)`, so users don't hit this. Harness fixture didn't pass any → 0 physics emitted vs upstream's full standard set (7 settings).

**Footgun:** if a future caller forgets to pass `physicsRules`, physics silently fails to emit. Two ways to address:

1. **Fall back to `DEFAULT_PHYSICS_RULES` inside the writer.** Restores upstream behaviour; matches the `params: project.parameters ?? []` pattern.
   - **Blocker:** `DEFAULT_PHYSICS_RULES` carries unresolved `boneOutputs` that need `project.nodes` to flatten into `outputs[]`. The writer doesn't have access to `project.nodes` directly, so naive fallback emits broken rules.
2. **Throw if `physicsRules == null && generatePhysics === true`.** Fail-loud forces caller to opt in or pass rules explicitly.

**Action:** **Deferred** — documented architectural choice, no real-world failure. Could be tightened in a follow-up if a future caller hits this. Tracked here for visibility.

### F-6 — `xs.id` numbering differs (collapsed by harness normalisation)

**Category:** **Cosmetic.** xs.id="#N" / xs.ref="#N" tokens get renumbered when shared-section element order shifts (F-1, F-2). Cubism resolves refs by id, not by position. Harness uses stable label normalisation (`<TagName>:<note>` / `<TagName>#N`) so this no longer dominates the diff.

## Verdict

The v3 refactor sweeps did not introduce silent regressions in the cmo3 writer. Every diff against upstream traces to a documented intentional change (F-3, F-4, F-5) or a cosmetic ordering difference (F-1, F-2, F-6). The `~50 sweeps / -6214 LOC / 5 god-class splits` documented in [memory `project_v3_blender_refactor.md`](../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/project_v3_blender_refactor.md) shipped clean.

### Audit confidence

The synthetic fixtures cover the standard tag landscape but don't exercise:
- Variant normalizer (no `*.suffix` meshes in fixtures)
- Eye closure parabola fit (parabola fit needs alpha-channel PNG bytes; minimal fixture uses 1×1 placeholder)
- Bone-rotation keyforms with non-default `bakedKeyformAngles`
- Per-mesh pre-resolved `rigWarps` map

If the user reports any future drift in those code paths, the harness can be extended with targeted fixtures.

## Future work

If a follow-up ever needs to diff against a real-world project (rather than synthetic fixtures), the cleanest path is:
1. Import the actual project (e.g. `shelby.cmo3`) via v3's `cmo3Import`
2. Reconstruct the `Cmo3Input` shape (meshes/groups/parameters)
3. Feed to both writers

That introduces import-side noise but tests genuine data flow. Not needed right now — the synthetic fixtures already cover the writer-only paths cleanly.
