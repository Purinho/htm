import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CalendarPlus,
  CalendarRange,
  Edit3,
  Play,
  Plus,
  Sparkles,
  Tag,
  Trash2
} from 'lucide-react';
import { db, purgePendingOutboxUpserts, queueSyncOperation } from '../db/database';
import type {
  ClubMember,
  HandballFocusTag,
  MultiWeekPlan,
  PlanWeek,
  SessionTemplate,
  Team,
  TrainingSession
} from '../types/domain';
import { FOCUS_TAG_LABELS } from '../constants/handballLabels';
import {
  addDaysIso,
  buildMultiWeekPlanDeletionPlan,
  formatIsoDateDe,
  generateMultiWeekPlanBundle,
  getIsoWeekNumber,
  getUpcomingMondayIso
} from '../utils/multiWeekPlanUtils';
import { buildSessionFromTemplate } from '../utils/sessionPlannerUtils';
import { reconcileSelectedTemplateId } from '../utils/sessionTemplateUtils';
import { GermanWeekPicker } from './GermanWeekPicker';

interface MultiWeekPlanManagerProps {
  activeTeam: Team;
  members: ClubMember[];
  plans: MultiWeekPlan[];
  planWeeks: PlanWeek[];
  sessions: TrainingSession[];
  templates: SessionTemplate[];
  onOpenSessionInEditor: (sessionId: string) => void;
  onStartHallMode: (sessionId: string) => void;
  onOpenTemplateManager?: () => void;
}

const ALL_FOCUS_TAGS = Object.keys(FOCUS_TAG_LABELS) as HandballFocusTag[];

