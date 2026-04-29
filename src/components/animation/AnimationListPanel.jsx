import { useState, useCallback } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

export function AnimationListPanel() {
  const proj = useProjectStore(s => s.project);
  const createAnimation = useProjectStore(s => s.createAnimation);
  const renameAnimation = useProjectStore(s => s.renameAnimation);
  const deleteAnimation = useProjectStore(s => s.deleteAnimation);

  const activeAnimationId = useAnimationStore(s => s.activeAnimationId);
  const switchAnimation = useAnimationStore(s => s.switchAnimation);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const handleCreate = () => {
    createAnimation();
    // The store update will add it; we don't need to manually switch here
    // as we might want to auto-select the last one in a useEffect or similar.
    // However, the user might expect an immediate switch.
  };

  const startEditing = (anim) => {
    setEditingId(anim.id);
    setEditValue(anim.name);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameAnimation(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDelete = () => {
    if (deleteConfirmId) {
      deleteAnimation(deleteConfirmId);
      // If we deleted the active one, switch to another if available
      if (deleteConfirmId === activeAnimationId) {
        const remaining = proj.animations.filter(a => a.id !== deleteConfirmId);
        if (remaining.length > 0) {
          switchAnimation(remaining[0]);
        } else {
          // If none left, projectStore logic usually ensures one exists,
          // but let's be safe.
          switchAnimation(null);
        }
      }
      setDeleteConfirmId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border-t border-border overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Animations</h2>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-5 w-5 hover:bg-muted" 
          onClick={handleCreate}
          title="Create New Animation"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {proj.animations.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-[10px] text-muted-foreground italic">No animations.</p>
          </div>
        ) : (
          <div className="space-y-px">
            {proj.animations.map((anim) => (
              <div
                key={anim.id}
                className={`group flex items-center px-3 py-1.5 cursor-pointer transition-colors ${
                  activeAnimationId === anim.id 
                    ? 'bg-primary/10 border-l-2 border-primary' 
                    : 'hover:bg-muted/50 border-l-2 border-transparent'
                }`}
                onClick={() => switchAnimation(anim)}
              >
                {editingId === anim.id ? (
                  <div className="flex flex-1 items-center gap-1 pr-1" onClick={e => e.stopPropagation()}>
                    <Input
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="h-6 text-xs px-1 py-0 focus-visible:ring-1"
                    />
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={commitRename}>
                      <Check className="h-3 w-3 text-green-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setEditingId(null)}>
                      <X className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-xs font-medium truncate">{anim.name}</p>
                      <p className="text-[9px] text-muted-foreground leading-none mt-0.5">
                        {(anim.duration / 1000).toFixed(1)}s · {anim.fps}fps
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(anim);
                        }}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(anim.id);
                        }}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Animation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this animation? This will remove all associated tracks and keyframes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete Animation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
