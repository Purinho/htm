import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOverlayHistory,
  handleOverlayPopState,
  pushOverlayHistory,
  requestOverlayClose,
  resetOverlayHistoryForTests
} from './overlayHistory';

interface HistoryFrame {
  state: unknown;
  url: string;
}

function installMockWindowHistory(initialState: unknown = { tab: 'HALL_LIVE' }) {
  const entries: HistoryFrame[] = [{ state: initialState, url: '#hall_live' }];
  let cursor = 0;

  const historyMock = {
    get state() {
      return entries[cursor]?.state ?? null;
    },
    pushState(state: unknown, _title: string, url?: string | URL | null) {
      entries.splice(cursor + 1);
      entries.push({ state, url: String(url ?? entries[cursor]?.url ?? '') });
      cursor = entries.length - 1;
    },
    back() {
      if (cursor > 0) {
        cursor--;
        handleOverlayPopState(entries[cursor]?.state ?? null);
      }
    }
  };

  vi.stubGlobal('window', {
    history: historyMock,
    location: { href: 'http://localhost/#hall_live' }
  });

  return {
    historyMock,
    entries,
    getCursor: () => cursor,
    simulateHardwareBack: () => {
      if (cursor > 0) {
        cursor--;
        return handleOverlayPopState(entries[cursor]?.state ?? null);
      }
      return false;
    }
  };
}

describe('overlayHistory', () => {
  beforeEach(() => {
    resetOverlayHistoryForTests();
  });

  afterEach(() => {
    resetOverlayHistoryForTests();
    vi.unstubAllGlobals();
  });

  it('closes fullscreen overlay on hardware back and keeps the user in HALL_LIVE', () => {
    const mock = installMockWindowHistory({ tab: 'HALL_LIVE' });
    let chalkboardOpen = true;
    const closeChalkboard = vi.fn(() => {
      chalkboardOpen = false;
    });

    const pushed = pushOverlayHistory('chalkboard-1', closeChalkboard);
    expect(pushed).toBe(true);
    expect(mock.entries).toHaveLength(2);
    expect(mock.historyMock.state).toEqual({
      tab: 'HALL_LIVE',
      __overlayId: 'chalkboard-1'
    });

    // First Back press: consumed by overlay, closes modal, does NOT leave HALL_LIVE
    const consumedFirstBack = mock.simulateHardwareBack();
    expect(consumedFirstBack).toBe(true);
    expect(closeChalkboard).toHaveBeenCalledTimes(1);
    expect(chalkboardOpen).toBe(false);
    expect(mock.historyMock.state).toEqual({ tab: 'HALL_LIVE' });

    // Second Back press: no overlay left, App handles tab navigation back to DASHBOARD
    const consumedSecondBack = mock.simulateHardwareBack();
    expect(consumedSecondBack).toBe(false);
  });

  it('pops history entry cleanly when user clicks in-app Schließen button', () => {
    const mock = installMockWindowHistory({ tab: 'HALL_LIVE' });
    const closeChalkboard = vi.fn();

    pushOverlayHistory('chalkboard-2', closeChalkboard);
    expect(mock.getCursor()).toBe(1);

    requestOverlayClose('chalkboard-2', closeChalkboard);
    expect(closeChalkboard).toHaveBeenCalledTimes(1);
    expect(mock.getCursor()).toBe(0);
    expect(mock.historyMock.state).toEqual({ tab: 'HALL_LIVE' });
    expect(handleOverlayPopState({ tab: 'DASHBOARD' })).toBe(false);
  });

  it('cleans up history entry on programmatic unmount without triggering App back navigation', () => {
    const mock = installMockWindowHistory({ tab: 'HALL_LIVE' });
    const closeChalkboard = vi.fn();

    pushOverlayHistory('chalkboard-3', closeChalkboard);
    expect(mock.getCursor()).toBe(1);

    cleanupOverlayHistory('chalkboard-3');
    expect(closeChalkboard).not.toHaveBeenCalled();
    expect(mock.getCursor()).toBe(0);
    expect(mock.historyMock.state).toEqual({ tab: 'HALL_LIVE' });
  });
});
