//! Search results page — the full page reached from the command palette.
//! Reuses the `data::search_palette` RPC and groups hits by type (Books,
//! Authors, Series, Tags, Genres) with the matched term highlighted, an "On
//! this page" jump rail, and a tags-first ordering when the query matches tag
//! names. Each section previews its first few hits and offers the rest behind
//! a "Show all", fetched through `data::search_results`.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{
    PaletteAuthorHit, PaletteBookHit, PaletteGenreHit, PaletteResults, PaletteSeriesHit,
    PaletteTagHit,
};

use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::format::{facet_query, plural, single_facet_value};
use crate::{data, use_server_url, Route};

/// Renders the full-page search results for the given query.
#[component]
pub fn SearchPage(query: String) -> Element {
    let server_url = use_server_url();
    let mut results: Signal<Option<PaletteResults>> = use_signal(|| None);
    let mut loading = use_signal(|| true);
    let mut error: Signal<Option<String>> = use_signal(|| None);

    // See `BookDetailPage` for why `query` needs `use_reactive!`.
    let url = server_url.clone();
    let query_dep = query.clone();
    use_effect(use_reactive!(|query_dep| {
        let url = url.clone();
        spawn(async move {
            loading.set(true);
            match data::search_palette(&url, &query_dep).await {
                Ok(r) => {
                    results.set(Some(r));
                    error.set(None);
                }
                Err(e) => error.set(Some(e.to_string())),
            }
            loading.set(false);
        });
    }));

    if loading() {
        return rsx! {
            section { class: "search-page",
                Loading { kind: LoadingKind::Page, label: "Searching the shelves" }
            }
        };
    }
    if let Some(msg) = error() {
        return rsx! {
            section { class: "search-page",
                p { role: "alert", class: "subtitle", "{msg}" }
            }
        };
    }
    let Some(r) = results() else {
        return rsx! {
            section { class: "search-page",
                p { class: "subtitle", "No results for \u{201c}{query}\u{201d}." }
            }
        };
    };

    rsx! {
        section { class: "search-page",
            // Keyed on the query so a new search starts with every section
            // collapsed again.
            SearchResults { key: "{query}", results: r, query: query.clone() }
        }
    }
}

/// How many hits a collapsed section shows — the palette's own cap, so the
/// first paint needs no second fetch.
const PREVIEW: usize = 5;

/// Which result group a section renders. Drives both the main column order
/// and the "On this page" rail.
#[derive(Clone, Copy, PartialEq)]
enum Section {
    Books,
    Authors,
    Series,
    Tags,
    Genres,
}

impl Section {
    fn label(self) -> &'static str {
        match self {
            Section::Books => "Books",
            Section::Authors => "Authors",
            Section::Series => "Series",
            Section::Tags => "Tags",
            Section::Genres => "Genres",
        }
    }

    /// In-page anchor id used by the "On this page" jump links.
    fn anchor(self) -> &'static str {
        match self {
            Section::Books => "results-books",
            Section::Authors => "results-authors",
            Section::Series => "results-series",
            Section::Tags => "results-tags",
            Section::Genres => "results-genres",
        }
    }

    fn count(self, r: &PaletteResults) -> u32 {
        match self {
            Section::Books => r.book_total,
            Section::Authors => r.author_total,
            Section::Series => r.series_total,
            Section::Tags => r.tag_total,
            Section::Genres => r.genre_total,
        }
    }

    /// How many hits the fetched results actually carry for this section.
    fn fetched(self, r: &PaletteResults) -> usize {
        match self {
            Section::Books => r.books.len(),
            Section::Authors => r.authors.len(),
            Section::Series => r.series.len(),
            Section::Tags => r.tags.len(),
            Section::Genres => r.genres.len(),
        }
    }
}

/// Each section's show-all state, threaded through the group renderers.
#[derive(Clone, Copy)]
struct Expansion {
    open: Signal<Vec<Section>>,
    busy: Signal<Option<Section>>,
    failed: Signal<Option<Section>>,
    toggle: Callback<Section>,
}

impl Expansion {
    fn is_open(self, sec: Section) -> bool {
        self.open.read().contains(&sec)
    }

    /// How many of a section's hits to render.
    fn shown(self, sec: Section) -> usize {
        if self.is_open(sec) {
            usize::MAX
        } else {
            PREVIEW
        }
    }
}

