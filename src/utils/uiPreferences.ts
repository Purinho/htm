export type UiFeatureKey =
  | 'hallLiveMode'
  | 'multiWeekPlans'
  | 'clubAdmin'
  | 'aiImport'
  | 'printExport'
  | 'exerciseVariants'
  | 'tacticAnimation'
  | 'advancedFilters'
  | 'favorites'
  | 'backupExport';

export type UiPresetKey = 'MINIMAL' | 'STANDARD' | 'PRO' | 'CUSTOM';

export type UiFeatureCategory = 'MODULES' | 'TOOLS' | 'CATALOG' | 'SYSTEM';

export interface UiFeatureDefinition {
  key: UiFeatureKey;
  label: string;
  category: UiFeatureCategory;
  description: string;
  affectsUi: string;
}

export interface UiPreferences {
  features: Record<UiFeatureKey, boolean>;
  tourCompleted: boolean;
  activePreset: UiPresetKey;
  updatedAt: string;
}

export const UI_PREFERENCES_STORAGE_KEY = 'htm_ui_preferences_v1';

export const UI_FEATURE_CATEGORY_LABELS: Record<UiFeatureCategory, string> = {
  MODULES: 'Hauptbereiche & Navigation',
  TOOLS: 'Werkzeuge & Aktionen',
  CATALOG: 'Übungsdatenbank & Filter',
  SYSTEM: 'Backup & Datensicherung'
};

export const UI_FEATURE_DEFINITIONS: UiFeatureDefinition[] = [
  {
    key: 'hallLiveMode',
    label: 'Sporthallen-Modus (Live)',
    category: 'MODULES',
    description: 'Live-Ansicht für die Halle mit Timer, Taktik-Tafel und Hallen-Notizen.',
    affectsUi: 'Navigation „Sporthallen-Modus“, Topbar-Button „Hallen-Modus“, Mobile-Tab'
  },
  {
    key: 'multiWeekPlans',
    label: 'Mehrwochenplan (Mesozyklus)',
    category: 'MODULES',
    description: 'Wochen- und Saisonplanung mit Schwerpunkten über mehrere Wochen.',
    affectsUi: 'Navigation „Mehrwochenplan“, Mobile-Tab „Wochenplan“'
  },
  {
    key: 'clubAdmin',
    label: 'Verein, Teams & Trainer',
    category: 'MODULES',
    description: 'Verwaltung mehrerer Mannschaften, Trainerrollen und Vereins-Einladungen.',
    affectsUi: 'Navigation „Verein, Teams & Trainer“, Mobile-Tab „Verein“'
  },
  {
    key: 'aiImport',
    label: 'KI-JSON Import & Prompt-Generator',
    category: 'TOOLS',
    description: 'Übungen aus Texten, PDFs oder ChatGPT-JSON direkt importieren.',
    affectsUi: 'Topbar-Button „KI-JSON Import“, Button in der Übungsdatenbank'
  },
  {
    key: 'printExport',
    label: 'Druck- & PDF-Export',
    category: 'TOOLS',
    description: 'A4-Hallen-Handouts und einzelne Übungskarten drucken oder als PDF speichern.',
    affectsUi: 'Buttons „PDF / Drucken“ im Trainingsplaner & Übungsdetail'
  },
  {
    key: 'exerciseVariants',
    label: 'Übungs-Varianten (Ableiten)',
    category: 'TOOLS',
    description: 'Neue Varianten bestehender Übungen mit Eltern-Verknüpfung erstellen.',
    affectsUi: 'Button „Variante“ in der Übungsdetail-Ansicht'
  },
  {
    key: 'tacticAnimation',
    label: 'Animiertes Taktikboard (Szenen & Play)',
    category: 'TOOLS',
    description: 'Schrittweise Spieler-/Ball-Animationen abspielen (deaktiviert = statische Skizze).',
    affectsUi: 'Play/Pause-Steuerung in der Übungsvorschau'
  },
  {
    key: 'advancedFilters',
    label: 'Erweiterte Übungsfilter',
    category: 'CATALOG',
    description: 'Detailfilter für Sichtbarkeit, Phase, Schwerpunkt, Level, Spielerzahl & Alter.',
    affectsUi: 'Filter-Leiste & Mobile-Filter-Button (Suche bleibt immer aktiv)'
  },
  {
    key: 'favorites',
    label: 'Favoriten-Markierung',
    category: 'CATALOG',
    description: 'Lieblingsübungen mit Stern markieren und schnell danach filtern.',
    affectsUi: 'Stern-Buttons in Übungsliste, Detailansicht & Suchleiste'
  },
  {
    key: 'backupExport',
    label: 'JSON-Vollbackup',
    category: 'SYSTEM',
    description: 'Komplette lokale Vereinsdatenbank als JSON-Datei sichern.',
    affectsUi: 'Button „Backup“ in der Sidebar'
  }
];

