import { useState } from 'react';
import {
  Building2,
  Cloud,
  KeyRound,
  LogIn,
  LogOut,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X
} from 'lucide-react';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import {
  clearAllLocalDatabaseTables,
  getLastSyncedAt,
  syncWithSupabaseCloud
} from '../services/cloudSyncService';
import {
  fetchStandardCatalogManifest,
  importMissingStandardExercisesForClub,
  type StandardCatalogImportProgress
} from '../services/standardCatalogService';
import { seedInitialDataIfEmpty } from '../db/seedData';
import { isValidInviteCodeFormat } from '../utils/securityUtils';
import type { Club, ClubMember } from '../types/domain';

interface AuthClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string | null;
  authUserId: string | null;
  clubs: Club[];
  activeClub?: Club;
  onSelectClub: (clubId: string) => void;
  currentMember?: ClubMember;
  isAnyClubAdmin: boolean;
  adminClubIds?: Set<string>;
  needsClubOnboarding: boolean;
  onNeedsOnboarding: () => void;
  onSyncCompleted: (message: string) => void;
}

export function AuthClubModal({
  isOpen,
  onClose,
  userEmail,
  authUserId,
  clubs,
  activeClub,
  onSelectClub,
  currentMember,
  isAnyClubAdmin,
  adminClubIds,
  needsClubOnboarding,
  onNeedsOnboarding,
  onSyncCompleted
}: AuthClubModalProps) {
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupInviteCode, setSignupInviteCode] = useState('');
  const [signupDisplayName, setSignupDisplayName] = useState('');
  // Anti-bot honeypot field (must remain empty)
  const [honeypotWebsite, setHoneypotWebsite] = useState('');

  const [inviteCode, setInviteCode] = useState('');
  const [clubName, setClubName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showAdminCreateClub, setShowAdminCreateClub] = useState(false);
  const [seedStandardCatalog, setSeedStandardCatalog] = useState(true);
  const [catalogTotalCount, setCatalogTotalCount] = useState<number | null>(null);
  const [clubCreateProgress, setClubCreateProgress] = useState<string | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const configured = isSupabaseConfigured();
  const lastSynced = getLastSyncedAt();

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Silent bot trap if honeypot is filled
    if (honeypotWebsite.trim() !== '') {
      setErrorMsg('Anfrage konnte nicht verarbeitet werden.');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    setIsBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      if (authMode === 'LOGIN') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) {
          setErrorMsg(error.message);
        } else {
          const syncRes = await syncWithSupabaseCloud();
          if (syncRes.errorMessage) {
            setErrorMsg(`Sync-Fehler: ${syncRes.errorMessage}`);
          } else if (syncRes.mode === 'NO_CLUB') {
            onNeedsOnboarding();
          } else if (syncRes.mode === 'CLOUD') {
            onSyncCompleted(
              `Angemeldet & synchronisiert (${syncRes.pulledCount} geladen, ${syncRes.pushedCount} gesendet).`
            );
            onClose();
          }
        }
      } else {
        const normalizedCode = signupInviteCode.trim().toUpperCase();
        if (!isValidInviteCodeFormat(normalizedCode)) {
          setErrorMsg(
            'Registrierung ist nur mit einem gültigen Vereins-Freischaltcode möglich (z. B. TSVH-9F3A7C2E1B).'
          );
          return;
        }
        if (!signupDisplayName.trim()) {
          setErrorMsg('Bitte gib deinen Namen ein.');
          return;
        }

        const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              invite_code: normalizedCode,
              display_name: signupDisplayName.trim()
            }
          }
        });
        if (error) {
          setErrorMsg(error.message);
        } else if (data.session) {
          // Ensure membership link (idempotent with DB trigger)
          const { error: joinErr } = await supabase.rpc('join_club_by_invite_code', {
            p_invite_code: normalizedCode,
            p_display_name: signupDisplayName.trim(),
            p_email: email.trim()
          });
          if (joinErr) {
            setErrorMsg(joinErr.message);
            return;
          }
          const syncRes = await syncWithSupabaseCloud();
          if (syncRes.mode === 'NO_CLUB') {
            onNeedsOnboarding();
          } else {
            onSyncCompleted(
              `Konto erstellt & mit Verein verbunden (${syncRes.pulledCount} Datensätze geladen).`
            );
            onClose();
          }
        } else {
          setInfoMsg(
            'Registrierung mit Freischaltcode erfolgreich! Bitte bestätige deine E-Mail-Adresse und melde dich danach an.'
          );
          setAuthMode('LOGIN');
        }
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleJoinByCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const normalizedCode = inviteCode.trim().toUpperCase();
    if (!isValidInviteCodeFormat(normalizedCode)) {
      setErrorMsg('Bitte gib einen gültigen Vereins-Freischaltcode ein.');
      return;
    }

    setIsBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const { error } = await supabase.rpc('join_club_by_invite_code', {
        p_invite_code: normalizedCode,
        p_display_name: displayName.trim() || userEmail?.split('@')[0] || 'Trainer',
        p_email: userEmail
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }

      const syncRes = await syncWithSupabaseCloud();
      onSyncCompleted(
        `Verein verbunden & synchronisiert (${syncRes.pulledCount} Datensätze geladen).`
      );
      onClose();
    } finally {
      setIsBusy(false);
    }
  }

  function formatCatalogSeedProgress(progress: StandardCatalogImportProgress): string {
    switch (progress.phase) {
      case 'PREPARING':
        return 'Bereite Standard-Übungskatalog vor…';
      case 'FETCHING':
        return `Lade Standard-Übungen (${progress.processedFiles}/${progress.totalFiles} Pakete)…`;
      case 'SAVING_LOCAL':
        return `Speichere ${progress.importedExercises} Standard-Übungen lokal…`;
      case 'SYNCING_CLOUD':
        return `Synchronisiere Übungen in die Cloud (${progress.syncedCount}/${progress.syncTotalCount})…`;
      case 'DONE':
        return 'Standard-Übungskatalog abgeschlossen.';
    }
  }

  async function handleCreateAdditionalClubSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase || !clubName.trim()) return;

    setIsBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setClubCreateProgress(null);

    try {
      const { data, error } = await supabase.rpc('create_club_with_admin', {
        p_club_name: clubName.trim(),
        p_display_name:
          currentMember?.display_name ||
          displayName.trim() ||
          userEmail?.split('@')[0] ||
          'Vereins-Admin',
        p_email: userEmail
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }

      const payload =
        data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const createdClubId =
        typeof payload.club_id === 'string' ? payload.club_id : undefined;
      const createdMemberId =
        typeof payload.member_id === 'string' ? payload.member_id : undefined;

      const syncRes = await syncWithSupabaseCloud();
      if (createdClubId) {
        onSelectClub(createdClubId);
      }

      if (seedStandardCatalog && createdClubId) {
        setClubCreateProgress('Bereite Standard-Übungskatalog vor…');
        const effectiveAuthUserId =
          authUserId ?? (await supabase.auth.getUser()).data.user?.id ?? null;

        try {
          const importRes = await importMissingStandardExercisesForClub({
            clubId: createdClubId,
            authUserId: effectiveAuthUserId,
            createdByMemberId: createdMemberId,
            onProgress: (prog) => setClubCreateProgress(formatCatalogSeedProgress(prog))
          });

          setClubName('');
          setShowAdminCreateClub(false);
          if (importRes.syncErrorMessage) {
            setInfoMsg(
              `Neuer Verein wurde angelegt (${importRes.importedCount} Standard-Übungen lokal eingerichtet). Cloud-Sync Hinweis: ${importRes.syncErrorMessage} Fehlende Übungen können jederzeit unter „Verein → Standard-Übungskatalog“ nachgeladen werden.`
            );
          } else {
            onSyncCompleted(
              `Neuer Verein angelegt & ${importRes.importedCount} Standard-Übungen eingerichtet.`
            );
          }
        } catch (seedErr) {
          setClubName('');
          setShowAdminCreateClub(false);
          const seedMsg =
            seedErr instanceof Error ? seedErr.message : 'Standard-Übungskatalog konnte nicht geladen werden.';
          setInfoMsg(
            `Neuer Verein wurde angelegt, der automatische Katalog-Import wurde jedoch unterbrochen (${seedMsg}). Du kannst alle Standard-Übungen jederzeit unter „Verein → Standard-Übungskatalog“ einspielen.`
          );
        }
      } else {
        setClubName('');
        setShowAdminCreateClub(false);
        onSyncCompleted(
          `Neuer Verein angelegt & synchronisiert (${syncRes.pulledCount} Datensätze geladen).`
        );
      }
    } finally {
      setClubCreateProgress(null);
      setIsBusy(false);
    }
  }

  async function handleManualSync() {
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const res = await syncWithSupabaseCloud();
      if (res.errorMessage) {
        setErrorMsg(res.errorMessage);
      } else {
        onSyncCompleted(
          `Sync abgeschlossen: ${res.pushedCount} gesendet, ${res.pulledCount} aktualisiert.`
        );
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setIsBusy(true);
    try {
      await supabase.auth.signOut();
      await clearAllLocalDatabaseTables();
      await seedInitialDataIfEmpty();
      onSyncCompleted('Abgemeldet. Lokaler Demo-Modus aktiv.');
      onClose();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Cloud-Sync & Vereins-Konto</h2>
              <p className="text-xs text-slate-400">
                Geschützter Vereinszugang (Registrierung nur mit Freischaltcode)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 p-1.5 text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!configured && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-xs text-amber-200 space-y-2">
            <div className="font-bold text-amber-300">
              Supabase-Umgebungsvariablen noch nicht hinterlegt
            </div>
            <p>
              Die App läuft aktuell im <strong>100% lokalen Offline-Modus</strong>. Sobald{' '}
              <code className="rounded bg-slate-950 px-1 py-0.5">VITE_SUPABASE_URL</code> und{' '}
              <code className="rounded bg-slate-950 px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code>{' '}
              (lokal in <code className="rounded bg-slate-950 px-1 py-0.5">.env</code> bzw. als
              GitHub Actions Secrets) gesetzt sind, erscheint hier der Cloud-Login.
            </p>
          </div>
        )}

        {configured && !userEmail && (
          <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('LOGIN');
                  setErrorMsg(null);
                }}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  authMode === 'LOGIN'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Anmelden
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('SIGNUP');
                  setErrorMsg(null);
                }}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  authMode === 'SIGNUP'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Mit Freischaltcode registrieren
              </button>
            </div>

            {/* Anti-Bot Honeypot (hidden from human users) */}
            <div className="hidden" aria-hidden="true">
              <label>
                Website
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypotWebsite}
                  onChange={(e) => setHoneypotWebsite(e.target.value)}
                />
              </label>
            </div>

            {authMode === 'SIGNUP' && (
              <>
                <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-3 text-xs text-blue-200">
                  Neue Trainer-Konten können ausschließlich mit einem gültigen{' '}
                  <strong>Vereins-Freischaltcode</strong> des Vereins-Administrators erstellt werden.
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Vereins-Freischaltcode *
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute top-2.5 left-3 h-4 w-4 text-blue-400" />
                    <input
                      type="text"
                      required
                      value={signupInviteCode}
                      onChange={(e) => setSignupInviteCode(e.target.value.toUpperCase())}
                      placeholder="z. B. TSVH-9F3A7C2E1B"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 font-mono text-sm uppercase text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Dein Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={signupDisplayName}
                    onChange={(e) => setSignupDisplayName(e.target.value)}
                    placeholder="z. B. Max Mustermann"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">E-Mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trainer@verein.de"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Passwort</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                {infoMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {authMode === 'LOGIN' ? (
                <>
                  <LogIn className="h-4 w-4" />
                  {isBusy ? 'Melde an...' : 'Anmelden & synchronisieren'}
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  {isBusy ? 'Prüfe Code & registriere...' : 'Mit Freischaltcode registrieren'}
                </>
              )}
            </button>
          </form>
        )}

        {configured && userEmail && needsClubOnboarding && (
          <form onSubmit={handleJoinByCodeSubmit} className="mt-5 space-y-4">
            <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-3 text-xs text-blue-200">
              Angemeldet als <strong>{userEmail}</strong>. Bitte gib den{' '}
              <strong>Vereins-Freischaltcode</strong> ein, um deinem Verein beizutreten:
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Dein Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z. B. Max Mustermann"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Vereins-Freischaltcode *
              </label>
              <div className="relative">
                <KeyRound className="absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="z. B. TSVH-9F3A7C2E1B"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 font-mono text-sm uppercase text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isBusy}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isBusy ? 'Verbinde...' : 'Mit Freischaltcode beitreten'}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Abmelden
              </button>
            </div>
          </form>
        )}

        {configured && userEmail && !needsClubOnboarding && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
                Cloud-Synchronisation aktiv
              </div>
              <div className="grid grid-cols-2 gap-y-1 text-slate-300">
                <span className="text-slate-400">Konto:</span>
                <span className="font-medium text-white truncate">{userEmail}</span>
                <span className="text-slate-400">Aktiver Verein:</span>
                <span className="font-medium text-white">{activeClub?.name ?? '–'}</span>
                {currentMember?.club_role === 'CLUB_ADMIN' && (
                  <>
                    <span className="text-slate-400">Freischaltcode:</span>
                    <span className="font-mono font-semibold text-blue-300">
                      {activeClub?.invite_code ?? '–'}
                    </span>
                  </>
                )}
                <span className="text-slate-400">Rolle:</span>
                <span className="font-medium text-white">
                  {currentMember?.club_role === 'CLUB_ADMIN' ? 'Vereins-Admin (Bearbeiter)' : 'Trainer'}
                </span>
                <span className="text-slate-400">Letzter Sync:</span>
                <span className="text-slate-200">
                  {lastSynced ? new Date(lastSynced).toLocaleString('de-DE') : 'Noch nicht'}
                </span>
              </div>
            </div>

            {/* Vereins-Umschalter bei mehreren Vereinen */}
            {clubs.length > 1 && activeClub && (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-wider text-blue-400 uppercase">
                  Aktiven Verein wechseln ({clubs.length} Vereine)
                </label>
                <select
                  value={activeClub.id}
                  onChange={(e) => onSelectClub(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-white focus:border-blue-500 focus:outline-none"
                >
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {adminClubIds?.has(c.id) ? `${c.name} (Code: ${c.invite_code})` : c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Exklusiv für den Administrator: Zweiten / weiteren Verein gründen */}
            {isAnyClubAdmin && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Admin-Funktion: Weiteren Verein anlegen
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !showAdminCreateClub;
                      setShowAdminCreateClub(nextOpen);
                      setErrorMsg(null);
                      if (nextOpen && catalogTotalCount === null) {
                        void fetchStandardCatalogManifest()
                          .then((m) => setCatalogTotalCount(m.totalExercises))
                          .catch(() => {
                            // Keep generic label if manifest fetch fails offline
                          });
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-slate-700"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    {showAdminCreateClub ? 'Schließen' : 'Neuen Verein gründen'}
                  </button>
                </div>

                {showAdminCreateClub && (
                  <form onSubmit={handleCreateAdditionalClubSubmit} className="space-y-2.5 pt-1">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Name des neuen (zweiten) Vereins *
                      </label>
                      <div className="relative">
                        <Building2 className="absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
                        <input
                          type="text"
                          required
                          value={clubName}
                          onChange={(e) => setClubName(e.target.value)}
                          placeholder="z. B. HSG Musterstadt 2"
                          className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2 pr-3 pl-9 text-xs text-white focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-950/20 px-3 py-2 text-[11px] text-slate-200">
                      <input
                        type="checkbox"
                        checked={seedStandardCatalog}
                        disabled={isBusy}
                        onChange={(e) => setSeedStandardCatalog(e.target.checked)}
                        className="h-4 w-4 rounded accent-blue-500"
                      />
                      <span>
                        Standard-Übungskatalog ({catalogTotalCount ?? 'alle'} Übungen) direkt einrichten
                      </span>
                    </label>
                    {clubCreateProgress && (
                      <div className="rounded-xl border border-blue-500/30 bg-slate-900 px-3 py-2 text-[11px] text-blue-200">
                        {clubCreateProgress}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {isBusy ? clubCreateProgress ?? 'Lege Verein an...' : 'Verein jetzt anlegen & wechseln'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {infoMsg && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
                {infoMsg}
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleManualSync()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
                {isBusy ? 'Synchronisiere...' : 'Jetzt synchronisieren'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                <LogOut className="h-4 w-4 text-slate-400" />
                Abmelden
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
