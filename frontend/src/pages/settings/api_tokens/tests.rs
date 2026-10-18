//! Tests for the API tokens section: its date and status helpers, the create
//! form and a token row.

use super::*;

#[test]
fn fmt_timestamp_renders_iso_date() {
    // 2024-01-15T00:00:00Z
    assert_eq!(fmt_timestamp(1_705_276_800), "2024-01-15");
}

#[test]
fn rel_date_covers_today_yesterday_recent_and_dated_tiers() {
    let now = 1_705_276_800 + 43_200; // 2024-01-15T12:00:00Z
    assert_eq!(rel_date(now, now - 3_600), "today");
    assert_eq!(rel_date(now, now - 86_400), "yesterday");
    assert_eq!(rel_date(now, now - 3 * 86_400), "3 days ago");
    // 60 days back → 2023-11-16, a different year than "now".
    assert_eq!(rel_date(now, now - 60 * 86_400), "16 Nov 2023");
    // Same-year fallthrough: pin "now" late in the year.
    let dec = 1_733_011_200; // 2024-12-01T00:00:00Z
    assert_eq!(rel_date(dec, dec - 60 * 86_400), "2 Oct");
}

#[test]
fn status_pill_maps_age_to_active_idle_and_unused() {
    let now = 1_705_276_800;
    assert_eq!(status_pill(now, None).1, "Never used");
    let (cls, label) = status_pill(now, Some(now - 86_400));
    assert_eq!((cls, label.as_str()), ("tkx-pill-active", "Active"));
    let (cls, label) = status_pill(now, Some(now - 91 * 86_400));
    assert_eq!((cls, label.as_str()), ("tkx-pill-idle", "Idle 91d"));
}

#[test]
fn empty_state_shown_waits_for_the_list_to_load_empty() {
    assert!(!empty_state_shown(false, 0));
    assert!(empty_state_shown(true, 0));
    assert!(!empty_state_shown(true, 1));
}

#[test]
fn mcp_command_embeds_origin_and_bearer() {
    let cmd = mcp_command("https://example.test", "omni_abcd");
    assert!(cmd.contains("https://example.test/mcp"));
    assert!(cmd.contains("Bearer omni_abcd"));
}

// SSR render-smoke coverage. These need the `server` feature (`dioxus::ssr`).
#[cfg(feature = "server")]
mod render_tests {
    use super::*;
    use crate::test_support::render_in_vdom;

    fn section() -> Element {
        rsx! {
            ApiTokensSection {}
        }
    }

    /// First paint: head, scope strip, and create form render; no secret
    /// surface, no rows, no empty-state card and no count (the list hasn't
    /// loaded) — a secret can only ever appear after a create in the same
    /// mounted session (AC2).
    #[test]
    fn api_tokens_section_first_paint_has_head_and_form_and_no_secret() {
        let html = render_in_vdom(section);
        assert!(html.contains("data-testid=\"api-tokens-card\""));
        assert!(html.contains("data-testid=\"api-token-name-input\""));
        assert!(
            html.contains("data-testid=\"api-tokens-count-pending\""),
            "{html}"
        );
        assert!(!html.contains("0 live tokens"));
        assert!(!html.contains("data-testid=\"api-token-secret\""));
        assert!(!html.contains("data-testid=\"api-tokens-empty\""));
        assert!(!html.contains("data-testid=\"api-token-row\""));
    }

    /// A row renders name, suffix identifier, pill, dates, and both actions.
    #[test]
    fn api_token_row_renders_identity_pill_dates_and_actions() {
        fn row() -> Element {
            rsx! {
                ApiTokenRow {
                    token: ApiTokenView {
                        id: 7,
                        name: "MCP on my laptop".to_string(),
                        created_at: 1_705_276_800,
                        last_used_at: None,
                        suffix: Some("4e39".to_string()),
                    },
                    disabled: false,
                    on_ask_rename: |_| {},
                    on_ask_revoke: |_| {},
                }
            }
        }
        let html = render_in_vdom(row);
        assert!(html.contains("MCP on my laptop"));
        assert!(html.contains("omni_…4e39"));
        assert!(html.contains("Never used"));
        assert!(html.contains("2024-01-15"));
        assert!(html.contains("data-testid=\"api-token-rename-7\""));
        assert!(html.contains("data-testid=\"api-token-revoke-7\""));
    }

