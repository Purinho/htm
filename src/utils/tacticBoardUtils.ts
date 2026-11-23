import type {
  TacticBoardData,
  TacticKeyframe,
  TacticKeyframeNodeState,
  TacticNode,
  TacticPath,
  TacticPathPoint
} from '../types/domain';

function sortPathsByStep(paths: TacticPath[]): TacticPath[] {
  return paths
    .map((p, index) => ({ path: p, index }))
    .sort((a, b) => {
      const stepA = a.path.stepNumber ?? Number.MAX_SAFE_INTEGER;
      const stepB = b.path.stepNumber ?? Number.MAX_SAFE_INTEGER;
      if (stepA !== stepB) return stepA - stepB;
      return a.index - b.index;
    })
    .map((entry) => entry.path);
}

/**
 * Sorts paths by their stepNumber and assigns contiguous 1..N step numbers.
 */
export function renumberTacticPaths(paths: TacticPath[]): TacticPath[] {
  return sortPathsByStep(paths).map((path, index) => ({
    ...path,
    stepNumber: index + 1
  }));
}

/**
 * Moves a path earlier or later in the action sequence and renumbers 1..N.
 */
export function moveTacticPathOrder(
  paths: TacticPath[],
  pathId: string,
  direction: 'EARLIER' | 'LATER'
): TacticPath[] {
  const ordered = sortPathsByStep(paths);
  const idx = ordered.findIndex((p) => p.id === pathId);
  if (idx === -1) return paths;

  const targetIdx = direction === 'EARLIER' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= ordered.length) return paths;

  const swapped = [...ordered];
  const temp = swapped[idx];
  swapped[idx] = swapped[targetIdx];
  swapped[targetIdx] = temp;

  return swapped.map((path, index) => ({
    ...path,
    stepNumber: index + 1
  }));
}

/**
 * Updates a single path's stepNumber (allowing simultaneous steps or manual ordering)
 * and keeps the paths array sorted by stepNumber.
 */
export function setTacticPathStepNumber(
  paths: TacticPath[],
  pathId: string,
  stepNumber: number
): TacticPath[] {
  const clamped = Math.max(1, Math.round(stepNumber));
  const updated = paths.map((p) =>
    p.id === pathId ? { ...p, stepNumber: clamped } : p
  );
  return sortPathsByStep(updated);
}

/**
 * Returns true if path step numbers have gaps, duplicates, or missing values compared to 1..N.
 */
export function hasPathNumberingGaps(paths: TacticPath[]): boolean {
  if (paths.length === 0) return false;
  const ordered = sortPathsByStep(paths);
  return ordered.some((p, index) => p.stepNumber !== index + 1);
}

/**
 * Removes a path from the board, cleans up any orphaned WAYPOINT nodes,
 * and optionally renumbers remaining paths to 1..N.
 */
export function deleteTacticPath(
  board: TacticBoardData,
  pathId: string,
  autoRenumber = true
): TacticBoardData {
  const remainingPaths = board.paths.filter((p) => p.id !== pathId);
  const referencedWaypoints = new Set<string>();
  for (const p of remainingPaths) {
    if (p.fromWaypointId) referencedWaypoints.add(p.fromWaypointId);
    if (p.toWaypointId) referencedWaypoints.add(p.toWaypointId);
  }

  const remainingNodes = board.nodes.filter(
    (n) => n.type !== 'WAYPOINT' || referencedWaypoints.has(n.id)
  );

  return {
    ...board,
    nodes: remainingNodes,
    paths: autoRenumber ? renumberTacticPaths(remainingPaths) : remainingPaths
  };
}

/**
 * Computes shortest Euclidean distance from point P to line segment AB (normalized coordinates).
 */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

const MIRROR_LABEL_MAP: Record<string, string> = {
  LA: 'RA',
  RA: 'LA',
  RL: 'RR',
  RR: 'RL',
  AL: 'AR',
  AR: 'AL',
  HL: 'HR',
  HR: 'HL',
  IL: 'IR',
  IR: 'IL'
};

