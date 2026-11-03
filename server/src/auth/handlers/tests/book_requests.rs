//! The `can_request` a session reports: the stored permission, masked by the
//! `OMNIBUS_BOOK_REQUESTS` boot flag, on both `me` and `login`.

use axum::{body::to_bytes, Router};
use omnibus_shared::UserSummary;
use tower::ServiceExt;

use super::super::*;
use super::{bearer_req, json_req};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::fixture_book_requests;

const PASSWORD: &str = "correct horse battery staple";

/// A user with the given stored flags, on an auth router whose flag is `enabled`.
async fn account(
    enabled: bool,
    is_admin: bool,
    can_request: bool,
) -> (Router, sqlx::SqlitePool, i64) {
    let (_, state, pool) = fixture_book_requests(enabled).await;
    let user = auth_test_support::create_user_with_password(&pool, "reader", PASSWORD).await;
    sqlx::query("UPDATE users SET is_admin = ?, can_request = ? WHERE id = ?")
        .bind(is_admin)
        .bind(can_request)
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();
    (crate::auth::auth_router(state), pool, user.id)
}

async fn summary_of(res: axum::response::Response) -> UserSummary {
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn me_can_request(enabled: bool, is_admin: bool, can_request: bool) -> bool {
    let (app, pool, id) = account(enabled, is_admin, can_request).await;
    let token = auth_test_support::bearer_token(&pool, id).await;
    let res = app
        .oneshot(bearer_req("GET", "/api/auth/me", &token))
        .await
        .unwrap();
    summary_of(res).await.can_request
}

async fn login_can_request(enabled: bool, is_admin: bool, can_request: bool) -> bool {
    let (app, _, _) = account(enabled, is_admin, can_request).await;
    let res = app
        .oneshot(json_req(
            "/api/auth/login",
            "POST",
            serde_json::json!({"username": "reader", "password": PASSWORD, "client_kind": "ios"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<omnibus_shared::LoginResponse>(&bytes)
        .unwrap()
        .user
        .can_request
}

mod get_me {
    use super::*;

    mod flag_off {
        use super::*;

        #[tokio::test]
        async fn reports_no_request_access_for_an_admin() {
            assert!(!me_can_request(false, true, false).await);
        }

        #[tokio::test]
        async fn reports_no_request_access_for_a_granted_user() {
            assert!(!me_can_request(false, false, true).await);
        }
    }

    mod flag_on {
        use super::*;

        #[tokio::test]
        async fn reports_request_access_for_an_admin_without_the_stored_grant() {
            assert!(me_can_request(true, true, false).await);
        }

        #[tokio::test]
        async fn reports_request_access_for_a_granted_user() {
            assert!(me_can_request(true, false, true).await);
        }

        #[tokio::test]
        async fn reports_no_request_access_for_an_ungranted_user() {
            assert!(!me_can_request(true, false, false).await);
        }
    }
}

mod post_login {
    use super::*;

    mod flag_off {
        use super::*;

        #[tokio::test]
        async fn reports_no_request_access_for_an_admin() {
            assert!(!login_can_request(false, true, false).await);
        }

        #[tokio::test]
        async fn reports_no_request_access_for_a_granted_user() {
            assert!(!login_can_request(false, false, true).await);
        }
    }

    mod flag_on {
        use super::*;

        #[tokio::test]
        async fn reports_request_access_for_an_admin_without_the_stored_grant() {
            assert!(login_can_request(true, true, false).await);
        }

        #[tokio::test]
        async fn reports_request_access_for_a_granted_user() {
            assert!(login_can_request(true, false, true).await);
        }

        #[tokio::test]
        async fn reports_no_request_access_for_an_ungranted_user() {
            assert!(!login_can_request(true, false, false).await);
        }
    }
}
