import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Filter,
  GitBranch,
  Maximize2,
  MessageSquarePlus,
  Minus,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sun,
  Timer,
  Trophy
} from 'lucide-react';
import { db, queueSyncOperation } from '../db/database';
import type {
  ClubMember,
  Exercise,
  MaterialType,
  SessionBlock,
  SessionNote,
  SessionPhase,
  Team,
  TrainingSession
} from '../types/domain';
import { MATERIAL_LABELS } from '../constants/handballLabels';
import { aggregateSessionMaterials } from '../utils/trainingCalculations';
import {
  selectDefaultSession,
  sortSessionsChronologically
} from '../utils/sessionPlannerUtils';
import { TacticBoardPreview } from './TacticBoardPreview';
import { FullScreenChalkboardModal } from './FullScreenChalkboardModal';
import { hasExplicitTacticAnimation } from '../utils/tacticBoardUtils';

interface HallLiveModeProps {
  activeTeam: Team;
  sessions: TrainingSession[];
  phases: SessionPhase[];
  blocks: SessionBlock[];
  exercises: Exercise[];
  members: ClubMember[];
  notes: SessionNote[];
  initialSessionId?: string;
}

function formatSeconds(totalSec: number): string {
  const abs = Math.max(0, totalSec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function HallLiveMode({
  activeTeam,
  sessions,
  phases,
  blocks,
  exercises,
  members,
  notes,
  initialSessionId
}: HallLiveModeProps) {
  const teamSessions = useMemo(
    () => sortSessionsChronologically(sessions.filter((s) => s.team_id === activeTeam.id)),
    [sessions, activeTeam.id]
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string>(initialSessionId ?? '');

  useEffect(() => {
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
    }
  }, [initialSessionId]);

  const currentSession = useMemo(() => {
    if (selectedSessionId) {
      const found = teamSessions.find((s) => s.id === selectedSessionId);
      if (found) return found;
    }
    return selectDefaultSession(teamSessions);
  }, [teamSessions, selectedSessionId]);

  const currentPhases = useMemo(
    () =>
      currentSession
        ? phases
            .filter((p) => p.training_session_id === currentSession.id)
            .sort((a, b) => a.sort_order - b.sort_order)
        : [],
    [phases, currentSession]
  );

  const exercisesById = useMemo(
    () => new Map(exercises.map((ex) => [ex.id, ex])),
    [exercises]
  );

  // Ordered flat list of blocks across phases
  const orderedBlocksWithPhase = useMemo(() => {
    const list: { block: SessionBlock; phase: SessionPhase }[] = [];
    for (const phase of currentPhases) {
      const pBlocks = blocks
        .filter((b) => b.session_phase_id === phase.id)
        .sort((a, b) => a.time_slot_index - b.time_slot_index);
      for (const block of pBlocks) {
        list.push({ block, phase });
      }
    }
    return list;
  }, [currentPhases, blocks]);

  // "Meine Spur" filter for parallel coaching
  const [trackFilter, setTrackFilter] = useState<string>('ALL');
  const availableTracks = useMemo(() => {
    const set = new Set<string>();
    for (const item of orderedBlocksWithPhase) {
      if (item.block.track_label) {
        set.add(item.block.track_label);
      }
    }
    return Array.from(set);
  }, [orderedBlocksWithPhase]);

  const visibleBlocksWithPhase = useMemo(() => {
    if (trackFilter === 'ALL') return orderedBlocksWithPhase;
    return orderedBlocksWithPhase.filter(
      (item) =>
        item.block.track_label === trackFilter ||
        item.block.track_label.toLowerCase().includes('alle')
    );
  }, [orderedBlocksWithPhase, trackFilter]);

  const [activeIndex, setActiveIndex] = useState(0);
  const currentItem = visibleBlocksWithPhase[activeIndex] ?? visibleBlocksWithPhase[0] ?? null;
  const activeBlock = currentItem?.block ?? null;
  const activePhase = currentItem?.phase ?? null;
  const activeExercise = activeBlock?.exercise_id
    ? exercisesById.get(activeBlock.exercise_id)
    : undefined;

  // Packing list & checked state
  const [showPackingList, setShowPackingList] = useState(false);
  const [checkedMaterials, setCheckedMaterials] = useState<Set<MaterialType>>(new Set());
  const sessionPackingList = useMemo(() => {
    const allSessionBlocks = orderedBlocksWithPhase.map((x) => x.block);
    return aggregateSessionMaterials(
      allSessionBlocks,
      exercisesById,
      currentSession?.custom_materials_override ?? []
    );
  }, [orderedBlocksWithPhase, exercisesById, currentSession]);

  // Section Countdown Timer state
  const [remainingSeconds, setRemainingSeconds] = useState<number>(15 * 60);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [timerTab, setTimerTab] = useState<'SECTION' | 'INTERVAL'>('SECTION');

  // Interval / Circuit Timer state
  const [intervalWorkSec, setIntervalWorkSec] = useState(30);
  const [intervalRestSec, setIntervalRestSec] = useState(15);
  const [intervalRounds, setIntervalRounds] = useState(8);
  const [intervalCurrentRound, setIntervalCurrentRound] = useState(1);
  const [intervalPhase, setIntervalPhase] = useState<'WORK' | 'REST'>('WORK');
  const [intervalSecLeft, setIntervalSecLeft] = useState(30);
  const [intervalRunning, setIntervalRunning] = useState(false);

  // Live Scoreboard state (Team A vs. Team B)
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [teamAName, setTeamAName] = useState('Team A');
  const [teamBName, setTeamBName] = useState('Team B');
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);

  // Interval Stopwatch state
  const [stopwatchSeconds, setStopwatchSeconds] = useState<number>(0);
  const [stopwatchRunning, setStopwatchRunning] = useState<boolean>(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const remainingSecondsRef = useRef<number>(remainingSeconds);
  remainingSecondsRef.current = remainingSeconds;
  const intervalSecLeftRef = useRef<number>(intervalSecLeft);
  intervalSecLeftRef.current = intervalSecLeft;

  function getOrCreateAudioContext(): AudioContext | null {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }

  function unlockAudio() {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  function triggerAlertSignal(high = false) {
    if (soundEnabled) {
      try {
        const ctx = getOrCreateAudioContext();
        if (ctx) {
          if (ctx.state === 'suspended') {
            void ctx.resume();
          }
          const now = ctx.currentTime;
          const playTone = (startOffset: number, freq: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + startOffset);
            gain.gain.setValueAtTime(0.35, now + startOffset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + startOffset);
            osc.stop(now + startOffset + duration);
          };

          if (high) {
            // Double whistle-like beep for work/session end
            playTone(0, 880, 0.22);
            playTone(0.26, 1046.5, 0.35);
          } else {
            // Crisp two-tone signal for transition to rest
            playTone(0, 660, 0.2);
            playTone(0.24, 523.25, 0.28);
          }
        }
      } catch {
        // Ignore audio errors if blocked by browser autoplay policy
      }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(high ? [250, 100, 250] : [200]);
    }
  }

  // Fullscreen Chalkboard modal state
  const [chalkboardOpen, setChalkboardOpen] = useState(false);

  // Quick-Swap panel state
  const [showQuickSwap, setShowQuickSwap] = useState(false);

  // Live Note input state
  const [liveNoteText, setLiveNoteText] = useState('');
  const [liveNoteAuthorId, setLiveNoteAuthorId] = useState<string>(members[0]?.id ?? '');

  // Wake Lock status
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Request Screen Wake Lock on mount
  useEffect(() => {
    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && navigator.wakeLock) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          setWakeLockActive(true);
        }
      } catch {
        setWakeLockActive(false);
      }
    }
    void requestWakeLock();
    return () => {
      if (wakeLockRef.current) {
        void wakeLockRef.current.release();
      }
    };
  }, []);

  // Reset countdown timer whenever active block changes
  useEffect(() => {
    if (activeBlock) {
      setRemainingSeconds((activeBlock.custom_duration_min || 15) * 60);
      setTimerRunning(false);
      setShowQuickSwap(false);
    }
  }, [activeBlock?.id, activeBlock?.custom_duration_min]);

  // Countdown interval
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      const current = remainingSecondsRef.current;
      if (current <= 1) {
        remainingSecondsRef.current = 0;
        setRemainingSeconds(0);
        setTimerRunning(false);
        triggerAlertSignal(true);
      } else {
        remainingSecondsRef.current = current - 1;
        setRemainingSeconds(current - 1);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, soundEnabled]);

  // Interval / Circuit Timer loop
  useEffect(() => {
    if (!intervalRunning) return;
    const id = window.setInterval(() => {
      const current = intervalSecLeftRef.current;
      if (current > 1) {
        intervalSecLeftRef.current = current - 1;
        setIntervalSecLeft(current - 1);
        return;
      }

      if (intervalPhase === 'WORK') {
        if (intervalCurrentRound >= intervalRounds) {
          intervalSecLeftRef.current = 0;
          setIntervalSecLeft(0);
          setIntervalRunning(false);
          triggerAlertSignal(true);
        } else {
          intervalSecLeftRef.current = intervalRestSec;
          setIntervalPhase('REST');
          setIntervalSecLeft(intervalRestSec);
          triggerAlertSignal(false);
        }
      } else {
        intervalSecLeftRef.current = intervalWorkSec;
        setIntervalCurrentRound((r) => r + 1);
        setIntervalPhase('WORK');
        setIntervalSecLeft(intervalWorkSec);
        triggerAlertSignal(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [
    intervalRunning,
    intervalPhase,
    intervalCurrentRound,
    intervalRounds,
    intervalWorkSec,
    intervalRestSec,
    soundEnabled
  ]);

  // Stopwatch interval
  useEffect(() => {
    if (!stopwatchRunning) return;
    const id = window.setInterval(() => {
      setStopwatchSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [stopwatchRunning]);

  // Quick-Swap candidate exercises (Variants first, then matching focus)
  const quickSwapCandidates = useMemo(() => {
    if (!activeExercise) return exercises;
    const rootId = activeExercise.parent_exercise_id ?? activeExercise.id;

    return exercises
      .filter((ex) => ex.id !== activeExercise.id)
      .sort((a, b) => {
        const aIsVariant = a.id === rootId || a.parent_exercise_id === rootId ? 1 : 0;
        const bIsVariant = b.id === rootId || b.parent_exercise_id === rootId ? 1 : 0;
        return bIsVariant - aIsVariant;
      });
  }, [activeExercise, exercises]);

  async function handleQuickSwapExercise(replacementExercise: Exercise) {
    if (!activeBlock) return;
    const updated: SessionBlock = {
      ...activeBlock,
      exercise_id: replacementExercise.id,
      quick_block_title: undefined,
      quick_block_description: undefined,
      custom_duration_min: replacementExercise.default_duration_min,
      updated_at: new Date().toISOString()
    };
    await db.sessionBlocks.put(updated);
    await queueSyncOperation('session_blocks', updated.id, 'UPSERT', updated);
    setShowQuickSwap(false);
  }

  async function handleAddLiveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSession || !activeBlock || !liveNoteText.trim()) return;
    const author = members.find((m) => m.id === liveNoteAuthorId) ?? members[0];
    const now = new Date().toISOString();
    const note: SessionNote = {
      id: crypto.randomUUID(),
      training_session_id: currentSession.id,
      session_block_id: activeBlock.id,
      author_member_id: author?.id,
      author_name: author ? author.display_name.split(' (')[0] : 'Trainer',
      content: liveNoteText.trim(),
      created_at: now,
      updated_at: now
    };
    await db.sessionNotes.put(note);
    await queueSyncOperation('session_notes', note.id, 'UPSERT', note);
    setLiveNoteText('');
  }

  async function handleCompleteTrainingSession() {
    if (!currentSession) return;
    const updated: TrainingSession = {
      ...currentSession,
      status: 'COMPLETED',
      updated_at: new Date().toISOString()
    };
    await db.trainingSessions.put(updated);
    await queueSyncOperation('training_sessions', updated.id, 'UPSERT', updated);
  }

  function toggleMaterialChecked(type: MaterialType) {
    setCheckedMaterials((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  if (!currentSession) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-300">
        Keine Trainingseinheit für den Sporthallen-Modus ausgewählt.
      </div>
    );
  }

  const activeBlockNotes = activeBlock
    ? notes.filter((n) => n.session_block_id === activeBlock.id)
    : [];

  return (
    <div className="space-y-5">
      {/* Top Hall Control Header (High Contrast & Large Touch Targets >= 48px) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={currentSession.id}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setActiveIndex(0);
              }}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-bold text-white"
            >
              {teamSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.status === 'COMPLETED' ? '✓ ' : s.status === 'CANCELLED' ? '[Ausgefallen] ' : ''}
                  {s.session_date} ({s.start_time}–{s.end_time}) · {s.title}
                </option>
              ))}
            </select>

            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <Sun className="h-3.5 w-3.5" />
              {wakeLockActive ? 'Display-WakeLock aktiv' : 'Hallen-Modus aktiv'}
            </span>
          </div>

          {/* Quick Buttons: Material-Packliste, Meine Spur Filter & Training abschließen */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                setSoundEnabled((s) => !s);
              }}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                soundEnabled
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
              title="Audio-/Vibrations-Signal bei Timer-Ablauf"
            >
              {soundEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              <span className="hidden sm:inline">{soundEnabled ? 'Signal an' : 'Stumm'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowScoreboard((s) => !s)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                showScoreboard
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-blue-500/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/50'
              }`}
            >
              <Trophy className="h-4 w-4" />
              Punkte ({scoreA}:{scoreB})
            </button>

            <button
              type="button"
              onClick={() => setShowPackingList((prev) => !prev)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                showPackingList
                  ? 'border-amber-500 bg-amber-500 text-slate-950'
                  : 'border-amber-500/40 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'
              }`}
            >
              <Package className="h-4 w-4" />
              Geräteraum-Packliste ({checkedMaterials.size}/{sessionPackingList.length})
            </button>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5">
              <Filter className="h-3.5 w-3.5 text-blue-400" />
              <select
                value={trackFilter}
                onChange={(e) => {
                  setTrackFilter(e.target.value);
                  setActiveIndex(0);
                }}
                className="bg-transparent text-xs font-bold text-white focus:outline-none"
              >
                <option value="ALL" className="bg-slate-900">
                  Spur: Alle Gruppen ({orderedBlocksWithPhase.length})
                </option>
                {availableTracks.map((tr) => (
                  <option key={tr} value={tr} className="bg-slate-900">
                    Meine Spur: {tr}
                  </option>
                ))}
              </select>
            </div>

            {currentSession.status !== 'COMPLETED' ? (
              <button
                type="button"
                onClick={() => void handleCompleteTrainingSession()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <CheckCircle2 className="h-4 w-4" />
                Training abschließen
              </button>
            ) : (
              <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-950 border border-emerald-500/40 px-3.5 py-2 text-xs font-bold text-emerald-300">
                ✓ Training durchgeführt
              </span>
            )}
          </div>
        </div>

        {/* Live-Punktezähler (Team A vs. Team B) */}
        {showScoreboard && (
          <div className="mt-4 rounded-xl border border-blue-500/40 bg-slate-950 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-blue-300 uppercase">
                Live-Punktezähler (Wettkampf-Spielform)
              </span>
              <button
                type="button"
                onClick={() => {
                  setScoreA(0);
                  setScoreB(0);
                }}
                className="min-h-[36px] rounded-lg bg-slate-800 px-3 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                Reset 0:0
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-950/30 p-3">
                <input
                  type="text"
                  value={teamAName}
                  onChange={(e) => setTeamAName(e.target.value)}
                  className="w-28 rounded bg-transparent text-sm font-bold text-blue-200 focus:bg-slate-900 focus:px-2 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScoreA((s) => Math.max(0, s - 1))}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white hover:bg-slate-700"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[40px] text-center font-mono text-3xl font-black text-white">
                    {scoreA}
                  </span>
                  <button
                    type="button"
                    onClick={() => setScoreA((s) => s + 1)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-500"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-950/30 p-3">
                <input
                  type="text"
                  value={teamBName}
                  onChange={(e) => setTeamBName(e.target.value)}
                  className="w-28 rounded bg-transparent text-sm font-bold text-rose-200 focus:bg-slate-900 focus:px-2 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScoreB((s) => Math.max(0, s - 1))}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white hover:bg-slate-700"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[40px] text-center font-mono text-3xl font-black text-white">
                    {scoreB}
                  </span>
                  <button
                    type="button"
                    onClick={() => setScoreB((s) => s + 1)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white hover:bg-rose-500"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Equipment Room Packing Checklist */}
        {showPackingList && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-slate-950 p-4">
            <div className="mb-2.5 text-xs font-bold text-amber-300 uppercase">
              Vor Trainingsbeginn aus dem Geräteraum holen (Antippen zum Abhaken):
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              {sessionPackingList.map((item) => {
                const isChecked = checkedMaterials.has(item.type);
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => toggleMaterialChecked(item.type)}
                    className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3.5 py-2 text-left text-xs font-semibold transition ${
                      isChecked
                        ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300 line-through'
                        : 'border-slate-800 bg-slate-900 text-white hover:border-slate-700'
                    }`}
                  >
                    <span>{MATERIAL_LABELS[item.type]}</span>
                    <span className="rounded-lg bg-slate-800 px-2 py-0.5 font-bold text-amber-300">
                      {item.quantity}x
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Timer & Step Navigation Bar (Touch-Optimized >= 48px) */}
      {activeBlock && activePhase && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Countdown Timer / Interval Timer Switchable Card (8 Cols) */}
          <div
            className={`rounded-2xl border p-5 lg:col-span-8 space-y-4 ${
              (timerTab === 'SECTION' && remainingSeconds === 0) ||
              (timerTab === 'INTERVAL' && intervalSecLeft === 0)
                ? 'border-rose-500 bg-rose-950/40'
                : (timerTab === 'SECTION' && timerRunning) ||
                    (timerTab === 'INTERVAL' && intervalRunning)
                  ? 'border-emerald-500/70 bg-emerald-950/20'
                  : 'border-slate-800 bg-slate-900'
            }`}
          >
            {/* Timer Mode Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTimerTab('SECTION')}
                  className={`min-h-[36px] rounded-lg px-3 font-bold transition ${
                    timerTab === 'SECTION'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Abschnitts-Timer
                </button>
                <button
                  type="button"
                  onClick={() => setTimerTab('INTERVAL')}
                  className={`min-h-[36px] rounded-lg px-3 font-bold transition ${
                    timerTab === 'INTERVAL'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Intervall / Zirkel
                </button>
              </div>

              {timerTab === 'INTERVAL' && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {[
                    { label: 'Tabata 20/10×8', w: 20, r: 10, n: 8 },
                    { label: '30/15×8', w: 30, r: 15, n: 8 },
                    { label: '45/15×6', w: 45, r: 15, n: 6 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setIntervalRunning(false);
                        setIntervalWorkSec(preset.w);
                        setIntervalRestSec(preset.r);
                        setIntervalRounds(preset.n);
                        setIntervalCurrentRound(1);
                        setIntervalPhase('WORK');
                        setIntervalSecLeft(preset.w);
                      }}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 font-semibold text-amber-300 hover:bg-slate-700"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {timerTab === 'SECTION' ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="font-mono text-4xl font-black tracking-tight text-white sm:text-5xl">
                    {formatSeconds(remainingSeconds)}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-blue-400 uppercase">
                      Abschnitt {activeIndex + 1} / {visibleBlocksWithPhase.length} · {activePhase.name}
                    </div>
                    <div className="text-sm font-bold text-white">
                      {activeBlock.track_label} ({activeBlock.custom_duration_min} Min geplant)
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudio();
                      setTimerRunning((prev) => !prev);
                    }}
                    className={`inline-flex min-h-[48px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition ${
                      timerRunning
                        ? 'bg-amber-600 hover:bg-amber-500'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    {timerRunning ? (
                      <>
                        <Pause className="h-4 w-4" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Timer Start
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setRemainingSeconds((prev) => prev + 60)}
                    className="min-h-[48px] rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-700"
                  >
                    +1 Min
                  </button>

                  <button
                    type="button"
                    onClick={() => setRemainingSeconds((prev) => prev + 120)}
                    className="min-h-[48px] rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-700"
                  >
                    +2 Min
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTimerRunning(false);
                      setRemainingSeconds((activeBlock.custom_duration_min || 15) * 60);
                    }}
                    className="min-h-[48px] rounded-xl bg-slate-800 p-3 text-slate-300 hover:bg-slate-700"
                    title="Timer zurücksetzen"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-4xl font-black tracking-tight text-white sm:text-5xl">
                      {formatSeconds(intervalSecLeft)}
                    </div>
                    <div>
                      <span
                        className={`inline-block rounded-lg px-2.5 py-0.5 text-xs font-extrabold uppercase ${
                          intervalPhase === 'WORK'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-500 text-slate-950'
                        }`}
                      >
                        {intervalPhase === 'WORK' ? 'Belastung' : 'Pause'}
                      </span>
                      <div className="mt-1 text-sm font-bold text-white">
                        Runde {intervalCurrentRound} / {intervalRounds}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        unlockAudio();
                        setIntervalRunning((p) => !p);
                      }}
                      className={`inline-flex min-h-[48px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white ${
                        intervalRunning
                          ? 'bg-amber-600 hover:bg-amber-500'
                          : 'bg-emerald-600 hover:bg-emerald-500'
                      }`}
                    >
                      {intervalRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      {intervalRunning ? 'Pause' : 'Intervall Start'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIntervalRunning(false);
                        setIntervalCurrentRound(1);
                        setIntervalPhase('WORK');
                        setIntervalSecLeft(intervalWorkSec);
                      }}
                      className="min-h-[48px] rounded-xl bg-slate-800 p-3 text-slate-300 hover:bg-slate-700"
                      title="Intervall zurücksetzen"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                  <label className="flex items-center gap-1.5">
                    Belastung (s):
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={intervalWorkSec}
                      onChange={(e) => {
                        const v = Math.max(5, Number(e.target.value) || 30);
                        setIntervalWorkSec(v);
                        if (!intervalRunning && intervalPhase === 'WORK') setIntervalSecLeft(v);
                      }}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-center font-bold text-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Pause (s):
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={intervalRestSec}
                      onChange={(e) => {
                        const v = Math.max(5, Number(e.target.value) || 15);
                        setIntervalRestSec(v);
                        if (!intervalRunning && intervalPhase === 'REST') setIntervalSecLeft(v);
                      }}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-center font-bold text-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Runden:
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={intervalRounds}
                      onChange={(e) => setIntervalRounds(Math.max(1, Number(e.target.value) || 8))}
                      className="w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-center font-bold text-white"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Interval Stopwatch & Prev/Next Block Step Controls (4 Cols) */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-300">Intervall-Stoppuhr:</span>
                <span className="font-mono text-lg font-black text-amber-300">
                  {formatSeconds(stopwatchSeconds)}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setStopwatchRunning((prev) => !prev)}
                  className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-700"
                >
                  {stopwatchRunning ? 'Stopp' : 'Start'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStopwatchRunning(false);
                    setStopwatchSeconds(0);
                  }}
                  className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-white"
                >
                  00:00
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeIndex <= 0}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Vorherige
              </button>
              <button
                type="button"
                disabled={activeIndex >= visibleBlocksWithPhase.length - 1}
                onClick={() =>
                  setActiveIndex((i) => Math.min(visibleBlocksWithPhase.length - 1, i + 1))
                }
                className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Nächste Übung
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kompakte „Als Nächstes“-Vorschau */}
      {(() => {
        const nextItem = visibleBlocksWithPhase[activeIndex + 1];
        if (!nextItem) return null;
        const nextEx = nextItem.block.exercise_id
          ? exercisesById.get(nextItem.block.exercise_id)
          : undefined;
        const nextTitle =
          nextEx?.title ?? nextItem.block.quick_block_title ?? 'Nächster Trainingsblock';
        const nextMaterials = nextEx?.materials ?? [];
        return (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-800 px-2 py-0.5 font-bold text-amber-300 uppercase">
                Als Nächstes
              </span>
              <span className="font-bold text-white">{nextTitle}</span>
              <span className="text-slate-400">
                ({nextItem.block.custom_duration_min} Min · {nextItem.phase.name})
              </span>
            </div>
            {nextMaterials.length > 0 && (
              <div className="text-slate-300">
                Material:{' '}
                {nextMaterials
                  .map((m) => `${m.quantity}× ${MATERIAL_LABELS[m.type]}`)
                  .join(', ')}
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Hall Split-View: Left TacticBoard + Fullscreen Chalkboard Trigger | Right Coaching Points, Quick-Swap & Live Notes */}
      {activeBlock && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left (7 Cols): Large TacticBoard & Fullscreen Chalkboard Button */}
          <div className="space-y-4 lg:col-span-7">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="rounded bg-blue-950 px-2.5 py-1 text-xs font-bold text-blue-300">
                    {activeBlock.track_label}
                  </span>
                  <h2 className="mt-1.5 text-xl font-black text-white lg:text-2xl">
                    {activeExercise
                      ? activeExercise.title
                      : activeBlock.quick_block_title ?? 'Freier Trainingsblock'}
                  </h2>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuickSwap((prev) => !prev)}
                    className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-950/50 px-3.5 py-2 text-xs font-bold text-blue-200 hover:bg-blue-900/60"
                  >
                    <RefreshCw className="h-4 w-4 text-blue-400" />
                    Übung tauschen (Quick-Swap)
                  </button>

                  <button
                    type="button"
                    onClick={() => setChalkboardOpen(true)}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400"
                  >
                    <Maximize2 className="h-4 w-4" />
                    Vollbild & Live-Zeichenstift
                  </button>
                </div>
              </div>

              {/* Quick-Swap Selection Sheet */}
              {showQuickSwap && (
                <div className="rounded-xl border border-blue-500/50 bg-slate-950 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-300 uppercase">
                      Spontan in der Halle tauschen (Varianten zuerst vorgeschlagen):
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQuickSwap(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Schließen
                    </button>
                  </div>
                  <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                    {quickSwapCandidates.map((cand) => {
                      const isVariant =
                        activeExercise &&
                        (cand.parent_exercise_id === activeExercise.id ||
                          activeExercise.parent_exercise_id === cand.id);
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => void handleQuickSwapExercise(cand)}
                          className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-3 text-left hover:border-blue-500"
                        >
                          <div>
                            {isVariant && (
                              <span className="mb-1 inline-flex items-center gap-1 rounded bg-blue-950 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                                <GitBranch className="h-3 w-3" />
                                Direkte Variante
                              </span>
                            )}
                            <div className="font-bold text-white text-xs">{cand.title}</div>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {cand.default_duration_min} Min · {cand.min_players}–{cand.max_players}{' '}
                            Sp. + {cand.goalkeepers} TW
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Large TacticBoard / Reference Image */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Taktiktafel
                    </span>
                    {activeExercise &&
                      (hasExplicitTacticAnimation(activeExercise.tactic_board_data) ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                          <Film className="h-3 w-3" />
                          Animation vorhanden ({activeExercise.tactic_board_data?.keyframes?.length ?? 0} Szenen)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                          <Film className="h-3 w-3" />
                          Keine Animation
                        </span>
                      ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setChalkboardOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-950/50 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-900/60"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    Vollbild & Live-Stift
                  </button>
                </div>
                {activeExercise?.reference_image_data && !activeExercise.tactic_board_data ? (
                  <img
                    src={activeExercise.reference_image_data}
                    alt={activeExercise.title}
                    onClick={() => setChalkboardOpen(true)}
                    className="mx-auto max-h-96 cursor-pointer rounded-xl border border-slate-700 object-contain"
                  />
                ) : (
                  <TacticBoardPreview data={activeExercise?.tactic_board_data} />
                )}
              </div>
            </div>
          </div>

          {/* Right (5 Cols): High-Contrast Coaching Points, Flow & Conflict-Free Live Notes */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-2xl border border-amber-500/30 bg-slate-900 p-5">
              <h3 className="text-xs font-bold tracking-wider text-amber-400 uppercase">
                Coaching-Punkte & Korrekturen (Hallen-Fokus)
              </h3>
              <p className="mt-2 text-base leading-relaxed font-medium text-white whitespace-pre-line">
                {activeExercise?.coaching_points ||
                  'Fokus auf hohes Tempo, saubere Passqualität und laute Absprache.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-xs font-bold tracking-wider text-blue-400 uppercase">
                Übungsablauf & Aufbau
              </h3>
              {activeExercise?.setup_description && (
                <p className="mt-2 text-xs text-slate-300 whitespace-pre-line">
                  <strong className="text-white">Aufbau:</strong> {activeExercise.setup_description}
                </p>
              )}
              <p className="mt-2 text-sm leading-relaxed text-slate-100 whitespace-pre-line">
                {activeExercise
                  ? activeExercise.flow_description
                  : activeBlock.quick_block_description || 'Freier Trainingsabschnitt'}
              </p>
            </div>

            {/* Conflict-Free Live Coach Notes */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase">
                <MessageSquarePlus className="h-4 w-4 text-emerald-400" />
                Live-Notizen aus der Sporthalle ({activeBlockNotes.length})
              </div>

              <div className="space-y-2">
                {activeBlockNotes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200"
                  >
                    <div className="flex items-center justify-between text-[11px] text-amber-400 font-bold">
                      <span>{note.author_name}</span>
                      <span className="text-slate-500">
                        {new Date(note.created_at).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <p className="mt-1">{note.content}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddLiveNote} className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <select
                    value={liveNoteAuthorId}
                    onChange={(e) => setLiveNoteAuthorId(e.target.value)}
                    className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
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
                    placeholder="Notiz für nächstes Training erfassen..."
                    value={liveNoteText}
                    onChange={(e) => setLiveNoteText(e.target.value)}
                    className="min-h-[44px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-xl bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-500"
                >
                  Live-Notiz speichern (konfliktfrei pro Trainer)
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Strip of all Sections at Bottom */}
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-3">
        {visibleBlocksWithPhase.map((item, idx) => {
          const isCurrent = idx === activeIndex;
          const ex = item.block.exercise_id ? exercisesById.get(item.block.exercise_id) : undefined;
          return (
            <button
              key={item.block.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`min-w-[180px] shrink-0 rounded-xl border p-3 text-left transition ${
                isCurrent
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="font-bold text-blue-400">#{idx + 1}</span>
                <span>
                  <Clock className="inline h-3 w-3 mr-0.5" />
                  {item.block.custom_duration_min}m
                </span>
              </div>
              <div className="mt-1 truncate text-xs font-bold text-white">
                {ex ? ex.title : item.block.quick_block_title ?? 'Block'}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                {item.block.track_label}
              </div>
            </button>
          );
        })}
      </div>

      <FullScreenChalkboardModal
        isOpen={chalkboardOpen}
        title={
          activeExercise
            ? activeExercise.title
            : activeBlock?.quick_block_title ?? 'Taktiktafel'
        }
        coachingPoints={activeExercise?.coaching_points}
        tacticBoardData={activeExercise?.tactic_board_data}
        referenceImageData={activeExercise?.reference_image_data}
        onClose={() => setChalkboardOpen(false)}
      />
    </div>
  );
}