/**
 * Swaps left/right handball position labels (LA<->RA, RL<->RR, AL<->AR, HL<->HR, IL<->IR).
 */
export function mirrorPlayerLabel(label?: string): string | undefined {
  if (!label) return label;
  const trimmed = label.trim();
  const upper = trimmed.toUpperCase();
  if (MIRROR_LABEL_MAP[upper]) {
    return MIRROR_LABEL_MAP[upper];
  }
  return label;
}

function mirrorRotationDeg(rotation?: number): number | undefined {
  if (typeof rotation !== 'number') return undefined;
  return ((360 - rotation) % 360 + 360) % 360;
}

/**
 * Mirrors all nodes, paths (including controlPoints), zones, and keyframes horizontally (x -> 1 - x)
 * and swaps left/right handball position labels.
 */
export function mirrorTacticBoardHorizontal(board: TacticBoardData): TacticBoardData {
  const nodes: TacticNode[] = board.nodes.map((node) => ({
    ...node,
    x: Math.round((1 - node.x) * 1000) / 1000,
    label: mirrorPlayerLabel(node.label),
    rotation: mirrorRotationDeg(node.rotation)
  }));

  const paths: TacticPath[] = board.paths.map((path) => ({
    ...path,
    points: path.points.map((pt) => ({
      x: Math.round((1 - pt.x) * 1000) / 1000,
      y: pt.y
    })),
    controlPoint: path.controlPoint
      ? {
          x: Math.round((1 - path.controlPoint.x) * 1000) / 1000,
          y: path.controlPoint.y
        }
      : undefined
  }));

  const zones = board.zones?.map((zone) => ({
    ...zone,
    x: Math.round((1 - zone.x) * 1000) / 1000,
    rotation: mirrorRotationDeg(zone.rotation)
  }));

  const keyframes = board.keyframes?.map((kf) => {
    const nextNodeStates: Record<string, TacticKeyframeNodeState> = {};
    for (const [nodeId, ns] of Object.entries(kf.nodeStates)) {
      nextNodeStates[nodeId] = {
        ...ns,
        x: Math.round((1 - ns.x) * 1000) / 1000,
        rotation: mirrorRotationDeg(ns.rotation)
      };
    }
    return {
      ...kf,
      nodeStates: nextNodeStates,
      ballPosition: kf.ballPosition
        ? {
            ...kf.ballPosition,
            x:
              typeof kf.ballPosition.x === 'number'
                ? Math.round((1 - kf.ballPosition.x) * 1000) / 1000
                : undefined
          }
        : undefined
    };
  });

  return {
    ...board,
    nodes,
    paths,
    zones,
    keyframes
  };
}

/**
 * Evaluates a quadratic Bezier curve at parameter t in [0, 1].
 */
export function evalQuadraticBezier(
  p0: TacticPathPoint,
  cp: TacticPathPoint,
  p1: TacticPathPoint,
  t: number
): TacticPathPoint {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y
  };
}

/**
 * Approximates shortest Euclidean distance from point P to a quadratic Bezier curve.
 */
export function distancePointToQuadraticBezier(
  px: number,
  py: number,
  p0: TacticPathPoint,
  cp: TacticPathPoint,
  p1: TacticPathPoint,
  steps = 16
): number {
  let minDist = Infinity;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const curr = evalQuadraticBezier(p0, cp, p1, i / steps);
    const d = distancePointToSegment(px, py, prev.x, prev.y, curr.x, curr.y);
    if (d < minDist) minDist = d;
    prev = curr;
  }
  return minDist;
}

/**
 * Builds a baseline KeyframeNodeState map from the static board nodes.
 */
export function buildInitialNodeStates(
  nodes: TacticNode[]
): Record<string, TacticKeyframeNodeState> {
  const states: Record<string, TacticKeyframeNodeState> = {};
  for (const node of nodes) {
    states[node.id] = {
      x: node.x,
      y: node.y,
      hasBall: Boolean(node.hasBall),
      rotation: node.rotation,
      visible: true
    };
  }
  return states;
}

