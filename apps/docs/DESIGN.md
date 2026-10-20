# agentic-analytics site design

This is the design system for the product site in `apps/docs`: the landing page, the docs (including Learn) and the 404. Every token lives in one file, `src/styles/tokens.css`. If this document and that file disagree, fix whichever is wrong in the same PR: they must agree (`scripts/test/site-light.test.ts` checks the colour table).

## 1. Identity: an AI analyst you can audit

The site is an **audited working paper**:

- **The landing page is the cover sheet.** It is a calm, graph-paper surface with one live exhibit: a real report that proves itself as you scroll, and again when you touch it.
- **The docs are the bound appendix.** They are long-form, quiet and built for reading, with evidence in the margin.

The product's promise is that every number can be traced, so the site shows numbers the same way the report does. Each one sits next to the ID of the fact it came from, and a mark shows that it was recomputed.

- **It is:** an audited statement, a lab notebook, an engineer's reference. Quiet surfaces, ruled lines, exact figures.
- **It is not:**
  - an AI startup page (no gradients, glow, blobs, 3D, robots or brains);
  - a BI dashboard (no chart wall);
  - a warm "paper" site. Our sibling project pas-agent uses cream and amber; this site is neutral off-white and ink.
- **Tone:** plain statements that can be checked. "Recomputed by the verifier", never "powered by AI". Caveats sit next to the number they qualify, in the margin when there is one.

## 2. Principles

1. **Light only.** There is one theme: no dark tokens, no theme control, no `prefers-color-scheme` rules and no stored theme. Starlight's own theme provider and picker are overridden (`components/starlight/ThemeProvider.astro`, `ThemeSelect.astro`).
2. **Typography leads.** A serif for statements and for reading, a neutral sans for the interface, a mono for every figure and identifier. Hierarchy comes from size and face, not from colour.
3. **Hairlines over shadows.** Separation comes from 1px rules and two surface tones. Nothing floats, so there is no elevation and there are no cards with shadows: content blocks are cells of a frame.
4. **One accent, and it means "verified".** Green appears only on things the verifier passed:
   - the check mark on a recomputed number;
   - V1–V8 pass states;
   - passed eval checks;
   - the "verified" badge.
   It is never used for links, buttons, decoration or emphasis.
5. **One moment of motion.** The hero exhibit's verification replay and its guided walkthrough are the only motion that starts by itself. The pipeline stages move only after the reader presses Play. Everything else is still, apart from 150ms hover and focus changes (§7).
6. **Premium through restraint:** exact alignment, hairlines, generous space, real data. No gradients, glow, blobs, 3D, stock illustration or emoji.
7. **Every number is real.**
   - Figures on the site come from generated data: real engine runs and `evals/results/*.json`, through `scripts/generate.ts`. That includes the status strip, the exhibit and the Learn sidenotes.
   - Each figure carries its fact ID or its source file. Nothing is typed by hand (`scripts/test/landing-exhibit.test.ts`, `scripts/test/learn.test.ts`).
   - There are no fake metrics and no testimonials.
8. **Every command exists.** A test extracts each `aa …` and `bun run …` command from the site sources and checks it against the CLI and package scripts.
9. **Complete without JavaScript and without motion.**
   - The server renders the final state: the exhibit already verified, sidenotes in place.
   - Fact chips are links into a static fact ledger.
   - Motion only replays what is already there.
10. **Local, even for the site.**
    - Fonts are self-hosted through `@fontsource`.
    - There are no third-party requests at runtime: no analytics, no CDN, no embeds.

## 3. Colour (light only)

| Token | Value | Use |
|---|---|---|
| `--aa-page` | `#f8f8f6` | Page background (neutral off-white, not cream) |
| `--aa-grid` | `#ecece8` | Graph-paper lines (decorative only) |
| `--aa-raised` | `#ffffff` | Exhibits, panels, code |
| `--aa-surface` | `#f1f2f0` | Sidebars, the status strip, ledger header rows, inline code |
| `--aa-mark` | `#e8ecef` | Highlighted cited rows, hover washes (not an accent) |
| `--aa-rule` | `#dcdcd6` | Hairlines, frames |
| `--aa-rule-strong` | `#8b8f94` | Header rules, chip boxes, corner ticks (≥ 2.7:1, decorative) |
| `--aa-ink` | `#121417` | Primary text, primary buttons, focus ring |
| `--aa-ink-2` | `#4a4f57` | Secondary text |
| `--aa-ink-3` | `#5f646c` | Labels, captions |
| `--aa-verified` | `#0b6b3a` | The accent: verified marks and pass states only |
| `--aa-verified-wash` | `#e7f2ea` | Background of a verified badge only |

