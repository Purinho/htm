import type {
  AgeGroup,
  Exercise,
  HandballFocusTag,
  SessionBlock,
  SessionPhase,
  SessionTemplate,
  TrainingPhaseCategory,
  TrainingSession
} from '../types/domain';
import {
  DEFAULT_AGE_GROUPS,
  FOCUS_TAG_LABELS,
  PHASE_CATEGORY_LABELS
} from '../constants/handballLabels';
import { calculateMinutesBetweenTimes } from './trainingCalculations';
import { buildTacticBoardPreset } from './tacticPresets';
import { isAgeGroup } from './teamAgeGroupUtils';

export type PlannerCatalogTab = 'SMART_FOCUS' | 'ALL' | 'RECENT';

export interface PlannerCatalogFilters {
  catalogTab: PlannerCatalogTab;
  catalogSearch: string;
  catalogAgeGroup: 'ALL' | AgeGroup;
  catalogPhase: 'ALL' | TrainingPhaseCategory;
  catalogFocusTag: 'ALL' | HandballFocusTag;
}

export interface PlannerNavigationSnapshot {
  teamId: string;
  teamAgeGroup?: AgeGroup | null;
  sessionId?: string;
  phaseId?: string;
  filters: PlannerCatalogFilters;
}

export interface PlannerTeamContext {
  teamId: string;
  ageGroup: AgeGroup | null;
}

const VALID_PLANNER_TABS = new Set<PlannerCatalogTab>(['SMART_FOCUS', 'ALL', 'RECENT']);

/** Creates the default exercise catalog filter state for the training session planner. */
export function createDefaultPlannerCatalogFilters(
  defaultAgeGroup?: AgeGroup | null
): PlannerCatalogFilters {
  return {
    catalogTab: 'SMART_FOCUS',
    catalogSearch: '',
    catalogAgeGroup: defaultAgeGroup ?? 'ALL',
    catalogPhase: 'ALL',
    catalogFocusTag: 'ALL'
  };
}

/**
 * Validates and normalizes persisted planner filters (e.g. from browser history state),
 * preserving an explicit `'ALL'` age group selection while falling back on missing/invalid fields.
 */
export function sanitizePlannerCatalogFilters(
  raw: unknown,
  fallbackAgeGroup?: AgeGroup | null
): PlannerCatalogFilters {
  if (!raw || typeof raw !== 'object') {
    return createDefaultPlannerCatalogFilters(fallbackAgeGroup);
  }

  const candidate = raw as Record<string, unknown>;
  const catalogTab: PlannerCatalogTab =
    typeof candidate.catalogTab === 'string' &&
    VALID_PLANNER_TABS.has(candidate.catalogTab as PlannerCatalogTab)
      ? (candidate.catalogTab as PlannerCatalogTab)
      : 'SMART_FOCUS';

  const catalogSearch = typeof candidate.catalogSearch === 'string' ? candidate.catalogSearch : '';

  const catalogAgeGroup: 'ALL' | AgeGroup =
    candidate.catalogAgeGroup === 'ALL'
      ? 'ALL'
      : isAgeGroup(candidate.catalogAgeGroup)
        ? candidate.catalogAgeGroup
        : (fallbackAgeGroup ?? 'ALL');

  const catalogPhase: 'ALL' | TrainingPhaseCategory =
    candidate.catalogPhase === 'ALL' ||
    (typeof candidate.catalogPhase === 'string' &&
      Object.prototype.hasOwnProperty.call(PHASE_CATEGORY_LABELS, candidate.catalogPhase))
      ? (candidate.catalogPhase as 'ALL' | TrainingPhaseCategory)
      : 'ALL';

  const catalogFocusTag: 'ALL' | HandballFocusTag =
    candidate.catalogFocusTag === 'ALL' ||
    (typeof candidate.catalogFocusTag === 'string' &&
      Object.prototype.hasOwnProperty.call(FOCUS_TAG_LABELS, candidate.catalogFocusTag))
      ? (candidate.catalogFocusTag as 'ALL' | HandballFocusTag)
      : 'ALL';

  return {
    catalogTab,
    catalogSearch,
    catalogAgeGroup,
    catalogPhase,
    catalogFocusTag
  };
}

