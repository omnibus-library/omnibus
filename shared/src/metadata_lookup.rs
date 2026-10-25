//! Wire types for book-metadata resolution against external providers. The
//! check-in ladder answers with one normalized [`ExternalBookMeta`]; the
//! metadata editor's fan-out search answers with an attributed, un-collapsed
//! list of [`ProviderEdition`] plus a per-source [`ProviderSearchStatus`].

use serde::{Deserialize, Serialize};

use crate::scan::SEARCH_QUERY_MAX_LEN;

/// An external metadata provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub enum MetadataProvider {
    OpenLibrary,
    GoogleBooks,
    /// Used only when the server has a Hardcover API key.
    Hardcover,
}

impl MetadataProvider {
    /// Every provider, in catalog order.
    ///
    /// The one hand-written roster in the workspace. Anything that visits every
    /// provider reads it rather than repeating the list: a second copy compiles but
    /// silently misses a variant, showing up as a blocked cover image or a 400.
    pub const ALL: &'static [MetadataProvider] = &[
        MetadataProvider::OpenLibrary,
        MetadataProvider::GoogleBooks,
        MetadataProvider::Hardcover,
    ];

    /// Human-readable provider name for display (check-in note, settings panel, provider catalog).
    pub fn display_name(self) -> &'static str {
        match self {
            MetadataProvider::OpenLibrary => "Open Library",
            MetadataProvider::GoogleBooks => "Google Books",
            MetadataProvider::Hardcover => "Hardcover",
        }
    }
}

// Flip a flag only in the same change that teaches the provider module to parse
// the field onto `ProviderEdition`: a fixture cross-check fails a flag that
// outruns its parser.
/// What a provider can be searched by and what it can return, whether or not it is
/// configured on this server. Each flag describes the provider's API, not any one book.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProviderCapabilities {
    pub search_by_title: bool,
    pub search_by_isbn: bool,
    pub carries_cover: bool,
    pub carries_ratings: bool,
    pub carries_genres: bool,
}

// Built by `providers::catalog` in `omnibus-db`. `configured` is a bool, not a
// masked preview, because any authenticated user can read this route.
/// One metadata provider, as `GET /api/metadata/providers` lists it. It never carries an
/// API key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProviderInfo {
    pub id: MetadataProvider,
    pub display_name: String,
    // Mirrors the check `providers::ladder` uses, so the two can never disagree
    // about what "configured" means.
    /// Whether the server asks this provider right now. Always true for a provider that
    /// works without a key. A provider that needs a key counts only once one is set.
    pub configured: bool,
    /// Whether the provider needs an API key at all. A provider whose key is optional
    /// answers without one.
    pub requires_key: bool,
    pub capabilities: ProviderCapabilities,
}

/// Maximum byte length of a stored Google Books API key. Google keys are short
/// (~39 chars), so this is a generous guard against an unbounded blob.
pub const GOOGLE_BOOKS_API_KEY_MAX_LEN: usize = 512;

// Mirrors `crate::suggestion::HardcoverKeyStatus`.
/// Whether the server has a Google Books API key, with the key masked. It never carries
/// the key itself.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GoogleBooksKeyStatus {
    pub configured: bool,
    /// A masked preview of the key, such as `AIza…9f3a`. Null when no key is set.
    pub masked: Option<String>,
    /// Where the key in effect comes from: `settings` when saved through the API, `env`
    /// when read from the server's environment variables, or `none`.
    pub source: String,
}

/// A Google Books API key to save, or none to clear the saved one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetGoogleBooksKey {
    /// The Google Books API key, up to 512 bytes. Null, left out or blank clears the
    /// saved key.
    #[serde(default)]
    pub key: Option<String>,
}

