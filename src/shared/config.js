// Shared constants and helpers. Classic script that hangs everything off
// globalThis.DD so the service worker (importScripts), content scripts,
// popup and options page can all load it without a build step.
(() => {
  const DD = (globalThis.DD = globalThis.DD || {});

  DD.DEFAULT_SITES = ['x.com', 'instagram.com', 'youtube.com', 'reddit.com'];

  // Minutes of active scrolling at which each stage begins.
  DD.DEFAULT_THRESHOLDS = { fade: 5, bleed: 10, warp: 15, unravel: 20, rot: 30 };
  DD.STAGE_KEYS = ['fade', 'bleed', 'warp', 'unravel', 'rot'];

  DD.STAGES = [
    { key: 'fresh', name: 'Fresh', line: 'The feed is intact. For now.', color: '#9ddfae' },
    { key: 'fade', name: 'Fading', line: 'Colour is draining out of the page.', color: '#c9d68b' },
    { key: 'bleed', name: 'Bleeding', line: 'Ink is soaking through the text.', color: '#ddb86b' },
    { key: 'warp', name: 'Warping', line: 'The page is coming loose.', color: '#da8e5d' },
    { key: 'unravel', name: 'Unravelling', line: 'The words won’t hold still.', color: '#c47784' },
    { key: 'rot', name: 'Decomposed', line: 'This feed is decomposing.', color: '#9b948a' },
  ];

  DD.DEMO_SPEED = 60;
  DD.IDLE_MS = 30_000;

  DD.withDefaults = (settings = {}) => ({
    sites: Array.isArray(settings.sites) ? settings.sites : [...DD.DEFAULT_SITES],
    thresholds: { ...DD.DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) },
    demo: Boolean(settings.demo),
  });

  // Demo time lives in its own bucket so screen recordings never touch real stats.
  DD.bucketKey = (demo) => (demo ? 'demoDays' : 'days');

  DD.todayKey = (d = new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  DD.nextMidnight = (d = new Date()) => {
    const m = new Date(d);
    m.setHours(24, 0, 0, 0);
    return m.getTime();
  };

  DD.matchPattern = (site) => `*://*.${site}/*`;

  DD.siteForHost = (host, sites) =>
    sites.find((s) => host === s || host.endsWith('.' + s)) || null;

  // Accepts "https://www.Example.com/feed" and returns "example.com", or null.
  DD.normalizeSite = (input) => {
    let s = String(input || '').trim().toLowerCase();
    s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
  };

  DD.dayTotal = (day, sites) =>
    sites.reduce((sum, s) => sum + ((day && day[s]) || 0), 0);

  DD.validateThresholds = (t) => {
    let prev = 0;
    for (const key of DD.STAGE_KEYS) {
      const v = t[key];
      const name = DD.STAGES[DD.STAGE_KEYS.indexOf(key) + 1].name;
      if (!Number.isFinite(v) || v <= 0) return `${name} needs a positive number of minutes.`;
      if (v <= prev) return `${name} has to start after the stage before it.`;
      prev = v;
    }
    return null;
  };

  // "23m 04s", "1h 07m", "45s"
  DD.formatDuration = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h) return `${h}h ${pad(m)}m`;
    if (m) return `${m}m ${pad(s)}s`;
    return `${s}s`;
  };
})();
