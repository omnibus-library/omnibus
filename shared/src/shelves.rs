//! Shelf wire types shared between web (`#[server]`) and mobile (`reqwest`). A
//! shelf is a named library subset: **smart** (membership from a `field op
//! value` rule over normalized metadata) or **manual** (an explicit, ordered
//! book list). The condition shape (`RuleField` / `RuleOp` / `ShelfRule`) is
//! defined once here so advanced search can reuse it.

use serde::{Deserialize, Serialize};

use crate::{EbookMetadata, SortDir, SortKey, ViewFilters};

/// Max length of a shelf name (matches the create-modal input expectation).
pub const SHELF_NAME_MAX_LEN: usize = 120;

/// Max length of a shelf description.
pub const SHELF_DESCRIPTION_MAX_LEN: usize = 2048;

/// Max length of a smart-rule condition value. Rule values are short strings
/// (a tag/author/series name, a rating, a date window), never free text.
pub const SHELF_RULE_VALUE_MAX_LEN: usize = 512;

/// Max number of book uuids accepted in one create/add-books request. Bulk
/// membership writes chunk the DB insert, but the request itself still needs
/// a cap so an unbounded array can't force a large batch before rejection.
pub const MAX_SHELF_BOOK_UUIDS: usize = 2000;

/// Max number of smart-rule conditions accepted in one create/preview
/// request. Each rule's `value` is capped individually; this bounds the
/// count so a request can't force an unbounded per-rule validation pass.
pub const MAX_PREVIEW_RULES: usize = 50;

/// The kind of a shelf, fixed when it is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ShelfKind {
    Smart,
    Manual,
    // Membership derives from `wishlist_entries`, not `shelf_books`.
    /// The built-in physical wishlist, one per user. Its books are the user's wishlist
    /// entries. It is public, and it can't be renamed, deleted or reconfigured.
    Wishlist,
}

impl ShelfKind {
    /// A system shelf the user cannot rename, delete, or reconfigure. Its
    /// membership is derived, and every mutation endpoint rejects it.
    pub fn is_system(self) -> bool {
        matches!(self, ShelfKind::Wishlist)
    }
}

/// Who can see a shelf. `private` means its owner and admins. `public` means every user.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    #[default]
    Private,
    Public,
}

/// How a smart shelf combines its conditions. `any` matches a book that meets at least
/// one. `all` matches a book that meets every one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    Any,
    All,
}

// Mirrors the advanced-search query vocabulary plus the acquisition-date fields.
/// A field a smart shelf condition can match on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum RuleField {
    Tag,
    /// Genres assigned in Omnibus. Book files never supply them.
    Genre,
    Author,
    Series,
    Rating,
    /// The shelf owner's read status: `unread`, `reading` or `finished`. A book the
    /// owner never marked counts as `unread`.
    Status,
    Format,
    Year,
    /// When the book was first added to the library.
    DateAdded,
    /// When the book's file or its edited metadata last changed.
    DateUpdated,
}

/// A comparison operator for a smart shelf condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum RuleOp {
    Is,
    IsNot,
    /// Contains the value, ignoring case. For text fields.
    Contains,
    /// Starts with the value, ignoring case. For text fields.
    StartsWith,
    /// Is at least the value. For `rating` and `year`.
    Gte,
    /// Has a file in the format. For `format`.
    Includes,
    /// Falls within a recent stretch of time, such as `30d`, `2w`, `3m` or `1y`.
    InLast,
    /// Falls between two dates, both included, written `START..END`.
    Between,
    Before,
    After,
}

macro_rules! wire_enum {
    ($ty:ty, $($variant:path => $token:literal),+ $(,)?) => {
        impl $ty {
            /// Stable DB/wire token.
            pub fn as_str(self) -> &'static str {
                match self { $($variant => $token),+ }
            }
            /// Parse from a DB/wire token; `None` if unrecognized. Named
            /// `from_str` for symmetry with `as_str` — it is not the fallible
            /// `FromStr` trait (no `Err` payload), hence the allow.
            #[allow(clippy::should_implement_trait)]
            pub fn from_str(s: &str) -> Option<Self> {
                Some(match s { $($token => $variant),+, _ => return None })
            }
        }
    };
}

