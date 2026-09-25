//! SSR render coverage for the stack tile and the head card it deals out to.

use std::collections::HashMap;

use dioxus::prelude::*;
use dioxus_router::{Routable, Router};
use omnibus_shared::{Contributor, EbookMetadata, SeriesStack, StackMemberState};

use super::*;
use crate::contexts::CoverCacheBust;
use crate::test_support::{render, render_in_vdom};

fn volume(uuid: &str, author: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.into()),
        title: Some(uuid.into()),
        creators: author
            .map(|name| Contributor {
                name: name.into(),
                ..Default::default()
            })
            .into_iter()
            .collect(),
        ..Default::default()
    }
}

fn pioneers(series_id: Option<i64>, author: Option<&str>) -> SeriesStack {
    SeriesStack {
        lead_uuid: "p1".into(),
        name: "Pioneers".into(),
        series_id,
        members: vec![volume("p1", author), volume("p2", author)],
        states: Vec::new(),
    }
}

/// The tile with the cover cache-bust context its leaves read.
#[component]
fn TileHost(stack: SeriesStack) -> Element {
    use_context_provider(|| CoverCacheBust(Signal::new(HashMap::new())));
    let refocus = use_signal(|| None::<String>);
    rsx! {
        StackTile { stack, server_url: String::new(), index: 0, refocus, on_open: move |_| {} }
    }
}

#[component]
fn CapHost(series_id: Option<i64>, author: Option<&'static str>) -> Element {
    rsx! {
        StackCap { stack: pioneers(series_id, author), on_fold: move |_| {} }
    }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum LinkedCapRoute {
    #[route("/")]
    LinkedCap {},
}

#[component]
fn LinkedCap() -> Element {
    rsx! {
        CapHost { series_id: Some(7), author: None }
    }
}

fn render_tile(stack: SeriesStack) -> String {
    render(rsx! {
        TileHost { stack }
    })
}

#[test]
fn stack_cap_links_the_series_page_only_when_the_series_resolves() {
    // `Link` panics without a router, so the linked case mounts one.
    let linked = render_in_vdom(|| rsx! { Router::<LinkedCapRoute> {} });
    assert!(
        linked.contains("data-testid=\"series-cap-page\""),
        "{linked}"
    );
    assert!(linked.contains("href=\"/series/7\""), "{linked}");

    let unlinked = render(rsx! {
        CapHost { series_id: None, author: None }
    });
    assert!(!unlinked.contains("series-cap-page"), "{unlinked}");
    assert!(
        unlinked.contains("data-testid=\"series-cap-fold\""),
        "{unlinked}"
    );
}

#[test]
fn stack_cap_meta_counts_the_library_and_adds_the_author_when_known() {
    let with = render(rsx! {
        CapHost { series_id: None, author: Some("Grace Hopper") }
    });
    assert!(
        with.contains("2 in your library<br/>Grace Hopper"),
        "{with}"
    );

    let without = render(rsx! {
        CapHost { series_id: None, author: None }
    });
    assert!(without.contains("2 in your library</span>"), "{without}");
}

#[test]
fn stack_tile_draws_progress_segments_only_once_a_member_is_started() {
    let unread = render_tile(pioneers(None, None));
    assert!(!unread.contains("ss-segs"), "{unread}");

    let mut started = pioneers(None, None);
    started.states = vec![StackMemberState {
        uuid: "p2".into(),
        percent: Some(40),
        started: true,
        finished: false,
    }];
    let html = render_tile(started);
    assert!(html.contains("class=\"ss-segs\""), "{html}");
}

#[test]
fn stack_tile_meta_names_the_author_only_when_the_front_volume_has_one() {
    let with = render_tile(pioneers(None, Some("Grace Hopper")));
    assert!(
        with.contains("<span class=\"lib-tile-author\">2 books · Grace Hopper</span>"),
        "{with}"
    );

    let without = render_tile(pioneers(None, None));
    assert!(
        without.contains("<span class=\"lib-tile-author\">2 books</span>"),
        "{without}"
    );
}
