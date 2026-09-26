//! Per-resume-point derivations shared across surfaces. The label half —
//! percent/remaining for audio, the plain continue affordance for epub rows
//! with no stored percent — is read by the mobile resume card and the web
//! continue fan; the stats in-progress list phrases its own and takes only
//! [`resume_key`], which every keyed list of open books shares.

use omnibus_shared::{ProgressFormat, ResumePoint, StructuralPosition};

use crate::pages::listen::remaining_at_rate;

/// The point's key in a keyed list of resume points.
///
/// Progress is stored `UNIQUE(user_id, book_uuid, format)`, so one book open
/// in both formats is two points — the uuid alone is not unique across such a
/// list, and duplicate keyed siblings corrupt Dioxus's keyed diff (#2633,
/// rule 07).
///
/// Keyed on the **progress row's own** `book_uuid`, never on the resolved
/// `point.book`: `get_book_by_uuid` falls back through `merged_uuids`, so two
/// rows filed under different uuids can resolve to one surviving book and
/// would key alike again.
pub(crate) fn resume_key(point: &ResumePoint) -> String {
    format!(
        "{}:{}",
        point.record.book_uuid,
        point.record.format.as_str()
    )
}

/// Meta line + progress percentage for a resume point. Audio rows with known
/// totals get "Ch. N · 42% · 7h 50m left" — the "left" span rate-adjusted by
/// the saved playback rate, matching the player's readouts; audio without
/// totals falls back to the raw position; epub rows read as a plain continue
/// affordance.
pub(super) fn resume_meta(point: &ResumePoint) -> (String, Option<i64>) {
    if point.record.format == ProgressFormat::Epub {
        // A stored whole-book percent (a Kobo's write, the comic pager's
        // page/count mapping, or the percent the server derives for a web
        // CFI write) is honest enough for a bar; a bare CFI is not.
        return match point.record.progress_percent {
            Some(pct) => (format!("{pct}% \u{00b7} Continue reading"), Some(pct)),
            None => ("Continue reading".to_string(), None),
        };
    }
    let pos = point.record.audio_position_seconds.unwrap_or(0.0);
    match point.record.total_duration_seconds.filter(|t| *t > 0.0) {
        Some(total) => {
            // Clamped to 0..=100 above, so the cast is in-range (NaN → 0).
            #[allow(clippy::cast_possible_truncation)]
            let pct = ((pos / total).clamp(0.0, 1.0) * 100.0).round() as i64;
            let left = format_hm_left(remaining_at_rate(
                (total - pos).max(0.0),
                point.playback_rate.unwrap_or(1.0),
            ));
            // A confidently resolved chapter reads as one; the container's
            // marks read as a part, because for a novel stored as four M4B
            // files that is what they are.
            let ch = match point.structural_position() {
                Some(StructuralPosition::Chapter { ordinal, .. }) => {
                    format!("Ch. {ordinal} \u{00b7} ")
                }
                Some(StructuralPosition::Part { ordinal, .. }) => {
                    format!("Pt. {ordinal} \u{00b7} ")
                }
                None => String::new(),
            };
            (format!("{ch}{pct}% \u{00b7} {left} left"), Some(pct))
        }
        None => (format!("{} in", format_hms_short(pos)), None),
    }
}

/// `7h 50m` / `50m` label for a remaining-seconds span.
pub(super) fn format_hm_left(seconds: f64) -> String {
    // Durations are finite and non-negative at both call sites; the clamp
    // keeps an absurd input from saturating the cast.
    #[allow(clippy::cast_possible_truncation)]
    let total_min = (seconds / 60.0).round().clamp(0.0, f64::from(i32::MAX)) as i64;
    let h = total_min / 60;
    let m = total_min % 60;
    if h > 0 {
        format!("{h}h {m:02}m")
    } else {
        format!("{m}m")
    }
}

