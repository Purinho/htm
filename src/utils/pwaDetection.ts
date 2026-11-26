export const INSTALLED_DISPLAY_MODES = [
  'standalone',
  'fullscreen',
  'minimal-ui',
  'window-controls-overlay'
] as const;

export interface PwaDetectionEnvironment {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
  referrer?: string;
}

/**
 * Detects whether the application is running inside an installed PWA container
 * (standalone/fullscreen/minimal-ui/WCO display mode, iOS standalone, or Android TWA)
 * rather than a regular browser tab.
 */
export function detectInstalledPwa(env?: PwaDetectionEnvironment): boolean {
  if (!env && typeof window === 'undefined') {
    return false;
  }

  const matchMedia = env
    ? env.matchMedia
    : typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : undefined;

  const nav = env
    ? env.navigator
    : (window.navigator as Navigator & { standalone?: boolean });

  const referrer = env
    ? env.referrer
    : typeof document !== 'undefined'
      ? document.referrer
      : '';

  if (
    matchMedia &&
    INSTALLED_DISPLAY_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches)
  ) {
    return true;
  }

  if (nav?.standalone === true) {
    return true;
  }

  if ((referrer ?? '').startsWith('android-app://')) {
    return true;
  }

  return false;
}
