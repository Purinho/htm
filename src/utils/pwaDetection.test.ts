import { describe, expect, it } from 'vitest';
import { INSTALLED_DISPLAY_MODES, detectInstalledPwa } from './pwaDetection';

describe('detectInstalledPwa', () => {
  it('returns false in a regular web browser', () => {
    expect(
      detectInstalledPwa({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
        referrer: 'https://example.com/'
      })
    ).toBe(false);
  });

  it.each(INSTALLED_DISPLAY_MODES)(
    'returns true when display-mode %s matches',
    (mode) => {
      expect(
        detectInstalledPwa({
          matchMedia: (query) => ({ matches: query === `(display-mode: ${mode})` }),
          navigator: {},
          referrer: ''
        })
      ).toBe(true);
    }
  );

  it('returns true when iOS navigator.standalone is true', () => {
    expect(
      detectInstalledPwa({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
        referrer: ''
      })
    ).toBe(true);
  });

  it('returns true when launched from an Android TWA referrer', () => {
    expect(
      detectInstalledPwa({
        matchMedia: () => ({ matches: false }),
        navigator: {},
        referrer: 'android-app://org.example.app'
      })
    ).toBe(true);
  });

  it('returns false safely when matchMedia is unavailable', () => {
    expect(
      detectInstalledPwa({
        matchMedia: undefined,
        navigator: {},
        referrer: ''
      })
    ).toBe(false);
  });
});
