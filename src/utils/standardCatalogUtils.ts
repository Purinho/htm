import type { Exercise } from '../types/domain';

export interface StandardCatalogFileEntry {
  filename: string;
  count: number;
  titles: string[];
}

export interface StandardCatalogManifest {
  version: number;
  generatedAt: string;
  totalFiles: number;
  totalExercises: number;
  files: StandardCatalogFileEntry[];
}

export interface StandardCatalogMissingFile {
  filename: string;
  totalCount: number;
  missingCount: number;
}

export interface StandardCatalogDelta {
  totalCatalogExercises: number;
  alreadyPresentCount: number;
  missingCount: number;
  missingFiles: StandardCatalogMissingFile[];
  existingNormalizedTitles: Set<string>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeStandardExerciseTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Returns true when the app is running in local/demo mode where standard catalog
 * bulk imports are intentionally disabled.
 */
export function isLocalDemoClub(
  clubId: string | undefined | null,
  authUserId: string | null,
  supabaseConfigured: boolean
): boolean {
  if (!supabaseConfigured || !authUserId || !clubId) return true;
  if (clubId === 'club-sgh-1') return true;
  return !UUID_REGEX.test(clubId);
}

/**
 * Computes which standard exercises from the manifest are not yet present in the club
 * (excluding soft-deleted and other-club records) and lists only files that contain
 * at least one missing exercise.
 */
export function computeStandardCatalogDelta(
  manifest: StandardCatalogManifest,
  existingExercises: Exercise[],
  clubId: string
): StandardCatalogDelta {
  const existingNormalizedTitles = new Set<string>();
  for (const ex of existingExercises) {
    if (ex.club_id === clubId && !ex.is_deleted && ex.title) {
      const normalized = normalizeStandardExerciseTitle(ex.title);
      if (normalized) {
        existingNormalizedTitles.add(normalized);
      }
    }
  }

  const seenCatalogTitles = new Set<string>();
  const missingFiles: StandardCatalogMissingFile[] = [];
  let totalCatalogExercises = 0;
  let alreadyPresentCount = 0;
  let missingCount = 0;

  for (const file of manifest.files) {
    let fileMissingCount = 0;
    for (const rawTitle of file.titles) {
      const normalized = normalizeStandardExerciseTitle(rawTitle);
      if (!normalized || seenCatalogTitles.has(normalized)) continue;
      seenCatalogTitles.add(normalized);
      totalCatalogExercises++;

      if (existingNormalizedTitles.has(normalized)) {
        alreadyPresentCount++;
      } else {
        missingCount++;
        fileMissingCount++;
      }
    }

    if (fileMissingCount > 0) {
      missingFiles.push({
        filename: file.filename,
        totalCount: file.count,
        missingCount: fileMissingCount
      });
    }
  }

  return {
    totalCatalogExercises,
    alreadyPresentCount,
    missingCount,
    missingFiles,
    existingNormalizedTitles
  };
}

/**
 * Filters parsed catalog exercises against an evolving Set of normalized existing titles.
 * Accepted titles are added to the Set to guarantee uniqueness within one import run.
 */
export function filterMissingExercisesForImport(
  parsedExercises: Exercise[],
  existingNormalizedTitles: Set<string>
): Exercise[] {
  const accepted: Exercise[] = [];
  for (const ex of parsedExercises) {
    const normalized = normalizeStandardExerciseTitle(ex.title);
    if (!normalized || existingNormalizedTitles.has(normalized)) {
      continue;
    }
    existingNormalizedTitles.add(normalized);
    accepted.push(ex);
  }
  return accepted;
}
