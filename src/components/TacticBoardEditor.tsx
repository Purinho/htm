import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CircleDot,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal2,
  Layers,
  ListOrdered,
  MousePointer,
  PenTool,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  UserPlus,
  Users
} from 'lucide-react';
import type {
  CourtTemplate,
  TacticBoardData,
  TacticNode,
  TacticPath,
  TacticPathType,
  TacticZone
} from '../types/domain';
import { buildTacticBoardPreset, TACTIC_PRESETS } from '../utils/tacticPresets';
import {
  createKeyframeFromBoardOrPrevious,
  deleteTacticPath,
  distancePointToQuadraticBezier,
  distancePointToSegment,
  evalQuadraticBezier,
  generateKeyframesFromPaths,
  hasPathNumberingGaps,
  mirrorTacticBoardHorizontal,
  moveTacticPathOrder,
  renumberTacticPaths,
  setTacticPathStepNumber
} from '../utils/tacticBoardUtils';
import {
  downloadPngFromSvg,
  downloadSvgElement,
  exportTacticAnimationWebm
} from '../utils/tacticBoardExport';
import { getDefaultNodeRotation, TacticPlayerGlyph } from './TacticPlayerGlyph';
import { TacticBoardPreview } from './TacticBoardPreview';

type EditorTool =
  | 'SELECT_MOVE'
  | 'ROTATE'
  | 'STAMP_OFFENSE'
  | 'STAMP_DEFENSE'
  | 'STAMP_GK'
  | 'STAMP_COACH'
  | 'STAMP_CONE'
  | 'STAMP_MAT'
  | 'STAMP_TARGET'
  | 'STAMP_ZONE_RECT'
  | 'STAMP_ZONE_ELLIPSE'
  | 'DRAW_RUN'
  | 'DRAW_PASS'
  | 'DRAW_DRIBBLE'
  | 'DRAW_SHOT'
  | 'DRAW_SCREEN'
  | 'DRAW_FEINT';

interface TacticBoardEditorProps {
  value: TacticBoardData;
  onChange: (next: TacticBoardData) => void;
}

const OFFENSE_LABELS = ['RL', 'RM', 'RR', 'KM', 'LA', 'RA', 'A1', 'A2'];
const DEFENSE_LABELS = ['IL', 'IR', 'HL', 'HR', 'AL', 'AR', 'VM', 'HM'];

const PATH_TYPE_LABELS: Record<TacticPathType, string> = {
  RUN_PATH: 'Laufweg',
  PASS_PATH: 'Passweg',
  DRIBBLE_PATH: 'Prellen',
  SHOT_PATH: 'Torwurf',
  SCREEN_BLOCK_PATH: 'Sperre',
  FEINT_PATH: 'Täuschung'
};