wire_enum!(
    ShelfKind,
    ShelfKind::Smart => "smart",
    ShelfKind::Manual => "manual",
    ShelfKind::Wishlist => "wishlist",
);
wire_enum!(Visibility, Visibility::Private => "private", Visibility::Public => "public");
wire_enum!(MatchMode, MatchMode::Any => "any", MatchMode::All => "all");
wire_enum!(
    RuleField,
    RuleField::Tag => "tag",
    RuleField::Genre => "genre",
    RuleField::Author => "author",
    RuleField::Series => "series",
    RuleField::Rating => "rating",
    RuleField::Status => "status",
    RuleField::Format => "format",
    RuleField::Year => "year",
    RuleField::DateAdded => "date_added",
    RuleField::DateUpdated => "date_updated",
);
wire_enum!(
    RuleOp,
    RuleOp::Is => "is",
    RuleOp::IsNot => "is_not",
    RuleOp::Contains => "contains",
    RuleOp::StartsWith => "starts_with",
    RuleOp::Gte => "gte",
    RuleOp::Includes => "includes",
    RuleOp::InLast => "in_last",
    RuleOp::Between => "between",
    RuleOp::Before => "before",
    RuleOp::After => "after",
);

impl RuleField {
    /// `true` if `op` is valid for this field.
    pub fn accepts(self, op: RuleOp) -> bool {
        use RuleField::*;
        use RuleOp::*;
        let ok: &[RuleOp] = match self {
            Tag | Genre | Author | Series => &[Is, IsNot, Contains, StartsWith],
            Rating => &[Is, Gte],
            Status => &[Is],
            Format => &[Includes, Contains, StartsWith],
            Year => &[Is, Gte],
            DateAdded | DateUpdated => &[InLast, Between, Before, After],
        };
        ok.contains(&op)
    }

    /// `true` for the two acquisition-date fields (owner-agnostic, library-global).
    pub fn is_date(self) -> bool {
        matches!(self, RuleField::DateAdded | RuleField::DateUpdated)
    }

    /// `true` for fields resolved against the shelf owner's per-user data.
    pub fn is_per_user(self) -> bool {
        matches!(self, RuleField::Rating | RuleField::Status)
    }
}

// The source of truth for `value`: migration `0034`'s comment is frozen and
// predates the switch from ids to names. `RuleField::accepts` holds the op table.
/// One smart shelf condition. What `value` holds, and which `op` values work, depend on
/// `field`:
///
/// - `tag`, `genre`, `author`, `series`: a name, matched ignoring case, with `is`,
///   `is_not`, `contains` or `starts_with`.
/// - `format`: a format name such as `epub`, with `includes`, `contains` or
///   `starts_with`.
/// - `rating`: a star rating from 0.5 to 5, with `is` or `gte`.
/// - `year`: a year, with `is` or `gte`.
/// - `status`: `unread`, `reading` or `finished`, with `is`.
/// - `date_added`, `date_updated`: a window such as `30d`, `2w`, `3m` or `1y` with
///   `in_last`, a `START..END` range of `YYYY-MM-DD` dates with `between`, or one
///   `YYYY-MM-DD` date with `before` or `after`.
///
/// `value` may be up to 512 characters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ShelfRule {
    pub field: RuleField,
    pub op: RuleOp,
    pub value: String,
}

impl ShelfRule {
    /// Reject an op the field doesn't accept or an empty value.
    pub fn validate(&self) -> Result<(), String> {
        if !self.field.accepts(self.op) {
            return Err(format!(
                "operator {} is not valid for field {}",
                self.op.as_str(),
                self.field.as_str()
            ));
        }
        if self.value.trim().is_empty() {
            return Err("condition value is required".into());
        }
        if self.value.chars().count() > SHELF_RULE_VALUE_MAX_LEN {
            return Err(format!(
                "condition value must be ≤ {SHELF_RULE_VALUE_MAX_LEN} characters"
            ));
        }
        Ok(())
    }
}

/// A shelf in a list of shelves: who owns it, its kind, visibility, accent color and
/// book count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ShelfSummary {
    pub id: i64,
    pub owner_user_id: i64,
    /// The owner's display name, or their username when they have none.
    pub owner_username: String,
    // `default` keeps payloads from older servers deserializable.
    /// Whether the owner has an avatar at `GET /api/users/{owner_user_id}/avatar`.
    #[serde(default)]
    pub owner_has_avatar: bool,
    pub kind: ShelfKind,
    pub name: String,
    pub visibility: Visibility,
    pub accent: Option<String>,
    pub book_count: i64,
    // `default` keeps payloads from older servers deserializable.
    /// The uuids of up to four of the shelf's books that have covers, in the shelf's
    /// order.
    #[serde(default)]
    pub cover_uuids: Vec<String>,
}

