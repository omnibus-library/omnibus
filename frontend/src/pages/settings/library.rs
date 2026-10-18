//! Library sources — the library-path form plus live file summaries, and the
//! separate maintenance panel. The form points Omnibus at ebook and audiobook
//! directories and sets the automatic-rescan interval; recursive per-extension
//! counts from the scanner let path changes be eyeballed before saving.

use dioxus::prelude::*;
use omnibus_shared::{LibraryContents, LibrarySection, Settings, SCAN_INTERVAL_MIN_HOURS};

use crate::components::unsaved::use_saved_snapshot;
#[cfg(not(feature = "mobile"))]
use crate::components::worker_status::WorkerStatusIndicator;
use crate::components::BusyLabel;
use crate::data::server_error_message;
use crate::{data, use_server_url};

/// Where the saved settings stand. Save writes every field, so it waits for
/// them: blank fields saved over a failed read would clear both library paths.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Load {
    Pending,
    Ready,
    Failed,
}

/// Why a Save must not go out.
#[derive(Debug, PartialEq)]
enum SaveRefusal {
    NotLoaded,
    BadInterval,
}

const NOT_LOADED_MESSAGE: &str =
    "The saved settings haven\u{2019}t loaded, so saving now would clear them.";
const INTERVAL_MESSAGE: &str = "Enter a whole number of hours, or leave it blank.";

/// The settings a Save would write, or why it must not go out. Paths are
/// trimmed and a blank field is `None`; the interval's `>= 1` floor is still
/// `Settings::validate()`'s call server-side.
fn settings_payload(
    load: Load,
    ebook: &str,
    audiobook: &str,
    interval: &str,
) -> Result<Settings, SaveRefusal> {
    if load != Load::Ready {
        return Err(SaveRefusal::NotLoaded);
    }
    let interval = interval.trim();
    let scan_interval_hours = if interval.is_empty() {
        None
    } else {
        Some(
            interval
                .parse::<u32>()
                .map_err(|_| SaveRefusal::BadInterval)?,
        )
    };
    let blank_to_none = |v: &str| Some(v.trim().to_string()).filter(|v| !v.is_empty());
    Ok(Settings {
        ebook_library_path: blank_to_none(ebook),
        audiobook_library_path: blank_to_none(audiobook),
        scan_interval_hours,
    })
}

/// The Sources form's signals, threaded together through its load and save.
#[derive(Clone, Copy, PartialEq)]
struct SourcesForm {
    ebook_path: Signal<String>,
    audiobook_path: Signal<String>,
    scan_interval_hours: Signal<String>,
    interval_error: Signal<Option<String>>,
    load: Signal<Load>,
    /// Bumped by "Try again" to re-run the settings read.
    reload: Signal<u32>,
    saving: Signal<bool>,
    status: Signal<Option<String>>,
    status_is_error: Signal<bool>,
    /// Bumped after a successful save to re-trigger the library-refresh effect.
    library_refresh: Signal<u32>,
}

/// Library-paths form + live recursive file-count summaries, wrapped in a card.
#[component]
pub fn LibraryLocationSection() -> Element {
    let server_url = use_server_url();
    let form = SourcesForm {
        ebook_path: use_signal(String::new),
        audiobook_path: use_signal(String::new),
        scan_interval_hours: use_signal(String::new),
        interval_error: use_signal(|| None),
        load: use_signal(|| Load::Pending),
        reload: use_signal(|| 0u32),
        saving: use_signal(|| false),
        status: use_signal(|| None),
        status_is_error: use_signal(|| false),
        library_refresh: use_signal(|| 0u32),
    };
    let library = use_signal(LibraryContents::default);
    let saved = use_saved_snapshot("library-sources", move || source_values(form));

    spawn_initial_settings_load(server_url.clone(), form, saved);
    spawn_library_refresh(server_url.clone(), library, form.library_refresh);
    let on_submit = save_settings_handler(server_url, form, saved);

    let load = (form.load)();
    let saving = (form.saving)();
    let mut reload = form.reload;
    let status = (form.status)();

    rsx! {
        section { class: "card", "data-testid": "library-location-card",
            h3 { "Library folders" }
            p { class: "subtitle", "Where your books live on disk, and how often Omnibus rescans them." }

            form {
                id: "settings-form",
                class: "settings-form",
                onsubmit: on_submit,
                LibraryPathFields {
                    ebook_path: form.ebook_path,
                    audiobook_path: form.audiobook_path,
                    library,
                }
                ScanIntervalField { scan_interval_hours: form.scan_interval_hours, error: form.interval_error }

                div { class: "settings-actions",
                    if load == Load::Failed {
                        button {
                            r#type: "button",
                            class: "btn ghost",
                            "data-testid": "library-retry",
                            onclick: move |_| reload += 1,
                            "Try again"
                        }
                    }
                    button {
                        r#type: "submit",
                        class: "btn primary",
                        "data-testid": "library-save",
                        disabled: load != Load::Ready || saving,
                        "aria-busy": if saving { "true" } else { "false" },
                        BusyLabel { busy: saving, label: "Save library settings", busy_label: "Saving\u{2026}" }
                    }
                }
            }

            p {
                id: "settings-status",
                "data-testid": "settings-status",
                role: "status",
                class: if (form.status_is_error)() { "settings-status error" } else { "settings-status success" },
                if let Some(msg) = status { "{msg}" }
            }
        }
    }
}

