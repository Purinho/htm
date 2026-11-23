import { useMemo, useState } from 'react';
import { FileText, Printer, X } from 'lucide-react';
import type {
  ClubMember,
  Exercise,
  SessionBlock,
  SessionPhase,
  Team,
  TrainingSession
} from '../types/domain';
import {
  AGE_GROUP_LABELS,
  COMPLEXITY_LABELS,
  FOCUS_TAG_LABELS,
  MATERIAL_LABELS,
  PHASE_CATEGORY_LABELS
} from '../constants/handballLabels';
import {
  aggregateSessionMaterials,
  calculatePhaseEffectiveDuration,
  calculateSessionTotalDuration
} from '../utils/trainingCalculations';
import { formatTeamAgeGroupLabel } from '../utils/teamAgeGroupUtils';
import { TacticBoardPreview } from './TacticBoardPreview';

export type PrintExportTarget =
  | {
      kind: 'SESSION';
      team: Team;
      session: TrainingSession;
      phases: SessionPhase[];
      blocks: SessionBlock[];
      exercisesById: Map<string, Exercise>;
      members: ClubMember[];
      focusTheme?: string;
    }
  | {
      kind: 'EXERCISE';
      exercise: Exercise;
    };

interface PrintExportModalProps {
  target: PrintExportTarget | null;
  onClose: () => void;
}