/**
 * Reconciles planner filter and selection state when the active team or its age group changes,
 * restoring an existing browser-history snapshot on initial mount if available.
 */
export function reconcilePlannerStateForTeamChange(params: {
  previousContext: PlannerTeamContext | null;
  nextContext: PlannerTeamContext;
  currentFilters: PlannerCatalogFilters;
  currentSessionId: string;
  currentPhaseId: string;
  historySnapshot?: PlannerNavigationSnapshot | null;
}): {
  filters: PlannerCatalogFilters;
  sessionId: string;
  phaseId: string;
  changed: boolean;
} {
  const {
    previousContext,
    nextContext,
    currentFilters,
    currentSessionId,
    currentPhaseId,
    historySnapshot
  } = params;

  if (previousContext === null) {
    if (historySnapshot && historySnapshot.teamId === nextContext.teamId) {
      return {
        filters: sanitizePlannerCatalogFilters(historySnapshot.filters, nextContext.ageGroup),
        sessionId: typeof historySnapshot.sessionId === 'string' ? historySnapshot.sessionId : '',
        phaseId: typeof historySnapshot.phaseId === 'string' ? historySnapshot.phaseId : '',
        changed: true
      };
    }

    return {
      filters: createDefaultPlannerCatalogFilters(nextContext.ageGroup),
      sessionId: currentSessionId,
      phaseId: currentPhaseId,
      changed: true
    };
  }

  if (previousContext.teamId !== nextContext.teamId) {
    return {
      filters: createDefaultPlannerCatalogFilters(nextContext.ageGroup),
      sessionId: '',
      phaseId: '',
      changed: true
    };
  }

  if (previousContext.ageGroup !== nextContext.ageGroup) {
    return {
      filters: {
        ...currentFilters,
        catalogAgeGroup: nextContext.ageGroup ?? 'ALL'
      },
      sessionId: currentSessionId,
      phaseId: currentPhaseId,
      changed: true
    };
  }

  return {
    filters: currentFilters,
    sessionId: currentSessionId,
    phaseId: currentPhaseId,
    changed: false
  };
}

export interface SessionBundle {
  session: TrainingSession;
  phases: SessionPhase[];
  blocks: SessionBlock[];
}

