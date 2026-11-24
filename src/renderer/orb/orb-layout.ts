/**
 * Tracks whether the WINDOW is being resized, so the theme wave is only animated when the orb is where it is going to
 * stay. Only real window resize events count (the observers of the canvas do not, because a theme change or a
 * transition can fire them without any resize). Resize events that arrive while a theme change is under way are
 * ignored, since the change itself (the title bar overlay, a repaint) can cause them. A canvas whose displayed size
 * still differs from the size it was drawn at is a resize that has not been handled yet.
 */
export const ORB_LAYOUT_SETTLE_MS = 150;
/** The canvas size may differ from the drawn size by this many pixels before it counts as a pending resize. */
export const ORB_SIZE_TOLERANCE_PX = 2;

let lastResize = Number.NEGATIVE_INFINITY;
let ignoreUntil = Number.NEGATIVE_INFINITY;
let probe: (() => boolean) | undefined;

/** Called by the window resize event only. */
export const markOrbLayoutChange = (now: number = performance.now()): void => {
  if (now < ignoreUntil) return;
  lastResize = now;
};

/** Drops the resize events of the next `milliseconds`: they belong to a theme change, not to the person resizing. */
export const ignoreOrbLayoutChanges = (milliseconds: number, now: number = performance.now()): void => {
  ignoreUntil = now + milliseconds;
};

/** The orb canvas registers a function that tells whether its displayed size differs from the drawn size (a resize not yet handled). */
export const registerOrbLayoutProbe = (fn: () => boolean): (() => void) => {
  probe = fn;
  return () => { if (probe === fn) probe = undefined; };
};

export const isOrbLayoutSettling = (now: number = performance.now()): boolean => {
  if (now - lastResize < ORB_LAYOUT_SETTLE_MS) return true;
  try { return probe?.() ?? false; } catch { return false; }
};

/** For tests. */
export const resetOrbLayoutTracking = (): void => {
  lastResize = Number.NEGATIVE_INFINITY;
  ignoreUntil = Number.NEGATIVE_INFINITY;
  probe = undefined;
};