/// The one-off maintenance jobs (rescan, author photos, chapters, EPUB
/// overrides) with their shared status line and the worker's live status.
/// Commands, not configuration, so they sit apart from the library form.
#[component]
pub(crate) fn MaintenancePanel() -> Element {
    let status = use_signal(|| None::<String>);
    let status_is_error = use_signal(|| false);
    let io = MaintenanceIo {
        status,
        status_is_error,
        refetch_in_flight: use_signal(|| false),
        backfill_in_flight: use_signal(|| false),
        scan_in_flight: use_signal(|| false),
        rewrite_in_flight: use_signal(|| false),
        library_refresh: use_signal(|| 0u32),
    };

    rsx! {
        section { class: "card", "data-testid": "maintenance-card",
            h3 { "Run a job" }
            p { class: "subtitle", "Each job runs once on the server\u{2019}s background worker; progress shows here." }
            {worker_status_slot()}
            MaintenanceActions { io }
            p {
                "data-testid": "maintenance-status",
                role: "status",
                class: if status_is_error() { "settings-status error" } else { "settings-status success" },
                if let Some(msg) = status() { "{msg}" }
            }
        }
    }
}

/// Worker-status indicator slot — emits `WorkerStatusIndicator` on web/server, nothing on mobile.
fn worker_status_slot() -> Element {
    #[cfg(not(feature = "mobile"))]
    {
        rsx! { WorkerStatusIndicator {} }
    }
    #[cfg(feature = "mobile")]
    {
        rsx! {}
    }
}

/// The form's three fields, as the unsaved-edits guard compares them.
fn source_values(form: SourcesForm) -> [String; 3] {
    [
        (form.ebook_path)(),
        (form.audiobook_path)(),
        (form.scan_interval_hours)(),
    ]
}

/// Hydrates the saved [`Settings`] into the path inputs on mount, and again
/// whenever "Try again" bumps `reload`.
fn spawn_initial_settings_load(
    url: String,
    form: SourcesForm,
    mut saved: Signal<Option<[String; 3]>>,
) {
    let SourcesForm {
        mut ebook_path,
        mut audiobook_path,
        mut scan_interval_hours,
        mut load,
        reload,
        mut status,
        mut status_is_error,
        ..
    } = form;
    use_effect(move || {
        let _ = reload();
        if *load.peek() != Load::Pending {
            load.set(Load::Pending);
            status.set(None);
        }
        let url = url.clone();
        spawn(async move {
            match data::get_settings(&url).await {
                Ok(settings) => {
                    ebook_path.set(settings.ebook_library_path.unwrap_or_default());
                    audiobook_path.set(settings.audiobook_library_path.unwrap_or_default());
                    scan_interval_hours.set(
                        settings
                            .scan_interval_hours
                            .map(|h| h.to_string())
                            .unwrap_or_default(),
                    );
                    saved.set(Some(source_values(form)));
                    load.set(Load::Ready);
                }
                Err(e) => {
                    status.set(Some(format!(
                        "Couldn\u{2019}t load the saved settings: {}",
                        server_error_message(&e)
                    )));
                    status_is_error.set(true);
                    load.set(Load::Failed);
                }
            }
        });
    });
}

/// Refetches the live per-extension counts whenever `library_refresh` ticks.
fn spawn_library_refresh(
    url: String,
    mut library: Signal<LibraryContents>,
    library_refresh: Signal<u32>,
) {
    use_effect(move || {
        let _ = library_refresh();
        let url = url.clone();
        spawn(async move {
            if let Ok(contents) = data::get_library(&url).await {
                library.set(contents);
            }
        });
    });
}