/// A shelf in full, with its description, conditions and match mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Shelf {
    pub id: i64,
    pub owner_user_id: i64,
    /// The owner's display name, or their username when they have none.
    pub owner_username: String,
    /// Whether the owner has an avatar at `GET /api/users/{owner_user_id}/avatar`.
    #[serde(default)]
    pub owner_has_avatar: bool,
    pub kind: ShelfKind,
    pub name: String,
    pub description: Option<String>,
    pub visibility: Visibility,
    pub accent: Option<String>,
    /// How the conditions combine. Set for a smart shelf, null for any other kind.
    pub match_mode: Option<MatchMode>,
    pub rules: Vec<ShelfRule>,
    pub book_count: i64,
    /// Whether the owner's sync devices (Kobos and KOReaders) sync this shelf's books. Off
    /// by default. A device syncs only books on shelves with this on, never the whole
    /// library.
    #[serde(default)]
    pub sync_to_kobo: bool,
}

/// A new shelf. A `smart` shelf needs `match_mode` and at least one rule, and takes no
/// `book_uuids`. A `manual` shelf takes no `match_mode` or rules, and may start with
/// `book_uuids`. A `wishlist` shelf can't be created. `name` is 1 to 120 characters and
/// `description` at most 2048.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateShelfRequest {
    pub kind: ShelfKind,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default)]
    pub match_mode: Option<MatchMode>,
    #[serde(default)]
    pub rules: Vec<ShelfRule>,
    #[serde(default)]
    pub book_uuids: Vec<String>,
}

impl CreateShelfRequest {
    /// Validate name + kind-specific invariants. Handlers translate `Err(_)`
    /// into a 400/422.
    pub fn validate(&self) -> Result<(), String> {
        validate_name(&self.name)?;
        validate_description(&self.description)?;
        validate_book_uuids(&self.book_uuids)?;
        match self.kind {
            ShelfKind::Smart => {
                if self.match_mode.is_none() {
                    return Err("smart shelves need a match mode".into());
                }
                if self.rules.is_empty() {
                    return Err("smart shelves need at least one condition".into());
                }
                if !self.book_uuids.is_empty() {
                    return Err("smart shelves cannot have hand-picked books".into());
                }
                validate_rule_count(&self.rules)?;
                for r in &self.rules {
                    r.validate()?;
                }
            }
            ShelfKind::Manual => {
                if !self.rules.is_empty() || self.match_mode.is_some() {
                    return Err("manual shelves cannot have rules".into());
                }
            }
            // The Wishlist shelf is system-provisioned, never created via the
            // API — reject an attempt to forge one.
            ShelfKind::Wishlist => {
                return Err("the Wishlist shelf cannot be created manually".into());
            }
        }
        Ok(())
    }
}

/// Changes to a shelf. A field left out or null stays as it is. `rules` replaces every
/// condition, and applies to smart shelves only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateShelfRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: Option<Visibility>,
    #[serde(default)]
    pub match_mode: Option<MatchMode>,
    #[serde(default)]
    pub rules: Option<Vec<ShelfRule>>,
    /// Turns device sync for the shelf on or off.
    #[serde(default)]
    pub sync_to_kobo: Option<bool>,
}

impl UpdateShelfRequest {
    /// Validate any present fields.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(name) = &self.name {
            validate_name(name)?;
        }
        validate_description(&self.description)?;
        if let Some(rules) = &self.rules {
            for r in rules {
                r.validate()?;
            }
        }
        Ok(())
    }
}

/// How many books a set of conditions matches, out of the `total` in the library, with
/// up to 12 of the matches as a sample.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct RulePreview {
    pub matched: i64,
    pub total: i64,
    pub sample: Vec<EbookMetadata>,
}

/// Conditions to try with `POST /api/shelves/preview` without saving a shelf, at most
/// 50.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RulePreviewRequest {
    pub match_mode: MatchMode,
    pub rules: Vec<ShelfRule>,
}

impl RulePreviewRequest {
    /// Reject more than [`MAX_PREVIEW_RULES`] conditions, then each rule
    /// itself. Handlers translate `Err(_)` into a 400/422.
    pub fn validate(&self) -> Result<(), String> {
        validate_rule_count(&self.rules)?;
        for r in &self.rules {
            r.validate()?;
        }
        Ok(())
    }
}

