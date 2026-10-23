//! A fake Kobo e-reader for testing Omnibus's wireless sync. It speaks the
//! firmware's side of `/kobo/<token>/v1/*` and enforces the firmware
//! behaviours behind past Kobo regressions, so a test sees what a device would.
//! `mock-kobo serve` runs one such device headless behind a loopback control
//! API; `mock-kobo tui` shows the same device in a terminal UI while serving
//! that API; `mock-kobo --help` lists the flags and env vars.

pub mod api;
pub mod autowire;
pub mod cli;
pub mod client;
pub mod control;
pub mod covers;
pub mod device;
pub mod firmware;
pub mod session;
pub mod startup;
pub mod state;
#[cfg(test)]
mod test_support;
#[cfg(feature = "tui")]
pub mod tui;
pub mod wire;