/// Returns the `<form onsubmit>` handler that POSTs the path + interval inputs,
/// refusing (with the reason where the reader will look) a Save
/// [`settings_payload`] rules out.
fn save_settings_handler(
    url: String,
    form: SourcesForm,
    mut saved: Signal<Option<[String; 3]>>,
) -> impl FnMut(FormEvent) {
    let SourcesForm {
        mut interval_error,
        mut saving,
        mut status,
        mut status_is_error,
        mut library_refresh,
        ..
    } = form;
    move |evt: FormEvent| {
        evt.prevent_default();
        if saving() {
            return;
        }
        interval_error.set(None);
        let payload = match settings_payload(
            (form.load)(),
            &(form.ebook_path)(),
            &(form.audiobook_path)(),
            &(form.scan_interval_hours)(),
        ) {
            Ok(payload) => payload,
            Err(SaveRefusal::NotLoaded) => {
                status.set(Some(NOT_LOADED_MESSAGE.to_string()));
                status_is_error.set(true);
                return;
            }
            Err(SaveRefusal::BadInterval) => {
                interval_error.set(Some(INTERVAL_MESSAGE.to_string()));
                return;
            }
        };
        status.set(None);
        saving.set(true);
        let url = url.clone();
        let submitted = source_values(form);
        spawn(async move {
            match data::save_settings(&url, payload).await {
                Ok(_) => {
                    saved.set(Some(submitted));
                    status.set(Some("Library settings saved.".to_string()));
                    status_is_error.set(false);
                    library_refresh.set(library_refresh() + 1);
                }
                Err(e) => {
                    status.set(Some(format!(
                        "Couldn\u{2019}t save the library settings: {}",
                        server_error_message(&e)
                    )));
                    status_is_error.set(true);
                }
            }
            saving.set(false);
        });
    }
}

