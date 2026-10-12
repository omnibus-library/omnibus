//! Shared "pick a file, upload it, report progress" `onchange` builder for
//! `<input type="file">` image pickers (author photo, journal images): reads
//! the picked file's bytes, calls the caller's upload fn, and reports
//! progress/errors through a `busy` flag and a status/error message signal.

use std::future::Future;

use dioxus::prelude::*;

use crate::data::DataError;

/// Builds an `onchange` handler for an image `<input type="file">`. It flips
/// `busy` on for the upload, seeds `message` from `on_start`, and calls
/// `upload(filename, mime, bytes)` (MIME falls back to
/// `application/octet-stream`). On success the result goes to `on_success`;
/// on failure the error is written to `message`.
pub(crate) fn use_file_upload<T, U, Fut>(
    mut busy: Signal<bool>,
    mut message: Signal<Option<String>>,
    on_start: impl Fn(&str) -> Option<String> + 'static,
    upload: U,
    on_success: impl Fn(T) + Clone + 'static,
) -> impl FnMut(Event<FormData>) + 'static
where
    T: 'static,
    U: Fn(String, String, Vec<u8>) -> Fut + Clone + 'static,
    Fut: Future<Output = Result<T, DataError>> + 'static,
{
    move |evt: Event<FormData>| {
        let Some(file) = evt.files().into_iter().next() else {
            return;
        };
        let filename = file.name();
        let mime = file
            .content_type()
            .unwrap_or_else(|| "application/octet-stream".into());
        let upload = upload.clone();
        let on_success = on_success.clone();
        busy.set(true);
        message.set(on_start(&filename));
        spawn(async move {
            match file.read_bytes().await {
                Ok(bytes) => match upload(filename, mime, bytes.to_vec()).await {
                    Ok(result) => on_success(result),
                    Err(e) => message.set(Some(format!("Upload failed: {e}"))),
                },
                Err(e) => message.set(Some(format!("Read file failed: {e}"))),
            }
            busy.set(false);
        });
    }
}
