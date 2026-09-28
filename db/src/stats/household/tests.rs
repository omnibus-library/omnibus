//! `household_readers`: list ordering/exclusion, the avatar flag, and DB
//! failure propagation.

use omnibus_shared::HouseholdReader;

use super::household_readers;
use crate::auth::{set_display_name, set_share_stats, upsert_user_avatar};
use crate::init_db;
use crate::test_support::{seed_user, solid_color_png};

#[tokio::test]
async fn household_readers_lists_the_caller_first_then_sharers_by_name_and_excludes_non_sharers() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let caller = seed_user(&pool, "caller").await;
    seed_user(&pool, "alice").await;
    let zed = seed_user(&pool, "zed").await;
    set_display_name(&pool, zed, Some("Bob")).await.unwrap();
    let dave = seed_user(&pool, "dave").await;
    set_share_stats(&pool, dave, false).await.unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice", "Bob"]);
    assert!(!names.contains(&"dave"));
    assert!(readers[0].is_you);
    assert!(readers[1..].iter().all(|r| !r.is_you));
}

#[tokio::test]
async fn household_readers_has_avatar_true_only_for_a_reader_with_an_avatar_row() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let caller = seed_user(&pool, "caller").await;
    let alice = seed_user(&pool, "alice").await;
    upsert_user_avatar(&pool, alice, "image/png", &solid_color_png(1, 2, 3, 4, 4))
        .await
        .unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let alice_entry = readers.iter().find(|r| r.name == "alice").unwrap();
    assert!(alice_entry.has_avatar);
    let caller_entry: &HouseholdReader = readers.iter().find(|r| r.is_you).unwrap();
    assert!(!caller_entry.has_avatar);
}

#[tokio::test]
async fn household_readers_propagates_db_error_when_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = household_readers(&pool, 1).await.unwrap_err();
    assert!(matches!(err, crate::stats::StatsError::Sqlx(_)));
}
