import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  CloudUpload,
  CopyPlus,
  Download,
  Edit3,
  ExternalLink as ExternalLinkIcon,
  FileDown,
  Filter,
  GitBranch,
  LayoutDashboard,
  Maximize2,
  Play,
  Plus,
  Printer,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  User,
  Wifi,
  WifiOff
} from 'lucide-react';
import { db, queueSyncOperation } from './db/database';
import { seedInitialDataIfEmpty } from './db/seedData';
import { ClubTeamManager } from './components/ClubTeamManager';
import { TacticBoardPreview } from './components/TacticBoardPreview';
import { PwaInstallGuideModal } from './components/PwaInstallGuideModal';
import { AuthClubModal } from './components/AuthClubModal';
import { ExerciseEditorModal } from './components/ExerciseEditorModal';
import { AiExerciseImporterModal } from './components/AiExerciseImporterModal';
import { TrainingSessionPlanner } from './components/TrainingSessionPlanner';
import { MultiWeekPlanManager } from './components/MultiWeekPlanManager';
import { HallLiveMode } from './components/HallLiveMode';
import { FullScreenChalkboardModal } from './components/FullScreenChalkboardModal';
import { PrintExportModal, type PrintExportTarget } from './components/PrintExportModal';
import { UiConfigModal } from './components/UiConfigModal';
import { UiConfigTourModal } from './components/UiConfigTourModal';
import {
  getFallbackTabIfDisabled,
  loadUiPreferences,
  saveUiPreferences,
  type UiPreferences
} from './utils/uiPreferences';
import {
  exportClubDatabaseSnapshot,
  syncWithSupabaseCloud
} from './services/cloudSyncService';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';
import { isSafeHttpUrl } from './utils/securityUtils';
import {
  addDaysIso,
  formatIsoDateDe,
  getIsoWeekNumber,
  selectActiveMultiWeekPlan,
  selectCurrentPlanWeek
} from './utils/multiWeekPlanUtils';
import {
  createDefaultPlannerCatalogFilters,
  getLocalDateIso,
  reconcilePlannerStateForTeamChange,
  sanitizePlannerCatalogFilters,
  type PlannerCatalogFilters,
  type PlannerNavigationSnapshot,
  type PlannerTeamContext
} from './utils/sessionPlannerUtils';
import { formatTeamAgeGroupLabel, resolveTeamAgeGroup } from './utils/teamAgeGroupUtils';
import {
  AGE_GROUP_LABELS,
  ALL_AGE_GROUPS,
  ATHLETICS_RECOVERY_FOCUS_TAGS,
  COMPLEXITY_LABELS,
  FOCUS_TAG_LABELS,
  PHASE_CATEGORY_LABELS,
  TACTIC_FOCUS_TAGS,
  TECHNIQUE_FOCUS_TAGS,
  VISIBILITY_LABELS
} from './constants/handballLabels';
import type {
  AgeGroup,
  ComplexityLevel,
  Exercise,
  HandballFocusTag,
  TrainingPhaseCategory,
  VisibilityLevel
} from './types/domain';

type NavTab = 'DASHBOARD' | 'HALL_LIVE' | 'EXERCISES' | 'PLANS' | 'CLUB_ADMIN';

interface AppHistoryState {
  tab?: NavTab;
  exerciseId?: string;
  mobileDetailOpen?: boolean;
  plannerSnapshot?: PlannerNavigationSnapshot;
}

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('DASHBOARD');
  const [activeClubId, setActiveClubId] = useState<string>(() => {
    try {
      return localStorage.getItem('handball_active_club_id') ?? '';
    } catch {
      return '';
    }
  });
  const [activeTeamId, setActiveTeamId] = useState<string>('team-mb');
  const [focusedSessionId, setFocusedSessionId] = useState<string | undefined>(undefined);
  const [plannerFilters, setPlannerFilters] = useState<PlannerCatalogFilters>(() =>
    createDefaultPlannerCatalogFilters()
  );
  const [plannerSelectedSessionId, setPlannerSelectedSessionId] = useState<string>('');
  const [plannerActivePhaseId, setPlannerActivePhaseId] = useState<string>('');
  const appliedTeamAgeGroupContextRef = useRef<PlannerTeamContext | null>(null);
  const activeTeamIdRef = useRef<string>('');
  const activeTeamAgeGroupRef = useRef<AgeGroup | null>(null);
  const plannerStateRef = useRef<{
    filters: PlannerCatalogFilters;
    sessionId: string;
    phaseId: string;
  }>({
    filters: plannerFilters,
    sessionId: plannerSelectedSessionId,
    phaseId: plannerActivePhaseId
  });
  plannerStateRef.current = {
    filters: plannerFilters,
    sessionId: plannerSelectedSessionId,
    phaseId: plannerActivePhaseId
  };
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [needsClubOnboarding, setNeedsClubOnboarding] = useState<boolean>(false);
  const [syncStatusBanner, setSyncStatusBanner] = useState<string | null>(null);

