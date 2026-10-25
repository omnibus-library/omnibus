#!/usr/bin/env python3
"""Link a KOReader home to the dev server on its first launch (`just koreader`).

    python3 scripts/koreader_home.py --home DIR --api URL --origin URL --state-dir DIR

Signs in as $OMNIBUS_DEV_SEED_USER, finds or creates this home's KOReader device,
installs the Omnibus plugin its Settings download hands a reader, and seeds
KOReader's OPDS catalog and stock Progress sync. Exits 0 when the home was
linked or already is, 1 with one `koreader:` line on stderr otherwise.

`--api` is the host-side URL the seed password is sent to; `--origin` is the
dev server as the container reaches it, and is only written into the home.
A home keeps the origin and token it was linked with: delete it to relink.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

SESSION_DEVICE_NAME = "omnibus-koreader-dev"
DEFAULT_DEVICE_NAME = "Dev KOReader"
PLUGIN_DIR = "omnibus.koplugin"


class LinkError(Exception):
    """A failed link; the message is the stderr line, without the `koreader: ` prefix."""


def lua_literal(value) -> str:
    """The Lua source for a str, int, bool, list or dict (a bool is checked before an int)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
        return f'"{escaped}"'
    if isinstance(value, list):
        return "{ " + ", ".join(lua_literal(v) for v in value) + " }"
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k} = {lua_literal(v)}" for k, v in value.items()) + " }"
    raise TypeError(f"no Lua literal for {type(value).__name__}")


def device_name(home: Path, state_dir: Path) -> str:
    """`Dev KOReader` for the default home, else the name carries the home's folder."""
    if home.resolve() == (state_dir / "home").resolve():
        return DEFAULT_DEVICE_NAME
    return f"{DEFAULT_DEVICE_NAME} ({home.name})"


def parse_seed_user(value: str | None) -> tuple[str, str]:
    """Split `user:password` at the first colon, as the server's own seeding does."""
    user, sep, password = (value or "").partition(":")
    if not sep or not user:
        raise LinkError("OMNIBUS_DEV_SEED_USER must be set to user:password (see .env.example)")
    return user, password


class Api:
    """The few bearer-authed routes a link needs, each failure naming its route and status."""

    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, route: str, body=None, *, raw: bool = False):
        request = urllib.request.Request(
            self.base + route,
            data=None if body is None else json.dumps(body).encode(),
            method=method,
            headers={"Content-Type": "application/json"},
        )
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
        except urllib.error.HTTPError as e:
            e.close()
            raise LinkError(f"{method} {route} answered {e.code}") from e
        except urllib.error.URLError as e:
            raise LinkError(f"can't reach {self.base}: {e.reason}") from e
        return data if raw or not data else json.loads(data)

    def login(self, user: str, password: str) -> None:
        body = {"username": user, "password": password, "client_kind": "bearer", "device_name": SESSION_DEVICE_NAME}
        try:
            self.token = self.call("POST", "/api/auth/login", body)["token"]
        except LinkError as e:
            if "answered 401" in str(e):
                raise LinkError("the dev server rejected the login in OMNIBUS_DEV_SEED_USER") from e
            raise

    def logout(self) -> None:
        try:
            self.call("POST", "/api/auth/logout")
        except LinkError:
            pass  # the session is only ours to tidy; the link's own outcome stands
        self.token = None


def find_or_create_device(api: Api, name: str) -> int:
    for device in api.call("GET", "/api/account/kobo-devices"):
        if device["name"] == name and device["kind"] == "koreader":
            return device["id"]
    return api.call("POST", "/api/account/kobo-devices", {"name": name, "kind": "koreader"})["id"]


def kosync_key(api: Api, state_dir: Path) -> dict:
    """The progress-sync login every home shares: the password is the account's, not the device's."""
    saved = state_dir / "kosync.json"
    if api.call("GET", "/api/account/kosync")["configured"] and saved.is_file():
        return json.loads(saved.read_text())
    credentials = api.call("POST", "/api/account/kosync")
    key = {"username": credentials["username"], "userkey": hashlib.md5(credentials["password"].encode()).hexdigest()}
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.touch(mode=0o600)
    saved.chmod(0o600)  # touch only sets the mode of a file it creates
    saved.write_text(json.dumps(key))
    return key


def install_plugin(home: Path, archive: bytes, origin: str) -> None:
    """Unzip beside the target and rename into place, so the folder's omnibus.json marks a finished link."""
    plugins = home / "plugins"
    plugins.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".link-", dir=plugins))  # no .koplugin suffix, so KOReader skips it
    try:
        with zipfile.ZipFile(BytesIO(archive)) as z:
            z.extractall(staging)
        config_path = staging / PLUGIN_DIR / "omnibus.json"
        config = json.loads(config_path.read_text())
        config["server_url"] = origin
        config_path.write_text(json.dumps(config))
        (staging / PLUGIN_DIR).rename(plugins / PLUGIN_DIR)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def write_settings(home: Path, origin: str, seed: tuple[str, str], key: dict) -> None:
    opds = {"servers": [{"title": "Omnibus (dev)", "url": f"{origin}/opds", "username": seed[0], "password": seed[1]}]}
    kosync = {
        "settings": {
            "custom_server": f"{origin}/kosync",
            "username": key["username"],
            "userkey": key["userkey"],
            "auto_sync": True,
            "sync_forward": 1,
            "sync_backward": 3,
            "checksum_method": 0,
            "send_metadata": False,
        }
    }
    settings = home / "settings"
    settings.mkdir(parents=True, exist_ok=True)
    (settings / "opds.lua").write_text(f"return {lua_literal(opds)}\n")
    (settings / "kosync.lua").write_text(f"return {lua_literal(kosync)}\n")


def link_home(home: Path, api: str, origin: str, state_dir: Path, seed: tuple[str, str]) -> bool:
    """Link `home` to the dev server; `True` when it was linked now, `False` when it already was."""
    if (home / "plugins" / PLUGIN_DIR / "omnibus.json").is_file():
        return False
    session = Api(api)
    session.login(*seed)
    try:
        device = find_or_create_device(session, device_name(home, state_dir))
        archive = session.call("GET", f"/api/account/kobo-devices/{device}/koreader-plugin", raw=True)
        key = kosync_key(session, state_dir)
        write_settings(home, origin, seed, key)
        install_plugin(home, archive, origin)
    finally:
        session.logout()
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Link a KOReader home to the dev server.")
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--api", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        seed = parse_seed_user(os.environ.get("OMNIBUS_DEV_SEED_USER"))
        if link_home(args.home, args.api, args.origin, args.state_dir, seed):
            print(f"koreader: linked {args.home} as {device_name(args.home, args.state_dir)!r}")
    except LinkError as e:
        print(f"koreader: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
