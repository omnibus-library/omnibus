#!/usr/bin/env python3
"""Tests for scripts/koreader_home.py, which links a fresh KOReader home to the
dev server (`just koreader`).

link_home runs against a fake Omnibus server speaking the REST routes it uses,
over real HTTP and real temp dirs.

    python3 scripts/tests/koreader-home.test.py
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import zipfile
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from koreader_home import (  # noqa: E402
    DEVICE_NAME,
    LinkError,
    install_plugin_zip,
    link_home,
    lua_literal,
    main,
    parse_seed_user,
    plugin_server_url,
)

SEED = ("admin", "seed-pw:with-colon")
ORIGIN = "http://device.test:3999"
DEVICE_TOKEN = "device-token-1"
KOSYNC_USERKEY = "f6121a1ebba66bfe5801cad01dfb80e5"  # md5 of the fake server's generated password


def plugin_zip(token: str) -> bytes:
    """What the Settings download hands a reader: the folder, configured for the server's own origin."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("omnibus.koplugin/main.lua", "-- plugin")
        config = {"server_url": "http://internal-backend:1234", "token": token}
        z.writestr("omnibus.koplugin/omnibus.json", json.dumps(config))
    return out.getvalue()


class FakeOmnibus:
    """The REST routes link_home calls, answering from this object's state."""

    def __init__(
        self, *, login_ok=True, devices=None, kosync_configured=False, kosync_userkey=None, fail_route=None, login_body=None
    ):
        self.login_ok = login_ok
        self.login_body = login_body
        self.fail_route = fail_route
        self.devices = devices if devices is not None else []
        self.kosync_configured = kosync_configured
        self.requests: list[tuple[str, str]] = []
        self.logins: list[dict] = []
        self.created: list[dict] = []
        self.kosync_userkey = kosync_userkey  # the key /kosync/users/auth accepts
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status: int, body: bytes = b"", ctype: str = "application/json"):
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def json_reply(self, payload, status: int = 200):
                self.reply(status, json.dumps(payload).encode())

            def handle_any(self, method: str):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw) if raw else None
                fake.requests.append((method, self.path))
                if (method, self.path) == ("POST", "/api/auth/login"):
                    fake.logins.append(body)
                    if not fake.login_ok:
                        return self.json_reply({"error": "bad credentials"}, 401)
                    if fake.login_body is not None:
                        return self.reply(200, fake.login_body, "text/html")
                    return self.json_reply({"user": {"username": body["username"]}, "token": "session-1"})
                if (method, self.path) == fake.fail_route:
                    return self.json_reply({"error": "boom"}, 500)
                if (method, self.path) == ("GET", "/kosync/users/auth"):
                    if self.headers.get("Accept") != "application/vnd.koreader.v1+json":
                        return self.json_reply({"code": 101}, 412)
                    key = (self.headers.get("x-auth-user"), self.headers.get("x-auth-key"))
                    if fake.kosync_userkey is None or key != (SEED[0], fake.kosync_userkey):
                        return self.json_reply({"code": 2001, "message": "Unauthorized"}, 401)
                    return self.json_reply({"authorized": "OK"})
                if self.headers.get("Authorization") != "Bearer session-1":
                    return self.json_reply({"error": "unauthorized"}, 401)
                if (method, self.path) == ("POST", "/api/auth/logout"):
                    return self.reply(204)
                if (method, self.path) == ("GET", "/api/account/kobo-devices"):
                    return self.json_reply(fake.devices)
                if (method, self.path) == ("POST", "/api/account/kobo-devices"):
                    fake.created.append(body)
                    device = {"id": 40 + len(fake.created), "token": DEVICE_TOKEN, **body}
                    fake.devices.append(device)
                    return self.json_reply(device, 201)
                if method == "GET" and self.path.endswith("/koreader-plugin"):
                    return self.reply(200, plugin_zip(DEVICE_TOKEN), "application/zip")
                if (method, self.path) == ("GET", "/api/account/kosync"):
                    return self.json_reply({"configured": fake.kosync_configured})
                if (method, self.path) == ("POST", "/api/account/kosync"):
                    fake.kosync_configured = True
                    fake.kosync_userkey = KOSYNC_USERKEY
                    return self.json_reply({"username": SEED[0], "password": "generated-kosync-pw"})
                self.json_reply({"error": "no such route"}, 404)

            def do_GET(self):
                self.handle_any("GET")

            def do_POST(self):
                self.handle_any("POST")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class LinkHomeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.state = self.root / "state"
        self.home = self.state / "home"
        self.home.mkdir(parents=True)

    def omnibus(self, **kwargs) -> FakeOmnibus:
        fake = FakeOmnibus(**kwargs)
        self.addCleanup(fake.close)
        return fake

    def link(self, fake: FakeOmnibus, home: Path | None = None) -> None:
        link_home(home or self.home, fake.url, ORIGIN, self.state, SEED)

    def save_key(self, fake: FakeOmnibus, userkey: str, account: str = SEED[0]) -> Path:
        """A key cached by an earlier link to `fake` as `account`."""
        return self.save_kosync(json.dumps({"server": fake.url, "account": account, "username": account, "userkey": userkey}))

    def save_kosync(self, text: str, mode: int = 0o644) -> Path:
        saved = self.state / "kosync.json"
        saved.write_text(text)
        saved.chmod(mode)
        return saved

    def test_links_fresh_home_to_device_origin(self):
        fake = self.omnibus()

        self.link(fake)

        config = json.loads((self.home / "plugins/omnibus.koplugin/omnibus.json").read_text())
        self.assertEqual(config, {"server_url": ORIGIN, "token": DEVICE_TOKEN})
        self.assertTrue((self.home / "plugins/omnibus.koplugin/main.lua").is_file())
        self.assertEqual(
            [p.name for p in (self.home / "plugins").iterdir()], ["omnibus.koplugin"], "no temp dir is left behind"
        )
        self.assertEqual(
            (self.home / "settings/opds.lua").read_text(),
            'return { servers = { { title = "Omnibus (dev)", url = "http://device.test:3999/opds", '
            'username = "admin", password = "seed-pw:with-colon" } } }\n',
        )
        self.assertEqual(
            (self.home / "settings/kosync.lua").read_text(),
            'return { settings = { custom_server = "http://device.test:3999/kosync", username = "admin", '
            f'userkey = "{KOSYNC_USERKEY}", auto_sync = true, sync_forward = 1, sync_backward = 3, '
            "checksum_method = 0, send_metadata = false } }\n",
        )
        self.assertEqual(
            fake.logins,
            [{"username": "admin", "password": "seed-pw:with-colon", "client_kind": "bearer", "device_name": "omnibus-koreader-dev"}],
        )
        self.assertEqual(fake.requests[-1], ("POST", "/api/auth/logout"))
        self.assertEqual((self.state / "kosync.json").stat().st_mode & 0o777, 0o600)

    def test_makes_the_linked_home_private_to_its_owner(self):
        self.home.chmod(0o755)

        self.link(self.omnibus())

        self.assertEqual(self.home.stat().st_mode & 0o777, 0o700)

    def test_replaces_a_plugin_folder_that_has_no_config(self):
        stale = self.home / "plugins/omnibus.koplugin"
        stale.mkdir(parents=True)
        (stale / "main.lua").write_text("-- stale")

        self.link(self.omnibus())

        self.assertEqual((stale / "main.lua").read_text(), "-- plugin")
        self.assertTrue((stale / "omnibus.json").is_file())

    def test_generates_the_kosync_password_once_when_two_launches_race(self):
        fake = self.omnibus()
        second = self.root / "second"
        second.mkdir()
        launches = [threading.Thread(target=self.link, args=(fake, home)) for home in (self.home, second)]

        for t in launches:
            t.start()
        for t in launches:
            t.join()

        self.assertEqual(fake.requests.count(("POST", "/api/account/kosync")), 1)

    def test_reuses_the_koreader_device_named_dev_koreader(self):
        fake = self.omnibus(devices=[{"id": 7, "name": "Dev KOReader", "kind": "koreader", "token": DEVICE_TOKEN}])

        self.link(fake)

        self.assertEqual(fake.created, [])
        self.assertIn(("GET", "/api/account/kobo-devices/7/koreader-plugin"), fake.requests)

    def test_creates_a_koreader_device_named_dev_koreader_when_none_matches(self):
        # A Kobo of the same name is a different device: only a koreader-kind one is reused.
        fake = self.omnibus(devices=[{"id": 7, "name": "Dev KOReader", "kind": "kobo", "token": "k"}])

        self.link(fake)

        self.assertEqual(fake.created, [{"name": "Dev KOReader", "kind": "koreader"}])

    def test_names_every_home_after_the_same_device(self):
        fake = self.omnibus()
        second = self.root / "second"
        second.mkdir()

        self.link(fake)
        self.link(fake, second)

        self.assertEqual(fake.created, [{"name": DEVICE_NAME, "kind": "koreader"}])

    def test_reuses_saved_kosync_key_when_server_has_one(self):
        fake = self.omnibus(kosync_configured=True, kosync_userkey="0" * 32)
        self.save_key(fake, "0" * 32)

        self.link(fake)

        self.assertNotIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertIn('userkey = "' + "0" * 32 + '"', (self.home / "settings/kosync.lua").read_text())

    def test_generates_kosync_password_when_saved_key_belongs_to_another_account(self):
        fake = self.omnibus(kosync_configured=True, kosync_userkey="0" * 32)
        self.save_key(fake, "0" * 32, account="someone-else")

        with contextlib.redirect_stderr(io.StringIO()):
            self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        saved = json.loads((self.state / "kosync.json").read_text())
        self.assertEqual((saved["account"], saved["userkey"]), (SEED[0], KOSYNC_USERKEY))

    def test_generates_kosync_password_when_saved_key_was_cached_for_another_server(self):
        fake = self.omnibus(kosync_configured=True, kosync_userkey="0" * 32)
        self.save_kosync(
            json.dumps({"server": "http://127.0.0.1:1", "account": SEED[0], "username": SEED[0], "userkey": "0" * 32})
        )

        with contextlib.redirect_stderr(io.StringIO()):
            self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertEqual(json.loads((self.state / "kosync.json").read_text())["server"], fake.url)

    def test_generates_kosync_password_when_the_server_rejects_the_saved_key(self):
        fake = self.omnibus(kosync_configured=True, kosync_userkey="1" * 32)
        self.save_key(fake, "0" * 32)
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertEqual(json.loads((self.state / "kosync.json").read_text())["userkey"], KOSYNC_USERKEY)
        self.assertIn("the server rejected the saved key", stderr.getvalue())

    def test_generates_kosync_password_when_server_has_none(self):
        fake = self.omnibus(kosync_configured=False)
        saved = self.save_kosync(json.dumps({"username": "admin", "userkey": "0" * 32}), mode=0o644)

        self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertEqual(json.loads(saved.read_text())["userkey"], KOSYNC_USERKEY)
        self.assertEqual(saved.stat().st_mode & 0o777, 0o600)

    def test_generates_kosync_password_when_saved_key_is_unreadable(self):
        fake = self.omnibus(kosync_configured=True)
        saved = self.save_kosync("")

        with contextlib.redirect_stderr(io.StringIO()):
            self.link(fake)

        self.assertEqual(json.loads(saved.read_text())["userkey"], KOSYNC_USERKEY)

    def test_says_so_when_it_replaces_a_password_it_holds_no_key_for(self):
        fake = self.omnibus(kosync_configured=True)
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertEqual(json.loads((self.state / "kosync.json").read_text())["userkey"], KOSYNC_USERKEY)
        self.assertEqual(
            stderr.getvalue(),
            "koreader: replacing the account's progress-sync password: no saved key for it was found\n",
        )

    def test_rejects_an_api_that_is_not_loopback_before_sending_the_seed_password(self):
        with self.assertRaisesRegex(LinkError, "loopback"):
            link_home(self.home, "http://192.0.2.1:9", ORIGIN, self.state, SEED)

    def test_ignores_proxy_settings_for_the_local_api(self):
        fake = self.omnibus()

        with mock.patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"}):
            self.link(fake)

    def test_reports_rejected_login(self):
        with self.assertRaisesRegex(LinkError, "OMNIBUS_DEV_SEED_USER"):
            self.link(self.omnibus(login_ok=False))

    def test_leaves_home_unlinked_when_login_is_rejected(self):
        with self.assertRaises(LinkError):
            self.link(self.omnibus(login_ok=False))

        self.assertFalse((self.home / "plugins").exists())
        self.assertFalse((self.home / "settings").exists())

    def test_names_route_and_status_when_a_route_fails(self):
        fake = self.omnibus(fail_route=("GET", "/api/account/kosync"))

        with self.assertRaisesRegex(LinkError, r"GET /api/account/kosync answered 500"):
            self.link(fake)

    def test_logs_out_when_a_later_step_fails(self):
        fake = self.omnibus(fail_route=("GET", "/api/account/kosync"))

        with self.assertRaises(LinkError):
            self.link(fake)

        self.assertEqual(fake.requests[-1], ("POST", "/api/auth/logout"))

    def test_leaves_home_unlinked_when_a_later_step_fails(self):
        fake = self.omnibus(fail_route=("GET", "/api/account/kosync"))

        with self.assertRaises(LinkError):
            self.link(fake)

        self.assertFalse((self.home / "plugins/omnibus.koplugin").exists())


