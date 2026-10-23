#!/usr/bin/env python3
"""Tests for `kobo.sh`, the exploration swarm's Kobo lane.

Run them directly:

    python3 scripts/explore/tests/test_kobo_lane.py
    python3 -m unittest discover -s scripts/explore/tests

`kobo.sh` runs as a subprocess, as the runner and the agents run it. Omnibus is
`FakeOmnibus` and `mock-kobo` is the stub in `fixtures/`, so the processes, the
files and the HTTP are real and only the two outside programs are stood in for.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from kobo_fakes import FakeOmnibus  # noqa: E402

KOBO_SH = HERE.parent / "kobo.sh"
STUB = HERE / "fixtures" / "mock-kobo"
PASSWORDS = {"explorer-1": "pw-one", "explorer-2": "pw-two"}

USAGE_CASES = {
    "no command": [],
    "an unknown command": ["frobnicate", "--agent", "1"],
    "a missing agent": ["state"],
    "agent zero": ["state", "--agent", "0"],
    "agent with a leading zero": ["state", "--agent", "01"],
    "an agent that is not a number": ["state", "--agent", "x"],
    "a negative agent": ["state", "--agent", "-1"],
    "an agent that climbs out of the directory": ["state", "--agent", "../x"],
    "an agent flag with no value": ["state", "--agent"],
    "an unknown flag": ["state", "--agent", "1", "--bogus"],
    "down with a bad agent": ["down", "--agent", "0"],
    "up without accounts": ["up", "--agent", "1"],
    "up with an accounts file that does not exist": ["up", "--agent", "1", "--accounts", "/nonexistent/provision.json"],
}


def is_running(pid: int) -> bool:
    """Whether `pid` is a live process; a zombie awaiting its reaper is not.

    Existence comes from signal 0, not `ps`: a macOS `ps` without setuid root
    (nixpkgs' procps, first on PATH in the dev shell) prints a blank state for a
    live process. It still prints a zombie's `Z`, so `ps` only rules that out.
    """
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return not out.startswith("Z")


class KoboLaneTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.kobo_dir = self.dir / "kobo"
        self.fake = FakeOmnibus(PASSWORDS)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)
        self.addCleanup(self.kill_devices)
        self.accounts = self.dir / "provision.json"
        self.accounts.write_text(json.dumps([
            {"actor": f"agent-{i}", "username": user, "password": pw}
            for i, (user, pw) in enumerate(PASSWORDS.items(), start=1)
        ]))

    def kill_devices(self):
        for manifest in self.kobo_dir.glob("agent-*/manifest.json"):
            try:
                os.kill(json.loads(manifest.read_text())["pid"], signal.SIGKILL)
            except (OSError, ValueError, KeyError):
                pass

    def kobo(self, *args, mode="ok", env=None, script=KOBO_SH, cwd=None):
        """Run `script` with the lane's settings exported; an `env` value of `None` unsets that variable."""
        environment = {
            **os.environ,
            "OMNIBUS_EXPLORE_URL": self.fake.origin,
            "OMNIBUS_EXPLORE_MOCK_KOBO": str(STUB),
            "OMNIBUS_EXPLORE_KOBO_DIR": str(self.kobo_dir),
            "STUB_MOCK_KOBO_MODE": mode,
            **(env or {}),
        }
        environment = {key: value for key, value in environment.items() if value is not None}
        return subprocess.run(
            ["bash", str(script), *map(str, args)], capture_output=True, text=True, env=environment, cwd=cwd
        )

    def up(self, agent=1, **kwargs):
        proc = self.kobo("up", "--agent", agent, "--accounts", self.accounts, **kwargs)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def agent_dir(self, agent=1) -> Path:
        return self.kobo_dir / f"agent-{agent}"

    def stub_state(self, agent=1) -> dict:
        return json.loads((self.agent_dir(agent) / "state.json").read_text())

    def stub_get(self, manifest, path):
        """What the device's control API answers, asked directly rather than through `kobo.sh`."""
        with urllib.request.urlopen(f"http://127.0.0.1:{manifest['port']}{path}", timeout=10) as reply:
            return json.load(reply)

    def plant_manifest(self, agent, pid):
        """Leave `agent` a manifest that points at `pid`, running the stub, whatever that process is."""
        self.agent_dir(agent).mkdir(parents=True, exist_ok=True)
        manifest = {"actor": f"agent-{agent}", "pid": pid, "bin": str(STUB)}
        (self.agent_dir(agent) / "manifest.json").write_text(json.dumps(manifest))

    def stop_abruptly(self, manifest):
        os.kill(manifest["pid"], signal.SIGKILL)
        deadline = time.monotonic() + 5
        while is_running(manifest["pid"]) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(is_running(manifest["pid"]))


class UpTests(KoboLaneTestCase):
    def test_up_prints_one_manifest_line_describing_the_running_device(self):
        proc = self.kobo("up", "--agent", 1, "--accounts", self.accounts)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(proc.stdout.splitlines()), 1)
        manifest = json.loads(proc.stdout)
        self.assertTrue(is_running(manifest["pid"]))
        self.assertEqual(manifest["actor"], "agent-1")
        self.assertEqual(manifest["username"], "explorer-1")
        self.assertEqual(manifest["device_name"], "Mock Kobo")
        self.assertEqual(manifest["wired"], "created")
        self.assertEqual(manifest["url"], self.fake.origin)
        self.assertEqual(manifest["bin"], str(STUB))
        self.assertEqual(manifest["state"], str(self.agent_dir() / "state.json"))
        self.assertEqual(manifest["log"], str(self.agent_dir() / "serve.log"))
        self.assertEqual(manifest["hardware_id"], self.stub_state()["device"]["hardware_id"])
        self.assertGreater(manifest["port"], 0)
        self.assertEqual(json.loads((self.agent_dir() / "manifest.json").read_text()), manifest)

    def test_up_starts_the_device_with_serve_url_state_and_an_ephemeral_port(self):
        self.up(agent=1)

        self.assertEqual(self.stub_state()["argv"], [
            "serve", "--url", self.fake.origin, "--state", str(self.agent_dir() / "state.json"), "--port", "0",
        ])

    def test_up_hands_the_token_over_in_the_environment_not_the_command_line(self):
        self.up(agent=1)

        token = self.fake.devices["explorer-1"][0]["token"]
        state = self.stub_state()
        self.assertEqual(state["token"], token)
        self.assertNotIn(token, " ".join(state["argv"]))

    def test_up_never_writes_the_token_to_stdout_stderr_or_the_manifest(self):
        proc = self.kobo("up", "--agent", 1, "--accounts", self.accounts)

        token = self.fake.devices["explorer-1"][0]["token"]
        manifest = (self.agent_dir() / "manifest.json").read_text()
        for name, text in (("stdout", proc.stdout), ("stderr", proc.stderr), ("manifest", manifest)):
            with self.subTest(name):
                self.assertNotIn(token, text)

    def test_up_for_two_agents_leaves_two_devices_running_apart(self):
        first = self.up(agent=1)
        second = self.up(agent=2)

        self.assertTrue(is_running(first["pid"]))
        self.assertTrue(is_running(second["pid"]))
        self.assertEqual((first["username"], second["username"]), ("explorer-1", "explorer-2"))
        for field in ("port", "state", "pid", "hardware_id"):
            with self.subTest(field):
                self.assertNotEqual(first[field], second[field])
        self.assertEqual(self.fake.logins(), ["explorer-1", "explorer-2"])