/// `H:MM:SS` (or `M:SS`) for an absolute position.
pub(super) fn format_hms_short(seconds: f64) -> String {
    // The finite/positive guard plus the clamp keep the cast in-range.
    #[allow(clippy::cast_possible_truncation)]
    let s = if seconds.is_finite() && seconds > 0.0 {
        seconds.min(f64::from(i32::MAX)) as i64
    } else {
        0
    };
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    if h > 0 {
        format!("{h}:{m:02}:{sec:02}")
    } else {
        format!("{m}:{sec:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use omnibus_shared::{EbookMetadata, PositionConfidence, ProgressRecord, ResolvedPosition};

    fn point(format: ProgressFormat, pos: Option<f64>, total: Option<f64>) -> ResumePoint {
        ResumePoint {
            record: ProgressRecord {
                book_uuid: "u".into(),
                format,
                epub_cfi: None,
                audio_position_seconds: pos,
                progress_percent: None,
                kobo_location: None,
                book_file_id: None,
                updated_at: 0,
                client_updated_at: 0,
                total_duration_seconds: total,
                resolved: None,
                derived_epub_cfi: None,
            },
            book: EbookMetadata::default(),
            linked: false,
            cross_format: None,
            audio_part: Some(3),
            audio_part_count: Some(10),
            playback_rate: None,
        }
    }

    /// A confidently resolved chapter, as the server sends one.
    fn resolved(ordinal: i64, confidence: PositionConfidence) -> ResolvedPosition {
        ResolvedPosition {
            spine_index: None,
            chapter_title: Some("The Middle".into()),
            chapter_ordinal: Some(ordinal),
            chapters_total: Some(24),
            percent_through_chapter: Some(10),
            percent_through_book: Some(50),
            confidence,
        }
    }

    #[test]
    fn resume_meta_reports_percent_and_time_left_for_audio_with_total() {
        let mut p = point(ProgressFormat::Audio, Some(3600.0), Some(7200.0));
        p.record.resolved = Some(resolved(7, PositionConfidence::High));
        let (meta, pct) = resume_meta(&p);
        assert_eq!(pct, Some(50));
        assert_eq!(meta, "Ch. 7 \u{00b7} 50% \u{00b7} 1h 00m left");
    }

    #[test]
    fn resume_meta_names_a_part_rather_than_a_chapter_for_container_marks() {
        // The marks on a novel stored as ten M4B files are parts. Calling
        // part 3 of 10 "Ch. 3" is the readout this rename exists to end — and
        // a low-confidence resolved block is demoted to the same readout,
        // because that is what it actually measured.
        let plain = point(ProgressFormat::Audio, Some(3600.0), Some(7200.0));
        assert_eq!(
            resume_meta(&plain).0,
            "Pt. 3 \u{00b7} 50% \u{00b7} 1h 00m left"
        );

        let mut coarse = plain;
        coarse.record.resolved = Some(resolved(7, PositionConfidence::Low));
        assert_eq!(
            resume_meta(&coarse).0,
            "Pt. 3 \u{00b7} 50% \u{00b7} 1h 00m left"
        );
    }

    #[test]
    fn resume_meta_scales_time_left_by_the_saved_playback_rate() {
        let mut p = point(ProgressFormat::Audio, Some(3600.0), Some(7200.0));
        p.record.resolved = Some(resolved(7, PositionConfidence::High));
        p.playback_rate = Some(2.0);
        let (meta, pct) = resume_meta(&p);
        // Percent stays in book time; only the wall-clock wait scales.
        assert_eq!(pct, Some(50));
        assert_eq!(meta, "Ch. 7 \u{00b7} 50% \u{00b7} 30m left");
    }

    #[test]
    fn resume_meta_has_no_bar_for_epub_or_totalless_audio() {
        let (meta, pct) = resume_meta(&point(ProgressFormat::Epub, None, None));
        assert_eq!((meta.as_str(), pct), ("Continue reading", None));

        let (meta, pct) = resume_meta(&point(ProgressFormat::Audio, Some(95.0), None));
        assert_eq!((meta.as_str(), pct), ("1:35 in", None));
    }

    #[test]
    fn resume_meta_shows_a_bar_for_epub_rows_carrying_a_percent() {
        let mut p = point(ProgressFormat::Epub, None, None);
        p.record.progress_percent = Some(37);
        let (meta, pct) = resume_meta(&p);
        assert_eq!(pct, Some(37));
        assert_eq!(meta, "37% \u{00b7} Continue reading");
    }

    #[test]
    fn resume_key_separates_the_two_formats_of_one_book() {
        // The list surfaces render one card per stored position, so both
        // formats of one book are siblings and must key apart (#2633).
        let epub = point(ProgressFormat::Epub, None, None);
        let audio = point(ProgressFormat::Audio, None, None);

        assert_eq!(resume_key(&epub), "u:epub");
        assert_ne!(resume_key(&epub), resume_key(&audio));
    }

    #[test]
    fn resume_key_reads_the_progress_rows_uuid_not_the_resolved_books() {
        // `get_book_by_uuid` falls back through `merged_uuids`, so two rows
        // filed under different uuids resolve to one surviving book. Keying
        // on that book would hand both siblings the same key again.
        let mut old = point(ProgressFormat::Epub, None, None);
        old.record.book_uuid = "old".into();
        old.book.unique_identifier = Some("survivor".into());
        let mut new = point(ProgressFormat::Epub, None, None);
        new.record.book_uuid = "new".into();
        new.book.unique_identifier = Some("survivor".into());

        assert_eq!(resume_key(&old), "old:epub");
        assert_ne!(resume_key(&old), resume_key(&new));
    }

    #[test]
    fn format_helpers_render_hours_and_minutes() {
        assert_eq!(format_hm_left(4712.0), "1h 19m");
        assert_eq!(format_hm_left(240.0), "4m");
        assert_eq!(format_hms_short(3725.0), "1:02:05");
        assert_eq!(format_hms_short(f64::NAN), "0:00");
    }
}
