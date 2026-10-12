//! The `mock-kobo tui` terminal UI: one device on screen, driven by single keys.
//! `app` turns key presses into the jobs they ask for and `render` draws the
//! screen. Neither reads the device or the terminal, so both are unit-tested.

pub mod app;
pub mod render;
