const $ = (id) => document.getElementById(id);

const STAGE_EFFECTS = {
  fade: 'Colour slowly drains out of the page.',
  bleed: 'Text bleeds ink, wears away, and slips into an old typewriter face.',
  warp: 'Posts tilt, images pixelate, and water damage creeps in from the corners.',
  unravel: 'Words wobble, and more of the text bleeds and changes face.',
  rot: 'Near-grayscale, stained, grainy, heavily pixelated. A note suggests going outside.',
};

let savedTimer = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return DD.withDefaults(settings);
}

// Always merge into the latest stored settings so the demo flag (owned by
// the popup) is never overwritten by a stale copy.
async function saveSettings(patch) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
  const saved = $('saved');
  saved.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('show'), 1400);
}

// ── Sites ─────────────────────────────────────────────────────────────

async function renderSites() {
  const { sites } = await getSettings();
  const chips = await Promise.all(
    sites.map(async (site) => {
      const granted = await chrome.permissions.contains({ origins: [DD.matchPattern(site)] });
      const li = document.createElement('li');
      li.className = 'chip' + (granted ? '' : ' no-access');
      li.append(site);
      if (!granted) {
        const warn = document.createElement('button');
        warn.type = 'button';
        warn.className = 'warn';
        warn.textContent = 'grant access';
        warn.addEventListener('click', () => grant(site));
        li.append(warn);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${site}`);
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener('click', () => removeSite(site));
      li.append(remove);
      return li;
    }),
  );
  $('sites').replaceChildren(...chips);
}

function grant(site) {
  return chrome.permissions.request({ origins: [DD.matchPattern(site)] }).then(renderSites);
}

async function removeSite(site) {
  const { sites } = await getSettings();
  await saveSettings({ sites: sites.filter((s) => s !== site) });
  if (!DD.DEFAULT_SITES.includes(site)) {
    chrome.permissions.remove({ origins: [DD.matchPattern(site)] }).catch(() => {});
  }
  renderSites();
}

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const error = $('siteError');
  const site = DD.normalizeSite($('addInput').value);
  if (!site) {
    error.textContent = 'That doesn’t look like a domain. Try something like tiktok.com.';
    return;
  }
  // The permission prompt must be requested synchronously inside the click.
  chrome.permissions.request({ origins: [DD.matchPattern(site)] }).then(async (granted) => {
    if (!granted) {
      error.textContent = `Chrome didn’t grant access to ${site}, so it can’t be tracked.`;
      return;
    }
    const { sites } = await getSettings();
    if (!sites.includes(site)) await saveSettings({ sites: [...sites, site] });
    error.textContent = '';
    $('addInput').value = '';
    renderSites();
  });
});

$('addInput').addEventListener('input', () => ($('siteError').textContent = ''));

// ── Thresholds ────────────────────────────────────────────────────────

function readThresholds() {
  const t = {};
  for (const input of $('stages').querySelectorAll('input')) t[input.name] = Number(input.value);
  return t;
}

async function renderStages() {
  const { thresholds } = await getSettings();
  const rows = DD.STAGE_KEYS.map((key, i) => {
    const stage = DD.STAGES[i + 1];
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="swatch"></span>
      <span class="stage-copy"><strong></strong><span></span></span>
      <label class="minutes"><input type="number" min="1" max="1440" step="1" inputmode="numeric"> min</label>`;
    li.querySelector('.swatch').style.background = stage.color;
    li.querySelector('strong').textContent = stage.name;
    li.querySelector('.stage-copy span').textContent = STAGE_EFFECTS[key];
    const input = li.querySelector('input');
    input.name = key;
    input.value = thresholds[key];
    input.setAttribute('aria-label', `${stage.name} starts after (minutes)`);
    input.addEventListener('input', onThresholdInput);
    return li;
  });
  $('stages').replaceChildren(...rows);
}

async function onThresholdInput() {
  const t = readThresholds();
  const problem = DD.validateThresholds(t);
  let prev = 0;
  for (const input of $('stages').querySelectorAll('input')) {
    const v = t[input.name];
    input.setAttribute('aria-invalid', String(!Number.isFinite(v) || v <= prev));
    prev = Number.isFinite(v) ? v : prev;
  }
  $('stageError').textContent = problem || '';
  if (!problem) await saveSettings({ thresholds: t });
}

$('restore').addEventListener('click', async () => {
  await saveSettings({ thresholds: { ...DD.DEFAULT_THRESHOLDS } });
  $('stageError').textContent = '';
  renderStages();
});

chrome.permissions.onAdded.addListener(renderSites);
chrome.permissions.onRemoved.addListener(renderSites);

renderSites();
renderStages();
