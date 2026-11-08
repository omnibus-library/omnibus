use super::*;

const TITLE: &str = "Dracula";
const AUTHOR: &str = "Bram Stoker";

fn release(title: &str) -> ProwlarrRelease {
    ProwlarrRelease {
        guid: title.to_string(),
        title: title.to_string(),
        size_bytes: Some(1_000_000),
        seeders: Some(10),
        protocol: None,
        info_url: None,
        indexer: Some("books".to_string()),
        link: "magnet:?xt=urn:btih:abc".to_string(),
        categories: vec![7020],
        files: None,
    }
}

fn ranked(releases: Vec<ProwlarrRelease>) -> Vec<Ranked> {
    rank(releases, TITLE, AUTHOR, false)
}

fn kept_titles(releases: Vec<ProwlarrRelease>) -> Vec<String> {
    ranked(releases)
        .into_iter()
        .filter(|r| !r.rejected)
        .map(|r| r.release.title)
        .collect()
}

fn is_dropped(release: ProwlarrRelease) -> bool {
    let title = release.title.clone();
    let all = ranked(vec![release]);
    all.iter()
        .find(|r| r.release.title == title)
        .unwrap()
        .rejected
}

mod drop_rules {
    use super::*;

    #[test]
    fn drops_a_release_outside_the_book_categories() {
        let mut audio = release("Dracula - Bram Stoker EPUB");
        audio.categories = vec![3030];

        assert!(is_dropped(audio));
    }

    #[test]
    fn keeps_a_release_in_another_book_category() {
        let mut comic = release("Dracula - Bram Stoker CBZ");
        comic.categories = vec![7030];

        assert!(!is_dropped(comic));
    }

    #[test]
    fn drops_a_release_nobody_is_seeding() {
        let mut dead = release("Dracula - Bram Stoker EPUB");
        dead.seeders = Some(0);

        assert!(is_dropped(dead));
    }

    #[test]
    fn drops_a_release_whose_seeder_count_is_negative() {
        let mut odd = release("Dracula - Bram Stoker EPUB");
        odd.seeders = Some(-2);

        assert!(is_dropped(odd));
    }

    #[test]
    fn drops_a_usenet_release() {
        let mut usenet = release("Dracula - Bram Stoker EPUB");
        usenet.protocol = Some(ReleaseProtocol::Usenet);

        assert!(is_dropped(usenet));
    }

    #[test]
    fn keeps_a_torrent_release() {
        let mut torrent = release("Dracula - Bram Stoker EPUB");
        torrent.protocol = Some(ReleaseProtocol::Torrent);

        assert!(!is_dropped(torrent));
    }

    #[test]
    fn keeps_a_release_that_reports_no_seeders_at_all() {
        let mut usenet = release("Dracula - Bram Stoker EPUB");
        usenet.seeders = None;

        assert!(!is_dropped(usenet));
    }

    #[test]
    fn drops_a_release_below_fifty_kilobytes_but_keeps_one_at_exactly_that_size() {
        let mut tiny = release("Dracula - Bram Stoker EPUB");
        tiny.size_bytes = Some(50 * 1024 - 1);
        let mut least = release("Dracula - Bram Stoker EPUB");
        least.size_bytes = Some(50 * 1024);

        assert!(is_dropped(tiny));
        assert!(!is_dropped(least));
    }

    #[test]
    fn drops_a_release_over_a_hundred_megabytes_but_keeps_one_at_exactly_that_size() {
        let mut huge = release("Dracula - Bram Stoker EPUB");
        huge.size_bytes = Some(100 * 1024 * 1024 + 1);
        let mut most = release("Dracula - Bram Stoker EPUB");
        most.size_bytes = Some(100 * 1024 * 1024);

        assert!(is_dropped(huge));
        assert!(!is_dropped(most));
    }

    #[test]
    fn drops_a_release_that_names_only_a_format_omnibus_cannot_read() {
        assert!(is_dropped(release("Dracula - Bram Stoker [MOBI]")));
        assert!(is_dropped(release("Dracula - Bram Stoker azw3")));
    }

    #[test]
    fn keeps_a_release_that_names_a_readable_format_beside_an_unreadable_one() {
        assert!(!is_dropped(release("Dracula - Bram Stoker EPUB MOBI")));
    }

    #[test]
    fn drops_a_release_whose_title_is_another_book() {
        assert!(is_dropped(release("Frankenstein - Bram Stoker EPUB")));
    }

    #[test]
    fn drops_a_release_that_never_names_the_author() {
        assert!(is_dropped(release("Dracula EPUB")));
    }

    #[test]
    fn matches_the_author_whichever_way_round_the_name_is_written() {
        let all = rank(
            vec![release("Dracula - Stoker, Bram EPUB")],
            TITLE,
            "Stoker, Bram",
            false,
        );

        assert!(!all[0].rejected);
    }

