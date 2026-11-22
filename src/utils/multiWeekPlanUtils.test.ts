import { describe, expect, it } from 'vitest';
import {
  buildGermanCalendarMonthGrid,
  formatIsoDateDe,
  generateMultiWeekPlanBundle,
  getIsoWeekNumber,
  getMondayOfIsoWeek,
  getUpcomingMondayIso,
  selectActiveMultiWeekPlan,
  selectCurrentPlanWeek
} from './multiWeekPlanUtils';
import type { MultiWeekPlan, PlanWeek, Team } from '../types/domain';

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
});
