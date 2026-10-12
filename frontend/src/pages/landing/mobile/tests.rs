//! Unit tests for what the mobile landing says when the grid has nothing to
//! show because its fetch failed.

use omnibus_shared::{FilterClause, FilterField, FilterMode, ViewFilters};

use super::*;

fn clause(field: FilterField) -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause::new(field, FilterMode::Include, &["x"])],
    }
}

#[test]
fn mobile_notice_says_a_shelf_filter_needs_a_connection_when_offline_browse_declined() {
    let notice = mobile_notice(Some("You're offline"), &clause(FilterField::Shelf), true);

    assert_eq!(notice, Some(MobileNotice::FiltersNeedConnection));
}

#[test]
fn mobile_notice_reports_the_failure_as_it_is_without_a_shelf_filter() {
    let notice = mobile_notice(Some("You're offline"), &clause(FilterField::Tag), true);

    assert_eq!(notice, Some(MobileNotice::Failed("You're offline".into())));
}

#[test]
fn mobile_notice_reports_a_server_failure_of_a_shelf_filtered_fetch_as_it_is() {
    let notice = mobile_notice(
        Some("server returned 500"),
        &clause(FilterField::Shelf),
        false,
    );

    assert_eq!(
        notice,
        Some(MobileNotice::Failed("server returned 500".into()))
    );
}

#[test]
fn mobile_notice_is_silent_when_nothing_failed() {
    assert_eq!(mobile_notice(None, &clause(FilterField::Shelf), true), None);
}
