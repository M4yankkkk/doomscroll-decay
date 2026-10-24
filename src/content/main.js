// Content entry point: ties the tracker, storage and the two renderers
// together. Renders four times a second so demo mode (60x) still moves
// in small steps; storage is only touched once a second while active.
(async () => {
  const DD = globalThis.DD;
  const RENDER_MS = 250;
  const FLUSH_MS = 1000;

  // A previous copy of this script may still be running in this world
  // (re-injection) or have left DOM behind (extension reloaded/updated).
  globalThis.__ddTeardown?.();
  DD.Decay.scrub();
  DD.Overlay.scrub();

  const alive = () => Boolean(chrome.runtime?.id);
  const stored = await chrome.storage.local.get(['settings', 'days', 'demoDays']);
  let cfg = DD.withDefaults(stored.settings);
  const buckets = { days: stored.days || {}, demoDays: stored.demoDays || {} };
  const site = DD.siteForHost(location.hostname, cfg.sites);
  if (!site) return;

  const tracker = new DD.Tracker();
  let decay = null;
  let overlay = null;
  let inflight = 0; // time sent to the worker but not yet seen in storage
  let flushing = false;
  let lastFlush = performance.now();

  const bucket = () => buckets[DD.bucketKey(cfg.demo)];
  const speed = () => (cfg.demo ? DD.DEMO_SPEED : 1);
  const totalMs = () =>
    DD.dayTotal(bucket()[DD.todayKey()], cfg.sites) + (tracker.pending + inflight) * speed();

  function render() {
    const s = DD.decayAt(totalMs() / 60000, cfg.thresholds);
    // Stay completely out of the page until the first stage begins.
    if (!decay && s.stage === 0 && s.sat >= 1) return;
    decay ||= new DD.Decay();
    overlay ||= new DD.Overlay({
      onCloseTab: () => chrome.runtime.sendMessage({ type: 'dd:closeTab' }).catch(() => {}),
    });
    decay.apply(s);
    overlay.update(s, totalMs());
  }

  function flush() {
    if (flushing || tracker.pending < 250) return;
    flushing = true;
    inflight = tracker.take();
    chrome.runtime
      .sendMessage({ type: 'dd:add', site, ms: inflight })
      .then((res) => {
        if (res?.ok) buckets[res.bucket] = { ...buckets[res.bucket], [res.date]: res.day };
      })
      .catch(() => {})
      .finally(() => {
        inflight = 0;
        flushing = false;
      });
  }

  const timer = setInterval(() => {
    if (!alive()) return teardown();
    tracker.tick();
    const now = performance.now();
    if (now - lastFlush >= FLUSH_MS) {
      lastFlush = now;
      flush();
    }
    render();
  }, RENDER_MS);

  // Flush what we have when the tab is hidden or closed.
  const onHide = () => {
    if (document.visibilityState === 'hidden' && alive()) {
      tracker.tick();
      flush();
    }
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  function onStorage(changes, area) {
    if (area !== 'local') return;
    if (changes.days) buckets.days = changes.days.newValue || {};
    if (changes.demoDays) buckets.demoDays = changes.demoDays.newValue || {};
    // Our own write has landed, so the in-flight time is now part of storage.
    if (changes[DD.bucketKey(cfg.demo)]) inflight = 0;
    if (changes.settings) {
      cfg = DD.withDefaults(changes.settings.newValue);
      if (!DD.siteForHost(location.hostname, cfg.sites)) return teardown();
    }
    render();
  }
  chrome.storage.onChanged.addListener(onStorage);

  function teardown() {
    clearInterval(timer);
    tracker.destroy();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {
      // Extension context already gone.
    }
    decay?.destroy();
    overlay?.destroy();
    DD.Decay.scrub();
    DD.Overlay.scrub();
    globalThis.__ddTeardown = null;
  }
  globalThis.__ddTeardown = teardown;

  render();
})();
