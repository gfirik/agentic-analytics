# agentic-analytics site design

This is the design system for the product site in `apps/docs`: the landing page, the docs and the 404. Every token lives in one file, `src/styles/tokens.css`. If this document and that file disagree, fix whichever is wrong in the same PR: they must agree.

## 1. Identity: an AI analyst you can audit

The site should feel like a well-kept ledger: calm, precise, and checkable line by line. The product's promise is that every number can be traced, so the site shows numbers the same way the report does. Each one sits next to the ID of the fact it came from, and a mark shows that it was recomputed.

- **It is:** an audited statement, a lab notebook, an engineer's reference. Quiet surfaces, ruled lines, exact figures.
- **It is not:**
  - an AI startup page (no gradients, glow, robots or brains);
  - a BI dashboard (no chart wall);
  - a warm "paper" site. Our sibling project pas-agent uses cream and amber; this site is deliberately cool.
- **Tone:** plain statements that can be checked. "Recomputed by the verifier", never "powered by AI". Caveats sit next to the number they qualify, not in a footnote.

## 2. Principles

1. **Typography leads.** A serif display face for statements, a neutral sans for reading, a mono for every figure and identifier. Hierarchy comes from size and face, not from colour.
2. **Hairlines over shadows.** Separation comes from 1px rules and two surface tones. Nothing floats, so there is no elevation.
3. **One accent, and it means "verified".** Green appears only on things the verifier passed:
   - the check mark on a recomputed number;
   - V1–V8 pass states;
   - passed eval checks;
   - the "verified" badge.
   It is never used for links, buttons, decoration or emphasis.
4. **Every number is real.**
   - Figures on the site come from generated data: real engine runs and `evals/results/*.json`, through `scripts/generate.ts`.
   - Each figure carries its fact ID or its source file. Nothing is typed by hand.
   - There are no fake metrics and no testimonials.
5. **Every command exists.** A test extracts each `aa …` and `bun run …` command from the site sources and checks it against the CLI and package scripts.
6. **Complete without JavaScript and without motion.**
   - Islands render their final state on the server.
   - Fact chips are links into a static fact ledger.
   - Motion only replays what is already there.
7. **Local, even for the site.**
   - Fonts are self-hosted through `@fontsource`.
   - There are no third-party requests at runtime: no analytics, no CDN, no embeds.

## 3. Colour

Light is the default. Dark applies under `prefers-color-scheme: dark` (with no JS), or when the user picks it: the choice is saved under Starlight's own `starlight-theme` key, so it is shared between the landing page and the docs.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--aa-page` | `#f7f9fb` | `#0b1220` | Page background |
| `--aa-surface` | `#eef2f6` | `#101a2b` | Slate surfaces: code, sidebars, ledger header rows |
| `--aa-raised` | `#ffffff` | `#142036` | Panels that hold a report or a fact |
| `--aa-mark` | `#e2e9f1` | `#1c2a42` | Highlighted cited rows, hover washes (not an accent) |
| `--aa-rule` | `#d8dfe7` | `#24324a` | Hairlines, table rules, chip boxes |
| `--aa-rule-strong` | `#8696a9` | `#566781` | Ledger header rules, input borders (≥ 2.5:1, decorative) |
| `--aa-ink` | `#0e1a2b` | `#e7edf4` | Primary text, primary buttons, focus ring |
| `--aa-ink-2` | `#46566b` | `#a8b5c5` | Secondary text |
| `--aa-ink-3` | `#5a6a7e` | `#8f9db0` | Labels and captions; on `page` and `raised` only |
| `--aa-verified` | `#0b6b3a` | `#4cc38a` | The accent: verified marks and pass states, as text or icon |
| `--aa-verified-wash` | `#e6f2ea` | `#0f2a20` | Background of a verified badge only |

Contrast ratios (WCAG relative luminance; axe re-checks them in CI). All text pairs pass AA (4.5:1):

