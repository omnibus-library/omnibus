#!/usr/bin/env python3
"""Tests for scripts/koreader_home.py, which links a new KOReader home to the
dev server on its first launch (`just koreader`).

link_home runs against a fake Omnibus server speaking the REST routes it uses,
over real HTTP and real temp dirs.

    python3 scripts/tests/koreader-home.test.py
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from koreader_home import LinkError, device_name, link_home, lua_literal, parse_seed_user  # noqa: E402

SEED = ("admin", "seed-pw:with-colon")
ORIGIN = "http://device.test:3999"
DEVICE_TOKEN = "device-token-1"


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

    def __init__(self, *, login_ok=True, devices=None, kosync_configured=False, fail_route=None):
        self.login_ok = login_ok
        self.fail_route = fail_route
        self.devices = devices if devices is not None else []
        self.kosync_configured = kosync_configured
        self.requests: list[tuple[str, str]] = []
        self.logins: list[dict] = []
        self.created: list[dict] = []
        self.kosync_password: str | None = None
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
                    return self.json_reply({"user": {"username": body["username"]}, "token": "session-1"})
                if (method, self.path) == fake.fail_route:
                    return self.json_reply({"error": "boom"}, 500)
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
                    fake.kosync_password = "generated-kosync-pw"
                    return self.json_reply({"username": SEED[0], "password": fake.kosync_password})
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

    def link(self, fake: FakeOmnibus, home: Path | None = None) -> bool:
        return link_home(home or self.home, fake.url, ORIGIN, self.state, SEED)

    def test_links_fresh_home_to_device_origin(self):
        fake = self.omnibus()

        self.assertTrue(self.link(fake))

        config = json.loads((self.home / "plugins/omnibus.koplugin/omnibus.json").read_text())
        self.assertEqual(config, {"server_url": ORIGIN, "token": DEVICE_TOKEN})
        self.assertTrue((self.home / "plugins/omnibus.koplugin/main.lua").is_file())
        self.assertEqual(
            [p.name for p in (self.home / "plugins").iterdir()], ["omnibus.koplugin"], "no temp dir is left behind"
        )
        userkey = hashlib.md5(b"generated-kosync-pw").hexdigest()
        self.assertEqual(
            (self.home / "settings/opds.lua").read_text(),
            'return { servers = { { title = "Omnibus (dev)", url = "http://device.test:3999/opds", '
            'username = "admin", password = "seed-pw:with-colon" } } }\n',
        )
        self.assertEqual(
            (self.home / "settings/kosync.lua").read_text(),
            'return { settings = { custom_server = "http://device.test:3999/kosync", username = "admin", '
            f'userkey = "{userkey}", auto_sync = true, sync_forward = 1, sync_backward = 3, '
            "checksum_method = 0, send_metadata = false } }\n",
        )
        self.assertEqual(fake.logins, [
            {"username": "admin", "password": "seed-pw:with-colon", "client_kind": "bearer", "device_name": "omnibus-koreader-dev"}
        ])
        self.assertEqual(fake.requests[-1], ("POST", "/api/auth/logout"))
        self.assertEqual((self.state / "kosync.json").stat().st_mode & 0o777, 0o600)

    def test_leaves_linked_home_alone(self):
        fake = self.omnibus()
        self.assertTrue(self.link(fake))
        fake.requests.clear()

        self.assertFalse(self.link(fake))

        self.assertEqual(fake.requests, [])

    def test_reuses_device_named_for_home(self):
        fake = self.omnibus(devices=[{"id": 7, "name": "Dev KOReader", "kind": "koreader", "token": DEVICE_TOKEN}])

        self.link(fake)

        self.assertEqual(fake.created, [])
        self.assertIn(("GET", "/api/account/kobo-devices/7/koreader-plugin"), fake.requests)

    def test_creates_a_koreader_device_named_for_home_when_none_matches(self):
        # A Kobo of the same name is a different device: only a koreader-kind one is reused.
        fake = self.omnibus(devices=[{"id": 7, "name": "Dev KOReader (second)", "kind": "kobo", "token": "k"}])
        second = self.root / "second"
        second.mkdir()

        self.link(fake, second)

        self.assertEqual(fake.created, [{"name": "Dev KOReader (second)", "kind": "koreader"}])

    def test_reuses_saved_kosync_key_when_server_has_one(self):
        fake = self.omnibus(kosync_configured=True)
        saved = {"username": "admin", "userkey": "0" * 32}
        self.state.mkdir(exist_ok=True)
        (self.state / "kosync.json").write_text(json.dumps(saved))

        self.link(fake)

        self.assertNotIn(("POST", "/api/account/kosync"), fake.requests)
        self.assertIn('userkey = "' + "0" * 32 + '"', (self.home / "settings/kosync.lua").read_text())

    def test_generates_kosync_password_when_server_has_none(self):
        fake = self.omnibus(kosync_configured=False)
        self.state.mkdir(exist_ok=True)
        (self.state / "kosync.json").write_text(json.dumps({"username": "admin", "userkey": "0" * 32}))

        self.link(fake)

        self.assertIn(("POST", "/api/account/kosync"), fake.requests)
        saved = json.loads((self.state / "kosync.json").read_text())
        self.assertEqual(saved["userkey"], hashlib.md5(b"generated-kosync-pw").hexdigest())

    def test_reports_rejected_login_and_leaves_home_unlinked(self):
        fake = self.omnibus(login_ok=False)

        with self.assertRaisesRegex(LinkError, "OMNIBUS_DEV_SEED_USER"):
            self.link(fake)

        self.assertFalse((self.home / "plugins").exists())
        self.assertFalse((self.home / "settings").exists())

    def test_names_route_and_status_and_logs_out_when_a_later_step_fails(self):
        fake = self.omnibus(fail_route=("GET", "/api/account/kobo-devices"))

        with self.assertRaisesRegex(LinkError, r"GET /api/account/kobo-devices answered 500"):
            self.link(fake)

        self.assertEqual(fake.requests[-1], ("POST", "/api/auth/logout"))
        self.assertFalse((self.home / "plugins/omnibus.koplugin").exists())


class LuaLiteralTests(unittest.TestCase):
    def test_lua_literal_escapes_quotes_backslashes_and_newlines(self):
        self.assertEqual(lua_literal('a"b\\c\nd\re'), '"a\\"b\\\\c\\nd\\re"')

    def test_lua_literal_renders_nested_values(self):
        value = {"list": [1, "x", True], "off": False}
        self.assertEqual(lua_literal(value), '{ list = { 1, "x", true }, off = false }')


class NamingTests(unittest.TestCase):
    def test_device_name_marks_non_default_home(self):
        state = Path("/tmp/state")
        self.assertEqual(device_name(state / "home", state), "Dev KOReader")
        self.assertEqual(device_name(state / "second", state), "Dev KOReader (second)")

    def test_parse_seed_user_splits_at_first_colon(self):
        self.assertEqual(parse_seed_user("admin:pw:with:colons"), ("admin", "pw:with:colons"))

    def test_parse_seed_user_rejects_value_without_colon(self):
        for bad in (None, "", "admin"):
            with self.assertRaisesRegex(LinkError, "OMNIBUS_DEV_SEED_USER"):
                parse_seed_user(bad)


if __name__ == "__main__":
    unittest.main()