const EXERCISE_PAGE_SIZE = 40;

  // Exercise filter & modal states
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'ALL' | VisibilityLevel>('ALL');
  const [ageGroupFilter, setAgeGroupFilter] = useState<'ALL' | AgeGroup>('ALL');
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | TrainingPhaseCategory>('ALL');
  const [focusFilter, setFocusFilter] = useState<'ALL' | HandballFocusTag>('ALL');
  const [levelFilter, setLevelFilter] = useState<'ALL' | ComplexityLevel>('ALL');
  const [playerCountFilter, setPlayerCountFilter] = useState<string>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [visibleExerciseCount, setVisibleExerciseCount] = useState(EXERCISE_PAGE_SIZE);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<PrintExportTarget | null>(null);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [variantParentExercise, setVariantParentExercise] = useState<Exercise | null>(null);
  const [aiImporterOpen, setAiImporterOpen] = useState(false);
  const [chalkboardOpen, setChalkboardOpen] = useState(false);
  const [confirmDeleteExerciseId, setConfirmDeleteExerciseId] = useState<string | null>(null);
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => loadUiPreferences());
  const [uiConfigModalOpen, setUiConfigModalOpen] = useState(false);
  const [uiTourModalOpen, setUiTourModalOpen] = useState(() => !loadUiPreferences().tourCompleted);
  const [isInstalledPwa, setIsInstalledPwa] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true ||
      document.referrer.startsWith('android-app://')
    );
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsInstalledPwa(true);
    };
    const handleAppInstalled = () => setIsInstalledPwa(true);
    mediaQuery.addEventListener('change', handleDisplayModeChange);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      mediaQuery.removeEventListener('change', handleDisplayModeChange);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const uiFeatures = uiPreferences.features;
  const showPwaInstallButton = uiFeatures.pwaInstall && !isInstalledPwa;

  function handleUpdateUiPreferences(next: UiPreferences) {
    const saved = saveUiPreferences(next);
    setUiPreferences(saved);
    const safeTab = getFallbackTabIfDisabled(activeTab, saved.features);
    if (safeTab !== activeTab) {
      setActiveTab(safeTab);
    }
  }

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      void seedInitialDataIfEmpty();
      return;
    }

    async function initAuthAndSync() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setAuthUserEmail(user?.email ?? null);
      setAuthUserId(user?.id ?? null);

      if (user) {
        const res = await syncWithSupabaseCloud();
        setNeedsClubOnboarding(res.mode === 'NO_CLUB');
        if (res.mode === 'NO_CLUB') {
          await seedInitialDataIfEmpty();
          setShowAuthModal(true);
        }
      } else {
        await seedInitialDataIfEmpty();
      }
    }

    void initAuthAndSync();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setAuthUserEmail(user?.email ?? null);
      setAuthUserId(user?.id ?? null);
      if (user) {
        void syncWithSupabaseCloud().then(async (res) => {
          const noClub = res.mode === 'NO_CLUB';
          setNeedsClubOnboarding(noClub);
          if (noClub) {
            await seedInitialDataIfEmpty();
            setShowAuthModal(true);
          }
        });
      } else {
        setNeedsClubOnboarding(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const validTabs: NavTab[] = ['DASHBOARD', 'HALL_LIVE', 'EXERCISES', 'PLANS', 'CLUB_ADMIN'];
    const currentState = window.history.state as AppHistoryState | null;
    const currentStateTab = currentState?.tab;
    if (!currentStateTab || !validTabs.includes(currentStateTab)) {
      try {
        window.history.replaceState(
          { tab: 'DASHBOARD' satisfies NavTab } satisfies AppHistoryState,
          '',
          window.location.pathname + window.location.search
        );
      } catch {
        // Ignore History API errors
      }
    }

    function handlePopState(event: PopStateEvent) {
      const state = event.state as AppHistoryState | null;
      const stateTab = state?.tab;
      const nextTab = stateTab && validTabs.includes(stateTab) ? stateTab : 'DASHBOARD';

      if (nextTab === 'DASHBOARD' && state?.plannerSnapshot) {
        const snapshot = state.plannerSnapshot;
        const currentTeamId = activeTeamIdRef.current;
        if (!currentTeamId || snapshot.teamId === currentTeamId) {
          const sanitized = sanitizePlannerCatalogFilters(
            snapshot.filters,
            activeTeamAgeGroupRef.current
          );
          const teamAgeChangedWhileAway =
            snapshot.teamAgeGroup !== undefined &&
            snapshot.teamAgeGroup !== activeTeamAgeGroupRef.current;

          setPlannerFilters(
            teamAgeChangedWhileAway
              ? { ...sanitized, catalogAgeGroup: activeTeamAgeGroupRef.current ?? 'ALL' }
              : sanitized
          );
          setPlannerSelectedSessionId(snapshot.sessionId ?? '');
          setPlannerActivePhaseId(snapshot.phaseId ?? '');
        }
      }

      if (nextTab === 'EXERCISES') {
        if (state?.exerciseId) {
          setSelectedExerciseId(state.exerciseId);
        }
        setMobileDetailOpen(Boolean(state?.mobileDetailOpen));
      } else {
        setMobileDetailOpen(false);
      }

      setActiveTab(nextTab);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigateToTab(
    nextTab: NavTab,
    options?: { keepFocusedSession?: boolean; exerciseId?: string; mobileDetailOpen?: boolean }
  ) {
    if (!options?.keepFocusedSession) {
      setFocusedSessionId(undefined);
    }
    if (nextTab === activeTab) return;

    const currentTeamId = activeTeamIdRef.current;
    if (activeTab === 'DASHBOARD' && currentTeamId) {
      const { filters, sessionId, phaseId } = plannerStateRef.current;
      try {
        const existingState = (window.history.state as AppHistoryState | null) ?? {};
        const snapshot: PlannerNavigationSnapshot = {
          teamId: currentTeamId,
          teamAgeGroup: activeTeamAgeGroupRef.current,
          sessionId: sessionId || undefined,
          phaseId: phaseId || undefined,
          filters
        };
        window.history.replaceState(
          {
            ...existingState,
            tab: 'DASHBOARD' satisfies NavTab,
            plannerSnapshot: snapshot
          } satisfies AppHistoryState,
          '',
          `${window.location.pathname}${window.location.search}${window.location.hash}`
        );
      } catch {
        // Ignore History API errors
      }
    }

    if (nextTab !== 'EXERCISES') {
      setMobileDetailOpen(false);
    }

    const nextState: AppHistoryState = {
      tab: nextTab,
      ...(nextTab === 'EXERCISES'
        ? {
            exerciseId: options?.exerciseId,
            mobileDetailOpen: Boolean(options?.mobileDetailOpen)
          }
        : {})
    };

    try {
      window.history.pushState(
        nextState,
        '',
        `${window.location.pathname}${window.location.search}#${nextTab.toLowerCase()}`
      );
    } catch {
      // Ignore History API errors
    }

    setActiveTab(nextTab);
  }

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncWithSupabaseCloud();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const clubs = useLiveQuery(() => db.clubs.toArray(), []) ?? [];
  const allTeams = useLiveQuery(() => db.teams.toArray(), []) ?? [];
  const allMembers = useLiveQuery(() => db.clubMembers.toArray(), []) ?? [];
  const teamMembers = useLiveQuery(() => db.teamMembers.toArray(), []) ?? [];
  const allExercises = useLiveQuery(() => db.exercises.filter((e) => !e.is_deleted).toArray(), []) ?? [];
  const allTemplates = useLiveQuery(() => db.sessionTemplates.toArray(), []) ?? [];
  const multiWeekPlans = useLiveQuery(() => db.multiWeekPlans.toArray(), []) ?? [];
  const planWeeks = useLiveQuery(() => db.planWeeks.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.trainingSessions.toArray(), []) ?? [];
  const phases = useLiveQuery(() => db.sessionPhases.toArray(), []) ?? [];
  const blocks = useLiveQuery(() => db.sessionBlocks.toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.sessionNotes.toArray(), []) ?? [];
  const pendingSyncCount = useLiveQuery(() => db.syncOutbox.where('synced').equals(0).count(), []) ?? 0;

  const activeClub = useMemo(
    () => clubs.find((c) => c.id === activeClubId) ?? clubs[0],
    [clubs, activeClubId]
  );

  function handleSelectClub(clubId: string) {
    setActiveClubId(clubId);
    try {
      localStorage.setItem('handball_active_club_id', clubId);
    } catch {
      // Ignore storage errors
    }
  }

  const teams = useMemo(
    () => (activeClub ? allTeams.filter((t) => t.club_id === activeClub.id) : allTeams),
    [allTeams, activeClub]
  );
  const members = useMemo(
    () => (activeClub ? allMembers.filter((m) => m.club_id === activeClub.id) : allMembers),
    [allMembers, activeClub]
  );
  const exercises = useMemo(
    () =>
      activeClub
        ? allExercises.filter((e) => e.club_id === activeClub.id || e.visibility === 'PUBLIC')
        : allExercises,
    [allExercises, activeClub]
  );
  const templates = useMemo(
    () => (activeClub ? allTemplates.filter((st) => st.club_id === activeClub.id) : allTemplates),
    [allTemplates, activeClub]
  );
  const isAnyClubAdmin = useMemo(
    () =>
      Boolean(
        authUserId &&
          allMembers.some((m) => m.user_id === authUserId && m.club_role === 'CLUB_ADMIN')
      ),
    [allMembers, authUserId]
  );

  const isCurrentClubAdmin = useMemo(() => {
    // Local / demo mode: the device owner acts as club admin
    if (!isSupabaseConfigured() || !authUserId) return true;
    return members.some((m) => m.user_id === authUserId && m.club_role === 'CLUB_ADMIN');
  }, [members, authUserId]);

  const clubTeamIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const clubExercises = useMemo(
    () =>
      activeClub
        ? allExercises.filter((e) => e.club_id === activeClub.id && e.visibility !== 'PUBLIC')
        : [],
    [allExercises, activeClub]
  );
  const clubSessions = useMemo(
    () => sessions.filter((s) => clubTeamIds.has(s.team_id)),
    [sessions, clubTeamIds]
  );
  const clubPlans = useMemo(
    () => multiWeekPlans.filter((p) => clubTeamIds.has(p.team_id)),
    [multiWeekPlans, clubTeamIds]
  );
  const clubPlanIds = useMemo(() => new Set(clubPlans.map((p) => p.id)), [clubPlans]);
  const clubPlanWeeks = useMemo(
    () => planWeeks.filter((pw) => clubPlanIds.has(pw.multi_week_plan_id)),
    [planWeeks, clubPlanIds]
  );

  function handleClubResetCompleted(summaryMessage: string) {
    setSelectedExerciseId(null);
    setFocusedSessionId(undefined);
    setPlannerSelectedSessionId('');
    setPlannerActivePhaseId('');
    setMobileDetailOpen(false);
    setSyncStatusBanner(summaryMessage);
    setTimeout(() => setSyncStatusBanner(null), 6000);
  }

  function handleCatalogImported(summaryMessage: string) {
    setSyncStatusBanner(summaryMessage);
    setTimeout(() => setSyncStatusBanner(null), 6000);
  }

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? teams[0],
    [teams, activeTeamId]
  );

  const activeTeamAgeGroup = useMemo(() => resolveTeamAgeGroup(activeTeam), [activeTeam]);

  activeTeamIdRef.current = activeTeam?.id ?? '';
  activeTeamAgeGroupRef.current = activeTeamAgeGroup;

  useEffect(() => {
    if (!activeTeam) return;
    const nextContext: PlannerTeamContext = {
      teamId: activeTeam.id,
      ageGroup: activeTeamAgeGroup
    };
    const current = plannerStateRef.current;
    const historySnapshot = (window.history.state as AppHistoryState | null)?.plannerSnapshot;
    const reconciled = reconcilePlannerStateForTeamChange({
      previousContext: appliedTeamAgeGroupContextRef.current,
      nextContext,
      currentFilters: current.filters,
      currentSessionId: current.sessionId,
      currentPhaseId: current.phaseId,
      historySnapshot
    });
    appliedTeamAgeGroupContextRef.current = nextContext;
    if (reconciled.changed) {
      setPlannerFilters(reconciled.filters);
      setPlannerSelectedSessionId(reconciled.sessionId);
      setPlannerActivePhaseId(reconciled.phaseId);
    }
  }, [activeTeam?.id, activeTeamAgeGroup]);

  useEffect(() => {
    setVisibleExerciseCount(EXERCISE_PAGE_SIZE);
  }, [
    activeClub?.id,
    activeTeam?.id,
    searchQuery,
    favoritesOnly,
    visibilityFilter,
    ageGroupFilter,
    phaseFilter,
    focusFilter,
    levelFilter,
    playerCountFilter
  ]);

  const exercisesById = useMemo(() => {
    const map = new Map(exercises.map((ex) => [ex.id, ex]));
    return map;
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    const playerCountNum = Number(playerCountFilter);
    const hasPlayerFilter = playerCountFilter.trim() !== '' && !Number.isNaN(playerCountNum) && playerCountNum > 0;

    return exercises
      .filter((ex) => {
        if (favoritesOnly && !ex.is_favorite) return false;
        if (visibilityFilter !== 'ALL' && ex.visibility !== visibilityFilter) {
          return false;
        }
        if (
          ageGroupFilter !== 'ALL' &&
          !(ex.categories.age_groups ?? []).includes(ageGroupFilter)
        ) {
          return false;
        }
        if (phaseFilter !== 'ALL' && !ex.categories.phases.includes(phaseFilter)) {
          return false;
        }
        if (focusFilter !== 'ALL' && !ex.categories.focus.includes(focusFilter)) {
          return false;
        }
        if (levelFilter !== 'ALL' && ex.categories.level !== levelFilter) {
          return false;
        }
        if (
          hasPlayerFilter &&
          (playerCountNum < ex.min_players || playerCountNum > ex.max_players)
        ) {
          return false;
        }
        if (
          ex.visibility === 'TEAM' &&
          ex.owner_team_id &&
          activeTeam &&
          ex.owner_team_id !== activeTeam.id
        ) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const focusText = ex.categories.focus
          .map((f) => FOCUS_TAG_LABELS[f])
          .join(' ')
          .toLowerCase();
        return (
          ex.title.toLowerCase().includes(q) ||
          ex.setup_description.toLowerCase().includes(q) ||
          ex.flow_description.toLowerCase().includes(q) ||
          ex.coaching_points.toLowerCase().includes(q) ||
          (ex.variations_text ?? '').toLowerCase().includes(q) ||
          focusText.includes(q)
        );
      })
      .sort((a, b) => Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite)));
  }, [
    exercises,
    favoritesOnly,
    visibilityFilter,
    ageGroupFilter,
    phaseFilter,
    focusFilter,
    levelFilter,
    playerCountFilter,
    searchQuery,
    activeTeam
  ]);

  const activeExercise = useMemo(() => {
    if (selectedExerciseId && exercisesById.has(selectedExerciseId)) {
      return exercisesById.get(selectedExerciseId)!;
    }
    return filteredExercises[0] ?? null;
  }, [selectedExerciseId, exercisesById, filteredExercises]);

  const relatedVariants = useMemo(() => {
    if (!activeExercise) return [];
    const rootId = activeExercise.parent_exercise_id ?? activeExercise.id;
    return exercises.filter(
      (ex) =>
        ex.id !== activeExercise.id &&
        (ex.id === rootId || ex.parent_exercise_id === rootId)
    );
  }, [activeExercise, exercises]);

  const todayIso = getLocalDateIso();

  const activePlan = useMemo(
    () =>
      activeTeam
        ? selectActiveMultiWeekPlan(
            multiWeekPlans.filter((p) => p.team_id === activeTeam.id),
            todayIso
          )
        : undefined,
    [multiWeekPlans, activeTeam, todayIso]
  );

  const activePlanWeeks = useMemo(
    () =>
      activePlan
        ? planWeeks
            .filter((pw) => pw.multi_week_plan_id === activePlan.id)
            .sort((a, b) => a.week_number - b.week_number)
        : [],
    [planWeeks, activePlan]
  );

  const currentPlanWeek = useMemo(
    () => selectCurrentPlanWeek(activePlanWeeks, todayIso),
    [activePlanWeeks, todayIso]
  );

  async function handleSaveExercise(exercise: Exercise) {
    await db.exercises.put(exercise);
    await queueSyncOperation('exercises', exercise.id, 'UPSERT', exercise);
    setSelectedExerciseId(exercise.id);
    setSyncStatusBanner(`✓ Übung „${exercise.title}“ in der Datenbank gespeichert.`);
    setTimeout(() => setSyncStatusBanner(null), 3500);
  }

  async function handleImportAiExercises(importedList: Exercise[]) {
    await db.exercises.bulkPut(importedList);
    for (const ex of importedList) {
      await queueSyncOperation('exercises', ex.id, 'UPSERT', ex);
    }
    if (importedList[0]) {
      setSelectedExerciseId(importedList[0].id);
    }
    setSyncStatusBanner(`✓ ${importedList.length} Übung(en) erfolgreich in die Datenbank importiert.`);
    setTimeout(() => setSyncStatusBanner(null), 3500);
  }

  async function handleDeleteExercise(ex: Exercise) {
    const updated: Exercise = {
      ...ex,
      is_deleted: true,
      updated_at: new Date().toISOString()
    };
    await db.exercises.put(updated);
    await queueSyncOperation('exercises', updated.id, 'DELETE', updated);
    if (selectedExerciseId === ex.id) {
      setSelectedExerciseId(null);
      setMobileDetailOpen(false);
    }
  }

  async function handleToggleFavorite(ex: Exercise) {
    const updated: Exercise = {
      ...ex,
      is_favorite: !ex.is_favorite,
      updated_at: new Date().toISOString()
    };
    await db.exercises.put(updated);
    await queueSyncOperation('exercises', updated.id, 'UPSERT', updated);
  }

  async function handleManualCloudSync() {
    if (isSupabaseConfigured() && !authUserEmail) {
      setShowAuthModal(true);
      return;
    }

    const res = await syncWithSupabaseCloud();
    if (res.mode === 'LOCAL_ONLY') {
      setSyncStatusBanner(
        'Lokaler Offline-First-Modus aktiv (Alle Änderungen sind sicher in IndexedDB gespeichert).'
      );
    } else if (res.mode === 'AUTH_REQUIRED') {
      setShowAuthModal(true);
    } else if (res.mode === 'NO_CLUB') {
      await seedInitialDataIfEmpty();
      setNeedsClubOnboarding(true);
      setShowAuthModal(true);
    } else if (res.errorMessage) {
      setSyncStatusBanner(`Sync-Hinweis: ${res.errorMessage}`);
    } else {
      setNeedsClubOnboarding(false);
      setSyncStatusBanner(
        `Cloud-Sync fertig: ${res.pushedCount} gesendet, ${res.pulledCount} aktualisiert.`
      );
    }
    setTimeout(() => setSyncStatusBanner(null), res.errorMessage ? 6500 : 3500);
  }

  async function handleDownloadBackupJson() {
    const json = await exportClubDatabaseSnapshot();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `handball-verein-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!activeClub) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        Initialisiere lokale Offline-Datenbank...
      </div>
    );
  }

  if (!activeTeam) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-200">
            Aktuell ist keine Mannschaft im Verein vorhanden. Bitte lege unten eine neue Mannschaft an.
          </div>
          <ClubTeamManager
            club={activeClub}
            teams={teams}
            members={members}
            teamMembers={teamMembers}
            activeTeamId=""
            onSelectTeam={(id) => setActiveTeamId(id)}
            isClubAdmin={isCurrentClubAdmin}
            authUserId={authUserId}
            clubExercises={clubExercises}
            clubSessions={clubSessions}
            clubPlans={clubPlans}
            clubPlanWeeks={clubPlanWeeks}
            onDownloadBackup={handleDownloadBackupJson}
            onResetCompleted={handleClubResetCompleted}
            onCatalogImported={handleCatalogImported}
          />
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="no-print flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:flex-row">
      {/* Linke Navigation (Desktop & Tablet Querformat) */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-800/90 bg-slate-900/90 p-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-3 pb-5 border-b border-slate-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-black text-white shadow-md shadow-blue-600/30">
            HB
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">{activeClub.name}</div>
            <div className="text-[11px] text-blue-400 font-medium">Offline-First Vereins-PWA</div>
          </div>
        </div>

        {/* Vereins-Umschalter (falls Nutzer in mehreren Vereinen ist) */}
        {clubs.length > 1 && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wider text-blue-400 uppercase">
              Aktiver Verein ({clubs.length})
            </label>
            <select
              value={activeClub.id}
              onChange={(e) => handleSelectClub(e.target.value)}
              className="w-full rounded-xl border border-blue-500/50 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-blue-400 focus:outline-none"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Mannschafts-Umschalter */}
        <div className="mt-5">
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Aktive Mannschaft
          </label>
          <select
            value={activeTeam.id}
            onChange={(e) => setActiveTeamId(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white focus:border-blue-500 focus:outline-none"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.season})
              </option>
            ))}
          </select>
        </div>

        {/* Hauptnavigation */}
        <nav className="mt-5 space-y-1.5">
          <button
            type="button"
            onClick={() => navigateToTab('DASHBOARD')}
            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              activeTab === 'DASHBOARD'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-slate-300 hover:bg-slate-800/70'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Trainings-Editor & Tag
          </button>

          {uiFeatures.hallLiveMode && (
            <button
              type="button"
              onClick={() => navigateToTab('HALL_LIVE')}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                activeTab === 'HALL_LIVE'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-emerald-300 hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-3">
                <Play className="h-4 w-4" />
                Sporthallen-Modus (Live)
              </span>
              <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                Timer
              </span>
            </button>
          )}

          {uiFeatures.multiWeekPlans && (
            <button
              type="button"
              onClick={() => navigateToTab('PLANS')}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                activeTab === 'PLANS'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <CalendarRange className="h-4 w-4" />
              Mehrwochenplan (Mesozyklus)
            </button>
          )}

          <button
            type="button"
            onClick={() => navigateToTab('EXERCISES')}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              activeTab === 'EXERCISES'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-slate-300 hover:bg-slate-800/70'
            }`}
          >
            <span className="flex items-center gap-3">
              <BookOpen className="h-4 w-4" />
              Übungsdatenbank
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
              {exercises.length}
            </span>
          </button>

          {uiFeatures.clubAdmin && (
            <button
              type="button"
              onClick={() => navigateToTab('CLUB_ADMIN')}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                activeTab === 'CLUB_ADMIN'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Verein, Teams & Trainer
            </button>
          )}
        </nav>

        {/* Offline / Sync Status & Store-freie PWA Hilfe */}
        <div className="mt-6 space-y-2.5 border-t border-slate-800 pt-4">
          {uiFeatures.cloudSync && (
            <>
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs">
                <span className="flex items-center gap-2 font-medium">
                  {isOnline ? (
                    <>
                      <Wifi className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-300">Offline-DB bereit</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 text-amber-400" />
                      <span className="text-amber-300">Hallen-Offline aktiv</span>
                    </>
                  )}
                </span>
                {authUserEmail ? (
                  <button
                    type="button"
                    onClick={() => void handleManualCloudSync()}
                    className="inline-flex items-center gap-1 rounded bg-blue-950 px-2 py-0.5 text-[10px] font-semibold text-blue-300 hover:bg-blue-900"
                    title="Outbox synchronisieren"
                  >
                    <CloudUpload className="h-3 w-3" />
                    {pendingSyncCount} Sync
                  </button>
                ) : (
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    Demo / Lokal
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  authUserEmail
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40'
                    : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {authUserEmail ? authUserEmail : isSupabaseConfigured() ? 'Cloud-Login' : 'Konto / Sync'}
                  </span>
                </span>
                <span className="text-[10px] opacity-80">
                  {authUserEmail ? 'Aktiv' : 'Lokal'}
                </span>
              </button>
            </>
          )}

          {(showPwaInstallButton || uiFeatures.backupExport) && (
            <div
              className={`grid gap-2 ${
                showPwaInstallButton && uiFeatures.backupExport ? 'grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {showPwaInstallButton && (
                <button
                  type="button"
                  onClick={() => setShowInstallModal(true)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-950/40 px-2.5 py-2 text-[11px] font-semibold text-blue-300 hover:bg-blue-900/50"
                >
                  <Download className="h-3.5 w-3.5" />
                  PWA App
                </button>
              )}
              {uiFeatures.backupExport && (
                <button
                  type="button"
                  onClick={() => void handleDownloadBackupJson()}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                  title="Komplettes Vereins-Backup als JSON herunterladen"
                >
                  <FileDown className="h-3.5 w-3.5 text-emerald-400" />
                  Backup
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setUiConfigModalOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-blue-400" />
            UI anpassen
          </button>
        </div>
      </aside>

      {/* Hauptinhalt */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 bg-slate-900/90 px-4 py-3 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-blue-600/20 px-2.5 py-1 text-xs font-bold text-blue-400">
              {activeTeam.name}
            </span>
            <span className="hidden text-xs text-slate-400 sm:inline">
              {formatTeamAgeGroupLabel(activeTeam.age_group)} · Saison {activeTeam.season}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={activeTeam.id}
              onChange={(e) => setActiveTeamId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white lg:hidden"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {uiFeatures.hallLiveMode && (
              <button
                type="button"
                onClick={() => navigateToTab('HALL_LIVE')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Play className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Hallen-Modus</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setEditingExercise(null);
                setVariantParentExercise(null);
                setEditorModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Neue Übung
            </button>

            {uiFeatures.aiImport && (
              <button
                type="button"
                onClick={() => setAiImporterOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-950/50 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/60"
              >
                <Bot className="h-3.5 w-3.5 text-purple-400" />
                <span className="hidden sm:inline">KI-JSON Import</span>
              </button>
            )}

            {uiFeatures.cloudSync && (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  authUserEmail
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                title="Cloud-Sync & Anmeldung"
              >
                <User className="h-3.5 w-3.5 text-emerald-400" />
                <span className="hidden md:inline">{authUserEmail ? 'Cloud' : 'Login'}</span>
              </button>
            )}

            {showPwaInstallButton && (
              <button
                type="button"
                onClick={() => setShowInstallModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5 text-blue-400" />
                <span className="hidden md:inline">Installieren</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setUiConfigModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
              title="UI vereinfachen & Funktionen konfigurieren"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-blue-400" />
              <span className="hidden xl:inline">UI</span>
            </button>
          </div>
        </header>

        {syncStatusBanner && (
          <div className="mx-auto mt-3 w-full max-w-7xl px-4 lg:px-8">
            <div className="rounded-xl border border-blue-500/40 bg-blue-950/50 px-4 py-2 text-xs font-semibold text-blue-200">
              {syncStatusBanner}
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">
          {/* TAB 1: SPEED-PLANNING TRAININGS-EDITOR & VORLAGEN (MEILENSTEIN 3) */}
          {activeTab === 'DASHBOARD' && (
            <div className="space-y-6">
              {activePlan && currentPlanWeek && (
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/50 via-slate-900 to-slate-900 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-emerald-400 uppercase">
                        <Sparkles className="h-4 w-4" />
                        Aktueller Wochen-Schwerpunkt · KW {getIsoWeekNumber(currentPlanWeek.start_date)} (
                        {formatIsoDateDe(currentPlanWeek.start_date)} –{' '}
                        {formatIsoDateDe(addDaysIso(currentPlanWeek.start_date, 6))}) · {activePlan.title}
                      </div>
                      <h2 className="mt-1 text-lg font-bold text-white">
                        {currentPlanWeek.focus_theme}
                      </h2>
                      {currentPlanWeek.notes && (
                        <p className="mt-0.5 text-xs text-slate-300">{currentPlanWeek.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {currentPlanWeek.focus_tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-emerald-500/40 bg-emerald-950/70 px-3 py-1 text-xs font-medium text-emerald-300"
                        >
                          #{FOCUS_TAG_LABELS[tag]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <TrainingSessionPlanner
                clubId={activeClub.id}
                activeTeam={activeTeam}
                members={members}
                exercises={exercises}
                templates={templates}
                sessions={sessions}
                phases={phases}
                blocks={blocks}
                notes={notes}
                activePlanWeeks={activePlanWeeks}
                focusedSessionId={focusedSessionId}
                catalogFilters={plannerFilters}
                onChangeCatalogFilters={setPlannerFilters}
                selectedSessionId={plannerSelectedSessionId}
                onSelectSessionId={setPlannerSelectedSessionId}
                activePhaseId={plannerActivePhaseId}
                onSelectPhaseId={setPlannerActivePhaseId}
                onEditExercise={(ex) => {
                  setEditingExercise(ex);
                  setVariantParentExercise(null);
                  setEditorModalOpen(true);
                }}
                onOpenExercise={(ex) => {
                  setSelectedExerciseId(ex.id);
                  setMobileDetailOpen(true);
                  navigateToTab('EXERCISES', { exerciseId: ex.id, mobileDetailOpen: true });
                }}
                onStartHallMode={
                  uiFeatures.hallLiveMode
                    ? (sessionId) => {
                        setFocusedSessionId(sessionId);
                        navigateToTab('HALL_LIVE', { keepFocusedSession: true });
                      }
                    : undefined
                }
                onPrintSession={
                  uiFeatures.printExport
                    ? (session) => {
                        const sessionPhases = phases.filter(
                          (p) => p.training_session_id === session.id
                        );
                        const linkedWeek = session.plan_week_id
                          ? activePlanWeeks.find((pw) => pw.id === session.plan_week_id)
                          : activePlanWeeks[1] ?? activePlanWeeks[0];
                        setPrintTarget({
                          kind: 'SESSION',
                          team: activeTeam,
                          session,
                          phases: sessionPhases,
                          blocks,
                          exercisesById,
                          members,
                          focusTheme: linkedWeek?.focus_theme
                        });
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* TAB 2: MOBILER SPORTHALLEN-MODUS LIVE (MEILENSTEIN 5) */}
          {activeTab === 'HALL_LIVE' && (
            <HallLiveMode
              activeTeam={activeTeam}
              sessions={sessions}
              phases={phases}
              blocks={blocks}
              exercises={exercises}
              members={members}
              notes={notes}
              initialSessionId={focusedSessionId}
            />
          )}

          {/* TAB 3: ÜBUNGSDATENBANK, TAKTIKBOARD & KI-IMPORT (MEILENSTEIN 2) */}
          {activeTab === 'EXERCISES' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Vereins- & Team-Übungsdatenbank ({filteredExercises.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Erstelle eigene Übungen mit Taktikboard, füge Web-Zeichnungen per Strg+V ein oder importiere per KI-JSON.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {uiFeatures.aiImport && (
                    <button
                      type="button"
                      onClick={() => setAiImporterOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-950/50 px-3.5 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-900/60"
                    >
                      <Bot className="h-4 w-4 text-purple-400" />
                      KI-JSON Import & Prompt-Generator
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExercise(null);
                      setVariantParentExercise(null);
                      setEditorModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500"
                  >
                    <Plus className="h-4 w-4" />
                    Neue Übung & Taktik-Skizze
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-5">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Übung, Schwerpunkt, Ablauf oder Variante suchen..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 text-xs text-white focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      {uiFeatures.favorites && (
                        <button
                          type="button"
                          onClick={() => setFavoritesOnly((f) => !f)}
                          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl border px-3 text-xs font-bold transition ${
                            favoritesOnly
                              ? 'border-amber-400 bg-amber-500 text-slate-950'
                              : 'border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700'
                          }`}
                          title="Nur Favoriten anzeigen"
                        >
                          <Star className={`h-4 w-4 ${favoritesOnly ? 'fill-slate-950' : ''}`} />
                          <span className="hidden sm:inline">Favoriten</span>
                        </button>
                      )}
                      {uiFeatures.advancedFilters && (
                        <button
                          type="button"
                          onClick={() => setMobileFiltersOpen((o) => !o)}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-200 lg:hidden"
                          title="Filter ein-/ausblenden"
                        >
                          <Filter className="h-4 w-4 text-blue-400" />
                        </button>
                      )}
                    </div>

                    {uiFeatures.advancedFilters && (
                    <div className={`space-y-3 ${mobileFiltersOpen ? 'block' : 'hidden lg:block'}`}>
                      <div className="flex flex-wrap gap-1.5">
                        {(['ALL', 'CLUB', 'TEAM'] as const).map((vis) => (
                          <button
                            key={vis}
                            type="button"
                            onClick={() => setVisibilityFilter(vis)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                              visibilityFilter === vis
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {vis === 'ALL'
                              ? 'Alle Sichtbarkeiten'
                              : vis === 'CLUB'
                                ? 'Vereins-Pool (CLUB)'
                                : 'Nur mein Team (TEAM)'}
                          </button>
                        ))}
                      </div>

                      {/* Kombinierbare Multi-Filter: Phase, Schwerpunkt, Level, Spielerzahl */}
                      <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
                        <select
                          value={phaseFilter}
                          onChange={(e) =>
                            setPhaseFilter(e.target.value as 'ALL' | TrainingPhaseCategory)
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                        >
                          <option value="ALL">Phase: Alle</option>
                          {(Object.keys(PHASE_CATEGORY_LABELS) as TrainingPhaseCategory[]).map(
                            (p) => (
                              <option key={p} value={p}>
                                {PHASE_CATEGORY_LABELS[p]}
                              </option>
                            )
                          )}
                        </select>

                        <select
                          value={focusFilter}
                          onChange={(e) =>
                            setFocusFilter(e.target.value as 'ALL' | HandballFocusTag)
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                        >
                          <option value="ALL">Schwerpunkt / Technik: Alle</option>
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

                        <select
                          value={levelFilter}
                          onChange={(e) =>
                            setLevelFilter(e.target.value as 'ALL' | ComplexityLevel)
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                        >
                          <option value="ALL">Level: Alle</option>
                          {(Object.keys(COMPLEXITY_LABELS) as ComplexityLevel[]).map((l) => (
                            <option key={l} value={l}>
                              {COMPLEXITY_LABELS[l]}
                            </option>
                          ))}
                        </select>

                        <input
                          type="number"
                          min={1}
                          max={30}
                          placeholder="Spielerzahl (z.B. 10)"
                          value={playerCountFilter}
                          onChange={(e) => setPlayerCountFilter(e.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                        />
                      </div>

                      <div className="space-y-1.5 border-t border-slate-800 pt-3">
                        <div className="text-[11px] font-semibold text-slate-400">
                          Altersstufe
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAgeGroupFilter('ALL')}
                            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                              ageGroupFilter === 'ALL'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            Alle Altersstufen
                          </button>
                          {ALL_AGE_GROUPS.map((ag) => (
                            <button
                              key={ag}
                              type="button"
                              onClick={() => setAgeGroupFilter(ag)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                                ageGroupFilter === ag
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {AGE_GROUP_LABELS[ag]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {filteredExercises.slice(0, visibleExerciseCount).map((ex) => {
                      const isSelected = activeExercise?.id === ex.id;
                      return (
                        <div
                          key={ex.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedExerciseId(ex.id);
                            setMobileDetailOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedExerciseId(ex.id);
                              setMobileDetailOpen(true);
                            }
                          }}
                          className={`w-full cursor-pointer rounded-xl border p-4 text-left transition ${
                            isSelected
                              ? 'border-blue-500 bg-blue-950/30 shadow-md'
                              : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`rounded px-2 py-0.5 font-semibold ${
                                  ex.visibility === 'CLUB'
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-amber-950 text-amber-300'
                                }`}
                              >
                                {VISIBILITY_LABELS[ex.visibility]}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">
                                {ex.default_duration_min} Min · {ex.min_players}–{ex.max_players} Sp.
                              </span>
                              {uiFeatures.favorites && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggleFavorite(ex);
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-800"
                                  title={ex.is_favorite ? 'Favorit entfernen' : 'Als Favorit anheften'}
                                >
                                  <Star
                                    className={`h-4 w-4 ${
                                      ex.is_favorite
                                        ? 'fill-amber-400 text-amber-400'
                                        : 'text-slate-500'
                                    }`}
                                  />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="mt-1.5 font-bold text-white text-sm">{ex.title}</div>

                          {(ex.categories.age_groups ?? []).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
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

                          {ex.parent_exercise_id && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-blue-400">
                              <GitBranch className="h-3 w-3" />
                              Variante einer Grundübung
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredExercises.length > visibleExerciseCount && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleExerciseCount((prev) => prev + EXERCISE_PAGE_SIZE)
                          }
                          className="flex-1 rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                        >
                          Weitere anzeigen ({Math.min(visibleExerciseCount, filteredExercises.length)} von{' '}
                          {filteredExercises.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setVisibleExerciseCount(filteredExercises.length)}
                          className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-900 hover:text-white"
                        >
                          Alle anzeigen
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={
                    mobileDetailOpen && activeExercise
                      ? 'fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-950 lg:static lg:z-auto lg:col-span-7 lg:overflow-visible lg:bg-transparent'
                      : 'hidden lg:block lg:col-span-7'
                  }
                >
                  {activeExercise ? (
                    <div className="rounded-none border-0 bg-slate-900/90 p-4 pb-28 space-y-5 lg:rounded-2xl lg:border lg:border-slate-800 lg:p-6">
                      {/* Sticky Smartphone Slide-Over Header (< 1024px) */}
                      <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur-md lg:hidden">
                        <button
                          type="button"
                          onClick={() => setMobileDetailOpen(false)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-bold text-white"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Zurück zur Liste
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingExercise(activeExercise);
                              setVariantParentExercise(null);
                              setEditorModalOpen(true);
                            }}
                            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-slate-800 px-2.5 text-xs font-semibold text-white"
                          >
                            <Edit3 className="h-3.5 w-3.5 text-blue-400" />
                            Bearbeiten
                          </button>
                          {uiFeatures.printExport && (
                            <button
                              type="button"
                              onClick={() =>
                                setPrintTarget({ kind: 'EXERCISE', exercise: activeExercise })
                              }
                              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-slate-800 px-2.5 text-xs font-semibold text-emerald-300"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              PDF
                            </button>
                          )}
                          {uiFeatures.exerciseVariants && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingExercise(null);
                                setVariantParentExercise(activeExercise);
                                setEditorModalOpen(true);
                              }}
                              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-blue-600 px-2.5 text-xs font-semibold text-white"
                            >
                              <CopyPlus className="h-3.5 w-3.5" />
                              Variante
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                        <div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="rounded bg-blue-950 px-2.5 py-0.5 font-semibold text-blue-300">
                              {COMPLEXITY_LABELS[activeExercise.categories.level]}
                            </span>
                            <span className="text-slate-400">
                              Empfohlene Dauer: {activeExercise.default_duration_min} Min ·{' '}
                              {activeExercise.min_players}–{activeExercise.max_players} Feldspieler +{' '}
                              {activeExercise.goalkeepers} TW
                            </span>
                          </div>
                          <h2 className="mt-1.5 text-xl font-bold text-white">
                            {activeExercise.title}
                          </h2>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {uiFeatures.favorites && (
                            <button
                              type="button"
                              onClick={() => void handleToggleFavorite(activeExercise)}
                              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                                activeExercise.is_favorite
                                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              <Star
                                className={`h-3.5 w-3.5 ${
                                  activeExercise.is_favorite ? 'fill-amber-400 text-amber-400' : ''
                                }`}
                              />
                              Favorit
                            </button>
                          )}

                          {uiFeatures.printExport && (
                            <button
                              type="button"
                              onClick={() =>
                                setPrintTarget({ kind: 'EXERCISE', exercise: activeExercise })
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              PDF / Drucken
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingExercise(activeExercise);
                              setVariantParentExercise(null);
                              setEditorModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                          >
                            <Edit3 className="h-3.5 w-3.5 text-blue-400" />
                            Bearbeiten
                          </button>

                          {uiFeatures.exerciseVariants && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingExercise(null);
                                setVariantParentExercise(activeExercise);
                                setEditorModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-950/40 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-900/50"
                            >
                              <CopyPlus className="h-3.5 w-3.5" />
                              Als Variante duplizieren
                            </button>
                          )}

                          {confirmDeleteExerciseId === activeExercise.id ? (
                            <div className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-950/70 px-2.5 py-1 text-xs">
                              <span className="font-semibold text-rose-200">Löschen?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeleteExercise(activeExercise);
                                  setConfirmDeleteExerciseId(null);
                                }}
                                className="rounded bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-500"
                              >
                                Ja
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteExerciseId(null)}
                                className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                              >
                                Nein
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteExerciseId(activeExercise.id)}
                              className="rounded-xl bg-rose-950/60 p-1.5 text-rose-300 hover:bg-rose-900"
                              title="Übung löschen"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {relatedVariants.length > 0 && (
                        <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3">
                          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-blue-300">
                            <GitBranch className="h-3.5 w-3.5" />
                            Verknüpfte Grundübung / Varianten ({relatedVariants.length}):
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {relatedVariants.map((rel) => (
                              <button
                                key={rel.id}
                                type="button"
                                onClick={() => setSelectedExerciseId(rel.id)}
                                className="rounded-lg border border-blue-500/40 bg-slate-900 px-2.5 py-1 text-xs font-medium text-blue-200 hover:bg-blue-950"
                              >
                                ↳ {rel.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-slate-200 uppercase">
                              Handball-Taktikboard (Vektor-Skizze)
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="hidden sm:inline">
                                Blau = Angriff · Rot = Abwehr · Grün = TW · ((RL)) = Anstellreihe
                              </span>
                              <button
                                type="button"
                                onClick={() => setChalkboardOpen(true)}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-500/40 bg-blue-950/50 px-2.5 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-900/60"
                              >
                                <Maximize2 className="h-3 w-3" />
                                Vollbild
                              </button>
                            </div>
                          </div>
                          <TacticBoardPreview
                            data={activeExercise.tactic_board_data}
                            hideControls={!uiFeatures.tacticAnimation}
                          />
                        </div>

                        {activeExercise.reference_image_data && (
                          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                            <div className="mb-2 text-xs font-semibold text-slate-300 uppercase">
                              Eingefügte Original-Zeichnung / Web-Referenz (Strg+V)
                            </div>
                            <img
                              src={activeExercise.reference_image_data}
                              alt={activeExercise.title}
                              className="mx-auto max-h-72 rounded-lg object-contain"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(activeExercise.categories.age_groups ?? []).map((ag) => (
                          <span
                            key={ag}
                            className="rounded-md bg-indigo-950/90 border border-indigo-600/40 px-2.5 py-1 text-xs font-medium text-indigo-200"
                          >
                            {AGE_GROUP_LABELS[ag]}
                          </span>
                        ))}
                        {activeExercise.categories.phases.map((p) => (
                          <span
                            key={p}
                            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
                          >
                            {PHASE_CATEGORY_LABELS[p]}
                          </span>
                        ))}
                        {activeExercise.categories.focus.map((f) => {
                          const isTechnique = TECHNIQUE_FOCUS_TAGS.includes(f);
                          const isAthleticsRecovery = ATHLETICS_RECOVERY_FOCUS_TAGS.includes(f);
                          return (
                            <span
                              key={f}
                              className={
                                isTechnique
                                  ? 'rounded-md bg-amber-950/80 border border-amber-600/40 px-2.5 py-1 text-xs font-medium text-amber-200'
                                  : isAthleticsRecovery
                                    ? 'rounded-md bg-emerald-950/80 border border-emerald-600/40 px-2.5 py-1 text-xs font-medium text-emerald-200'
                                    : 'rounded-md bg-blue-950/80 border border-blue-700/40 px-2.5 py-1 text-xs text-blue-300'
                              }
                            >
                              #{FOCUS_TAG_LABELS[f]}
                            </span>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <h4 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                            Aufbau & Organisation
                          </h4>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                            {activeExercise.setup_description}
                          </p>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <h4 className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                            Coaching-Punkte / Korrekturen
                          </h4>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                            {activeExercise.coaching_points}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <h4 className="text-xs font-bold tracking-wider text-blue-400 uppercase">
                          Übungsablauf
                        </h4>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                          {activeExercise.flow_description}
                        </p>
                      </div>

                      {activeExercise.variations_text && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <h4 className="text-xs font-bold tracking-wider text-emerald-400 uppercase">
                            Variationen & Steigerungen
                          </h4>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                            {activeExercise.variations_text}
                          </p>
                        </div>
                      )}

                      {(isSafeHttpUrl(activeExercise.source_url) ||
                        activeExercise.external_links.some((lnk) => isSafeHttpUrl(lnk.url))) && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                          <h4 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                            Web-Referenzen & Weiterführende Links
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {isSafeHttpUrl(activeExercise.source_url) && (
                              <a
                                href={activeExercise.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-blue-400 hover:underline"
                              >
                                <ExternalLinkIcon className="h-3.5 w-3.5" />
                                Original-Quelle öffnen
                              </a>
                            )}
                            {activeExercise.external_links
                              .filter((lnk) => isSafeHttpUrl(lnk.url))
                              .map((lnk, idx) => (
                                <a
                                  key={idx}
                                  href={lnk.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-blue-300 hover:underline"
                                >
                                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                                  {lnk.title}
                                </a>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MEHRWOCHENPLÄNE & WOCHENMATRIX (MEILENSTEIN 4) */}
          {activeTab === 'PLANS' && (
            <MultiWeekPlanManager
              activeTeam={activeTeam}
              members={members}
              plans={multiWeekPlans}
              planWeeks={planWeeks}
              sessions={sessions}
              templates={templates}
              onOpenSessionInEditor={(sessionId) => {
                setFocusedSessionId(sessionId);
                setPlannerSelectedSessionId(sessionId);
                setPlannerActivePhaseId('');
                navigateToTab('DASHBOARD', { keepFocusedSession: true });
              }}
              onStartHallMode={(sessionId) => {
                setFocusedSessionId(sessionId);
                navigateToTab('HALL_LIVE', { keepFocusedSession: true });
              }}
            />
          )}

          {/* TAB 5: VEREIN, MANNSCHAFTEN & TRAINERTEAM (MEILENSTEIN 1) */}
          {activeTab === 'CLUB_ADMIN' && (
            <ClubTeamManager
              club={activeClub}
              teams={teams}
              members={members}
              teamMembers={teamMembers}
              activeTeamId={activeTeam.id}
              onSelectTeam={setActiveTeamId}
              isClubAdmin={isCurrentClubAdmin}
              authUserId={authUserId}
              clubExercises={clubExercises}
              clubSessions={clubSessions}
              clubPlans={clubPlans}
              clubPlanWeeks={clubPlanWeeks}
              onDownloadBackup={handleDownloadBackupJson}
              onResetCompleted={handleClubResetCompleted}
              onCatalogImported={handleCatalogImported}
            />
          )}
        </main>
      </div>

      {/* Bottom Navigation für Smartphone & kleines Tablet */}
      <nav className="fixed right-0 bottom-0 left-0 z-40 flex items-center justify-around border-t border-slate-800 bg-slate-900/95 py-2 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => navigateToTab('DASHBOARD')}
          className={`flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-medium ${
            activeTab === 'DASHBOARD' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          Planer
        </button>
        {uiFeatures.hallLiveMode && (
          <button
            type="button"
            onClick={() => navigateToTab('HALL_LIVE')}
            className={`flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-bold ${
              activeTab === 'HALL_LIVE' ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            <Play className="h-5 w-5" />
            Halle Live
          </button>
        )}
        {uiFeatures.multiWeekPlans && (
          <button
            type="button"
            onClick={() => navigateToTab('PLANS')}
            className={`flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-medium ${
              activeTab === 'PLANS' ? 'text-blue-400' : 'text-slate-400'
            }`}
          >
            <CalendarRange className="h-5 w-5" />
            Wochenplan
          </button>
        )}
        <button
          type="button"
          onClick={() => navigateToTab('EXERCISES')}
          className={`flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-medium ${
            activeTab === 'EXERCISES' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <BookOpen className="h-5 w-5" />
          Übungen
        </button>
        {uiFeatures.clubAdmin && (
          <button
            type="button"
            onClick={() => navigateToTab('CLUB_ADMIN')}
            className={`flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-medium ${
              activeTab === 'CLUB_ADMIN' ? 'text-blue-400' : 'text-slate-400'
            }`}
          >
            <Building2 className="h-5 w-5" />
            Verein
          </button>
        )}
      </nav>

      <PwaInstallGuideModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />

      <AuthClubModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        userEmail={authUserEmail}
        authUserId={authUserId}
        clubs={clubs}
        activeClub={activeClub}
        onSelectClub={handleSelectClub}
        currentMember={members.find((m) => m.user_id && m.user_id === authUserId)}
        isAnyClubAdmin={isAnyClubAdmin}
        needsClubOnboarding={needsClubOnboarding}
        onNeedsOnboarding={() => setNeedsClubOnboarding(true)}
        onSyncCompleted={(msg) => {
          setNeedsClubOnboarding(false);
          setSyncStatusBanner(msg);
          setTimeout(() => setSyncStatusBanner(null), 4000);
        }}
      />

      <ExerciseEditorModal
        isOpen={editorModalOpen}
        initialExercise={editingExercise}
        parentExercise={variantParentExercise}
        clubId={activeClub.id}
        activeTeamId={activeTeam.id}
        onClose={() => setEditorModalOpen(false)}
        onSave={handleSaveExercise}
      />

      <AiExerciseImporterModal
        isOpen={aiImporterOpen}
        clubId={activeClub.id}
        activeTeamId={activeTeam.id}
        onClose={() => setAiImporterOpen(false)}
        onImportExercises={handleImportAiExercises}
      />
    </div>
    <PrintExportModal target={printTarget} onClose={() => setPrintTarget(null)} />

    <FullScreenChalkboardModal
      isOpen={chalkboardOpen && Boolean(activeExercise)}
      title={activeExercise?.title ?? 'Taktiktafel'}
      coachingPoints={activeExercise?.coaching_points}
      tacticBoardData={activeExercise?.tactic_board_data}
      referenceImageData={activeExercise?.reference_image_data}
      onClose={() => setChalkboardOpen(false)}
    />

    <UiConfigModal
      isOpen={uiConfigModalOpen}
      preferences={uiPreferences}
      onChangePreferences={handleUpdateUiPreferences}
      onOpenTour={() => setUiTourModalOpen(true)}
      onClose={() => setUiConfigModalOpen(false)}
    />

    {uiTourModalOpen && !showAuthModal && (
      <UiConfigTourModal
        isOpen={uiTourModalOpen}
        initialPreferences={uiPreferences}
        onComplete={(next) => {
          handleUpdateUiPreferences(next);
          setUiTourModalOpen(false);
        }}
        onSkip={() => setUiTourModalOpen(false)}
      />
    )}
    </>
  );
}
