import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  Copy,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type { Exercise, SessionTemplate, SessionTemplatePhase } from '../types/domain';
import {
  calculateTemplateTotalDuration,
  createBlankSessionTemplateDraft,
  duplicateSessionTemplate,
  moveTemplatePhase,
  normalizeSessionTemplateDraft,
  sortSessionTemplates
} from '../utils/sessionTemplateUtils';

interface SessionTemplateManagerModalProps {
  isOpen: boolean;
  clubId: string;
  templates: SessionTemplate[];
  exercises: Exercise[];
  initialDraft?: SessionTemplate | null;
  canManageTemplates?: boolean;
  onSaveTemplate: (template: SessionTemplate) => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onClose: () => void;
}

function cloneTemplate(tpl: SessionTemplate): SessionTemplate {
  return {
    ...tpl,
    phases_template: tpl.phases_template.map((phase) => ({ ...phase }))
  };
}

export function SessionTemplateManagerModal({
  isOpen,
  clubId,
  templates,
  exercises,
  initialDraft,
  canManageTemplates = true,
  onSaveTemplate,
  onDeleteTemplate,
  onClose
}: SessionTemplateManagerModalProps) {
  const sortedTemplates = useMemo(() => sortSessionTemplates(templates), [templates]);
  const sortedExercises = useMemo(
    () =>
      exercises
        .filter((ex) => !ex.is_deleted)
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' })),
    [exercises]
  );
  const exercisesById = useMemo(
    () => new Map(exercises.map((ex) => [ex.id, ex])),
    [exercises]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState<SessionTemplate | null>(null);
  const [isFromSessionDraft, setIsFromSessionDraft] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setConfirmDeleteId(null);
    setErrorMsg(null);
    setStatusBanner(null);

    if (initialDraft) {
      setDraft(cloneTemplate(initialDraft));
      setIsFromSessionDraft(true);
    } else if (sortedTemplates.length > 0) {
      setDraft(cloneTemplate(sortedTemplates[0]));
      setIsFromSessionDraft(false);
    } else {
      setDraft(null);
      setIsFromSessionDraft(false);
    }
    // Intentionally reset editor state when modal opens or receives a new initialDraft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialDraft]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedTemplates;
    return sortedTemplates.filter(
      (tpl) =>
        tpl.title.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q)
    );
  }, [sortedTemplates, searchQuery]);

  if (!isOpen) return null;

  const isExistingTemplate = Boolean(draft && templates.some((t) => t.id === draft.id));
  const totalDurationMin = draft ? calculateTemplateTotalDuration(draft.phases_template) : 0;

  function handleSelectTemplate(tpl: SessionTemplate) {
    setDraft(cloneTemplate(tpl));
    setIsFromSessionDraft(false);
    setConfirmDeleteId(null);
    setErrorMsg(null);
    setStatusBanner(null);
  }

  function handleCreateNewDraft() {
    if (!canManageTemplates) return;
    setDraft(createBlankSessionTemplateDraft(clubId));
    setIsFromSessionDraft(false);
    setConfirmDeleteId(null);
    setErrorMsg(null);
    setStatusBanner(null);
  }

  function handleDuplicateCurrent() {
    if (!canManageTemplates || !draft) return;
    setDraft(duplicateSessionTemplate(draft, clubId));
    setIsFromSessionDraft(false);
    setConfirmDeleteId(null);
    setErrorMsg(null);
    setStatusBanner('Kopie erstellt – passe die Vorlage an und speichere sie.');
  }

  function updatePhaseAt(index: number, patch: Partial<SessionTemplatePhase>) {
    if (!canManageTemplates || !draft) return;
    const nextPhases = draft.phases_template.map((phase, idx) =>
      idx === index ? { ...phase, ...patch } : phase
    );
    setDraft({ ...draft, phases_template: nextPhases });
  }

  function handleMovePhase(index: number, direction: 'UP' | 'DOWN') {
    if (!canManageTemplates || !draft) return;
    setDraft({
      ...draft,
      phases_template: moveTemplatePhase(draft.phases_template, index, direction)
    });
  }

  function handleAddPhase() {
    if (!canManageTemplates || !draft) return;
    setDraft({
      ...draft,
      phases_template: [
        ...draft.phases_template,
        { name: `${draft.phases_template.length + 1}. Neue Phase`, target_duration_min: 15 }
      ]
    });
  }

  function handleRemovePhase(index: number) {
    if (!canManageTemplates || !draft || draft.phases_template.length <= 1) return;
    setDraft({
      ...draft,
      phases_template: draft.phases_template.filter((_, idx) => idx !== index)
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageTemplates || !draft || isSaving) return;

    const normalized = normalizeSessionTemplateDraft(draft);
    if (!normalized.valid) {
      setErrorMsg(normalized.error);
      setStatusBanner(null);
      return;
    }

    setErrorMsg(null);
    setIsSaving(true);
    try {
      await onSaveTemplate(normalized.template);
      setDraft(cloneTemplate(normalized.template));
      setIsFromSessionDraft(false);
      setStatusBanner(`Vorlage „${normalized.template.title}“ gespeichert.`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDelete(templateId: string) {
    if (!canManageTemplates || isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onDeleteTemplate(templateId);
      const remaining = sortedTemplates.filter((t) => t.id !== templateId);
      setConfirmDeleteId(null);
      setIsFromSessionDraft(false);
      if (remaining[0]) {
        setDraft(cloneTemplate(remaining[0]));
      } else {
        setDraft(null);
      }
      setStatusBanner('Vorlage gelöscht.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
            <div>
              <div className="flex items-center gap-2">
                <Bookmark className="h-5 w-5 text-blue-400" />
                <h2 className="text-lg font-bold text-white">
                  {canManageTemplates
                    ? 'Trainingstag-Vorlagen verwalten'
                    : 'Trainingstag-Vorlagen (Nur Lesen)'}
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {canManageTemplates
                  ? `Erstelle, bearbeite, dupliziere oder lösche wiederverwendbare Ablauf-Vorlagen für Einzeltrainings und Mehrwochenpläne (${templates.length} gespeichert).`
                  : `Wiederverwendbare Ablauf-Vorlagen des Vereins einsehen (${templates.length} gespeichert). Bearbeiten und Löschen sind nur für Vereins-Admins möglich.`}
              </p>
            </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Left column: Template list */}
          <div className="flex max-h-[38vh] flex-col border-b border-slate-800 bg-slate-950/50 lg:col-span-4 lg:max-h-none lg:border-r lg:border-b-0">
            <div className="space-y-2.5 border-b border-slate-800 p-4">
              {canManageTemplates && (
                <button
                  type="button"
                  onClick={handleCreateNewDraft}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <Plus className="h-4 w-4" />
                  Neue Vorlage
                </button>
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Vorlage suchen…"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 py-1.5 pr-3 pl-8 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {filteredTemplates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
                  {templates.length === 0
                    ? 'Noch keine Vorlagen gespeichert.'
                    : 'Keine passenden Vorlagen gefunden.'}
                </div>
              ) : (
                filteredTemplates.map((tpl) => {
                  const isActive = draft?.id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        isActive
                          ? 'border-blue-500/70 bg-blue-950/50 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold leading-snug">{tpl.title}</span>
                        <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                          {tpl.default_duration_min} Min
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span className="truncate">
                          {tpl.description || 'Ohne Beschreibung'}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {tpl.phases_template.length} Phasen
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right column: Template editor */}
          <div className="flex flex-1 flex-col overflow-hidden lg:col-span-8">
            {!draft ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <Bookmark className="h-10 w-10 text-slate-600" />
                <div className="text-sm font-semibold text-slate-300">
                  Keine Vorlage ausgewählt
                </div>
                <p className="max-w-sm text-xs text-slate-400">
                  {canManageTemplates
                    ? 'Wähle links eine bestehende Trainingstag-Vorlage aus oder erstelle eine neue Struktur für deine Trainingsplanung.'
                    : 'Wähle links eine bestehende Trainingstag-Vorlage zur Ansicht aus.'}
                </p>
                {canManageTemplates && (
                  <button
                    type="button"
                    onClick={handleCreateNewDraft}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    <Plus className="h-4 w-4" />
                    Neue Vorlage anlegen
                  </button>
                )}
              </div>
            ) : (
              <form onSubmit={handleSave} className="flex flex-1 flex-col overflow-hidden">
                {/* Editor scroll body */}
                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  {!canManageTemplates && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-3.5 py-2 text-xs text-amber-200">
                      <strong>Nur Lesezugriff:</strong> Vereins-Vorlagen können nur von
                      Vereins-Admins angelegt, bearbeitet oder gelöscht werden. Du kannst sie beim
                      Erstellen von Trainingstagen anwenden.
                    </div>
                  )}
                  {/* Status & actions row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {isExistingTemplate ? (
                        <span className="rounded-full border border-blue-500/40 bg-blue-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-blue-300">
                          {canManageTemplates ? 'Vorlage bearbeiten' : 'Vorlage ansehen'}
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                          Neue Vorlage
                        </span>
                      )}
                      <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                        {totalDurationMin} Min · {draft.phases_template.length} Phasen
                      </span>
                    </div>

                    {canManageTemplates && isExistingTemplate && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleDuplicateCurrent}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          <Copy className="h-3.5 w-3.5 text-blue-400" />
                          Duplizieren
                        </button>

                        {confirmDeleteId === draft.id ? (
                          <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-950/60 px-2.5 py-1 text-xs">
                            <span className="font-semibold text-rose-200">Vorlage löschen?</span>
                            <button
                              type="button"
                              onClick={() => void handleConfirmDelete(draft.id)}
                              disabled={isSaving}
                              className="rounded bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-500"
                            >
                              Ja
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                            >
                              Nein
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(draft.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:border-rose-700/60 hover:bg-rose-950/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Löschen
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isFromSessionDraft && (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3.5 py-2 text-xs text-emerald-200">
                      Aus aktuellem Trainingstag übernommen – du kannst Titel, Beschreibung und
                      Phasen vor dem Speichern anpassen.
                    </div>
                  )}

                  {statusBanner && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-3.5 py-2 text-xs font-semibold text-emerald-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{statusBanner}</span>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="rounded-xl border border-rose-500/50 bg-rose-950/50 px-3.5 py-2 text-xs font-semibold text-rose-200">
                      {errorMsg}
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">
                        Vorlagen-Titel *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={!canManageTemplates}
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        placeholder="z. B. Standard-Hallentraining 90 Min (Tempospiel)"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-75"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">
                        Beschreibung
                      </label>
                      <textarea
                        rows={2}
                        disabled={!canManageTemplates}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        placeholder="Kurze Notiz zum Einsatzbereich oder Schwerpunkt dieser Vorlage…"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-75"
                      />
                    </div>
                  </div>

                  {/* Phases list */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                          Phasen-Ablauf
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Reihenfolge, Zielzeit und optionale Standard-Übung je Phase festlegen.
                        </p>
                      </div>
                      {canManageTemplates && (
                        <button
                          type="button"
                          onClick={handleAddPhase}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-500/40 bg-blue-950/40 px-2.5 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-900/50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Phase hinzufügen
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      {draft.phases_template.map((phase, idx) => {
                        const selectedExerciseId = phase.default_exercise_id ?? '';
                        const hasMissingExercise =
                          Boolean(selectedExerciseId) && !exercisesById.has(selectedExerciseId);
                        return (
                          <div
                            key={idx}
                            className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-300">
                                #{idx + 1}
                              </span>

                              {canManageTemplates && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleMovePhase(idx, 'UP')}
                                    disabled={idx === 0}
                                    className="rounded-lg border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 disabled:opacity-35"
                                    title="Phase nach oben"
                                    aria-label="Phase nach oben"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMovePhase(idx, 'DOWN')}
                                    disabled={idx === draft.phases_template.length - 1}
                                    className="rounded-lg border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 disabled:opacity-35"
                                    title="Phase nach unten"
                                    aria-label="Phase nach unten"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}

                              <input
                                type="text"
                                required
                                disabled={!canManageTemplates}
                                value={phase.name}
                                onChange={(e) => updatePhaseAt(idx, { name: e.target.value })}
                                placeholder="Phasen-Name"
                                className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-75"
                              />

                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={5}
                                  max={180}
                                  step={5}
                                  disabled={!canManageTemplates}
                                  value={phase.target_duration_min}
                                  onChange={(e) =>
                                    updatePhaseAt(idx, {
                                      target_duration_min: Number(e.target.value)
                                    })
                                  }
                                  className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-right text-xs font-semibold text-white focus:border-blue-500 focus:outline-none disabled:opacity-75"
                                />
                                <span className="text-[11px] text-slate-400">Min</span>
                              </div>

                              {canManageTemplates && (
                                <button
                                  type="button"
                                  onClick={() => handleRemovePhase(idx)}
                                  disabled={draft.phases_template.length <= 1}
                                  className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-rose-300 hover:bg-rose-950/50 disabled:opacity-35"
                                  title="Phase entfernen"
                                  aria-label="Phase entfernen"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <select
                                disabled={!canManageTemplates}
                                value={selectedExerciseId}
                                onChange={(e) =>
                                  updatePhaseAt(idx, {
                                    default_exercise_id: e.target.value || undefined
                                  })
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none disabled:opacity-75"
                              >
                                <option value="">— Keine Standard-Übung (leere Phase) —</option>
                                {hasMissingExercise && (
                                  <option value={selectedExerciseId}>
                                    (Verknüpfte Übung nicht im Katalog)
                                  </option>
                                )}
                                {sortedExercises.map((ex) => (
                                  <option key={ex.id} value={ex.id}>
                                    {ex.title} ({ex.default_duration_min} Min)
                                  </option>
                                ))}
                              </select>

                              <input
                                type="text"
                                disabled={!canManageTemplates}
                                value={phase.default_track_label ?? ''}
                                onChange={(e) =>
                                  updatePhaseAt(idx, {
                                    default_track_label: e.target.value || undefined
                                  })
                                }
                                placeholder="Spur / Gruppe (optional, z. B. Alle Spieler)"
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-75"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/95 px-5 py-3.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    Schließen
                  </button>
                  {canManageTemplates && (
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {isSaving ? 'Speichere…' : 'Vorlage speichern'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
