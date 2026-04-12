import React, { useRef, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import CanvasViewport from '@/components/canvas/CanvasViewport';
import { LayerPanel } from '@/components/layers/LayerPanel';
import { Inspector } from '@/components/inspector/Inspector';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { AnimationListPanel } from '@/components/animation/AnimationListPanel';
import { ArmaturePanel } from '@/components/armature/ArmaturePanel';
import { Download, Upload, Palette, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpIcon } from '@/components/ui/help-icon';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useTheme, AVAILABLE_FONTS } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";


export default function EditorLayout() {
  /**
   * remeshRef is a stable ref that CanvasViewport populates.
   * Inspector calls remeshRef.current(partId, opts) to trigger remeshing
   * without needing to lift state up or use context.
   */
  const remeshRef = useRef(null);
  const deleteMeshRef = useRef(null);

  const handleRemesh = useCallback((partId, opts) => {
    remeshRef.current?.(partId, opts);
  }, []);

  const handleDeleteMesh = useCallback((partId) => {
    deleteMeshRef.current?.(partId);
  }, []);

  const mode = useEditorStore(s => s.editorMode);
  const setEditorMode = useEditorStore(s => s.setEditorMode);
  const isAnimationMode = mode === 'animation';
  const project = useProjectStore(s => s.project);
  const captureRestPose = useAnimationStore(s => s.captureRestPose);

  const saveRef = useRef(null);
  const loadRef = useRef(null);

  const {
    themeMode, setThemeMode,
    openThemeModal,
    setLightTheme, setDarkTheme,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
  } = useTheme();

  const handleThemeSelectClick = () => {
    const config = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? {
      title: 'Select Dark Theme',
      themes: darkThemePresets,
      onSelect: setDarkTheme,
    } : {
      title: 'Select Light Theme',
      themes: lightThemePresets,
      onSelect: setLightTheme,
    };
    openThemeModal(config);
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 border-b flex items-center px-4 shrink-0 bg-card gap-3 relative">
        <div className="flex items-center gap-3 h-full">
          <span className="font-semibold text-sm select-none tracking-tight">Stretchy Studio</span>
          <span className="text-xs text-muted-foreground border border-border/50 px-1.5 py-0.5 font-mono">v0.1</span>

          <div className="flex h-full items-stretch border-l border-r ml-1 mr-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-none hover:bg-muted"
              onClick={() => saveRef.current?.()}
              title="Save project (.stretch)"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-none border-l hover:bg-muted"
              onClick={() => loadRef.current?.()}
              title="Load project (.stretch)"
            >
              <Upload className="h-4 w-4" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-full w-9 rounded-none border-l hover:bg-muted"
                  title="Customize Theme"
                >
                  <Palette className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4 space-y-4 shadow-2xl border-border/60">
                <div className="flex items-center gap-2">
                  <ToggleGroup
                    type="single"
                    value={themeMode}
                    onValueChange={(value) => {
                      if (value) setThemeMode(value);
                    }}
                    aria-label="Theme mode"
                  >
                    <ToggleGroupItem value="light" aria-label="Light mode" className="h-8 w-8">
                      <Sun className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="dark" aria-label="Dark mode" className="h-8 w-8">
                      <Moon className="h-4 w-4" />
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleThemeSelectClick}
                  >
                    Select Theme
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-select" className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Font Family</Label>
                  <Select value={fontFamily} onValueChange={setFontFamily}>
                    <SelectTrigger id="font-select" className="h-8 text-xs">
                      <SelectValue placeholder="Select a font" />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_FONTS.map((font) => (
                        <SelectItem key={font.id} value={font.id} className="text-xs">
                          {font.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-size-slider" className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Font Size ({fontSize}px)</Label>
                  <Slider
                    id="font-size-slider"
                    min={12}
                    max={20}
                    step={1}
                    value={[fontSize]}
                    onValueChange={(value) => setFontSize(value[0])}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Center Toggle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center bg-muted/30 rounded-lg p-0.5 border border-border/40">
          <button
            onClick={() => setEditorMode('staging')}
            className={[
              'px-3 py-1 rounded-md text-[13px] font-semibold transition-all flex items-center gap-1.5',
              !isAnimationMode
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/10'
                : 'text-muted-foreground hover:text-foreground'
            ].join(' ')}
          >
            Staging
            <HelpIcon tip="In Staging mode, you set the base layout, mesh structure, and joint positions." className="opacity-40 hover:opacity-100" />
          </button>
          <button
            onClick={() => {
              setEditorMode('animation');
              captureRestPose(project.nodes);
            }}
            className={[
              'px-3 py-1 rounded-md text-[13px] font-semibold transition-all flex items-center gap-1.5 ml-0.5',
              isAnimationMode
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/10'
                : 'text-muted-foreground hover:text-foreground'
            ].join(' ')}
          >
            Animation
            <HelpIcon tip="In Animation mode, you create keyframes on the timeline." className="opacity-40 hover:opacity-100" />
          </button>
        </div>

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground hidden sm:block">Scroll to zoom · Alt+drag to pan</span>
      </header>

      {/* Workspace */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Layers */}
          <ResizablePanel defaultSize={18} minSize={12} maxSize={28}>
            <div className="flex h-full flex-col border-r">
              <div className="px-3 py-2 border-b shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layers</h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <LayerPanel />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Center: Canvas + Timeline */}
          <ResizablePanel defaultSize={62}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={isAnimationMode ? 85 : 100}>
                <CanvasViewport
                  remeshRef={remeshRef}
                  deleteMeshRef={deleteMeshRef}
                  saveRef={saveRef}
                  loadRef={loadRef}
                />
              </ResizablePanel>
              {isAnimationMode && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={15} minSize={12} collapsible>
                    <div className="flex h-full flex-col border-t">
                      <TimelinePanel />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />

          {/* Sidebar: Inspector + Animations */}
          <ResizablePanel defaultSize={20} minSize={14} maxSize={30}>
            <ResizablePanelGroup direction="vertical">
              {/* Inspector Content */}
              <ResizablePanel defaultSize={isAnimationMode ? 75 : 100} minSize={30}>
                <div className="flex h-full flex-col border-l overflow-hidden">
                  <ArmaturePanel />
                  <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inspector</h2>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Inspector onRemesh={handleRemesh} onDeleteMesh={handleDeleteMesh} />
                  </div>
                </div>
              </ResizablePanel>

              {isAnimationMode && (
                <>
                  <ResizableHandle />
                  {/* Animations Content */}
                  <ResizablePanel defaultSize={25} minSize={10}>
                    <AnimationListPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
