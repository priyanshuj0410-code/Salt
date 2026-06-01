#!/usr/bin/env node
// SALT-142 — nav <-> route invariant guard.
//
// "Per-module on ship": when a screen ships you must (1) add its <Route> in
// apps/web/src/App.tsx and (2) flip its navConfig leaf to `built: true` with a
// `path`. This guard turns that checklist into a CI gate: it fails when the two
// drift apart, so a shipped module is never left unreachable and a nav link can
// never point at a route that does not exist.
//
// Invariants over apps/web/src/components/nav/navConfig.ts + App.tsx:
//   1. build-state <-> path: every node with `built: true` carries a `path`, and
//      no `built: false` node carries one. In navConfig a path is present iff the
//      node is built, so this reduces to count(path:) === count(built: true).
//   2. reachability: every navConfig `path` (query string stripped) resolves to a
//      real <Route path="..."> in App.tsx.
//
// Orphan routes (a <Route> with no nav leaf) are allowed on purpose: detail
// routes (/parties/:id), sub-flows (/import/smart) and /setup are reached
// contextually, not from the sidebar. The guard only checks nav -> route.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const nav = read("src/components/nav/navConfig.ts");
const app = read("src/App.tsx");

const errors = [];

// (1) build-state <-> path consistency.
const builtTrue = (nav.match(/\bbuilt:\s*true\b/g) || []).length;
const navPaths = [...nav.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]);
if (navPaths.length !== builtTrue) {
  errors.push(
    `build-state/path mismatch: ${builtTrue} node(s) are built:true but ${navPaths.length} path(s) are present in navConfig.ts. ` +
      `Every built:true node must carry a path and no built:false node may — did a leaf get flipped to built:true without its path (or a path added to a built:false leaf)?`,
  );
}

// (2) reachability: each nav path must map to an App.tsx <Route>.
const routePaths = new Set(
  [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
);
for (const p of navPaths) {
  const bare = p.split("?")[0]; // /parties?type=customer -> /parties
  if (!routePaths.has(bare)) {
    errors.push(
      `navConfig path "${p}" is marked navigable but has no <Route path="${bare}"> in App.tsx.`,
    );
  }
}

if (errors.length) {
  console.error("✗ nav/route invariant FAILED (SALT-142):\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFix: keep apps/web/src/components/nav/navConfig.ts in sync with the routes in apps/web/src/App.tsx.",
  );
  process.exit(1);
}

console.log(
  `✓ nav/route invariant OK — ${navPaths.length} navigable nav paths, all resolve to App.tsx routes.`,
);
