//! The `mock-kobo tui` terminal UI: one device on screen, driven by single keys.
//! `app` turns key presses into the jobs they ask for, `render` draws the screen,
//! and `jobs` runs a job against the device. Only `jobs` waits on the network.
//! `run` is the thin loop gluing them to the terminal: it redraws every tick, so
//! a sync started over the control API shows without a key press.

use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::Duration;

use ratatui::crossterm::event::{self, Event};
use ratatui::DefaultTerminal;
use tokio::runtime::Handle;
use tokio::task::JoinError;

use crate::control::Control;

use self::app::{Action, App, Job, Status};
use self::jobs::Wiring;
use self::render::Screen;

pub mod app;
pub mod jobs;
pub mod render;

/// Redraw interval, so a sync started over the control API shows without a key press.
const TICK: Duration = Duration::from_millis(100);

/// What the TUI shows and drives: one device, its control API port, and how `w` wires it.
pub struct Tui {
    pub control: Arc<Control>,
    pub port: u16,
    pub state: PathBuf,
    pub wiring: Wiring,
    /// The startup notice, shown as the first status.
    pub notice: Option<String>,
}

/// A job's status, or why its task never produced one.
type Finished = Result<Status, JoinError>;

/// Take over the terminal until `q` or Ctrl-C, restoring it on exit and on panic.
/// While a job runs the first quit waits for it and a second quits at once.
/// Jobs run on `runtime`, so drawing never waits on the network.
pub fn run(tui: Tui, runtime: Handle) -> io::Result<()> {
    let mut terminal = match ratatui::try_init() {
        Ok(terminal) => terminal,
        Err(error) => {
            ratatui::restore();
            return Err(error);
        }
    };
    let ended = event_loop(&mut terminal, tui, &runtime);
    ratatui::restore();
    ended
}

/// Each tick: take in finished jobs, quit if one was awaited, draw the device,
/// then wait up to `TICK` for a key.
fn event_loop(terminal: &mut DefaultTerminal, tui: Tui, runtime: &Handle) -> io::Result<()> {
    let Tui {
        control,
        port,
        state,
        wiring,
        notice,
    } = tui;
    let wiring = Arc::new(wiring);
    let mut app = App::new(notice);
    let (finished_tx, finished_rx) = mpsc::channel();
    loop {
        take_finished_jobs(&mut app, &finished_rx)?;
        if app.quit_requested() {
            return Ok(());
        }
        let view = control.view();
        let requests = control.requests();
        let screen = Screen {
            view: &view,
            requests: &requests,
            port,
            state: &state,
            app: &app,
        };
        terminal.draw(|frame| render::draw(frame, &screen))?;
        if !event::poll(TICK)? {
            continue;
        }
        if let Event::Key(key) = event::read()? {
            match app.on_key(key, &view.url) {
                Some(Action::Quit) => return Ok(()),
                Some(Action::Run(job)) => {
                    spawn_job(runtime, &control, &wiring, job, finished_tx.clone());
                }
                None => {}
            }
        }
    }
}

/// Show how each job that ended since the last tick went; a panicked job ends the TUI.
fn take_finished_jobs(app: &mut App, finished: &Receiver<Finished>) -> io::Result<()> {
    for job in finished.try_iter() {
        match job {
            Ok(status) => app.finish(status),
            Err(error) => return Err(io::Error::other(format!("a job failed: {error}"))),
        }
    }
    Ok(())
}

/// Run `job` on `runtime`; a second task reports how the first ended.
fn spawn_job(
    runtime: &Handle,
    control: &Arc<Control>,
    wiring: &Arc<Wiring>,
    job: Job,
    finished: Sender<Finished>,
) {
    let (control, wiring) = (Arc::clone(control), Arc::clone(wiring));
    let task = runtime.spawn(async move { jobs::perform(&control, &wiring, job).await });
    runtime.spawn(async move {
        // The receiver is gone once the TUI has quit; nobody is left to tell.
        let _ = finished.send(task.await);
    });
}

#[cfg(test)]
mod tests;
