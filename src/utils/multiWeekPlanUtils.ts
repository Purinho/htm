import type {
  HandballFocusTag,
  MultiWeekPlan,
  PlanWeek,
  SessionBlock,
  SessionPhase,
  SessionTemplate,
  Team,
  TrainingSession
} from '../types/domain';
import { buildSessionFromTemplate, getLocalDateIso } from './sessionPlannerUtils';

const WEEK_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDayCell {
  isoDate: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
}

export interface CalendarWeekRow {
  isoWeek: number;
  mondayIso: string;
  days: CalendarDayCell[];
}

/**
 * Formats an ISO YYYY-MM-DD date string in German DD.MM.YYYY notation.
 */
export function formatIsoDateDe(isoDate: string): string {
  const match = ISO_DATE_RE.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/**
 * Computes the ISO-8601 calendar week number (1..53) for a YYYY-MM-DD date.
 */
export function getIsoWeekNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Returns the reference date itself if it is Monday, otherwise the upcoming Monday.
 */
export function getUpcomingMondayIso(referenceIsoDate?: string): string {
  const ref = referenceIsoDate ?? getLocalDateIso();
  const [y, m, d] = ref.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDay() === 1) {
    return ref;
  }
  return addDaysIso(getMondayOfIsoWeek(ref), 7);
}

/**
 * Builds Monday-first calendar week rows covering the given year & 0-indexed month.
 */
export function buildGermanCalendarMonthGrid(
  year: number,
  monthIndex0: number
): CalendarWeekRow[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const firstIso = firstOfMonth.toISOString().slice(0, 10);
  const gridStartMonday = getMondayOfIsoWeek(firstIso);

  const lastOfMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  const lastIso = lastOfMonth.toISOString().slice(0, 10);

  const rows: CalendarWeekRow[] = [];
  let cursorMonday = gridStartMonday;

  while (cursorMonday <= lastIso) {
    const days: CalendarDayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const dayIso = addDaysIso(cursorMonday, i);
      const [dy, dm, dd] = dayIso.split('-').map(Number);
      days.push({
        isoDate: dayIso,
        dayOfMonth: dd,
        inCurrentMonth: dy === year && dm - 1 === monthIndex0
      });
    }
    rows.push({
      isoWeek: getIsoWeekNumber(cursorMonday),
      mondayIso: cursorMonday,
      days
    });
    cursorMonday = addDaysIso(cursorMonday, 7);
  }

  return rows;
}

/**
 * Picks the mesocycle covering todayIso, otherwise nearest upcoming, otherwise most recent past.
 */
export function selectActiveMultiWeekPlan(
  plans: MultiWeekPlan[],
  todayIso: string
): MultiWeekPlan | undefined {
  if (plans.length === 0) return undefined;

  const current = plans
    .filter((p) => p.start_date <= todayIso && p.end_date >= todayIso)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (current.length > 0) return current[0];

  const upcoming = plans
    .filter((p) => p.start_date > todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming.length > 0) return upcoming[0];

  return plans.slice().sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
}

/**
 * Picks the plan week covering todayIso, or nearest boundary week if outside range.
 */
export function selectCurrentPlanWeek(
  weeks: PlanWeek[],
  todayIso: string
): PlanWeek | undefined {
  if (weeks.length === 0) return undefined;
  const sorted = weeks
    .slice()
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) || a.week_number - b.week_number
    );

  const matching = sorted.find(
    (w) => w.start_date <= todayIso && addDaysIso(w.start_date, 6) >= todayIso
  );
  if (matching) return matching;

  if (todayIso < sorted[0].start_date) {
    return sorted[0];
  }
  const last = sorted[sorted.length - 1];
  if (todayIso > addDaysIso(last.start_date, 6)) {
    return last;
  }

  return sorted.find((w) => w.start_date > todayIso) ?? sorted[0];
}

export interface MultiWeekPlanGeneratedBundle {
  plan: MultiWeekPlan;
  weeks: PlanWeek[];
  sessions: TrainingSession[];
  phases: SessionPhase[];
  blocks: SessionBlock[];
}

/**
 * Adds `days` to a YYYY-MM-DD date string in UTC and returns YYYY-MM-DD.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Normalizes any YYYY-MM-DD date to the Monday of that ISO week.
 */
export function getMondayOfIsoWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

/**
 * Generates a complete MultiWeekPlan (Mesocycle), its PlanWeeks (Microcycles),
 * and automatically creates all TrainingSessions based on the Team's fixed `default_schedule`.
 */
export function generateMultiWeekPlanBundle(params: {
  team: Team;
  title: string;
  startDate: string;
  weekCount: number;
  goals: string;
  defaultTemplate?: SessionTemplate;
  defaultCoachMemberId?: string;
  initialFocusTags?: HandballFocusTag[];
}): MultiWeekPlanGeneratedBundle {
  const now = new Date().toISOString();
  const mondayStart = getMondayOfIsoWeek(params.startDate);
  const clampedWeeks = Math.min(16, Math.max(1, params.weekCount));
  const endDate = addDaysIso(mondayStart, clampedWeeks * 7 - 1);

  const planId = crypto.randomUUID();
  const plan: MultiWeekPlan = {
    id: planId,
    team_id: params.team.id,
    title: params.title.trim() || `Mehrwochenplan (${clampedWeeks} Wochen)`,
    start_date: mondayStart,
    end_date: endDate,
    goals: params.goals.trim(),
    updated_at: now
  };

  const weeks: PlanWeek[] = [];
  const sessions: TrainingSession[] = [];
  const phases: SessionPhase[] = [];
  const blocks: SessionBlock[] = [];

  for (let w = 0; w < clampedWeeks; w++) {
    const weekNumber = w + 1;
    const weekMonday = addDaysIso(mondayStart, w * 7);
    const weekId = crypto.randomUUID();

    const week: PlanWeek = {
      id: weekId,
      multi_week_plan_id: planId,
      week_number: weekNumber,
      start_date: weekMonday,
      focus_theme: `Woche ${weekNumber}: Schwerpunkt definieren`,
      focus_tags:
        params.initialFocusTags && params.initialFocusTags.length > 0
          ? params.initialFocusTags
          : ['OFFENSE_GROUP', 'DEFENSE_6_0'],
      color_hex: WEEK_COLORS[w % WEEK_COLORS.length],
      notes: '',
      updated_at: now
    };
    weeks.push(week);

    // Automatically generate training days from the team's default_schedule
    for (const slot of params.team.default_schedule) {
      // slot.weekday: 1 = Monday ... 7 = Sunday
      const dayOffset = Math.min(6, Math.max(0, slot.weekday - 1));
      const sessionDate = addDaysIso(weekMonday, dayOffset);

      const sessionBundle = buildSessionFromTemplate({
        teamId: params.team.id,
        sessionDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: `${slot.weekdayLabel}-Training (Woche ${weekNumber})`,
        planWeekId: weekId,
        template: params.defaultTemplate,
        defaultCoachMemberId: params.defaultCoachMemberId
      });

      sessions.push(sessionBundle.session);
      phases.push(...sessionBundle.phases);
      blocks.push(...sessionBundle.blocks);
    }
  }

  return {
    plan,
    weeks,
    sessions,
    phases,
    blocks
  };
}
