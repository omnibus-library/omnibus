---
paths: "server/src/backend.rs, server/src/backend/**, server/src/auth/**, shared/src/**, openapi/**"
---
# 13 — The REST contract (OpenAPI)

[`openapi/openapi.json`](../../openapi/openapi.json) is the contract for `/api/*`: the
document the iOS app, the React client, the MCP server and any future client build
against. It is generated from the Rust code and never edited by hand.

## Where the contract lives

- **Wire types live in `shared/`.** Every request body, query struct and response body of
  an `/api/*` route, even one only the server touches. Each derives
  `#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]` (a query struct derives
  `utoipa::IntoParams` with `into_params(parameter_in = Query)`). This overrides rule 05's
  "hoist on the second consumer": the spec is the second consumer.
- **Routes live on their handlers.** A `#[utoipa::path]` attribute declares the method,
  path, tag, parameters, body and responses. `routes.rs` registers the handler with
  `.routes(routes!(handler))`, which reads the path from that attribute, so a route can't
  be served at one path and documented at another. Handlers sharing a path and differing
  in method go in one `routes!(a, b)`.
- **What no handler owns** (overview, security schemes, tag order) lives in
  [`server/src/backend/openapi.rs`](../../server/src/backend/openapi.rs), with the
  overview prose in [`overview.md`](../../server/src/backend/openapi/overview.md) beside it.

Out of scope: the Dioxus server functions (`/api/rpc/*`), Kobo, OPDS, `/metrics`, `/mcp`
and `/react`. Their clients fix those formats, so they keep plain `.route(...)`.

## Annotating a handler

```rust
/// Get a book
///
/// One book's full record.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book.", body = EbookMetadata),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_ebook_by_uuid(/* … */) -> Response {
```

- **`tag`** is one of the tags declared in `openapi.rs`, which sets their order.
- **Every response has a `description`.** OpenAPI requires one; a test enforces it.
- **Errors:** list each 4xx the handler itself returns, saying *when* ("No book has that
  uuid."), not what the status means. Leave out the 401/408/413/429/500 any route can
  return; the overview covers them.
- **Binary bodies:** `body = [u8], content_type = "image/webp"` (`image/*` when the type
  varies). A route that honours `If-None-Match` lists its `304`.
- **Security:** inherited from the document (bearer or session cookie). A public route
  says `security(())`. A media route an `<img>`/`<audio>` loads, which also accepts
  `?token=`, says `security(("bearer" = []), ("session_cookie" = []), ("media_token" = []))`.
- **Permissions:** a route gated on admin, upload, edit or download ends its description
  with "Needs an admin account." (or "the upload/edit/download permission") and lists the
  `403`.
- **`operation_id`** defaults to the function name, which clients turn into method names.
  Override it only when the name is unclear (`login_handler`) or collides; a test fails
  on duplicates.
- **A type only a query parameter references** isn't collected by utoipa: add it to
  `components(schemas(...))` in `openapi.rs`. A test fails on a dangling `$ref`.

## Writing the docs

Handler doc comments become the operation's summary and description; doc comments on
`shared/` types and fields become schema descriptions. Write them for someone calling
the API, not reading the Rust:

- The **first line** is the summary, an imperative title without a full stop: "List
  books", "Revoke an API token".
- The rest says what the call does and anything a caller would trip over. Implementation
  notes (why a lock, which helper, what the db does) go in a `//` comment in the body.
- No issue or PR numbers, Rust paths (`db::foo`), intra-doc links (`` [`Foo`] ``),
  migration numbers or derive notes in text that reaches the spec.
- Give a field a doc when its name doesn't say its unit or meaning: "Unix seconds",
  "The book's uuid", what each enum value means.

## Regenerating

```bash
just openapi-gen   # rewrite openapi/openapi.json from the code
just openapi       # regenerate, then browse it on a local port (Scalar, openapi/index.html)
```

`spec_matches_committed_openapi_json` fails while the committed file is stale, so CI's
test job catches a route or wire type changed without regenerating. Commit the
regenerated file with the change that caused it.
