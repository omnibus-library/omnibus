//! Server-only helpers behind the stats server functions: the readers list,
//! the share gate's message, a sharer's success path, admin no-bypass, and a
//! DB failure genericized to `internal server error`.

use super::household_readers;

async fn pool_with_user(name: &str) -> (sqlx::SqlitePool, i64) {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    let id = omnibus_db::test_support::seed_user(&pool, name).await;
    (pool, id)
}

#[tokio::test]
async fn household_readers_returns_the_caller_first_and_excludes_a_non_sharer() {
    let (pool, caller) = pool_with_user("caller").await;
    omnibus_db::test_support::seed_user(&pool, "alice").await;
    let dave = omnibus_db::test_support::seed_user(&pool, "dave").await;
    omnibus_db::auth::set_share_stats(&pool, dave, false)
        .await
        .unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice"]);
    assert!(readers[0].is_you);
}