/**
 * Creates a new keyframe either cloning the previous keyframe or the base board nodes.
 */
export function createKeyframeFromBoardOrPrevious(
  board: TacticBoardData,
  index: number,
  previous?: TacticKeyframe,
  label?: string
): TacticKeyframe {
  const nodeStates: Record<string, TacticKeyframeNodeState> = {};
  for (const node of board.nodes) {
    const prevNs = previous?.nodeStates[node.id];
    nodeStates[node.id] = prevNs
      ? { ...prevNs }
      : {
          x: node.x,
          y: node.y,
          hasBall: Boolean(node.hasBall),
          rotation: node.rotation,
          visible: true
        };
  }

  return {
    id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    index,
    label: label ?? `Szene ${index + 1}`,
    durationMs: 1400,
    pauseAfterMs: 300,
    nodeStates,
    activePathIds: []
  };
}

function findNodeNearInStates(
  nodes: TacticNode[],
  pt: TacticPathPoint,
  states: Record<string, TacticKeyframeNodeState>
): string | undefined {
  let bestId: string | undefined;
  let bestDist = 0.08;
  for (const node of nodes) {
    if (node.type === 'WAYPOINT' || node.type.startsWith('EQUIPMENT_')) continue;
    const st = states[node.id];
    if (!st) continue;
    const d = Math.hypot(st.x - pt.x, st.y - pt.y);
    if (d <= bestDist) {
      bestDist = d;
      bestId = node.id;
    }
  }
  return bestId;
}

/**
 * Generates an animation keyframe sequence automatically from numbered paths.
 */
