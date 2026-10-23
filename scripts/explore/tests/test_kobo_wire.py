#!/usr/bin/env python3
"""Tests for `kobo_wire.py`, which wires an exploration account's "Mock Kobo" device.

Run them directly:

    python3 scripts/explore/tests/test_kobo_wire.py
    python3 -m unittest discover -s scripts/explore/tests

The decisions are unit tests. The CLI runs as a subprocess against `FakeOmnibus`,
a local server that speaks the slice of the Omnibus contract it uses.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import kobo_wire  # noqa: E402
from kobo_fakes import FakeOmnibus  # noqa: E402

KOBO_WIRE = HERE.parent / "kobo_wire.py"
PASSWORDS = {"explorer-1": "pw-one", "explorer-2": "pw-two"}


class PlanTests(unittest.TestCase):
    def test_plan_creates_a_device_when_none_matches(self):
        for have_state in (True, False):
            with self.subTest(have_state=have_state):
                self.assertEqual(kobo_wire.plan(have_state, 0), "create")

    def test_plan_reuses_the_one_device_when_the_state_file_matches(self):
        self.assertEqual(kobo_wire.plan(True, 1), "reuse")

    def test_plan_recreates_the_one_device_when_there_is_no_state_file(self):
        self.assertEqual(kobo_wire.plan(False, 1), "recreate")

    def test_plan_recreates_two_or_more_devices_with_or_without_a_state_file(self):
        for have_state in (True, False):
            for matching in (2, 3):
                with self.subTest(have_state=have_state, matching=matching):
                    self.assertEqual(kobo_wire.plan(have_state, matching), "recreate")


class StateMatchesTests(unittest.TestCase):
    URL = "https://omnibus-test.example.com"
    TOKEN = "tok-1"

    def saved(self, url=URL, token=TOKEN):
        return {"url": url, "token": token}

    def matches(self, saved, token=TOKEN):
        return kobo_wire.state_matches(saved, self.URL, token)

    def test_state_matches_when_url_and_token_both_agree(self):
        self.assertTrue(self.matches(self.saved()))

    def test_state_matches_ignoring_case_default_port_and_trailing_slash(self):
        for saved in (
            "HTTPS://Omnibus-Test.Example.com",
            "https://omnibus-test.example.com:443",
            "https://omnibus-test.example.com/",
        ):
            with self.subTest(saved=saved):
                self.assertTrue(self.matches(self.saved(url=saved)))

    def test_state_matches_ignoring_the_default_port_of_http(self):
        saved = {"url": "http://127.0.0.1:80/", "token": self.TOKEN}
        self.assertTrue(kobo_wire.state_matches(saved, "http://127.0.0.1", self.TOKEN))

    def test_state_does_not_match_another_instance(self):
        for saved in (
            "https://other.example.com",
            "http://omnibus-test.example.com",
            "https://omnibus-test.example.com:8443",
        ):
            with self.subTest(saved=saved):
                self.assertFalse(self.matches(self.saved(url=saved)))

    def test_state_does_not_match_another_devices_token(self):
        self.assertFalse(self.matches(self.saved(token="tok-2")))

    def test_state_does_not_match_without_a_usable_saved_url_and_token(self):
        for saved in (
            None,
            {},
            {"token": self.TOKEN},
            {"url": self.URL},
            {"url": None, "token": self.TOKEN},
            {"url": 3, "token": self.TOKEN},
            {"url": "http://host:99999", "token": self.TOKEN},
            {"url": self.URL, "token": None},
            ["url"],
            "https://omnibus-test.example.com",
        ):
            with self.subTest(saved=saved):
                self.assertFalse(self.matches(saved))


class InstanceUrlTests(unittest.TestCase):
    def instance_url(self, url):
        with mock.patch.dict(os.environ, {"OMNIBUS_EXPLORE_URL": url}):
            return kobo_wire.instance_url()

    def test_instance_url_refuses_a_port_that_is_not_a_port_number(self):
        for url in ("http://host:99999", "http://host:abc", "http://reader:secret@host:abc"):
            with self.subTest(url=url):
                with self.assertRaises(kobo_wire.UsageError) as raised:
                    self.instance_url(url)
                self.assertNotIn("secret", str(raised.exception))

    def test_instance_url_refuses_an_origin_with_no_scheme_or_host(self):
        for url in ("//host:8080", "http://", "http://:8080"):
            with self.subTest(url=url):
                with self.assertRaises(kobo_wire.UsageError):
                    self.instance_url(url)

    def test_instance_url_returns_the_normalised_origin(self):
        self.assertEqual(self.instance_url(" HTTP://Host:80/ "), "http://host")


class KoboWireCliTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.fake = FakeOmnibus(PASSWORDS)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def accounts_file(self, accounts=None) -> Path:
        accounts = accounts or [
            {"actor": f"agent-{i}", "username": user, "password": pw}
            for i, (user, pw) in enumerate(PASSWORDS.items(), start=1)
        ]
        path = self.dir / "provision.json"
        path.write_text(json.dumps(accounts))
        return path

    def wire(self, agent=1, accounts=None, state=None, url=None):
        state = state or self.dir / "state.json"
        env = {**os.environ, "OMNIBUS_EXPLORE_URL": self.fake.origin if url is None else url}
        return subprocess.run(
            [sys.executable, str(KOBO_WIRE), "--accounts", str(accounts or self.accounts_file()),
             "--agent", str(agent), "--state", str(state)],
            capture_output=True, text=True, env=env,
        )

    def save_state(self, token, url=None, name="state.json"):
        """Leave a device state file as `mock-kobo serve` would, recording `token` against `url`."""
        (self.dir / name).write_text(json.dumps({"url": self.fake.origin if url is None else url, "token": token}))

    def sent(self):
        return [(r["method"], r["path"]) for r in self.fake.requests]


class CreateTests(KoboWireCliTests):
    def test_prints_the_created_devices_details_as_json(self):
        proc = self.wire(agent=1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        [device] = self.fake.devices["explorer-1"]
        self.assertEqual(device["name"], "Mock Kobo")
        self.assertEqual(json.loads(proc.stdout), {
            "wired": "created",
            "url": self.fake.origin,
            "username": "explorer-1",
            "device_name": "Mock Kobo",
            "token": device["token"],
        })

    def test_logs_in_lists_creates_then_logs_out(self):
        self.wire(agent=2)

        self.assertEqual(self.sent(), [
            ("POST", "/api/auth/login"),
            ("GET", "/api/auth/me"),
            ("POST", "/api/rpc/kobo/devices"),
            ("POST", "/api/rpc/kobo/devices/create"),
            ("POST", "/api/auth/logout"),
        ])
        self.assertEqual(self.fake.calls("/api/auth/login")[0]["body"], {"username": "explorer-2", "password": "pw-two"})
        self.assertEqual(self.fake.calls("/api/rpc/kobo/devices/create")[0]["body"], {"name": "Mock Kobo"})

    def test_sends_the_instance_origin_on_every_post(self):
        self.wire()

        posts = [r for r in self.fake.requests if r["method"] == "POST"]
        self.assertEqual({r["origin"] for r in posts}, {self.fake.origin})

    def test_prints_the_token_on_stdout_only(self):
        proc = self.wire()

        token = self.fake.devices["explorer-1"][0]["token"]
        self.assertEqual(proc.stdout.count(token), 1)
        self.assertNotIn(token, proc.stderr)


class ReuseTests(KoboWireCliTests):
    def test_reuses_the_device_when_the_state_file_matches_it(self):
        device = self.fake.add_device("explorer-1", "Mock Kobo")
        self.save_state(device["token"])

        proc = self.wire()

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["wired"], "reused")
        self.assertEqual(json.loads(proc.stdout)["token"], device["token"])
        self.assertEqual(self.fake.devices["explorer-1"], [device])
        self.assertEqual(self.fake.calls("/api/rpc/kobo/devices/create"), [])
        self.assertEqual(self.fake.calls("/api/rpc/kobo/devices/revoke"), [])


class RecreateTests(KoboWireCliTests):
    def assert_recreated(self, proc, stale):
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(out["wired"], "recreated")
        self.assertNotEqual(out["token"], stale["token"])
        mine = [d for d in self.fake.devices["explorer-1"] if d["name"] == "Mock Kobo"]
        self.assertEqual([d["token"] for d in mine], [out["token"]])
        self.assertEqual(self.fake.calls("/api/rpc/kobo/devices/revoke")[0]["body"], {"id": stale["id"]})

    def test_recreates_the_device_when_there_is_no_state_file(self):
        stale = self.fake.add_device("explorer-1", "Mock Kobo")

        self.assert_recreated(self.wire(), stale)

    def test_recreates_the_device_when_the_state_file_names_another_instance(self):
        stale = self.fake.add_device("explorer-1", "Mock Kobo")
        self.save_state(stale["token"], url="http://elsewhere.example.com")

        self.assert_recreated(self.wire(), stale)

    def test_recreates_the_device_when_the_state_file_holds_another_devices_token(self):
        stale = self.fake.add_device("explorer-1", "Mock Kobo")
        self.save_state("tok-of-a-device-since-revoked")

        self.assert_recreated(self.wire(), stale)

    def test_recreates_the_device_when_another_checkout_wired_it_since(self):
        checkout_a, checkout_b = "state-a.json", "state-b.json"
        outcomes = []
        for state in (checkout_a, checkout_b, checkout_a):
            proc = self.wire(state=self.dir / state)
            out = json.loads(proc.stdout)
            outcomes.append(out["wired"])
            self.save_state(out["token"], name=state)

        self.assertEqual(outcomes, ["created", "recreated", "recreated"])

    def test_recreates_the_device_when_the_state_file_is_not_json(self):
        self.fake.add_device("explorer-1", "Mock Kobo")
        (self.dir / "state.json").write_text("not json")

        proc = self.wire()

        self.assertEqual(json.loads(proc.stdout)["wired"], "recreated", proc.stderr)

    def test_revokes_every_mock_kobo_before_creating_a_new_one(self):
        first = self.fake.add_device("explorer-1", "Mock Kobo")
        second = self.fake.add_device("explorer-1", "Mock Kobo")
        self.save_state(first["token"])

        proc = self.wire()

        self.assertEqual(json.loads(proc.stdout)["wired"], "recreated")
        revoked = [r["body"] for r in self.fake.calls("/api/rpc/kobo/devices/revoke")]
        self.assertEqual(revoked, [{"id": first["id"]}, {"id": second["id"]}])
        paths = [path for _, path in self.sent()]
        self.assertLess(paths.index("/api/rpc/kobo/devices/revoke"), paths.index("/api/rpc/kobo/devices/create"))
        self.assertEqual(paths.count("/api/rpc/kobo/devices/revoke"), 2)

    def test_leaves_a_same_named_koreader_alone_and_creates_a_kobo(self):
        koreader = self.fake.add_device("explorer-1", "Mock Kobo", kind="koreader")
        self.save_state(koreader["token"])

        proc = self.wire()

        self.assertEqual(json.loads(proc.stdout)["wired"], "created", proc.stderr)
        self.assertEqual(self.fake.calls("/api/rpc/kobo/devices/revoke"), [])
        self.assertIn(koreader, self.fake.devices["explorer-1"])

    def test_leaves_devices_with_other_names_alone(self):
        stale = self.fake.add_device("explorer-1", "Mock Kobo")
        other = self.fake.add_device("explorer-1", "Living Room")

        self.assert_recreated(self.wire(), stale)

        self.assertIn(other, self.fake.devices["explorer-1"])


class UsageErrorTests(KoboWireCliTests):
    def assert_refused_before_any_request(self, proc, *names):
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertEqual(proc.stdout, "")
        self.assertNotIn("Traceback", proc.stderr)
        for name in names:
            self.assertIn(name, proc.stderr)
        self.assertEqual(self.fake.requests, [])

    def test_exits_2_naming_the_agent_when_the_accounts_file_lacks_it(self):
        self.assert_refused_before_any_request(self.wire(agent=3), "agent-3")

    def test_exits_2_naming_both_when_the_account_is_not_explorer_k(self):
        accounts = self.accounts_file([{"actor": "agent-1", "username": "someone-else", "password": "pw-one"}])

        self.assert_refused_before_any_request(self.wire(agent=1, accounts=accounts), "explorer-1", "someone-else")

    def test_exits_2_when_the_accounts_file_cannot_be_read(self):
        self.assert_refused_before_any_request(self.wire(accounts=self.dir / "missing.json"), "missing.json")

    def test_exits_2_when_the_instance_url_is_empty(self):
        self.assert_refused_before_any_request(self.wire(url=""), "OMNIBUS_EXPLORE_URL")

    def test_exits_2_when_the_instance_url_is_more_than_an_origin(self):
        host = self.fake.origin.removeprefix("http://")
        for name, url in {
            "a path": f"http://{host}/omnibus",
            "a query": f"http://{host}?tenant=1",
            "a fragment": f"http://{host}#top",
            "credentials": f"http://reader:secret@{host}",
        }.items():
            with self.subTest(name):
                self.assert_refused_before_any_request(self.wire(url=url), "OMNIBUS_EXPLORE_URL")

    def test_exits_2_without_echoing_the_credentials_in_the_instance_url(self):
        proc = self.wire(url=self.fake.origin.replace("http://", "http://reader:secret@"))

        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertNotIn("secret", proc.stderr)


class InstanceFailureTests(KoboWireCliTests):
    DEVICE_CALLS = (
        "/api/rpc/kobo/devices",
        "/api/rpc/kobo/devices/revoke",
        "/api/rpc/kobo/devices/create",
    )

    def assert_failed_cleanly(self, proc):
        self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertEqual(proc.stdout, "")
        self.assertNotIn("Traceback", proc.stderr)

    def wire_while_failing(self, path):
        """Wire against a stale "Mock Kobo" while `path` answers 500, so every device call is reached."""
        self.fake.requests.clear()
        self.fake.fail(path, 500)
        try:
            return self.wire()
        finally:
            self.fake.recover(path)

    def test_exits_1_when_the_login_is_rejected(self):
        accounts = self.accounts_file([{"actor": "agent-1", "username": "explorer-1", "password": "wrong"}])

        proc = self.wire(accounts=accounts)

        self.assert_failed_cleanly(proc)
        self.assertIn("login as explorer-1 failed (HTTP 401)", proc.stderr)

    def test_exits_1_when_the_instance_is_unreachable(self):
        proc = self.wire(url="http://127.0.0.1:1")

        self.assert_failed_cleanly(proc)

    def test_exits_1_naming_the_failed_call_when_a_device_call_fails(self):
        stale = self.fake.add_device("explorer-1", "Mock Kobo")
        for path in self.DEVICE_CALLS:
            with self.subTest(path=path):
                proc = self.wire_while_failing(path)
                self.assert_failed_cleanly(proc)
                self.assertIn(f"POST {path} -> HTTP 500", proc.stderr)
                self.assertNotIn(stale["token"], proc.stderr)

    def test_logs_out_when_a_device_call_fails(self):
        self.fake.add_device("explorer-1", "Mock Kobo")
        for path in self.DEVICE_CALLS:
            with self.subTest(path=path):
                self.wire_while_failing(path)
                self.assertEqual(self.sent()[-1], ("POST", "/api/auth/logout"))


if __name__ == "__main__":
    unittest.main()
