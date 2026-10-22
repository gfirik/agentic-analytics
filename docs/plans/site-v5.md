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

## PR 2: the scroll-pinned story

The next PR. Not started here.
