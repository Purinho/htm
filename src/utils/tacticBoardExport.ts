import type { TacticBoardData } from '../types/domain';
import { getTotalAnimationDurationMs, interpolateTacticBoardAtTime } from './tacticBoardUtils';

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Downloads an SVG element as a standalone .svg vector file.
 */
export function downloadSvgElement(svg: SVGSVGElement, filename = 'taktikboard.svg'): void {
  const serializer = new XMLSerializer();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const source = serializer.serializeToString(clone);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Rasterizes an SVG element to a high-DPI PNG file and triggers download.
 */
export async function downloadPngFromSvg(
  svg: SVGSVGElement,
  filename = 'taktikboard.png',
  exportWidth = 1200,
  exportHeight = 840
): Promise<void> {
  const serializer = new XMLSerializer();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  clone.setAttribute('width', String(exportWidth));
  clone.setAttribute('height', String(exportHeight));
  const source = serializer.serializeToString(clone);
  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = exportHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f2942';
    ctx.fillRect(0, 0, exportWidth, exportHeight);
    ctx.drawImage(img, 0, 0, exportWidth, exportHeight);

    const pngUrl = canvas.toDataURL('image/png');
    triggerDownload(pngUrl, filename);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * Exports a TacticBoardData animation as a client-side WebM video clip using Canvas + MediaRecorder.
 * No server required.
 */
export async function exportTacticAnimationWebm(
  board: TacticBoardData,
  filename = 'taktik-animation.webm',
  onProgress?: (ratio: number) => void
): Promise<{ ok: boolean; reason?: string }> {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, reason: 'MediaRecorder wird von diesem Browser nicht unterstützt.' };
  }

  const totalMs = getTotalAnimationDurationMs(board.keyframes);
  if (totalMs <= 0) {
    return { ok: false, reason: 'Keine Animations-Szenen (Keyframes) vorhanden.' };
  }

  const width = 960;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, reason: 'Canvas-Kontext nicht verfügbar.' };
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  recorder.start();

  const fps = 30;
  const frameInterval = 1000 / fps;
  const speed = board.animationSettings?.defaultSpeed ?? 1;
  const effectiveTotalMs = totalMs / speed;
  const totalFrames = Math.max(1, Math.ceil(effectiveTotalMs / frameInterval));

  for (let f = 0; f <= totalFrames; f++) {
    const simTime = Math.min(totalMs, f * frameInterval * speed);
    const frame = interpolateTacticBoardAtTime(board, simTime);
    drawBoardFrameToCanvas(ctx, board, frame, width, height);
    onProgress?.(Math.min(1, f / totalFrames));
    await new Promise((r) => setTimeout(r, frameInterval));
  }

  recorder.stop();
  const blob = await stopped;
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true };
}

function drawBoardFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  board: TacticBoardData,
  frame: ReturnType<typeof interpolateTacticBoardAtTime>,
  width: number,
  height: number
) {
  // Court background
  ctx.fillStyle = '#0f2942';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#163b5c';
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 3;
  const padX = width * 0.04;
  const padY = height * 0.043;
  ctx.fillRect(padX, padY, width - padX * 2, height - padY * 2);
  ctx.strokeRect(padX, padY, width - padX * 2, height - padY * 2);

  // Court markings matching SVG preview & editor templates
  if (board.courtTemplate === 'HALF_COURT_VERTICAL') {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(width * 0.5, padY, width * 0.24, height * 0.2, 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([12, 8]);
    ctx.ellipse(width * 0.5, padY, width * 0.37, height * 0.343, 0, 0, Math.PI);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(width * 0.48, height * 0.164);
    ctx.lineTo(width * 0.52, height * 0.164);
    ctx.moveTo(width * 0.47, height * 0.286);
    ctx.lineTo(width * 0.53, height * 0.286);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.fillRect(width * 0.425, 6, width * 0.15, 16);
    ctx.strokeRect(width * 0.425, 6, width * 0.15, 16);
  } else if (board.courtTemplate === 'GOAL_SECTOR_ZOOM') {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(width * 0.5, padY, width * 0.37, height * 0.371, 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([12, 8]);
    ctx.ellipse(width * 0.5, padY, width * 0.46, height * 0.593, 0, 0, Math.PI);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(width * 0.47, height * 0.236);
    ctx.lineTo(width * 0.53, height * 0.236);
    ctx.moveTo(width * 0.46, height * 0.486);
    ctx.lineTo(width * 0.54, height * 0.486);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.fillRect(width * 0.3875, 5, width * 0.225, 18);
    ctx.strokeRect(width * 0.3875, 5, width * 0.225, 18);
  } else if (board.courtTemplate === 'FULL_COURT') {
    ctx.save();
    // Left 6m & 9m
    ctx.beginPath();
    ctx.ellipse(padX, height * 0.5, width * 0.13, height * 0.243, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([10, 6]);
    ctx.ellipse(padX, height * 0.5, width * 0.2, height * 0.35, 0, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Right 6m & 9m
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(width - padX, height * 0.5, width * 0.13, height * 0.243, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([10, 6]);
    ctx.ellipse(width - padX, height * 0.5, width * 0.2, height * 0.35, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Vertical center line & center circle
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(width * 0.5, padY);
    ctx.lineTo(width * 0.5, height - padY);
    ctx.stroke();

    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, width * 0.045, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.fillRect(width * 0.01, height * 0.414, width * 0.03, height * 0.172);
    ctx.strokeRect(width * 0.01, height * 0.414, width * 0.03, height * 0.172);
    ctx.fillRect(width * 0.96, height * 0.414, width * 0.03, height * 0.172);
    ctx.strokeRect(width * 0.96, height * 0.414, width * 0.03, height * 0.172);
  } else if (board.courtTemplate === 'HALF_COURT_HORIZONTAL') {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(width - padX, height * 0.5, width * 0.22, height * 0.343, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([12, 8]);
    ctx.ellipse(width - padX, height * 0.5, width * 0.36, height * 0.457, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.fillRect(width * 0.96, height * 0.393, width * 0.03, height * 0.214);
    ctx.strokeRect(width * 0.96, height * 0.393, width * 0.03, height * 0.214);
  }

  // Zones
  for (const zone of board.zones ?? []) {
    ctx.save();
    ctx.translate(zone.x * width, zone.y * height);
    if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);
    ctx.globalAlpha = zone.opacity ?? 0.22;
    ctx.fillStyle = zone.color;
    const zw = zone.width * width;
    const zh = zone.height * height;
    if (zone.shape === 'ELLIPSE') {
      ctx.beginPath();
      ctx.ellipse(0, 0, zw / 2, zh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-zw / 2, -zh / 2, zw, zh);
    }
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = zone.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (zone.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.label, 0, 5);
    }
    ctx.restore();
  }

  // Paths
  if (board.animationSettings?.showPathsDuringPlay !== false) {
    for (const path of board.paths) {
      if (path.points.length < 2) continue;
      const isHighlighted = frame.activePathIds.has(path.id);
      ctx.save();
      ctx.globalAlpha = isHighlighted ? 1 : 0.35;
      ctx.strokeStyle =
        path.type === 'PASS_PATH'
          ? '#60a5fa'
          : path.type === 'SHOT_PATH' || path.type === 'SCREEN_BLOCK_PATH' || path.type === 'FEINT_PATH'
            ? '#f59e0b'
            : '#f8fafc';
      ctx.lineWidth = isHighlighted ? 4.5 : 3;
      if (path.type === 'PASS_PATH' || path.type === 'DRIBBLE_PATH' || path.type === 'FEINT_PATH') {
        ctx.setLineDash([10, 6]);
      }
      ctx.beginPath();
      const p0 = path.points[0];
      const pLast = path.points[path.points.length - 1];
      ctx.moveTo(p0.x * width, p0.y * height);
      if (path.controlPoint && path.points.length === 2) {
        ctx.quadraticCurveTo(
          path.controlPoint.x * width,
          path.controlPoint.y * height,
          pLast.x * width,
          pLast.y * height
        );
      } else {
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x * width, path.points[i].y * height);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Trails
  for (const trail of frame.trails) {
    if (trail.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = trail.color ?? '#60a5fa';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(trail.points[0].x * width, trail.points[0].y * height);
    ctx.lineTo(trail.points[1].x * width, trail.points[1].y * height);
    ctx.stroke();
    ctx.restore();
  }

  // Nodes
  for (const node of frame.nodes) {
    if (node.type === 'WAYPOINT' || frame.hiddenNodeIds.has(node.id)) continue;
    const cx = node.x * width;
    const cy = node.y * height;
    ctx.save();
    ctx.translate(cx, cy);
    if (node.type === 'OFFENSE_PLAYER') {
      ctx.fillStyle = node.color ?? '#1e3a8a';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(20, 16);
      ctx.lineTo(-20, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (node.type === 'DEFENSE_PLAYER') {
      ctx.fillStyle = node.color ?? '#991b1b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (node.type === 'GOALKEEPER' || node.type === 'COACH_FEEDER') {
      ctx.fillStyle = node.color ?? (node.type === 'GOALKEEPER' ? '#10b981' : '#8b5cf6');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    if (node.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, 0, node.type === 'OFFENSE_PLAYER' ? 8 : 5);
    }

    if (node.hasBall) {
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(16, -14, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Free ball
  if (frame.freeBallPosition) {
    ctx.save();
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(frame.freeBallPosition.x * width, frame.freeBallPosition.y * height, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
