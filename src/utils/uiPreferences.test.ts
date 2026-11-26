import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURES_ENABLED,
  UI_PREFERENCES_STORAGE_KEY,
  applyUiPreset,
  countEnabledFeatures,
  createDefaultUiPreferences,
  getFallbackTabIfDisabled,
  loadUiPreferences,
  saveUiPreferences,
  toggleUiFeature,
  type StorageLike
} from './uiPreferences';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    }
  };
}

describe('uiPreferences', () => {
  it('returns default PRO preferences when storage is empty or corrupted', () => {
    const storage = createMemoryStorage();
    const emptyPrefs = loadUiPreferences(storage);
    expect(emptyPrefs.activePreset).toBe('PRO');
    expect(emptyPrefs.tourCompleted).toBe(false);
    expect(emptyPrefs.features).toEqual(ALL_FEATURES_ENABLED);

    storage.setItem(UI_PREFERENCES_STORAGE_KEY, '{broken-json');
    const fallbackPrefs = loadUiPreferences(storage);
    expect(fallbackPrefs.activePreset).toBe('PRO');
    expect(fallbackPrefs.features.aiImport).toBe(true);
  });

  it('applies presets and persists changes to storage', () => {
    const storage = createMemoryStorage();
    const base = createDefaultUiPreferences();
    const minimal = applyUiPreset(base, 'MINIMAL');
    expect(minimal.activePreset).toBe('MINIMAL');
    expect(minimal.features.hallLiveMode).toBe(true);
    expect(minimal.features.aiImport).toBe(false);
    expect(minimal.features.clubAdmin).toBe(false);

    const custom = toggleUiFeature(minimal, 'aiImport', true);
    expect(custom.activePreset).toBe('CUSTOM');
    expect(custom.features.aiImport).toBe(true);

    saveUiPreferences({ ...custom, tourCompleted: true }, storage);
    const reloaded = loadUiPreferences(storage);
    expect(reloaded.tourCompleted).toBe(true);
    expect(reloaded.activePreset).toBe('CUSTOM');
    expect(reloaded.features.aiImport).toBe(true);
    expect(reloaded.features.clubAdmin).toBe(false);
    expect(countEnabledFeatures(reloaded.features)).toBe(3);
  });

  it('falls back to DASHBOARD when active tab feature is disabled', () => {
    const minimal = applyUiPreset(createDefaultUiPreferences(), 'MINIMAL');
    expect(getFallbackTabIfDisabled('HALL_LIVE', minimal.features)).toBe('HALL_LIVE');
    expect(getFallbackTabIfDisabled('PLANS', minimal.features)).toBe('DASHBOARD');
    expect(getFallbackTabIfDisabled('CLUB_ADMIN', minimal.features)).toBe('DASHBOARD');
    expect(getFallbackTabIfDisabled('EXERCISES', minimal.features)).toBe('EXERCISES');
  });

  it('ignores deprecated pwaInstall and cloudSync keys when loading legacy preferences', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        features: { pwaInstall: false, cloudSync: false, aiImport: false },
        activePreset: 'CUSTOM',
        tourCompleted: true
      })
    );
    const loaded = loadUiPreferences(storage);
    expect('pwaInstall' in loaded.features).toBe(false);
    expect('cloudSync' in loaded.features).toBe(false);
    expect(loaded.features.aiImport).toBe(false);
    expect(loaded.tourCompleted).toBe(true);
  });
});