export function getLocalDateIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sortSessionsChronologically(sessions: TrainingSession[]): TrainingSession[] {
  return sessions
    .slice()
    .sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.start_time.localeCompare(b.start_time) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * Selects the default session to display when entering the training editor or hall mode:
 * 1. Earliest upcoming open (not COMPLETED / not CANCELLED) session on or after todayIso.
 * 2. If none, most recent open (not COMPLETED / not CANCELLED) session in the past.
 * 3. If all sessions are COMPLETED/CANCELLED, earliest upcoming session on or after todayIso,
 *    or else the most recent session overall.
 */
export function selectDefaultSession(
  sessions: TrainingSession[],
  todayIso: string = getLocalDateIso()
): TrainingSession | null {
  if (sessions.length === 0) return null;
  const sorted = sortSessionsChronologically(sessions);

  const isOpen = (s: TrainingSession) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED';

  const nextUpcomingOpen = sorted.find((s) => s.session_date >= todayIso && isOpen(s));
  if (nextUpcomingOpen) return nextUpcomingOpen;

  const pastOpen = sorted.filter((s) => isOpen(s));
  if (pastOpen.length > 0) return pastOpen[pastOpen.length - 1];

  const nextUpcomingAny = sorted.find((s) => s.session_date >= todayIso);
  if (nextUpcomingAny) return nextUpcomingAny;

  return sorted[sorted.length - 1];
}

/**
 * Selects the next session in dropdown order after a session is marked COMPLETED:
 * 1. First open (not COMPLETED / not CANCELLED) session appearing after completedSessionId.
 * 2. Otherwise, first non-COMPLETED session appearing after completedSessionId.
 * 3. Otherwise, falls back to selectDefaultSession on all other non-COMPLETED sessions.
 * Returns null if no other non-COMPLETED session exists.
 */
export function selectNextSessionAfterCompletion(
  sessions: TrainingSession[],
  completedSessionId: string,
  todayIso: string = getLocalDateIso()
): TrainingSession | null {
  const sorted = sortSessionsChronologically(sessions);
  const currentIdx = sorted.findIndex((s) => s.id === completedSessionId);

  if (currentIdx !== -1) {
    const afterCurrent = sorted.slice(currentIdx + 1);
    const nextOpen = afterCurrent.find(
      (s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED'
    );
    if (nextOpen) return nextOpen;

    const nextNonCompleted = afterCurrent.find((s) => s.status !== 'COMPLETED');
    if (nextNonCompleted) return nextNonCompleted;
  }

  const remainingNonCompleted = sorted.filter(
    (s) => s.id !== completedSessionId && s.status !== 'COMPLETED'
  );
  return selectDefaultSession(remainingNonCompleted, todayIso);
}

/**
 * Creates a new TrainingSession + Phases + Default Blocks from a SessionTemplate.
 */
export function buildSessionFromTemplate(params: {
  teamId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  title: string;
  planWeekId?: string;
  template?: SessionTemplate;
  defaultCoachMemberId?: string;
}): SessionBundle {
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const plannedMin = calculateMinutesBetweenTimes(params.startTime, params.endTime);

  const session: TrainingSession = {
    id: sessionId,
    team_id: params.teamId,
    plan_week_id: params.planWeekId,
    session_date: params.sessionDate,
    start_time: params.startTime,
    end_time: params.endTime,
    planned_duration_min: plannedMin,
    title: params.title.trim() || 'Hallentraining',
    custom_materials_override: [],
    status: 'PLANNED',
    updated_at: now
  };

  const templatePhases =
    params.template && params.template.phases_template.length > 0
      ? params.template.phases_template
      : [
          { name: '1. Aufwärmen & Einstimmung', target_duration_min: 15 },
          { name: '2. Torwart-Einwerfen & Auftakt', target_duration_min: 15 },
          { name: '3. Hauptteil 1: Technik / Kleingruppe', target_duration_min: 25 },
          { name: '4. Hauptteil 2: Mannschaftstaktik / Zielspiel', target_duration_min: 25 },
          { name: '5. Abschlussspiel & Cool-Down', target_duration_min: 10 }
        ];

  const phases: SessionPhase[] = [];
  const blocks: SessionBlock[] = [];

  templatePhases.forEach((tp, index) => {
    const phaseId = crypto.randomUUID();
    phases.push({
      id: phaseId,
      training_session_id: sessionId,
      name: tp.name,
      sort_order: index + 1,
      target_duration_min: tp.target_duration_min,
      updated_at: now
    });

    if (tp.default_exercise_id) {
      blocks.push({
        id: crypto.randomUUID(),
        session_phase_id: phaseId,
        exercise_id: tp.default_exercise_id,
        time_slot_index: 0,
        track_label: tp.default_track_label ?? 'Alle Spieler',
        assigned_member_id: params.defaultCoachMemberId,
        custom_duration_min: tp.target_duration_min,
        updated_at: now
      });
    }
  });

  return { session, phases, blocks };
}

/**
 * Clones an existing TrainingSession (including all phases and sequential/parallel blocks)
 * onto a new date.
 */
export function cloneTrainingSessionBundle(params: {
  sourceSession: TrainingSession;
  sourcePhases: SessionPhase[];
  sourceBlocks: SessionBlock[];
  newDate: string;
  newTitle?: string;
}): SessionBundle {
  const now = new Date().toISOString();
  const newSessionId = crypto.randomUUID();

  const session: TrainingSession = {
    ...params.sourceSession,
    id: newSessionId,
    session_date: params.newDate,
    title: params.newTitle?.trim() || `${params.sourceSession.title} (Kopie)`,
    status: 'PLANNED',
    updated_at: now
  };

  const phaseIdMap = new Map<string, string>();
  const phases: SessionPhase[] = params.sourcePhases
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const nextPhaseId = crypto.randomUUID();
      phaseIdMap.set(p.id, nextPhaseId);
      return {
        ...p,
        id: nextPhaseId,
        training_session_id: newSessionId,
        updated_at: now
      };
    });

  const blocks: SessionBlock[] = params.sourceBlocks
    .filter((b) => phaseIdMap.has(b.session_phase_id))
    .map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      session_phase_id: phaseIdMap.get(b.session_phase_id)!,
      updated_at: now
    }));

  return { session, phases, blocks };
}

