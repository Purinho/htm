import { ALL_AGE_GROUPS, AGE_GROUP_LABELS } from '../constants/handballLabels';
import type { AgeGroup, Team } from '../types/domain';

const AGE_GROUP_SET = new Set<string>(ALL_AGE_GROUPS);

const AGE_GROUP_BY_LOWER_LABEL = new Map<string, AgeGroup>(
  ALL_AGE_GROUPS.map((ag) => [AGE_GROUP_LABELS[ag].toLowerCase(), ag])
);

const TEXT_PATTERNS: Array<{ ageGroup: AgeGroup; patterns: RegExp[] }> = [
  {
    ageGroup: 'MINIS',
    patterns: [/\b(minis?|bambinis?|superminis?|g[- ]?jugend|g[- ]?jgd|jugend[- ]?g|u[ -]?[78])\b/i]
  },
  {
    ageGroup: 'F_YOUTH',
    patterns: [/\b(f[- ]?jugend|f[- ]?jgd|jugend[- ]?f|u[ -]?9)\b/i, /\b[mw]F\d?\b/]
  },
  {
    ageGroup: 'E_YOUTH',
    patterns: [/\b(e[- ]?jugend|e[- ]?jgd|jugend[- ]?e|u[ -]?1[01])\b/i, /\b[mw]E\d?\b/]
  },
  {
    ageGroup: 'D_YOUTH',
    patterns: [/\b(d[- ]?jugend|d[- ]?jgd|jugend[- ]?d|u[ -]?1[23])\b/i, /\b[mw]D\d?\b/]
  },
  {
    ageGroup: 'C_YOUTH',
    patterns: [/\b(c[- ]?jugend|c[- ]?jgd|jugend[- ]?c|u[ -]?1[45])\b/i, /\b[mw]C\d?\b/]
  },
  {
    ageGroup: 'B_YOUTH',
    patterns: [/\b(b[- ]?jugend|b[- ]?jgd|jugend[- ]?b|u[ -]?1[67])\b/i, /\b[mw]B\d?\b/]
  },
  {
    ageGroup: 'A_YOUTH',
    patterns: [/\b(a[- ]?jugend|a[- ]?jgd|jugend[- ]?a|u[ -]?1[89])\b/i, /\b[mw]A\d?\b/]
  },
  {
    ageGroup: 'ADULTS',
    patterns: [
      /\b(erwachsene|aktive|senioren|herren|damen|frauen|männer|maenner|u[ -]?2[013])\b/i
    ]
  }
];

/** Type guard checking whether a value is a canonical AgeGroup key. */
export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === 'string' && AGE_GROUP_SET.has(value);
}

/**
 * Parses a canonical AgeGroup from either an AgeGroup key, German label,
 * or legacy free-text team description (e.g. "U17 / B-Jugend (Oberliga)", "mB1", "1. Herren").
 */
export function parseAgeGroupFromText(raw: string | undefined | null): AgeGroup | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (isAgeGroup(upper)) {
    return upper;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'jugend / aktive') {
    return null;
  }

  const exactLabelMatch = AGE_GROUP_BY_LOWER_LABEL.get(lower);
  if (exactLabelMatch) {
    return exactLabelMatch;
  }

  for (const { ageGroup, patterns } of TEXT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      return ageGroup;
    }
  }

  return null;
}

/**
 * Resolves a team's canonical AgeGroup, preferring the explicit `age_group` field
 * and falling back to the team's `name` for legacy free-text records.
 */
export function resolveTeamAgeGroup(
  team: Pick<Team, 'age_group' | 'name'> | null | undefined
): AgeGroup | null {
  if (!team) return null;
  return parseAgeGroupFromText(team.age_group) ?? parseAgeGroupFromText(team.name);
}

/** Formats a canonical AgeGroup key into its German display label, preserving legacy free text. */
export function formatTeamAgeGroupLabel(ageGroup: string | undefined | null): string {
  if (!ageGroup) return '';
  const trimmed = ageGroup.trim();
  if (isAgeGroup(trimmed)) {
    return AGE_GROUP_LABELS[trimmed];
  }
  return trimmed;
}
