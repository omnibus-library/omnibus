---
name: add-backend-route
description: Recipe for adding a backend route to omnibus — a hand-written `/api/*` REST endpoint with its OpenAPI annotation, the shared wire types, and the React client call. Triggers when the user asks to add a new endpoint, handler, API route, or a feature that needs one.
---

# Add a backend route

Every client — the React web client (`frontend-js/`), the iOS app and the MCP server — speaks one transport: hand-written axum handlers under [server/src/backend/](../../../server/src/backend/) at `/api/<resource>`, registered in `routes.rs` and described by [openapi/openapi.json](../../../openapi/openapi.json). A feature adds the handler once and every client calls it.

## 1. Decide the route shape

- **New page:** a React route in [frontend-js/src/router.tsx](../../../frontend-js/src/router.tsx) and a page under `frontend-js/src/pages/`; the server needs nothing, since its fallback serves the client for every path no route claims (`backend::react_ui`). Signed-in pages sit under `RequireAuth`; a page a signed-out visitor must reach (a password reset, an invite) sits beside `/login` and `/register` outside it. Render its loading state, never an empty one, while its data loads (rule 12).
- **Data endpoint:** one REST handler (below).
- **Binary upload (file/multipart):** a REST handler with `axum::extract::Multipart` (see `backend/uploads.rs`, modeled on the author-photo upload). Large uploads need their own sub-router with a bigger `DefaultBodyLimit`, merged after the route-level `REQUEST_TIMEOUT` layer with a `RequestBodyTimeoutLayer` idle timeout in its place (see `book_upload_router` and `rest_router_with_timeouts`) — a body that takes more than 30 s to arrive otherwise gets a 408; if the handler then triggers a reindex, `worker.post(Task::Scan{..})` + `await_completion` before reading the result back.

## 2. Add the shared request/response types

Pick the right submodule under `shared/src/` ([lib.rs](../../../shared/src/lib.rs) is just a re-export index):
`settings.rs` (library paths), `ebook/` (book metadata + overrides), `discovery.rs` (browse / search-palette / author / series), `progress.rs` (F2.1 reading/listening), `audiobook.rs` (F2.3 manifest), `highlight.rs` (annotation colors + CRUD payloads), `view_prefs.rs` (landing-page sort/view state) + `view_filters.rs` (its include/exclude filter clauses), `auth.rs` (login/register payloads), `worker.rs` (worker progress feed). If the new type doesn't fit any of those, add a new submodule alongside them and re-export from `lib.rs`.

- Define the request/response bodies with `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`. Add `Eq` when every field supports it (skip it on any payload that carries `f64` or another non-`Eq` type).
- Every `/api/*` request body, query struct and response body lives here, even one only the server uses: add `#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]` (a query struct takes `utoipa::IntoParams` with `into_params(parameter_in = Query)`), and doc comments written for API callers, since they become the OpenAPI schema descriptions ([13-openapi.md](../../rules/13-openapi.md)).
- Keep this crate free of transport and framework deps — pure serde (plus the optional `openapi` derive).
- The flat re-exports in `lib.rs` mean callers keep writing `omnibus_shared::Foo` regardless of which submodule `Foo` lives in.

## 3. Add the REST handler

Write the handler function in the matching per-domain module under
[server/src/backend/](../../../server/src/backend/) (e.g. `backend/ebooks.rs`,
`backend/progress.rs`), give it a `#[utoipa::path(...)]` attribute with the method,
path, tag, params, body and every response with a description (see
[13-openapi.md](../../rules/13-openapi.md), and any handler in `backend/reviews.rs`
for the shape), then register it with `.routes(routes!(handler))` inside the
matching builder function in
[server/src/backend/routes.rs](../../../server/src/backend/routes.rs) —
`content_routes()`, `data_routes()`, `progress_routes()`, `shelf_routes()`,
`check_in_routes()`, and the other per-domain builders it defines, or add a
new one and merge it into `data_routes()` (or `content_routes()`) if none
fits. `rest_router()` / `rest_router_with_search_limiter()` in
[server/src/backend.rs](../../../server/src/backend.rs) only **compose**
these builder functions into the final router, and no route is registered
there. `routes!` reads the path from the attribute, so the path is written
once; handlers that share a path go in one `routes!(a, b)`. Then run
`just openapi-gen` and commit the regenerated `openapi/openapi.json` with the
handler. `spec_matches_committed_openapi_json` fails until you do.