    #[test]
    fn keeps_a_dropped_release_in_the_result_after_every_kept_one() {
        let mut dead = release("Dracula - Bram Stoker PDF");
        dead.seeders = Some(0);

        let all = ranked(vec![dead, release("Dracula - Bram Stoker EPUB")]);

        let rejected: Vec<bool> = all.iter().map(|r| r.rejected).collect();
        assert_eq!(rejected, [false, true]);
    }
}

mod ordering {
    use super::*;

    #[test]
    fn puts_a_closer_title_match_above_a_better_format() {
        let order = kept_titles(vec![
            release("Bram Stoker - Dracula (Annotated) EPUB"),
            release("Dracula - Bram Stoker PDF"),
        ]);

        assert_eq!(order[0], "Dracula - Bram Stoker PDF");
    }

    #[test]
    fn orders_formats_epub_then_pdf_then_cbz_then_unnamed() {
        let order = kept_titles(vec![
            release("Dracula - Bram Stoker"),
            release("Dracula - Bram Stoker CBZ"),
            release("Dracula - Bram Stoker PDF"),
            release("Dracula - Bram Stoker EPUB"),
        ]);

        assert_eq!(
            order,
            [
                "Dracula - Bram Stoker EPUB",
                "Dracula - Bram Stoker PDF",
                "Dracula - Bram Stoker CBZ",
                "Dracula - Bram Stoker",
            ]
        );
    }

    #[test]
    fn puts_another_language_below_english_and_unlabelled_ones() {
        let order = kept_titles(vec![
            release("Dracula - Bram Stoker EPUB German"),
            release("Dracula - Bram Stoker EPUB English"),
        ]);

        assert_eq!(order[1], "Dracula - Bram Stoker EPUB German");
    }

    #[test]
    fn puts_a_retail_release_above_an_otherwise_equal_one() {
        let order = kept_titles(vec![
            release("Dracula - Bram Stoker EPUB"),
            release("Dracula - Bram Stoker EPUB retail"),
        ]);

        assert_eq!(order[0], "Dracula - Bram Stoker EPUB retail");
    }

    #[test]
    fn puts_the_better_seeded_release_first_when_all_else_is_equal() {
        let mut busy = release("Dracula - Bram Stoker EPUB busy");
        busy.seeders = Some(500);
        let quiet = release("Dracula - Bram Stoker EPUB quiet");

        let order = kept_titles(vec![quiet, busy]);

        assert_eq!(order[0], "Dracula - Bram Stoker EPUB busy");
    }

    #[test]
    fn puts_the_release_far_from_the_median_size_last() {
        let mut odd = release("Dracula - Bram Stoker EPUB odd");
        odd.size_bytes = Some(20_000_000);
        let usual = release("Dracula - Bram Stoker EPUB usual");
        let mut also_usual = release("Dracula - Bram Stoker EPUB also usual");
        also_usual.size_bytes = Some(1_100_000);

        let order = kept_titles(vec![odd, usual, also_usual]);

        assert_eq!(order[2], "Dracula - Bram Stoker EPUB odd");
    }

    #[test]
    fn puts_a_multi_file_release_below_every_single_file_one() {
        let mut pack = release("Dracula - Bram Stoker EPUB retail pack");
        pack.files = Some(3);
        pack.seeders = Some(5_000);
        let single_cbz = release("Dracula - Bram Stoker CBZ");

        let order = kept_titles(vec![pack, single_cbz]);

        assert_eq!(order[1], "Dracula - Bram Stoker EPUB retail pack");
    }

    #[test]
    fn does_not_penalise_a_release_that_reports_a_single_file() {
        let mut one = release("Dracula - Bram Stoker EPUB retail");
        one.files = Some(1);
        let plain = release("Dracula - Bram Stoker EPUB");

        let order = kept_titles(vec![plain, one]);

        assert_eq!(order[0], "Dracula - Bram Stoker EPUB retail");
    }
}

mod best_match {
    use super::*;

    #[test]
    fn marks_only_the_top_release_when_it_is_a_strong_match() {
        let all = ranked(vec![
            release("Dracula - Bram Stoker PDF"),
            release("Dracula - Bram Stoker EPUB"),
        ]);

        let badges: Vec<bool> = all.iter().map(|r| r.best_match).collect();
        assert_eq!(badges, [true, false]);
        assert_eq!(all[0].release.title, "Dracula - Bram Stoker EPUB");
    }

    #[test]
    fn marks_nothing_when_even_the_top_release_is_a_weak_match() {
        let all = ranked(vec![release("Bram Stoker - Dracula (Annotated) CBZ")]);

        assert!(!all[0].best_match);
    }

