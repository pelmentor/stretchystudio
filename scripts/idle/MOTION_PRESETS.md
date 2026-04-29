# Procedural motion presets

Generate loop-safe Live2D `.motion3.json` files for characters exported from Stretchy Studio. Bundled together as scenes in `.can3` (editable in Cubism Editor) plus standalone runtime motion files.

## Available presets

| Preset (CLI slug) | Type | What it does |
|---|---|---|
| `idle` | loop | Default rest — head wander, body sway, breath, blinks |
| `listening` | loop | Attentive engagement — periodic acknowledgement nods, focused eyes, slight body lean |
| `talking-idle` | loop | Speech-rhythm mouth + emphasis tilts and brow raises (no lipsync data needed) |
| `embarrassed` | hold | Sustained shy expression — head tucked down, eyes glance away, blush, faster nervous breath |

## Two ways to invoke

### From the SS export dialog (recommended)

1. **File → Export** → pick **Live2D Project** type
2. Tick **"Generate animations"**
3. Pick which motions to include (multi-select), set Personality + Loop duration
4. Export

The zip contains:
- `<name>.cmo3` — model project
- `<name>.can3` — animation scenes for Cubism Editor
- `<name>_<preset>.motion3.json` — one runtime file per selected motion

### From the CLI

```bash
node scripts/idle/generate_idle_motion.mjs <model3.json> [options]
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--preset NAME` | `idle` | Repeat or comma-separate: `idle,listening,talking-idle,embarrassed` |
| `--out PATH` | `<model>_<preset>.motion3.json` | Single-preset output override |
| `--duration N` | `8.0` | Loop duration in seconds (4..15) |
| `--fps N` | `30` | Recorded `Meta.Fps` |
| `--personality NAME` | `calm` | One of: `calm`, `energetic`, `tired`, `nervous`, `confident` |
| `--seed N` | `1` | PRNG seed — same seed → same motion |
| `--register` | off | Append motion(s) to `model3.json`'s `Motions` block under each preset's group |

Examples:

```bash
# All four motions on Shelby with energetic feel
node scripts/idle/generate_idle_motion.mjs models/shelby/Shelby.model3.json \
  --preset idle,listening,talking-idle,embarrassed --personality energetic --register

# Just talking idle for a longer loop
node scripts/idle/generate_idle_motion.mjs models/shelby/Shelby.model3.json \
  --preset talking-idle --duration 12

# Different seed for variety
node scripts/idle/generate_idle_motion.mjs models/shelby/Shelby.model3.json --seed 42
```

## How the presets differ

All presets share the same fundamental approach: drive Live2D Standard Parameters with curves that respect the model's bounds, skip physics-output params, and loop seamlessly.

What differs is **which generator type** runs on each parameter:

| Param | idle | listening | talking-idle | embarrassed |
|---|---|---|---|---|
| ParamAngleX (head turn) | wander ±12° | wander ±5° | wander ±8° | sine, mid=-8° |
| ParamAngleY (head tilt) | wander ±7° | **burst nods** -5° | **burst tilts** -3° | sine, mid=-10° |
| ParamAngleZ (head roll) | wander ±6° | wander ±3° | wander ±4° | sine, mid=-3° |
| ParamBody* | sine ±2.5°/±1.8°/±2.5° | gentler sines | livelier sines | small sines, biased |
| ParamBreath | sine 0..1 over 3.5s | same | faster (3s) | faster (2.5s, nervous) |
| Eye blinks | every ~4s | less frequent (~5s) | more frequent (~3.5s) | nervous (~2.8s) |
| ParamEyeBall* | wander ±0.4/±0.25 | smaller (focused) | active | sine, biased away |
| ParamBrowLY/RY | micro sine | slight raise (engaged) | **burst raises** (emphasis) | held raised (worried) |
| ParamMouthOpenY | constant 0 | constant 0 | **syllables** 0..0.85 | constant 0 |
| ParamMouthForm | constant 0 | constant 0 | slow drift | sine biased -0.2 |
| ParamCheek | constant 0 | constant 0 | constant 0 | **constant 1** (blush) |

## Architecture

The pure synthesis logic lives under `src/io/live2d/idle/`:

