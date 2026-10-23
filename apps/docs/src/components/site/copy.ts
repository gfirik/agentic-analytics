// Copy on click (apps/docs/DESIGN.md §6 "Copy", site v5 PR 3): every code block and every copyable value on the
// landing page and the docs gets a copy button, and a click on the block itself copies it too. This file holds the
// pure rules for what is copied (`runnableText`, `isCopyValue`: unit-tested in scripts/test/site-copy.test.ts) and
// the small client that wires the buttons (`initCopy`, run from CopyCode.astro). No dependency: the Clipboard API,
// with a hidden textarea and execCommand("copy") as the fallback.

/** Languages whose blocks are shell commands: prompts are stripped and `\` continuations joined. */
const SHELL = new Set(["", "bash", "sh", "shell", "zsh", "console", "shellsession", "shellscript", "plaintext", "text", "txt", "ansi"]);

export function isShellLanguage(lang: string | null | undefined): boolean {
  return SHELL.has((lang ?? "").toLowerCase());
}

/**
 * The runnable text of a block, exactly what a reader should paste:
 * - line endings normalised and trailing spaces dropped;
 * - in shell blocks, a leading "$ " prompt removed from each line, and a line ending in an (unescaped) `\` joined
 *   with the next into one line, so a broken command pastes as one runnable line;
 * - separate commands stay separate lines (each runnable), and `#` comment lines are kept (a shell ignores them);
 * - no blank lines at the start or the end.
 */
export function runnableText(raw: string, shell: boolean): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""));
  const out: string[] = [];
  let joining = false;
  for (const line of lines) {
    let l = shell ? line.replace(/^\$ /, "") : line;
    if (joining) {
      l = l.replace(/^[ \t]+/, "");
      out[out.length - 1] += l;
    } else out.push(l);
    const last = out[out.length - 1] ?? "";
    // An odd run of backslashes at the end is a continuation; "\\" is a literal backslash.
    const run = /\\+$/.exec(last)?.[0].length ?? 0;
    joining = shell && run % 2 === 1;
    if (joining) out[out.length - 1] = `${last.slice(0, -1).replace(/[ \t]+$/, "")} `;
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

const COMMAND = /^(aa|bun|bunx|docker|git|curl|ollama|npx|npm|node)\s+\S/;
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** An inline value worth a copy button: a command (`aa serve`) or an environment variable's name (`GROQ_API_KEY`). */
export function isCopyValue(text: string): boolean {
  const t = text.trim();
  return COMMAND.test(t) || ENV_NAME.test(t);
}

// ── The client ──

const SAY_MS = 1500;
const ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5.5 5.5h7v8h-7z"/><path d="M3.5 10.5v-8h7"/></svg>';

/** Blocks the client gives a button: every <pre> (bar Mermaid's source fallback) and every marked inline value. */
const TARGETS = "pre:not(.aa-nocopy), code[data-copy]";

function nameOf(block: HTMLElement): string {
  const own = block.getAttribute("aria-label");
  if (own) return own.replace(/^Terminal output of: /, "");
  const title = block.closest(".frame")?.querySelector(".title")?.textContent?.trim();
  if (title) return title;
  if (block.tagName === "CODE") return (textOf(block).split("\n")[0] ?? "").slice(0, 60);
  return "code";
}

/** The block's text as shown, without the copy button, Expressive Code's line gutter or its screen-reader labels. */
function textOf(block: HTMLElement): string {
  const own = block.dataset.copy;
  if (own) return own;
  const clone = block.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(".aa-copy-btn, .gutter, .sr-only")) el.remove();
  const lines = clone.querySelectorAll(".ec-line");
  const raw = lines.length
    ? [...lines].map((l) => (l.querySelector(".code") ?? l).textContent ?? "").join("\n")
    : (clone.textContent ?? "");
  const lang = block.closest("[data-language]")?.getAttribute("data-language");
  return block.tagName === "CODE" ? raw.replace(/\s+/g, " ").trim() : runnableText(raw, isShellLanguage(lang));
}

function button(label: string, inline: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = inline ? "aa-copy-btn aa-copy-inline" : "aa-copy-btn";
  b.setAttribute("aria-label", `Copy ${label}`);
  b.title = "Copy";
  b.dataset.say = "Copied";
  b.innerHTML = ICON;
  return b;
}

/** Gives one block its button: in Expressive Code's frame, inside a React island's own <pre> (React owns its parent),
 * inside an inline value, or in a positioned wrapper around any other <pre>. */
