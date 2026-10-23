# Plan: site v5, a premium hero and a scroll story

**Status:** the maintainer's direction (2026-10-22), built under the autonomy rule. Same quality bar as site v4 (hex.tech-level), and the same rule: none of hex's branding, assets, layout or copy. The identity stays our own: a ledger you can audit, real data, green only on verified things, light only.

## PR 1: hero backgrounds and type polish

The maintainer's note: "The current hero looks flat. Rework the backgrounds: a fine dot/graph-paper grid that fades out radially from the centre, a soft tinted glow behind the headline, subtle grain, framed corner marks, and quiet animated connector lines and small nodes drifting around the hero (canvas or SVG, paused off-screen). Tighten the type scale, button styles and spacing so it reads as a premium product page. Update DESIGN.md to match."

Visuals only: the exhibit and its walkthrough keep their behaviour exactly.

**Tasks, in order:**

1. `HeroField.astro`, behind the hero statement (DESIGN.md §5 "The hero field"):
   - glow: a white core behind the headline inside a faint cool haze (one new token, `--aa-glow`);
   - graph paper: 24px minor lines, 96px major lines, a dot on every crossing, faded out radially from the statement's centre;
   - grain: an inline SVG noise tile (a data URI, no request);
   - the net: a canvas of small square nodes drifting, joined by elbowed hairline connectors, with an occasional ink tick along one.
2. Framed corner marks on the hero's frame.
3. Type and spacing: a fluid display size (40–68px), tighter leading and tracking, a larger hero lead, the eyebrow as a tag, and a fixed vertical rhythm in the statement.
4. Buttons: tighter, a raised secondary in a strong hairline, a trailing arrow on the primary.
5. Browser tests: the net pauses off-screen, in a hidden tab and on Pause; it is absent under reduced motion and without JS; and nothing shifts as it starts.
6. DESIGN.md (§1, §2, §3, §4, §5, §6, §7, §9, §10, plus a new §12) and STATE.

**Motion budget (the net):**
- it starts on idle after load and fades in with opacity only;
- it draws only while the hero is on screen and the tab is visible, at ≤ 30 fps;
- no layout reads per frame;
- the backing store follows the DPR, capped at 2 and at about 1.6 Mpx;
- none under reduced motion, Save-Data or without JS;
- a Pause control (WCAG 2.2.2).

**Risks:**
- Contrast over the glow. Mitigation: the core is lighter than the page, and the haze's worst case still keeps `ink-3` at 4.9:1.
- The grain bloats screenshots. They are PNGs, as in v4; only the light set is committed, because the site is light only and the dark-preference shots match it.
- The font swap moving the hero. The new browser test pins the field, its control and the corner marks at zero shift.

**Budgets:** the same as site v4:
- no third-party requests;
- Lighthouse on `/` ≥ 90 mobile and ≥ 95 desktop;
- CLS < 0.05;
- axe clean;
- no horizontal scroll at 360px;
- screenshots at 1920, 1440 and 390.

## PR 1b: a bolder hero

The maintainer, after PR 1: "it's still too flat and restrained. Be bold this time; DESIGN.md's calm/ink-only rules may be changed for the hero."

**Tasks, in order:**
1. Tokens: one brand accent (`--aa-accent`, `-deep`, `-wash`) replacing `--aa-glow`; DESIGN.md's rules changed for the hero only (§1, §2.4, §2.6, §3, §12).
2. Type: a two-voice headline (Plex Sans 700 + the serif italic) at 72–84px on desktop; Plex Sans 700 latin only (23 KB) with a metric-matched fallback face, and an italic fallback face; preloads on `/`.
3. Proof chips from generated data (`proofChips()` into `evals.json`), with icons, links and sources; unit tests and a browser test that recomputes each figure from the runs.
4. The net: more nodes, accent connectors that draw in, pulses toward the exhibit; the same pause rules, ≤ 30 fps.
5. Fixes: the eyebrow on one line at 390, Pause in its own slot.
6. Checks: CLS with CI-like fallback fonts (Noto hidden from fontconfig), the glow's contrast measured behind the text, Lighthouse, axe, 360px, before/after screenshots.

