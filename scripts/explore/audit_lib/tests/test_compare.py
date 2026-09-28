"""Checking expectations against state, the `unexpected` sweep, and containment."""

from __future__ import annotations

import unittest
from typing import Any

from .. import compare, expectations
from ..client import ApiError
from .support import BOOK, FakeState, claims_of, entry


class CompareTests(unittest.TestCase):
    def _expect(self, family: str, value: Any, target: str | None = BOOK) -> expectations.Expectation:
        return expectations.Expectation("agent-1", 7, family, family, target, "expected", value)

    def test_a_matching_rating_produces_no_finding(self) -> None:
        state = FakeState(ratings={BOOK: 4.5})
        self.assertIsNone(compare.check(self._expect("rating", 4.5), state))

    def test_a_deleted_rating_is_reported_missing(self) -> None:
        found = compare.check(self._expect("rating", 4.5), FakeState(ratings={}))
        self.assertIsNotNone(found)
        self.assertEqual(found.kind, compare.MISSING)
        self.assertEqual(found.replay_from, 7)

    def test_a_changed_rating_is_reported_as_a_mismatch(self) -> None:
        found = compare.check(self._expect("rating", 4.5), FakeState(ratings={BOOK: 2.0}))
        self.assertEqual(found.kind, compare.MISMATCH)
        self.assertIn("2 of 5", found.observed)

    def test_an_absent_read_status_row_reads_as_unread(self) -> None:
        # `shared::ReadStatus::Unread` documents the missing row as unread, so
        # an agent that journalled a return to unread lost nothing.
        self.assertIsNone(compare.check(self._expect("read_status", "unread"), FakeState(statuses={})))

    def test_a_missing_read_status_row_is_a_finding_when_reading_was_claimed(self) -> None:
        found = compare.check(self._expect("read_status", "reading"), FakeState(statuses={}))
        self.assertEqual(found.kind, compare.MISSING)

    def test_progress_is_checked_on_the_axis_the_entry_named(self) -> None:
        audio = {"audio_position_seconds": 4174.0, "epub_cfi": None}
        state = FakeState(progress={(BOOK, "audio"): audio})
        self.assertIsNone(compare.check(self._expect("progress", {"axis": "audio"}), state))
        # The same book with only an ebook row must not satisfy an audio claim.
        ebook_only = FakeState(progress={(BOOK, "ebook"): {"epub_cfi": "epubcfi(/6)"}})
        self.assertEqual(compare.check(self._expect("progress", {"axis": "audio"}), ebook_only).kind, compare.MISSING)

    def test_progress_does_not_compare_the_exact_position(self) -> None:
        # The player keeps writing after the journal line is appended, so an
        # exact comparison would fail on a healthy run.
        state = FakeState(progress={(BOOK, "audio"): {"audio_position_seconds": 9999.0}})
        self.assertIsNone(compare.check(self._expect("progress", {"axis": "audio", "seconds": 10.0}), state))

    def test_a_journal_entry_matches_through_reflowed_whitespace(self) -> None:
        state = FakeState(journals={BOOK: [{"body_md": "one\n\ntwo   three"}]})
        self.assertIsNone(compare.check(self._expect("journal", "one two three"), state))

    def test_two_copies_of_one_journal_entry_are_a_duplicate(self) -> None:
        state = FakeState(journals={BOOK: [{"body_md": "hello"}, {"body_md": "hello"}]})
        self.assertEqual(compare.check(self._expect("journal", "hello"), state).kind, compare.DUPLICATE)

    def test_an_edited_journal_entry_is_a_mismatch_not_a_miss(self) -> None:
        exp = expectations.Expectation(
            "agent-1", 7, "journal", "journal entry", BOOK, "expected", "new text", {"phrase": "brine-lantern"}
        )
        state = FakeState(journals={BOOK: [{"body_md": "old text with brine-lantern in it"}]})
        self.assertEqual(compare.check(exp, state).kind, compare.MISMATCH)

    def test_a_wishlist_entry_that_is_gone_is_missing(self) -> None:
        found = compare.check(self._expect("wishlist", "a-uuid", target=None), FakeState(wishlist=[]))
        self.assertEqual(found.kind, compare.MISSING)

    def test_unexpected_needs_a_baseline(self) -> None:
        state = FakeState(ratings={BOOK: 5.0}, library=[BOOK])
        self.assertEqual(compare.unexpected("agent-1", state, None, claims_of()), [])

    def test_unexpected_reports_a_rating_the_journal_never_claimed(self) -> None:
        baseline = {"library": [BOOK], "actors": {"agent-1": {"books": {BOOK: {"rating": None}}}}}
        state = FakeState(ratings={BOOK: 5.0}, statuses={}, journals={}, shelves=[])
        found = compare.unexpected("agent-1", state, baseline, claims_of())
        self.assertEqual([f.kind for f in found], [compare.UNEXPECTED])

    def test_unexpected_stays_quiet_about_a_shelf_the_journal_claimed(self) -> None:
        baseline = {"library": [], "actors": {"agent-2": {"books": {}, "shelves": []}}}
        state = FakeState(shelves=[{"name": "agent-2 shortlist", "id": 7}])
        claimed = claims_of(shelf_names={"agent-2 shortlist"})
        self.assertEqual(compare.unexpected("agent-2", state, baseline, claimed), [])
        # …but a second, unclaimed shelf on the same actor is still reported.
        state2 = FakeState(shelves=[{"name": "agent-2 shortlist"}, {"name": "mystery pile"}])
        found = compare.unexpected("agent-2", state2, baseline, claimed)
        self.assertEqual([f.observed for f in found], ["shelf 'mystery pile'"])

    def test_unexpected_stays_quiet_about_state_the_baseline_already_held(self) -> None:
        baseline = {"library": [BOOK], "actors": {"agent-1": {"books": {BOOK: {"rating": 5.0}}, "shelves": []}}}
        state = FakeState(ratings={BOOK: 5.0}, statuses={}, journals={}, shelves=[])
        self.assertEqual(compare.unexpected("agent-1", state, baseline, claims_of()), [])


