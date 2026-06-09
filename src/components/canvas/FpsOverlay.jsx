import { useEffect, useRef, useState } from 'react';

export function FpsOverlay() {
  const [fps, setFps] = useState(0);
  const framesRef = useRef([]);

  useEffect(() => {
    let raf = 0;
    let lastEmit = performance.now();
    const tick = (t) => {
      const frames = framesRef.current;
      frames.push(t);
      const cutoff = t - 1000;
      while (frames.length > 0 && frames[0] <= cutoff) frames.shift();
      if (t - lastEmit >= 250) {
        setFps(frames.length);
        lastEmit = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute top-1 left-2 text-[10px] font-mono text-red-500 pointer-events-none select-none tabular-nums z-50">
      {fps} fps
    </div>
  );
}
