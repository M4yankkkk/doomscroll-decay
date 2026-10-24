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
    // Each stage lands visibly within ~1 minute of its threshold (about a
    // second in demo mode), then keeps deepening until the next stage.
    // Ramping from zero across a whole stage read as "nothing happening".
    const land = (from, to) => from + Math.min(1, (to - from) * 0.2);
    const [f1, b1, w1, u1] = [land(fade, bleed), land(bleed, warp), land(warp, unravel), land(unravel, rot)];
    const brokenStart = unravel + (rot - unravel) * 0.5;

    return {
      minutes: m,
      stage: DD.stageAt(m, t),

      // Whole-page colour. `fade` drives the washed-out "old photo" look:
      // lifted blacks on dark pages, dimmed whites on light ones.
      sat: ramp(m, [[fade, 1], [f1, 0.72], [bleed, 0.64], [warp, 0.5], [unravel, 0.36], [rot, 0.06]]),
      sepia: ramp(m, [[fade, 0], [f1, 0.28], [unravel, 0.36], [rot, 0.4]]),
      fade: ramp(m, [[fade, 0], [f1, 0.65], [bleed, 0.72], [unravel, 0.88], [rot, 1]]),

      // Ink bleed + erosion: share of text elements affected, and how hard.
      inkShare: ramp(m, [[bleed, 0], [b1, 0.3], [warp, 0.42], [unravel, 0.6], [rot, 0.88]]),
      ink: ramp(m, [[bleed, 1], [unravel, 1.2], [rot, 1.4]]),
      erode: ramp(m, [[bleed, 0.38], [warp, 0.5], [unravel, 0.64], [rot, 0.86]]),

      // Share of longer text that has slipped into a worn typewriter face.
      fontShare: ramp(m, [[bleed, 0], [b1, 0.22], [warp, 0.3], [unravel, 0.4], [u1, 0.5], [rot, 0.7]]),

      // Posts tilt (degrees), images pixelate (block size in px; < 2 means off).
      tilt: ramp(m, [[warp, 0], [w1, 0.7], [unravel, 1.25], [rot, 2.3]]),
      pixel: ramp(m, [[warp, 1], [w1, 3], [unravel, 6], [rot, 14]]),

      // Water damage creeping in from the screen edges, 0..1.
      mold: ramp(m, [[warp, 0], [w1, 0.14], [unravel, 0.4], [u1, 0.5], [rot, 1]]),

      // Text blocks that sway, and how far (px).
      wobbleShare: ramp(m, [[unravel, 0], [u1, 0.28], [rot, 0.6]]),
      wobble: ramp(m, [[unravel, 1.4], [rot, 3.2]]),

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