class ClaimsTests(unittest.TestCase):
    """FP-4 / FP-5: `unexpected` must subtract every slot the journal addressed."""

    def _baseline(self, actor: str = "agent-1") -> dict:
        return {"library": [BOOK], "actors": {actor: {"books": {BOOK: {"rating": None}}, "shelves": []}}}

    def test_an_unjudged_write_still_claims_its_slot_against_unexpected(self) -> None:
        # FP-4: the rating params are unreadable, so no expectation is folded —
        # but the write usually landed, and re-reporting it as `unexpected`
        # would contradict the journal line that names it.
        entries = [entry("rating.set", target=BOOK, params={"how": "clicked the stars"})]
        exps, unver, _, claims = expectations.expectations_for("agent-1", entries)
        self.assertEqual(exps, [])
        self.assertEqual(len(unver), 1)
        self.assertIn(("rating", BOOK), claims.slots)
        state = FakeState(ratings={BOOK: 5.0}, statuses={}, journals={}, shelves=[])
        self.assertEqual(compare.unexpected("agent-1", state, self._baseline(), claims), [])

    def test_an_unknown_shelf_verb_suppresses_the_shelf_sweep(self) -> None:
        # FP-4: `shelf.reorder` is UNKNOWN — the audit cannot say which shelf
        # it touched, so no shelf-level surprise is sound to report.
        entries = [entry("shelf.reorder", params={})]
        _, _, _, claims = expectations.expectations_for("agent-2", entries)
        self.assertTrue(claims.shelf_any)
        baseline = {"library": [], "actors": {"agent-2": {"books": {}, "shelves": []}}}
        state = FakeState(shelves=[{"name": "renamed pile"}])
        self.assertEqual(compare.unexpected("agent-2", state, baseline, claims), [])

    def test_a_named_unknown_shelf_verb_claims_just_that_name(self) -> None:
        entries = [entry("shelf.reorder", params={"name": "new name"})]
        _, _, _, claims = expectations.expectations_for("agent-2", entries)
        self.assertFalse(claims.shelf_any)
        self.assertIn("new name", claims.shelf_names)

    def test_opening_a_book_claims_its_read_status_slot(self) -> None:
        # FP-5: the reading surfaces auto-write read status client-side
        # (read_status_auto.rs) — merely opening a book moves unread→reading
        # with nothing journalled, and that must not read as `unexpected`.
        for action in ("book.open", "reader.open", "player.play"):
            entries = [entry(action, target=BOOK)]
            _, _, _, claims = expectations.expectations_for("agent-1", entries)
            self.assertIn(("read_status", BOOK), claims.slots, action)
        state = FakeState(ratings={}, statuses={BOOK: "reading"}, journals={}, shelves=[])
        baseline = {"library": [BOOK], "actors": {"agent-1": {"books": {BOOK: {"read_status": None}}, "shelves": []}}}
        _, _, _, claims = expectations.expectations_for("agent-1", [entry("book.open", target=BOOK)])
        self.assertEqual(compare.unexpected("agent-1", state, baseline, claims), [])

    def test_a_status_write_the_journal_never_made_is_still_reported(self) -> None:
        # The FP-5 claim is scoped to the book that was opened — a status
        # change on a book nothing touched still surfaces.
        other = "00000000-0000-0000-0000-000000000001"
        _, _, _, claims = expectations.expectations_for("agent-1", [entry("book.open", target=BOOK)])
        state = FakeState(ratings={}, statuses={other: "finished"}, journals={}, shelves=[])
        baseline = {
            "library": [BOOK, other],
            "actors": {"agent-1": {"books": {BOOK: {}, other: {"read_status": None}}, "shelves": []}},
        }
        found = compare.unexpected("agent-1", state, baseline, claims)
        self.assertEqual([(f.kind, f.target) for f in found], [(compare.UNEXPECTED, other)])



