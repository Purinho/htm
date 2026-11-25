import { useEffect, useState } from 'react';
import { Bot, Check, Copy, FileCode2, Sparkles, Upload, X } from 'lucide-react';
import type { Exercise, VisibilityLevel } from '../types/domain';
import {
  AI_EXERCISE_SYSTEM_PROMPT,
  parseAndNormalizeAiExerciseJson
} from '../utils/aiExerciseImport';
import { TacticBoardPreview } from './TacticBoardPreview';

interface AiExerciseImporterModalProps {
  isOpen: boolean;
  clubId: string;
  activeTeamId: string;
  canCreateTeamExercise?: boolean;
  currentMemberId?: string;
  onClose: () => void;
  onImportExercises: (exercises: Exercise[]) => Promise<void>;
}

const SAMPLE_AI_JSON = `[
  {
    "title": "Kreuzen RM-RL mit Sperre-Absetzen am Kreis gegen 6:0",
    "default_duration_min": 20,
    "min_players": 7,
    "max_players": 14,
    "goalkeepers": 1,
    "source_url": "https://www.dhb.de/de/training/rahmentrainingskonzeption",
    "categories": {
      "phases": ["GROUND_EXERCISE", "GROUND_GAME"],
      "focus": ["OFFENSE_GROUP", "DEFENSE_6_0"],
      "level": "ADVANCED",
      "age_groups": ["C_YOUTH", "B_YOUTH", "A_YOUTH", "ADULTS"]
    },
    "materials": [
      { "type": "BALL", "quantity": 6 },
      { "type": "CONE", "quantity": 4 }
    ],
    "setup_description": "Halbfeld: RM und RL mit Anstellreihen, KM am 6m-Kreis gegen Innenblock IL und IR.",
    "flow_description": "1. RM läuft nach links an und bindet IL.\\n2. RL kreuzt hinter RM in die entstehende Lücke vor IR.\\n3. Gleichzeitig stellt KM eine Sperre an IR und setzt sich zum Tor ab.",
    "coaching_points": "- RM muss echte Torgefahr in die Nahtstelle ausstrahlen\\n- Timing beim Kreuzen: Ballübergabe auf Brusthöhe\\n- KM hält die Sperre bis RL auf Ballhöhe ist",
    "variations_text": "Erweiterung: Mit Hinzunahme von RR als Weiterleitungs-Option bei helfendem HR.",
    "tactic_board_data": {
      "version": 1,
      "courtTemplate": "HALF_COURT_VERTICAL",
      "nodes": [
        { "id": "tw", "type": "GOALKEEPER", "label": "TW", "x": 0.50, "y": 0.08, "color": "#10b981" },
        { "id": "rm", "type": "OFFENSE_PLAYER", "label": "RM", "x": 0.50, "y": 0.52, "hasBall": true },
        { "id": "rl", "type": "OFFENSE_PLAYER", "label": "RL", "x": 0.24, "y": 0.48, "isQueue": true, "queueCount": 3 },
        { "id": "km", "type": "OFFENSE_PLAYER", "label": "KM", "x": 0.56, "y": 0.23 },
        { "id": "il", "type": "DEFENSE_PLAYER", "label": "IL", "x": 0.42, "y": 0.25 },
        { "id": "ir", "type": "DEFENSE_PLAYER", "label": "IR", "x": 0.58, "y": 0.25 },
        { "id": "wp1", "type": "WAYPOINT", "x": 0.38, "y": 0.40 }
      ],
      "paths": [
        {
          "id": "p1",
          "type": "RUN_PATH",
          "stepNumber": 1,
          "fromNodeId": "rm",
          "toWaypointId": "wp1",
          "points": [{ "x": 0.50, "y": 0.52 }, { "x": 0.38, "y": 0.40 }]
        },
        {
          "id": "p2",
          "type": "RUN_PATH",
          "stepNumber": 2,
          "fromNodeId": "rl",
          "points": [{ "x": 0.24, "y": 0.48 }, { "x": 0.52, "y": 0.36 }]
        },
        {
          "id": "p3",
          "type": "SCREEN_BLOCK_PATH",
          "stepNumber": 3,
          "fromNodeId": "km",
          "points": [{ "x": 0.56, "y": 0.23 }, { "x": 0.58, "y": 0.25 }]
        }
      ]
    }
  }
]`;

