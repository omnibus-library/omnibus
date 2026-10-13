"""Test doubles for the Kobo lane: a local server that speaks Omnibus's contract.

`FakeOmnibus` answers the routes `kobo_wire.py` uses (login, me, logout and the
Kobo device RPCs) over real HTTP, so the scripts under test keep their real
HTTP stack. Like `auth::origin_check`, it refuses a POST whose `Origin` is not
the instance's own.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

COOKIE = "omnibus_session"


class FakeOmnibus:
    """A local Omnibus with accounts, sessions and Kobo devices.

    `requests` records every request in order, as dicts with `method`, `path`,
    `body` (parsed JSON or None), `origin` and `user` (the session's account).
    """

    def __init__(self, accounts: dict[str, str], devices: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.accounts = accounts
        self.devices = {user: [dict(row) for row in rows] for user, rows in (devices or {}).items()}
        self.requests: list[dict[str, Any]] = []
        self._failures: dict[str, int] = {}
        self._sessions: dict[str, str] = {}
        self._counter = 100
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._server.fake = self  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self._server.server_port}"

    def __enter__(self) -> "FakeOmnibus":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join()

    def add_device(self, user: str, name: str) -> dict[str, Any]:
        """Register a device for `user` as if it were made in the Account page."""
        device = {"id": self._next(), "name": name, "token": f"tok-{self._next()}", "created_at": 0, "last_seen_at": 0}
        self.devices.setdefault(user, []).append(device)
        return device

    def fail(self, path: str, status: int) -> None:
        """Answer `path` with `status` instead of its normal reply."""
        self._failures[path] = status

    def recover(self, path: str) -> None:
        """Undo `fail` for `path`."""
        self._failures.pop(path, None)

    def calls(self, path: str) -> list[dict[str, Any]]:
        return [r for r in self.requests if r["path"] == path]

    def logins(self) -> list[str]:
        """The usernames that logged in successfully, in order."""
        return [r["body"]["username"] for r in self.calls("/api/auth/login") if r.get("accepted")]

    def _next(self) -> int:
        self._counter += 1
        return self._counter

    def handle(self, method: str, path: str, headers: Any, raw: bytes) -> tuple[int, list[tuple[str, str]], str]:
        body = json.loads(raw) if raw.strip() else None
        session = _cookie(headers.get("Cookie", ""), COOKIE)
        record = {"method": method, "path": path, "body": body, "origin": headers.get("Origin"), "user": self._sessions.get(session or "")}
        self.requests.append(record)
        if method == "POST" and record["origin"] != self.origin:
            return 403, [], "forbidden origin"
        if path in self._failures:
            return self._failures[path], [], json.dumps({"error": "injected failure"})
        return self._route(method, path, body, record)

    def _route(self, method: str, path: str, body: Any, record: dict[str, Any]) -> tuple[int, list[tuple[str, str]], str]:
        user = record["user"]
        if (method, path) == ("POST", "/api/auth/login"):
            return self._login(body, record)
        if (method, path) == ("POST", "/api/auth/logout"):
            self._sessions = {sid: u for sid, u in self._sessions.items() if u != user}
            return 204, [("Set-Cookie", f"{COOKIE}=; Max-Age=0; Path=/")], ""
        if user is None:
            return 401, [], json.dumps({"error": "not signed in"})
        if (method, path) == ("GET", "/api/auth/me"):
            return 200, [], json.dumps({"id": list(self.accounts).index(user) + 1, "username": user})
        if (method, path) == ("POST", "/api/rpc/kobo/devices"):
            return 200, [], json.dumps(self.devices.get(user, []))
        if (method, path) == ("POST", "/api/rpc/kobo/devices/create"):
            return 200, [], json.dumps(self.add_device(user, body["name"]))
        if (method, path) == ("POST", "/api/rpc/kobo/devices/revoke"):
            rows = self.devices.get(user, [])
            self.devices[user] = [row for row in rows if row["id"] != body["id"]]
            return 200, [], "null"
        return 404, [], json.dumps({"error": f"no route for {method} {path}"})

    def _login(self, body: Any, record: dict[str, Any]) -> tuple[int, list[tuple[str, str]], str]:
        if self.accounts.get(body["username"]) != body["password"]:
            return 401, [], json.dumps({"error": "invalid credentials"})
        record["accepted"] = True
        sid = f"sid-{self._next()}"
        self._sessions[sid] = body["username"]
        return 200, [("Set-Cookie", f"{COOKIE}={sid}; Path=/")], json.dumps({"username": body["username"]})


def _cookie(header: str, name: str) -> str | None:
    for part in header.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return None


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def _serve(self, method: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        status, headers, text = self.server.fake.handle(method, self.path, self.headers, self.rfile.read(length))  # type: ignore[attr-defined]
        data = text.encode("utf-8")
        self.send_response(status)
        for key, value in headers:
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._serve("GET")

    def do_POST(self) -> None:
        self._serve("POST")
