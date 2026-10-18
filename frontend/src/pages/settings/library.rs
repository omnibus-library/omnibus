//! Library sources — the library-path form plus live file summaries, and the
//! separate maintenance panel. The form points Omnibus at ebook and audiobook
//! directories and sets the automatic-rescan interval; recursive per-extension
//! counts from the scanner let path changes be eyeballed before saving.

use dioxus::prelude::*;
use omnibus_shared::{LibraryContents, LibrarySection, Settings, SCAN_INTERVAL_MIN_HOURS};

use crate::components::credential_card::live_status;
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

            {live_status("settings-status", status.as_deref(), (form.status_is_error)())}
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
        running: use_signal(Vec::new),
    };

    rsx! {
        section { class: "card", "data-testid": "maintenance-card",
            h3 { "Run a job" }
            p { class: "subtitle", "Each job runs once on the server\u{2019}s background worker; progress shows here." }
            {worker_status_slot()}
            MaintenanceActions { io }
            {live_status("maintenance-status", status().as_deref(), status_is_error())}
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

/// One job the maintenance panel queues on the server's background worker.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MaintenanceJob {
    Scan,
    RefetchPhotos,
    Chapters,
    BakeEpubs,
}

impl MaintenanceJob {
    const ALL: [MaintenanceJob; 4] = [
        MaintenanceJob::Scan,
        MaintenanceJob::RefetchPhotos,
        MaintenanceJob::Chapters,
        MaintenanceJob::BakeEpubs,
    ];

    fn testid(self) -> &'static str {
        match self {
            MaintenanceJob::Scan => "scan-library",
            MaintenanceJob::RefetchPhotos => "refetch-author-photos",
            MaintenanceJob::Chapters => "backfill-chapters",
            MaintenanceJob::BakeEpubs => "rewrite-all-epubs",
        }
    }

    fn label(self) -> &'static str {
        match self {
            MaintenanceJob::Scan => "Scan library",
            MaintenanceJob::RefetchPhotos => "Refetch author pictures",
            MaintenanceJob::Chapters => "Extract audiobook chapters",
            MaintenanceJob::BakeEpubs => "Bake overrides into EPUBs",
        }
    }

    fn description(self) -> &'static str {
        match self {
            MaintenanceJob::Scan => "Look through both library folders now for new, changed and removed books, instead of waiting for the next automatic rescan.",
            MaintenanceJob::RefetchPhotos => "Look up every author\u{2019}s photo on Open Library again. Pictures set by hand are kept.",
            MaintenanceJob::Chapters => "Read chapter markers from audiobooks added before chapters were recorded.",
            MaintenanceJob::BakeEpubs => "Rebuild the downloadable copy of every edited EPUB so downloads and Kobo sync carry your metadata and covers.",
        }
    }

    /// The job's name in the status line.
    fn noun(self) -> &'static str {
        match self {
            MaintenanceJob::Scan => "library scan",
            MaintenanceJob::RefetchPhotos => "author photo refetch",
            MaintenanceJob::Chapters => "chapter extraction",
            MaintenanceJob::BakeEpubs => "EPUB override bake",
        }
    }

    async fn queue(self, url: &str) -> Result<(), data::DataError> {
        match self {
            MaintenanceJob::Scan => data::scan_library(url).await,
            MaintenanceJob::RefetchPhotos => data::refetch_author_photos(url).await,
            MaintenanceJob::Chapters => data::backfill_chapters(url).await,
            MaintenanceJob::BakeEpubs => data::rewrite_all_epubs(url).await,
        }
    }
}

/// A job button's `onclick`: disable it at once, then report whether queuing
/// worked. Completion shows in the `WorkerStatusIndicator` above, not here.
fn run_job_handler(url: String, job: MaintenanceJob, io: MaintenanceIo) -> impl FnMut(MouseEvent) {
    let MaintenanceIo {
        mut status,
        mut status_is_error,
        mut running,
    } = io;
    move |_evt: MouseEvent| {
        let url = url.clone();
        running.write().push(job);
        spawn(async move {
            let (line, failed) = match job.queue(&url).await {
                Ok(()) => (
                    format!("{} queued.", crate::format::capitalize(job.noun())),
                    false,
                ),
                Err(e) => (format!("Failed to start {}: {e}", job.noun()), true),
            };
            status.set(Some(line));
            status_is_error.set(failed);
            running.write().retain(|out| *out != job);
        });
    }
}

/// The panel's shared status line and the jobs it has queuing right now.
#[derive(Copy, Clone, PartialEq)]
struct MaintenanceIo {
    status: Signal<Option<String>>,
    status_is_error: Signal<bool>,
    running: Signal<Vec<MaintenanceJob>>,
}

/// The one-off maintenance jobs, each with a line saying what it does.
#[component]
fn MaintenanceActions(io: MaintenanceIo) -> Element {
    let server_url = use_server_url();
    rsx! {
        ul { class: "maint-list",
            for job in MaintenanceJob::ALL {
                MaintenanceCommand {
                    key: "{job.testid()}",
                    testid: job.testid(),
                    label: job.label(),
                    description: job.description(),
                    busy: (io.running)().contains(&job),
                    on_run: run_job_handler(server_url.clone(), job, io),
                }
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
    let files = crate::format::count_label(section.total_files as i64, "file");
    let mut line = format!("{files} found.");
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
