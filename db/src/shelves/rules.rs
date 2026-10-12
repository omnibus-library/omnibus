//! Smart-rule → SQL predicate translation: each [`ShelfRule`] becomes an
//! `EXISTS`/`IN`/comparison fragment over the `books b` alias, and the rule set
//! joins with `OR` (match any) or `AND` (match all). Per-field semantics —
//! effective tag/genre/author/series membership, owner-scoped rating/status,
//! date windows — are documented on each condition helper.

use omnibus_shared::{MatchMode, ReadStatus, RuleField, RuleOp, ShelfRule};

// The membership fragments expand the precedence and presence macros at this
// site, so those must be in scope here too.
use crate::metadata_overrides::sql::{
    effective_authors_sql, effective_genres_sql, effective_series_sql, effective_tags_sql,
    override_present_sql, overrides_win_sql,
};

use super::ShelfError;

/// A positional bind for a membership query. Owned so callers can `.bind()` by
/// value without lifetime gymnastics.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Bind {
    Text(String),
    Int(i64),
}

/// A WHERE fragment over the `books b` alias plus its ordered binds.
pub(crate) struct Predicate {
    pub sql: String,
    pub binds: Vec<Bind>,
}

/// Combine `rules` under `match_mode` into one predicate, resolving owner-scoped
/// fields against `owner_id`. Empty `rules` matches nothing (`"0"`).
pub(super) fn membership_predicate(
    rules: &[ShelfRule],
    match_mode: MatchMode,
    owner_id: i64,
) -> Result<Predicate, ShelfError> {
    if rules.is_empty() {
        return Ok(Predicate {
            sql: "0".into(),
            binds: Vec::new(),
        });
    }
    let mut parts = Vec::with_capacity(rules.len());
    let mut binds = Vec::new();
    for rule in rules {
        let (sql, mut b) = condition_sql(rule, owner_id)?;
        parts.push(sql);
        binds.append(&mut b);
    }
    let joiner = match match_mode {
        MatchMode::Any => " OR ",
        MatchMode::All => " AND ",
    };
    Ok(Predicate {
        sql: format!("({})", parts.join(joiner)),
        binds,
    })
}

/// Translate one condition into `(sql, binds)`.
fn condition_sql(rule: &ShelfRule, owner_id: i64) -> Result<(String, Vec<Bind>), ShelfError> {
    // Central op gate: the SQL arms below only handle ops the field accepts.
    if !rule.field.accepts(rule.op) {
        return Err(unsupported(rule));
    }
    let v = rule.value.trim();
    match rule.field {
        RuleField::Tag
        | RuleField::Genre
        | RuleField::Author
        | RuleField::Series
        | RuleField::Format => text_condition(rule),
        RuleField::Rating => {
            let cmp = match rule.op {
                RuleOp::Is => "=",
                RuleOp::Gte => ">=",
                _ => return Err(unsupported(rule)),
            };
            Ok((
                format!(
                    "EXISTS (SELECT 1 FROM user_ratings ur \
                     WHERE ur.book_uuid = b.uuid AND ur.user_id = ? AND ur.half_stars {cmp} ?)"
                ),
                vec![Bind::Int(owner_id), Bind::Int(parse_half_stars(v)?)],
            ))
        }
        RuleField::Year => {
            let cmp = match rule.op {
                RuleOp::Is => "=",
                RuleOp::Gte => ">=",
                _ => return Err(unsupported(rule)),
            };
            Ok((
                format!("CAST(substr(b.pubdate, 1, 4) AS INTEGER) {cmp} ?"),
                vec![Bind::Int(parse_id(v)?)],
            ))
        }
        RuleField::DateAdded | RuleField::DateUpdated => date_condition(rule, v),
        RuleField::Status => status_condition(v, owner_id),
    }
}

