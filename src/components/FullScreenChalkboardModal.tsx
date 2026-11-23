import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  Pause,
  PenTool,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  X
} from 'lucide-react';
import type { TacticBoardData } from '../types/domain';
import { TacticBoardPreview } from './TacticBoardPreview';
import {
  generateKeyframesFromPaths,
  getTotalAnimationDurationMs,
  interpolateTacticBoardAtTime
} from '../utils/tacticBoardUtils';
import {
  cleanupOverlayHistory,
  pushOverlayHistory,
  requestOverlayClose
} from '../utils/overlayHistory';

interface FullScreenChalkboardModalProps {
  isOpen: boolean;
  title: string;
  coachingPoints?: string;
  tacticBoardData?: TacticBoardData;
  referenceImageData?: string;
  onClose: () => void;
}

const CHALK_COLORS = [
  { hex: '#facc15', label: 'Gelb' },
  { hex: '#ef4444', label: 'Rot' },
  { hex: '#38bdf8', label: 'Hellblau' },
  { hex: '#ffffff', label: 'Weiß' }
];

export function FullScreenChalkboardModal({
  isOpen,
  title,
  coachingPoints,
  tacticBoardData,
  referenceImageData,
  onClose
}: FullScreenChalkboardModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chalkColor, setChalkColor] = useState('#facc15');
  const [isDrawing, setIsDrawing] = useState(false);

  const effectiveBoardData = useMemo(() => {
    if (!tacticBoardData) return undefined;
    if (tacticBoardData.keyframes && tacticBoardData.keyframes.length > 1) {
      return tacticBoardData;
    }
    if (tacticBoardData.paths.length > 0) {
      return generateKeyframesFromPaths(tacticBoardData);
    }
    return tacticBoardData;
  }, [tacticBoardData]);

  // 60-FPS Animation Playback state (combines seamlessly with Live Chalk Pen)
  const hasAnimation = Boolean(
    effectiveBoardData?.keyframes && effectiveBoardData.keyframes.length > 1
  );
  const totalDurationMs = useMemo(
    () => (hasAnimation ? getTotalAnimationDurationMs(effectiveBoardData?.keyframes) : 0),
    [hasAnimation, effectiveBoardData?.keyframes]
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [speed, setSpeed] = useState<0.5 | 1 | 1.5 | 2>(
    tacticBoardData?.animationSettings?.defaultSpeed ?? 1
  );
  const [loop, setLoop] = useState<boolean>(tacticBoardData?.animationSettings?.loop ?? true);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const overlayIdRef = useRef<string | null>(null);

  const handleClose = () => {
    const id = overlayIdRef.current;
    if (id) {
      requestOverlayClose(id, () => onCloseRef.current());
    } else {
      onCloseRef.current();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const id = `chalkboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    overlayIdRef.current = id;
    pushOverlayHistory(id, () => onCloseRef.current());

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cleanupOverlayHistory(id);
      if (overlayIdRef.current === id) {
        overlayIdRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    setIsPlaying(false);
    setTimeMs(0);
  }, [isOpen, tacticBoardData]);

  useEffect(() => {
    if (!isOpen || !isPlaying || !hasAnimation || totalDurationMs <= 0) {
      lastFrameRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const delta = (now - lastFrameRef.current) * speed;
      lastFrameRef.current = now;

      setTimeMs((prev) => {
        const next = prev + delta;
        if (next >= totalDurationMs) {
          if (loop) return next % totalDurationMs;
          setIsPlaying(false);
          return totalDurationMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = null;
    };
  }, [isOpen, isPlaying, hasAnimation, totalDurationMs, speed, loop]);

  const jumpToKeyframe = (direction: -1 | 1) => {
    if (!effectiveBoardData?.keyframes || effectiveBoardData.keyframes.length <= 1) return;
    setIsPlaying(false);
    const frame = interpolateTacticBoardAtTime(effectiveBoardData, timeMs);
    const targetIdx = Math.max(
      0,
      Math.min(effectiveBoardData.keyframes.length - 1, frame.currentKeyframeIndex + direction)
    );
    let targetTime = 0;
    for (let i = 1; i <= targetIdx; i++) {
      targetTime +=
        (effectiveBoardData.keyframes[i].durationMs || 1400) +
        (effectiveBoardData.keyframes[i].pauseAfterMs ?? 300);
    }
    setTimeMs(Math.min(totalDurationMs, targetTime));
  };

  // Sync canvas pixel resolution to container dimensions
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [isOpen]);

  if (!isOpen) return null;

  function clearChalkOverlay() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function getCanvasCoords(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    setIsDrawing(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    ctx.strokeStyle = chalkColor;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function handlePointerUp() {
    setIsDrawing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-3 lg:p-6">
      {/* Top Controls Bar (Large Touch Targets >= 48px for Hall Use) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <PenTool className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold tracking-wider text-amber-400 uppercase">
              Vollbild-Taktiktafel & Temporärer Live-Zeichenstift (Kreide-Modus)
            </span>
            <h2 className="text-base font-bold text-white lg:text-lg">{title}</h2>
          </div>
        </div>

        {/* Chalk Pen Color Selector & Clear Button */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">Stiftfarbe:</span>
          {CHALK_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setChalkColor(c.hex)}
              className={`h-9 w-9 rounded-full border-2 transition ${
                chalkColor === c.hex ? 'scale-110 border-white shadow-lg' : 'border-slate-700'
              }`}
              style={{ backgroundColor: c.hex }}
              title={c.label}
            />
          ))}

          <button
            type="button"
            onClick={clearChalkOverlay}
            className="ml-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-950/60 px-4 py-2 text-xs font-bold text-amber-200 hover:bg-amber-900"
          >
            <Eraser className="h-4 w-4" />
            Freihand wegwischen
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
            Schließen
          </button>
        </div>
      </div>

      {/* Main Presentation Area with Temporary Freehand Canvas Overlay */}
      <div className="mt-4 grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
        <div className="flex flex-col gap-2 overflow-hidden lg:col-span-9">
          <div
            ref={containerRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
          >
            {referenceImageData && !tacticBoardData ? (
              <img
                src={referenceImageData}
                alt={title}
                className="h-full w-full object-contain p-4 select-none"
              />
            ) : (
              <TacticBoardPreview
                data={effectiveBoardData}
                hideControls
                externalTimeMs={hasAnimation ? timeMs : undefined}
                className="h-full w-full border-0"
              />
            )}

            {/* Transparent Chalk Canvas on Top */}
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
            />
          </div>

          {hasAnimation && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => jumpToKeyframe(-1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
                  title="Vorherige Szene"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (timeMs >= totalDurationMs) setTimeMs(0);
                    setIsPlaying((p) => !p);
                  }}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-500"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause (Zeichnen möglich)' : 'Animation abspielen'}
                </button>
                <button
                  type="button"
                  onClick={() => jumpToKeyframe(1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
                  title="Nächste Szene"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(1, totalDurationMs)}
                value={Math.min(totalDurationMs, timeMs)}
                onChange={(e) => {
                  setIsPlaying(false);
                  setTimeMs(Number(e.target.value));
                }}
                className="h-2 flex-1 min-w-[140px] accent-emerald-500"
              />

              <div className="flex items-center gap-1.5">
                {([0.5, 1, 1.5, 2] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`min-h-[36px] rounded-lg px-2.5 text-xs font-bold ${
                      speed === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLoop((l) => !l)}
                  className={`flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg ${
                    loop ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                  title="Endlosschleife (Loop)"
                >
                  <Repeat className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: High-Contrast Coaching Points for Quick Glance */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-3">
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                Wichtigste Coaching-Punkte
              </h3>
              <p className="mt-2 text-sm leading-relaxed font-medium text-slate-100 whitespace-pre-line lg:text-base">
                {coachingPoints || 'Keine speziellen Coaching-Punkte hinterlegt.'}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            💡 <strong>Hinweis:</strong> Alles, was du hier mit dem Finger oder Stift einzeichnest, ist nur für die aktuelle Erklärung sichtbar und verändert deine gespeicherte Übung nicht.
          </div>
        </div>
      </div>
    </div>
  );
}
