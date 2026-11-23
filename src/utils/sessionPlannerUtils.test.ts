import { describe, expect, it } from 'vitest';
import {
  buildSessionFromTemplate,
  cloneTrainingSessionBundle,
  convertQuickBlockToCatalogExercise,
  createDefaultPlannerCatalogFilters,
  moveBlockInPhase,
  movePhaseInSession,
  reconcilePlannerStateForTeamChange,
  sanitizePlannerCatalogFilters,
  selectDefaultSession,
  selectNextSessionAfterCompletion,
  toggleBlockParallelWithPrevious
} from './sessionPlannerUtils';
import type { SessionBlock, SessionPhase, SessionStatus, TrainingSession } from '../types/domain';

describe('sessionPlannerUtils', () => {
  it('creates a session bundle from a template with default phases and exercise blocks', () => {
    const bundle = buildSessionFromTemplate({
      teamId: 'team-mb',
      sessionDate: '2026-11-19',
      startTime: '18:30',
      endTime: '20:00',
      title: 'Donnerstagstraining',
      template: {
        id: 'tpl-1',
        club_id: 'club-1',
        title: 'Standard 90',
        description: '',
        default_duration_min: 90,
        phases_template: [
          { name: 'Aufwärmen', target_duration_min: 15, default_exercise_id: 'ex-1' },
          { name: 'Hauptteil', target_duration_min: 45 }
        ],
        updated_at: new Date().toISOString()
      }
    });

    expect(bundle.session.planned_duration_min).toBe(90);
    expect(bundle.phases).toHaveLength(2);
    expect(bundle.blocks).toHaveLength(1);
    expect(bundle.blocks[0].exercise_id).toBe('ex-1');
  });

  it('clones an existing session bundle with new IDs while preserving phase/block links', () => {
    const original = buildSessionFromTemplate({
      teamId: 'team-mb',
      sessionDate: '2026-11-17',
      startTime: '18:30',
      endTime: '20:00',
      title: 'Dienstag'
    });

    const cloned = cloneTrainingSessionBundle({
      sourceSession: original.session,
      sourcePhases: original.phases,
      sourceBlocks: [
        {
          id: 'b-orig',
          session_phase_id: original.phases[0].id,
          quick_block_title: 'Sprint-Staffel',
          time_slot_index: 0,
          track_label: 'Alle',
          custom_duration_min: 15,
          updated_at: new Date().toISOString()
        }
      ],
      newDate: '2026-11-24',
      newTitle: 'Dienstag Nächste Woche'
    });

    expect(cloned.session.id).not.toBe(original.session.id);
    expect(cloned.session.session_date).toBe('2026-11-24');
    expect(cloned.phases).toHaveLength(5);
    expect(cloned.blocks).toHaveLength(1);
    expect(cloned.blocks[0].session_phase_id).toBe(cloned.phases[0].id);
  });

  it('converts a Quick-Block into a full catalog exercise and links the block', () => {
    const quickBlock = {
      id: 'block-quick-1',
      session_phase_id: 'phase-1',
      quick_block_title: '4gg4 Überzahl-Kontinuum',
      quick_block_description: 'Schnelles Weiterspielen bis zum freien Außen.',
      time_slot_index: 0,
      track_label: 'Alle Spieler',
      custom_duration_min: 20,
      updated_at: new Date().toISOString()
    };

    const { exercise, updatedBlock } = convertQuickBlockToCatalogExercise({
      block: quickBlock,
      clubId: 'club-1',
      teamId: 'team-mb',
      focusTags: ['OFFENSE_GROUP']
    });

    expect(exercise.title).toBe('4gg4 Überzahl-Kontinuum');
    expect(exercise.default_duration_min).toBe(20);
    expect(updatedBlock.exercise_id).toBe(exercise.id);
    expect(updatedBlock.quick_block_title).toBeUndefined();
  });

  it('moves sequential and parallel blocks up/down within a phase', () => {
    const now = '2026-11-17T10:00:00.000Z';
    const blocks: SessionBlock[] = [
      { id: 'b1', session_phase_id: 'p1', time_slot_index: 0, track_label: 'Alle', custom_duration_min: 10, updated_at: now },
      { id: 'b2', session_phase_id: 'p1', time_slot_index: 2, track_label: 'Spur A', custom_duration_min: 15, updated_at: now },
      { id: 'b3', session_phase_id: 'p1', time_slot_index: 2, track_label: 'Spur B', custom_duration_min: 15, updated_at: now },
      { id: 'b4', session_phase_id: 'p1', time_slot_index: 5, track_label: 'Alle', custom_duration_min: 10, updated_at: now }
    ];

    // Move b1 DOWN: swaps slot 0 with slot [b2, b3]
    const movedDown = moveBlockInPhase(blocks, 'b1', 'DOWN');
    const slotByIdDown = new Map(movedDown.map((b) => [b.id, b.time_slot_index]));
    expect(slotByIdDown.get('b2')).toBe(0);
    expect(slotByIdDown.get('b3')).toBe(0);
    expect(slotByIdDown.get('b1')).toBe(1);
    expect(slotByIdDown.get('b4')).toBe(2);

    // Move b2 UP from parallel slot: splits out before b3
    const splitUp = moveBlockInPhase(blocks, 'b2', 'UP');
    const slotByIdSplit = new Map(splitUp.map((b) => [b.id, b.time_slot_index]));
    expect(slotByIdSplit.get('b2')).toBe(1);
    expect(slotByIdSplit.get('b4')).toBe(3);

    // Move b1 UP when already first: no changes
    expect(moveBlockInPhase(blocks, 'b1', 'UP')).toHaveLength(0);
  });

  it('toggles a block between parallel with previous and its own sequential slot', () => {
    const now = '2026-11-17T10:00:00.000Z';
    const blocks: SessionBlock[] = [
      { id: 'b1', session_phase_id: 'p1', time_slot_index: 0, track_label: 'Alle', custom_duration_min: 10, updated_at: now },
      { id: 'b2', session_phase_id: 'p1', time_slot_index: 1, track_label: 'Alle', custom_duration_min: 15, updated_at: now }
    ];

    const merged = toggleBlockParallelWithPrevious(blocks, 'b2');
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('b2');
    expect(merged[0].time_slot_index).toBe(0);

    const updatedBlocks = blocks.map((b) => (b.id === 'b2' ? { ...b, time_slot_index: 0 } : b));
    const split = toggleBlockParallelWithPrevious(updatedBlocks, 'b2');
    expect(split).toHaveLength(1);
    expect(split[0].id).toBe('b2');
    expect(split[0].time_slot_index).toBe(1);
  });

  it('reorders phases within a session cleanly', () => {
    const now = '2026-11-17T10:00:00.000Z';
    const phases: SessionPhase[] = [
      { id: 'p1', training_session_id: 's1', name: 'Phase 1', sort_order: 1, target_duration_min: 15, updated_at: now },
      { id: 'p2', training_session_id: 's1', name: 'Phase 2', sort_order: 2, target_duration_min: 20, updated_at: now },
      { id: 'p3', training_session_id: 's1', name: 'Phase 3', sort_order: 3, target_duration_min: 15, updated_at: now }
    ];

    const moved = movePhaseInSession(phases, 'p2', 'UP');
    expect(moved).toHaveLength(2);
    expect(moved.find((p) => p.id === 'p2')?.sort_order).toBe(1);
    expect(moved.find((p) => p.id === 'p1')?.sort_order).toBe(2);
  });

  it('selects the next upcoming open session rather than the first or last', () => {
    const makeSession = (
      id: string,
      session_date: string,
      status: SessionStatus = 'PLANNED',
      start_time = '18:30'
    ): TrainingSession => ({
      id,
      team_id: 'team-mb',
      session_date,
      start_time,
      end_time: '20:00',
      planned_duration_min: 90,
      title: `Training ${session_date}`,
      custom_materials_override: [],
      status,
      updated_at: '2026-11-20T09:00:00.000Z'
    });

    const sessions = [
      makeSession('s-17', '2026-11-17', 'PLANNED'),
      makeSession('s-19', '2026-11-19', 'COMPLETED'),
      makeSession('s-24', '2026-11-24', 'PLANNED'),
      makeSession('s-26', '2026-11-26', 'PLANNED')
    ];

    // On 2026-11-20, should pick 2026-11-24 (next upcoming), not 2026-11-17 or 2026-11-26
    expect(selectDefaultSession(sessions, '2026-11-20')?.id).toBe('s-24');

    // If today (2026-11-20) has a READY session, pick today
    const withToday = [...sessions, makeSession('s-20', '2026-11-20', 'READY')];
    expect(selectDefaultSession(withToday, '2026-11-20')?.id).toBe('s-20');

    // If today's session is COMPLETED and 24th is CANCELLED, pick 26th
    const skipped = [
      makeSession('s-17', '2026-11-17', 'COMPLETED'),
      makeSession('s-20', '2026-11-20', 'COMPLETED'),
      makeSession('s-24', '2026-11-24', 'CANCELLED'),
      makeSession('s-26', '2026-11-26', 'PLANNED')
    ];
    expect(selectDefaultSession(skipped, '2026-11-20')?.id).toBe('s-26');

    // If all sessions are completed in the past, fall back to the most recent one
    const allCompleted = [
      makeSession('s-10', '2026-11-10', 'COMPLETED'),
      makeSession('s-17', '2026-11-17', 'COMPLETED')
    ];
    expect(selectDefaultSession(allCompleted, '2026-11-20')?.id).toBe('s-17');

    expect(selectDefaultSession([], '2026-11-20')).toBeNull();
  });

  it('advances to the next open session in dropdown order when a session is completed', () => {
    const makeSession = (
      id: string,
      session_date: string,
      status: SessionStatus = 'PLANNED',
      start_time = '18:30'
    ): TrainingSession => ({
      id,
      team_id: 'team-mb',
      session_date,
      start_time,
      end_time: '20:00',
      planned_duration_min: 90,
      title: `Training ${session_date}`,
      custom_materials_override: [],
      status,
      updated_at: '2026-11-20T09:00:00.000Z'
    });

    const sessions = [
      makeSession('s-17', '2026-11-17', 'COMPLETED'),
      makeSession('s-20-a', '2026-11-20', 'READY', '17:00'),
      makeSession('s-20-b', '2026-11-20', 'PLANNED', '19:00'),
      makeSession('s-24', '2026-11-24', 'COMPLETED'),
      makeSession('s-26', '2026-11-26', 'PLANNED')
    ];

    // Completing 20.11 17:00 advances to 20.11 19:00
    expect(selectNextSessionAfterCompletion(sessions, 's-20-a', '2026-11-20')?.id).toBe('s-20-b');

    // Completing 20.11 19:00 skips already-completed 24.11 and advances to 26.11
    expect(selectNextSessionAfterCompletion(sessions, 's-20-b', '2026-11-20')?.id).toBe('s-26');

    // Completing the last session (26.11) falls back to another remaining open session
    expect(selectNextSessionAfterCompletion(sessions, 's-26', '2026-11-20')?.id).toBe('s-20-a');

    // If no other non-completed session exists, returns null
    const onlyOneOpen = [
      makeSession('s-17', '2026-11-17', 'COMPLETED'),
      makeSession('s-20', '2026-11-20', 'READY')
    ];
    expect(selectNextSessionAfterCompletion(onlyOneOpen, 's-20', '2026-11-20')).toBeNull();
  });

  it('builds default planner filters with or without a team age group', () => {
    expect(createDefaultPlannerCatalogFilters('B_YOUTH')).toEqual({
      catalogTab: 'SMART_FOCUS',
      catalogSearch: '',
      catalogAgeGroup: 'B_YOUTH',
      catalogPhase: 'ALL',
      catalogFocusTag: 'ALL'
    });

    expect(createDefaultPlannerCatalogFilters(null)).toEqual({
      catalogTab: 'SMART_FOCUS',
      catalogSearch: '',
      catalogAgeGroup: 'ALL',
      catalogPhase: 'ALL',
      catalogFocusTag: 'ALL'
    });
  });

  it('sanitizes persisted planner filters while preserving explicit ALL age group', () => {
    expect(
      sanitizePlannerCatalogFilters(
        {
          catalogTab: 'ALL',
          catalogSearch: 'Kreis',
          catalogAgeGroup: 'ALL',
          catalogPhase: 'GROUND_GAME',
          catalogFocusTag: 'SHOOTING'
        },
        'B_YOUTH'
      )
    ).toEqual({
      catalogTab: 'ALL',
      catalogSearch: 'Kreis',
      catalogAgeGroup: 'ALL',
      catalogPhase: 'GROUND_GAME',
      catalogFocusTag: 'SHOOTING'
    });

    expect(
      sanitizePlannerCatalogFilters(
        {
          catalogTab: 'INVALID_TAB',
          catalogSearch: 123,
          catalogAgeGroup: 'INVALID_AGE',
          catalogPhase: 'INVALID_PHASE',
          catalogFocusTag: 'INVALID_TAG'
        },
        'C_YOUTH'
      )
    ).toEqual({
      catalogTab: 'SMART_FOCUS',
      catalogSearch: '',
      catalogAgeGroup: 'C_YOUTH',
      catalogPhase: 'ALL',
      catalogFocusTag: 'ALL'
    });
  });

  it('reconciles planner state across initial mount, history restore, team switch, age edit, and no-op', () => {
    const customFilters = {
      catalogTab: 'ALL' as const,
      catalogSearch: 'Gegenstoß',
      catalogAgeGroup: 'C_YOUTH' as const,
      catalogPhase: 'GROUND_EXERCISE' as const,
      catalogFocusTag: 'FAST_BREAK_1ST_WAVE' as const
    };

    // 1. Initial load without history snapshot
    const initial = reconcilePlannerStateForTeamChange({
      previousContext: null,
      nextContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      currentFilters: createDefaultPlannerCatalogFilters(null),
      currentSessionId: 'sess-1',
      currentPhaseId: 'phase-1'
    });
    expect(initial.changed).toBe(true);
    expect(initial.filters.catalogAgeGroup).toBe('B_YOUTH');
    expect(initial.sessionId).toBe('sess-1');
    expect(initial.phaseId).toBe('phase-1');

    // 2. Initial load with matching history snapshot
    const restored = reconcilePlannerStateForTeamChange({
      previousContext: null,
      nextContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      currentFilters: createDefaultPlannerCatalogFilters(null),
      currentSessionId: '',
      currentPhaseId: '',
      historySnapshot: {
        teamId: 'team-mb',
        sessionId: 'sess-2',
        phaseId: 'phase-3',
        filters: customFilters
      }
    });
    expect(restored.changed).toBe(true);
    expect(restored.filters).toEqual(customFilters);
    expect(restored.sessionId).toBe('sess-2');
    expect(restored.phaseId).toBe('phase-3');

    // 3. Switching teams resets filters to new team's age group and clears session/phase
    const switched = reconcilePlannerStateForTeamChange({
      previousContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      nextContext: { teamId: 'team-m1', ageGroup: 'ADULTS' },
      currentFilters: customFilters,
      currentSessionId: 'sess-2',
      currentPhaseId: 'phase-3'
    });
    expect(switched.changed).toBe(true);
    expect(switched.filters).toEqual(createDefaultPlannerCatalogFilters('ADULTS'));
    expect(switched.sessionId).toBe('');
    expect(switched.phaseId).toBe('');

    // 4. Editing active team's age group updates only catalogAgeGroup
    const editedAge = reconcilePlannerStateForTeamChange({
      previousContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      nextContext: { teamId: 'team-mb', ageGroup: 'A_YOUTH' },
      currentFilters: customFilters,
      currentSessionId: 'sess-2',
      currentPhaseId: 'phase-3'
    });
    expect(editedAge.changed).toBe(true);
    expect(editedAge.filters).toEqual({
      ...customFilters,
      catalogAgeGroup: 'A_YOUTH'
    });
    expect(editedAge.sessionId).toBe('sess-2');
    expect(editedAge.phaseId).toBe('phase-3');

    // 5. Same team and age group is a no-op (preserves user filters)
    const noop = reconcilePlannerStateForTeamChange({
      previousContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      nextContext: { teamId: 'team-mb', ageGroup: 'B_YOUTH' },
      currentFilters: customFilters,
      currentSessionId: 'sess-2',
      currentPhaseId: 'phase-3'
    });
    expect(noop.changed).toBe(false);
    expect(noop.filters).toEqual(customFilters);
  });
});