class SettingsTests(KoboLaneTestCase):
    """`kobo.sh` takes its settings from the `.env` of the checkout it lives in, so these run a copy of it in a repo of their own."""

    def setUp(self):
        super().setUp()
        self.checkout = self.dir / "checkout"
        shutil.copytree(
            KOBO_SH.parent, self.checkout / "scripts" / "explore",
            ignore=shutil.ignore_patterns("tests", "__pycache__"),
        )
        subprocess.run(["git", "init", "-q", str(self.checkout)], check=True)

    def write_dotenv(self, **settings):
        (self.checkout / ".env").write_text("".join(f"{key}={value}\n" for key, value in settings.items()))

    def kobo_in_checkout(self, *args, env=None, cwd=None):
        unset = {"OMNIBUS_EXPLORE_MOCK_KOBO": None, "OMNIBUS_EXPLORE_KOBO_DIR": None}
        script = self.checkout / "scripts" / "explore" / "kobo.sh"
        return self.kobo(*args, script=script, env={**unset, **(env or {})}, cwd=cwd)

    def test_up_reads_its_settings_from_dotenv(self):
        self.write_dotenv(OMNIBUS_EXPLORE_MOCK_KOBO=STUB, OMNIBUS_EXPLORE_KOBO_DIR=self.kobo_dir)

        proc = self.kobo_in_checkout("up", "--agent", 1, "--accounts", self.accounts)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        manifest = json.loads(proc.stdout)
        self.assertEqual(manifest["bin"], str(STUB))
        self.assertEqual(manifest["state"], str(self.agent_dir() / "state.json"))

    def test_up_prefers_an_exported_setting_to_dotenv(self):
        from_dotenv = self.dir / "from-dotenv"
        self.write_dotenv(OMNIBUS_EXPLORE_MOCK_KOBO=STUB, OMNIBUS_EXPLORE_KOBO_DIR=from_dotenv)

        proc = self.kobo_in_checkout(
            "up", "--agent", 1, "--accounts", self.accounts,
            env={"OMNIBUS_EXPLORE_KOBO_DIR": str(self.kobo_dir)},
        )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue((self.agent_dir() / "manifest.json").exists())
        self.assertFalse(from_dotenv.exists())

    def test_a_relative_kobo_dir_is_taken_from_the_repo_root_whatever_the_working_directory(self):
        self.kobo_dir = self.checkout / "devices"
        env = {"OMNIBUS_EXPLORE_MOCK_KOBO": str(STUB), "OMNIBUS_EXPLORE_KOBO_DIR": "devices"}
        elsewhere = self.dir / "elsewhere"
        elsewhere.mkdir()

        up = self.kobo_in_checkout("up", "--agent", 1, "--accounts", self.accounts, env=env, cwd=elsewhere)
        state = self.kobo_in_checkout("state", "--agent", 1, env=env, cwd=self.dir)

        self.assertEqual(up.returncode, 0, up.stderr)
        self.assertTrue((self.agent_dir() / "manifest.json").exists())
        self.assertTrue(json.loads(state.stdout)["running"])