Contrast ratios (WCAG relative luminance; axe re-checks them in CI). All text pairs pass AA (4.5:1):

- `ink`: 17.4:1 on page, 18.5:1 on raised.
- `ink-2`: 7.8:1 on page, 6.9:1 on mark.
- `ink-3`: 5.6:1 on page, 5.3:1 on surface, 5.0:1 on mark.
- `verified`: 6.2:1 on page, 6.6:1 on raised, 5.8:1 on its wash.

Rules:

- **No cream, no amber, no gradients.** The only hue is the verified green.
- **Failure is never a colour.** Dropped claims are struck through and labelled "dropped". A failed check is a struck-through "fail" in ink. Negative contributions are solid ink, positive ones are outlined. Shape and text carry the meaning, so it survives greyscale and colour blindness.
- **Links are ink with a hairline underline** that turns ink on hover. Their underline and position make them visible, not their colour.

## 4. Typography

All three faces are self-hosted through `@fontsource` and imported once, in `src/styles/fonts.css`.

- **Serif file.** The serif uses its weight-axis file (51 KB) with its italic, not the optical-size file (122 KB). The docs' first paint is serif prose, and the larger file kept the Learn pages under Lighthouse 95.
- **Preloads.** The serif is preloaded on every page and Plex Sans 400 on the landing page (`FontPreloads.astro`).
- **CSS.** Page CSS is inlined (`astro.config.mjs`).

| Role | Face | Use |
|---|---|---|
| Display | **Source Serif 4** (variable, weight axis) | The hero statement, section headings, docs `h1`/`h2` |
| Reading (docs body) | **Source Serif 4** text, 1.0625rem / 1.65 | Docs and Learn article prose: book-like, Tufte-style |
| UI | **IBM Plex Sans** 400 / 500 / 600 | Navigation, buttons, landing body copy, captions, docs `h3`, sidenotes, tables and islands inside articles |
| Figures, labels, code | **IBM Plex Mono** 400 / 500 | Every number, fact-ID chip, label, code. Always `tabular-nums`, ligatures off. |

The scale (rem, root 16px; mobile values apply under 640px):

- **Larger than h2:** nothing renders larger than `--aa-text-h2` except the hero statement and a page's own h1 (the docs h1 is 2.5rem, 2rem on mobile).
- **Reading text in figures:** no reading text inside a figure is smaller than `--aa-text-note`. A figure is any diagram, island, ledger or framed panel, with everything inside its frame. Mono uppercase labels and fact chips are not reading text: they keep `--aa-text-label`, and nothing on the site is smaller than that.
- **Code:** one size everywhere, 0.8125rem (site v3 PR 4 moves every code block onto one token, `--aa-text-code`).

| Token | Size / line height | Face | Use |
|---|---|---|---|
| `--aa-text-display` | 3.5 / 1.05 (2.25 mobile), −0.02em | Serif 450 | The hero statement (one per page) |
| `--aa-text-h2` | 2.25 / 1.15 (1.75), −0.015em | Serif 450 | Section headings |
| `--aa-text-h3` | 1.125 / 1.4 | Sans 600 | Cell, row and step titles |
| `--aa-text-lead` | 1.1875 / 1.55 | Sans 400, `ink-2` | Lead paragraphs |
| `--aa-text-reading` | 1.0625 / 1.65 | Serif | Docs and Learn prose |
| `--aa-text-body` | 1 / 1.6 | Sans 400 | Landing body copy |
| `--aa-text-small` | 0.875 / 1.5 | Sans 400 | Captions, caveats |
| `--aa-text-note` | 0.8125 / 1.5 | Sans 400, `ink-2` | Sidenotes, margin notes, the TOC |
| `--aa-text-label` | 0.75 / 1.3, uppercase, `--aa-label-tracking` (+0.08em) | Mono 500, `ink-3` | Labels, ledger column heads, section references |