/// Read-state condition over the owner's `book_read_status` rows. `unread`
/// matches both an explicit `unread` row and the absence of any row (the
/// convention everywhere read state is consumed), so it is a `NOT EXISTS` over
/// the two "touched" states; `reading` / `finished` are a plain `EXISTS` on the
/// matching status. Only the `is` op reaches here (the field accepts no other).
fn status_condition(v: &str, owner_id: i64) -> Result<(String, Vec<Bind>), ShelfError> {
    let status = ReadStatus::from_str(v.trim())
        .ok_or_else(|| ShelfError::InvalidRule(format!("unknown read status {v:?}")))?;
    let sql = match status {
        ReadStatus::Unread => "NOT EXISTS (SELECT 1 FROM book_read_status rs \
             WHERE rs.book_uuid = b.uuid AND rs.user_id = ? \
               AND rs.status IN ('reading', 'finished'))"
            .to_string(),
        ReadStatus::Reading | ReadStatus::Finished => format!(
            "EXISTS (SELECT 1 FROM book_read_status rs \
             WHERE rs.book_uuid = b.uuid AND rs.user_id = ? AND rs.status = '{}')",
            status.as_str()
        ),
    };
    Ok((sql, vec![Bind::Int(owner_id)]))
}

/// Date-field conditions over `books.timestamp` / `books.last_modified`, which
/// are INTEGER unix-seconds (migration 0038): the relative-window comparison
/// stays numeric via `strftime('%s', …)`, and the absolute-date comparisons
/// render the column back to a calendar date with the `'unixepoch'` modifier.
fn date_condition(rule: &ShelfRule, v: &str) -> Result<(String, Vec<Bind>), ShelfError> {
    let col = match rule.field {
        RuleField::DateAdded => "b.timestamp",
        RuleField::DateUpdated => "b.last_modified",
        _ => unreachable!("date_condition called for non-date field"),
    };
    match rule.op {
        RuleOp::InLast => Ok((
            format!("{col} >= CAST(strftime('%s', 'now', ?) AS INTEGER)"),
            vec![Bind::Text(parse_relative_window(v)?)],
        )),
        RuleOp::Between => {
            let (start, end) = v.split_once("..").ok_or_else(|| {
                ShelfError::InvalidRule(format!("range must be START..END, got {v:?}"))
            })?;
            Ok((
                format!("date({col}, 'unixepoch') BETWEEN ? AND ?"),
                vec![
                    Bind::Text(validate_date(start)?),
                    Bind::Text(validate_date(end)?),
                ],
            ))
        }
        RuleOp::Before => Ok((
            format!("date({col}, 'unixepoch') < ?"),
            vec![Bind::Text(validate_date(v)?)],
        )),
        RuleOp::After => Ok((
            format!("date({col}, 'unixepoch') > ?"),
            vec![Bind::Text(validate_date(v)?)],
        )),
        _ => Err(unsupported(rule)),
    }
}

/// Members-select prefix (ending in `WHERE `) and compared name column for a
/// name-matched field; `None` for fields that don't match by name.
///
/// Names resolve against the normalized taxonomy `name` columns (all `COLLATE
/// NOCASE`), so the user types a name, not an id. Each reads the shared
/// effective membership the indexes and the palette count, so an override
/// moves a book on every surface at once. Uncorrelated, so the union is built
/// once per query rather than once per book.
pub(crate) fn name_membership(field: RuleField) -> Option<(&'static str, &'static str)> {
    Some(match field {
        RuleField::Tag => (
            concat!(
                "SELECT et.book_id FROM (",
                effective_tags_sql!(),
                ") et JOIN tags t ON t.id = et.tag_id WHERE "
            ),
            "t.name",
        ),
        RuleField::Genre => (
            concat!(
                "SELECT eg.book_id FROM (",
                effective_genres_sql!(),
                ") eg JOIN genres g ON g.id = eg.genre_id WHERE "
            ),
            "g.name",
        ),
        RuleField::Author => (
            concat!(
                "SELECT ea.book_id FROM (",
                effective_authors_sql!(),
                ") ea JOIN authors a ON a.id = ea.author_id WHERE "
            ),
            "a.name",
        ),
        RuleField::Series => (
            concat!(
                "SELECT es.book_id FROM (",
                effective_series_sql!(),
                ") es JOIN series s ON s.id = es.series_id WHERE "
            ),
            "s.name",
        ),
        RuleField::Format => ("SELECT bf.book_id FROM book_files bf WHERE ", "bf.format"),
        RuleField::Rating
        | RuleField::Year
        | RuleField::DateAdded
        | RuleField::DateUpdated
        | RuleField::Status => return None,
    })
}