- `ink`: 16.6:1 on page (light) and 15.9:1 (dark).
- `ink-2`: 7.1:1 and 9.0:1.
- `ink-3`: 5.2:1 and 6.8:1 on page, and 4.9:1 and 6.3:1 on surface.
- `verified`: 6.3:1 on page (light), 5.7:1 on its wash, and 8.5:1 on page (dark).

Rules:

- **No cream, no amber, no gradients.** The only hue outside the slate/navy family is the verified green.
- **Failure is not a colour.** Dropped claims are struck through and labelled "dropped". Negative contributions are solid ink, positive ones are outlined. Shape and text carry the meaning, so it survives greyscale and colour blindness.
- **Links are ink with a hairline underline** that turns ink on hover. Their underline and position make them visible, not their colour.

## 4. Typography

All three faces are self-hosted through `@fontsource` and imported once, in `src/styles/fonts.css`.

| Role | Face | Use |
|---|---|---|
| Display | **Source Serif 4** (variable, optical size) | `h1`, `h2`, the landing statements. It gives the book or ledger voice. |
| Text and UI | **IBM Plex Sans** 400 / 500 / 600 | Body, navigation, buttons, `h3` and below |
| Figures and code | **IBM Plex Mono** 400 / 500 | Every number, fact-ID chip, code, labels. Always `tabular-nums`, ligatures off. |

The scale (rem, root 16px; mobile values apply under 640px):

| Token | Size / line height | Face | Use |
|---|---|---|---|
| `--aa-text-display` | 3.5 / 1.05 (2.25 mobile), −0.02em | Serif 450 | The hero statement (one per page) |
| `--aa-text-h2` | 2.25 / 1.15 (1.75), −0.015em | Serif 450 | Section headings |
| `--aa-text-h3` | 1.125 / 1.4 | Sans 600 | Card, row and step titles |
| `--aa-text-lead` | 1.1875 / 1.55 | Sans 400, `ink-2` | Lead paragraphs |
| `--aa-text-body` | 1 / 1.6 | Sans 400 | Body copy |
| `--aa-text-small` | 0.875 / 1.5 | Sans 400 | Captions, caveats |
| `--aa-text-label` | 0.75 / 1.3, +0.06em, uppercase | Mono 500, `ink-3` | Eyebrows, ledger column heads, section references |
| `--aa-text-figure` | inherits | Mono, `tabular-nums` | Inline numbers |

Prose is capped at `--aa-measure` (68ch). Docs articles follow Starlight's content width.

## 5. Layout and spacing

- **Spacing scale:** `--aa-space-1` … `--aa-space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96 px. Never use a value outside the scale.
- **Container:** 1180px max, 24px side gutters (16px under 480px).
- **Landing sections** are separated by a full-width hairline, with `--aa-space-9` of vertical padding (`--aa-space-8` on mobile). Each section opens with a ledger reference label (`§1 The report`), a serif heading and a lead.
- **Docs:** Starlight's three-column frame (sidebar | content | TOC), re-themed:
  - the sidebar sits on `surface` with a hairline edge;
  - the TOC marks the current heading with an ink rule;
  - the header is shared with the landing page.
- **Radii:** 2px for chips, 4px for buttons, panels and code. Nothing rounder.
- **Width:** at 360px nothing scrolls sideways. Wide tables and code scroll inside their own container.

## 6. Ledger motifs (components)

- **Fact-ID chip** (`.aa-chip`):
  - mono 0.75rem in `ink-2`, inside a 1px `rule-strong` box with a 2px radius, e.g. `N30`; a verified fact's chip starts with the green check (`✓N30`);
  - it follows the figure it backs: `−17.9% N30`;
  - it is a link to that fact's row in the fact ledger (`#fact-N30`), so it works without JS. With JS it opens the fact panel in place (`aria-expanded`, `aria-controls`; Escape closes it);
  - hover and focus show an `ink` box, and the open chip is filled `ink` with `page` text.
- **Verified mark** (`.aa-check`):
  - a 0.9em check-mark SVG in `--aa-verified`, after a recomputed figure or a passed check;
  - it always has a text alternative ("verified", "pass");
  - a failed check shows a struck-through "fail" in `ink`, never red.
