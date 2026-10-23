# agentic-analytics site design

This is the design system for the product site in `apps/docs`: the landing page, the docs (including Learn) and the 404. Every token lives in one file, `src/styles/tokens.css`. If this document and that file disagree, fix whichever is wrong in the same PR: they must agree (`scripts/test/site-light.test.ts` checks the colour table).

## 1. Identity: an AI analyst you can audit

The site is an **audited working paper**:

- **The landing page is the cover sheet.** It is a calm, graph-paper surface with one live exhibit: a real report that proves itself on the first screen, and again when you touch it.
- **The docs are the bound appendix.** They are long-form, quiet and built for reading, with evidence in the margin.

The product's promise is that every number can be traced, so the site shows numbers the same way the report does. Each one sits next to the ID of the fact it came from, and a mark shows that it was recomputed.

- **It is:** an audited statement, a lab notebook, an engineer's reference. Quiet surfaces, ruled lines, exact figures.
- **It is not:**
  - an AI startup page (no gradients, glow, blobs, 3D, robots or brains). The one exception is the engine machine (§6): the real pipeline as solid, lit models in an axonometric view, shaded only in the page's own greys by one hemisphere and one directional light in token colours, with hairline edges, no shadows and no glow. 3D as decoration stays banned. The other is the hero (§5, site v5, made bold in PR 1b): a visible warm-grey glow behind the statement, the net's graphite nodes and pulsing connectors, and the proof chips (no brand hue: the cobalt of PR 1b was taken out, §12). The calm, ink-only rules below hold everywhere else;
  - a BI dashboard (no chart wall);
  - a warm "paper" site. Our sibling project pas-agent uses cream and amber; this site is neutral off-white and ink.
- **Tone:** plain statements that can be checked. "Recomputed by the verifier", never "powered by AI". Caveats sit next to the number they qualify, in the margin when there is one.

## 2. Principles

1. **Light only.** There is one theme: no dark tokens, no theme control, no `prefers-color-scheme` rules and no stored theme. Starlight's own theme provider and picker are overridden (`components/starlight/ThemeProvider.astro`, `ThemeSelect.astro`).
2. **Typography leads.** A serif for statements and for reading, a neutral sans for the interface, a mono for every figure and identifier. Hierarchy comes from size and face, not from colour.
3. **Hairlines over shadows.** Separation comes from 1px rules and two surface tones. Nothing floats, so there is no elevation and there are no cards with shadows: content blocks are cells of a frame.
4. **One semantic accent, and it means "verified".** Green appears only on things the verifier passed:
   - the check mark on a recomputed number;
   - V1–V8 pass states;
   - passed eval checks;
   - the "verified" badge.
   It is never used for links, buttons, decoration or emphasis. There is no brand hue beside it (the cobalt accent of site v5 PR 1b was removed, §12): the hero's glow is a warm grey and its button, net and icons are ink.
