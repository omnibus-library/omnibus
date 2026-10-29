//! Fixtures shared by the auth module's tests: a migrated pool and extra accounts.

use omnibus_shared::UserPermissions;
use sqlx::SqlitePool;

use crate::auth::users::{admin_create_user, get_user_by_id};
use crate::auth::User;
use crate::pool::init_db;

/// A migrated in-memory pool for the tests in this module.
pub async fn pool() -> SqlitePool {
    init_db("sqlite::memory:").await.expect("pool init")
}

/// A second account: self-registration closes after the first user, so it goes through
/// the admin path.
pub async fn second_user(p: &SqlitePool, name: &str, is_admin: bool) -> User {
    let row = admin_create_user(
        p,
        name,
        "bunker9-longer-pass",
        UserPermissions {
            is_admin,
            can_upload: false,
            can_edit: false,
            can_download: true,
        },
    )
    .await
    .unwrap();
    get_user_by_id(p, row.id).await.unwrap().unwrap()
}