/// Build a case-insensitive `IN`/`NOT IN` text predicate for a name-matched
/// field (see [`name_membership`]).
///
/// Equality (`is`/`is_not`/`includes`) uses `COLLATE NOCASE`;
/// `contains`/`starts_with` use `LIKE` (case-insensitive for ASCII) with
/// metacharacters escaped so user text matches literally.
fn text_condition(rule: &ShelfRule) -> Result<(String, Vec<Bind>), ShelfError> {
    let (members, col) = name_membership(rule.field).ok_or_else(|| unsupported(rule))?;
    let v = rule.value.trim();
    let (cmp, bind, negate) = match rule.op {
        RuleOp::Is | RuleOp::Includes => (
            format!("{col} = ? COLLATE NOCASE"),
            Bind::Text(v.into()),
            false,
        ),
        RuleOp::IsNot => (
            format!("{col} = ? COLLATE NOCASE"),
            Bind::Text(v.into()),
            true,
        ),
        RuleOp::Contains => (
            format!("{col} LIKE ? ESCAPE '\\'"),
            Bind::Text(format!("%{}%", like_escape(v))),
            false,
        ),
        RuleOp::StartsWith => (
            format!("{col} LIKE ? ESCAPE '\\'"),
            Bind::Text(format!("{}%", like_escape(v))),
            false,
        ),
        _ => return Err(unsupported(rule)),
    };
    let not = if negate { "NOT " } else { "" };
    Ok((format!("b.id {not}IN ({members}{cmp})"), vec![bind]))
}

/// Escape `LIKE` metacharacters (`\`, `%`, `_`) so user text matches literally.
/// Pairs with the `ESCAPE '\'` clause in [`text_condition`].
fn like_escape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn parse_id(v: &str) -> Result<i64, ShelfError> {
    v.parse::<i64>()
        .map_err(|_| ShelfError::InvalidRule(format!("expected an integer, got {v:?}")))
}

/// Parse a whole/half star value (`"4"`, `"4.5"`) into a `1..=10` half-star count.
fn parse_half_stars(v: &str) -> Result<i64, ShelfError> {
    let stars: f64 = v
        .parse()
        .map_err(|_| ShelfError::InvalidRule(format!("invalid rating {v:?}")))?;
    if !(0.5..=5.0).contains(&stars) {
        return Err(ShelfError::InvalidRule(
            "rating must be between 0.5 and 5".into(),
        ));
    }
    // The 0.5..=5.0 range check above bounds the scaled value to 1..=10, so
    // the cast cannot truncate or saturate.
    #[allow(clippy::cast_possible_truncation)]
    let half_stars = (stars * 2.0).round() as i64;
    Ok(half_stars)
}

/// Parse a relative window (`"30d"`, `"2w"`, `"3m"`, `"1y"`) into a SQLite
/// datetime modifier (`"-30 days"`).
fn parse_relative_window(v: &str) -> Result<String, ShelfError> {
    let invalid = || ShelfError::InvalidRule(format!("invalid relative window {v:?}"));
    let (num, unit) = v.split_at(v.len().checked_sub(1).ok_or_else(invalid)?);
    let n: i64 = num.parse().map_err(|_| invalid())?;
    if n <= 0 {
        return Err(ShelfError::InvalidRule("window must be positive".into()));
    }
    let unit_word = match unit {
        "d" => "days",
        "w" => "weeks",
        "m" => "months",
        "y" => "years",
        _ => return Err(invalid()),
    };
    Ok(format!("-{n} {unit_word}"))
}

/// Validate an ISO `YYYY-MM-DD` date string, returning it trimmed.
fn validate_date(v: &str) -> Result<String, ShelfError> {
    let v = v.trim();
    let ok = v.len() == 10
        && v.as_bytes().iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    if !ok {
        return Err(ShelfError::InvalidRule(format!(
            "date must be YYYY-MM-DD, got {v:?}"
        )));
    }
    Ok(v.to_string())
}