/// The note under an opened section the server still couldn't hand over whole
/// — past its per-section ceiling — or `None` when every hit is on the page.
fn cut_note(sec: Section, r: &PaletteResults) -> Option<String> {
    let (fetched, total) = (sec.fetched(r), sec.count(r));
    (u32::try_from(fetched).unwrap_or(u32::MAX) < total).then(|| {
        format!(
            "Showing the first {fetched} of {total} \u{2014} narrow your search to see the rest."
        )
    })
}

/// Grouped, highlighted result sections + an "On this page" rail for a loaded
/// [`PaletteResults`].
#[component]
fn SearchResults(results: PaletteResults, query: String) -> Element {
    let server_url = use_server_url();
    // The whole-section fetch replaces the preview once it lands; collapsed
    // sections still render only their first few.
    let mut fuller: Signal<Option<PaletteResults>> = use_signal(|| None);
    let mut open = use_signal(Vec::<Section>::new);
    let mut busy = use_signal(|| None::<Section>);
    let mut failed = use_signal(|| None::<Section>);
    let url = server_url.clone();
    let q_fetch = query.clone();
    let preview = results.clone();
    let toggle = use_callback(move |sec: Section| {
        if open.peek().contains(&sec) {
            open.write().retain(|s| *s != sec);
            return;
        }
        let current = fuller.peek().clone().unwrap_or_else(|| preview.clone());
        let want = sec.count(&current);
        if sec.fetched(&current) >= usize::try_from(want).unwrap_or(usize::MAX) {
            open.write().push(sec);
            return;
        }
        let url = url.clone();
        let q = q_fetch.clone();
        busy.set(Some(sec));
        failed.set(None);
        spawn(async move {
            match data::search_results(&url, &q, want).await {
                Ok(r) => {
                    fuller.set(Some(r));
                    open.write().push(sec);
                }
                Err(_) => failed.set(Some(sec)),
            }
            busy.set(None);
        });
    });
    let ctl = Expansion {
        open,
        busy,
        failed,
        toggle,
    };
    // Ordered off the preview, so opening a section never reshuffles the page.
    let (order, tag_match) = section_order(&results, &query);
    let r = fuller().unwrap_or(results);
    let q = query;
    let total = r.total_count();

    if total == 0 {
        return empty_results(&r, &q);
    }

    let result_word = if total == 1 { "result" } else { "results" };
    // A one-facet query is headed by the name the reader clicked, not by the
    // `tag:"…"` string the link was built from (#2504). Anything else keeps
    // the raw query, which is what they actually typed.
    let heading = single_facet_value(&q).unwrap_or_else(|| q.clone());

    rsx! {
        // No sort/view controls: one ordering, one rendering, and a button
        // without a handler is worse than no button (#2453).
        div { class: "search-head",
            div {
                div { class: "label", "Search results" }
                h1 { class: "search-title",
                    span { class: "search-title-n", "{total}" }
                    " {result_word} for \u{201c}"
                    {highlight(&heading, &heading)}
                    "\u{201d}"
                }
            }
        }
        p { class: "search-summary mono", "data-testid": "search-result-count",
            {summary_line(&r)}
        }

        div { class: "search-layout",
            div { class: "search-main",
                for (i, sec) in order.iter().enumerate() {
                    div { key: "{sec.label()}", class: "search-section-slot",
                        if i > 0 {
                            div { class: "divider" }
                        }
                        {section_node(*sec, &r, &q, tag_match, &server_url, ctl)}
                    }
                }
            }
            {on_this_page(&order, &r)}
        }
    }
}

/// Empty-state header + zero-count summary for a query with no hits.
fn empty_results(r: &PaletteResults, q: &str) -> Element {
    // Same naming rule as the populated head — a reader who clicked a tag and
    // found nothing should still be told which tag (#2504).
    let heading = single_facet_value(q).unwrap_or_else(|| q.to_string());
    rsx! {
        div { class: "search-head",
            div {
                div { class: "label", "Search results" }
                h1 { class: "search-title",
                    "No results for \u{201c}"
                    {highlight(&heading, &heading)}
                    "\u{201d}"
                }
            }
        }
        p { class: "subtitle", "data-testid": "search-result-count",
            "0 results \u{00b7} fts5 \u{00b7} {r.duration_ms}ms"
        }
    }
}