    #[test]
    fn never_marks_a_dropped_release() {
        let mut dead = release("Dracula - Bram Stoker EPUB");
        dead.seeders = Some(0);

        assert!(!ranked(vec![dead])[0].best_match);
    }
}

mod format_label {
    use super::*;

    #[test]
    fn names_the_format_in_capitals_and_leaves_an_unnamed_one_empty() {
        let all = ranked(vec![
            release("Dracula - Bram Stoker epub"),
            release("Dracula - Bram Stoker"),
        ]);

        assert_eq!(all[0].format.as_deref(), Some("EPUB"));
        assert_eq!(all[1].format, None);
    }
}

mod convertible_formats {
    use super::*;

    fn ranked_convertible(releases: Vec<ProwlarrRelease>) -> Vec<Ranked> {
        rank(releases, TITLE, AUTHOR, true)
    }

    fn kept_convertible(releases: Vec<ProwlarrRelease>) -> Vec<String> {
        ranked_convertible(releases)
            .into_iter()
            .filter(|r| !r.rejected)
            .map(|r| r.release.title)
            .collect()
    }

    fn format_of_only(title: &str, convertible: bool) -> Option<String> {
        let all = rank(vec![release(title)], TITLE, AUTHOR, convertible);
        assert!(!all[0].rejected, "{title} was dropped");
        all[0].format.clone()
    }

    #[test]
    fn keeps_azw3_and_mobi_with_their_own_format_label_when_convertible() {
        assert_eq!(
            format_of_only("Dracula - Bram Stoker AZW3", true).as_deref(),
            Some("AZW3")
        );
        assert_eq!(
            format_of_only("Dracula - Bram Stoker [MOBI]", true).as_deref(),
            Some("MOBI")
        );
    }

    #[test]
    fn drops_azw3_and_mobi_when_not_convertible() {
        let all = rank(
            vec![
                release("Dracula - Bram Stoker AZW3"),
                release("Dracula - Bram Stoker [MOBI]"),
            ],
            TITLE,
            AUTHOR,
            false,
        );

        assert!(all.iter().all(|r| r.rejected));
    }

    #[test]
    fn orders_formats_epub_then_azw3_and_mobi_then_pdf_then_cbz_then_unnamed() {
        let order = kept_convertible(vec![
            release("Dracula - Bram Stoker"),
            release("Dracula - Bram Stoker CBZ"),
            release("Dracula - Bram Stoker PDF"),
            release("Dracula - Bram Stoker MOBI"),
            release("Dracula - Bram Stoker AZW3"),
            release("Dracula - Bram Stoker EPUB"),
        ]);

        let mut converted = order[1..3].to_vec();
        converted.sort();
        assert_eq!(
            (&order[0], converted, &order[3..]),
            (
                &"Dracula - Bram Stoker EPUB".to_string(),
                vec![
                    "Dracula - Bram Stoker AZW3".to_string(),
                    "Dracula - Bram Stoker MOBI".to_string()
                ],
                &[
                    "Dracula - Bram Stoker PDF".to_string(),
                    "Dracula - Bram Stoker CBZ".to_string(),
                    "Dracula - Bram Stoker".to_string(),
                ][..]
            )
        );
    }

    #[test]
    fn lets_a_far_closer_title_match_beat_a_better_format() {
        let order = kept_convertible(vec![
            release("Bram Stoker - Dracula (Annotated) EPUB"),
            release("Dracula - Bram Stoker AZW3"),
        ]);

        assert_eq!(order[0], "Dracula - Bram Stoker AZW3");
    }

    #[test]
    fn keeps_azw_and_azw4_dropped_when_convertible() {
        let all = ranked_convertible(vec![
            release("Dracula - Bram Stoker AZW"),
            release("Dracula - Bram Stoker AZW4"),
        ]);

        assert!(all.iter().all(|r| r.rejected));
    }

    #[test]
    fn labels_a_title_naming_several_formats_with_the_one_worth_the_most() {
        assert_eq!(
            format_of_only("Dracula - Bram Stoker EPUB MOBI", true).as_deref(),
            Some("EPUB")
        );
        assert_eq!(
            format_of_only("Dracula - Bram Stoker PDF AZW3", true).as_deref(),
            Some("AZW3")
        );
        assert_eq!(
            format_of_only("Dracula - Bram Stoker PDF AZW3", false).as_deref(),
            Some("PDF")
        );
    }
}

mod names_convertible {
    use super::*;

    #[test]
    fn is_true_only_when_a_title_names_azw3_or_mobi() {
        let plain = vec![
            release("Dracula - Bram Stoker EPUB"),
            release("Dracula - Bram Stoker PDF"),
        ];
        let with_mobi = vec![
            release("Dracula - Bram Stoker EPUB"),
            release("Dracula - Bram Stoker [MOBI]"),
        ];

        assert!(!names_convertible(&plain));
        assert!(names_convertible(&with_mobi));
    }
}