export function TacticBoardEditor({ value, onChange }: TacticBoardEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [editorMode, setEditorMode] = useState<'SKETCH' | 'ANIMATION'>('SKETCH');
  const [activeKeyframeIdx, setActiveKeyframeIdx] = useState(0);
  const [showAnimPreview, setShowAnimPreview] = useState(false);
  const [webmExporting, setWebmExporting] = useState(false);

  const [activeTool, setActiveTool] = useState<EditorTool>('SELECT_MOVE');
  const [parallelDrawMode, setParallelDrawMode] = useState(false);
  const [stepInputDraft, setStepInputDraft] = useState('1');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingZoneId, setDraggingZoneId] = useState<string | null>(null);
  const [draggingControlPathId, setDraggingControlPathId] = useState<string | null>(null);
  const [rotatingNodeId, setRotatingNodeId] = useState<string | null>(null);

  // Undo / Redo History (>= 30 steps)
  const historyRef = useRef<TacticBoardData[]>([]);
  const redoRef = useRef<TacticBoardData[]>([]);
  const [, setHistoryVersion] = useState(0);

  function commitChange(next: TacticBoardData, recordHistory = true) {
    if (recordHistory) {
      historyRef.current = [...historyRef.current.slice(-39), value];
      redoRef.current = [];
      setHistoryVersion((v) => v + 1);
    }
    onChange(next);
  }

  function handleUndo() {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-39), value];
    setHistoryVersion((v) => v + 1);
    onChange(prev);
  }

  function handleRedo() {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-39), value];
    setHistoryVersion((v) => v + 1);
    onChange(next);
  }

  // Active path drawing state
  const [drawingStart, setDrawingStart] = useState<{
    x: number;
    y: number;
    fromNodeId?: string;
    fromWaypointId?: string;
  } | null>(null);
  const [drawingCurrent, setDrawingCurrent] = useState<{ x: number; y: number } | null>(null);

  const width = 500;
  const height = 350;
  const template = value.courtTemplate ?? 'HALF_COURT_VERTICAL';
  const keyframes = value.keyframes ?? [];
  const safeKeyframeIdx = Math.min(activeKeyframeIdx, Math.max(0, keyframes.length - 1));
  const activeKeyframe = editorMode === 'ANIMATION' ? keyframes[safeKeyframeIdx] : undefined;
  const prevKeyframe =
    editorMode === 'ANIMATION' && safeKeyframeIdx > 0 ? keyframes[safeKeyframeIdx - 1] : undefined;

  // Effective nodes for current mode (Sketch uses value.nodes, Animation uses activeKeyframe.nodeStates)
  const displayNodes: TacticNode[] = activeKeyframe
    ? value.nodes.map((n) => {
        const st = activeKeyframe.nodeStates[n.id];
        if (!st) return n;
        return {
          ...n,
          x: st.x,
          y: st.y,
          hasBall: st.hasBall ?? n.hasBall,
          rotation: st.rotation ?? n.rotation
        };
      })
    : value.nodes;

  const selectedNode = displayNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedPath = value.paths.find((p) => p.id === selectedPathId) ?? null;
  const selectedZone = (value.zones ?? []).find((z) => z.id === selectedZoneId) ?? null;
  const numberingHasGaps = hasPathNumberingGaps(value.paths);

  useEffect(() => {
    if (selectedPath) {
      setStepInputDraft(String(selectedPath.stepNumber ?? 1));
    }
  }, [selectedPath?.id, selectedPath?.stepNumber]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedPathId(null);
        setSelectedZoneId(null);
        setActiveTool('SELECT_MOVE');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId && editorMode === 'SKETCH') {
          e.preventDefault();
          handleDeleteSelectedNode();
        } else if (selectedPathId && editorMode === 'SKETCH') {
          e.preventDefault();
          handleDeleteSelectedPath();
        } else if (selectedZoneId && editorMode === 'SKETCH') {
          e.preventDefault();
          handleDeleteSelectedZone();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  function getNormalizedCoords(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0.5, y: 0.5 };
    const rect = svg.getBoundingClientRect();
    const x = Math.min(0.96, Math.max(0.04, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.96, Math.max(0.04, (e.clientY - rect.top) / rect.height));
    return {
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000
    };
  }

  function findNearestSnapNode(x: number, y: number, maxDist = 0.065): TacticNode | undefined {
    let best: TacticNode | undefined;
    let bestDist = maxDist;
    for (const node of displayNodes) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best;
  }

  function findNearestZone(x: number, y: number): TacticZone | undefined {
    const zones = value.zones ?? [];
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (
        Math.abs(x - z.x) <= z.width / 2 &&
        Math.abs(y - z.y) <= z.height / 2
      ) {
        return z;
      }
    }
    return undefined;
  }

  function findNearestPath(x: number, y: number, maxDist = 0.045): TacticPath | undefined {
    let best: TacticPath | undefined;
    let bestDist = maxDist;
    for (const path of value.paths) {
      if (path.points.length < 2) continue;
      // Check step badge position first
      const first = path.points[0];
      const last = path.points[path.points.length - 1];
      const mid =
        path.controlPoint && path.points.length === 2
          ? evalQuadraticBezier(first, path.controlPoint, last, 0.5)
          : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      const badgeX = mid.x;
      const badgeY = mid.y - 9 / height;
      const badgeDist = Math.hypot(x - badgeX, y - badgeY);
      if (badgeDist <= bestDist) {
        bestDist = badgeDist;
        best = path;
      }

      if (path.controlPoint && path.points.length === 2) {
        const bezDist = distancePointToQuadraticBezier(x, y, first, path.controlPoint, last);
        if (bezDist <= bestDist) {
          bestDist = bezDist;
          best = path;
        }
      } else {
        for (let i = 0; i < path.points.length - 1; i++) {
          const a = path.points[i];
          const b = path.points[i + 1];
          const segDist = distancePointToSegment(x, y, a.x, a.y, b.x, b.y);
          if (segDist <= bestDist) {
            bestDist = segDist;
            best = path;
          }
        }
      }
    }
    return best;
  }

  function isPathTool(tool: EditorTool): boolean {
    return tool.startsWith('DRAW_');
  }

  function mapToolToPathType(tool: EditorTool): TacticPathType {
    switch (tool) {
      case 'DRAW_PASS':
        return 'PASS_PATH';
      case 'DRAW_DRIBBLE':
        return 'DRIBBLE_PATH';
      case 'DRAW_SHOT':
        return 'SHOT_PATH';
      case 'DRAW_SCREEN':
        return 'SCREEN_BLOCK_PATH';
      case 'DRAW_FEINT':
        return 'FEINT_PATH';
      case 'DRAW_RUN':
      default:
        return 'RUN_PATH';
    }
  }

  function isRotatableNode(node: TacticNode): boolean {
    return node.type === 'OFFENSE_PLAYER' || node.type === 'DEFENSE_PLAYER';
  }

  function getRotationHandleCoords(node: TacticNode): { hx: number; hy: number } {
    const rotRad = (getDefaultNodeRotation(node) * Math.PI) / 180;
    return {
      hx: node.x * width + Math.sin(rotRad) * 32,
      hy: node.y * height - Math.cos(rotRad) * 32
    };
  }

  function computeAngleFromNodeToCoords(
    node: TacticNode,
    coords: { x: number; y: number }
  ): number {
    const dx = (coords.x - node.x) * width;
    const dy = (coords.y - node.y) * height;
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return (Math.round(deg / 5) * 5) % 360;
  }

  function pushHistorySnapshot() {
    historyRef.current = [...historyRef.current.slice(-39), value];
    redoRef.current = [];
    setHistoryVersion((v) => v + 1);
  }

  function getCurveHandleCoords(path: TacticPath): { cx: number; cy: number } | null {
    if (path.points.length !== 2) return null;
    const first = path.points[0];
    const last = path.points[1];
    const cp = path.controlPoint ?? {
      x: (first.x + last.x) / 2,
      y: (first.y + last.y) / 2
    };
    return { cx: cp.x * width, cy: cp.y * height };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const coords = getNormalizedCoords(e);

    if (activeTool === 'SELECT_MOVE') {
      // Check curve control handle of currently selected path first (in Sketch mode)
      if (editorMode === 'SKETCH' && selectedPath && selectedPath.points.length === 2) {
        const handle = getCurveHandleCoords(selectedPath);
        if (handle) {
          const px = coords.x * width;
          const py = coords.y * height;
          if (Math.hypot(px - handle.cx, py - handle.cy) <= 13) {
            pushHistorySnapshot();
            setDraggingControlPathId(selectedPath.id);
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      // Check rotation handle of currently selected player
      if (selectedNode && isRotatableNode(selectedNode)) {
        const { hx, hy } = getRotationHandleCoords(selectedNode);
        const px = coords.x * width;
        const py = coords.y * height;
        if (Math.hypot(px - hx, py - hy) <= 13) {
          pushHistorySnapshot();
          setRotatingNodeId(selectedNode.id);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }

      const hitNode = findNearestSnapNode(coords.x, coords.y, 0.055);
      if (hitNode) {
        pushHistorySnapshot();
        setSelectedNodeId(hitNode.id);
        setSelectedPathId(null);
        setSelectedZoneId(null);
        setDraggingNodeId(hitNode.id);
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (editorMode === 'SKETCH') {
        const hitPath = findNearestPath(coords.x, coords.y, 0.045);
        if (hitPath) {
          setSelectedNodeId(null);
          setSelectedPathId(hitPath.id);
          setSelectedZoneId(null);
        } else {
          const hitZone = findNearestZone(coords.x, coords.y);
          setSelectedNodeId(null);
          setSelectedPathId(null);
          setSelectedZoneId(hitZone ? hitZone.id : null);
          if (hitZone) {
            pushHistorySnapshot();
            setDraggingZoneId(hitZone.id);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }
      } else {
        setSelectedNodeId(null);
        setSelectedPathId(null);
        setSelectedZoneId(null);
      }
      return;
    }

    if (activeTool === 'ROTATE') {
      const hitNode = findNearestSnapNode(coords.x, coords.y, 0.075);
      if (hitNode && isRotatableNode(hitNode)) {
        pushHistorySnapshot();
        setSelectedNodeId(hitNode.id);
        setSelectedPathId(null);
        setSelectedZoneId(null);
        setRotatingNodeId(hitNode.id);
        e.currentTarget.setPointerCapture(e.pointerId);

        const distPx = Math.hypot((coords.x - hitNode.x) * width, (coords.y - hitNode.y) * height);
        const nextRotation =
          distPx < 8
            ? (getDefaultNodeRotation(hitNode) + 45) % 360
            : computeAngleFromNodeToCoords(hitNode, coords);

        if (activeKeyframe) {
          updateActiveKeyframeNodeState(hitNode.id, { rotation: nextRotation }, false);
        } else {
          onChange({
            ...value,
            nodes: value.nodes.map((n) =>
              n.id === hitNode.id ? { ...n, rotation: nextRotation } : n
            )
          });
        }
      }
      return;
    }

    if (editorMode === 'SKETCH' && (activeTool === 'STAMP_ZONE_RECT' || activeTool === 'STAMP_ZONE_ELLIPSE')) {
      const zone: TacticZone = {
        id: `zone-${crypto.randomUUID().slice(0, 6)}`,
        shape: activeTool === 'STAMP_ZONE_ELLIPSE' ? 'ELLIPSE' : 'RECT',
        x: coords.x,
        y: coords.y,
        width: 0.22,
        height: 0.16,
        color: '#22c55e',
        opacity: 0.22,
        label: 'Zielzone'
      };
      commitChange({
        ...value,
        version: Math.max(value.version, 2),
        zones: [...(value.zones ?? []), zone]
      });
      setSelectedZoneId(zone.id);
      setSelectedNodeId(null);
      setSelectedPathId(null);
      setActiveTool('SELECT_MOVE');
      return;
    }

    if (editorMode === 'SKETCH' && isPathTool(activeTool)) {
      const snapStart = findNearestSnapNode(coords.x, coords.y, 0.07);
      const startX = snapStart ? snapStart.x : coords.x;
      const startY = snapStart ? snapStart.y : coords.y;

      setDrawingStart({
        x: startX,
        y: startY,
        fromNodeId: snapStart && snapStart.type !== 'WAYPOINT' ? snapStart.id : undefined,
        fromWaypointId: snapStart && snapStart.type === 'WAYPOINT' ? snapStart.id : undefined
      });
      setDrawingCurrent({ x: startX, y: startY });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (editorMode !== 'SKETCH') return;

    // Stamp Mode: Place player or equipment with 1 click/tap!
    const id = `node-${crypto.randomUUID().slice(0, 6)}`;
    let newNode: TacticNode | null = null;

    if (activeTool === 'STAMP_OFFENSE') {
      const offCount = value.nodes.filter((n) => n.type === 'OFFENSE_PLAYER').length;
      const label = OFFENSE_LABELS[offCount % OFFENSE_LABELS.length];
      newNode = {
        id,
        type: 'OFFENSE_PLAYER',
        label,
        x: coords.x,
        y: coords.y,
        hasBall: offCount === 0,
        rotation: 0
      };
    } else if (activeTool === 'STAMP_DEFENSE') {
      const defCount = value.nodes.filter((n) => n.type === 'DEFENSE_PLAYER').length;
      const label = DEFENSE_LABELS[defCount % DEFENSE_LABELS.length];
      newNode = {
        id,
        type: 'DEFENSE_PLAYER',
        label,
        x: coords.x,
        y: coords.y,
        rotation: 180
      };
    } else if (activeTool === 'STAMP_GK') {
      newNode = {
        id,
        type: 'GOALKEEPER',
        label: 'TW',
        x: coords.x,
        y: coords.y,
        color: '#10b981'
      };
    } else if (activeTool === 'STAMP_COACH') {
      newNode = {
        id,
        type: 'COACH_FEEDER',
        label: 'T',
        x: coords.x,
        y: coords.y,
        color: '#8b5cf6',
        hasBall: true
      };
    } else if (activeTool === 'STAMP_CONE') {
      newNode = {
        id,
        type: 'EQUIPMENT_CONE',
        x: coords.x,
        y: coords.y,
        color: '#facc15'
      };
    } else if (activeTool === 'STAMP_MAT') {
      newNode = {
        id,
        type: 'EQUIPMENT_MAT',
        x: coords.x,
        y: coords.y
      };
    } else if (activeTool === 'STAMP_TARGET') {
      newNode = {
        id,
        type: 'EQUIPMENT_GOAL_TARGET',
        x: coords.x,
        y: coords.y
      };
    }

    if (newNode) {
      commitChange({
        ...value,
        nodes: [...value.nodes, newNode]
      });
      setSelectedNodeId(newNode.id);
    }
  }

  function updateActiveKeyframeNodeState(
    nodeId: string,
    patch: Partial<{ x: number; y: number; hasBall: boolean; rotation: number; visible: boolean }>,
    recordHistory = true
  ) {
    if (!activeKeyframe) return;
    const baseNode = value.nodes.find((n) => n.id === nodeId);
    const currentNs = activeKeyframe.nodeStates[nodeId] ?? {
      x: baseNode?.x ?? 0.5,
      y: baseNode?.y ?? 0.5,
      hasBall: Boolean(baseNode?.hasBall),
      rotation: baseNode?.rotation,
      visible: true
    };
    const nextKeyframes = keyframes.map((kf, idx) =>
      idx === safeKeyframeIdx
        ? {
            ...kf,
            nodeStates: {
              ...kf.nodeStates,
              [nodeId]: { ...currentNs, ...patch }
            }
          }
        : kf
    );
    commitChange(
      {
        ...value,
        version: Math.max(value.version, 2),
        keyframes: nextKeyframes
      },
      recordHistory
    );
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (draggingControlPathId) {
      const coords = getNormalizedCoords(e);
      onChange({
        ...value,
        version: Math.max(value.version, 2),
        paths: value.paths.map((p) =>
          p.id === draggingControlPathId
            ? { ...p, controlPoint: { x: coords.x, y: coords.y }, curved: true }
            : p
        )
      });
      return;
    }

    if (draggingZoneId) {
      const coords = getNormalizedCoords(e);
      onChange({
        ...value,
        zones: (value.zones ?? []).map((z) =>
          z.id === draggingZoneId ? { ...z, x: coords.x, y: coords.y } : z
        )
      });
      return;
    }

    if (rotatingNodeId) {
      const targetNode = displayNodes.find((n) => n.id === rotatingNodeId);
      if (!targetNode) return;
      const coords = getNormalizedCoords(e);
      const distPx = Math.hypot(
        (coords.x - targetNode.x) * width,
        (coords.y - targetNode.y) * height
      );
      if (distPx >= 8) {
        const nextRotation = computeAngleFromNodeToCoords(targetNode, coords);
        if (activeKeyframe) {
          updateActiveKeyframeNodeState(rotatingNodeId, { rotation: nextRotation }, false);
        } else {
          onChange({
            ...value,
            nodes: value.nodes.map((n) =>
              n.id === rotatingNodeId ? { ...n, rotation: nextRotation } : n
            )
          });
        }
      }
      return;
    }

    if (draggingNodeId && activeTool === 'SELECT_MOVE') {
      const coords = getNormalizedCoords(e);
      if (activeKeyframe) {
        updateActiveKeyframeNodeState(draggingNodeId, { x: coords.x, y: coords.y }, false);
        return;
      }

      const nextNodes = value.nodes.map((n) =>
        n.id === draggingNodeId ? { ...n, x: coords.x, y: coords.y } : n
      );

      // Magnetic snapping: update connected path start/end points in real time!
      const nextPaths = value.paths.map((path) => {
        const pts = [...path.points];
        if (
          (path.fromNodeId === draggingNodeId || path.fromWaypointId === draggingNodeId) &&
          pts.length >= 1
        ) {
          pts[0] = { x: coords.x, y: coords.y };
        }
        if (
          (path.toNodeId === draggingNodeId || path.toWaypointId === draggingNodeId) &&
          pts.length >= 2
        ) {
          pts[pts.length - 1] = { x: coords.x, y: coords.y };
        }
        return { ...path, points: pts };
      });

      onChange({
        ...value,
        nodes: nextNodes,
        paths: nextPaths
      });
      return;
    }

    if (drawingStart && isPathTool(activeTool)) {
      const coords = getNormalizedCoords(e);
      setDrawingCurrent(coords);
    }
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (draggingControlPathId) {
      setDraggingControlPathId(null);
      return;
    }

    if (draggingZoneId) {
      setDraggingZoneId(null);
      return;
    }

    if (rotatingNodeId) {
      setRotatingNodeId(null);
      return;
    }

    if (draggingNodeId) {
      setDraggingNodeId(null);
      return;
    }

    if (drawingStart && drawingCurrent && isPathTool(activeTool)) {
      const endCoords = getNormalizedCoords(e);
      const dist = Math.hypot(endCoords.x - drawingStart.x, endCoords.y - drawingStart.y);

      if (dist > 0.03) {
        const pathType = mapToolToPathType(activeTool);
        const snapEnd = findNearestSnapNode(endCoords.x, endCoords.y, 0.065);
        const finalEndX = snapEnd ? snapEnd.x : endCoords.x;
        const finalEndY = snapEnd ? snapEnd.y : endCoords.y;

        let toNodeId: string | undefined;
        let toWaypointId: string | undefined;
        const nextNodes = [...value.nodes];

        if (snapEnd) {
          if (snapEnd.type === 'WAYPOINT') {
            toWaypointId = snapEnd.id;
          } else {
            toNodeId = snapEnd.id;
          }
        } else if (
          pathType === 'RUN_PATH' ||
          pathType === 'DRIBBLE_PATH' ||
          pathType === 'FEINT_PATH'
        ) {
          // Automatically place a chainable WAYPOINT at the end of a run/dribble path
          const wpId = `wp-${crypto.randomUUID().slice(0, 6)}`;
          toWaypointId = wpId;
          nextNodes.push({
            id: wpId,
            type: 'WAYPOINT',
            x: finalEndX,
            y: finalEndY
          });
        }

        const lastStep =
          value.paths.length > 0
            ? value.paths[value.paths.length - 1].stepNumber ?? value.paths.length
            : 1;
        const maxStep = value.paths.reduce((m, p) => Math.max(m, p.stepNumber ?? 0), 0);
        const nextStepNumber =
          parallelDrawMode && value.paths.length > 0 ? lastStep : maxStep + 1;

        const newPath: TacticPath = {
          id: `path-${crypto.randomUUID().slice(0, 6)}`,
          type: pathType,
          stepNumber: nextStepNumber,
          fromNodeId: drawingStart.fromNodeId,
          fromWaypointId: drawingStart.fromWaypointId,
          toNodeId,
          toWaypointId,
          points: [
            { x: drawingStart.x, y: drawingStart.y },
            { x: finalEndX, y: finalEndY }
          ]
        };

        commitChange({
          ...value,
          nodes: nextNodes,
          paths: [...value.paths, newPath]
        });
      }

      setDrawingStart(null);
      setDrawingCurrent(null);
    }
  }

  function handleApplyPreset(presetId: string) {
    if (!presetId) return;
    const presetData = buildTacticBoardPreset(presetId, template);
    commitChange(presetData);
    setSelectedNodeId(null);
    setSelectedPathId(null);
    setSelectedZoneId(null);
    setActiveKeyframeIdx(0);
  }

  function handleUpdateSelectedNode(patch: Partial<TacticNode>) {
    if (!selectedNodeId) return;
    if (activeKeyframe) {
      updateActiveKeyframeNodeState(selectedNodeId, {
        x: patch.x,
        y: patch.y,
        hasBall: patch.hasBall,
        rotation: patch.rotation
      });
      return;
    }
    commitChange({
      ...value,
      nodes: value.nodes.map((n) => (n.id === selectedNodeId ? { ...n, ...patch } : n))
    });
  }

  function handleDeleteSelectedNode() {
    if (!selectedNodeId) return;
    const remainingPaths = value.paths.filter(
      (p) =>
        p.fromNodeId !== selectedNodeId &&
        p.toNodeId !== selectedNodeId &&
        p.fromWaypointId !== selectedNodeId &&
        p.toWaypointId !== selectedNodeId
    );
    commitChange({
      ...value,
      nodes: value.nodes.filter((n) => n.id !== selectedNodeId),
      paths: renumberTacticPaths(remainingPaths)
    });
    setSelectedNodeId(null);
  }

  function handleUpdateSelectedPath(patch: Partial<TacticPath>) {
    if (!selectedPathId) return;
    commitChange({
      ...value,
      paths: value.paths.map((p) => (p.id === selectedPathId ? { ...p, ...patch } : p))
    });
  }

  function handleToggleCurveOnSelectedPath() {
    if (!selectedPath || selectedPath.points.length !== 2) return;
    if (selectedPath.controlPoint) {
      handleUpdateSelectedPath({ controlPoint: undefined, curved: false });
    } else {
      const p0 = selectedPath.points[0];
      const p1 = selectedPath.points[1];
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      handleUpdateSelectedPath({
        controlPoint: {
          x: Math.min(0.96, Math.max(0.04, Math.round((mx - dy * 0.25) * 1000) / 1000)),
          y: Math.min(0.96, Math.max(0.04, Math.round((my + dx * 0.25) * 1000) / 1000))
        },
        curved: true
      });
    }
  }

  function handleSetSelectedPathStep(nextStep: number) {
    if (!selectedPathId || Number.isNaN(nextStep)) return;
    commitChange({
      ...value,
      paths: setTacticPathStepNumber(value.paths, selectedPathId, nextStep)
    });
  }

  function handleMovePathOrder(pathId: string, direction: 'EARLIER' | 'LATER') {
    commitChange({
      ...value,
      paths: moveTacticPathOrder(value.paths, pathId, direction)
    });
  }

  function handleRenumberAllPaths() {
    commitChange({
      ...value,
      paths: renumberTacticPaths(value.paths)
    });
  }

  function handleDeleteSelectedPath() {
    if (!selectedPathId) return;
    commitChange(deleteTacticPath(value, selectedPathId, true));
    setSelectedPathId(null);
  }

  function handleUpdateSelectedZone(patch: Partial<TacticZone>) {
    if (!selectedZoneId) return;
    commitChange({
      ...value,
      zones: (value.zones ?? []).map((z) => (z.id === selectedZoneId ? { ...z, ...patch } : z))
    });
  }

  function handleDeleteSelectedZone() {
    if (!selectedZoneId) return;
    commitChange({
      ...value,
      zones: (value.zones ?? []).filter((z) => z.id !== selectedZoneId)
    });
    setSelectedZoneId(null);
  }

  function handleMirrorHorizontal() {
    commitChange(mirrorTacticBoardHorizontal(value));
  }

  function handleGenerateAnimation() {
    const next = generateKeyframesFromPaths(value);
    commitChange(next);
    setEditorMode('ANIMATION');
    setActiveKeyframeIdx(0);
    setSelectedNodeId(null);
    setSelectedPathId(null);
    setSelectedZoneId(null);
  }

  function handleAddKeyframe() {
    const prev = keyframes[keyframes.length - 1];
    const nextKf = createKeyframeFromBoardOrPrevious(value, keyframes.length, prev);
    const nextKeyframes = [...keyframes, nextKf];
    commitChange({
      ...value,
      version: 2,
      keyframes: nextKeyframes,
      animationSettings: value.animationSettings ?? {
        defaultSpeed: 1,
        loop: true,
        showTrails: true,
        showPathsDuringPlay: true
      }
    });
    setActiveKeyframeIdx(nextKeyframes.length - 1);
  }

  function handleDuplicateKeyframe(idx: number) {
    const source = keyframes[idx];
    if (!source) return;
    const copy = createKeyframeFromBoardOrPrevious(
      value,
      keyframes.length,
      source,
      `${source.label ?? `Szene ${idx + 1}`} (Kopie)`
    );
    copy.durationMs = source.durationMs;
    const nextKeyframes = [
      ...keyframes.slice(0, idx + 1),
      copy,
      ...keyframes.slice(idx + 1)
    ].map((kf, i) => ({ ...kf, index: i }));
    commitChange({
      ...value,
      version: 2,
      keyframes: nextKeyframes
    });
    setActiveKeyframeIdx(idx + 1);
  }

  function handleDeleteKeyframe(idx: number) {
    if (keyframes.length <= 1) return;
    const nextKeyframes = keyframes
      .filter((_, i) => i !== idx)
      .map((kf, i) => ({ ...kf, index: i }));
    commitChange({
      ...value,
      keyframes: nextKeyframes
    });
    setActiveKeyframeIdx(Math.max(0, Math.min(idx, nextKeyframes.length - 1)));
  }

  function handleUpdateActiveKeyframe(patch: Partial<{ label: string; durationMs: number }>) {
    if (!activeKeyframe) return;
    commitChange({
      ...value,
      keyframes: keyframes.map((kf, i) => (i === safeKeyframeIdx ? { ...kf, ...patch } : kf))
    });
  }

  async function handleExportWebm() {
    if (webmExporting) return;
    setWebmExporting(true);
    try {
      await exportTacticAnimationWebm(value, 'taktik-animation.webm');
    } finally {
      setWebmExporting(false);
    }
  }

  function handleUndoLastPath() {
    if (value.paths.length === 0) return;
    const lastPath = value.paths[value.paths.length - 1];
    const nextBoard = deleteTacticPath(value, lastPath.id, true);
    if (selectedPathId === lastPath.id) {
      setSelectedPathId(null);
    }
    commitChange(nextBoard);
  }

  function handleClearBoard() {
    commitChange({
      version: 1,
      courtTemplate: template,
      nodes: [],
      paths: [],
      zones: [],
      keyframes: undefined
    });
    setSelectedNodeId(null);
    setSelectedPathId(null);
    setSelectedZoneId(null);
    setActiveKeyframeIdx(0);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
      {/* Top Bar: Modus, Spielfeld-Vorlage, Presets, Undo/Redo, Spiegeln & Export */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Modus-Umschalter: Skizze | Animation */}
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => {
                setEditorMode('SKETCH');
                setShowAnimPreview(false);
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                editorMode === 'SKETCH'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              Skizze
            </button>
            <button
              type="button"
              onClick={() => {
                setEditorMode('ANIMATION');
                setActiveTool('SELECT_MOVE');
                setSelectedPathId(null);
                setSelectedZoneId(null);
                if (!value.keyframes || value.keyframes.length === 0) {
                  handleGenerateAnimation();
                }
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                editorMode === 'ANIMATION'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              Animation ({keyframes.length})
            </button>
          </div>

          <select
            value={template}
            onChange={(e) =>
              commitChange({ ...value, courtTemplate: e.target.value as CourtTemplate })
            }
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
          >
            <option value="HALF_COURT_VERTICAL">Spielfeld: Halbfeld (Standard)</option>
            <option value="GOAL_SECTOR_ZOOM">Spielfeld: Torraum- & 9m-Zoom</option>
            <option value="FULL_COURT">Spielfeld: Ganzfeld (Tempospiel)</option>
            <option value="FREE_SPACE">Spielfeld: Freifläche (Koordination)</option>
          </select>

          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <select
              value=""
              onChange={(e) => handleApplyPreset(e.target.value)}
              className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-2.5 py-1.5 text-xs font-semibold text-amber-200"
            >
              <option value="">⚡ 1-Klick Preset...</option>
              {TACTIC_PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyRef.current.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            title="Rückgängig (Strg+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoRef.current.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            title="Wiederholen (Strg+Y)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleMirrorHorizontal}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-2.5 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
            title="Spielfeld horizontal spiegeln (inkl. LA↔RA, RL↔RR Tausch)"
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            Spiegeln
          </button>

          <button
            type="button"
            onClick={() => svgRef.current && void downloadPngFromSvg(svgRef.current)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
            title="Als PNG herunterladen"
          >
            <Download className="h-3 w-3" />
            PNG
          </button>
          <button
            type="button"
            onClick={() => svgRef.current && downloadSvgElement(svgRef.current)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
            title="Als SVG herunterladen"
          >
            SVG
          </button>
          {keyframes.length > 1 && (
            <button
              type="button"
              onClick={() => void handleExportWebm()}
              disabled={webmExporting}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-2 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50"
              title="Animation als WebM-Video exportieren"
            >
              {webmExporting ? 'Export...' : 'WebM'}
            </button>
          )}

          <button
            type="button"
            onClick={handleUndoLastPath}
            disabled={value.paths.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            title="Letzten Pfeil rückgängig machen"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClearBoard}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-950/60 border border-rose-700/40 px-2 py-1.5 text-xs text-rose-300 hover:bg-rose-900/60"
            title="Taktikboard leeren"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Werkzeugleiste (Skizzen-Modus) ODER Animations-Timeline */}
      {editorMode === 'SKETCH' ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTool('SELECT_MOVE')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'SELECT_MOVE'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <MousePointer className="h-3.5 w-3.5" />
            Bewegen / Auswählen
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('ROTATE')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'ROTATE'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-800 text-cyan-300 hover:bg-slate-700'
            }`}
            title="Angreifer oder Verteidiger in Blickrichtung drehen"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Drehen
          </button>

          {/* Stempel-Werkzeuge */}
          <button
            type="button"
            onClick={() => setActiveTool('STAMP_OFFENSE')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_OFFENSE'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-blue-300 hover:bg-slate-700'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            + Angreifer
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_DEFENSE')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_DEFENSE'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            + Abwehr
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_GK')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_GK'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
            }`}
          >
            + TW
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_COACH')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_COACH'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-purple-300 hover:bg-slate-700'
            }`}
          >
            + Trainer (T)
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_CONE')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_CONE'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
            }`}
          >
            ▲ Hütchen
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_MAT')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_MAT'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-sky-300 hover:bg-slate-700'
            }`}
          >
            ▬ Matte
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_ZONE_RECT')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_ZONE_RECT'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
            }`}
            title="Rechteck-Zone (Zielraum / Sperrzone) setzen"
          >
            <Square className="h-3.5 w-3.5" />
            + Zone
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('STAMP_ZONE_ELLIPSE')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'STAMP_ZONE_ELLIPSE'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
            }`}
            title="Ellipsen-Zone setzen"
          >
            ◯ Ellipse
          </button>

          {/* Handball-Pfeile */}
          <button
            type="button"
            onClick={() => setActiveTool('DRAW_RUN')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'DRAW_RUN'
                ? 'bg-white text-slate-950'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            → Laufweg
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('DRAW_PASS')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'DRAW_PASS'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-sky-300 hover:bg-slate-700'
            }`}
          >
            - - ► Passweg
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('DRAW_DRIBBLE')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'DRAW_DRIBBLE'
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-800 text-indigo-300 hover:bg-slate-700'
            }`}
          >
            ~~~► Prellen
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('DRAW_SHOT')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'DRAW_SHOT'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
            }`}
          >
            ══► Torwurf
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('DRAW_SCREEN')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTool === 'DRAW_SCREEN'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-amber-200 hover:bg-slate-700'
            }`}
          >
            ──┤ Sperre
          </button>

          <button
            type="button"
            onClick={() => setParallelDrawMode((p) => !p)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
              parallelDrawMode
                ? 'border-amber-400 bg-amber-500 text-slate-950 shadow'
                : 'border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700'
            }`}
            title="Wenn aktiv, erhalten neu gezeichnete Pfeile dieselbe Schrittnummer wie der vorherige Pfeil (für gleichzeitige Aktionen)"
          >
            ⚡ Gleichzeitig (gleiche Nr.)
          </button>
        </div>
      ) : (
        <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateAnimation}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Animation aus Schritten erzeugen
              </button>
              <button
                type="button"
                onClick={handleAddKeyframe}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Szene
              </button>
              <button
                type="button"
                onClick={() => setShowAnimPreview((p) => !p)}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold ${
                  showAnimPreview
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
                }`}
              >
                <Play className="h-3.5 w-3.5" />
                {showAnimPreview ? 'Editor anzeigen' : '60-FPS Vorschau abspielen'}
              </button>
            </div>

            {activeKeyframe && (
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="text"
                  value={activeKeyframe.label ?? ''}
                  onChange={(e) => handleUpdateActiveKeyframe({ label: e.target.value })}
                  placeholder={`Szene ${safeKeyframeIdx + 1}`}
                  className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                />
                <input
                  type="number"
                  min={200}
                  max={5000}
                  step={100}
                  value={activeKeyframe.durationMs}
                  onChange={(e) =>
                    handleUpdateActiveKeyframe({ durationMs: Number(e.target.value) || 1400 })
                  }
                  className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-center text-white"
                />
                <span className="text-slate-400">ms</span>
              </div>
            )}
          </div>

          {/* Horizontale Timeline-Karten */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {keyframes.map((kf, idx) => {
              const isSelected = idx === safeKeyframeIdx;
              return (
                <div
                  key={kf.id}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition ${
                    isSelected
                      ? 'border-emerald-400 bg-emerald-950/70 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowAnimPreview(false);
                      setActiveKeyframeIdx(idx);
                    }}
                    className="text-left font-semibold"
                  >
                    <span className="mr-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px]">
                      {idx + 1}
                    </span>
                    {kf.label || `Szene ${idx + 1}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateKeyframe(idx)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                    title="Szene duplizieren"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {keyframes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteKeyframe(idx)}
                      className="rounded p-1 text-rose-400 hover:bg-rose-950"
                      title="Szene löschen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editorMode === 'ANIMATION' && showAnimPreview ? (
        <TacticBoardPreview data={value} />
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="h-auto w-full touch-none select-none cursor-crosshair"
        >
          <defs>
            <marker id="ed-arrow-white" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="#f8fafc" />
            </marker>
            <marker id="ed-arrow-blue" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="#60a5fa" />
            </marker>
            <marker id="ed-arrow-amber" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="#f59e0b" />
            </marker>
            <marker id="ed-screen-t" markerWidth="8" markerHeight="10" refX="4" refY="5" orient="auto">
              <line x1="4" y1="0" x2="4" y2="10" stroke="#f59e0b" strokeWidth="3" />
            </marker>
          </defs>

          {/* Court Background */}
          <rect x="0" y="0" width={width} height={height} fill="#0f2942" />
          <rect x="20" y="15" width={width - 40} height={height - 30} fill="#163b5c" stroke="#93c5fd" strokeWidth="2" />

          {template === 'HALF_COURT_VERTICAL' && (
            <>
              <path
                d="M 130 15 A 120 70 0 0 0 370 15 Z"
                fill="#1d4ed8"
                fillOpacity="0.45"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <path
                d="M 65 15 A 185 120 0 0 0 435 15"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="2"
                strokeDasharray="9 7"
              />
              <line x1="240" y1="57.5" x2="260" y2="57.5" stroke="#ffffff" strokeWidth="2" />
              <line x1="235" y1="100" x2="265" y2="100" stroke="#ffffff" strokeWidth="2.5" />
              <rect x="212.5" y="5" width="75" height="12" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
            </>
          )}

          {template === 'GOAL_SECTOR_ZOOM' && (
            <>
              <path
                d="M 65 15 A 185 130 0 0 0 435 15 Z"
                fill="#1d4ed8"
                fillOpacity="0.45"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <path
                d="M 20 15 A 230 207.5 0 0 0 480 15"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="2"
                strokeDasharray="9 7"
              />
              <line x1="235" y1="82.5" x2="265" y2="82.5" stroke="#ffffff" strokeWidth="2" />
              <line x1="230" y1="170" x2="270" y2="170" stroke="#ffffff" strokeWidth="2.5" />
              <rect x="194" y="4" width="112" height="13" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
            </>
          )}

          {template === 'FULL_COURT' && (
            <>
              <path
                d="M 20 90 A 65 85 0 0 1 20 260 Z"
                fill="#1d4ed8"
                fillOpacity="0.45"
                stroke="#ffffff"
                strokeWidth="2"
              />
              <path
                d="M 20 52.5 A 100 122.5 0 0 1 20 297.5"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="1.5"
                strokeDasharray="7.5 5"
              />
              <line x1="50" y1="166" x2="50" y2="184" stroke="#ffffff" strokeWidth="1.5" />
              <line x1="95" y1="164" x2="95" y2="186" stroke="#ffffff" strokeWidth="2" />
              <rect x="5" y="145" width="15" height="60" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />

              <line x1={width / 2} y1="15" x2={width / 2} y2={height - 15} stroke="#ffffff" strokeWidth="2" />
              <circle cx={width / 2} cy={height / 2} r="22.5" fill="none" stroke="#93c5fd" strokeWidth="1.5" />

              <path
                d="M 480 90 A 65 85 0 0 0 480 260 Z"
                fill="#1d4ed8"
                fillOpacity="0.45"
                stroke="#ffffff"
                strokeWidth="2"
              />
              <path
                d="M 480 52.5 A 100 122.5 0 0 0 480 297.5"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="1.5"
                strokeDasharray="7.5 5"
              />
              <line x1="450" y1="166" x2="450" y2="184" stroke="#ffffff" strokeWidth="1.5" />
              <line x1="405" y1="164" x2="405" y2="186" stroke="#ffffff" strokeWidth="2" />
              <rect x="480" y="145" width="15" height="60" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
            </>
          )}

          {template === 'HALF_COURT_HORIZONTAL' && (
            <>
              <path
                d="M 480 55 A 110 120 0 0 0 480 295 Z"
                fill="#1d4ed8"
                fillOpacity="0.45"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <path
                d="M 480 15 A 180 160 0 0 0 480 335"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="2"
                strokeDasharray="9 7"
              />
              <line x1="420" y1="165" x2="420" y2="185" stroke="#ffffff" strokeWidth="2" />
              <line x1="352.5" y1="160" x2="352.5" y2="190" stroke="#ffffff" strokeWidth="2.5" />
              <rect x="480" y="137.5" width="15" height="75" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
            </>
          )}

          {/* Zones */}
          {(value.zones ?? []).map((zone) => {
            const zx = zone.x * width;
            const zy = zone.y * height;
            const zw = zone.width * width;
            const zh = zone.height * height;
            const op = zone.opacity ?? 0.22;
            const isSelZone = zone.id === selectedZoneId;
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
                    stroke={isSelZone ? '#38bdf8' : zone.color}
                    strokeWidth={isSelZone ? 2.5 : 1.5}
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
                    stroke={isSelZone ? '#38bdf8' : zone.color}
                    strokeWidth={isSelZone ? 2.5 : 1.5}
                    strokeDasharray="4 3"
                  />
                )}
                {zone.label && (
                  <text textAnchor="middle" dy="3.5" fontSize="10" fontWeight="bold" fill="#ffffff">
                    {zone.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Existing Paths (mit Bezier-Kurven & Kurven-Handle) */}
          {value.paths.map((path) => {
            if (path.points.length < 2) return null;
            const pts = path.points.map((p) => `${p.x * width},${p.y * height}`).join(' ');
            const first = path.points[0];
            const last = path.points[path.points.length - 1];
            const mid =
              path.controlPoint && path.points.length === 2
                ? evalQuadraticBezier(first, path.controlPoint, last, 0.5)
                : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
            const midX = mid.x * width;
            const midY = mid.y * height;

            const isPass = path.type === 'PASS_PATH';
            const isShot = path.type === 'SHOT_PATH';
            const isScreen = path.type === 'SCREEN_BLOCK_PATH';
            const isDribble = path.type === 'DRIBBLE_PATH';

            const markerEnd = isScreen
              ? 'url(#ed-screen-t)'
              : isShot
                ? 'url(#ed-arrow-amber)'
                : isPass
                  ? 'url(#ed-arrow-blue)'
                  : 'url(#ed-arrow-white)';

            const strokeColor = isShot || isScreen ? '#f59e0b' : isPass ? '#60a5fa' : '#f8fafc';
            const isSelectedPath = path.id === selectedPathId;
            const curveD =
              path.controlPoint && path.points.length === 2
                ? `M ${first.x * width} ${first.y * height} Q ${path.controlPoint.x * width} ${path.controlPoint.y * height} ${last.x * width} ${last.y * height}`
                : null;
            const curveHandle = isSelectedPath && editorMode === 'SKETCH' ? getCurveHandleCoords(path) : null;

            return (
              <g key={path.id}>
                {isSelectedPath &&
                  (curveD ? (
                    <path
                      d={curveD}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={isShot ? 9 : 7.5}
                      strokeOpacity="0.45"
                      strokeLinecap="round"
                    />
                  ) : (
                    <polyline
                      points={pts}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={isShot ? 9 : 7.5}
                      strokeOpacity="0.45"
                      strokeLinecap="round"
                    />
                  ))}
                {curveD ? (
                  <path
                    d={curveD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isShot ? 4 : 2.8}
                    strokeDasharray={isPass ? '7 5' : isDribble ? '3 3' : undefined}
                    markerEnd={markerEnd}
                  />
                ) : (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isShot ? 4 : 2.8}
                    strokeDasharray={isPass ? '7 5' : isDribble ? '3 3' : undefined}
                    markerEnd={markerEnd}
                  />
                )}
                {curveHandle && (
                  <g className="cursor-grab">
                    <circle
                      cx={curveHandle.cx}
                      cy={curveHandle.cy}
                      r="6.5"
                      fill="#facc15"
                      stroke="#0f172a"
                      strokeWidth="2"
                    />
                    <title>Kurven-Handle ziehen, um Bogenlauf anzupassen</title>
                  </g>
                )}
                {path.stepNumber !== undefined && (
                  <g transform={`translate(${midX}, ${midY - 9})`}>
                    <circle
                      r={isSelectedPath ? 11 : 9}
                      fill={isSelectedPath ? '#0284c7' : '#0f172a'}
                      stroke={isSelectedPath ? '#bae6fd' : strokeColor}
                      strokeWidth={isSelectedPath ? 2 : 1.5}
                    />
                    <text textAnchor="middle" dy="3.5" fontSize="10" fontWeight="bold" fill="#ffffff">
                      {path.stepNumber}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Onion-Skinning Geister-Symbole im Animations-Modus (Vorher-Position k-1) */}
          {editorMode === 'ANIMATION' &&
            prevKeyframe &&
            activeKeyframe &&
            value.nodes.map((baseNode) => {
              if (baseNode.type === 'WAYPOINT' || baseNode.type.startsWith('EQUIPMENT_')) return null;
              const prevNs = prevKeyframe.nodeStates[baseNode.id];
              const currNs = activeKeyframe.nodeStates[baseNode.id];
              if (!prevNs || !currNs) return null;
              const moved = Math.hypot(currNs.x - prevNs.x, currNs.y - prevNs.y) > 0.015;
              if (!moved) return null;
              const ghostNode: TacticNode = {
                ...baseNode,
                x: prevNs.x,
                y: prevNs.y,
                hasBall: prevNs.hasBall,
                rotation: prevNs.rotation
              };
              return (
                <g key={`ghost-${baseNode.id}`}>
                  <line
                    x1={prevNs.x * width}
                    y1={prevNs.y * height}
                    x2={currNs.x * width}
                    y2={currNs.y * height}
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity="0.55"
                  />
                  <g transform={`translate(${prevNs.x * width}, ${prevNs.y * height})`}>
                    <TacticPlayerGlyph node={ghostNode} opacity={0.3} />
                  </g>
                </g>
              );
            })}

          {/* Live Path Preview while dragging */}
          {drawingStart && drawingCurrent && (
            <line
              x1={drawingStart.x * width}
              y1={drawingStart.y * height}
              x2={drawingCurrent.x * width}
              y2={drawingCurrent.y * height}
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeDasharray="5 4"
            />
          )}

          {/* Nodes */}
          {displayNodes.map((node) => {
            const isHiddenInKeyframe =
              activeKeyframe && activeKeyframe.nodeStates[node.id]?.visible === false;
            const cx = node.x * width;
            const cy = node.y * height;
            const isSelected = node.id === selectedNodeId;

            if (node.type === 'WAYPOINT') {
              return (
                <g key={node.id} transform={`translate(${cx}, ${cy})`}>
                  <circle
                    r={isSelected ? 8 : 6}
                    fill="#f8fafc"
                    stroke="#38bdf8"
                    strokeWidth="2"
                  />
                  <title>Verketteter Wegpunkt (Hier weiteren Pfeil für Folgeaktion ansetzen)</title>
                </g>
              );
            }

            if (node.type === 'EQUIPMENT_CONE') {
              return (
                <g key={node.id} transform={`translate(${cx}, ${cy})`}>
                  {isSelected && (
                    <circle r="15" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
                  )}
                  <polygon
                    points="0,-10 -9,8 9,8"
                    fill={node.color ?? '#facc15'}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                </g>
              );
            }

            if (node.type === 'EQUIPMENT_MAT') {
              return (
                <g key={node.id} transform={`translate(${cx}, ${cy})`}>
                  <rect
                    x="-20"
                    y="-12"
                    width="40"
                    height="24"
                    rx="4"
                    fill="#0284c7"
                    stroke={isSelected ? '#facc15' : '#e0f2fe'}
                    strokeWidth="2"
                  />
                </g>
              );
            }

            if (node.type === 'EQUIPMENT_GOAL_TARGET') {
              return (
                <g key={node.id} transform={`translate(${cx}, ${cy})`}>
                  <rect
                    x="-11"
                    y="-7"
                    width="22"
                    height="14"
                    fill="none"
                    stroke="#facc15"
                    strokeWidth="3"
                  />
                </g>
              );
            }

            const showRotateHandle =
              isSelected &&
              isRotatableNode(node) &&
              (activeTool === 'SELECT_MOVE' || activeTool === 'ROTATE');
            const handleCoords = showRotateHandle ? getRotationHandleCoords(node) : null;

            return (
              <g key={node.id} opacity={isHiddenInKeyframe ? 0.25 : 1}>
                <g transform={`translate(${cx}, ${cy})`}>
                  <TacticPlayerGlyph node={node} isSelected={isSelected} />
                </g>
                {handleCoords && (
                  <g className="cursor-grab">
                    <line
                      x1={cx}
                      y1={cy}
                      x2={handleCoords.hx}
                      y2={handleCoords.hy}
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="3 2"
                    />
                    <circle
                      cx={handleCoords.hx}
                      cy={handleCoords.hy}
                      r="6"
                      fill="#0ea5e9"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      )}

      {/* Knoten-Inspektor: Anstellreihe ((RL)), Ballbesitz, Beschriftung & Löschen */}
      {selectedNode ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/40 bg-blue-950/30 px-4 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-blue-300">Ausgewähltes Element:</span>

            {selectedNode.type !== 'WAYPOINT' && selectedNode.type !== 'EQUIPMENT_CONE' && (
              <div className="flex items-center gap-1.5">
                <label className="text-slate-300">Kürzel:</label>
                <input
                  type="text"
                  maxLength={4}
                  value={selectedNode.label ?? ''}
                  onChange={(e) => handleUpdateSelectedNode({ label: e.target.value })}
                  className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-center font-bold text-white"
                />
              </div>
            )}

            {(selectedNode.type === 'OFFENSE_PLAYER' || selectedNode.type === 'COACH_FEEDER') && (
              <>
                <button
                  type="button"
                  onClick={() => handleUpdateSelectedNode({ hasBall: !selectedNode.hasBall })}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold ${
                    selectedNode.hasBall
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  <CircleDot className="h-3.5 w-3.5" />
                  {selectedNode.hasBall ? 'Hat Ball ✓' : 'Ball geben'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSelectedNode({
                      isQueue: !selectedNode.isQueue,
                      queueCount: selectedNode.queueCount ?? 3
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold ${
                    selectedNode.isQueue
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  {selectedNode.isQueue ? 'Anstellreihe (( )) ✓' : 'Als Anstellreihe'}
                </button>

                {selectedNode.isQueue && (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-300">Spieler:</span>
                    <select
                      value={selectedNode.queueCount ?? 3}
                      onChange={(e) =>
                        handleUpdateSelectedNode({ queueCount: Number(e.target.value) })
                      }
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-white"
                    >
                      {[2, 3, 4, 5, 6].map((cnt) => (
                        <option key={cnt} value={cnt}>
                          x{cnt}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {isRotatableNode(selectedNode) && (
              <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-2 py-0.5">
                <span className="text-cyan-300">Blickrichtung:</span>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSelectedNode({
                      rotation: (getDefaultNodeRotation(selectedNode) + 315) % 360
                    })
                  }
                  className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200 hover:bg-slate-700"
                  title="45° gegen den Uhrzeigersinn drehen"
                >
                  ↺ 45°
                </button>
                <span className="min-w-[32px] text-center font-mono font-bold text-white">
                  {getDefaultNodeRotation(selectedNode)}°
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSelectedNode({
                      rotation: (getDefaultNodeRotation(selectedNode) + 45) % 360
                    })
                  }
                  className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200 hover:bg-slate-700"
                  title="45° im Uhrzeigersinn drehen"
                >
                  ↻ 45°
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSelectedNode({
                      rotation: (getDefaultNodeRotation(selectedNode) + 180) % 360
                    })
                  }
                  className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200 hover:bg-slate-700"
                  title="Um 180° wenden"
                >
                  180°
                </button>
              </div>
            )}

            {activeKeyframe && (
              <button
                type="button"
                onClick={() => {
                  const currentlyVisible =
                    activeKeyframe.nodeStates[selectedNode.id]?.visible !== false;
                  updateActiveKeyframeNodeState(selectedNode.id, {
                    visible: !currentlyVisible
                  });
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold ${
                  activeKeyframe.nodeStates[selectedNode.id]?.visible !== false
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {activeKeyframe.nodeStates[selectedNode.id]?.visible !== false ? (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    Sichtbar
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    Ausgeblendet
                  </>
                )}
              </button>
            )}
          </div>

          {editorMode === 'SKETCH' && (
            <button
              type="button"
              onClick={handleDeleteSelectedNode}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Element löschen
            </button>
          )}
        </div>
      ) : selectedPath ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/40 bg-sky-950/30 px-4 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-sky-300">Ausgewählter Schritt:</span>

            <div className="flex flex-wrap items-center gap-1.5">
              <label className="text-slate-300">Nr.:</label>
              <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900">
                <button
                  type="button"
                  onClick={() =>
                    handleSetSelectedPathStep(Math.max(1, (selectedPath.stepNumber ?? 1) - 1))
                  }
                  className="px-2 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white"
                  title="Schrittnummer verringern"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={stepInputDraft}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setStepInputDraft(raw);
                    if (raw !== '') {
                      const num = Number(raw);
                      if (num >= 1 && num <= 99) {
                        handleSetSelectedPathStep(num);
                      }
                    }
                  }}
                  onBlur={() => {
                    const num = Number(stepInputDraft);
                    if (!stepInputDraft || Number.isNaN(num) || num < 1) {
                      const fallback = selectedPath.stepNumber ?? 1;
                      setStepInputDraft(String(fallback));
                    } else {
                      handleSetSelectedPathStep(Math.min(99, num));
                    }
                  }}
                  className="w-10 bg-transparent px-1 py-1 text-center font-bold text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSetSelectedPathStep(Math.min(99, (selectedPath.stepNumber ?? 1) + 1))
                  }
                  className="px-2 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white"
                  title="Schrittnummer erhöhen"
                >
                  +
                </button>
              </div>
              {(() => {
                const idx = value.paths.findIndex((p) => p.id === selectedPath.id);
                const prevPath = idx > 0 ? value.paths[idx - 1] : undefined;
                if (!prevPath) return null;
                const prevStep = prevPath.stepNumber ?? 1;
                const isAlreadyParallel = (selectedPath.stepNumber ?? 1) === prevStep;
                return (
                  <button
                    type="button"
                    disabled={isAlreadyParallel}
                    onClick={() => handleSetSelectedPathStep(prevStep)}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-900/50 disabled:opacity-40"
                    title={`Mit vorherigem Schritt (${prevStep}) gleichzeitig ausführen`}
                  >
                    ⚡ Parallel zu #{prevStep}
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => handleMovePathOrder(selectedPath.id, 'EARLIER')}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
                title="Schritt in der Reihenfolge vorziehen"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Früher
              </button>
              <button
                type="button"
                onClick={() => handleMovePathOrder(selectedPath.id, 'LATER')}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
                title="Schritt in der Reihenfolge nach hinten schieben"
              >
                Später
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-slate-300">Typ:</label>
              <select
                value={selectedPath.type}
                onChange={(e) =>
                  handleUpdateSelectedPath({ type: e.target.value as TacticPathType })
                }
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
              >
                {(Object.keys(PATH_TYPE_LABELS) as TacticPathType[]).map((pt) => (
                  <option key={pt} value={pt}>
                    {PATH_TYPE_LABELS[pt]}
                  </option>
                ))}
              </select>
            </div>

            {selectedPath.points.length === 2 && (
              <button
                type="button"
                onClick={handleToggleCurveOnSelectedPath}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold ${
                  selectedPath.controlPoint
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
                }`}
              >
                {selectedPath.controlPoint ? 'Gerade machen' : '〰️ Bogen / Kurve'}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleDeleteSelectedPath}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Pfeil löschen
          </button>
        </div>
      ) : selectedZone ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-emerald-300">Zone:</span>
            <input
              type="text"
              value={selectedZone.label ?? ''}
              onChange={(e) => handleUpdateSelectedZone({ label: e.target.value })}
              placeholder="Beschriftung..."
              className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
            />
            <div className="flex items-center gap-1">
              {[
                { hex: '#22c55e', title: 'Zielzone (Grün)' },
                { hex: '#ef4444', title: 'Sperrzone (Rot)' },
                { hex: '#3b82f6', title: 'Sektor (Blau)' },
                { hex: '#f59e0b', title: 'Achtung (Gelb)' }
              ].map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => handleUpdateSelectedZone({ color: c.hex })}
                  className={`h-6 w-6 rounded-full border-2 ${
                    selectedZone.color === c.hex ? 'border-white' : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.title}
                />
              ))}
            </div>
            <label className="flex items-center gap-1 text-slate-300">
              Breite:
              <input
                type="range"
                min={0.08}
                max={0.8}
                step={0.02}
                value={selectedZone.width}
                onChange={(e) => handleUpdateSelectedZone({ width: Number(e.target.value) })}
                className="w-16 accent-emerald-500"
              />
            </label>
            <label className="flex items-center gap-1 text-slate-300">
              Höhe:
              <input
                type="range"
                min={0.08}
                max={0.8}
                step={0.02}
                value={selectedZone.height}
                onChange={(e) => handleUpdateSelectedZone({ height: Number(e.target.value) })}
                className="w-16 accent-emerald-500"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleDeleteSelectedZone}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Zone löschen
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-blue-400" />
            Tipp: Pfeile rasten magnetisch an Spielern ein. Im „Bewegen / Auswählen“-Modus kannst du Spieler verschieben oder Pfeile/Nummern anklicken.
          </span>
          <span>
            {value.nodes.length} Elemente · {value.paths.length} Aktionen
          </span>
        </div>
      )}

      {/* Ablauf-Reihenfolge & Neu-Nummerierung */}
      {value.paths.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
              <ListOrdered className="h-3.5 w-3.5 text-sky-400" />
              Reihenfolge:
            </span>
            {value.paths.map((p) => {
              const isSelected = p.id === selectedPathId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActiveTool('SELECT_MOVE');
                    setSelectedNodeId(null);
                    setSelectedPathId(p.id);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                    isSelected
                      ? 'border-sky-400 bg-sky-600 text-white'
                      : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-950/80 text-[10px] font-bold text-white">
                    {p.stepNumber ?? '?'}
                  </span>
                  <span>{PATH_TYPE_LABELS[p.type]}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleRenumberAllPaths}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
              numberingHasGaps
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Alle Aktions-Schritte lückenlos 1 bis N neu nummerieren"
          >
            <ListOrdered className="h-3.5 w-3.5" />
            1…{value.paths.length} neu nummerieren
          </button>
        </div>
      )}
    </div>
  );
}
