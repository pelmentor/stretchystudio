// @ts-check

/**
 * Driver-tree node type registrations.
 *
 * Phase N-2 of the V2 plan. New types extending `registry.js`:
 *
 *   - `ParamInput`        — reads a paramValue from `ctx.paramOverrides`
 *                           or `project.parameters[i].default`.
 *   - `Constant`          — literal scalar value (storage.value).
 *   - `Math`              — binary / unary scalar ops (+, -, *, /, sin,
 *                           cos, abs, min, max, clamp, pow, sqrt, PI).
 *   - `Compare`           — relational ops (<, >, ==, !=, <=, >=).
 *   - `DriverOutput`      — writes its input value to a target paramId
 *                           via `ctx.paramOverrides`.
 *   - `ScriptedExpression`— fallback wrapper around `evaluateDriver`
 *                           for expressions the Phase N-2 parser can't
 *                           lift to a graph.
 *
 * Adapted from Blender's node math-op set
 * (`reference/blender/source/blender/nodes/function/nodes/`).
 *
 * @module anim/nodetree/nodes/drivers
 */

import { registerNodeType } from '../registry.js';
import { SocketType, SocketInOut } from '../types.js';
import { evaluateDriver } from '../../driver.js';

registerNodeType({
  typeId: 'ParamInput',
  label: 'Param Input',
  category: 'driver',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { paramId: '...' }
  execute: (node, ctx) => {
    const paramId = node.storage?.paramId;
    if (!paramId) return 0;
    const override = ctx?.paramOverrides?.get?.(paramId);
    if (typeof override === 'number' && Number.isFinite(override)) return override;
    const params = ctx?.project?.parameters ?? [];
    const p = params.find((pp) => pp?.id === paramId);
    return typeof p?.default === 'number' ? p.default : 0;
  },
});

registerNodeType({
  typeId: 'Constant',
  label: 'Constant',
  category: 'common',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { value: <number> }
  execute: (node) => {
    const v = node.storage?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  },
});

/**
 * Math operations supported by the `Math` node. Mirrors Blender's
 * `NODE_MATH_*` enum (`reference/blender/source/blender/nodes/function/nodes/node_fn_math.cc`).
 */
export const MATH_OPS = Object.freeze({
  ADD:      'add',
  SUBTRACT: 'subtract',
  MULTIPLY: 'multiply',
  DIVIDE:   'divide',
  POWER:    'power',
  SQRT:     'sqrt',
  ABS:      'abs',
  SIN:      'sin',
  COS:      'cos',
  MIN:      'min',
  MAX:      'max',
  CLAMP:    'clamp',
  NEGATE:   'negate',
});

/** @type {Record<string, (a: number, b: number, c?: number) => number>} */
const MATH_OP_FNS = {
  add:      (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide:   (a, b) => b === 0 ? 0 : a / b,
  power:    (a, b) => Math.pow(a, b),
  sqrt:     (a)    => a < 0 ? 0 : Math.sqrt(a),
  abs:      (a)    => Math.abs(a),
  sin:      (a)    => Math.sin(a),
  cos:      (a)    => Math.cos(a),
  min:      (a, b) => Math.min(a, b),
  max:      (a, b) => Math.max(a, b),
  clamp:    (a, b, c) => Math.min(c ?? Infinity, Math.max(b ?? -Infinity, a)),
  negate:   (a)    => -a,
};

registerNodeType({
  typeId: 'Math',
  label: 'Math',
  category: 'common',
  // Sockets: a (input), b (input), c (input), value (output)
  // Unary ops use only `a`; ternary `clamp` uses all three.
  sockets: [
    { identifier: 'a', name: 'A',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
    { identifier: 'b', name: 'B',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
    { identifier: 'c', name: 'C',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { op: <MATH_OPS value> }
  execute: (node, ctx) => {
    const op = node.storage?.op;
    const fn = op && MATH_OP_FNS[op];
    if (!fn) return 0;
    const a = ctx?.inputs?.a ?? 0;
    const b = ctx?.inputs?.b ?? 0;
    const c = ctx?.inputs?.c;
    const v = fn(a, b, c);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  },
});

/**
 * Comparison operations supported by the `Compare` node. Mirrors
 * Blender's `NODE_COMPARE_*` enum.
 */
export const COMPARE_OPS = Object.freeze({
  LT: 'lt', GT: 'gt', EQ: 'eq', NE: 'ne', LE: 'le', GE: 'ge',
});

/** @type {Record<string, (a: number, b: number) => boolean>} */
const COMPARE_FNS = {
  lt: (a, b) => a <  b,
  gt: (a, b) => a >  b,
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  le: (a, b) => a <= b,
  ge: (a, b) => a >= b,
};

registerNodeType({
  typeId: 'Compare',
  label: 'Compare',
  category: 'common',
  sockets: [
    { identifier: 'a', name: 'A',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
    { identifier: 'b', name: 'B',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { op: <COMPARE_OPS value> }
  execute: (node, ctx) => {
    const op = node.storage?.op;
    const fn = op && COMPARE_FNS[op];
    if (!fn) return 0;
    return fn(ctx?.inputs?.a ?? 0, ctx?.inputs?.b ?? 0) ? 1 : 0;
  },
});

registerNodeType({
  typeId: 'DriverOutput',
  label: 'Driver Output',
  category: 'driver',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
  ],
  // storage = { paramId: '...' }
  execute: (node, ctx) => {
    const paramId = node.storage?.paramId;
    const v = ctx?.inputs?.value;
    if (typeof paramId === 'string' && typeof v === 'number' && Number.isFinite(v)) {
      ctx?.paramOverrides?.set?.(paramId, v);
    }
    return v;
  },
});

registerNodeType({
  typeId: 'ScriptedExpression',
  label: 'Scripted Expression',
  category: 'driver',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { driver: ChannelDriver } — the original driver record;
  // delegate to evaluateDriver with the current ctx.project for var
  // resolution. Falls back to NaN on parse error / unsafe expression.
  execute: (node, ctx) => {
    const driver = node.storage?.driver;
    if (!driver) return 0;
    const v = evaluateDriver(driver, { project: ctx?.project });
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  },
});
