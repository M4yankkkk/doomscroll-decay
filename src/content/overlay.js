// A click-through layer above the page, in a closed shadow root so the
// site's CSS can't reach it. It carries everything that acts on the page
// as a whole: colour loss (a backdrop filter, so the site's layout is
// never touched), grain, vignette, flicker, and the "decomposing" card,
// which sits above the filter and stays crisp.
//
// The host is a plain div on purpose: sites built on web components
// (Reddit) style undefined custom elements, which silently disabled the
// backdrop filter when the host was a custom element.
(() => {
  const DD = globalThis.DD;
  const SNOOZE_MS = 10 * 60_000;

  const template = () => `
<style>
  /* !important here outranks the page's own rules for the host div. */
  :host {
    all: initial !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483646 !important;
    pointer-events: none !important;
    display: block !important;
    transition: --dd-sat 1s linear, --dd-sepia 1s linear, --dd-con 1s linear,
      --dd-bri 1s linear, --dd-grain 1s linear, --dd-vig 1s linear !important;
  }
  .layer { position: absolute; inset: 0; }
  .veil {
    display: none;
    backdrop-filter: saturate(var(--dd-sat)) sepia(var(--dd-sepia)) contrast(var(--dd-con)) brightness(var(--dd-bri));
  }
  :host([data-veil]) .veil { display: block; }

  .grain, .vignette, .flicker { display: none; }
  :host([data-broken]) :is(.grain, .vignette, .flicker) { display: block; }
  .grain {
    inset: -110px;
    background: url("${chrome.runtime.getURL('assets/textures/grain.svg')}");
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
<div class="layer veil"></div>
<div class="layer vignette"></div>
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

  let fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    const faces = [
      new FontFace('Doomscroll Serif', `url(${chrome.runtime.getURL('assets/fonts/instrument-serif-italic.woff2')})`, { style: 'italic' }),
      new FontFace('Doomscroll Sans', `url(${chrome.runtime.getURL('assets/fonts/inter-var.woff2')})`, { weight: '100 900' }),
    ];
    for (const face of faces) {
      document.fonts.add(face);
      face.load().catch(() => {}); // Blocked by the page? The fallback stack is fine.
    }
  }

  DD.Overlay = class {
    constructor({ onCloseTab }) {
      this.host = document.createElement('div');
      this.host.setAttribute('data-dd-root', '');
      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = template();
      this.timeEl = root.querySelector('.time');
      this.snoozedUntil = 0;
      this.last = {};

      root.querySelector('.go').addEventListener('click', onCloseTab);
      root.querySelector('.later').addEventListener('click', () => {
        this.snoozedUntil = Date.now() + SNOOZE_MS;
        this.host.removeAttribute('data-card');
      });

      document.documentElement.append(this.host);
    }

    setVar(name, value) {
      const v = value.toFixed(3);
      if (this.last[name] === v) return;
      this.last[name] = v;
      this.host.style.setProperty(name, v);
    }

    update(s, totalMs) {
      if (!this.host.isConnected) document.documentElement.append(this.host);

      this.setVar('--dd-sat', s.sat);
      this.setVar('--dd-sepia', s.sepia);
      this.setVar('--dd-con', s.contrast);
      this.setVar('--dd-bri', s.bright);
      this.setVar('--dd-grain', s.broken * 0.3);
      this.setVar('--dd-vig', s.broken);

      this.host.toggleAttribute('data-veil', s.sat < 0.999 || s.sepia > 0.001 || s.contrast > 1.001);
      this.host.toggleAttribute('data-broken', s.broken > 0.001);

      const showCard = s.message && Date.now() > this.snoozedUntil;
      if (showCard) {
        loadFonts();
        const minutes = Math.floor(totalMs / 60000);
        const text = `${minutes} minute${minutes === 1 ? '' : 's'} of feed today`;
        if (this.timeEl.textContent !== text) this.timeEl.textContent = text;
      }
      this.host.toggleAttribute('data-card', showCard);
    }

    destroy() {
      this.host.remove();
    }

    static scrub() {
      document.querySelectorAll('div[data-dd-root]').forEach((n) => n.remove());
    }
  };
})();
