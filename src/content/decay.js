// Applies a decay state (from DD.decayAt) to the page: global strengths on
// :root, which text elements bleed/erode/wobble, which posts tilt, and the
// SVG pixelation filter. Text discovery is lazy and runs in idle time, so
// nothing is scanned until the page actually starts to rot.
(() => {
  const DD = globalThis.DD;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const SKIP =
    'script,style,noscript,template,textarea,input,select,option,svg,math,code,pre,' +
    '[contenteditable]:not([contenteditable="false"]),[data-dd-root]';
  const POSTS =
    'article,ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,' +
    'ytd-reel-item-renderer,ytd-comment-thread-renderer';
  const TEXT_ATTRS = ['data-dd-ink', 'data-dd-wob', 'data-dd-jit'];
  const ALL_ATTRS = [...TEXT_ATTRS, 'data-dd-v', 'data-dd-post'];
  const FADE_OUT_MS = 3200;
  const MAX_WOBBLE_HEIGHT = 420;

  const variant = (el) => {
    if (!el.hasAttribute('data-dd-v')) el.setAttribute('data-dd-v', String((Math.random() * 8) | 0));
  };

  DD.Decay = class {
    constructor() {
      this.entries = []; // { el, r, w, j, target }
      this.seen = new WeakSet();
      this.pendingNodes = new Set();
      this.walker = null;
      this.idleHandle = null;
      this.fading = new Map(); // "attr" on el -> timestamp it started fading out
      this.wobTargets = new Set();
      this.lastVars = {};
      this.lastPixel = 0;
      this.state = null;

      this.styleEl = document.createElement('style');
      this.styleEl.id = 'dd-vars';
      document.documentElement.append(this.styleEl);
      this.styleEl.sheet.insertRule(':root {}', 0);
      this.rootRule = this.styleEl.sheet.cssRules[0];
      this.rootRule.style.setProperty(
        '--dd-erode-mask',
        `url("${chrome.runtime.getURL('assets/textures/erode.svg')}")`,
      );

      this.defs = this.buildFilters();
      document.documentElement.append(this.defs);

      // Until the first full-page walk starts it will see every node anyway,
      // so there is no point queueing additions before then.
      this.fullScanQueued = true;
      this.pendingNodes.add(document.body || document.documentElement);
      this.observer = new MutationObserver((records) => {
        if (this.fullScanQueued) return;
        for (const rec of records) for (const node of rec.addedNodes) this.pendingNodes.add(node);
        if (this.wantsText) this.scheduleScan();
      });
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    get wantsText() {
      return !!this.state && (this.state.inkShare > 0 || this.state.wobbleShare > 0);
    }

    buildFilters() {
      // Classic SVG pixelate: sample one pixel per block, then dilate it to fill the block.
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.id = 'dd-defs';
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
      svg.innerHTML =
        '<filter id="dd-pixelate" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">' +
        '<feFlood x="1" y="1" width="1" height="1"/>' +
        '<feComposite width="2" height="2"/>' +
        '<feTile result="grid"/>' +
        '<feComposite in="SourceGraphic" in2="grid" operator="in"/>' +
        '<feMorphology operator="dilate" radius="1"/>' +
        '</filter>';
      return svg;
    }

    setPixelSize(size) {
      if (size === this.lastPixel) return;
      this.lastPixel = size;
      const half = Math.floor(size / 2);
      const [flood, composite, , , morph] = this.defs.querySelector('filter').children;
      flood.setAttribute('x', half);
      flood.setAttribute('y', half);
      composite.setAttribute('width', size);
      composite.setAttribute('height', size);
      morph.setAttribute('radius', Math.max(half, 1));
    }

    apply(s) {
      this.state = s;
      const html = document.documentElement;
      if (!this.styleEl.isConnected) html.append(this.styleEl);
      if (!this.defs.isConnected) html.append(this.defs);

      this.setVar('--dd-ink-s', s.ink);
      this.setVar('--dd-erode', s.erode);
      this.setVar('--dd-tilt', s.tilt);
      this.setVar('--dd-wobble', s.wobble);
      this.setVar('--dd-broken', s.broken);

      html.toggleAttribute('data-dd-tilt', s.tilt > 0.005);
      const pixel = Math.round(s.pixel);
      html.toggleAttribute('data-dd-pix', pixel >= 2);
      if (pixel >= 2) this.setPixelSize(pixel);

      if (s.tilt > 0.005) this.markPosts();
      if (this.wantsText) this.scheduleScan();
      this.syncText(s);
    }

    setVar(name, value) {
      const v = value.toFixed(3);
      if (this.lastVars[name] === v) return;
      this.lastVars[name] = v;
      this.rootRule.style.setProperty(name, v);
    }

    markPosts() {
      for (const post of document.querySelectorAll(POSTS)) {
        if (post.hasAttribute('data-dd-post')) continue;
        if (post.parentElement?.closest(POSTS)) continue;
        variant(post);
        post.setAttribute('data-dd-post', '');
      }
    }

    // ── Text discovery ────────────────────────────────────────────────

    scheduleScan() {
      if (this.idleHandle != null || (!this.walker && !this.pendingNodes.size)) return;
      this.idleHandle = requestIdleCallback((deadline) => this.scan(deadline), { timeout: 500 });
    }

    scan(deadline) {
      this.idleHandle = null;
      while (deadline.timeRemaining() > 2) {
        if (!this.walker) {
          const next = this.pendingNodes.values().next();
          if (next.done) break;
          this.pendingNodes.delete(next.value);
          const node = next.value;
          if (node.nodeType === Node.TEXT_NODE) {
            this.consider(node);
            continue;
          }
          if (node.nodeType !== Node.ELEMENT_NODE || !node.isConnected) continue;
          this.walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          this.fullScanQueued = false;
        }
        const text = this.walker.nextNode();
        if (text) this.consider(text);
        else this.walker = null;
      }
      if (this.walker || this.pendingNodes.size) this.scheduleScan();
    }

    consider(textNode) {
      const el = textNode.parentElement;
      if (!el || this.seen.has(el)) return;
      if (textNode.nodeValue.trim().length < 2) return;
      this.seen.add(el);
      if (el === document.body || el.closest(SKIP)) return;
      this.entries.push({ el, r: Math.random(), w: Math.random(), j: Math.random(), target: undefined });
    }

    // Wobble needs a box that transforms apply to, so climb out of inline
    // spans to the nearest block; skip anything big enough to be a layout column.
    wobbleTarget(entry) {
      if (entry.target !== undefined) return entry.target;
      let t = entry.el;
      for (let i = 0; i < 4 && t; i++) {
        const display = getComputedStyle(t).display;
        if (display !== 'inline' && display !== 'contents') break;
        t = t.parentElement;
      }
      const ok =
        t && t !== document.body && t !== document.documentElement &&
        !t.closest(SKIP) && t.getBoundingClientRect().height <= MAX_WOBBLE_HEIGHT;
      entry.target = ok ? t : null;
      return entry.target;
    }

    // ── Applying the text effects ─────────────────────────────────────

    setFlag(el, attr, want) {
      const cur = el.getAttribute(attr);
      if (want) {
        if (cur !== '1') {
          variant(el);
          el.setAttribute(attr, '1');
        }
        this.fading.get(el)?.delete(attr);
      } else if (cur === '1') {
        // Fade out via the transition on --dd-in/--dd-win, then drop the attribute.
        el.setAttribute(attr, '0');
        if (!this.fading.has(el)) this.fading.set(el, new Map());
        this.fading.get(el).set(attr, performance.now());
      }
    }

    syncText(s) {
      const jitShare = s.broken * 0.5;
      const wobWanted = new Map(); // target -> wants jitter
      let alive = 0;

      for (const e of this.entries) {
        if (!e.el.isConnected) continue;
        this.entries[alive++] = e;
        this.setFlag(e.el, 'data-dd-ink', e.r < s.inkShare);
        if (e.w < s.wobbleShare) {
          const t = this.wobbleTarget(e);
          if (t) wobWanted.set(t, wobWanted.get(t) || e.j < jitShare);
        }
      }
      this.entries.length = alive;

      for (const t of this.wobTargets) {
        if (!t.isConnected) this.wobTargets.delete(t);
        else if (!wobWanted.has(t)) this.setFlag(t, 'data-dd-wob', false);
      }
      for (const [t, jit] of wobWanted) {
        this.wobTargets.add(t);
        this.setFlag(t, 'data-dd-wob', true);
        t.toggleAttribute('data-dd-jit', jit);
      }

      const now = performance.now();
      for (const [el, attrs] of this.fading) {
        for (const [attr, since] of attrs) {
          if (now - since < FADE_OUT_MS) continue;
          if (el.getAttribute(attr) === '0') {
            el.removeAttribute(attr);
            if (attr === 'data-dd-wob') el.removeAttribute('data-dd-jit');
          }
          attrs.delete(attr);
        }
        if (!attrs.size || !el.isConnected) this.fading.delete(el);
      }
    }

    destroy() {
      this.observer.disconnect();
      if (this.idleHandle != null) cancelIdleCallback(this.idleHandle);
      DD.Decay.scrub();
    }

    // Removes everything any instance (including an orphaned one from a
    // previous version of the extension) may have left in the page.
    static scrub() {
      const html = document.documentElement;
      html.removeAttribute('data-dd-tilt');
      html.removeAttribute('data-dd-pix');
      document.querySelectorAll('style#dd-vars, svg#dd-defs').forEach((n) => n.remove());
      const selector = ALL_ATTRS.map((a) => `[${a}]`).join(',');
      for (const el of document.querySelectorAll(selector)) for (const a of ALL_ATTRS) el.removeAttribute(a);
    }
  };
})();
