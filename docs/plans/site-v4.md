# Plan: site v4, a wider, livelier landing page

**Status:** the maintainer's direction (2026-10-21), built under the autonomy rule. It supersedes the site freeze and the 3D strip with its "Open the machine" button (#50, #51).

**Goal:** the landing page should feel like hex.tech in quality and energy, without copying its branding, assets, one-to-one layout or copy. The identity stays our own: a ledger you can audit, real data, green only on verified things, light only. What changes is the scale and the motion.

## What DESIGN.md loses and gains

| Rule today | v4 |
|---|---|
| §5: a 1180px container with 24px gutters, and a 1px frame left and right of the container | A frame up to **1440px** with **32px** gutters (16px under 480px). Section backgrounds and the graph-paper grid run **full-bleed**, edge to edge. The vertical frame lines move out to the 1440 frame. |
| §5: landing sections are one centred column; the exhibit and pipeline stages are full container width | **Wide rows**, many of them two columns: text left (the 56ch measure), a large live visual right. The narrow ("belly") column stays only for long reading text in the docs and Learn. |
| §2.5 and §7: one moment of motion (the exhibit's replay); the pipeline stages move only after Play; "no entrance animations, no parallax" | **Tasteful motion across the page:** sections reveal as they scroll in, animated connector lines between the pipeline stages, exhibit numbers that count and verify in, smooth hovers. Motion never blocks reading, never moves text the reader is on, and is **all off under `prefers-reduced-motion`** (the final state renders without JS, as now). |
| §2.6 / §9: no 3D, except the engine machine opened by a button (§6) | The engine machine is **live from page load** in its own full-width section, as below. 3D as decoration elsewhere stays banned. |

Kept as they are:
- light only, the tokens and type scale (with display sizes allowed to grow with the wider frame);
- green only for verified things, real data only, and every command real;
- complete without JS;
- the hard budgets.

## The hard budgets (every PR)

- **No third-party requests.**
- **Lighthouse on `/`:** ≥ 90 mobile and ≥ 95 desktop.
- **CLS < 0.05.**
- **axe clean** on every page.
- **No horizontal scroll at 360px.**
- **Screenshots at 1920, 1440 and 390** in each PR.

## PR 1: width and layout

- **Tokens:** `--aa-container` becomes 90rem (1440px), with a new `--aa-gutter` (2rem, 1rem under 480px). Full-bleed section bands carry their own backgrounds; the graph paper spans the viewport and fades at the edges as now.
- **Hero:** two columns at ≥ 1100px. The statement, lead, actions and install line on the left; the exhibit's report page on the right, so the replay plays on the first screen again. Stacked below 1100px.
- **§1 How it works, §2 Why it's different, §3 Results, §4 Quickstart:** each a wide row. Text left, the visual right (the pipeline stages, the three proof examples, the results table, the code), or a full-width band where the visual needs the room (the results table).
- **Docs and Learn:** keep the reading measure; only the site header and footer widen.
- **DESIGN.md §5** is rewritten to match, and its §10 checklist updated.

## PR 2: the 3D section

- **Placement:** its own full-width section directly under the hero and exhibit, at least 600px tall on desktop. The strip and the Open button are removed.
- **Loading:**
  - a still frame renders instantly (the build-rendered image, explicit size, so no shift);
  - three.js starts on `requestIdleCallback` after load (with a timeout fallback), so first paint isn't blocked;
  - the chunk is about 142 KB gzip, and Lighthouse desktop must stay ≥ 95.
- **Look:**
  - solid, shaded, lit models (`MeshStandardMaterial` or `MeshLambertMaterial` with one hemisphere and one directional light, in token colours) instead of the thin wireframe;
  - the glass for model-calling stations stays translucent;
  - green only on the verifier's gate lights for passed checks.
- **Interaction and motion:**
  - a slow camera drift;
  - hover a station to highlight it and show its label and summary (HTML, linking to its Learn page, as now);
  - as the reader scrolls through the section, the camera moves from station to station (scroll-linked, inside this section only; the page itself scrolls normally).
- **Phones:** a lighter scene (fewer segments, no drift, a tap to select) or the still frame on weak devices.
- **Reduced motion:** the still frame with the HTML station list.
- **DESIGN.md:** the engine machine entry (§6) and the 3D exception are rewritten for the live section.

## PR 3: motion across the page

- **Sections reveal on scroll:** a short fade and rise (≤ 300ms, once per section, IntersectionObserver).
- **Pipeline stages:** connector lines draw between the stages as they come into view; Play still steps through them.
- **The exhibit:** numbers count up to their value, then verify (the check appears), as part of the existing replay.
- **Hover states:** 150–200ms on links, chips, buttons and rows.
- **Rules:**
  - nothing animates while it is under the reader's eye;
  - nothing blocks input or reading;
  - everything is off under reduced motion;
  - CLS stays < 0.05 (only transforms and opacity are animated).
- **DESIGN.md §2.5 and §7** are rewritten as above.

## Risks

- **Performance:** a live WebGL scene on desktop plus page motion against the ≥ 95 desktop budget. The scene starts on idle, renders only while on screen, and pauses when the tab is hidden.
- **Copying:** the reference is hex.tech's quality and energy, not its look. No assets, wording or one-to-one layouts are taken; screenshots are compared by a reviewer for that.
- **Hero two-column:** the exhibit's notes column needs room. At 1100–1300px the notes may stack under the report page.