/// Book metadata from an external provider. Only `isbn13`, `title` and `source` are
/// always set, and providers differ on the rest. `cover_url` points at the provider's
/// image, which the server downloads only when it creates a book or wishlist entry from
/// this metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ExternalBookMeta {
    /// The ISBN-13 that matched, as 13 digits with no hyphens.
    pub isbn13: String,
    pub title: String,
    pub authors: Vec<String>,
    /// The publication year or date, as free text in the provider's own form.
    pub year: Option<String>,
    pub pages: Option<i64>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    /// The series statement, as free text in the provider's own form, such as
    /// "The Kingkiller Chronicle (1)".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    /// The year the work was first published, in any edition. `year` is this edition's
    /// own date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_publish_year: Option<i64>,
    /// The edition's physical format as the provider names it, such as `Paperback`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    pub source: MetadataProvider,
}

impl ExternalBookMeta {
    /// Maximum title length in Unicode scalar values (chars). Mirrors
    /// `MetadataOverrides::TITLE_MAX_LEN`.
    pub const TITLE_MAX_LEN: usize = 500;
    /// Maximum length in chars for single-line name fields: publisher, year,
    /// and each author name. Mirrors `MetadataOverrides::NAME_MAX_LEN`.
    pub const NAME_MAX_LEN: usize = 250;
    /// Maximum length (in chars) for the `description` field. Mirrors
    /// `MetadataOverrides::DESCRIPTION_MAX_LEN`.
    pub const DESCRIPTION_MAX_LEN: usize = 50_000;
    /// Maximum **byte** length for `cover_url`. Mirrors
    /// `crate::AUTHOR_PHOTO_URL_MAX_LEN`, which is itself a byte cap — unlike
    /// every other field cap on this type, `cover_url` is validated with
    /// `.len()` (bytes), not `.chars().count()`.
    pub const COVER_URL_MAX_LEN: usize = crate::AUTHOR_PHOTO_URL_MAX_LEN;
    /// Maximum number of authors.
    pub(crate) const MAX_AUTHORS: usize = 32;

    /// Validate field lengths. This is untrusted wire input, so every free-text
    /// field gets a cap before it reaches a DB write. Returns `Err` with a
    /// human-readable message on the first field over its cap. Caps count Unicode
    /// scalar values (`chars`), **except** `cover_url`, whose cap is byte-based
    /// (see [`Self::COVER_URL_MAX_LEN`]).
    pub fn validate(&self) -> Result<(), String> {
        if self.title.chars().count() > Self::TITLE_MAX_LEN {
            return Err(format!("title exceeds {} characters", Self::TITLE_MAX_LEN));
        }
        if self.authors.len() > Self::MAX_AUTHORS {
            return Err(format!("too many authors (max {})", Self::MAX_AUTHORS));
        }
        for author in &self.authors {
            if author.chars().count() > Self::NAME_MAX_LEN {
                return Err(format!(
                    "author name exceeds {} characters",
                    Self::NAME_MAX_LEN
                ));
            }
        }
        let check = |name: &str, val: &Option<String>, max: usize| -> Result<(), String> {
            if let Some(v) = val {
                if v.chars().count() > max {
                    return Err(format!("{name} exceeds {max} characters"));
                }
            }
            Ok(())
        };
        check("year", &self.year, Self::NAME_MAX_LEN)?;
        check("publisher", &self.publisher, Self::NAME_MAX_LEN)?;
        check("series", &self.series, Self::NAME_MAX_LEN)?;
        check("format", &self.format, Self::NAME_MAX_LEN)?;
        check("description", &self.description, Self::DESCRIPTION_MAX_LEN)?;
        if let Some(ref cover_url) = self.cover_url {
            if cover_url.len() > Self::COVER_URL_MAX_LEN {
                return Err(format!(
                    "cover_url exceeds {} bytes",
                    Self::COVER_URL_MAX_LEN
                ));
            }
        }
        Ok(())
    }
}