/// A shelf's books, all in one response, up to 50,000.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ShelfPage {
    pub books: Vec<EbookMetadata>,
}

/// Body of `POST /api/shelves/{id}/books`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AddBooksRequest {
    /// The uuids of the books to add, up to 2000.
    pub book_uuids: Vec<String>,
}

impl AddBooksRequest {
    /// Reject an over-long or malformed book uuid list before any DB round trip.
    pub fn validate(&self) -> Result<(), String> {
        validate_book_uuids(&self.book_uuids)
    }
}

/// Query parameters of `GET /api/shelves/{id}/page`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ShelfPageQuery {
    /// The order to list a smart shelf's books in. Defaults to `recently_interacted`, as
    /// does a value the server doesn't know. A hand-picked shelf keeps its own order.
    #[cfg_attr(feature = "openapi", param(value_type = Option<SortKey>))]
    pub sort: Option<String>,
    /// `asc` or `desc`. Any other value, or none, means `desc`. A hand-picked shelf
    /// ignores it.
    #[cfg_attr(feature = "openapi", param(value_type = Option<SortDir>))]
    pub dir: Option<String>,
    /// Filter clauses as a percent-encoded JSON array, in the same form as `filter` on
    /// `GET /api/ebooks`.
    pub filter: Option<String>,
}

impl ShelfPageQuery {
    /// The parsed `filter`, or the reason it doesn't parse.
    pub fn filters(&self) -> Result<ViewFilters, String> {
        match self.filter.as_deref() {
            Some(raw) => ViewFilters::from_query_param(raw),
            None => Ok(ViewFilters::default()),
        }
    }

    /// The requested sort, falling back to [`SortKey::RecentlyInteracted`].
    pub fn sort_key(&self) -> SortKey {
        self.sort
            .as_deref()
            .and_then(SortKey::from_wire)
            .unwrap_or(SortKey::RecentlyInteracted)
    }

    /// The requested direction, falling back to [`SortDir::Desc`].
    pub fn sort_dir(&self) -> SortDir {
        match self.dir.as_deref() {
            Some("asc") => SortDir::Asc,
            _ => SortDir::Desc,
        }
    }
}

/// Reject an over-long list of book uuids, or any uuid string itself over
/// [`crate::BOOK_UUID_MAX_LEN`], before a DB round trip. Shared by
/// `CreateShelfRequest::validate`, the REST `AddBooksRequest`, and
/// `rpc_add_shelf_books`.
pub fn validate_book_uuids(uuids: &[String]) -> Result<(), String> {
    if uuids.len() > MAX_SHELF_BOOK_UUIDS {
        return Err(format!(
            "cannot submit more than {MAX_SHELF_BOOK_UUIDS} book uuids at once"
        ));
    }
    for uuid in uuids {
        if uuid.len() > crate::BOOK_UUID_MAX_LEN {
            return Err(format!(
                "book uuid must be ≤ {} bytes",
                crate::BOOK_UUID_MAX_LEN
            ));
        }
    }
    Ok(())
}

/// Reject more than [`MAX_PREVIEW_RULES`] conditions before validating each
/// one. Shared by `RulePreviewRequest::validate`, `CreateShelfRequest::validate`,
/// and `rpc_preview_shelf_rule`.
pub fn validate_rule_count(rules: &[ShelfRule]) -> Result<(), String> {
    if rules.len() > MAX_PREVIEW_RULES {
        return Err(format!(
            "cannot submit more than {MAX_PREVIEW_RULES} conditions at once"
        ));
    }
    Ok(())
}

/// Reject an empty or over-long shelf name.
fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("shelf name is required".into());
    }
    if trimmed.chars().count() > SHELF_NAME_MAX_LEN {
        return Err(format!(
            "shelf name must be ≤ {SHELF_NAME_MAX_LEN} characters"
        ));
    }
    Ok(())
}

/// Reject an over-long shelf description. `None` is always permitted.
fn validate_description(description: &Option<String>) -> Result<(), String> {
    if let Some(description) = description {
        if description.chars().count() > SHELF_DESCRIPTION_MAX_LEN {
            return Err(format!(
                "shelf description must be ≤ {SHELF_DESCRIPTION_MAX_LEN} characters"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