5. **Motion that shows the work, never in the way of it (site v4).** The landing page moves where the movement says something true: the sections below the fold reveal as they scroll in, the pipeline's connector draws from stage to stage, the exhibit's figures count up to their recorded value and then verify, and hovers ease in. The rules (§7):
   - **Nothing animates under the reader's eye.** Whatever is on screen at load renders final and never re-animates; a reveal happens once, as a part first enters from below. The exhibit's replay is the one motion on the first screen that carries content, because it is the demonstration (its walkthrough then follows the reader's own scroll, site v5 PR 2); the hero field's net (§5, site v5) is ambient background behind the statement: its connectors draw in and accent pulses run along them toward the exhibit, slowly, and calmed behind the text the reader is on.
   - **Nothing blocks reading or input.** A reveal is 240ms; a jump (an anchor, the End key, keyboard focus) lands on final content.
   - **No layout shift.** Only `transform` and `opacity` animate (and colour on hover); CLS stays under 0.05.
   - **Every number stays the recorded fact.** A count runs toward the real value and ends on it; the HTML holds the real value, and the count is drawn over it.
   - **All off under `prefers-reduced-motion`**, and the final state renders without JS.
   The engine machine's drift and scroll-linked camera (§6) keep their own rules.
6. **Premium through restraint:** exact alignment, hairlines, generous space, real data. No gradients, glow, blobs, 3D, stock illustration or emoji. Two written exceptions: the engine machine (§6), the real pipeline as lit 3D models in its own band (nothing else on the site is 3D), and the hero (§5, site v5 PR 1b), the only gradients and glow on the site: the warm-grey field behind the statement and its graphite net.
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
| `--aa-mark` | `#e8ecef` | Highlighted cited rows, hover washes, text selection (not an accent) |
| `--aa-glow` | `#d3ccc0` | The hero's glow, a warm grey (site v5): mixed at 34% or less onto the page, strongest where there is no text. Never a surface |
| `--aa-glow-deep` | `#bdb4a6` | The glow's deeper light, low on the side toward the exhibit, away from text |
| `--aa-rule` | `#dcdcd6` | Hairlines, frames |
| `--aa-rule-strong` | `#8b8f94` | Header rules, chip boxes, corner ticks (≥ 2.7:1, decorative) |
| `--aa-ink` | `#121417` | Primary text, focus ring |
| `--aa-ink-2` | `#4a4f57` | Secondary text |
| `--aa-ink-3` | `#5f646c` | Labels, captions |
| `--aa-verified` | `#0b6b3a` | The accent: verified marks and pass states only |
| `--aa-verified-wash` | `#e7f2ea` | Background of a verified badge only |

Contrast ratios (WCAG relative luminance; axe re-checks them in CI). All text pairs pass AA (4.5:1):

- `ink`: 17.4:1 on page, 18.5:1 on raised.
- `ink-2`: 7.8:1 on page, 6.9:1 on mark.
- `ink-3`: 5.6:1 on page, 5.3:1 on surface, 5.0:1 on mark.
- `verified`: 6.2:1 on page, 6.6:1 on raised, 5.8:1 on its wash.
- Over the hero field (site v5 PR 1b) the warm-grey glow behind text is light enough to keep AA; it is strongest at the field's edges, where there is no text. Measured on the darkest glow pixel behind each block (`site.spec.ts`, "hero glow"): the lead (`ink-2`) at least 5.1:1, the headline (`ink`) at least 9:1, at 1440, 1100 and 390. Nothing in `ink-3` sits on the glow. The grid's lines and dots are hairlines and 1px dots under the text, never a fill behind it.

Rules:

- **No cream, no amber, no gradients.** The only hue is the verified green.
- **Failure is never a colour.** Dropped claims are struck through and labelled "dropped". A failed check is a struck-through "fail" in ink. Negative contributions are solid ink, positive ones are outlined. Shape and text carry the meaning, so it survives greyscale and colour blindness.
- **Links are ink with a hairline underline** that turns ink on hover. Their underline and position make them visible, not their colour.

## 4. Typography

All three faces are self-hosted through `@fontsource` and imported once, in `src/styles/fonts.css`.

- **Serif file.** The serif uses its weight-axis file (51 KB) with its italic, not the optical-size file (122 KB). The docs' first paint is serif prose, and the larger file kept the Learn pages under Lighthouse 95.
- **Preloads.** The serif is preloaded on every page and Plex Sans 400 on the landing page (`FontPreloads.astro`).
- **Fallback metrics.** Each face has a fallback face (`… Fallback` in `fonts.css`, second in its token's stack): a local metric-compatible font (Arial / Liberation Sans, Times New Roman / Liberation Serif, Courier New / Liberation Mono) with `size-adjust` and ascent/descent overrides measured against the web font, so text set before the swap has the same line lengths and line boxes and the swap moves nothing. Without it, Linux's wider DejaVu fallback wrapped the hero's buttons until Plex Sans 500 arrived (CLS 0.068 at 390px in CI). New faces get a matching fallback face.
- **CSS.** Page CSS is inlined (`astro.config.mjs`).

| Role | Face | Use |
|---|---|---|
| Display | **Source Serif 4** (variable, weight axis) | The hero statement, section headings, docs `h1`/`h2` |
| Reading (docs body) | **Source Serif 4** text, 1.0625rem / 1.65 | Docs and Learn article prose: book-like, Tufte-style |
| UI | **IBM Plex Sans** 400 / 500 / 600, and 700 for the hero headline's first voice only (latin subset, 23 KB, site v5 PR 1b) | Navigation, buttons, landing body copy, captions, docs `h3`, sidenotes, tables and islands inside articles |
| Figures, labels, code | **IBM Plex Mono** 400 / 500 | Every number, fact-ID chip, label, code. Always `tabular-nums`, ligatures off. |

The scale (rem, root 16px; mobile values apply under 640px):

- **Larger than h2:** nothing renders larger than `--aa-text-h2` except the hero headline and a page's own h1 (the docs h1 is 2.5rem, 2rem on mobile).
- **Reading text in figures:** no reading text inside a figure is smaller than `--aa-text-note`. A figure is any diagram, island, ledger or framed panel, with everything inside its frame. Labels are not reading text: mono uppercase labels (and what sits in their line, such as a run's jobs count in a results-table head), fact chips, and short mono tags and ids (a fact id outside a chip, "bar ≥ 80%", "recomputed", a grade) keep `--aa-text-label`. A figure's numbers (`.aa-fig`) are reading text. Nothing on the site is smaller than `--aa-text-label`.
- **Code:** one size everywhere, `--aa-text-code` (0.8125rem): the hero's install line, §2, Quickstart, the exhibit's notes, StageFlow, the fact ledgers, Transcript, Expressive Code blocks, Mermaid sources, page leads and inline code in prose. The one exception: code inside a heading keeps the heading's scale (0.875em of it). Quickstart commands are broken at a flag or a `\` and fit their cell. The clone URL is longer than a Quickstart column at every width: it wraps only after `github.com/` (a `<wbr>`), and its second line starts under its first (an inline block), so it reads as one argument. Nothing splits mid-word.

| Token | Size / line height | Face | Use |
|---|---|---|---|
| `--aa-text-hero` | `min(clamp(2.75rem, 0.9rem + 4.6vw, 5.25rem), 16cqi)` (44px on phones, 81px at 1440, 84px from about 1510; never wider than the statement, so 64px at 1100) | Two voices: Sans 700 / 1, −0.04em ("An AI analyst"), then Serif italic 400 at 1.06em / 1.06, −0.02em ("you can audit."), each on one line | The hero headline (site v5 PR 1b) |
| `--aa-text-display` | `clamp(2.5rem, 1.25rem + 3.4vw, 4.25rem)` / 1.02 (40px on phones to 68px at 1440; site v5), −0.028em | Serif 440 | The 404's h1 |
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
- **Reading measure:** the narrow column is for long reading text only: docs and Learn prose keep `--aa-article` (≈ 64ch) and their own columns (below). Landing copy keeps its 56ch measure inside a wide row or band; nothing on the landing page sits in a centred narrow column.
- **Radii:** 2px for chips, 4px for buttons, panels and code. Nothing rounder.
- **Width:** at 360px nothing scrolls sideways. Wide tables and code scroll inside their own container.

### The landing page (the cover sheet)

- **The frame.** The page content sits inside one long vertical frame, running the full height of the page:
  - 1px `rule` lines left and right of the 1440px container (at the screen's edges below 1440px);
  - sections divided by full-bleed hairlines that meet the frame;
  - a small `+` tick in `rule-strong` where the lines cross.

  This is the "working paper" structure, and it replaces cards. Under 720px only the hairlines remain. The paper clips anything outside the screen (`overflow-x: clip`), so the ticks and the graph paper never scroll the page sideways (the graph paper is sized with `vw`, which includes a classic scrollbar's width; the clip hides that excess).
- **Bands, and the hero's wide row (site v5).** Every numbered section (§1–§4) is a full-width band: the head across the top (label, `h2` on one line at 1440, lead), and the content full width below it, laid out in columns of its own (§2's three proofs, §4's three steps and then the binaries beside the doors). Only the hero is a wide row: from 1100px two columns, the statement on the left and the exhibit on the right. Site v4 made §1, §2 and §4 wide rows too (head left, about 2:3, sticky beside a taller visual); the maintainer's review found the head column a large empty block at every scroll position, sticky or not, so they became bands. **The rule:** at 1920×1080, 1440×900 and 1366×768, no rectangle wider than 40% and taller than 35% of the screen is empty of content inside a section at any scroll position (a browser test measures it). Below 1100px the head is centred above its content, as before.
- **The hero field (site v5, `HeroField.astro`; bold in PR 1b).** The hero statement stands on its own field instead of the plain graph paper. Same geometry as the graph-paper field below (full-bleed; stacked it spans the screen over the statement, in the wide row it runs from the screen's left edge into the gap before the exhibit, fading out over its last 10rem), reaching up to the header's hairline. Four layers, back to front:
  - **glow (warm grey, plainly visible):** a bloom (34% of `--aa-glow`) above and behind the headline's start, a deeper light (30% of `--aa-glow-deep`) low on the side toward the exhibit, and a soft wash (18% to 8%) joining them. Behind text it keeps the lead and headline at AA (§3); stacked, the bloom sits at the headline's top left and the deeper light below the statement;
  - **graph paper:** 24px minor lines in `grid`, every fourth line in `rule` (96px), a 1px `rule-strong` dot on every crossing, anchored to the frame's left edge so the lines meet the frame line, faded out radially from the statement's centre (a CSS mask centred with `cqi`: the statement is an inline-size container);
  - **the net (the one motion):** a canvas of square nodes (the pipeline rail's own node, 4 or 6px, about a quarter filled in `ink-2`, the rest outlined in it) drifting at 6–16px a second, 16 to 64 of them by area, each joined to its two nearest neighbours by an elbowed `ink-2` connector (right angles, like the ledger's rules; the corner is fixed by the pair, so it never snaps). Connectors draw themselves in (900ms, eased out; at start as a sweep toward the exhibit), and ink pulses with a short tail and a small halo run along them toward the exhibit (rightward in the wide row, downward when stacked), hop on from node to node while there is a connector onward, and open a ring on each node they reach; at most six at once, a new one every 0.45–1.1s. It is masked to 40% right behind the text and full in a ring around it. See §7 for its rules;
  - **grain:** a 160px tile of SVG fractal noise in ink at 22% (an inline data URI, so no request), masked like the paper.
  The static layers (glow, paper, grain) are CSS and render without JS and under reduced motion. Nothing in the field is behind the exhibit.
- **Framed corner marks (site v5).** The hero's frame carries an L-shaped mark at each of its four corners, `--aa-space-4` inside it: 12px arms (8px under 480px, `--aa-space-2` inside) of 1px `rule-strong`, drawn as background strokes on one absolutely placed box, so they never take part in layout.
- **Hero type (site v5, PR 1b).** The eyebrow is a label in a hairline tag (`rule` border, `raised`, 2px radius) led by the net's 6px node in ink, "Open source · self-hosted", on one line at every width down to 320px ("free local models" moved to a proof chip, which carries its source). Then the headline in two voices (`--aa-text-hero`: Plex Sans 700 for the claim, the serif italic for the promise), the lead a step up from other leads (1.25rem / 1.55, 1.125rem under 40rem; ≈ 34rem measure, `text-wrap: pretty`), the actions, the proof chips and the install line (site v5 PR 2 removed the Pause control and its slot; the row gap keeps the exhibit's label a full gap below the install line when stacked). Spacing, top to bottom: `--aa-space-5`, `--aa-space-5`, `--aa-space-6`, `--aa-space-5`, `--aa-space-5`.
- **Proof chips (site v5 PR 1b).** Under the actions, the headline's claims as figures: the real-data checks passed (`16/18`), the wrong numbers in the latest real-model run (`0`), the verifier's checks (`V1–V8`) and "runs on free local models". Each is generated (`landing-data.ts` `proofChips()` into `evals.json`, from the same runs as the status strip and §3, the verifier's check table of the recorded run and the routes a fresh install resolves to); a chip its data doesn't support is left out, never softened. Each is a link (to §3, the verifier page or Running free) whose `title` and screen-reader text name its source file. Look: a hairline tag on `raised`, 32px tall, 4px radius, a 24px `accent-wash` well holding a 16px inline-SVG icon in the accent (1.5px round stroke), the figure in Plex Mono 500 and the text in Plex Sans 500 at 0.8125rem; the border turns accent on hover. From 480px they sit in two even columns; narrower they wrap as whole chips.
- **Graph-paper field.** A 24px grid in `--aa-grid`, behind the section heads only (the hero has its own field, above). It is full-bleed: stacked and in a band, a head's field spans the screen's width over the head's height; in the hero's wide row it runs from the screen's left edge to the middle of the gap before the visual. It fades to the plain page at its edges through a CSS mask (no image) and is never behind a visual or long text.
- **Status strip.** One quiet mono line above the header, on `surface`, not a scrolling marquee. On narrow screens it stays one line and scrolls sideways instead of wrapping (a horizontal scroll box, §6: keyboard-focusable, no scrollbar, a fade at the edge with more), so the font swap can't move the page. Proven results lead: the release, the real public data checks, the real-model smoke run, the test files and the verifier. The generated-business suite comes last as the nightly regression check, a link to §3's results, never a headline figure (a partial pass reads as failure next to proven results). Its values come from generated data (`statusStrip()` in `scripts/landing-data.ts`).
- **Section heads:** every landing section opens with the same three lines, `--aa-space-4` apart: the bracketed label, the `h2` (at most a 48ch measure) and a one-sentence lead. Stacked, they are centred on the graph paper with the label's hairline on both sides; in a wide row or band (from 1100px) they sit on the left, and the label's hairline runs only after it. Caveats go next to what they qualify (§3's under its table), not in the lead.
- **Sections, in order** (nothing else: no testimonials, logo wall or newsletter):
  1. Status strip, header, then **the hero**, two columns from 1100px:
     - **left, the statement:** a mono eyebrow label, the serif headline, one or two lines on what it is and what it solves, the actions, and the install line (the clone and then `cd … && bun install`; site v5 PR 2: where the clone URL is wider than the box, on phones, it wraps only after `github.com/` and its second line starts under its first, like Quickstart's; it never scrolls or clips);
     - **right, the exhibit** (§6): its label and the report page with its walkthrough, so the verification replay plays on the first screen (the report page's top at about 260px at 1440×900). At 1440 the right column is about 795px, wide enough for the notes to sit beside the report page; between 1100 and about 1410px they sit below it;
     - **below 1100px** the statement is centred and the exhibit follows it.
     - **The whole hero pins (site v5 PR 2).** While the walkthrough is pinned (§6) the hero section holds a scroll track below its row, one sentinel per step (`--aa-walk-step`, 45vh each) and a 20vh tail. The row itself (the statement with its field, the exhibit, and the frame's corner marks) is one sticky unit at the screen's top, at least a screen tall with its content centred, so the whole hero holds still for the four steps and covers the empty track the whole time. As the track ends, the whole hero releases together, and the engine machine's band starts right at its bottom edge, with no empty block between them. While pinned, the statement's field fades in over its first 6rem (its top no longer meets the header's hairline). The hero's colours are unchanged.
  2. **The engine machine** (§6, `EngineMachine.astro`), a full-width band directly under the hero: its head (an unnumbered bracketed label, `THE ENGINE, OPENED UP`, the `h2` and a lead with the run's station count), then the live machine on a stage at least 600px tall on desktop (37.5–45rem), with the station list under it.
  3. `§1 HOW IT WORKS`: a band, the head above the pipeline stages (§6) at the full width (site v5; a wide row in site v4). Site v5 PR 2 trimmed its head, which repeated the machine's "files in, a checked report out": the machine above says what each station does; §1 shows what this run's stages produced (the files read, the SQL run, the figures and the checks).
  4. `§2 WHY IT'S DIFFERENT`: a band, the head above exactly three proofs: "The model never does arithmetic", "Definitions you confirm", "Every claim is cited". Each has a mono label, a title, one sentence and one real example in a framed box: the report's first sentence as the model wrote it (`{{N…}}` placeholders) and as the reader sees it (figures and chips); the metric's definition with the 2-line SQL it compiles to; a quoted citation.
     - **From 52rem** they are three cells side by side across the band that share their rows (CSS subgrid), so the three example boxes line up and match in height; stacked on phones. (Site v4's wide row set them as three ruled rows beside the head.)
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
  6. `§4 QUICKSTART`: a band. The head, then the three steps (install, model, analyze) side by side from 56rem, each its label, its code and its note; then, from 1100px, the binary downloads with the Docker line (left, about 2/5) beside the four doors (CLI, API, MCP, Telegram) as a ruled list (right, about 3/5). Stacked on phones: head, steps, binaries, doors.
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
  - **The guided walkthrough (scroll-driven, site v5 PR 2).** The exhibit demonstrates itself as the reader scrolls. After the verification it steps through the story's key figures, opening each one's margin note under a step indicator (`1/4 Revenue fell −17.9% → how it was computed`), with step marks and a progress rule, and no buttons.
    - The steps are chosen from the run's data by role (`walkthrough()` in `scripts/landing-data.ts`), never by typed id: the headline change and how it was computed; its current-period SQL input with the SQL and the sheet rows it read; the driver's share of the change; the quoted document.
    - **Pinned to the scroll from 1100px (site v5 PR 2; this overrides the maintainer's D2 of site v3, "no scroll-pinning at any size", at the maintainer's request).** The whole hero sticks (§5) and each scroll step activates the next figure and opens its note, 1/4 to 4/4; after step 4 the hero releases straight into the engine machine's band. There is no timer.
    - **How the scroll picks the step:** an IntersectionObserver on the track's sentinels, its root a 1%-tall line 65% down the screen; the step is the last sentinel to cross it (the entry's own box says which way). No scroll listener and no layout read per frame.
    - **The progress rule:** 2px of ink over the step bar's hairline, a scroll-driven animation (`animation-timeline` on the track's view timeline, `--aa-walk-track`, scoped on the hero row; transform only) from the pin's start to step 4. Where scroll-driven animations aren't supported it steps with the walkthrough instead (a custom property the script sets). Four step marks fill as the steps pass.
    - **No step controls (the maintainer's call, site v5 PR 2).** No previous, next, Pause or Replay: the active step changes only with the scroll, softly (the caption, the note and the figure's wash cross-fade over 200ms; opacity and colour only). It stays accessible without buttons: the page's own keyboard scrolling (Page Down, Space, the arrow keys) drives the steps; every figure stays a link in the tab order and opens its note on focus; the step caption is announced (`aria-live="polite"`) on every step, and the step's chip carries `aria-current="step"`.
    - **It fits laptop screens; the threshold is 680px of viewport height.** The whole hero pins from 1100px wide and 680px of viewport height when its content fits; below 680px of height it is the tap list. Pinned on a screen under 900px tall, the hero goes compact, sizes only and chosen before first paint: the headline follows the screen's height (`min(--aa-text-hero, 16cqi, 9svh)`), the lead is 1.0625rem / 1.5, the statement's gaps are tighter, the report page sets closer (0.9375rem / 1.6, tighter rules and padding), and the notes' SQL stays folded behind "show". From 1280px wide the exhibit column is at least 48rem when pinned, so the notes sit beside the report page. Measured content at 1280×720 is 616px, at 1366×768 582px and at 1536×730 568px, so it pins at 1280×800, 1366×768, 1440×900 and 1536×864 with browser chrome (about 730–800px), and at 1280×720. The inline script still checks the fit once before first paint (and on resize): between 1100 and 1279px wide (notes below the report page, about 820–890px of content) it pins only on a screen that tall. Pinned, every note shares one grid cell as tall as the tallest; beside the report page a note is raised just enough to end inside that cell (the leader still meets it). The pinned row has no bottom padding, so the release leaves at most about 150px under the exhibit's caption at 1440×900 (the centring's slack plus the tallest note's room).
    - **Under 1100px, under 680px of viewport height (and where it doesn't fit) nothing is pinned:** the steps stack as a ruled list under the exhibit, each a disclosure that opens on tap (step 1 open); the step bar isn't shown. Tapping a figure still opens its margin note below the report page.
    - **Beside or below is a container query (site v4)** on the exhibit's own width (`.aa-walk`), not the screen's, because the exhibit sits in the hero's right column from 1100px: beside at 1440 and wider, below between 1100 and about 1410px, beside again from about 840px to 1100px where the hero stacks, and below on phones. The script reads the same width.
    - **Step 1's note is open from the start**, so the margin is never an empty box; its figure isn't marked until step 1.
    - **Notes size to their own content.** Pinned, every note shares one grid cell as tall as the tallest, so the pinned exhibit's height is known before first paint; beside the report page a note sits level with its figure, raised only as far as it must be to end inside that cell (the leader still meets it). Unpinned beside the exhibit, the notes column keeps the room of its tallest note (measured in the browser, again when the fonts arrive or the window changes; it only grows). Each note sits at the top of its room, never stretched, and the step captions share one grid cell too. So stepping never moves the page.
    - **With the notes below the report page, the SQL is folded** behind "SQL, run in DuckDB · show" (a `<details>`; "· hide" once open; a 24px target at label size), so the tallest note stays short on a phone; beside the exhibit it is open.
    - The step's figure takes the `mark` wash in the text, and its chip shows open.
    - Step 0 says what the verifier did to what is shown: the figures recomputed and the quotes checked, counted from the notes.
    - Under reduced motion, or without JS, the steps are a static ruled list under the exhibit, every note open (SQL unfolded); no step bar and no pin.
    - The mode (`data-walk="pin"` or `"tap"`, none for the static list) is chosen before first paint, so the step bar, the track and the list never shift the layout.
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
- **Buttons (site v5):**
  - `.aa-button` is Plex Sans 500 at 0.9375rem / 1 (−0.005em), 44px tall with 18px side padding, 4px radius, on one line;
  - the primary (the hero's Quickstart, the only one on the site; site v5 PR 1b) is ink: `--aa-ink` under a soft top-down sheen of white (10% to nothing), white text, a 1px `ink` border and a soft ink drop under it, lifting to `ink-2` on hover. It may carry a trailing arrow (`.aa-button-arrow`, an inline 14px SVG, 1.5px square-capped stroke) that steps 2px forward on hover; the secondary is a `raised` sheet in a 1px `rule-strong` hairline that turns `ink` on hover; a third action is a plain text link;
  - hover changes tone (and the arrow's position) only; a press moves the button down 1px. Never its size. No transform under reduced motion.
- **Code:**
  - Expressive Code with `github-light` only, re-based onto `raised` (so its contrast correction targets our real background);
  - a hairline frame, a mono body at `--aa-text-code`, a mono caption label, no window dots.
- **Horizontal scroll boxes** (`.aa-scroll-x`: the status strip; the hero's install line wraps instead since site v5 PR 2): one line that scrolls sideways on narrow screens, a labelled focusable region. No scrollbar (in CSS from the start, so the box's height never changes); the edge with more to read fades over `--aa-space-7` with a transparency mask (not a coloured gradient), set by a small script (`ScrollFade.astro`, in the site layout); without JS there is no fade, and keyboard and touch scrolling work as before. Focused (the box or a link in it), the mask is off, so the focus ring shows (WCAG 2.4.7). A frame (hairline, background) sits on a wrapper, not on the masked box, so it never fades. Text in the fade is scroll-off content: axe doesn't evaluate masks, and it isn't meant to read as body text.
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
  - **The stage (site v5).** Live, it fills the screen (100svh, full-bleed, with no box or frame around it) and stays put while the reader scrolls through the band, then releases into §1; it starts right where the hero's pin releases (the section has no cell; the head and the list keep the page frame's side rules). From 60rem the view is the whole stage, with the card over its right side; under 60rem the view sits over a card of fixed height (14.5rem), so nothing in the stage moves when the card's content changes. The section's head (the component's `head` slot) sits over the stage's top left from 60rem (sticky with it, taking no height, never taking the pointer): the camera frames the home view below it, and it fades as the tour starts (opacity, from the scroll); under 60rem it sits above the band. In the still mode the stage is the old 37.5–45rem box (no hairline frame) in the page frame, with the head above it.
  - **The still frame, at once.** The build renders the home view of the same scene, lights and framing (`machine-wide`, 1600×1160, the stage area the card leaves free, and `machine-tall`, 720×840 from the lighter scene, for phones; WebP plus PNG, explicit width and height, `object-fit: contain` on the page colour) with the docs `assets` script; `site-assets.test.ts` covers them. The box is fixed in CSS, so nothing shifts.
  - **Loading.** three.js (a pinned dependency, D18, imported as ES modules so it tree-shakes) and the live view (`machine-3d.ts`) are one chunk, imported on `requestIdleCallback` after the load event (a 2s timeout; a plain timer where there is none) once the band is near: within a quarter screen below the viewport on desktop, within a screen on phones. Creating the WebGL context and compiling the shaders is one long task on a machine without a GPU (about 300ms under Lighthouse), so it never runs while the first screen is in use, and a reader who never comes to the band never fetches it. Building the scene, compiling (`compileAsync`) and the first frame are split into separate tasks; the canvas then fades in over the still in 400ms. No third-party request.
  - **The tour (scroll-linked camera; the default mode).** The band is a screen plus 25svh per share (20svh under 60rem), one share for the home view and one per stop, and the stage is sticky inside it, so the page scrolls normally while the reader passes through. Site v5 made it quicker: seven stops instead of thirteen (`tourStops()` in `engine-machine.ts`): files in; read and understand (Ingest, Profile); the database file; calculate (Metrics, Analysis); explain and decide (Index docs, Web lane, Explain, Decide and the model room); verify; report. A stop of several pieces frames them together (`fitView` over the group, never closer than a single station was framed, never as wide as home), highlights them all and shows a group card (its stations' numbers, a title, each piece's name and first sentence, their Learn pages); a single piece's stop shows that piece's own entry. Each stop holds for the middle of its share and the camera eases between stops (target and zoom, zoom in log space); a focused piece centres in the part of the view the card (and, at home, the head) doesn't cover. A 2px ink rule along the view's foot shows the progress. The heights are set before first paint (an inline script sets `data-mode`), so the band never shifts.
  - **Explore (site v5, the maintainer's spec; reinstates three's OrbitControls, which site v4 PR 2 had dropped).** A click on the canvas in the tour (with a mouse, from 900px; a small "Click to explore" hint shows at the view's foot on hover) or the **Explore** button (phones under 900px and coarse pointers, where there is no hint) hands the camera to the reader: drag to rotate, wheel or pinch to zoom, right-drag or two fingers to pan. OrbitControls is damped, zooms toward the cursor, keeps the zoom within 0.7–7× of the home view and the tilt between 9° and 74° from straight down (never under the floor), and keeps the pan target over the machine. A click on a station opens its card (the station's own entry; a click that enters explore on a station opens it at once). In explore the wheel zooms the model and never scrolls the page (the stage swallows the wheel outside the canvas, except a card that can scroll, which is contained), and the section stays pinned. **Back to tour** (a real button, in the view's bottom left), Esc, a press outside the view and the card, or scrolling the page by other means (more than 48px) return to the tour: the camera eases over 700ms from where the reader left it to the tour stop of the current scroll. The controls are off in the tour, where the canvas takes neither the wheel nor a touch (`touch-action: pan-y`, so a phone's swipe scrolls the page); in explore it takes both (`touch-action: none`). The mode is `data-view` on the root.
  - **Hover, focus and tap.** Pointing at a station (on the canvas or its label), focusing its label, or tapping it on a touch screen in the tour highlights it (its hairlines turn ink, its floor takes the `mark` wash, its label is pressed) and shows its card, until the scroll reaches another stop. In the tour, pressing a label scrolls the page to the stop that shows its station; in explore it opens the station's card.
  - **Labels (site v5).** Only the labels that matter now show; the rest fade (200ms, opacity) and leave the tab order: in the tour, the stop's pieces and their neighbours on the line, and at the home view every station's number (the side pieces only where they fit); in explore, the ones near the pointer (near the view's centre on a touch screen). A pressed label always shows. A label that would cover another moves up once; if it still collides it fades instead of stacking, so labels never overlap (tested at 1440×900, 1366×768 and 390×844, at home and at stops).
  - **Accessibility of the modes.** Explore and Back to tour are buttons with the site's focus ring; on a desktop the Explore button is out of sight until it has the keyboard's focus (the hint is the pointer's way in), and focus moves between the two as the mode changes, never into the canvas (it is `aria-hidden` and not focusable). Esc leaves explore. Mode changes are announced in a polite live region. The station list stays the accessible equivalent of the whole machine.
  - **Everything readable is HTML**, never canvas text: the station labels (buttons with `aria-pressed`, placed from projected coordinates, kept inside the view and moved up past a label they would cover, in station order for the keyboard; on a narrow or wide-open view they show their number, with the name in their text) and the card (kicker, title, what it does, whether it calls a model, its figures in the run and its Learn stage pages: the station list's own entry, cloned; at the home view a short "how to read the machine"). On a narrow screen the live card keeps the first sentence and the Learn links. The canvas is `aria-hidden`; the still's `alt` describes the machine and points to the list.
  - **The station list.** Every station and its entry, as a plain HTML list in a `<details>` ("Every station, as a list") under the stage: open without JS and in the still mode, folded when live (before first paint).
  - **Phones.** The lighter scene: fewer segments on curved parts and cables, a pixel ratio of at most 1.5, no drift, and a tap to select.
  - **The still mode.** Under `prefers-reduced-motion`, on a weak device (`hardwareConcurrency` ≤ 2, `deviceMemory` ≤ 2 or Save-Data) and without JS: the still frame, the overview card and the open list, a band no taller than its stage, and three is never loaded. If WebGL is missing or the chunk fails when live, the still frame stays and the card still follows the scroll.
  - **Performance.** It renders only while the stage is on screen (IntersectionObserver) and the tab is visible; frames are drawn continuously only while the camera eases or drifts, the drift alone at no more than 30 frames a second.
  - **Motion** (§7): the slow drift, the scroll-linked camera, and in explore the reader's own camera and the ease back to the tour.
- **Footer (every page):** project links, the licence, and "Built by fhsystems", linking to https://fhsystems.dev.

## 7. Motion

Site v4 PR 3 brought tasteful motion to the whole landing page under the rules of §2.5. What moves, and how:

- **Section reveals** (`Reveal.astro`, landing only): the head and the visual of §1–§4 (the children of a `data-reveal` section's cell) fade and rise 12px into place, 240ms with `--aa-ease`, the visual 60ms after its head, **once**, as each first comes into view (IntersectionObserver, 6% inside the bottom edge).
  - Only what is **below the screen when the script runs** is held (opacity 0), so the first screen, and anything the reader has already reached, renders final and never animates. The hero and the engine machine's band are never held.
  - A part the reader scrolls past without stopping (the End key, a fling) is shown at once, as is one that takes keyboard focus; an in-page link, a hash change or printing shows every held part at once, so a jump never lands on a fade.
  - The server renders every part final: without JS, without IntersectionObserver and under reduced motion nothing is held.
- **The pipeline's connector** (§6) draws in, stop by stop, the first time its rail scrolls into view on the landing page. Play still steps through the stops once while on screen and stops at Report; each step moves the connector by one segment (180ms) and crossfades the panel content (150ms), with no moving parts. The stages never play by themselves. Without JS every panel is in the HTML as a stacked list.
- **The exhibit:** its replay (§6), where the figures count up to their recorded values and then verify, the one motion on the first screen; then its walkthrough, the whole hero pinned and stepped by the reader's own scroll from 1100px (site v5 PR 2), with a scroll-driven progress rule. Nothing in it moves by itself.
- **Hover and focus:** 150ms (`--aa-fast`) on links (underline and colour), chips, buttons, the rail's stops, and rows (§3's metric rows and §4's doors take the `mark` wash; a "more" link's arrow steps 3px forward). The margin note slides in over 150ms.
- **Docs:** none beyond hover and focus, the TOC stepping aside, and the user-triggered StageFlow and pipeline stepping (the connector is drawn from the start there).
- **The engine machine** (§6): a slow camera drift (±3.4° about the vertical over 26 seconds, desktop only, tour mode only) while its band is on screen, and the camera moving from stop to stop as the reader scrolls through the band (eased, never ahead of the scroll); in explore the camera moves only under the reader's hand (damped), and eases back to the tour's stop over 700ms when they leave. In the tour nothing in it blocks the page's own scrolling (wheel or touch); only explore, which the reader enters on purpose, holds the wheel. Nothing moves text the reader is on. Under reduced motion it is the still frame with the station list: no drift, no scroll-linked camera and no canvas.
- **The engine machine keeps its own rules** (§6, site v4 PR 2): it is not revealed, and its drift and scroll-linked camera are described above.
- **The hero field's net (site v5, §5; PR 1b):** the one ambient motion. It starts on idle after load and fades in over 600ms (opacity only); its connectors draw in and its pulses run toward the exhibit (§5). It draws only while the hero is on screen (IntersectionObserver) and the tab is visible, at most 30 frames a second, with no layout reads per frame (its size comes from a ResizeObserver, its direction from a media query); the pulses' halo is one pre-rendered sprite, never a per-frame blur; its backing store follows the device pixel ratio, capped at 2 and at about 1.6 million pixels. It has no pause control (site v5 PR 2, the maintainer's call): it always plays while the hero is on screen and the tab is visible, and stops off-screen and in a hidden tab for cost. The maintainer explicitly accepts the WCAG 2.2.2 (Pause, Stop, Hide) trade-off for this decorative background motion; readers who ask for less motion get none (reduced motion), as do Save-Data and no-JS readers. None of it under reduced motion (the canvas is not displayed), with Save-Data, or without JS; the static field stays.
- **No other motion:** no parallax, no looping decoration, nothing that moves text the reader is on, nothing that animates layout (width, height, position): only `transform` and `opacity`, and colour on hover.
- **Reduced motion** turns off the reveals, the connector's draw-in, the count, the replay, the walkthrough and its pin (its steps become a static list, every note open), smooth scrolling and every transition. Everything renders its final state without JS.
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
  - gradients, glow, blobs, 3D (except the engine machine, §6, and the hero's glow, masks and net, §5, §6), glassmorphism, shadows (the machine's shading is light on its own faces, never a cast shadow; the primary button's soft ink drop is the one exception);
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
10. Are the engine machine's labels and card HTML (never canvas text); does its still frame show before any script, does three start only on idle (on phones only near the band), and is it absent under reduced motion? Do its labels never overlap, does the tour scroll the page under the wheel and a touch, and does explore hold the wheel and return to the right stop (Back to tour, Esc, a press outside)?
11. Width (site v4, v5): does a new landing section use the 1440px frame as a full-width band (head above, content in columns across the width; site v5: no empty block over 40% × 35% of the screen), with backgrounds and the graph paper full-bleed, and stack below 1100px? Is long reading text (docs, Learn) still at its reading measure, never stretched to the frame?
12. Is it checked at 1920, 1440, 1100, 1000, 390 and 360px (screenshots at 1920, 1440 and 390 in the PR), with no horizontal scroll at any of them and CLS under 0.05?
13. Motion (site v4 PR 3): does anything new animate only `transform` and `opacity` (colour on hover), stay still while on the first screen, run once, end on the real value, and render its final state with reduced motion and without JS (§2.5, §7)? A new landing section opts into the reveal with `data-reveal`.
14. Hero field (site v5): is the net still paused off-screen and in a hidden tab (with no pause control), at most 30 fps, absent under reduced motion and without JS, and does the hero keep its box while it starts (`site.spec.ts`, "hero field")? Does all text over the glow keep AA (§3, "hero glow")? Are the proof chips' figures still the generated data's ("hero proof chips")?

## 11. Site v3 (October 2026): what the review found, and what it settled

The site v3 design pass (`docs/plans/site-v3.md`, five PRs, #38–#42) started from a review of the live site against this document. Its brief is folded in here; the rules it set are in the sections above.

- **What it found.** The top of the landing page followed this document; from §1 down it didn't. The main cause was the pipeline scene, the README GIF's fixed 640×480 canvas, stretched to the container: its type rendered larger than every heading on desktop and too small to read on phones. Around it, visuals had been built one at a time and didn't share a scale, frame or motion logic: a results table that scrolled sideways even at 1920, code at four sizes, section heads in three patterns.
- **What works, and stays.** One statement and one lead in the hero, with clear actions. The exhibit, a real report whose figures verify and open their SQL, rows and quote, is the strongest thing on the site. Green only on verified. The hairline frame, the quiet status strip, the four doors as a ruled list, the footer.
- **Motion: rethought, not removed.** The verification replay stays (short and meaningful). The walkthrough stays, timed at every size, with nothing pinned to the scroll. The pipeline moves only when the reader presses Play, and then only its panel content crossfades. Nothing else moves.
- **Scale, settled.** One type scale with three floors (labels, reading text in figures, code) and one ceiling (h2, except the hero and a page's own h1); one frame (hairlines, `raised` panels, 4px radius); every visual a component with an entry in §6.
- **Moved out.** The report template's wording for shares over 100% ("accounted for 108% of the change") is an engine task in the analyst-grade plan, not a site change.

## 12. Site v5 (October 2026): the hero's backgrounds and type

Site v5 starts from the maintainer's note that the hero looked flat. PR 1 (this system) keeps the palette, the type families, light only, and the exhibit and its walkthrough exactly as they were, and adds:

- **the hero field** (§5): glow, graph paper fading out radially, grain and the drifting net, with its motion rules in §7;
- **framed corner marks** on the hero's frame (§5);
- **a tighter scale:** a fluid display size (40–68px, set closer), a larger hero lead, the eyebrow as a tag, a fixed vertical rhythm in the statement, and reworked buttons (§6);
- one new colour, `--aa-glow`, for the haze only (§3), and text selection in `mark`.

The scroll-pinned story is PR 2.

### PR 2: a scroll-driven story into the machine (overrides D2)

The maintainer: the hero exhibit should tell its story as the reader scrolls, not on a timer. This overrides site v3's D2 ("no scroll-pinning at any size; the walkthrough is timed everywhere"):

- **the whole hero pins** (the statement and the exhibit together) from 1100px while a scroll track below it passes, each step activated by the scroll and shown by a scroll-driven progress rule; after step 4 it releases straight into the engine machine's band (§5, §6). The timer and every step control (previous, next, Pause, Replay) are gone: only the scroll moves it, keyboard scrolling included, with soft cross-fades and a polite live region;
- **phones** get the steps as a list that opens on tap; **reduced motion and no JS** the static list, every note open;
- **§1's head** is trimmed so it no longer repeats the machine (§5);
- **the install line** wraps after `github.com/` on phones instead of scrolling (§5).
- **the hero field's Pause control is gone**: the net always plays while on screen (still stopped off-screen, in a hidden tab, and absent under reduced motion, Save-Data and without JS). The maintainer accepts the WCAG 2.2.2 trade-off (§7);
- **the engine machine is unchanged**: the pin only releases into its band; its tour and explore modes are a separate PR (below).

### The machine fills the screen, with a quicker tour and an explore mode

The maintainer's spec for the engine machine (§6, §7). It overrides site v4 PR 2's decision that dropped OrbitControls and the guided modes in favour of the scroll-linked camera alone:

- **the stage fills the screen** (100svh, full-bleed, no frame) and stays pinned through the tour, then releases into §1; it follows the hero's release directly, its head over the home view's top left (from 60rem), fading as the tour starts;
- **a quicker tour:** seven stops of neighbouring pieces instead of thirteen, a shorter band (25svh a share, 20svh on phones), the camera framing each group and easing between them;
- **explore:** a click on the canvas (a hint on hover) or the Explore button on phones hands the camera to the reader through three's OrbitControls (damped, bounded zoom and tilt); a station click opens its card; the wheel zooms instead of scrolling the page; Back to tour, Esc or a press outside eases back to the tour's stop;
- **labels:** only near the stop (or the pointer, in explore), the rest faded, and never overlapping;
- unchanged: the still frame and the list under reduced motion, on weak devices, with Save-Data and without JS (three never loads); three on idle once the band is near; same-origin only. OrbitControls comes from `three/examples/jsm`, part of the pinned `three` dependency (D18): no new dependency.

### PR 1b: a bolder hero (the rule change)

The maintainer, after PR 1: "it's still too flat and restrained. Be bold this time; DESIGN.md's calm/ink-only rules may be changed for the hero." So the hero, and only the hero, now carries:

- *(removed after review, see "Removing the blue" below)* **one brand accent, cobalt** (`--aa-accent` #2f3fe8, with `--aa-accent-deep` and `--aa-accent-wash`, §3), in a soft gradient of itself: a visible glow, the net's nodes and connectors, the proof chips' icons and the primary button. It replaces PR 1's `--aa-glow` haze. Green still means only "verified" (§2.4);
- **a two-voice headline** at 72–84px on desktop (`--aa-text-hero`, §4): Plex Sans 700 (a new 23 KB latin file, preloaded on the landing page with the serif italic, which replaces the upright serif's preload there; both have metric-matched fallback faces, so the swap moves nothing) and the serif italic;
- **proof chips** under the actions, generated, each with its source (§5);
- **more motion in the net:** more nodes, connectors that draw in, pulses toward the exhibit (§5, §7), under the same pause, off-screen, hidden-tab, reduced-motion and frame-rate rules.

Everything below the hero keeps the calm, ink-only system.

### Removing the blue (after the live review)

The maintainer, from the live page: no blue. The cobalt accent is gone: `--aa-accent`, `-deep` and `-wash` are removed.
- The primary button (Quickstart) is ink, with its soft sheen and drop; the proof chips' icons are ink in a `surface` well, and their hover border is ink; the eyebrow's node is ink.
- The net is graphite: `ink-2` nodes and connectors, ink pulse heads.
- The glow is a neutral warm grey (`--aa-glow`, `--aa-glow-deep`, §3), same shape and strengths as PR 1b's.
- Everything else from PR 1b stays: the two-voice headline, the proof chips, the net's motion and the 390 fixes. Green still means only "verified".

### Sections without empty columns (after the live review)

The maintainer, from the live page: §1, §2 and §4 had the heading on the left and all the content on the right, leaving a big empty left column; make the head sticky with the content scrolling, or go full width, with no large empty blocks. Measured at 1920×1080, 1440×900 and 1366×768, each was a tall single column of content beside a head of three lines, so a sticky head would still have stood alone over an empty column for most of the scroll, and there was nothing of the section's own to fill it without new copy. So all three are full-width bands (§5):

- **§1:** the head across the top, the pipeline stages at the full width below it (the rail spreads, the panel's ledgers use the width).
- **§2:** the head across the top, the three proofs side by side under it, their example boxes aligned (the 52rem subgrid layout, now from 52rem up).
- **§4:** the head across the top, the three steps side by side, then the binaries beside the four doors.
- **unchanged:** §3 (already a band), the hero and the machine's release into §1, the copy, the colours, and every layout under 1100px (390 identical before and after).
- **no sticky heads remain** on the landing page below the hero; the rule above is checked in the browser suite instead.
