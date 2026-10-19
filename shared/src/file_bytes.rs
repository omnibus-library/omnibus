//! How the OpenAPI document describes a response or upload that is a raw file.

/// A file's raw bytes, such as an image, an EPUB or an audio part. Never JSON: the
/// operation's content type says what the bytes are.
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "openapi", schema(value_type = String, format = Binary))]
pub struct FileBytes(pub Vec<u8>);
