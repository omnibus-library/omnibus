"""Folding journal entries into expectations: supersession, edits, colours, titles."""

from __future__ import annotations

import unittest

from .. import compare, expectations, journal, vocabulary
from .support import BOOK, OTHER, FakeState, entry


class ExpectationTests(unittest.TestCase):
    def test_scalar_family_keeps_only_the_last_statement(self) -> None:
        entries = [
            entry("rating.set", seq=1, target=BOOK, params={"new": 4.0}),
            entry("rating.set", seq=2, target=BOOK, params={"old": 4.0, "new": None}),
            entry("rating.set", seq=3, target=BOOK, params={"old": None, "new": 4.5}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(len(exps), 1)
        self.assertEqual(exps[0].value, 4.5)
        self.assertEqual(unver, [])

    def test_rating_prefers_the_terminal_value_over_a_transition_list(self) -> None:
        e = entry(
            "rating.set",
            target=BOOK,
            params={"sequence": [{"old": "none", "new": "4.5 of 5"}], "final_rating_left_behind": "3.5 of 5"},
        )
        exps, _, _, _ = expectations.expectations_for("agent-1", [e])
        self.assertEqual(exps[0].value, 3.5)

    def test_status_falls_past_a_key_holding_a_boolean(self) -> None:
        e = entry(
            "status.set",
            target=BOOK,
            params={"old": "finished", "new": "reading", "left_in_this_state": True},
        )
        exps, _, _, _ = expectations.expectations_for("agent-1", [e])
        self.assertEqual(exps[0].value, "reading")

    def test_status_reads_the_last_of_a_transition_list(self) -> None:
        e = entry(
            "status.set",
            target=BOOK,
            params={"transitions": [{"old": "reading", "new": "finished"}, {"old": "finished", "new": "reading"}]},
        )
        exps, _, _, _ = expectations.expectations_for("agent-1", [e])
        self.assertEqual(exps[0].value, "reading")

    def test_add_then_remove_expects_nothing(self) -> None:
        entries = [
            entry("wishlist.add", seq=1, target="a-uuid", params={"chosen_title": "Dune"}),
            entry("wishlist.remove", seq=2, target="a-uuid", params={}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-3", entries)
        self.assertEqual(exps, [])

    def test_a_remove_of_something_this_run_never_added_cancels_nothing(self) -> None:
        # The bug this guards: agent adds A, then removes B (added by an
        # earlier run). A pop that falls back to "drop the most recent" would
        # cancel A's expectation, and the audit would never look for it.
        entries = [
            entry("wishlist.add", seq=1, target="uuid-A", params={"chosen_title": "A"}),
            entry("wishlist.remove", seq=2, target="uuid-B", params={}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-3", entries)
        self.assertEqual([e.value for e in exps], ["uuid-A"])
        self.assertIn("did not add", unver[0].why)

    def test_classify_reads_the_device_scenario_nouns_as_observations(self) -> None:
        # ios_lane.md's offline names and kobo_sync.md's sync check: device
        # state, not per-user state, so they must not land in `unverifiable`.
        for action in ("offline.on", "offline.off", "outbox.queued", "outbox.drained",
                       "probe.refused", "sync.delta"):
            self.assertEqual(vocabulary.classify(action).kind, vocabulary.OBSERVATION, action)

    def test_classify_recognises_a_shelf_edit_as_an_update_write(self) -> None:
        for action in ("shelf.edit", "shelf.rename"):
            cls = vocabulary.classify(action)
            self.assertEqual((cls.kind, cls.family, cls.detail), (vocabulary.WRITE, "shelf", "update"), action)

    def test_a_shelf_rename_supersedes_its_create(self) -> None:
        entries = [
            entry("shelf.create", seq=1, params={"name": "Weeknight Reading"}),
            entry("shelf.edit", seq=2, params={"old_name": "Weeknight Reading", "name": "Weeknight Reads"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-2", entries)
        self.assertEqual([e.value for e in exps], ["Weeknight Reads"])
        self.assertEqual(unver, [])

    def test_a_shelf_edit_keeping_its_name_asserts_it_once(self) -> None:
        entries = [
            entry("shelf.create", seq=1, params={"name": "Books Dad Lent Me"}),
            entry("shelf.edit", seq=2, params={"name": "Books Dad Lent Me", "visibility": "public"}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-2", entries)
        self.assertEqual([e.value for e in exps], ["Books Dad Lent Me"])

    def test_a_shelf_edit_of_an_earlier_runs_shelf_still_asserts_the_new_name(self) -> None:
        entries = [entry("shelf.edit", seq=1, params={"old_name": "old pile", "name": "new pile"})]
        exps, unver, _, claims = expectations.expectations_for("agent-2", entries)
        self.assertEqual([e.value for e in exps], ["new pile"])
        self.assertEqual(unver, [])
        self.assertIn("new pile", claims.shelf_names)

    def test_a_shelf_delete_drops_its_journalled_memberships(self) -> None:
        entries = [
            entry("shelf.create", seq=1, params={"name": "Rainy Sunday Stack"}),
            entry("shelf.add", seq=2, target=BOOK, params={"shelf": "Rainy Sunday Stack"}),
            entry("shelf.delete", seq=3, params={"name": "Rainy Sunday Stack"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-6", entries)
        self.assertEqual(exps, [])
        self.assertEqual(unver, [])

    def test_a_book_delete_supersedes_the_actors_own_add(self) -> None:
        entries = [
            entry("book.add", seq=1, target=BOOK, params={"source_filename": "x.epub"}),
            entry("book.delete", seq=2, target=BOOK, params={"files": ["x.epub"]}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-3", entries)
        self.assertEqual(exps, [])
        self.assertEqual(unver, [])

    def test_a_copy_removal_supersedes_a_paper_only_add(self) -> None:
        entries = [
            entry("book.add", seq=1, target=BOOK, params={"title": "paper only"}),
            entry("checkin.remove", seq=2, target=BOOK, params={}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-4", entries)
        self.assertEqual(exps, [])

    def test_ios_bookmark_and_shelf_entries_do_not_read_the_book_title_as_a_name(self) -> None:
        bm = entry("bookmark.create", seq=1, target=BOOK, params={"title": "Dawnshard", "location": "page 32"})
        bm = journal.Entry(**{**bm.__dict__, "surface": "ios"})
        sh = entry("shelf.add", seq=2, target=BOOK, params={"title": "Dawnshard", "shelf": "Lunch Break Picks"})
        sh = journal.Entry(**{**sh.__dict__, "surface": "ios"})
        exps, _, _, _ = expectations.expectations_for("agent-6", [bm, sh])
        by_family = {e.family: e for e in exps}
        self.assertIsNone(by_family["bookmark"].value.get("label"))
        self.assertEqual(by_family["shelf_member"].target, "Lunch Break Picks")

    def test_a_highlight_delete_naming_deleted_text_pops_that_create(self) -> None:
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"selected_text": "first passage", "colour": "amber"}),
            entry("highlight.create", seq=2, target=BOOK, params={"selected_text": "second passage", "colour": "green"}),
            entry("highlight.delete", seq=3, target=BOOK, params={"deleted_text": "first passage"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-3", entries)
        self.assertEqual([e.value["quote"] for e in exps], ["second passage"])
        self.assertEqual(unver, [])

    def test_progress_reads_the_records_envelope(self) -> None:
        from ..state import _progress_record
        env = {"book_uuid": BOOK, "records": [
            {"format": "epub", "epub_cfi": "epubcfi(/6/2!/4/1:0)", "progress_percent": 39},
            {"format": "audio", "audio_position_seconds": 12.5},
        ], "furthest": "epub", "linked": False}
        self.assertEqual(_progress_record(env, "epub")["progress_percent"], 39)
        self.assertEqual(_progress_record(env, "audio")["audio_position_seconds"], 12.5)
        self.assertIsNone(_progress_record({"book_uuid": BOOK, "records": []}, "epub"))
        self.assertEqual(_progress_record({"format": "epub", "epub_cfi": "x"}, "epub")["epub_cfi"], "x")

    def test_a_shelf_delete_this_run_never_created_cancels_nothing(self) -> None:
        entries = [
            entry("shelf.create", seq=1, params={"name": "mine"}),
            entry("shelf.delete", seq=2, params={"name": "someone else's"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-2", entries)
        self.assertEqual([e.value for e in exps], ["mine"])
        self.assertIn("did not create", unver[0].why)

    def test_journal_update_supersedes_its_create(self) -> None:
        entries = [
            entry("journal.create", seq=1, target=BOOK, params={"entry_text_verbatim": "first draft"}),
            entry("journal.update", seq=2, target=BOOK, params={"after_verbatim": "first draft plus more"}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual([e.value for e in exps], ["first draft plus more"])

    def test_a_write_with_no_readable_value_is_unverifiable_not_a_finding(self) -> None:
        e = entry("rating.set", target=BOOK, params={"how": "clicked the stars"})
        exps, unver, _, _ = expectations.expectations_for("agent-1", [e])
        self.assertEqual(exps, [])
        self.assertEqual(len(unver), 1)
        self.assertIn("no readable rating", unver[0].why)

    def test_a_refused_write_is_unverifiable_not_a_finding(self) -> None:
        e = entry("book.add", target=None, outcome="refused", params={"uuid": BOOK})
        exps, unver, _, _ = expectations.expectations_for("agent-2", [e])
        self.assertEqual(exps, [])
        self.assertIn("refused", unver[0].why)

    def test_an_unknown_action_is_unverifiable_and_names_itself(self) -> None:
        e = entry("shelf.reorder", target=None, params={"name": "x"})
        exps, unver, tally, _ = expectations.expectations_for("agent-1", [e])
        self.assertEqual(exps, [])
        self.assertIn("shelf.reorder", unver[0].why)
        self.assertEqual(tally[vocabulary.UNKNOWN], 1)

    def test_an_observation_produces_neither_expectation_nor_unverifiable(self) -> None:
        exps, unver, tally, _ = expectations.expectations_for("agent-1", [entry("book.open", target=BOOK)])
        self.assertEqual((exps, unver), ([], []))
        self.assertEqual(tally[vocabulary.OBSERVATION], 1)

    def test_progress_takes_its_axis_from_the_action_head(self) -> None:
        exps, _, _, _ = expectations.expectations_for(
            "agent-3", [entry("player.close", target=BOOK, params={"final_position_secs": 6869})]
        )
        self.assertEqual(exps[0].value["axis"], "audio")
        self.assertEqual(exps[0].value["seconds"], 6869.0)


class FoldEditTests(unittest.TestCase):
    """FP-1/2/3, SM-1/2/3: edits and deletes must supersede what they name."""

    def test_journal_update_pops_the_entry_it_names_not_the_most_recent(self) -> None:
        # FP-1: create A, create B, edit A. The edit names A by its prior
        # text; popping "most recent" would cancel B and leave A stale.
        entries = [
            entry("journal.create", seq=1, target=BOOK, params={"entry_text_verbatim": "first entry"}),
            entry("journal.create", seq=2, target=BOOK, params={"entry_text_verbatim": "second entry"}),
            entry(
                "journal.update", seq=3, target=BOOK,
                params={"before_verbatim": "first entry", "after_verbatim": "first entry, edited"},
            ),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(sorted(e.value for e in exps), ["first entry, edited", "second entry"])
        self.assertEqual(unver, [])

    def test_a_note_edit_supersedes_the_highlight_it_edited(self) -> None:
        # FP-2: the prior is named by its OLD note; the new note is what the
        # replacement asserts, and the untouched quote survives the merge.
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"note_text": "old note", "quote": "the passage"}),
            entry("highlight.note", seq=2, target=BOOK, params={"old_note": "old note", "note_text": "new note"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(len(exps), 1)
        self.assertEqual(exps[0].value["note"], "new note")
        self.assertEqual(exps[0].value["quote"], "the passage")
        self.assertEqual(unver, [])

    def test_a_note_edit_finds_the_prior_by_its_quote(self) -> None:
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"note_text": "old", "quote": "the passage"}),
            entry("highlight.note", seq=2, target=BOOK, params={"note_text": "new", "quote": "the passage"}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual([e.value["note"] for e in exps], ["new"])

    def test_a_highlight_delete_matches_on_the_quote(self) -> None:
        # FP-3: the delete names the quote, not the note — it must still find
        # the create rather than leaving a stale `missing` plus a skip.
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"note_text": "keep an eye", "quote": "the passage"}),
            entry("highlight.delete", seq=2, target=BOOK, params={"quote": "the passage"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(exps, [])
        self.assertEqual(unver, [])

    def test_dual_format_progress_folds_per_axis(self) -> None:
        # SM-1: a dual-format book keeps one position row per format; folding
        # reader and player statements together leaves one axis unchecked.
        entries = [
            entry("reader.progress", seq=1, target=BOOK, params={"app_shows": "p. 3 of 22 · 11%"}),
            entry("player.seek", seq=2, target=BOOK, params={"to_secs": 120.0}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(sorted(e.value["axis"] for e in exps), ["audio", "ebook"])

    def test_a_colour_only_edit_keeps_the_note_it_cannot_name(self) -> None:
        # SM-2: a colour change names nothing identifying; with one candidate
        # the reference is unambiguous, and the merge must keep the note.
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"note_text": "keep", "colour": "green"}),
            entry("highlight.colour", seq=2, target=BOOK, params={"colour": "blue"}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(len(exps), 1)
        self.assertEqual(exps[0].value["note"], "keep")
        self.assertEqual(exps[0].value["colour"], "blue")

    def test_an_ambiguous_edit_is_declined_not_guessed(self) -> None:
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"colour": "green"}),
            entry("highlight.create", seq=2, target=BOOK, params={"colour": "green"}),
            entry("highlight.colour", seq=3, target=BOOK, params={"colour": "blue"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(len(exps), 2)
        self.assertEqual(len(unver), 1)
        self.assertIn("cannot attribute", unver[0].why)

    def test_highlight_colour_is_compared_against_the_row(self) -> None:
        # SM-2: colour was never compared on any path.
        exp = expectations.Expectation(
            "agent-1", 2, "highlight", "highlight", BOOK, "x", {"note": "keep", "colour": "blue"}
        )
        wrong = FakeState(highlights={BOOK: [{"note": "keep", "text": None, "color": "green"}]})
        found = compare.check(exp, wrong)
        self.assertIsNotNone(found)
        self.assertEqual(found.kind, compare.MISMATCH)
        right = FakeState(highlights={BOOK: [{"note": "keep", "text": None, "color": "blue"}]})
        self.assertIsNone(compare.check(exp, right))

    def test_bookmark_keys_identify_the_row(self) -> None:
        # SM-3: bookmarks used to fold with no keys at all, so every row
        # matched and a lost bookmark could never be reported.
        entries = [
            entry("bookmark.create", seq=1, target=BOOK, params={"title": "chapter one"}),
            entry("bookmark.create", seq=2, target=BOOK, params={"title": "chapter two"}),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        state = FakeState(bookmarks={BOOK: [{"position": "epubcfi(/6/2)", "title": "chapter one"}]})
        outcomes = [compare.check(e, state) for e in exps]
        kinds = [f.kind if f else None for f in outcomes]
        self.assertEqual(kinds, [None, compare.MISMATCH])


class ColourTests(unittest.TestCase):
    """#2362: the audit reported recoloured and prose-coloured highlights as lost."""

    def test_a_recolour_supersedes_the_colour_the_create_journalled(self) -> None:
        # adding_highlight.md requires the recolour, and names it
        # `highlight.recolour` — an action the audit never listed, so the
        # create's green was compared against the server's violet.
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"quote": "the passage", "colour": "green"}),
            entry("highlight.recolour", seq=2, target=BOOK, params={"quote": "the passage", "from": "green", "to": "violet"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(unver, [])
        self.assertEqual([e.value["colour"] for e in exps], ["violet"])
        state = FakeState(highlights={BOOK: [{"text": "the passage", "note": None, "color": "violet"}]})
        self.assertIsNone(compare.check(exps[0], state))

    def test_a_recolour_finds_its_prior_by_the_old_colour(self) -> None:
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"note_text": "first", "colour": "green"}),
            entry("highlight.create", seq=2, target=BOOK, params={"note_text": "second", "colour": "blue"}),
            entry("highlight.recolor", seq=3, target=BOOK, params={"old_colour": "green", "new_colour": "rose"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(unver, [])
        self.assertEqual({e.value["note"]: e.value["colour"] for e in exps}, {"first": "rose", "second": "blue"})

    def test_colour_prose_is_matched_on_its_token(self) -> None:
        exp = expectations.Expectation(
            "agent-1", 2, "highlight", "highlight", BOOK, "x",
            {"note": "keep", "colour": "amber (the reader's default)"},
        )
        right = FakeState(highlights={BOOK: [{"note": "keep", "text": None, "color": "amber"}]})
        self.assertIsNone(compare.check(exp, right))
        wrong = FakeState(highlights={BOOK: [{"note": "keep", "text": None, "color": "green"}]})
        self.assertEqual(compare.check(exp, wrong).kind, compare.MISMATCH)

    def test_parse_colour_reads_synonyms_and_takes_the_last_named(self) -> None:
        self.assertEqual(expectations.parse_colour("yellow"), "amber")
        self.assertEqual(expectations.parse_colour("changed from green to violet"), "violet")
        self.assertIs(expectations.parse_colour("a bright one"), expectations.UNPARSED)

    def test_a_text_divergence_still_mismatches_when_the_colour_agrees(self) -> None:
        # AC3: matching colours must not paper over a lost note.
        exp = expectations.Expectation(
            "agent-1", 2, "highlight", "highlight", BOOK, "x", {"note": "keep", "colour": "amber"}
        )
        state = FakeState(highlights={BOOK: [{"note": "something else", "text": None, "color": "amber"}]})
        self.assertEqual(compare.check(exp, state).kind, compare.MISMATCH)


class TitleResolutionTests(unittest.TestCase):
    """#2365: the iOS lane cannot see a uuid, so its entries name the book by title."""

    @staticmethod
    def _resolve(title: str) -> tuple[str | None, str]:
        library = {"the lighthouse": [BOOK], "twice shelved": [BOOK, OTHER]}
        matches = library.get(title.casefold(), [])
        if len(matches) == 1:
            return matches[0], ""
        return None, f"title {title!r} matches {len(matches)} library books"

    def test_an_ios_entry_gets_its_uuid_from_an_unambiguous_title(self) -> None:
        e = entry("rating.set", surface="ios", target=None, params={"title": "The Lighthouse", "new": 4.0})
        resolved = expectations.resolve_targets([e], self._resolve)
        self.assertEqual(resolved[0].target, BOOK)
        exps, unver, _, _ = expectations.expectations_for("agent-1", resolved)
        self.assertEqual(unver, [])
        self.assertEqual((exps[0].target, exps[0].value), (BOOK, 4.0))

    def test_an_ambiguous_title_is_declined_with_the_reason(self) -> None:
        e = entry("rating.set", surface="ios", target=None, params={"title": "Twice Shelved", "new": 4.0})
        exps, unver, _, _ = expectations.expectations_for(
            "agent-1", expectations.resolve_targets([e], self._resolve)
        )
        self.assertEqual(exps, [])
        self.assertEqual(len(unver), 1)
        self.assertIn("matches 2 library books", unver[0].why)

    def test_a_web_entry_is_never_resolved_by_title(self) -> None:
        # The web agent has the uuid on the page; resolving for it would hide
        # a journal that broke the contract.
        e = entry("rating.set", surface="web", target=None, params={"title": "The Lighthouse", "new": 4.0})
        resolved = expectations.resolve_targets([e], self._resolve)
        self.assertIsNone(resolved[0].target)
        self.assertIsNone(resolved[0].target_note)

    def test_an_entry_with_a_uuid_keeps_it(self) -> None:
        e = entry("rating.set", surface="ios", target=OTHER, params={"title": "The Lighthouse", "new": 4.0})
        self.assertEqual(expectations.resolve_targets([e], self._resolve)[0].target, OTHER)

    def test_library_titles_index_the_listing_by_normalised_title(self) -> None:
        listing = {"books": [
            {"unique_identifier": BOOK, "title": "The  Lighthouse"},
            {"unique_identifier": OTHER, "title": "the lighthouse"},
        ]}
        from ..state import _titles_in
        self.assertEqual(_titles_in(listing), {"the lighthouse": [BOOK, OTHER]})


ISHMAEL = "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse."
HUNKS = "What of it, if some old hunks of a sea-captain orders me to get a broom and sweep down the decks?"
NOVEMBER = "The damp, drizzly November in my soul is the whole book in nine words."


class NotedHighlightTests(unittest.TestCase):
    """#2519: a highlight with a note, saved and verified, read as data loss."""

    def test_a_noted_highlight_recoloured_and_kept_produces_no_finding(self) -> None:
        # r-20260908-02 agent-8: every later step names its highlight by a
        # prefix of the passage, under keys the fold never read.
        entries = [
            entry("highlight.create", seq=114, target=BOOK, params={
                "selected_text_verbatim": ISHMAEL, "colour": "green",
            }),
            entry("highlight.note", seq=115, target=BOOK, params={
                "attached_to_highlight_starting": "Call me Ishmael. Some years ago—never mind how long precisely—",
                "note_text": NOVEMBER, "read_back_verbatim": NOVEMBER,
            }),
            entry("highlight.create", seq=116, target=BOOK, params={
                "selected_text_verbatim": HUNKS, "colour": "blue",
            }),
            entry("highlight.recolour", seq=117, target=BOOK, params={
                "highlight_starting": "Call me Ishmael. Some years ago—",
                "colour_before": "green", "colour_after": "violet",
            }),
            entry("highlight.delete", seq=118, target=BOOK, params={
                "deleted_highlight_verbatim_start": "What of it, if some old hunks of a sea-captain",
                "kept_highlight_verbatim_start": "Call me Ishmael. Some years ago—",
            }),
            entry("highlight.create.verify", seq=120, target=BOOK, params={"note_present_and_verbatim": NOVEMBER}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-8", entries)
        self.assertEqual(unver, [])
        self.assertEqual(len(exps), 1)
        self.assertEqual(exps[0].value["quote"], ISHMAEL, "a prefix naming the highlight must not replace its quote")
        state = FakeState(highlights={BOOK: [{"text": ISHMAEL, "note": NOVEMBER, "color": "violet"}]})
        self.assertEqual(compare.check_all(exps, state), ([], []))

    def test_a_recolour_and_delete_naming_their_passage_leave_only_the_noted_highlight(self) -> None:
        # r-20260908-02 agent-4: the same keys under their other spellings.
        carson = "Wenjie opened the book and was pulled in."
        radar = "In the distance, the gigantic antenna on top of Radar Peak rose once again."
        entries = [
            entry("highlight.create", seq=49, target=BOOK, params={"verbatim_text": carson, "colour": "green"}),
            entry("highlight.note", seq=50, target=BOOK, params={
                "highlight_verbatim_text": carson, "note_text": "apocalypse",
            }),
            entry("highlight.create", seq=52, target=BOOK, params={"verbatim_text": radar, "colour": "violet"}),
            entry("highlight.recolour", seq=54, target=BOOK, params={
                "highlight_verbatim_text": radar, "colour_before": "violet", "colour_after": "blue",
            }),
            entry("highlight.delete", seq=56, target=BOOK, params={
                "deleted_verbatim_text": radar, "colour_at_delete": "blue",
            }),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-4", entries)
        self.assertEqual(unver, [])
        state = FakeState(highlights={BOOK: [{"text": carson, "note": "apocalypse", "color": "green"}]})
        self.assertEqual(compare.check_all(exps, state), ([], []))

    def test_a_delete_naming_the_passage_as_the_saved_list_shows_it_finds_its_create(self) -> None:
        # r-20260908-02 agent-6 (iOS): the list read back the passage without
        # the space the page showed, so the delete never matched its create.
        entries = [
            entry("highlight.create", seq=10, target=BOOK, params={
                "selected_text": "stranger, and I, an embarrassment. It's been two months", "colour": "green",
            }),
            entry("highlight.create", seq=11, target=BOOK, params={
                "selected_text": "my reputation has not.", "colour": "yellow",
            }),
            entry("highlight.note", seq=12, target=BOOK, params={
                "highlight_text": "my reputation has not.", "note_text": "Reputation heals slower than bone.",
            }),
            entry("highlight.delete", seq=17, target=BOOK, params={
                "deleted_text": "stranger, and I, an embarrassment.It's been two months",
            }),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-6", entries)
        self.assertEqual(unver, [])
        state = FakeState(highlights={BOOK: [
            {"text": "my reputation has not.", "note": "Reputation heals slower than bone.", "color": "amber"},
        ]})
        self.assertEqual(compare.check_all(exps, state), ([], []))

    def test_a_highlight_expectation_names_what_each_text_it_carries_is(self) -> None:
        # The finding quoted the note bare, and was read as the audit wanting
        # the note to be the passage.
        entries = [
            entry("highlight.create", seq=1, target=BOOK, params={"quote": "the passage", "colour": "green"}),
            entry("highlight.note", seq=2, target=BOOK, params={
                "highlight_text": "the passage", "note_text": "a thought",
            }),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertIn("quoting 'the passage'", exps[0].expected)
        self.assertIn("with note 'a thought'", exps[0].expected)
        self.assertIn("green", exps[0].expected)


class JournalEditTests(unittest.TestCase):
    """#2519: an edit's params described the change, and the audit compared the description."""

    def test_a_journal_edit_described_in_prose_asserts_no_text(self) -> None:
        # r-20260908-02 agent-6 seq 90: `after` held a description, not a body.
        e = entry("journal.update", seq=90, target=BOOK, params={
            "before": "the four-paragraph entry ending \"...More at [his site](https://www.peterbeagle.com).\"",
            "after": "same, plus \" Coming back a day later: I was wrong about the butterfly.\" appended",
        })
        exps, unver, _, claims = expectations.expectations_for("agent-6", [e])
        self.assertEqual(exps, [])
        self.assertEqual([u.seq for u in unver], [90])
        self.assertIn("after_verbatim", unver[0].why)
        self.assertIn(("journal", BOOK), claims.slots)

    def test_a_journal_edit_described_in_prose_supersedes_the_entry_it_edited(self) -> None:
        # The created text no longer holds once a paragraph lands inside it,
        # so asserting it after the edit would report the edit as a loss.
        entries = [
            entry("journal.create", seq=140, target=BOOK, params={
                "entry_text_verbatim": "First paragraph.\n\nLast line.",
            }),
            entry("journal.update", seq=141, target=BOOK, params={
                "before": "entry ended with the spoiler paragraph then the image",
                "after": "a closing paragraph added between them: Coming back to this a day later.",
            }),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(exps, [])
        self.assertEqual([u.seq for u in unver], [141])
        edited = "First paragraph.\n\nComing back to this a day later.\n\nLast line."
        state = FakeState(journals={BOOK: [{"body_md": edited}]})
        self.assertEqual(compare.check_all(exps, state), ([], []))

    def test_a_verbatim_before_naming_no_entry_from_this_run_cancels_nothing(self) -> None:
        # Quoted text that matches nothing here is an earlier run's entry, so
        # this run's own entry on the book is still asserted.
        entries = [
            entry("journal.create", seq=1, target=BOOK, params={"entry_text_verbatim": "this run's entry"}),
            entry("journal.update", seq=2, target=BOOK, params={
                "before_verbatim": "an earlier run's entry", "after_verbatim": "an earlier run's entry, edited",
            }),
        ]
        exps, _, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(sorted(e.value for e in exps), ["an earlier run's entry, edited", "this run's entry"])


class ConfirmedWriteTests(unittest.TestCase):
    """#2519: a write journalled `uncertain` and then verified `ok` is a completed write."""

    def test_an_uncertain_delete_confirmed_by_its_verify_supersedes_the_add(self) -> None:
        # r-20260908-02 agent-1 seq 111/112.
        entries = [
            entry("book.add", seq=94, target=BOOK, params={"source_filename": "The Sword of Kaigen.epub"}),
            entry("book.delete", seq=111, target=BOOK, outcome="uncertain", params={"files_chosen": ["x.epub"]}),
            entry("book.delete.verify", seq=112, target=BOOK, params={"outcome_of_two": "gone entirely"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(exps, [])
        self.assertEqual(unver, [])

    def test_a_verify_confirms_only_the_latest_attempt_of_its_action(self) -> None:
        # r-20260908-02 agent-4: a failed selection journalled `uncertain`, a
        # real highlight after it, and one verify that is about the real one.
        entries = [
            entry("highlight.create", seq=51, target=BOOK, outcome="uncertain", params={
                "attempted": "two paragraphs",
            }),
            entry("highlight.create", seq=52, target=BOOK, params={
                "verbatim_text": "the antenna line", "colour": "violet",
            }),
            entry("highlight.create.verify", seq=57, target=BOOK, params={"observed": "1 saved passage"}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-4", entries)
        self.assertEqual([e.seq for e in exps], [52])
        self.assertEqual([u.seq for u in unver], [51])

    def test_a_verify_does_not_confirm_a_refused_write_or_another_books(self) -> None:
        entries = [
            entry("book.add", seq=1, target=BOOK, params={}),
            entry("book.add", seq=2, target=OTHER, params={}),
            entry("book.delete", seq=3, target=BOOK, outcome="refused", params={}),
            entry("book.delete", seq=4, target=OTHER, outcome="uncertain", params={}),
            entry("book.delete.verify", seq=5, target=BOOK, params={}),
            entry("book.delete.attempt", seq=6, target=OTHER, params={}),
        ]
        exps, unver, _, _ = expectations.expectations_for("agent-1", entries)
        self.assertEqual(sorted(e.target for e in exps), sorted([BOOK, OTHER]))
        self.assertEqual([u.seq for u in unver], [3, 4])