/// Non-empty section order (tags-first on a tag-name match) plus that match flag.
fn section_order(r: &PaletteResults, q: &str) -> (Vec<Section>, bool) {
    let q_lower = q.to_lowercase();
    let tag_match = r
        .tags
        .iter()
        .any(|t| t.name.to_lowercase().contains(&q_lower));
    let canonical = [
        Section::Books,
        Section::Authors,
        Section::Series,
        Section::Tags,
        Section::Genres,
    ];
    let tags_first = [
        Section::Tags,
        Section::Books,
        Section::Authors,
        Section::Series,
        Section::Genres,
    ];
    let order: Vec<Section> = if tag_match { tags_first } else { canonical }
        .into_iter()
        .filter(|s| s.count(r) > 0)
        .collect();
    (order, tag_match)
}

// ── Section renderers ────────────────────────────────────────────────────

/// Dispatch one [`Section`] to its group renderer.
fn section_node(
    sec: Section,
    r: &PaletteResults,
    q: &str,
    tag_match: bool,
    server_url: &str,
    ctl: Expansion,
) -> Element {
    let shown = ctl.shown(sec);
    let body = match sec {
        Section::Books => books_group(r, q, server_url, shown),
        Section::Authors => authors_group(r, q, shown),
        Section::Series => series_group(r, q, shown),
        Section::Tags => tags_group(r, q, shown),
        Section::Genres => genres_group(r, q, shown),
    };
    let sub = match sec {
        Section::Books => tag_match.then_some("in matched tags"),
        Section::Tags if tag_match => Some("matched in tag name"),
        Section::Tags => Some("related to your matches"),
        Section::Genres => Some("matched in genre name"),
        Section::Authors | Section::Series => None,
    };
    let note = ctl.is_open(sec).then(|| cut_note(sec, r)).flatten();
    rsx! {
        section { id: "{sec.anchor()}", class: "search-section",
            {section_head(sec, sec.count(r), sub, ctl)}
            {body}
            if let Some(note) = note {
                p { class: "search-section-note mono", "data-testid": "search-section-cut", "{note}" }
            }
            if ctl.failed.read().as_ref() == Some(&sec) {
                p { class: "search-section-note", role: "alert", "data-testid": "search-section-error",
                    "Couldn\u{2019}t load the rest \u{2014} try again."
                }
            }
        }
    }
}

/// Section heading: `LABEL · count` with an optional right-aligned hint, and
/// the "Show all" that reaches every hit the count names when the preview
/// holds fewer.
fn section_head(sec: Section, count: u32, sub: Option<&str>, ctl: Expansion) -> Element {
    let more = usize::try_from(count).unwrap_or(usize::MAX) > PREVIEW;
    let open = ctl.is_open(sec);
    let busy = ctl.busy.read().as_ref() == Some(&sec);
    let label = if open {
        "Show fewer".to_string()
    } else {
        format!("Show all {count}")
    };
    rsx! {
        div { class: "search-section-head",
            div { class: "label", "{sec.label()}" }
            div { class: "mono search-section-count", "\u{00b7} {count}" }
            if let Some(sub) = sub {
                div { class: "search-section-sub", "{sub}" }
            }
            if more {
                button {
                    class: "search-section-all",
                    r#type: "button",
                    "data-testid": "search-show-all-{sec.anchor()}",
                    "aria-expanded": "{open}",
                    "aria-busy": "{busy}",
                    disabled: busy,
                    onclick: move |_| ctl.toggle.call(sec),
                    BusyLabel { busy, label, busy_label: "Loading\u{2026}" }
                }
            }
        }
    }
}

fn books_group(r: &PaletteResults, q: &str, server_url: &str, shown: usize) -> Element {
    rsx! {
        div { class: "search-cover-grid",
            for book in r.books.iter().take(shown).cloned() {
                Link {
                    key: "{book.uuid}",
                    to: Route::BookDetail { uuid: book.uuid.clone() },
                    class: "search-cover-card",
                    "data-testid": "search-book-row",
                    {book_cover(server_url, &book)}
                    div { class: "search-cover-title", {highlight(&book.title, q)} }
                    div { class: "search-cover-sub", "{book.author_display}" }
                }
            }
        }
    }
}

fn authors_group(r: &PaletteResults, q: &str, shown: usize) -> Element {
    rsx! {
        div { class: "search-card-grid",
            for author in r.authors.iter().take(shown).cloned() {
                {author_card(&author, q)}
            }
        }
    }
}