// A separate type from `ExternalBookMeta`, the frozen check-in wire payload;
// convert with `TryFrom` where a check-in-shaped value is wanted.
/// One edition that one provider returned for an edition search. Results from different
/// providers are never merged, so the same ISBN from two providers comes back as two
/// entries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ProviderEdition {
    pub source: MetadataProvider,
    // The provider's own id where one exists, else `isbn:<isbn13>`, which every
    // provider can be re-queried by. Omnibus never parses it.
    /// An opaque handle for fetching this edition in full with
    /// `POST /api/metadata/editions/hydrate`, since a search result carries less than
    /// the provider's full record. Send it back unchanged.
    pub provider_ref: String,
    /// The ISBN-13 of this edition, as 13 digits with no hyphens. Absent when the
    /// provider ties none to this edition, which is common because a search result
    /// often names a work rather than one printing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn13: Option<String>,
    /// The ISBN-10 of the same printing as `isbn13`. Present only when the provider
    /// shows that the two name one edition. A 979-prefixed ISBN-13 has no ISBN-10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn10: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    /// The publication year or date, as free text in the provider's own form.
    pub year: Option<String>,
    /// The printed page count of this edition, the value the `print_pages` override
    /// takes. It is never a comic's image count. Null when the provider doesn't say,
    /// and a provider's 0 for unknown also becomes null.
    pub pages: Option<i64>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub series: Option<String>,
    /// The book's position in `series`, formatted for display, such as "1" or "2.5".
    /// Absent when the provider doesn't say. Only Hardcover gives a position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_index: Option<String>,
    /// The year the work was first published, in any edition. `year` is this edition's
    /// own date.
    pub first_publish_year: Option<i64>,
    /// The genres this provider gives the book, at most 10. An empty list means the
    /// provider has none for this book. `carries_genres` in `ProviderCapabilities` says
    /// whether a provider gives genres at all.
    #[serde(default)]
    pub genres: Vec<String>,
    /// How closely this edition matches the query, in hundredths of a point, where 1000
    /// is a perfect title match. Absent when the result wasn't scored. The score depends
    /// only on the edition and the query, never on the provider, so scores compare
    /// across providers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relevance: Option<i32>,
}

impl ProviderEdition {
    /// Maximum genres one candidate contributes.
    ///
    /// Far below `MetadataOverrides::MAX_GENRES` (64) on purpose: that bounds what
    /// a book may *store*, this bounds what one source may *propose*, since Open
    /// Library's subject lists run to dozens of mixed entries.
    pub const MAX_GENRES: usize = 10;

    /// Fill this record's empty fields from `thinner`, keeping every value this one
    /// already carries. The merge behind hydrate-on-select: the detail record is
    /// richer in some fields and poorer in others than the search hit that named
    /// it, and re-fetching must not blank what the list row showed. `self` wins
    /// every conflict, being the record fetched *for this edition*.
    pub fn fill_missing_from(&mut self, thinner: &ProviderEdition) {
        // Both sides are checked for content, not just presence. Providers
        // don't consistently trim these, and filling an absent field with a
        // blank one turns "this source didn't say" into "this source said
        // nothing", which renders as a present-but-empty value.
        let fill = |slot: &mut Option<String>, from: &Option<String>| {
            let blank = |v: &Option<String>| v.as_ref().is_none_or(|s| s.trim().is_empty());
            if blank(slot) && !blank(from) {
                slot.clone_from(from);
            }
        };
        // The ISBN can legitimately be absent on one side and present on the
        // other: a Hardcover *search* document lists a work's ISBNs without
        // tying one to an edition, while the record its detail lookup returns
        // does. Filling — rather than leaving the hydrated record bare — is
        // what stops a re-fetch from erasing an identifier the list row had.
        fill(&mut self.isbn13, &thinner.isbn13);
        fill(&mut self.isbn10, &thinner.isbn10);
        fill(&mut self.year, &thinner.year);
        fill(&mut self.publisher, &thinner.publisher);
        fill(&mut self.description, &thinner.description);
        fill(&mut self.cover_url, &thinner.cover_url);
        fill(&mut self.series, &thinner.series);
        // A book number is a position *in* a series, so it may only cross
        // over when both records name the same one. A provider that files a
        // book under two series can answer two queries in two row orders, and
        // pairing one series' name with another's number is worse than
        // reporting no number at all — the invariant Hardcover's
        // `series_statement` protects within a single response.
        let same = |a: &Option<String>, b: &Option<String>| {
            let key = |v: &Option<String>| v.as_deref().unwrap_or_default().trim().to_string();
            key(a) == key(b)
        };
        if same(&self.series, &thinner.series) {
            fill(&mut self.series_index, &thinner.series_index);
        }
        if self.title.trim().is_empty() {
            self.title.clone_from(&thinner.title);
        }
        if self.authors.is_empty() {
            self.authors.clone_from(&thinner.authors);
        }
        if self.pages.is_none() {
            self.pages = thinner.pages;
        }
        if self.first_publish_year.is_none() {
            self.first_publish_year = thinner.first_publish_year;
        }
        if self.genres.is_empty() {
            self.genres.clone_from(&thinner.genres);
        }
    }
}

