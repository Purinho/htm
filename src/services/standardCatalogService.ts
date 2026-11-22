import { db } from '../db/database';
import { parseAndNormalizeAiExerciseJson } from '../utils/aiExerciseImport';
import {
  computeStandardCatalogDelta,
  filterMissingExercisesForImport,
  isLocalDemoClub,
  type StandardCatalogManifest
} from '../utils/standardCatalogUtils';
import type { Exercise } from '../types/domain';
import { flushSyncOutboxToCloud, isValidUuid } from './cloudSyncService';
import { isSupabaseConfigured } from './supabaseClient';

const FETCH_CONCURRENCY = 6;

let cachedManifest: StandardCatalogManifest | null = null;
let manifestInFlight: Promise<StandardCatalogManifest> | null = null;

function getCatalogBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}catalog/`;
}

export async function fetchStandardCatalogManifest(
  forceRefresh = false
): Promise<StandardCatalogManifest> {
  if (cachedManifest && !forceRefresh) {
    return cachedManifest;
  }
  if (manifestInFlight && !forceRefresh) {
    return manifestInFlight;
  }

  const promise = (async () => {
    const response = await fetch(`${getCatalogBaseUrl()}manifest.json`, {
      cache: forceRefresh ? 'no-cache' : 'default'
    });
    if (!response.ok) {
      throw new Error(
        `Standard-Katalog-Manifest konnte nicht geladen werden (HTTP ${response.status}).`
      );
    }
    const data = (await response.json()) as StandardCatalogManifest;
    if (!data || !Array.isArray(data.files)) {
      throw new Error('Ungültiges Format im Standard-Katalog-Manifest.');
    }
    cachedManifest = data;
    return data;
  })();

  manifestInFlight = promise;
  try {
    return await promise;
  } finally {
    if (manifestInFlight === promise) {
      manifestInFlight = null;
    }
  }
}

export type StandardCatalogImportPhase =
  | 'PREPARING'
  | 'FETCHING'
  | 'SAVING_LOCAL'
  | 'SYNCING_CLOUD'
  | 'DONE';

export interface StandardCatalogImportProgress {
  phase: StandardCatalogImportPhase;
  totalFiles: number;
  processedFiles: number;
  totalExercises: number;
  importedExercises: number;
  syncedCount: number;
  syncTotalCount: number;
}

export interface StandardCatalogImportResult {
  totalCatalogExercises: number;
  alreadyPresentCount: number;
  importedCount: number;
  skippedCount: number;
  syncedToCloudCount: number;
  syncErrorMessage?: string;
}

export interface ImportStandardCatalogParams {
  clubId: string;
  authUserId: string | null;
  createdByMemberId?: string;
  onProgress?: (progress: StandardCatalogImportProgress) => void;
}

export async function importMissingStandardExercisesForClub({
  clubId,
  authUserId,
  createdByMemberId,
  onProgress
}: ImportStandardCatalogParams): Promise<StandardCatalogImportResult> {
  if (isLocalDemoClub(clubId, authUserId, isSupabaseConfigured())) {
    throw new Error('Der Standard-Übungskatalog-Import ist im lokalen Demo-Modus nicht verfügbar.');
  }

  onProgress?.({
    phase: 'PREPARING',
    totalFiles: 0,
    processedFiles: 0,
    totalExercises: 0,
    importedExercises: 0,
    syncedCount: 0,
    syncTotalCount: 0
  });

  const manifest = await fetchStandardCatalogManifest();
  const existingClubExercises = await db.exercises.where('club_id').equals(clubId).toArray();
  const delta = computeStandardCatalogDelta(manifest, existingClubExercises, clubId);

  if (delta.missingCount === 0 || delta.missingFiles.length === 0) {
    onProgress?.({
      phase: 'DONE',
      totalFiles: 0,
      processedFiles: 0,
      totalExercises: delta.totalCatalogExercises,
      importedExercises: 0,
      syncedCount: 0,
      syncTotalCount: 0
    });
    return {
      totalCatalogExercises: delta.totalCatalogExercises,
      alreadyPresentCount: delta.alreadyPresentCount,
      importedCount: 0,
      skippedCount: delta.alreadyPresentCount,
      syncedToCloudCount: 0
    };
  }

  const baseUrl = getCatalogBaseUrl();
  const totalFiles = delta.missingFiles.length;
  let processedFiles = 0;
  const parsedByFile: Exercise[][] = new Array(totalFiles);

  const safeCreatorId =
    createdByMemberId && isValidUuid(createdByMemberId) ? createdByMemberId : undefined;

  for (let start = 0; start < totalFiles; start += FETCH_CONCURRENCY) {
    const batchFiles = delta.missingFiles.slice(start, start + FETCH_CONCURRENCY);
    await Promise.all(
      batchFiles.map(async (fileEntry, offset) => {
        const res = await fetch(`${baseUrl}${encodeURIComponent(fileEntry.filename)}`);
        if (!res.ok) {
          throw new Error(
            `Katalog-Paket "${fileEntry.filename}" konnte nicht geladen werden (HTTP ${res.status}).`
          );
        }
        const rawText = await res.text();
        // Explicitly disable auto-animation during standard catalog import
        const normalized = parseAndNormalizeAiExerciseJson(
          rawText,
          clubId,
          'CLUB',
          undefined,
          false
        ).map((ex) => ({
          ...ex,
          ...(safeCreatorId ? { created_by_member_id: safeCreatorId } : {}),
          is_favorite: false
        }));
        parsedByFile[start + offset] = normalized;
        processedFiles++;
        onProgress?.({
          phase: 'FETCHING',
          totalFiles,
          processedFiles,
          totalExercises: delta.missingCount,
          importedExercises: 0,
          syncedCount: 0,
          syncTotalCount: delta.missingCount
        });
      })
    );
  }

  const existingTitles = new Set<string>(delta.existingNormalizedTitles);
  const exercisesToImport: Exercise[] = [];
  for (const fileExercises of parsedByFile) {
    if (!fileExercises) continue;
    const filtered = filterMissingExercisesForImport(fileExercises, existingTitles);
    exercisesToImport.push(...filtered);
  }

  if (exercisesToImport.length === 0) {
    onProgress?.({
      phase: 'DONE',
      totalFiles,
      processedFiles: totalFiles,
      totalExercises: delta.totalCatalogExercises,
      importedExercises: 0,
      syncedCount: 0,
      syncTotalCount: 0
    });
    return {
      totalCatalogExercises: delta.totalCatalogExercises,
      alreadyPresentCount: delta.alreadyPresentCount,
      importedCount: 0,
      skippedCount: delta.alreadyPresentCount,
      syncedToCloudCount: 0
    };
  }

  onProgress?.({
    phase: 'SAVING_LOCAL',
    totalFiles,
    processedFiles: totalFiles,
    totalExercises: exercisesToImport.length,
    importedExercises: exercisesToImport.length,
    syncedCount: 0,
    syncTotalCount: exercisesToImport.length
  });

  const queuedAt = new Date().toISOString();
  await db.transaction('rw', [db.exercises, db.syncOutbox], async () => {
    await db.exercises.bulkPut(exercisesToImport);
    await db.syncOutbox.bulkAdd(
      exercisesToImport.map((ex) => ({
        entity_table: 'exercises',
        entity_id: ex.id,
        operation: 'UPSERT' as const,
        payload_json: JSON.stringify(ex),
        created_at: queuedAt,
        synced: 0
      }))
    );
  });

  onProgress?.({
    phase: 'SYNCING_CLOUD',
    totalFiles,
    processedFiles: totalFiles,
    totalExercises: exercisesToImport.length,
    importedExercises: exercisesToImport.length,
    syncedCount: 0,
    syncTotalCount: exercisesToImport.length
  });

  const flushRes = await flushSyncOutboxToCloud({
    onProgress: (processed, total) => {
      onProgress?.({
        phase: 'SYNCING_CLOUD',
        totalFiles,
        processedFiles: totalFiles,
        totalExercises: exercisesToImport.length,
        importedExercises: exercisesToImport.length,
        syncedCount: processed,
        syncTotalCount: total
      });
    }
  });

  onProgress?.({
    phase: 'DONE',
    totalFiles,
    processedFiles: totalFiles,
    totalExercises: exercisesToImport.length,
    importedExercises: exercisesToImport.length,
    syncedCount: flushRes.flushedCount,
    syncTotalCount: exercisesToImport.length
  });

  return {
    totalCatalogExercises: delta.totalCatalogExercises,
    alreadyPresentCount: delta.alreadyPresentCount,
    importedCount: exercisesToImport.length,
    skippedCount: delta.alreadyPresentCount,
    syncedToCloudCount: flushRes.flushedCount,
    syncErrorMessage:
      flushRes.failedCount > 0
        ? flushRes.lastErrorMessage ?? `${flushRes.failedCount} Übungen konnten noch nicht synchronisiert werden.`
        : undefined
  };
}
