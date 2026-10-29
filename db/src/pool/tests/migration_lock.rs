//! The migration lock: `db/migrations.lock` pins the checksum of every
//! migration, so editing an applied `.sql` file (comments included) fails the
//! suite here instead of failing startup on every existing install.

use std::collections::BTreeMap;
use std::fmt::Write;
use std::path::PathBuf;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

const UPDATE_VAR: &str = "UPDATE_MIGRATION_LOCK";

fn lock_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations.lock")
}

/// One `<version> <checksum> <description>` line per embedded migration.
fn render_lock() -> String {
    let mut out = String::from(
        "# Pinned sqlx checksum of every migration; see .claude/rules/06-migrations.md.\n\
         # Add a line for a new migration with `UPDATE_MIGRATION_LOCK=1 cargo test -p omnibus-db migration_lock`.\n",
    );
    for m in MIGRATOR.iter() {
        let digest = m.checksum.iter().fold(String::new(), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        });
        let _ = writeln!(out, "{:04} {digest} {}", m.version, m.description);
    }
    out
}

fn parse_lock(text: &str) -> BTreeMap<i64, String> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            Some((parts.next()?.parse().ok()?, parts.next()?.to_owned()))
        })
        .collect()
}

#[test]
fn every_migration_matches_its_pinned_checksum() {
    if std::env::var_os(UPDATE_VAR).is_some() {
        std::fs::write(lock_path(), render_lock()).unwrap();
        return;
    }
    let locked = parse_lock(&std::fs::read_to_string(lock_path()).unwrap_or_default());
    let current = parse_lock(&render_lock());

    let modified: Vec<String> = current
        .iter()
        .filter(|&(version, sum)| locked.get(version).is_some_and(|pinned| pinned != sum))
        .map(|(version, _)| format!("{version:04}"))
        .collect();
    assert!(
        modified.is_empty(),
        "applied migration(s) {modified:?} changed: sqlx refuses to start on any database that \
         already ran them. Restore the file (`git checkout origin/main -- db/migrations/<file>`) \
         and fix forward with a new migration instead of editing it."
    );

    let unlocked: Vec<&i64> = current.keys().filter(|v| !locked.contains_key(*v)).collect();
    let removed: Vec<&i64> = locked.keys().filter(|v| !current.contains_key(*v)).collect();
    assert!(
        unlocked.is_empty() && removed.is_empty(),
        "db/migrations.lock is out of step (unpinned: {unlocked:?}, missing files: {removed:?}); \
         run `{UPDATE_VAR}=1 cargo test -p omnibus-db migration_lock` and commit it. \
         A removed or renumbered applied migration breaks existing installs too."
    );
}

#[test]
fn parse_lock_ignores_comments_and_reads_version_and_checksum() {
    let parsed = parse_lock("# header\n\n0093 abc sitting_scoped\n0094 def session_time_zone\n");
    assert_eq!(parsed.get(&93).map(String::as_str), Some("abc"));
    assert_eq!(parsed.len(), 2);
}
