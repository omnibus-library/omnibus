The REST API behind every Omnibus client. The web app, the iOS app and the MCP server all use it, and a new client can too.

## Signing in

`POST /api/auth/login` opens a session. Set `client_kind` to `ios`, `android` or `bearer` and the token comes back in the response body; send it on every request as `Authorization: Bearer <token>`. Leave `client_kind` out and the server sets a session cookie instead, which is what a browser wants.

An API token (`omni_…`, from `POST /api/auth/api-tokens`) works anywhere a session token does, and suits scripts.

Some media, such as covers, audio parts and book files, gets loaded straight into an `<img>` or `<audio>` element, which can't send a header. Those routes also take the token as a `token` query parameter, and list `media_token` among their security schemes.

Every route needs a session unless it says otherwise.

## Errors

A request that fails answers with a 4xx or 5xx status and a short plain-text body, such as `book not found`. Each operation lists the statuses particular to it. Any route can also answer:

- `401` when the request has no valid session.
- `403` when your account lacks a permission the route needs: admin, upload, edit or download. The route's description says which.
- `408` when the request takes longer than 30 seconds. Book uploads are exempt.
- `413` when the body is too large: over 1 MiB of JSON, 11 MiB for an image, or the server's configured limit for a book upload.
- `429` when one address sends too many requests. Signing in, search and uploads have per-IP limits.
- `500` when something fails on the server.

## Paging

`GET /api/ebooks` pages through the library when you pass `sort`, `dir`, `limit` or `cursor`. `X-Total-Count` holds the number of books that match, and `X-Next-Cursor` the cursor for the next page; the last page has none. A cursor only makes sense under the order that produced it, so send `sort` and `dir` with it.

## Caching

Routes that serve files send an `ETag`. Send it back in `If-None-Match`, and an unchanged file answers `304 Not Modified` with no body. Book and audio files also answer `Range` requests, so a player can seek.

## Versions

The `openapi/openapi.json` at a release tag describes that release.
