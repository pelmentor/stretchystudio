import React from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useParameterStore } from '@/store/parameterStore';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, ChevronDown, ChevronRight, Link } from 'lucide-react';

/**
 * ParametersPanel — Live2D-style named sliders that drive animation tracks.
 *
 * Each parameter has a min/max range and zero or more bindings.
 * A binding links the slider position (0..1 along min..max) to a position
 * along a specific animation track's keyframe range, deforming the mesh
 * or changing any other animatable property in real-time.
 */
export function ParametersPanel() {
  const parameters = useProjectStore(s => s.project.parameters);
  const animations  = useProjectStore(s => s.project.animations);
  const nodes       = useProjectStore(s => s.project.nodes);
  const createParameter      = useProjectStore(s => s.createParameter);
  const updateParameter      = useProjectStore(s => s.updateParameter);
  const deleteParameter      = useProjectStore(s => s.deleteParameter);
  const addParameterBinding  = useProjectStore(s => s.addParameterBinding);
  const removeParameterBinding = useProjectStore(s => s.removeParameterBinding);

  const values           = useParameterStore(s => s.values);
  const setParameterValue = useParameterStore(s => s.setParameterValue);

  const [expanded,    setExpanded]    = React.useState({});
  const [addingBinding, setAddingBinding] = React.useState(null);

  if (!parameters?.length && !true) return null; // always show (even if empty, to allow adding)

  return (
    <div className="flex flex-col border-b shrink-0 max-h-64 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Parameters
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          title="Add parameter"
          onClick={() => createParameter()}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="overflow-y-auto flex-1">
        {parameters.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground italic">
            No parameters. Press + to add one.
          </p>
        )}

        {parameters.map(param => {
          const currentVal = values[param.id] ?? param.default ?? 0;
          const isExpanded = !!expanded[param.id];

          return (
            <div key={param.id} className="border-b last:border-b-0">
              {/* Name row */}
              <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5 group">
                <button
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setExpanded(e => ({ ...e, [param.id]: !e[param.id] }))}
                >
                  {isExpanded
                    ? <ChevronDown  className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />}
                </button>

                <span className="text-xs font-mono flex-1 truncate" title={param.id}>
                  {param.name}
                </span>

                <span className="text-[10px] text-muted-foreground font-mono w-10 text-right tabular-nums shrink-0">
                  {currentVal.toFixed(2)}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 opacity-0 group-hover:opacity-100 shrink-0"
                  title="Delete parameter"
                  onClick={() => deleteParameter(param.id)}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>

              {/* Slider */}
              <div className="px-3 pb-2">
                <Slider
                  min={param.min ?? -1}
                  max={param.max ?? 1}
                  step={Math.abs((param.max ?? 1) - (param.min ?? -1)) / 200}
                  value={[currentVal]}
                  onValueChange={([v]) => setParameterValue(param.id, v)}
                  className="w-full"
                />
              </div>

              {/* Expanded: edit settings + bindings */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 bg-muted/10 border-t border-border/50">
                  {/* Name field */}
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">Name</span>
                    <Input
                      className="h-6 text-xs flex-1"
                      value={param.name}
                      onChange={e => updateParameter(param.id, { name: e.target.value })}
                    />
                  </div>

                  {/* ID (read-only) */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">ID</span>
                    <Input
                      className="h-6 text-xs flex-1 font-mono"
                      value={param.id}
                      onChange={e => updateParameter(param.id, { id: e.target.value })}
                    />
                  </div>

                  {/* Min / Max */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">Min</span>
                    <Input
                      type="number"
                      className="h-6 text-xs w-16"
                      value={param.min ?? -1}
                      onChange={e => updateParameter(param.id, { min: Number(e.target.value) })}
                    />
                    <span className="text-xs text-muted-foreground ml-1">Max</span>
                    <Input
                      type="number"
                      className="h-6 text-xs w-16"
                      value={param.max ?? 1}
                      onChange={e => updateParameter(param.id, { max: Number(e.target.value) })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2 ml-auto"
                      title="Reset to default"
                      onClick={() => setParameterValue(param.id, param.default ?? 0)}
                    >
                      ↺
                    </Button>
                  </div>

                  {/* Bindings list */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Track bindings</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-xs px-1.5 gap-1"
                        onClick={() => setAddingBinding(param.id)}
                      >
                        <Link className="h-2.5 w-2.5" /> Add
                      </Button>
                    </div>

                    {(param.bindings ?? []).map((b, i) => {
                      const anim = animations.find(a => a.id === b.animationId);
                      const node = nodes.find(n => n.id === b.nodeId);
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-1 text-[10px] bg-muted/40 rounded px-1.5 py-0.5"
                        >
                          <span className="flex-1 truncate text-muted-foreground font-mono" title={`${b.animationId} / ${b.nodeId} / ${b.property}`}>
                            {anim?.name ?? '?'} › {node?.name ?? '?'} › {b.property}
                          </span>
                          <button
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeParameterBinding(param.id, i)}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })}

                    {addingBinding === param.id && (
                      <AddBindingForm
                        animations={animations}
                        nodes={nodes}
                        onAdd={binding => {
                          addParameterBinding(param.id, binding);
                          setAddingBinding(null);
                        }}
                        onCancel={() => setAddingBinding(null)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline form for adding a new track binding to a parameter. */
function AddBindingForm({ animations, nodes, onAdd, onCancel }) {
  const [animId,   setAnimId]   = React.useState(animations[0]?.id ?? '');
  const [property, setProperty] = React.useState('mesh_verts');
  const [nodeId,   setNodeId]   = React.useState('');

  const meshNodes  = nodes.filter(n => (n.type === 'part' && n.mesh) || n.type === 'warpDeformer');
  const groupNodes = nodes.filter(n => n.type === 'group');
  const allNodes   = nodes;

  const candidateNodes = property === 'rotation'
    ? groupNodes
    : property === 'mesh_verts'
      ? meshNodes
      : allNodes;

  return (
    <div className="space-y-1.5 p-2 border rounded bg-background text-xs">
      {/* Animation */}
      <select
        className="w-full h-6 px-1 rounded border bg-background text-xs"
        value={animId}
        onChange={e => setAnimId(e.target.value)}
      >
        {animations.length === 0 && <option value="">— no animations —</option>}
        {animations.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      {/* Property */}
      <select
        className="w-full h-6 px-1 rounded border bg-background text-xs"
        value={property}
        onChange={e => { setProperty(e.target.value); setNodeId(''); }}
      >
        <option value="mesh_verts">Mesh / warp deform (mesh_verts)</option>
        <option value="rotation">Group rotation</option>
        <option value="opacity">Opacity</option>
        <option value="x">Position X</option>
        <option value="y">Position Y</option>
        <option value="scaleX">Scale X</option>
        <option value="scaleY">Scale Y</option>
      </select>

      {/* Node */}
      <select
        className="w-full h-6 px-1 rounded border bg-background text-xs"
        value={nodeId}
        onChange={e => setNodeId(e.target.value)}
      >
        <option value="">— select node —</option>
        {candidateNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>

      <div className="flex gap-1 justify-end pt-0.5">
        <Button variant="ghost" size="sm" className="h-5 text-xs px-1.5" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-5 text-xs px-1.5"
          disabled={!nodeId || !animId}
          onClick={() => onAdd({ animationId: animId, nodeId, property })}
        >
          Bind
        </Button>
      </div>
    </div>
  );
}
