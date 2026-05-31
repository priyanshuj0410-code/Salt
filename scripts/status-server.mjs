#!/usr/bin/env node
// status-server.mjs — live status portal for parallel Salt chats.
// Reads the shared lock dir + work queue + git worktrees (and open PRs) and
// serves an auto-refreshing dashboard. Zero dependencies (Node stdlib only).
// Usage:  node scripts/status-server.mjs [port]     (or: scripts/wt.sh portal [port])

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PORT = Number(process.argv[2]) || 7878;

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

const MAIN_REPO =
  (sh("git worktree list --porcelain").split("\n").find((l) => l.startsWith("worktree ")) || "")
    .slice(9) || process.cwd();
const WT_HOME = path.join(path.dirname(MAIN_REPO), "salt-worktrees");
const LOCKS = path.join(WT_HOME, "locks");
const QUEUE = path.join(WT_HOME, "queue.md");
const MAP = path.join(MAIN_REPO, "scripts", "module-map.txt");

function modules() {
  const out = [];
  try {
    for (const line of fs.readFileSync(MAP, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [name, ...globs] = t.split(/\s+/);
      out.push({ name, globs });
    }
  } catch {}
  return out;
}

function lockInfo(name) {
  try {
    const info = fs.readFileSync(path.join(LOCKS, name, "info"), "utf8");
    const get = (k) => (info.match(new RegExp("^" + k + " (.*)$", "m")) || [])[1] || "";
    const worktree = get("worktree");
    return { holder: get("slug"), since: get("since"), worktree, stale: !!worktree && !fs.existsSync(worktree) };
  } catch { return null; }
}

function worktrees() {
  const list = [];
  let cur = {};
  for (const line of sh("git -C " + JSON.stringify(MAIN_REPO) + " worktree list --porcelain").split("\n")) {
    if (line.startsWith("worktree ")) cur = { path: line.slice(9) };
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5, 12);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace("refs/heads/", "");
    else if (line === "detached") cur.branch = "(detached)";
    else if (line === "" && cur.path) { list.push(cur); cur = {}; }
  }
  if (cur.path) list.push(cur);
  return list;
}

