// Minutes of scrolling -> how strongly each effect should be applied.
// Every value is a piecewise-linear ramp anchored on the stage thresholds,
// so effects ease in continuously instead of switching on at a boundary.
(() => {
  const DD = globalThis.DD;

  function ramp(x, points) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (x <= x1) {
        const [x0, y0] = points[i - 1];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
      }
    }
    return points[points.length - 1][1];
  }

  DD.stageAt = (minutes, t) => DD.STAGE_KEYS.filter((k) => minutes >= t[k]).length;

  DD.decayAt = (minutes, t) => {
    const m = minutes;
    const { fade, bleed, warp, unravel, rot } = t;
    const brokenStart = unravel + (rot - unravel) * 0.6;

    return {
      minutes: m,
      stage: DD.stageAt(m, t),

      // Whole-page colour, applied through a backdrop filter overlay.
      sat: ramp(m, [[fade, 1], [bleed, 0.8], [warp, 0.62], [unravel, 0.42], [rot, 0.07]]),
      sepia: ramp(m, [[bleed, 0], [rot, 0.24]]),
      contrast: ramp(m, [[warp, 1], [rot, 1.1]]),
      bright: ramp(m, [[unravel, 1], [rot, 0.94]]),

      // Ink bleed + erosion: share of text elements affected, and how hard.
      inkShare: ramp(m, [[bleed, 0], [warp, 0.14], [unravel, 0.32], [rot, 0.72]]),
      ink: ramp(m, [[bleed, 0.45], [unravel, 0.75], [rot, 1]]),
      erode: ramp(m, [[bleed, 0.12], [warp, 0.3], [unravel, 0.5], [rot, 0.82]]),

      // Posts tilt, images pixelate (block size in px; < 2 means off).
      tilt: ramp(m, [[warp, 0], [unravel, 0.9], [rot, 1.8]]),
      pixel: ramp(m, [[warp, 1], [unravel, 4], [rot, 11]]),

      // Text blocks that sway, and how far (px).
      wobbleShare: ramp(m, [[unravel, 0], [rot, 0.45]]),
      wobble: ramp(m, [[unravel, 0.5], [rot, 1.8]]),

      // Grain, vignette, flicker, jitter and the message, 0..1.
      broken: ramp(m, [[brokenStart, 0], [rot, 1]]),
      message: m >= rot,
    };
  };

  // Minutes until the next stage begins, or null once fully decomposed.
  DD.nextStageIn = (minutes, t) => {
    const key = DD.STAGE_KEYS.find((k) => minutes < t[k]);
    return key ? { stage: DD.STAGE_KEYS.indexOf(key) + 1, minutes: t[key] - minutes } : null;
  };
})();
