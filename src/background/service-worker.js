// The service worker is the only writer of usage totals, so tabs in
// different windows can never clobber each other's time. It also keeps
// the content script registered for whichever sites are configured.
importScripts('../shared/config.js', '../shared/decay-curve.js');

const SCRIPT_ID = 'doomscroll-decay';
const CONTENT_JS = [
  'src/shared/config.js',
  'src/shared/decay-curve.js',
  'src/content/tracker.js',
  'src/content/assets.js',
  'src/content/decay.js',
  'src/content/overlay.js',
  'src/content/main.js',
];
const CONTENT_CSS = ['src/content/decay.css'];
const KEEP_DAYS = 14;
const ASSET_PATHS = ['assets/fonts/instrument-serif-italic.woff2', 'assets/fonts/inter-var.woff2'];

// Serialise every read-modify-write of storage.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
};

async function load() {
  const { settings, days = {}, demoDays = {} } = await chrome.storage.local.get([
    'settings',
    'days',
    'demoDays',
  ]);
  return { cfg: DD.withDefaults(settings), days, demoDays };
}

async function permittedPatterns(sites) {
  const patterns = [];
  for (const site of sites) {
    const pattern = DD.matchPattern(site);
    if (await chrome.permissions.contains({ origins: [pattern] })) patterns.push(pattern);
  }
  return patterns;
}

// Settings and permission events can fire together; registering twice at
// once would fail on the duplicate script id, so syncs run one at a time.
let syncChain = Promise.resolve();
function syncContentScripts(opts) {
  const run = syncChain.then(() => doSyncContentScripts(opts));
  syncChain = run.catch((err) => console.warn('content script sync failed', err));
  return syncChain;
}

async function doSyncContentScripts({ injectOpenTabs = false } = {}) {
  const { cfg } = await load();
  const matches = await permittedPatterns(cfg.sites);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches, js: CONTENT_JS, css: CONTENT_CSS, runAt: 'document_idle' },
  ]);

  if (!injectOpenTabs) return;
  const tabs = await chrome.tabs.query({ url: matches });
  for (const tab of tabs) {
    const target = { tabId: tab.id };
    try {
      await chrome.scripting.insertCSS({ target, files: CONTENT_CSS });
      await chrome.scripting.executeScript({ target, files: CONTENT_JS });
    } catch {
      // Discarded or otherwise unscriptable tab; it will pick the script up on reload.
    }
  }
}

async function updateBadge() {
  const { cfg, days, demoDays } = await load();
  const store = cfg.demo ? demoDays : days;
  const ms = DD.dayTotal(store[DD.todayKey()], cfg.sites);
  const minutes = ms / 60000;
  const stage = DD.stageAt(minutes, cfg.thresholds);
  await chrome.action.setBadgeText({ text: minutes >= 1 ? `${Math.floor(minutes)}m` : '' });
  await chrome.action.setBadgeBackgroundColor({ color: DD.STAGES[stage].color });
  await chrome.action.setBadgeTextColor({ color: '#15130f' });
}

function prune() {
  return serial(async () => {
    const { days, demoDays } = await load();
    const cutoff = DD.todayKey(new Date(Date.now() - KEEP_DAYS * 86_400_000));
    const today = DD.todayKey();
    for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
    for (const day of Object.keys(demoDays)) if (day !== today) delete demoDays[day];
    await chrome.storage.local.set({ days, demoDays });
  });
}

function scheduleAlarms() {
  chrome.alarms.create('midnight', { when: DD.nextMidnight() + 1000 });
  chrome.alarms.create('prune', { periodInMinutes: 360 });
}

const handlers = {
  add: ({ site, ms }) =>
    serial(async () => {
      const { cfg, days, demoDays } = await load();
      if (!cfg.sites.includes(site)) return { ok: false };
      const credited = Math.min(Math.max(Number(ms) || 0, 0), 10_000) * (cfg.demo ? DD.DEMO_SPEED : 1);
      const key = DD.bucketKey(cfg.demo);
      const store = cfg.demo ? demoDays : days;
      const today = DD.todayKey();
      const day = (store[today] ||= {});
      day[site] = (day[site] || 0) + credited;
      await chrome.storage.local.set({ [key]: store });
      return { ok: true, bucket: key, date: today, day };
    }),

  reset: () =>
    serial(async () => {
      const { cfg, days, demoDays } = await load();
      const store = cfg.demo ? demoDays : days;
      delete store[DD.todayKey()];
      await chrome.storage.local.set({ [DD.bucketKey(cfg.demo)]: store });
      return { ok: true };
    }),

  // Turning demo on always starts a fresh run, so a recording begins un-rotted.
  setDemo: ({ on }) =>
    serial(async () => {
      const { cfg } = await load();
      const update = { settings: { ...cfg, demo: Boolean(on) } };
      if (on) update.demoDays = {};
      await chrome.storage.local.set(update);
      return { ok: true };
    }),

  // Font bytes for the content script, so the page never has to request a
  // chrome-extension:// URL itself (YouTube rejects those).
  asset: async ({ path }) => {
    if (!ASSET_PATHS.includes(path)) return { ok: false };
    const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(path))).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { ok: true, base64: btoa(binary) };
  },

  closeTab: (_msg, sender) => {
    if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id);
    return Promise.resolve({ ok: true });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && typeof msg.type === 'string' && handlers[msg.type.replace(/^dd:/, '')];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: DD.withDefaults(settings) });
  scheduleAlarms();
  await syncContentScripts({ injectOpenTabs: true });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  scheduleAlarms();
  await prune();
  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'midnight') {
    chrome.alarms.create('midnight', { when: DD.nextMidnight() + 1000 });
    await prune();
    await updateBadge();
  } else if (alarm.name === 'prune') {
    await prune();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const before = DD.withDefaults(changes.settings.oldValue).sites.join();
    const after = DD.withDefaults(changes.settings.newValue).sites.join();
    if (before !== after) syncContentScripts({ injectOpenTabs: true });
  }
  if (changes.settings || changes.days || changes.demoDays) updateBadge();
});

chrome.permissions.onAdded.addListener(() => syncContentScripts({ injectOpenTabs: true }));
chrome.permissions.onRemoved.addListener(() => syncContentScripts());
