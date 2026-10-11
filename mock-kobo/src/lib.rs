//! A fake Kobo e-reader for testing Omnibus's wireless sync. It speaks the
//! firmware's side of `/kobo/<token>/v1/*` and enforces the firmware
//! behaviours behind past Kobo regressions, so a test sees what a device would.

pub mod client;
#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod control;
pub mod device;
pub mod firmware;
#[cfg(feature = "cli")]
pub mod host;
pub mod session;
#[cfg(feature = "cli")]
pub mod store;
#[cfg(test)]
mod test_support;
pub mod wire;
