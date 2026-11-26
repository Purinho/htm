import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  Sparkles,
  X
} from 'lucide-react';
import {
  ALL_FEATURES_ENABLED,
  UI_FEATURE_DEFINITIONS,
  UI_PRESETS,
  applyUiPreset,
  countEnabledFeatures,
  toggleUiFeature,
  type UiFeatureKey,
  type UiPreferences,
  type UiPresetKey
} from '../utils/uiPreferences';

interface UiConfigTourModalProps {
  isOpen: boolean;
  initialPreferences: UiPreferences;
  onComplete: (nextPreferences: UiPreferences) => void;
  onSkip: () => void;
}

const STEP_TITLES = [
  '1. Dein Trainer-Profil',
  '2. Halle, Planung & Ausdruck',
  '3. Übungsdatenbank & Taktik',
  '4. Verein, Backup & Zusammenfassung'
];

interface TourQuestion {
  key: UiFeatureKey;
  question: string;
  hint: string;
}

const STEP_2_QUESTIONS: TourQuestion[] = [
  {
    key: 'hallLiveMode',
    question: 'Nutzt du Handy oder Tablet direkt in der Sporthalle?',
    hint: 'Aktiviert den Sporthallen-Modus mit Live-Timer, Punktzähler und digitaler Taktiktafel.'
  },
  {
    key: 'multiWeekPlans',
    question: 'Planst du Trainingsinhalte über mehrere Wochen voraus?',
    hint: 'Aktiviert den Mehrwochenplan (Mesozyklus) mit Wochen-Schwerpunkten.'
  },
  {
    key: 'printExport',
    question: 'Druckst du Trainingspläne oder Übungskarten für das Klemmbrett aus?',
    hint: 'Zeigt „PDF / Drucken“-Buttons im Trainingsplaner und in den Übungen.'
  }
];

const STEP_3_QUESTIONS: TourQuestion[] = [
  {
    key: 'aiImport',
    question: 'Möchtest du Übungen per KI / ChatGPT (JSON-Import) hinzufügen?',
    hint: 'Zeigt den „KI-JSON Import“-Button zum schnellen Import aus Texten oder PDFs.'
  },
  {
    key: 'tacticAnimation',
    question: 'Möchtest du animierte Spielzüge auf dem Taktikboard abspielen?',
    hint: 'Aktiviert Play/Pause und Schritt-Animationen (sonst nur kompakte Skizze).'
  },
  {
    key: 'advancedFilters',
    question: 'Brauchst du detaillierte Filter (Altersstufe, Fokus, Level, Spielerzahl)?',
    hint: 'Wenn deaktiviert, bleibt die Übungssuche auf die schnelle Textsuche reduziert.'
  },
  {
    key: 'exerciseVariants',
    question: 'Erstellst du eigene Varianten bestehender Übungen?',
    hint: 'Zeigt den „Variante“-Button in der Übungsdetail-Ansicht.'
  },
  {
    key: 'favorites',
    question: 'Möchtest du Lieblingsübungen mit einem Stern markieren?',
    hint: 'Zeigt Favoriten-Sterne und den Schnellfilter „Favoriten“.'
  }
];

const STEP_4_QUESTIONS: TourQuestion[] = [
  {
    key: 'clubAdmin',
    question: 'Verwaltest du mehrere Mannschaften oder Trainerkollegen im Verein?',
    hint: 'Aktiviert den Bereich „Verein, Teams & Trainer“.'
  },
  {
    key: 'backupExport',
    question: 'Möchtest du einen direkten Button für JSON-Vollbackups sehen?',
    hint: 'Zeigt den „Backup“-Export-Button in der Seitenleiste.'
  }
];

export function UiConfigTourModal({
  isOpen,
  initialPreferences,
  onComplete,
  onSkip
}: UiConfigTourModalProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<UiPreferences>(initialPreferences);

  if (!isOpen) return null;

  const activeCount = countEnabledFeatures(draft.features);
  const totalCount = UI_FEATURE_DEFINITIONS.length;

  function handleSelectPreset(preset: Exclude<UiPresetKey, 'CUSTOM'>) {
    setDraft((prev) => applyUiPreset(prev, preset));
  }

  function handleToggle(key: UiFeatureKey) {
    setDraft((prev) => toggleUiFeature(prev, key));
  }

  function handleFinish() {
    onComplete({
      ...draft,
      tourCompleted: true,
      updatedAt: new Date().toISOString()
    });
  }

  function handleSkipAll() {
    onComplete({
      ...draft,
      features: { ...ALL_FEATURES_ENABLED },
      activePreset: 'PRO',
      tourCompleted: true,
      updatedAt: new Date().toISOString()
    });
    onSkip();
  }

  function renderQuestionList(questions: TourQuestion[]) {
    return (
      <div className="space-y-2.5">
        {questions.map((q) => {
          const enabled = draft.features[q.key];
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => handleToggle(q.key)}
              className={`flex w-full items-center justify-between gap-4 rounded-xl border p-3.5 text-left transition ${
                enabled
                  ? 'border-blue-500/60 bg-blue-950/35'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="text-xs font-bold text-white">{q.question}</div>
                <p className="mt-0.5 text-[11px] text-slate-400">{q.hint}</p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  enabled
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {enabled ? (
                  <>
                    <Check className="h-3 w-3" /> Aktiv
                  </>
                ) : (
                  'Aus'
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="border-b border-slate-800 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-indigo-300">
                <Compass className="h-4 w-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Einrichtungs-Assistent · {STEP_TITLES[step]}
                </span>
              </div>
              <h2 className="mt-1 text-lg font-bold text-white">
                Deine App passend einrichten
              </h2>
            </div>
            <button
              type="button"
              onClick={handleSkipAll}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="Tour überspringen"
              aria-label="Schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Step progress bar */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {STEP_TITLES.map((title, idx) => (
              <div
                key={title}
                className={`h-1.5 rounded-full transition-colors ${
                  idx <= step ? 'bg-blue-500' : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-300">
                Wähle zuerst ein Ausgangsprofil, das am besten zu dir passt. In den nächsten 3
                Schritten kannst du einzelne Funktionen gezielt an- oder abschalten.
              </p>
              <div className="space-y-2.5">
                {(['MINIMAL', 'STANDARD', 'PRO'] as const).map((presetKey) => {
                  const preset = UI_PRESETS[presetKey];
                  const selected = draft.activePreset === presetKey;
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      onClick={() => handleSelectPreset(presetKey)}
                      className={`flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition ${
                        selected
                          ? 'border-blue-500 bg-blue-950/50 ring-1 ring-blue-500/40'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{preset.label}</span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                            {preset.badge}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{preset.subtitle}</p>
                      </div>
                      {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && renderQuestionList(STEP_2_QUESTIONS)}
          {step === 2 && renderQuestionList(STEP_3_QUESTIONS)}
          {step === 3 && (
            <div className="space-y-4">
              {renderQuestionList(STEP_4_QUESTIONS)}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200">
                <div className="flex items-center gap-2 font-bold">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  Bereit! {activeCount} von {totalCount} Zusatzfunktionen aktiviert.
                </div>
                <p className="mt-1 text-[11px] text-emerald-300/80">
                  Du kannst jede Funktion später jederzeit über „UI anpassen“ in der Seitenleiste
                  oder Topbar wieder ein- oder ausblenden.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={handleSkipAll}
            className="text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            Überspringen (Alles aktiv)
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Zurück
              </button>
            )}

            {step < STEP_TITLES.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500"
              >
                Weiter
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Check className="h-4 w-4" />
                Konfiguration übernehmen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
