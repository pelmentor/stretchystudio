import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Circle, Scissors } from 'lucide-react';
import {
  loadDWPoseSession, runDWPose, buildArmatureNodes, analyzeGroups,
  matchTag, estimateSkeletonFromBounds, DWPOSE_URL, clearDWPoseSession,
  KNOWN_TAGS,
} from '../../io/armatureOrganizer';
import { splitLayerLR } from '../../io/splitLR';

export default function PsdImportWizard({
  step,
  onSetStep,
  pendingPsd,
  onnxSessionRef,
  onFinalize,
  onSkip,
  onComplete,
  onBack,
  onSplitArms,  // (rightLayer, leftLayer) → void  — replaces merged handwear with two layers
}) {
  const [rigStatus, setRigStatus] = useState('');
  const [rigLoading, setRigLoading] = useState(false);
  const [tagOverrides, setTagOverrides] = useState({});
  const [mappingExpanded, setMappingExpanded] = useState(false);
  const [splitError, setSplitError] = useState('');

  const { psdW, psdH, layers, partIds } = pendingPsd || {};

  /* ── Effective layers: apply tag overrides by renaming to canonical tag ── */
  const effectiveLayers = layers
    ? layers.map(l =>
        tagOverrides[l.name] ? { ...l, name: tagOverrides[l.name] } : l
      )
    : [];

  const matchCount = effectiveLayers.filter(l => matchTag(l.name) !== null).length;
  const unmatchedLayers = layers
    ? layers.filter(l => {
        const effective = tagOverrides[l.name] ?? null;
        if (effective !== null) return false; // user-assigned
        return matchTag(l.name) === null;
      })
    : [];
  const tooFew = matchCount < 4;

  /* ── Detect merged arms (handwear present but no handwear-l or handwear-r) ── */
  const hasHandwear  = effectiveLayers.some(l => matchTag(l.name) === 'handwear');
  const hasHandwearL = effectiveLayers.some(l => matchTag(l.name) === 'handwear-l');
  const hasHandwearR = effectiveLayers.some(l => matchTag(l.name) === 'handwear-r');
  const armsMerged   = hasHandwear && !hasHandwearL && !hasHandwearR;

  /* ── Handle tag override dropdown change ────────────────────────────────── */
  const handleTagChange = useCallback((layerName, value) => {
    setTagOverrides(prev => {
      const next = { ...prev };
      if (value === '') {
        delete next[layerName];
      } else {
        next[layerName] = value;
      }
      return next;
    });
  }, []);

  /* ── Handle manual rigging (bounding-box heuristic) ────────────────────── */
  const handleRigManually = useCallback(async () => {
    setRigLoading(true);
    try {
      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = estimateSkeletonFromBounds(effectiveLayers, psdW, psdH);
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      onFinalize(groupDefs, assignments);
    } catch (err) {
      console.error('[Manual Rig]', err);
      setRigStatus(`Error: ${err.message}`);
    } finally {
      setRigLoading(false);
    }
  }, [effectiveLayers, psdW, psdH, partIds, onFinalize]);

  /* ── Handle DWPose rigging ────────────────────────────────────────────── */
  const runArmatureRig = useCallback(async (onnxPayload) => {
    setRigLoading(true);
    try {
      setRigStatus('Loading ONNX model…');
      const session = await loadDWPoseSession(onnxPayload);
      onnxSessionRef.current = session;

      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = await runDWPose(effectiveLayers, psdW, psdH, session, setRigStatus);

      setRigStatus('Building rig…');
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      onFinalize(groupDefs, assignments);
    } catch (err) {
      console.error('[AutoRig]', err);
      setRigStatus(`Error: ${err.message}`);
      clearDWPoseSession();
    } finally {
      setRigLoading(false);
    }
  }, [effectiveLayers, psdW, psdH, partIds, onFinalize, onnxSessionRef]);

  /* ── Handle arm split confirmation ─────────────────────────────────────── */
  const handleConfirmSplit = useCallback(() => {
    setSplitError('');
    // Find the merged handwear layer (using effectiveLayers so overrides are respected)
    const mergedIdx = effectiveLayers.findIndex(l => matchTag(l.name) === 'handwear');
    if (mergedIdx === -1) {
      onSetStep('choose');
      return;
    }

    const mergedLayer = effectiveLayers[mergedIdx];
    const result = splitLayerLR(mergedLayer, psdW, psdH);

    if (!result.right && !result.left) {
      setSplitError(
        `Could not find two separate components in the handwear layer ` +
        `(found ${result.componentCount} component${result.componentCount !== 1 ? 's' : ''}). ` +
        `The layer may be a single connected shape — continuing without split.`
      );
      return;
    }

    // Build replacement layers
    const rightLayer = result.right ? {
      ...mergedLayer,
      name:      'handwear-r',
      imageData: result.right.imageData,
      x:         result.right.x,
      y:         result.right.y,
      width:     result.right.width,
      height:    result.right.height,
    } : null;

    const leftLayer = result.left ? {
      ...mergedLayer,
      name:      'handwear-l',
      imageData: result.left.imageData,
      x:         result.left.x,
      y:         result.left.y,
      width:     result.left.width,
      height:    result.left.height,
    } : null;

    onSplitArms(mergedIdx, rightLayer, leftLayer);
    onSetStep('choose');
  }, [effectiveLayers, psdW, psdH, onSplitArms, onSetStep]);

  /* ── Step: Review layer mapping ─────────────────────────────────────── */
  if (step === 'review') {
    const layerMappings = layers
      ? layers.map(l => ({
          layer: l,
          tag: tagOverrides[l.name] ?? matchTag(l.name),
          overridden: l.name in tagOverrides,
        }))
      : [];

    const hasWarnings = unmatchedLayers.length > 0;
    const allMatched = unmatchedLayers.length === 0;

    // When user clicks Continue, check if arms are merged — if so, route to splitArms
    const handleContinue = () => {
      if (armsMerged) {
        onSetStep('splitArms');
      } else {
        onSetStep('choose');
      }
    };

    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
          <h3 className="text-base font-semibold text-foreground">Review Layer Mapping</h3>

          {/* Collapsed summary row */}
          <button
            onClick={() => setMappingExpanded(v => !v)}
            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded border border-border hover:bg-muted transition-colors"
          >
            {tooFew ? (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            ) : allMatched ? (
              <CheckCircle size={14} className="text-green-500 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            )}
            <span className="flex-1 text-xs text-foreground">
              {matchCount} of {layers.length} layers matched
              {hasWarnings && (
                <span className="text-amber-400 ml-1">
                  · {unmatchedLayers.length} unmatched
                </span>
              )}
              {tooFew && (
                <span className="text-amber-400 ml-1">· too few for auto-rig</span>
              )}
            </span>
            {mappingExpanded
              ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
              : <ChevronRight size={13} className="text-muted-foreground shrink-0" />
            }
          </button>

          {/* Expanded layer table */}
          {mappingExpanded && (
            <div className="border border-border rounded overflow-hidden">
              <div className="max-h-56 overflow-y-auto">
                {layerMappings.map(({ layer, tag, overridden }) => (
                  <div
                    key={layer.name}
                    className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-b-0 hover:bg-muted/50"
                  >
                    {/* Status icon */}
                    <span className="shrink-0">
                      {tag !== null ? (
                        <CheckCircle size={11} className={overridden ? 'text-blue-400' : 'text-green-500'} />
                      ) : (
                        <Circle size={11} className="text-amber-400" />
                      )}
                    </span>

                    {/* Layer name */}
                    <span
                      className="flex-1 text-[11px] text-muted-foreground truncate"
                      title={layer.name}
                    >
                      {layer.name}
                    </span>

                    {/* Tag dropdown */}
                    <select
                      value={tagOverrides[layer.name] ?? (matchTag(layer.name) ?? '')}
                      onChange={e => handleTagChange(layer.name, e.target.value)}
                      className={[
                        'text-[11px] rounded border px-1 py-0.5 bg-background outline-none shrink-0',
                        tag !== null
                          ? 'border-border text-foreground'
                          : 'border-amber-500/50 text-amber-400',
                      ].join(' ')}
                    >
                      <option value="">— unassigned —</option>
                      {KNOWN_TAGS.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning messages */}
          {tooFew && (
            <p className="text-[11px] text-amber-400 leading-relaxed">
              At least 4 layers must be matched for automatic rigging. Assign unmatched layers above or skip rigging.
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-3 gap-2">
            <button
              onClick={onSkip}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Skip rigging
            </button>
            <button
              onClick={handleContinue}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Continue →
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Step: Split Left / Right Arms ──────────────────────────────────────── */
  if (step === 'splitArms') {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-5">

          {/* Icon + heading */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-primary/15 shrink-0">
              <Scissors size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground leading-snug">
                Split left &amp; right arms?
              </h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Your <span className="text-foreground font-medium">handwear</span> layer
                has both arms merged into one. Splitting them into{' '}
                <span className="text-foreground font-medium">handwear-l</span> and{' '}
                <span className="text-foreground font-medium">handwear-r</span> lets you
                independently control depth, transform, and deformation for each arm.
              </p>
              <p className="mt-1.5 text-xs text-primary/80 font-medium">
                Recommended — works best when both gloves are visually separate.
              </p>
            </div>
          </div>

          {/* Error if split failed */}
          {splitError && (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-300 leading-relaxed">{splitError}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleConfirmSplit}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              <Scissors size={14} />
              Split arms (recommended)
            </button>
            <button
              onClick={() => onSetStep('choose')}
              className="w-full px-4 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Keep merged — continue without splitting
            </button>
          </div>

          {/* Back */}
          <div className="flex justify-start border-t border-border pt-3">
            <button
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => onSetStep('review')}
            >
              ← Back
            </button>
          </div>

        </div>
      </div>
    );
  }

  /* ── Step: Choose rigging method ────────────────────────────────────── */
  if (step === 'choose') {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-8 max-w-md w-full mx-4 flex flex-col gap-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Set up character rig</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {matchCount} of {layers.length} layers match see-through part names.
              Choose how you'd like to rig this character.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              disabled={rigLoading}
              onClick={handleRigManually}
              className="w-full p-3 text-sm rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <div className="font-medium">Rig manually</div>
              <div className="text-xs text-muted-foreground">Fast heuristic from layer positions</div>
            </button>

            <button
              disabled={rigLoading}
              onClick={() => onSetStep('dwpose')}
              className="w-full p-3 text-sm rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <div className="font-medium">Rig with DWPose</div>
              <div className="text-xs text-muted-foreground">High-accuracy AI pose detection</div>
            </button>

            <button
              disabled={rigLoading}
              onClick={onSkip}
              className="w-full p-3 text-sm rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <div className="font-medium">Skip rigging</div>
              <div className="text-xs text-muted-foreground">Import flat, no skeleton</div>
            </button>
          </div>

          {/* Back to review (or splitArms if arms were merged) */}
          <div className="flex justify-start border-t border-border pt-3">
            <button
              disabled={rigLoading}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => onSetStep(armsMerged ? 'splitArms' : 'review')}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Step: DWPose loading ─────────────────────────────────────────── */
  if (step === 'dwpose') {
    const modelLoaded = !!onnxSessionRef?.current;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Load DWPose model</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Download or upload the ~50 MB DWPose ONNX model for high-accuracy pose detection.
            </p>
          </div>

          {/* Model status */}
          <div className="p-2 rounded bg-muted border border-border">
            <p className="text-xs text-muted-foreground">
              Status: {modelLoaded ? (
                <span className="text-green-500 font-medium">Loaded ✓</span>
              ) : (
                <span className="text-amber-500">Not loaded</span>
              )}
            </p>
          </div>

          {/* Load buttons */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Load Model</div>
            <div className="flex gap-2">
              {/* Local .onnx file */}
              <label className={[
                'flex-1 text-center px-3 py-1.5 text-xs rounded border cursor-pointer transition-colors',
                rigLoading
                  ? 'opacity-40 pointer-events-none border-border text-muted-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              ].join(' ')}>
                Load .onnx file
                <input
                  type="file" accept=".onnx" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    runArmatureRig(await f.arrayBuffer());
                  }}
                  disabled={rigLoading}
                />
              </label>

              {/* Download from HuggingFace */}
              <button
                disabled={rigLoading}
                className="flex-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-40"
                onClick={() => runArmatureRig(DWPOSE_URL)}
              >
                {rigLoading ? 'Working…' : 'Download'}
              </button>
            </div>

            {/* Status */}
            {rigStatus && (
              <p className={[
                'text-[11px] px-1',
                rigStatus.startsWith('Error') ? 'text-red-400' : 'text-muted-foreground',
              ].join(' ')}>
                {rigStatus}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between border-t border-border pt-3">
            <button
              disabled={rigLoading}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => onSetStep('choose')}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Step: Adjust joints (floating toolbar) ────────────────────────── */
  if (step === 'adjust') {
    return (
      <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                      bg-background/90 border-b border-border backdrop-blur-sm">
        <span className="text-xs font-semibold text-foreground">Adjust Joints</span>
        <span className="text-xs text-muted-foreground flex-1">
          Drag yellow dots to reposition joints.
        </span>
        <button
          onClick={onBack}
          className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onComplete}
          className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          Finish
        </button>
      </div>
    );
  }

  return null;
}
