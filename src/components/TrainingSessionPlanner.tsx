import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookmarkPlus,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  GripVertical,
  History,
  Layers,
  MessageSquarePlus,
  Package,
  Plus,
  Printer,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import { db, purgePendingOutboxUpserts, queueSyncOperation } from '../db/database';
import type {
  AgeGroup,
  ClubMember,
  Exercise,
  HandballFocusTag,
  PlanWeek,
  SessionBlock,
  SessionNote,
  SessionPhase,
  SessionStatus,
  SessionTemplate,
  Team,
  TrainingPhaseCategory,
  TrainingSession
} from '../types/domain';
import {
  AGE_GROUP_LABELS,
  ALL_AGE_GROUPS,
  ATHLETICS_RECOVERY_FOCUS_TAGS,
  FOCUS_TAG_LABELS,
  MATERIAL_LABELS,
  PHASE_CATEGORY_LABELS,
  TACTIC_FOCUS_TAGS,
  TECHNIQUE_FOCUS_TAGS
} from '../constants/handballLabels';
import {
  aggregateSessionMaterials,
  calculateMinutesBetweenTimes,
  calculatePhaseEffectiveDuration,
  calculateSessionTotalDuration
} from '../utils/trainingCalculations';
import {
  buildSessionFromTemplate,
  buildTemplateFromSession,
  cloneTrainingSessionBundle,
  convertQuickBlockToCatalogExercise,
  getLocalDateIso,
  moveBlockInPhase,
  movePhaseInSession,
  selectDefaultSession,
  selectNextSessionAfterCompletion,
  sortSessionsChronologically,
  toggleBlockParallelWithPrevious,
  type PlannerCatalogFilters,
  type PlannerCatalogTab
} from '../utils/sessionPlannerUtils';
import { addDaysIso, selectCurrentPlanWeek } from '../utils/multiWeekPlanUtils';
import { resolveTeamAgeGroup } from '../utils/teamAgeGroupUtils';
import { TacticBoardPreview } from './TacticBoardPreview';

interface TrainingSessionPlannerProps {
  clubId: string;
  activeTeam: Team;
  members: ClubMember[];
  exercises: Exercise[];
  templates: SessionTemplate[];
  sessions: TrainingSession[];
  phases: SessionPhase[];
  blocks: SessionBlock[];
  notes: SessionNote[];
  activePlanWeeks: PlanWeek[];
  focusedSessionId?: string;
  catalogFilters: PlannerCatalogFilters;
  onChangeCatalogFilters: React.Dispatch<React.SetStateAction<PlannerCatalogFilters>>;
  selectedSessionId: string;
  onSelectSessionId: (sessionId: string) => void;
  activePhaseId: string;
  onSelectPhaseId: (phaseId: string) => void;
  onEditExercise: (exercise: Exercise) => void;
  onOpenExercise?: (exercise: Exercise) => void;
  onStartHallMode?: (sessionId: string) => void;
  onPrintSession?: (session: TrainingSession) => void;
}

const PLANNER_CATALOG_PAGE_SIZE = 30;

const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  PLANNED: 'In Planung',
  READY: 'Vorbereitet (Bereit für Halle)',
  COMPLETED: 'Durchgeführt',
  CANCELLED: 'Ausgefallen'
};