**Risks:** contrast over a visible glow (measured, ≤ 22% of the accent behind text); a late heavy face moving the page (fallback faces, checked with CI's fonts); the motion getting busy behind text (masked to 40% there).

## PR 2: the scroll-pinned story

The maintainer's spec (it overrides site v3's D2, "no scroll-pinning"): the hero exhibit tells its story as the reader scrolls instead of on a timer.

1. Pin: from 1100px, when it fits the screen, the whole hero row (statement and exhibit) is one sticky unit, a screen tall, over a scroll track below it in the section (one sentinel per step). Each step's sentinel crossing a line 65% down the screen activates the next figure and opens its note; after step 4 the whole hero releases straight into the engine machine's band with no gap (maintainer's change: the whole hero, not just the exhibit). It fits laptop screens: compact under 900px of height, tap list only under 680px.
2. Progress: step marks and a 2px rule driven by the track's view timeline (scroll-driven animation), stepped by the script where unsupported.
3. Controls: none (the maintainer withdrew prev/next): the timer, Pause, Replay, prev and next all go, and only the scroll moves the steps, keyboard scrolling included; soft cross-fades. The hero field's Pause control goes too (WCAG 2.2.2 trade-off accepted by the maintainer). `aria-live` on the caption, `aria-current="step"` on the step's chip.
4. Under 1100px (stacked, taller than a screen) and on phones: no pin; the steps stack as a list, each a disclosure that opens on tap. Reduced motion and no JS: the static list, every note open.
5. §1 "How it works": trimmed where it repeated the machine (its head); its panels show the run's artifacts, which the machine doesn't.
6. The install line wraps after `github.com/` at 390 instead of clipping.
7. Checks: Playwright (pin and step on scroll, release, tap list, reduced motion, keyboard, axe on the live modes), CLS with CI-like fonts, Lighthouse, 360px, screenshots `pr2-*.png`.

**Risks:** a pinned exhibit taller than the screen (pin only when it fits, measured before first paint); a reader without a mouse (keyboard scrolling drives the steps; figures stay links in the tab order; a polite live region); layout shift as the pin releases (position, not animation; the shift test tells sticky moves apart).

## The machine's modes: full screen, a quicker tour, explore

The maintainer's spec for the engine machine (it overrides site v4 PR 2, which dropped OrbitControls and the guided modes for the scroll-linked camera alone):

1. The stage fills the screen (100svh, full-bleed, no frame) and stays pinned through the tour, then releases into §1; it starts right where the hero's pin releases. The section's head sits over the home view's top left from 60rem and fades as the tour starts.
2. Tour (default): seven stops of neighbouring pieces instead of thirteen (`tourStops()`), a shorter band, the camera framing each group and easing between stops.
3. Explore: a click on the canvas (a "Click to explore" hint on hover) hands the camera to the reader (three's OrbitControls from `three/examples/jsm`, already part of the pinned `three`: damped, bounded zoom and tilt, pan kept over the machine); a station click opens its card; the wheel zooms, not the page. Back to tour, Esc, a press outside or scrolling the page another way eases back to the tour's stop.
4. Phones and coarse pointers: an Explore button instead of the hint; in the tour a touch scrolls the page (`touch-action: pan-y`), in explore the canvas takes it.
5. Labels: only near the stop (or the pointer in explore), never overlapping.
6. Unchanged: the still frame and the list under reduced motion, weak devices, Save-Data and no JS; three on idle once the band is near; same-origin only; no new dependency.
7. Checks: Playwright (full-viewport pin, the stops, the hint, click to explore, the wheel in both modes, a station click, Esc / Back / a press outside, the phone's button and touch scrolling, labels, reduced motion, axe in explore), CLS through the page, Lighthouse, 360px, screenshots `machine-*.png` (`site-screenshots.ts --machine`).

**Risks:** the wheel or a swipe trapped by the canvas (the controls are off in the tour, and explore is entered on purpose); a reader lost in explore (Back to tour, Esc, a press outside, and a scroll all return); layout shift from the card and the labels (fresh nodes for the card's text, hidden labels frozen while they fade).
