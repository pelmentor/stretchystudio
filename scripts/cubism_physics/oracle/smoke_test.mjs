import { CubismPhysicsOracle } from './cubismPhysicsOracle.mjs';

// Minimal physics3.json: 1 setting, 1 input (ParamAngleX → angle), 1 output
// (PARAM_HAIR_FRONT angle), 4 particles.
const rigJson = {
  Meta: {
    PhysicsSettingCount: 1,
    Fps: 30,
    EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
  },
  PhysicsSettings: [{
    Normalization: {
      Position: { Minimum: -10, Default: 0, Maximum: 10 },
      Angle:    { Minimum: -10, Default: 0, Maximum: 10 },
    },
    Input: [
      { Source: { Target: 'Parameter', Id: 'ParamAngleX' }, Weight: 100, Type: 'Angle', Reflect: false },
    ],
    Output: [
      { Destination: { Target: 'Parameter', Id: 'ParamHairFront' }, VertexIndex: 1, Scale: 5.0, Weight: 100, Type: 'Angle', Reflect: false },
    ],
    Vertices: [
      { Position: { X: 0, Y: 0 }, Mobility: 1.0, Delay: 1.0, Acceleration: 1.0, Radius: 0 },
      { Position: { X: 0, Y: 1 }, Mobility: 0.95, Delay: 0.8, Acceleration: 1.5, Radius: 1 },
      { Position: { X: 0, Y: 2 }, Mobility: 0.95, Delay: 0.8, Acceleration: 1.5, Radius: 1 },
      { Position: { X: 0, Y: 3 }, Mobility: 0.95, Delay: 0.8, Acceleration: 1.5, Radius: 1 },
    ],
  }],
};

const phys = new CubismPhysicsOracle();
phys.setRig(rigJson);

const ids = ['ParamAngleX', 'ParamHairFront'];
const pool = {
  ids,
  values:        new Float32Array([30, 0]),
  minimumValues: new Float32Array([-30, -10]),
  maximumValues: new Float32Array([ 30,  10]),
  defaultValues: new Float32Array([  0,  0]),
};
phys.setParameterPool(pool);

console.log('initial pool.values =', Array.from(pool.values));
const dt = 1 / 60;
for (let i = 0; i < 20; i++) {
  phys.evaluate(dt);
  if (i % 4 === 0 || i === 19) {
    console.log(`  step ${i + 1}: hairFront = ${pool.values[1].toFixed(6)}`);
  }
}
console.log('settled? final hairFront =', pool.values[1].toFixed(6));

// Now sweep ParamAngleX 0→30→0→-30→0 over 4 seconds and watch the lag.
console.log('\n--- 4s sweep ---');
let t = 0;
let frame = 0;
const sweepSec = 4.0;
while (t < sweepSec) {
  // Triangle wave to ±30 with period 4s
  const phase = (t / sweepSec) * 4; // 0..4
  let v;
  if (phase < 1) v = 30 * phase;
  else if (phase < 3) v = 30 * (2 - phase);
  else v = 30 * (phase - 4);
  pool.values[0] = v;
  phys.evaluate(dt);
  if (frame % 30 === 0) {
    console.log(`  t=${t.toFixed(2)}s angleX=${v.toFixed(2)} hairFront=${pool.values[1].toFixed(4)}`);
  }
  t += dt;
  frame++;
}

console.log('\noracle smoke test ran without errors.');
