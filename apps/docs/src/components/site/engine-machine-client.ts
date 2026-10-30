// The engine machine's client behaviour (DESIGN.md §6 "Engine machine"; EngineMachine.astro holds the markup and
// styles, engine-machine.ts the data): the scroll-linked tour and its card, explore mode, and starting the live view
// (machine-3d.ts, its own chunk) on idle once the band is near.
import type { Live, MachineData, Mode } from "./machine-3d.ts";

const PHONE = "(max-width: 39.99rem)";
const WIDE = "(min-width: 60rem)";
/** Phones and touch screens (site v5): no hover hint, an Explore button instead of a click on the canvas. */
const TOUCH = "(max-width: 56.24rem), (pointer: coarse)";

/** After load, when the browser is idle (with a timeout, and a plain timer where there is no requestIdleCallback). */
const idle = () =>
  new Promise<void>((ok) => {
    const go = () => ("requestIdleCallback" in window ? requestIdleCallback(() => ok(), { timeout: 2000 }) : setTimeout(ok, 1200));
    if (document.readyState === "complete") go();
    else addEventListener("load", go, { once: true });
  });
/** Once the element is within `margin` of the viewport. */
const near = (el: Element, margin: string) =>
  new Promise<void>((ok) => {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          ok();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
  });
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Wires one live machine (its `[data-machine]` root, `data-mode="live"`). */
export function startMachine(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>("[data-track]");
  const stage = root.querySelector<HTMLElement>("[data-engine-stage]");
  const viewport = root.querySelector<HTMLElement>("[data-viewport]");
  const head = root.querySelector<HTMLElement>(".aa-engine-head-in");
  const card = root.querySelector<HTMLElement>("[data-card]");
  const list = root.querySelector<HTMLElement>(".aa-engine-list");
  const bar = root.querySelector<HTMLElement>("[data-bar]");
  const exploreBtn = root.querySelector<HTMLButtonElement>("[data-explore]");
  const backBtn = root.querySelector<HTMLButtonElement>("[data-back]");
  const announcer = root.querySelector<HTMLElement>("[data-announce]");
  const json = root.querySelector("script[data-machine-data]")?.textContent;
  if (!track || !stage || !viewport || !head || !card || !list || !bar || !exploreBtn || !backBtn || !announcer || !json) return;
  const data = JSON.parse(json) as MachineData;
  let kickerEl = card.querySelector<HTMLElement>("[data-card-kicker]");
  let titleEl = card.querySelector<HTMLElement>("[data-card-title]");
  let bodyEl = card.querySelector<HTMLElement>("[data-card-body]");
  const overview = bodyEl?.firstElementChild?.cloneNode(true) ?? null;
  const overviewHead = [kickerEl?.textContent ?? "", titleEl?.textContent ?? ""] as const;
  const stops = data.tour.length;
  const wide = () => matchMedia(WIDE).matches;

  // The card: a piece's own entry in the list (cloned), a stop's group (its template), explore's start, or the
  // overview at the home view.
  let shown: string | null = "";
  // The card's kicker, title and body are replaced by new nodes, not edited in place: a title that wraps to another
  // line would otherwise move the body under it, which counts as a layout shift; new content is not a shift.
  const fresh = <T extends HTMLElement>(el: T) => {
    const n = el.cloneNode(false) as T;
    el.replaceWith(n);
    return n;
  };
  const fill = (kicker: string, title: string, body: Node | null) => {
    if (!kickerEl || !titleEl || !bodyEl) return;
    kickerEl = fresh(kickerEl);
    titleEl = fresh(titleEl);
    bodyEl = fresh(bodyEl);
    kickerEl.textContent = kicker;
    titleEl.textContent = title;
    bodyEl.replaceChildren(...(body ? [body] : []));
    card.scrollTop = 0;
  };
  const fromTemplate = (sel: string, id: string, prefix?: string) => {
    const c = root.querySelector<HTMLElement>(sel);
    if (!c || shown === id) return;
    shown = id;
    const k = c.querySelector("[data-k]")?.textContent ?? "";
    fill(
      prefix ? `${prefix} · ${k}` : k,
      c.querySelector("[data-t]")?.textContent ?? "",
      c.querySelector(".aa-station-body")?.cloneNode(true) ?? null,
    );
  };
  const show = (key: string | null, prefix?: string) => {
    const id = `${prefix ?? ""}|${key ?? ""}`;
    if (id === shown) return;
    if (!key) {
      shown = id;
      fill(overviewHead[0], overviewHead[1], overview ? overview.cloneNode(true) : null);
      return;
    }
    const li = list.querySelector<HTMLElement>(`[data-station="${key}"]`);
    if (!li) return;
    shown = id;
    const k = li.querySelector(".aa-station-kicker")?.textContent ?? "";
    fill(
      prefix ? `${prefix} · ${k}` : k,
      li.querySelector(".aa-station-title")?.textContent ?? "",
      li.querySelector(".aa-station-body")?.cloneNode(true) ?? null,
    );
  };

  // The scroll: how far through the band the reader is, in stops (0 is the home view). Each stop, the home view
  // included, holds an equal share of the band.
  let live: Live | null = null;
  let view: Mode = "tour";
  let stop = -1;
  let hover: string | null = null;
  // The band's size and the stage's sticky offset change only when the page does, so they are read on load and resize,
  // not on every scroll frame (only the track's position is).
  let spanPx = 1;
  let stickyPx = 0;
  const measure = () => {
    spanPx = Math.max(1, track.offsetHeight - stage.offsetHeight);
    stickyPx = parseFloat(getComputedStyle(stage).top) || 0;
  };
  const span = () => spanPx;
  const stickyTop = () => stickyPx;
  const progress = () => {
    const top = track.getBoundingClientRect().top - stickyPx;
    return Math.min(1, Math.max(0, -top / spanPx));
  };
  const showStop = (s: number) => {
    const t = s === 0 ? null : data.tour[s - 1];
    if (!t) {
      show(null);
      live?.highlight([]);
      return;
    }
    const prefix = `Stop ${s} of ${stops}`;
    if (t.members.length > 1) fromTemplate(`[data-stop-card="${s}"]`, `stop|${s}`, prefix);
    else show(t.key, prefix);
    live?.highlight(t.members);
  };
  let barScale = "";
  let headOpacity = "";
  const update = () => {
    const p = progress();
    const f = clamp(p * (stops + 1) - 0.5, 0, stops);
    const scale = `scaleX(${p.toFixed(4)})`;
    if (scale !== barScale) {
      barScale = scale;
      bar.style.transform = scale;
    }
    // The head sits over the home view and fades as the tour starts (opacity only).
    const headO = (1 - clamp(f / 0.45, 0, 1)).toFixed(3);
    if (headO !== headOpacity) {
      headOpacity = headO;
      root.style.setProperty("--aa-engine-head-o", headO);
    }
    if (view === "explore") return;
    live?.setProgress(f);
    const s = Math.round(f);
    if (s !== stop) {
      stop = s;
      hover = null;
      showStop(s);
    }
  };

  // Explore (site v5): the reader turns, zooms and pans the machine; the scroll is paused under it.
  let exploreY = 0;
  const announce = (text: string) => {
    announcer.textContent = text;
  };
  const touch = () => matchMedia(TOUCH).matches;
  const pick = (key: string | null) => {
    if (!key || key === hover) return;
    hover = key;
    show(key);
    live?.highlight([key]);
  };
  const enter = (key: string | null) => {
    if (!live || view === "explore") return;
    const fromButton = document.activeElement === exploreBtn;
    view = "explore";
    root.dataset.view = "explore";
    live.setMode("explore");
    exploreY = scrollY;
    hover = null;
    if (key) pick(key);
    else {
      fromTemplate("[data-explore-card]", "explore");
      live.highlight([]);
    }
    backBtn.hidden = false;
    exploreBtn.hidden = true;
    if (fromButton) backBtn.focus();
    announce(
      "Explore mode: drag to turn the machine, scroll or pinch to zoom, and choose a station to see what it does. Back to tour or Escape returns.",
    );
  };
  const leave = () => {
    if (!live || view !== "explore") return;
    const hadFocus = document.activeElement === backBtn;
    view = "tour";
    root.dataset.view = "tour";
    live.setMode("tour");
    exploreBtn.hidden = false;
    backBtn.hidden = true;
    if (hadFocus) exploreBtn.focus();
    stop = -1;
    update();
    announce(stop === 0 ? "Back to the tour." : `Back to the tour, stop ${stop} of ${stops}.`);
  };
  exploreBtn.addEventListener("click", () => enter(null));
  backBtn.addEventListener("click", () => leave());
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && view === "explore") leave();
  });
  // A press anywhere outside the view and the card returns to the tour.
  addEventListener(
    "pointerdown",
    (e) => {
      if (view !== "explore") return;
      const t = e.target as Node | null;
      if (t && (viewport.contains(t) || card.contains(t))) return;
      leave();
    },
    { capture: true },
  );
  // In explore the wheel turns into zoom over the canvas (OrbitControls) and does nothing elsewhere on the stage, so
  // the page doesn't scroll from under the pinned machine; a card that can scroll still scrolls.
  stage.addEventListener(
    "wheel",
    (e) => {
      if (view !== "explore") return;
      if (card.contains(e.target as Node) && card.scrollHeight > card.clientHeight + 1) return;
      e.preventDefault();
    },
    { passive: false },
  );

  let ticking = false;
  addEventListener(
    "scroll",
    () => {
      // Scrolling the page by other means (the keyboard, the scrollbar) is the tour's: it leaves explore.
      if (view === "explore" && Math.abs(scrollY - exploreY) > 48) leave();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    },
    { passive: true },
  );
  const remeasure = () => {
    measure();
    update();
  };
  addEventListener("resize", remeasure, { passive: true });
  new ResizeObserver(remeasure).observe(track);
  measure();
  update();

  /** Scroll the page so the camera stops at the stop that shows this piece. */
  const go = (key: string) => {
    const i = data.tour.findIndex((t) => t.members.includes(key));
    if (i < 0) return;
    const y = track.getBoundingClientRect().top + scrollY + ((i + 1.5) / (stops + 1)) * span() - stickyTop();
    scrollTo({ top: Math.ceil(y), behavior: "smooth" });
  };
  for (const t of root.querySelectorAll<HTMLButtonElement>("[data-tag]")) {
    const key = t.dataset.id ?? "";
    t.addEventListener("pointerenter", () => pick(key));
    t.addEventListener("focus", () => pick(key));
    t.addEventListener("click", () => (view === "explore" ? pick(key) : go(key)));
  }

  // three.js: on idle after load, once the band is near (within a quarter screen below the viewport; a whole screen on
  // phones, which scroll faster and draw a lighter scene). Creating the WebGL context and compiling the shaders is one
  // long task on a GPU-less machine, so a reader who never comes here never pays for it, and the first screen's
  // input stays free. The one context is made by the live view itself (no throwaway probe context). If WebGL or the
  // chunk fails, the still frame stays, with the card still following the scroll.
  const phone = matchMedia(PHONE).matches;
  const start = async () => {
    await idle();
    await near(track, phone ? "100% 0px" : "0px 0px 25% 0px");
    try {
      const m = await import("./machine-3d.ts");
      live = await m.mount(stage, data, {
        detail: phone ? "lite" : "full",
        drift: !phone,
        onHover: (k) => {
          if (view === "tour") pick(k);
        },
        onTap: (k, pointer) => {
          if (view === "explore") pick(k);
          else if (pointer !== "touch" && !touch()) enter(k);
          else pick(k);
        },
        coveredRight: () => (wide() ? card.offsetWidth + 24 : 0), // the card and its 24px inset
        coveredTop: () => (wide() ? head.offsetHeight : 0),
      });
      root.dataset.gl = "on";
      stop = -1;
      update();
      // Torn down with the page (not when it goes to the back/forward cache): the context, the geometry and the listeners.
      addEventListener("pagehide", (e) => {
        if (!e.persisted) live?.destroy();
      });
    } catch (e) {
      // The still frame and the scroll-linked card are the fallback, so the reader sees nothing break; the state is
      // marked so a test (or a developer) can see the live view failed to start (no WebGL at all is not a failure).
      if (!(e instanceof Error && e.name === "NoWebGL")) root.dataset.gl = "failed";
    }
  };
  void start();
}
