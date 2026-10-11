//! Library filter clauses: the persisted, per-library filter a reader builds
//! on All Books and shelves, shared by the web UI, the REST listing and the
//! db filter engine. Values OR within a clause; clauses AND together.

use serde::{Deserialize, Serialize};

use crate::ebook::EbookMetadata;
use crate::shelves::SHELF_RULE_VALUE_MAX_LEN;

#[cfg(test)]
mod tests;

/// The book attribute a [`FilterClause`] matches against. A `Shelf` value is a
/// shelf id as a decimal string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterField {
    Tag,
    Genre,
    Author,
    Series,
    Format,
    Shelf,
}

/// Most clauses a [`ViewFilters`] may carry.
pub const MAX_FILTER_CLAUSES: usize = 16;

/// Most values one [`FilterClause`] may list.
pub const MAX_FILTER_VALUES: usize = 64;

/// Whether a clause keeps the books that match it or drops them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    Include,
    Exclude,
}

/// One clause: its values OR together; a filter's clauses AND together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilterClause {
    pub field: FilterField,
    pub mode: FilterMode,
    pub values: Vec<String>,
}

impl FilterClause {
    /// A clause matching `field` against `values` in the given `mode`.
    pub fn new(field: FilterField, mode: FilterMode, values: &[&str]) -> Self {
        Self {
            field,
            mode,
            values: values.iter().map(|v| v.to_string()).collect(),
        }
    }

    /// The values that can match: trimmed, blanks dropped.
    pub fn usable_values(&self) -> impl Iterator<Item = &str> {
        self.values
            .iter()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
    }
}

/// Active library filter: a clause list whose clauses AND together.
///
/// A record persisted before `clauses` existed carried one include-only facet
/// list per field; deserializing folds those into include clauses so it still
/// loads. Serializing writes `clauses` alone.
///
/// Format values are stored lowercase (`"epub"`, `"m4b"`) since the underlying
/// `EbookMetadata.formats` strings vary in case across sources.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ViewFiltersWire")]
pub struct ViewFilters {
    pub clauses: Vec<FilterClause>,
}

/// Every key a stored or posted filter has ever carried.
#[derive(Deserialize)]
struct ViewFiltersWire {
    #[serde(default)]
    clauses: Vec<FilterClause>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    series: Vec<String>,
    #[serde(default)]
    formats: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    genres: Vec<String>,
}

impl From<ViewFiltersWire> for ViewFilters {
    /// One include clause per non-empty legacy facet (author, series, format,
    /// tag, genre), then `clauses` verbatim.
    fn from(wire: ViewFiltersWire) -> Self {
        let legacy = [
            (FilterField::Author, wire.authors),
            (FilterField::Series, wire.series),
            (FilterField::Format, wire.formats),
            (FilterField::Tag, wire.tags),
            (FilterField::Genre, wire.genres),
        ];
        let clauses = legacy
            .into_iter()
            .filter(|(_, values)| !values.is_empty())
            .map(|(field, values)| FilterClause {
                field,
                mode: FilterMode::Include,
                values,
            })
            .chain(wire.clauses)
            .collect();
        Self { clauses }
    }
}

impl ViewFilters {
    /// `true` when there is no clause.
    pub fn is_empty(&self) -> bool {
        self.clauses.is_empty()
    }

    /// Whether `book` passes every clause, over metadata with overrides already
    /// merged. A clause it can decide rules a book out even when a shelf clause
    /// is present; `None` when the rest pass and a shelf clause remains, since
    /// membership is the server's to answer and a guess would read as fact.
    pub fn matches(&self, book: &EbookMetadata) -> Option<bool> {
        let mut undecided = false;
        for clause in &self.clauses {
            match clause_matches(clause, book) {
                Some(false) => return Some(false),
                Some(true) => {}
                None => undecided = true,
            }
        }
        (!undecided).then_some(true)
    }

    /// Reject filters over the clause or value caps, or a clause no book could
    /// be matched by.
    pub fn validate(&self) -> Result<(), String> {
        if self.clauses.len() > MAX_FILTER_CLAUSES {
            return Err(format!(
                "a filter may have at most {MAX_FILTER_CLAUSES} clauses"
            ));
        }
        self.clauses.iter().try_for_each(validate_clause)
    }

    /// The `?filter=` value: a JSON array of [`FilterClause`], `None` when empty.
    /// Not percent-encoded.
    pub fn to_query_param(&self) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        serde_json::to_string(&self.clauses).ok()
    }

    /// Parse and validate a `?filter=` value.
    pub fn from_query_param(raw: &str) -> Result<ViewFilters, String> {
        let clauses: Vec<FilterClause> = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        let filters = ViewFilters { clauses };
        filters.validate()?;
        Ok(filters)
    }
}

/// Mirrors the db engine: values are trimmed, compared ASCII-case-insensitively,
/// and a clause with no usable value matches every book.
fn clause_matches(clause: &FilterClause, book: &EbookMetadata) -> Option<bool> {
    if clause.field == FilterField::Shelf {
        return None;
    }
    if clause.usable_values().next().is_none() {
        return Some(true);
    }
    let carries_one = clause
        .usable_values()
        .any(|wanted| holds(book, clause.field, wanted));
    Some(carries_one == (clause.mode == FilterMode::Include))
}

/// Whether `book` carries `wanted` under `field`. Always `false` for a shelf,
/// which the book alone can't answer; `clause_matches` settles that first.
fn holds(book: &EbookMetadata, field: FilterField, wanted: &str) -> bool {
    let is_wanted = |held: &str| held.eq_ignore_ascii_case(wanted);
    match field {
        FilterField::Tag => book.subjects.iter().any(|v| is_wanted(v)),
        FilterField::Genre => book.genres.iter().any(|v| is_wanted(v)),
        FilterField::Format => book.formats.iter().any(|v| is_wanted(v)),
        FilterField::Author => book.creators.iter().any(|c| is_wanted(&c.name)),
        FilterField::Series => book.series.as_deref().is_some_and(is_wanted),
        FilterField::Shelf => false,
    }
}

fn validate_clause(clause: &FilterClause) -> Result<(), String> {
    if clause.values.is_empty() {
        return Err("a filter clause needs at least one value".into());
    }
    if clause.values.len() > MAX_FILTER_VALUES {
        return Err(format!(
            "a filter clause may have at most {MAX_FILTER_VALUES} values"
        ));
    }
    clause
        .values
        .iter()
        .try_for_each(|value| validate_value(clause.field, value))
}

fn validate_value(field: FilterField, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("a filter value must not be blank".into());
    }
    if value.chars().count() > SHELF_RULE_VALUE_MAX_LEN {
        return Err(format!(
            "a filter value must be ≤ {SHELF_RULE_VALUE_MAX_LEN} characters"
        ));
    }
    if field == FilterField::Shelf && value.trim().parse::<i64>().is_err() {
        return Err("a shelf filter value must be a shelf id".into());
    }
    Ok(())
}