/// A [`ProviderEdition`] that names no ISBN-13 cannot become an
/// [`ExternalBookMeta`]. Not a general failure: the picker is *expected* to
/// surface such candidates and the check-in path to skip them, rather than put
/// an empty ISBN on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoIsbn;

impl std::fmt::Display for NoIsbn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("provider candidate carries no ISBN-13")
    }
}

impl std::error::Error for NoIsbn {}

impl TryFrom<ProviderEdition> for ExternalBookMeta {
    type Error = NoIsbn;

    /// Narrow a search candidate to the check-in payload, dropping the fields that
    /// type doesn't carry (`provider_ref`, `isbn10`, `series_index`, `relevance`,
    /// `genres`) and leaving `format` for the provider that knows it to fill. Fails with [`NoIsbn`] when the candidate has none: check-in stores
    /// the ISBN per physical copy and the iOS client decodes `isbn13` as a
    /// non-optional `String`, so a blank would break it.
    fn try_from(e: ProviderEdition) -> Result<Self, Self::Error> {
        Ok(Self {
            isbn13: e.isbn13.ok_or(NoIsbn)?,
            title: e.title,
            authors: e.authors,
            year: e.year,
            pages: e.pages,
            publisher: e.publisher,
            description: e.description,
            cover_url: e.cover_url,
            series: e.series,
            first_publish_year: e.first_publish_year,
            format: None,
            source: e.source,
        })
    }
}

/// What one provider did for an edition search. `kind` tells apart a provider that had
/// nothing, one the server didn't ask, and one that didn't answer, so an outage never
/// looks like an empty result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub enum ProviderSearchStatus {
    /// The provider answered. `count` is how many of its results are in the returned
    /// list, after the server's cap.
    Answered { count: usize },
    /// The provider needs an API key this server doesn't have. The server didn't ask it.
    NotConfigured,
    // `message` is the provider call's own top-level context, never the error chain
    // below it, which is where a request URL, and so a `?key=`, would render.
    /// The server asked, but no answer came back. `message` says what failed.
    Failed { message: String },
    /// The provider limited the server's request rate recently, so the server didn't ask
    /// it this time. `retry_after_secs` says when to try again.
    Throttled {
        /// Whole seconds left on the cooldown, rounded up.
        retry_after_secs: u64,
    },
}

/// What one provider, named, did for an edition search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ProviderSearchSource {
    pub provider: MetadataProvider,
    pub display_name: String,
    pub status: ProviderSearchStatus,
}

/// An edition search across the metadata providers, for
/// `POST /api/metadata/editions/search`. At least one of `query`, `title`, `author` or
/// `isbn` must hold text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EditionSearchRequest {
    /// The search as free text, up to 200 characters. A client may send only this.
    pub query: String,
    // Open Library searches the author's name inside the title field if handed one
    // flattened string, hence the separate fields.
    /// The book's title on its own, up to 200 characters, when the client can separate
    /// it from the author. Each provider then gets the title and author in the fields it
    /// expects. When it is left out, the server treats `query` as the title, with no
    /// author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The book's main author, up to 200 characters, to go with `title`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// An ISBN the client already has for the book, in any format, up to 32 characters.
    /// The server normalizes it and ignores an invalid one. It is the strongest match
    /// signal a search can carry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    /// The providers to ask. When it is left out, the server asks every configured
    /// provider. An empty list is refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub providers: Option<Vec<MetadataProvider>>,
}