- **Ruled table** (`.aa-ledger`):
  - no outer box: a 1px `rule-strong` line under the header, `rule` hairlines between rows, a label-style header;
  - IDs in the first column in mono, figures right-aligned in mono with tabular numbers;
  - on narrow screens it scrolls inside a wrapper (`.aa-ledger-wrap`) that is keyboard-focusable, has a label, and shows its edge with a hairline.
- **Fact panel:** a `raised` panel with a hairline. It shows:
  - the fact's label, value and unit;
  - its computation (SQL and parameters, or the function and its inputs);
  - the cited rows;
  - its verification state.
- **Buttons:**
  - `.aa-btn` is Plex Sans 500 at 0.9375rem, 10×16 padding, 4px radius;
  - the primary is `ink` filled with `page` text, the secondary is a 1px `ink` outline;
  - hover changes the background tone only.
- **Code:**
  - Expressive Code with `github-light` / `github-dark`, re-based onto `surface` (so its contrast correction targets our real background);
  - a hairline frame, a mono 0.875rem body, no window dots;
  - terminal frames are labelled with a mono caption.
- **Diagrams:**
  - Mermaid is initialised with the token colours and Plex Sans.
  - The pipeline scene (`pipeline-scene.ts`) is shared with the README GIF, so the site re-themes it rather than changing its colours. It does this through the scene's `--pp-*` custom properties and three class hooks the scene carries for the site (the GIF doesn't style them):
    - `ink` for progress (the rail, the current stage, headings);
    - `mark` for packets;
    - fact IDs (`.fact-chip`, `.fact-id`) as hairline chips: a `rule-strong` stroke, `ink-2` text and a 2px radius, the same as the Fact-ID chip above;
    - V1–V8 pass marks and the "verified, cited" stamp (`.verified`) in `--aa-verified`;
    - corners at 4px.
  - The scene is its own frame, with a hairline and no island box around it.
  - Under 30rem its type is too small to read, so the island also tells the same run as a ruled list of steps, from the same data.
- **Header:** the wordmark, a mark (a ruled square with a check, `aria-hidden`, drawn in `currentColor`: it is the brand, not a verified state, so it is never green; the favicon is the same mark in ink), then Docs, Evals and GitHub. In the docs it adds search and the theme control. Under 720px the landing links fold into a menu button (`aria-expanded`, `aria-controls`, Escape closes it and returns focus).
- **Footer (every page):** project links, the licence, and "Built by fhsystems", linking to https://fhsystems.dev.

## 7. Motion

- **Hover and focus:** 120–160ms changes to colour, background or border only.
- **The pipeline:**
  - it plays the README scene while on screen, and has Play/Pause and per-stage stops;
  - under `prefers-reduced-motion: reduce` it never autoplays and shows the finished frame (the server render);
  - without JS the same still frame is in the HTML.
- **Nothing else moves:** no entrance animations, no parallax, no looping decoration.
- **Reduced motion** also turns off smooth scrolling and every transition.

## 8. Accessibility

- WCAG 2.1 AA, checked by axe in CI on the landing page, a docs page and the 404, in light and dark.
- A skip link on every page, landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, and headings in order.
- A visible `:focus-visible` ring on everything: 2px `ink`, 2px offset.
- Targets are at least 24×24px (the chips have padding plus spacing).
- Decorative SVGs are `aria-hidden`. The pipeline and the report have text labels.

## 9. What we don't use

- **Look:** gradients, glow, glassmorphism, shadows, cream or amber, rounded "bubbly" cards, emoji, stock imagery, third-party logos.
- **Claims:** fake metrics or testimonials, a pricing table, a newsletter pop-up, a chat widget, a cookie banner. Nothing on the page is there only because "landing pages have it".

## 10. Checklist before shipping a page

1. Does every number come from generated data, and does every command exist (`scripts/test/site-commands.test.ts`)?
2. Is the page complete with JS off and with reduced motion on?
3. Does axe report no WCAG A/AA violations in light and in dark?
4. Is there no horizontal scroll at 360px?
5. Are there no requests to any origin but the site's own?
6. Is green used only for "verified"?
