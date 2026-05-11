// @ts-check

/**
 * Driver expression → DriverTree subgraph compiler.
 *
 * Phase N-2 of the V2 plan. Parses a small subset of the scripted-
 * driver expression language and emits a chain of Math/Compare/
 * Constant/ParamInput/DriverOutput nodes whose evaluation matches
 * `evaluateDriver`'s output.
 *
 * # Grammar (recursive descent)
 *
 *   expression  := term (('+' | '-') term)*
 *   term        := factor (('*' | '/') factor)*
 *   factor      := unary | unary '**' unary
 *   unary       := '-' unary | primary
 *   primary     := number | identifier | identifier '(' arglist? ')' | '(' expression ')'
 *   arglist     := expression (',' expression)*
 *
 * Identifiers map to either:
 *   - Driver variable (in `driver.variables[]`) → `ParamInput` node.
 *   - Math built-in (`sin`, `cos`, `abs`, `min`, `max`, `clamp`,
 *     `sqrt`, `pow`, `PI`) → `Math`/`Constant` node.
 *
 * # Fallback
 *
 * Unparseable expressions (anything outside the grammar — comparison
 * operators, ternary, complex bool logic) compile to a single
 * `ScriptedExpression` node carrying the original driver record;
 * eval delegates to `evaluateDriver`.
 *
 * @module anim/nodetree/driverCompile
 */

import { addNodeToTree, addLinkToTree, makeNodeTree, NodeTreeType } from './types.js';

/**
 * Compile `driver` (a ChannelDriver record) for parameter `targetId`
 * into a DriverTree datablock.
 *
 * @param {string} targetId
 * @param {object} driver
 * @returns {import('./types.js').NodeTree}
 */
export function compileDriverTree(targetId, driver) {
  const tree = makeNodeTree(`driver:${targetId}`, NodeTreeType.DRIVER);

  // Always emit the DriverOutput sink. Source side depends on parse.
  const outputId = `${targetId}__out`;
  addNodeToTree(tree, {
    id: outputId,
    typeId: 'DriverOutput',
    inputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'input', defaultValue: 0 }],
    outputs: [],
    storage: { paramId: targetId },
    position: [400, 0],
  });

  let sourceId = null;
  let sourceSocket = 'value';
  if (driver?.type === 'scripted' && typeof driver?.expression === 'string') {
    const compiled = tryCompileExpression(tree, targetId, driver);
    if (compiled) {
      sourceId = compiled.nodeId;
      sourceSocket = compiled.socket;
    }
  }

  if (!sourceId) {
    // Fallback: ScriptedExpression wraps the original driver verbatim.
    const fallbackId = `${targetId}__scripted`;
    addNodeToTree(tree, {
      id: fallbackId,
      typeId: 'ScriptedExpression',
      inputs: [],
      outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
      storage: { driver },
      position: [0, 0],
    });
    sourceId = fallbackId;
    sourceSocket = 'value';
  }

  addLinkToTree(tree, {
    fromNode: sourceId, fromSocket: sourceSocket,
    toNode: outputId, toSocket: 'value',
  });

  return tree;
}

/**
 * Attempt to parse + lift `driver.expression` into a graph rooted at a
 * single output node. Returns `{ nodeId, socket }` on success, null on
 * any parse / unsupported-construct error.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {string} targetId
 * @param {object} driver
 * @returns {{ nodeId: string, socket: string } | null}
 */
function tryCompileExpression(tree, targetId, driver) {
  try {
    const tokens = tokenize(driver.expression);
    if (!tokens) return null;
    const parser = makeParser(tokens);
    const ast = parser.parseExpression();
    if (!parser.atEnd()) return null;
    const variables = Array.isArray(driver.variables) ? driver.variables : [];
    const ctx = { tree, targetId, variables, idCounter: 0 };
    return emit(ast, ctx);
  } catch {
    return null;
  }
}

/**
 * Tokenize. Returns null on any unsupported character (forces fallback).
 *
 * Tokens: number, ident, op (`+ - * / ** ( ) ,`).
 */
