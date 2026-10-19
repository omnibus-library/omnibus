// Usage: node tools/extract-atrium.cjs [--write] [--force]
// Copies the atrium.css + loading.css + filter_bar.css rules the React markup can match into
// per-component files: a selector is kept when every class it needs appears in
// src/**/*.tsx, and filed under the owner of its first class (OWNERS below).
// --write creates the CSS files that don't exist yet; --force rewrites them all.
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");

const root = path.join(__dirname, "../..");
const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const src = path.join(root, "frontend-js/src");

const OWNERS = [
  ["styles/theme.css", (c) => ["atrium", "theme-snap"].includes(c)],
  ["components/Button/Button.css", (c) => c === "btn"],
  ["components/FilterBar/FilterBar.css", (c) => c === "fb" || c.startsWith("fb-")],
  ["components/ChipInput/ChipInput.css", (c) => c.startsWith("chip-editor") || c.startsWith("me-chip") || c === "me-tag-input"],
  ["components/Chip/Chip.css", (c) => c === "chip" || c.startsWith("chip-")],
  ["components/Cover/Cover.css", (c) => ["cover-wrap", "cover", "tpl-plate", "ca", "ct"].includes(c)],
  ["components/Loading/Loading.css", (c) => c === "ld" || c.startsWith("ld-")],
  ["components/Banner/Banner.css", (c) => c.startsWith("auth-banner")],
  ["components/Field/Field.css", (c) => c.startsWith("auth-field")],
  ["components/StrengthMeter/StrengthMeter.css", (c) => c.startsWith("auth-strength") || c.startsWith("auth-req")],
  ["pages/Register/Register.css", (c) => c.startsWith("auth-checkbox") || ["auth-closed-note", "auth-form-pending"].includes(c)],
  ["components/AuthShell/AuthShell.css", (c) => c.startsWith("auth-")],
  ["components/TopNav/TopNav.css", (c) => c.startsWith("atrium-")],
  ["components/UserMenu/UserMenu.css", (c) => c.startsWith("um-")],
  ["components/ThemePicker/ThemePicker.css", (c) => c.startsWith("theme-seg")],
  ["components/SearchPalette/SearchPalette.css", (c) => c.startsWith("sp-")],
  ["pages/Search/Search.css", (c) => c.startsWith("search-")],
  ["layouts/AppShell.css", (c) => c === "app-shell"],
  ["components/DiscPage/DiscPage.css", (c) => c.startsWith("disc-")],
  ["pages/Library/Library.css", (c) => c.startsWith("lib-") || c.startsWith("lmq") || c.startsWith("ebook-") || c.startsWith("sort-th") || c.startsWith("ss-") || c.startsWith("format-badge") || c.startsWith("bulk-edit") || c.startsWith("shelf-btn-") || c.startsWith("shelf-modal-") || c.startsWith("shelf-picker") || c.startsWith("pick-") || c === "author-photo-modal-backdrop" || ["landing-col", "library-empty", "cover-link"].includes(c)],
  ["pages/BookDetail/BookDetail.css", (c) => c.startsWith("bdmq") || c.startsWith("bd-")],
  ["styles/base.css", (c) => ["divider", "label", "mono", "sr-only", "subtitle"].includes(c)],
];
const CONTEXT = new Set(["atrium", "theme-snap"]);

function tsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    // Test names are prose, not markup: "the whole screen" would pull in .screen.
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

// Status words the code compares against, never a className.
const STOP = new Set(["back", "error", "off", "ok", "pending", "success", "tag"]);
const vocab = new Set();
for (const file of tsxFiles(src)) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    const literal = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ");
    for (const token of literal.split(/\s+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(token) && !STOP.has(token)) vocab.add(token);
    }
  }
}

function requiredClasses(selector) {
  let s = selector.replace(/\[[^\]]*\]/g, "");
  for (let prev; prev !== s; ) {
    prev = s;
    s = s.replace(/:not\([^()]*\)/g, "");
  }
  return [...s.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
}