- **Labels:** Plex Mono at `--aa-text-label` (0.75rem), uppercase, +0.08em tracking, in `ink-3`.
- **Bracketed section labels** on the landing page: `⊣ §1 HOW IT WORKS ⊢`, in mono, centred on a hairline (`SectionLabel.astro`).
- **Measures:** docs prose is 62–66ch (`--aa-article`, 36rem ≈ 64ch of the serif at 17px). Landing copy is 56ch (`--aa-measure`).

## 5. Layout and spacing

- **Spacing scale:** `--aa-space-1` … `--aa-space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96 px. Never use a value outside the scale.
- **Container:** 1180px max, 24px side gutters (16px under 480px).
- **Radii:** 2px for chips, 4px for buttons, panels and code. Nothing rounder.
- **Width:** at 360px nothing scrolls sideways. Wide tables and code scroll inside their own container.

### The landing page (the cover sheet)

- **The frame.** The page content sits inside one long vertical frame, running the full height of the page:
  - 1px `rule` lines left and right of the 1180px container;
  - sections divided by full-width hairlines that meet the frame;
  - a small `+` tick in `rule-strong` where the lines cross.

  This is the "working paper" structure, and it replaces cards. Under 720px only the hairlines remain.
- **Graph-paper field.** A 24px grid in `--aa-grid`, behind the hero and the section heads only. It fades to the plain page at the edges through a CSS mask (no image) and is never behind long text.
- **Status strip.** One quiet mono line above the header, on `surface`, not a scrolling marquee. On narrow screens it stays one line and scrolls sideways (keyboard-focusable) instead of wrapping, so the font swap can't move the page. Proven results lead: the release, the real public data checks, the real-model smoke run, the test files and the verifier. The generated-business suite comes last as the nightly regression check, a link to §3's results, never a headline figure (a partial pass reads as failure next to proven results). Its values come from generated data (`statusStrip()` in `scripts/landing-data.ts`).
- **Sections, in order** (nothing else: no testimonials, logo wall or newsletter):
  1. Status strip, header, then the hero, in hex.tech's structure rather than two columns:
     - a **centred statement block**: a mono eyebrow label, the serif headline, one or two lines on what it is and what it solves, the actions, and the install line;
     - below it, **the exhibit as its own framed section**, full container width, its top visible above the fold on 1440×900.
  2. `§1 HOW IT WORKS`: the pipeline stages (§6), full container width, inside the frame, one sentence above it.
  3. `§2 WHY IT'S DIFFERENT`: exactly three proof cells side by side (stacked on mobile): "The model never does arithmetic", "Definitions you confirm", "Every claim is cited". Each has a mono label, one sentence and one real tiny example: a chip, the metric's definition with the 2-line SQL it compiles to, a citation.
  4. `§3 RESULTS, AS THEY ARE`: one ruled table from `evals/results`, **metrics as rows, runs as columns**, so it fits the 1180px container with no sideways scroll.
     - **Rows:** every bar a real-model run can miss (planted recall, distractor false positives, driver accuracy, cause grade, citation precision, recommendation relevance, number mismatches), each with its bar stated once in the row label.
     - **Columns:** real public data, the real-model smoke run, the nightly regression, then the offline baseline. Each head gives the run, a one-line note, its jobs and its date.
     - **Cells:** a figure plus the check, or a struck-style "below bar"; "meets the bar" is screen-reader text only.
     - **A run without rates gets one cell spanning every metric row:**
       - the real public data, scored by its own checks (12/12);
       - a run with jobs missing: partial after its last pass, in progress between passes, labelled from the generated status, with its jobs-finished count.
     - **Sources:** the result files sit in a `<details>` under the table, with the RESULTS.md link.
     - **Under 60rem** the table scrolls inside its wrapper with the metric column held in place.
  5. `§4 QUICKSTART`: three steps (install, model, analyze) with code, the binary downloads and the Docker line, and the four doors (CLI, API, MCP, Telegram) as a ruled list.
  6. The footer.

### Docs and Learn (the bound appendix)

- **Columns:** left sidebar (240px, `surface`, hairline edge) | article column (≈ 64ch) | **margin column** (~260px, narrowing to 176px between 1000 and 1200px) for sidenotes.
  - Built by overriding Starlight's `TwoColumnContent` and `PageSidebar`.
  - The article is left-aligned next to the sidebar.
