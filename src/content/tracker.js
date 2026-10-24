// Counts "active" time: the tab is visible and the user has scrolled
// within the last IDLE_MS. Feeds often scroll an inner container rather
// than the window, so scroll is captured at the window for every element.
(() => {
  const DD = globalThis.DD;
  const SCROLL_KEYS = new Set([
    'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End', 'j', 'k',
  ]);

  DD.Tracker = class {
    constructor() {
      this.lastActivity = -Infinity;
      this.lastTick = performance.now();
      this.pending = 0;

      this.mark = () => (this.lastActivity = performance.now());
      this.onKey = (e) => {
        if (SCROLL_KEYS.has(e.key) && !e.target?.isContentEditable) this.mark();
      };
      const opts = { capture: true, passive: true };
      window.addEventListener('scroll', this.mark, opts);
      window.addEventListener('wheel', this.mark, opts);
      window.addEventListener('touchmove', this.mark, opts);
      window.addEventListener('keydown', this.onKey, opts);
    }

    get active() {
      return (
        document.visibilityState === 'visible' &&
        performance.now() - this.lastActivity < DD.IDLE_MS
      );
    }

    // Called once a second. The gap is capped so a sleeping laptop or a
    // throttled background timer can't credit a burst of phantom time.
    tick() {
      const now = performance.now();
      const dt = Math.min(now - this.lastTick, 2000);
      this.lastTick = now;
      if (this.active) this.pending += dt;
    }

    take() {
      const ms = Math.round(this.pending);
      this.pending = 0;
      return ms;
    }

    destroy() {
      const opts = { capture: true };
      window.removeEventListener('scroll', this.mark, opts);
      window.removeEventListener('wheel', this.mark, opts);
      window.removeEventListener('touchmove', this.mark, opts);
      window.removeEventListener('keydown', this.onKey, opts);
    }
  };
})();