class MainTests(unittest.TestCase):
    def run_main(self, env: dict, api: str = "http://127.0.0.1:9") -> tuple[int, str]:
        home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, home, True)
        (home / "home").mkdir()
        argv = ["--home", str(home / "home"), "--api", api, "--origin", ORIGIN, "--state-dir", str(home)]
        stderr = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), contextlib.redirect_stderr(stderr):
            return main(argv), stderr.getvalue()

    def test_reports_a_missing_seed_user_as_one_line(self):
        status, stderr = self.run_main({})

        self.assertEqual(status, 1)
        self.assertEqual(stderr, "koreader: OMNIBUS_DEV_SEED_USER must be set to user:password (see .env.example)\n")

    def test_reports_a_login_answer_that_is_not_json_as_one_line(self):
        fake = FakeOmnibus(login_body=b"<html>not an api</html>")
        self.addCleanup(fake.close)

        status, stderr = self.run_main({"OMNIBUS_DEV_SEED_USER": "admin:pw"}, api=fake.url)

        self.assertEqual(status, 1)
        self.assertEqual(stderr, "koreader: POST /api/auth/login answered something that isn't JSON\n")


def zip_of(files: dict[str, str]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return out.getvalue()


def plugin_zip_for(server_url, token: str = "plugin-token") -> bytes:
    """A plugin zip as an instance's Settings download hands it out, baked for `server_url`."""
    config = {"server_url": server_url, "token": token}
    return zip_of({"omnibus.koplugin/main.lua": "-- plugin", "omnibus.koplugin/omnibus.json": json.dumps(config)})


class PluginZipTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.home.mkdir()

    def write(self, data: bytes, name: str = "omnibus-koreader.zip") -> Path:
        path = self.root / name
        path.write_bytes(data)
        return path

    def refusal(self, data: bytes) -> str:
        path = self.write(data)
        with self.assertRaises(LinkError) as caught:
            install_plugin_zip(self.home, path)
        self.assertFalse((self.home / "plugins/omnibus.koplugin").exists())
        return str(caught.exception).replace(str(path), "<path>")

    def test_plugin_server_url_reads_the_server_url_of_the_zips_config(self):
        self.assertEqual(plugin_server_url(plugin_zip_for("https://omnibus.example")), "https://omnibus.example")

    def test_installs_the_plugin_with_the_zips_own_config_and_returns_its_server(self):
        path = self.write(plugin_zip_for("https://omnibus.example", token="abc"))

        server = install_plugin_zip(self.home, path)

        self.assertEqual(server, "https://omnibus.example")
        config = json.loads((self.home / "plugins/omnibus.koplugin/omnibus.json").read_text())
        self.assertEqual(config, {"server_url": "https://omnibus.example", "token": "abc"})
        self.assertTrue((self.home / "plugins/omnibus.koplugin/main.lua").is_file())

    def test_refuses_a_file_that_is_not_a_zip(self):
        self.assertEqual(self.refusal(b"hosts file"), "<path> is not an Omnibus plugin zip: not a zip file")

    def test_refuses_a_zip_without_the_plugins_config(self):
        data = zip_of({"omnibus.koplugin/main.lua": "-- plugin"})

        self.assertEqual(
            self.refusal(data), "<path> is not an Omnibus plugin zip: no omnibus.koplugin/omnibus.json"
        )

    def test_refuses_a_config_with_no_http_server_url(self):
        reason = "<path> is not an Omnibus plugin zip: omnibus.json has no http(s) server_url"
        for config in ('{"token": "t"}', '{"server_url": 5}', '{"server_url": "ftp://h"}', "[]", "not json"):
            with self.subTest(config=config):
                self.assertEqual(self.refusal(zip_of({"omnibus.koplugin/omnibus.json": config})), reason)

    def test_refuses_a_loopback_server_url_and_points_at_local(self):
        for server in (
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://[::1]:3000",
            "http://0.0.0.0:3000",
            "http://[::]:3000",
        ):
            with self.subTest(server=server):
                message = self.refusal(plugin_zip_for(server))
                self.assertEqual(
                    message,
                    f"<path> syncs with {server}, which the container can't reach: use --local for this worktree's dev server",
                )

    def test_refuses_a_missing_file(self):
        missing = self.root / "gone.zip"

        with self.assertRaisesRegex(LinkError, f"^no such file: {missing}$"):
            install_plugin_zip(self.home, missing)


class MainPluginTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        self.home.mkdir()
        self.zip = self.root / "plugin.zip"
        self.zip.write_bytes(plugin_zip_for("https://omnibus.example"))

    def run_main(self, argv: list[str]) -> tuple[int, str, str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                status = main(argv)
            except SystemExit as exit:
                status = exit.code
        return status, stdout.getvalue(), stderr.getvalue()

    def test_says_which_server_the_plugin_will_sync_with(self):
        status, stdout, stderr = self.run_main(["--home", str(self.home), "--plugin", str(self.zip)])

        self.assertEqual((status, stdout, stderr), (0, "koreader: KOReader will sync with https://omnibus.example\n", ""))
        self.assertTrue((self.home / "plugins/omnibus.koplugin/omnibus.json").is_file())

    def test_reports_a_refused_zip_as_one_line(self):
        self.zip.write_bytes(b"not a zip")

        status, stdout, stderr = self.run_main(["--home", str(self.home), "--plugin", str(self.zip)])

        self.assertEqual((status, stdout), (1, ""))
        self.assertEqual(stderr, f"koreader: {self.zip} is not an Omnibus plugin zip: not a zip file\n")

    def test_rejects_plugin_combined_with_the_link_arguments(self):
        for extra in (["--api", "http://127.0.0.1:1"], ["--origin", ORIGIN], ["--state-dir", str(self.root)]):
            with self.subTest(extra=extra):
                argv = ["--home", str(self.home), "--plugin", str(self.zip), *extra]
                self.assertEqual(self.run_main(argv)[0], 2)

    def test_requires_all_three_link_arguments_without_plugin(self):
        argv = ["--home", str(self.home), "--api", "http://127.0.0.1:1", "--origin", ORIGIN]

        self.assertEqual(self.run_main(argv)[0], 2)


class LuaLiteralTests(unittest.TestCase):
    def test_lua_literal_escapes_quotes_backslashes_and_newlines(self):
        self.assertEqual(lua_literal('a"b\\c\nd\re'), '"a\\"b\\\\c\\nd\\re"')

    def test_lua_literal_renders_nested_values(self):
        value = {"list": [1, "x", True], "off": False}
        self.assertEqual(lua_literal(value), '{ list = { 1, "x", true }, off = false }')


class SeedUserTests(unittest.TestCase):
    def test_parse_seed_user_splits_at_first_colon(self):
        self.assertEqual(parse_seed_user("admin:pw:with:colons"), ("admin", "pw:with:colons"))

    def test_parse_seed_user_rejects_value_without_colon(self):
        for bad in (None, "", "admin"):
            with self.assertRaisesRegex(LinkError, "OMNIBUS_DEV_SEED_USER"):
                parse_seed_user(bad)


if __name__ == "__main__":
    unittest.main()
