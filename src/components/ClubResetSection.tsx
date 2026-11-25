import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileDown, RotateCcw, ShieldAlert } from 'lucide-react';
import type {
  Club,
  ClubMember,
  Exercise,
  MultiWeekPlan,
  PlanWeek,
  Team,
  TrainingSession
} from '../types/domain';
import { executeClubReset } from '../services/clubResetService';
import {
  EMPTY_CLUB_RESET_SELECTION,
  FULL_CLUB_RESET_SELECTION,
  computeClubResetPreviewCounts,
  formatClubResetSummary,
  hasAnyResetSelection,
  isResetConfirmationValid,
  resolvePreservedAdminMemberId,
  type ClubResetSelection
} from '../utils/clubResetUtils';

interface ClubResetSectionProps {
  club: Club;
  teams: Team[];
  members: ClubMember[];
  exercises: Exercise[];
  sessions: TrainingSession[];
  plans: MultiWeekPlan[];
  planWeeks: PlanWeek[];
  authUserId: string | null;
  isClubAdmin?: boolean;
  onDownloadBackup?: () => Promise<void> | void;
  onResetCompleted?: (summaryMessage: string) => void;
}

interface ResetOption {
  key: keyof ClubResetSelection;
  title: string;
  badge: string;
  description: string;
  hint?: string;
}

