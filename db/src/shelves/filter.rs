//! Library filter clauses → SQL: each [`FilterClause`] becomes an `IN`/`NOT IN`
//! over the smart-rule engine's per-field membership, so a filtered page and a
//! smart shelf rule on the same value always agree. A shelf clause resolves
//! only to shelves its [`Viewer`] can see. Used by the keyset page and `shelf_page`.

use omnibus_shared::{FilterClause, FilterField, FilterMode, RuleField, ViewFilters};

use super::rules::name_membership;
pub(crate) use super::rules::{Bind, Predicate};

/// `Predicate.sql` when no clause applies.
pub(crate) const MATCH_ALL: &str = "1";

/// The reader a filter is evaluated for: a shelf value resolves only to a shelf this viewer can see.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Viewer {
    pub user_id: i64,
    pub is_admin: bool,
}

/// AND the clauses of `filters` into one boolean expression over `books b`.
/// Values OR within a clause; a clause with no usable value is skipped.
pub(crate) fn filter_predicate(filters: &ViewFilters, viewer: Viewer) -> Predicate {
    let mut parts = Vec::new();
    let mut binds = Vec::new();
    for clause in &filters.clauses {
        if let Some((sql, mut clause_binds)) = clause_sql(clause, viewer) {
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

fn clause_sql(clause: &FilterClause, viewer: Viewer) -> Option<(String, Vec<Bind>)> {
    let values: Vec<&str> = clause.usable_values().collect();
    if values.is_empty() {
        return None;
    }
    let not = match clause.mode {
        FilterMode::Include => "",
        FilterMode::Exclude => "NOT ",
    };
    match clause.field {
        FilterField::Shelf => shelf_sql(not, &values, viewer),
        FilterField::Tag => name_sql(not, RuleField::Tag, &values),
        FilterField::Genre => name_sql(not, RuleField::Genre, &values),
        FilterField::Author => name_sql(not, RuleField::Author, &values),
        FilterField::Series => name_sql(not, RuleField::Series, &values),
        FilterField::Format => name_sql(not, RuleField::Format, &values),
    }
}

/// `IN`/`NOT IN` over the smart-rule membership for a name-matched field.
fn name_sql(not: &str, field: RuleField, values: &[&str]) -> Option<(String, Vec<Bind>)> {
    let (members, col) = name_membership(field)?;
    let placeholders = vec!["?"; values.len()].join(", ");
    let sql = format!("b.id {not}IN ({members}{col} COLLATE NOCASE IN ({placeholders}))");
    let binds = values
        .iter()
        .map(|v| Bind::Text((*v).to_string()))
        .collect();
    Some((sql, binds))
}

/// `can_view` in SQL: owner, public, or admin; binds are the user id, then is-admin.
const SHELF_VISIBLE: &str = "(s.owner_user_id = ? OR s.visibility = 'public' OR ?)";

/// `IN`/`NOT IN` over the books on the listed shelves the viewer can see; values that aren't shelf ids are dropped.
fn shelf_sql(not: &str, values: &[&str], viewer: Viewer) -> Option<(String, Vec<Bind>)> {
    let ids: Vec<i64> = values.iter().filter_map(|v| v.parse().ok()).collect();
    if ids.is_empty() {
        return None;
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let sql = format!(
        "b.uuid {not}IN (SELECT sb.book_uuid FROM shelf_books sb \
         JOIN shelves s ON s.id = sb.shelf_id \
         WHERE s.id IN ({placeholders}) AND s.kind = 'manual' AND {SHELF_VISIBLE} \
         UNION \
         SELECT we.book_uuid FROM wishlist_entries we \
         JOIN shelves s ON s.owner_user_id = we.user_id AND s.kind = 'wishlist' \
         WHERE s.id IN ({placeholders}) AND {SHELF_VISIBLE})"
    );
    let arm_binds = || {
        ids.iter().map(|id| Bind::Int(*id)).chain([
            Bind::Int(viewer.user_id),
            Bind::Int(i64::from(viewer.is_admin)),
        ])
    };
    Some((sql, arm_binds().chain(arm_binds()).collect()))
}
