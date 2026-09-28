"""Action-name classification and the value parsers."""

from __future__ import annotations

import unittest

from .. import expectations, vocabulary
from .support import BOOK, entry


class VocabularyTests(unittest.TestCase):
    def test_classify_recognises_a_documented_write(self) -> None:
        cls = vocabulary.classify("rating.set")
        self.assertTrue(cls.is_write)
        self.assertEqual(cls.family, "rating")

    def test_classify_folds_plural_and_separator_spellings_onto_one_noun(self) -> None:
        self.assertEqual(vocabulary.classify("ratings.set").family, "rating")
        self.assertEqual(vocabulary.classify("shelves.create").family, "shelf")
        self.assertEqual(vocabulary.classify("playback.rate").family, "playback_rate")

    def test_classify_reads_a_trailing_qualifier_as_an_observation(self) -> None:
        for name in ("book.add.verify", "reader.resume_check", "reader.resume.verify", "wishlist.verify"):
            self.assertEqual(vocabulary.classify(name).kind, vocabulary.OBSERVATION, name)

    def test_classify_reads_a_trailing_qualifier_behind_filler_as_an_observation(self) -> None:
        self.assertEqual(vocabulary.classify("journal.persist.verify").kind, vocabulary.OBSERVATION)

    def test_classify_marks_metadata_out_of_scope_with_the_contract_reason(self) -> None:
        cls = vocabulary.classify("metadata.save")
        self.assertEqual(cls.kind, vocabulary.OUT_OF_SCOPE)
        self.assertEqual(cls.detail, vocabulary.SCOPE_METADATA)

    def test_classify_never_guesses_a_write_from_an_unknown_verb(self) -> None:
        for name in ("shelf.reorder", "player.scrub", "journal.pin"):
            cls = vocabulary.classify(name)
            self.assertEqual(cls.kind, vocabulary.UNKNOWN, name)
            self.assertIn(name, cls.reason or "")

    def test_an_unlisted_verb_on_a_state_free_noun_is_a_look(self) -> None:
        # The verb slot is open exactly where the noun holds nothing to miss.
        for name in ("nav.jump", "search.refine", "stats.expand", "ui.hover"):
            self.assertEqual(vocabulary.classify(name).kind, vocabulary.OBSERVATION, name)

    def test_an_unlisted_verb_on_an_excluded_noun_stays_out_of_scope(self) -> None:
        cls = vocabulary.classify("metadata.revert")
        self.assertEqual(cls.kind, vocabulary.OUT_OF_SCOPE)
        self.assertEqual(cls.detail, vocabulary.SCOPE_METADATA)

    def test_classify_resolves_a_two_segment_noun(self) -> None:
        for name in ("read-status.set", "read_status.set", "readstatus.set"):
            self.assertEqual(vocabulary.classify(name).family, "read_status", name)

    def test_a_deep_name_resolves_through_a_non_write_verb_at_either_end(self) -> None:
        self.assertEqual(vocabulary.classify("book.detail.open").kind, vocabulary.OBSERVATION)
        self.assertEqual(vocabulary.classify("reader.settings.font_size").kind, vocabulary.OBSERVATION)

    def test_a_deep_name_never_collapses_onto_a_write_verb(self) -> None:
        # `shelf.archive` is not defined; reading `shelf.archive.all` as one
        # would assert a shelf that nothing created.
        self.assertEqual(vocabulary.classify("shelf.archive.all").kind, vocabulary.UNKNOWN)

    def test_confirm_is_the_act_not_a_check_that_it_stuck(self) -> None:
        # `merge.confirm` presses the button; treating it as a look would
        # drop it from `unverifiable` entirely.
        self.assertEqual(vocabulary.classify("merge.confirm").kind, vocabulary.OUT_OF_SCOPE)
        self.assertEqual(vocabulary.classify("merge.attempt").kind, vocabulary.OBSERVATION)

    def test_classify_returns_unknown_rather_than_raising_on_junk(self) -> None:
        self.assertEqual(vocabulary.classify(None).kind, vocabulary.UNKNOWN)
        self.assertEqual(vocabulary.classify("...").kind, vocabulary.UNKNOWN)

    def test_player_rate_is_playback_speed_not_a_star_rating(self) -> None:
        self.assertEqual(vocabulary.classify("player.rate").family, "playback_rate")


class ParserTests(unittest.TestCase):
    def test_parse_rating_reads_prose_and_explicit_clears(self) -> None:
        self.assertEqual(expectations.parse_rating("3.5 of 5"), 3.5)
        self.assertEqual(expectations.parse_rating(4), 4.0)
        self.assertIsNone(expectations.parse_rating(None))
        self.assertIsNone(expectations.parse_rating("cleared"))

    def test_parse_rating_rejects_a_boolean_standing_where_a_value_was_expected(self) -> None:
        self.assertIs(expectations.parse_rating(True), expectations.UNPARSED)

    def test_parse_status_normalises_the_ui_wording(self) -> None:
        self.assertEqual(expectations.parse_status("reading (In progress)"), "reading")
        self.assertEqual(expectations.parse_status("Finished just now"), "finished")
        self.assertEqual(expectations.parse_status("unread (Not started)"), "unread")
        self.assertIs(expectations.parse_status(True), expectations.UNPARSED)

    def test_parse_rate_reads_the_ui_suffix(self) -> None:
        self.assertEqual(expectations.parse_rate("1.20x"), 1.2)
        self.assertIs(expectations.parse_rate(9.0), expectations.UNPARSED)

    def test_parse_percent_reads_a_position_string(self) -> None:
        self.assertEqual(expectations.parse_percent("Ch 9 of 64, p. 3 of 22, 11%"), 11.0)

    def test_parse_status_does_not_read_did_not_finish_as_finished(self) -> None:
        for phrase in ("did not finish", "didn't finish it", "never finished"):
            self.assertNotEqual(expectations.parse_status(phrase), "finished", phrase)
        self.assertEqual(expectations.parse_status("Finished just now"), "finished")

    def test_parse_rating_refuses_a_value_off_the_half_star_grid(self) -> None:
        # The UI rates in 0.5 steps; 4.3 is a misread, not a rating, and
        # asserting it would mismatch against every honest half-star row.
        self.assertIs(expectations.parse_rating(4.3), expectations.UNPARSED)
        self.assertEqual(expectations.parse_rating(4.5), 4.5)

    def test_a_bare_close_with_no_position_is_declined_not_asserted(self) -> None:
        # A cover-only open-and-close may never write a position server-side.
        exps, unver, _, _ = expectations.expectations_for(
            "agent-1", [entry("reader.close", target=BOOK, params={"exit_via": "Back to book"})]
        )
        self.assertEqual(exps, [])
        self.assertEqual(len(unver), 1)
        self.assertIn("no position recorded", unver[0].why)