fn author_card(author: &PaletteAuthorHit, q: &str) -> Element {
    let initial = author
        .name
        .chars()
        .next()
        .unwrap_or('?')
        .to_uppercase()
        .to_string();
    let books = format!("{} book{}", author.book_count, plural(author.book_count));
    rsx! {
        Link {
            key: "{author.id}",
            to: Route::AuthorDetail { id: author.id },
            class: "search-entity",
            "data-testid": "search-author-row",
            div { class: "search-avatar", "{initial}" }
            div { class: "search-entity-body",
                div { class: "search-entity-title", {highlight(&author.name, q)} }
                div { class: "search-entity-sub mono",
                    "{books}"
                    if let Some(ref lead) = author.lead_book_title {
                        " \u{00b7} incl. {lead}"
                    }
                }
            }
            span { class: "search-entity-arrow", "\u{2192}" }
        }
    }
}

fn series_group(r: &PaletteResults, q: &str, shown: usize) -> Element {
    rsx! {
        div { class: "search-card-grid",
            for s in r.series.iter().take(shown).cloned() {
                {series_card(&s, q)}
            }
        }
    }
}

fn series_card(s: &PaletteSeriesHit, q: &str) -> Element {
    rsx! {
        Link {
            key: "{s.id}",
            to: Route::SeriesDetail { id: s.id },
            class: "search-entity",
            "data-testid": "search-series-row",
            div { class: "search-avatar search-avatar-series", "\u{224b}" }
            div { class: "search-entity-body",
                div { class: "search-entity-title search-entity-title-serif", {highlight(&s.name, q)} }
                div { class: "search-entity-sub mono",
                    if let Some(ref lead) = s.lead_book_title {
                        "incl. {lead}"
                    } else {
                        "{s.book_count} book{plural(s.book_count)}"
                    }
                    if let Some(ref a) = s.author_display {
                        " \u{00b7} {a}"
                    }
                }
            }
            span { class: "search-entity-n mono", "{s.book_count}" }
        }
    }
}

fn tags_group(r: &PaletteResults, q: &str, shown: usize) -> Element {
    let q_lower = q.to_lowercase();
    rsx! {
        div { class: "search-tags",
            for tag in r.tags.iter().take(shown).cloned() {
                {tag_chip(&tag, q, &q_lower)}
            }
        }
    }
}

fn tag_chip(tag: &PaletteTagHit, q: &str, q_lower: &str) -> Element {
    let matched = tag.name.to_lowercase().contains(q_lower);
    let class = if matched {
        "chip search-tag search-tag-matched"
    } else {
        "chip search-tag"
    };
    rsx! {
        Link {
            key: "{tag.id}",
            to: Route::Search { query: facet_query("tag", &tag.name) },
            class: "{class}",
            "data-testid": "search-tag-row",
            {highlight(&tag.name, q)}
            span { class: "search-tag-count", " \u{00b7} {tag.book_count}" }
        }
    }
}

fn genres_group(r: &PaletteResults, q: &str, shown: usize) -> Element {
    let q_lower = q.to_lowercase();
    rsx! {
        div { class: "search-tags",
            for genre in r.genres.iter().take(shown).cloned() {
                {genre_chip(&genre, q, &q_lower)}
            }
        }
    }
}

/// A genre chip. Unlike [`tag_chip`] there is no detail route to offer — a
/// genre has no navigable row (migration `0066`) — so the only destination is
/// a `genre:`-refined search, which is also the chip's whole purpose.
fn genre_chip(genre: &PaletteGenreHit, q: &str, q_lower: &str) -> Element {
    let matched = genre.name.to_lowercase().contains(q_lower);
    let class = if matched {
        "chip search-tag search-tag-matched"
    } else {
        "chip search-tag"
    };
    rsx! {
        Link {
            key: "{genre.name}",
            to: Route::Search { query: facet_query("genre", &genre.name) },
            class: "{class}",
            "data-testid": "search-genre-row",
            {highlight(&genre.name, q)}
            span { class: "search-tag-count", " \u{00b7} {genre.book_count}" }
        }
    }
}

