//! The request permissions a session reports: each stored grant, masked by the
//! `OMNIBUS_BOOK_REQUESTS` boot flag, on both `me` and `login`; and the flag itself.

use axum::body::to_bytes;
use omnibus_shared::{LoginResponse, UserSummary};
use serde::de::DeserializeOwned;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::fixture_book_requests;

use super::super::*;
use super::{app, bearer_req, json_req};

const PASSWORD: &str = "correct horse battery staple";

async fn json_of<T: DeserializeOwned>(res: axum::response::Response) -> T {
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn me(app: Router, token: &str) -> UserSummary {
    let res = app
        .oneshot(bearer_req("GET", "/api/auth/me", token))
        .await
        .unwrap();
    json_of(res).await
}

mod request_access {
    use super::*;

    #[test]
    fn follows_the_flag_and_the_stored_grant_with_admins_always_granted() {
        // (book_requests, is_admin, stored, want)
        let cases = [
            (false, true, true, false),
            (false, false, true, false),
            (true, true, false, true),
            (true, false, true, true),
            (true, false, false, false),
        ];
        for (enabled, is_admin, stored, want) in cases {
            assert_eq!(
                request_access(enabled, is_admin, stored),
                want,
                "enabled={enabled} is_admin={is_admin} stored={stored}"
            );
        }
    }
}

mod get_me {
    use super::*;

    #[tokio::test]
    async fn reports_no_request_access_for_an_admin_by_default() {
        let (app, pool) = app().await;
        let admin = auth_test_support::create_admin(&pool, "ada").await;
        let token = auth_test_support::bearer_token(&pool, admin.id).await;

        let summary = me(app, &token).await;

        assert!(!summary.can_start_requests && !summary.can_choose_request_versions);
    }

    #[tokio::test]
    async fn reports_request_access_for_a_granted_user_when_on() {
        let (_, state, pool) = fixture_book_requests(true).await;
        let user = auth_test_support::create_user(&pool, "reader").await;
        auth_test_support::set_request_flags(&pool, user.id, false, true, false).await;
        let token = auth_test_support::bearer_token(&pool, user.id).await;

        let summary = me(crate::auth::auth_router(state), &token).await;

        assert!(summary.can_start_requests);
        assert!(!summary.can_choose_request_versions);
    }

    #[tokio::test]
    async fn reports_each_request_permission_on_its_own() {
        let (_, state, pool) = fixture_book_requests(true).await;
        let user = auth_test_support::create_user(&pool, "reader").await;
        auth_test_support::set_request_flags(&pool, user.id, false, false, true).await;
        let token = auth_test_support::bearer_token(&pool, user.id).await;

        let summary = me(crate::auth::auth_router(state), &token).await;

        assert!(!summary.can_start_requests);
        assert!(summary.can_choose_request_versions);
    }
}

mod book_requests_flag {
    use super::*;

    #[tokio::test]
    async fn reaches_a_reader_without_the_permission_on_me_when_on() {
        let (_, state, pool) = fixture_book_requests(true).await;
        let user = auth_test_support::create_user(&pool, "reader").await;
        let token = auth_test_support::bearer_token(&pool, user.id).await;

        let summary = me(crate::auth::auth_router(state), &token).await;

        assert!(summary.book_requests);
        assert!(!summary.can_start_requests && !summary.can_choose_request_versions);
    }

    #[tokio::test]
    async fn reads_off_on_me_when_the_flag_is_off() {
        let (_, state, pool) = fixture_book_requests(false).await;
        let admin = auth_test_support::create_admin(&pool, "ada").await;
        let token = auth_test_support::bearer_token(&pool, admin.id).await;

        assert!(
            !me(crate::auth::auth_router(state), &token)
                .await
                .book_requests
        );
    }

    #[tokio::test]
    async fn reaches_a_reader_on_login_when_on() {
        let (_, state, pool) = fixture_book_requests(true).await;
        auth_test_support::create_user_with_password(&pool, "reader", PASSWORD).await;

        let res = crate::auth::auth_router(state)
            .oneshot(json_req(
                "/api/auth/login",
                "POST",
                serde_json::json!({"username": "reader", "password": PASSWORD, "client_kind": "ios"}),
            ))
            .await
            .unwrap();

        assert!(json_of::<LoginResponse>(res).await.user.book_requests);
    }
}

mod post_login {
    use super::*;

    #[tokio::test]
    async fn reports_request_access_for_an_admin_without_the_stored_grant_when_on() {
        let (_, state, pool) = fixture_book_requests(true).await;
        let user = auth_test_support::create_user_with_password(&pool, "reader", PASSWORD).await;
        auth_test_support::set_request_flags(&pool, user.id, true, false, false).await;

        let res = crate::auth::auth_router(state)
            .oneshot(json_req(
                "/api/auth/login",
                "POST",
                serde_json::json!({"username": "reader", "password": PASSWORD, "client_kind": "ios"}),
            ))
            .await
            .unwrap();

        let user = json_of::<LoginResponse>(res).await.user;
        assert!(user.can_start_requests && user.can_choose_request_versions);
    }

    #[tokio::test]
    async fn reports_exactly_the_stored_request_permissions_of_a_reader_when_on() {
        let (_, state, pool) = fixture_book_requests(true).await;
        let user = auth_test_support::create_user_with_password(&pool, "reader", PASSWORD).await;
        auth_test_support::set_request_flags(&pool, user.id, false, false, true).await;

        let res = crate::auth::auth_router(state)
            .oneshot(json_req(
                "/api/auth/login",
                "POST",
                serde_json::json!({"username": "reader", "password": PASSWORD, "client_kind": "ios"}),
            ))
            .await
            .unwrap();

        let user = json_of::<LoginResponse>(res).await.user;
        assert!(!user.can_start_requests);
        assert!(user.can_choose_request_versions);
    }

    #[tokio::test]
    async fn reports_no_request_permission_for_an_admin_when_the_flag_is_off() {
        let (_, state, pool) = fixture_book_requests(false).await;
        let user = auth_test_support::create_user_with_password(&pool, "reader", PASSWORD).await;
        auth_test_support::set_request_flags(&pool, user.id, true, true, true).await;

        let res = crate::auth::auth_router(state)
            .oneshot(json_req(
                "/api/auth/login",
                "POST",
                serde_json::json!({"username": "reader", "password": PASSWORD, "client_kind": "ios"}),
            ))
            .await
            .unwrap();

        let user = json_of::<LoginResponse>(res).await.user;
        assert!(!user.can_start_requests && !user.can_choose_request_versions);
    }
}