/// Ebook + audiobook path inputs with their live per-extension summaries.
#[component]
fn LibraryPathFields(
    mut ebook_path: Signal<String>,
    mut audiobook_path: Signal<String>,
    library: Signal<LibraryContents>,
) -> Element {
    rsx! {
        div { class: "settings-field",
            label { r#for: "ebook-library-path", "Ebook library path" }
            input {
                r#type: "text",
                id: "ebook-library-path",
                name: "ebook_library_path",
                autocomplete: "off",
                autocapitalize: "none",
                spellcheck: "false",
                translate: "no",
                value: "{ebook_path}",
                placeholder: "/path/to/ebooks\u{2026}",
                oninput: move |evt| ebook_path.set(evt.value()),
            }
            LibrarySummary {
                testid: "ebook-library-summary",
                section: library().ebooks,
            }
        }
        div { class: "settings-field",
            label { r#for: "audiobook-library-path", "Audiobook library path" }
            input {
                r#type: "text",
                id: "audiobook-library-path",
                name: "audiobook_library_path",
                autocomplete: "off",
                autocapitalize: "none",
                spellcheck: "false",
                translate: "no",
                value: "{audiobook_path}",
                placeholder: "/path/to/audiobooks\u{2026}",
                oninput: move |evt| audiobook_path.set(evt.value()),
            }
            LibrarySummary {
                testid: "audiobook-library-summary",
                section: library().audiobooks,
            }
        }
    }
}

/// Optional periodic-rescan interval, in hours. Blank disables it — the
/// server-side `Settings::validate()` rejects 0 or any other value below
/// [`omnibus_shared::SCAN_INTERVAL_MIN_HOURS`]; a non-numeric entry is caught
/// by [`settings_payload`] and reported here, at the field.
#[component]
fn ScanIntervalField(
    mut scan_interval_hours: Signal<String>,
    error: Signal<Option<String>>,
) -> Element {
    let message = error();
    let invalid = if message.is_some() { "true" } else { "false" };
    rsx! {
        div { class: "settings-field",
            label { r#for: "scan-interval-hours", "Automatic rescan interval (hours)" }
            input {
                r#type: "number",
                min: "{SCAN_INTERVAL_MIN_HOURS}",
                inputmode: "numeric",
                id: "scan-interval-hours",
                name: "scan_interval_hours",
                "data-testid": "scan-interval-hours",
                "aria-describedby": "scan-interval-hint",
                "aria-invalid": invalid,
                value: "{scan_interval_hours}",
                oninput: move |evt| scan_interval_hours.set(evt.value()),
            }
            p { class: "settings-hint", id: "scan-interval-hint", "Leave blank to rescan only when you ask." }
            if let Some(m) = message {
                p { class: "settings-status error", role: "alert", "data-testid": "scan-interval-error", "{m}" }
            }
        }
    }
}

/// Returns the "Scan Library" button's `onclick` handler: flips
/// `scan_in_flight` immediately (so the button disables before the request
/// even lands), then reports the queued scan — or its failure — once the
/// request resolves.
fn scan_library_handler(
    url: String,
    mut status: Signal<Option<String>>,
    mut status_is_error: Signal<bool>,
    mut scan_in_flight: Signal<bool>,
    mut library_refresh: Signal<u32>,
) -> impl FnMut(MouseEvent) {
    move |_evt: MouseEvent| {
        let url = url.clone();
        scan_in_flight.set(true);
        spawn(async move {
            match data::scan_library(&url).await {
                Ok(()) => {
                    status.set(Some("Library scan queued.".into()));
                    status_is_error.set(false);
                    library_refresh.set(library_refresh() + 1);
                }
                Err(e) => {
                    status.set(Some(format!("Failed to start library scan: {e}")));
                    status_is_error.set(true);
                }
            }
            scan_in_flight.set(false);
        });
    }
}

/// Returns the "Refetch Author Pictures" button's `onclick` handler, mirroring
/// [`scan_library_handler`]'s immediate-disable-then-report shape.
fn refetch_author_photos_handler(
    url: String,
    mut status: Signal<Option<String>>,
    mut status_is_error: Signal<bool>,
    mut refetch_in_flight: Signal<bool>,
) -> impl FnMut(MouseEvent) {
    move |_evt: MouseEvent| {
        let url = url.clone();
        refetch_in_flight.set(true);
        spawn(async move {
            match data::refetch_author_photos(&url).await {
                Ok(()) => {
                    status.set(Some("Author photo refetch queued.".into()));
                    status_is_error.set(false);
                }
                Err(e) => {
                    status.set(Some(format!("Failed to start photo refetch: {e}")));
                    status_is_error.set(true);
                }
            }
            refetch_in_flight.set(false);
        });
    }
}

/// Returns the "Extract Audiobook Chapters" button's `onclick` handler,
/// mirroring [`scan_library_handler`]'s immediate-disable-then-report shape.
fn backfill_chapters_handler(
    url: String,
    mut status: Signal<Option<String>>,
    mut status_is_error: Signal<bool>,
    mut backfill_in_flight: Signal<bool>,
) -> impl FnMut(MouseEvent) {
    move |_evt: MouseEvent| {
        let url = url.clone();
        backfill_in_flight.set(true);
        spawn(async move {
            match data::backfill_chapters(&url).await {
                Ok(()) => {
                    status.set(Some("Chapter extraction queued.".into()));
                    status_is_error.set(false);
                }
                Err(e) => {
                    status.set(Some(format!("Failed to start chapter extraction: {e}")));
                    status_is_error.set(true);
                }
            }
            backfill_in_flight.set(false);
        });
    }
}

/// Returns the "Bake Overrides Into EPUBs" button's `onclick` handler,
/// mirroring [`refetch_author_photos_handler`]'s immediate-disable-then-report
/// shape: the run is queued on the shared worker and this reports only whether
/// *queuing* succeeded. Completion and any per-book failures surface via the
/// `WorkerStatusIndicator`'s poll.
fn rewrite_all_epubs_handler(
    url: String,
    mut status: Signal<Option<String>>,
    mut status_is_error: Signal<bool>,
    mut rewrite_in_flight: Signal<bool>,
) -> impl FnMut(MouseEvent) {
    move |_evt: MouseEvent| {
        let url = url.clone();
        rewrite_in_flight.set(true);
        spawn(async move {
            match data::rewrite_all_epubs(&url).await {
                Ok(()) => {
                    status.set(Some("EPUB override bake queued.".into()));
                    status_is_error.set(false);
                }
                Err(e) => {
                    status.set(Some(format!("Failed to start EPUB override bake: {e}")));
                    status_is_error.set(true);
                }
            }
            rewrite_in_flight.set(false);
        });
    }
}

/// Shared status line plus each maintenance job's own in-flight flag.
/// Grouped so [`MaintenanceActions`] stays under the prop cap.
#[derive(Copy, Clone, PartialEq)]
struct MaintenanceIo {
    status: Signal<Option<String>>,
    status_is_error: Signal<bool>,
    refetch_in_flight: Signal<bool>,
    backfill_in_flight: Signal<bool>,
    scan_in_flight: Signal<bool>,
    rewrite_in_flight: Signal<bool>,
    library_refresh: Signal<u32>,
}

/// The one-off maintenance jobs (library rescan, author photo refetch, chapter
/// backfill, EPUB override bake), each with a line saying what it does.
#[component]
fn MaintenanceActions(io: MaintenanceIo) -> Element {
    let MaintenanceIo {
        status,
        status_is_error,
        refetch_in_flight,
        backfill_in_flight,
        scan_in_flight,
        rewrite_in_flight,
        library_refresh,
    } = io;
    let server_url = use_server_url();
    let on_scan = scan_library_handler(
        server_url.clone(),
        status,
        status_is_error,
        scan_in_flight,
        library_refresh,
    );
    let on_refetch = refetch_author_photos_handler(
        server_url.clone(),
        status,
        status_is_error,
        refetch_in_flight,
    );
    let on_backfill = backfill_chapters_handler(
        server_url.clone(),
        status,
        status_is_error,
        backfill_in_flight,
    );
    let on_rewrite =
        rewrite_all_epubs_handler(server_url, status, status_is_error, rewrite_in_flight);

    rsx! {
        ul { class: "maint-list",
            MaintenanceCommand {
                testid: "scan-library",
                label: "Scan library",
                description: "Look through both library folders now for new, changed and removed books, instead of waiting for the next automatic rescan.",
                busy: scan_in_flight(),
                on_run: on_scan,
            }
            MaintenanceCommand {
                testid: "refetch-author-photos",
                label: "Refetch author pictures",
                description: "Look up every author\u{2019}s photo on Open Library again. Pictures set by hand are kept.",
                busy: refetch_in_flight(),
                on_run: on_refetch,
            }
            MaintenanceCommand {
                testid: "backfill-chapters",
                label: "Extract audiobook chapters",
                description: "Read chapter markers from audiobooks added before chapters were recorded.",
                busy: backfill_in_flight(),
                on_run: on_backfill,
            }
            MaintenanceCommand {
                testid: "rewrite-all-epubs",
                label: "Bake overrides into EPUBs",
                description: "Rebuild the downloadable copy of every edited EPUB so downloads and Kobo sync carry your metadata and covers.",
                busy: rewrite_in_flight(),
                on_run: on_rewrite,
            }
        }
    }
}

/// One maintenance command: what it does, and the button that queues it.
#[component]
fn MaintenanceCommand(
    testid: &'static str,
    label: &'static str,
    description: &'static str,
    busy: bool,
    on_run: EventHandler<MouseEvent>,
) -> Element {
    rsx! {
        li { class: "maint-row",
            p { class: "maint-desc", id: "{testid}-desc", "{description}" }
            button {
                r#type: "button",
                class: "btn ghost",
                disabled: busy,
                "aria-busy": if busy { "true" } else { "false" },
                "aria-describedby": "{testid}-desc",
                "data-testid": "{testid}",
                onclick: move |evt| on_run.call(evt),
                BusyLabel { busy, label, busy_label: "Queuing\u{2026}" }
            }
        }
    }
}

fn library_summary_line(section: &LibrarySection) -> String {
    let noun = if section.total_files == 1 {
        "file"
    } else {
        "files"
    };
    let mut line = format!("{} {noun} found.", section.total_files);
    for (ext, count) in &section.counts_by_ext {
        line.push_str(&format!(" {count} .{ext} found."));
    }
    line
}

#[component]
fn LibrarySummary(testid: String, section: LibrarySection) -> Element {
    if section.path.is_none() {
        return rsx! {
            p {
                id: "{testid}",
                "data-testid": "{testid}",
                class: "library-summary empty",
            }
        };
    }

    if let Some(err) = &section.error {
        return rsx! {
            p {
                id: "{testid}",
                "data-testid": "{testid}",
                class: "library-summary error",
                "Couldn\u{2019}t read this folder: {err}"
            }
        };
    }

    let line = library_summary_line(&section);

    rsx! {
        p {
            id: "{testid}",
            "data-testid": "{testid}",
            class: "library-summary",
            "{line}"
        }
    }
}

#[cfg(test)]
mod tests;
