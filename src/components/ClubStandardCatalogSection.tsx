import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Check, Download, Loader2, RefreshCw } from 'lucide-react';
import type { Club, Exercise } from '../types/domain';
import {
  fetchStandardCatalogManifest,
  importMissingStandardExercisesForClub,
  type StandardCatalogImportProgress
} from '../services/standardCatalogService';
import {
  computeStandardCatalogDelta,
  type StandardCatalogManifest
} from '../utils/standardCatalogUtils';

interface ClubStandardCatalogSectionProps {
  club: Club;
  clubExercises: Exercise[];
  authUserId: string | null;
  currentMemberId?: string;
  onCatalogImported?: (summaryMessage: string) => void;
}

function formatProgressLabel(progress: StandardCatalogImportProgress | null): {
  label: string;
  percent: number;
} {
  if (!progress) {
    return { label: 'Bereite Import vor…', percent: 5 };
  }
  switch (progress.phase) {
    case 'PREPARING':
      return { label: 'Prüfe fehlende Übungen…', percent: 10 };
    case 'FETCHING': {
      const ratio =
        progress.totalFiles > 0 ? progress.processedFiles / progress.totalFiles : 0;
      return {
        label: `Katalog-Pakete laden (${progress.processedFiles}/${progress.totalFiles})…`,
        percent: Math.round(10 + ratio * 35)
      };
    }
    case 'SAVING_LOCAL':
      return {
        label: `Speichere ${progress.importedExercises} Übungen lokal…`,
        percent: 50
      };
    case 'SYNCING_CLOUD': {
      const ratio =
        progress.syncTotalCount > 0 ? progress.syncedCount / progress.syncTotalCount : 1;
      return {
        label: `Cloud-Sync (${progress.syncedCount}/${progress.syncTotalCount})…`,
        percent: Math.round(50 + ratio * 50)
      };
    }
    case 'DONE':
      return { label: 'Abgeschlossen', percent: 100 };
  }
}

export function ClubStandardCatalogSection({
  club,
  clubExercises,
  authUserId,
  currentMemberId,
  onCatalogImported
}: ClubStandardCatalogSectionProps) {
  const [manifest, setManifest] = useState<StandardCatalogManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestRetryKey, setManifestRetryKey] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<StandardCatalogImportProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setProgress(null);
  }, [club.id]);

  useEffect(() => {
    let cancelled = false;
    setManifestLoading(true);
    setManifestError(null);
    void fetchStandardCatalogManifest(true)
      .then((data) => {
        if (!cancelled) {
          setManifest(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setManifestError(
            err instanceof Error
              ? err.message
              : 'Standard-Übungskatalog konnte nicht geladen werden.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setManifestLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [club.id, manifestRetryKey]);

  const delta = useMemo(() => {
    if (!manifest) return null;
    return computeStandardCatalogDelta(manifest, clubExercises, club.id);
  }, [manifest, clubExercises, club.id]);

  async function handleImportMissing() {
    if (isBusy || !delta || delta.missingCount === 0) return;
    setIsBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setProgress({
      phase: 'PREPARING',
      totalFiles: 0,
      processedFiles: 0,
      totalExercises: delta.missingCount,
      importedExercises: 0,
      syncedCount: 0,
      syncTotalCount: delta.missingCount
    });

    try {
      const res = await importMissingStandardExercisesForClub({
        clubId: club.id,
        authUserId,
        createdByMemberId: currentMemberId,
        onProgress: setProgress
      });

      const summary =
        res.importedCount === 0
          ? `Alle ${res.totalCatalogExercises} Standard-Übungen sind bereits im Verein vorhanden.`
          : res.syncErrorMessage
            ? `✓ ${res.importedCount} fehlende Standard-Übungen lokal übernommen (${res.skippedCount} bereits vorhanden). Cloud-Sync Hinweis: ${res.syncErrorMessage}`
            : `✓ ${res.importedCount} Standard-Übungen erfolgreich in „${club.name}“ eingespielt und synchronisiert (${res.skippedCount} bereits vorhanden).`;

      setSuccessMsg(summary);
      onCatalogImported?.(summary);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Import des Standard-Übungskatalogs fehlgeschlagen.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  const progressInfo = isBusy ? formatProgressLabel(progress) : null;

  return (
    <section className="rounded-2xl border border-blue-500/35 bg-blue-950/10 p-6 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-blue-500/20 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
            <BookOpenCheck className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold tracking-wider text-blue-400 uppercase">
              Admin-Bereich · Übungskatalog
            </span>
            <h3 className="text-lg font-bold text-white">
              Standard-Übungskatalog (Delta-Abgleich)
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Spielt fehlende Standard-Übungen als editierbare Vereins-Übungen ein. Bestehende Übungen bleiben unverändert.
            </p>
          </div>
        </div>

        {delta && (
          <span className="rounded-full border border-blue-500/40 bg-blue-950/60 px-3 py-1 text-xs font-bold text-blue-200">
            {delta.alreadyPresentCount} / {delta.totalCatalogExercises} im Verein
          </span>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {manifestLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            Prüfe verfügbaren Standard-Übungskatalog…
          </div>
        )}

        {manifestError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
            <span>{manifestError}</span>
            <button
              type="button"
              disabled={manifestLoading}
              onClick={() => setManifestRetryKey((prev) => prev + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Erneut versuchen
            </button>
          </div>
        )}

        {!manifestLoading && delta && (
          <>
            {delta.missingCount === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-4 text-xs text-emerald-200">
                <div className="flex items-center gap-2 font-semibold">
                  <Check className="h-4 w-4 text-emerald-400" />
                  Alle {delta.totalCatalogExercises} Standard-Übungen sind bereits im Verein vorhanden.
                </div>
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 opacity-60"
                >
                  <Check className="h-4 w-4" />
                  Katalog vollständig
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="space-y-1 text-xs text-slate-300">
                  <div className="font-semibold text-white">
                    {delta.missingCount} fehlende Standard-Übung(en) in {delta.missingFiles.length} Paket(en) gefunden
                  </div>
                  <p className="text-slate-400">
                    Nur die noch nicht vorhandenen Übungen werden als{' '}
                    <strong className="text-slate-200">Vereinsweit (CLUB)</strong> importiert (ohne Auto-Animation).
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleImportMissing()}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {delta.alreadyPresentCount === 0
                    ? `Kompletten Standardkatalog einspielen (${delta.missingCount} Übungen)`
                    : `${delta.missingCount} fehlende Standard-Übungen nachladen`}
                </button>
              </div>
            )}
          </>
        )}

        {progressInfo && (
          <div className="space-y-1.5 rounded-xl border border-blue-500/30 bg-slate-950/80 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-200">{progressInfo.label}</span>
              <span className="font-mono text-blue-300">{progressInfo.percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-200"
                style={{ width: `${progressInfo.percent}%` }}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>
    </section>
  );
}
