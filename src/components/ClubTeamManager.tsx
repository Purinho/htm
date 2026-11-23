import { useEffect, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Check,
  Copy,
  Edit3,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { db, purgePendingOutboxUpserts, queueSyncOperation } from '../db/database';
import type {
  AgeGroup,
  Club,
  ClubMember,
  ClubRole,
  Exercise,
  MultiWeekPlan,
  PlanWeek,
  Team,
  TeamMember,
  TeamRole,
  TeamScheduleSlot,
  TrainingSession
} from '../types/domain';
import { AGE_GROUP_LABELS, ALL_AGE_GROUPS, WEEKDAY_OPTIONS } from '../constants/handballLabels';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { isLocalDemoClub } from '../utils/standardCatalogUtils';
import { generateSecureInviteCode } from '../utils/securityUtils';
import { formatTeamAgeGroupLabel, resolveTeamAgeGroup } from '../utils/teamAgeGroupUtils';
import { ClubResetSection } from './ClubResetSection';
import { ClubStandardCatalogSection } from './ClubStandardCatalogSection';

interface ClubTeamManagerProps {
  club: Club;
  teams: Team[];
  members: ClubMember[];
  teamMembers: TeamMember[];
  activeTeamId: string;
  onSelectTeam: (teamId: string) => void;
  isClubAdmin: boolean;
  authUserId: string | null;
  clubExercises: Exercise[];
  clubSessions: TrainingSession[];
  clubPlans: MultiWeekPlan[];
  clubPlanWeeks: PlanWeek[];
  onDownloadBackup?: () => Promise<void> | void;
  onResetCompleted?: (summaryMessage: string) => void;
  onCatalogImported?: (summaryMessage: string) => void;
}

export function ClubTeamManager({
  club,
  teams,
  members,
  teamMembers,
  activeTeamId,
  onSelectTeam,
  isClubAdmin,
  authUserId,
  clubExercises,
  clubSessions,
  clubPlans,
  clubPlanWeeks,
  onDownloadBackup,
  onResetCompleted,
  onCatalogImported
}: ClubTeamManagerProps) {
  const [clubName, setClubName] = useState(club.name);
  const [clubSavedBanner, setClubSavedBanner] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Team edit & delete confirmation state
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamAgeGroup, setEditTeamAgeGroup] = useState<'' | AgeGroup>('');
  const [editTeamSeason, setEditTeamSeason] = useState('');
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);

  useEffect(() => {
    setClubName(club.name);
  }, [club.name]);

  // New team form state
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamAgeGroup, setNewTeamAgeGroup] = useState<'' | AgeGroup>('');
  const [newTeamSeason, setNewTeamSeason] = useState('2026/27');

  // New coach form state
  const [newCoachName, setNewCoachName] = useState('');
  const [newCoachEmail, setNewCoachEmail] = useState('');
  const [newCoachRole, setNewCoachRole] = useState<ClubRole>('COACH');
  const [newCoachInitialTeamId, setNewCoachInitialTeamId] = useState<string>(activeTeamId);
  const [newCoachTeamRole, setNewCoachTeamRole] = useState<TeamRole>('ASSISTANT_COACH');

  // Schedule slot form state per team
  const [scheduleTeamId, setScheduleTeamId] = useState<string>(activeTeamId);
  const [slotWeekday, setSlotWeekday] = useState<number>(2);
  const [slotStart, setSlotStart] = useState('18:30');
  const [slotEnd, setSlotEnd] = useState('20:00');
  const [slotHall, setSlotHall] = useState('Sporthalle Nord');

  async function handleSaveClubName() {
    if (!clubName.trim()) return;
    const updated: Club = {
      ...club,
      name: clubName.trim(),
      updated_at: new Date().toISOString()
    };
    await db.clubs.put(updated);
    await queueSyncOperation('clubs', updated.id, 'UPSERT', updated);
    setClubSavedBanner(true);
    setTimeout(() => setClubSavedBanner(false), 2500);
  }

  async function handleRegenerateInviteCode() {
    const updated: Club = {
      ...club,
      invite_code: generateSecureInviteCode(club.name),
      updated_at: new Date().toISOString()
    };
    await db.clubs.put(updated);
    await queueSyncOperation('clubs', updated.id, 'UPSERT', updated);
  }

  async function handleCopyInviteCode() {
    try {
      await navigator.clipboard.writeText(club.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback ignored
    }
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamAgeGroup) return;

    const now = new Date().toISOString();
    const newTeam: Team = {
      id: crypto.randomUUID(),
      club_id: club.id,
      name: newTeamName.trim(),
      age_group: newTeamAgeGroup,
      season: newTeamSeason.trim() || '2026/27',
      default_schedule: [
        {
          id: `sched-${crypto.randomUUID().slice(0, 6)}`,
          weekday: 2,
          weekdayLabel: 'Dienstag',
          startTime: '18:30',
          endTime: '20:00',
          hallName: 'Sporthalle'
        }
      ],
      is_archived: false,
      created_at: now,
      updated_at: now
    };

    await db.teams.put(newTeam);
    await queueSyncOperation('teams', newTeam.id, 'UPSERT', newTeam);
    setNewTeamName('');
    setNewTeamAgeGroup('');
    onSelectTeam(newTeam.id);
  }

  function handleStartEditTeam(team: Team) {
    setEditingTeamId(team.id);
    setEditTeamName(team.name);
    setEditTeamAgeGroup(resolveTeamAgeGroup(team) ?? '');
    setEditTeamSeason(team.season);
    setConfirmDeleteTeamId(null);
  }

  async function handleSaveTeamEdit(team: Team) {
    if (!editTeamName.trim() || !editTeamAgeGroup) return;
    const updated: Team = {
      ...team,
      name: editTeamName.trim(),
      age_group: editTeamAgeGroup,
      season: editTeamSeason.trim() || team.season,
      updated_at: new Date().toISOString()
    };
    await db.teams.put(updated);
    await queueSyncOperation('teams', updated.id, 'UPSERT', updated);
    setEditingTeamId(null);
  }

  async function handleDeleteTeam(teamId: string) {
    if (teams.length <= 1) return;

    const teamSessions = await db.trainingSessions.where('team_id').equals(teamId).toArray();
    const sessionIds = teamSessions.map((s) => s.id);
    const teamPhases =
      sessionIds.length > 0
        ? await db.sessionPhases.where('training_session_id').anyOf(sessionIds).toArray()
        : [];
    const phaseIds = teamPhases.map((p) => p.id);
    const teamBlocks =
      phaseIds.length > 0
        ? await db.sessionBlocks.where('session_phase_id').anyOf(phaseIds).toArray()
        : [];
    const teamNotes =
      sessionIds.length > 0
        ? await db.sessionNotes.where('training_session_id').anyOf(sessionIds).toArray()
        : [];

    const teamPlans = await db.multiWeekPlans.where('team_id').equals(teamId).toArray();
    const planIds = teamPlans.map((p) => p.id);
    const teamPlanWeeks =
      planIds.length > 0
        ? await db.planWeeks.where('multi_week_plan_id').anyOf(planIds).toArray()
        : [];

    const assignedLinks = teamMembers.filter((tm) => tm.team_id === teamId);

    await db.transaction(
      'rw',
      [
        db.teams,
        db.teamMembers,
        db.multiWeekPlans,
        db.planWeeks,
        db.trainingSessions,
        db.sessionPhases,
        db.sessionBlocks,
        db.sessionNotes,
        db.syncOutbox
      ],
      async () => {
        const childKeys = new Set<string>();
        await db.teams.delete(teamId);
        await queueSyncOperation('teams', teamId, 'DELETE', { id: teamId });

        for (const tm of assignedLinks) {
          await db.teamMembers.delete(tm.id);
          childKeys.add(`team_members:${tm.id}`);
        }
        for (const w of teamPlanWeeks) {
          await db.planWeeks.delete(w.id);
          childKeys.add(`plan_weeks:${w.id}`);
        }
        for (const p of teamPlans) {
          await db.multiWeekPlans.delete(p.id);
          childKeys.add(`multi_week_plans:${p.id}`);
        }
        for (const b of teamBlocks) {
          await db.sessionBlocks.delete(b.id);
          childKeys.add(`session_blocks:${b.id}`);
        }
        for (const ph of teamPhases) {
          await db.sessionPhases.delete(ph.id);
          childKeys.add(`session_phases:${ph.id}`);
        }
        for (const n of teamNotes) {
          await db.sessionNotes.delete(n.id);
          childKeys.add(`session_notes:${n.id}`);
        }
        for (const s of teamSessions) {
          await db.trainingSessions.delete(s.id);
          childKeys.add(`training_sessions:${s.id}`);
        }
        await purgePendingOutboxUpserts(childKeys);
      }
    );

    setConfirmDeleteTeamId(null);
    if (editingTeamId === teamId) setEditingTeamId(null);

    const remainingTeams = teams.filter((t) => t.id !== teamId);
    const fallbackId = remainingTeams[0]?.id ?? '';
    if (activeTeamId === teamId && fallbackId) {
      onSelectTeam(fallbackId);
    }
    if (scheduleTeamId === teamId) {
      setScheduleTeamId(fallbackId);
    }
    if (newCoachInitialTeamId === teamId) {
      setNewCoachInitialTeamId(fallbackId);
    }
  }

  async function handleAddScheduleSlot(e: React.FormEvent) {
    e.preventDefault();
    const targetTeam = teams.find((t) => t.id === scheduleTeamId);
    if (!targetTeam) return;

    const weekdayMeta = WEEKDAY_OPTIONS.find((w) => w.value === slotWeekday) ?? WEEKDAY_OPTIONS[1];
    const newSlot: TeamScheduleSlot = {
      id: `slot-${crypto.randomUUID().slice(0, 8)}`,
      weekday: weekdayMeta.value,
      weekdayLabel: weekdayMeta.label,
      startTime: slotStart,
      endTime: slotEnd,
      hallName: slotHall.trim() || undefined
    };

    const updatedTeam: Team = {
      ...targetTeam,
      default_schedule: [...targetTeam.default_schedule, newSlot].sort((a, b) => a.weekday - b.weekday),
      updated_at: new Date().toISOString()
    };

    await db.teams.put(updatedTeam);
    await queueSyncOperation('teams', updatedTeam.id, 'UPSERT', updatedTeam);
  }

  async function handleRemoveScheduleSlot(team: Team, slotId: string) {
    const updatedTeam: Team = {
      ...team,
      default_schedule: team.default_schedule.filter((s) => s.id !== slotId),
      updated_at: new Date().toISOString()
    };
    await db.teams.put(updatedTeam);
    await queueSyncOperation('teams', updatedTeam.id, 'UPSERT', updatedTeam);
  }

  async function handleAddCoach(e: React.FormEvent) {
    e.preventDefault();
    if (!newCoachName.trim()) return;

    const now = new Date().toISOString();
    const member: ClubMember = {
      id: crypto.randomUUID(),
      club_id: club.id,
      club_role: newCoachRole,
      display_name: newCoachName.trim(),
      email: newCoachEmail.trim() || undefined,
      created_at: now,
      updated_at: now
    };

    await db.clubMembers.put(member);
    await queueSyncOperation('club_members', member.id, 'UPSERT', member);

    if (newCoachInitialTeamId) {
      const assignment: TeamMember = {
        id: crypto.randomUUID(),
        team_id: newCoachInitialTeamId,
        club_member_id: member.id,
        team_role: newCoachTeamRole
      };
      await db.teamMembers.put(assignment);
      await queueSyncOperation('team_members', assignment.id, 'UPSERT', assignment);
    }

    setNewCoachName('');
    setNewCoachEmail('');
  }

  async function handleToggleTeamAssignment(teamId: string, memberId: string) {
    const existing = teamMembers.find(
      (tm) => tm.team_id === teamId && tm.club_member_id === memberId
    );
    if (existing) {
      await db.teamMembers.delete(existing.id);
      await queueSyncOperation('team_members', existing.id, 'DELETE', { id: existing.id });
    } else {
      const assignment: TeamMember = {
        id: crypto.randomUUID(),
        team_id: teamId,
        club_member_id: memberId,
        team_role: 'HEAD_COACH'
      };
      await db.teamMembers.put(assignment);
      await queueSyncOperation('team_members', assignment.id, 'UPSERT', assignment);
    }
  }

  const canManageStandardCatalog =
    isClubAdmin && !isLocalDemoClub(club.id, authUserId, isSupabaseConfigured());
  const currentMemberId = members.find((m) => m.user_id && m.user_id === authUserId)?.id;

  return (
    <div className="space-y-8">
      {/* 1. Ebene: Verein (Mandant) & Einladungs-Code */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-semibold tracking-wider text-blue-400 uppercase">
                Ebene 1 · Mandant / Verein
              </span>
              <h2 className="text-xl font-bold text-white">{club.name}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-950/40 px-4 py-2.5">
            <div>
              <div className="text-[11px] text-slate-400">Vereins-Einladungscode für Trainer</div>
              <div className="font-mono text-base font-bold tracking-wider text-blue-300">
                {club.invite_code}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyInviteCode}
              className="ml-2 rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              title="Code kopieren"
            >
              {copiedCode ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleRegenerateInviteCode}
              className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              title="Neuen Einladungscode generieren"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Vereinsname / Spielgemeinschaft
            </label>
            <input
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveClubName}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Vereinsname speichern
          </button>
          {clubSavedBanner && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <Check className="h-4 w-4" />
              Gespeichert
            </span>
          )}
        </div>
      </section>

      {/* 2. Ebene: Mannschaften & Standard-Trainingszeiten */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 lg:col-span-7">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">
                Ebene 2 · Mannschaften & feste Hallenzeiten ({teams.length})
              </h3>
            </div>
          </div>

          <div className="space-y-4">
            {teams.map((team) => {
              const isSelected = team.id === activeTeamId;
              const assignedCoaches = teamMembers
                .filter((tm) => tm.team_id === team.id)
                .map((tm) => ({
                  ...tm,
                  member: members.find((m) => m.id === tm.club_member_id)
                }));

              return (
                <div
                  key={team.id}
                  className={`rounded-xl border p-4 transition ${
                    isSelected
                      ? 'border-blue-500/80 bg-blue-950/20'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {editingTeamId === team.id ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editTeamName}
                          onChange={(e) => setEditTeamName(e.target.value)}
                          placeholder="Mannschaftsname"
                          className="min-w-[140px] flex-1 rounded-lg border border-blue-500/60 bg-slate-900 px-2.5 py-1 text-sm font-bold text-white focus:outline-none"
                        />
                        <select
                          aria-label="Altersklasse"
                          required
                          value={editTeamAgeGroup}
                          onChange={(e) => setEditTeamAgeGroup(e.target.value as '' | AgeGroup)}
                          className="w-36 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                        >
                          <option value="" disabled>
                            Altersklasse wählen...
                          </option>
                          {ALL_AGE_GROUPS.map((ag) => (
                            <option key={ag} value={ag}>
                              {AGE_GROUP_LABELS[ag]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={editTeamSeason}
                          onChange={(e) => setEditTeamSeason(e.target.value)}
                          placeholder="Saison"
                          className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                        />
                        <button
                          type="button"
                          disabled={!editTeamName.trim() || !editTeamAgeGroup}
                          onClick={() => void handleSaveTeamEdit(team)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Speichern
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTeamId(null)}
                          className="rounded-lg bg-slate-800 p-1 text-slate-300 hover:bg-slate-700"
                          title="Abbrechen"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-bold text-white">{team.name}</span>
                            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                              {formatTeamAgeGroupLabel(team.age_group)}
                            </span>
                            <span className="rounded-full bg-blue-950 px-2.5 py-0.5 text-xs text-blue-300">
                              Saison {team.season}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectTeam(team.id)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {isSelected ? 'Aktive Mannschaft' : 'Auswählen'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEditTeam(team)}
                            className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
                            title="Mannschaft bearbeiten"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {confirmDeleteTeamId === team.id ? (
                            <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-950/70 px-2.5 py-1 text-xs">
                              <span className="font-semibold text-rose-200">
                                Inkl. Pläne löschen?
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTeam(team.id)}
                                className="rounded bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-500"
                              >
                                Ja
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTeamId(null)}
                                className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                              >
                                Nein
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={teams.length <= 1}
                              onClick={() => setConfirmDeleteTeamId(team.id)}
                              className="rounded-lg bg-slate-800 p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:text-slate-400"
                              title={
                                teams.length <= 1
                                  ? 'Mindestens eine Mannschaft muss im Verein bleiben'
                                  : 'Mannschaft löschen'
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Feste Trainingszeiten */}
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-medium text-slate-400">
                      Standard-Trainingszeiten (Basis für Mehrwochenpläne):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {team.default_schedule.map((slot) => (
                        <div
                          key={slot.id}
                          className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs"
                        >
                          <CalendarClock className="h-3.5 w-3.5 text-blue-400" />
                          <span className="font-semibold text-white">{slot.weekdayLabel}</span>
                          <span className="text-slate-300">
                            {slot.startTime}–{slot.endTime} Uhr
                          </span>
                          {slot.hallName && (
                            <span className="text-slate-400">({slot.hallName})</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveScheduleSlot(team, slot.id)}
                            className="ml-1 text-slate-500 hover:text-rose-400"
                            title="Trainingszeit entfernen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Zugeordnetes Trainerteam */}
                  <div className="mt-3 border-t border-slate-800/80 pt-3">
                    <div className="mb-1.5 text-xs font-medium text-slate-400">
                      Zugeordnetes Trainerteam ({assignedCoaches.length}):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {assignedCoaches.map(({ id, team_role, member }) =>
                        member ? (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 border border-emerald-700/40"
                          >
                            {member.display_name}
                            <span className="text-[10px] text-emerald-400/80">
                              ({team_role === 'HEAD_COACH' ? 'Haupttrainer' : 'Co-Trainer'})
                            </span>
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Neue Hallenzeit hinzufügen */}
          <form
            onSubmit={handleAddScheduleSlot}
            className="mt-6 rounded-xl border border-slate-800 bg-slate-950/80 p-4"
          >
            <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Feste Trainingszeit zu Mannschaft hinzufügen
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <select
                value={scheduleTeamId}
                onChange={(e) => setScheduleTeamId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={slotWeekday}
                onChange={(e) => setSlotWeekday(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
              >
                {WEEKDAY_OPTIONS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={slotStart}
                onChange={(e) => setSlotStart(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
              />
              <input
                type="time"
                value={slotEnd}
                onChange={(e) => setSlotEnd(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
              />
              <input
                type="text"
                placeholder="Halle (optional)"
                value={slotHall}
                onChange={(e) => setSlotHall(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Trainingszeit hinzufügen
            </button>
          </form>
        </section>

        {/* Rechte Spalte: Neue Mannschaft & Trainerteam verwalten */}
        <div className="space-y-6 lg:col-span-5">
          {/* Neue Mannschaft anlegen */}
          <form
            onSubmit={handleCreateTeam}
            className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6"
          >
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-white">
              <Plus className="h-5 w-5 text-blue-400" />
              Neue Mannschaft im Verein anlegen
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Mannschaftsname *</label>
                <input
                  type="text"
                  required
                  placeholder="z.B. weibliche C-Jugend oder 2. Herren"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-team-age-group" className="mb-1 block text-xs text-slate-300">
                    Altersklasse *
                  </label>
                  <select
                    id="new-team-age-group"
                    required
                    value={newTeamAgeGroup}
                    onChange={(e) => setNewTeamAgeGroup(e.target.value as '' | AgeGroup)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="" disabled>
                      Altersklasse wählen...
                    </option>
                    {ALL_AGE_GROUPS.map((ag) => (
                      <option key={ag} value={ag}>
                        {AGE_GROUP_LABELS[ag]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Wird in der Trainingsplanung als Filter vorbelegt.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Saison</label>
                  <input
                    type="text"
                    value={newTeamSeason}
                    onChange={(e) => setNewTeamSeason(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Mannschaft anlegen
              </button>
            </div>
          </form>

          {/* 3. Ebene: Trainerteam & Zuordnung */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-white">
              <Shield className="h-5 w-5 text-amber-400" />
              Ebene 3 · Vereins-Trainerteam ({members.length})
            </h3>

            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{member.display_name}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        member.club_role === 'CLUB_ADMIN'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700/40'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {member.club_role === 'CLUB_ADMIN' ? 'Vereins-Admin' : 'Trainer'}
                    </span>
                  </div>
                  {member.email && (
                    <div className="mt-0.5 text-xs text-slate-400">{member.email}</div>
                  )}

                  {/* Schnell-Zuordnung zu Mannschaften */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Teams:</span>
                    {teams.map((t) => {
                      const isAssigned = teamMembers.some(
                        (tm) => tm.team_id === t.id && tm.club_member_id === member.id
                      );
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleToggleTeamAssignment(t.id, member.id)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                            isAssigned
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {isAssigned ? '✓ ' : '+ '}
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Neuen Trainer ins Team aufnehmen */}
            <form onSubmit={handleAddCoach} className="mt-5 border-t border-slate-800 pt-4 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase">
                <UserPlus className="h-4 w-4 text-emerald-400" />
                Weiteren Trainer in den Verein aufnehmen
              </div>
              <input
                type="text"
                required
                placeholder="Name (z.B. Sarah Klein – Co-Trainerin)"
                value={newCoachName}
                onChange={(e) => setNewCoachName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="email"
                  placeholder="E-Mail (optional)"
                  value={newCoachEmail}
                  onChange={(e) => setNewCoachEmail(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
                <select
                  value={newCoachRole}
                  onChange={(e) => setNewCoachRole(e.target.value as ClubRole)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="COACH">Mannschafts-Trainer</option>
                  <option value="CLUB_ADMIN">Vereins-Admin / Koordinator</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newCoachInitialTeamId}
                  onChange={(e) => setNewCoachInitialTeamId(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      Team: {t.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newCoachTeamRole}
                  onChange={(e) => setNewCoachTeamRole(e.target.value as TeamRole)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="HEAD_COACH">Haupttrainer</option>
                  <option value="ASSISTANT_COACH">Co-Trainer</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Trainer hinzufügen
              </button>
            </form>
          </section>
        </div>
      </div>

      {/* Admin-Funktion: Standard-Übungskatalog (nur für Vereins-Admins, nicht im Demo-Modus) */}
      {canManageStandardCatalog && (
        <ClubStandardCatalogSection
          club={club}
          clubExercises={clubExercises}
          authUserId={authUserId}
          currentMemberId={currentMemberId}
          onCatalogImported={onCatalogImported}
        />
      )}

      {/* Admin-Funktion: Vereins-Reset (nur für Vereins-Admins) */}
      {isClubAdmin && (
        <ClubResetSection
          club={club}
          teams={teams}
          members={members}
          exercises={clubExercises}
          sessions={clubSessions}
          plans={clubPlans}
          planWeeks={clubPlanWeeks}
          authUserId={authUserId}
          onDownloadBackup={onDownloadBackup}
          onResetCompleted={onResetCompleted}
        />
      )}
    </div>
  );
}
