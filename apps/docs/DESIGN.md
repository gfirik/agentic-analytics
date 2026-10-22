# agentic-analytics site design

This is the design system for the product site in `apps/docs`: the landing page, the docs (including Learn) and the 404. Every token lives in one file, `src/styles/tokens.css`. If this document and that file disagree, fix whichever is wrong in the same PR: they must agree (`scripts/test/site-light.test.ts` checks the colour table).

## 1. Identity: an AI analyst you can audit

The site is an **audited working paper**:

- **The landing page is the cover sheet.** It is a calm, graph-paper surface with one live exhibit: a real report that proves itself on the first screen, and again when you touch it.
- **The docs are the bound appendix.** They are long-form, quiet and built for reading, with evidence in the margin.

The product's promise is that every number can be traced, so the site shows numbers the same way the report does. Each one sits next to the ID of the fact it came from, and a mark shows that it was recomputed.

- **It is:** an audited statement, a lab notebook, an engineer's reference. Quiet surfaces, ruled lines, exact figures.
- **It is not:**
  - an AI startup page (no gradients, glow, blobs, 3D, robots or brains). The one exception is the engine machine (§6): the real pipeline as solid, lit models in an axonometric view, shaded only in the page's own greys by one hemisphere and one directional light in token colours, with hairline edges, no shadows and no glow. 3D as decoration stays banned;
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
5. **Motion that shows the work, never in the way of it (site v4).** The landing page moves where the movement says something true: the sections below the fold reveal as they scroll in, the pipeline's connector draws from stage to stage, the exhibit's figures count up to their recorded value and then verify, and hovers ease in. The rules (§7):
   - **Nothing animates under the reader's eye.** Whatever is on screen at load renders final and never re-animates; a reveal happens once, as a part first enters from below. The exhibit's replay is the one motion on the first screen, because it is the demonstration.
   - **Nothing blocks reading or input.** A reveal is 240ms; a jump (an anchor, the End key, keyboard focus) lands on final content.
   - **No layout shift.** Only `transform` and `opacity` animate (and colour on hover); CLS stays under 0.05.
   - **Every number stays the recorded fact.** A count runs toward the real value and ends on it; the HTML holds the real value, and the count is drawn over it.
   - **All off under `prefers-reduced-motion`**, and the final state renders without JS.
   The engine machine's drift and scroll-linked camera (§6) keep their own rules.
