// @ts-nocheck
/**
 * CMvEffect_VisualDefault track-attribute factories.
 *
 * The visual-default effect has 9 transform attrs (xy / scalex / scaley
 * / rotate / shear / anchor / opacity / frameStep / artPathWidth) that
 * Cubism Editor expects in a specific shape even when no animation is
 * applied. Hiyori uses CMutableSequence with `count=0` for the static
 * attrs (not CFixedSequence) — that's the pattern these helpers emit.
 *
 * Each factory binds `pidAdaptRel` (shared CMvAttrF AdaptType) and
 * `pidModelTrack` (the model track this attr is parented to) at create
 * time so call sites stay short.
 *
 * @module io/live2d/can3/trackAttrs
 */

/**
 * Build the three track-attr factories for a given scene's model track.
 *
 * @param {object} x XmlBuilder
 * @param {string|number} pidAdaptRel Shared AdaptType pid
 * @param {string|number} pidModelTrack Per-scene CMvTrack_Live2DModel_Source pid
 * @returns {{
 *   makeTrackAttrF: (idstr:string, name:string, baseValue:number, rangeMin:number, rangeMax:number) => string|number,
 *   makeTrackAttrPt: (idstr:string, name:string, ptX:number, ptY:number) => string|number,
 *   makeTrackAttrI: (idstr:string, name:string, baseValue:number, rangeMin:number, rangeMax:number) => string|number,
 * }}
 */