export function ClubResetSection({
  club,
  teams,
  members,
  exercises,
  sessions,
  plans,
  planWeeks,
  authUserId,
  isClubAdmin = false,
  onDownloadBackup,
  onResetCompleted
}: ClubResetSectionProps) {
  const [selection, setSelection] = useState<ClubResetSelection>(EMPTY_CLUB_RESET_SELECTION);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Never carry a pending reset selection over to another club
  useEffect(() => {
    setSelection(EMPTY_CLUB_RESET_SELECTION);
    setShowConfirm(false);
    setConfirmText('');
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [club.id]);

  const preservedAdminMemberId = useMemo(
    () => resolvePreservedAdminMemberId(members, club.id, authUserId),
    [members, club.id, authUserId]
  );

  const previewCounts = useMemo(
    () =>
      computeClubResetPreviewCounts({
        clubId: club.id,
        teams,
        members,
        exercises,
        sessions,
        plans,
        planWeeks,
        preservedAdminMemberId
      }),
    [club.id, teams, members, exercises, sessions, plans, planWeeks, preservedAdminMemberId]
  );

  const anySelected = hasAnyResetSelection(selection);
  const allSelected =
    selection.deleteExercises &&
    selection.deleteSessions &&
    selection.deletePlans &&
    selection.deleteMembers;

  const options: ResetOption[] = [
    {
      key: 'deleteExercises',
      title: 'a) (Vereins-)Übungen löschen',
      badge: `${previewCounts.exercises} Übungen`,
      description:
        'Alle eigenen Vereins- und Team-Übungen inkl. Varianten, Taktik-Skizzen und Referenzbildern. Öffentliche Katalog-Übungen bleiben erhalten.',
      hint:
        selection.deleteExercises && !selection.deleteSessions
          ? 'Trainingstage bleiben erhalten – Übungsblöcke verlieren ihre verknüpfte Übung.'
          : undefined
    },
    {
      key: 'deleteSessions',
      title: 'b) Trainingstage löschen',
      badge: `${previewCounts.sessions} Trainingstage`,
      description:
        'Alle Trainingseinheiten aller Mannschaften inkl. Phasen, Übungsblöcke und Trainer-Notizen.'
    },
    {
      key: 'deletePlans',
      title: 'c) Mesozyklen löschen',
      badge: `${previewCounts.plans} Pläne (${previewCounts.planWeeks} Wochen)`,
      description: 'Alle Mehrwochenpläne inkl. Wochen-Schwerpunkten, Tags und Wochen-Notizen.',
      hint:
        selection.deletePlans && !selection.deleteSessions
          ? 'Trainingstage bleiben erhalten, verlieren aber ihre Wochen-Zuordnung.'
          : undefined
    },
    {
      key: 'deleteMembers',
      title: 'd) Trainer etc. löschen',
      badge: `${previewCounts.membersToDelete} weitere Mitglieder`,
      description: `Alle anderen Trainer/Admins inkl. Mannschafts-Zuordnungen. Der Einladungscode wird automatisch erneuert. Dein eigener Zugang${
        previewCounts.preservedAdminName ? ` (${previewCounts.preservedAdminName})` : ''
      } bleibt erhalten.`,
      hint: 'Login-Konten bleiben bestehen (z. B. für andere Vereine), der Zugriff auf diesen Verein endet sofort.'
    }
  ];

  function toggleOption(key: keyof ClubResetSelection) {
    setSelection((prev) => ({ ...prev, [key]: !prev[key] }));
    setShowConfirm(false);
    setConfirmText('');
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  function toggleAll() {
    setSelection(allSelected ? EMPTY_CLUB_RESET_SELECTION : FULL_CLUB_RESET_SELECTION);
    setShowConfirm(false);
    setConfirmText('');
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function handleExecuteReset() {
    if (!isClubAdmin || !anySelected || !isResetConfirmationValid(confirmText) || isBusy) return;
    setIsBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const executedSelection = selection;
      const result = await executeClubReset({
        club,
        selection: executedSelection,
        authUserId,
        isClubAdmin
      });
      const summary = formatClubResetSummary(result, executedSelection);
      setSuccessMsg(summary);
      setSelection(EMPTY_CLUB_RESET_SELECTION);
      setShowConfirm(false);
      setConfirmText('');
      onResetCompleted?.(summary);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vereins-Reset fehlgeschlagen.');
    } finally {
      setIsBusy(false);
    }
  }

  if (!isClubAdmin) return null;

  return (
    <section className="rounded-2xl border border-rose-500/40 bg-rose-950/10 p-6 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rose-500/20 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600/20 text-rose-400">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold tracking-wider text-rose-400 uppercase">
              Admin-Bereich · Gefahrenzone
            </span>
            <h3 className="text-lg font-bold text-white">Vereins-Reset (Teilbereiche zurücksetzen)</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Verein, Mannschaften und dein eigener Admin-Zugang bleiben immer erhalten.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onDownloadBackup && (
            <button
              type="button"
              onClick={() => void onDownloadBackup()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              title="Vor dem Reset ein Backup als JSON herunterladen"
            >
              <FileDown className="h-3.5 w-3.5 text-emerald-400" />
              Backup (JSON)
            </button>
          )}
          <button
            type="button"
            onClick={toggleAll}
            disabled={isBusy}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {allSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map((opt) => {
          const checked = selection[opt.key];
          return (
            <label
              key={opt.key}
              className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                checked
                  ? 'border-rose-500/70 bg-rose-950/40'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              } ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleOption(opt.key)}
                disabled={isBusy}
                className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
              />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-white">{opt.title}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                    {opt.badge}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">{opt.description}</p>
                {opt.hint && (
                  <p className="flex items-start gap-1 text-[11px] text-amber-300/90">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {opt.hint}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {!showConfirm && (
        <button
          type="button"
          disabled={!anySelected || isBusy}
          onClick={() => {
            setShowConfirm(true);
            setConfirmText('');
            setErrorMsg(null);
            setSuccessMsg(null);
          }}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
          Ausgewählte Bereiche zurücksetzen…
        </button>
      )}

      {showConfirm && anySelected && (
        <div className="mt-5 space-y-3 rounded-xl border border-rose-500/60 bg-rose-950/50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-rose-200">
            <AlertTriangle className="h-4 w-4" />
            Folgende Daten von „{club.name}“ werden endgültig gelöscht:
          </div>
          <ul className="list-disc space-y-0.5 pl-6 text-xs text-rose-100">
            {options
              .filter((opt) => selection[opt.key])
              .map((opt) => (
                <li key={opt.key}>
                  {opt.title} – {opt.badge}
                </li>
              ))}
            {selection.deleteMembers && <li>Einladungscode wird neu generiert</li>}
          </ul>
          <p className="text-xs font-semibold text-rose-300">
            Diese Aktion kann nicht rückgängig gemacht werden.
          </p>
          <div>
            <label className="mb-1 block text-xs text-rose-100">
              Zur Bestätigung <strong>RESET</strong> eingeben:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
              autoComplete="off"
              disabled={isBusy}
              className="w-full max-w-xs rounded-xl border border-rose-500/60 bg-slate-950 px-3 py-2 font-mono text-sm uppercase text-white focus:border-rose-400 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!isResetConfirmationValid(confirmText) || isBusy}
              onClick={() => void handleExecuteReset()}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
              {isBusy ? 'Setze zurück…' : 'Unwiderruflich zurücksetzen'}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setShowConfirm(false);
                setConfirmText('');
              }}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
    </section>
  );
}