/**
 * Converts a free-text Quick-Block into a reusable Exercise entity for the club catalog,
 * and returns both the new Exercise and the updated SessionBlock referencing it.
 */
export function convertQuickBlockToCatalogExercise(params: {
  block: SessionBlock;
  clubId: string;
  teamId: string;
  focusTags?: HandballFocusTag[];
  ageGroups?: AgeGroup[];
}): { exercise: Exercise; updatedBlock: SessionBlock } {
  const now = new Date().toISOString();
  const exerciseId = crypto.randomUUID();

  const exercise: Exercise = {
    id: exerciseId,
    club_id: params.clubId,
    visibility: 'CLUB',
    owner_team_id: params.teamId,
    title: params.block.quick_block_title?.trim() || 'Neue Trainingsübung aus Quick-Block',
    default_duration_min: params.block.custom_duration_min || 15,
    min_players: 6,
    max_players: 14,
    goalkeepers: 1,
    categories: {
      phases: ['GROUND_EXERCISE'],
      focus:
        params.focusTags && params.focusTags.length > 0
          ? params.focusTags
          : ['OFFENSE_GROUP'],
      level: 'BASIC',
      age_groups:
        params.ageGroups && params.ageGroups.length > 0
          ? params.ageGroups
          : DEFAULT_AGE_GROUPS
    },
    materials: [{ type: 'BALL', quantity: 6 }],
    setup_description: 'Aus freiem Trainingsblock übernommen.',
    flow_description: params.block.quick_block_description?.trim() || '',
    coaching_points: '',
    variations_text: '',
    external_links: [],
    tactic_board_data: buildTacticBoardPreset('OFFENSE_BACKCOURT_TRIANGLE'),
    is_deleted: false,
    created_at: now,
    updated_at: now
  };

  const updatedBlock: SessionBlock = {
    ...params.block,
    exercise_id: exerciseId,
    quick_block_title: undefined,
    quick_block_description: undefined,
    updated_at: now
  };

  return { exercise, updatedBlock };
}

/**
 * Extracts a reusable SessionTemplate from an existing session's phases and blocks.
 */
export function buildTemplateFromSession(params: {
  clubId: string;
  title: string;
  description: string;
  session: TrainingSession;
  phases: SessionPhase[];
  blocks: SessionBlock[];
}): SessionTemplate {
  const now = new Date().toISOString();
  const sortedPhases = params.phases.slice().sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: crypto.randomUUID(),
    club_id: params.clubId,
    title: params.title.trim() || `Vorlage: ${params.session.title}`,
    description: params.description.trim() || 'Aus bestehender Trainingseinheit gespeichert',
    default_duration_min: params.session.planned_duration_min,
    phases_template: sortedPhases.map((p) => {
      const firstBlock = params.blocks.find((b) => b.session_phase_id === p.id);
      return {
        name: p.name,
        target_duration_min: p.target_duration_min,
        default_exercise_id: firstBlock?.exercise_id,
        default_track_label: firstBlock?.track_label
      };
    }),
    updated_at: now
  };
}

function groupPhaseBlocksBySlot(phaseBlocks: SessionBlock[]): SessionBlock[][] {
  const slotMap = new Map<number, SessionBlock[]>();
  for (const b of phaseBlocks) {
    const existing = slotMap.get(b.time_slot_index) ?? [];
    slotMap.set(b.time_slot_index, [...existing, b]);
  }
  return Array.from(slotMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list);
}

function collectChangedBlocks(
  original: SessionBlock[],
  reorderedSlots: SessionBlock[][]
): SessionBlock[] {
  const now = new Date().toISOString();
  const originalSlotById = new Map(original.map((b) => [b.id, b.time_slot_index]));
  const changed: SessionBlock[] = [];

  reorderedSlots.forEach((slotBlocks, newSlotIdx) => {
    for (const block of slotBlocks) {
      if (originalSlotById.get(block.id) !== newSlotIdx) {
        changed.push({
          ...block,
          time_slot_index: newSlotIdx,
          updated_at: now
        });
      }
    }
  });

  return changed;
}