export const ALL_FEATURES_ENABLED: Record<UiFeatureKey, boolean> = {
  hallLiveMode: true,
  multiWeekPlans: true,
  clubAdmin: true,
  aiImport: true,
  printExport: true,
  exerciseVariants: true,
  tacticAnimation: true,
  advancedFilters: true,
  favorites: true,
  backupExport: true
};

export const UI_PRESETS: Record<
  Exclude<UiPresetKey, 'CUSTOM'>,
  {
    label: string;
    subtitle: string;
    badge: string;
    features: Record<UiFeatureKey, boolean>;
  }
> = {
  MINIMAL: {
    label: 'Fokus / Minimal',
    subtitle: 'Nur Trainings-Planer, Sporthallen-Modus & einfache Übungssuche. Ideal für ein extrem aufgeräumtes UI.',
    badge: 'Weniger ist mehr',
    features: {
      hallLiveMode: true,
      multiWeekPlans: false,
      clubAdmin: false,
      aiImport: false,
      printExport: false,
      exerciseVariants: false,
      tacticAnimation: false,
      advancedFilters: false,
      favorites: true,
      backupExport: false
    }
  },
  STANDARD: {
    label: 'Standard (Trainer & Jugend)',
    subtitle: 'Planer, Hallen-Modus, Wochenplan, Druck/PDF, Filter & Favoriten – ohne KI-Import & Admin-Extras.',
    badge: 'Empfohlen',
    features: {
      hallLiveMode: true,
      multiWeekPlans: true,
      clubAdmin: false,
      aiImport: false,
      printExport: true,
      exerciseVariants: true,
      tacticAnimation: true,
      advancedFilters: true,
      favorites: true,
      backupExport: false
    }
  },
  PRO: {
    label: 'Alle Funktionen (Profi / Admin)',
    subtitle: 'Voller Funktionsumfang inkl. KI-Import, Vereinsverwaltung, Backup & allen Taktik-Features.',
    badge: '100% Features',
    features: { ...ALL_FEATURES_ENABLED }
  }
};

export function createDefaultUiPreferences(): UiPreferences {
  return {
    features: { ...ALL_FEATURES_ENABLED },
    tourCompleted: false,
    activePreset: 'PRO',
    updatedAt: new Date().toISOString()
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageLike | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

export function loadUiPreferences(storage: StorageLike | undefined = getDefaultStorage()): UiPreferences {
  try {
    const raw = storage?.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return createDefaultUiPreferences();
    }
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    const mergedFeatures: Record<UiFeatureKey, boolean> = { ...ALL_FEATURES_ENABLED };
    if (parsed.features && typeof parsed.features === 'object') {
      for (const key of Object.keys(ALL_FEATURES_ENABLED) as UiFeatureKey[]) {
        if (typeof parsed.features[key] === 'boolean') {
          mergedFeatures[key] = parsed.features[key];
        }
      }
    }
    return {
      features: mergedFeatures,
      tourCompleted: Boolean(parsed.tourCompleted),
      activePreset:
        parsed.activePreset && ['MINIMAL', 'STANDARD', 'PRO', 'CUSTOM'].includes(parsed.activePreset)
          ? parsed.activePreset
          : 'CUSTOM',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return createDefaultUiPreferences();
  }
}

export function saveUiPreferences(
  prefs: UiPreferences,
  storage: StorageLike | undefined = getDefaultStorage()
): UiPreferences {
  const next: UiPreferences = {
    ...prefs,
    updatedAt: new Date().toISOString()
  };
  try {
    storage?.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors in private browsing
  }
  return next;
}

export function applyUiPreset(
  current: UiPreferences,
  preset: Exclude<UiPresetKey, 'CUSTOM'>
): UiPreferences {
  return {
    ...current,
    features: { ...UI_PRESETS[preset].features },
    activePreset: preset,
    updatedAt: new Date().toISOString()
  };
}

export function toggleUiFeature(
  current: UiPreferences,
  key: UiFeatureKey,
  enabled?: boolean
): UiPreferences {
  const nextValue = typeof enabled === 'boolean' ? enabled : !current.features[key];
  const nextFeatures: Record<UiFeatureKey, boolean> = {
    ...current.features,
    [key]: nextValue
  };
  return {
    ...current,
    features: nextFeatures,
    activePreset: 'CUSTOM',
    updatedAt: new Date().toISOString()
  };
}

export function countEnabledFeatures(features: Record<UiFeatureKey, boolean>): number {
  return Object.values(features).filter(Boolean).length;
}

export type AppNavTab = 'DASHBOARD' | 'HALL_LIVE' | 'EXERCISES' | 'PLANS' | 'CLUB_ADMIN';

export function getFallbackTabIfDisabled(
  activeTab: AppNavTab,
  features: Record<UiFeatureKey, boolean>
): AppNavTab {
  if (activeTab === 'HALL_LIVE' && !features.hallLiveMode) return 'DASHBOARD';
  if (activeTab === 'PLANS' && !features.multiWeekPlans) return 'DASHBOARD';
  if (activeTab === 'CLUB_ADMIN' && !features.clubAdmin) return 'DASHBOARD';
  return activeTab;
}
