-- Unit tests for omnibussync.lua, the plugin's pure sync logic. Plain luajit, no KOReader:
--   luajit koreader/tests/omnibussync.test.lua   (just koreader-plugin-test)
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/../omnibus.koplugin/?.lua;" .. package.path
local sync = require("omnibussync")

local failures = 0
local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then
        print("ok   - " .. name)
    else
        failures = failures + 1
        print("FAIL - " .. name .. ": " .. tostring(err))
    end
end

local function eq(actual, expected, what)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", what or "value", tostring(expected), tostring(actual)), 2)
    end
end

local DIR = "/books/Omnibus"
local ALPHA = { uuid = "0123abcd-0000-0000-0000-000000000000", title = "Alpha", format = "epub" }
local BETA = { uuid = "89efcdab-0000-0000-0000-000000000000", title = "Beta", format = "epub" }

-- A fake device: `files` is the set of paths on disk, `opts.delivered` the plugin's record of
-- what it delivered; every call lands in `log`. A download answers `true, "etag-new"` unless
-- `opts.fail_download[title]` fails it or `opts.not_modified` answers it with a 304; applying
-- metadata fails for the titles in `opts.fail_apply`.
local function fake(opts)
    opts = opts or {}
    local files = opts.files or {}
    local log = { downloads = {}, conditions = {}, applied = {}, removed = {}, reports = {}, saves = 0 }
    local deps = {
        dir = DIR,
        open_path = opts.open_path,
        manifest = opts.manifest or {},
        files = opts.delivered or {},
        can_replace = opts.can_replace ~= false,
        save_manifest = function()
            log.saves = log.saves + 1
        end,
        get_library = function()
            if opts.library then
                return (table.unpack or unpack)(opts.library, 1, 3)
            end
            return 200, { books = opts.books or {} }
        end,
        download = function(book, path, if_none_match)
            table.insert(log.downloads, path)
            table.insert(log.conditions, if_none_match or "none")
            local failure = opts.fail_download and opts.fail_download[book.title]
            if failure then
                return false, failure
            end
            if opts.not_modified then
                return true, nil, true
            end
            files[path] = true
            return true, "etag-new"
        end,
        apply_metadata = function(book, path)
            table.insert(log.applied, path)
            local failure = opts.fail_apply and opts.fail_apply[book.title]
            if failure then
                return false, failure
            end
            return true
        end,
        remove = function(path)
            table.insert(log.removed, path)
            files[path] = nil
            return true
        end,
        exists = function(path)
            return files[path] == true
        end,
        report = function(error_text)
            table.insert(log.reports, error_text == nil and "nil" or error_text)
        end,
    }
    return deps, log, files
end

test("file_name joins the title and the uuid prefix under the format extension", function()
    eq(sync.file_name(ALPHA), "Alpha - 0123abcd.epub")
end)

test("file_name replaces path and reserved characters and controls with underscores", function()
    local book = { uuid = ALPHA.uuid, title = 'a/b\\c:d*e?f"g<h>i|j\tk', format = "epub" }
    eq(sync.file_name(book), "a_b_c_d_e_f_g_h_i_j_k - 0123abcd.epub")
end)

test("file_name caps the title at 80 characters without splitting a multibyte one", function()
    local book = { uuid = ALPHA.uuid, title = string.rep("a", 79) .. "é" .. "tail", format = "epub" }
    eq(sync.file_name(book), string.rep("a", 79) .. " - 0123abcd.epub")
end)

test("book_url joins a host-relative download path to the configured server", function()
    local book = { download_url = "/koreader/v1/books/abc/file" }
    eq(sync.book_url("https://omni.test/", book), "https://omni.test/koreader/v1/books/abc/file")
end)

test("book_url refuses a download url that could point at another host", function()
    for _, url in ipairs({ "https://evil.test/x", "//evil.test/x", "@evil.test/x" }) do
        eq(sync.book_url("https://omni.test", { download_url = url }), nil, url)
    end
end)

test("cover_url joins a host-relative cover path to the configured server", function()
    local book = { cover_url = "/koreader/v1/books/abc/cover" }
    eq(sync.cover_url("https://omni.test/", book), "https://omni.test/koreader/v1/books/abc/cover")
end)

test("cover_url refuses a cover url that could point at another host", function()
    for _, url in ipairs({ "https://evil.test/x", "//evil.test/x", "@evil.test/x" }) do
        eq(sync.cover_url("https://omni.test", { cover_url = url }), nil, url)
    end
end)

