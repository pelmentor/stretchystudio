// CLI: generate procedural Live2D motion3.json files for an SS-exported model.
//
// Thin wrapper around the pure builder at src/io/live2d/idle/builder.js —
// adds file I/O (read .model3.json + .cdi3.json + .physics3.json, write
// motion3.json, optionally register in model3).
//
// Usage:
//   node scripts/idle/generate_idle_motion.mjs <model3.json> [options]
//
// Options:
//   --preset <name>       idle | listening | talking-idle | embarrassed
//                         (repeat or comma-separate to generate multiple)
//   --out <path>          Output motion3.json path (default: <model>_<preset>.motion3.json)
//                         When multiple --preset values are supplied, --out is ignored
//                         and each is written as <model>_<preset>.motion3.json next to model.
//   --duration <seconds>  Total motion duration (default: 8.0, sane range 4..15)
//   --fps <n>             Recorded fps in Meta (default: 30)
//   --personality <name>  calm | energetic | tired | nervous | confident (default: calm)
//   --seed <int>          Deterministic seed (default: 1)
//   --register            Append generated motion(s) to model3.json's Motions block

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, basename, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILDER_PATH = resolve(HERE, '..', '..', 'src', 'io', 'live2d', 'idle', 'builder.js');
const { buildMotion3, PERSONALITY_PRESETS, PRESET_NAMES, PRESETS } = await import(pathToFileURL(BUILDER_PATH).href);

// CLI uses kebab-case for nicer typing; map to internal camelCase preset ids.
const KEBAB_TO_PRESET = {
  'idle': 'idle',
  'listening': 'listening',
  'talking-idle': 'talkingIdle',
  'talking': 'talkingIdle',
  'embarrassed': 'embarrassedHold',
  'embarrassed-hold': 'embarrassedHold',
};
const PRESET_TO_KEBAB = {
  'idle': 'idle',
  'listening': 'listening',
  'talkingIdle': 'talking-idle',
  'embarrassedHold': 'embarrassed',
};


/* ── Arg parsing ──────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { _: [], duration: 8.0, fps: 30, personality: 'calm', seed: 1, register: false, presets: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--out')              { args.out = argv[++i]; }
    else if (a === '--duration')    { args.duration = parseFloat(argv[++i]); }
    else if (a === '--fps')         { args.fps = parseInt(argv[++i], 10); }
    else if (a === '--personality') { args.personality = argv[++i]; }
    else if (a === '--seed')        { args.seed = parseInt(argv[++i], 10); }
    else if (a === '--register')    { args.register = true; }
    else if (a === '--preset')      {
      const v = argv[++i];
      for (const piece of v.split(',')) args.presets.push(piece.trim());
    }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else if (a.startsWith('--'))    { console.error(`Unknown flag: ${a}`); process.exit(1); }
    else                            { args._.push(a); }
    i++;
  }
  if (args.presets.length === 0) args.presets = ['idle'];
  return args;
}


/* ── Discover params from the model's cdi3.json ──────────────────────── */

function discoverParams(model3Path, model3) {
  const cdiRel = model3?.FileReferences?.DisplayInfo;
  if (!cdiRel) return [];
  const cdiPath = join(dirname(model3Path), cdiRel);
  if (!existsSync(cdiPath)) {
    console.warn(`[warn] DisplayInfo file not found: ${cdiPath}`);
    return [];
  }
  try {
    const cdi = JSON.parse(readFileSync(cdiPath, 'utf8'));
    return (cdi.Parameters ?? []).map(p => p.Id).filter(Boolean);
  } catch (err) {
    console.warn(`[warn] failed to parse cdi3 ${cdiPath}: ${err.message}`);
    return [];
  }
}


/* ── Discover physics output param IDs from physics3.json ────────────── */

function discoverPhysicsOutputs(model3Path, model3) {
  const physRel = model3?.FileReferences?.Physics;
  if (!physRel) return new Set();
  const physPath = join(dirname(model3Path), physRel);
  if (!existsSync(physPath)) {
    console.warn(`[warn] Physics file not found: ${physPath}`);
    return new Set();
  }
  try {
    const phys = JSON.parse(readFileSync(physPath, 'utf8'));
    const outputs = new Set();
    for (const setting of (phys.PhysicsSettings ?? [])) {
      for (const out of (setting.Output ?? [])) {
        const id = out?.Destination?.Id;
        if (id) outputs.add(id);
      }
    }
    return outputs;
  } catch (err) {
    console.warn(`[warn] failed to parse physics3 ${physPath}: ${err.message}`);
    return new Set();
  }
}


/* ── Main ────────────────────────────────────────────────────────────── */

