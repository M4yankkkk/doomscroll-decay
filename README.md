# Doomscroll Decay

A Chrome extension that makes feeds rot the longer you scroll them.

Five minutes in, the colour starts to drain. By ten, the text begins to bleed ink and wear away. At fifteen, posts come loose and images pixelate. At twenty, the words won't hold still. At thirty, the page is a grainy, near-grayscale ruin, and a small note asks if you'd like to go outside.

Everything stays on your device. The extension makes no network requests.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the extension so you can see the popup and the minutes badge.

Feed tabs that are already open start decaying straight away; there's no need to reload them.

## How time is counted

Time only counts when **both** are true:

- the tab is visible, and
- you've scrolled (wheel, touch, scroll keys, or a scrolling feed container) in the last 30 seconds.

Totals are kept per site, per day, in `chrome.storage.local`, keyed by your local date, so they reset at midnight. Decay is driven by your **combined** time across all feed sites, so switching from X to Reddit doesn't give you a fresh page.

## Stages

| Default | Stage | What happens |
| --- | --- | --- |
| 5 min | Fading | Colour slowly drains out of the page. |
| 10 min | Bleeding | Random lines of text start to bleed ink and erode. |
| 15 min | Warping | Posts tilt a degree or two; images begin to pixelate. |
| 20 min | Unravelling | Text wobbles; more of it bleeds. |
| 30 min | Decomposed | Near-grayscale, grain, vignette, heavy pixelation, the odd glitch, and the note. |

No effect switches on abruptly. Each stage eases in visibly within about a minute of its threshold, then keeps deepening until the next one, and every text element fades in on its own schedule. Reset (or midnight) heals the page the same way.

Thresholds and the site list are configurable from the settings page (the sliders icon in the popup). Adding a site asks Chrome for permission to run on that domain; subdomains are included.

## Demo mode

Toggle **Demo mode** in the popup and time runs 60× faster: about 30 seconds of scrolling takes a page from fresh to fully decomposed. Demo time is stored separately and starts from zero each time you turn it on, so recordings never touch your real stats.

Recording tips: turn demo mode on, open the feed, start recording, then scroll steadily. If you want the page fresh again, use **Reset demo** in the popup.

## How it's built

Plain JavaScript, no build step, no dependencies.

```
manifest.json
src/
  shared/      config.js (defaults, helpers), decay-curve.js (minutes → effect strengths), ui.css
  background/  service-worker.js: the only writer of totals; registers content scripts per site; badge
  content/     tracker.js (active time), decay.js + decay.css (text, tilt, pixelation),
               overlay.js (colour, grain, the note), main.js (wiring)
  popup/       today's time, stage, per-site breakdown, demo toggle, reset
  options/     sites and thresholds
assets/        icons, bundled fonts (OFL), grain and erosion textures
```

A few details worth knowing if you change things:

- **Colour loss is a filter on `<html>`.** A `backdrop-filter` overlay stops working once the page has been scrolled (always, on a feed), and a *transform* on the root would break every `position: fixed` header. A root filter does neither. That's also why tilt is applied to individual posts.
- **The fade adapts to the theme.** Desaturating a black-and-white page does nothing, so on dark sites the fade lifts black into a warm charcoal and turns white text cream; on light sites the whites dim to a creamy paper.
- **Grain, vignette and the note live in the top layer** (a manual popover in a closed shadow root), so they sit above the root filter and the note keeps its colour.
- **Every stage lands visibly within about a minute of its threshold** (about a second in demo mode), then keeps deepening.
- **Ink bleed and erosion** are a thin text stroke plus a soft shadow, and a mask that blends from solid to a speckle texture. Nothing that affects layout changes, so the feed never reflows.
- **Textures and fonts are extension files**, not `data:` URIs. Sites' Content Security Policies commonly block `data:` images; extension resources aren't affected.
- **Global strengths aren't transitioned on `:root`.** That would restyle the whole page every frame. They step four times a second, and smoothness comes from per-element transitions.
- Respects `prefers-reduced-motion`: the rot stays, the movement goes.

## Privacy

No analytics, no remote code, no network requests. The only data stored is seconds per site per day (kept for 14 days) and your settings.

## Credits

Fonts: [Instrument Serif](https://github.com/Instrument/instrument-serif) and [Inter](https://github.com/rsms/inter), both under the SIL Open Font License (see `assets/fonts/`).