export function PrintExportModal({ target, onClose }: PrintExportModalProps) {
  const [sessionLayout, setSessionLayout] = useState<'COMPACT' | 'DETAIL'>('COMPACT');

  const sessionComputed = useMemo(() => {
    if (!target || target.kind !== 'SESSION') return null;
    const orderedPhases = [...target.phases].sort((a, b) => a.sort_order - b.sort_order);
    const phaseIds = new Set(orderedPhases.map((p) => p.id));
    const sessionBlocks = target.blocks.filter((b) => phaseIds.has(b.session_phase_id));
    const materials = aggregateSessionMaterials(
      sessionBlocks,
      target.exercisesById,
      target.session.custom_materials_override ?? []
    );
    const totalDuration = calculateSessionTotalDuration(orderedPhases, sessionBlocks);
    const membersById = new Map(target.members.map((m) => [m.id, m]));

    return { orderedPhases, sessionBlocks, materials, totalDuration, membersById };
  }, [target]);

  if (!target) return null;

  return (
    <div className="print-modal-backdrop fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm">
      {/* Toolbar (hidden when printing) */}
      <div className="no-print mb-4 flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">
              {target.kind === 'SESSION'
                ? 'Druck- & PDF-Export: Hallen-Handout (A4)'
                : 'Druck- & PDF-Export: Übungskarte (A4)'}
            </h2>
            <p className="text-xs text-slate-400">
              100 % offline über „Als PDF speichern“ oder direkt auf Papier drucken.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {target.kind === 'SESSION' && (
            <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSessionLayout('COMPACT')}
                className={`rounded-lg px-3 py-1.5 font-semibold ${
                  sessionLayout === 'COMPACT'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Kompakt (1-Seiter Klemmbrett)
              </button>
              <button
                type="button"
                onClick={() => setSessionLayout('DETAIL')}
                className={`rounded-lg px-3 py-1.5 font-semibold ${
                  sessionLayout === 'DETAIL'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Detail-Handout (inkl. Skizzen)
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
          >
            <Printer className="h-4 w-4" />
            Drucken / Als PDF speichern
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
            Schließen
          </button>
        </div>
      </div>

      {/* A4 White Paper Sheet */}
      <div className="print-modal-panel w-full max-w-4xl rounded-2xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
        {target.kind === 'SESSION' && sessionComputed ? (
          <div className="print-sheet space-y-5">
            {/* Kopfzeile */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
              <div>
                <div className="text-[11px] font-bold tracking-wider text-blue-700 uppercase">
                  {target.team.name} · {formatTeamAgeGroupLabel(target.team.age_group)} · Saison{' '}
                  {target.team.season}
                </div>
                <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
                  {target.session.title}
                </h1>
                {target.focusTheme && (
                  <div className="mt-1 text-xs font-semibold text-slate-700">
                    Tagesschwerpunkt: {target.focusTheme}
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-slate-700">
                <div className="font-bold text-slate-900">
                  {target.session.session_date} · {target.session.start_time}–{target.session.end_time} Uhr
                </div>
                <div className="mt-0.5">
                  Gesamtdauer: <strong>{sessionComputed.totalDuration} Min</strong> (Soll:{' '}
                  {target.session.planned_duration_min} Min)
                </div>
              </div>
            </div>

            {/* Geräteraum-Box */}
            <div className="print-break-inside-avoid rounded-xl border border-slate-300 bg-slate-50 p-3.5">
              <div className="mb-2 text-xs font-extrabold tracking-wider text-slate-700 uppercase">
                Geräteraum-Checkliste (Materialbedarf)
              </div>
              {sessionComputed.materials.length === 0 ? (
                <div className="text-xs text-slate-500">Kein besonderes Material hinterlegt.</div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {sessionComputed.materials.map((item) => (
                    <div key={item.type} className="flex items-center gap-2 text-xs text-slate-800">
                      <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-slate-700 bg-white" />
                      <span>
                        <strong>{item.quantity}×</strong> {MATERIAL_LABELS[item.type]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ablaufplan */}
            <div className="space-y-4">
              {sessionComputed.orderedPhases.map((phase, pIdx) => {
                const phaseBlocks = sessionComputed.sessionBlocks.filter(
                  (b) => b.session_phase_id === phase.id
                );
                const effMin = calculatePhaseEffectiveDuration(phase, phaseBlocks);

                // Group by time_slot_index so parallel tracks render side-by-side!
                const slotMap = new Map<number, SessionBlock[]>();
                for (const b of phaseBlocks) {
                  const arr = slotMap.get(b.time_slot_index) ?? [];
                  arr.push(b);
                  slotMap.set(b.time_slot_index, arr);
                }
                const orderedSlots = Array.from(slotMap.entries()).sort((a, b) => a[0] - b[0]);

                return (
                  <div
                    key={phase.id}
                    className="print-break-inside-avoid rounded-xl border border-slate-300 overflow-hidden"
                  >
                    <div className="flex items-center justify-between bg-slate-900 px-3.5 py-2 text-xs font-bold text-white">
                      <span>
                        {pIdx + 1}. {phase.name}
                      </span>
                      <span>
                        {effMin} Min (Soll: {phase.target_duration_min} Min)
                      </span>
                    </div>

                    {orderedSlots.length === 0 ? (
                      <div className="px-3.5 py-2 text-xs text-slate-500">Keine Blöcke</div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {orderedSlots.map(([slotIdx, slotBlocks]) => (
                          <div
                            key={slotIdx}
                            className={`grid gap-3 p-3 ${
                              slotBlocks.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                            }`}
                          >
                            {slotBlocks.map((block) => {
                              const ex = block.exercise_id
                                ? target.exercisesById.get(block.exercise_id)
                                : undefined;
                              const coach = block.assigned_member_id
                                ? sessionComputed.membersById.get(block.assigned_member_id)
                                : undefined;
                              const blockTitle =
                                ex?.title ?? block.quick_block_title ?? 'Trainingsblock';

                              return (
                                <div
                                  key={block.id}
                                  className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-900">
                                        {block.track_label || 'Alle'}
                                      </span>
                                      {coach && (
                                        <span className="text-[10px] font-semibold text-slate-600">
                                          Trainer: {coach.display_name}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-xs font-extrabold text-slate-900">
                                      {block.custom_duration_min} Min
                                    </span>
                                  </div>

                                  <div className="text-sm font-bold text-slate-900">
                                    {blockTitle}
                                  </div>

                                  {sessionLayout === 'DETAIL' && (
                                    <div className="space-y-2 pt-1 text-xs text-slate-700">
                                      {ex ? (
                                        <>
                                          {ex.tactic_board_data && (
                                            <div className="max-w-sm">
                                              <TacticBoardPreview
                                                data={ex.tactic_board_data}
                                                hideControls
                                              />
                                            </div>
                                          )}
                                          {ex.setup_description && (
                                            <div>
                                              <strong>Aufbau:</strong> {ex.setup_description}
                                            </div>
                                          )}
                                          {ex.flow_description && (
                                            <div className="whitespace-pre-line">
                                              <strong>Ablauf:</strong> {ex.flow_description}
                                            </div>
                                          )}
                                          {ex.coaching_points && (
                                            <div className="whitespace-pre-line rounded bg-amber-50 p-2 border border-amber-200">
                                              <strong>Coaching-Punkte:</strong>{' '}
                                              {ex.coaching_points}
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        block.quick_block_description && (
                                          <p>{block.quick_block_description}</p>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : target.kind === 'EXERCISE' ? (
          <div className="print-sheet space-y-5">
            {/* Übungskarte Header */}
            <div className="border-b-2 border-slate-900 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-blue-800">
                <span>ÜBUNGSKARTE · {COMPLEXITY_LABELS[target.exercise.categories.level]}</span>
                <span>
                  Dauer: {target.exercise.default_duration_min} Min ·{' '}
                  {target.exercise.min_players}–{target.exercise.max_players} Spieler +{' '}
                  {target.exercise.goalkeepers} TW
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-extrabold text-slate-900">
                {target.exercise.title}
              </h1>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(target.exercise.categories.age_groups ?? []).map((ag) => (
                  <span
                    key={ag}
                    className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-900"
                  >
                    {AGE_GROUP_LABELS[ag]}
                  </span>
                ))}
                {target.exercise.categories.phases.map((p) => (
                  <span
                    key={p}
                    className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-800"
                  >
                    {PHASE_CATEGORY_LABELS[p]}
                  </span>
                ))}
                {target.exercise.categories.focus.map((f) => (
                  <span
                    key={f}
                    className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-900"
                  >
                    #{FOCUS_TAG_LABELS[f]}
                  </span>
                ))}
              </div>
            </div>

            {/* Taktik-Skizze / Referenzbild */}
            {target.exercise.tactic_board_data ? (
              <div className="mx-auto max-w-lg">
                <TacticBoardPreview data={target.exercise.tactic_board_data} hideControls />
              </div>
            ) : target.exercise.reference_image_data ? (
              <img
                src={target.exercise.reference_image_data}
                alt={target.exercise.title}
                className="mx-auto max-h-80 rounded-lg object-contain"
              />
            ) : null}

            {/* Material */}
            {target.exercise.materials.length > 0 && (
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs">
                <strong>Material:</strong>{' '}
                {target.exercise.materials
                  .map((m) => `${m.quantity}× ${MATERIAL_LABELS[m.type]}`)
                  .join(' · ')}
              </div>
            )}

            {/* Strukturierte Beschreibung */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-300 p-3.5 text-xs">
                <h3 className="mb-1 font-extrabold text-slate-900 uppercase">
                  Aufbau & Organisation
                </h3>
                <p className="whitespace-pre-line text-slate-700 leading-relaxed">
                  {target.exercise.setup_description || '—'}
                </p>
              </div>
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 text-xs">
                <h3 className="mb-1 font-extrabold text-amber-900 uppercase">
                  Coaching-Punkte
                </h3>
                <p className="whitespace-pre-line text-slate-800 leading-relaxed">
                  {target.exercise.coaching_points || '—'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-300 p-3.5 text-xs">
              <h3 className="mb-1 font-extrabold text-slate-900 uppercase">Übungsablauf</h3>
              <p className="whitespace-pre-line text-slate-700 leading-relaxed">
                {target.exercise.flow_description || '—'}
              </p>
            </div>

            {target.exercise.variations_text && (
              <div className="rounded-xl border border-slate-300 p-3.5 text-xs">
                <h3 className="mb-1 font-extrabold text-slate-900 uppercase">Variationen</h3>
                <p className="whitespace-pre-line text-slate-700 leading-relaxed">
                  {target.exercise.variations_text}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
