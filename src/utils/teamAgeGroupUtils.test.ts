import { describe, expect, it } from 'vitest';
import {
  formatTeamAgeGroupLabel,
  isAgeGroup,
  parseAgeGroupFromText,
  resolveTeamAgeGroup
} from './teamAgeGroupUtils';

describe('teamAgeGroupUtils', () => {
  it('validates canonical AgeGroup codes with isAgeGroup', () => {
    expect(isAgeGroup('MINIS')).toBe(true);
    expect(isAgeGroup('B_YOUTH')).toBe(true);
    expect(isAgeGroup('ADULTS')).toBe(true);
    expect(isAgeGroup('b_youth')).toBe(false);
    expect(isAgeGroup('U17 / B-Jugend')).toBe(false);
    expect(isAgeGroup(null)).toBe(false);
  });

  it('parses canonical AgeGroup keys case-insensitively and German display labels', () => {
    expect(parseAgeGroupFromText('MINIS')).toBe('MINIS');
    expect(parseAgeGroupFromText('b_youth')).toBe('B_YOUTH');
    expect(parseAgeGroupFromText('C-Jugend')).toBe('C_YOUTH');
    expect(parseAgeGroupFromText('Erwachsene')).toBe('ADULTS');
    expect(parseAgeGroupFromText('Minis')).toBe('MINIS');
  });

  it('parses legacy seed and free-text team age groups accurately', () => {
    expect(parseAgeGroupFromText('U17 / B-Jugend (Oberliga)')).toBe('B_YOUTH');
    expect(parseAgeGroupFromText('Aktive (Verbandsliga)')).toBe('ADULTS');
    expect(parseAgeGroupFromText('Senioren')).toBe('ADULTS');
    expect(parseAgeGroupFromText('U15 / Bezirksoberliga')).toBe('C_YOUTH');
    expect(parseAgeGroupFromText('Jugend / Aktive')).toBeNull();
    expect(parseAgeGroupFromText('')).toBeNull();
    expect(parseAgeGroupFromText(undefined)).toBeNull();
  });

  it('parses German handball abbreviations without false positives on lowercase words', () => {
    expect(parseAgeGroupFromText('mB1')).toBe('B_YOUTH');
    expect(parseAgeGroupFromText('wD')).toBe('D_YOUTH');
    expect(parseAgeGroupFromText('mE2')).toBe('E_YOUTH');
    expect(parseAgeGroupFromText('weibliche C-Jugend')).toBe('C_YOUTH');
    expect(parseAgeGroupFromText('1. Herren')).toBe('ADULTS');
    expect(parseAgeGroupFromText('2. Damen')).toBe('ADULTS');

    // Lowercase German words like "am", "we", "me" must not trigger youth abbreviations
    expect(parseAgeGroupFromText('Training am Abend')).toBeNull();
    expect(parseAgeGroupFromText('Team me and we')).toBeNull();
  });

  it('prefers explicit team.age_group over team.name and falls back when ambiguous', () => {
    expect(
      resolveTeamAgeGroup({
        age_group: 'A_YOUTH',
        name: 'männliche B-Jugend'
      })
    ).toBe('A_YOUTH');

    expect(
      resolveTeamAgeGroup({
        age_group: 'Jugend / Aktive',
        name: 'weibliche D-Jugend'
      })
    ).toBe('D_YOUTH');

    expect(
      resolveTeamAgeGroup({
        age_group: 'Jugend / Aktive',
        name: '1. Herren'
      })
    ).toBe('ADULTS');

    expect(resolveTeamAgeGroup(null)).toBeNull();
  });

  it('formats canonical AgeGroup keys to German labels while preserving legacy strings', () => {
    expect(formatTeamAgeGroupLabel('B_YOUTH')).toBe('B-Jugend');
    expect(formatTeamAgeGroupLabel('ADULTS')).toBe('Erwachsene');
    expect(formatTeamAgeGroupLabel('U17 / B-Jugend (Oberliga)')).toBe('U17 / B-Jugend (Oberliga)');
    expect(formatTeamAgeGroupLabel(undefined)).toBe('');
  });
});
