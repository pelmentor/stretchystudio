import React from 'react';
import { useProjectStore } from '@/store/projectStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Grid2x2 } from 'lucide-react';

/**
 * Inspector panel for warpDeformer nodes.
 *
 * Shows the grid dimensions, bounding box, and parameter binding.
 * The actual lattice editing happens in the canvas overlay (GizmoOverlay)
 * when the warp deformer is selected.
 */
export function WarpDeformerPanel({ node }) {
  const parameters    = useProjectStore(s => s.project.parameters);
  const animations    = useProjectStore(s => s.project.animations);
  const allNodes      = useProjectStore(s => s.project.nodes);
  const updateProject = useProjectStore(s => s.updateProject);

  const update = (partial) => updateProject(proj => {
    const n = proj.nodes.find(x => x.id === node.id);
    if (n) Object.assign(n, partial);
  });

  const collectDescendantMeshParts = (parentId) => {
    const result = [];
    for (const n of allNodes) {
      if (n.parent !== parentId) continue;
      if (n.type === 'part' && n.mesh) result.push(n);
      else if (n.type === 'group' || n.type === 'warpDeformer') result.push(...collectDescendantMeshParts(n.id));
    }
    return result;
  };

  const fitToChildren = () => {
    const children = collectDescendantMeshParts(node.id);
    if (children.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      for (const v of child.mesh.vertices) {
        const x = v.restX ?? v.x, y = v.restY ?? v.y;
        if (x < minX) minX = x;  if (x > maxX) maxX = x;
        if (y < minY) minY = y;  if (y > maxY) maxY = y;
      }
    }
    const PAD = 20;
    const newGridX = minX - PAD, newGridY = minY - PAD;
    const newGridW = maxX - minX + PAD * 2, newGridH = maxY - minY + PAD * 2;

    updateProject(proj => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (!n) return;

      const oldGridX = n.gridX ?? 0, oldGridY = n.gridY ?? 0;
      const oldGridW = n.gridW || 1,  oldGridH = n.gridH || 1;

      // Remap keyframe control points from old grid space to new grid space so
      // the UV parameterization (which uses gridX/Y/W/H) stays consistent with
      // the stored absolute control point positions.
      const param   = proj.parameters?.find(p => p.id === n.parameterId);
      const binding = param?.bindings?.find(b => b.nodeId === n.id && b.property === 'mesh_verts');
      if (binding) {
        const anim  = proj.animations?.find(a => a.id === binding.animationId);
        const track = anim?.tracks?.find(t => t.nodeId === n.id && t.property === 'mesh_verts');
        if (track) {
          for (const kf of track.keyframes) {
            if (!Array.isArray(kf.value)) continue;
            kf.value = kf.value.map(pt => ({
              x: newGridX + ((pt.x - oldGridX) / oldGridW) * newGridW,
              y: newGridY + ((pt.y - oldGridY) / oldGridH) * newGridH,
            }));
          }
        }
      }

      n.gridX = newGridX; n.gridY = newGridY;
      n.gridW = newGridW; n.gridH = newGridH;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Grid2x2 className="h-3.5 w-3.5" /> Warp Deformer
      </div>

      {/* Grid dimensions */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Grid size (col × row control points)</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number" min="1" max="10"
            className="h-7 text-xs w-16"
            value={node.col ?? 2}
            onChange={e => update({ col: Math.max(1, Math.min(10, Number(e.target.value))) })}
          />
          <span className="text-xs text-muted-foreground">×</span>
          <Input
            type="number" min="1" max="10"
            className="h-7 text-xs w-16"
            value={node.row ?? 2}
            onChange={e => update({ row: Math.max(1, Math.min(10, Number(e.target.value))) })}
          />
          <span className="text-xs text-muted-foreground">
            = {((node.col ?? 2) + 1) * ((node.row ?? 2) + 1)} pts
          </span>
        </div>
      </div>

      {/* Bounding box */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Grid bounds (canvas px)</Label>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={fitToChildren}>
            Fit to children
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[['X', 'gridX'], ['Y', 'gridY'], ['W', 'gridW'], ['H', 'gridH']].map(([label, key]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground w-4">{label}</span>
              <Input
                type="number"
                className="h-6 text-xs flex-1"
                value={node[key] ?? 0}
                onChange={e => update({ [key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Parameter binding */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Driven by parameter
          <span className="block font-normal text-muted-foreground/70">
            Moving this parameter scrubs the warp deformer keyforms.
          </span>
        </Label>
        <select
          className="w-full h-7 text-xs px-1.5 rounded border bg-background"
          value={node.parameterId ?? ''}
          onChange={e => update({ parameterId: e.target.value || null })}
        >
          <option value="">— none —</option>
          {parameters.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
          ))}
        </select>
      </div>

      {node.parameterId && (
        <p className="text-[10px] text-muted-foreground italic">
          Keyform canvas editing: select the warp deformer, then drag control points in the canvas
          at each parameter value to build the deformation.
        </p>
      )}
    </div>
  );
}
