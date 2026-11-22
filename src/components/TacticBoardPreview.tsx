import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward
} from 'lucide-react';
import type { TacticBoardData } from '../types/domain';
import { TacticPlayerGlyph } from './TacticPlayerGlyph';
import {
  evalQuadraticBezier,
  getTotalAnimationDurationMs,
  interpolateTacticBoardAtTime
} from '../utils/tacticBoardUtils';

interface TacticBoardPreviewProps {
  data?: TacticBoardData;
  className?: string;
  hideControls?: boolean;
  externalTimeMs?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

export function TacticBoardPreview({
  data,
  className = '',
  hideControls = false,
  externalTimeMs,
  svgRef
}: TacticBoardPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [speed, setSpeed] = useState<0.5 | 1 | 1.5 | 2>(
    data?.animationSettings?.defaultSpeed ?? 1
  );
  const [loop, setLoop] = useState<boolean>(data?.animationSettings?.loop ?? true);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  const hasAnimation = Boolean(data?.keyframes && data.keyframes.length > 1);
  const totalDurationMs = useMemo(
    () => (hasAnimation ? getTotalAnimationDurationMs(data?.keyframes) : 0),
    [hasAnimation, data?.keyframes]
  );

  // Reset playback when board changes
  useEffect(() => {
    setIsPlaying(false);
    setTimeMs(0);
  }, [data]);

  // 60-FPS requestAnimationFrame loop
  useEffect(() => {
    if (!isPlaying || !hasAnimation || totalDurationMs <= 0) {
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      }
      const delta = (now - lastFrameTimeRef.current) * speed;
      lastFrameTimeRef.current = now;

      setTimeMs((prev) => {
        const next = prev + delta;
        if (next >= totalDurationMs) {
          if (loop) {
            return next % totalDurationMs;
          }
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
      lastFrameTimeRef.current = null;
    };
  }, [isPlaying, hasAnimation, totalDurationMs, speed, loop]);

  if (!data) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-xs text-slate-400 ${className}`}
      >
        Keine Taktikboard-Skizze hinterlegt
      </div>
    );
  }

  const effectiveTimeMs = typeof externalTimeMs === 'number' ? externalTimeMs : timeMs;
  const frame = hasAnimation
    ? interpolateTacticBoardAtTime(data, effectiveTimeMs)
    : null;

  const renderedNodes = frame ? frame.nodes : data.nodes;
  const hiddenNodeIds = frame ? frame.hiddenNodeIds : new Set<string>();
  const activePathIds = frame ? frame.activePathIds : null;
  const trails = frame ? frame.trails : [];
  const freeBallPosition = frame?.freeBallPosition;

  const width = 400;
  const height = 280;
  const template = data.courtTemplate ?? 'HALF_COURT_VERTICAL';

  const jumpToKeyframe = (direction: -1 | 1) => {
    if (!data.keyframes || data.keyframes.length <= 1) return;
    setIsPlaying(false);
    const currentIdx = frame?.currentKeyframeIndex ?? 0;
    const targetIdx = Math.max(0, Math.min(data.keyframes.length - 1, currentIdx + direction));
    let targetTime = 0;
    for (let i = 1; i <= targetIdx; i++) {
      targetTime += (data.keyframes[i].durationMs || 1400) + (data.keyframes[i].pauseAfterMs ?? 300);
    }
    setTimeMs(Math.min(totalDurationMs, targetTime));
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-inner ${className}`}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="h-full w-full select-none">
        <defs>
          <marker id="arrow-white" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#f8fafc" />
          </marker>
          <marker id="arrow-blue" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#60a5fa" />
          </marker>
          <marker id="arrow-amber" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#f59e0b" />
          </marker>
          <marker id="screen-t" markerWidth="8" markerHeight="10" refX="4" refY="5" orient="auto">
            <line x1="4" y1="0" x2="4" y2="10" stroke="#f59e0b" strokeWidth="3" />
          </marker>
        </defs>

        {/* Court Floor */}
        <rect x="0" y="0" width={width} height={height} fill="#0f2942" />
        <rect x="16" y="12" width={width - 32} height={height - 24} fill="#163b5c" stroke="#93c5fd" strokeWidth="2" />

        {/* Court Template markings */}
        {template === 'HALF_COURT_VERTICAL' && (
          <>
            <path
              d="M 104 12 A 96 56 0 0 0 296 12 Z"
              fill="#1d4ed8"
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2.5"
            />
            <path
              d="M 52 12 A 148 96 0 0 0 348 12"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="2"
              strokeDasharray="8 6"
            />
            <line x1="192" y1="46" x2="208" y2="46" stroke="#ffffff" strokeWidth="2" />
            <line x1="188" y1="80" x2="212" y2="80" stroke="#ffffff" strokeWidth="2.5" />
            <rect x="170" y="4" width="60" height="10" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
          </>
        )}

        {template === 'GOAL_SECTOR_ZOOM' && (
          <>
            <path
              d="M 52 12 A 148 104 0 0 0 348 12 Z"
              fill="#1d4ed8"
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2.5"
            />
            <path
              d="M 16 12 A 184 166 0 0 0 384 12"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="2"
              strokeDasharray="8 6"
            />
            <line x1="188" y1="66" x2="212" y2="66" stroke="#ffffff" strokeWidth="2" />
            <line x1="184" y1="136" x2="216" y2="136" stroke="#ffffff" strokeWidth="2.5" />
            <rect x="155" y="3" width="90" height="11" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
          </>
        )}

        {template === 'FULL_COURT' && (
          <>
            <path
              d="M 16 72 A 52 68 0 0 1 16 208 Z"
              fill="#1d4ed8"
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2"
            />
            <path
              d="M 16 42 A 80 98 0 0 1 16 238"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <line x1="40" y1="133" x2="40" y2="147" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="76" y1="131" x2="76" y2="149" stroke="#ffffff" strokeWidth="2" />
            <rect x="4" y="116" width="12" height="48" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />

            <line x1={width / 2} y1="12" x2={width / 2} y2={height - 12} stroke="#ffffff" strokeWidth="2" />
            <circle cx={width / 2} cy={height / 2} r="18" fill="none" stroke="#93c5fd" strokeWidth="1.5" />

            <path
              d="M 384 72 A 52 68 0 0 0 384 208 Z"
              fill="#1d4ed8"
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2"
            />
            <path
              d="M 384 42 A 80 98 0 0 0 384 238"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <line x1="360" y1="133" x2="360" y2="147" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="324" y1="131" x2="324" y2="149" stroke="#ffffff" strokeWidth="2" />
            <rect x="384" y="116" width="12" height="48" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
          </>
        )}

        {template === 'HALF_COURT_HORIZONTAL' && (
          <>
            <path
              d="M 384 44 A 88 96 0 0 0 384 236 Z"
              fill="#1d4ed8"
              fillOpacity="0.45"
              stroke="#ffffff"
              strokeWidth="2.5"
            />
            <path
              d="M 384 12 A 144 128 0 0 0 384 268"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="2"
              strokeDasharray="8 6"
            />
            <line x1="336" y1="132" x2="336" y2="148" stroke="#ffffff" strokeWidth="2" />
            <line x1="282" y1="128" x2="282" y2="152" stroke="#ffffff" strokeWidth="2.5" />
            <rect x="384" y="110" width="12" height="60" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
          </>
        )}

        {/* Zones */}
        {(data.zones ?? []).map((zone) => {
          const zx = zone.x * width;
          const zy = zone.y * height;
          const zw = zone.width * width;
          const zh = zone.height * height;
          const op = zone.opacity ?? 0.22;
          return (
            <g
              key={zone.id}
              transform={`translate(${zx}, ${zy}) rotate(${zone.rotation ?? 0})`}
            >
              {zone.shape === 'ELLIPSE' ? (
                <ellipse
                  cx="0"
                  cy="0"
                  rx={zw / 2}
                  ry={zh / 2}
                  fill={zone.color}
                  fillOpacity={op}
                  stroke={zone.color}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              ) : (
                <rect
                  x={-zw / 2}
                  y={-zh / 2}
                  width={zw}
                  height={zh}
                  rx="6"
                  fill={zone.color}
                  fillOpacity={op}
                  stroke={zone.color}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              )}
              {zone.label && (
                <text
                  textAnchor="middle"
                  dy="3"
                  fontSize="9"
                  fontWeight="bold"
                  fill="#ffffff"
                  opacity="0.9"
                >
                  {zone.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Paths */}
        {(!hasAnimation || data.animationSettings?.showPathsDuringPlay !== false) &&
          data.paths.map((path) => {
            if (path.points.length < 2) return null;
            const first = path.points[0];
            const last = path.points[path.points.length - 1];

            const isPass = path.type === 'PASS_PATH';
            const isShot = path.type === 'SHOT_PATH';
            const isScreen = path.type === 'SCREEN_BLOCK_PATH';
            const isDribble = path.type === 'DRIBBLE_PATH';
            const isFeint = path.type === 'FEINT_PATH';

            const markerEnd = isScreen
              ? 'url(#screen-t)'
              : isShot || isFeint
                ? 'url(#arrow-amber)'
                : isPass
                  ? 'url(#arrow-blue)'
                  : 'url(#arrow-white)';

            const strokeColor =
              isShot || isScreen || isFeint ? '#f59e0b' : isPass ? '#60a5fa' : '#f8fafc';

            const isDimmed =
              hasAnimation &&
              activePathIds &&
              activePathIds.size > 0 &&
              !activePathIds.has(path.id);

            let midX = ((first.x + last.x) / 2) * width;
            let midY = ((first.y + last.y) / 2) * height;
            if (path.controlPoint && path.points.length === 2) {
              const mid = evalQuadraticBezier(first, path.controlPoint, last, 0.5);
              midX = mid.x * width;
              midY = mid.y * height;
            }

            return (
              <g key={path.id} opacity={isDimmed ? 0.35 : 1}>
                {path.controlPoint && path.points.length === 2 ? (
                  <path
                    d={`M ${first.x * width} ${first.y * height} Q ${path.controlPoint.x * width} ${path.controlPoint.y * height} ${last.x * width} ${last.y * height}`}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isShot ? 3.5 : 2.5}
                    strokeDasharray={
                      isPass ? '6 4' : isDribble ? '3 3' : isFeint ? '2 4' : undefined
                    }
                    markerEnd={markerEnd}
                  />
                ) : (
                  <polyline
                    points={path.points.map((p) => `${p.x * width},${p.y * height}`).join(' ')}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isShot ? 3.5 : 2.5}
                    strokeDasharray={
                      isPass ? '6 4' : isDribble ? '3 3' : isFeint ? '2 4' : undefined
                    }
                    markerEnd={markerEnd}
                  />
                )}
                {path.stepNumber !== undefined && (
                  <g transform={`translate(${midX}, ${midY - 8})`}>
                    <circle r="8" fill="#0f172a" stroke={strokeColor} strokeWidth="1.5" />
                    <text textAnchor="middle" dy="3" fontSize="9" fontWeight="bold" fill="#ffffff">
                      {path.stepNumber}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

        {/* Motion Trails during playback */}
        {trails.map((trail) => {
          if (trail.points.length < 2) return null;
          return (
            <line
              key={`trail-${trail.nodeId}`}
              x1={trail.points[0].x * width}
              y1={trail.points[0].y * height}
              x2={trail.points[1].x * width}
              y2={trail.points[1].y * height}
              stroke={trail.color ?? '#60a5fa'}
              strokeWidth="3"
              strokeDasharray="4 4"
              opacity="0.45"
            />
          );
        })}

        {/* Nodes */}
        {renderedNodes.map((node) => {
          if (hiddenNodeIds.has(node.id)) return null;
          const cx = node.x * width;
          const cy = node.y * height;

          if (node.type === 'WAYPOINT') {
            return (
              <circle
                key={node.id}
                cx={cx}
                cy={cy}
                r="4.5"
                fill="#f8fafc"
                stroke="#0f172a"
                strokeWidth="1.5"
              />
            );
          }

          if (node.type === 'EQUIPMENT_CONE') {
            return (
              <polygon
                key={node.id}
                points={`${cx},${cy - 8} ${cx - 7},${cy + 6} ${cx + 7},${cy + 6}`}
                fill={node.color ?? '#facc15'}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
            );
          }

          if (node.type === 'EQUIPMENT_MAT') {
            return (
              <rect
                key={node.id}
                x={cx - 16}
                y={cy - 10}
                width="32"
                height="20"
                rx="3"
                fill="#0284c7"
                stroke="#e0f2fe"
                strokeWidth="1.5"
              />
            );
          }

          if (node.type === 'EQUIPMENT_GOAL_TARGET') {
            return (
              <rect
                key={node.id}
                x={cx - 9}
                y={cy - 6}
                width="18"
                height="12"
                fill="none"
                stroke="#facc15"
                strokeWidth="2.5"
              />
            );
          }

          return (
            <g key={node.id} transform={`translate(${cx}, ${cy})`}>
              <TacticPlayerGlyph node={node} scale={0.85} />
            </g>
          );
        })}

        {/* Free ball in flight */}
        {freeBallPosition && (
          <circle
            cx={freeBallPosition.x * width}
            cy={freeBallPosition.y * height}
            r="6.5"
            fill="#f59e0b"
            stroke="#0f172a"
            strokeWidth="1.8"
          />
        )}
      </svg>

      {/* 60-FPS Animation Player Bar */}
      {hasAnimation && !hideControls && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/90 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => jumpToKeyframe(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
              title="Vorherige Szene"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (timeMs >= totalDurationMs) setTimeMs(0);
                setIsPlaying((p) => !p);
              }}
              className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 font-bold text-white hover:bg-emerald-500"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => jumpToKeyframe(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
              title="Nächste Szene"
            >
              <SkipForward className="h-3.5 w-3.5" />
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
            className="h-1.5 flex-1 min-w-[100px] accent-emerald-500"
          />

          <div className="flex items-center gap-1.5">
            {([0.5, 1, 1.5, 2] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded px-1.5 py-1 text-[10px] font-bold ${
                  speed === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {s}x
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLoop((l) => !l)}
              className={`flex h-7 w-7 items-center justify-center rounded ${
                loop ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
              title="Endlosschleife (Loop)"
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
