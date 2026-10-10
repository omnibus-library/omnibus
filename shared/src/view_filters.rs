//! Library filter clauses: the persisted, per-library filter a reader builds
//! on All Books and shelves, shared by the web UI, the REST listing and the
//! db filter engine. Values OR within a clause; clauses AND together.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// The book attribute a [`FilterClause`] matches against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterField {
    Tag,
    Genre,
    Author,
    Series,
    Format,
}

/// Most clauses a [`ViewFilters`] may carry, legacy facets included.
pub const MAX_FILTER_CLAUSES: usize = 16;

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

/// Active library filter. The legacy facet lists are include-only and stay
/// readable so a record persisted before `clauses` existed still loads.
///
/// Format values are stored lowercase (`"epub"`, `"m4b"`) since the underlying
/// `EbookMetadata.formats` strings vary in case across sources.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ViewFilters {
    #[serde(default)]
    pub clauses: Vec<FilterClause>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub series: Vec<String>,
    #[serde(default)]
    pub formats: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub genres: Vec<String>,
}

impl ViewFilters {
    /// `true` when neither a clause nor a legacy facet has a value.
    pub fn is_empty(&self) -> bool {
        self.clauses.is_empty()
            && self.authors.is_empty()
            && self.series.is_empty()
            && self.formats.is_empty()
            && self.tags.is_empty()
            && self.genres.is_empty()
    }

    /// Legacy facets as include clauses (author, series, format, tag, genre),
    /// then `clauses` verbatim.
    pub fn effective_clauses(&self) -> Vec<FilterClause> {
        let legacy = [
            (FilterField::Author, &self.authors),
            (FilterField::Series, &self.series),
            (FilterField::Format, &self.formats),
            (FilterField::Tag, &self.tags),
            (FilterField::Genre, &self.genres),
        ];
        legacy
            .into_iter()
            .filter(|(_, values)| !values.is_empty())
            .map(|(field, values)| FilterClause {
                field,
                mode: FilterMode::Include,
                values: values.clone(),
            })
            .chain(self.clauses.iter().cloned())
            .collect()
    }
}
