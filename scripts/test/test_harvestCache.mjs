// @ts-check

/**
 * test_harvestCache.mjs — P4 memo correctness.
 *
 * Properties checked:
 *   1. Same project reference twice → cache hit (initializeRigFromProject
 *      not invoked again).
 *   2. Different project reference → cache miss.
 *   3. Concurrent calls with same project share a single in-flight
 *      Promise (no double-harvest).
 *   4. A failed harvest is removed from the cache so the next call
 *      retries (no permanently-stuck cached rejection).
 *
 * Method: stub `initializeRigFromProject` (the wrapped function) via a
 * module-level mock counter to assert call counts. We can't easily
 * import the real RigService.js because it pulls in the projectStore
 * + paramValuesStore + initRig graph; instead, this test verifies the
 * memoization shape directly against a small stand-in implementation
 * that mirrors the wrapper logic.
 */

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) passed++;
  else { console.error(`FAIL: ${name}`); failed++; }
}

// Reproduce the wrapper logic locally so we test exactly the cache
// shape without dragging the entire RigService graph into the test.
const _harvestCache = new WeakMap();
let invocations = 0;

async function memoInitializeRigFromProject(project, fn) {
  if (!project) return fn(project);
  if (_harvestCache.has(project)) return _harvestCache.get(project);
  const p = (async () => {
    try {
      return await fn(project);
    } catch (err) {
      _harvestCache.delete(project);
      throw err;
    }
  })();
  _harvestCache.set(project, p);
  return p;
}

// 1. Same project ref twice → single invocation.
{
  invocations = 0;
  const project = { id: 'p1' };
  const fn = async () => { invocations++; return { data: 'harvest1' }; };
  const r1 = await memoInitializeRigFromProject(project, fn);
  const r2 = await memoInitializeRigFromProject(project, fn);
  assert(r1 === r2, 'same project: returns same harvest');
  assert(invocations === 1, `same project: fn called once (got ${invocations})`);
}

// 2. Different project refs → cache miss per ref.
{
  invocations = 0;
  const projectA = { id: 'pA' };
  const projectB = { id: 'pB' };
  const fn = async () => { invocations++; return { data: 'h' }; };
  await memoInitializeRigFromProject(projectA, fn);
  await memoInitializeRigFromProject(projectB, fn);
  assert(invocations === 2, `different projects: fn called twice (got ${invocations})`);
  // Re-call A — should hit.
  await memoInitializeRigFromProject(projectA, fn);
  assert(invocations === 2, `different projects: re-call A is hit (still got ${invocations})`);
}

// 3. Concurrent same-project calls share a single Promise.
{
  invocations = 0;
  const project = { id: 'pC' };
  let resolveFn = null;
  const fn = () => new Promise((r) => { invocations++; resolveFn = r; });
  const p1 = memoInitializeRigFromProject(project, fn);
  const p2 = memoInitializeRigFromProject(project, fn);
  assert(invocations === 1, `concurrent: fn called only once before resolve (got ${invocations})`);
  resolveFn?.({ data: 'shared' });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert(r1 === r2, 'concurrent: both callers got same harvest');
}

// 4. Failed harvest → cache evicted → retry calls fn again.
{
  invocations = 0;
  const project = { id: 'pD' };
  let shouldFail = true;
  const fn = async () => {
    invocations++;
    if (shouldFail) throw new Error('boom');
    return { data: 'ok' };
  };
  let caught1 = null;
  try { await memoInitializeRigFromProject(project, fn); }
  catch (e) { caught1 = e; }
  assert(caught1 != null, 'fail: error propagated');
  assert(invocations === 1, 'fail: fn called once');
  // Cache cleared → retry triggers a second call.
  shouldFail = false;
  const r = await memoInitializeRigFromProject(project, fn);
  assert(invocations === 2, `fail-then-retry: fn called twice (got ${invocations})`);
  assert(r.data === 'ok', 'fail-then-retry: succeeds');
}

// 5. After a successful cache, subsequent calls don't re-invoke fn.
{
  invocations = 0;
  const project = { id: 'pE' };
  const fn = async () => { invocations++; return { data: 'x' }; };
  await memoInitializeRigFromProject(project, fn);
  await memoInitializeRigFromProject(project, fn);
  await memoInitializeRigFromProject(project, fn);
  assert(invocations === 1, `success-cache: fn called once across 3 calls (got ${invocations})`);
}

console.log(`harvestCache: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
