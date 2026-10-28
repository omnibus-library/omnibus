use omnibus_shared::cross_format::MappingConfidence;
use omnibus_shared::ProgressFormat;

use super::*;

fn candidate(source_ahead: Option<bool>) -> CrossFormatCandidate {
    CrossFormatCandidate {
        target: ProgressFormat::Epub,
        source_format: ProgressFormat::Audio,
        source_client_updated_at: 100,
        confidence: MappingConfidence::ChapterAnchored,
        book_file_id: Some(917),
        audio_position_seconds: Some(3_725.0),
        total_duration_seconds: Some(35_760.0),
        percent: Some(42),
        fraction: Some(0.425),
        epub_cfi: None,
        source_position_seconds: None,
        source_ahead,
    }
}

fn resume(state: CrossFormatResumeState, follow: bool) -> CrossFormatResume {
    CrossFormatResume {
        state,
        candidate: Some(candidate(Some(true))),
        follow,
    }
}

#[test]
fn offer_candidate_returns_the_candidate_when_follow_is_off() {
    let offered = offer_candidate(resume(CrossFormatResumeState::Candidate, false));
    assert_eq!(offered, Some(candidate(Some(true))));
}

#[test]
fn offer_candidate_returns_none_when_follow_is_on() {
    // Follow on resolves at open instead; an offer would ask about a move
    // that has already happened.
    assert_eq!(
        offer_candidate(resume(CrossFormatResumeState::Candidate, true)),
        None
    );
}

#[test]
fn offer_candidate_returns_none_when_the_formats_are_already_aligned() {
    // `aligned` still carries a candidate, but the jump would not move anyone.
    assert_eq!(
        offer_candidate(resume(CrossFormatResumeState::Aligned, false)),
        None
    );
}

#[test]
fn should_offer_re_arms_only_once_the_source_clock_passes_the_answered_one() {
    assert!(should_offer(100, None));
    assert!(!should_offer(100, Some(100)));
    assert!(should_offer(101, Some(100)));
}

#[test]
fn reader_offer_copy_says_further_when_the_listening_is_ahead_or_unknown() {
    let (title, detail) = reader_offer_copy(&candidate(None)).expect("copy");
    assert_eq!(title, "Listened further in the audiobook");
    assert_eq!(detail, "Your listening maps to about 42% through.");
}

#[test]
fn reader_offer_copy_says_earlier_when_the_listening_is_behind() {
    let (title, detail) = reader_offer_copy(&candidate(Some(false))).expect("copy");
    assert_eq!(title, "Audiobook is earlier in the book");
    assert!(detail.contains("before this page"), "{detail}");
}

#[test]
fn player_offer_copy_names_the_mapped_time_and_its_direction() {
    let (title, detail) = player_offer_copy(&candidate(Some(true))).expect("copy");
    assert_eq!(title, "Read further in the ebook");
    assert_eq!(detail, "Your reading maps to about 1:02:05.");
    let (behind, _) = player_offer_copy(&candidate(Some(false))).expect("copy");
    assert_eq!(behind, "Re-reading earlier in the ebook");
}
