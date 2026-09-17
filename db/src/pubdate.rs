//! Normalization of the free-text `books.pubdate` column: a provider hands the
//! check-in flow a date in whatever shape it likes, and every reader of the
//! column expects a year or an ISO date. Used by the fileless-book write and
//! by the palette's year projection.

#[cfg(test)]
mod tests;

/// Reduce a provider-reported publication date to the shape `books.pubdate`
/// holds for scanned books: an ISO date (`2015-08-04`), an ISO month
/// (`2015-08`) or a bare year (`2015`). Anything else — `8/4/2015`,
/// `August 4, 2015`, `c. 2015` — is reduced to its four-digit year, and a
/// value carrying no year at all is dropped rather than stored.
///
/// Dropping is the right failure: a locale-formatted string in this column
/// renders as `8/4/` on iOS (the first four characters) and sorts among the
/// ISO dates by its first digit.
pub fn normalize_pubdate(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if let Some(iso) = iso_prefix(trimmed) {
        return Some(iso.to_string());
    }
    year_of(trimmed)
}

/// The four-digit year in a `pubdate` value, wherever the writer put it: the
/// first run of exactly four ASCII digits, which is the leading `YYYY` of an
/// ISO date and the trailing one of a locale-formatted date. `None` when
/// there is no such run.
pub fn year_of(pubdate: &str) -> Option<String> {
    pubdate
        .split(|c: char| !c.is_ascii_digit())
        .find(|run| run.len() == 4)
        .map(str::to_string)
}

/// The leading `YYYY`, `YYYY-MM` or `YYYY-MM-DD` of `s` when `s` *is* one of
/// those shapes, optionally followed by a time (`2015-08-04T00:00:00Z`).
fn iso_prefix(s: &str) -> Option<&str> {
    let shapes: [&[usize]; 3] = [&[4, 2, 2], &[4, 2], &[4]];
    for shape in shapes {
        let len = shape.iter().sum::<usize>() + shape.len() - 1;
        if s.len() < len || !s.is_char_boundary(len) {
            continue;
        }
        let head = &s[..len];
        let rest = &s[len..];
        let well_formed = head.split('-').map(str::len).eq(shape.iter().copied())
            && head.split('-').all(is_digits);
        // A trailing time is fine; a fifth digit or another dash means this
        // is not the shape we thought it was.
        let terminated = rest.is_empty() || rest.starts_with('T') || rest.starts_with(' ');
        if well_formed && terminated {
            return Some(head);
        }
    }
    None
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