impl EditionSearchRequest {
    /// Maximum length of the supplied `isbn`. An ISBN-13 with separators is
    /// 17 characters; this leaves room for stray whitespace without letting
    /// an unbounded blob through to `normalize_isbn`.
    pub const ISBN_MAX_LEN: usize = 32;

    /// Reject a request that asks *nothing*, an oversized field, and an
    /// explicitly-empty provider list (which would search nothing and look like an
    /// outage). "Asks nothing" means every field is blank, not just `query`: an
    /// ISBN-only search has no free text. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        let blank = |v: &Option<String>| v.as_deref().is_none_or(|s| s.trim().is_empty());
        if self.query.trim().is_empty()
            && blank(&self.title)
            && blank(&self.author)
            && blank(&self.isbn)
        {
            return Err("a title, author, or ISBN is required".into());
        }
        if self.query.chars().count() > SEARCH_QUERY_MAX_LEN {
            return Err(format!("query exceeds {SEARCH_QUERY_MAX_LEN} characters"));
        }
        if self.providers.as_ref().is_some_and(|p| p.is_empty()) {
            return Err("providers must name at least one provider when supplied".into());
        }
        // The structured fields ride the same request and reach the same
        // outbound URLs, so they get the same cap. Blank is allowed and means
        // absent — a client clearing an empty form field shouldn't 400.
        for (name, value) in [("title", &self.title), ("author", &self.author)] {
            if value
                .as_ref()
                .is_some_and(|v| v.chars().count() > SEARCH_QUERY_MAX_LEN)
            {
                return Err(format!("{name} exceeds {SEARCH_QUERY_MAX_LEN} characters"));
            }
        }
        if self
            .isbn
            .as_ref()
            .is_some_and(|v| v.chars().count() > Self::ISBN_MAX_LEN)
        {
            return Err(format!("isbn exceeds {} characters", Self::ISBN_MAX_LEN));
        }
        Ok(())
    }
}

// Omnibus never parses `provider_ref`, so it is capped rather than validated for
// shape.
/// One edition to fetch in full from its provider, for
/// `POST /api/metadata/editions/hydrate`. Send `source` and `provider_ref` exactly as
/// the edition search returned them. `provider_ref` may be up to 256 bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EditionHydrateRequest {
    pub source: MetadataProvider,
    pub provider_ref: String,
    /// The edition's ISBN-13, when it has one. The server prefers it to `provider_ref`,
    /// because an ISBN names one printing where a handle may name a whole work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn13: Option<String>,
}

impl EditionHydrateRequest {
    /// Maximum byte length of an accepted `provider_ref`. Generous against
    /// the longest handle any provider mints (an Open Library work key runs
    /// to a couple of dozen chars) and small enough that an unbounded blob
    /// can't ride in on it.
    pub const PROVIDER_REF_MAX_LEN: usize = 256;

    /// Reject a blank or oversized handle. The ISBN itself is validated by
    /// `normalize_isbn` further down, where a bad check digit reports the
    /// specific failure — and where a bad one is *discarded* rather than
    /// fatal, since the handle alone is enough to re-fetch by. Handlers
    /// translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.provider_ref.trim().is_empty() {
            return Err("provider_ref is required".into());
        }
        if self.provider_ref.len() > Self::PROVIDER_REF_MAX_LEN {
            return Err(format!(
                "provider_ref exceeds {} bytes",
                Self::PROVIDER_REF_MAX_LEN
            ));
        }
        if self
            .isbn13
            .as_ref()
            .is_some_and(|v| v.chars().count() > EditionSearchRequest::ISBN_MAX_LEN)
        {
            return Err(format!(
                "isbn13 exceeds {} characters",
                EditionSearchRequest::ISBN_MAX_LEN
            ));
        }
        Ok(())
    }
}

/// The results of an edition search: every edition the providers returned, and one
/// status per provider considered, including any the server skipped and any that
/// failed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EditionSearchResponse {
    pub editions: Vec<ProviderEdition>,
    pub sources: Vec<ProviderSearchSource>,
}

#[cfg(test)]
mod tests;
