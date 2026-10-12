//! The `mock-kobo tui` terminal UI: one device on screen, driven by single keys.
//! `app` turns key presses into the jobs they ask for, `render` draws the screen,
//! and `jobs` runs a job against the device. Only `jobs` waits on the network.

pub mod app;
pub mod jobs;
pub mod render;
