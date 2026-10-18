//! The admin "Delete author" confirmation. Web-only: the matching
//! `rpc_delete_author` server function is not built for mobile.

use dioxus::prelude::*;
use dioxus_router::use_navigator;

use crate::components::{confirm_modal_body, ConfirmModal, ConfirmModalAction, ConfirmModalTone};
use crate::pages::authors_index::use_forget_author;
use crate::{data, Route};

/// Transient state for the delete-author modal: whether the confirm
/// pane is open, whether a delete RPC is in flight, and the most
/// recent error message (if any). Grouped because all three change
/// together across the confirm/run/error lifecycle, and keep the
/// modal's signature focused on the stable identity props.
#[derive(Clone, Copy, PartialEq)]
pub struct AuthorDeleteState {
    pub show_confirm: Signal<bool>,
    pub deleting: Signal<bool>,
    pub delete_error: Signal<Option<String>>,
}

/// Confirmation modal for the admin "Delete author" action. On confirm it
/// calls `rpc_delete_author` (un-links every book, adds the name to
/// `ignored_authors`, refreshes FTS) then navigates to `/authors`. The
/// blocklist insert keeps the delete durable: a later `Task::Scan` would
/// otherwise recreate the row from OPF metadata; the author also leaves the
/// mounted list, which a route change alone would not refetch.
#[component]
pub fn AuthorDeleteModal(
    author_id: i64,
    author_name: String,
    book_count: usize,
    server_url: String,
    state: AuthorDeleteState,
) -> Element {
    let AuthorDeleteState {
        mut show_confirm,
        mut deleting,
        mut delete_error,
    } = state;
    let nav = use_navigator();
    let mut forget = use_forget_author();
    let busy = deleting();
    let book_count_label = if book_count == 1 { "book" } else { "books" };
    let title = format!("Delete \"{author_name}\"?");
    let body = format!(
        "This will un-link the author from {book_count} {book_count_label} \
         and prevent the name from being re-added on future library scans. \
         The books themselves are not deleted."
    );

    let confirm_delete = move |_| {
        let server_url = server_url.clone();
        spawn(async move {
            deleting.set(true);
            delete_error.set(None);
            match data::delete_author(&server_url, author_id).await {
                Ok(_) => {
                    show_confirm.set(false);
                    forget(author_id);
                    nav.push(Route::AuthorsIndex {});
                }
                Err(e) => {
                    delete_error.set(Some(e.to_string()));
                }
            }
            deleting.set(false);
        });
    };

    rsx! {
        ConfirmModal {
            testid: "author-delete-modal".to_string(),
            aria_label: format!("Delete {author_name}"),
            dialog_class: "author-delete-modal".to_string(),
            busy,
            on_dismiss: move |_| show_confirm.set(false),
            if let Some(msg) = delete_error() {
                p { role: "alert", class: "error author-delete-modal__error", "⚠ {msg}" }
            }
            {confirm_modal_body(
                &title,
                &body,
                None,
                vec![
                    ConfirmModalAction {
                        testid: "author-delete-cancel".to_string(),
                        label: "Cancel".to_string(),
                        busy_label: None,
                        busy: false,
                        tone: ConfirmModalTone::Ghost,
                        disabled: busy,
                        on_click: EventHandler::new(move |_| show_confirm.set(false)),
                    },
                    ConfirmModalAction {
                        testid: "author-delete-confirm".to_string(),
                        label: "Delete".to_string(),
                        busy_label: Some("Deleting\u{2026}".to_string()),
                        busy,
                        tone: ConfirmModalTone::Danger,
                        disabled: busy,
                        on_click: EventHandler::new(confirm_delete),
                    },
                ],
            )}
        }
    }
}
