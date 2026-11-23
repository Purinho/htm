interface OverlayHistoryEntry {
  id: string;
  onClose: () => void;
}

const overlayStack: OverlayHistoryEntry[] = [];
const pendingCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();
let suppressNextPopStateCount = 0;

function getOverlayIdFromState(state: unknown): string | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const val = (state as { __overlayId?: unknown }).__overlayId;
  return typeof val === 'string' ? val : undefined;
}

function clearPendingTimer(id: string): void {
  const timer = pendingCloseTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingCloseTimers.delete(id);
  }
}

function removeOverlayEntry(id: string): OverlayHistoryEntry | undefined {
  const idx = overlayStack.findIndex((entry) => entry.id === id);
  if (idx === -1) return undefined;
  const [removed] = overlayStack.splice(idx, 1);
  return removed;
}

/**
 * Pushes a dedicated browser history entry for a fullscreen/modal overlay so
 * hardware/OS Back gestures close the overlay before navigating away from the current tab.
 */
export function pushOverlayHistory(id: string, onClose: () => void): boolean {
  if (typeof window === 'undefined' || !window.history) return false;
  try {
    const existingState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    window.history.pushState(
      { ...existingState, __overlayId: id },
      '',
      window.location.href
    );
    overlayStack.push({ id, onClose });
    return true;
  } catch {
    return false;
  }
}

/**
 * Requests closing an overlay initiated by in-app UI (e.g. Close button or Escape).
 * Pops the synthetic history entry via `history.back()` so `popstate` closes it cleanly
 * without leaving stale forward entries.
 */
export function requestOverlayClose(id: string, fallbackClose: () => void): void {
  if (typeof window === 'undefined' || !window.history) {
    removeOverlayEntry(id);
    clearPendingTimer(id);
    fallbackClose();
    return;
  }

  const top = overlayStack[overlayStack.length - 1];
  const currentOverlayId = getOverlayIdFromState(window.history.state);

  if (top?.id === id && currentOverlayId === id) {
    clearPendingTimer(id);
    const timer = setTimeout(() => {
      pendingCloseTimers.delete(id);
      const removed = removeOverlayEntry(id);
      if (removed) {
        removed.onClose();
      } else {
        fallbackClose();
      }
    }, 150);
    pendingCloseTimers.set(id, timer);
    try {
      window.history.back();
    } catch {
      clearPendingTimer(id);
      removeOverlayEntry(id);
      fallbackClose();
    }
    return;
  }

  clearPendingTimer(id);
  removeOverlayEntry(id);
  fallbackClose();
}

/**
 * Cleans up an overlay's history entry on unmount or programmatic close without
 * triggering a redundant tab navigation in App's popstate listener.
 */
export function cleanupOverlayHistory(id: string): void {
  clearPendingTimer(id);
  const removed = removeOverlayEntry(id);
  if (!removed || typeof window === 'undefined' || !window.history) return;

  if (getOverlayIdFromState(window.history.state) === id) {
    suppressNextPopStateCount++;
    try {
      window.history.back();
    } catch {
      suppressNextPopStateCount = Math.max(0, suppressNextPopStateCount - 1);
    }
  }
}

/**
 * Handles a browser `popstate` event if an overlay owns the popped history entry.
 * Returns `true` when the event was consumed and App tab navigation should be skipped.
 */
export function handleOverlayPopState(state: unknown): boolean {
  if (suppressNextPopStateCount > 0) {
    suppressNextPopStateCount--;
    return true;
  }

  if (overlayStack.length === 0) return false;

  const top = overlayStack[overlayStack.length - 1];
  if (getOverlayIdFromState(state) !== top.id) {
    overlayStack.pop();
    clearPendingTimer(top.id);
    top.onClose();
    return true;
  }

  return false;
}

export function resetOverlayHistoryForTests(): void {
  for (const timer of pendingCloseTimers.values()) {
    clearTimeout(timer);
  }
  pendingCloseTimers.clear();
  overlayStack.length = 0;
  suppressNextPopStateCount = 0;
}
