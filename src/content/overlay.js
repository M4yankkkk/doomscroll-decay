// Everything that acts on the page as a whole.
//
// Colour loss is a filter on <html>. A backdrop-filter overlay looked
// equivalent but silently stopped working once the page had been scrolled,
// which is always, on a feed. A root filter doesn't break fixed headers
// (the root is exempt from creating a containing block).
//
// Grain, vignette, flicker, water damage and the "decomposing" card live in a closed
// shadow root on a manual popover, so they sit in the browser's top layer:
// above the root filter (the card keeps its colour) and above the site.
// The host is a plain div: sites built on web components (Reddit) style
// undefined custom elements, which broke a custom-element host.
(() => {
  const DD = globalThis.DD;
  const SNOOZE_MS = 10 * 60_000;

  // Water damage is drawn at low resolution and stretched over the
  // viewport; the browser's smoothing turns the noise into soft blooms.
  const MOLD_W = 360;
  const MOLD_STEP = 0.004; // redraw only when the spread moves this much

  // Seeded, so a resize (devtools opening, say) redraws the same stains
  // at the new size instead of a different pattern.
  function seededRandom(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth value noise in 0..1: three octaves of smoothly blended random grids.
  function noiseField(w, h, seed) {
    const random = seededRandom(seed);
    const out = new Float32Array(w * h);
    let amp = 1;
    let total = 0;
    for (const cell of [64, 24, 9]) {
      const gw = Math.ceil(w / cell) + 2;
      const gh = Math.ceil(h / cell) + 2;
      const grid = Float32Array.from({ length: gw * gh }, random);
      for (let y = 0; y < h; y++) {
        const gy = y / cell;
        const y0 = gy | 0;
        const ty = (gy - y0) * (gy - y0) * (3 - 2 * (gy - y0));
        for (let x = 0; x < w; x++) {
          const gx = x / cell;
          const x0 = gx | 0;
          const tx = (gx - x0) * (gx - x0) * (3 - 2 * (gx - x0));
          const a = grid[y0 * gw + x0] + (grid[y0 * gw + x0 + 1] - grid[y0 * gw + x0]) * tx;
          const b = grid[(y0 + 1) * gw + x0] + (grid[(y0 + 1) * gw + x0 + 1] - grid[(y0 + 1) * gw + x0]) * tx;
          out[y * w + x] += (a + (b - a) * ty) * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    // Summed octaves bunch up around 0.5; stretch back to the full range
    // so the damage spreads in patches rather than an even band.
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of out) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
    return out;
  }

  const template = () => `
<style>
  /* !important here outranks the page's own rules for the host div. */
  :host {
    all: initial !important;
    position: fixed !important;
    inset: 0 !important;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
    display: block !important;
    transition: --dd-grain 1s linear, --dd-vig 1s linear !important;
  }
  .layer { position: absolute; inset: 0; }

  .mold { display: none; width: 100%; height: 100%; }
  :host([data-mold]) .mold { display: block; }

  .grain, .vignette, .flicker { display: none; }
  :host([data-broken]) :is(.grain, .vignette, .flicker) { display: block; }
  .grain {
    inset: -110px;
    background-image: var(--dd-grain-img);
    opacity: var(--dd-grain);
    animation: grain 0.9s steps(1, end) infinite;
  }
  .vignette {
    background: radial-gradient(120% 95% at 50% 45%, transparent 52%,
      rgb(14 11 8 / calc(var(--dd-vig) * 0.6)) 100%);
  }
  .flicker {
    background: #0b0a08;
    opacity: 0;
    animation: flicker 7.3s steps(1, end) infinite;
  }
  @keyframes grain {
    0% { transform: translate(0, 0); }
    25% { transform: translate(-47px, 31px); }
    50% { transform: translate(38px, -66px); }
    75% { transform: translate(-71px, -18px); }
  }
  @keyframes flicker {
    0%, 100% { opacity: 0; }
    61% { opacity: calc(var(--dd-vig) * 0.09); }
    62% { opacity: 0; }
    63.5% { opacity: calc(var(--dd-vig) * 0.05); }
    64.5% { opacity: 0; }
    88% { opacity: calc(var(--dd-vig) * 0.04); }
    88.6% { opacity: 0; }
  }

  .card {
    position: absolute;
    right: 24px;
    bottom: 24px;
    width: 300px;
    box-sizing: border-box;
    padding: 18px 20px 16px;
    border-radius: 18px;
    background: #f2ece0;
    color: #1d1a16;
    box-shadow:
      0 0 0 1px rgb(29 26 22 / 0.06),
      0 1px 0 rgb(255 255 255 / 0.7) inset,
      0 28px 60px -18px rgb(0 0 0 / 0.55),
      0 10px 24px -12px rgb(0 0 0 / 0.35);
    font: 400 13px/1.4 'Doomscroll Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    pointer-events: auto;
    opacity: 0;
    visibility: hidden;
    transform: translateY(14px) scale(0.97);
    filter: blur(6px);
    transition:
      opacity 0.28s ease, transform 0.28s ease, filter 0.28s ease, visibility 0s linear 0.28s;
  }
  :host([data-card]) .card {
    opacity: 1;
    visibility: visible;
    transform: none;
    filter: none;
    transition:
      opacity 0.9s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1),
      filter 0.9s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #857b6e;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #b5633f;
    box-shadow: 0 0 0 3px rgb(181 99 63 / 0.16);
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse { 50% { box-shadow: 0 0 0 5px rgb(181 99 63 / 0.04); } }
  .headline, .ask {
    margin: 0;
    font: italic 400 31px/1.02 'Doomscroll Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .headline { text-shadow: 0 0 0.6px rgb(29 26 22 / 0.5); }
  .ask { color: #4f6b4a; margin-top: 2px; }
  .actions { display: flex; align-items: center; gap: 6px; margin-top: 16px; }
  button {
    all: unset;
    cursor: pointer;
    font: 550 12.5px/1 'Doomscroll Sans', ui-sans-serif, system-ui, sans-serif;
    padding: 9px 14px;
    border-radius: 999px;
    transition: transform 0.12s ease, background-color 0.15s ease, color 0.15s ease;
  }
  button:active { transform: scale(0.96); }
  button:focus-visible { outline: 2px solid #4f6b4a; outline-offset: 2px; }
  .go { background: #1d1a16; color: #f2ece0; }
  .go:hover { background: #33302a; }
  .later { color: #6f665b; }
  .later:hover { color: #1d1a16; background: rgb(29 26 22 / 0.06); }

  @media (prefers-reduced-motion: reduce) {
    .grain, .flicker, .dot { animation: none; }
    .card, :host([data-card]) .card { transform: none; filter: none; }
  }
</style>
<div class="layer vignette"></div>
<canvas class="layer mold"></canvas>
<div class="layer grain"></div>
<div class="layer flicker"></div>
<div class="card" role="status" aria-live="polite">
  <p class="meta"><span class="dot"></span><span class="time"></span></p>
  <p class="headline">this feed is decomposing.</p>
  <p class="ask">go outside?</p>
  <div class="actions">
    <button class="go" type="button">Close this tab</button>
    <button class="later" type="button">Not yet</button>
  </div>
</div>`;

  DD.Overlay = class {
    constructor({ onCloseTab }) {
      this.host = document.createElement('div');
      this.host.setAttribute('data-dd-root', '');
      this.host.setAttribute('popover', 'manual');
      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = template();
      this.timeEl = root.querySelector('.time');
      this.mold = {
        canvas: root.querySelector('.mold'),
        seed: (Math.random() * 2 ** 31) | 0,
        field: null,
        w: 0,
        h: 0,
        key: '',
      };
      this.snoozedUntil = 0;
      this.last = {};

      root.querySelector('.go').addEventListener('click', onCloseTab);
      root.querySelector('.later').addEventListener('click', () => {
        this.snoozedUntil = Date.now() + SNOOZE_MS;
        this.host.removeAttribute('data-card');
      });

      this.dropTexture = DD.useTexture('grain', (url) => this.host.style.setProperty('--dd-grain-img', url));

      this.pageStyle = document.createElement('style');
      this.pageStyle.id = 'dd-page';
      this.pageStyle.textContent = 'html[data-dd-veil] {}';
      this.lastFilter = '';
      this.offSince = 0;
      this.dark = null;
      this.themeCheckedAt = 0;

      this.mount();
    }

    mount() {
      const html = document.documentElement;
      if (!this.pageStyle.isConnected) {
        html.append(this.pageStyle);
        this.pageRule = this.pageStyle.sheet.cssRules[0];
        this.lastFilter = '';
      }
      if (!this.host.isConnected) html.append(this.host);
      if (!this.host.matches(':popover-open')) {
        try {
          this.host.showPopover();
        } catch {
          // Popover unsupported or blocked; the layers still render, just
          // under the root filter instead of above it.
        }
      }
    }

    // Is the site in dark mode? Look at the first opaque background under
    // the middle of the viewport. Checked every few seconds, not every tick.
    isDark() {
      const now = performance.now();
      if (this.dark !== null && now - this.themeCheckedAt < 3000) return this.dark;
      this.themeCheckedAt = now;
      const stack = [
        ...document.elementsFromPoint(innerWidth / 2, innerHeight / 2),
        document.body,
        document.documentElement,
      ];
      for (const el of stack) {
        if (!el || el === this.host) continue;
        const rgba = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
        if (!rgba || (rgba.length > 3 && rgba[3] < 0.5)) continue;
        const [r, g, b] = rgba;
        this.dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
        return this.dark;
      }
      this.dark = matchMedia('(prefers-color-scheme: dark)').matches;
      return this.dark;
    }

    // Faded-photo colour. On dark pages contrast drops to lift black into a
    // warm charcoal and turn white text cream; plain desaturation is
    // invisible on a black-and-white page. Light pages get dimmed, creamy whites.
    applyPageFilter(s) {
      const html = document.documentElement;
      const on = s.fade > 0.001 || s.sat < 0.999;
      // When healing (reset, midnight), transition to identity first and
      // only then drop the filter, so the colour eases back instead of snapping.
      if (on) {
        this.offSince = 0;
        html.setAttribute('data-dd-veil', '');
      } else if (html.hasAttribute('data-dd-veil')) {
        this.offSince ||= performance.now();
        if (performance.now() - this.offSince > 1000) {
          html.removeAttribute('data-dd-veil');
          this.lastFilter = '';
          return;
        }
      } else {
        return;
      }
      const dark = this.isDark();
      const contrast = 1 - s.fade * (dark ? 0.24 : 0.09) + s.broken * 0.06;
      const bright = 1 + s.fade * (dark ? 0.12 : -0.05) - s.broken * 0.05;
      const filter =
        `saturate(${s.sat.toFixed(3)}) contrast(${contrast.toFixed(3)}) ` +
        `sepia(${s.sepia.toFixed(3)}) brightness(${bright.toFixed(3)})`;
      if (filter === this.lastFilter) return;
      this.lastFilter = filter;
      this.pageRule.style.setProperty('filter', filter, 'important');
      this.pageRule.style.setProperty('transition', 'filter 0.35s linear', 'important');
    }

    // Tea-brown stains on light pages, pale mildew on dark ones. They sit
    // in the top layer, above the colour filter, so they keep their colour
    // while the feed underneath goes gray. Each stain has a darker tide
    // line along its front, like real water damage.
    drawMold(amount) {
      const m = this.mold;
      this.host.toggleAttribute('data-mold', amount > 0.001);
      if (amount <= 0.001) return;

      const w = MOLD_W;
      const h = Math.max(120, Math.round((MOLD_W * innerHeight) / Math.max(innerWidth, 1)));
      const dark = this.isDark();
      const level = Math.round(amount / MOLD_STEP);
      const key = `${level}|${w}x${h}|${dark}`;
      if (key === m.key) return;
      m.key = key;
      if (m.w !== w || m.h !== h) {
        m.canvas.width = m.w = w;
        m.canvas.height = m.h = h;
        m.field = noiseField(w, h, m.seed);
        m.image = new ImageData(w, h);
      }

      // `front` is how far from the edges the damage reaches (0..1 of the
      // way to the centre). Corners soak through first.
      const front = level * MOLD_STEP * 0.56 - 0.12;
      const [fill, rim] = dark
        ? [[122, 124, 96, 0.17], [150, 150, 116, 0.2]]
        : [[140, 102, 52, 0.17], [104, 70, 32, 0.3]];
      const px = m.image.data;
      for (let y = 0; y < h; y++) {
        const dy = Math.min(y, h - 1 - y) / (h / 2);
        for (let x = 0; x < w; x++) {
          const dx = Math.min(x, w - 1 - x) / (w / 2);
          const i = y * w + x;
          const v = Math.min(dx, dy) * 0.4 + Math.sqrt(dx * dy) * 0.6 + (m.field[i] - 0.5) * 0.7;
          const depth = front - v;
          let r = 0, g = 0, b = 0, a = 0;
          if (depth > -0.03) {
            const inside = Math.min(Math.max(depth / 0.05, 0), 1);
            const deep = Math.min(Math.max(depth / 0.25, 0), 1);
            const fa = fill[3] * inside * (0.55 + 0.75 * deep);
            const t = depth / 0.022;
            const ra = rim[3] * Math.exp(-t * t);
            a = fa + ra * (1 - fa);
            const k = a ? ra / a : 0;
            r = fill[0] + (rim[0] - fill[0]) * k;
            g = fill[1] + (rim[1] - fill[1]) * k;
            b = fill[2] + (rim[2] - fill[2]) * k;
          }
          const o = i * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = a * 255;
        }
      }
      m.canvas.getContext('2d').putImageData(m.image, 0, 0);
    }

    setVar(name, value) {
      const v = value.toFixed(3);
      if (this.last[name] === v) return;
      this.last[name] = v;
      this.host.style.setProperty(name, v);
    }

    update(s, totalMs) {
      this.mount();
      this.applyPageFilter(s);

      this.setVar('--dd-grain', s.broken * 0.3);
      this.setVar('--dd-vig', s.broken);
      this.host.toggleAttribute('data-broken', s.broken > 0.001);
      this.drawMold(s.mold);

      const showCard = s.message && Date.now() > this.snoozedUntil;
      if (showCard) {
        DD.loadFonts('card');
        const minutes = Math.floor(totalMs / 60000);
        const text = `${minutes} minute${minutes === 1 ? '' : 's'} of feed today`;
        if (this.timeEl.textContent !== text) this.timeEl.textContent = text;
      }
      this.host.toggleAttribute('data-card', showCard);
    }

    destroy() {
      this.dropTexture();
      this.host.remove();
      this.pageStyle.remove();
      document.documentElement.removeAttribute('data-dd-veil');
    }

    static scrub() {
      document.querySelectorAll('div[data-dd-root], style#dd-page').forEach((n) => n.remove());
      document.documentElement.removeAttribute('data-dd-veil');
    }
  };
})();
