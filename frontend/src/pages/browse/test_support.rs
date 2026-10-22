//! Fixtures the browse, author-pane and series-pane tests share: a book known
//! by its uuid, and the reader's state on one.

use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

/// One day in seconds.
pub const DAY: i64 = 86_400;

/// A book known by `uuid`, titled with it upper-cased, at series number `index`.
pub fn book(uuid: &str, index: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        title: Some(uuid.to_uppercase()),
        unique_identifier: Some(uuid.into()),
        series_index: index.map(Into::into),
        ..Default::default()
    }
}

/// The reader's state on `uuid`, as an entry of a [`super::BookStates`] map.
pub fn state(
    uuid: &str,
    status: ReadStatus,
    percent: Option<i64>,
    at: Option<i64>,
) -> (String, BookReading) {
    (
        uuid.into(),
        BookReading {
            book_uuid: uuid.into(),
            status,
            percent,
            last_read_at: at,
            ..Default::default()
        },
    )
}
