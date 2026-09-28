"""Re-issuing folded expectations against the instance."""

from __future__ import annotations

import unittest

from .. import expectations, replay
from .support import BOOK, FakeClient, FakeState


class ReplayTests(unittest.TestCase):
    def test_wishlist_is_refused_with_its_reason(self) -> None:
        exp = expectations.Expectation("agent-3", 4, "wishlist", "wishlist entry", None, "x", "a-uuid")
        step = replay.replay_one(exp, FakeState())
        self.assertEqual(step.action, "refused")
        self.assertIn("ISBN-lookup", step.detail)

    def test_a_percent_only_epub_position_replays_as_a_valid_update(self) -> None:
        # ProgressUpdate::validate accepts a cfi OR a percent for epub — a Kobo
        # has no CFI to give — so percent-only is a first-class position and
        # must replay rather than be refused.
        payload = replay._progress_payload(BOOK, {"axis": "ebook", "percent": 11.0, "cfi": None})
        self.assertEqual(payload, {"book_uuid": BOOK, "format": "epub", "progress_percent": 11})

    def test_an_epub_position_with_neither_cfi_nor_percent_is_refused(self) -> None:
        exp = expectations.Expectation(
            "agent-1", 15, "progress", "progress", BOOK, "x", {"axis": "ebook", "percent": None, "cfi": None}
        )
        step = replay.replay_one(exp, FakeState())
        self.assertEqual(step.action, "refused")

    def test_an_audio_position_builds_a_valid_progress_payload(self) -> None:
        payload = replay._progress_payload(BOOK, {"axis": "audio", "seconds": 42.5})
        self.assertEqual(payload, {"book_uuid": BOOK, "format": "audio", "audio_position_seconds": 42.5})

    def test_replay_sets_playback_rate_with_the_rpc_shape(self) -> None:
        # PY-1: the server function takes (uuid, update) and the update's
        # field is `playback_rate` — the old flat body could never succeed.
        client = FakeClient()
        exp = expectations.Expectation("agent-2", 51, "playback_rate", "playback rate", BOOK, "x", 1.5)
        step = replay.replay_one(exp, FakeState(client=client))
        self.assertTrue(step.ok)
        self.assertEqual(
            client.calls,
            [("POST", "/api/rpc/audiobooks/playback-rate/set", {"uuid": BOOK, "update": {"playback_rate": 1.5}})],
        )

    def test_replay_lands_the_note_through_its_own_patch(self) -> None:
        # PY-2: CreateHighlight has no note field and unknown fields are
        # silently dropped — an inline note would 200 and vanish.
        client = FakeClient(responses={"/api/highlights": (200, '{"id": 7}')})
        exp = expectations.Expectation(
            "agent-1", 9, "highlight", "highlight", BOOK, "x",
            {"note": "check this", "quote": "the passage", "colour": "green", "cfi": "epubcfi(/6/4!/4/2)"},
        )
        step = replay.replay_one(exp, FakeState(client=client))
        self.assertTrue(step.ok)
        methods_paths = [(m, path) for m, path, _ in client.calls]
        self.assertEqual(
            methods_paths,
            [("POST", "/api/highlights"), ("PATCH", "/api/highlights/7/note")],
        )
        create_payload = client.calls[0][2]
        self.assertNotIn("note", create_payload)
        self.assertEqual(client.calls[1][2], {"note": "check this"})

    def test_replay_refusal_names_the_missing_machine_location(self) -> None:
        # PY-3: without a cfi the refusal must say what capability is absent,
        # not imply the journal was deficient in some unstated way.
        exp = expectations.Expectation(
            "agent-1", 9, "highlight", "highlight", BOOK, "x", {"note": "n", "quote": "q", "colour": None, "cfi": None}
        )
        step = replay.replay_one(exp, FakeState(client=FakeClient()))
        self.assertEqual(step.action, "refused")
        self.assertIn("epubcfi", step.detail)

    def test_bookmark_replay_uses_the_journalled_position_and_title(self) -> None:
        client = FakeClient()
        exp = expectations.Expectation(
            "agent-1", 4, "bookmark", "bookmark", BOOK, "x", {"label": "chapter one", "position": "epubcfi(/6/2)"}
        )
        step = replay.replay_one(exp, FakeState(client=client))
        self.assertTrue(step.ok)
        self.assertEqual(
            client.calls,
            [("POST", "/api/bookmarks", {"book_uuid": BOOK, "position": "epubcfi(/6/2)", "title": "chapter one"})],
        )
