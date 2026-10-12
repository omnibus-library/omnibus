//! Render a unix timestamp as ISO 8601 UTC, with no calendar dependency.
//!
//! `shared` carries only serde and thiserror, so the civil-date conversion is
//! done here rather than pulling in a date crate for one formatting job. Used
//! by every read surface that publishes a stamp beside its epoch.

#[cfg(test)]
mod tests;

/// Format unix `seconds` as `YYYY-MM-DDTHH:MM:SSZ` (UTC), fixed-width for years
/// `0000..=9999` so the output sorts lexicographically in chronological order.
/// Outside that range the year takes ISO 8601's signed expanded form
/// (`+292277026596-…`), which no longer sorts; only a corrupt stamp gets there.
pub fn to_iso8601(seconds: i64) -> String {
    // Floor division, so a pre-epoch timestamp borrows a day rather than
    // truncating toward zero and landing an hour into the wrong date.
    let days = seconds.div_euclid(86_400);
    let secs_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let (h, m, s) = (
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60,
    );
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year > 9999 {
        // ISO 8601 expanded years are signed; without the `+` many parsers
        // reject the string outright.
        format!("+{year}")
    } else {
        // `{year:04}` counts the sign in its width, so year -1 rendered
        // `-001`. Pad the magnitude instead.
        format!("-{:04}", year.unsigned_abs())
    };
    format!("{year}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Optional counterpart to [`to_iso8601`], for the wire fields that carry a
/// nullable epoch.
pub fn to_iso8601_opt(seconds: Option<i64>) -> Option<String> {
    seconds.map(to_iso8601)
}

/// Days since 1970-01-01 → `(year, month, day)` in the proleptic Gregorian
/// calendar (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Epoch shifted to 0000-03-01 so leap days land at the end of the era, keeping
    // this integer-only with no leap-year branching.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    // `mp` counts from March; fold it back to a January-based month.
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
