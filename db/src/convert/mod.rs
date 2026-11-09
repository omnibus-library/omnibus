//! Calibre `ebook-convert` integration: binary detection ([`detect`]) plus
//! the shell-out that converts a book ([`execute::convert_book`]), which
//! persists its output as a new `book_files` row
//! ([`persist::persist_converted_file`]), or a bare file ([`execute::convert_file`]). Calibre is strictly optional — an
//! unresolved binary logs one startup warning and leaves conversion disabled.

/// The formats the server converts to EPUB; request ranking and import both read this list.
pub const EPUB_CONVERTIBLE_FORMATS: &[&str] = &["azw3", "mobi"];

mod detect;
mod execute;
mod fs;
mod persist;

pub use detect::{ebook_convert_available, ebook_convert_bin, is_runnable, warn_if_unavailable};
pub use execute::{convert_book, convert_file, ConvertError};
pub use fs::{convert_dir, convert_path};

#[cfg(test)]
mod tests;