function printHelp() {
  const presetList = PRESET_NAMES
    .map(p => `${PRESET_TO_KEBAB[p].padEnd(15)} ${PRESETS[p].label.padEnd(14)} — ${PRESETS[p].description}`)
    .join('\n  ');
  console.log(`Generate procedural Live2D motion3.json files.

Usage:
  node scripts/idle/generate_idle_motion.mjs <model3.json> [options]

Options:
  --preset <name>        Repeat or comma-separate. Default: idle
  ${presetList}
  --out <path>           Single-preset output override (default: <model>_<preset>.motion3.json)
  --duration <seconds>   Motion duration (default: 8.0)
  --fps <n>              Meta.Fps (default: 30)
  --personality <name>   ${PERSONALITY_PRESETS.join(' | ')} (default: calm)
  --seed <int>           Deterministic seed (default: 1)
  --register             Append motion(s) to model3.json's Motions block
  -h, --help             This help.
`);
}

function resolvePresets(rawPresets) {
  const normalised = [];
  for (const raw of rawPresets) {
    const preset = KEBAB_TO_PRESET[raw];
    if (!preset) {
      console.error(`Unknown preset '${raw}'. Valid: ${Object.keys(KEBAB_TO_PRESET).join(', ')}`);
      process.exit(1);
    }
    if (!normalised.includes(preset)) normalised.push(preset);
  }
  return normalised;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) { printHelp(); process.exit(args.help ? 0 : 1); }

  const model3Path = resolve(args._[0]);
  if (!existsSync(model3Path)) {
    console.error(`Model file not found: ${model3Path}`);
    process.exit(1);
  }
  if (!Number.isFinite(args.duration) || args.duration < 1 || args.duration > 60) {
    console.error(`Invalid --duration ${args.duration} (must be 1..60)`);
    process.exit(1);
  }

  const presets = resolvePresets(args.presets);
  const model3 = JSON.parse(readFileSync(model3Path, 'utf8'));
  const paramIds = discoverParams(model3Path, model3);
  const physicsOutputIds = discoverPhysicsOutputs(model3Path, model3);

  const usingExplicitOut = !!args.out && presets.length === 1;

  for (const preset of presets) {
    let result;
    try {
      result = buildMotion3({
        preset,
        paramIds,
        physicsOutputIds,
        durationSec: args.duration,
        fps: args.fps,
        personality: args.personality,
        seed: args.seed,
      });
    } catch (err) {
      console.error(`[FAIL ${preset}] ${err.message}`);
      process.exit(1);
    }

    if (result.validationErrors.length > 0) {
      console.error(`[FAIL ${preset}] Validation errors:`);
      for (const e of result.validationErrors) console.error('  ' + e);
      process.exit(2);
    }
    if (result.animatedIds.length === 0) {
      console.warn(`[skip ${preset}] No animatable params present in model.`);
      continue;
    }

    const presetSlug = PRESET_TO_KEBAB[preset];
    const defaultOutName = basename(model3Path)
      .replace(/\.model3\.json$/i, '')
      + `_${presetSlug.replace(/-/g, '_')}.motion3.json`;
    const outPath = usingExplicitOut
      ? resolve(args.out)
      : join(dirname(model3Path), defaultOutName);

    writeFileSync(outPath, JSON.stringify(result.motion3, null, '\t'));

    if (args.register) {
      const motionRel = relative(dirname(model3Path), outPath).split(/[\\/]/).join('/');
      if (!model3.FileReferences) model3.FileReferences = {};
      if (!model3.FileReferences.Motions) model3.FileReferences.Motions = {};
      // Register under the preset's label as the motion group name.
      const groupName = PRESETS[preset].label;
      if (!model3.FileReferences.Motions[groupName]) model3.FileReferences.Motions[groupName] = [];
      const already = model3.FileReferences.Motions[groupName].some(m => m.File === motionRel);
      if (!already) {
        model3.FileReferences.Motions[groupName].push({ File: motionRel });
      }
    }

    const m = result.motion3.Meta;
    console.log(`[OK ${preset}] ${basename(outPath)}`);
    console.log(`     ${m.Duration}s @ ${m.Fps}fps, ${m.CurveCount} curves, ${m.TotalSegmentCount} segments`);
    console.log(`     personality=${args.personality} seed=${args.seed}`);
    console.log(`     animated: ${result.animatedIds.join(', ')}`);
  }

  if (args.register) {
    writeFileSync(model3Path, JSON.stringify(model3, null, '\t'));
    console.log(`     registered ${presets.length} motion(s) in ${basename(model3Path)}`);
  }
}

main().catch(err => { console.error(err); process.exit(99); });