class UpRestartTests(KoboLaneTestCase):
    def test_up_for_a_running_device_prints_its_manifest_without_touching_the_instance(self):
        first = self.kobo("up", "--agent", 1, "--accounts", self.accounts)
        requests_before = len(self.fake.requests)

        again = self.kobo("up", "--agent", 1, "--accounts", self.accounts)

        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(again.stdout, first.stdout)
        self.assertEqual(len(self.fake.requests), requests_before)

    def test_up_rewires_a_running_device_when_the_exploration_instance_changes(self):
        first = self.up(agent=1)

        with FakeOmnibus(PASSWORDS) as elsewhere:
            second = self.up(agent=1, env={"OMNIBUS_EXPLORE_URL": elsewhere.origin})

            self.assertFalse(is_running(first["pid"]))
            self.assertTrue(is_running(second["pid"]))
            self.assertEqual(second["url"], elsewhere.origin)
            self.assertEqual(elsewhere.logins(), ["explorer-1"])

    def test_up_for_a_running_device_refuses_an_unusable_instance_url_and_leaves_it_running(self):
        first = self.up(agent=1)

        proc = self.kobo("up", "--agent", 1, "--accounts", self.accounts, env={"OMNIBUS_EXPLORE_URL": self.fake.origin + "/library"})

        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("OMNIBUS_EXPLORE_URL", proc.stderr)
        self.assertTrue(is_running(first["pid"]))

    def test_up_restarts_a_dead_device_with_its_hardware_id(self):
        first = self.up(agent=1)
        self.stop_abruptly(first)

        second = self.up(agent=1)

        self.assertTrue(is_running(second["pid"]))
        self.assertNotEqual(second["pid"], first["pid"])
        self.assertEqual(second["wired"], "reused")
        self.assertEqual(second["hardware_id"], first["hardware_id"])

    def test_up_treats_a_pid_that_belongs_to_another_program_as_not_running(self):
        bystander = subprocess.Popen(["sleep", "60"])
        self.addCleanup(bystander.wait)
        self.addCleanup(bystander.kill)
        self.agent_dir().mkdir(parents=True)
        (self.agent_dir() / "manifest.json").write_text(json.dumps({"pid": bystander.pid, "bin": str(STUB)}))

        manifest = self.up(agent=1)

        self.assertNotEqual(manifest["pid"], bystander.pid)
        self.assertTrue(is_running(manifest["pid"]))
        self.assertIsNone(bystander.poll())

    def test_up_deletes_a_state_file_the_instance_does_not_vouch_for(self):
        self.agent_dir().mkdir(parents=True)
        stale = {"url": self.fake.origin, "token": "old", "device": {"hardware_id": "mock-stale", "library": {}, "sync_token": None}}
        (self.agent_dir() / "state.json").write_text(json.dumps(stale))

        manifest = self.up(agent=1)

        self.assertEqual(manifest["wired"], "created")
        self.assertNotEqual(manifest["hardware_id"], "mock-stale")


