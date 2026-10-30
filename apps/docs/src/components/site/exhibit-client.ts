// The hero exhibit's client behaviour (DESIGN.md §6 "The hero exhibit"; Exhibit.astro holds the markup and styles):
// the margin notes (hover, focus, tap, Esc), their placement and reserved room, the pin-or-tap mode, the walkthrough's
// steps that follow the scroll, and the count and verification as the report page comes into view.

/** Wires one exhibit (its `[data-exhibit]` wrapper). The mode was chosen before first paint by the inline scripts. */
export function startExhibit(wrap: HTMLElement): void {
  wrap.dataset.ready = "1";
  const chips = [...wrap.querySelectorAll<HTMLAnchorElement>(".aa-exhibit a.aa-chip[data-note]")];
  const col = wrap.querySelector<HTMLElement>(".aa-notes");
  const leader = wrap.querySelector<HTMLElement>(".aa-leader");
  const caps = [...wrap.querySelectorAll<HTMLElement>(".aa-walk-cap")];
  const dots = [...wrap.querySelectorAll<HTMLElement>(".aa-walk-dot")];
  // The scroll track the pinned exhibit stays over (index.astro): one sentinel per step.
  const sentinels = [...document.querySelectorAll<HTMLElement>("[data-walk-sentinel]")];
  const stepIds = JSON.parse(wrap.dataset.steps ?? "[]") as string[];
  const n = stepIds.length;
  // The mode was chosen before first paint (the inline scripts): "pin", "tap", or none (reduced motion).
  const motion = Boolean(wrap.dataset.walk);
  const pinned = () => wrap.dataset.walk === "pin";
  // The notes sit beside the exhibit when the exhibit is at least 48rem wide: a container query on .aa-walk, since its
  // width follows the hero's columns, not the screen (site v4: beside at 1440 in the hero's right column and from
  // about 840px where the hero stacks; below it in between).
  const besideAt = 48 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const beside = {
    get matches() {
      return wrap.clientWidth >= besideAt;
    },
  };
  const chipFor = (id: string) => chips.find((c) => c.dataset.note === id);

  // ── Notes ─────────────────────────────────────────────────────────────────────────────────────────────────
  let open: { chip: HTMLAnchorElement; note: HTMLElement } | undefined;
  let held = false; // a note opened by a click (touch): it stays until the reader lets go
  let returning = false; // focus going back to a chip after Esc: don't reopen its note
  let autoScroll = false; // the page is scrolling a held note into view
  let hideTimer = 0;
  let current = 0; // 0: the verification; 1..n: the walkthrough's steps
  const place = () => {
    if (!open || !col || !leader) return;
    const { chip, note } = open;
    if (!beside.matches) {
      note.style.top = "";
      note.style.translate = "";
      leader.hidden = true;
      return;
    }
    const c = chip.getBoundingClientRect();
    const box = col.getBoundingClientRect();
    const level = Math.max(0, c.top - box.top - 10);
    if (pinned()) {
      // Pinned, every note shares one grid cell as tall as the tallest (so the exhibit's height is known before
      // first paint): the note sits level with its figure, raised only as far as it must be to end inside the cell.
      note.style.top = "";
      note.style.translate = `0 ${Math.min(level, Math.max(0, box.height - note.offsetHeight))}px`;
    } else {
      note.style.translate = "";
      note.style.top = `${level}px`;
    }
    // The leader runs from the exhibit's edge, level with the figure, to the note: it never crosses the text.
    const page = wrap.querySelector<HTMLElement>(".aa-exhibit-page")?.getBoundingClientRect();
    const from = page ? page.right : c.right;
    leader.hidden = false;
    leader.style.top = `${c.top + c.height / 2 - box.top}px`;
    leader.style.left = `${from - box.left}px`;
    leader.style.width = `${Math.max(0, box.left - from)}px`;
  };
  const close = () => {
    if (!open) return;
    open.note.classList.remove("is-open");
    open.chip.setAttribute("aria-expanded", "false");
    open = undefined;
    held = false;
    if (leader) leader.hidden = true;
  };
  const show = (chip: HTMLAnchorElement) => {
    clearTimeout(hideTimer);
    const note = document.getElementById(`aa-note-${chip.dataset.note}`);
    if (!note) return;
    if (open?.chip !== chip) close();
    open = { chip, note };
    note.classList.add("is-open");
    chip.setAttribute("aria-expanded", "true");
    place();
  };
  // Back to the walkthrough's note once a hovered or held note lets go: pinned, the current step's (step 1's before
  // the first step), and beside the exhibit step 1's, so the margin is never an empty box. Below the exhibit and
  // unpinned the steps are their own list, so nothing opens by itself there.
  const settle = () => {
    held = false;
    const id = stepIds[Math.max(current, 1) - 1];
    const chip = id && (pinned() || beside.matches) ? chipFor(id) : undefined;
    if (chip) show(chip);
    else close();
  };
  const later = () => {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!held) settle();
    }, 220);
  };
  for (const chip of chips) {
    chip.setAttribute("aria-expanded", "false");
    chip.setAttribute("aria-controls", `aa-note-${chip.dataset.note}`);
    chip.addEventListener("mouseenter", () => {
      if (!autoScroll) show(chip);
    });
    chip.addEventListener("mouseleave", later);
    chip.addEventListener("focus", () => {
      if (!returning) show(chip);
    });
    chip.addEventListener("blur", (e) => {
      const to = e.relatedTarget as Node | null;
      if (!(to && open?.note.contains(to))) later();
    });
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      if (held && open?.chip === chip) return settle();
      show(chip);
      held = true;
      if (!beside.matches && !pinned() && open) {
        // Bringing the held note into view (smooth scrolling) carries other figures under a resting pointer:
        // their mouseenter must not take the note away while the page moves by itself.
        // (A scrollend left over from an earlier scroll can arrive first: only one after the page moved counts.)
        autoScroll = true;
        const from = window.scrollY;
        const settled = (e?: Event) => {
          if (e && window.scrollY === from) return;
          autoScroll = false;
          window.removeEventListener("scrollend", settled);
        };
        window.addEventListener("scrollend", settled);
        window.setTimeout(settled, 1200);
        open.note.scrollIntoView({ block: "nearest" });
      }
    });
  }
  col?.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  col?.addEventListener("mouseleave", later);
  col?.addEventListener("focusout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (!(to && (col.contains(to) || open?.chip === to))) later();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !open) return;
    const { chip, note } = open;
    const active = document.activeElement;
    const hadFocus = active === chip || (active !== null && note.contains(active));
    close();
    if (!hadFocus) return;
    returning = true;
    chip.focus();
    returning = false;
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Node;
    if (held && open && !open.note.contains(t) && !chips.some((c) => c.contains(t))) settle();
  });
  // "Show SQL": open beside the exhibit, folded below it (where the tallest note would otherwise be a long column).
  const folds = [...wrap.querySelectorAll<HTMLDetailsElement>(".aa-notes details[data-fold]")];
  // Unpinned beside the exhibit, the notes column keeps the room of its tallest note, measured once its contents are
  // final, so stepping from a short note to a long one never moves the page: a note sits level with its figure, so
  // its room is its figure's offset plus its height. (Pinned, or below the exhibit, one grid cell already holds the
  // tallest.) It only grows: a smaller measure later (fonts in, a wider window) never pulls the page up under the reader.
  let reserved = 0;
  const reserve = () => {
    if (!col) return;
    if (!beside.matches || pinned()) {
      reserved = 0;
      col.style.minHeight = "";
      return;
    }
    const box = col.getBoundingClientRect();
    let room = 0;
    for (const note of col.querySelectorAll<HTMLElement>(".aa-note")) {
      const chip = chipFor(note.dataset.noteFor ?? "");
      const was = note.classList.contains("is-open");
      note.classList.add("is-measure");
      const top = chip ? Math.max(0, chip.getBoundingClientRect().top - box.top - 10) : 0;
      room = Math.max(room, top + note.getBoundingClientRect().height);
      note.classList.remove("is-measure");
      if (was) note.classList.add("is-open");
    }
    reserved = Math.max(reserved, Math.ceil(room));
    col.style.minHeight = `${reserved}px`;
  };
  const fold = () => {
    const roomy = !pinned() || window.innerHeight >= 900;
    for (const d of folds) d.open = beside.matches && roomy;
    reserve();
    place();
  };
  // From 1100px and 680px of height the hero pins when its content fits the screen; otherwise the steps are the
  // tap list. Checked again when the window changes, never per frame.
  const wide = matchMedia("(min-width: 68.75rem)");
  const chooseMode = () => {
    if (!motion) return;
    const was = wrap.dataset.walk;
    wrap.dataset.walk = wide.matches && window.innerHeight >= 680 ? "pin" : "tap";
    const row = wrap.closest<HTMLElement>(".aa-hero-row");
    if (wrap.dataset.walk === "pin" && row) {
      for (const d of folds) d.open = beside.matches && window.innerHeight >= 900;
      row.style.minHeight = "0";
      if (row.getBoundingClientRect().height > window.innerHeight) wrap.dataset.walk = "tap";
      row.style.minHeight = "";
    }
    fold();
    if (wrap.dataset.walk !== was) {
      for (const d of wrap.querySelectorAll<HTMLDetailsElement>(".aa-walk-list details"))
        d.open = d.dataset.stepItem === String(Math.max(current, 1));
      reserved = 0;
      markStep();
      settle();
    }
  };
  fold();
  let wasBeside = beside.matches;
  new ResizeObserver(() => {
    if (beside.matches === wasBeside) return;
    wasBeside = beside.matches;
    fold();
  }).observe(wrap);
  // A narrower column makes its notes taller: measure again (once a frame) as the window changes.
  let resizing = 0;
  window.addEventListener("resize", () => {
    if (!resizing)
      resizing = requestAnimationFrame(() => {
        resizing = 0;
        chooseMode();
        reserve();
        place();
      });
  });
  // The note is placed by its figure's box, and sized by its text: both move a little when the web fonts arrive.
  document.fonts?.ready.then(() => {
    reserve();
    place();
  });

  // ── The walkthrough's steps ──────────────────────────────────────────────────────────────────────────────
  const progress = wrap.querySelector<HTMLElement>(".aa-walk-progress");
  function markStep() {
    caps.forEach((c, i) => {
      c.hidden = i !== current;
    });
    dots.forEach((d, i) => {
      d.classList.toggle("is-on", i < current);
    });
    const on = pinned() && current > 0;
    chips.forEach((c) => {
      const step = on && c.dataset.note === stepIds[current - 1];
      c.classList.toggle("is-step", step);
      if (step) c.setAttribute("aria-current", "step");
      else c.removeAttribute("aria-current");
    });
    // Where scroll-driven animations aren't supported the progress rule steps with the walkthrough (CSS reads it).
    progress?.style.setProperty("--aa-walk-p", String(n ? current / n : 0));
  }
  const setStep = (k: number) => {
    const to = Math.max(0, Math.min(n, k));
    if (to === current) return;
    current = to;
    markStep();
    if (!held) settle();
  };
  markStep();
  settle();

  if (motion && n > 0) {
    // The count: every figure runs up to its recorded value together (each number in it, from zero, in the figure's
    // own format). It is drawn over the figure (data-count, CSS), whose real text never changes and keeps its place,
    // so nothing reflows; it always ends on the real value, which is what the HTML holds.
    const COUNT = 600;
    const figs = [...wrap.querySelectorAll<HTMLElement>(".aa-exhibit .aa-fig")];
    const NUM = /\d[\d,]*(?:\.\d+)?/g;
    const at = (text: string, t: number) =>
      text.replace(NUM, (m) => {
        const decimals = m.split(".")[1]?.length ?? 0;
        const value = Number(m.replace(/,/g, "")) * t;
        return value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: m.includes(","),
        });
      });
    const count = () => {
      for (const f of figs) {
        f.classList.remove("is-counted");
        f.dataset.count = at(f.textContent ?? "", 0);
      }
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / COUNT);
        const eased = 1 - (1 - t) ** 3;
        for (const f of figs) {
          if (t < 1) f.dataset.count = at(f.textContent ?? "", eased);
          else {
            delete f.dataset.count;
            f.classList.add("is-counted");
          }
        }
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    // The verification, once: as the count lands, one figure every ≤ 200 ms in reading order; the last check by 2.5 s.
    const verify = () => {
      count();
      const lead = COUNT - 140; // the check fades in 140 ms after its chip is marked: on the count's last frame
      const step = Math.min(200, 1600 / Math.max(chips.length, 1));
      chips.forEach((chip, i) => {
        window.setTimeout(() => chip.classList.add("is-verified"), lead + i * step);
      });
      window.setTimeout(
        () => {
          wrap.dataset.anim = "done";
        },
        lead + chips.length * step + 300,
      );
    };
    // It runs once the report page's top is above the bottom sixth of the screen: on load in the two-column hero,
    // as the page comes into view when stacked. A margin, not a visible ratio: a ratio can't be reached by a box
    // taller than the screen (a landscape phone).
    const page = wrap.querySelector<HTMLElement>(".aa-exhibit-page");
    const seen = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        seen.disconnect();
        verify();
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    seen.observe(page ?? wrap);

    // The steps follow the scroll while pinned: the step is the number of sentinels whose top has passed a line 65%
    // down the screen. The observer's root runs from far above the screen down to that line, so a sentinel's state
    // changes exactly as its top crosses the line, and a jump past several (the End key, a fling, a link) changes
    // each of them. Nothing is read from the layout, and there is no scroll listener.
    const LINE = 0.65;
    const passed = new Set<Element>();
    const follow = () => {
      if (pinned()) setStep(passed.size);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) passed.add(e.target);
          else passed.delete(e.target);
        }
        follow();
      },
      { rootMargin: `100000px 0px -${Math.round((1 - LINE) * 100)}% 0px` },
    );
    for (const s of sentinels) io.observe(s);
  } else markStep();
}