export function TrainingSessionPlanner({
  clubId,
  activeTeam,
  members,
  exercises,
  templates,
  sessions,
  phases,
  blocks,
  notes,
  activePlanWeeks,
  focusedSessionId,
  catalogFilters,
  onChangeCatalogFilters,
  selectedSessionId,
  onSelectSessionId,
  activePhaseId,
  onSelectPhaseId,
  onEditExercise,
  onOpenExercise,
  onStartHallMode,
  onPrintSession
}: TrainingSessionPlannerProps) {
  const setSelectedSessionId = onSelectSessionId;
  const setActivePhaseId = onSelectPhaseId;
  const { catalogTab, catalogSearch, catalogAgeGroup, catalogPhase, catalogFocusTag } =
    catalogFilters;

  function updateCatalogFilter<K extends keyof PlannerCatalogFilters>(
    key: K,
    value: PlannerCatalogFilters[K]
  ) {
    onChangeCatalogFilters((prev) => ({ ...prev, [key]: value }));
  }

  const setCatalogTab = (tab: PlannerCatalogTab) => updateCatalogFilter('catalogTab', tab);
  const setCatalogSearch = (search: string) => updateCatalogFilter('catalogSearch', search);
  const setCatalogAgeGroup = (ag: 'ALL' | AgeGroup) => updateCatalogFilter('catalogAgeGroup', ag);
  const setCatalogPhase = (phase: 'ALL' | TrainingPhaseCategory) =>
    updateCatalogFilter('catalogPhase', phase);
  const setCatalogFocusTag = (tag: 'ALL' | HandballFocusTag) =>
    updateCatalogFilter('catalogFocusTag', tag);

  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOverPhaseId, setDragOverPhaseId] = useState<string | null>(null);
  const teamSessions = useMemo(
    () => sortSessionsChronologically(sessions.filter((s) => s.team_id === activeTeam.id)),
    [sessions, activeTeam.id]
  );

  const currentSession = useMemo(() => {
    const targetId = selectedSessionId || focusedSessionId;
    if (targetId) {
      const found = teamSessions.find((s) => s.id === targetId);
      if (found) return found;
    }
    return selectDefaultSession(teamSessions);
  }, [teamSessions, selectedSessionId, focusedSessionId]);

  const currentPhases = useMemo(
    () =>
      currentSession
        ? phases
            .filter((p) => p.training_session_id === currentSession.id)
            .sort((a, b) => a.sort_order - b.sort_order)
        : [],
    [phases, currentSession]
  );

  const targetPhase = useMemo(() => {
    if (activePhaseId) {
      const found = currentPhases.find((p) => p.id === activePhaseId);
      if (found) return found;
    }
    return currentPhases[0] ?? null;
  }, [currentPhases, activePhaseId]);

  const currentBlocks = useMemo(() => {
    const phaseIds = new Set(currentPhases.map((p) => p.id));
    return blocks.filter((b) => phaseIds.has(b.session_phase_id));
  }, [blocks, currentPhases]);

  const exercisesById = useMemo(
    () => new Map(exercises.map((ex) => [ex.id, ex])),
    [exercises]
  );

  // Linked PlanWeek for Smart-Suggestions
  const linkedPlanWeek = useMemo(() => {
    if (currentSession?.plan_week_id) {
      const found = activePlanWeeks.find((pw) => pw.id === currentSession.plan_week_id);
      if (found) return found;
    }
    if (currentSession?.session_date) {
      const byDate = activePlanWeeks.find(
        (pw) =>
          pw.start_date <= currentSession.session_date &&
          addDaysIso(pw.start_date, 6) >= currentSession.session_date
      );
      if (byDate) return byDate;
    }
    return selectCurrentPlanWeek(activePlanWeeks, getLocalDateIso());
  }, [currentSession, activePlanWeeks]);

  // Right catalog panel state
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(PLANNER_CATALOG_PAGE_SIZE);
  const [previewExerciseId, setPreviewExerciseId] = useState<string | null>(null);

  useEffect(() => {
    setVisibleCatalogCount(PLANNER_CATALOG_PAGE_SIZE);
  }, [catalogTab, catalogSearch, catalogAgeGroup, catalogPhase, catalogFocusTag, activeTeam.id]);

  // Quick-Block input state
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDesc, setQuickDesc] = useState('');
  const [quickDuration, setQuickDuration] = useState(15);
  const [quickTrackLabel, setQuickTrackLabel] = useState('Alle Spieler');
  const [quickIsParallel, setQuickIsParallel] = useState(false);

  // New session / Template / Clone panels
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);
  const [newSessionDate, setNewSessionDate] = useState(() => getLocalDateIso());
  const [newSessionStart, setNewSessionStart] = useState(
    activeTeam.default_schedule[0]?.startTime ?? '18:30'
  );
  const [newSessionEnd, setNewSessionEnd] = useState(
    activeTeam.default_schedule[0]?.endTime ?? '20:00'
  );
  const [newSessionTitle, setNewSessionTitle] = useState('Donnerstagstraining');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates[0]?.id ?? ''
  );

  // New Phase form
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseDuration, setNewPhaseDuration] = useState(15);

  // Note input per block
  const [noteBlockId, setNoteBlockId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteAuthorId, setNoteAuthorId] = useState<string>(members[0]?.id ?? '');

  // Template save feedback & delete confirmation
  const [savedTemplateBanner, setSavedTemplateBanner] = useState<string | null>(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);

  const totalSessionDuration = useMemo(
    () => calculateSessionTotalDuration(currentPhases, currentBlocks),
    [currentPhases, currentBlocks]
  );

  const sessionPackingList = useMemo(
    () =>
      aggregateSessionMaterials(
        currentBlocks,
        exercisesById,
        currentSession?.custom_materials_override ?? []
      ),
    [currentBlocks, exercisesById, currentSession]
  );

  // Smart-filtered exercises for right column
  const smartCatalogExercises = useMemo(() => {
    const focusSet = new Set<HandballFocusTag>(linkedPlanWeek?.focus_tags ?? []);
    const recentExerciseIds = new Set<string>(
      blocks
        .filter((b) => Boolean(b.exercise_id))
        .map((b) => b.exercise_id!)
    );

    return exercises.filter((ex) => {
      if (
        ex.visibility === 'TEAM' &&
        ex.owner_team_id &&
        ex.owner_team_id !== activeTeam.id
      ) {
        return false;
      }

      if (
        catalogAgeGroup !== 'ALL' &&
        !(ex.categories.age_groups ?? []).includes(catalogAgeGroup)
      ) {
        return false;
      }

      if (
        catalogPhase !== 'ALL' &&
        !ex.categories.phases.includes(catalogPhase)
      ) {
        return false;
      }

      if (
        catalogFocusTag !== 'ALL' &&
        !ex.categories.focus.includes(catalogFocusTag)
      ) {
        return false;
      }

      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        const focusText = ex.categories.focus
          .map((f) => FOCUS_TAG_LABELS[f])
          .join(' ')
          .toLowerCase();
        const matchesText =
          ex.title.toLowerCase().includes(q) ||
          ex.flow_description.toLowerCase().includes(q) ||
          ex.coaching_points.toLowerCase().includes(q) ||
          focusText.includes(q);
        if (!matchesText) return false;
      }

      if (catalogTab === 'SMART_FOCUS' && focusSet.size > 0) {
        return ex.categories.focus.some((tag) => focusSet.has(tag));
      }
      if (catalogTab === 'RECENT') {
        return recentExerciseIds.has(ex.id);
      }
      return true;
    });
  }, [exercises, linkedPlanWeek, blocks, activeTeam.id, catalogAgeGroup, catalogPhase, catalogFocusTag, catalogSearch, catalogTab]);

  async function saveSessionBundleToDb(bundle: {
    session: TrainingSession;
    phases: SessionPhase[];
    blocks: SessionBlock[];
  }) {
    await db.transaction(
      'rw',
      [db.trainingSessions, db.sessionPhases, db.sessionBlocks, db.syncOutbox],
      async () => {
        await db.trainingSessions.put(bundle.session);
        await queueSyncOperation('training_sessions', bundle.session.id, 'UPSERT', bundle.session);
        if (bundle.phases.length > 0) {
          await db.sessionPhases.bulkPut(bundle.phases);
          for (const p of bundle.phases) {
            await queueSyncOperation('session_phases', p.id, 'UPSERT', p);
          }
        }
        if (bundle.blocks.length > 0) {
          await db.sessionBlocks.bulkPut(bundle.blocks);
          for (const b of bundle.blocks) {
            await queueSyncOperation('session_blocks', b.id, 'UPSERT', b);
          }
        }
      }
    );
    setSelectedSessionId(bundle.session.id);
    if (bundle.phases[0]) {
      setActivePhaseId(bundle.phases[0].id);
    }
  }

  async function handleCreateSessionFromTemplate(e: React.FormEvent) {
    e.preventDefault();
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    const bundle = buildSessionFromTemplate({
      teamId: activeTeam.id,
      sessionDate: newSessionDate,
      startTime: newSessionStart,
      endTime: newSessionEnd,
      title: newSessionTitle,
      planWeekId: linkedPlanWeek?.id,
      template: tpl,
      defaultCoachMemberId: members[0]?.id
    });
    await saveSessionBundleToDb(bundle);
    setShowNewSessionForm(false);
  }

  async function handleCloneCurrentSession() {
    if (!currentSession) return;
    // Default next date: +2 days
    const baseDate = new Date(currentSession.session_date);
    baseDate.setDate(baseDate.getDate() + 2);
    const nextDateStr = baseDate.toISOString().slice(0, 10);

    const cloned = cloneTrainingSessionBundle({
      sourceSession: currentSession,
      sourcePhases: currentPhases,
      sourceBlocks: currentBlocks,
      newDate: nextDateStr,
      newTitle: `${currentSession.title} (Folgeeinheit)`
    });
    await saveSessionBundleToDb(cloned);
  }

  async function handleSaveCurrentAsTemplate() {
    if (!currentSession) return;
    const tpl = buildTemplateFromSession({
      clubId,
      title: `Vorlage: ${currentSession.title}`,
      description: `Gespeichert aus ${activeTeam.name} (${currentPhases.length} Phasen)`,
      session: currentSession,
      phases: currentPhases,
      blocks: currentBlocks
    });
    await db.sessionTemplates.put(tpl);
    await queueSyncOperation('session_templates', tpl.id, 'UPSERT', tpl);
    setSavedTemplateBanner(`Vorlage „${tpl.title}" gespeichert!`);
    setTimeout(() => setSavedTemplateBanner(null), 3500);
  }

  async function handleUpdateSessionHeader(patch: Partial<TrainingSession>) {
    if (!currentSession) return;
    const nextStart = patch.start_time ?? currentSession.start_time;
    const nextEnd = patch.end_time ?? currentSession.end_time;
    const plannedMin = calculateMinutesBetweenTimes(nextStart, nextEnd);

    const updated: TrainingSession = {
      ...currentSession,
      ...patch,
      planned_duration_min: plannedMin,
      updated_at: new Date().toISOString()
    };
    await db.trainingSessions.put(updated);
    await queueSyncOperation('training_sessions', updated.id, 'UPSERT', updated);

    if (patch.status === 'COMPLETED' && currentSession.status !== 'COMPLETED') {
      const nextSession = selectNextSessionAfterCompletion(teamSessions, currentSession.id);
      if (nextSession) {
        setSelectedSessionId(nextSession.id);
        setActivePhaseId('');
        setSavedTemplateBanner(
          `Training „${currentSession.title}“ abgeschlossen – nächste Einheit (${nextSession.session_date}) ausgewählt.`
        );
        setTimeout(() => setSavedTemplateBanner(null), 3500);
      }
    }
  }

  async function handleAddPhase(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSession || !newPhaseName.trim()) return;
    const now = new Date().toISOString();
    const newPhase: SessionPhase = {
      id: crypto.randomUUID(),
      training_session_id: currentSession.id,
      name: newPhaseName.trim(),
      sort_order: currentPhases.length + 1,
      target_duration_min: newPhaseDuration,
      updated_at: now
    };
    await db.sessionPhases.put(newPhase);
    await queueSyncOperation('session_phases', newPhase.id, 'UPSERT', newPhase);
    setActivePhaseId(newPhase.id);
    setNewPhaseName('');
  }

  async function handleDeletePhase(phaseId: string) {
    const phaseBlocks = currentBlocks.filter((b) => b.session_phase_id === phaseId);
    await db.transaction('rw', [db.sessionPhases, db.sessionBlocks, db.syncOutbox], async () => {
      await db.sessionPhases.delete(phaseId);
      await queueSyncOperation('session_phases', phaseId, 'DELETE', { id: phaseId });
      for (const b of phaseBlocks) {
        await db.sessionBlocks.delete(b.id);
        await queueSyncOperation('session_blocks', b.id, 'DELETE', { id: b.id });
      }
    });
  }

  async function handleMovePhase(phaseId: string, direction: 'UP' | 'DOWN') {
    const changed = movePhaseInSession(currentPhases, phaseId, direction);
    if (changed.length === 0) return;
    await db.transaction('rw', [db.sessionPhases, db.syncOutbox], async () => {
      await db.sessionPhases.bulkPut(changed);
      for (const p of changed) {
        await queueSyncOperation('session_phases', p.id, 'UPSERT', p);
      }
    });
  }

  async function handleRenamePhase(phase: SessionPhase, name: string) {
    const updated: SessionPhase = {
      ...phase,
      name,
      updated_at: new Date().toISOString()
    };
    await db.sessionPhases.put(updated);
    await queueSyncOperation('session_phases', updated.id, 'UPSERT', updated);
  }

  async function handleUpdatePhaseTargetDuration(phase: SessionPhase, targetMin: number) {
    const updated: SessionPhase = {
      ...phase,
      target_duration_min: Math.max(5, Math.min(90, targetMin || 15)),
      updated_at: new Date().toISOString()
    };
    await db.sessionPhases.put(updated);
    await queueSyncOperation('session_phases', updated.id, 'UPSERT', updated);
  }

  async function handleDropBlock(targetPhaseId: string, targetBlockId?: string) {
    if (!draggedBlockId) return;
    const dragged = currentBlocks.find((b) => b.id === draggedBlockId);
    setDraggedBlockId(null);
    setDragOverPhaseId(null);
    if (!dragged || dragged.id === targetBlockId) return;

    const now = new Date().toISOString();
    if (dragged.session_phase_id !== targetPhaseId) {
      await handleMoveBlockToPhase(dragged, targetPhaseId);
      return;
    }

    if (!targetBlockId) return;
    const phaseBlocks = currentBlocks
      .filter((b) => b.session_phase_id === targetPhaseId)
      .sort((a, b) => a.time_slot_index - b.time_slot_index);
    const fromIdx = phaseBlocks.findIndex((b) => b.id === dragged.id);
    const toIdx = phaseBlocks.findIndex((b) => b.id === targetBlockId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    const reordered = [...phaseBlocks];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updated = reordered.map((b, idx) => ({
      ...b,
      time_slot_index: idx,
      updated_at: now
    }));

    await db.transaction('rw', [db.sessionBlocks, db.syncOutbox], async () => {
      await db.sessionBlocks.bulkPut(updated);
      for (const b of updated) {
        await queueSyncOperation('session_blocks', b.id, 'UPSERT', b);
      }
    });
  }

  async function handleMoveBlockInPhase(
    phaseId: string,
    blockId: string,
    direction: 'UP' | 'DOWN'
  ) {
    const phaseBlocks = currentBlocks.filter((b) => b.session_phase_id === phaseId);
    const changed = moveBlockInPhase(phaseBlocks, blockId, direction);
    if (changed.length === 0) return;
    await db.transaction('rw', [db.sessionBlocks, db.syncOutbox], async () => {
      await db.sessionBlocks.bulkPut(changed);
      for (const b of changed) {
        await queueSyncOperation('session_blocks', b.id, 'UPSERT', b);
      }
    });
  }

  async function handleToggleBlockParallel(phaseId: string, blockId: string) {
    const phaseBlocks = currentBlocks.filter((b) => b.session_phase_id === phaseId);
    const changed = toggleBlockParallelWithPrevious(phaseBlocks, blockId);
    if (changed.length === 0) return;
    await db.transaction('rw', [db.sessionBlocks, db.syncOutbox], async () => {
      await db.sessionBlocks.bulkPut(changed);
      for (const b of changed) {
        await queueSyncOperation('session_blocks', b.id, 'UPSERT', b);
      }
    });
  }

  async function handleMoveBlockToPhase(block: SessionBlock, targetPhaseId: string) {
    if (block.session_phase_id === targetPhaseId) return;
    const targetBlocks = currentBlocks.filter((b) => b.session_phase_id === targetPhaseId);
    const nextSlot =
      targetBlocks.length > 0
        ? Math.max(...targetBlocks.map((b) => b.time_slot_index)) + 1
        : 0;
    const updated: SessionBlock = {
      ...block,
      session_phase_id: targetPhaseId,
      time_slot_index: nextSlot,
      updated_at: new Date().toISOString()
    };
    await db.sessionBlocks.put(updated);
    await queueSyncOperation('session_blocks', updated.id, 'UPSERT', updated);
    setActivePhaseId(targetPhaseId);
  }

  async function handleDeleteSession(sessionId: string) {
    const sessionPhases = phases.filter((p) => p.training_session_id === sessionId);
    const phaseIds = new Set(sessionPhases.map((p) => p.id));
    const sessionBlocks = blocks.filter((b) => phaseIds.has(b.session_phase_id));
    const sessionNotes = notes.filter((n) => n.training_session_id === sessionId);

    await db.transaction(
      'rw',
      [db.trainingSessions, db.sessionPhases, db.sessionBlocks, db.sessionNotes, db.syncOutbox],
      async () => {
        const childKeys = new Set<string>();
        await db.trainingSessions.delete(sessionId);
        await queueSyncOperation('training_sessions', sessionId, 'DELETE', { id: sessionId });
        for (const p of sessionPhases) {
          await db.sessionPhases.delete(p.id);
          childKeys.add(`session_phases:${p.id}`);
        }
        for (const b of sessionBlocks) {
          await db.sessionBlocks.delete(b.id);
          childKeys.add(`session_blocks:${b.id}`);
        }
        for (const n of sessionNotes) {
          await db.sessionNotes.delete(n.id);
          childKeys.add(`session_notes:${n.id}`);
        }
        await purgePendingOutboxUpserts(childKeys);
      }
    );

    setConfirmDeleteSessionId(null);
    const remaining = teamSessions.filter((s) => s.id !== sessionId);
    setSelectedSessionId(selectDefaultSession(remaining)?.id ?? '');
  }

  async function handleAddExerciseToPhase(exercise: Exercise, asParallelTrack: boolean) {
    if (!targetPhase) return;
    const blocksInTarget = currentBlocks.filter((b) => b.session_phase_id === targetPhase.id);
    const maxSlot =
      blocksInTarget.length > 0
        ? Math.max(...blocksInTarget.map((b) => b.time_slot_index))
        : 0;

    const slotIndex =
      blocksInTarget.length === 0 ? 0 : asParallelTrack ? maxSlot : maxSlot + 1;

    const now = new Date().toISOString();
    const newBlock: SessionBlock = {
      id: crypto.randomUUID(),
      session_phase_id: targetPhase.id,
      exercise_id: exercise.id,
      time_slot_index: slotIndex,
      track_label: asParallelTrack ? 'Spur B: Parallel-Gruppe' : 'Alle Spieler',
      assigned_member_id: members[0]?.id,
      custom_duration_min: exercise.default_duration_min,
      updated_at: now
    };

    await db.sessionBlocks.put(newBlock);
    await queueSyncOperation('session_blocks', newBlock.id, 'UPSERT', newBlock);
  }

  async function handleAddQuickBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!targetPhase || !quickTitle.trim()) return;
    const blocksInTarget = currentBlocks.filter((b) => b.session_phase_id === targetPhase.id);
    const maxSlot =
      blocksInTarget.length > 0
        ? Math.max(...blocksInTarget.map((b) => b.time_slot_index))
        : 0;

    const slotIndex =
      blocksInTarget.length === 0 ? 0 : quickIsParallel ? maxSlot : maxSlot + 1;

    const now = new Date().toISOString();
    const newBlock: SessionBlock = {
      id: crypto.randomUUID(),
      session_phase_id: targetPhase.id,
      quick_block_title: quickTitle.trim(),
      quick_block_description: quickDesc.trim() || undefined,
      time_slot_index: slotIndex,
      track_label: quickTrackLabel.trim() || (quickIsParallel ? 'Spur B' : 'Alle Spieler'),
      assigned_member_id: members[0]?.id,
      custom_duration_min: quickDuration,
      updated_at: now
    };

    await db.sessionBlocks.put(newBlock);
    await queueSyncOperation('session_blocks', newBlock.id, 'UPSERT', newBlock);
    setQuickTitle('');
    setQuickDesc('');
    setQuickIsParallel(false);
  }

  async function handleUpdateBlock(block: SessionBlock, patch: Partial<SessionBlock>) {
    const updated: SessionBlock = {
      ...block,
      ...patch,
      updated_at: new Date().toISOString()
    };
    await db.sessionBlocks.put(updated);
    await queueSyncOperation('session_blocks', updated.id, 'UPSERT', updated);
  }

  async function handleDeleteBlock(blockId: string) {
    await db.sessionBlocks.delete(blockId);
    await queueSyncOperation('session_blocks', blockId, 'DELETE', { id: blockId });
  }

  async function handlePromoteQuickBlockToCatalog(block: SessionBlock) {
    const teamAgeGroup = resolveTeamAgeGroup(activeTeam);
    const { exercise, updatedBlock } = convertQuickBlockToCatalogExercise({
      block,
      clubId,
      teamId: activeTeam.id,
      focusTags: linkedPlanWeek?.focus_tags,
      ageGroups: teamAgeGroup ? [teamAgeGroup] : undefined
    });
    await db.transaction('rw', [db.exercises, db.sessionBlocks], async () => {
      await db.exercises.put(exercise);
      await db.sessionBlocks.put(updatedBlock);
    });
    await queueSyncOperation('exercises', exercise.id, 'UPSERT', exercise);
    await queueSyncOperation('session_blocks', updatedBlock.id, 'UPSERT', updatedBlock);
  }

  async function handleAddBlockNote(e: React.FormEvent, blockId: string) {
    e.preventDefault();
    if (!currentSession || !noteContent.trim()) return;
    const author = members.find((m) => m.id === noteAuthorId) ?? members[0];
    const now = new Date().toISOString();
    const newNote: SessionNote = {
      id: crypto.randomUUID(),
      training_session_id: currentSession.id,
      session_block_id: blockId,
      author_member_id: author?.id,
      author_name: author ? author.display_name.split(' (')[0] : 'Trainer',
      content: noteContent.trim(),
      created_at: now,
      updated_at: now
    };
    await db.sessionNotes.put(newNote);
    await queueSyncOperation('session_notes', newNote.id, 'UPSERT', newNote);
    setNoteContent('');
    setNoteBlockId(null);
  }

  const timeExceedsBudget =
    currentSession && totalSessionDuration > currentSession.planned_duration_min;

  return (
    <div className="space-y-6">
      {/* Top Action & Session Selector Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold tracking-wider text-blue-400 uppercase">
              Trainingseinheit:
            </label>
            <select
              value={currentSession?.id ?? ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-bold text-white focus:border-blue-500 focus:outline-none"
            >
              {teamSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.status === 'COMPLETED' ? '✓ ' : s.status === 'CANCELLED' ? '[Ausgefallen] ' : ''}
                  {s.session_date} ({s.start_time}–{s.end_time}) · {s.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentSession && onPrintSession && (
              <button
                type="button"
                onClick={() => onPrintSession(currentSession)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                title="Einzeltraining als Hallen-Handout (A4 PDF) drucken"
              >
                <Printer className="h-3.5 w-3.5 text-emerald-400" />
                Drucken / PDF
              </button>
            )}

            {currentSession && onStartHallMode && (
              <button
                type="button"
                onClick={() => onStartHallMode(currentSession.id)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500"
              >
                🏃 Sporthallen-Modus starten
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowNewSessionForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
              Neues Training (aus Vorlage)
            </button>

            {currentSession && (
              <>
                <button
                  type="button"
                  onClick={handleCloneCurrentSession}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  title="Gesamtes Training inkl. Phasen & Spuren auf neuen Tag kopieren"
                >
                  <Copy className="h-3.5 w-3.5 text-blue-400" />
                  Training kopieren
                </button>

                <button
                  type="button"
                  onClick={handleSaveCurrentAsTemplate}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  title="Phasen-Ablauf als wiederverwendbare Vereins-Vorlage speichern"
                >
                  <BookmarkPlus className="h-3.5 w-3.5 text-emerald-400" />
                  Als Vorlage speichern
                </button>

                {confirmDeleteSessionId === currentSession.id ? (
                  <div className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-950/60 px-2.5 py-1.5 text-xs">
                    <span className="font-semibold text-rose-200">Einheit löschen?</span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSession(currentSession.id)}
                      className="rounded-lg bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-500"
                    >
                      Ja
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSessionId(null)}
                      className="rounded-lg bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                    >
                      Nein
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSessionId(currentSession.id)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/50 hover:border-rose-700/50"
                    title="Aktuelle Trainingseinheit löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {savedTemplateBanner && (
          <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-4 py-2 text-xs font-semibold text-emerald-300">
            ✓ {savedTemplateBanner}
          </div>
        )}

        {/* Inline Form: Neues Training aus Vorlage anlegen */}
        {showNewSessionForm && (
          <form
            onSubmit={handleCreateSessionFromTemplate}
            className="mt-4 rounded-xl border border-blue-500/40 bg-blue-950/20 p-4 space-y-3"
          >
            <div className="text-xs font-bold text-blue-300 uppercase">
              Neue Trainingseinheit für {activeTeam.name} erstellen
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-slate-300">Titel / Schwerpunkt</label>
                <input
                  type="text"
                  required
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-300">Datum</label>
                <input
                  type="date"
                  required
                  value={newSessionDate}
                  onChange={(e) => setNewSessionDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-300">Startzeit</label>
                <input
                  type="time"
                  value={newSessionStart}
                  onChange={(e) => setNewSessionStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-300">Endzeit</label>
                <input
                  type="time"
                  value={newSessionEnd}
                  onChange={(e) => setNewSessionEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-300">Trainings-Vorlage:</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                >
                  <option value="">Standard 5-Phasen-Struktur (Leer)</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title} ({tpl.default_duration_min} Min)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewSessionForm(false)}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  Trainingseinheit anlegen
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Current Session Metadata & Live Time-Budget Bar */}
        {currentSession && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12 items-center">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:col-span-8">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-slate-400">
                  Tagesschwerpunkt / Titel
                </label>
                <input
                  type="text"
                  value={currentSession.title}
                  onChange={(e) => handleUpdateSessionHeader({ title: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Datum & Uhrzeit</label>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={currentSession.session_date}
                    onChange={(e) => handleUpdateSessionHeader({ session_date: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Status</label>
                <select
                  value={currentSession.status}
                  onChange={(e) =>
                    handleUpdateSessionHeader({ status: e.target.value as SessionStatus })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-emerald-300"
                >
                  {(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {SESSION_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Time Budget Progress */}
            <div
              className={`rounded-xl border p-3 lg:col-span-4 ${
                timeExceedsBudget
                  ? 'border-rose-500/60 bg-rose-950/30'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                  {timeExceedsBudget ? (
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                  ) : (
                    <Clock className="h-4 w-4 text-emerald-400" />
                  )}
                  Hallen-Zeitbudget ({currentSession.start_time}–{currentSession.end_time})
                </span>
                <span
                  className={`font-bold ${
                    timeExceedsBudget ? 'text-rose-400' : 'text-white'
                  }`}
                >
                  {totalSessionDuration} / {currentSession.planned_duration_min} Min
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all ${
                    timeExceedsBudget
                      ? 'bg-rose-500'
                      : totalSessionDuration === currentSession.planned_duration_min
                        ? 'bg-emerald-500'
                        : 'bg-blue-500'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (totalSessionDuration /
                          Math.max(1, currentSession.planned_duration_min)) *
                          100
                      )
                    )}%`
                  }}
                />
              </div>
              {timeExceedsBudget && (
                <div className="mt-1 text-[11px] text-rose-300">
                  Achtung: Hallenzeit um {totalSessionDuration - currentSession.planned_duration_min} Min überschritten!
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2-Column Speed-Planning Cockpit */}
      {currentSession && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT COLUMN (7 Cols): Phases, Parallel Tracks & Quick-Block Input */}
          <div className="space-y-4 lg:col-span-7">
            {currentPhases.map((phase, phaseIndex) => {
              const isTargetPhase = targetPhase?.id === phase.id;
              const phaseBlocks = currentBlocks.filter((b) => b.session_phase_id === phase.id);
              const effectiveMin = calculatePhaseEffectiveDuration(phase, phaseBlocks);

              // Group blocks by time_slot_index so parallel tracks render side-by-side
              const slotsMap = new Map<number, SessionBlock[]>();
              for (const b of phaseBlocks) {
                const list = slotsMap.get(b.time_slot_index) ?? [];
                slotsMap.set(b.time_slot_index, [...list, b]);
              }
              const sortedSlots = Array.from(slotsMap.entries()).sort((a, b) => a[0] - b[0]);

              return (
                <div
                  key={phase.id}
                  onClick={() => setActivePhaseId(phase.id)}
                  onDragOver={(e) => {
                    if (!draggedBlockId) return;
                    e.preventDefault();
                    setDragOverPhaseId(phase.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverPhaseId === phase.id) setDragOverPhaseId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleDropBlock(phase.id);
                  }}
                  className={`cursor-pointer rounded-2xl border p-5 transition ${
                    dragOverPhaseId === phase.id
                      ? 'border-emerald-400 bg-emerald-950/20'
                      : isTargetPhase
                        ? 'border-blue-500 bg-slate-900 shadow-lg shadow-blue-950/30'
                        : 'border-slate-800 bg-slate-900/75 hover:border-slate-700'
                  }`}
                >
                  {/* Phase Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex min-w-0 flex-1 basis-[240px] flex-wrap items-center gap-x-2 gap-y-1">
                      {isTargetPhase && (
                        <span className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                          Aktive Phase
                        </span>
                      )}
                      <div className="relative grid min-w-[200px] flex-1 basis-[220px]">
                        <span
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1 px-0.5 py-0.5 text-sm font-bold leading-snug whitespace-pre-wrap break-words"
                        >
                          {phase.name || 'Phase benennen...'}
                        </span>
                        <textarea
                          rows={1}
                          value={phase.name}
                          placeholder="Phase benennen..."
                          aria-label="Phasenname"
                          onChange={(e) =>
                            void handleRenamePhase(phase, e.target.value.replace(/\r?\n/g, ' '))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          className="col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent px-0.5 py-0.5 text-sm font-bold leading-snug text-white focus:border-b focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <div
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${
                          effectiveMin > phase.target_duration_min + 5
                            ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                            : effectiveMin > phase.target_duration_min
                              ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                              : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                        title="Phasen-Zeitbudget: Ist-Dauer vs. Soll-Budget"
                      >
                        <span>Ist: {effectiveMin}</span>
                        <span className="opacity-60">/</span>
                        <span>Soll:</span>
                        <input
                          type="number"
                          min={5}
                          max={90}
                          value={phase.target_duration_min}
                          onChange={(e) =>
                            void handleUpdatePhaseTargetDuration(phase, Number(e.target.value))
                          }
                          className="w-10 rounded bg-slate-900/80 px-1 text-center font-bold text-white focus:outline-none"
                        />
                        <span>Min</span>
                      </div>
                      <button
                        type="button"
                        disabled={phaseIndex === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleMovePhase(phase.id, 'UP');
                        }}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                        title="Phase nach oben verschieben"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={phaseIndex === currentPhases.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleMovePhase(phase.id, 'DOWN');
                        }}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                        title="Phase nach unten verschieben"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeletePhase(phase.id);
                        }}
                        className="rounded-lg p-1 text-slate-500 hover:bg-rose-950/50 hover:text-rose-400"
                        title="Phase löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Time Slots & Parallel Tracks inside Phase */}
                  <div className="mt-4 space-y-3">
                    {sortedSlots.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
                        Noch keine Übung in dieser Phase – wähle rechts im Katalog eine Übung oder tippe unten einen Quick-Block ein.
                      </div>
                    ) : (
                      sortedSlots.map(([slotIdx, slotBlocks], slotOrderIndex) => {
                        const isParallelSlot = slotBlocks.length > 1;
                        return (
                          <div key={slotIdx} className="space-y-1.5">
                            {isParallelSlot && (
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                                <Layers className="h-3.5 w-3.5" />
                                Paralleler Zeitblock (Haupt- & Co-Trainer parallel – längste Spur zählt)
                              </div>
                            )}

                            <div
                              className={`grid gap-3 ${
                                isParallelSlot ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
                              }`}
                            >
                              {slotBlocks.map((block) => {
                                const linkedEx = block.exercise_id
                                  ? exercisesById.get(block.exercise_id)
                                  : undefined;
                                const blockNotes = notes.filter(
                                  (n) => n.session_block_id === block.id
                                );

                                return (
                                  <div
                                    key={block.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.stopPropagation();
                                      setDraggedBlockId(block.id);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedBlockId(null);
                                      setDragOverPhaseId(null);
                                    }}
                                    onDragOver={(e) => {
                                      if (!draggedBlockId || draggedBlockId === block.id) return;
                                      e.preventDefault();
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      void handleDropBlock(phase.id, block.id);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className={`min-w-0 rounded-xl border bg-slate-950/90 p-3.5 space-y-2.5 transition ${
                                      draggedBlockId === block.id
                                        ? 'border-blue-500 opacity-50'
                                        : 'border-slate-800'
                                    }`}
                                  >
                                    {/* Track label, duration & coach selector */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className="cursor-grab text-slate-500 hover:text-slate-300"
                                          title="Block per Drag & Drop verschieben"
                                        >
                                          <GripVertical className="h-4 w-4" />
                                        </span>
                                        <input
                                        type="text"
                                        value={block.track_label}
                                        onChange={(e) =>
                                          void handleUpdateBlock(block, {
                                            track_label: e.target.value
                                          })
                                        }
                                        className="min-w-0 w-full max-w-[160px] rounded bg-blue-950/80 px-2 py-0.5 text-[11px] font-semibold text-blue-300 focus:outline-none"
                                        title="Spur / Gruppe umbenennen"
                                      />
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <input
                                          type="number"
                                          min={3}
                                          max={60}
                                          value={block.custom_duration_min}
                                          onChange={(e) =>
                                            void handleUpdateBlock(block, {
                                              custom_duration_min: Number(e.target.value)
                                            })
                                          }
                                          className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center text-xs font-bold text-white"
                                        />
                                        <span className="text-[11px] text-slate-400">Min</span>

                                        <select
                                          value={block.assigned_member_id ?? ''}
                                          onChange={(e) =>
                                            void handleUpdateBlock(block, {
                                              assigned_member_id: e.target.value || undefined
                                            })
                                          }
                                          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300"
                                        >
                                          <option value="">Trainer...</option>
                                          {members.map((m) => (
                                            <option key={m.id} value={m.id}>
                                              {m.display_name.split(' (')[0]}
                                            </option>
                                          ))}
                                        </select>

                                        {currentPhases.length > 1 && (
                                          <select
                                            value={phase.id}
                                            onChange={(e) =>
                                              void handleMoveBlockToPhase(block, e.target.value)
                                            }
                                            className="min-w-0 max-w-[220px] sm:max-w-[260px] rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300"
                                            title="Übung in eine andere Phase verschieben"
                                          >
                                            {currentPhases.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                {p.id === phase.id ? `Phase: ${p.name}` : `→ ${p.name}`}
                                              </option>
                                            ))}
                                          </select>
                                        )}

                                        {(isParallelSlot || slotOrderIndex > 0) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleToggleBlockParallel(phase.id, block.id)
                                            }
                                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                                              isParallelSlot
                                                ? 'border-amber-500/40 bg-amber-950/50 text-amber-300 hover:bg-amber-900/50'
                                                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                            }`}
                                            title={
                                              isParallelSlot
                                                ? 'Aus Parallel-Block als eigene Übung danach lösen'
                                                : 'Parallel zum vorherigen Block ausführen'
                                            }
                                          >
                                            {isParallelSlot ? 'Trennen' : 'Parallel'}
                                          </button>
                                        )}

                                        <button
                                          type="button"
                                          disabled={!isParallelSlot && slotOrderIndex === 0}
                                          onClick={() =>
                                            void handleMoveBlockInPhase(phase.id, block.id, 'UP')
                                          }
                                          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                          title="Innerhalb der Phase nach oben verschieben"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5" />
                                        </button>

                                        <button
                                          type="button"
                                          disabled={
                                            !isParallelSlot &&
                                            slotOrderIndex === sortedSlots.length - 1
                                          }
                                          onClick={() =>
                                            void handleMoveBlockInPhase(phase.id, block.id, 'DOWN')
                                          }
                                          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                          title="Innerhalb der Phase nach unten verschieben"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5" />
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => void handleDeleteBlock(block.id)}
                                          className="text-slate-500 hover:text-rose-400"
                                          title="Block aus Phase entfernen"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Exercise or Quick-Block Content */}
                                    {linkedEx ? (
                                      <div>
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onOpenExercise
                                                ? onOpenExercise(linkedEx)
                                                : onEditExercise(linkedEx)
                                            }
                                            className="group inline-flex min-w-0 items-center gap-1 text-left font-bold text-white text-sm hover:text-blue-400"
                                            title="Übungsdetails in der Übungsdatenbank ansehen"
                                          >
                                            <span className="group-hover:underline">
                                              {linkedEx.title}
                                            </span>
                                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-blue-400" />
                                          </button>
                                          <div className="flex shrink-0 items-center gap-1">
                                            {onOpenExercise && (
                                              <button
                                                type="button"
                                                onClick={() => onOpenExercise(linkedEx)}
                                                className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700"
                                                title="Übungsdetails & Ablauf öffnen"
                                              >
                                                <BookOpen className="h-3 w-3" />
                                                Details
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => onEditExercise(linkedEx)}
                                              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-blue-300 hover:bg-slate-700"
                                              title="Übung & Taktikskizze bearbeiten"
                                            >
                                              <Edit3 className="h-3 w-3" />
                                              Bearbeiten
                                            </button>
                                          </div>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-300 line-clamp-2">
                                          {linkedEx.flow_description}
                                        </p>
                                      </div>
                                    ) : (
                                      <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/15 p-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 uppercase">
                                            <Zap className="h-3 w-3" />
                                            Freier Quick-Block
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handlePromoteQuickBlockToCatalog(block)
                                            }
                                            className="inline-flex items-center gap-1 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-500"
                                            title="Diesen freien Block mit 1 Klick als dauerhafte Übung in der Übungsdatenbank speichern"
                                          >
                                            <BookOpen className="h-3 w-3" />
                                            In Übungsdatenbank umwandeln
                                          </button>
                                        </div>
                                        <input
                                          type="text"
                                          value={block.quick_block_title ?? ''}
                                          onChange={(e) =>
                                            void handleUpdateBlock(block, {
                                              quick_block_title: e.target.value
                                            })
                                          }
                                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-bold text-white"
                                        />
                                        <textarea
                                          rows={2}
                                          placeholder="Kurzbeschreibung / Coaching-Fokus..."
                                          value={block.quick_block_description ?? ''}
                                          onChange={(e) =>
                                            void handleUpdateBlock(block, {
                                              quick_block_description: e.target.value
                                            })
                                          }
                                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                                        />
                                      </div>
                                    )}

                                    {/* Trainer Notes on Block */}
                                    <div className="border-t border-slate-800/80 pt-2 space-y-1.5">
                                      {blockNotes.map((n) => (
                                        <div
                                          key={n.id}
                                          className="rounded bg-slate-900 px-2.5 py-1 text-[11px] text-amber-200"
                                        >
                                          <strong className="text-amber-400">
                                            {n.author_name}:
                                          </strong>{' '}
                                          {n.content}
                                        </div>
                                      ))}

                                      {noteBlockId === block.id ? (
                                        <form
                                          onSubmit={(e) => void handleAddBlockNote(e, block.id)}
                                          className="flex flex-wrap items-center gap-1.5 pt-1"
                                        >
                                          <select
                                            value={noteAuthorId}
                                            onChange={(e) => setNoteAuthorId(e.target.value)}
                                            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-white"
                                          >
                                            {members.map((m) => (
                                              <option key={m.id} value={m.id}>
                                                {m.display_name.split(' (')[0]}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="text"
                                            required
                                            autoFocus
                                            placeholder="Trainer-Notiz..."
                                            value={noteContent}
                                            onChange={(e) => setNoteContent(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                setNoteBlockId(null);
                                                setNoteContent('');
                                              }
                                            }}
                                            className="min-w-[120px] flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                                          />
                                          <button
                                            type="submit"
                                            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                                          >
                                            OK
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setNoteBlockId(null);
                                              setNoteContent('');
                                            }}
                                            className="inline-flex items-center justify-center rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 hover:text-white"
                                            title="Abbrechen"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </form>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setNoteBlockId(block.id)}
                                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-300"
                                        >
                                          <MessageSquarePlus className="h-3 w-3" />
                                          + Trainer-Notiz
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Quick-Block Speed-Bar inside the Active Phase */}
                  {isTargetPhase && (
                    <form
                      onSubmit={handleAddQuickBlock}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-4 rounded-xl border border-blue-500/30 bg-slate-950 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1 font-bold text-blue-300">
                          <Zap className="h-3.5 w-3.5 text-amber-400" />
                          Schneller Quick-Block in „{phase.name}" (ohne Katalog-Zwang):
                        </span>
                        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={quickIsParallel}
                            onChange={(e) => setQuickIsParallel(e.target.checked)}
                            className="rounded border-slate-700"
                          />
                          Als parallele Spur (z.B. Co-Trainer / Torwart)
                        </label>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                        <input
                          type="text"
                          required
                          placeholder="Titel eintippen (z.B. 4gg4 Überzahl-Spiel mit Joker) & Enter..."
                          value={quickTitle}
                          onChange={(e) => setQuickTitle(e.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white sm:col-span-6"
                        />
                        <input
                          type="text"
                          placeholder="Spur (z.B. Alle / TW)"
                          value={quickTrackLabel}
                          onChange={(e) => setQuickTrackLabel(e.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white sm:col-span-3"
                        />
                        <input
                          type="number"
                          min={3}
                          max={60}
                          value={quickDuration}
                          onChange={(e) => setQuickDuration(Number(e.target.value))}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white sm:col-span-1"
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 sm:col-span-2"
                        >
                          + Block
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}

            {/* Add new phase form */}
            <form
              onSubmit={handleAddPhase}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
            >
              <input
                type="text"
                required
                placeholder="Neue Trainingsphase hinzufügen (z.B. 6. Individuelles Wurftraining)..."
                value={newPhaseName}
                onChange={(e) => setNewPhaseName(e.target.value)}
                className="min-w-[220px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
              />
              <input
                type="number"
                min={5}
                max={60}
                value={newPhaseDuration}
                onChange={(e) => setNewPhaseDuration(Number(e.target.value))}
                className="w-20 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
              >
                <Plus className="h-4 w-4" />
                Phase anlegen
              </button>
            </form>
          </div>

          {/* RIGHT COLUMN (5 Cols): Smart Exercise Catalog & Packing List */}
          <div className="space-y-6 lg:col-span-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
              <div>
                <span className="text-[11px] font-bold tracking-wider text-blue-400 uppercase">
                  Übungs-Baukasten → Ziel: {targetPhase?.name ?? 'Phase wählen'}
                </span>
                <h3 className="text-base font-bold text-white">
                  1-Klick-Zuweisung in aktive Trainingsphase
                </h3>
              </div>

              {/* 3 Smart Tabs */}
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setCatalogTab('SMART_FOCUS')}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                    catalogTab === 'SMART_FOCUS'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Schwerpunkt
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogTab('ALL')}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                    catalogTab === 'ALL'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Alle ({exercises.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogTab('RECENT')}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                    catalogTab === 'RECENT'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  Zuletzt genutzt
                </button>
              </div>

              {catalogTab === 'SMART_FOCUS' && linkedPlanWeek && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs">
                  <div className="font-semibold text-emerald-300">
                    Gefiltert nach {linkedPlanWeek.focus_theme}:
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {linkedPlanWeek.focus_tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] text-emerald-300"
                      >
                        #{FOCUS_TAG_LABELS[t]}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Search & Altersstufe Filter */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Übung im Katalog filtern..."
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 text-xs text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="planner-age-group-filter"
                    className="shrink-0 text-[11px] font-semibold text-slate-400"
                  >
                    Altersstufe:
                  </label>
                  <select
                    id="planner-age-group-filter"
                    value={catalogAgeGroup}
                    onChange={(e) => setCatalogAgeGroup(e.target.value as 'ALL' | AgeGroup)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">Alle Altersstufen</option>
                    {ALL_AGE_GROUPS.map((ag) => (
                      <option key={ag} value={ag}>
                        {AGE_GROUP_LABELS[ag]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="planner-phase-filter"
                    className="shrink-0 text-[11px] font-semibold text-slate-400"
                  >
                    Phase:
                  </label>
                  <select
                    id="planner-phase-filter"
                    value={catalogPhase}
                    onChange={(e) => setCatalogPhase(e.target.value as 'ALL' | TrainingPhaseCategory)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">Alle Trainingsphasen</option>
                    {(Object.keys(PHASE_CATEGORY_LABELS) as TrainingPhaseCategory[]).map((p) => (
                      <option key={p} value={p}>
                        {PHASE_CATEGORY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="planner-focus-filter"
                    className="shrink-0 text-[11px] font-semibold text-slate-400"
                  >
                    Tag / Technik:
                  </label>
                  <select
                    id="planner-focus-filter"
                    value={catalogFocusTag}
                    onChange={(e) => setCatalogFocusTag(e.target.value as 'ALL' | HandballFocusTag)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">Alle Schwerpunkte & Techniken</option>
                    <optgroup label="Taktik & Spielphasen">
                      {TACTIC_FOCUS_TAGS.map((f) => (
                        <option key={f} value={f}>
                          {FOCUS_TAG_LABELS[f]}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Techniken">
                      {TECHNIQUE_FOCUS_TAGS.map((f) => (
                        <option key={f} value={f}>
                          {FOCUS_TAG_LABELS[f]}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Athletik & Regeneration">
                      {ATHLETICS_RECOVERY_FOCUS_TAGS.map((f) => (
                        <option key={f} value={f}>
                          {FOCUS_TAG_LABELS[f]}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* Exercise Cards */}
              <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-1">
                {smartCatalogExercises.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-4 text-center space-y-2">
                    <div className="text-xs text-slate-400">
                      Keine Übungen für die aktuellen Filter gefunden.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeCatalogFilters({
                          catalogTab: 'ALL',
                          catalogSearch: '',
                          catalogAgeGroup: 'ALL',
                          catalogPhase: 'ALL',
                          catalogFocusTag: 'ALL'
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-slate-700"
                    >
                      Alle Filter zurücksetzen
                    </button>
                  </div>
                ) : (
                  smartCatalogExercises.slice(0, visibleCatalogCount).map((ex) => {
                  const isPreviewOpen = previewExerciseId === ex.id;
                  return (
                    <div
                      key={ex.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {onOpenExercise ? (
                            <button
                              type="button"
                              onClick={() => onOpenExercise(ex)}
                              className="group inline-flex items-center gap-1 text-left font-bold text-white text-xs hover:text-blue-400"
                              title="Übung in der Übungsdatenbank öffnen"
                            >
                              <span className="truncate group-hover:underline">{ex.title}</span>
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-blue-400" />
                            </button>
                          ) : (
                            <div className="font-bold text-white text-xs">{ex.title}</div>
                          )}
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {ex.default_duration_min} Min · {ex.min_players}–{ex.max_players} Sp. +{' '}
                            {ex.goalkeepers} TW
                          </div>
                          {(ex.categories.age_groups ?? []).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(ex.categories.age_groups ?? []).map((ag) => (
                                <span
                                  key={ag}
                                  className="rounded bg-indigo-950/90 border border-indigo-700/40 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200"
                                >
                                  {AGE_GROUP_LABELS[ag]}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {onOpenExercise && (
                            <button
                              type="button"
                              onClick={() => onOpenExercise(ex)}
                              className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-slate-700"
                              title="Zur Übung navigieren"
                            >
                              Öffnen
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewExerciseId(isPreviewOpen ? null : ex.id)
                            }
                            className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                          >
                            {isPreviewOpen ? 'Skizze ▲' : 'Skizze ▼'}
                          </button>
                        </div>
                      </div>

                      {isPreviewOpen && (
                        <TacticBoardPreview data={ex.tactic_board_data} />
                      )}

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleAddExerciseToPhase(ex, false)}
                          className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          + In Phase einfügen
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAddExerciseToPhase(ex, true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/30 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-900/40"
                          title="Parallel zum bestehenden Block in dieser Phase ausführen (z.B. Gruppe B / Torwart)"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          + Parallel
                        </button>
                      </div>
                    </div>
                  );
                  })
                )}
                {smartCatalogExercises.length > visibleCatalogCount && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCatalogCount((prev) => prev + PLANNER_CATALOG_PAGE_SIZE)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    Weitere Übungen anzeigen ({visibleCatalogCount} von{' '}
                    {smartCatalogExercises.length})
                  </button>
                )}
              </div>
            </div>

            {/* Automatic Material Packing List */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
              <div className="flex items-center gap-2 text-amber-400">
                <Package className="h-5 w-5" />
                <h3 className="text-base font-bold text-white">
                  Automatische Material-Packliste ({sessionPackingList.length})
                </h3>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Berücksichtigt parallele Spuren (gleichzeitiger Materialbedarf wird addiert):
              </p>
              <div className="mt-3 space-y-2">
                {sessionPackingList.map((item) => (
                  <div
                    key={item.type}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2 text-slate-200">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      {MATERIAL_LABELS[item.type]}
                    </span>
                    <span className="rounded bg-blue-950 px-2 py-0.5 font-bold text-blue-300">
                      {item.quantity}x
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
