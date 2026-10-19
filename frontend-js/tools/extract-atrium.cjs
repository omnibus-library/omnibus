// Usage: node tools/extract-atrium.cjs [--write] [--force]
// Copies the atrium.css + loading.css + filter_bar.css + authors.css rules the React markup can match into
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

// Third element true: a catch-all prefix that may also match classes an earlier, narrower owner claimed.
const OWNERS = [
  ["styles/theme.css", (c) => ["atrium", "theme-snap"].includes(c)],
  ["components/Button/Button.css", (c) => c === "btn"],
  ["components/FilterBar/FilterBar.css", (c) => c === "fb" || c.startsWith("fb-")],
  ["components/ChipInput/ChipInput.css", (c) => c.startsWith("chip-editor") || c.startsWith("me-chip") || c === "me-tag-input" || c === "me-avatar"],
  ["components/Chip/Chip.css", (c) => c === "chip" || c.startsWith("chip-"), true],
  ["components/Cover/Cover.css", (c) => ["cover-wrap", "cover", "tpl-plate", "ca", "ct"].includes(c)],
  ["components/Loading/Loading.css", (c) => c === "ld" || c.startsWith("ld-")],
  ["components/Banner/Banner.css", (c) => c.startsWith("auth-banner")],
  ["components/Field/Field.css", (c) => c.startsWith("auth-field")],
  ["components/StrengthMeter/StrengthMeter.css", (c) => c.startsWith("auth-strength") || c.startsWith("auth-req")],
  ["pages/Register/Register.css", (c) => c.startsWith("auth-checkbox") || ["auth-closed-note", "auth-form-pending"].includes(c)],
  ["components/AuthShell/AuthShell.css", (c) => c.startsWith("auth-"), true],
  ["components/TopNav/TopNav.css", (c) => c.startsWith("atrium-")],
  ["components/UserMenu/UserMenu.css", (c) => c.startsWith("um-")],
  ["components/ThemePicker/ThemePicker.css", (c) => c.startsWith("theme-seg")],
  ["components/SearchPalette/SearchPalette.css", (c) => c.startsWith("sp-")],
  ["pages/Search/Search.css", (c) => c.startsWith("search-")],
  ["layouts/AppShell.css", (c) => c === "app-shell"],
  ["components/DiscPage/DiscPage.css", (c) => c.startsWith("disc-")],
  ["components/ConfirmModal/ConfirmModal.css", (c) => c.startsWith("mg-") || c.startsWith("del-") || c.startsWith("confirm-") || c.startsWith("author-photo-modal")],
  ["components/QuoteCard/QuoteCard.css", (c) => c.startsWith("rd-quote") || c.startsWith("quote-") || ["rd-chip", "rd-x", "rd-drawer-body", "rd-drawer-head", "rd-drawer-title", "rd-desktop-only", "rd-phone-only"].includes(c)],
  ["components/StarRating/StarRating.css", (c) => c.startsWith("star-")],
  ["components/SessionLog/SessionLog.css", (c) => c.startsWith("st-log") || c.startsWith("session-log")],
  ["components/FetchSummary/FetchSummary.css", (c) => c.startsWith("fs-")],
  ["components/FormatSwitcher/FormatSwitcher.css", (c) => c.startsWith("format-") || c.startsWith("kindle-toast") || c.startsWith("kobo-toast")],
  ["components/CopyButton/CopyButton.css", (c) => c.startsWith("copy-feedback")],
  ["pages/Settings/Settings.css", (c) => c.startsWith("profile-") || c.startsWith("setting-row") || c.startsWith("pref-") || c.startsWith("hidden-format") || c === "kindle-delivery" || (c.startsWith("kobo-") && !c.startsWith("kobo-toast")) || c.startsWith("users-") || c === "table-scroll" || c.startsWith("tkx-")],
  ["pages/Authors/Authors.css", (c) => c.startsWith("au-")],
  ["components/AuthorPhotoEdit/AuthorPhotoEdit.css", (c) => c.startsWith("author-photo-edit") || c.startsWith("author-delete-modal")],
  ["pages/Series/Series.css", (c) => c.startsWith("idx-")],
  ["pages/SeriesDetail/SeriesDetail.css", (c) => c === "series-cards" || c.startsWith("series-card")],
  ["components/MoreMenu/MoreMenu.css", (c) => c === "shd-more" || c.startsWith("shd-menu") || c === "shelf-actions-menu" || c.startsWith("shelf-menu-")],
  ["pages/ShelfDetail/ShelfDetail.css", (c) => c.startsWith("shd-") || c === "shelf-grid", true],
  ["pages/Shelves/Shelves.css", (c) => ["shv-page", "shv-header", "shv-head-row", "shv-admin-note", "shv-new", "shv-new-plus", "shv-toolbar", "shv-owners", "shv-owner-chip", "shv-owner-chip--all", "shv-chip-av", "shv-empty", "shv-empty-msg", "shv-body", "shv-group", "shv-group-head", "shv-group-av", "shv-group-title", "shv-group-count", "shv-grid", "shv-cell"].includes(c)],
  ["components/LibraryPicker/LibraryPicker.css", (c) => ["pick", "pick-body", "pick-search", "pick-search-row", "pick-search-clear", "pick-status", "pick-status-text", "pick-review", "pick-more", "pick-more-row", "pick-on-shelf", "pick-tag", "pick-tags", "pick-card-skel"].includes(c)],
  ["components/ShelfForm/ShelfForm.css", (c) => c.startsWith("shelf-") && !c.startsWith("shelf-picker") && !c.startsWith("shelf-add-tile") && !c.startsWith("shelf-btn-") && !["shelf-modal-overlay", "shelf-modal-card", "shelf-modal-error", "shelf-modal-foot"].includes(c), true],
  ["components/ShelfTile/ShelfTile.css", (c) => c.startsWith("shv-") || c.startsWith("shelf-add-tile"), true],
  ["components/ShelfPicker/ShelfPicker.css", (c) => c.startsWith("shelf-picker") || c.startsWith("shelf-modal") || c.startsWith("shelf-btn-") || c.startsWith("pick-"), true],
  ["pages/Library/Library.css", (c) => c.startsWith("lib-") || c.startsWith("lmq") || c.startsWith("ebook-") || c.startsWith("sort-th") || c.startsWith("ss-") || c.startsWith("bulk-edit") || ["landing-col", "library-empty", "cover-link"].includes(c)],
  ["pages/BookEdit/BookEdit.css", (c) => (c.startsWith("me-") && c !== "me-textarea") || c.startsWith("mes-") || c.startsWith("bd-crumb"), true],
  ["pages/BookDetail/BookDetail.css", (c) => c.startsWith("bdmq") || (c.startsWith("bd-") && !c.startsWith("bd-crumb")) || c.startsWith("rx-") || c.startsWith("spoiler") || c.startsWith("cm-") || c === "me-textarea" || c.startsWith("suggest-") || c.startsWith("sug-") || c.startsWith("author-lead") || c.startsWith("author-portrait") || ["sh-title", "sh-sub", "fan-match"].includes(c)],
  ["pages/AddBooks/AddBooks.css", (c) => c.startsWith("file-drop-") || c.startsWith("add-books-")],
  ["components/BarcodeScanner/BarcodeScanner.css", (c) => c.startsWith("scanner")],
  ["pages/CheckIn/CheckIn.css", (c) => c.startsWith("check-in") || c.startsWith("isbn-")],
  ["pages/ComicReader/ComicReader.css", (c) => c.startsWith("cr-")],
  ["pages/PdfReader/PdfReader.css", (c) => c.startsWith("pr-")],
  // After the QuoteCard row, so the `rd-` classes it owns stay there.
  ["pages/Reader/Reader.css", (c) => c.startsWith("rd-"), true],
  ["styles/settings.css", (c) => c.startsWith("settings-")],
  ["styles/base.css", (c) => ["card", "divider", "label", "mono", "sr-only", "subtitle"].includes(c)],
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

// Status words the code compares against: never a className.
const STOP = new Set(["back", "error", "off", "ok", "pending", "success", "tag"]);
const vocab = new Set();
// PDF.js draws the canvas and its layers through this glue, so the class names it sets count as markup.
const GLUES = [path.join(src, "vendor/reader/pdf-reader-glue.js")];
for (const file of [...tsxFiles(src), ...GLUES]) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    if (/test-?id\s*[=:]\s*\{?$/i.test(text.slice(0, m.index))) continue; // test ids are not classNames
    const literal = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ");
    for (const token of literal.split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/.test(token) && !STOP.has(token)) vocab.add(token);
    }
  }
}

// First match wins, so a second narrower owner matching the same class is a dead or misfiled predicate.
const overlaps = [];
for (const token of vocab) {
  const [first, ...later] = OWNERS.filter(([, test]) => test(token));
  for (const [file, , catchAll] of later) if (!catchAll) overlaps.push(`  OVERLAP:${token} ${first[0]} + ${file}`);
}
if (overlaps.length) {
  console.log(overlaps.join("\n"));
  process.exit(1);
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

for (const name of ["atrium.css", "loading.css", "filter_bar.css", "authors.css"]) {
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
