//! A fake Kobo e-reader for testing Omnibus's wireless sync. It speaks the
//! firmware's side of `/kobo/<token>/v1/*` and enforces the firmware
//! behaviours behind past Kobo regressions, so a test sees what a device would.

pub mod api;
pub mod autowire;
pub mod cli;
pub mod client;
pub mod control;
pub mod device;
pub mod firmware;
pub mod session;
pub mod state;
#[cfg(test)]
mod test_support;
pub mod wire;
