#!/usr/bin/env python3
"""Tests for scripts/testflight_feedback_to_issues.py — the daily step that turns
TestFlight screenshot feedback into GitHub issues.

No network and no credentials: the real script is imported and only its I/O
primitives — `asc_get`, `asc_jwt`, and `gh` — are stubbed. The property under
test is idempotence. The dedupe used to be one Search API call per submission
that *proceeded* on failure, and the search rate limit made it fail on the
same tail of the list every morning — so half of these assert which issues a
run does not create, and one asserts the script never reaches for search.

Usage: scripts/tests/testflight-feedback.test.py
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "testflight_feedback_to_issues.py"

APP_ID = "app-1"
BUNDLE_ID = "com.omnibus.mobile"
REPO = "owner/repo"
ASSET_BRANCH = "testflight-feedback"

pass_count = 0
fail_count = 0


def check(desc, expected, actual):
    global pass_count, fail_count
    if actual == expected:
        print(f"PASS: {desc}")
        pass_count += 1
    else:
        print(f"FAIL: {desc} (expected {expected!r}, got {actual!r})", file=sys.stderr)
        fail_count += 1


class Resp:
    """The slice of requests.Response the script actually touches."""

    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = {} if payload is None else payload
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload


def submission(sub_id):
    return {"id": sub_id, "attributes": {"comment": f"Feedback {sub_id}", "screenshots": []},
            "relationships": {}}


def issue(sub_id, state="open"):
    """An issue as the script itself would have filed it, marker included."""
    return {"number": 1, "state": state,
            "body": f"## Description\nx\n\n<!-- asc-feedback-id: {sub_id} -->\n"}


class FakeGitHub:
    """A scripted GitHub REST API.

    `pages` is what the label listing answers, one entry per page number.
    `listing_status` forces the listing to fail. Anything the script asks for
    that isn't stubbed — the Search API above all — is an assertion failure.
    """

    def __init__(self, pages=((),), listing_status=200):
        self.pages = [list(p) for p in pages]
        self.listing_status = listing_status
        self.listing_params = []
        self.created = []  # issue titles POSTed

    def __call__(self, method, path, token, **kw):
        if "/search/" in path:
            raise AssertionError(f"the script must never reach for the Search API: {path}")
        if method == "GET" and path == f"/repos/{REPO}/issues":
            params = kw.get("params", {})
            self.listing_params.append(params)
            if self.listing_status != 200:
                return Resp(status_code=self.listing_status, payload={"message": "no"})
            page = params.get("page", 1)
            body = self.pages[page - 1] if page <= len(self.pages) else []
            return Resp(payload=body)
        if method == "POST" and path == f"/repos/{REPO}/issues":
            self.created.append(kw["json"]["title"])
            return Resp(status_code=201, payload={"number": len(self.created)})
        if path == f"/repos/{REPO}/branches/{ASSET_BRANCH}":
            return Resp(payload={})  # asset branch already exists
        raise AssertionError(f"unstubbed request: {method} {path}")


def fake_asc(subs):
    def asc_get(url, token, params=None):
        if url == "/v1/apps":
            return {"data": [{"id": APP_ID}]}
        if url == f"/v1/apps/{APP_ID}/betaFeedbackScreenshotSubmissions":
            return {"data": [submission(s) for s in subs], "included": [], "links": {}}
        raise AssertionError(f"unstubbed ASC request: {url}")
    return asc_get


def run(fake_gh, subs, **env):
    """Import the script fresh under `env` and run main() against the fakes."""
    # Every setting the script reads is pinned: a developer's ambient
    # ASSET_BRANCH or MAX_PAGES must not change what this suite exercises.
    base = {"ASC_ISSUER_ID": "issuer", "ASC_KEY_ID": "key", "ASC_PRIVATE_KEY": "pem",
            "GITHUB_TOKEN": "ghs", "GITHUB_REPOSITORY": REPO,
            "BUNDLE_IDS": BUNDLE_ID, "ASSET_BRANCH": ASSET_BRANCH, "MAX_PAGES": "5",
            "DRY_RUN": "0"}
    base.update(env)
    saved = dict(os.environ)
    os.environ.update(base)
    try:
        spec = importlib.util.spec_from_file_location("tf_feedback", SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            mod.gh = fake_gh
            mod.asc_get = fake_asc(subs)
            mod.asc_jwt = lambda: "stub-token"
            mod.main()
            return 0
        except SystemExit as e:
            return e.code or 0
    finally:
        os.environ.clear()
        os.environ.update(saved)


# Two already filed (one of them closed), one new: only the new one is created.
gh = FakeGitHub(pages=[[issue("AAA"), issue("BBB", state="closed")]])
code = run(gh, ["AAA", "BBB", "CCC"])
check("happy path exits 0", 0, code)
check("only the unfiled submission is created", 1, len(gh.created))
check("the created issue is the unfiled one", True, "Feedback CCC" in gh.created[0])
check("the listing is fetched once", 1, len(gh.listing_params))
check("the listing covers closed issues too", "all", gh.listing_params[0]["state"])
check("the listing is scoped to the script's label", "testflight",
      gh.listing_params[0]["labels"])

# A full first page means there is a second; a marker on it must still count.
first = [issue(f"P{i}") for i in range(100)]
gh = FakeGitHub(pages=[first, [issue("TAIL")]])
code = run(gh, ["TAIL", "P7"])
check("paged listing exits 0", 0, code)
check("a marker on the second page is honoured", 0, len(gh.created))
check("both pages are fetched", [1, 2], [p["page"] for p in gh.listing_params])

# The listing failing is the regression this suite exists for: abort, file nothing.
gh = FakeGitHub(listing_status=403)
code = run(gh, ["AAA"])
check("a failed listing exits non-zero", 1, code)
check("a failed listing files nothing", 0, len(gh.created))

# A submission repeated across pages mid-run is filed once.
gh = FakeGitHub()
code = run(gh, ["NEW", "NEW"])
check("a submission seen twice in one run is filed once", 1, len(gh.created))

# Dry run consults the listing and writes nothing.
gh = FakeGitHub()
code = run(gh, ["AAA"], DRY_RUN="1")
check("dry run exits 0", 0, code)
check("dry run creates nothing", 0, len(gh.created))

print("---")
print(f"{pass_count} passed, {fail_count} failed")
sys.exit(1 if fail_count else 0)