class UpFailureTests(KoboLaneTestCase):
    def test_up_exits_with_the_wire_failure_code_leaving_no_device(self):
        wrong = self.dir / "wrong.json"
        wrong.write_text(json.dumps([{"actor": "agent-1", "username": "explorer-1", "password": "nope"}]))
        for accounts, agent, code in ((wrong, 1, 1), (self.accounts, 5, 2)):
            with self.subTest(agent=agent, code=code):
                proc = self.kobo("up", "--agent", agent, "--accounts", accounts)
                self.assertEqual(proc.returncode, code, proc.stderr)
                self.assertEqual(proc.stdout, "")
                self.assertFalse((self.agent_dir(agent) / "manifest.json").exists())
                self.assertFalse((self.agent_dir(agent) / "state.json").exists())

    def test_up_fails_fast_with_the_log_tail_when_the_device_exits_before_it_is_ready(self):
        started = time.monotonic()

        proc = self.kobo("up", "--agent", 1, "--accounts", self.accounts, mode="crash")

        self.assertEqual(proc.returncode, 1)
        self.assertLess(time.monotonic() - started, 10)
        self.assertIn("cannot bind 127.0.0.1:0 (stub crash)", proc.stderr)
        self.assertEqual(proc.stdout, "")
        self.assertFalse((self.agent_dir() / "manifest.json").exists())


class UpReadyTests(KoboLaneTestCase):
    def test_up_records_the_pid_of_the_device_it_started_when_the_log_has_another_ready_line(self):
        manifest = self.up(agent=1, mode="foreign_ready")

        self.assertEqual(manifest["pid"], self.stub_state()["pid"])


class UpPermissionTests(KoboLaneTestCase):
    def mode(self, path):
        return stat.S_IMODE(path.stat().st_mode)

    def assert_private(self):
        self.assertEqual(self.mode(self.agent_dir()), 0o700)
        self.assertEqual(self.mode(self.agent_dir() / "state.json"), 0o600)
        self.assertEqual(self.mode(self.agent_dir() / "serve.log"), 0o600)

    def test_up_creates_the_device_directory_and_its_files_private(self):
        self.up(agent=1)

        self.assert_private()

    def test_up_tightens_a_directory_and_files_left_open(self):
        first = self.up(agent=1)
        self.stop_abruptly(first)
        self.agent_dir().chmod(0o755)
        for name in ("state.json", "serve.log"):
            (self.agent_dir() / name).chmod(0o644)

        self.up(agent=1)

        self.assert_private()