- **First argument is the auth extractor** (`_user: AuthUser` for read paths and per-user mutations, `_admin: AdminUser` for shared-config writes). Then `State<AppState>` for the pool, `Json<T>` / `Path<…>` / `Query<…>` for the rest. Mandatory — without an extractor the route would default to "any logged-in user", which defeats the per-user permission columns. Domain errors use `thiserror` per [02-error-handling.md](../../rules/02-error-handling.md); background reindex work goes through the shared `Worker` (`worker.post(Task::Scan { .. })`), never `tokio::spawn(indexer::reindex(...))` from a handler.
- **Image-serving GET whose bytes go into an `<img src>`** (covers/thumbs/photos): use `_user: MediaAuthUser` instead of `AuthUser`, and add the path prefix to `is_media_read_path` in `auth/gate.rs`. Both accept the session as a `?token=` query param — a native WebView's `<img>` fetch carries neither the bearer header nor a cookie (the browser sends its cookie, so the React client needs no token). Every cacheable 200 these return must publish an `ETag` — **including a stand-in body**, like the full cover `/api/thumbs/*` serves while the WebP generates. The iOS client caches what comes back, and one that arrives with no validator is one it can never revalidate; see [09-content-validators.md](../../rules/09-content-validators.md).
- **GET that streams bytes off disk** (a book file, an audio part, a download): route it through `backend::conditional` so it publishes an `ETag`, answers `If-None-Match` with a 304, and refuses a `Range` whose `If-Range` went stale. `tower-http`'s `ServeFile` gives you an ETag but has **no `If-Range` support**, so delegating to it alone lets a resume splice the tail of a new file onto the head of an old one. See [09a-serving-validated-bytes.md](../../rules/09a-serving-validated-bytes.md) for the call shape and why `ETag` and `Vary` must travel together, and [09-content-validators.md](../../rules/09-content-validators.md) for what the validator itself is derived from.
- **POST that fetches a client-supplied URL server-side** (apply a provider cover, paste an author photo URL): never write a second fetcher — go through `db::author_photos::fetch_remote_image_with`, which is the one SSRF implementation in the workspace (IP-range guard before any connect, addresses pinned against DNS rebinding, streamed size cap). Tighten it with `RemoteImageConfig`: a `host_allowlist` derived from a catalog rather than hand-written, `require_https`, and `max_redirects` — every hop is re-gated, so following one is only safe through that path. Sniff the bytes with `detect_image_format` afterwards; a remote `Content-Type` is a claim. Mount it in `upload_router()` even though it carries no upload body: the outbound fetch is the cost the per-IP limiter is for. `overrides::post_ebook_cover_from_url` is the worked example — it reaches that fetcher through `db::fetch_provider_cover`, a thin wrapper that spends a *second* gated fetch to upgrade a Google Books cover past its 128px thumbnail and falls back when the larger rendition can't be shown to be the same picture. Wrapping like that is fine; a parallel fetcher is not. That worked example also splits its terms by host (`db::cover_image_config_for`): a catalog host gets the allowlist, a pasted non-catalog URL gets HTTPS plus the address gate only — a deliberate exception, not the default.
- Pick a URL under `/api/<resource>`; an unclaimed `/api/*` path answers a JSON 404, never the web client.
- Return `Response` with explicit status + error string on failure so each client's error UI can surface it.

## 4. Add the DB query (if needed)

In the matching domain module under [db/src/](../../../db/src/) (`books/`, `progress.rs`, `settings/`, a new sibling module for a new domain — `queries.rs` was split apart):

- Define a typed error variant in the module's error enum (or add one) per [02-error-handling.md](../../rules/02-error-handling.md).
- Schema changes go as a new numbered SQL file under [db/migrations/](../../../db/migrations/) (never edit an applied file). Re-exported from `omnibus_db::` (see the flatten block in `db/src/lib.rs`) so callsites just write `omnibus_db::my_query(...)`.
- If the new table interacts with book identity, mind `merged_uuids` (cross-format attach/merge, migration 0016): book-keyed reads should resolve uuids via `resolve_book_id_by_uuid`, which falls back to merged uuids.

## 5. Call it from the React client

After `just openapi-gen`, regenerate the client: `pnpm --dir frontend-js run generate` (orval writes `src/api/generated/`, gitignored). Add the call to the resource's module under [frontend-js/src/api/](../../../frontend-js/src/api/) — a `queryOptions` for a read, an async function over `send` for a write, each parsing the answer with the generated zod schema (`kobo.ts` is a small worked example) — and re-export it from `src/api.ts`. Pages import from `../../api`, never from `api/generated`. The iOS client adds its own call in `omnibus-ios/omnibus/Networking/`; if the write is per-user content state it may join the iOS outbox only by passing [08-offline-writes.md](../../rules/08-offline-writes.md).

## 6. Add tests

Per [03-unit-testing.md](../../rules/03-unit-testing.md):

- **DB:** sibling `<mod>/tests.rs` in the relevant module (inline `#[cfg(test)]` only for 1-2 trivial cases). Happy path + not-found + constraint violation. Run with `cargo test -p omnibus-db`.
- **REST handler:** sibling `<module>/tests.rs` next to the handler module (e.g. `server/src/backend/progress/tests.rs`); inline `#[cfg(test)]` only for routes still in `server/src/backend.rs` itself. Drive with `tower::ServiceExt::oneshot` against `rest_router(AppState::new(in-memory pool))`. Bootstrap a session via the helpers in [server/src/auth/test_support.rs](../../../server/src/auth/test_support.rs) (`create_user` / `create_admin` / `bearer_token`) and attach the bearer header. Cover the full matrix per [03-unit-testing.md](../../rules/03-unit-testing.md): 200 (authed) + 401 (anon) + 403 (wrong role, for admin-gated routes) + relevant 4xx/5xx. Run with `cargo test -p omnibus`.
- **React client:** an `api/` function with logic of its own (a 404 read as `null`, shaping a response) gets a vitest test beside it; the screen that uses it gets a story with a `play` assertion, faked with the generated MSW handler ([frontend-js/README.md](../../../frontend-js/README.md)).

## 7. Add Playwright coverage (user-facing changes)

See [add-playwright-flow](../add-playwright-flow/SKILL.md). `expectMutation` names the REST route the page calls.

## 8. Verify in the browser (when the route surfaces in the UI)

If this route is hit by a UI page, drive that page via [`ui-validate`](../ui-validate/SKILL.md) — it brings up the dev server (idempotent, identity-checked across worktrees), logs in as the seeded admin, and uses Claude Preview (`mcp__Claude_Preview__preview_*`) to snapshot the new behavior.

## 9. End-of-session

Run [99-end-of-session.md](../../rules/99-end-of-session.md). If a new module was introduced, give it a `//!` doc ([05-rust-style.md](../../rules/05-rust-style.md)) — there is no module map to update — and add a link to it from [CLAUDE.md](../../../CLAUDE.md) if it's a top-level crate or concept worth listing in the index.