/// Right-rail "On this page" jump list over the rendered sections.
fn on_this_page(order: &[Section], r: &PaletteResults) -> Element {
    rsx! {
        aside { class: "search-rail",
            div { class: "label search-rail-head", "On this page" }
            div { class: "search-rail-list",
                for (i, sec) in order.iter().enumerate() {
                    a {
                        key: "{sec.label()}",
                        href: "#{sec.anchor()}",
                        class: if i == 0 { "search-rail-item search-rail-item-active" } else { "search-rail-item" },
                        span { "{sec.label()}" }
                        span { class: "search-rail-count mono", "{sec.count(r)}" }
                    }
                }
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Book cover thumbnail for a palette hit, falling back to an accent-backed
/// initial plate when the book has no cover (mirrors the palette rows).
fn book_cover(server_url: &str, book: &PaletteBookHit) -> Element {
    if book.cover_url.is_some() {
        let url = crate::thumb_url(server_url, &book.uuid, "md");
        rsx! {
            img { class: "search-cover-thumb", src: "{url}", alt: "", loading: "lazy" }
        }
    } else {
        let initial = book
            .title
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        let bg = book.accent.as_deref().unwrap_or("var(--bg-2)");
        rsx! {
            div { class: "search-cover-thumb search-cover-fallback", style: "background: {bg};",
                "{initial}"
            }
        }
    }
}

/// Render `text` with every case-insensitive occurrence of `q` wrapped in an
/// accented `<em class="search-hit">`. Returns the plain text untouched when
/// `q` is empty or doesn't occur, so non-matching fields stay free of stray
/// markup.
fn highlight(text: &str, q: &str) -> Element {
    let q_lower = q.to_lowercase();
    let qn = q_lower.chars().count();
    if qn == 0 {
        return rsx! { "{text}" };
    }
    let q_chars: Vec<char> = q_lower.chars().collect();
    let text_chars: Vec<char> = text.chars().collect();
    // Compare against a per-char lowercased copy. One char → one char holds
    // for ASCII and the Latin script titles carry, which is all the search
    // box realistically sees; exotic multi-char lowercasings just won't match.
    let lower: Vec<char> = text_chars
        .iter()
        .map(|c| c.to_lowercase().next().unwrap_or(*c))
        .collect();

    let mut segments: Vec<(String, bool)> = Vec::new();
    let mut buf = String::new();
    let mut i = 0;
    while i < text_chars.len() {
        if i + qn <= text_chars.len() && lower[i..i + qn] == q_chars[..] {
            if !buf.is_empty() {
                segments.push((std::mem::take(&mut buf), false));
            }
            segments.push((text_chars[i..i + qn].iter().collect(), true));
            i += qn;
        } else {
            buf.push(text_chars[i]);
            i += 1;
        }
    }
    if !buf.is_empty() {
        segments.push((buf, false));
    }

    // No hit → emit the original string with no wrapper markup.
    if !segments.iter().any(|(_, hit)| *hit) {
        return rsx! { "{text}" };
    }

    rsx! {
        for (idx, (seg, hit)) in segments.into_iter().enumerate() {
            if hit {
                em { key: "{idx}", class: "search-hit", "{seg}" }
            } else {
                span { key: "{idx}", "{seg}" }
            }
        }
    }
}

/// Mono summary line under the header: per-category totals, then engine + time.
fn summary_line(r: &PaletteResults) -> String {
    let mut parts: Vec<String> = Vec::new();
    if r.book_total > 0 {
        let word = if r.book_total == 1 { "title" } else { "titles" };
        parts.push(format!("{} {word}", r.book_total));
    }
    if r.author_total > 0 {
        parts.push(format!(
            "{} author{}",
            r.author_total,
            plural(r.author_total)
        ));
    }
    if r.series_total > 0 {
        parts.push(format!("{} series", r.series_total));
    }
    if r.tag_total > 0 {
        parts.push(format!("{} tag{}", r.tag_total, plural(r.tag_total)));
    }
    if r.genre_total > 0 {
        parts.push(format!("{} genre{}", r.genre_total, plural(r.genre_total)));
    }
    parts.push("fts5".to_string());
    parts.push(format!("{}ms", r.duration_ms));
    parts.join(" \u{00b7} ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use omnibus_shared::{PaletteAuthorHit, PaletteBookHit, PaletteResults, PaletteTagHit};

    #[test]
    fn total_count_sums_per_category_totals_not_capped_lengths() {
        // Vecs hold the 5-hit display cap; the totals carry the true counts.
        let r = PaletteResults {
            query: "x".into(),
            books: vec![PaletteBookHit::default()],
            authors: vec![PaletteAuthorHit::default(), PaletteAuthorHit::default()],
            series: vec![],
            tags: vec![],
            duration_ms: 0,
            book_total: 40,
            author_total: 2,
            series_total: 0,
            tag_total: 3,
            genre_total: 1,
            ..Default::default()
        };
        assert_eq!(r.total_count(), 46);
    }

    #[test]
    fn summary_line_lists_present_categories_with_engine_and_time() {
        let r = PaletteResults {
            query: "wind".into(),
            duration_ms: 24,
            book_total: 2,
            author_total: 2,
            series_total: 2,
            tag_total: 4,
            genre_total: 3,
            ..Default::default()
        };
        assert_eq!(
            summary_line(&r),
            "2 titles \u{00b7} 2 authors \u{00b7} 2 series \u{00b7} 4 tags \u{00b7} 3 genres \u{00b7} fts5 \u{00b7} 24ms"
        );
    }

    #[test]
    fn summary_line_singularizes_a_lone_genre() {
        let r = PaletteResults {
            query: "noir".into(),
            duration_ms: 5,
            genre_total: 1,
            ..Default::default()
        };
        assert_eq!(summary_line(&r), "1 genre \u{00b7} fts5 \u{00b7} 5ms");
    }

    #[test]
    fn summary_line_singularizes_and_omits_empty_categories() {
        let r = PaletteResults {
            query: "x".into(),
            duration_ms: 3,
            book_total: 0,
            author_total: 1,
            series_total: 0,
            tag_total: 1,
            ..Default::default()
        };
        assert_eq!(
            summary_line(&r),
            "1 author \u{00b7} 1 tag \u{00b7} fts5 \u{00b7} 3ms"
        );
    }

    fn tag(id: i64, name: &str) -> PaletteTagHit {
        PaletteTagHit {
            id,
            name: name.to_string(),
            book_count: 1,
        }
    }

    #[test]
    fn cut_note_speaks_only_when_an_opened_section_still_holds_back_hits() {
        let whole = PaletteResults {
            tags: (0..20).map(|i| tag(i, "fiction")).collect(),
            tag_total: 20,
            ..Default::default()
        };
        assert_eq!(cut_note(Section::Tags, &whole), None);

        let clamped = PaletteResults {
            tags: (0..3).map(|i| tag(i, "fiction")).collect(),
            tag_total: 812,
            ..Default::default()
        };
        let note = cut_note(Section::Tags, &clamped).unwrap();
        assert!(note.starts_with("Showing the first 3 of 812"), "{note}");
    }

    #[cfg(feature = "server")]
    mod render_tests {
        use super::*;
        use crate::test_support::render_in_vdom;
        use dioxus_router::{Routable, Router};

        #[derive(Clone, Debug, PartialEq, Routable)]
        enum ResultsRoute {
            #[route("/")]
            ResultsHost {},
        }

        #[component]
        fn ResultsHost() -> Element {
            // The palette's preview: five of twenty tags, and two authors
            // that are the whole of their section.
            let results = PaletteResults {
                query: "fiction".into(),
                tags: (0..5).map(|i| tag(i, &format!("fiction {i}"))).collect(),
                tag_total: 20,
                authors: (1..=2)
                    .map(|id| PaletteAuthorHit {
                        id,
                        name: format!("Author {id}"),
                        ..Default::default()
                    })
                    .collect(),
                author_total: 2,
                ..Default::default()
            };
            rsx! { SearchResults { results, query: "fiction".to_string() } }
        }

        #[test]
        fn a_section_holding_back_hits_offers_a_show_all_that_names_the_count() {
            let html = render_in_vdom(|| rsx! { Router::<ResultsRoute> {} });
            assert_eq!(html.matches("search-tag-row").count(), 5, "{html}");
            assert!(html.contains("search-show-all-results-tags"), "{html}");
            assert!(html.contains("Show all 20"), "{html}");
            assert!(html.contains(r#"aria-expanded="false""#), "{html}");
            // A section already whole has nothing to reach.
            assert!(!html.contains("search-show-all-results-authors"), "{html}");
        }
    }

    #[cfg(feature = "server")]
    #[test]
    fn search_page_first_paint_is_a_page_loader() {
        let html = crate::test_support::render_in_vdom(|| {
            rsx! { SearchPage { query: "dune".to_string() } }
        });
        assert!(html.contains("search-page"), "{html}");
        assert!(html.contains("ld-page"), "{html}");
        assert!(html.contains("Searching the shelves"), "{html}");
    }
}
