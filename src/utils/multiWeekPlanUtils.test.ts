import { describe, expect, it } from 'vitest';
import {
  buildGermanCalendarMonthGrid,
  buildMultiWeekPlanDeletionPlan,
  formatIsoDateDe,
  generateMultiWeekPlanBundle,
  getIsoWeekNumber,
  getMondayOfIsoWeek,
  getUpcomingMondayIso,
  selectActiveMultiWeekPlan,
  selectCurrentPlanWeek
} from './multiWeekPlanUtils';
import type {
  MultiWeekPlan,
  PlanWeek,
  SessionBlock,
  SessionNote,
  SessionPhase,
  Team,
  TrainingSession
} from '../types/domain';

describe('multiWeekPlanUtils', () => {
  it('normalizes any date to the Monday of its ISO week', () => {
    // 2026-11-18 is a Wednesday -> Monday is 2026-11-16
    expect(getMondayOfIsoWeek('2026-11-18')).toBe('2026-11-16');
  });

  it('generates weeks and automatic training sessions matching the team schedule', () => {
    const mockTeam: Team = {
      id: 'team-test',
      club_id: 'club-1',
      name: 'mB-Jugend',
      age_group: 'U17',
      season: '2026/27',
      default_schedule: [
        { id: 's1', weekday: 2, weekdayLabel: 'Dienstag', startTime: '18:30', endTime: '20:00' },
        { id: 's2', weekday: 4, weekdayLabel: 'Donnerstag', startTime: '18:30', endTime: '20:00' }
      ],
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const bundle = generateMultiWeekPlanBundle({
      team: mockTeam,
      title: 'Vorbereitung Block 1',
      startDate: '2026-11-16',
      weekCount: 3,
      goals: 'Abwehr & Gegenstoß'
    });

    expect(bundle.weeks).toHaveLength(3);
    // 3 weeks * 2 training days per week (Tue & Thu) = 6 training sessions automatically generated!
    expect(bundle.sessions).toHaveLength(6);
    expect(bundle.sessions[0].session_date).toBe('2026-11-17'); // Tuesday of week 1
    expect(bundle.sessions[1].session_date).toBe('2026-11-19'); // Thursday of week 1
  });

  it('formats ISO dates in German DD.MM.YYYY and computes ISO week numbers accurately', () => {
    expect(formatIsoDateDe('2026-12-07')).toBe('07.12.2026');
    expect(formatIsoDateDe('invalid')).toBe('invalid');
    expect(getIsoWeekNumber('2026-12-07')).toBe(50);
    // 2025-12-29 is Monday of ISO week 1 of 2026
    expect(getIsoWeekNumber('2025-12-29')).toBe(1);
    // 2026-12-31 is Thursday of ISO week 53
    expect(getIsoWeekNumber('2026-12-31')).toBe(53);
  });

  it('resolves upcoming Monday from Monday, mid-week, and Sunday dates', () => {
    expect(getUpcomingMondayIso('2026-11-23')).toBe('2026-11-23');
    expect(getUpcomingMondayIso('2026-11-22')).toBe('2026-11-23');
    expect(getUpcomingMondayIso('2026-11-25')).toBe('2026-11-30');
  });

  it('builds a Monday-first German month grid with 7 days per week row', () => {
    const dec2026 = buildGermanCalendarMonthGrid(2026, 11); // December 2026
    expect(dec2026.length).toBeGreaterThanOrEqual(5);
    expect(dec2026[0].mondayIso).toBe('2026-11-30');
    expect(dec2026[0].isoWeek).toBe(49);
    for (const row of dec2026) {
      expect(row.days).toHaveLength(7);
    }
    expect(dec2026[1].mondayIso).toBe('2026-12-07');
    expect(dec2026[1].isoWeek).toBe(50);
  });

  it('selects the active mesocycle plan and current week matching todayIso', () => {
    const now = '2026-11-22T12:00:00.000Z';
    const plans: MultiWeekPlan[] = [
      { id: 'past', team_id: 't1', title: 'Past', start_date: '2026-09-07', end_date: '2026-10-04', goals: '', updated_at: now },
      { id: 'current', team_id: 't1', title: 'Current', start_date: '2026-11-09', end_date: '2026-12-06', goals: '', updated_at: now },
      { id: 'future', team_id: 't1', title: 'Future', start_date: '2026-12-07', end_date: '2027-01-03', goals: '', updated_at: now }
    ];

    expect(selectActiveMultiWeekPlan(plans, '2026-11-22')?.id).toBe('current');
    expect(selectActiveMultiWeekPlan([plans[0], plans[2]], '2026-11-22')?.id).toBe('future');
    expect(selectActiveMultiWeekPlan([plans[0]], '2026-11-22')?.id).toBe('past');

    const weeks: PlanWeek[] = [
      { id: 'w1', multi_week_plan_id: 'current', week_number: 1, start_date: '2026-11-09', focus_theme: 'W1', focus_tags: [], color_hex: '#000', notes: '', updated_at: now },
      { id: 'w2', multi_week_plan_id: 'current', week_number: 2, start_date: '2026-11-16', focus_theme: 'W2', focus_tags: [], color_hex: '#000', notes: '', updated_at: now },
      { id: 'w3', multi_week_plan_id: 'current', week_number: 3, start_date: '2026-11-23', focus_theme: 'W3', focus_tags: [], color_hex: '#000', notes: '', updated_at: now }
    ];

    expect(selectCurrentPlanWeek(weeks, '2026-11-22')?.id).toBe('w2');
    expect(selectCurrentPlanWeek(weeks, '2026-11-23')?.id).toBe('w3');
    expect(selectCurrentPlanWeek(weeks, '2026-11-01')?.id).toBe('w1');
    expect(selectCurrentPlanWeek(weeks, '2026-12-20')?.id).toBe('w3');
  });

  describe('buildMultiWeekPlanDeletionPlan', () => {
    const oldTs = '2026-11-01T10:00:00.000Z';
    const newTs = '2026-11-25T18:00:00.000Z';

    const planWeeks: PlanWeek[] = [
      { id: 'w1', multi_week_plan_id: 'plan-1', week_number: 1, start_date: '2026-11-09', focus_theme: 'W1', focus_tags: [], color_hex: '#3b82f6', notes: '', updated_at: oldTs },
      { id: 'w2', multi_week_plan_id: 'plan-1', week_number: 2, start_date: '2026-11-16', focus_theme: 'W2', focus_tags: [], color_hex: '#10b981', notes: '', updated_at: oldTs },
      { id: 'w-other', multi_week_plan_id: 'plan-2', week_number: 1, start_date: '2026-12-07', focus_theme: 'Other', focus_tags: [], color_hex: '#f59e0b', notes: '', updated_at: oldTs }
    ];

    const sessions: TrainingSession[] = [
      { id: 's1', team_id: 't1', plan_week_id: 'w1', session_date: '2026-11-10', start_time: '18:30', end_time: '20:00', planned_duration_min: 90, title: 'S1', custom_materials_override: [], status: 'PLANNED', updated_at: oldTs },
      { id: 's2', team_id: 't1', plan_week_id: 'w2', session_date: '2026-11-17', start_time: '18:30', end_time: '20:00', planned_duration_min: 90, title: 'S2', custom_materials_override: [], status: 'COMPLETED', updated_at: oldTs },
      // Standalone session falling inside w1's date range, but NOT linked via plan_week_id
      { id: 's-standalone', team_id: 't1', session_date: '2026-11-12', start_time: '18:30', end_time: '20:00', planned_duration_min: 90, title: 'Standalone', custom_materials_override: [], status: 'PLANNED', updated_at: oldTs },
      { id: 's-other', team_id: 't1', plan_week_id: 'w-other', session_date: '2026-12-08', start_time: '18:30', end_time: '20:00', planned_duration_min: 90, title: 'Other', custom_materials_override: [], status: 'PLANNED', updated_at: oldTs }
    ];

    const phases: SessionPhase[] = [
      { id: 'p1', training_session_id: 's1', name: 'Aufwärmen', sort_order: 1, target_duration_min: 15, updated_at: oldTs },
      { id: 'p2', training_session_id: 's2', name: 'Hauptteil', sort_order: 2, target_duration_min: 40, updated_at: oldTs },
      { id: 'p-other', training_session_id: 's-other', name: 'Other', sort_order: 1, target_duration_min: 15, updated_at: oldTs }
    ];

    const blocks: SessionBlock[] = [
      { id: 'b1', session_phase_id: 'p1', time_slot_index: 0, track_label: 'Alle', custom_duration_min: 15, updated_at: oldTs },
      { id: 'b2', session_phase_id: 'p2', time_slot_index: 0, track_label: 'Alle', custom_duration_min: 40, updated_at: oldTs },
      { id: 'b-other', session_phase_id: 'p-other', time_slot_index: 0, track_label: 'Alle', custom_duration_min: 15, updated_at: oldTs }
    ];

    const notes: SessionNote[] = [
      { id: 'n1', training_session_id: 's1', author_name: 'Trainer', content: 'Gut', created_at: oldTs, updated_at: oldTs },
      { id: 'n-other', training_session_id: 's-other', author_name: 'Trainer', content: 'Other', created_at: oldTs, updated_at: oldTs }
    ];

    it('unlinks associated sessions and keeps session data when deleteLinkedSessions is false', () => {
      const result = buildMultiWeekPlanDeletionPlan({
        planId: 'plan-1',
        planWeeks,
        sessions,
        phases,
        blocks,
        notes,
        deleteLinkedSessions: false,
        nowIso: newTs
      });

      expect(result.planId).toBe('plan-1');
      expect(result.planWeekIdsToDelete).toEqual(['w1', 'w2']);
      expect(result.sessionIdsToDelete).toEqual([]);
      expect(result.phaseIdsToDelete).toEqual([]);
      expect(result.blockIdsToDelete).toEqual([]);
      expect(result.noteIdsToDelete).toEqual([]);

      expect(result.sessionsToUnlink).toHaveLength(2);
      expect(result.sessionsToUnlink.map((s) => s.id)).toEqual(['s1', 's2']);
      for (const unlinked of result.sessionsToUnlink) {
        expect(unlinked.plan_week_id).toBeUndefined();
        expect('plan_week_id' in unlinked).toBe(false);
        expect(unlinked.updated_at).toBe(newTs);
      }

      expect(Array.from(result.outboxUpsertKeysToPurge).sort()).toEqual([
        'multi_week_plans:plan-1',
        'plan_weeks:w1',
        'plan_weeks:w2'
      ]);
    });

    it('cascades deletion to explicitly linked sessions and children without touching standalone sessions', () => {
      const result = buildMultiWeekPlanDeletionPlan({
        planId: 'plan-1',
        planWeeks,
        sessions,
        phases,
        blocks,
        notes,
        deleteLinkedSessions: true,
        nowIso: newTs
      });

      expect(result.planWeekIdsToDelete).toEqual(['w1', 'w2']);
      expect(result.sessionsToUnlink).toEqual([]);
      expect(result.sessionIdsToDelete).toEqual(['s1', 's2']);
      expect(result.phaseIdsToDelete).toEqual(['p1', 'p2']);
      expect(result.blockIdsToDelete).toEqual(['b1', 'b2']);
      expect(result.noteIdsToDelete).toEqual(['n1']);

      expect(Array.from(result.outboxUpsertKeysToPurge).sort()).toEqual([
        'multi_week_plans:plan-1',
        'plan_weeks:w1',
        'plan_weeks:w2',
        'session_blocks:b1',
        'session_blocks:b2',
        'session_notes:n1',
        'session_phases:p1',
        'session_phases:p2',
        'training_sessions:s1',
        'training_sessions:s2'
      ]);
    });

    it('handles plans with no weeks or linked sessions cleanly', () => {
      const result = buildMultiWeekPlanDeletionPlan({
        planId: 'plan-empty',
        planWeeks,
        sessions,
        phases,
        blocks,
        notes,
        deleteLinkedSessions: true,
        nowIso: newTs
      });

      expect(result.planWeekIdsToDelete).toEqual([]);
      expect(result.sessionsToUnlink).toEqual([]);
      expect(result.sessionIdsToDelete).toEqual([]);
      expect(result.phaseIdsToDelete).toEqual([]);
      expect(result.blockIdsToDelete).toEqual([]);
      expect(result.noteIdsToDelete).toEqual([]);
      expect(Array.from(result.outboxUpsertKeysToPurge)).toEqual([
        'multi_week_plans:plan-empty'
      ]);
    });
  });
});
