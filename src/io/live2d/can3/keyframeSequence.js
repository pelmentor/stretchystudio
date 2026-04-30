// @ts-nocheck
/**
 * Bezier-keyframe CMutableSequence emitter for .can3 animation tracks.
 *
 * SS keyframes carry `{time: ms, value: number, easing: string}`; can3
 * stores them as frame positions inside a CMutableSequence containing
 * `keyPts2`, `points` (CBezierPt with anchor / next / prev), and a
 * matching `curveTypes` array. Cubism Editor 5.0 cannot round-trip
 * CFixedSequence (ClassCastException on motion-file export), so even
 * pinned-rest tracks emit a single-keyframe CMutableSequence here.
 *
 * @module io/live2d/can3/keyframeSequence
 */

export function emitMutableSequence(x, parent, pidAttr, keyframes, fps, _rangeMin, _rangeMax) {
  const seq = x.sub(parent, 'CMutableSequence', { 'xs.n': 'valueData' });
  const acvs = x.sub(seq, 'ACValueSequence', { 'xs.n': 'super' });

  const frameKfs = keyframes.map(kf => ({
    frame: Math.round(kf.time * fps / 1000),
    value: kf.value ?? 0,
  }));

  const values = frameKfs.map(k => k.value);
  const curMin = Math.min(...values);
  const curMax = Math.max(...values);

  x.sub(acvs, 'd', { 'xs.n': 'curMin' }).text = String(curMin);
  x.sub(acvs, 'd', { 'xs.n': 'curMax' }).text = String(curMax);
  x.sub(acvs, 'i', { 'xs.n': 'posStart' }).text = '0';
  x.sub(acvs, 'int-array', {
    'xs.n': 'keyPts2', count: String(frameKfs.length),
  }).text = frameKfs.map(k => String(k.frame)).join(' ');
  x.sub(acvs, 'i', { 'xs.n': 'keyMin' }).text = String(frameKfs[0].frame);
  x.sub(acvs, 'i', { 'xs.n': 'keyMax' }).text = String(frameKfs[frameKfs.length - 1].frame);
  x.sub(acvs, 'd', { 'xs.n': 'lastValue' }).text = String(frameKfs[0].value);
  x.sub(acvs, 'i', { 'xs.n': 'lastPos' }).text = '0';
  x.subRef(acvs, 'CMvAttrF', pidAttr, { 'xs.n': 'attr' });
  x.sub(acvs, 'd', { 'xs.n': 'baseValue' }).text = '0.0';

  const pts = x.sub(seq, 'array', {
    'xs.n': 'points', count: String(frameKfs.length), type: 'CBezierPt',
  });

  for (let i = 0; i < frameKfs.length; i++) {
    const kf = frameKfs[i];
    const bp = x.sub(pts, 'CBezierPt');

    const anchor = x.sub(bp, 'CSeqPt', { 'xs.n': 'anchor' });
    x.sub(anchor, 'b', { 'xs.n': 'isCorner' }).text = 'false';
    x.sub(anchor, 'i', { 'xs.n': 'pos' }).text = String(kf.frame);
    x.sub(anchor, 'd', { 'xs.n': 'doubleValue' }).text = String(kf.value);

    const nextCtrl = x.sub(bp, 'CBezierCtrlPt', { 'xs.n': 'next' });
    const nextFrame = (i < frameKfs.length - 1)
      ? kf.frame + (frameKfs[i + 1].frame - kf.frame) / 3
      : kf.frame;
    x.sub(nextCtrl, 'f', { 'xs.n': 'posF' }).text = nextFrame.toFixed(6);
    x.sub(nextCtrl, 'i', { 'xs.n': 'pos' }).text = '0';
    x.sub(nextCtrl, 'd', { 'xs.n': 'doubleValue' }).text = String(kf.value);
    x.sub(nextCtrl, 'b', { 'xs.n': 'isPosOptimized' }).text = 'false';

    const prevCtrl = x.sub(bp, 'CBezierCtrlPt', { 'xs.n': 'prev' });
    const prevFrame = (i > 0)
      ? kf.frame - (kf.frame - frameKfs[i - 1].frame) / 3
      : kf.frame;
    x.sub(prevCtrl, 'f', { 'xs.n': 'posF' }).text = prevFrame.toFixed(6);
    x.sub(prevCtrl, 'i', { 'xs.n': 'pos' }).text = '0';
    x.sub(prevCtrl, 'd', { 'xs.n': 'doubleValue' }).text = String(kf.value);
    x.sub(prevCtrl, 'b', { 'xs.n': 'isPosOptimized' }).text = 'false';
  }

  const ctList = x.sub(seq, 'carray_list', {
    'xs.n': 'curveTypes', count: String(frameKfs.length),
  });
  for (let i = 0; i < frameKfs.length; i++) {
    x.sub(ctList, 'CCurveType', { v: 'SMOOTH' });
  }
}