test("plan downloads a library book that is absent from the manifest", function()
    local plan = sync.plan({}, { ALPHA }, DIR, function() return false end, nil)
    eq(#plan.download, 1)
    eq(plan.download[1].uuid, ALPHA.uuid)
end)

test("plan downloads a manifest book whose file is gone", function()
    local manifest = { [ALPHA.uuid] = DIR .. "/Alpha - 0123abcd.epub" }
    local plan = sync.plan(manifest, { ALPHA }, DIR, function() return false end, nil)
    eq(#plan.download, 1)
end)

test("plan keeps a delivered book whose file is still there", function()
    local path = DIR .. "/Alpha - 0123abcd.epub"
    local plan = sync.plan({ [ALPHA.uuid] = path }, { ALPHA }, DIR, function(p) return p == path end, nil)
    eq(#plan.download, 0)
    eq(#plan.delete, 0)
end)

test("plan deletes a manifest book that left the library", function()
    local path = DIR .. "/Beta - 89efcdab.epub"
    local plan = sync.plan({ [BETA.uuid] = path }, {}, DIR, function() return true end, nil)
    eq(#plan.delete, 1)
    eq(plan.delete[1].uuid, BETA.uuid)
    eq(plan.delete[1].path, path)
end)

test("plan never deletes a file outside the Omnibus folder, only forgets it", function()
    local manifest = {
        [ALPHA.uuid] = "/books/Sideloaded.epub",
        [BETA.uuid] = DIR .. "/../Sideloaded.epub",
    }
    local plan = sync.plan(manifest, {}, DIR, function() return true end, nil)
    eq(#plan.delete, 0)
    eq(#plan.forget, 2)
end)

test("plan never deletes the open document and leaves it in the manifest", function()
    local path = DIR .. "/Beta - 89efcdab.epub"
    local plan = sync.plan({ [BETA.uuid] = path }, {}, DIR, function() return true end, path)
    eq(#plan.delete, 0)
    eq(#plan.forget, 0)
end)

test("run downloads and removes books, saves the manifest after each file and reports success", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps, log = fake({
        books = { ALPHA },
        manifest = { [BETA.uuid] = gone },
        files = { [gone] = true },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(result.added, 1)
    eq(result.removed, 1)
    eq(log.downloads[1], DIR .. "/Alpha - 0123abcd.epub")
    eq(deps.manifest[ALPHA.uuid], DIR .. "/Alpha - 0123abcd.epub")
    eq(deps.manifest[BETA.uuid], nil)
    eq(log.saves, 2)
    eq(log.reports[1], "nil")
end)

test("run removes only the book file, never a sidecar folder", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps, log = fake({ manifest = { [BETA.uuid] = gone }, files = { [gone] = true } })

    sync.run("https://omni.test", deps)

    eq(#log.removed, 1)
    eq(log.removed[1], gone)
end)

test("run on a 401 changes nothing, reports nothing and says the device was removed", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps, log = fake({ library = { 401, nil }, manifest = { [BETA.uuid] = gone }, files = { [gone] = true } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(result.message, "This device was removed from Omnibus. Download the plugin again from Settings › Devices.")
    eq(#log.downloads + #log.removed + #log.reports, 0)
    eq(deps.manifest[BETA.uuid], gone)
end)

test("run with no response names the server and the error and touches nothing", function()
    local deps, log = fake({ library = { nil, nil, "connection refused" } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    assert(result.message:find("https://omni.test", 1, true), result.message)
    assert(result.message:find("connection refused", 1, true), result.message)
    eq(#log.downloads + #log.removed + #log.reports, 0)
end)

test("run treats a 200 without a books array as a failure, never an empty library", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps, log = fake({ library = { 200, { oops = true } }, manifest = { [BETA.uuid] = gone }, files = { [gone] = true } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(#log.removed, 0)
    eq(#log.reports, 1)
end)

test("run still delivers the other book when one download fails and reports the failure", function()
    local deps, log = fake({ books = { ALPHA, BETA }, fail_download = { Alpha = "HTTP 404" } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(result.added, 1)
    eq(result.message, "Couldn't download 1 book: Alpha: HTTP 404")
    eq(log.reports[1], "Couldn't download 1 book: Alpha: HTTP 404")
    eq(deps.manifest[BETA.uuid], DIR .. "/Beta - 89efcdab.epub")
    eq(deps.manifest[ALPHA.uuid], nil)
end)

test("run forgets a manifest path outside the folder without deleting it", function()
    local deps, log = fake({ manifest = { [ALPHA.uuid] = "/books/Sideloaded.epub" }, files = { ["/books/Sideloaded.epub"] = true } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(#log.removed, 0)
    eq(deps.manifest[ALPHA.uuid], nil)
end)


-- Metadata: what the plugin writes into the device's custom metadata, and when.
local EDITED = {
    uuid = ALPHA.uuid, title = "Alpha Revised", format = "epub", last_modified = 200,
    authors = { "Ada Lovelace", "Bo Peep" }, series = "The Greek Letters", series_index = 2.0,
    description = "An edited blurb",
}
local ALPHA_PATH = DIR .. "/Alpha - 0123abcd.epub"
local EDITED_PATH = DIR .. "/Alpha Revised - 0123abcd.epub"

test("custom_props maps title, authors, series, series_index and description", function()
    local props = sync.custom_props(EDITED)

    eq(props.title, "Alpha Revised")
    eq(props.authors, "Ada Lovelace\nBo Peep")
    eq(props.series, "The Greek Letters")
    eq(props.series_index, 2.0)
    eq(props.description, "An edited blurb")
end)

test("custom_props leaves out an empty title, a null series and index and an empty description", function()
    local null = function() end -- KOReader's json decodes null to a function
    local props = sync.custom_props({ title = "", authors = {}, series = null, series_index = null, description = "" })

    eq(props.title, nil)
    eq(props.authors, nil)
    eq(props.series, nil)
    eq(props.series_index, nil)
    eq(props.description, nil)
end)

test("refresh_plan lists a delivered book whose version moved, at its manifest path", function()
    local manifest = { [ALPHA.uuid] = "/books/Omnibus/Old name.epub" }
    local files = { [ALPHA.uuid] = { path = "/books/Omnibus/Old name.epub", version = 100 } }

    local plan = sync.refresh_plan(manifest, files, { EDITED }, function() return true end, nil)

    eq(#plan, 1)
    eq(plan[1].book, EDITED)
    eq(plan[1].path, "/books/Omnibus/Old name.epub")
end)

test("refresh_plan skips a book whose version matches", function()
    local manifest = { [ALPHA.uuid] = ALPHA_PATH }
    local files = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 200 } }

    eq(#sync.refresh_plan(manifest, files, { EDITED }, function() return true end, nil), 0)
end)

test("refresh_plan skips the open document and a file that is gone", function()
    local manifest = { [ALPHA.uuid] = ALPHA_PATH, [BETA.uuid] = DIR .. "/Beta - 89efcdab.epub" }
    local files = {}
    local beta = { uuid = BETA.uuid, title = "Beta", format = "epub", last_modified = 5 }
    local exists = function(path) return path == ALPHA_PATH end

    eq(#sync.refresh_plan(manifest, files, { EDITED, beta }, exists, ALPHA_PATH), 0)
end)

test("refresh_plan treats a delivered book with no record as changed", function()
    local manifest = { [ALPHA.uuid] = ALPHA_PATH }

    eq(#sync.refresh_plan(manifest, {}, { EDITED }, function() return true end, nil), 1)
end)

test("run applies metadata after a new download and records its path, version and etag", function()
    local deps, log = fake({ books = { EDITED } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(log.applied[1], EDITED_PATH)
    eq(log.conditions[1], "none")
    local kept = deps.files[ALPHA.uuid]
    eq(kept.path, EDITED_PATH)
    eq(kept.version, 200)
    eq(kept.etag, "etag-new")
end)

test("run re-downloads a changed book to its manifest path with its saved etag and deletes nothing", function()
    local path = DIR .. "/Old name - 0123abcd.epub"
    local deps, log = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = path },
        files = { [path] = true },
        delivered = { [ALPHA.uuid] = { path = path, version = 100, etag = "etag-old" } },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(result.added, 0)
    eq(result.refreshed, 1)
    eq(result.replaced, 1)
    eq(log.downloads[1], path)
    eq(log.conditions[1], "etag-old")
    eq(#log.removed, 0)
    eq(deps.manifest[ALPHA.uuid], path)
    eq(log.applied[1], path)
    eq(deps.files[ALPHA.uuid].version, 200)
    eq(deps.files[ALPHA.uuid].etag, "etag-new")
end)

test("run keeps the file on a not-modified answer, still applies metadata and keeps the etag", function()
    local deps, log = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 100, etag = "etag-old" } },
        not_modified = true,
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(result.replaced, 0)
    eq(result.refreshed, 1)
    eq(log.applied[1], ALPHA_PATH)
    eq(deps.files[ALPHA.uuid].version, 200)
    eq(deps.files[ALPHA.uuid].etag, "etag-old")
end)

test("run with can_replace off never downloads for a refresh, still applies metadata and records the version", function()
    local deps, log = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 100, etag = "etag-old" } },
        can_replace = false,
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(#log.downloads, 0)
    eq(result.replaced, 0)
    eq(result.refreshed, 1)
    eq(log.applied[1], ALPHA_PATH)
    eq(deps.files[ALPHA.uuid].version, 200)
end)

test("run neither downloads nor applies metadata for a book whose version is unchanged", function()
    local deps, log = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 200, etag = "etag-old" } },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, true)
    eq(result.refreshed + result.replaced + result.added, 0)
    eq(#log.downloads + #log.applied, 0)
end)

test("run leaves the version as it was when a refresh download fails, so the next sync retries", function()
    local deps, log = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 100, etag = "etag-old" } },
        fail_download = { ["Alpha Revised"] = "HTTP 500" },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(result.message, "Couldn't update 1 book: Alpha Revised: HTTP 500")
    eq(log.reports[1], result.message)
    eq(#log.applied, 0)
    eq(deps.files[ALPHA.uuid].version, 100)
    eq(deps.files[ALPHA.uuid].etag, "etag-old")
end)

test("run records the new etag but not the version when applying metadata fails after a replace", function()
    local deps = fake({
        books = { EDITED },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 100, etag = "etag-old" } },
        fail_apply = { ["Alpha Revised"] = "unsupported cover type text/html" },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(result.message, "Couldn't update 1 book: Alpha Revised: unsupported cover type text/html")
    eq(deps.files[ALPHA.uuid].etag, "etag-new")
    eq(deps.files[ALPHA.uuid].version, 100)
end)

test("run joins a download failure and an update failure in one message", function()
    local beta = { uuid = BETA.uuid, title = "Beta", format = "epub", last_modified = 5 }
    local deps = fake({
        books = { EDITED, beta },
        manifest = { [ALPHA.uuid] = ALPHA_PATH },
        files = { [ALPHA_PATH] = true },
        delivered = { [ALPHA.uuid] = { path = ALPHA_PATH, version = 100 } },
        fail_download = { ["Alpha Revised"] = "HTTP 500", Beta = "HTTP 404" },
    })

    local result = sync.run("https://omni.test", deps)

    eq(result.message, "Couldn't download 1 book: Beta: HTTP 404; Couldn't update 1 book: Alpha Revised: HTTP 500")
end)

test("run delivers a returning book to the path it had when that is free inside the folder", function()
    local kept = DIR .. "/Old name - 0123abcd.epub"
    local deps, log = fake({
        books = { EDITED },
        delivered = { [ALPHA.uuid] = { path = kept, version = 100, etag = "etag-old" } },
    })

    sync.run("https://omni.test", deps)

    eq(log.downloads[1], kept)
    eq(log.conditions[1], "none")
    eq(deps.manifest[ALPHA.uuid], kept)
end)

test("run delivers a returning book under its file name when its old path is taken or outside the folder", function()
    for _, remembered in ipairs({ DIR .. "/Old name - 0123abcd.epub", "/books/Elsewhere.epub" }) do
        local deps, log = fake({
            books = { EDITED },
            files = { [DIR .. "/Old name - 0123abcd.epub"] = true },
            delivered = { [ALPHA.uuid] = { path = remembered, version = 100 } },
        })

        sync.run("https://omni.test", deps)

        eq(log.downloads[1], EDITED_PATH, remembered)
    end
end)


-- Reading state. `books` is the device's per-book record: percent, status, the event_at it
-- last agreed with the server, and whether a change still waits to be pushed.
local function entry(fields)
    local e = { percent = 40, status = "reading", event_at = 100, pending = false }
    for k, v in pairs(fields or {}) do
        e[k] = v
    end
    return e
end

test("percent floors a fraction to a whole percent clamped to 0..100, and passes nil on", function()
    local cases = { { 0.379, 37 }, { 1.0, 100 }, { 1.2, 100 }, { -0.1, 0 }, { 0, 0 } }
    for _, case in ipairs(cases) do
        eq(sync.percent(case[1]), case[2], tostring(case[1]))
    end
    eq(sync.percent(nil), nil, "nil")
end)

test("uuid_for_path finds the uuid of a delivered file and nothing for a sideload", function()
    local path = DIR .. "/Alpha - 0123abcd.epub"
    local manifest = { [ALPHA.uuid] = path, [BETA.uuid] = DIR .. "/Beta - 89efcdab.epub" }
    eq(sync.uuid_for_path(manifest, path), ALPHA.uuid)
    eq(sync.uuid_for_path(manifest, "/books/Sideloaded.epub"), nil)
end)

test("capture marks a book pending at now when its percent moved", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.percent, 55)
    eq(e.event_at, 500)
    eq(e.pending, true)
end)

test("capture marks a book pending at now when its status changed", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 40, status = "complete" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.status, "complete")
    eq(e.event_at, 500)
    eq(e.pending, true)
end)

test("capture leaves a book whose state matches the agreed one exactly as it was", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 40, status = "reading" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.event_at, 100)
    eq(e.pending, false)
end)

test("capture does nothing when the device cannot report a percent", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = nil, status = "complete" }, 500)

    eq(books[ALPHA.uuid].status, "reading")
    eq(books[ALPHA.uuid].pending, false)
end)

test("capture does nothing for a book that was never baselined", function()
    local books = {}

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)

    eq(books[ALPHA.uuid], nil)
end)

test("capture twice leaves one entry carrying the later event time", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)
    sync.capture(books, ALPHA.uuid, { percent = 61, status = "reading" }, 900)

    local count = 0
    for _ in pairs(books) do
        count = count + 1
    end
    eq(count, 1)
    eq(books[ALPHA.uuid].percent, 61)
    eq(books[ALPHA.uuid].event_at, 900)
end)

test("capture marks a book pending when only its xpointer moved within the same percent", function()
    local books = { [ALPHA.uuid] = entry({ xpointer = "/body/DocFragment/body/p[1]/text().0" }) }

    sync.capture(books, ALPHA.uuid,
        { percent = 40, status = "reading", xpointer = "/body/DocFragment/body/p[2]/text().0" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.xpointer, "/body/DocFragment/body/p[2]/text().0")
    eq(e.event_at, 500)
    eq(e.pending, true)
end)

test("capture never counts a missing xpointer as a change", function()
    local books = { [ALPHA.uuid] = entry({ xpointer = "/body/DocFragment/body/p/text().0" }) }

    sync.capture(books, ALPHA.uuid, { percent = 40, status = "reading" }, 500)

    eq(books[ALPHA.uuid].pending, false)
    eq(books[ALPHA.uuid].xpointer, "/body/DocFragment/body/p/text().0")
end)

test("capture does not push an entry saved before xpointers for the xpointer alone", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid,
        { percent = 40, status = "reading", xpointer = "/body/DocFragment/body/p/text().0" }, 500)

    eq(books[ALPHA.uuid].pending, false)
end)

-- A flush target that answers each PUT from `answers` in order and records what it was sent.
local function fake_server(answers)
    local sent, saves = {}, { n = 0 }
    local deps = {
        put_state = function(uuid, body)
            table.insert(sent, { uuid = uuid, body = body })
            local answer = answers[#sent] or { 200 }
            return (table.unpack or unpack)(answer, 1, 2)
        end,
        save = function()
            saves.n = saves.n + 1
        end,
    }
    return deps, sent, saves
end

test("flush sends each pending book once as percent, status and event time and clears pending", function()
    local books = {
        [ALPHA.uuid] = entry({ pending = true, percent = 55, event_at = 500 }),
        [BETA.uuid] = entry(),
    }
    local deps, sent, saves = fake_server({})

    local result = sync.flush(books, deps)

    eq(result.ok, true)
    eq(#sent, 1)
    eq(sent[1].uuid, ALPHA.uuid)
    eq(sent[1].body.percent, 55)
    eq(sent[1].body.status, "reading")
    eq(sent[1].body.event_at, 500)
    eq(books[ALPHA.uuid].pending, false)
    eq(saves.n, 1)
end)

test("flush sends the xpointer when the entry has one and leaves the key out otherwise", function()
    local books = {
        [ALPHA.uuid] = entry({ pending = true, xpointer = "/body/DocFragment/body/p/text().3" }),
        [BETA.uuid] = entry({ pending = true }),
    }
    local deps, sent = fake_server({})

    sync.flush(books, deps)

    eq(sent[1].body.xpointer, "/body/DocFragment/body/p/text().3")
    eq(sent[2].body.xpointer, nil)
end)

test("flush leaves the status out of the body when the device has none", function()
    local books = { [ALPHA.uuid] = entry({ pending = true }) }
    books[ALPHA.uuid].status = nil
    local deps, sent = fake_server({})

    sync.flush(books, deps)

    eq(sent[1].body.status, nil)
end)

test("flush clears pending without retrying when the server holds a newer position", function()
    local books = { [ALPHA.uuid] = entry({ pending = true }) }
    local deps, sent = fake_server({ { 409 } })

    local result = sync.flush(books, deps)

    eq(result.ok, true)
    eq(#sent, 1)
    eq(books[ALPHA.uuid].pending, false)
end)

test("flush drops a book the server refuses outright, so it never blocks the queue", function()
    for _, code in ipairs({ 400, 404, 422 }) do
        local books = {
            [ALPHA.uuid] = entry({ pending = true }),
            [BETA.uuid] = entry({ pending = true }),
        }
        local deps, sent = fake_server({ { code } })

        local result = sync.flush(books, deps)

        eq(result.ok, true, "HTTP " .. code)
        eq(#sent, 2, "HTTP " .. code)
        eq(books[ALPHA.uuid], nil, "HTTP " .. code)
        eq(books[BETA.uuid].pending, false, "HTTP " .. code)
    end
end)

test("flush with no response keeps every entry pending, stops and returns the error", function()
    local books = {
        [ALPHA.uuid] = entry({ pending = true }),
        [BETA.uuid] = entry({ pending = true }),
    }
    local deps, sent = fake_server({ { nil, "connection refused" } })

    local result = sync.flush(books, deps)

    eq(result.ok, false)
    assert(result.message:find("connection refused", 1, true), result.message)
    eq(#sent, 1)
    eq(books[ALPHA.uuid].pending, true)
    eq(books[BETA.uuid].pending, true)
end)

test("flush on a server error keeps every remaining entry pending and stops", function()
    local books = {
        [ALPHA.uuid] = entry({ pending = true }),
        [BETA.uuid] = entry({ pending = true }),
    }
    local deps, sent = fake_server({ { 503 } })

    local result = sync.flush(books, deps)

    eq(result.ok, false)
    assert(result.message:find("503", 1, true), result.message)
    eq(#sent, 1)
    eq(books[ALPHA.uuid].pending, true)
    eq(books[BETA.uuid].pending, true)
end)

test("flush on a 401 stops with the removed-device message and keeps the entries", function()
    local books = { [ALPHA.uuid] = entry({ pending = true }), [BETA.uuid] = entry({ pending = true }) }
    local deps, sent = fake_server({ { 401 } })

    local result = sync.flush(books, deps)

    eq(result.ok, false)
    eq(result.message, sync.REMOVED_MESSAGE)
    eq(#sent, 1)
    eq(books[ALPHA.uuid].pending, true)
end)

test("pull_plan moves to a remote position newer than the local entry", function()
    local plan = sync.pull_plan(entry({ percent = 40, event_at = 100 }),
        { position = { percent = 70, event_at = 300 } }, { percent = 40, status = "reading" })

    eq(plan.percent, 70)
    eq(plan.event_at, 300)
end)

test("pull_plan ignores a remote position older than the local entry", function()
    local plan = sync.pull_plan(entry({ percent = 40, event_at = 500 }),
        { position = { percent = 70, event_at = 300 } }, { percent = 40, status = "reading" })

    eq(plan, nil)
end)

test("pull_plan keeps the page when the newer remote position is the same whole percent", function()
    local plan = sync.pull_plan(entry({ percent = 40, event_at = 100 }),
        { position = { percent = 40, event_at = 300 } }, { percent = 40, status = "reading" })

    eq(plan.percent, nil)
    eq(plan.event_at, 300)
end)

test("pull_plan moves by a newer remote xpointer the device is not at, keeping the percent as fallback", function()
    local plan = sync.pull_plan(entry({ percent = 40, event_at = 100 }),
        { position = { percent = 40, event_at = 300, xpointer = "/body/DocFragment/body/p[7]/text().2" } },
        { percent = 40, status = "reading", xpointer = "/body/DocFragment/body/p[2]/text().0" })

    eq(plan.xpointer, "/body/DocFragment/body/p[7]/text().2")
    eq(plan.percent, 40)
    eq(plan.event_at, 300)
end)

test("pull_plan keeps the page when the newer remote xpointer is the one the device is at", function()
    local at = "/body/DocFragment/body/p[7]/text().2"
    local plan = sync.pull_plan(entry({ percent = 40, event_at = 100 }),
        { position = { percent = 41, event_at = 300, xpointer = at } },
        { percent = 40, status = "reading", xpointer = at })

    eq(plan.xpointer, nil)
    eq(plan.percent, nil)
    eq(plan.event_at, 300)
end)

test("pull_plan moves by percent when the remote position has no xpointer or the device has none", function()
    local remote = { position = { percent = 70, event_at = 300 } }
    local no_xpointer = sync.pull_plan(entry({ event_at = 100 }), remote,
        { percent = 40, status = "reading", xpointer = "/body/DocFragment/body/p/text().0" })
    local paged = sync.pull_plan(entry({ event_at = 100 }),
        { position = { percent = 70, event_at = 300, xpointer = "/body/DocFragment/body/p/text().5" } },
        { percent = 40, status = "reading" })

    eq(no_xpointer.percent, 70)
    eq(no_xpointer.xpointer, nil)
    eq(paged.percent, 70)
    eq(paged.xpointer, nil)
end)

test("pull_plan applies a newer remote complete status", function()
    local plan = sync.pull_plan(entry({ event_at = 100 }),
        { position = { percent = 100, event_at = 300 }, status = { status = "complete", event_at = 350 } },
        { percent = 40, status = "reading" })

    eq(plan.status, "complete")
    eq(plan.percent, 100)
    eq(plan.event_at, 350)
end)

test("pull_plan leaves a status the device already has", function()
    local plan = sync.pull_plan(entry({ event_at = 100 }),
        { status = { status = "reading", event_at = 350 } }, { percent = 40, status = "reading" })

    eq(plan.status, nil)
    eq(plan.event_at, 350)
end)

test("pull_plan returns nothing while the local entry waits to be pushed", function()
    local plan = sync.pull_plan(entry({ pending = true, event_at = 100 }),
        { position = { percent = 70, event_at = 300 } }, { percent = 55, status = "reading" })

    eq(plan, nil)
end)

test("pull_plan treats a missing entry as event time zero", function()
    local plan = sync.pull_plan(nil, { position = { percent = 70, event_at = 1 } },
        { percent = 5, status = nil })

    eq(plan.percent, 70)
end)

test("pull_plan returns nothing when the server holds no state", function()
    eq(sync.pull_plan(entry(), {}, { percent = 40, status = "reading" }), nil)
end)

test("pull_plan reads a decoded JSON null as no state", function()
    -- KOReader's json decodes null to a function, not nil.
    local null = function() end
    eq(sync.pull_plan(entry(), { position = null, status = null }, { percent = 40, status = "reading" }), nil)
end)

test("settle records the xpointer the device is at", function()
    local books = {}

    sync.settle(books, ALPHA.uuid, { percent = 70, status = "reading", xpointer = "/body/DocFragment/body/p/text().1" }, 300)

    eq(books[ALPHA.uuid].xpointer, "/body/DocFragment/body/p/text().1")
end)

test("settle records the device's own state as agreed at the event time and not pending", function()
    local books = { [ALPHA.uuid] = entry({ pending = true }) }

    sync.settle(books, ALPHA.uuid, { percent = 70, status = "complete" }, 300)

    local e = books[ALPHA.uuid]
    eq(e.percent, 70)
    eq(e.status, "complete")
    eq(e.event_at, 300)
    eq(e.pending, false)
end)

-- Annotation sync. A fake device: `items` is the book's annotation list, `opts.post` /
-- `opts.get` answer as `{ code, body, err }` (a function of the request, or a fixed table),
-- and every call lands in `log`. Adding and removing an item edits `items` like the device does.
local NOW = 1700000000
local PLACE = { pos0 = "/body/DocFragment/body/p[2]/text().0", pos1 = "/body/DocFragment/body/p[2]/text().6" }

local function highlight(fields)
    local item = { drawer = "lighten", color = "orange", text = "Second", note = "a note",
        pos0 = PLACE.pos0, pos1 = PLACE.pos1,
        datetime = os.date("%Y-%m-%d %H:%M:%S", NOW - 3600) }
    for k, v in pairs(fields or {}) do
        item[k] = v
    end
    return item
end

local function annotation_device(opts)
    opts = opts or {}
    local items = opts.items or {}
    local log = { posts = {}, gets = {}, added = {}, removed = {}, minted = 0 }
    local function answer(spec, request)
        if type(spec) == "function" then
            spec = spec(request)
        end
        return spec[1], spec[2], spec[3]
    end
    local deps = {
        new_id = function()
            log.minted = log.minted + 1
            return string.format("minted-%d", log.minted)
        end,
        post = function(body)
            table.insert(log.posts, body)
            return answer(opts.post or { 200, { results = {} } }, body)
        end,
        get = function(since)
            table.insert(log.gets, since)
            return answer(opts.get or { 200, { cursor = 500, annotations = {}, deleted = {} } }, since)
        end,
        add = function(wire)
            table.insert(log.added, wire)
            if opts.refuse_add then
                return nil
            end
            local item = highlight({ omnibus_id = wire.id, color = wire.color, note = wire.note,
                text = wire.text, pos0 = wire.pos0, pos1 = wire.pos1 })
            table.insert(items, item)
            return item
        end,
        remove = function(item)
            table.insert(log.removed, item)
            for i, candidate in ipairs(items) do
                if candidate == item then
                    table.remove(items, i)
                    break
                end
            end
        end,
    }
    return items, opts.synced or {}, deps, log
end

-- The server's version of a stored annotation, as a result or a listing carries it.
local function server_row(id, fields)
    local row = { id = id, pos0 = PLACE.pos0, pos1 = PLACE.pos1, text = "Second", note = "a note",
        color = "yellow", created_at = NOW - 3600, updated_at = NOW - 10 }
    for k, v in pairs(fields or {}) do
        row[k] = v
    end
    return row
end

-- The fingerprint of an item as it stands, for a `synced.agreed` entry that matches it.
local function fingerprint(item)
    return table.concat({ item.color or "", item.note or "", item.text or "", item.pos0, item.pos1 }, "\0")
end

local function server_fingerprint(row)
    return table.concat({ row.color, row.note or "", row.text or "" }, "\0")
end

-- The agreed entry for `item` as it stands, against the default `server_row`.
local function agreed_with(item, extra)
    local entry = { fp = fingerprint(item), server_at = NOW - 10, server_color = "yellow",
        server_fp = server_fingerprint(server_row("any")) }
    for k, v in pairs(extra or {}) do
        entry[k] = v
    end
    return entry
end

test("parse_datetime reads a KOReader local timestamp back to the epoch second it came from", function()
    eq(sync.parse_datetime(os.date("%Y-%m-%d %H:%M:%S", NOW)), NOW)
end)

test("parse_datetime yields nil for nothing and for junk", function()
    eq(sync.parse_datetime(nil), nil)
    eq(sync.parse_datetime("yesterday"), nil)
    eq(sync.parse_datetime("2024-01-01"), nil)
    eq(sync.parse_datetime(42), nil)
end)

test("sync_annotations pushes a new highlight under a minted id with its device times", function()
    local item = highlight()
    local items, synced, deps, log = annotation_device({ items = { item } })

    local result = sync.sync_annotations(items, synced, deps)

    eq(result.ok, true)
    eq(result.changed, true)
    eq(item.omnibus_id, "minted-1")
    eq(#log.posts, 1)
    local sent = log.posts[1].upserts[1]
    eq(sent.id, "minted-1")
    eq(sent.pos0, PLACE.pos0)
    eq(sent.pos1, PLACE.pos1)
    eq(sent.text, "Second")
    eq(sent.note, "a note")
    eq(sent.color, "orange")
    eq(sent.created_at, NOW - 3600)
    eq(sent.updated_at, NOW - 3600)
    eq(log.posts[1].deletes, nil)
end)

test("sync_annotations leaves a bookmark alone: never pushed, numbered or removed", function()
    local bookmark = { pos0 = PLACE.pos0, pos1 = PLACE.pos1, text = "page 4" }
    local items, synced, deps, log = annotation_device({
        items = { bookmark },
        get = { 200, { cursor = 5, annotations = {}, deleted = { "minted-1" } } },
    })

    sync.sync_annotations(items, synced, deps)

    eq(#log.posts, 0)
    eq(bookmark.omnibus_id, nil)
    eq(#items, 1)
    eq(#log.removed, 0)
end)

test("sync_annotations does not push an unchanged agreed highlight", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps, log = annotation_device({ items = { item } })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(#log.posts, 0)
end)

for field, changed in pairs({ color = "red", note = "edited", text = "other", pos0 = "/body/DocFragment/body/p[2]/text().1",
    pos1 = "/body/DocFragment/body/p[2]/text().5" }) do
    test("sync_annotations pushes an agreed highlight whose " .. field .. " changed", function()
        local item = highlight({ omnibus_id = "h1" })
        local items, synced, deps, log = annotation_device({ items = { item } })
        synced.agreed = { h1 = agreed_with(item) }
        item[field] = changed

        sync.sync_annotations(items, synced, deps)

        eq(log.posts[1].upserts[1].id, "h1")
        eq(log.posts[1].upserts[1][field], changed)
    end)
end

test("sync_annotations dates an edit no earlier than the server time it last agreed on", function()
    local newer = highlight({ omnibus_id = "newer", note = "x", datetime_updated = os.date("%Y-%m-%d %H:%M:%S", NOW) })
    local older = highlight({ omnibus_id = "older", note = "x", datetime_updated = os.date("%Y-%m-%d %H:%M:%S", NOW - 5000) })
    local items, synced, deps, log = annotation_device({ items = { newer, older } })
    local was = { newer = highlight(), older = highlight() }
    synced.agreed = { newer = agreed_with(was.newer, { server_at = NOW - 100 }),
        older = agreed_with(was.older, { server_at = NOW - 100 }) }

    sync.sync_annotations(items, synced, deps)

    eq(log.posts[1].upserts[1].updated_at, NOW)
    eq(log.posts[1].upserts[2].updated_at, NOW - 100)
end)

test("sync_annotations sends an agreed id missing from the items as a delete, and forgets a local-only one", function()
    local items, synced, deps, log = annotation_device()
    synced.agreed = { gone = { fp = "x", server_at = 1, server_color = "yellow" }, mine = { fp = "y", local_only = true } }

    local result = sync.sync_annotations(items, synced, deps)

    eq(result.ok, true)
    eq(#log.posts, 1)
    eq(log.posts[1].deletes[1], "gone")
    eq(#log.posts[1].deletes, 1)
    eq(synced.agreed.gone, nil)
    eq(synced.agreed.mine, nil)
end)

test("sync_annotations records an applied highlight as agreed with the server's time and colour", function()
    local item = highlight()
    local items, synced, deps = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "minted-1", outcome = "applied", annotation = server_row("minted-1") } } } },
    })

    sync.sync_annotations(items, synced, deps)

    local agreed = synced.agreed["minted-1"]
    eq(agreed.fp, fingerprint(item))
    eq(agreed.server_at, NOW - 10)
    eq(agreed.server_color, "yellow")
    eq(item.color, "orange")
end)

test("sync_annotations takes the server's note and text on a stale answer and keeps a colour the server did not change", function()
    local item = highlight({ omnibus_id = "h1", note = "device edit" })
    local items, synced, deps = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "h1", outcome = "stale",
            annotation = server_row("h1", { note = "web edit", text = "web text", updated_at = NOW - 5 }) } } } },
    })
    synced.agreed = { h1 = agreed_with(highlight({ omnibus_id = "h1" })) }

    local result = sync.sync_annotations(items, synced, deps)

    eq(item.note, "web edit")
    eq(item.text, "web text")
    eq(item.color, "orange")
    eq(synced.agreed.h1.server_at, NOW - 5)
    eq(synced.agreed.h1.fp, fingerprint(item))
    eq(result.changed, true)
end)

test("sync_annotations takes the server's colour on a stale answer when the server's colour moved", function()
    local item = highlight({ omnibus_id = "h1", note = "device edit" })
    local items, synced, deps = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "h1", outcome = "stale",
            annotation = server_row("h1", { color = "purple", updated_at = NOW - 5 }) } } } },
    })
    synced.agreed = { h1 = agreed_with(highlight({ omnibus_id = "h1" })) }

    sync.sync_annotations(items, synced, deps)

    eq(item.color, "purple")
end)

test("sync_annotations removes a highlight the server answers deleted", function()
    local item = highlight({ omnibus_id = "h1", note = "edited after the web deleted it" })
    local items, synced, deps, log = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "h1", outcome = "deleted" } } } },
    })
    synced.agreed = { h1 = agreed_with(highlight({ omnibus_id = "h1" })) }

    sync.sync_annotations(items, synced, deps)

    eq(#items, 0)
    eq(log.removed[1], item)
    eq(synced.agreed.h1, nil)
end)

test("sync_annotations keeps an unplaceable highlight local and does not resend it until it changes", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps, log = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "h1", outcome = "unplaceable" } } } },
    })

    sync.sync_annotations(items, synced, deps)
    sync.sync_annotations(items, synced, deps)
    item.note = "now different"
    sync.sync_annotations(items, synced, deps)

    eq(synced.agreed.h1.local_only, true)
    eq(#log.posts, 2)
    eq(#items, 1)
end)

test("sync_annotations adds a listed highlight the device lacks and agrees on it", function()
    local items, synced, deps, log = annotation_device({
        get = { 200, { cursor = 777, annotations = { server_row("w1", { color = "red", updated_at = NOW - 20 }) }, deleted = {} } },
    })

    local result = sync.sync_annotations(items, synced, deps)

    eq(result.ok, true)
    eq(#items, 1)
    eq(log.added[1].id, "w1")
    eq(synced.agreed.w1.server_at, NOW - 20)
    eq(synced.agreed.w1.server_color, "red")
    eq(synced.agreed.w1.fp, fingerprint(items[1]))
    eq(synced.cursor, 777)
    eq(log.gets[1], 0)
end)

test("sync_annotations skips a listed highlight the document cannot place and does not record it", function()
    local items, synced, deps = annotation_device({
        refuse_add = true,
        get = { 200, { cursor = 9, annotations = { server_row("w1") }, deleted = {} } },
    })

    sync.sync_annotations(items, synced, deps)

    eq(#items, 0)
    eq(synced.agreed.w1, nil)
end)

test("sync_annotations leaves a listed highlight older than the agreed time untouched", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { note = "older", updated_at = NOW - 11 }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(item.note, "a note")
end)

test("sync_annotations leaves a re-listed highlight the device already agreed on untouched", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { updated_at = NOW - 10 }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }
    item.color = "red"
    synced.agreed.h1.fp = fingerprint(item)

    sync.sync_annotations(items, synced, deps)

    eq(item.color, "red")
end)

test("sync_annotations applies a web edit made in the same second as the one it agreed on", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { color = "purple", updated_at = NOW - 10 }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(item.color, "purple")
end)

test("sync_annotations applies a newer web note edit but keeps the device's own colour when the server's did not move", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { note = "web note", updated_at = NOW }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(item.note, "web note")
    eq(item.color, "orange")
    eq(synced.agreed.h1.server_at, NOW)
    eq(synced.agreed.h1.fp, fingerprint(item))
end)

test("sync_annotations takes a web recolour as the colour the server now names", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { color = "purple", updated_at = NOW }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(item.color, "purple")
    eq(synced.agreed.h1.server_color, "purple")
end)

test("sync_annotations removes a highlight the server lists as deleted, even one edited locally", function()
    local item = highlight({ omnibus_id = "h1" })
    local other = highlight({ omnibus_id = "h2" })
    local items, synced, deps, log = annotation_device({
        items = { item, other },
        get = { 200, { cursor = 9, annotations = {}, deleted = { "h1", "never-here" } } },
    })
    synced.agreed = { h1 = agreed_with(item), h2 = agreed_with(other) }

    sync.sync_annotations(items, synced, deps)

    eq(#items, 1)
    eq(items[1], other)
    eq(log.removed[1], item)
    eq(synced.agreed.h1, nil)
end)

test("sync_annotations never deletes a highlight the listing merely omits", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps, log = annotation_device({
        items = { item },
        get = { 200, { cursor = 9, annotations = {}, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item) }

    sync.sync_annotations(items, synced, deps)

    eq(#items, 1)
    eq(#log.removed, 0)
    eq(synced.agreed.h1 ~= nil, true)
end)

test("sync_annotations reads a decoded JSON null note or annotation as nothing", function()
    local null = function() end
    local item = highlight({ omnibus_id = "h1", note = "kept" })
    local pushed = highlight({ omnibus_id = "h2" })
    local items, synced, deps = annotation_device({
        items = { item, pushed },
        post = { 200, { results = { { id = "h2", outcome = "stale", annotation = null } } } },
        get = { 200, { cursor = 9, annotations = { server_row("h1", { note = null, updated_at = NOW }) }, deleted = {} } },
    })
    synced.agreed = { h1 = agreed_with(item), h2 = agreed_with(highlight({ omnibus_id = "h2" })) }
    pushed.note = "changed"

    sync.sync_annotations(items, synced, deps)

    eq(item.note, nil)
    eq(pushed.note, "changed")
end)

for name, response in pairs({
    ["no response"] = { nil, nil, "timeout" },
    ["a server error"] = { 503 },
    ["a 200 without results"] = { 200, {} },
}) do
    test("sync_annotations fails on " .. name .. " to the push and changes nothing it did not land", function()
        local item = highlight({ omnibus_id = "h1", note = "edited" })
        local items, synced, deps, log = annotation_device({ items = { item }, post = response })
        synced.agreed = { h1 = agreed_with(highlight({ omnibus_id = "h1" })), gone = { fp = "x", server_at = 1 } }
        synced.cursor = 41

        local result = sync.sync_annotations(items, synced, deps)

        eq(result.ok, false)
        eq(result.message ~= nil, true)
        eq(synced.cursor, 41)
        eq(synced.agreed.gone ~= nil, true)
        eq(synced.agreed.h1.fp == fingerprint(item), false)
        eq(#items, 1)
        eq(#log.gets, 0)
    end)
end

for name, response in pairs({
    ["no response"] = { nil, nil, "timeout" },
    ["a server error"] = { 500 },
    ["a 200 without an annotations array"] = { 200, { cursor = 9 } },
}) do
    test("sync_annotations fails on " .. name .. " to the listing, never reading it as nothing changed", function()
        local item = highlight({ omnibus_id = "h1" })
        local items, synced, deps, log = annotation_device({ items = { item }, get = response })
        synced.agreed = { h1 = agreed_with(item), other = agreed_with(highlight(), { server_at = 1 }) }
        synced.cursor = 41

        local result = sync.sync_annotations(items, synced, deps)

        eq(result.ok, false)
        eq(synced.cursor, 41)
        eq(#items, 1)
        eq(#log.removed, 0)
    end)
end

test("sync_annotations tells a removed device apart on a 401 from either call", function()
    for _, which in ipairs({ "post", "get" }) do
        local item = highlight({ omnibus_id = "h1", note = "edited" })
        local items, synced, deps = annotation_device({ items = { item }, [which] = { 401 } })
        synced.agreed = { h1 = agreed_with(highlight({ omnibus_id = "h1" })) }

        local result = sync.sync_annotations(items, synced, deps)

        eq(result.ok, false)
        eq(result.message, sync.REMOVED_MESSAGE, which)
    end
end)

test("sync_annotations reports a failed pull after a landed push as changed so the push is kept", function()
    local item = highlight()
    local items, synced, deps = annotation_device({
        items = { item },
        post = { 200, { results = { { id = "minted-1", outcome = "applied", annotation = server_row("minted-1") } } } },
        get = { 503 },
    })

    local result = sync.sync_annotations(items, synced, deps)

    eq(result.ok, false)
    eq(result.changed, true)
    eq(synced.agreed["minted-1"] ~= nil, true)
end)

test("sync_annotations with no saved state sends no deletes and pulls from the start", function()
    local item = highlight({ omnibus_id = "h1" })
    local items, synced, deps, log = annotation_device({ items = { item } })

    sync.sync_annotations(items, synced, deps)

    eq(log.posts[1].deletes, nil)
    eq(log.gets[1], 0)
end)

test("sync_annotations splits a large push into requests within the server's batch cap", function()
    local items = {}
    for i = 1, sync.PUSH_BATCH + 1 do
        table.insert(items, highlight({ omnibus_id = "h" .. i }))
    end
    local _, synced, deps, log = annotation_device({ items = items })

    sync.sync_annotations(items, synced, deps)

    eq(#log.posts, 2)
    eq(#log.posts[1].upserts, sync.PUSH_BATCH)
    eq(#log.posts[2].upserts, 1)
end)


os.exit(failures == 0 and 0 or 1)