class ActTests(KoboLaneTestCase):
    def test_act_sync_prints_the_reply_of_the_sync_route(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "sync")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        reply = json.loads(proc.stdout)
        self.assertEqual((reply["status"], reply["code"]), (200, "synced"))
        self.assertEqual(reply["details"], {"pages": 1})
        self.assertEqual(self.stub_get(manifest, "/__calls"), [["POST", "/actions/sync"]])

    def test_act_sync_exits_1_with_the_quirk_of_a_failed_sync_on_stdout(self):
        self.up(agent=1, mode="sync_failed")

        proc = self.kobo("act", "--agent", 1, "sync")

        self.assertEqual(proc.returncode, 1, proc.stderr)
        reply = json.loads(proc.stdout)
        self.assertEqual((reply["status"], reply["code"]), (502, "sync_failed"))
        self.assertIn("404", reply["message"])
        self.assertEqual(reply["details"]["quirk"], "StorePaths")

    def test_act_show_prints_the_device_library_and_last_sync(self):
        manifest = self.up(agent=1)
        self.kobo("act", "--agent", 1, "sync")

        proc = self.kobo("act", "--agent", 1, "show")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.stub_get(manifest, "/__calls"), [["POST", "/actions/sync"], ["GET", "/device"]])
        self.assertEqual(json.loads(proc.stdout), self.stub_get(manifest, "/device"))
        details = json.loads(proc.stdout)["details"]
        self.assertEqual(details["last_sync"]["result"], "synced")
        self.assertEqual(len(details["library"]), 1)

    def test_requests_prints_the_request_log(self):
        manifest = self.up(agent=1)
        self.kobo("act", "--agent", 1, "sync")

        proc = self.kobo("requests", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), self.stub_get(manifest, "/requests"))
        self.assertEqual(self.stub_get(manifest, "/__calls")[-1], ["GET", "/requests"])

    def test_act_exits_2_listing_the_actions_when_given_an_unknown_action_or_extra_argument(self):
        manifest = self.up(agent=1)
        for name, args in {
            "reset, which is withheld": ["act", "--agent", "1", "reset"],
            "an extra argument": ["act", "--agent", "1", "sync", "now"],
            "no action": ["act", "--agent", "1"],
            "requests with an argument": ["requests", "--agent", "1", "now"],
        }.items():
            with self.subTest(name):
                proc = self.kobo(*args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(proc.stdout, "")
                self.assertIn("sync show", proc.stderr)
        self.assertEqual(self.stub_get(manifest, "/__calls"), [])

    def test_act_download_posts_the_listed_books(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "download", "uuid-1", "uuid-2")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [["POST", "/actions/download", {"books": ["uuid-1", "uuid-2"]}]],
        )

    def test_act_read_posts_the_book_and_percent(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "read", "uuid-1", "42")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [["POST", "/actions/read", {"book": "uuid-1", "percent": 42}]],
        )

    def test_act_read_posts_a_kobospan_location_when_given(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "read", "uuid-1", "42", "c1.xhtml", "kobo.2.1")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [["POST", "/actions/read", {
                "book": "uuid-1",
                "percent": 42,
                "location": {"source": "c1.xhtml", "value": "kobo.2.1"},
            }]],
        )

    def test_act_finish_posts_the_book(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "finish", "uuid-1")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [["POST", "/actions/finish", {"book": "uuid-1"}]],
        )

    def test_act_remove_download_posts_the_book(self):
        manifest = self.up(agent=1)

        proc = self.kobo("act", "--agent", 1, "remove-download", "uuid-1")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [["POST", "/actions/remove-download", {"book": "uuid-1"}]],
        )

    def test_act_accepts_agent_and_accounts_flags_in_any_position(self):
        manifest = self.up(agent=1)

        after_action = self.kobo("act", "show", "--agent", 1)
        after_args = self.kobo("act", "read", "uuid-1", "42", "--agent", 1)

        self.assertEqual(after_action.returncode, 0, after_action.stderr)
        self.assertEqual(after_args.returncode, 0, after_args.stderr)
        self.assertEqual(
            self.stub_get(manifest, "/__calls"),
            [
                ["GET", "/device"],
                ["POST", "/actions/read", {"book": "uuid-1", "percent": 42}],
            ],
        )

    def test_act_exits_2_for_an_action_given_the_wrong_arguments(self):
        manifest = self.up(agent=1)
        for name, args in {
            "download with no books": ["download"],
            "read missing percent": ["read", "uuid-1"],
            "read with a non-digit percent": ["read", "uuid-1", "abc"],
            "read with a source but no span": ["read", "uuid-1", "42", "c1.xhtml"],
            "read with an extra argument": ["read", "uuid-1", "42", "c1.xhtml", "kobo.2.1", "extra"],
            "finish with no book": ["finish"],
            "finish with an extra argument": ["finish", "uuid-1", "extra"],
            "remove-download with no book": ["remove-download"],
        }.items():
            with self.subTest(name):
                proc = self.kobo("act", "--agent", "1", *args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(proc.stdout, "")
                self.assertIn("sync show", proc.stderr)
        self.assertEqual(self.stub_get(manifest, "/__calls"), [])

    def test_act_without_a_running_device_exits_1_naming_the_agent(self):
        proc = self.kobo("act", "--agent", 3, "sync")

        self.assertEqual(proc.returncode, 1)
        self.assertEqual(proc.stdout, "")
        self.assertIn("no Kobo running for agent-3 — kobo.sh up --agent 3 first", proc.stderr)

    def test_requests_without_a_running_device_exits_1_naming_the_agent(self):
        self.up(agent=1)
        self.kobo("down", "--agent", 1)

        proc = self.kobo("requests", "--agent", 1)

        self.assertEqual(proc.returncode, 1)
        self.assertEqual(proc.stdout, "")
        self.assertIn("no Kobo running for agent-1 — kobo.sh up --agent 1 first", proc.stderr)

    def test_act_exits_1_when_the_device_does_not_answer(self):
        self.up(agent=1)
        manifest_path = self.agent_dir() / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            manifest["port"] = probe.getsockname()[1]
        manifest_path.write_text(json.dumps(manifest))

        proc = self.kobo("act", "--agent", 1, "show")

        self.assertEqual(proc.returncode, 1)
        self.assertEqual(proc.stdout, "")
        self.assertIn("agent-1", proc.stderr)

    def test_act_waits_up_to_300_seconds_for_an_answer(self):
        self.up(agent=1)
        shims = self.dir / "shims"
        shims.mkdir()
        curl = shims / "curl"
        args = self.dir / "curl-args"
        curl.write_text(f'#!/bin/sh\nprintf \'%s\\n\' "$@" > {args}\nexit 28\n')
        curl.chmod(0o755)

        proc = self.kobo("act", "--agent", 1, "show", env={"PATH": f"{shims}:{os.environ['PATH']}"})

        self.assertEqual(proc.returncode, 1)
        recorded = args.read_text().split()
        self.assertEqual(recorded[recorded.index("--max-time") + 1], "300")
        self.assertIn("agent-1", proc.stderr)


class UsageTests(KoboLaneTestCase):
    def test_a_bad_command_line_exits_2_with_usage_before_touching_anything(self):
        for name, args in USAGE_CASES.items():
            with self.subTest(name):
                proc = self.kobo(*args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertIn("usage:", proc.stderr)
                self.assertEqual(proc.stdout, "")
        self.assertEqual(self.fake.requests, [])
        self.assertFalse(self.kobo_dir.exists())


class StateTests(KoboLaneTestCase):
    def test_state_prints_the_manifest_with_running_true_while_the_device_runs(self):
        manifest = self.up(agent=1)

        proc = self.kobo("state", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), {**manifest, "running": True})

    def test_state_reports_not_running_for_a_device_never_started(self):
        proc = self.kobo("state", "--agent", 2)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), {"actor": "agent-2", "running": False})

    def test_state_reports_not_running_for_a_pid_that_is_another_agents_device(self):
        other = self.up(agent=2)
        self.plant_manifest(1, other["pid"])

        proc = self.kobo("state", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), {"actor": "agent-1", "running": False})

    def test_state_reports_not_running_once_the_device_is_down(self):
        self.up(agent=1)
        self.kobo("down", "--agent", 1)

        proc = self.kobo("state", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), {"actor": "agent-1", "running": False})