/**
 * Moves a block up or down within a phase's time-slot sequence.
 * Single-block slots swap with the adjacent slot; parallel-track blocks split out before/after.
 * Returns only the SessionBlock records whose time_slot_index changed.
 */
export function moveBlockInPhase(
  phaseBlocks: SessionBlock[],
  blockId: string,
  direction: 'UP' | 'DOWN'
): SessionBlock[] {
  const slots = groupPhaseBlocksBySlot(phaseBlocks);
  const slotIdx = slots.findIndex((group) => group.some((b) => b.id === blockId));
  if (slotIdx === -1) return [];

  const currentGroup = slots[slotIdx];
  const nextSlots = slots.map((g) => [...g]);

  if (currentGroup.length === 1) {
    const targetIdx = direction === 'UP' ? slotIdx - 1 : slotIdx + 1;
    if (targetIdx < 0 || targetIdx >= nextSlots.length) return [];
    const temp = nextSlots[slotIdx];
    nextSlots[slotIdx] = nextSlots[targetIdx];
    nextSlots[targetIdx] = temp;
  } else {
    const targetBlock = currentGroup.find((b) => b.id === blockId);
    if (!targetBlock) return [];
    nextSlots[slotIdx] = currentGroup.filter((b) => b.id !== blockId);
    const insertAt = direction === 'UP' ? slotIdx : slotIdx + 1;
    nextSlots.splice(insertAt, 0, [targetBlock]);
  }

  return collectChangedBlocks(phaseBlocks, nextSlots);
}

/**
 * Merges a sequential block into the previous time slot (parallel track) or
 * splits a parallel block out into its own sequential slot.
 */
export function toggleBlockParallelWithPrevious(
  phaseBlocks: SessionBlock[],
  blockId: string
): SessionBlock[] {
  const slots = groupPhaseBlocksBySlot(phaseBlocks);
  const slotIdx = slots.findIndex((group) => group.some((b) => b.id === blockId));
  if (slotIdx === -1) return [];

  const currentGroup = slots[slotIdx];
  const targetBlock = currentGroup.find((b) => b.id === blockId);
  if (!targetBlock) return [];

  const nextSlots = slots.map((g) => [...g]);

  if (currentGroup.length > 1) {
    // Split out of parallel slot into its own sequential slot right after
    nextSlots[slotIdx] = currentGroup.filter((b) => b.id !== blockId);
    nextSlots.splice(slotIdx + 1, 0, [targetBlock]);
  } else if (slotIdx > 0) {
    // Merge into previous slot to run in parallel
    nextSlots[slotIdx - 1].push(targetBlock);
    nextSlots.splice(slotIdx, 1);
  } else {
    return [];
  }

  return collectChangedBlocks(phaseBlocks, nextSlots);
}

/**
 * Reorders a SessionPhase up or down within a TrainingSession and normalizes sort_order (1..N).
 * Returns only the phases whose sort_order changed.
 */
export function movePhaseInSession(
  sessionPhases: SessionPhase[],
  phaseId: string,
  direction: 'UP' | 'DOWN'
): SessionPhase[] {
  const sorted = sessionPhases.slice().sort((a, b) => a.sort_order - b.sort_order);
  const idx = sorted.findIndex((p) => p.id === phaseId);
  if (idx === -1) return [];

  const targetIdx = direction === 'UP' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return [];

  const reordered = [...sorted];
  const temp = reordered[idx];
  reordered[idx] = reordered[targetIdx];
  reordered[targetIdx] = temp;

  const now = new Date().toISOString();
  const changed: SessionPhase[] = [];
  reordered.forEach((phase, index) => {
    const nextOrder = index + 1;
    if (phase.sort_order !== nextOrder) {
      changed.push({
        ...phase,
        sort_order: nextOrder,
        updated_at: now
      });
    }
  });

  return changed;
}
