import { describe, expect, it } from 'vitest';
import {
  deleteTacticPath,
  evalQuadraticBezier,
  generateKeyframesFromPaths,
  hasExplicitTacticAnimation,
  hasPathNumberingGaps,
  interpolateTacticBoardAtTime,
  mirrorPlayerLabel,
  mirrorTacticBoardHorizontal,
  moveTacticPathOrder,
  renumberTacticPaths,
  setTacticPathStepNumber
} from './tacticBoardUtils';
import type { TacticBoardData, TacticPath } from '../types/domain';

describe('tacticBoardUtils', () => {
  const samplePaths: TacticPath[] = [
    { id: 'p1', type: 'RUN_PATH', stepNumber: 1, points: [{ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.4 }] },
    { id: 'p2', type: 'PASS_PATH', stepNumber: 3, points: [{ x: 0.3, y: 0.4 }, { x: 0.6, y: 0.4 }] },
    { id: 'p3', type: 'SHOT_PATH', stepNumber: 5, points: [{ x: 0.6, y: 0.4 }, { x: 0.5, y: 0.1 }] }
  ];

  it('detects numbering gaps and renumbers paths contiguously 1..N', () => {
    expect(hasPathNumberingGaps(samplePaths)).toBe(true);
    const renumbered = renumberTacticPaths(samplePaths);
    expect(renumbered.map((p) => p.stepNumber)).toEqual([1, 2, 3]);
    expect(hasPathNumberingGaps(renumbered)).toBe(false);
  });

  it('moves a path earlier or later in the sequence and renumbers 1..N', () => {
    const moved = moveTacticPathOrder(samplePaths, 'p3', 'EARLIER');
    expect(moved.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(moved.map((p) => p.stepNumber)).toEqual([1, 2, 3]);
  });

  it('allows setting a custom stepNumber and sorts paths accordingly', () => {
    const updated = setTacticPathStepNumber(samplePaths, 'p3', 2);
    expect(updated.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(updated.find((p) => p.id === 'p3')?.stepNumber).toBe(2);
  });

  it('deletes a path, cleans up orphaned waypoints, and renumbers remaining paths', () => {
    const board: TacticBoardData = {
      version: 1,
      courtTemplate: 'HALF_COURT_VERTICAL',
      nodes: [
        { id: 'n1', type: 'OFFENSE_PLAYER', x: 0.2, y: 0.5 },
        { id: 'wp1', type: 'WAYPOINT', x: 0.3, y: 0.4 }
      ],
      paths: [
        {
          id: 'p1',
          type: 'RUN_PATH',
          stepNumber: 1,
          fromNodeId: 'n1',
          toWaypointId: 'wp1',
          points: [{ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.4 }]
        },
        {
          id: 'p2',
          type: 'SHOT_PATH',
          stepNumber: 2,
          fromNodeId: 'n1',
          points: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.1 }]
        }
      ]
    };

    const next = deleteTacticPath(board, 'p1', true);
    expect(next.nodes.some((n) => n.id === 'wp1')).toBe(false);
    expect(next.paths).toHaveLength(1);
    expect(next.paths[0].id).toBe('p2');
    expect(next.paths[0].stepNumber).toBe(1);
  });

  it('mirrors board horizontally and swaps handball left/right position labels', () => {
    expect(mirrorPlayerLabel('LA')).toBe('RA');
    expect(mirrorPlayerLabel('RL')).toBe('RR');
    expect(mirrorPlayerLabel('IL')).toBe('IR');
    expect(mirrorPlayerLabel('RM')).toBe('RM');
    expect(mirrorPlayerLabel('TW')).toBe('TW');

    const board: TacticBoardData = {
      version: 2,
      courtTemplate: 'HALF_COURT_VERTICAL',
      nodes: [
        { id: 'n1', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.25, y: 0.5, rotation: 30 },
        { id: 'n2', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.5, y: 0.55 }
      ],
      paths: [
        {
          id: 'p1',
          type: 'RUN_PATH',
          stepNumber: 1,
          points: [{ x: 0.25, y: 0.5 }, { x: 0.4, y: 0.3 }],
          controlPoint: { x: 0.2, y: 0.35 }
        }
      ],
      zones: [
        { id: 'z1', shape: 'RECT', x: 0.2, y: 0.4, width: 0.15, height: 0.1, color: '#22c55e' }
      ]
    };

    const mirrored = mirrorTacticBoardHorizontal(board);
    expect(mirrored.nodes[0].x).toBeCloseTo(0.75, 3);
    expect(mirrored.nodes[0].label).toBe('RR');
    expect(mirrored.nodes[0].rotation).toBe(330);
    expect(mirrored.nodes[1].label).toBe('RM');
    expect(mirrored.paths[0].controlPoint?.x).toBeCloseTo(0.8, 3);
    expect(mirrored.zones?.[0].x).toBeCloseTo(0.8, 3);
  });

  it('evaluates quadratic bezier midpoint accurately', () => {
    const mid = evalQuadraticBezier({ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }, 0.5);
    expect(mid.x).toBeCloseTo(0.5, 4);
    expect(mid.y).toBeCloseTo(0.5, 4);
  });

  it('auto-generates keyframes from numbered paths and interpolates animation frames', () => {
    const board: TacticBoardData = {
      version: 1,
      courtTemplate: 'HALF_COURT_VERTICAL',
      nodes: [
        { id: 'rl', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.24, y: 0.48, hasBall: true },
        { id: 'rm', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.5, y: 0.52 }
      ],
      paths: [
        {
          id: 'p1',
          type: 'RUN_PATH',
          stepNumber: 1,
          fromNodeId: 'rl',
          points: [{ x: 0.24, y: 0.48 }, { x: 0.36, y: 0.38 }]
        },
        {
          id: 'p2',
          type: 'PASS_PATH',
          stepNumber: 2,
          fromNodeId: 'rl',
          toNodeId: 'rm',
          points: [{ x: 0.36, y: 0.38 }, { x: 0.5, y: 0.52 }]
        }
      ]
    };

    const animated = generateKeyframesFromPaths(board);
    expect(animated.version).toBe(2);
    expect(animated.keyframes).toHaveLength(3);
    expect(animated.keyframes?.[1].nodeStates.rl.x).toBeCloseTo(0.36, 3);
    expect(animated.keyframes?.[2].nodeStates.rm.hasBall).toBe(true);

    const midFrame = interpolateTacticBoardAtTime(animated, 700);
    const rlMid = midFrame.nodes.find((n) => n.id === 'rl');
    expect(rlMid?.x).toBeGreaterThan(0.24);
    expect(rlMid?.x).toBeLessThan(0.36);
  });

  it('detects whether an explicit multi-frame animation exists', () => {
    const baseBoard: TacticBoardData = {
      version: 1,
      courtTemplate: 'HALF_COURT_VERTICAL',
      nodes: [],
      paths: []
    };

    expect(hasExplicitTacticAnimation(undefined)).toBe(false);
    expect(hasExplicitTacticAnimation(null)).toBe(false);
    expect(hasExplicitTacticAnimation(baseBoard)).toBe(false);
    expect(hasExplicitTacticAnimation({ ...baseBoard, keyframes: [] })).toBe(false);
    expect(
      hasExplicitTacticAnimation({
        ...baseBoard,
        keyframes: [{ id: 'kf-0', index: 0, durationMs: 1400, nodeStates: {} }]
      })
    ).toBe(false);
    expect(
      hasExplicitTacticAnimation({
        ...baseBoard,
        keyframes: [
          { id: 'kf-0', index: 0, durationMs: 1400, nodeStates: {} },
          { id: 'kf-1', index: 1, durationMs: 1400, nodeStates: {} }
        ]
      })
    ).toBe(true);
  });

  it('animates simultaneous multi-ball passes for all pairs without collapsing to one ball', () => {
    const legacyLuftballonBoard: TacticBoardData = {
      version: 1,
      courtTemplate: 'FREE_SPACE',
      nodes: [
        { id: 'p1a', type: 'OFFENSE_PLAYER', label: 'P1 A', x: 0.25, y: 0.25, hasBall: true },
        { id: 'p1b', type: 'OFFENSE_PLAYER', label: 'P1 B', x: 0.25, y: 0.75 },
        { id: 'p2a', type: 'OFFENSE_PLAYER', label: 'P2 A', x: 0.5, y: 0.25, hasBall: true },
        { id: 'p2b', type: 'OFFENSE_PLAYER', label: 'P2 B', x: 0.5, y: 0.75 },
        { id: 'p3a', type: 'OFFENSE_PLAYER', label: 'P3 A', x: 0.75, y: 0.25, hasBall: true },
        { id: 'p3b', type: 'OFFENSE_PLAYER', label: 'P3 B', x: 0.75, y: 0.75 }
      ],
      paths: [
        { id: 'pass1', type: 'PASS_PATH', stepNumber: 1, fromNodeId: 'p1a', toNodeId: 'p1b', points: [{ x: 0.25, y: 0.25 }, { x: 0.25, y: 0.75 }] },
        { id: 'pass2', type: 'PASS_PATH', stepNumber: 1, fromNodeId: 'p2a', toNodeId: 'p2b', points: [{ x: 0.5, y: 0.25 }, { x: 0.5, y: 0.75 }] },
        { id: 'pass3', type: 'PASS_PATH', stepNumber: 1, fromNodeId: 'p3a', toNodeId: 'p3b', points: [{ x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }] }
      ]
    };

    const animated = generateKeyframesFromPaths(legacyLuftballonBoard);
    expect(animated.keyframes).toHaveLength(2);
    const kf0 = animated.keyframes![0];
    const kf1 = animated.keyframes![1];
    expect(kf0.nodeStates.p1a.hasBall).toBe(true);
    expect(kf0.nodeStates.p2a.hasBall).toBe(true);
    expect(kf0.nodeStates.p3a.hasBall).toBe(true);
    expect(kf1.nodeStates.p1a.hasBall).toBe(false);
    expect(kf1.nodeStates.p2a.hasBall).toBe(false);
    expect(kf1.nodeStates.p3a.hasBall).toBe(false);
    expect(kf1.nodeStates.p1b.hasBall).toBe(true);
    expect(kf1.nodeStates.p2b.hasBall).toBe(true);
    expect(kf1.nodeStates.p3b.hasBall).toBe(true);

    // Midpoint (timeMs = 700 into 1400ms transition) should show 3 distinct balls along x = 0.25, 0.5, 0.75
    const midFrame = interpolateTacticBoardAtTime(animated, 700);
    expect(midFrame.freeBallPositions).toHaveLength(3);
    expect(midFrame.freeBallPositions.map((b) => b.x)).toEqual([0.25, 0.5, 0.75]);
    for (const ball of midFrame.freeBallPositions) {
      expect(ball.y).toBeCloseTo(0.5, 3);
    }
    expect(midFrame.nodes.every((n) => !n.hasBall)).toBe(true);

    // At end of transition (segProgress >= 0.95), balls are held by p1b, p2b, p3b
    const endFrame = interpolateTacticBoardAtTime(animated, 1400);
    expect(endFrame.freeBallPositions).toHaveLength(0);
    expect(endFrame.nodes.find((n) => n.id === 'p1b')?.hasBall).toBe(true);
    expect(endFrame.nodes.find((n) => n.id === 'p2b')?.hasBall).toBe(true);
    expect(endFrame.nodes.find((n) => n.id === 'p3b')?.hasBall).toBe(true);
  });

  it('animates curved 2-step multi-ball back-and-forth passing and preserves unrelated ball holders', () => {
    const board: TacticBoardData = {
      version: 2,
      courtTemplate: 'FREE_SPACE',
      nodes: [
        { id: 'p1a', type: 'OFFENSE_PLAYER', label: 'P1 A', x: 0.25, y: 0.25, rotation: 180, hasBall: true },
        { id: 'p1b', type: 'OFFENSE_PLAYER', label: 'P1 B', x: 0.25, y: 0.75, rotation: 0 },
        { id: 'p2a', type: 'OFFENSE_PLAYER', label: 'P2 A', x: 0.5, y: 0.25, rotation: 180, hasBall: true },
        { id: 'p2b', type: 'OFFENSE_PLAYER', label: 'P2 B', x: 0.5, y: 0.75, rotation: 0 },
        { id: 'idle', type: 'OFFENSE_PLAYER', label: 'IDLE', x: 0.85, y: 0.5, hasBall: true }
      ],
      paths: [
        { id: 'pass1', type: 'PASS_PATH', stepNumber: 1, fromNodeId: 'p1a', toNodeId: 'p1b', controlPoint: { x: 0.21, y: 0.5 }, curved: true, points: [{ x: 0.25, y: 0.25 }, { x: 0.25, y: 0.75 }] },
        { id: 'pass2', type: 'PASS_PATH', stepNumber: 1, fromNodeId: 'p2a', toNodeId: 'p2b', controlPoint: { x: 0.46, y: 0.5 }, curved: true, points: [{ x: 0.5, y: 0.25 }, { x: 0.5, y: 0.75 }] },
        { id: 'pass1_back', type: 'PASS_PATH', stepNumber: 2, fromNodeId: 'p1b', toNodeId: 'p1a', controlPoint: { x: 0.29, y: 0.5 }, curved: true, points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0.25 }] },
        { id: 'pass2_back', type: 'PASS_PATH', stepNumber: 2, fromNodeId: 'p2b', toNodeId: 'p2a', controlPoint: { x: 0.54, y: 0.5 }, curved: true, points: [{ x: 0.5, y: 0.75 }, { x: 0.5, y: 0.25 }] }
      ]
    };

    const animated = generateKeyframesFromPaths(board);
    expect(animated.keyframes).toHaveLength(3);
    expect(animated.keyframes![1].nodeStates.idle.hasBall).toBe(true);
    expect(animated.keyframes![2].nodeStates.p1a.hasBall).toBe(true);
    expect(animated.keyframes![2].nodeStates.p2a.hasBall).toBe(true);
    expect(animated.keyframes![2].nodeStates.idle.hasBall).toBe(true);

    // Step 1 midpoint (700ms): 2 curved balls in flight, idle player still holds its ball
    const step1Mid = interpolateTacticBoardAtTime(animated, 700);
    expect(step1Mid.freeBallPositions).toHaveLength(2);
    expect(step1Mid.freeBallPositions[0].x).toBeCloseTo(0.23, 3);
    expect(step1Mid.freeBallPositions[1].x).toBeCloseTo(0.48, 3);
    expect(step1Mid.nodes.find((n) => n.id === 'idle')?.hasBall).toBe(true);

    // Step 2 midpoint (1700 + 700 = 2400ms): 2 curved return balls in flight
    const step2Mid = interpolateTacticBoardAtTime(animated, 2400);
    expect(step2Mid.freeBallPositions).toHaveLength(2);
    expect(step2Mid.freeBallPositions[0].x).toBeCloseTo(0.27, 3);
    expect(step2Mid.freeBallPositions[1].x).toBeCloseTo(0.52, 3);
    expect(step2Mid.nodes.find((n) => n.id === 'idle')?.hasBall).toBe(true);
  });
});