class DownTests(KoboLaneTestCase):
    def test_down_for_an_agent_stops_only_that_device(self):
        first = self.up(agent=1)
        second = self.up(agent=2)

        proc = self.kobo("down", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(is_running(first["pid"]))
        self.assertTrue(is_running(second["pid"]))
        self.assertFalse((self.agent_dir(1) / "manifest.json").exists())
        self.assertTrue((self.agent_dir(2) / "manifest.json").exists())

    def test_down_keeps_the_devices_state_file_and_log(self):
        self.up(agent=1)

        self.kobo("down", "--agent", 1)

        self.assertTrue((self.agent_dir(1) / "state.json").exists())
        self.assertTrue((self.agent_dir(1) / "serve.log").exists())

    def test_down_without_an_agent_stops_every_device(self):
        pids = [self.up(agent=k)["pid"] for k in (1, 2)]

        proc = self.kobo("down")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual([is_running(pid) for pid in pids], [False, False])
        self.assertEqual(list(self.kobo_dir.glob("agent-*/manifest.json")), [])

    def test_down_with_no_devices_exits_0(self):
        self.assertEqual(self.kobo("down").returncode, 0)

    def test_down_waits_the_configured_ticks_before_killing_a_device_that_ignores_the_stop_request(self):
        manifest = self.up(agent=1, mode="stubborn")
        started = time.monotonic()

        proc = self.kobo("down", "--agent", 1, env={"OMNIBUS_EXPLORE_KOBO_STOP_TICKS": "5"})

        waited = time.monotonic() - started
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(is_running(manifest["pid"]))
        self.assertGreaterEqual(waited, 5 * 0.2)
        self.assertLess(waited, 5)

    def test_down_leaves_a_pid_that_belongs_to_another_program_alone(self):
        bystander = subprocess.Popen(["sleep", "60"])
        self.addCleanup(bystander.wait)
        self.addCleanup(bystander.kill)
        self.agent_dir().mkdir(parents=True)
        (self.agent_dir() / "manifest.json").write_text(json.dumps({"pid": bystander.pid, "bin": str(STUB)}))

        proc = self.kobo("down", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIsNone(bystander.poll())
        self.assertFalse((self.agent_dir() / "manifest.json").exists())

    def test_down_leaves_another_agents_device_alone(self):
        other = self.up(agent=2)
        self.plant_manifest(1, other["pid"])

        proc = self.kobo("down", "--agent", 1)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(is_running(other["pid"]))
        self.assertFalse((self.agent_dir(1) / "manifest.json").exists())

    def test_up_after_down_reuses_the_device_without_creating_another(self):
        first = self.up(agent=1)
        self.kobo("down", "--agent", 1)

        second = self.up(agent=1)

        self.assertEqual(second["wired"], "reused")
        self.assertEqual(second["hardware_id"], first["hardware_id"])
        self.assertEqual(len(self.fake.calls("/api/rpc/kobo/devices/create")), 1)


class ScriptShapeTests(unittest.TestCase):
    """The runner may be on macOS, whose bash is 3.2 and whose userland is BSD."""

    FORBIDDEN = {
        "an associative array": r"\b(declare|local|typeset)\s+-[a-zA-Z]*A\b",
        "case conversion in an expansion": r"\$\{[^}]*(,,|\^\^)",
        "mapfile": r"\b(mapfile|readarray)\b",
        "wait -n": r"\bwait\s+-n\b",
        "timeout": r"(^|[\s|;(])timeout\s",
        "setsid": r"\bsetsid\b",
    }

    def test_kobo_sh_parses(self):
        proc = subprocess.run(["bash", "-n", str(KOBO_SH)], capture_output=True, text=True)

        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_kobo_sh_avoids_bash_4_features_and_gnu_only_tools(self):
        code = "\n".join(line for line in KOBO_SH.read_text().splitlines() if not line.lstrip().startswith("#"))
        for name, pattern in self.FORBIDDEN.items():
            with self.subTest(name):
                self.assertIsNone(re.search(pattern, code, re.M))


if __name__ == "__main__":
    unittest.main()