- **The on-page TOC** sits at the top of the margin column and is sticky, with the page background and a height cap; it marks the current heading with an ink rule. Under 1200px it collapses into Starlight's TOC bar. While a full-width figure or a sidenote passes beneath it, it steps aside (JS), so neither is covered; without JS it stays on top.
- **Sidebar:** mono section labels, sans items, the active item marked with a 2px ink rule on the left.
- **Measure between 1000 and ~1072px:** article, gap and margin column always fit beside the sidebar; the article gives up a little measure there rather than letting notes and figures run off the page.
- **Sidenotes** for fact IDs and sources, definitions of terms (with a glossary link) and caveats (§6). From 1000px they sit in the margin; under 1000px they are tap-to-expand inline notes.
- **Full-width figures** (`.aa-fullwidth`, and automatically the stage diagram, Mermaid diagrams and the pipeline stages) run across the margin column from 1000px, clearing any sidenote beside them.
- **Epigraph-style lead** at the top of each Learn stage page: one sentence on the problem the stage solves, in serif italic (`epigraph` frontmatter, rendered by `PageTitle.astro`).
- **Headings:** `h1`/`h2` in the serif, no rule under `h2`; `h3` in Plex Sans 600.
- **The header** is shared with the landing page. Search (Pagefind) stays. There is no theme control.

## 6. Ledger motifs (components)

- **Fact-ID chip** (`.aa-chip`):
  - mono 0.75rem in `ink-2`, inside a 1px `rule-strong` box with a 2px radius, e.g. `N30`; a verified fact's chip starts with the green check (`✓N30`);
  - it follows the figure it backs: `−17.9% N30`;
  - it is a link to that fact's row in a fact ledger (`#fact-N30`), so it works without JS;
  - hover and focus show an `ink` box, and the open chip is filled `ink` with `page` text.
- **Verified mark** (`.aa-check`):
  - a 0.9em check-mark SVG in `--aa-verified`, after a recomputed figure or a passed check;
  - it always has a text alternative ("verified", "pass");
  - a failed check shows a struck-through "fail" in `ink`, never red.
- **Ruled table** (`.aa-ledger`):
  - no outer box: a 1px `rule-strong` line under the header, `rule` hairlines between rows, a label-style header;
  - IDs in the first column in mono, figures right-aligned in mono with tabular numbers;
  - on narrow screens it scrolls inside a wrapper (`.aa-ledger-wrap`) that is keyboard-focusable, has a label, and shows its edge with a hairline; a row-label column may stay in place (`position: sticky`) while the rest scrolls;
  - a value that doesn't exist for a whole column (a run without rates) is one cell spanning those rows, with hairlines either side and its reason in it, never a column of repeated "n/a".
