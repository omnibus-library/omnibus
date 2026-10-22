//! The pieces the authors browser is built from that don't depend on what it
//! lists: the head, the letter-grouped list and its A–Z rail, the reader's
//! progress per row, and the reader's state on each book in the pane. Its
//! markup wears the `au-` classes in `authors.css`.
//!
//! A row's progress is a second, per-reader request beside the library-wide
//! rows, and stays unknown — never zero — until it lands ([`ListReading`]).

mod books;
mod letters;
mod list;
mod rail;

pub use books::{
    ago, book_card, book_grid, books_meta, current_book, progress_meter, state_of, status_of,
    tally, BookCard, BookStates,
};
pub use letters::{group_by_letter, is_non_alpha_key, letter_for_key, letter_frag};
pub use list::{
    list_body, row_bar, use_list_reading, use_preview, use_reveal_current_row, Groups, ListCopy,
    ListHead, ListReading, ListView, Preview,
};

#[cfg(test)]
pub mod test_support;
#[cfg(all(test, feature = "server"))]
mod tests;
