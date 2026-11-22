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
});