- **The hero exhibit** (`components/site/Exhibit.astro`):
  - **What it is.** A `raised` panel with a hairline, styled like a report page and titled in mono (`REPORT · COFFEE-ROASTER · APRIL`).
    - It shows the recorded run's first finding (`src/data/exhibit.json`): its two headline claims, the document-supported cause with its source chip, and the top recommendation with its impact range.
    - This is the report's own text, with every figure a fact's stored value.
  - **The verification replay.** As the exhibit comes into view (its report page's top above the bottom sixth of the screen), and only without `prefers-reduced-motion`, the figures are verified one by one, top to bottom: each chip's box draws in, then the green check appears in the space it already holds (~250ms per figure, ≤ 2.5s in all). An inline script holds the figures unverified before first paint. With reduced motion or no JS, the server-rendered verified state is all there is.
  - **The guided walkthrough.** The exhibit demonstrates itself, with no hover needed. After the verification it steps through the story's key figures, opening each one's margin note under a step indicator (`1/4 Revenue fell −17.9% → how it was computed`), with a progress rule and previous, next and replay buttons.
    - The steps are chosen from the run's data by role (`walkthrough()` in `scripts/landing-data.ts`), never by typed id: the headline change and how it was computed; its current-period SQL input with the SQL and the sheet rows it read; the driver's share of the change; the quoted document.
    - From 1100px wide and 704px tall, scroll drives the steps: the exhibit section is sticky, centred on screen, while a track of half a screen per step (plus one for the verification) scrolls past. Previous and next scroll to their step; Replay scrolls back without flashing the steps it passes. Every step's note fits on screen there (a browser test checks 1100×704).
    - On smaller screens the same steps advance every 4.5 seconds while the notes (below the figure under 900px) are on screen, under a sticky step bar. The timer waits while the reader hovers or focuses inside the exhibit, a Pause/Play button stops it (WCAG 2.2.2), and stepping by hand pauses it. The notes and the step captions each share one grid cell as tall as the tallest, so stepping never moves the page.
    - The step's figure takes the `mark` wash in the text, and its chip shows open. Prev and next use `aria-disabled` at the ends, so keyboard focus is never lost.
    - Step 0 says what the verifier did to what is shown: the figures recomputed and the quotes checked, counted from the notes.
    - Under reduced motion, or without JS, the steps are a static ruled list under the exhibit, each with its note; no sticky track, no step bar.
    - The walkthrough is switched on before first paint (`data-walk="live"`), so the track and the list never shift the layout.
  - **Margin notes.** Hovering or focusing a figure slides a Tufte-style margin note out to the right of the exhibit, joined to the figure by a hairline leader. From 900px it sits beside the exhibit; under 900px it sits below. The note shows:
    - the fact's ID and label, its value and its recomputed mark;
    - the SQL that computed it, laid out one clause per line and tinted in ink shades only, with its parameters; or, for a function fact, the function and its input facts as a ruled table;
    - the cited sheet rows: the first cited row and its neighbours, read back from the run's DuckDB, with the cited rows in the `mark` wash;
    - for a document, the exact quote and where it is.

    Esc or blur closes it, and a click pins it (for touch); letting go returns to the walkthrough's current note. The empty margin column carries a small mono hint.
  - **The fact ledger.** It holds every fact behind the exhibit and is collapsed under the hero until one of its rows is the link target (`:has(:target)`). The chips link to it without JS.
  - **Caption.** A small mono caption: "Recorded from a real engine run. Any number opens how it was computed."
- **Sidenote** (`components/learn/Sidenote.astro`, MDX):
  - It shows as a numbered superscript in the text (numbered per page, in reading order).
  - The note sits in the margin column beside its line, in Plex Sans 0.8125rem `ink-2`.
  - Under 1000px it is a tap-to-expand inline note on a `surface` wash with an ink rule. A visually hidden checkbox makes it keyboard-focusable, and it works without JS.
  - Keep its content inline: text, links, `<Fact />`, code.
- **Margin note** (`components/learn/MarginNote.astro`): the same without a number. Under 1000px a small ⊕ toggles it.
- **Buttons:**
  - `.aa-button` is Plex Sans 500 at 0.9375rem, 10×16 padding, 4px radius;
  - the primary is `ink` filled with `page` text, the secondary is a 1px `ink` outline, and a third action is a plain text link;
  - hover changes the background tone only.
- **Code:**
  - Expressive Code with `github-light` only, re-based onto `raised` (so its contrast correction targets our real background);
  - a hairline frame, a mono 0.875rem body, a mono caption label, no window dots.
- **Diagrams:**
  - Mermaid is initialised with the token colours and Plex Sans.
  - The pipeline scene (`pipeline-scene.ts`) draws the README GIF only. The site never uses it: its fixed 640×480 canvas scaled its type past the h2 on desktop and below reading size on phones.
- **Pipeline stages** (`components/site/PipelineStages.astro`), on the landing page (§1), Learn, What it is and Pipeline overview:
  - **The run:** one real run of the example (`docs/assets/readme/pipeline.json`, the same data as the README GIF), told as a **rail** of seven stops above **one ledger panel per stop**, at the site's own sizes. Every figure is the run's fact with its chip (`pipeline-stages.ts` only picks rows; it computes nothing).
  - **The rail:** mono labels at `--aa-text-label` on a 1px `rule`, a 2px ink rule under the stops up to the current one. Each stop is a button (`aria-pressed`, `aria-controls` its panel); its title lists the engine stages behind it, from the run's event log.
  - **The panels:**
    - Files is a ledger of name, kind and how it's read.
    - Profile gives the three counts.
    - Metric is the definition and its compiled SQL.
    - SQL is a ledger of the two periods, the change and the driver.
    - Evidence holds the document quotes with source, file and grade, and the web quote labelled external.
    - Verify is the eight checks V1–V8 as ruled cells (how many times each ran, then a pass mark or how many claims it caught) plus the verifier's totals.
    - Report is the headline and the top action with its impact range and dated check.
  - **Live** (JS, from 40rem; switched on before first paint, so nothing shifts): the panels share one grid cell as tall as the tallest, and the finished report shows first. Play steps through the stops once, every 2.5 seconds while on screen, and stops at Report; it reads Pause while running, and pressing a stop stops it there. Changing stop crossfades the panel content only, in 150ms. Under reduced motion there is no Play and no crossfade; the stops still work.
  - **Without JS, or under 40rem,** the panels are a stacked ruled list, with no rail.
  - **Markup:** each panel is a `role="group"` named by its title (not a heading, so it fits under any page's outline). On docs pages the root carries `not-content`, so Starlight's flow margins and the prose table and inline-code rules don't reach in (the prose colour, link and strong rules still do, and match).
- **Stage diagram** (`StageFlow`, Learn):
  - three ruled columns on a `raised` panel: In → the stage's steps → Out, full width;
  - figures in mono with their fact chips; a selected step and its outputs take the `mark` wash;
  - the server renders every step done; buttons step through it, and Play is offered only without reduced motion;
  - under 50rem the columns stack, with ↓ between them.
- **Recorded output** (`Transcript`, Learn): a `surface` block in mono with a label-style caption; long lines scroll inside it, and a note names what was replaced.
- **Header:**
  - The wordmark, a mark, then the links. The mark is a ruled square with a check, `aria-hidden`, drawn in `currentColor`. It is the brand, not a verified state, so it is never green; the favicon is the same mark in ink.
  - Landing: How it works, Results, Docs, GitHub. Docs: search, Results, GitHub.
  - Under 720px the landing links fold into a menu button (`aria-expanded`, `aria-controls`; Escape closes it and returns focus).
- **Footer (every page):** project links, the licence, and "Built by fhsystems", linking to https://fhsystems.dev.

## 7. Motion

- **Landing:** the hero verification replay and its walkthrough are the only motion that starts by itself (scroll-linked on desktop, timed on small screens). The pipeline stages move only after Play. Plus 150ms hover and focus transitions (and the margin note's 150ms slide in).
- **Docs:** none beyond hover and focus, the TOC stepping aside, and the user-triggered StageFlow stepping.
- **The pipeline stages** never play by themselves: Play steps through the stops once while on screen and stops at Report, with a 150ms crossfade of the panel content only and no moving parts. Without JS every panel is in the HTML as a stacked list.
- **No other motion:** no entrance animations, no parallax, no looping decoration.
- **Reduced motion** turns off the replay, the walkthrough (its steps become a static list), smooth scrolling and every transition. Everything renders its final state without JS.

## 8. Accessibility

- WCAG 2.1 AA, checked by axe in CI on every page in the sitemap and the 404.
- A skip link on every page, landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, and headings in order.
- A visible `:focus-visible` ring on everything: 2px `ink`, 2px offset.
- Targets are at least 24×24px (the chips and sidenote numbers have padding).
- Decorative SVGs and the graph paper are `aria-hidden` or background-only. The pipeline stages and the exhibit are real text and tables.
- Margin notes are tied to their chips with `aria-describedby` and `aria-expanded`/`aria-controls`.

## 9. What we don't use

- **Look:**
  - gradients, glow, blobs, 3D, glassmorphism, shadows;
  - cream or amber, a dark theme;
  - rounded "bubbly" cards;
  - emoji, stock imagery, third-party logos.
- **Claims:** fake metrics or testimonials, a pricing table, a newsletter pop-up, a chat widget, a cookie banner. Nothing on the page is there only because "landing pages have it".

## 10. Checklist before shipping a page

1. Does every number come from generated data, and does every command exist (`scripts/test/site-commands.test.ts`)?
2. Is the page complete with JS off and with reduced motion on?
3. Does axe report no WCAG A/AA violations?
4. Is there no horizontal scroll at 360px?
5. Are there no requests to any origin but the site's own?
6. Is green used only for "verified"?
7. Is it light only (`scripts/test/site-light.test.ts`)?
