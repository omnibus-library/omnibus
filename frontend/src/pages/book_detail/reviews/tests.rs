//! Reviews section tests: the patches each write sends, what the card draws
//! before the server answers, and the section's markup in each load state.

use omnibus_shared::{AttributedReview, BookReviews, Review, ReviewBucket, ReviewPatch};

use super::mine::{rated_ago, rendered, stars_meta};
use super::others::{needs_read_more, split_others, spoiler_veiled};
use super::reviews_kicker;
use super::stars::half_star_label;
use super::summary::{average_label, spread_bars, spread_summary};
use super::writes::{apply_locally, stars_patch, text_patch};

fn review(stars: Option<f32>, body: Option<&str>, notes: Option<&str>) -> Review {
    Review {
        book_uuid: "book-1".into(),
        stars,
        body_md: body.map(str::to_string),
        body_html: body.map(|b| format!("<p>{b}</p>")),
        notes_md: notes.map(str::to_string),
        notes_html: notes.map(|n| format!("<p>{n}</p>")),
        spoiler: false,
        rated_at: stars.map(|_| 1_000),
        created_at: 1_000,
        updated_at: 1_000,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn other(user_id: i64, stars: Option<f32>, body: Option<&str>) -> AttributedReview {
    AttributedReview {
        user_id,
        username: format!("reader{user_id}"),
        has_avatar: false,
        stars,
        body_md: body.map(str::to_string),
        body_html: body.map(|b| format!("<p>{b}</p>")),
        spoiler: false,
        rated_at: stars.map(|_| 1_000),
        created_at: 1_000,
        updated_at: 1_779_019_200,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn buckets(readers: [i64; 10]) -> Vec<ReviewBucket> {
    (1..=10)
        .zip(readers)
        .map(|(half_stars, readers)| ReviewBucket {
            half_stars,
            readers,
        })
        .collect()
}

#[test]
fn stars_patch_sends_the_tapped_value_when_it_is_not_the_rating() {
    assert_eq!(stars_patch(None, 4.5).stars, Some(Some(4.5)));
    assert_eq!(stars_patch(Some(3.0), 4.5).stars, Some(Some(4.5)));
}

#[test]
fn stars_patch_clears_only_the_stars_when_the_rating_is_tapped_again() {
    let patch = stars_patch(Some(4.5), 4.5);
    assert_eq!(patch.stars, Some(None));
    assert_eq!(patch.body_md, None, "text must be left as it is");
    assert_eq!(patch.notes_md, None, "notes must be left as it is");
}

#[test]
fn text_patch_sends_only_the_fields_that_changed() {
    let patch = text_patch("Loved it", "", "Loved it", "Check chapter 3");
    assert_eq!(patch.body_md, None);
    assert_eq!(patch.notes_md, Some(Some("Check chapter 3".into())));
    assert_eq!(patch.stars, None, "a text save never touches the stars");
}

#[test]
fn text_patch_clears_a_field_emptied_to_whitespace() {
    let patch = text_patch("Loved it", "", "  \n", "");
    assert_eq!(patch.body_md, Some(None));
    assert_eq!(patch.notes_md, None);
}

#[test]
fn text_patch_is_empty_when_nothing_changed() {
    assert_eq!(text_patch("a", "b", "a", "b"), ReviewPatch::default());
    assert_eq!(text_patch("", "", " ", ""), ReviewPatch::default());
}

#[test]
fn apply_locally_starts_a_review_from_a_first_rating() {
    let patch = stars_patch(None, 4.0);
    let drawn = apply_locally(None, &patch, "book-1", 2_000).expect("a rating is a review");
    assert_eq!(drawn.stars, Some(4.0));
    assert_eq!(drawn.rated_at, Some(2_000));
    assert_eq!(drawn.book_uuid, "book-1");
}

#[test]
fn apply_locally_keeps_the_text_when_the_stars_are_cleared() {
    let mine = review(Some(4.0), Some("Loved it"), None);
    let drawn = apply_locally(Some(mine), &stars_patch(Some(4.0), 4.0), "book-1", 2_000)
        .expect("text keeps the review");
    assert_eq!(drawn.stars, None);
    assert_eq!(drawn.rated_at, None);
    assert_eq!(drawn.body_md.as_deref(), Some("Loved it"));
}

#[test]
fn apply_locally_empties_a_review_left_with_nothing() {
    let mine = review(Some(4.0), None, None);
    assert_eq!(
        apply_locally(Some(mine), &stars_patch(Some(4.0), 4.0), "book-1", 2_000),
        None
    );
}

#[test]
fn apply_locally_flags_the_spoiler() {
    let mine = review(None, Some("The butler did it"), None);
    let patch = ReviewPatch {
        spoiler: Some(true),
        ..Default::default()
    };
    let drawn = apply_locally(Some(mine), &patch, "book-1", 2_000).expect("still a review");
    assert!(drawn.spoiler);
}

#[test]
fn reviews_kicker_counts_texts_and_ratings_including_yours() {
    let reviews = BookReviews {
        mine: Some(review(Some(4.0), Some("Mine"), None)),
        others: vec![
            other(2, Some(3.0), Some("Theirs")),
            other(3, Some(5.0), None),
        ],
        summary: None,
    };
    assert_eq!(reviews_kicker(&reviews), "2 reviews \u{b7} 3 ratings");
}

#[test]
fn reviews_kicker_ignores_notes_and_says_when_there_is_nothing() {
    let reviews = BookReviews {
        mine: Some(review(None, None, Some("private"))),
        others: vec![],
        summary: None,
    };
    assert_eq!(reviews_kicker(&reviews), "No reviews yet");
}

#[test]
fn stars_meta_reports_a_refused_save_before_anything_else() {
    let mine = review(Some(4.0), None, None);
    assert_eq!(
        stars_meta(1_000, true, Some(&mine)),
        "Couldn\u{2019}t save your rating \u{2014} try again"
    );
}

#[test]
fn stars_meta_states_the_rating_and_its_age() {
    let mine = review(Some(4.5), None, None);
    assert_eq!(
        stars_meta(1_000 + 2 * 86_400, false, Some(&mine)),
        "rated 2 days ago \u{b7} 4.5 of 5"
    );
}

#[test]
fn stars_meta_says_not_rated_for_text_without_stars() {
    let mine = review(None, Some("Loved it"), None);
    assert_eq!(stars_meta(1_000, false, Some(&mine)), "Not rated yet");
    assert_eq!(stars_meta(1_000, false, None), "Not rated yet");
}

#[test]
fn rated_ago_singularizes_and_pluralizes() {
    assert_eq!(rated_ago(1_000, 999), "rated just now");
    assert_eq!(rated_ago(1_060, 1_000), "rated 1 minute ago");
    assert_eq!(rated_ago(1_000 + 3 * 3600, 1_000), "rated 3 hours ago");
    assert_eq!(rated_ago(172_800, 86_400), "rated 1 day ago");
}

#[test]
fn half_star_label_announces_the_clear_on_the_active_value() {
    assert_eq!(half_star_label(3.0, Some(3.0)), "Clear your 3-star rating");
    assert_eq!(half_star_label(3.0, Some(2.5)), "Rate 3 stars");
    assert_eq!(half_star_label(1.0, None), "Rate 1 star");
    assert_eq!(half_star_label(0.5, None), "Rate 0.5 stars");
}

#[test]
fn rendered_falls_back_to_escaped_source_until_the_server_renders() {
    assert_eq!(
        rendered(Some("a"), Some("<p>a</p>")).as_deref(),
        Some("<p>a</p>")
    );
    assert_eq!(rendered(Some("<b>"), None).as_deref(), Some("&lt;b&gt;"));
    assert_eq!(rendered(None, None), None);
}

#[test]
fn split_others_keeps_the_server_order_within_each_group() {
    let (texts, ratings) = split_others(vec![
        other(1, Some(4.0), Some("first")),
        other(2, None, Some("second")),
        other(3, Some(5.0), None),
        other(4, Some(2.0), None),
    ]);
    assert_eq!(texts.iter().map(|r| r.user_id).collect::<Vec<_>>(), [1, 2]);
    assert_eq!(
        ratings.iter().map(|r| r.user_id).collect::<Vec<_>>(),
        [3, 4]
    );
}

#[test]
fn spoiler_veiled_holds_until_revealed_or_finished() {
    assert!(spoiler_veiled(true, false, false));
    assert!(
        !spoiler_veiled(true, true, false),
        "a finished reader sees it"
    );
    assert!(!spoiler_veiled(true, false, true), "a reveal opens it");
    assert!(!spoiler_veiled(false, false, false), "no flag, no veil");
}

#[test]
fn needs_read_more_clips_long_or_many_lined_text() {
    assert!(!needs_read_more("A short review."));
    assert!(needs_read_more(&"x".repeat(421)));
    assert!(needs_read_more("a\nb\nc\nd\ne\nf\ng"));
    assert!(!needs_read_more("a\nb\nc\nd\ne\nf"));
}

#[test]
fn average_label_rounds_to_one_decimal() {
    assert_eq!(average_label(4.333), "4.3");
    assert_eq!(average_label(4.0), "4.0");
    assert_eq!(average_label(3.96), "4.0");
}

#[test]
fn spread_bars_scale_to_the_fullest_bucket_and_label_whole_stars() {
    let bars = spread_bars(&buckets([0, 0, 0, 0, 0, 1, 0, 2, 0, 0]));
    assert_eq!(bars.len(), 10);
    assert_eq!(bars[7].height_pct, 100, "4 stars is the fullest");
    assert_eq!(bars[5].height_pct, 50);
    assert_eq!(bars[0].height_pct, 0);
    assert_eq!(bars[0].label, "", "half stars go unlabelled");
    assert_eq!(bars[1].label, "1");
    assert_eq!(bars[9].label, "5");
    assert_eq!(bars[8].title, "4.5 \u{2605} \u{b7} 0 readers");
}

#[test]
fn spread_summary_names_each_value_given() {
    assert_eq!(
        spread_summary(&buckets([0, 0, 0, 0, 0, 1, 0, 2, 0, 0])),
        "Ratings by stars: 1 reader at 3, 2 readers at 4."
    );
    assert_eq!(spread_summary(&buckets([0; 10])), "Ratings by stars: none.");
}

// Markup in each load state. SSR (`dioxus::ssr`) needs the `server` feature.
#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;
    use omnibus_shared::ReviewSummary;

    use super::*;
    use crate::pages::book_detail::reviews::composer::{BdReviewComposer, ComposerSeed};
    use crate::pages::book_detail::reviews::{BdReviewsJumpLink, BdReviewsSection, ReviewsCtx};
    use crate::pages::book_detail::rule_facts::RuleFactsSaved;
    use crate::pages::book_detail::FeedState;
    use crate::test_support::render_in_vdom;

    fn ctx(reviews: Option<BookReviews>, feed: FeedState, finished: bool) -> ReviewsCtx {
        ReviewsCtx {
            reviews: Signal::new(reviews),
            feed: Signal::new(feed),
            finished: Signal::new(finished),
            op_seq: Signal::new(0),
            refresh_seq: Signal::new(0),
            refreshing: Signal::new(false),
            refresh_failed: Signal::new(false),
            failure: Signal::new(None),
            saved: RuleFactsSaved::new(),
        }
    }

    fn section(reviews: Option<BookReviews>, feed: FeedState, finished: bool) -> Element {
        rsx! {
            BdReviewsSection { uuid: "book-1".to_string(), ctx: ctx(reviews, feed, finished) }
        }
    }

    fn summary() -> ReviewSummary {
        ReviewSummary {
            average_stars: 4.333,
            ratings: 3,
            buckets: buckets([0, 0, 0, 0, 0, 0, 0, 2, 0, 1]),
        }
    }

    fn written() -> BookReviews {
        let mut mine = review(Some(4.5), Some("Loved the ending"), Some("Reread part two"));
        mine.spoiler = true;
        BookReviews {
            mine: Some(mine),
            others: vec![],
            summary: None,
        }
    }

    fn empty() -> BookReviews {
        BookReviews {
            mine: None,
            others: vec![],
            summary: None,
        }
    }

    fn spoiled(finished: bool) -> Element {
        let mut theirs = other(2, Some(4.0), Some("The butler did it"));
        theirs.spoiler = true;
        let reviews = BookReviews {
            mine: None,
            others: vec![theirs],
            summary: None,
        };
        section(Some(reviews), FeedState::Loaded, finished)
    }

    fn mixed() -> BookReviews {
        BookReviews {
            mine: None,
            others: vec![
                other(2, Some(4.0), Some("Worth it")),
                other(3, Some(5.0), None),
                other(4, Some(2.5), None),
            ],
            summary: None,
        }
    }

    // Unknown is not unrated (rule 12): no card, no "Not rated yet", until the answer.
    #[test]
    fn reviews_section_draws_the_loader_rather_than_an_unrated_card_before_the_answer() {
        let html = render_in_vdom(|| section(None, FeedState::Pending, false));
        assert!(html.contains("data-testid=\"reviews-loading\""), "{html}");
        assert!(!html.contains("Not rated yet"), "{html}");
        assert!(!html.contains("data-testid=\"my-review\""), "{html}");
    }

    #[test]
    fn reviews_section_says_so_when_the_reviews_failed_to_load() {
        let html = render_in_vdom(|| section(None, FeedState::Failed, false));
        assert!(html.contains("data-testid=\"reviews-error\""), "{html}");
        assert!(!html.contains("data-testid=\"reviews-loading\""), "{html}");
    }

    #[test]
    fn my_review_offers_to_write_one_when_there_is_none() {
        let html = render_in_vdom(|| section(Some(empty()), FeedState::Loaded, false));
        assert!(html.contains("Not rated yet"), "{html}");
        assert!(html.contains("Write review"), "{html}");
        assert!(!html.contains("data-testid=\"review-delete\""), "{html}");
        assert!(!html.contains("data-testid=\"review-spoiler\""), "{html}");
        assert!(
            html.contains("data-testid=\"other-reviews-empty\""),
            "{html}"
        );
    }

    #[test]
    fn my_review_shows_its_text_spoiler_box_and_private_notes() {
        let html = render_in_vdom(|| section(Some(written()), FeedState::Loaded, false));
        assert!(html.contains("<p>Loved the ending</p>"), "{html}");
        assert!(html.contains("data-testid=\"review-spoiler\""), "{html}");
        assert!(html.contains("checked"), "{html}");
        assert!(html.contains("data-testid=\"my-review-notes\""), "{html}");
        assert!(html.contains("only you can see these"), "{html}");
        assert!(html.contains("Edit review"), "{html}");
        assert!(html.contains("data-testid=\"review-delete\""), "{html}");
        assert!(
            html.contains("aria-label=\"Clear your 4.5-star rating\""),
            "{html}"
        );
    }

    #[test]
    fn other_review_keeps_a_spoiler_behind_its_reveal_but_shows_the_stars() {
        let html = render_in_vdom(|| spoiled(false));
        assert!(
            html.contains("data-testid=\"review-spoiler-veil\""),
            "{html}"
        );
        assert!(!html.contains("The butler did it"), "{html}");
        assert!(html.contains("4 out of 5 stars"), "{html}");
    }

    #[test]
    fn other_review_opens_a_spoiler_for_a_reader_who_finished_the_book() {
        let html = render_in_vdom(|| spoiled(true));
        assert!(html.contains("The butler did it"), "{html}");
        assert!(
            !html.contains("data-testid=\"review-spoiler-veil\""),
            "{html}"
        );
    }

    #[test]
    fn stars_only_ratings_gather_into_one_row_apart_from_the_text_reviews() {
        let html = render_in_vdom(|| section(Some(mixed()), FeedState::Loaded, false));
        let count = |needle: &str| html.matches(needle).count();
        assert_eq!(count("data-testid=\"review-card\""), 1, "{html}");
        assert_eq!(count("data-testid=\"review-stars-only\""), 1, "{html}");
        assert_eq!(count("data-testid=\"review-stars-only-item\""), 2, "{html}");
    }

    #[test]
    fn summary_renders_only_when_the_server_sent_one() {
        let without = render_in_vdom(|| section(Some(written()), FeedState::Loaded, false));
        assert!(
            !without.contains("data-testid=\"review-summary\""),
            "{without}"
        );

        let html = render_in_vdom(|| {
            let mut reviews = written();
            reviews.summary = Some(summary());
            section(Some(reviews), FeedState::Loaded, false)
        });
        assert!(html.contains("data-testid=\"review-summary\""), "{html}");
        assert!(html.contains("4.3"), "{html}");
        assert!(html.contains("3 readers in the household"), "{html}");
        assert_eq!(html.matches("bd-review-spread-col").count(), 10, "{html}");
    }

    #[test]
    fn jump_link_states_the_household_rating_and_is_absent_without_one() {
        let html = render_in_vdom(|| {
            rsx! { BdReviewsJumpLink { summary: summary(), on_jump: move |_| {} } }
        });
        assert!(html.contains("data-testid=\"reviews-jump\""), "{html}");
        assert!(html.contains("4.3 \u{b7} 3 readers"), "{html}");

        let none = render_in_vdom(|| {
            rsx! { BdReviewsJumpLink { summary: None, on_jump: move |_| {} } }
        });
        assert!(!none.contains("reviews-jump"), "{none}");
    }

    #[test]
    fn composer_offers_public_text_and_private_notes_seeded_from_the_saved_review() {
        let html = render_in_vdom(|| {
            rsx! {
                BdReviewComposer {
                    uuid: "book-1".to_string(),
                    ctx: ctx(Some(written()), FeedState::Loaded, false),
                    seed: ComposerSeed {
                        body: "Loved the ending".into(),
                        notes: "Reread part two".into(),
                    },
                    open: Signal::new(true),
                }
            }
        });
        assert!(html.contains("aria-label=\"Review text\""), "{html}");
        assert!(html.contains("aria-label=\"Private notes\""), "{html}");
        assert!(html.contains("only you can see these"), "{html}");
        assert!(html.contains("Loved the ending"), "{html}");
        assert!(html.contains("Reread part two"), "{html}");
        // Each field inserts from highlights into its own editor.
        assert!(html.contains("review-body-insert-highlight"), "{html}");
        assert!(html.contains("review-notes-insert-highlight"), "{html}");
        assert!(html.contains("Save review"), "{html}");
    }
}