    /// A legacy row (no recorded suffix) omits the identifier line entirely.
    #[test]
    fn api_token_row_omits_identifier_without_a_suffix() {
        fn row() -> Element {
            rsx! {
                ApiTokenRow {
                    token: ApiTokenView {
                        id: 8,
                        name: "legacy".to_string(),
                        created_at: 1_705_276_800,
                        last_used_at: None,
                        suffix: None,
                    },
                    disabled: false,
                    on_ask_rename: |_| {},
                    on_ask_revoke: |_| {},
                }
            }
        }
        let html = render_in_vdom(row);
        assert!(!html.contains("omni_…"));
    }

    /// The hand-off panel carries the secret, the pre-filled command, and
    /// the dismiss control.
    #[test]
    fn secret_hand_off_renders_secret_command_and_dismiss() {
        fn panel() -> Element {
            rsx! {
                SecretHandOff {
                    name: "scan-cron (server)".to_string(),
                    secret: "omni_test_secret".to_string(),
                    origin: "https://example.test".to_string(),
                    on_dismiss: |_| {},
                }
            }
        }
        let html = render_in_vdom(panel);
        assert!(html.contains("data-testid=\"api-token-secret-field\""));
        assert!(html.contains("omni_test_secret"));
        assert!(html.contains("https://example.test/mcp"));
        assert!(html.contains("data-testid=\"api-token-secret-dismiss\""));
    }

    fn named_row() -> Element {
        rsx! {
            ApiTokenRow {
                token: ApiTokenView {
                    id: 7,
                    name: "MCP on my laptop".to_string(),
                    created_at: 1_705_276_800,
                    last_used_at: None,
                    suffix: Some("4e39".to_string()),
                },
                disabled: false,
                on_ask_rename: |_| {},
                on_ask_revoke: |_| {},
            }
        }
    }

    fn hand_off() -> Element {
        rsx! {
            SecretHandOff {
                name: "laptop".to_string(),
                secret: "omni_test_secret".to_string(),
                origin: "https://example.test".to_string(),
                on_dismiss: |_| {},
            }
        }
    }

    #[test]
    fn api_token_row_names_the_token_on_its_actions() {
        let html = render_in_vdom(named_row);
        assert!(
            html.contains(r#"aria-label="Rename MCP on my laptop""#),
            "{html}"
        );
        assert!(
            html.contains(r#"aria-label="Revoke MCP on my laptop""#),
            "{html}"
        );
    }

    #[test]
    fn secret_hand_off_reports_whether_each_copy_landed() {
        let html = render_in_vdom(hand_off);
        assert!(html.contains("api-token-secret-copy-feedback"), "{html}");
        assert!(
            html.contains("api-token-mcp-command-copy-feedback"),
            "{html}"
        );
    }

    #[test]
    fn secret_hand_off_offers_to_hide_the_secret() {
        let html = render_in_vdom(hand_off);
        assert!(html.contains("Hide secret"), "{html}");
        assert!(!html.contains("I\u{2019}ve stored it"), "{html}");
    }

    #[test]
    fn api_tokens_section_makes_create_token_the_primary_footer_action() {
        let html = render_in_vdom(section);
        let input = html
            .find("data-testid=\"api-token-name-input\"")
            .expect("input");
        let hint = html.find("class=\"tkx-create-hint\"").expect("hint");
        let footer = html.find("class=\"settings-actions\"").expect("footer");
        let create = html
            .find("data-testid=\"api-token-create\"")
            .expect("create");
        assert!(input < hint && hint < footer && footer < create, "{html}");
        assert!(html[footer..create].contains("btn primary"), "{html}");
    }

    #[test]
    fn api_tokens_section_mounts_its_status_line_before_any_message() {
        let html = render_in_vdom(section);
        assert!(
            html.contains("<h3 class=\"tkx-title\">API tokens</h3>"),
            "{html}"
        );
        assert!(
            html.contains(r#"class="settings-status" data-testid="api-tokens-status"></p>"#),
            "{html}"
        );
    }
}
