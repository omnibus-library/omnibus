//! Library filter clauses → SQL: each [`FilterClause`] becomes an `IN`/`NOT IN`
//! over the smart-rule engine's per-field membership, so a filtered page and a
//! smart shelf rule on the same value always agree. Used by the keyset page.

use omnibus_shared::{FilterClause, FilterField, FilterMode, RuleField, ViewFilters};

use super::rules::name_membership;
pub(crate) use super::rules::{Bind, Predicate};

/// `Predicate.sql` when no clause applies.
pub(crate) const MATCH_ALL: &str = "1";

/// AND the clauses of `filters` into one boolean expression over `books b`.
/// Values OR within a clause; a clause with no usable value is skipped.
pub(crate) fn filter_predicate(filters: &ViewFilters) -> Predicate {
    let mut parts = Vec::new();
    let mut binds = Vec::new();
    for clause in filters.effective_clauses() {
        if let Some((sql, mut clause_binds)) = clause_sql(&clause) {
            parts.push(sql);
            binds.append(&mut clause_binds);
        }
    }
    let sql = if parts.is_empty() {
        MATCH_ALL.to_string()
    } else {
        parts.join(" AND ")
    };
    Predicate { sql, binds }
}

fn clause_sql(clause: &FilterClause) -> Option<(String, Vec<Bind>)> {
    let values: Vec<&str> = clause
        .values
        .iter()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .collect();
    if values.is_empty() {
        return None;
    }
    let (members, col) = name_membership(rule_field(clause.field))?;
    let placeholders = vec!["?"; values.len()].join(", ");
    let not = match clause.mode {
        FilterMode::Include => "",
        FilterMode::Exclude => "NOT ",
    };
    let sql = format!("b.id {not}IN ({members}{col} COLLATE NOCASE IN ({placeholders}))");
    let binds = values
        .into_iter()
        .map(|v| Bind::Text(v.to_string()))
        .collect();
    Some((sql, binds))
}

fn rule_field(field: FilterField) -> RuleField {
    match field {
        FilterField::Tag => RuleField::Tag,
        FilterField::Genre => RuleField::Genre,
        FilterField::Author => RuleField::Author,
        FilterField::Series => RuleField::Series,
        FilterField::Format => RuleField::Format,
    }
}
