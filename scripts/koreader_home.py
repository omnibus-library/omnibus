#!/usr/bin/env python3
"""Link a fresh KOReader home to the dev server (`just koreader`).

    python3 scripts/koreader_home.py --home DIR --api URL --origin URL --state-dir DIR
    python3 scripts/koreader_home.py --home DIR --plugin ZIP

Signs in as $OMNIBUS_DEV_SEED_USER, finds or creates the "Dev KOReader" device,
installs the Omnibus plugin its Settings download hands a reader, and seeds
KOReader's OPDS catalog and stock Progress sync. Exits 0 when the home was
linked, 1 with one `koreader:` line on stderr otherwise.

`--plugin` installs a plugin zip downloaded from any instance as it is, and
prints the server it will sync with; nothing is sent to that server.

`--api` is the host-side URL the seed password is sent to; `--origin` is the
dev server as the container reaches it, and is only written into the home.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import http.client
import ipaddress
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

SESSION_DEVICE_NAME = "omnibus-koreader-dev"
DEVICE_NAME = "Dev KOReader"  # one name for every launch, so fresh homes never pile up server devices
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


def parse_seed_user(value: str | None) -> tuple[str, str]:
    """Split `user:password` at the first colon, as the server's own seeding does."""
    user, sep, password = (value or "").partition(":")
    if not sep or not user:
        raise LinkError("OMNIBUS_DEV_SEED_USER must be set to user:password (see .env.example)")
    return user, password


def _is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _is_unreachable_from_container(host: str) -> bool:
    """Loopback is the container's own, and the unspecified address (`0.0.0.0`, `::`) reaches it too."""
    try:
        return _is_loopback_host(host) or ipaddress.ip_address(host).is_unspecified
    except ValueError:
        return False


class Api:
    """The few bearer-authed routes a link needs, each failure naming its route and status."""

    def __init__(self, base: str):
        host = urllib.parse.urlsplit(base).hostname or ""
        if not _is_loopback_host(host):
            raise LinkError(f"--api must be a loopback address, not {base}: it is sent the seed password")
        self.base = base.rstrip("/")
        self.token: str | None = None
        # An empty proxy map: a proxy configured in the environment must never see the seed password.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

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
            with self.opener.open(request, timeout=30) as response:
                data = response.read()
            return data if raw or not data else json.loads(data)
        except urllib.error.HTTPError as e:
            e.close()
            raise LinkError(f"{method} {route} answered {e.code}") from e
        except urllib.error.URLError as e:
            raise LinkError(f"can't reach {self.base}: {e.reason}") from e
        except ValueError as e:
            raise LinkError(f"{method} {route} answered something that isn't JSON") from e
        except (OSError, http.client.HTTPException) as e:
            raise LinkError(f"{method} {route} failed: {e}") from e

    def login(self, user: str, password: str) -> None:
        body = {"username": user, "password": password, "client_kind": "bearer", "device_name": SESSION_DEVICE_NAME}
        try:
            self.token = self.call("POST", "/api/auth/login", body)["token"]
        except LinkError as e:
            if "answered 401" in str(e):
                raise LinkError("the dev server rejected the login in OMNIBUS_DEV_SEED_USER") from e
            raise

    def kosync_accepts(self, key: dict) -> bool:
        """Whether the server's stock Progress sync still takes `key` (a reader may have replaced the password)."""
        headers = {"Accept": "application/vnd.koreader.v1+json", "x-auth-user": key["username"], "x-auth-key": key["userkey"]}
        request = urllib.request.Request(self.base + "/kosync/users/auth", headers=headers)
        try:
            with self.opener.open(request, timeout=30):
                return True
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 401:
                return False
            raise LinkError(f"GET /kosync/users/auth answered {e.code}") from e
        except urllib.error.URLError as e:
            raise LinkError(f"can't reach {self.base}: {e.reason}") from e
        except (OSError, http.client.HTTPException) as e:
            raise LinkError(f"GET /kosync/users/auth failed: {e}") from e

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


def kosync_key(api: Api, state_dir: Path, account: str) -> dict:
    """The progress-sync login every home shares: the password is the account's, not the device's.
    Cached per server and account, and reused only while the server still accepts it."""
    saved = state_dir / "kosync.json"
    configured = api.call("GET", "/api/account/kosync")["configured"]
    key = _read_saved_key(saved, api.base, account)
    if configured and key:
        if api.kosync_accepts(key):
            return key
        print("koreader: replacing the account's progress-sync password: the server rejected the saved key", file=sys.stderr)
    elif configured:
        print("koreader: replacing the account's progress-sync password: no saved key for it was found", file=sys.stderr)
    credentials = api.call("POST", "/api/account/kosync")
    key = {
        "server": api.base,
        "account": account,
        "username": credentials["username"],
        "userkey": hashlib.md5(credentials["password"].encode()).hexdigest(),
    }
    fd, temp = tempfile.mkstemp(dir=state_dir, prefix=".kosync-")  # mkstemp creates it 0600
    with os.fdopen(fd, "w") as f:
        json.dump(key, f)
    os.replace(temp, saved)
    return key


