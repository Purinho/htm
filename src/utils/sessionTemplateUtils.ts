import type { SessionTemplate, SessionTemplatePhase } from '../types/domain';

export const DEFAULT_TEMPLATE_PHASES: SessionTemplatePhase[] = [
  { name: '1. Aufwärmen & Einstimmung', target_duration_min: 15 },
  { name: '2. Torwart-Einwerfen & Auftakt', target_duration_min: 15 },
  { name: '3. Hauptteil 1: Technik / Kleingruppe', target_duration_min: 25 },
  { name: '4. Hauptteil 2: Mannschaftstaktik / Zielspiel', target_duration_min: 25 },
  { name: '5. Abschlussspiel & Cool-Down', target_duration_min: 10 }
];

function sanitizePhaseDuration(rawDuration: number): number {
  if (!Number.isFinite(rawDuration)) return 15;
  return Math.max(5, Math.min(180, Math.round(rawDuration)));
}

/**
 * Computes the total planned duration (in minutes) across all phases of a template.
 */
export function calculateTemplateTotalDuration(phases: SessionTemplatePhase[]): number {
  return phases.reduce((sum, phase) => sum + sanitizePhaseDuration(phase.target_duration_min), 0);
}

/**
 * Creates a fresh editable SessionTemplate draft populated with the default 5-phase structure.
 */
export function createBlankSessionTemplateDraft(clubId: string): SessionTemplate {
  const phases_template = DEFAULT_TEMPLATE_PHASES.map((phase) => ({ ...phase }));
  return {
    id: crypto.randomUUID(),
    club_id: clubId,
    title: '',
    description: '',
    default_duration_min: calculateTemplateTotalDuration(phases_template),
    phases_template,
    updated_at: new Date().toISOString()
  };
}

/**
 * Duplicates an existing SessionTemplate with a new UUID and deep-cloned phase list.
 */
export function duplicateSessionTemplate(
  source: SessionTemplate,
  clubId?: string
): SessionTemplate {
  const phases_template = source.phases_template.map((phase) => ({ ...phase }));
  return {
    ...source,
    id: crypto.randomUUID(),
    club_id: clubId ?? source.club_id,
    title: `${source.title.trim() || 'Vorlage'} (Kopie)`,
    default_duration_min: calculateTemplateTotalDuration(phases_template),
    phases_template,
    updated_at: new Date().toISOString()
  };
}

/**
 * Validates and normalizes an edited SessionTemplate draft before persistence.
 */
export function normalizeSessionTemplateDraft(
  draft: SessionTemplate
): { valid: true; template: SessionTemplate } | { valid: false; error: string } {
  const trimmedTitle = draft.title.trim();
  if (!trimmedTitle) {
    return { valid: false, error: 'Bitte einen Vorlagen-Titel eingeben.' };
  }

  if (draft.phases_template.length === 0) {
    return { valid: false, error: 'Eine Vorlage benötigt mindestens eine Phase.' };
  }

  const normalizedPhases: SessionTemplatePhase[] = [];
  for (const phase of draft.phases_template) {
    const trimmedName = phase.name.trim();
    if (!trimmedName) {
      return { valid: false, error: 'Bitte alle Phasen benennen.' };
    }

    const cleanedExerciseId = phase.default_exercise_id?.trim() || undefined;
    const cleanedTrackLabel = phase.default_track_label?.trim() || undefined;

    normalizedPhases.push({
      name: trimmedName,
      target_duration_min: sanitizePhaseDuration(phase.target_duration_min),
      ...(cleanedExerciseId ? { default_exercise_id: cleanedExerciseId } : {}),
      ...(cleanedTrackLabel ? { default_track_label: cleanedTrackLabel } : {})
    });
  }

  return {
    valid: true,
    template: {
      ...draft,
      title: trimmedTitle,
      description: draft.description.trim(),
      default_duration_min: calculateTemplateTotalDuration(normalizedPhases),
      phases_template: normalizedPhases,
      updated_at: new Date().toISOString()
    }
  };
}

/**
 * Reorders a phase up or down within a template phase array without mutating the original.
 */
export function moveTemplatePhase(
  phases: SessionTemplatePhase[],
  index: number,
  direction: 'UP' | 'DOWN'
): SessionTemplatePhase[] {
  const next = phases.map((phase) => ({ ...phase }));
  if (index < 0 || index >= next.length) {
    return next;
  }
  const targetIndex = direction === 'UP' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }

  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

/**
 * Returns a German locale-sorted copy of SessionTemplate entries by title.
 */
export function sortSessionTemplates(templates: SessionTemplate[]): SessionTemplate[] {
  return templates
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
}

/**
 * Clears a selected template ID if it no longer exists in the available template list.
 */
export function reconcileSelectedTemplateId(
  currentId: string,
  templates: SessionTemplate[]
): string {
  if (!currentId) return '';
  return templates.some((tpl) => tpl.id === currentId) ? currentId : '';
}
