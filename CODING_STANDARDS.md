# Coding standards

Judgement rules every code review of this repo applies, on top of what the
linters, the tests and [.claude/rules/](.claude/rules/) already check. Each
rule names what to compare and what passing looks like. A finding against one
names the rule, the file:line, and the state a user ends up seeing.

## A moved write keeps its fallbacks

When a change moves a write to another screen, module or call path, or
replaces how it is made, compare the old path with the new one on each of:

- **Optimistic update**: what the screen showed before the server answered.
- **Revert**: what the screen showed when the server refused.
- **Cache**: which stored copy was patched, deleted or left stale.
- **Follow-up read**: what the screen showed when a refresh after the write
  failed.

The new path keeps every fallback the old one had, or the PR says why it drops
it. The case this rule comes from: an iOS setting moved from a toolbar, which
restacked the grid itself, into Settings, which restacked it only through an
identity refresh that swallows failures, so a refresh that failed after a
successful save left every grid in the old layout.

## A broken book degrades like Apple Books

When a reader change handles a malformed book (a manifest entry the zip lacks,
a sheet or font that won't load, a url() that names no file), compare what the
reader shows with what Apple Books shows for the same book:

- **A missing file** shows nothing: no picture, the fallback font. The iOS
  host's resource check still hears of it, so the book stays detectably broken.
- **Every other file** shows from its own copy, never a neighbour's.

A finding's failure scenario stands on a book that exists: a fixture, a user's
report, or a test book opened in Apple Books to compare. A case that only a
hand-built spelling reaches is a follow-up, not a fix in the same PR. The case
this rule comes from: a fix for an error flash grew, over nine review rounds, a
CSS scanner for spellings no book was known to use, while a manifest entry the
zip lacked shifted every later file onto the next one's copy, so chapters
showed the wrong pictures. Apple Books showed nothing for the missing file and
every other file correctly, and matching it took one function run at book open.