export function generateKeyframesFromPaths(board: TacticBoardData): TacticBoardData {
  const orderedPaths = sortPathsByStep(board.paths);
  if (orderedPaths.length === 0) {
    const initialKf = createKeyframeFromBoardOrPrevious(board, 0, undefined, 'Ausgangsposition');
    return {
      ...board,
      version: 2,
      keyframes: [initialKf],
      animationSettings: board.animationSettings ?? {
        defaultSpeed: 1,
        loop: true,
        showTrails: true,
        showPathsDuringPlay: true
      }
    };
  }

  const keyframes: TacticKeyframe[] = [];
  let currentStates = buildInitialNodeStates(board.nodes);
  const initialHolders = board.nodes.filter((n) => n.hasBall).map((n) => n.id);

  keyframes.push({
    id: 'kf-0',
    index: 0,
    label: 'Ausgangsposition',
    durationMs: 900,
    pauseAfterMs: 250,
    nodeStates: JSON.parse(JSON.stringify(currentStates)),
    activePathIds: [],
    ballPosition: initialHolders.length === 1 ? { holderNodeId: initialHolders[0] } : undefined
  });

  // Group paths by stepNumber so simultaneous actions animate together
  const stepGroups: { step: number; paths: TacticPath[] }[] = [];
  for (const path of orderedPaths) {
    const step = path.stepNumber ?? 1;
    const existing = stepGroups.find((g) => g.step === step);
    if (existing) {
      existing.paths.push(path);
    } else {
      stepGroups.push({ step, paths: [path] });
    }
  }

  stepGroups.forEach((group, groupIdx) => {
    const nextStates: Record<string, TacticKeyframeNodeState> = JSON.parse(
      JSON.stringify(currentStates)
    );
    const releasedBallNodeIds = new Set<string>();
    const receivedBallNodeIds = new Set<string>();
    const freeBallEndpoints: TacticPathPoint[] = [];
    let ballPathCount = 0;
    const labels: string[] = [];

    for (const path of group.paths) {
      if (path.points.length < 2) continue;
      const startPt = path.points[0];
      const endPt = path.points[path.points.length - 1];
      const sourceNodeId =
        path.fromNodeId && nextStates[path.fromNodeId]
          ? path.fromNodeId
          : findNodeNearInStates(board.nodes, startPt, currentStates);
      const targetNodeId =
        path.toNodeId && nextStates[path.toNodeId]
          ? path.toNodeId
          : findNodeNearInStates(board.nodes, endPt, currentStates);

      if (path.type === 'PASS_PATH') {
        ballPathCount++;
        labels.push('Pass');
        if (sourceNodeId && nextStates[sourceNodeId]) {
          releasedBallNodeIds.add(sourceNodeId);
        }
        if (targetNodeId && nextStates[targetNodeId]) {
          receivedBallNodeIds.add(targetNodeId);
        } else {
          freeBallEndpoints.push({ x: endPt.x, y: endPt.y });
        }
      } else if (path.type === 'SHOT_PATH') {
        ballPathCount++;
        labels.push('Wurf');
        if (sourceNodeId && nextStates[sourceNodeId]) {
          releasedBallNodeIds.add(sourceNodeId);
        }
        freeBallEndpoints.push({ x: endPt.x, y: endPt.y });
      } else {
        // RUN_PATH, DRIBBLE_PATH, FEINT_PATH, SCREEN_BLOCK_PATH
        labels.push(
          path.type === 'DRIBBLE_PATH'
            ? 'Prellen'
            : path.type === 'FEINT_PATH'
              ? 'Täuschung'
              : path.type === 'SCREEN_BLOCK_PATH'
                ? 'Sperre'
                : 'Laufweg'
        );
        if (sourceNodeId && nextStates[sourceNodeId]) {
          nextStates[sourceNodeId].x = endPt.x;
          nextStates[sourceNodeId].y = endPt.y;
          const angle =
            (Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x) * 180) / Math.PI + 90;
          nextStates[sourceNodeId].rotation = Math.round(angle);
        }
      }
    }

    if (ballPathCount === 1 && releasedBallNodeIds.size === 0) {
      const prevHolders = Object.keys(currentStates).filter((id) => currentStates[id].hasBall);
      if (prevHolders.length === 1) {
        releasedBallNodeIds.add(prevHolders[0]);
      }
    }

    for (const id of releasedBallNodeIds) {
      if (!receivedBallNodeIds.has(id) && nextStates[id]) {
        nextStates[id].hasBall = false;
      }
    }
    for (const id of receivedBallNodeIds) {
      if (nextStates[id]) {
        nextStates[id].hasBall = true;
      }
    }

    const finalHolders = Object.keys(nextStates).filter((id) => nextStates[id].hasBall);
    let ballPos: TacticKeyframe['ballPosition'];
    if (finalHolders.length === 1 && freeBallEndpoints.length === 0) {
      ballPos = { holderNodeId: finalHolders[0] };
    } else if (finalHolders.length === 0 && freeBallEndpoints.length === 1) {
      ballPos = { x: freeBallEndpoints[0].x, y: freeBallEndpoints[0].y };
    }

    keyframes.push({
      id: `kf-${groupIdx + 1}`,
      index: groupIdx + 1,
      label: `Schritt ${group.step}: ${Array.from(new Set(labels)).join(' + ')}`,
      durationMs: 1400,
      pauseAfterMs: 300,
      nodeStates: nextStates,
      activePathIds: group.paths.map((p) => p.id),
      ballPosition: ballPos
    });

    currentStates = nextStates;
  });

  return {
    ...board,
    version: 2,
    keyframes,
    animationSettings: board.animationSettings ?? {
      defaultSpeed: 1,
      loop: true,
      showTrails: true,
      showPathsDuringPlay: true
    }
  };
}

/**
 * Returns true if the tactic board defines an explicit multi-frame keyframe animation
 * (at least 2 keyframes: initial state + at least one target scene).
 */
export function hasExplicitTacticAnimation(board?: TacticBoardData | null): boolean {
  return Boolean(board?.keyframes && board.keyframes.length > 1);
}

