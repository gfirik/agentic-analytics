// A tiny static server for a built copy of the site, so a "before" build and an "after" build can be measured side by side:
//   node scripts/site/perf/serve.mjs <dist dir> <port>
// It serves the directory under /agentic-analytics/ (the site's base), like `astro preview`.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const [dir, port = "4330"] = process.argv.slice(2);
if (!dir) throw new Error("usage: serve.mjs <dist dir> <port>");
const BASE = "/agentic-analytics";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};
createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  if (!path.startsWith(`${BASE}/`) && path !== BASE) {
    res.writeHead(404).end();
    return;
  }
  let file = join(dir, normalize(path.slice(BASE.length)).replace(/^(\.\.[/\\])+/, ""));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(Number(port), "127.0.0.1");
