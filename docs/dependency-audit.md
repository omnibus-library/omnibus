# Dependency Audit — Cargo.lock Duplicate Families

Last updated: 2026-10-31 (issue #2790; previously PR #2793, issues #2756, #2724, #522, #2054, #1767, #1710, #1621, #1529, #1530, #1100, #1268, #1147, #643).

Run `cargo tree -d --target all` and inspect the output any time Axum, sqlx or
reqwest are bumped. The `deny.toml` `[bans]` section has matching `skip`
entries for the accepted and blocked duplicates below; `cargo deny check bans`
warns on anything outside this list.

## Duplicate-family inventory

| Crate | Versions | Sources | Classification | Notes |
|---|---|---|---|---|
| `getrandom` | 0.2.17, 0.3.4, 0.4.2 | 0.2 from our `db` (argon2/rand_core 0.6 auth path) + `ring`; 0.3 from `jobserver` (→ `cc`, build-dep), `rand_core 0.9` (metrics-util) and dev-deps; 0.4 is a **runtime** dependency via `uuid`'s `v4` feature (`db::helpers::mint_uuid` calls `Uuid::new_v4()` in non-test code), `lopdf` and `rand 0.10`, with `tempfile` a separate dev-only consumer | **accepted intentionally** | The 0.2 pin in `db` is deliberate: `rand_core@0.6` + `getrandom@0.2` is the stable API surface for `OsRng::generate` in the Argon2 password hashing path (see `db/Cargo.toml` comment). Bumping to 0.3 would require also bumping `rand_core`, `password-hash`, and `argon2` — a non-trivial auth-layer upgrade. |
| `rand_core` | 0.6.4, 0.9.5, 0.10.1 | 0.6 via `db` + `password-hash`/`argon2`; 0.9 via `rand 0.9` and `rand_xoshiro` (metrics-util); 0.10 via `rand 0.10` | **blocked by upstream** | Mirrors the `getrandom` and `rand` rows. 0.6 and 0.9 are skipped; 0.10 is then the only counted copy. |
| `rand` | 0.9.4, 0.10.2 | 0.9 via `metrics-util` → `metrics-exporter-prometheus` → `axum-prometheus`; 0.10 via `rmcp` and `lopdf` | **blocked by upstream** | Collapses when `metrics-util` bumps `rand`. |
| `hashbrown` | 0.15.5, 0.16.1, 0.17.1 | 0.15 from `sqlx-core` + `hashlink`; 0.16 from `metrics-util` (axum-prometheus) and `kasuari` (ratatui-core, mock-kobo's `tui`); 0.17 from `indexmap` | **blocked by upstream** | All internal impl details — `hashbrown` does not appear in any public API. Collapses as each upstream crate catches up to the same minor. |
| `foldhash` | 0.1.5, 0.2.0 | 0.1 with `hashbrown 0.15`; 0.2 with `hashbrown 0.16` | **accepted intentionally** | One copy per `hashbrown` minor, same root cause as the row above. |
| `zip` | 3.0.0, 9.0.5 | 3.0.0 via `epub 2.1.5` (the latest `epub`, which asks for `zip = "3.0.0"`); 9.0.5 via `omnibus-db` and `omnibus` directly | **blocked by upstream** | Ours moved to 9 for the `extract()` advisories below; `epub` has not. Collapses when `epub` moves to zip >= 9. |
| `webpki-roots` | 0.26.11, 1.0.10 | 0.26 from `sqlx-core`; 1.0 from `hyper-rustls` (reqwest) | **blocked by upstream** | sqlx-core pins 0.26; reqwest/hyper-rustls have moved to 1.x. Collapses when sqlx bumps its rustls deps. |
| `tower-http` | 0.6.11, 0.7.1 | 0.6.11 via `reqwest 0.13.5` (which vendors its own copy); 0.7.1 via our own `omnibus` server crate directly | **blocked by upstream** | Persists until `reqwest` upgrades to `tower-http 0.7`, or our server's direct dep is downgraded to 0.6 to match. |
| `windows-sys` | 0.48.0, 0.52.0, 0.59.0, 0.60.2, 0.61.2 | `cfg(windows)`-gated, so `cargo deny`'s all-target resolution surfaces them even though this project ships Linux/container-only: `ring`/`rustls-webpki`, `tokio` and its `socket2`/`mio`, `tracing-subscriber`, `tempfile` and `rustls-platform-verifier` each pin their own; 0.48 via `winapi-util` → `walkdir` | **blocked by upstream** | 0.52–0.61 are skipped, leaving 0.48 as the counted copy. Windows target support in those crates is out of this project's control. |
| `base64`, `cpufeatures`, `euclid`, `miniz_oxide`, `r-efi`, `syn`, `wit-bindgen`, `windows-targets`, `windows-link`, `windows_*` | 2–3 each | `base64` 0.23 via `lettre`/`reqwest` beside 0.22; `cpufeatures` 0.3 via `chacha20` (`rand 0.10`); `euclid` 0.20 via `pdf-extract` beside 0.22 via `vello_common` (hayro); `miniz_oxide` 0.8 via `png` beside 0.9 via `flate2`; `r-efi` and `wit-bindgen` one per `getrandom` line (UEFI and WASI targets only); `syn` 3 via `bytemuck_derive`; the `windows_*` target crates under `windows-sys` | **warn, unskipped** | `cargo deny check bans` lists these as `warning[duplicate]` and passes. None is first-party; each collapses on its upstream's next bump. Skip one only if it starts to fail the check. |
| `either`, `fastrand`, `futures-*`, `libc`, `log`, `mio`, `num-traits`, `serde_core`, `serde_json`, `slab`, `sqlx-sqlite`, `tokio` | (shown ×2 each) | Multiple downstream consumers | N/A — same version | One version, multiple reverse-dependency entry points (normal vs build vs dev) in the `cargo tree -d` output. Not true duplicates. |

## Accepted advisories

- `paste 1.0.15` — RUSTSEC-2024-0436 (unmaintained). A proc-macro, pulled in by
  `lofty` (db audiobook tags), so it never links into a runtime binary.
  `deny.toml` ignores it with a matching comment; revisit when `lofty` moves
  off it.
- `ttf-parser 0.25.1` — RUSTSEC-2026-0192 (unmaintained). See
  [PDF crates](#pdf-crates-issue-2568).
- **`unsound` scope (issue #2054):** `deny.toml` sets `unsound = "all"`,
  because cargo-deny's own default (`Scope::Workspace`) never evaluates a
  transitive `informational = "unsound"` advisory, which would leave its
  `ignore` entry unmatched (`advisory-not-detected`). `cargo audit` scans the
  raw `Cargo.lock` and is unaffected.
- **`rsa 0.9.10` / RUSTSEC-2023-0071 — deliberately not in `deny.toml`**
  (issue #2054): this advisory has no `informational`
  category (it's a true `vulnerability`), so the `unsound`-scope setting above
  doesn't apply — and there's no configurable scope for vulnerability-class
  advisories to relax. The actual gap is that cargo-deny's own crate-graph
  resolution prunes `rsa` as unreachable for any built target before the
  advisories check ever runs (`cargo deny -L debug check advisories` logs
  `filtered rsa 0.9.10`; independently confirmed with `cargo tree -i rsa
  --target all`, empty even with `--workspace`). An `ignore` entry for it in
  `deny.toml` can therefore never match anything and would sit as permanent
  `advisory-not-detected` noise, so it was removed rather than kept stale.
  `rsa` is real, present, and unpatched per `cargo audit` (which does not
  do this pruning) — its exemption lives on the `--ignore RUSTSEC-2023-0071`
  flag on the cargo-audit step in `rust.yml`, which is the tool that
  actually encounters it.
- `zip 3.0.0`, RUSTSEC-2026-0367 (`extract()` keeps SUID/SGID bits),
  RUSTSEC-2026-0368 (`extract()` creates symlinks whose targets escape the
  destination) and RUSTSEC-2026-0369 (`ZipStreamReader::extract()` applies
  permissions through symlinks). Fixed only in zip >= 9.0.0. `zip 3.0.0`
  reaches the production graph via `epub 2.1.5` (the latest `epub`, which pins
  `zip = "3.0.0"`); our own `db/` and `server/` deps are on zip 9, but that
  alone does not drop it. Accepted. All three hit only
  `ZipArchive::extract()` / `ZipStreamReader::extract()`, and neither this repo
  nor `epub` calls them (archives are read entry by entry, never extracted to
  disk). `deny.toml` ignores all three with a matching comment, and the
  cargo-audit step in `rust.yml` passes `--ignore` for each. Revisit when
  `epub` moves to zip >= 9.
- `webpki-roots 0.26.11`, RUSTSEC-2026-0381 (bundled roots trust distrusted
  emSign intermediates). Fixed in webpki-roots >= 1.0.10, which Cargo.lock
  holds, alongside the patched `rustls-webpki 0.103.16` (RUSTSEC-2026-0382)
  and `webpki-root-certs 1.0.10` (RUSTSEC-2026-0383). The 0.26.11 copy comes
  from `sqlx-core 0.8.6` and is a semver-trick shim that only re-exports
  webpki-roots 1.x, so it serves the patched roots; sqlx opens SQLite files
  only and makes no TLS connection. No 0.26.x release carries the fix.
  Accepted: like `rsa`, cargo-deny's graph never reaches it, so the exemption
  is only the cargo-audit step's `--ignore RUSTSEC-2026-0381` in `rust.yml`.
  Revisit when sqlx moves to webpki-roots 1.

## Yanked crates

- `spin 0.9.8` — flagged by `cargo audit` as yanked from crates.io (no
  RUSTSEC advisory, 0 vulnerabilities). Reaches the production graph two
  ways: `sqlx-sqlite → flume → spin` and `axum → multer → spin`. Accepted
  until `flume`/`multer` naturally drop it on their next releases — it is a
  yanked-not-vulnerable notice, and both parents are well-maintained.
  `deny.toml` sets `[advisories] yanked = "warn"` with a matching comment.

## KOReader sync

- `md-5` (MIT/Apache-2.0) — `db::partial_md5`, the document fingerprint a
  KOReader device sends over its progress sync. It names a file, it does not
  protect anything. It rides the RustCrypto `digest` 0.10 that `sha2` already
  uses and was already in `Cargo.lock` via `lopdf`, so it adds no crate.

## PDF crates (issue #2568)

- `hayro` (Apache-2.0/MIT) — pure-Rust PDF parser + rasterizer behind
  `db::pdf`: page count, the Info dict, and the page-1 cover render, with the
  standard-14 fonts embedded (`embed-fonts`, the default) so no poppler or
  mupdf is linked or shelled out to. Pulls the `vello_cpu`/`vello_common`
  renderer family; check `cargo tree -d` on bumps, since `image`/`png` are
  shared with the cover pipeline.
- `pdf-extract` (MIT, over `lopdf`) — per-page text and the outline. Held at
  `0.12` or newer: `0.9` rode `lopdf 0.36`, which RUSTSEC-2026-0187 (stack
  overflow on deeply nested objects — an abort, which no `catch_unwind`
  catches) fixes only from `0.42`. `lopdf 0.42` in turn pulls `ttf-parser`,
  which carries an *unmaintained* notice (RUSTSEC-2026-0192) — ignored in
  `deny.toml` with the reason written beside it, since pinning back would
  trade a notice for the abort. It loads whole documents, which is why
  `db::pdf::text_max_bytes` caps the file size it sees; its font parsers can panic on real-world embedded fonts, so every
  page runs under `catch_unwind`. Text quality is advisory (ligatures, CJK).
- MuPDF (AGPL) and pdfium (prebuilt binary) were ruled out under the MIT
  license allow-list in `deny.toml`.
- **PDF.js (Apache-2.0), vendored, not a crate** — `pdfjs-dist@6.3.289`'s
  `build/pdf.min.mjs` + `build/pdf.worker.min.mjs` sit in
  `frontend-js/src/vendor/reader/` beside `epub.min.js` (issue #2569, the web
  PDF reader). Both are the upstream minified ES modules verbatim, loaded by
  `pdf-reader-glue.js` through a dynamic `import()` with the worker URL
  handed over as `GlobalWorkerOptions.workerSrc`; the license text is the
  `@licstart` banner at the top of each file. Apache-2.0 is on the
  `deny.toml` allow-list already (via `hayro`), and nothing about it
  conflicts with the MIT project license. Bumping: fetch the same two files
  for the new version from the npm registry, keep the pin here and in the
  glue's header comment in step, and re-run `pdf_reader.spec.ts` — the text
  layer's CSS contract (`--total-scale-factor`, `--scale-round-x/y`,
  `.textLayer span` geometry) has moved between majors before.

## TUI crates (mock-kobo)

- `ratatui` 0.30 and `crossterm` 0.29 (both MIT) sit behind mock-kobo's
  default `tui` feature: dev tooling, never in the server or its tests.
- `lru 0.18.x` (via `ratatui-core`) is past RUSTSEC-2026-0253's `>= 0.18.2`
  fix, and is the only `lru` in the graph.
- ratatui-core's `bitflags ^2.12` lifted bitflags 2.11.1 to 2.13.2; nothing
  else moved.

## Policy

- **Plain version-currency pins** (issue #1529): a dependency frozen behind
  current stable earns a `# PIN RATIONALE: ...` comment at its pin site even
  when it isn't part of a duplicate-family split — the same "explain, don't
  silently drift" principle this doc has always applied to duplicates, now
  extended to any deliberately-stale single-version pin (`zip`, `sqlx`,
  `rusqlite`, `argon2`, etc.). State *why* the freeze is intentional and
  *what* would need to change to lift it, so the next person to touch that
  line doesn't have to reconstruct the reasoning from a git-blame.
- **Adding a new crate:** check `cargo tree -d` after `cargo update`; any new duplicate must be classified here before the PR lands.
- **Promoting `getrandom`:** when `argon2`/`password-hash` ship a version that supports `getrandom@0.3`, consolidate the 0.2 + 0.3 entries. Until then the three-way split is intentional.
- **Bumping `sqlx`:** held on the 0.8 line (`Cargo.toml` allows 0.8.x patch bumps; upstream has published 0.9.0); revisit as a coordinated bump when the `rusqlite`/`sqlx` `libsqlite3-sys` coupling from issue #1529 needs to move together, same trigger shape as the `getrandom` note above.
- **`deny.toml` skip entries:** every blocked/accepted duplicate has a matching `skip` entry in the `[bans]` section of `deny.toml` so `cargo deny check bans` does not regress on already-triaged duplicates.
