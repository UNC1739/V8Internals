#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = fileURLToPath(new URL("./notes/", import.meta.url));
const PORT = Number(process.env.NOTES_PORT || 8765);
const HOST = process.env.NOTES_HOST || "127.0.0.1";

const PAGES = [
  { id: "README", file: "README.md", title: "Index" },
  { id: "00-ground", file: "00-ground.md", title: "0 — Ground" },
  { id: "01-data", file: "01-data-representation.md", title: "1 — Data representation" },
  { id: "02-access", file: "02-property-access.md", title: "2 — Property access" },
  { id: "03-parse", file: "03-parsing-bytecode.md", title: "3 — Parse / bytecode" },
  { id: "04-builtins", file: "04-builtins-runtime.md", title: "4 — Builtins / runtime" },
  { id: "04-torque", file: "04-torque-builtin.md", title: "4.3 — Torque builtin" },
  { id: "05-jit", file: "05-jit-and-tiers.md", title: "5 — JIT & tiers (primer)" },
  { id: "05-tiers", file: "05-compiler-tiers.md", title: "5 — Compiler tiers" },
  { id: "05-workbook", file: "05-compiler-tiers-workbook.md", title: "5 — Workbook (hands-on)" },
  { id: "06-memory", file: "06-memory.md", title: "6 — Memory / GC" },
  { id: "07-wasm", file: "07-wasm.md", title: "7 — Wasm" },
  { id: "08-tail", file: "08-long-tail.md", title: "8 — Long tail" },
  { id: "09-synth", file: "09-synthesis.md", title: "9 — Synthesis" },
  { id: "09-log", file: "09-compiler-log.md", title: "9.5 — Compiler log" },
  { id: "habits", file: "habits.md", title: "Habits" },
  { id: "unknown", file: "unknown.md", title: "Unknown" },
];

marked.setOptions({ gfm: true, breaks: false });

function safeJoin(rel) {
  const abs = resolve(ROOT, rel);
  const relToRoot = relative(ROOT, abs);
  if (relToRoot.startsWith("..") || normalize(relToRoot) === "..") return null;
  return abs;
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>V8 internals notes</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;650;700&family=IBM+Plex+Mono:wght@400;500&display=swap"/>
<style>
:root {
  --bg: #0c0e12; --panel: #12151c; --panel-2: #181c25; --line: #2a3140;
  --text: #d6d3cd; --muted: #8b8680; --amber: #e8a838; --amber-dim: #e8a83822;
  --red: #c45c5c; --green: #7ea36a; --blue: #6a8ea3;
  --sans: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--sans); }
.app { display: grid; grid-template-columns: 260px 1fr; height: 100%; }
.nav { border-right: 1px solid var(--line); background: var(--panel); overflow: auto; }
.brand { padding: 18px 16px 12px; border-bottom: 1px solid var(--line); }
.logo { width: 32px; height: 32px; border-radius: 8px; background: var(--amber-dim);
  color: var(--amber); display: grid; place-items: center; font: 700 13px var(--mono);
  float: left; margin-right: 10px; }
.brand-name { font-weight: 700; }
.brand-sub { color: var(--muted); font-size: 12px; }
.les { display: block; width: 100%; text-align: left; background: none; border: 0;
  color: var(--text); padding: 7px 16px; cursor: pointer; font: inherit; }
.les:hover { background: var(--panel-2); }
.les.active { background: var(--amber-dim); color: var(--amber); }
.main { overflow: auto; padding: 32px 40px 80px; }
.article { max-width: 760px; }
.md h1 { font-size: 26px; font-weight: 650; margin: 0 0 0.6em; }
.md h2 { font-size: 18px; font-weight: 650; margin-top: 1.6em; }
.md h3 { font-size: 15px; font-weight: 650; }
.md p { margin: 0.8em 0; }
.md a { color: var(--amber); }
.md code { font-family: var(--mono); font-size: 13px; background: var(--panel-2);
  padding: 1px 5px; border-radius: 4px; }
.md pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px 14px; overflow: auto; }
.md pre code { background: none; padding: 0; }
.md table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
.md th, .md td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; }
.md th { color: var(--muted); font-weight: 600; }
.md blockquote { margin: 1em 0; padding: 0 12px; border-left: 3px solid var(--amber); color: var(--muted); }
.err { color: var(--red); }
</style>
</head>
<body>
<div class="app">
  <aside class="nav">
    <div class="brand">
      <div class="logo">V8</div>
      <div class="brand-name">Internals</div>
      <div class="brand-sub">cohort pin 15.3.76.13</div>
    </div>
    <nav id="nav"></nav>
  </aside>
  <main class="main"><article class="article md" id="article">Loading…</article></main>
</div>
<script>
const PAGES = ${JSON.stringify(PAGES)};
const nav = document.getElementById("nav");
const article = document.getElementById("article");

function currentId() {
  const h = location.hash.replace(/^#/, "");
  return PAGES.some((p) => p.id === h) ? h : PAGES[0].id;
}

function renderNav() {
  const id = currentId();
  nav.innerHTML = PAGES.map((p) =>
    \`<button class="les\${p.id === id ? " active" : ""}" data-id="\${p.id}">\${p.title}</button>\`
  ).join("");
  nav.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { location.hash = b.dataset.id; };
  });
}

async function load() {
  const id = currentId();
  renderNav();
  document.title = (PAGES.find((p) => p.id === id)?.title || id) + " — V8 internals";
  article.textContent = "Loading…";
  try {
    const r = await fetch("/api/page/" + encodeURIComponent(id));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    article.innerHTML = j.html;
    article.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const page = PAGES.find((p) => p.file === href || p.id === href);
      if (page) {
        a.href = "#" + page.id;
        return;
      }
      if (href.endsWith(".md") || href.endsWith(".html") || href.startsWith("_proofs/") || href.startsWith("embedder/")) {
        a.href = "/raw/" + href;
      }
    });
    article.scrollTo?.(0, 0);
    document.querySelector(".main").scrollTop = 0;
  } catch (e) {
    article.innerHTML = '<p class="err">' + e.message + "</p>";
  }
}

window.addEventListener("hashchange", load);
load();
</script>
</body>
</html>
`;

const MIME = {
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".cc": "text/plain; charset=utf-8",
  ".h": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }
    if (url.pathname.startsWith("/api/page/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/page/".length));
      const page = PAGES.find((p) => p.id === id);
      if (!page) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unknown page" }));
        return;
      }
      const md = await readFile(join(ROOT, page.file), "utf8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ id, title: page.title, html: marked.parse(md) }));
      return;
    }
    if (url.pathname.startsWith("/raw/")) {
      const rel = decodeURIComponent(url.pathname.slice("/raw/".length));
      const abs = safeJoin(rel);
      if (!abs) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const body = await readFile(abs);
      res.writeHead(200, {
        "content-type": MIME[extname(abs)] || "text/plain; charset=utf-8",
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(e.stack || e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Notes ready http://${HOST}:${PORT}/`);
});
