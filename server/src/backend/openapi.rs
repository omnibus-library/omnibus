//! The OpenAPI document for the `/api/*` REST surface, committed at `openapi/openapi.json`.
//!
//! Each handler declares its own path, parameters and responses in a `#[utoipa::path]`
//! attribute, and `utoipa_axum::routes!` registers the route from that attribute, so the
//! path a route is served at and the path it is documented at are one string. [`spec`]
//! adds what no handler owns: the overview, the security schemes and the tag order.
//! `just openapi-gen` writes the result, and a test fails while the committed file is
//! stale. The Dioxus server functions (`/api/rpc/*`), Kobo and OPDS are left out: their
//! clients fix those formats.

use omnibus_shared::{SortDir, SortKey, SpoilerFilter};
use utoipa::{
    openapi::{
        security::{ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityScheme},
        OpenApi as Document,
    },
    Modify, OpenApi,
};

#[derive(OpenApi)]
#[openapi(
    info(title = "Omnibus API", description = include_str!("openapi/overview.md")),
    servers((
        url = "{origin}",
        description = "Your Omnibus server.",
        variables(("origin" = (
            default = "http://localhost:3000",
            description = "The address you open Omnibus at, with no trailing slash.",
        ))),
    )),
    modifiers(&SecuritySchemes),
    // Types that only query parameters reference, which utoipa doesn't collect itself.
    components(schemas(SortDir, SortKey, SpoilerFilter)),
    security(("bearer" = []), ("session_cookie" = [])),
    tags(
        (name = "Auth", description = "Sign in and out, sessions, and API tokens."),
        (name = "Library", description = "Books: the listing, one book's details, its files, chapters and images."),
        (name = "Search", description = "Search by title, author and series, or through the text of every book."),
        (name = "Audiobooks", description = "Audiobook playback: the manifest, part files, HLS streams and playback speed."),
        (name = "Covers", description = "Book covers and thumbnails, and changing a book's cover."),
        (name = "Metadata", description = "Correcting a book's metadata, and looking books up at external providers."),
        (name = "Uploads", description = "Adding your own books and audiobooks to the library."),
        (name = "Progress", description = "Reading and listening positions, reading sessions, and moving between a book's formats."),
        (name = "Annotations", description = "Highlights and bookmarks."),
        (name = "Journals", description = "Journal entries about a book, and the images in them."),
        (name = "Ratings", description = "Star ratings."),
        (name = "Read status", description = "Whether you have read a book, and when."),
        (name = "Stats", description = "Reading statistics and goals: yours, and those other readers share."),
        (name = "Shelves", description = "Shelves you fill by hand, and smart shelves that fill themselves from a rule."),
        (name = "Physical books", description = "The physical collection: ISBN check-in, copies, and the wishlist."),
        (name = "Discovery", description = "Authors, series, tags and genres."),
        (name = "Account", description = "Your profile, avatar and preferences, Kobo devices, and Send to Kindle."),
        (name = "Admin", description = "Server administration: users, sessions, settings, maintenance and health."),
        (name = "System", description = "Health check."),
    )
)]
struct ApiDoc;

/// Registers the three ways a request can carry a session.
struct SecuritySchemes;

impl Modify for SecuritySchemes {
    fn modify(&self, doc: &mut Document) {
        let components = doc.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .description(Some(
                        "A session token from `POST /api/auth/login`, or an API token \
                         (`omni_…`) from `POST /api/auth/api-tokens`.",
                    ))
                    .build(),
            ),
        );
        components.add_security_scheme(
            "session_cookie",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
                "__Host-omnibus_session",
                "The cookie a browser sign-in sets. A server running without secure cookies \
                 (`OMNIBUS_SECURE_COOKIES=0`) names it `omnibus_session` instead.",
            ))),
        );
        components.add_security_scheme(
            "media_token",
            SecurityScheme::ApiKey(ApiKey::Query(ApiKeyValue::with_description(
                "token",
                "A bearer token passed in the URL, for media that an `<img>` or `<audio>` \
                 element loads and so can't send a header with. Only routes that list this \
                 scheme accept it.",
            ))),
        );
    }
}

/// The OpenAPI document for every documented `/api/*` route.
pub fn spec() -> Document {
    let mut doc = ApiDoc::openapi();
    doc.merge(crate::auth::auth_routes().into_openapi());
    doc.merge(super::rest_openapi());
    doc
}

/// [`spec`] as the pretty-printed JSON committed at `openapi/openapi.json`.
pub fn spec_json() -> serde_json::Result<String> {
    Ok(spec().to_pretty_json()? + "\n")
}

#[cfg(test)]
mod tests;