class WishlistRenameTests(unittest.TestCase):
    """#2519: a display-name change renames the wishlist, which read as an unexplained shelf."""

    @staticmethod
    def _baseline(*shelves: str) -> dict:
        return {"library": [], "actors": {"agent-4": {"books": {}, "shelves": list(shelves)}}}

    def test_a_display_name_change_claims_the_wishlist_it_renames(self) -> None:
        # r-20260908-02 agent-4 and agent-3, and the older `new_display_name` shape.
        for params in (
            {"field": "display_name", "old": "(empty, fell back to username explorer-4)", "new": "Rowan Beckett"},
            {"old_display_name": None, "new_display_name": "  Rowan Beckett "},
        ):
            _, unver, _, claims = expectations.expectations_for("agent-4", [entry("profile.update", params=params)])
            self.assertEqual(len(unver), 1, params)
            state = FakeState(shelves=[{"name": "Rowan Beckett's Wishlist", "kind": "wishlist"}])
            baseline = self._baseline("explorer-4's Wishlist")
            self.assertEqual(compare.unexpected("agent-4", state, baseline, claims), [], params)

    def test_a_wishlist_named_for_nobody_the_journal_renamed_is_still_reported(self) -> None:
        entries = [
            entry("profile.update", seq=1, params={"new": "Rowan Beckett"}),
            entry("avatar.replace", seq=2, params={"source_filename": "cover.jpg"}),
        ]
        _, _, _, claims = expectations.expectations_for("agent-4", entries)
        self.assertFalse(claims.shelf_any)
        state = FakeState(shelves=[{"name": "Marguerite Ashby's Wishlist", "kind": "wishlist"}])
        found = compare.unexpected("agent-4", state, self._baseline("explorer-4's Wishlist"), claims)
        self.assertEqual([f.observed for f in found], ['shelf "Marguerite Ashby\'s Wishlist"'])

    def test_a_wishlist_an_earlier_run_renamed_is_not_unexpected(self) -> None:
        # The baseline is captured before this run, so an earlier rename is in it.
        state = FakeState(shelves=[{"name": "Rosalind Fenwick's Wishlist", "kind": "wishlist"}])
        baseline = self._baseline("Rosalind Fenwick's Wishlist")
        self.assertEqual(compare.unexpected("agent-4", state, baseline, claims_of()), [])

class ContainmentTests(unittest.TestCase):
    """PY-4: one bad uuid or one dead login must not destroy the report."""

    def test_one_failing_state_read_costs_one_expectation_not_the_report(self) -> None:
        bad = "not-a-uuid"

        class OneBadUuid(FakeState):
            def rating(self, uuid: str) -> Any:
                if uuid == bad:
                    raise ApiError(f"POST /api/rpc/ratings/get -> HTTP 500 for {uuid}")
                return super().rating(uuid)

        good = expectations.Expectation("agent-1", 1, "rating", "rating", BOOK, "x", 4.5)
        broken = expectations.Expectation("agent-1", 2, "rating", "rating", bad, "x", 3.0)
        state = OneBadUuid(ratings={BOOK: 4.5})
        findings, failed = compare.check_all([good, broken], state)
        self.assertEqual(findings, [])
        self.assertEqual([exp.seq for exp, _ in failed], [2])
        self.assertIn("state read failed", failed[0][1])

    def test_a_dead_login_is_contained_to_its_actor(self) -> None:
        import audit
        from audit_lib.client import Account

        # Port 1 refuses instantly; the helper must answer, not raise.
        reader, error = audit.actor_reader("http://127.0.0.1:1", Account("agent-9", "u", "p"))
        self.assertIsNone(reader)
        self.assertIn("agent-9", error or "")