export function MultiWeekPlanManager({
  activeTeam,
  members,
  plans,
  planWeeks,
  sessions,
  templates,
  onOpenSessionInEditor,
  onStartHallMode,
  onOpenTemplateManager
}: MultiWeekPlanManagerProps) {
  const teamPlans = useMemo(
    () =>
      plans
        .filter((p) => p.team_id === activeTeam.id)
        .sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [plans, activeTeam.id]
  );

  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const activePlan = useMemo(() => {
    if (selectedPlanId) {
      const found = teamPlans.find((p) => p.id === selectedPlanId);
      if (found) return found;
    }
    return teamPlans[0] ?? null;
  }, [teamPlans, selectedPlanId]);

  const activeWeeks = useMemo(
    () =>
      activePlan
        ? planWeeks
            .filter((pw) => pw.multi_week_plan_id === activePlan.id)
            .sort((a, b) => a.week_number - b.week_number)
        : [],
    [planWeeks, activePlan]
  );

  // Generator form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState(
    'Aufbaublock Rückrunde: Tempospiel & Abwehr-Kooperation'
  );
  const [newStartDate, setNewStartDate] = useState(() => getUpcomingMondayIso());
  const [newWeekCount, setNewWeekCount] = useState(4);
  const [newGoals, setNewGoals] = useState(
    'Steigerung der 1. & 2. Welle sowie stabile Übergaben im Innenblock.'
  );
  const [newTemplateId, setNewTemplateId] = useState<string>(templates[0]?.id ?? '');
  const effectiveTemplateId = useMemo(
    () => reconcileSelectedTemplateId(newTemplateId, templates),
    [newTemplateId, templates]
  );

  // Expanded tag selector per week
  const [editingTagsWeekId, setEditingTagsWeekId] = useState<string | null>(null);

  // Plan deletion confirmation state
  const [confirmDeletePlanId, setConfirmDeletePlanId] = useState<string | null>(null);
  const [deleteLinkedSessions, setDeleteLinkedSessions] = useState(false);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);

  const activeWeekIds = useMemo(
    () => new Set(activeWeeks.map((week) => week.id)),
    [activeWeeks]
  );

  const linkedSessionsForActivePlan = useMemo(
    () =>
      sessions.filter((s) => Boolean(s.plan_week_id && activeWeekIds.has(s.plan_week_id))),
    [sessions, activeWeekIds]
  );

  const completedLinkedSessionsCount = useMemo(
    () => linkedSessionsForActivePlan.filter((s) => s.status === 'COMPLETED').length,
    [linkedSessionsForActivePlan]
  );

  async function handleGeneratePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const defaultTemplate = templates.find((t) => t.id === effectiveTemplateId);
    const bundle = generateMultiWeekPlanBundle({
      team: activeTeam,
      title: newTitle,
      startDate: newStartDate,
      weekCount: newWeekCount,
      goals: newGoals,
      defaultTemplate,
      defaultCoachMemberId: members[0]?.id
    });

    await db.transaction(
      'rw',
      [
        db.multiWeekPlans,
        db.planWeeks,
        db.trainingSessions,
        db.sessionPhases,
        db.sessionBlocks,
        db.syncOutbox
      ],
      async () => {
        await db.multiWeekPlans.put(bundle.plan);
        await queueSyncOperation('multi_week_plans', bundle.plan.id, 'UPSERT', bundle.plan);
        await db.planWeeks.bulkPut(bundle.weeks);
        for (const w of bundle.weeks) {
          await queueSyncOperation('plan_weeks', w.id, 'UPSERT', w);
        }
        if (bundle.sessions.length > 0) {
          await db.trainingSessions.bulkPut(bundle.sessions);
          for (const s of bundle.sessions) {
            await queueSyncOperation('training_sessions', s.id, 'UPSERT', s);
          }
        }
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

    setSelectedPlanId(bundle.plan.id);
    setShowCreateForm(false);
  }

  async function handleUpdateWeek(week: PlanWeek, patch: Partial<PlanWeek>) {
    const updated: PlanWeek = {
      ...week,
      ...patch,
      updated_at: new Date().toISOString()
    };
    await db.planWeeks.put(updated);
    await queueSyncOperation('plan_weeks', updated.id, 'UPSERT', updated);
  }

  async function handleToggleWeekTag(week: PlanWeek, tag: HandballFocusTag) {
    const exists = week.focus_tags.includes(tag);
    const nextTags = exists
      ? week.focus_tags.filter((t) => t !== tag)
      : [...week.focus_tags, tag];
    await handleUpdateWeek(week, { focus_tags: nextTags });
  }

  async function handleAddExtraSessionToWeek(week: PlanWeek) {
    const slot = activeTeam.default_schedule[0];
    const sessionDate = addDaysIso(week.start_date, 5); // Default Saturday of that week
    const bundle = buildSessionFromTemplate({
      teamId: activeTeam.id,
      sessionDate,
      startTime: slot?.startTime ?? '10:00',
      endTime: slot?.endTime ?? '12:00',
      title: `Zusatztraining (${week.focus_theme.split(':')[0]})`,
      planWeekId: week.id,
      template: templates[0],
      defaultCoachMemberId: members[0]?.id
    });

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
  }

  async function handleDeletePlan(planId: string) {
    if (isDeletingPlan) return;
    setIsDeletingPlan(true);

    try {
      await db.transaction(
        'rw',
        [
          db.multiWeekPlans,
          db.planWeeks,
          db.trainingSessions,
          db.sessionPhases,
          db.sessionBlocks,
          db.sessionNotes,
          db.syncOutbox
        ],
        async () => {
          const planWeeksForPlan = await db.planWeeks
            .where('multi_week_plan_id')
            .equals(planId)
            .toArray();
          const weekIds = planWeeksForPlan.map((w) => w.id);
          const linkedSessions =
            weekIds.length > 0
              ? await db.trainingSessions.where('plan_week_id').anyOf(weekIds).toArray()
              : [];
          const linkedSessionIds = linkedSessions.map((s) => s.id);

          const linkedPhases =
            deleteLinkedSessions && linkedSessionIds.length > 0
              ? await db.sessionPhases
                  .where('training_session_id')
                  .anyOf(linkedSessionIds)
                  .toArray()
              : [];
          const phaseIds = linkedPhases.map((p) => p.id);
          const linkedBlocks =
            deleteLinkedSessions && phaseIds.length > 0
              ? await db.sessionBlocks
                  .where('session_phase_id')
                  .anyOf(phaseIds)
                  .toArray()
              : [];
          const linkedNotes =
            deleteLinkedSessions && linkedSessionIds.length > 0
              ? await db.sessionNotes
                  .where('training_session_id')
                  .anyOf(linkedSessionIds)
                  .toArray()
              : [];

          const deletionPlan = buildMultiWeekPlanDeletionPlan({
            planId,
            planWeeks: planWeeksForPlan,
            sessions: linkedSessions,
            phases: linkedPhases,
            blocks: linkedBlocks,
            notes: linkedNotes,
            deleteLinkedSessions
          });

          await db.multiWeekPlans.delete(planId);
          if (deletionPlan.planWeekIdsToDelete.length > 0) {
            await db.planWeeks.bulkDelete(deletionPlan.planWeekIdsToDelete);
          }
          if (deletionPlan.blockIdsToDelete.length > 0) {
            await db.sessionBlocks.bulkDelete(deletionPlan.blockIdsToDelete);
          }
          if (deletionPlan.noteIdsToDelete.length > 0) {
            await db.sessionNotes.bulkDelete(deletionPlan.noteIdsToDelete);
          }
          if (deletionPlan.phaseIdsToDelete.length > 0) {
            await db.sessionPhases.bulkDelete(deletionPlan.phaseIdsToDelete);
          }
          if (deletionPlan.sessionIdsToDelete.length > 0) {
            await db.trainingSessions.bulkDelete(deletionPlan.sessionIdsToDelete);
          }
          if (deletionPlan.sessionsToUnlink.length > 0) {
            await db.trainingSessions.bulkPut(deletionPlan.sessionsToUnlink);
          }

          await purgePendingOutboxUpserts(deletionPlan.outboxUpsertKeysToPurge);

          for (const session of deletionPlan.sessionsToUnlink) {
            await queueSyncOperation('training_sessions', session.id, 'UPSERT', {
              ...session,
              plan_week_id: null
            });
          }
          for (const sessionId of deletionPlan.sessionIdsToDelete) {
            await queueSyncOperation('training_sessions', sessionId, 'DELETE', { id: sessionId });
          }
          await queueSyncOperation('multi_week_plans', planId, 'DELETE', { id: planId });
        }
      );

      setConfirmDeletePlanId(null);
      setDeleteLinkedSessions(false);
      setEditingTagsWeekId(null);
      const remainingPlans = teamPlans.filter((p) => p.id !== planId);
      setSelectedPlanId(remainingPlans[0]?.id ?? '');
    } finally {
      setIsDeletingPlan(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Plan Selector */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-bold tracking-wider text-blue-400 uppercase">
                Mesozyklus- & Mehrwochenplanung ({activeTeam.name})
              </span>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {teamPlans.length > 0 ? (
                  <>
                    <select
                      value={activePlan?.id ?? ''}
                      onChange={(e) => {
                        setSelectedPlanId(e.target.value);
                        setConfirmDeletePlanId(null);
                        setDeleteLinkedSessions(false);
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-bold text-white"
                    >
                      {teamPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({formatIsoDateDe(p.start_date)} – {formatIsoDateDe(p.end_date)})
                        </option>
                      ))}
                    </select>
                    {activePlan && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateForm(false);
                          setDeleteLinkedSessions(false);
                          setConfirmDeletePlanId((prev) =>
                            prev === activePlan.id ? null : activePlan.id
                          );
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:border-rose-700/60 hover:bg-rose-950/50"
                        title="Aktuellen Mesozyklus löschen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Mesozyklus löschen
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-sm font-bold text-white">Noch kein Plan angelegt</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowCreateForm((prev) => !prev);
              setConfirmDeletePlanId(null);
              setDeleteLinkedSessions(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            Neuen Mehrwochenplan & Trainingstage generieren
          </button>
        </div>

        {/* Inline Deletion Confirmation */}
        {activePlan && confirmDeletePlanId === activePlan.id && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/25 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div className="space-y-1 text-xs">
                <div className="font-bold text-rose-100">
                  Mesozyklus „{activePlan.title}“ löschen?
                </div>
                <p className="text-slate-300">
                  Der Mesozyklus und seine {activeWeeks.length} Wochen-Schwerpunkte werden dauerhaft gelöscht.
                </p>
              </div>
            </div>

            {linkedSessionsForActivePlan.length > 0 && (
              <div className="rounded-lg border border-rose-500/30 bg-slate-950/60 p-3 space-y-1.5 text-xs">
                <label className="flex cursor-pointer items-start gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={deleteLinkedSessions}
                    onChange={(e) => setDeleteLinkedSessions(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-rose-600 focus:ring-rose-500"
                  />
                  <span>
                    Auch {linkedSessionsForActivePlan.length} verknüpfte{' '}
                    {linkedSessionsForActivePlan.length === 1
                      ? 'Trainingseinheit'
                      : 'Trainingseinheiten'}{' '}
                    dauerhaft mitlöschen
                    {completedLinkedSessionsCount > 0 && (
                      <span className="ml-1 font-semibold text-amber-300">
                        ({completedLinkedSessionsCount} bereits durchgeführt)
                      </span>
                    )}
                  </span>
                </label>
                <p className="pl-5 text-[11px] text-slate-400">
                  {deleteLinkedSessions
                    ? 'Alle verknüpften Trainingseinheiten werden inklusive ihrer Phasen, Übungsblöcke und Notizen gelöscht.'
                    : 'Ohne Haken bleiben alle Trainingseinheiten als eigenständige Termine erhalten (Verknüpfung zum Mesozyklus wird gelöst).'}
                </p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={() => {
                  setConfirmDeletePlanId(null);
                  setDeleteLinkedSessions(false);
                }}
                className="rounded-xl bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={() => void handleDeletePlan(activePlan.id)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeletingPlan ? 'Wird gelöscht...' : 'Mesozyklus endgültig löschen'}
              </button>
            </div>
          </div>
        )}

        {/* Generator Form */}
        {showCreateForm && (
          <form
            onSubmit={handleGeneratePlan}
            className="mt-5 rounded-xl border border-blue-500/40 bg-blue-950/20 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-400" />
                Automatischer Mehrwochenplan-Generator für {activeTeam.name}
              </h3>
              <span className="text-xs text-blue-300">
                Erzeugt automatisch {newWeekCount * activeTeam.default_schedule.length} Trainingstage anhand eurer festen Hallenzeiten!
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">Titel des Mehrwochenplans *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="mesocycle-start-week"
                  className="mb-1 block text-xs text-slate-300"
                >
                  Startwoche (Datum)
                </label>
                <GermanWeekPicker
                  id="mesocycle-start-week"
                  value={newStartDate}
                  onChange={setNewStartDate}
                  weekCount={newWeekCount}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">Anzahl Wochen</label>
                <select
                  value={newWeekCount}
                  onChange={(e) => setNewWeekCount(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                >
                  {[2, 3, 4, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} Wochen ({n * activeTeam.default_schedule.length} Trainingseinheiten)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Übergeordnete Ziele im Block</label>
                <input
                  type="text"
                  value={newGoals}
                  onChange={(e) => setNewGoals(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-xs text-slate-300">
                    Standard-Vorlage für generierte Trainingstage
                  </label>
                  {onOpenTemplateManager && (
                    <button
                      type="button"
                      onClick={onOpenTemplateManager}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                    >
                      <Bookmark className="h-3 w-3" />
                      Vorlagen verwalten
                    </button>
                  )}
                </div>
                <select
                  value={effectiveTemplateId}
                  onChange={(e) => setNewTemplateId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                >
                  <option value="">Standard 5-Phasen-Struktur</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs text-slate-300"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Mehrwochenplan & Trainingstage erzeugen
              </button>
            </div>
          </form>
        )}

        {activePlan && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-300">
            <div>
              <strong className="text-white">Block-Zielsetzung:</strong> {activePlan.goals}
            </div>
            <div className="text-slate-400">
              Zeitraum: {formatIsoDateDe(activePlan.start_date)} bis{' '}
              {formatIsoDateDe(activePlan.end_date)} ({activeWeeks.length} Wochen)
            </div>
          </div>
        )}
      </div>

      {/* Interactive Week Matrix (Microcycles & Assigned Training Sessions) */}
      {activePlan ? (
        <div className="space-y-4">
          {activeWeeks.map((week) => {
            const weekEndDate = addDaysIso(week.start_date, 6);
            // Match sessions either explicitly linked by plan_week_id OR falling within the week's date range
            const weekSessions = sessions
              .filter(
                (s) =>
                  s.team_id === activeTeam.id &&
                  (s.plan_week_id === week.id ||
                    (s.session_date >= week.start_date && s.session_date <= weekEndDate))
              )
              .sort((a, b) => a.session_date.localeCompare(b.session_date));

            const isEditingTags = editingTagsWeekId === week.id;

            return (
              <div
                key={week.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-md"
                style={{ borderLeftWidth: '5px', borderLeftColor: week.color_hex }}
              >
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                  {/* Left (5 Cols): Week Focus Theme, Notes & Smart-Filter Focus Tags */}
                  <div className="space-y-3 lg:col-span-5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="rounded-lg bg-slate-800 px-2.5 py-1 font-bold text-white">
                        Woche {week.week_number} (KW {getIsoWeekNumber(week.start_date)}) ·{' '}
                        {formatIsoDateDe(week.start_date)} – {formatIsoDateDe(weekEndDate)}
                      </span>
                      <input
                        type="color"
                        value={week.color_hex}
                        onChange={(e) =>
                          void handleUpdateWeek(week, { color_hex: e.target.value })
                        }
                        className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-transparent"
                        title="Wochen-Farbcode wählen"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-400">
                        Wochen-Schwerpunkt / Thema
                      </label>
                      <input
                        type="text"
                        value={week.focus_theme}
                        onChange={(e) =>
                          void handleUpdateWeek(week, { focus_theme: e.target.value })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-bold text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Wochen-Notiz / Hinweis ans Trainerteam
                      </label>
                      <input
                        type="text"
                        placeholder="z.B. Samstag Topspiel – Donnerstag Belastung dosieren..."
                        value={week.notes}
                        onChange={(e) =>
                          void handleUpdateWeek(week, { notes: e.target.value })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
                      />
                    </div>

                    {/* Focus Tags (steuern Smart-Suggestions im Trainings-Editor) */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-emerald-400 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          Smart-Filter Schwerpunkte ({week.focus_tags.length}):
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTagsWeekId(isEditingTags ? null : week.id)
                          }
                          className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                        >
                          <Tag className="h-3 w-3" />
                          {isEditingTags ? 'Fertig' : 'Tags anpassen'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {week.focus_tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
                          >
                            #{FOCUS_TAG_LABELS[tag]}
                          </span>
                        ))}
                      </div>

                      {isEditingTags && (
                        <div className="mt-2.5 flex max-h-36 flex-wrap gap-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                          {ALL_FOCUS_TAGS.map((tag) => {
                            const active = week.focus_tags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => void handleToggleWeekTag(week, tag)}
                                className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                                  active
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                }`}
                              >
                                {active ? '✓ ' : '+ '}
                                {FOCUS_TAG_LABELS[tag]}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right (7 Cols): Training Sessions in this Week */}
                  <div className="space-y-3 lg:col-span-7">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase">
                        Trainingstage in Woche {week.week_number} ({weekSessions.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAddExtraSessionToWeek(week)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        <CalendarPlus className="h-3.5 w-3.5 text-blue-400" />
                        + Zusatztraining in Woche {week.week_number}
                      </button>
                    </div>

                    {weekSessions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-400">
                        Keine Trainingseinheit in dieser Woche – klicke oben auf „+ Zusatztraining".
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {weekSessions.map((sess) => (
                          <div
                            key={sess.id}
                            className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 space-y-3"
                          >
                            <div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-blue-400">
                                  {formatIsoDateDe(sess.session_date)} · {sess.start_time}–{sess.end_time}
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                    sess.status === 'COMPLETED'
                                      ? 'bg-emerald-950 text-emerald-300'
                                      : sess.status === 'READY'
                                        ? 'bg-blue-950 text-blue-300'
                                        : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {sess.status === 'COMPLETED'
                                    ? 'Durchgeführt'
                                    : sess.status === 'READY'
                                      ? 'Bereit'
                                      : 'Geplant'}
                                </span>
                              </div>
                              <div className="mt-1.5 font-bold text-white text-sm">
                                {sess.title}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                Zeitbudget: {sess.planned_duration_min} Min
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => onOpenSessionInEditor(sess.id)}
                                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-slate-800 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                              >
                                <Edit3 className="h-3.5 w-3.5 text-blue-400" />
                                Planen
                              </button>
                              <button
                                type="button"
                                onClick={() => onStartHallMode(sess.id)}
                                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                <Play className="h-3.5 w-3.5" />
                                Halle Live
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
