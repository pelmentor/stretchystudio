import React from 'react';
import EditorLayout from '@/app/layout/EditorLayout';
import { Toaster } from '@/components/ui/toaster';
import { useUndoRedo } from '@/hooks/useUndoRedo';

function App() {
  // Mount global undo/redo keyboard handler
  useUndoRedo();

  return (
    <>
      <EditorLayout />
      <Toaster />
    </>
  );
}

export default App;