function ownerOf(selector, classes) {
  const anchor = classes.find((c) => !CONTEXT.has(c));
  if (anchor) {
    const owner = OWNERS.find(([, test]) => test(anchor));
    return owner ? owner[0] : `UNMAPPED:${anchor}`;
  }
  if (classes.length || /:root|\[data-theme/.test(selector)) return "styles/theme.css";
  return "styles/base.css";
}

const outputs = new Map();
const keyframes = new Map();
const unmapped = new Map();
let kept = 0;
let dropped = 0;

function emit(owner, node, wrappers) {
  if (!outputs.has(owner)) outputs.set(owner, []);
  outputs.get(owner).push({ node, wrappers });
}

function visit(node, wrappers) {
  if (node.type === "comment") return;
  if (node.type === "atrule") {
    if (node.name === "import") return;
    if (/keyframes$/.test(node.name)) {
      keyframes.set(node.params, node);
      return;
    }
    if (node.name === "font-face") {
      emit("styles/base.css", node, wrappers);
      return;
    }
    const inner = [...wrappers, `@${node.name} ${node.params}`];
    for (const child of node.nodes ?? []) visit(child, inner);
    return;
  }
  if (node.type !== "rule") return;
  const byOwner = new Map();
  for (const selector of node.selectors) {
    const classes = requiredClasses(selector);
    if (!classes.every((c) => vocab.has(c))) {
      dropped++;
      continue;
    }
    kept++;
    const owner = ownerOf(selector, classes);
    if (owner.startsWith("UNMAPPED:")) {
      unmapped.set(owner, (unmapped.get(owner) ?? 0) + 1);
    }
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(selector);
  }
  for (const [owner, selectors] of byOwner) {
    const copy = node.clone({ selectors });
    copy.raws.selector = undefined;
    emit(owner, copy, wrappers);
  }
}

for (const name of ["atrium.css", "loading.css", "filter_bar.css"]) {
  const css = fs.readFileSync(path.join(root, "frontend/assets", name), "utf8");
  for (const node of postcss.parse(css).nodes) visit(node, []);
}

function render(entries) {
  const out = postcss.root();
  let open = null;
  let openKey = null;
  for (const { node, wrappers } of entries) {
    const key = wrappers.join(" | ");
    if (!wrappers.length) {
      out.append(node.clone());
      open = null;
      openKey = null;
      continue;
    }
    if (key !== openKey) {
      let parent = out;
      for (const w of wrappers) {
        const [, name, params] = w.match(/^@(\S+)\s*(.*)$/);
        const at = postcss.atRule({ name, params });
        parent.append(at);
        parent = at;
      }
      open = parent;
      openKey = key;
    }
    open.append(node.clone());
  }
  return out;
}

const used = new Map();
for (const [owner, entries] of outputs) {
  const text = entries.map((e) => e.node.toString()).join("\n");
  for (const [name, node] of keyframes) {
    if (new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(text) && !used.has(name)) {
      used.set(name, owner);
      entries.push({ node, wrappers: [] });
    }
  }
}

console.log(`vocabulary: ${vocab.size} tokens; selectors kept ${kept}, dropped ${dropped}`);
for (const [owner, entries] of [...outputs].sort()) {
  console.log(`  ${owner}: ${entries.length} rules`);
}
for (const [k, n] of unmapped) console.log(`  ${k} (${n})`);
if (unmapped.size) process.exit(1);

if (write) {
  for (const [owner, entries] of outputs) {
    const file = path.join(src, owner);
    if (fs.existsSync(file) && fs.statSync(file).size > 0 && !force) {
      console.log(`  kept ${owner} (exists; --force rewrites it)`);
      continue;
    }
    fs.writeFileSync(file, `${render(entries).toString().trim()}\n`);
    console.log(`  wrote ${owner}`);
  }
}