export function AiExerciseImporterModal({
  isOpen,
  clubId,
  activeTeamId,
  canCreateTeamExercise = true,
  currentMemberId,
  onClose,
  onImportExercises
}: AiExerciseImporterModalProps) {
  const [activeTab, setActiveTab] = useState<'IMPORT' | 'PROMPT'>('IMPORT');
  const [jsonInput, setJsonInput] = useState('');
  const [visibility, setVisibility] = useState<VisibilityLevel>('CLUB');
  const [autoGenerateAnimation, setAutoGenerateAnimation] = useState(true);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewList, setPreviewList] = useState<Exercise[]>([]);

  useEffect(() => {
    if (!canCreateTeamExercise && visibility === 'TEAM') {
      setVisibility('CLUB');
    }
  }, [canCreateTeamExercise, visibility]);

  if (!isOpen) return null;

  function handleValidateAndPreview(inputText: string, autoAnim = autoGenerateAnimation) {
    setJsonInput(inputText);
    if (!inputText.trim()) {
      setPreviewList([]);
      setErrorMsg(null);
      return;
    }
    const effectiveVisibility: VisibilityLevel =
      !canCreateTeamExercise && visibility === 'TEAM' ? 'CLUB' : visibility;
    try {
      const parsed = parseAndNormalizeAiExerciseJson(
        inputText,
        clubId,
        effectiveVisibility,
        activeTeamId,
        autoAnim,
        currentMemberId
      );
      setPreviewList(parsed);
      setErrorMsg(null);
    } catch (err) {
      setPreviewList([]);
      setErrorMsg(err instanceof Error ? err.message : 'Ungültiges JSON');
    }
  }

  async function handleCopySystemPrompt() {
    try {
      await navigator.clipboard.writeText(AI_EXERCISE_SYSTEM_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch {
      // Fallback ignored
    }
  }

  async function handleConfirmImport() {
    if (previewList.length === 0) return;
    await onImportExercises(previewList);
    setJsonInput('');
    setPreviewList([]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm lg:p-6">
      <div className="my-auto flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/20 text-purple-400">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold tracking-wider text-purple-400 uppercase">
                KI-Übungs-Konverter & Massen-Import
              </span>
              <h2 className="text-lg font-bold text-white">
                Web-Übungen, PDFs & Screenshots per KI in App-Übungen + Taktikboard umwandeln
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-2.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('IMPORT')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'IMPORT'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              1. KI-JSON einfügen & mit Vorschau importieren
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PROMPT')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'PROMPT'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              2. KI-System-Prompt für Gemini / ChatGPT / Claude kopieren
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setActiveTab('IMPORT');
              handleValidateAndPreview(SAMPLE_AI_JSON);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-950/40 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-900/50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Beispiel-KI-Übung laden
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'PROMPT' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/30 bg-purple-950/20 p-4">
                <div className="text-xs text-slate-200 space-y-1">
                  <div className="font-bold text-white">
                    So wandelst du jede Übung (inkl. Zeichnung!) aus dem Web kostenlos um:
                  </div>
                  <p className="text-slate-300">
                    1. Kopiere diesen System-Prompt in Gemini, ChatGPT oder Claude.<br />
                    2. Lade dort einen Screenshot einer Übungszeichnung, ein PDF-Skript oder einen Web-Link hoch.<br />
                    3. Füge die JSON-Antwort der KI im Reiter <strong>„KI-JSON einfügen"</strong> ein – fertig!
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopySystemPrompt}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="h-4 w-4" />
                      Prompt kopiert!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      KI-System-Prompt kopieren
                    </>
                  )}
                </button>
              </div>

              <pre className="max-h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
                {AI_EXERCISE_SYSTEM_PROMPT}
              </pre>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left: JSON Input */}
              <div className="space-y-3 lg:col-span-5">
                <label className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoGenerateAnimation}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAutoGenerateAnimation(next);
                      if (jsonInput.trim()) {
                        handleValidateAndPreview(jsonInput, next);
                      }
                    }}
                    className="h-4 w-4 rounded accent-emerald-500"
                  />
                  Nummerierte Schritte automatisch als Animation importieren
                </label>

                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Von der KI generiertes JSON hier einfügen:
                  </label>
                  <select
                    value={visibility}
                    onChange={(e) => {
                      const requestedVis = e.target.value as VisibilityLevel;
                      const nextVis: VisibilityLevel =
                        !canCreateTeamExercise && requestedVis === 'TEAM' ? 'CLUB' : requestedVis;
                      setVisibility(nextVis);
                      if (jsonInput.trim()) {
                        try {
                          setPreviewList(
                            parseAndNormalizeAiExerciseJson(
                              jsonInput,
                              clubId,
                              nextVis,
                              activeTeamId,
                              autoGenerateAnimation,
                              currentMemberId
                            )
                          );
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white"
                  >
                    <option value="CLUB">Import als: Vereinsweit (CLUB)</option>
                    <option value="TEAM" disabled={!canCreateTeamExercise}>
                      Import als: Nur mein Team (TEAM)
                    </option>
                  </select>
                </div>

                <textarea
                  rows={14}
                  placeholder='Füge hier das JSON-Objekt { "title": "..." } oder Array [ ... ] aus der KI ein...'
                  value={jsonInput}
                  onChange={(e) => handleValidateAndPreview(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-emerald-300 focus:border-purple-500 focus:outline-none"
                />

                {errorMsg && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-300">
                    {errorMsg}
                  </div>
                )}
              </div>

              {/* Right: Live Preview of recognized exercises & TacticBoard */}
              <div className="space-y-4 lg:col-span-7">
                <div className="text-xs font-semibold text-slate-300">
                  Live-Vorschau der erkannten Übungen ({previewList.length}):
                </div>

                {previewList.length === 0 ? (
                  <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
                    <Bot className="mb-2 h-8 w-8 text-slate-600" />
                    <p>
                      Füge links ein JSON ein oder klicke oben rechts auf{' '}
                      <strong>„Beispiel-KI-Übung laden"</strong>, um die automatische Taktikboard-Generierung zu sehen.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                    {previewList.map((ex, i) => (
                      <div
                        key={ex.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-sm">
                            {i + 1}. {ex.title}
                          </span>
                          <span className="rounded bg-purple-950 px-2 py-0.5 text-xs text-purple-300">
                            {ex.default_duration_min} Min · {ex.min_players}–{ex.max_players} Sp.
                          </span>
                        </div>

                        <TacticBoardPreview data={ex.tactic_board_data} />

                        <p className="text-xs text-slate-300 whitespace-pre-line">
                          {ex.flow_description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Schließen
          </button>
          {activeTab === 'IMPORT' && (
            <button
              type="button"
              disabled={previewList.length === 0}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-5 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
              {previewList.length} Übung(en) in Katalog importieren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