fn unsupported(rule: &ShelfRule) -> ShelfError {
    ShelfError::InvalidRule(format!(
        "operator {} is not supported for field {}",
        rule.op.as_str(),
        rule.field.as_str()
    ))
}

#[cfg(test)]
mod rule_tests {
    use super::*;

    fn rule(field: RuleField, op: RuleOp, value: &str) -> ShelfRule {
        ShelfRule {
            field,
            op,
            value: value.into(),
        }
    }

    #[test]
    fn membership_joins_with_or_for_any() {
        let p = membership_predicate(
            &[
                rule(RuleField::Tag, RuleOp::Is, "Fantasy"),
                rule(RuleField::Tag, RuleOp::Is, "Sci-fi"),
            ],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(p.sql.contains(") OR b.id IN ("), "sql was {}", p.sql);
        assert_eq!(p.binds.len(), 2);
    }

    #[test]
    fn membership_joins_with_and_for_all() {
        let p = membership_predicate(
            &[
                rule(RuleField::Tag, RuleOp::Is, "Fantasy"),
                rule(RuleField::Author, RuleOp::Is, "7"),
            ],
            MatchMode::All,
            1,
        )
        .unwrap();
        assert!(p.sql.contains(") AND b.id IN ("), "sql was {}", p.sql);
    }

    #[test]
    fn rating_binds_owner_and_half_stars() {
        let p = membership_predicate(
            &[rule(RuleField::Rating, RuleOp::Gte, "4")],
            MatchMode::Any,
            42,
        )
        .unwrap();
        assert_eq!(p.binds, vec![Bind::Int(42), Bind::Int(8)]);
    }

    #[test]
    fn relative_window_becomes_sqlite_modifier() {
        assert_eq!(parse_relative_window("30d").unwrap(), "-30 days");
        assert_eq!(parse_relative_window("3m").unwrap(), "-3 months");
        assert_eq!(parse_relative_window("1y").unwrap(), "-1 years");
        assert!(parse_relative_window("5x").is_err());
        assert!(parse_relative_window("").is_err());
    }

    #[test]
    fn between_splits_range_and_validates_dates() {
        let p = membership_predicate(
            &[rule(
                RuleField::DateAdded,
                RuleOp::Between,
                "2025-06-01..2025-08-30",
            )],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert_eq!(
            p.binds,
            vec![
                Bind::Text("2025-06-01".into()),
                Bind::Text("2025-08-30".into())
            ]
        );
        assert!(membership_predicate(
            &[rule(RuleField::DateAdded, RuleOp::Between, "2025-06-01")],
            MatchMode::Any,
            1
        )
        .is_err());
    }

    #[test]
    fn status_finished_builds_exists_bound_to_owner() {
        let p = membership_predicate(
            &[rule(RuleField::Status, RuleOp::Is, "finished")],
            MatchMode::Any,
            42,
        )
        .unwrap();
        assert!(p.sql.contains("EXISTS"), "sql was {}", p.sql);
        assert!(
            p.sql.contains("rs.status = 'finished'"),
            "sql was {}",
            p.sql
        );
        assert_eq!(p.binds, vec![Bind::Int(42)]);
    }

    #[test]
    fn status_unread_negates_the_touched_states() {
        let p = membership_predicate(
            &[rule(RuleField::Status, RuleOp::Is, "unread")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(p.sql.contains("NOT EXISTS"), "sql was {}", p.sql);
        assert!(
            p.sql.contains("('reading', 'finished')"),
            "sql was {}",
            p.sql
        );
    }

    #[test]
    fn status_rejects_unknown_value() {
        assert!(membership_predicate(
            &[rule(RuleField::Status, RuleOp::Is, "done")],
            MatchMode::Any,
            1
        )
        .is_err());
    }

    #[test]
    fn bad_op_for_field_is_rejected() {
        // `gte` is numeric-only; author is a text field, so it must be rejected.
        assert!(membership_predicate(
            &[rule(RuleField::Author, RuleOp::Gte, "3")],
            MatchMode::Any,
            1
        )
        .is_err());
    }

    #[test]
    fn author_matches_by_name_not_id() {
        // Regression: `is` on author/series used to bind a numeric id, so a
        // typed name failed to parse. It now joins the taxonomy `name` column.
        let p = membership_predicate(
            &[rule(RuleField::Author, RuleOp::Is, "Ursula K. Le Guin")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(
            p.sql.contains("a.name = ? COLLATE NOCASE"),
            "sql was {}",
            p.sql
        );
        assert_eq!(p.binds, vec![Bind::Text("Ursula K. Le Guin".into())]);
    }

    #[test]
    fn series_is_not_negates_the_membership() {
        let p = membership_predicate(
            &[rule(RuleField::Series, RuleOp::IsNot, "Foundation")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(p.sql.starts_with("(b.id NOT IN"), "sql was {}", p.sql);
        assert!(p.sql.contains("s.name = ? COLLATE NOCASE"));
    }

    #[test]
    fn contains_and_starts_with_build_like_patterns() {
        let c = membership_predicate(
            &[rule(RuleField::Tag, RuleOp::Contains, "sci")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(
            c.sql.contains("t.name LIKE ? ESCAPE '\\'"),
            "sql was {}",
            c.sql
        );
        assert_eq!(c.binds, vec![Bind::Text("%sci%".into())]);

        let s = membership_predicate(
            &[rule(RuleField::Author, RuleOp::StartsWith, "Le")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(s.sql.contains("a.name LIKE ? ESCAPE '\\'"));
        assert_eq!(s.binds, vec![Bind::Text("Le%".into())]);
    }

    #[test]
    fn like_escape_neutralizes_wildcards() {
        // A user searching for a literal `%` or `_` must not get wildcard
        // behavior; the escaped pattern is wrapped for `contains`.
        assert_eq!(like_escape("100%_off\\x"), "100\\%\\_off\\\\x");
        let p = membership_predicate(
            &[rule(RuleField::Tag, RuleOp::Contains, "50%")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert_eq!(p.binds, vec![Bind::Text("%50\\%%".into())]);
    }

    #[test]
    fn tag_and_genre_rules_read_the_guarded_effective_membership() {
        for (field, join) in [
            (RuleField::Tag, "JOIN tags t ON t.id = et.tag_id"),
            (RuleField::Genre, "JOIN genres g ON g.id = eg.genre_id"),
        ] {
            let p =
                membership_predicate(&[rule(field, RuleOp::Is, "Sea")], MatchMode::Any, 1).unwrap();
            assert!(p.sql.contains(join), "sql was {}", p.sql);
            assert!(
                p.sql.contains("CASE WHEN json_valid(mo.overrides)"),
                "sql was {}",
                p.sql
            );
            assert_eq!(p.binds, vec![Bind::Text("Sea".into())]);
        }
    }

    #[test]
    fn genre_contains_and_starts_with_build_like_patterns() {
        let c = membership_predicate(
            &[rule(RuleField::Genre, RuleOp::Contains, "50%")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert!(
            c.sql.contains("g.name LIKE ? ESCAPE '\\'"),
            "sql was {}",
            c.sql
        );
        assert_eq!(c.binds, vec![Bind::Text("%50\\%%".into())]);

        let s = membership_predicate(
            &[rule(RuleField::Genre, RuleOp::StartsWith, "Epic")],
            MatchMode::Any,
            1,
        )
        .unwrap();
        assert_eq!(s.binds, vec![Bind::Text("Epic%".into())]);
    }

    #[test]
    fn genre_rejects_numeric_ops() {
        assert!(membership_predicate(
            &[rule(RuleField::Genre, RuleOp::Gte, "3")],
            MatchMode::Any,
            1
        )
        .is_err());
    }

    #[test]
    fn tag_and_genre_is_not_negate_the_membership() {
        for field in [RuleField::Tag, RuleField::Genre] {
            let p =
                membership_predicate(&[rule(field, RuleOp::IsNot, "fiction")], MatchMode::Any, 1)
                    .unwrap();
            assert!(p.sql.starts_with("(b.id NOT IN"), "sql was {}", p.sql);
        }
    }
}
