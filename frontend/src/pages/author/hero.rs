//! The author pane's hero: portrait, name, a one-line count of books and
//! series, and the actions — "Show in library" for everyone, a ⋯ menu for an
//! admin's Delete. Its own component so the photo-error and delete-modal
//! hooks keep their slots however the pane above it branches.

use dioxus::prelude::*;
use dioxus_router::use_navigator;
use omnibus_shared::{AuthorDetail, FilterClause, FilterField, FilterMode, ViewFilters};

use crate::components::author_photo_edit::AuthorPhotoEditOverlay;
use crate::{data, Route};

/// Hero for one author. `author` is the pane's payload signal, refetched
/// when the photo changes so the new one replaces the old in place.
#[component]
pub fn AuthorHero(
    id: i64,
    name: String,
    has_photo: bool,
    book_count: usize,
    series_count: usize,
    server_url: String,
    author: Signal<Option<AuthorDetail>>,
    is_admin: bool,
) -> Element {
    let nav = use_navigator();
    let mut handoff = crate::use_library_filter_handoff();
    let show_in_library = {
        let name = name.clone();
        move |_| {
            // Replaces the library's filter with this author alone.
            handoff.set(Some(ViewFilters {
                clauses: vec![FilterClause::new(
                    FilterField::Author,
                    FilterMode::Include,
                    &[name.as_str()],
                )],
            }));
            nav.push(Route::Landing {});
        }
    };
    rsx! {
        header { class: "au-hero",
            {author_avatar(id, &name, has_photo, &server_url, author)}
            div { class: "au-hero-body",
                h2 { class: "au-name", "data-testid": "author-name", "{name}" }
                p { class: "au-meta", "{hero_meta(book_count, series_count)}" }
            }
            div { class: "au-hero-actions",
                button {
                    r#type: "button",
                    class: "au-btn",
                    "data-testid": "author-show-in-library",
                    onclick: show_in_library,
                    "Show in library"
                }
                AuthorMoreMenu { id, name, book_count, server_url, is_admin }
            }
        }
    }
}

/// "11 books · 2 series", leaving out a zero series count.
pub fn hero_meta(book_count: usize, series_count: usize) -> String {
    let books = match book_count {
        1 => "1 book".to_string(),
        n => format!("{n} books"),
    };
    match series_count {
        0 => books,
        n => format!("{books} \u{b7} {n} series"),
    }
}

/// The portrait: the cached photo, else the name's initial, under the
/// hover-revealed edit pencil. One stable circle swaps only its child (rule
/// 07). A photo that fails to load falls back to the initial for that URL.
fn author_avatar(
    id: i64,
    name: &str,
    has_photo: bool,
    server_url: &str,
    mut author: Signal<Option<AuthorDetail>>,
) -> Element {
    let mut broken_photo_src: Signal<Option<String>> = use_signal(|| None);
    let photo_url =
        has_photo.then(|| crate::media_url(server_url, &format!("/api/authors/{id}/photo")));
    let initial = name
        .chars()
        .next()
        .unwrap_or('?')
        .to_uppercase()
        .to_string();
    rsx! {
        AuthorPhotoEditOverlay {
            author_id: id,
            author_name: name.to_string(),
            server_url: server_url.to_string(),
            on_change: {
                let server_url = server_url.to_string();
                move |_| {
                    let server_url = server_url.clone();
                    // A re-upload keeps the same URL, so clear the failure too.
                    broken_photo_src.set(None);
                    spawn(async move {
                        if let Ok(a) = data::get_author(&server_url, id).await {
                            author.set(a);
                        }
                    });
                }
            },
            div { class: "disc-avatar au-avatar",
                if let Some(url) =
                    photo_url.filter(|u| broken_photo_src.read().as_deref() != Some(u.as_str()))
                {
                    img {
                        class: "disc-avatar--photo",
                        src: "{url}",
                        alt: "{name}",
                        onerror: {
                            let url = url.clone();
                            move |_| broken_photo_src.set(Some(url.clone()))
                        },
                    }
                } else {
                    "{initial}"
                }
            }
        }
    }
}

/// The ⋯ menu. Its one action is an admin's Delete, which the mobile build
/// doesn't carry, so it renders nothing for anyone else.
#[component]
fn AuthorMoreMenu(
    id: i64,
    name: String,
    book_count: usize,
    server_url: String,
    is_admin: bool,
) -> Element {
    #[cfg(not(feature = "mobile"))]
    {
        use super::delete::{AuthorDeleteModal, AuthorDeleteState};

        let mut open = use_signal(|| false);
        let mut show_confirm = use_signal(|| false);
        let deleting = use_signal(|| false);
        let mut delete_error: Signal<Option<String>> = use_signal(|| None);
        if !is_admin {
            return rsx! {};
        }
        rsx! {
            div { class: "shd-more",
                button {
                    r#type: "button",
                    class: "au-btn au-more-btn",
                    "aria-label": "More actions for {name}",
                    "aria-haspopup": "menu",
                    "aria-expanded": if open() { "true" } else { "false" },
                    "data-testid": "author-more",
                    onclick: move |_| open.toggle(),
                    "\u{22EF}"
                }
                if open() {
                    div { class: "shd-menu-scrim", onclick: move |_| open.set(false) }
                    div {
                        class: "shelf-actions-menu shd-menu",
                        role: "menu",
                        "aria-label": "More actions for {name}",
                        button {
                            r#type: "button",
                            class: "shelf-menu-item shelf-menu-item--danger shd-menu-item",
                            role: "menuitem",
                            "data-testid": "author-delete-btn",
                            onclick: move |_| {
                                open.set(false);
                                delete_error.set(None);
                                show_confirm.set(true);
                            },
                            "Delete author\u{2026}"
                        }
                    }
                }
            }
            if show_confirm() {
                AuthorDeleteModal {
                    author_id: id,
                    author_name: name.clone(),
                    book_count,
                    server_url: server_url.clone(),
                    state: AuthorDeleteState {
                        show_confirm,
                        deleting,
                        delete_error,
                    },
                }
            }
        }
    }
    #[cfg(feature = "mobile")]
    {
        let _ = (id, name, book_count, server_url, is_admin);
        rsx! {}
    }
}
