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
