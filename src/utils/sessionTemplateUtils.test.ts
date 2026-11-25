import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_PHASES,
  calculateTemplateTotalDuration,
  createBlankSessionTemplateDraft,
  duplicateSessionTemplate,
  moveTemplatePhase,
  normalizeSessionTemplateDraft,
  reconcileSelectedTemplateId,
  sortSessionTemplates
} from './sessionTemplateUtils';
import type { SessionTemplate } from '../types/domain';

describe('sessionTemplateUtils', () => {
  it('creates a blank draft with default 5-phase structure and 90 min total duration', () => {
    const draft = createBlankSessionTemplateDraft('club-1');
    expect(draft.club_id).toBe('club-1');
    expect(draft.title).toBe('');
    expect(draft.phases_template).toHaveLength(DEFAULT_TEMPLATE_PHASES.length);
    expect(draft.default_duration_min).toBe(90);

    // Ensure cloned phase array does not mutate constant
    draft.phases_template[0].name = 'Geändert';
    expect(DEFAULT_TEMPLATE_PHASES[0].name).toBe('1. Aufwärmen & Einstimmung');
  });

  it('duplicates a template with a new ID and independent deep-cloned phases', () => {
    const source: SessionTemplate = {
      id: 'tpl-1',
      club_id: 'club-1',
      title: 'Standard 90',
      description: 'Für B-Jugend',
      default_duration_min: 40,
      phases_template: [
        {
          name: 'Aufwärmen',
          target_duration_min: 15,
          default_exercise_id: 'ex-1',
          default_track_label: 'Alle Spieler'
        },
        { name: 'Hauptteil', target_duration_min: 25 }
      ],
      updated_at: '2026-11-20T10:00:00.000Z'
    };

    const copy = duplicateSessionTemplate(source, 'club-2');
    expect(copy.id).not.toBe(source.id);
    expect(copy.club_id).toBe('club-2');
    expect(copy.title).toBe('Standard 90 (Kopie)');
    expect(copy.default_duration_min).toBe(40);

    copy.phases_template[0].name = 'Sprint-Warmup';
    expect(source.phases_template[0].name).toBe('Aufwärmen');
  });

  it('validates empty title, empty phases, and blank phase names', () => {
    const base = createBlankSessionTemplateDraft('club-1');

    expect(normalizeSessionTemplateDraft(base)).toEqual({
      valid: false,
      error: 'Bitte einen Vorlagen-Titel eingeben.'
    });

    expect(
      normalizeSessionTemplateDraft({
        ...base,
        title: 'Meine Vorlage',
        phases_template: []
      })
    ).toEqual({
      valid: false,
      error: 'Eine Vorlage benötigt mindestens eine Phase.'
    });

    expect(
      normalizeSessionTemplateDraft({
        ...base,
        title: 'Meine Vorlage',
        phases_template: [{ name: '   ', target_duration_min: 15 }]
      })
    ).toEqual({
      valid: false,
      error: 'Bitte alle Phasen benennen.'
    });
  });

  it('normalizes title, description, phase durations, optional fields, and total duration', () => {
    const draft: SessionTemplate = {
      id: 'tpl-2',
      club_id: 'club-1',
      title: '  Tempospiel 75  ',
      description: '  Fokus 1./2. Welle  ',
      default_duration_min: 0,
      phases_template: [
        {
          name: '  Warmup  ',
          target_duration_min: 2, // clamps to 5
          default_exercise_id: '   ',
          default_track_label: ''
        },
        {
          name: 'Gegenstoß',
          target_duration_min: 250, // clamps to 180
          default_exercise_id: 'ex-fast',
          default_track_label: '  Spur A  '
        },
        {
          name: 'Cool-Down',
          target_duration_min: Number.NaN // fallback 15
        }
      ],
      updated_at: '2026-11-20T10:00:00.000Z'
    };

    const result = normalizeSessionTemplateDraft(draft);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.template.title).toBe('Tempospiel 75');
    expect(result.template.description).toBe('Fokus 1./2. Welle');
    expect(result.template.default_duration_min).toBe(200);
    expect(result.template.phases_template).toEqual([
      { name: 'Warmup', target_duration_min: 5 },
      {
        name: 'Gegenstoß',
        target_duration_min: 180,
        default_exercise_id: 'ex-fast',
        default_track_label: 'Spur A'
      },
      { name: 'Cool-Down', target_duration_min: 15 }
    ]);
  });

  it('calculates total duration cleanly with invalid or boundary phase minutes', () => {
    expect(
      calculateTemplateTotalDuration([
        { name: 'A', target_duration_min: 10 },
        { name: 'B', target_duration_min: Number.NaN },
        { name: 'C', target_duration_min: 3.2 }
      ])
    ).toBe(30); // 10 + 15 + 5
  });

  it('moves phases up and down while respecting array boundaries', () => {
    const phases = [
      { name: 'P1', target_duration_min: 10 },
      { name: 'P2', target_duration_min: 20 },
      { name: 'P3', target_duration_min: 30 }
    ];

    expect(moveTemplatePhase(phases, 0, 'UP').map((p) => p.name)).toEqual(['P1', 'P2', 'P3']);
    expect(moveTemplatePhase(phases, 2, 'DOWN').map((p) => p.name)).toEqual(['P1', 'P2', 'P3']);
    expect(moveTemplatePhase(phases, 1, 'UP').map((p) => p.name)).toEqual(['P2', 'P1', 'P3']);
    expect(moveTemplatePhase(phases, 0, 'DOWN').map((p) => p.name)).toEqual(['P2', 'P1', 'P3']);
    expect(moveTemplatePhase(phases, 99, 'UP').map((p) => p.name)).toEqual(['P1', 'P2', 'P3']);
  });

  it('sorts templates alphabetically using German locale rules', () => {
    const makeTpl = (id: string, title: string): SessionTemplate => ({
      id,
      club_id: 'club-1',
      title,
      description: '',
      default_duration_min: 60,
      phases_template: [{ name: 'P1', target_duration_min: 60 }],
      updated_at: '2026-11-20T10:00:00.000Z'
    });

    const sorted = sortSessionTemplates([
      makeTpl('3', 'Übergangsspiel'),
      makeTpl('1', 'Abwehr 3:2:1'),
      makeTpl('2', 'Torwart-Spezial')
    ]);
    expect(sorted.map((t) => t.title)).toEqual([
      'Abwehr 3:2:1',
      'Torwart-Spezial',
      'Übergangsspiel'
    ]);
  });

  it('reconciles selected template ID when a template is deleted', () => {
    const templates: SessionTemplate[] = [
      {
        id: 'tpl-a',
        club_id: 'club-1',
        title: 'A',
        description: '',
        default_duration_min: 60,
        phases_template: [{ name: 'P1', target_duration_min: 60 }],
        updated_at: '2026-11-20T10:00:00.000Z'
      }
    ];

    expect(reconcileSelectedTemplateId('', templates)).toBe('');
    expect(reconcileSelectedTemplateId('tpl-a', templates)).toBe('tpl-a');
    expect(reconcileSelectedTemplateId('tpl-deleted', templates)).toBe('');
  });
});
