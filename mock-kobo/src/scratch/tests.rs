//! `Scratch` and `sweep` against a real temp root: the filesystem is the boundary.

use std::fs;
use std::time::{Duration, SystemTime};

use tempfile::TempDir;

use super::*;

/// A dead run's leftovers: a dir holding an unlocked `lock` file and some state.
fn dead_run(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(LOCK), "").unwrap();
    fs::write(dir.join("mock-kobo.json"), "{}").unwrap();
    dir
}

#[test]
fn create_makes_a_state_path_inside_a_fresh_dir_under_root() {
    let root = TempDir::new().unwrap();

    let scratch = Scratch::create(root.path()).unwrap();

    let state = scratch.state_path();
    assert_eq!(state.file_name().unwrap(), "mock-kobo.json");
    let dir = state.parent().unwrap();
    assert_eq!(dir.parent().unwrap(), root.path());
    assert!(dir.is_dir());
}

#[test]
fn create_makes_the_root_when_it_is_missing() {
    let parent = TempDir::new().unwrap();
    let root = parent.path().join("omnibus-mock-kobo");

    let scratch = Scratch::create(&root).unwrap();

    assert!(scratch.state_path().parent().unwrap().is_dir());
}

#[test]
fn drop_removes_the_state_file_and_the_books_dir() {
    let root = TempDir::new().unwrap();
    let scratch = Scratch::create(root.path()).unwrap();
    let state = scratch.state_path();
    let dir = state.parent().unwrap().to_owned();
    fs::write(&state, "{}").unwrap();
    fs::create_dir(dir.join("mock-kobo.books")).unwrap();
    fs::write(dir.join("mock-kobo.books").join("dune.kepub.epub"), "x").unwrap();

    drop(scratch);

    assert!(!dir.exists());
    assert!(root.path().is_dir());
}

#[test]
fn sweep_removes_a_dir_whose_lock_no_run_holds() {
    let root = TempDir::new().unwrap();
    let dead = dead_run(root.path(), "run.dead");

    sweep(root.path());

    assert!(!dead.exists());
}

#[test]
fn sweep_keeps_a_dir_held_by_a_live_scratch() {
    let root = TempDir::new().unwrap();
    let live = Scratch::create(root.path()).unwrap();
    let dead = dead_run(root.path(), "run.dead");

    sweep(root.path());

    assert!(live.state_path().parent().unwrap().is_dir());
    assert!(!dead.exists());
}

#[test]
fn sweep_keeps_a_dir_that_has_no_lock_file_yet() {
    let root = TempDir::new().unwrap();
    let starting = root.path().join("run.starting");
    fs::create_dir(&starting).unwrap();

    sweep(root.path());

    assert!(starting.is_dir());
}

/// Backdate `dir`'s mtime, as if it had been sitting there for `age`.
fn age(dir: &Path, age: Duration) {
    fs::File::open(dir)
        .unwrap()
        .set_modified(SystemTime::now() - age)
        .unwrap();
}

#[test]
fn sweep_removes_a_dir_with_no_lock_file_once_it_is_old() {
    let root = TempDir::new().unwrap();
    let abandoned = root.path().join("run.abandoned");
    fs::create_dir(&abandoned).unwrap();
    age(&abandoned, Duration::from_secs(5 * 60));

    sweep(root.path());

    assert!(!abandoned.exists());
}

#[test]
fn create_leaves_only_a_held_lock_file_for_a_sweep_to_find() {
    let root = TempDir::new().unwrap();
    let scratch = Scratch::create(root.path()).unwrap();
    let dir = scratch.state_path().parent().unwrap().to_owned();

    // The file named `lock` is the one that is held; the one being locked was another name.
    assert!(dir.join(LOCK).is_file());
    assert!(!dir.join(format!("{LOCK}.tmp")).exists());
    let probe = fs::File::open(dir.join(LOCK)).unwrap();
    assert!(probe.try_lock().is_err());
}

#[test]
fn sweep_does_nothing_when_the_root_is_missing() {
    let parent = TempDir::new().unwrap();

    sweep(&parent.path().join("never-created"));

    assert!(parent.path().is_dir());
}
