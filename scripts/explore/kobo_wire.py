#!/usr/bin/env python3
"""Wire an exploration account's "Mock Kobo" device and print its token.

    kobo_wire.py --accounts provision.json --agent 2 --state agent-2/state.json

Logs in as `explorer-<k>`, then reuses, creates or recreates the device named
"Mock Kobo" and prints one JSON line:

    {"wired": "reused|created|recreated", "url": …, "username": …,
     "device_name": "Mock Kobo", "token": …}

`mock-kobo serve` cannot do this itself: its auto-wire refuses a remote
instance. A device is reused only when exactly one "Mock Kobo" exists and the
state file records this instance and that device's token; otherwise a fresh
device on an old server record would sync only changes (#2743), so the old
ones are revoked first.

Exit 1 means the instance refused or failed; exit 2 is a usage or accounts
problem. The token is printed on stdout and nowhere else.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_lib import env  # noqa: E402
from audit_lib.client import Account, ApiError, Client, load_accounts  # noqa: E402

DEVICE_NAME = "Mock Kobo"
DEFAULT_PORTS = {"http": 80, "https": 443}


def plan(have_state: bool, matching: int) -> str:
    """What to do about the account's "Mock Kobo" devices: reuse, create or recreate."""
    if matching == 0:
        return "create"
    if matching == 1 and have_state:
        return "reuse"
    return "recreate"


def normalise_origin(url: str) -> str:
    """`url` with scheme and host lowercased, the default port and trailing `/` dropped."""
    parts = urlsplit(url.strip())
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    port = parts.port
    suffix = "" if port is None or port == DEFAULT_PORTS.get(parts.scheme) else f":{port}"
    return f"{parts.scheme}://{host}{suffix}{parts.path.rstrip('/')}"


def state_matches(saved: Any, url: str, token: str) -> bool:
    """Whether the device state file `saved` records the instance at `url` and the device `token`."""
    if not isinstance(saved, dict) or not isinstance(saved.get("url"), str):
        return False
    if saved.get("token") != token:
        return False
    try:
        return normalise_origin(saved["url"]) == normalise_origin(url)
    except ValueError:
        return False


def read_state(path: Path) -> Any:
    """The state file's JSON, or `None` when it is missing or unreadable."""
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


class UsageError(Exception):
    """The command line, accounts file or environment can't be used."""


def pick_account(path: Path, agent: int) -> Account:
    """`agent-<agent>`'s account from `provision.sh`'s file, which must be `explorer-<agent>`."""
    try:
        accounts = load_accounts(json.loads(path.read_text()))
    except (OSError, ValueError, ApiError) as exc:
        raise UsageError(f"cannot read accounts from {path}: {exc}") from exc
    account = accounts.get(f"agent-{agent}")
    if account is None:
        raise UsageError(f"{path} has no agent-{agent}")
    if account.username != f"explorer-{agent}":
        raise UsageError(f"agent-{agent} is {account.username}, not explorer-{agent}")
    return account


def instance_url() -> str:
    """The normalised `OMNIBUS_EXPLORE_URL`, which must be a bare origin; an exported value beats `.env`."""
    env.load()
    url = os.environ.get("OMNIBUS_EXPLORE_URL", "")
    if not url:
        raise UsageError("set OMNIBUS_EXPLORE_URL in .env — see .env.example")
    parts = urlsplit(url.strip())
    if parts.path.strip("/") or parts.query or parts.fragment or parts.username or parts.password:
        raise UsageError("OMNIBUS_EXPLORE_URL must be an origin (scheme://host[:port]): no path, query, fragment or credentials")
    return normalise_origin(url)


def wire(client: Client, url: str, state: Path) -> tuple[str, str]:
    """Reuse, create or recreate the account's "Mock Kobo"; returns how, and its token."""
    devices = client.rpc("/api/rpc/kobo/devices", {})
    ours = [d for d in devices if d["name"] == DEVICE_NAME]
    saved = read_state(state)
    have_state = any(state_matches(saved, url, device["token"]) for device in ours)
    action = plan(have_state, len(ours))
    if action == "reuse":
        return "reused", ours[0]["token"]
    for device in ours:
        client.rpc("/api/rpc/kobo/devices/revoke", {"id": device["id"]})
    created = client.rpc("/api/rpc/kobo/devices/create", {"name": DEVICE_NAME})
    return {"create": "created", "recreate": "recreated"}[action], created["token"]


def log_out(client: Client) -> None:
    """End the session; a failure leaves it to expire."""
    try:
        client.post("/api/auth/logout", {})
    except ApiError:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wire an exploration account's Mock Kobo device.")
    parser.add_argument("--accounts", required=True, type=Path, help="provision.sh's JSON output")
    parser.add_argument("--agent", required=True, type=int, help="the agent number k (account explorer-<k>)")
    parser.add_argument("--state", required=True, type=Path, help="the device's mock-kobo state file")
    args = parser.parse_args(argv)

    try:
        account = pick_account(args.accounts, args.agent)
        url = instance_url()
    except UsageError as exc:
        print(f"kobo_wire: {exc}", file=sys.stderr)
        return 2

    client = Client(url)
    try:
        client.login(account.username, account.password)
        try:
            wired, token = wire(client, url, args.state)
        finally:
            log_out(client)
    except ApiError as exc:
        print(f"kobo_wire: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "wired": wired,
        "url": url,
        "username": account.username,
        "device_name": DEVICE_NAME,
        "token": token,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