def _read_saved_key(saved: Path, server: str, account: str) -> dict | None:
    """The saved key when it was cached for this server and account, else `None`."""
    try:
        key = json.loads(saved.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(key, dict) or not {"username", "userkey"} <= key.keys():
        return None
    return key if (key.get("server"), key.get("account")) == (server, account) else None


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
        shutil.rmtree(plugins / PLUGIN_DIR, ignore_errors=True)  # a half-made folder from an earlier attempt
        (staging / PLUGIN_DIR).rename(plugins / PLUGIN_DIR)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def plugin_server_url(archive: bytes) -> str:
    """The `server_url` in the zip's omnibus.json; ValueError with the reason when it is not a plugin zip."""
    try:
        with zipfile.ZipFile(BytesIO(archive)) as z:
            config = json.loads(z.read(f"{PLUGIN_DIR}/omnibus.json"))
    except zipfile.BadZipFile:
        raise ValueError("not a zip file") from None
    except KeyError:
        raise ValueError(f"no {PLUGIN_DIR}/omnibus.json") from None
    except ValueError:
        config = None  # not UTF-8 or not JSON
    server = config.get("server_url") if isinstance(config, dict) else None
    if not isinstance(server, str) or urllib.parse.urlsplit(server).scheme not in ("http", "https"):
        raise ValueError("omnibus.json has no http(s) server_url")
    return server


def install_plugin_zip(home: Path, path: Path) -> str:
    """Install the plugin zip at `path` as downloaded; returns the server it syncs with."""
    try:
        archive = path.read_bytes()
    except FileNotFoundError:
        raise LinkError(f"no such file: {path}") from None
    try:
        server = plugin_server_url(archive)
    except ValueError as e:
        raise LinkError(f"{path} is not an Omnibus plugin zip: {e}") from None
    if _is_unreachable_from_container(urllib.parse.urlsplit(server).hostname or ""):
        raise LinkError(f"{path} syncs with {server}, which the container can't reach: use --local for this worktree's dev server")
    install_plugin(home, archive, server)
    return server


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


def link_home(home: Path, api: str, origin: str, state_dir: Path, seed: tuple[str, str]) -> None:
    """Link `home` to the dev server."""
    state_dir.mkdir(parents=True, exist_ok=True)
    with open(state_dir / ".link.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # two launches must not both generate the account's kosync password
        session = Api(api)
        home.chmod(0o700)  # opds.lua and omnibus.json hold the seed password and the device token
        session.login(*seed)
        try:
            device = find_or_create_device(session, DEVICE_NAME)
            archive = session.call("GET", f"/api/account/kobo-devices/{device}/koreader-plugin", raw=True)
            key = kosync_key(session, state_dir, seed[0])
            write_settings(home, origin, seed, key)
            install_plugin(home, archive, origin)
        finally:
            session.logout()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Set up a fresh KOReader home for `just koreader`.")
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, help="a plugin zip from any instance, installed as it is")
    parser.add_argument("--api", help="link to the dev server: its host-side URL")
    parser.add_argument("--origin", help="link to the dev server: its URL as the container reaches it")
    parser.add_argument("--state-dir", type=Path, help="link to the dev server: where the kosync key is cached")
    args = parser.parse_args(argv)
    link_args = (args.api, args.origin, args.state_dir)
    if args.plugin is not None and any(a is not None for a in link_args):
        parser.error("--plugin can't be combined with --api, --origin or --state-dir")
    if args.plugin is None and None in link_args:
        parser.error("--api, --origin and --state-dir are required without --plugin")
    try:
        if args.plugin is not None:
            print(f"koreader: KOReader will sync with {install_plugin_zip(args.home, args.plugin)}")
            return 0
        seed = parse_seed_user(os.environ.get("OMNIBUS_DEV_SEED_USER"))
        link_home(args.home, args.api, args.origin, args.state_dir, seed)
        print(f"koreader: linked {args.home} as {DEVICE_NAME!r}")
    except LinkError as e:
        print(f"koreader: {e}", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:
        print(f"koreader: linking failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