- [`src/io/live2d/idle/motionLib.js`](../../src/io/live2d/idle/motionLib.js) — pure curve generators. Each returns `[{time: ms, value, easing}]`. Loop-safety contract: `value(t=0) === value(t=durationMs)`.
  - `genConstant` — flat hold
  - `genSine` — single-frequency oscillation
  - `genWander` — sum of harmonics (look-around drift)
  - `genBlink` — discrete eye-closure events
  - `genBurst` — periodic accent events (nods, brow raises, glances)
  - `genSyllables` — speech-tempo mouth pulses
- [`src/io/live2d/idle/paramDefaults.js`](../../src/io/live2d/idle/paramDefaults.js) — per-preset config tables `IDLE_PARAMS / LISTENING_PARAMS / TALKING_IDLE_PARAMS / EMBARRASSED_HOLD_PARAMS`. Bounds in shared `RANGES` table (DRY). `PRESETS` registry exposes each by name.
- [`src/io/live2d/idle/builder.js`](../../src/io/live2d/idle/builder.js) — pure `buildMotion3({preset, paramIds, ...})` returning `{ motion3, animatedIds, paramKeyframes, paramRanges, skipped, validationErrors }`. No file I/O.
  - `resultToSsAnimation(result)` converts the result to a Stretchy Studio animation shape with first-class **parameter tracks** (`{paramId, min, max, rest, keyframes}`) — the SS animation system's clean way to target Live2D parameters directly.
- [`scripts/idle/generate_idle_motion.mjs`](generate_idle_motion.mjs) — Node CLI: reads `.model3.json` / `.cdi3.json` / `.physics3.json`, calls the builder per `--preset`, writes outputs, optionally registers in model3.

The builder reuses `encodeKeyframesToSegments` and `countSegmentsAndPoints` from [`src/io/live2d/motion3json.js`](../../src/io/live2d/motion3json.js). The SS export pipeline ([`exporter.js`](../../src/io/live2d/exporter.js)) appends each preset's animation to the project's animation list, so `generateCan3` produces one scene per preset in the same `.can3`.

## Validation guarantees

Each generated motion is validated before being written. Failure aborts that motion (others continue):

- `Version === 3`, valid `Meta` block
- `CurveCount === Curves.length`
- Each curve's first value === last value (within 1e-3) when `Loop: true`
- `Meta.TotalSegmentCount` and `TotalPointCount` match an independent re-count over the segment arrays
- All curve `Target` values are `Parameter` / `PartOpacity` / `Model`

## Adding a new preset

1. Define `MY_PRESET_PARAMS` in [`paramDefaults.js`](../../src/io/live2d/idle/paramDefaults.js) — pick `kind` + tuning per Standard Parameter
2. Add an entry to the `PRESETS` registry: `{ params, label, description, cycleType }`
3. Add a CLI alias in `KEBAB_TO_PRESET` and `PRESET_TO_KEBAB` in [`generate_idle_motion.mjs`](generate_idle_motion.mjs)
4. Surface the new preset in the v3 export operator (Phase 5; the
   v2 ExportModal where this row used to live was retired 2026-04-29)

That's it — the builder dispatcher picks it up automatically. No changes to `can3writer.js` / `motion3json.js` / `exporter.js` needed.

## Adding a new generator kind

If you need a motion shape the existing 6 generators don't cover (e.g. wave/jump/run with explicit timing):

1. Write `genXxx(opts)` in [`motionLib.js`](../../src/io/live2d/idle/motionLib.js) — must return `[{time, value, easing}]` with loop closure
2. Add `case 'xxx':` in `synthesiseKeyframes` in [`builder.js`](../../src/io/live2d/idle/builder.js)
3. Use `kind: 'xxx'` in any preset's PARAMS table

## Limitations

- **No expression / mood inflection beyond the 5 personalities.** Personality multiplies amplitudes/periods. For radically different feel, define a new preset.
- **No "look at object" wander biasing.** Wander is unbiased noise. To bias, use `sine` with `mid` set instead, or override per-param config.
- **Single seed per preset per export.** For runtime variety, generate twice with different seeds and let SDK rotate.
- **Linear segments mostly.** Most curves are linear at high sample density. Burst events use `ease-in-out` easing (encodes as bezier).
- **Wave / point / arm gestures NOT included.** Auto-rig drives `ParamRotation_*Elbow` via physics; motion targeting them would conflict. Out of scope for now.
