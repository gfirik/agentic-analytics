# Site v3: design review and brief (19 Oct 2026)

Input brief for `docs/plans/site-v3.md`. Like `docs/design/website-v2.md` before it, this file is folded into `apps/docs/DESIGN.md` and the plan, then deleted once site v3 merges.

Reviewed live at gfirik.github.io/agentic-analytics at 1920×1000, 1440 and 390 px, against `apps/docs/DESIGN.md` (main at the time of review). Pages: landing, /learn/, /learn/stages/analysis/.

## Verdict

The top of the page (status strip, hero, exhibit) is calm and on-system. From §1 down, the page stops following its own rules. The main cause is that the **pipeline scene is the README GIF, upscaled**. `pipeline-scene.ts` draws a fixed 640×480 viewBox with type at 18–64px (the delta is 56px, weight 800) and is stretched to the container. At 1130px wide that is ×1.77, so its text renders at 32–48px, with headline figures near 100px. That is bigger than the section h2 (36px) and 2–3× the exhibit's 16px. On a 390px phone the same scene shrinks to roughly ×0.55, so its text is about 10–14px and unreadable, which is why a second text version exists. One component is wrong at both ends.

Around it, the visuals were built one at a time and don't share a scale, frame or motion logic. Results is a table that overflows a 1920px screen. Code sits at four different sizes. Section heads don't share a pattern.

## Findings

### Critical

1. **Pipeline scene breaks the type scale, the surfaces and the "hairlines over shadows" rule.**
   - Text is 32–48px (×1.77), larger than every heading on the page.
   - It uses rounded cards (rx 10–16), a thick 8px black accent bar on the action card, and bold Plex Sans titles. DESIGN.md has headings in the serif, hierarchy "from size and face", no elevation, 4px max radius.
   - The panel holds a fixed 4:3 area, so stages with less content (Files) leave a large empty block.
   - The same problems appear in Learn's "The whole job on one screen", next to 17px serif prose.

   **Fix:** stop reusing the GIF scene on the site. Rebuild §1 as a native HTML component at site tokens: a stage rail (mono labels, 1px rules, ink progress) above one ledger-style panel per stage, at body and note sizes, with chips and checks from the shared components. Keep Play and stage stepping, and keep the README GIF on its own renderer. The mobile ruled list then becomes the same component stacked, not a second version.
2. **Results table scrolls sideways on a 1920px desktop.** Columns are truncated ("NUMBE…"). "✓ meets the bar" repeats in green across every cell, and "n/a (partial run)" repeats five times. The real-public-data row is mostly blank, and the sources are one long mono run.

   **Fix:** transpose the table: metrics as rows (5), runs as columns (4), which fits 1180px with no scroll. Show each value as a figure plus check, with the bar stated once in the row label. A partial run gets one spanning cell ("partial: 8/30 jobs, metrics not computed"). Sources go into a footnote list or `<details>`. Optionally add a small bullet mark per cell (bar tick vs value dot, ink only) as the one infographic here.

### Moderate

3. **Exhibit walkthrough track is long and empty.**
   - The sticky section is 3,172px tall (about 3.5 screens) for 4 steps.
   - While pinned, ~140px above and ~250px below the panel are blank.
   - The "EXHIBIT ·" label scrolls away, leaving the step bar orphaned.
   - At step 0 the margin column is an empty box with "MARGIN · HOVER OR FOCUS A FIGURE".

   **Fix:**
   - cut the track to ~40vh per step;
   - keep the exhibit label in the sticky block;
   - open step 1's note by default instead of the empty hint;
   - centre the pinned block in the space that's actually used.
4. **Chips after every number make the exhibit prose choppy** ("$44,100 ✓N12 in 2026-03 to $36,200 ✓N11 …"). **Fix:** keep the identity but lighten it: chips at label size, a tighter box, `ink-3` text, and the check carried by the chip only after verification.
5. **Section heads aren't one pattern.** §1 and §3 have a 19px lead and §2 and §4 have none. The headline measure forces two lines everywhere. **Fix:** every section gets label → h2 → one-line lead (or explicitly none), with the same spacing tokens.
6. **Code sizes are inconsistent:** the hero install line is 16px, §2 13px, Quickstart 12px, exhibit notes 11px. The step 3 command wraps mid-flag ("--embedder / hash"). **Fix:** two code sizes only (0.8125rem on the page, 0.75rem inside notes), with commands wrapped at a logical break or given a copy button.
7. **Mobile shows native scrollbars** under the status strip and the install line. **Fix:** hide the scrollbar visually, add a fade edge, keep keyboard focus and scrolling.
8. **Decomposition "waterfall" (Learn, Analysis) isn't a waterfall.**
   - Bars start at 0, so the deltas are slivers at the right with no connectors.
   - It's titled "by customer" but shows channels.
   - "Everyone else: the remainder" has a tick but no number.

   **Fix:** draw a true bridge with connectors, deltas on a readable scale (an axis break or a delta-only panel), the right title, and an explicit "0" row or none.
9. **Copy issue in the exhibit (engine template): "wholesale accounted for 108% of the change".** That is correct but reads like an error. **Fix:** in the report template, phrase shares over 100% as "wholesale fell $8,500, more than the whole drop; retail grew $600".

### Minor

10. In Learn, the pipeline's Play button sits off the baseline of the stage buttons.
11. The Learn TOC clips its last items with an inner scrollbar at 1000px tall.
12. StageFlow step descriptions sit at label size (0.75rem). Raise them to note size (0.8125rem) for reading.
13. §2 example blocks have uneven heights, and cell 1's example (`{{N30}} → −17.9%`) is thin. Show the sentence before and after rendering.

## What works

- Hero: one statement, one lead, clear actions.
- The exhibit concept (a real report whose figures verify and open their SQL, rows and quote) is the strongest thing on the site.
- The colour discipline: green only on verified.
- Hairline frame, quiet status strip, Four doors ledger, footer.

## Motion: rethink, not remove

- **Verification replay:** keep. It's short and meaningful.
- **Walkthrough:** keep, but shorter (finding 3). Consider triggering steps when in view plus click, rather than long scroll-pinning, at ≥1100px too.
- **Pipeline:** native rebuild (finding 1). Play steps through the stages with a 150–250ms crossfade of panel content only, with no moving packets.
- **Nothing else moves.** That stays.

## Order of work

1. Pipeline rebuild (1).
2. Results transpose (2).
3. Walkthrough tightening (3, 4).
4. Section-head and code scale (5, 6, 7).
5. Learn visuals (8, 10–13).
6. Template wording (9).

Each step: before/after screenshots at 1440 and 390, a DESIGN.md update in the same PR, and Lighthouse and axe as today.
