// @ts-check

import { uuid } from '../xmlbuilder.js';
import { emitSingleParamKfGrid, emitStructuralWarp } from './deformerEmit.js';

/**
 * Body warp chain XML emission — Section 3d head. Lifted out of
 * cmo3writer.js (Phase 6 god-class breakup, sweep #30).
 *
 * Translates the 4 `WarpDeformerSpec` entries returned by
 * `buildBodyWarpChain` (BodyZ → BodyY → BreathWarp → BodyXWarp) into
 * cmo3 XML. The math/coordinate logic lives in `rig/bodyWarp.js`;
 * this module is pure XML translation.
 *
 *   - Each spec gets a `CDeformerGuid` pid + a `KeyformGridSource`
 *     bound to its single parameter (one keyform per stop).
 *   - Parent pid is `pidDeformerRoot` for spec.parent.type='root',
 *     otherwise the previously-emitted spec's pid (chain wiring).
 *   - BodyZ uses Canvas coords (its own CoordType node); the rest
 *     reuse the shared DeformerLocal pidCoord.
 *
 * Returns the two pids the rest of the writer cares about
 * (`pidBreathGuid`, `pidBodyXGuid`) — used as re-parent targets for
 * group rotation deformers + per-part rig warps.
 *
 * @module io/live2d/cmo3/bodyChainEmit
 */

/**
 * @param {Object} x
 * @param {Object} opts
 * @param {{specs: Array}} opts.bodyChain
 * @param {Array<{id:string, pid:string|number}>} opts.paramDefs
 * @param {Array} opts.rigCollectorWarpDeformers   Mutated — push specs here.
 * @param {string|number} opts.pidDeformerRoot
 * @param {string|number} opts.pidCoord
 * @param {Object} opts.emitCtx                    {allDeformerSources, pidPartGuid, rootPart}.
 * @returns {{ pidBreathGuid: string|number|null, pidBodyXGuid: string|number|null }}
 */
export function emitBodyWarpChain(x, opts) {
  const {
    bodyChain, paramDefs, rigCollectorWarpDeformers,
    pidDeformerRoot, pidCoord, emitCtx,
  } = opts;

  const _bodyParamPid = (paramId) => paramDefs.find(p => p.id === paramId)?.pid;
  const _bodyDeformerPids = new Map(); // spec.id → its CDeformerGuid pid
  const [_coordBWZ, pidCoordBWZ] = x.shared('CoordType');
  x.sub(_coordBWZ, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

  for (const spec of bodyChain.specs) {
    rigCollectorWarpDeformers.push(spec);
    const [, pid] = x.shared('CDeformerGuid', { uuid: uuid(), note: spec.id });
    _bodyDeformerPids.set(spec.id, pid);

    // BodyZ uses canvas coords; rest of chain uses DeformerLocal.
    const coordPid = spec.localFrame === 'canvas-px' ? pidCoordBWZ : pidCoord;

    // Parent pid: ROOT → pidDeformerRoot, warp → previously-emitted spec pid.
    const parentPid = spec.parent.type === 'root'
      ? pidDeformerRoot
      : _bodyDeformerPids.get(spec.parent.id);

    const binding = spec.bindings[0];
    const paramPid = _bodyParamPid(binding.parameterId);
    const { pidKfg, formGuids } = emitSingleParamKfGrid(
      x, paramPid, binding.keys, binding.parameterId,
    );
    const positions = spec.keyforms.map(k => k.positions);
    emitStructuralWarp(
      x, emitCtx,
      spec.name, spec.id, spec.gridSize.cols, spec.gridSize.rows,
      pid, parentPid, pidKfg, coordPid, formGuids, positions,
    );
  }

  return {
    pidBreathGuid: _bodyDeformerPids.get('BreathWarp') ?? null,
    pidBodyXGuid: _bodyDeformerPids.get('BodyXWarp') ?? null,
  };
}
