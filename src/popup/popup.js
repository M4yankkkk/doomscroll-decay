const $ = (id) => document.getElementById(id);
const app = $('app');

let cfg = DD.withDefaults();
let buckets = { days: {}, demoDays: {} };
let resetArmed = null;

async function load() {
  const stored = await chrome.storage.local.get(['settings', 'days', 'demoDays']);
  cfg = DD.withDefaults(stored.settings);
  buckets = { days: stored.days || {}, demoDays: stored.demoDays || {} };
}

function buildMeter() {
  const t = cfg.thresholds;
  const end = t.rot;
  const pct = (m) => `${(m / end) * 100}%`;

  // The fill is the full stage gradient, revealed with clip-path as time passes.
  const stops = DD.STAGES.map((s, i) => `${s.color} ${pct(i === 0 ? 0 : t[DD.STAGE_KEYS[i - 1]])}`);
  $('fill').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;

  $('ticks').replaceChildren(
    ...DD.STAGE_KEYS.slice(0, -1).map((k) => {
      const i = document.createElement('i');
      i.style.left = pct(t[k]);
      return i;
    }),
  );
  $('tickLabels').replaceChildren(
    ...DD.STAGE_KEYS.map((k) => {
      const span = document.createElement('span');
      span.textContent = `${t[k]}m`;
      span.style.left = pct(t[k]);
      span.dataset.minutes = t[k];
      return span;
    }),
  );
}

function siteRow(site, ms, share) {
  const li = document.createElement('li');
  li.classList.toggle('idle', ms < 1000);
  const mono = document.createElement('span');
  mono.className = 'mono';
  mono.textContent = site[0];
  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = site;
  const bar = document.createElement('span');
  bar.className = 'bar';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(share * 100)}%`;
  bar.append(fill);
  const time = document.createElement('span');
  time.className = 'site-time';
  time.textContent = ms >= 1000 ? DD.formatDuration(ms) : '—';
  li.append(mono, name, bar, time);
  return li;
}

function render() {
  const day = buckets[DD.bucketKey(cfg.demo)][DD.todayKey()] || {};
  const total = DD.dayTotal(day, cfg.sites);
  const minutes = total / 60000;
  const t = cfg.thresholds;
  const stage = DD.stageAt(minutes, t);
  const info = DD.STAGES[stage];

  app.style.setProperty('--accent', info.color);
  $('demoPill').hidden = !cfg.demo;
  $('demo').checked = cfg.demo;
  $('eyebrow').textContent = cfg.demo ? 'Demo run' : 'Today on feeds';
  $('total').textContent = DD.formatDuration(total);
  $('stageName').textContent = info.name;
  $('stageLine').textContent = info.line;

  const progress = Math.min(minutes / t.rot, 1);
  $('fill').style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0 round 999px)`;
  $('knob').style.left = `${progress * 100}%`;
  for (const label of $('tickLabels').children) {
    label.classList.toggle('reached', minutes >= Number(label.dataset.minutes));
  }

  const next = DD.nextStageIn(minutes, t);
  const nextEl = $('next');
  if (next) {
    const realMs = (next.minutes * 60000) / (cfg.demo ? DD.DEMO_SPEED : 1);
    const name = DD.STAGES[next.stage].name;
    const b = document.createElement('b');
    b.textContent = DD.formatDuration(realMs);
    nextEl.replaceChildren(`${name} sets in after `, b, ' more scrolling');
  } else {
    nextEl.textContent = 'Fully decomposed. The outside is still there.';
  }

  const rows = cfg.sites
    .map((site) => [site, day[site] || 0])
    .sort((a, b) => b[1] - a[1]);
  const list = $('siteList');
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'site-empty';
    li.textContent = 'No feed sites configured.';
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...rows.map(([site, ms]) => siteRow(site, ms, total ? ms / total : 0)));
  }

  $('reset').textContent = resetArmed
    ? cfg.demo ? 'Click again to reset demo' : 'Click again to reset'
    : cfg.demo ? 'Reset demo' : 'Reset today';
  $('reset').classList.toggle('armed', Boolean(resetArmed));
}

$('demo').addEventListener('change', (e) => {
  chrome.runtime.sendMessage({ type: 'dd:setDemo', on: e.target.checked });
});

// Two-step reset instead of a modal: first click arms, second confirms.
$('reset').addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = setTimeout(() => {
      resetArmed = null;
      render();
    }, 3000);
    render();
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  await chrome.runtime.sendMessage({ type: 'dd:reset' });
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const sitesBefore = cfg.sites.join();
  const thresholdsBefore = JSON.stringify(cfg.thresholds);
  await load();
  if (sitesBefore !== cfg.sites.join() || thresholdsBefore !== JSON.stringify(cfg.thresholds)) buildMeter();
  render();
});

(async () => {
  await load();
  buildMeter();
  render();
  // Enable transitions only after the first paint so the popup doesn't animate open.
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.add('ready')));
})();
