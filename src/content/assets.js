// Textures and fonts for the page, provided without the page itself ever
// requesting a chrome-extension:// URL. Some sites (YouTube) reject those
// loads with "Unsafe attempt to load URL ... Domains, protocols and ports
// must match", which also shows up as errors on chrome://extensions.
//
// - Textures become same-origin blob: URLs built from inline SVG. If the
//   site's CSP blocks blob: images, they fall back to the extension file
//   (which strict-CSP sites do allow).
// - Fonts are fetched by the service worker and handed over as bytes, so
//   the FontFace has no URL at all.
(() => {
  const DD = globalThis.DD;

  const SVG = {
    // Speckle mask for text erosion: opaque with transparent pits.
    erode:
      '<svg xmlns="http://www.w3.org/2000/svg" width="170" height="170">' +
      '<filter id="n" x="0" y="0" width="1" height="1">' +
      '<feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="11" stitchTiles="stitch"/>' +
      '<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -11 0 0 0 6.6"/>' +
      '</filter><rect width="170" height="170" filter="url(#n)"/></svg>',
    // Film grain: dark and light specks with real transparency.
    grain:
      '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">' +
      '<filter id="g" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" result="t"/>' +
      '<feColorMatrix in="t" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -1.7" result="d"/>' +
      '<feColorMatrix in="t" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -3.2 0 0 0 1.5" result="l"/>' +
      '<feMerge><feMergeNode in="d"/><feMergeNode in="l"/></feMerge>' +
      '</filter><rect width="220" height="220" filter="url(#g)"/></svg>',
  };

  const blobUrls = {};
  const listeners = new Set();
  let blobBlocked = false;
  let probe = null;

  const blobUrl = (name) =>
    (blobUrls[name] ||= URL.createObjectURL(new Blob([SVG[name]], { type: 'image/svg+xml' })));

  // CSS-initiated loads that CSP rejects are only observable through this event.
  document.addEventListener('securitypolicyviolation', (e) => {
    if (blobBlocked || !String(e.blockedURI).startsWith('blob')) return;
    blobBlocked = true;
    for (const fn of listeners) fn();
  });

  // Try a blob: texture on one hidden pixel before handing it to hundreds of
  // text elements, so a strict CSP produces one console error, not one each.
  // No violation within the window means blob: is allowed.
  const probeBlob = () =>
    (probe ||= new Promise((resolve) => {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:-9px;top:-9px;width:1px;height:1px;pointer-events:none;' +
        `background-image:url("${blobUrl('erode')}")`;
      document.documentElement.append(el);
      const check = setInterval(() => blobBlocked && finish(), 25);
      const timeout = setTimeout(finish, 400);
      function finish() {
        clearInterval(check);
        clearTimeout(timeout);
        el.remove();
        resolve();
      }
    }));

  const textureUrl = (name) =>
    blobBlocked ? chrome.runtime.getURL(`assets/textures/${name}.svg`) : blobUrl(name);

  // Calls `apply(cssUrl)` once the usable URL is known, and again if a
  // blob: URL later turns out to be blocked.
  DD.useTexture = (name, apply) => {
    const run = () => apply(`url("${textureUrl(name)}")`);
    let active = true;
    probeBlob().then(() => {
      if (!active) return;
      listeners.add(run);
      run();
    });
    return () => {
      active = false;
      listeners.delete(run);
    };
  };

  const FONTS = {
    card: [
      { family: 'Doomscroll Serif', path: 'assets/fonts/instrument-serif-italic.woff2', descriptors: { style: 'italic' } },
      { family: 'Doomscroll Sans', path: 'assets/fonts/inter-var.woff2', descriptors: { weight: '100 900' } },
    ],
    // The typewriter face that page text slips into. Special Elite runs
    // wide and short, so it is scaled and given sans-like line metrics:
    // swapped text keeps roughly its old width and line height, and the
    // feed doesn't jump. (Overrides are scaled by size-adjust too.)
    rot: [
      {
        family: 'Doomscroll Rot',
        path: 'assets/fonts/special-elite.woff2',
        descriptors: { sizeAdjust: '93%', ascentOverride: '99%', descentOverride: '26%', lineGapOverride: '0%' },
      },
    ],
  };
  const fontLoads = {};

  // Resolves once the group is usable; a failed load resolves too, since
  // every use has a fallback font stack.
  DD.loadFonts = (group) =>
    (fontLoads[group] ||= Promise.all(
      FONTS[group].map(({ family, path, descriptors }) =>
        chrome.runtime
          .sendMessage({ type: 'dd:asset', path })
          .then((res) => {
            if (!res?.ok) return;
            const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
            const face = new FontFace(family, bytes, descriptors);
            document.fonts.add(face);
            return face.load();
          })
          .catch(() => {}),
      ),
    ));
})();
