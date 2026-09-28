"""Fixtures shared by the audit's test modules: journal entries and fakes."""

from __future__ import annotations

from typing import Any

from .. import expectations, journal


def entry(action: str, **kw: Any) -> journal.Entry:
    obj = {
        "ts": "2026-08-28T15:00:00.000Z",
        "run": "r-20260828-02",
        "actor": kw.pop("actor", "agent-1"),
        "surface": "web",
        "flow": "test",
        "seq": kw.pop("seq", 1),
        "action": action,
        "target": kw.pop("target", None),
        "params": kw.pop("params", {}),
        "outcome": kw.pop("outcome", "ok"),
        "note": None,
    }
    obj.update(kw)
    return journal.Entry.from_obj(obj)


class FakeState:
    """Enough of `ActorState` for the comparison rules."""

    def __init__(self, client: Any = None, **facts: Any) -> None:
        self.facts = facts
        self.client = client

    def rating(self, uuid: str) -> Any:
        return self.facts.get("ratings", {}).get(uuid)

    def read_status(self, uuid: str) -> Any:
        return self.facts.get("statuses", {}).get(uuid)

    def progress(self, uuid: str, axis: str = "ebook") -> Any:
        return self.facts.get("progress", {}).get((uuid, axis))

    def playback_rate(self, uuid: str) -> Any:
        return self.facts.get("rates", {}).get(uuid)

    def journals(self, uuid: str) -> list[dict[str, Any]]:
        return self.facts.get("journals", {}).get(uuid, [])

    def highlights(self, uuid: str) -> list[dict[str, Any]]:
        return self.facts.get("highlights", {}).get(uuid, [])

    def bookmarks(self, uuid: str) -> list[dict[str, Any]]:
        return self.facts.get("bookmarks", {}).get(uuid, [])

    def shelves(self) -> list[dict[str, Any]]:
        return self.facts.get("shelves", [])

    def shelf_members(self, shelf_id: int) -> list[str]:
        return self.facts.get("members", {}).get(shelf_id, [])

    def wishlist(self) -> list[str]:
        return self.facts.get("wishlist", [])

    def library(self) -> list[str]:
        return self.facts.get("library", [])


def claims_of(*slots: tuple, shelf_names: Any = (), shelf_any: bool = False) -> expectations.Claims:
    c = expectations.Claims()
    c.slots.update(slots)
    c.shelf_names.update(shelf_names)
    c.shelf_any = shelf_any
    return c


class FakeClient:
    """Records what replay sends and answers from a canned table."""

    def __init__(self, responses: dict | None = None) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.responses = responses or {}

    def _answer(self, method: str, path: str, payload: Any) -> tuple[int, str]:
        self.calls.append((method, path, payload))
        return self.responses.get(path, (200, "{}"))

    def post(self, path: str, payload: Any) -> tuple[int, str]:
        return self._answer("POST", path, payload)

    def put(self, path: str, payload: Any) -> tuple[int, str]:
        return self._answer("PUT", path, payload)

    def patch(self, path: str, payload: Any) -> tuple[int, str]:
        return self._answer("PATCH", path, payload)


BOOK = "18c784fc-e768-47c5-9d6c-ceb3e0cbb3db"
OTHER = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"
