//! Tests for the People section: the date helpers, the edit form's dirty
//! check, and the table, row and Sessions modal markup.

use super::*;

fn alice() -> AdminUserRow {
    AdminUserRow {
        id: 7,
        username: "alice".into(),
        is_admin: false,
        can_upload: true,
        can_edit: false,
        can_download: true,
        kindle_email: None,
        display_name: None,
        created_at: 0,
        locked: true,
    }
}

#[test]
fn edit_is_dirty_is_false_until_a_permission_or_password_changes() {
    let user = alice();
    let unchanged = modals::permissions_of(&user);
    assert!(!modals::edit_is_dirty(&user, unchanged, ""));
    assert!(modals::edit_is_dirty(&user, unchanged, "hunter2hunter2"));
    let promoted = UserPermissions {
        is_admin: true,
        ..unchanged
    };
    assert!(modals::edit_is_dirty(&user, promoted, ""));
}

#[test]
fn fmt_date_formats_known_epochs_utc() {
    assert_eq!(fmt_date(0), "Jan 1, 1970");
    // 2024-01-01T00:00:00Z
    assert_eq!(fmt_date(1_704_067_200), "Jan 1, 2024");
    // 2026-07-25T00:00:00Z
    assert_eq!(fmt_date(1_784_937_600), "Jul 25, 2026");
}

#[test]
fn fmt_date_is_stable_within_a_day() {
    // Any second within the civil day maps to the same date (SSR/hydration
    // must not disagree because of sub-day drift).
    assert_eq!(fmt_date(1_704_067_200), fmt_date(1_704_067_200 + 86_399));
}

#[test]
fn civil_from_days_round_trips_epoch() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
}

#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;
    use dioxus_router::{Routable, Router};

    use super::super::UsersSection;
    use crate::test_support::render_in_vdom;

    // The section's modals navigate, so it mounts under a router.
    #[derive(Clone, Debug, PartialEq, Routable)]
    enum UsersRoute {
        #[route("/")]
        UsersHost {},
    }

    #[component]
    fn UsersHost() -> Element {
        rsx! { UsersSection {} }
    }

    #[component]
    fn TableHost() -> Element {
        rsx! { super::super::UsersTable { users: vec![super::alice()], current_id: None, on_action: move |_| {} } }
    }

    #[test]
    fn users_table_names_the_user_in_every_row_action() {
        let html = crate::test_support::render(rsx! { TableHost {} });
        for label in [
            "Unlock alice",
            "Edit alice",
            "Sessions for alice",
            "Delete alice",
        ] {
            assert!(
                html.contains(&format!(r#"aria-label="{label}""#)),
                "{label}: {html}"
            );
        }
    }

    #[test]
    fn users_table_scrolls_inside_its_card() {
        let html = crate::test_support::render(rsx! { TableHost {} });
        let wrap = html.find("table-scroll").expect("scroll wrapper");
        assert!(wrap < html.find("users-table").unwrap(), "{html}");
    }

    #[component]
    fn SessionsHost() -> Element {
        rsx! { super::super::modals::SessionsModal { user: super::alice(), on_close: move |_| {} } }
    }

    #[test]
    fn sessions_modal_loads_rather_than_claiming_no_sessions_before_the_lists_arrive() {
        let html = render_in_vdom(|| rsx! { SessionsHost {} });
        assert!(html.contains("user-sessions-loading"), "{html}");
        assert!(!html.contains("No live sessions"), "{html}");
        assert!(!html.contains("No registered devices"), "{html}");
    }

    #[component]
    fn RevokeListsHost() -> Element {
        let session = omnibus_shared::SessionView {
            id: 3,
            device_id: None,
            kind: "cookie".into(),
            client: "Firefox on macOS".into(),
            created_at: 0,
            last_used_at: 0,
            expires_at: 0,
            is_current: false,
        };
        let device = omnibus_shared::DeviceView {
            id: 4,
            name: "Kobo Clara".into(),
            client_kind: "kobo".into(),
            client_version: None,
            created_at: 0,
            last_seen_at: 0,
        };
        let revoke = use_callback(|_: i64| {});
        rsx! {
            {super::super::modals::render_session_list(&[session], None, revoke)}
            {super::super::modals::render_device_list(&[device], None, revoke)}
        }
    }

    #[test]
    fn session_and_device_revokes_name_what_they_sign_out() {
        let html = render_in_vdom(|| rsx! { RevokeListsHost {} });
        assert!(
            html.contains(r#"aria-label="Revoke the session on Firefox on macOS""#),
            "{html}"
        );
        assert!(
            html.contains(r#"aria-label="Revoke the device Kobo Clara""#),
            "{html}"
        );
    }

    #[test]
    fn users_section_first_paint_holds_skeleton_rows_rather_than_an_empty_table() {
        let html = render_in_vdom(|| rsx! { Router::<UsersRoute> {} });
        assert!(html.contains("users-loading"), "{html}");
        assert!(!html.contains("data-testid=\"users-table\""), "{html}");
    }
}
