// The only JavaScript in report.html: citation highlighting and the "explain this number" panel.
// Plain ES2020, inlined, no dependencies, no network. Text is written with textContent only, so report
// strings can never become markup.
export const CLIENT_SCRIPT = String.raw`(function () {
  "use strict";
  var dataEl = document.getElementById("aa-data");
  if (!dataEl) return;
  var data = JSON.parse(dataEl.textContent || "{}");
  var facts = {};
  (data.facts || []).forEach(function (f) { facts[f.id] = f; });
  var panel = document.getElementById("aa-fact-panel");
  var lastTrigger = null;

  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clearHighlights() {
    all(".hl").forEach(function (e) { e.classList.remove("hl"); });
    all(".cite[aria-pressed='true']").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
  }

  function showSource(id) {
    var shown = null;
    all(".ev").forEach(function (e) {
      var match = e.getAttribute("data-source") === id;
      e.hidden = !match;
      if (match) shown = e;
    });
    var empty = document.getElementById("aa-ev-empty");
    if (empty) empty.hidden = !!shown;
    return shown;
  }

  function highlightCitation(btn) {
    var wasPressed = btn.getAttribute("aria-pressed") === "true";
    clearHighlights();
    if (wasPressed) { showSource(""); return; }
    btn.setAttribute("aria-pressed", "true");
    var source = btn.getAttribute("data-source");
    var box = showSource(source);
    if (!box) return;
    (btn.getAttribute("data-rows") || "").split(",").filter(Boolean).forEach(function (r) {
      all("tr[data-row='" + r + "']", box).forEach(function (e) { e.classList.add("hl"); });
    });
    (btn.getAttribute("data-cells") || "").split(",").filter(Boolean).forEach(function (c) {
      all("td[data-cell='" + c + "']", box).forEach(function (e) { e.classList.add("hl"); });
    });
    var q = btn.getAttribute("data-q");
    if (q) all("mark[data-q='" + q + "']", box).forEach(function (e) { e.classList.add("hl"); });
    if (box.scrollIntoView) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function openFact(id, trigger) {
    var f = facts[id];
    if (!f || !panel) return;
    lastTrigger = trigger;
    var body = panel.querySelector(".fp-body");
    body.textContent = "";
    body.appendChild(el("p", "fp-value", trigger.textContent));
    body.appendChild(el("p", "fp-label mono", f.id + " · " + f.label));
    var dl = el("dl", "kv");
    function row(k, v) { if (v == null || v === "") return; dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
    row("Exact value", String(f.value) + (f.currency ? " " + f.currency : "") + (f.unit === "percent" ? " %" : ""));
    if (f.metric) row("Metric", f.metric.label + ": " + f.metric.plain + (f.metric.status === "assumed" ? " (assumed)" : ""));
    row("Computed by", f.computation.kind === "sql" ? "SQL in DuckDB" : "function " + f.computation.fn);
    if (f.computation.params) row("Parameters", JSON.stringify(f.computation.params));
    if (f.computation.inputs && f.computation.inputs.length) {
      row("Inputs", f.computation.inputs.map(function (i) { return i + " = " + (facts[i] ? facts[i].display : "?"); }).join(", "));
    }
    row("Verified", f.verified ? "yes, re-derived by the verifier" : "no");
    body.appendChild(dl);
    if (f.computation.sql) body.appendChild(el("pre", "sql mono", f.computation.sql));
    if (f.cites && f.cites.length) {
      var holder = el("div", "chips");
      f.cites.forEach(function (c) {
        var b = el("button", "cite", c.label);
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("data-source", c.source);
        if (c.rows) b.setAttribute("data-rows", c.rows);
        if (c.cells) b.setAttribute("data-cells", c.cells);
        if (c.q) b.setAttribute("data-q", c.q);
        holder.appendChild(b);
      });
      body.appendChild(holder);
    }
    panel.hidden = false;
    var close = panel.querySelector("[data-close]");
    if (close && close.focus) close.focus();
  }

  function closeFact() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var cite = t.closest(".cite");
    if (cite) { highlightCitation(cite); return; }
    var num = t.closest(".num");
    if (num) { openFact(num.getAttribute("data-fact"), num); return; }
    if (t.closest("[data-close]")) closeFact();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeFact(); clearHighlights(); }
  });
})();`;