function tokenize(src) {
  /** @type {Array<{kind: string, text: string, value?: number}>} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && (src[j] === '.' || (src[j] >= '0' && src[j] <= '9'))) j++;
      out.push({ kind: 'number', text: src.slice(i, j), value: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < src.length &&
             ((src[j] >= 'a' && src[j] <= 'z') || (src[j] >= 'A' && src[j] <= 'Z') ||
              (src[j] >= '0' && src[j] <= '9') || src[j] === '_')) j++;
      out.push({ kind: 'ident', text: src.slice(i, j) });
      i = j; continue;
    }
    if (c === '+' || c === '-' || c === '/' || c === '(' || c === ')' || c === ',') {
      out.push({ kind: 'op', text: c });
      i++; continue;
    }
    if (c === '*') {
      if (src[i + 1] === '*') { out.push({ kind: 'op', text: '**' }); i += 2; continue; }
      out.push({ kind: 'op', text: '*' }); i++; continue;
    }
    return null;  // unsupported
  }
  return out;
}

function makeParser(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (kind, text) => {
    const t = tokens[pos];
    if (!t) return null;
    if (kind && t.kind !== kind) return null;
    if (text !== undefined && t.text !== text) return null;
    pos++;
    return t;
  };

  function parseExpression() {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (!t || t.kind !== 'op' || (t.text !== '+' && t.text !== '-')) break;
      pos++;
      const right = parseTerm();
      left = { kind: 'binop', op: t.text, left, right };
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (true) {
      const t = peek();
      if (!t || t.kind !== 'op' || (t.text !== '*' && t.text !== '/')) break;
      pos++;
      const right = parseFactor();
      left = { kind: 'binop', op: t.text, left, right };
    }
    return left;
  }
  function parseFactor() {
    let left = parseUnary();
    const t = peek();
    if (t && t.kind === 'op' && t.text === '**') {
      pos++;
      const right = parseUnary();
      left = { kind: 'binop', op: '**', left, right };
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.kind === 'op' && t.text === '-') {
      pos++;
      const inner = parseUnary();
      return { kind: 'unary', op: '-', inner };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('unexpected eof');
    if (t.kind === 'number') {
      pos++;
      return { kind: 'number', value: t.value };
    }
    if (t.kind === 'op' && t.text === '(') {
      pos++;
      const inner = parseExpression();
      if (!eat('op', ')')) throw new Error('expected )');
      return inner;
    }
    if (t.kind === 'ident') {
      pos++;
      // Function call?
      if (peek()?.kind === 'op' && peek()?.text === '(') {
        pos++;
        const args = [];
        if (peek()?.text !== ')') {
          args.push(parseExpression());
          while (peek()?.kind === 'op' && peek()?.text === ',') {
            pos++;
            args.push(parseExpression());
          }
        }
        if (!eat('op', ')')) throw new Error('expected )');
        return { kind: 'call', name: t.text, args };
      }
      return { kind: 'ident', name: t.text };
    }
    throw new Error('unexpected token');
  }

  return {
    parseExpression,
    atEnd: () => pos >= tokens.length,
  };
}

/**
 * Emit graph nodes + links for a parsed AST. Returns the source node
 * + socket so the caller can wire it into DriverOutput.
 *
 * @returns {{ nodeId: string, socket: string }}
 */
function emit(ast, ctx) {
  switch (ast.kind) {
    case 'number': {
      const id = nextId(ctx, 'const');
      addNodeToTree(ctx.tree, {
        id, typeId: 'Constant',
        inputs: [],
        outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
        storage: { value: ast.value },
        position: [0, 0],
      });
      return { nodeId: id, socket: 'value' };
    }
    case 'ident': {
      // Built-in `PI`?
      if (ast.name === 'PI') {
        const id = nextId(ctx, 'const');
        addNodeToTree(ctx.tree, {
          id, typeId: 'Constant',
          inputs: [],
          outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
          storage: { value: Math.PI },
          position: [0, 0],
        });
        return { nodeId: id, socket: 'value' };
      }
      // Driver variable → ParamInput.
      const v = ctx.variables.find((vv) => vv?.name === ast.name);
      if (!v) throw new Error(`unknown identifier ${ast.name}`);
      const paramId = extractParamIdFromVarTarget(v);
      if (!paramId) throw new Error(`unsupported variable ${ast.name}`);
      const id = nextId(ctx, 'param');
      addNodeToTree(ctx.tree, {
        id, typeId: 'ParamInput',
        inputs: [],
        outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
        storage: { paramId },
        position: [0, 0],
      });
      return { nodeId: id, socket: 'value' };
    }
    case 'unary': {
      const inner = emit(ast.inner, ctx);
      const id = nextId(ctx, 'math');
      addNodeToTree(ctx.tree, {
        id, typeId: 'Math',
        inputs: [
          { identifier: 'a', name: 'A', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'b', name: 'B', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'c', name: 'C', type: 'value', inOut: 'input', defaultValue: 0 },
        ],
        outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
        storage: { op: 'negate' },
        position: [0, 0],
      });
      addLinkToTree(ctx.tree, {
        fromNode: inner.nodeId, fromSocket: inner.socket,
        toNode: id, toSocket: 'a',
      });
      return { nodeId: id, socket: 'value' };
    }
    case 'binop': {
      const opMap = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '**': 'power' };
      const op = opMap[ast.op];
      if (!op) throw new Error(`unsupported op ${ast.op}`);
      const left = emit(ast.left, ctx);
      const right = emit(ast.right, ctx);
      const id = nextId(ctx, 'math');
      addNodeToTree(ctx.tree, {
        id, typeId: 'Math',
        inputs: [
          { identifier: 'a', name: 'A', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'b', name: 'B', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'c', name: 'C', type: 'value', inOut: 'input', defaultValue: 0 },
        ],
        outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
        storage: { op },
        position: [0, 0],
      });
      addLinkToTree(ctx.tree, {
        fromNode: left.nodeId, fromSocket: left.socket,
        toNode: id, toSocket: 'a',
      });
      addLinkToTree(ctx.tree, {
        fromNode: right.nodeId, fromSocket: right.socket,
        toNode: id, toSocket: 'b',
      });
      return { nodeId: id, socket: 'value' };
    }
    case 'call': {
      const fnMap = {
        sin: 'sin', cos: 'cos', abs: 'abs',
        sqrt: 'sqrt', pow: 'power',
        min: 'min', max: 'max', clamp: 'clamp',
      };
      const op = fnMap[ast.name];
      if (!op) throw new Error(`unsupported function ${ast.name}`);
      // Arity check.
      const arity = (op === 'clamp') ? 3 : (['pow', 'min', 'max'].includes(op)) ? 2 : 1;
      if (ast.args.length !== arity) throw new Error(`bad arity for ${ast.name}`);
      const id = nextId(ctx, 'math');
      addNodeToTree(ctx.tree, {
        id, typeId: 'Math',
        inputs: [
          { identifier: 'a', name: 'A', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'b', name: 'B', type: 'value', inOut: 'input', defaultValue: 0 },
          { identifier: 'c', name: 'C', type: 'value', inOut: 'input', defaultValue: 0 },
        ],
        outputs: [{ identifier: 'value', name: 'Value', type: 'value', inOut: 'output' }],
        storage: { op },
        position: [0, 0],
      });
      const sockets = ['a', 'b', 'c'];
      for (let i = 0; i < ast.args.length; i++) {
        const child = emit(ast.args[i], ctx);
        addLinkToTree(ctx.tree, {
          fromNode: child.nodeId, fromSocket: child.socket,
          toNode: id, toSocket: sockets[i],
        });
      }
      return { nodeId: id, socket: 'value' };
    }
  }
  throw new Error(`unhandled ast.kind ${ast.kind}`);
}

function nextId(ctx, prefix) {
  return `${ctx.targetId}__${prefix}_${ctx.idCounter++}`;
}

/**
 * Extract paramId from a driver variable's target rnaPath.
 *
 *   `objects["__params__"].values["<paramId>"]` → `<paramId>`
 *
 * @param {{target?: {rnaPath?: string}}} v
 * @returns {string | null}
 */
function extractParamIdFromVarTarget(v) {
  const path = v?.target?.rnaPath;
  if (typeof path !== 'string') return null;
  const m = /objects\["__params__"\]\.values\["([^"]+)"\]/.exec(path);
  return m ? m[1] : null;
}