6. **Premium through restraint:** exact alignment, hairlines, generous space, real data. No gradients, glow, blobs, 3D, stock illustration or emoji. One written exception: the engine machine (§6), the real pipeline as lit 3D models in its own band; nothing else on the site is 3D.
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
- **Reading text in figures:** no reading text inside a figure is smaller than `--aa-text-note`. A figure is any diagram, island, ledger or framed panel, with everything inside its frame. Labels are not reading text: mono uppercase labels (and what sits in their line, such as a run's jobs count in a results-table head), fact chips, and short mono tags and ids (a fact id outside a chip, "bar ≥ 80%", "recomputed", a grade) keep `--aa-text-label`. A figure's numbers (`.aa-fig`) are reading text. Nothing on the site is smaller than `--aa-text-label`.
- **Code:** one size everywhere, `--aa-text-code` (0.8125rem): the hero's install line, §2, Quickstart, the exhibit's notes, StageFlow, the fact ledgers, Transcript, Expressive Code blocks, Mermaid sources, page leads and inline code in prose. The one exception: code inside a heading keeps the heading's scale (0.875em of it). Quickstart commands are broken at a flag or a `\` and fit their cell. The clone URL is longer than a Quickstart column at every width: it wraps only after `github.com/` (a `<wbr>`), and its second line starts under its first (an inline block), so it reads as one argument. Nothing splits mid-word.

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
| `--aa-text-code` | 0.8125 / 1.5–1.65 | Mono 400 | Every code block and inline code |

- **Labels:** Plex Mono at `--aa-text-label` (0.75rem), uppercase, +0.08em tracking, in `ink-3`.
- **Bracketed section labels** on the landing page: `⊣ §1 HOW IT WORKS ⊢`, in mono, centred on a hairline (`SectionLabel.astro`).
- **Measures:** docs prose is 62–66ch (`--aa-article`, 36rem ≈ 64ch of the serif at 17px). Landing copy is 56ch (`--aa-measure`).

## 5. Layout and spacing

- **Spacing scale:** `--aa-space-1` … `--aa-space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96 px. Never use a value outside the scale.
- **Container (site v4):** `--aa-container` is 1440px max (90rem), with `--aa-gutter` side gutters of 32px (16px under 480px). The landing page's frame, the site header and the footer use it. Section backgrounds, the section hairlines and the graph paper run full-bleed, edge to edge; only the content keeps to the frame.
- **Reading measure:** the narrow column is for long reading text only: docs and Learn prose keep `--aa-article` (≈ 64ch) and their own columns (below). Landing copy keeps its 56ch measure inside a wide row; nothing on the landing page sits in a centred narrow column.
- **Radii:** 2px for chips, 4px for buttons, panels and code. Nothing rounder.
- **Width:** at 360px nothing scrolls sideways. Wide tables and code scroll inside their own container.

### The landing page (the cover sheet)

- **The frame.** The page content sits inside one long vertical frame, running the full height of the page:
  - 1px `rule` lines left and right of the 1440px container (at the screen's edges below 1440px);
  - sections divided by full-bleed hairlines that meet the frame;
  - a small `+` tick in `rule-strong` where the lines cross.

  This is the "working paper" structure, and it replaces cards. Under 720px only the hairlines remain. The paper clips anything outside the screen (`overflow-x: clip`), so the ticks and the graph paper never scroll the page sideways (the graph paper is sized with `vw`, which includes a classic scrollbar's width; the clip hides that excess).
- **Wide rows (site v4).** From 1100px a section is one row of two columns, about 2:3: the text on the left (label, `h2`, lead, at the 56ch measure) and a large visual on the right. In §1 and §2 the head is sticky (`--aa-space-7` from the top), so it stays beside a taller visual while the row scrolls by (site v4 PR 3); only a head alone in its column may be sticky, since a sticky grid item is held within the whole grid and would slide over a neighbour below it (§4's binaries list). A visual that needs the room (the results table) gets a full-width band instead, with the head above it. Below 1100px the columns stack, the head centred above its visual.
- **Graph-paper field.** A 24px grid in `--aa-grid`, behind the hero statement and the section heads only. It is full-bleed: stacked, a head's field spans the screen's width over the head's height; in a wide row it runs from the screen's left edge to the middle of the gap before the visual. It fades to the plain page at its edges through a CSS mask (no image) and is never behind a visual or long text.
- **Status strip.** One quiet mono line above the header, on `surface`, not a scrolling marquee. On narrow screens it stays one line and scrolls sideways instead of wrapping (a horizontal scroll box, §6: keyboard-focusable, no scrollbar, a fade at the edge with more), so the font swap can't move the page. Proven results lead: the release, the real public data checks, the real-model smoke run, the test files and the verifier. The generated-business suite comes last as the nightly regression check, a link to §3's results, never a headline figure (a partial pass reads as failure next to proven results). Its values come from generated data (`statusStrip()` in `scripts/landing-data.ts`).
- **Section heads:** every landing section opens with the same three lines, `--aa-space-4` apart: the bracketed label, the `h2` (at most a 48ch measure) and a one-sentence lead. Stacked, they are centred on the graph paper with the label's hairline on both sides; in a wide row or band (from 1100px) they sit on the left, and the label's hairline runs only after it. Caveats go next to what they qualify (§3's under its table), not in the lead.
- **Sections, in order** (nothing else: no testimonials, logo wall or newsletter):
  1. Status strip, header, then **the hero**, two columns from 1100px:
     - **left, the statement:** a mono eyebrow label, the serif headline, one or two lines on what it is and what it solves, the actions, and the install line (two fixed lines, the clone and then `cd … && bun install`, so the column never cuts it mid-word at 1440; a box that scrolls sideways on phones);
     - **right, the exhibit** (§6): its label and the report page with its walkthrough, so the verification replay plays on the first screen (the report page's top at about 260px at 1440×900). At 1440 the right column is about 795px, wide enough for the notes to sit beside the report page; between 1100 and about 1410px they sit below it;
     - **below 1100px** the statement is centred and the exhibit follows it.
  2. **The engine machine** (§6, `EngineMachine.astro`), a full-width band directly under the hero: its head (an unnumbered bracketed label, `THE ENGINE, OPENED UP`, the `h2` and a lead with the run's station count), then the live machine on a stage at least 600px tall on desktop (37.5–45rem), with the station list under it.
  3. `§1 HOW IT WORKS`: a wide row, the head on the left and the pipeline stages (§6) on the right.
  4. `§2 WHY IT'S DIFFERENT`: a wide row, the head on the left and exactly three proofs on the right: "The model never does arithmetic", "Definitions you confirm", "Every claim is cited". Each has a mono label, a title, one sentence and one real example in a framed box: the report's first sentence as the model wrote it (`{{N…}}` placeholders) and as the reader sees it (figures and chips); the metric's definition with the 2-line SQL it compiles to; a quoted citation.
     - **In the wide row** the proofs are three ruled rows, the words on the left and the example on the right.
     - **From 52rem to 1100px** they are three cells side by side that share their rows (CSS subgrid), so the three example boxes line up and match in height; stacked on phones.
  5. `§3 RESULTS, AS THEY ARE`: a full-width band, the head over one ruled table from `evals/results`, **metrics as rows, runs as columns**, so it fits the container with no sideways scroll.
     - **Rows:** the seven headline bars (planted recall, distractor false positives, driver accuracy, cause grade, citation precision, recommendation relevance, number mismatches), including every bar the smoke run misses, each with its bar stated once in the row label. The rest are in RESULTS.md.
     - **Columns:** real public data, the real-model smoke run, the nightly regression, then the offline baseline. Each head gives the run, a one-line note, its jobs and its date.
     - **Cells:** a figure plus the check, or an underlined "below bar" in ink; "meets the bar" is screen-reader text only.
     - **A run without rates gets one cell spanning every metric row:**
       - the real public data, scored by its own checks (passed of total from the latest real results: 16/18 since hotel bookings joined);
       - a run with jobs missing: partial after its last pass, in progress between passes, labelled from the generated status, with its jobs-finished count.
       - Each spanning cell names its column head (`headers`), so a screen reader reads it under its run, not under the first metric.
     - **Sources:** the result files sit in a `<details>` under the table, with the RESULTS.md link.
     - **Under 60rem** the table scrolls inside its wrapper with the metric column held in place.
  6. `§4 QUICKSTART`: a wide row. On the left the head, then the binary downloads and the Docker line; on the right the three steps (install, model, analyze), each a ruled row with its label and note beside its code, then the four doors (CLI, API, MCP, Telegram) as a ruled list. From 56rem to 1100px the steps are three columns; stacked on phones (head, steps, binaries, doors).
  7. The footer.

### Docs and Learn (the bound appendix)

- **Columns:** left sidebar (240px, `surface`, hairline edge) | article column (≈ 64ch) | **margin column** (~260px, narrowing to 176px between 1000 and 1200px) for sidenotes.
  - Built by overriding Starlight's `TwoColumnContent` and `PageSidebar`.
  - The article is left-aligned next to the sidebar.
- **The on-page TOC** sits at the top of the margin column and is sticky, with the page background and a height cap (the screen below the header, less `--aa-space-8`); Learn stage pages list their h2s only (`tableOfContents.maxHeadingLevel: 2`), so the list fits with no inner scrollbar; it marks the current heading with an ink rule. Under 1200px it collapses into Starlight's TOC bar. While a full-width figure or a sidenote passes beneath it, it steps aside (JS), so neither is covered; without JS it stays on top.
- **Sidebar:** mono section labels, sans items, the active item marked with a 2px ink rule on the left.
- **Measure between 1000 and ~1072px:** article, gap and margin column always fit beside the sidebar; the article gives up a little measure there rather than letting notes and figures run off the page.
- **Sidenotes** for fact IDs and sources, definitions of terms (with a glossary link) and caveats (§6). From 1000px they sit in the margin; under 1000px they are tap-to-expand inline notes.
- **Full-width figures** (`.aa-fullwidth`, and automatically the stage diagram, Mermaid diagrams and the pipeline stages) run across the margin column from 1000px, clearing any sidenote beside them.
- **Epigraph-style lead** at the top of each Learn stage page: one sentence on the problem the stage solves, in serif italic (`epigraph` frontmatter, rendered by `PageTitle.astro`).
- **Headings:** `h1`/`h2` in the serif, no rule under `h2`; `h3` in Plex Sans 600.
- **The header** is shared with the landing page. Search (Pagefind) stays. There is no theme control.
- **Width (site v4):** the docs keep their reading measure and columns; the wider frame changes only the landing page and the pages outside Starlight (the 404), and the site header and footer there. Starlight's own header already spans the screen, and the docs' compact footer sits in the article column.

## 6. Ledger motifs (components)

- **Fact-ID chip** (`.aa-chip`):
  - quiet in running text (site v3): mono at `--aa-text-label` in `ink-3`, inside a 1px `rule` box with a 2px radius and a tight padding that doesn't open up the line, e.g. `N30`; a verified fact's chip starts with the green check (`✓N30`), in the exhibit only once its verification has run;
  - its target is still at least 24px tall: a transparent hit box (`::after`) reaches above and below the visible box;
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
  - **The verification replay.** As the exhibit comes into view (its report page's top above the bottom sixth of the screen: on load in the two-column hero), and only without `prefers-reduced-motion`:
    - **the figures count up** (site v4 PR 3): every number in every figure runs from zero to its recorded value together, in the figure's own format, over 600ms (ease-out). The running value is drawn over the figure (`data-count`, a CSS overlay) while the real text stays in place, transparent, so the line never reflows; it always ends on the real value, which is what the HTML holds;
    - **then they verify** one by one, top to bottom, as the count lands: each chip's box draws in, then the green check appears in the space it already holds (≤ 200ms per figure, ≤ 2.5s in all, count included).
    An inline script holds the figures unverified (and unseen, in their place) before first paint. With reduced motion or no JS, the server-rendered verified state is all there is.
  - **The guided walkthrough.** The exhibit demonstrates itself, with no hover needed. After the verification it steps through the story's key figures, opening each one's margin note under a step indicator (`1/4 Revenue fell −17.9% → how it was computed`), with a progress rule and previous, next and replay buttons.
    - The steps are chosen from the run's data by role (`walkthrough()` in `scripts/landing-data.ts`), never by typed id: the headline change and how it was computed; its current-period SQL input with the SQL and the sheet rows it read; the driver's share of the change; the quoted document.
    - **One behaviour at every size (site v3), nothing pinned to the scroll.** The figures verify as the exhibit comes into view; then the steps advance every 4.5 seconds while the notes are on screen (beside the report page when the exhibit is at least 48rem wide, below it otherwise, where the step bar stays at the top of the screen).
    - **Beside or below is a container query (site v4)** on the exhibit's own width (`.aa-walk`), not the screen's, because the exhibit sits in the hero's right column from 1100px: beside at 1440 and wider, below between 1100 and about 1410px, beside again from about 840px to 1100px where the hero stacks, and below on phones. The script reads the same width.
    - The timer waits while the pointer is on a figure or a note, or focus is inside the exhibit; a Pause/Play button stops it (WCAG 2.2.2), and stepping by hand pauses it. At the last step it stops and offers Play, which starts again from step 1. The step caption is announced (`aria-live="polite"`) only when the reader moves a step: the region is `aria-busy` while it advances by itself.
    - **Step 1's note is open from the start**, so the margin is never an empty box; its figure isn't marked until step 1.
    - **Notes size to their own content.** The notes column keeps the room of its tallest note (measured in the browser beside the exhibit, again when the fonts arrive or the window changes, and it only grows; one shared grid cell when the notes are below), and each note sits at the top of that room, never stretched. The step captions share one grid cell too. So stepping never moves the page.
    - **With the notes below the report page, the SQL is folded** behind "SQL, run in DuckDB · show" (a `<details>`; "· hide" once open; a 24px target at label size), so the tallest note stays short on a phone; beside the exhibit it is open.
    - The step's figure takes the `mark` wash in the text, and its chip shows open. Prev and next use `aria-disabled` at the ends, so keyboard focus is never lost.
    - Step 0 says what the verifier did to what is shown: the figures recomputed and the quotes checked, counted from the notes.
    - Under reduced motion, or without JS, the steps are a static ruled list under the exhibit, each with its note (SQL unfolded); no step bar.
    - The walkthrough is switched on before first paint (`data-walk="live"`), so the step bar and the list never shift the layout.
  - **Margin notes.** Hovering or focusing a figure slides a Tufte-style margin note out to the right of the exhibit, joined to the figure by a hairline leader. When the exhibit is at least 48rem wide it sits beside the report page; otherwise below. The note shows:
    - the fact's ID and label, its value and its recomputed mark;
    - the SQL that computed it, laid out one clause per line and tinted in ink shades only, with its parameters; or, for a function fact, the function and its input facts as a ruled table;
    - the cited sheet rows: the first cited row and its neighbours, read back from the run's DuckDB, with the cited rows in the `mark` wash;
    - for a document, the exact quote and where it is.

    Esc or blur closes it, and a click pins it (for touch); letting go returns to the walkthrough's current note (step 1's before the first step). There is no hint text: the margin holds a note except after Esc, which closes it until the next step or hover.
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
  - a hairline frame, a mono body at `--aa-text-code`, a mono caption label, no window dots.
- **Horizontal scroll boxes** (`.aa-scroll-x`: the status strip, the hero's install line): one line that scrolls sideways on narrow screens, a labelled focusable region. No scrollbar (in CSS from the start, so the box's height never changes); the edge with more to read fades over `--aa-space-7` with a transparency mask (not a coloured gradient), set by a small script (`ScrollFade.astro`, in the site layout); without JS there is no fade, and keyboard and touch scrolling work as before. Focused (the box or a link in it), the mask is off, so the focus ring shows (WCAG 2.4.7). A frame (hairline, background) sits on a wrapper, not on the masked box, so it never fades. Text in the fade is scroll-off content: axe doesn't evaluate masks, and it isn't meant to read as body text.
- **Diagrams:**
  - Mermaid is initialised with the token colours and Plex Sans.
  - The pipeline scene (`pipeline-scene.ts`) draws the README GIF only. The site never uses it: its fixed 640×480 canvas scaled its type past the h2 on desktop and below reading size on phones.
- **Pipeline stages** (`components/site/PipelineStages.astro`), on the landing page (§1), Learn, What it is and Pipeline overview:
  - **The run:** one real run of the example (`docs/assets/readme/pipeline.json`, the same data as the README GIF), told as a **rail** of seven stops above **one ledger panel per stop**, at the site's own sizes. Every figure is the run's fact with its chip (`pipeline-stages.ts` only picks rows; it computes nothing).
  - **The rail:** mono labels at `--aa-text-label` on a 1px `rule`: a connector line with a small square node where each stop starts, and a 2px ink segment and an ink node under every stop up to the current one (both drawn with transforms only, so stepping never moves the layout). Each stop is a button (`aria-pressed`, `aria-controls` its panel); its title lists the engine stages behind it, from the run's event log.
  - **The draw-in (landing page only, `draw`; site v4 PR 3):** when the rail is still below the screen as the page loads, it is held undrawn and, the first time it scrolls into view, the connector draws itself left to right, stop after stop (90ms a stop, about 0.6s), each node appearing as the line reaches it. A rail on screen at load, or one the reader jumped past, is simply drawn; none of it under reduced motion. On docs pages the rail is drawn from the start.
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
  - under 50rem the columns stack, with ↓ between them;
  - step descriptions and every other reading text in it at `--aa-text-note`; column heads at `--aa-text-label`.
- **Contribution bridge** (`Decomposition.tsx`; Learn's analysis page, Your first report, Finding drivers):
  - start total → each member's change → end total, one row each (label · bar · figure with its fact id); the rows share one set of columns (CSS subgrid), so every bar is on the same scale, and dashed `rule-strong` connectors run from one bar's end to the next one's start (hidden under 40rem, where the bars stack under their labels); the name and the figure take their own width and the track the rest, with each share on its own line under its figure;
  - titled by the decomposition's own dimension ("Contribution by channel");
  - the totals are drawn from a broken axis, marked ≈ on the bar with no numeric tick, so the changes show at the scale of the change; the bar geometry is layout only, and every figure shown is a fact's stored value;
  - negative changes solid ink, positive ones outlined (§3);
  - no "everyone else" row and no figure the page subtracted: members in the decomposition's total that aren't drawn are named by their fact ids; the caption says the members drawn are all of them only when the total fact shows it (its value with its id).
- **Recorded output** (`Transcript`, Learn): a `surface` block in mono with a label-style caption; long lines scroll inside it, and a note names what was replaced.
- **Header:**
  - The wordmark, then the links. The wordmark is the name alone, in the interface sans; there is no icon mark. The favicon is an "aa" lettermark: IBM Plex Mono Medium outlined to paths (so it needs no font), ink on paper (`--aa-ink` on `--aa-page`), with no check symbol. Green stays reserved for verified states.
  - Landing: How it works, Results, Docs, GitHub. Docs: search, Results, GitHub.
  - Under 720px the landing links fold into a menu button (`aria-expanded`, `aria-controls`; Escape closes it and returns focus).
- **Engine machine** (`components/site/EngineMachine.astro`; the one 3D exception of §1, §2.6 and §9), live in its own full-width band under the hero (site v4):
  - **What it is.** The pipeline as a factory line in an axonometric 3D view: eleven numbered stations on a conveyor (the doors, then one station per group of the run's stages), the job's database file in front, the model room behind glass, dashed cables to the stations that call a model, and the verifier's gate with one light per check the run ran: green for a check that passed, ink for one that failed a claim.
  - **Data.** The stations, their names and their order come from the same run as the pipeline stages (`docs/assets/readme/pipeline.json`'s `stages`, grouped by one mapping in `engine-machine.ts`, which also holds each station's wording and Learn pages). Every figure in it is the run's own, with its fact chip; the band's lead counts the stations from the same data.
  - **Look.** Light only. Solid models shaded by Lambert materials under one hemisphere and one directional light, both in token colours, calibrated so a part's top renders at `--aa-raised` and its sides step down within the page's greys; hairline edges in `--aa-rule-strong`; no shadow maps, no glow, no tone mapping. The model rooms' glass is a translucent pane of `--aa-mark` with a hairline frame. The gate lights are unlit, so a passed check is exactly `--aa-verified`: green appears nowhere else in the scene. The floor is the page with the graph paper's lines. Every colour is a CSS token read at runtime with `getComputedStyle` and set as sRGB, so three's colour management returns it unchanged (`site.spec.ts` samples the canvas for `--aa-page` and for green only at the verifier).
  - **The stage.** A frame (hairline, 4px radius) 37.5–45rem tall from 60rem (at least 600px), holding the still frame, the canvas over it, the station labels and the card at its right. Under 60rem the view is `min(30rem, 56svh)` tall with the card under it.
  - **The still frame, at once.** The build renders the home view of the same scene, lights and framing (`machine-wide`, 1600×1160, the stage area the card leaves free, and `machine-tall`, 720×840 from the lighter scene, for phones; WebP plus PNG, explicit width and height, `object-fit: contain` on the page colour) with the docs `assets` script; `site-assets.test.ts` covers them. The box is fixed in CSS, so nothing shifts.
  - **Loading.** three.js (a pinned dependency, D18, imported as ES modules so it tree-shakes) and the live view (`machine-3d.ts`) are one chunk, imported on `requestIdleCallback` after the load event (a 2s timeout; a plain timer where there is none) once the band is near: within a quarter screen below the viewport on desktop, within a screen on phones. Creating the WebGL context and compiling the shaders is one long task on a machine without a GPU (about 300ms under Lighthouse), so it never runs while the first screen is in use, and a reader who never comes to the band never fetches it. Building the scene, compiling (`compileAsync`) and the first frame are split into separate tasks; the canvas then fades in over the still in 400ms. No third-party request.
  - **Scroll-linked camera.** The band is tall (the stage's height plus 22svh per stop, 18svh under 60rem) and the stage is sticky inside it, so the page scrolls normally while the reader passes through: the progress through the band maps to the tour (the home view, then every station in line order with the database file after the first station that writes to it and the model room after Explain). Each stop holds for the middle of its span and the camera eases between stops (target and zoom, zoom in log space); a focused piece centres in the part of the view the card doesn't cover. A 2px ink rule along the view's foot shows the progress. The heights are set before first paint (an inline script sets `data-mode`), so the band never shifts.
  - **Hover, focus and tap.** Pointing at a station (on the canvas or its label), focusing its label, or tapping it on a touch screen highlights it (its hairlines turn ink, its floor takes the `mark` wash, its label is pressed) and shows its card, until the scroll reaches another stop. Pressing a label scrolls the page to that station's stop.
  - **Everything readable is HTML**, never canvas text: the station labels (buttons with `aria-pressed`, placed from projected coordinates, kept inside the view and moved up past a label they would cover, in station order for the keyboard; on a narrow or wide-open view they show their number, with the name in their text) and the card (kicker, title, what it does, whether it calls a model, its figures in the run and its Learn stage pages: the station list's own entry, cloned; at the home view a short "how to read the machine"). On a narrow screen the live card keeps the first sentence and the Learn links. The canvas is `aria-hidden`; the still's `alt` describes the machine and points to the list.
  - **The station list.** Every station and its entry, as a plain HTML list in a `<details>` ("Every station, as a list") under the stage: open without JS and in the still mode, folded when live (before first paint).
  - **Phones.** The lighter scene: fewer segments on curved parts and cables, a pixel ratio of at most 1.5, no drift, and a tap to select.
  - **The still mode.** Under `prefers-reduced-motion`, on a weak device (`hardwareConcurrency` ≤ 2, `deviceMemory` ≤ 2 or Save-Data) and without JS: the still frame, the overview card and the open list, a band no taller than its stage, and three is never loaded. If WebGL is missing or the chunk fails when live, the still frame stays and the card still follows the scroll.
  - **Performance.** It renders only while the stage is on screen (IntersectionObserver) and the tab is visible; frames are drawn continuously only while the camera eases or drifts, the drift alone at no more than 30 frames a second.
  - **Motion** (§7): the slow drift and the scroll-linked camera.
- **Footer (every page):** project links, the licence, and "Built by fhsystems", linking to https://fhsystems.dev.

## 7. Motion

Site v4 PR 3 brought tasteful motion to the whole landing page under the rules of §2.5. What moves, and how:

- **Section reveals** (`Reveal.astro`, landing only): the head and the visual of §1–§4 (the children of a `data-reveal` section's cell) fade and rise 12px into place, 240ms with `--aa-ease`, the visual 60ms after its head, **once**, as each first comes into view (IntersectionObserver, 6% inside the bottom edge).
  - Only what is **below the screen when the script runs** is held (opacity 0), so the first screen, and anything the reader has already reached, renders final and never animates. The hero and the engine machine's band are never held.
  - A part the reader scrolls past without stopping (the End key, a fling) is shown at once, as is one that takes keyboard focus; an in-page link, a hash change or printing shows every held part at once, so a jump never lands on a fade.
  - The server renders every part final: without JS, without IntersectionObserver and under reduced motion nothing is held.
- **The pipeline's connector** (§6) draws in, stop by stop, the first time its rail scrolls into view on the landing page. Play still steps through the stops once while on screen and stops at Report; each step moves the connector by one segment (180ms) and crossfades the panel content (150ms), with no moving parts. The stages never play by themselves. Without JS every panel is in the HTML as a stacked list.
- **The exhibit:** its replay (§6), where the figures count up to their recorded values and then verify, and its walkthrough (timed at every size, never scroll-linked), the one motion on the first screen.
- **Hover and focus:** 150ms (`--aa-fast`) on links (underline and colour), chips, buttons, the rail's stops, the walkthrough's buttons, and rows (§3's metric rows and §4's doors take the `mark` wash; a "more" link's arrow steps 3px forward). The margin note slides in over 150ms.
- **Docs:** none beyond hover and focus, the TOC stepping aside, and the user-triggered StageFlow and pipeline stepping (the connector is drawn from the start there).
- **The engine machine** (§6): a slow camera drift (±3.4° about the vertical over 26 seconds, desktop only) while its band is on screen, and the camera moving from station to station as the reader scrolls through the band (eased, never ahead of the scroll). Nothing in it blocks the page's own scrolling, and nothing moves text the reader is on. Under reduced motion it is the still frame with the station list: no drift, no scroll-linked camera and no canvas.
- **The engine machine keeps its own rules** (§6, site v4 PR 2): it is not revealed, and its drift and scroll-linked camera are described above.
- **No other motion:** no parallax, no looping decoration, nothing that moves text the reader is on, nothing that animates layout (width, height, position): only `transform` and `opacity`, and colour on hover.
- **Reduced motion** turns off the reveals, the connector's draw-in, the count, the replay, the walkthrough (its steps become a static list), smooth scrolling and every transition. Everything renders its final state without JS.
- **Tested** in `site.spec.ts` ("motion"): reveals happen once and only below the fold, nothing is held or counts under reduced motion or without JS, the figures end on their recorded values, the connector draws left to right, no layout shift is attributable to any of it (CLS under 0.05 through the whole page at 1440 and 390), and nothing scrolls sideways at 360 mid-reveal.

## 8. Accessibility

- WCAG 2.1 AA, checked by axe in CI on every page in the sitemap and the 404.
- A skip link on every page, landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, and headings in order.
- A visible `:focus-visible` ring on everything: 2px `ink`, 2px offset.
- Targets are at least 24×24px: sidenote numbers have padding, and fact chips have a transparent hit box above and below their visible box.
- Decorative SVGs and the graph paper are `aria-hidden` or background-only. The pipeline stages and the exhibit are real text and tables.
- Margin notes are tied to their chips with `aria-describedby` and `aria-expanded`/`aria-controls`.

## 9. What we don't use

- **Look:**
  - gradients, glow, blobs, 3D (except the engine machine, §6), glassmorphism, shadows (the machine's shading is light on its own faces, never a cast shadow);
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
8. Do the type floors hold: nothing larger than h2 except the hero and a page's own h1, reading text in a figure at least `--aa-text-note`, nothing under `--aa-text-label`, and one code size (`site.spec.ts` checks every page in the sitemap)?
9. Is there one source per rule: a new component gets its entry in §6 in the same PR?
10. Are the engine machine's labels and card HTML (never canvas text); does its still frame show before any script, does three start only on idle (on phones only near the band), and is it absent under reduced motion?
11. Width (site v4): does a new landing section use the 1440px frame as a wide row (text left, visual right) or a full-width band, with backgrounds and the graph paper full-bleed, and stack below 1100px? Is long reading text (docs, Learn) still at its reading measure, never stretched to the frame?
12. Is it checked at 1920, 1440, 1100, 1000, 390 and 360px (screenshots at 1920, 1440 and 390 in the PR), with no horizontal scroll at any of them and CLS under 0.05?
13. Motion (site v4 PR 3): does anything new animate only `transform` and `opacity` (colour on hover), stay still while on the first screen, run once, end on the real value, and render its final state with reduced motion and without JS (§2.5, §7)? A new landing section opts into the reveal with `data-reveal`.

## 11. Site v3 (October 2026): what the review found, and what it settled

The site v3 design pass (`docs/plans/site-v3.md`, five PRs, #38–#42) started from a review of the live site against this document. Its brief is folded in here; the rules it set are in the sections above.

- **What it found.** The top of the landing page followed this document; from §1 down it didn't. The main cause was the pipeline scene, the README GIF's fixed 640×480 canvas, stretched to the container: its type rendered larger than every heading on desktop and too small to read on phones. Around it, visuals had been built one at a time and didn't share a scale, frame or motion logic: a results table that scrolled sideways even at 1920, code at four sizes, section heads in three patterns.
- **What works, and stays.** One statement and one lead in the hero, with clear actions. The exhibit, a real report whose figures verify and open their SQL, rows and quote, is the strongest thing on the site. Green only on verified. The hairline frame, the quiet status strip, the four doors as a ruled list, the footer.
- **Motion: rethought, not removed.** The verification replay stays (short and meaningful). The walkthrough stays, timed at every size, with nothing pinned to the scroll. The pipeline moves only when the reader presses Play, and then only its panel content crossfades. Nothing else moves.
- **Scale, settled.** One type scale with three floors (labels, reading text in figures, code) and one ceiling (h2, except the hero and a page's own h1); one frame (hairlines, `raised` panels, 4px radius); every visual a component with an entry in §6.
- **Moved out.** The report template's wording for shares over 100% ("accounted for 108% of the change") is an engine task in the analyst-grade plan, not a site change.