export function buildTrackAttrFactories(x, pidAdaptRel, pidModelTrack) {
  const makeTrackAttrF = (idstr, name, baseValue, rangeMin, rangeMax) => {
    const [attr, pid] = x.shared('CMvAttrF');
    const sup = x.sub(attr, 'ICMvAttr', { 'xs.n': 'super' });
    x.sub(sup, 'b', { 'xs.n': 'isShyMode' }).text = 'false';
    x.sub(sup, 'b', { 'xs.n': 'isFreezeMode' }).text = 'false';
    x.sub(sup, 'CAttrId', { 'xs.n': 'id', idstr });
    x.sub(sup, 's', { 'xs.n': 'name' }).text = name;
    x.sub(sup, 'null', { 'xs.n': 'guid' });
    x.sub(sup, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.subRef(sup, 'AdaptType', pidAdaptRel, { 'xs.n': 'adaptType' });
    x.sub(sup, 'hash_map', { 'xs.n': 'optionParam', count: '0', keyType: 'string' });
    x.subRef(sup, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    const seq = x.sub(attr, 'CMutableSequence', { 'xs.n': 'valueData' });
    const acvs = x.sub(seq, 'ACValueSequence', { 'xs.n': 'super' });
    x.sub(acvs, 'd', { 'xs.n': 'curMin' }).text = String(rangeMin);
    x.sub(acvs, 'd', { 'xs.n': 'curMax' }).text = String(rangeMax);
    x.sub(acvs, 'i', { 'xs.n': 'posStart' }).text = '0';
    x.sub(acvs, 'int-array', { 'xs.n': 'keyPts2', count: '0' });
    x.sub(acvs, 'i', { 'xs.n': 'keyMin' }).text = '0';
    x.sub(acvs, 'i', { 'xs.n': 'keyMax' }).text = '0';
    x.sub(acvs, 'd', { 'xs.n': 'lastValue' }).text = String(baseValue);
    x.sub(acvs, 'i', { 'xs.n': 'lastPos' }).text = '0';
    x.subRef(acvs, 'CMvAttrF', pid, { 'xs.n': 'attr' });
    x.sub(acvs, 'd', { 'xs.n': 'baseValue' }).text = String(baseValue);
    x.sub(seq, 'array', { 'xs.n': 'points', count: '0', type: 'CBezierPt' });
    x.sub(seq, 'carray_list', { 'xs.n': 'curveTypes', count: '0' });
    x.sub(attr, 'd', { 'xs.n': 'rangeMin' }).text = String(rangeMin);
    x.sub(attr, 'd', { 'xs.n': 'rangeMax' }).text = String(rangeMax);
    x.sub(attr, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
    x.sub(attr, 'd', { 'xs.n': 'repeatMin' }).text = '-1.7976931348623157E308';
    x.sub(attr, 'd', { 'xs.n': 'repeatMax' }).text = '1.7976931348623157E308';
    x.sub(attr, 'null', { 'xs.n': 'linked_keyFormsForObject' });
    return pid;
  };

  const makeTrackAttrPt = (idstr, name, ptX, ptY) => {
    const [attr, pid] = x.shared('CMvAttrPt');
    const sup = x.sub(attr, 'ICMvAttr', { 'xs.n': 'super' });
    x.sub(sup, 'b', { 'xs.n': 'isShyMode' }).text = 'false';
    x.sub(sup, 'b', { 'xs.n': 'isFreezeMode' }).text = 'false';
    x.sub(sup, 'CAttrId', { 'xs.n': 'id', idstr });
    x.sub(sup, 's', { 'xs.n': 'name' }).text = name;
    x.sub(sup, 'null', { 'xs.n': 'guid' });
    x.sub(sup, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.subRef(sup, 'AdaptType', pidAdaptRel, { 'xs.n': 'adaptType' });
    x.sub(sup, 'hash_map', { 'xs.n': 'optionParam', count: '0', keyType: 'string' });
    x.subRef(sup, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    const seq = x.sub(attr, 'CXY_TNSSequence', { 'xs.n': 'valueDataXY' });
    const pts = x.sub(seq, 'array', { 'xs.n': 'points', count: '1', type: 'CPtTNS' });
    const pt = x.sub(pts, 'CPtTNS');
    const gv = x.sub(pt, 'GVector2', { 'xs.n': 'super' });
    x.sub(gv, 'f', { 'xs.n': 'x' }).text = String(ptX);
    x.sub(gv, 'f', { 'xs.n': 'y' }).text = String(ptY);
    x.sub(pt, 'b', { 'xs.n': 'isCorner' }).text = 'false';
    const val = x.sub(pt, 'GVector2', { 'xs.n': 'value' });
    x.sub(val, 'f', { 'xs.n': 'x' }).text = String(ptX);
    x.sub(val, 'f', { 'xs.n': 'y' }).text = String(ptY);
    x.sub(pt, 'i', { 'xs.n': 'pos' }).text = '0';
    const basePt = x.sub(seq, 'GVector2', { 'xs.n': 'basePt' });
    x.sub(basePt, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(basePt, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.subRef(seq, 'CMvAttrPt', pid, { 'xs.n': 'attr' });
    return pid;
  };

  const makeTrackAttrI = (idstr, name, baseValue, rangeMin, rangeMax) => {
    const [attr, pid] = x.shared('CMvAttrI');
    const sup = x.sub(attr, 'ICMvAttr', { 'xs.n': 'super' });
    x.sub(sup, 'b', { 'xs.n': 'isShyMode' }).text = 'false';
    x.sub(sup, 'b', { 'xs.n': 'isFreezeMode' }).text = 'false';
    x.sub(sup, 'CAttrId', { 'xs.n': 'id', idstr });
    x.sub(sup, 's', { 'xs.n': 'name' }).text = name;
    x.sub(sup, 'null', { 'xs.n': 'guid' });
    x.sub(sup, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.subRef(sup, 'AdaptType', pidAdaptRel, { 'xs.n': 'adaptType' });
    x.sub(sup, 'hash_map', { 'xs.n': 'optionParam', count: '0', keyType: 'string' });
    x.subRef(sup, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    const seq = x.sub(attr, 'CIntSequence', { 'xs.n': 'valueData' });
    const acvs = x.sub(seq, 'ACValueSequence', { 'xs.n': 'super' });
    x.sub(acvs, 'd', { 'xs.n': 'curMin' }).text = '0.0';
    x.sub(acvs, 'd', { 'xs.n': 'curMax' }).text = '0.0';
    x.sub(acvs, 'i', { 'xs.n': 'posStart' }).text = '0';
    x.sub(acvs, 'int-array', { 'xs.n': 'keyPts2', count: '0' });
    x.sub(acvs, 'i', { 'xs.n': 'keyMin' }).text = '2147483647';
    x.sub(acvs, 'i', { 'xs.n': 'keyMax' }).text = '-2147483648';
    x.sub(acvs, 'd', { 'xs.n': 'lastValue' }).text = 'NaN';
    x.sub(acvs, 'i', { 'xs.n': 'lastPos' }).text = '-1';
    x.subRef(acvs, 'CMvAttrI', pid, { 'xs.n': 'attr' });
    x.sub(acvs, 'd', { 'xs.n': 'baseValue' }).text = String(baseValue);
    x.sub(seq, 'array', { 'xs.n': 'points', count: '0', type: 'CSeqPt' });
    x.sub(attr, 'i', { 'xs.n': 'rangeMin' }).text = String(rangeMin);
    x.sub(attr, 'i', { 'xs.n': 'rangeMax' }).text = String(rangeMax);
    return pid;
  };

  return { makeTrackAttrF, makeTrackAttrPt, makeTrackAttrI };
}
