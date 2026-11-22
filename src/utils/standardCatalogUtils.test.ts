import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types/domain';
import { parseAndNormalizeAiExerciseJson } from './aiExerciseImport';
import {
  computeStandardCatalogDelta,
  filterMissingExercisesForImport,
  isLocalDemoClub,
  normalizeStandardExerciseTitle,
  type StandardCatalogManifest
} from './standardCatalogUtils';

function makeExercise(
  id: string,
  title: string,
  overrides: Partial<Exercise> = {}
): Exercise {
  const now = '2026-11-22T12:00:00.000Z';
  return {
    id,
    club_id: '11111111-1111-4111-8111-111111111111',
    visibility: 'CLUB',
    title,
    default_duration_min: 15,
    min_players: 6,
    max_players: 14,
    goalkeepers: 1,
    categories: {
      phases: ['GROUND_EXERCISE'],
      focus: ['OFFENSE_GROUP'],
      level: 'BASIC',
      age_groups: ['C_YOUTH']
    },
    materials: [],
    setup_description: '',
    flow_description: '',
    coaching_points: '',
    variations_text: '',
    external_links: [],
    is_deleted: false,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

const sampleManifest: StandardCatalogManifest = {
  version: 1,
  generatedAt: '2026-11-22T12:00:00.000Z',
  totalFiles: 3,
  totalExercises: 5,
  files: [
    {
      filename: 'focus_catching.json',
      count: 2,
      titles: ['W-Form Fangen', 'Reaktions-Fangen']
    },
    {
      filename: 'focus_passing.json',
      count: 2,
      titles: ['Dreieckspass mit Tempo', 'Kreuzpass im Lauf']
    },
    {
      filename: 'phase_warmup.json',
      count: 1,
      titles: ['Parteiball 5gg5']
    }
  ]
};

describe('standardCatalogUtils', () => {
  const clubId = '11111111-1111-4111-8111-111111111111';

  it('normalizes titles across whitespace and case', () => {
    expect(normalizeStandardExerciseTitle('  W-Form   Fangen \n ')).toBe('w-form fangen');
  });

  it('reports all exercises and files as missing when club has none', () => {
    const delta = computeStandardCatalogDelta(sampleManifest, [], clubId);
    expect(delta.totalCatalogExercises).toBe(5);
    expect(delta.alreadyPresentCount).toBe(0);
    expect(delta.missingCount).toBe(5);
    expect(delta.missingFiles).toEqual([
      { filename: 'focus_catching.json', totalCount: 2, missingCount: 2 },
      { filename: 'focus_passing.json', totalCount: 2, missingCount: 2 },
      { filename: 'phase_warmup.json', totalCount: 1, missingCount: 1 }
    ]);
  });

  it('computes partial delta and skips files that have zero missing exercises', () => {
    const existing = [
      makeExercise('e1', '  w-form   fangen '),
      makeExercise('e2', 'Reaktions-Fangen'),
      makeExercise('e3', 'Dreieckspass mit Tempo')
    ];

    const delta = computeStandardCatalogDelta(sampleManifest, existing, clubId);
    expect(delta.totalCatalogExercises).toBe(5);
    expect(delta.alreadyPresentCount).toBe(3);
    expect(delta.missingCount).toBe(2);
    expect(delta.missingFiles).toEqual([
      { filename: 'focus_passing.json', totalCount: 2, missingCount: 1 },
      { filename: 'phase_warmup.json', totalCount: 1, missingCount: 1 }
    ]);
  });

  it('returns zero missing files when all standard exercises are present', () => {
    const existing = [
      makeExercise('e1', 'W-Form Fangen'),
      makeExercise('e2', 'Reaktions-Fangen'),
      makeExercise('e3', 'Dreieckspass mit Tempo'),
      makeExercise('e4', 'Kreuzpass im Lauf'),
      makeExercise('e5', 'Parteiball 5gg5')
    ];

    const delta = computeStandardCatalogDelta(sampleManifest, existing, clubId);
    expect(delta.alreadyPresentCount).toBe(5);
    expect(delta.missingCount).toBe(0);
    expect(delta.missingFiles).toEqual([]);
  });

  it('ignores soft-deleted exercises and exercises belonging to other clubs', () => {
    const existing = [
      makeExercise('e1', 'W-Form Fangen', { is_deleted: true }),
      makeExercise('e2', 'Reaktions-Fangen', {
        club_id: '22222222-2222-4222-8222-222222222222'
      }),
      makeExercise('e3', 'Parteiball 5gg5')
    ];

    const delta = computeStandardCatalogDelta(sampleManifest, existing, clubId);
    expect(delta.alreadyPresentCount).toBe(1);
    expect(delta.missingCount).toBe(4);
    expect(delta.missingFiles.map((f) => f.filename)).toEqual([
      'focus_catching.json',
      'focus_passing.json'
    ]);
  });

  it('filters out duplicates both against existing titles and within the same import batch', () => {
    const existingTitles = new Set<string>(['w-form fangen']);
    const incoming = [
      makeExercise('n1', 'W-Form Fangen'),
      makeExercise('n2', 'Reaktions-Fangen'),
      makeExercise('n3', '  reaktions-fangen ')
    ];

    const filtered = filterMissingExercisesForImport(incoming, existingTitles);
    expect(filtered.map((ex) => ex.id)).toEqual(['n2']);
    expect(existingTitles.has('reaktions-fangen')).toBe(true);
  });

  it('detects local demo mode correctly', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const userUuid = '99999999-9999-4999-8999-999999999999';

    expect(isLocalDemoClub('club-sgh-1', userUuid, true)).toBe(true);
    expect(isLocalDemoClub(validUuid, null, true)).toBe(true);
    expect(isLocalDemoClub(validUuid, userUuid, false)).toBe(true);
    expect(isLocalDemoClub(undefined, userUuid, true)).toBe(true);
    expect(isLocalDemoClub('non-uuid-id', userUuid, true)).toBe(true);
    expect(isLocalDemoClub(validUuid, userUuid, true)).toBe(false);
  });

  it('validates all deployed JSON catalog files in docs/ai_import parse cleanly without auto-animation', () => {
    const catalogDir = path.resolve(process.cwd(), 'docs/ai_import');
    const jsonFiles = fs
      .readdirSync(catalogDir)
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    expect(jsonFiles.length).toBe(33);

    const clubUuid = '11111111-1111-4111-8111-111111111111';
    const allNormalized: Exercise[] = [];
    for (const file of jsonFiles) {
      const raw = fs.readFileSync(path.join(catalogDir, file), 'utf8');
      const parsed = parseAndNormalizeAiExerciseJson(raw, clubUuid, 'CLUB', undefined, false);
      expect(parsed.length).toBeGreaterThan(0);
      allNormalized.push(...parsed);
    }

    expect(allNormalized).toHaveLength(511);
    const uniqueTitles = new Set(
      allNormalized.map((ex) => normalizeStandardExerciseTitle(ex.title))
    );
    expect(uniqueTitles.size).toBe(511);

    // Every raw focus tag across all 511 exercises must survive normalization without fallback loss
    for (const file of jsonFiles) {
      const rawArr = JSON.parse(
        fs.readFileSync(path.join(catalogDir, file), 'utf8')
      ) as Array<{ title: string; categories: { focus: string[] } }>;
      const parsedArr = parseAndNormalizeAiExerciseJson(
        fs.readFileSync(path.join(catalogDir, file), 'utf8'),
        clubUuid,
        'CLUB',
        undefined,
        false
      );
      parsedArr.forEach((parsedEx, idx) => {
        const expectedFocus = Array.from(new Set(rawArr[idx].categories.focus));
        expect(parsedEx.categories.focus).toEqual(expectedFocus);
      });
    }
  });

  it('enforces clean DHB handball domain tag rules across all 511 standard exercises', () => {
    const catalogDir = path.resolve(process.cwd(), 'docs/ai_import');
    const jsonFiles = fs
      .readdirSync(catalogDir)
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    const clubUuid = '11111111-1111-4111-8111-111111111111';
    const allExercises: Exercise[] = [];
    for (const file of jsonFiles) {
      const raw = fs.readFileSync(path.join(catalogDir, file), 'utf8');
      allExercises.push(...parseAndNormalizeAiExerciseJson(raw, clubUuid, 'CLUB', undefined, false));
    }

    const forbiddenCoolDownFocus = new Set([
      'FAST_BREAK_1ST_WAVE',
      'GOALKEEPER_TECHNIQUE',
      'OFFENSE_TEAM',
      'RETREAT'
    ]);
    const youngerThanC = new Set(['MINIS', 'F_YOUTH', 'E_YOUTH', 'D_YOUTH']);

    for (const ex of allExercises) {
      if (ex.categories.phases.includes('GOALKEEPER_WARMUP')) {
        expect(ex.goalkeepers, `${ex.title} requires >= 1 GK`).toBeGreaterThanOrEqual(1);
        expect(
          ex.categories.phases.includes('WARMUP'),
          `${ex.title} should not mix GOALKEEPER_WARMUP and WARMUP`
        ).toBe(false);
      }

      if (ex.categories.phases.includes('COOL_DOWN')) {
        expect(
          ex.categories.focus.includes('REGENERATION_MOBILITY'),
          `${ex.title} must include REGENERATION_MOBILITY`
        ).toBe(true);
        for (const tag of ex.categories.focus) {
          expect(
            forbiddenCoolDownFocus.has(tag),
            `${ex.title} must not have misleading focus tag ${tag}`
          ).toBe(false);
        }
      }

      if (
        ex.categories.focus.includes('DEFENSE_6_0') ||
        ex.categories.focus.includes('DEFENSE_5_1')
      ) {
        for (const ag of ex.categories.age_groups) {
          expect(
            youngerThanC.has(ag),
            `${ex.title} uses 6:0/5:1 and should not target ${ag}`
          ).toBe(false);
        }
      }
    }

    const schnelleMitte = allExercises.find(
      (ex) => ex.title === 'Schnelle Mitte mit Torwart-Passkette und Seitenwechsel'
    );
    expect(schnelleMitte).toBeDefined();
    expect(schnelleMitte?.categories.phases.includes('WARMUP')).toBe(false);
    expect(schnelleMitte?.categories.focus).toContain('SHOOTING');
    expect(schnelleMitte?.categories.focus).toContain('JUMP_SHOT');

    const siebenMeterStress = allExercises.find(
      (ex) => ex.title === 'Wurf-Wettkampf 7-Meter-Nervenstärke unter Vorbelastung'
    );
    expect(siebenMeterStress).toBeDefined();
    expect(siebenMeterStress?.categories.phases.includes('COOL_DOWN')).toBe(false);
  });

  it('validates tactic board geometry, orientation, refs, and node spacing across all 511 exercises', () => {
    const catalogDir = path.resolve(process.cwd(), 'docs/ai_import');
    const jsonFiles = fs
      .readdirSync(catalogDir)
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    const validTemplates = new Set([
      'HALF_COURT_VERTICAL',
      'FULL_COURT',
      'GOAL_SECTOR_ZOOM',
      'FREE_SPACE'
    ]);
    const validNodeTypes = new Set([
      'OFFENSE_PLAYER',
      'DEFENSE_PLAYER',
      'GOALKEEPER',
      'COACH_FEEDER',
      'EQUIPMENT_CONE',
      'EQUIPMENT_MAT',
      'EQUIPMENT_GOAL_TARGET',
      'WAYPOINT'
    ]);
    const validPathTypes = new Set([
      'RUN_PATH',
      'PASS_PATH',
      'DRIBBLE_PATH',
      'SHOT_PATH',
      'SCREEN_BLOCK_PATH',
      'FEINT_PATH'
    ]);

    const clubUuid = '11111111-1111-4111-8111-111111111111';
    const allExercises: Exercise[] = [];
    for (const file of jsonFiles) {
      const raw = fs.readFileSync(path.join(catalogDir, file), 'utf8');
      allExercises.push(...parseAndNormalizeAiExerciseJson(raw, clubUuid, 'CLUB', undefined, false));
    }

    expect(allExercises).toHaveLength(511);

    for (const ex of allExercises) {
      const board = ex.tactic_board_data;
      expect(board, `${ex.title} missing tactic_board_data`).toBeDefined();
      if (!board) continue;

      expect(
        validTemplates.has(board.courtTemplate),
        `${ex.title} invalid courtTemplate ${board.courtTemplate}`
      ).toBe(true);
      expect(board.keyframes, `${ex.title} must not ship auto-generated keyframes`).toBeUndefined();
      expect(board.nodes.length, `${ex.title} must have nodes`).toBeGreaterThan(0);

      const nodeMap = new Map(board.nodes.map((n) => [n.id, n]));
      for (const node of board.nodes) {
        expect(validNodeTypes.has(node.type), `${ex.title} invalid node type ${node.type}`).toBe(true);
        expect(node.x, `${ex.title} node ${node.id} x out of bounds`).toBeGreaterThanOrEqual(0.04);
        expect(node.x, `${ex.title} node ${node.id} x out of bounds`).toBeLessThanOrEqual(0.96);
        expect(node.y, `${ex.title} node ${node.id} y out of bounds`).toBeGreaterThanOrEqual(0.04);
        expect(node.y, `${ex.title} node ${node.id} y out of bounds`).toBeLessThanOrEqual(0.96);
      }

      const nonWaypoints = board.nodes.filter((n) => n.type !== 'WAYPOINT');
      for (let i = 0; i < nonWaypoints.length; i++) {
        for (let j = i + 1; j < nonWaypoints.length; j++) {
          const a = nonWaypoints[i];
          const b = nonWaypoints[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          expect(
            dist,
            `${ex.title}: overlap between ${a.id} and ${b.id} (dist=${dist.toFixed(3)})`
          ).toBeGreaterThanOrEqual(0.035);
        }
      }

      for (const p of board.paths) {
        expect(validPathTypes.has(p.type), `${ex.title} invalid path type ${p.type}`).toBe(true);
        expect(p.points.length, `${ex.title} path ${p.id} needs >= 2 points`).toBeGreaterThanOrEqual(2);

        const startRefId = p.fromNodeId || p.fromWaypointId;
        if (startRefId) {
          const refNode = nodeMap.get(startRefId);
          expect(refNode, `${ex.title} path ${p.id} dangling start ref ${startRefId}`).toBeDefined();
          if (refNode) {
            expect(
              Math.hypot(refNode.x - p.points[0].x, refNode.y - p.points[0].y),
              `${ex.title} path ${p.id} start detached from ${startRefId}`
            ).toBeLessThanOrEqual(0.06);
          }
        }

        const endRefId = p.toNodeId || p.toWaypointId;
        if (endRefId) {
          const refNode = nodeMap.get(endRefId);
          expect(refNode, `${ex.title} path ${p.id} dangling end ref ${endRefId}`).toBeDefined();
          if (refNode) {
            const last = p.points[p.points.length - 1];
            expect(
              Math.hypot(refNode.x - last.x, refNode.y - last.y),
              `${ex.title} path ${p.id} end detached from ${endRefId}`
            ).toBeLessThanOrEqual(0.06);
          }
        }
      }

      const gkNodes = board.nodes.filter((n) => n.type === 'GOALKEEPER');
      if (ex.goalkeepers === 0) {
        expect(gkNodes, `${ex.title} has goalkeepers=0`).toHaveLength(0);
      } else {
        expect(gkNodes.length, `${ex.title} has goalkeepers=${ex.goalkeepers}`).toBeGreaterThanOrEqual(1);
      }

      if (board.courtTemplate === 'FULL_COURT') {
        if (ex.goalkeepers === 2) {
          expect(gkNodes.length, `${ex.title} FULL_COURT needs 2 GKs`).toBeGreaterThanOrEqual(2);
        }
        for (const gk of gkNodes) {
          expect(
            gk.x <= 0.18 || gk.x >= 0.82,
            `${ex.title} FULL_COURT GK ${gk.id} must be horizontal left/right (got x=${gk.x}, y=${gk.y})`
          ).toBe(true);
        }
      }

      if (board.courtTemplate === 'HALF_COURT_VERTICAL') {
        const fieldPlayers = board.nodes.filter(
          (n) => n.type === 'OFFENSE_PLAYER' || n.type === 'DEFENSE_PLAYER'
        );
        for (const fp of fieldPlayers) {
          if (fp.y >= 0.043) {
            const ell = ((fp.x - 0.5) / 0.24) ** 2 + ((fp.y - 0.043) / 0.2) ** 2;
            expect(
              ell,
              `${ex.title}: ${fp.id} (${fp.x},${fp.y}) inside 6m crease`
            ).toBeGreaterThanOrEqual(0.72);
          }
        }
      }
    }

    const schnelleMitte = allExercises.find(
      (ex) => ex.title === 'Schnelle Mitte mit Torwart-Passkette und Seitenwechsel'
    );
    expect(schnelleMitte?.tactic_board_data?.courtTemplate).toBe('FULL_COURT');
    const smGks = schnelleMitte?.tactic_board_data?.nodes.filter((n) => n.type === 'GOALKEEPER') ?? [];
    expect(smGks.some((g) => g.x <= 0.15)).toBe(true);
    expect(smGks.some((g) => g.x >= 0.85)).toBe(true);
    expect(
      (schnelleMitte?.tactic_board_data?.nodes ?? []).some((n) => n.type === 'EQUIPMENT_CONE')
    ).toBe(true);

    const ersterGegenstoss = allExercises.find((ex) =>
      ex.title.startsWith('Klassischer Gegenstoß-Laufweg')
    );
    expect(ersterGegenstoss?.tactic_board_data?.courtTemplate).toBe('FULL_COURT');
    const egGks =
      ersterGegenstoss?.tactic_board_data?.nodes.filter((n) => n.type === 'GOALKEEPER') ?? [];
    expect(egGks.some((g) => g.x <= 0.15)).toBe(true);
    expect(egGks.some((g) => g.x >= 0.85)).toBe(true);

    const wandball = allExercises.find((ex) => ex.title === 'Wandball (Aufwärmspiel)');
    expect(wandball?.tactic_board_data?.courtTemplate).toBe('FREE_SPACE');
  });
});
