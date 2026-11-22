import { useEffect, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  ExternalLink as ExternalLinkIcon,
  Film,
  Image as ImageIcon,
  Layers,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import type {
  AgeGroup,
  ComplexityLevel,
  Exercise,
  ExternalLink,
  HandballFocusTag,
  MaterialItem,
  MaterialType,
  TacticBoardData,
  TrainingPhaseCategory,
  VisibilityLevel
} from '../types/domain';
import {
  AGE_GROUP_LABELS,
  ALL_AGE_GROUPS,
  ATHLETICS_RECOVERY_FOCUS_TAGS,
  COMPLEXITY_LABELS,
  DEFAULT_AGE_GROUPS,
  FOCUS_TAG_LABELS,
  MATERIAL_LABELS,
  PHASE_CATEGORY_LABELS,
  TACTIC_FOCUS_TAGS,
  TECHNIQUE_FOCUS_TAGS
} from '../constants/handballLabels';
import { TacticBoardEditor } from './TacticBoardEditor';
import { buildTacticBoardPreset } from '../utils/tacticPresets';
import { hasExplicitTacticAnimation } from '../utils/tacticBoardUtils';
import { isSafeHttpUrl, sanitizeHttpUrl } from '../utils/securityUtils';

interface ExerciseEditorModalProps {
  isOpen: boolean;
  initialExercise?: Exercise | null;
  parentExercise?: Exercise | null;
  clubId: string;
  activeTeamId: string;
  onClose: () => void;
  onSave: (exercise: Exercise) => Promise<void>;
}

async function compressImageFileToDataUrl(file: File, maxWidth = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ExerciseEditorModal({
  isOpen,
  initialExercise,
  parentExercise,
  clubId,
  activeTeamId,
  onClose,
  onSave
}: ExerciseEditorModalProps) {
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<VisibilityLevel>('CLUB');
  const [durationMin, setDurationMin] = useState(15);
  const [minPlayers, setMinPlayers] = useState(6);
  const [maxPlayers, setMaxPlayers] = useState(14);
  const [goalkeepers, setGoalkeepers] = useState(1);
  const [level, setLevel] = useState<ComplexityLevel>('BASIC');
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(DEFAULT_AGE_GROUPS);
  const [ageGroupError, setAgeGroupError] = useState<string | null>(null);
  const [phases, setPhases] = useState<TrainingPhaseCategory[]>(['GROUND_EXERCISE']);
  const [focusTags, setFocusTags] = useState<HandballFocusTag[]>(['OFFENSE_GROUP']);
  const [materials, setMaterials] = useState<MaterialItem[]>([
    { type: 'BALL', quantity: 6 },
    { type: 'CONE', quantity: 4 }
  ]);
  const [setupDesc, setSetupDesc] = useState('');
  const [flowDesc, setFlowDesc] = useState('');
  const [coachingPoints, setCoachingPoints] = useState('');
  const [variationsText, setVariationsText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [referenceImageData, setReferenceImageData] = useState<string | undefined>(undefined);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);
  const [tacticBoard, setTacticBoard] = useState<TacticBoardData>(() =>
    buildTacticBoardPreset('OFFENSE_BACKCOURT_TRIANGLE')
  );

  // Graphic tab: interactive tactic board vs pasted reference image
  const [graphicTab, setGraphicTab] = useState<'TACTIC_BOARD' | 'REFERENCE_IMAGE'>('TACTIC_BOARD');

  // Helper state for adding material & external link
  const [newMatType, setNewMatType] = useState<MaterialType>('CONE');
  const [newMatQty, setNewMatQty] = useState(4);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setIsSaving(false);
    const source = initialExercise ?? parentExercise;
    if (source) {
      setTitle(
        parentExercise && !initialExercise ? `${source.title} (Variante)` : source.title
      );
      setVisibility(source.visibility);
      setDurationMin(source.default_duration_min);
      setMinPlayers(source.min_players);
      setMaxPlayers(source.max_players);
      setGoalkeepers(source.goalkeepers);
      setLevel(source.categories.level);
      setAgeGroups(
        source.categories.age_groups?.length ? source.categories.age_groups : DEFAULT_AGE_GROUPS
      );
      setAgeGroupError(null);
      setPhases(source.categories.phases);
      setFocusTags(source.categories.focus);
      setMaterials(source.materials);
      setSetupDesc(source.setup_description);
      setFlowDesc(source.flow_description);
      setCoachingPoints(source.coaching_points);
      setVariationsText(source.variations_text);
      setSourceUrl(source.source_url ?? '');
      setReferenceImageData(source.reference_image_data);
      setExternalLinks(source.external_links ?? []);
      setTacticBoard(
        source.tactic_board_data
          ? structuredClone(source.tactic_board_data)
          : buildTacticBoardPreset('OFFENSE_BACKCOURT_TRIANGLE')
      );
      setGraphicTab(
        source.reference_image_data && !source.tactic_board_data
          ? 'REFERENCE_IMAGE'
          : 'TACTIC_BOARD'
      );
    } else {
      setTitle('');
      setVisibility('CLUB');
      setDurationMin(15);
      setMinPlayers(6);
      setMaxPlayers(14);
      setGoalkeepers(1);
      setLevel('BASIC');
      setAgeGroups(DEFAULT_AGE_GROUPS);
      setAgeGroupError(null);
      setPhases(['GROUND_EXERCISE']);
      setFocusTags(['OFFENSE_GROUP']);
      setMaterials([
        { type: 'BALL', quantity: 6 },
        { type: 'CONE', quantity: 4 }
      ]);
      setSetupDesc('');
      setFlowDesc('');
      setCoachingPoints('');
      setVariationsText('');
      setSourceUrl('');
      setReferenceImageData(undefined);
      setExternalLinks([]);
      setTacticBoard(buildTacticBoardPreset('OFFENSE_BACKCOURT_TRIANGLE'));
      setGraphicTab('TACTIC_BOARD');
    }
  }, [isOpen, initialExercise, parentExercise]);

  // Listen to Ctrl+V image paste events while modal is open
  useEffect(() => {
    if (!isOpen) return;
    async function handleWindowPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const dataUrl = await compressImageFileToDataUrl(file);
            setReferenceImageData(dataUrl);
            setGraphicTab('REFERENCE_IMAGE');
            break;
          }
        }
      }
    }
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isOpen]);

  if (!isOpen) return null;

  function toggleAgeGroup(ag: AgeGroup) {
    setAgeGroupError(null);
    setAgeGroups((prev) => (prev.includes(ag) ? prev.filter((x) => x !== ag) : [...prev, ag]));
  }

  function togglePhase(p: TrainingPhaseCategory) {
    setPhases((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleFocus(f: HandballFocusTag) {
    setFocusTags((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function handleAddMaterial() {
    setMaterials((prev) => {
      const existing = prev.find((m) => m.type === newMatType);
      if (existing) {
        return prev.map((m) => (m.type === newMatType ? { ...m, quantity: newMatQty } : m));
      }
      return [...prev, { type: newMatType, quantity: newMatQty }];
    });
  }

  function handleAddExternalLink() {
    if (!newLinkUrl.trim()) return;
    if (!isSafeHttpUrl(newLinkUrl)) {
      setFormError('Bitte eine gültige http:// oder https:// Web-URL für den Link eingeben.');
      return;
    }
    setFormError(null);
    setExternalLinks((prev) => [
      ...prev,
      {
        title: newLinkTitle.trim() || newLinkUrl.trim(),
        url: newLinkUrl.trim(),
        platform: newLinkUrl.includes('youtube') || newLinkUrl.includes('youtu.be')
          ? 'YOUTUBE'
          : newLinkUrl.includes('instagram')
            ? 'INSTAGRAM'
            : 'WEB'
      }
    ]);
    setNewLinkTitle('');
    setNewLinkUrl('');
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await compressImageFileToDataUrl(file);
    setReferenceImageData(dataUrl);
    setGraphicTab('REFERENCE_IMAGE');
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError('Bitte gib oben links einen Übungstitel ein.');
      return;
    }
    if (ageGroups.length === 0) {
      const msg = 'Bitte wähle mindestens eine Altersstufe aus.';
      setAgeGroupError(msg);
      setFormError(msg);
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const exerciseToSave: Exercise = {
        id: initialExercise?.id ?? crypto.randomUUID(),
        club_id: clubId,
        parent_exercise_id:
          initialExercise?.parent_exercise_id ?? parentExercise?.id ?? undefined,
        visibility,
        owner_team_id: visibility === 'TEAM' ? activeTeamId : undefined,
        title: title.trim(),
        default_duration_min: Number(durationMin) || 15,
        min_players: Number(minPlayers) || 1,
        max_players: Number(maxPlayers) || 14,
        goalkeepers: Number(goalkeepers) || 0,
        categories: {
          phases: phases.length ? phases : ['GROUND_EXERCISE'],
          focus: focusTags.length ? focusTags : ['OFFENSE_GROUP'],
          level,
          age_groups: ageGroups
        },
        materials,
        setup_description: setupDesc.trim(),
        flow_description: flowDesc.trim(),
        coaching_points: coachingPoints.trim(),
        variations_text: variationsText.trim(),
        source_url: sanitizeHttpUrl(sourceUrl),
        reference_image_data: referenceImageData,
        external_links: externalLinks.filter((lnk) => isSafeHttpUrl(lnk.url)),
        tactic_board_data: tacticBoard,
        is_favorite: initialExercise?.is_favorite,
        is_deleted: false,
        created_at: initialExercise?.created_at ?? now,
        updated_at: now
      };

      await onSave(exerciseToSave);
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? `Fehler beim Speichern: ${err.message}`
          : 'Die Übung konnte nicht gespeichert werden.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm lg:p-6">
      <div className="my-auto flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <span className="text-xs font-semibold tracking-wider text-blue-400 uppercase">
              {initialExercise
                ? 'Übung bearbeiten'
                : parentExercise
                  ? `Neue Variante zu „${parentExercise.title}" anlegen`
                  : 'Neue Handball-Übung erstellen'}
            </span>
            <h2 className="text-lg font-bold text-white">
              Desktop Übungs-Backend & Taktikboard-Editor
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-6">
          {formError && (
            <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-2.5 text-xs font-semibold text-rose-200">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Linke Spalte (5 Cols): Metadaten, Textfelder, Material & Web-Links */}
            <div className="space-y-4 lg:col-span-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  Übungstitel *
                </label>
                <input
                  type="text"
                  required
                  placeholder="z.B. Kreuzen RM-RL mit Kreiskooperation gegen 6:0"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Sichtbarkeit im Verein</label>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as VisibilityLevel)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="CLUB">Vereinsweit (Alle Vereinstrainer)</option>
                    <option value="TEAM">Intern (Nur mein Trainerteam)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-300">Komplexität / Stufe</label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as ComplexityLevel)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    {(Object.keys(COMPLEXITY_LABELS) as ComplexityLevel[]).map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {COMPLEXITY_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Dauer (Min)</label>
                  <input
                    type="number"
                    min={3}
                    max={90}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Min. Spieler</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={minPlayers}
                    onChange={(e) => setMinPlayers(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Max. Spieler</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Torhüter</label>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={goalkeepers}
                    onChange={(e) => setGoalkeepers(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              {/* Textbeschreibungen */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  Aufbau & Organisation
                </label>
                <textarea
                  rows={4}
                  placeholder="Positionen, Hütchen, Gruppengröße..."
                  value={setupDesc}
                  onChange={(e) => setSetupDesc(e.target.value)}
                  className="w-full min-h-[6rem] resize-y rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-blue-300">
                  Übungsablauf (Schritt für Schritt)
                </label>
                <textarea
                  rows={6}
                  placeholder="1. RL stößt auf die Nahtstelle...\n2. Parallelpass zu RM..."
                  value={flowDesc}
                  onChange={(e) => setFlowDesc(e.target.value)}
                  className="w-full min-h-[9rem] resize-y rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-amber-300">
                  Coaching-Punkte & Korrekturen
                </label>
                <textarea
                  rows={4}
                  placeholder="- Tiefgang mit Wurfarm oben\n- Früher Blickkontakt zum Kreis..."
                  value={coachingPoints}
                  onChange={(e) => setCoachingPoints(e.target.value)}
                  className="w-full min-h-[6rem] resize-y rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  Variationen & Steigerungen
                </label>
                <textarea
                  rows={4}
                  placeholder="Steigerung: Abwehrspieler darf aktiv heraustreten..."
                  value={variationsText}
                  onChange={(e) => setVariationsText(e.target.value)}
                  className="w-full min-h-[6rem] resize-y rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white"
                />
              </div>

              {/* Web-Quellen-URL & Externe Video-Links */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2.5">
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <ExternalLinkIcon className="h-3.5 w-3.5 text-blue-400" />
                    Web-Referenz / Quellen-URL (optional)
                  </label>
                  <input
                    type="url"
                    placeholder="https://www.dhb.de/... oder YouTube-Link"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                  />
                </div>

                {externalLinks.length > 0 && (
                  <div className="space-y-1">
                    {externalLinks.map((lnk, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded bg-slate-900 px-2.5 py-1 text-xs"
                      >
                        <span className="truncate text-blue-300">{lnk.title}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setExternalLinks((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Video-Titel"
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    className="w-1/3 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                  />
                  <input
                    type="url"
                    placeholder="https://youtube.com/..."
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddExternalLink}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    + Link
                  </button>
                </div>
              </div>
            </div>

            {/* Rechte Spalte (7 Cols): Taktikboard-Editor, Strg+V Bild-Import, Kategorien & Material */}
            <div className="space-y-4 lg:col-span-7">
              {/* Umschalter: Interaktives Taktikboard vs. Strg+V Referenz-Bild aus dem Web */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => setGraphicTab('TACTIC_BOARD')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      graphicTab === 'TACTIC_BOARD'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Interaktives Taktikboard
                  </button>
                  <button
                    type="button"
                    onClick={() => setGraphicTab('REFERENCE_IMAGE')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      graphicTab === 'REFERENCE_IMAGE'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Web-Zeichnung / Screenshot (Strg+V)
                    {referenceImageData && (
                      <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 text-[10px] text-emerald-300">
                        ✓
                      </span>
                    )}
                  </button>
                </div>

                {hasExplicitTacticAnimation(tacticBoard) ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    <Film className="h-3.5 w-3.5" />
                    Animation vorhanden ({tacticBoard.keyframes?.length ?? 0} Szenen)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-400">
                    <Film className="h-3.5 w-3.5" />
                    Keine Animation
                  </span>
                )}
              </div>

              {graphicTab === 'TACTIC_BOARD' ? (
                <TacticBoardEditor value={tacticBoard} onChange={setTacticBoard} />
              ) : (
                <div className="rounded-2xl border border-dashed border-blue-500/40 bg-slate-950/80 p-6 text-center space-y-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400">
                    <ClipboardPaste className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Bestehende Übungszeichnung aus Web oder PDF per <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-blue-300">Strg + V</kbd> einfügen
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      Mache mit <kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">Win + Shift + S</kbd> einen Screenshot einer bestehenden Übung und drücke jetzt einfach <strong>Strg + V</strong>, oder wähle eine Bilddatei aus.
                    </p>
                  </div>

                  {referenceImageData ? (
                    <div className="space-y-3">
                      <img
                        src={referenceImageData}
                        alt="Eingefügte Referenz-Skizze"
                        className="mx-auto max-h-64 rounded-xl border border-slate-700 object-contain shadow-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setReferenceImageData(undefined)}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-950/70 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Referenz-Bild entfernen
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                        <ImageIcon className="h-4 w-4 text-blue-400" />
                        Bilddatei vom PC auswählen
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Altersstufen (Pflichtfeld, Mehrfachauswahl) */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-300">
                    Altersstufen * <span className="font-normal text-slate-400">(Mehrfachauswahl möglich)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAgeGroupError(null);
                        setAgeGroups(ALL_AGE_GROUPS);
                      }}
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                    >
                      Alle
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAgeGroupError(null);
                        setAgeGroups(['MINIS', 'F_YOUTH', 'E_YOUTH']);
                      }}
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                    >
                      Minis – E-Jugend
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAgeGroupError(null);
                        setAgeGroups(['E_YOUTH', 'D_YOUTH', 'C_YOUTH', 'B_YOUTH', 'A_YOUTH']);
                      }}
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                    >
                      Jugend (E–A)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAgeGroupError(null);
                        setAgeGroups(DEFAULT_AGE_GROUPS);
                      }}
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                    >
                      Ab D-Jugend
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_AGE_GROUPS.map((ag) => {
                    const active = ageGroups.includes(ag);
                    return (
                      <button
                        key={ag}
                        type="button"
                        onClick={() => toggleAgeGroup(ag)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {AGE_GROUP_LABELS[ag]}
                      </button>
                    );
                  })}
                </div>
                {ageGroupError && (
                  <p className="mt-2 text-xs font-medium text-rose-400">{ageGroupError}</p>
                )}
              </div>

              {/* Kategorien: Trainingsphasen & Handball-Schwerpunkte */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                  <div className="mb-2 text-xs font-bold text-slate-300">
                    Geeignete Trainingsphasen
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(PHASE_CATEGORY_LABELS) as TrainingPhaseCategory[]).map((p) => {
                      const active = phases.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePhase(p)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                            active
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          {PHASE_CATEGORY_LABELS[p]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                  <div className="text-xs font-bold text-slate-300">
                    Handball-Schwerpunkte & Techniken (für Smart-Filter)
                  </div>

                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Taktik & Spielphasen
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TACTIC_FOCUS_TAGS.map((f) => {
                        const active = focusTags.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleFocus(f)}
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              active
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            #{FOCUS_TAG_LABELS[f]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-slate-800/80 pt-2.5">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                      Techniken
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TECHNIQUE_FOCUS_TAGS.map((f) => {
                        const active = focusTags.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleFocus(f)}
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              active
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            #{FOCUS_TAG_LABELS[f]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-slate-800/80 pt-2.5">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-300/90">
                      Athletik & Regeneration
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ATHLETICS_RECOVERY_FOCUS_TAGS.map((f) => {
                        const active = focusTags.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleFocus(f)}
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              active
                                ? 'bg-teal-600 text-white'
                                : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            #{FOCUS_TAG_LABELS[f]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Benötigtes Material */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="mb-2 text-xs font-bold text-slate-300">
                  Benötigtes Material (für automatische Hallen-Packliste)
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {materials.map((item) => (
                    <span
                      key={item.type}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
                    >
                      <strong>{item.quantity}x</strong> {MATERIAL_LABELS[item.type]}
                      <button
                        type="button"
                        onClick={() =>
                          setMaterials((prev) => prev.filter((m) => m.type !== item.type))
                        }
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={newMatType}
                    onChange={(e) => setNewMatType(e.target.value as MaterialType)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                  >
                    {(Object.keys(MATERIAL_LABELS) as MaterialType[]).map((mt) => (
                      <option key={mt} value={mt}>
                        {MATERIAL_LABELS[mt]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={newMatQty}
                    onChange={(e) => setNewMatQty(Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddMaterial}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Material setzen
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Modal Footer (Fixed at bottom of modal) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-6 py-4">
            <span className="text-xs text-slate-400">
              {formError ? (
                <span className="font-semibold text-rose-400">{formError}</span>
              ) : (
                'Änderungen werden erst mit Klick auf „Übung in Datenbank speichern“ übernommen.'
              )}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSaving}
                onClick={(e) => {
                  e.preventDefault();
                  void handleSubmit();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {isSaving ? 'Speichere...' : 'Übung in Datenbank speichern'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