export function getTotalAnimationDurationMs(keyframes?: TacticKeyframe[]): number {
  if (!keyframes || keyframes.length <= 1) return 0;
  // Keyframe 0 is initial state; transitions are 0->1, 1->2, ...
  let total = 0;
  for (let i = 1; i < keyframes.length; i++) {
    total += (keyframes[i].durationMs || 1400) + (keyframes[i].pauseAfterMs ?? 300);
  }
  return total;
}

export interface InterpolatedBoardFrame {
  nodes: TacticNode[];
  hiddenNodeIds: Set<string>;
  freeBallPosition?: { x: number; y: number };
  freeBallPositions: { x: number; y: number }[];
  activePathIds: Set<string>;
  currentKeyframeIndex: number;
  trails: { nodeId: string; points: TacticPathPoint[]; color?: string }[];
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

/**
 * Interpolates node positions, rotations, ball flight, and active paths at a given timeMs.
 */
export function interpolateTacticBoardAtTime(
  board: TacticBoardData,
  timeMs: number
): InterpolatedBoardFrame {
  const keyframes = board.keyframes ?? [];
  if (keyframes.length === 0) {
    return {
      nodes: board.nodes,
      hiddenNodeIds: new Set(),
      freeBallPositions: [],
      activePathIds: new Set(),
      currentKeyframeIndex: 0,
      trails: []
    };
  }

  if (keyframes.length === 1) {
    const kf = keyframes[0];
    const hidden = new Set<string>();
    const nodes = board.nodes.map((n) => {
      const st = kf.nodeStates[n.id];
      if (!st) return n;
      if (st.visible === false) hidden.add(n.id);
      return {
        ...n,
        x: st.x,
        y: st.y,
        hasBall: st.hasBall ?? n.hasBall,
        rotation: st.rotation ?? n.rotation
      };
    });
    const singleFreeBall =
      kf.ballPosition && typeof kf.ballPosition.x === 'number' && typeof kf.ballPosition.y === 'number'
        ? { x: kf.ballPosition.x, y: kf.ballPosition.y }
        : undefined;
    return {
      nodes,
      hiddenNodeIds: hidden,
      freeBallPosition: singleFreeBall,
      freeBallPositions: singleFreeBall ? [singleFreeBall] : [],
      activePathIds: new Set(kf.activePathIds ?? []),
      currentKeyframeIndex: 0,
      trails: []
    };
  }

  // Locate segment [i-1 -> i]
  let elapsed = 0;
  let segIndex = 1;
  let segProgress = 0;
  for (let i = 1; i < keyframes.length; i++) {
    const dur = keyframes[i].durationMs || 1400;
    const pause = keyframes[i].pauseAfterMs ?? 300;
    const segTotal = dur + pause;
    if (timeMs <= elapsed + segTotal || i === keyframes.length - 1) {
      segIndex = i;
      const localT = Math.max(0, timeMs - elapsed);
      segProgress = Math.min(1, localT / Math.max(1, dur));
      break;
    }
    elapsed += segTotal;
  }

  const prevKf = keyframes[segIndex - 1];
  const nextKf = keyframes[segIndex];
  const eased = easeInOutCubic(segProgress);
  const activePathIds = new Set(nextKf.activePathIds ?? []);
  const hiddenNodeIds = new Set<string>();
  const trails: InterpolatedBoardFrame['trails'] = [];

  // Map active paths by fromNodeId so curved paths are followed during interpolation
  const activePaths = board.paths.filter((p) => activePathIds.has(p.id));

  const nodes = board.nodes.map((node) => {
    const prevSt = prevKf.nodeStates[node.id];
    const nextSt = nextKf.nodeStates[node.id];
    if (!prevSt && !nextSt) return node;

    const p0 = prevSt ?? { x: node.x, y: node.y, hasBall: node.hasBall, rotation: node.rotation, visible: true };
    const p1 = nextSt ?? p0;

    if (p1.visible === false && (segProgress > 0.5 || p0.visible === false)) {
      hiddenNodeIds.add(node.id);
    }

    // Check if there is an active curved movement path for this node
    const matchingPath = activePaths.find(
      (p) =>
        p.fromNodeId === node.id &&
        p.type !== 'PASS_PATH' &&
        p.type !== 'SHOT_PATH' &&
        p.points.length >= 2
    );

    let pos: TacticPathPoint;
    if (matchingPath?.controlPoint) {
      pos = evalQuadraticBezier(
        { x: p0.x, y: p0.y },
        matchingPath.controlPoint,
        { x: p1.x, y: p1.y },
        eased
      );
    } else {
      pos = {
        x: p0.x + (p1.x - p0.x) * eased,
        y: p0.y + (p1.y - p0.y) * eased
      };
    }

    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.01;
    if (moved && board.animationSettings?.showTrails !== false) {
      trails.push({
        nodeId: node.id,
        points: [{ x: p0.x, y: p0.y }, pos],
        color: node.type === 'DEFENSE_PLAYER' ? '#f87171' : '#60a5fa'
      });
    }

    const rot0 = p0.rotation ?? (node.type === 'DEFENSE_PLAYER' ? 180 : 0);
    const rot1 = p1.rotation ?? rot0;

    return {
      ...node,
      x: pos.x,
      y: pos.y,
      rotation: lerpAngle(rot0, rot1, eased),
      hasBall: segProgress >= 0.9 ? Boolean(p1.hasBall) : false
    };
  });

  // Ball flight interpolation: handle simultaneous PASS_PATH / SHOT_PATH actions as well as legacy single-ball keyframes
  const freeBallPositions: { x: number; y: number }[] = [];
  const activeBallPaths = activePaths.filter(
    (p) => (p.type === 'PASS_PATH' || p.type === 'SHOT_PATH') && p.points.length >= 2
  );

  if (activeBallPaths.length > 0) {
    const inFlightSourceIds = new Set<string>();
    const inFlightTargetIds = new Set<string>();

    for (const path of activeBallPaths) {
      const firstPt = path.points[0];
      const lastPt = path.points[path.points.length - 1];
      const sourceId =
        path.fromNodeId && prevKf.nodeStates[path.fromNodeId]
          ? path.fromNodeId
          : findNodeNearInStates(board.nodes, firstPt, prevKf.nodeStates);
      const targetId =
        path.type === 'PASS_PATH'
          ? path.toNodeId && nextKf.nodeStates[path.toNodeId]
            ? path.toNodeId
            : findNodeNearInStates(board.nodes, lastPt, nextKf.nodeStates)
          : undefined;

      const pStart =
        sourceId && prevKf.nodeStates[sourceId]
          ? { x: prevKf.nodeStates[sourceId].x, y: prevKf.nodeStates[sourceId].y }
          : firstPt;
      const pEnd =
        targetId && nextKf.nodeStates[targetId]
          ? { x: nextKf.nodeStates[targetId].x, y: nextKf.nodeStates[targetId].y }
          : lastPt;

      if (sourceId) inFlightSourceIds.add(sourceId);
      if (targetId) inFlightTargetIds.add(targetId);

      if (segProgress < 0.95 || !targetId) {
        if (path.controlPoint && path.points.length === 2) {
          freeBallPositions.push(evalQuadraticBezier(pStart, path.controlPoint, pEnd, eased));
        } else {
          freeBallPositions.push({
            x: pStart.x + (pEnd.x - pStart.x) * eased,
            y: pStart.y + (pEnd.y - pStart.y) * eased
          });
        }
      }
    }

    for (const node of nodes) {
      if (inFlightTargetIds.has(node.id) && segProgress >= 0.95) {
        node.hasBall = Boolean(nextKf.nodeStates[node.id]?.hasBall);
      } else if (inFlightSourceIds.has(node.id) || inFlightTargetIds.has(node.id)) {
        node.hasBall = false;
      } else if (prevKf.nodeStates[node.id]?.hasBall && nextKf.nodeStates[node.id]?.hasBall) {
        node.hasBall = true;
      } else {
        node.hasBall = segProgress >= 0.9 ? Boolean(nextKf.nodeStates[node.id]?.hasBall) : false;
      }
    }
  } else {
    for (const node of nodes) {
      if (prevKf.nodeStates[node.id]?.hasBall && nextKf.nodeStates[node.id]?.hasBall) {
        node.hasBall = true;
      }
    }

    const lostIds = Object.keys(prevKf.nodeStates).filter(
      (id) => prevKf.nodeStates[id]?.hasBall && !nextKf.nodeStates[id]?.hasBall
    );
    const gainedIds = Object.keys(nextKf.nodeStates).filter(
      (id) => !prevKf.nodeStates[id]?.hasBall && nextKf.nodeStates[id]?.hasBall
    );

    if (lostIds.length > 0 && gainedIds.length > 0) {
      const pairCount = Math.min(lostIds.length, gainedIds.length);
      for (let i = 0; i < pairCount; i++) {
        const fromId = lostIds[i];
        const toId = gainedIds[i];
        const pStart = { x: prevKf.nodeStates[fromId].x, y: prevKf.nodeStates[fromId].y };
        const pEnd = { x: nextKf.nodeStates[toId].x, y: nextKf.nodeStates[toId].y };
        if (segProgress < 0.95) {
          freeBallPositions.push({
            x: pStart.x + (pEnd.x - pStart.x) * eased,
            y: pStart.y + (pEnd.y - pStart.y) * eased
          });
          const fromNode = nodes.find((n) => n.id === fromId);
          const toNode = nodes.find((n) => n.id === toId);
          if (fromNode) fromNode.hasBall = false;
          if (toNode) toNode.hasBall = false;
        } else {
          const toNode = nodes.find((n) => n.id === toId);
          if (toNode) toNode.hasBall = true;
        }
      }
    } else {
      const prevHolderId =
        prevKf.ballPosition?.holderNodeId ??
        Object.keys(prevKf.nodeStates).find((id) => prevKf.nodeStates[id]?.hasBall);
      const nextHolderId =
        nextKf.ballPosition?.holderNodeId ??
        Object.keys(nextKf.nodeStates).find((id) => nextKf.nodeStates[id]?.hasBall);

      const prevBallPt =
        prevHolderId && prevKf.nodeStates[prevHolderId]
          ? { x: prevKf.nodeStates[prevHolderId].x, y: prevKf.nodeStates[prevHolderId].y }
          : typeof prevKf.ballPosition?.x === 'number' && typeof prevKf.ballPosition?.y === 'number'
            ? { x: prevKf.ballPosition.x, y: prevKf.ballPosition.y }
            : undefined;

      const nextBallPt =
        nextHolderId && nextKf.nodeStates[nextHolderId]
          ? { x: nextKf.nodeStates[nextHolderId].x, y: nextKf.nodeStates[nextHolderId].y }
          : typeof nextKf.ballPosition?.x === 'number' && typeof nextKf.ballPosition?.y === 'number'
            ? { x: nextKf.ballPosition.x, y: nextKf.ballPosition.y }
            : undefined;

      if (prevBallPt && nextBallPt && (prevHolderId !== nextHolderId || !nextHolderId)) {
        if (segProgress < 0.95 || !nextHolderId) {
          freeBallPositions.push({
            x: prevBallPt.x + (nextBallPt.x - prevBallPt.x) * eased,
            y: prevBallPt.y + (nextBallPt.y - prevBallPt.y) * eased
          });
          for (const n of nodes) {
            if (n.id === prevHolderId || n.id === nextHolderId) {
              n.hasBall = false;
            }
          }
        }
      }
    }
  }

  return {
    nodes,
    hiddenNodeIds,
    freeBallPosition: freeBallPositions[0],
    freeBallPositions,
    activePathIds,
    currentKeyframeIndex: segIndex,
    trails
  };
}