function enhance(block: HTMLElement): void {
  if (block.hasAttribute("data-copy-on") || block.closest("astro-island[ssr]")) return;
  block.setAttribute("data-copy-on", "");
  const inline = block.tagName === "CODE";
  const b = button(nameOf(block), inline);
  if (inline) {
    block.classList.add("aa-copy-host");
    block.append(b);
    return;
  }
  const frame = block.parentElement?.matches(".expressive-code .frame") ? block.parentElement : null;
  const host = block.closest<HTMLElement>("[data-copy-host]");
  if (frame) {
    frame.classList.add("aa-copy-host");
    frame.append(b);
  } else if (host) {
    host.classList.add("aa-copy-host");
    host.append(b);
  } else if (block.closest("astro-island")) {
    block.classList.add("aa-copy-host");
    block.append(b);
  } else {
    // The wrapper arrives after first paint, so it must not move anything: it takes over the pre's margins exactly
    // (whatever rule gave them: a sibling combinator or the docs' flow spacing no longer reaches the pre inside it).
    const m = getComputedStyle(block);
    const margin = `${m.marginTop} ${m.marginRight} ${m.marginBottom} ${m.marginLeft}`;
    const wrap = document.createElement("div");
    wrap.className = "aa-copy-host aa-copy-wrap";
    block.replaceWith(wrap);
    wrap.append(block, b);
    wrap.style.margin = margin;
    block.style.margin = "0";
  }
}

function blockOf(btn: Element): HTMLElement | null {
  const host = btn.closest<HTMLElement>(".aa-copy-host");
  if (!host) return null;
  return host.matches("[data-copy-on]") ? host : host.querySelector<HTMLElement>("[data-copy-on]");
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  ta.className = "aa-copy-scratch";
  document.body.append(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

/** The Clipboard API, or the textarea fallback when it is missing or refuses (an insecure origin, a denied permission). */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea.
  }
  return legacyCopy(text);
}

let live: HTMLElement | null = null;
const timers = new WeakMap<HTMLElement, number>();

function say(btn: HTMLElement, state: "copied" | "selected", message: string): void {
  btn.dataset.state = state;
  btn.dataset.say = state === "copied" ? "Copied" : "Selected";
  if (live) {
    // Cleared first, so the same words are announced again on the next copy.
    live.textContent = "";
    requestAnimationFrame(() => {
      if (live) live.textContent = message;
    });
  }
  clearTimeout(timers.get(btn));
  timers.set(
    btn,
    window.setTimeout(() => {
      delete btn.dataset.state;
      btn.dataset.say = "Copied";
      if (live) live.textContent = "";
    }, SAY_MS),
  );
}

async function copy(block: HTMLElement, btn: HTMLElement | null): Promise<void> {
  const ok = await writeClipboard(textOf(block));
  if (!btn) return;
  if (ok) say(btn, "copied", "Copied");
  else {
    // Neither way was allowed: select the text so the reader's own copy works.
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    say(btn, "selected", "Copy was blocked; the text is selected, press Ctrl+C or Cmd+C");
  }
}

function onClick(e: MouseEvent): void {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const btn = target.closest<HTMLElement>(".aa-copy-btn");
  if (btn) {
    const block = blockOf(btn);
    if (block) void copy(block, btn);
    return;
  }
  const block = target.closest<HTMLElement>("[data-copy-on]");
  if (!block || e.button !== 0 || e.detail > 1) return;
  // A link, control or summary inside a block keeps its own job.
  if (target.closest("a, button, summary, input, select, textarea, label")) return;
  // A click that ends a drag-selection selects; it doesn't copy.
  const sel = getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) return;
  void copy(block, block.closest(".aa-copy-host")?.querySelector<HTMLElement>(".aa-copy-btn") ?? null);
}

function scan(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(TARGETS)) enhance(el);
}

export function initCopy(): void {
  live = document.createElement("div");
  live.className = "aa-copy-live";
  live.id = "aa-copy-live";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  document.body.append(live);
  scan();
  document.addEventListener("click", onClick);
  // React islands render their <pre> after hydration (and some only on a click): rescan them as they change.
  const islands = document.querySelectorAll("astro-island");
  if (!islands.length) return;
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const island of islands) scan(island);
      });
  });
  for (const island of islands) observer.observe(island, { childList: true, subtree: true, attributes: true, attributeFilter: ["ssr"] });
}
