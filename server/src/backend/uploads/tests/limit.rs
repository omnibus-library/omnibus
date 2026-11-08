//! The upload size cap: none unless the operator sets `OMNIBUS_MAX_UPLOAD_BYTES`.

use omnibus_db::test_support::EnvVarGuard;

use super::super::*;

#[test]
fn max_upload_bytes_is_uncapped_when_env_unset() {
    let _env = EnvVarGuard::set("OMNIBUS_MAX_UPLOAD_BYTES", None);

    assert_eq!(max_upload_bytes(), usize::MAX);
}

#[test]
fn max_upload_bytes_uses_env_cap_when_set() {
    let _env = EnvVarGuard::set("OMNIBUS_MAX_UPLOAD_BYTES", Some("2048"));

    assert_eq!(max_upload_bytes(), 2048);
}