function queue(n = 25) {
  try {
    const lines = fs.readFileSync(QUEUE, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    return lines.slice(-n).reverse();
  } catch { return []; }
}

let prCache = { at: 0, data: [] };
function prs() {
  if (Date.now() - prCache.at < 30000) return prCache.data;
  let data = [];
  try { data = JSON.parse(sh("gh pr list --state open --limit 30 --json number,title,headRefName,isDraft")); }
  catch {}
  prCache = { at: Date.now(), data: Array.isArray(data) ? data : [] };
  return prCache.data;
}

function status() {
  const mods = modules().map((m) => {
    const li = lockInfo(m.name);
    return li ? { name: m.name, owns: m.globs, locked: true, ...li } : { name: m.name, owns: m.globs, locked: false };
  });
  return { now: new Date().toISOString(), mainRepo: MAIN_REPO, wtHome: WT_HOME,
           modules: mods, worktrees: worktrees(), queue: queue(), prs: prs() };
}

const HTML = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Salt · parallel chat status</title>
<style>
:root{--bg:#0b0e14;--panel:#141925;--line:#232a3a;--txt:#e6e9ef;--dim:#8a93a6;
--free:#1f8f54;--freebg:#11271c;--lock:#d6473b;--lockbg:#2a1513;--stale:#c98a1a;--stalebg:#2a2110;--accent:#4c8dff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;background:linear-gradient(180deg,#0b0e14,rgba(11,14,20,.85));
border-bottom:1px solid var(--line);padding:14px 22px;display:flex;align-items:center;gap:14px;backdrop-filter:blur(6px)}
h1{font-size:15px;margin:0;font-weight:650;letter-spacing:.2px}
.sub{color:var(--dim);font-size:12.5px}
.pulse{width:9px;height:9px;border-radius:50%;background:var(--free);box-shadow:0 0 0 0 rgba(31,143,84,.6);animation:p 2s infinite}
body.offline .pulse{background:var(--lock);animation:none}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(31,143,84,.5)}70%{box-shadow:0 0 0 7px rgba(31,143,84,0)}100%{box-shadow:0 0 0 0 rgba(31,143,84,0)}}
.upd{margin-left:auto;color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
main{padding:18px 22px;max-width:1280px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px;margin-bottom:26px}
.card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:9px;padding:11px 13px}
.card.free{border-left-color:var(--free)}.card.locked{border-left-color:var(--lock)}.card.stale{border-left-color:var(--stale)}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.name{font-weight:620;font-size:14px}
.badge{font-size:10px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:20px}
.badge.free{color:#7fe0a6;background:var(--freebg)}.badge.locked{color:#ff9d93;background:var(--lockbg)}.badge.stale{color:#f3c969;background:var(--stalebg)}
.who{font-size:12.5px;margin-top:5px;color:var(--txt)}.who b{color:var(--accent)}.since{color:var(--dim)}
.owns{margin-top:7px;color:var(--dim);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cols{display:grid;grid-template-columns:1.3fr 1fr;gap:22px}
@media(max-width:820px){.cols{grid-template-columns:1fr}}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);margin:0 0 9px}
.feed{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px;max-height:60vh;overflow:auto}
.q{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 8px;border-radius:6px;margin:2px 0;border-left:2px solid var(--line);color:var(--txt)}
.q-claim{border-left-color:var(--free)}.q-block{border-left-color:var(--lock);background:var(--lockbg)}.q-done{border-left-color:var(--dim);color:var(--dim)}.q-note{border-left-color:var(--accent)}
ul{list-style:none;margin:0;padding:0}li{padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px;background:var(--panel);font-size:13px}
.dim{color:var(--dim)}b{font-weight:620}
</style></head><body>
<header><span class=pulse></span><h1>Salt · parallel chats</h1><span class=sub id=sub>loading…</span><span class=upd id=updated></span></header>
<main>
<div class=grid id=mods></div>
<div class=cols>
<section><h2>Work queue (newest first)</h2><div class=feed id=queue></div></section>
<section><h2>Worktrees</h2><ul id=wts></ul><h2 style=margin-top:18px>Open PRs</h2><ul id=prs></ul></section>
</div>
</main>
<script>
var $=function(s){return document.querySelector(s)};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]})}
function qcls(l){if(/\\bBLOCK:/.test(l))return'q-block';if(/\\bDONE:/.test(l))return'q-done';if(/\\bCLAIM:/.test(l))return'q-claim';return'q-note'}
function tick(){
  fetch('/api/status',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    document.body.classList.remove('offline');
    var held=d.modules.filter(function(m){return m.locked}).length;
    $('#sub').textContent=d.modules.length+' modules · '+held+' locked · '+d.worktrees.length+' worktrees';
    $('#mods').innerHTML=d.modules.map(function(m){
      var cls=m.locked?(m.stale?'stale':'locked'):'free';
      var badge=m.locked?(m.stale?'STALE':'LOCKED'):'FREE';
      var who=m.locked?('<div class=who>chat <b>'+esc(m.holder)+'</b><span class=since> · '+esc(m.since)+(m.stale?' · worktree gone':'')+'</span></div>'):'<div class="who dim">available</div>';
      var owns='<div class=owns title="'+esc((m.owns||[]).join(' '))+'">'+esc((m.owns||[]).join('  '))+'</div>';
      return '<div class="card '+cls+'"><div class=row><span class=name>'+esc(m.name)+'</span><span class="badge '+cls+'">'+badge+'</span></div>'+who+owns+'</div>';
    }).join('');
    $('#queue').innerHTML=d.queue.map(function(l){return'<div class="q '+qcls(l)+'">'+esc(l)+'</div>'}).join('')||'<div class=dim style=padding:6px>queue empty</div>';
    $('#wts').innerHTML=d.worktrees.map(function(w){return'<li><b>'+esc(w.branch||'?')+'</b> <span class=dim>'+esc(w.head||'')+'</span><br><span class=dim>'+esc(w.path)+'</span></li>'}).join('');
    $('#prs').innerHTML=d.prs.length?d.prs.map(function(p){return'<li>#'+p.number+' <b>'+esc(p.headRefName)+'</b> '+(p.isDraft?'<span class=dim>· draft</span>':'')+'<br><span class=dim>'+esc(p.title)+'</span></li>'}).join(''):'<li class=dim>none open</li>';
    $('#updated').textContent='updated '+new Date(d.now).toLocaleTimeString();
  }).catch(function(){document.body.classList.add('offline');$('#updated').textContent='disconnected — retrying…'});
}
tick();setInterval(tick,2000);
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/api/status")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(status()));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log("Salt status portal  →  http://localhost:" + PORT);
  console.log("watching: " + LOCKS + "  +  " + QUEUE);
});
