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
local ALPHA = {
    uuid = "0123abcd-0000-0000-0000-000000000000", title = "Alpha", format = "epub",
    download_url = "/koreader/v1/books/0123abcd-0000-0000-0000-000000000000/file",
}
local BETA = {
    uuid = "89efcdab-0000-0000-0000-000000000000", title = "Beta", format = "epub",
    download_url = "/koreader/v1/books/89efcdab-0000-0000-0000-000000000000/file",
}

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
    eq(sync.file_name(book), string.rep("a", 79) .. "é - 0123abcd.epub")
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

test("plan downloads a wanted book again when its manifest path is outside the folder, without deleting it", function()
    local old = "/old/Omnibus/Alpha - 0123abcd.epub"
    local plan = sync.plan({ [ALPHA.uuid] = old }, { ALPHA }, "/new/Omnibus", function(p) return p == old end, nil)
    eq(#plan.download, 1)
    eq(#plan.delete, 0)
    eq(plan.forget[1], ALPHA.uuid)
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
    eq(result.message, "This device was removed from Omnibus. Add a new KOReader in Settings › Devices and install its plugin.")
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

test("run treats a books map as an unreadable library and removes nothing", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps, log = fake({ library = { 200, { books = { x = 1 } } }, manifest = { [BETA.uuid] = gone }, files = { [gone] = true } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(result.message, "Omnibus sent a library this plugin could not read. Download the plugin again from Settings › Devices.")
    eq(#log.removed, 0)
    eq(deps.manifest[BETA.uuid], gone)
end)

test("run treats a book without a uuid as an unreadable library instead of crashing", function()
    local deps, log = fake({ library = { 200, { books = { { title = "X" } } } } })

    local result = sync.run("https://omni.test", deps)

    eq(result.ok, false)
    eq(#log.downloads, 0)
end)

test("run removes the manifest books when the library is a genuinely empty list", function()
    local gone = DIR .. "/Beta - 89efcdab.epub"
    local deps = fake({ books = {}, manifest = { [BETA.uuid] = gone }, files = { [gone] = true } })

    eq(sync.run("https://omni.test", deps).removed, 1)
end)

test("run says to try again later when Omnibus answers an unexpected status", function()
    local deps = fake({ library = { 500, nil } })

    eq(sync.run("https://omni.test", deps).message, "Omnibus answered HTTP 500. Try again later.")
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
    download_url = ALPHA.download_url,
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
    local beta = { uuid = BETA.uuid, title = "Beta", format = "epub", last_modified = 5, download_url = BETA.download_url }
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
    local beta = { uuid = BETA.uuid, title = "Beta", format = "epub", last_modified = 5, download_url = BETA.download_url }
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


-- Reading state. `books` is the device's per-book record: each field's agreed value and the
-- time it was set (percent/percent_at, status/status_at), and whether a change to it still
-- waits to be pushed (dirty_percent, dirty_status).
local function entry(fields)
    local e = { percent = 40, percent_at = 100, status = "reading", status_at = 100,
        dirty_percent = false, dirty_status = false }
    for k, v in pairs(fields or {}) do
        e[k] = v
    end
    return e
end

local READING40 = { percent = 40, status = "reading" }

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

test("capture marks only the percent pending when only the percent moved", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.percent, 55)
    eq(e.percent_at, 500)
    eq(e.dirty_percent, true)
    eq(e.status_at, 100)
    eq(e.dirty_status, false)
end)

test("capture marks only the status pending when only the status changed", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 40, status = "complete" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.status, "complete")
    eq(e.status_at, 500)
    eq(e.dirty_status, true)
    eq(e.percent_at, 100)
    eq(e.dirty_percent, false)
end)

test("capture leaves a book whose state matches the agreed one exactly as it was", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, READING40, 500)

    eq(books[ALPHA.uuid].percent_at, 100)
    eq(books[ALPHA.uuid].status_at, 100)
    eq(sync.pending(books[ALPHA.uuid]), false)
end)

test("capture does nothing when the device cannot report a percent", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = nil, status = "complete" }, 500)

    eq(books[ALPHA.uuid].status, "reading")
    eq(sync.pending(books[ALPHA.uuid]), false)
end)

test("capture does nothing for a book that was never baselined", function()
    local books = {}

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)

    eq(books[ALPHA.uuid], nil)
end)

test("capture dates a status the server does not sync but queues nothing for it", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 40, status = "abandoned" }, 500)

    local e = books[ALPHA.uuid]
    eq(e.status, nil)
    eq(e.status_at, 500)
    eq(sync.pending(e), false)
end)

test("capture twice leaves one entry carrying the later change time", function()
    local books = { [ALPHA.uuid] = entry() }

    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)
    sync.capture(books, ALPHA.uuid, { percent = 61, status = "reading" }, 900)

    local count = 0
    for _ in pairs(books) do
        count = count + 1
    end
    eq(count, 1)
    eq(books[ALPHA.uuid].percent, 61)
    eq(books[ALPHA.uuid].percent_at, 900)
end)

-- A flush target that answers each PUT from `answers` in order ({code, answer body, error})
-- and records what it was sent.
local function fake_server(answers)
    local sent, saves = {}, { n = 0 }
    local deps = {
        put_state = function(uuid, body)
            table.insert(sent, { uuid = uuid, body = body })
            local answer = answers[#sent] or { 200 }
            return (table.unpack or unpack)(answer, 1, 3)
        end,
        save = function()
            saves.n = saves.n + 1
        end,
    }
    return deps, sent, saves
end

test("S1: a status that did not change is not pushed with a moved percent", function()
    local books = {}
    sync.settle(books, "u1", { percent = 54, status = "reading" }, { percent_at = 1000, status_at = 1000 })
    sync.capture(books, "u1", { percent = 55, status = "reading" }, 3000)
    local deps, sent = fake_server({})

    sync.flush(books, deps)

    eq(#sent, 1)
    eq(sent[1].body.percent, 55)
    eq(sent[1].body.status, nil)
    eq(sent[1].body.event_at, 3000)
end)

test("S2: a percent that did not change is not pushed with a new status", function()
    local books = {}
    sync.settle(books, "u1", { percent = 40, status = "reading" }, { percent_at = 1000, status_at = 1000 })
    sync.capture(books, "u1", { percent = 40, status = "complete" }, 3000)
    local deps, sent = fake_server({})

    sync.flush(books, deps)

    eq(#sent, 1)
    eq(sent[1].body.percent, nil)
    eq(sent[1].body.status, "complete")
    eq(sent[1].body.event_at, 3000)
end)

test("flush sends a percent and a status changed together in one PUT and clears both", function()
    local books = { [ALPHA.uuid] = entry(), [BETA.uuid] = entry() }
    sync.capture(books, ALPHA.uuid, { percent = 100, status = "complete" }, 500)
    local deps, sent, saves = fake_server({})

    local result = sync.flush(books, deps)

    eq(result.ok, true)
    eq(#sent, 1)
    eq(sent[1].uuid, ALPHA.uuid)
    eq(sent[1].body.percent, 100)
    eq(sent[1].body.status, "complete")
    eq(sent[1].body.event_at, 500)
    eq(sync.pending(books[ALPHA.uuid]), false)
    eq(saves.n, 1)
end)

test("flush sends the two fields separately when they changed at different times", function()
    local books = { [ALPHA.uuid] = entry() }
    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)
    sync.capture(books, ALPHA.uuid, { percent = 55, status = "complete" }, 900)
    local deps, sent = fake_server({})

    sync.flush(books, deps)

    eq(#sent, 2)
    eq(sent[1].body.event_at, 500)
    eq(sent[1].body.percent, 55)
    eq(sent[1].body.status, nil)
    eq(sent[2].body.event_at, 900)
    eq(sent[2].body.status, "complete")
    eq(sent[2].body.percent, nil)
end)

test("P1: a landed write takes the time the server stored, not the device's clock ahead of it", function()
    local books = { [ALPHA.uuid] = entry() }
    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 9000)
    local deps = fake_server({ { 200, { position = { percent = 55, event_at = 4000 } } } })

    sync.flush(books, deps)

    eq(books[ALPHA.uuid].percent_at, 4000)
    local plan = sync.pull_plan(books[ALPHA.uuid], { position = { percent = 70, event_at = 4500 } },
        { percent = 55, status = "reading" })
    eq(plan.percent, 70)
end)

test("a lost write keeps the device's own value and time, so the newer server value is pulled", function()
    local books = { [ALPHA.uuid] = entry() }
    sync.capture(books, ALPHA.uuid, { percent = 55, status = "reading" }, 500)
    local deps = fake_server({ { 409, { position = { percent = 70, event_at = 800 } } } })

    sync.flush(books, deps)

    eq(books[ALPHA.uuid].percent, 55)
    eq(books[ALPHA.uuid].percent_at, 500)
    eq(sync.pending(books[ALPHA.uuid]), false)
    local plan = sync.pull_plan(books[ALPHA.uuid], { position = { percent = 70, event_at = 800 } },
        { percent = 55, status = "reading" })
    eq(plan.percent, 70)
end)

test("flush drops a book the server refuses outright, so it never blocks the queue", function()
    for _, code in ipairs({ 400, 404, 422 }) do
        local books = {
            [ALPHA.uuid] = entry({ dirty_percent = true }),
            [BETA.uuid] = entry({ dirty_percent = true }),
        }
        local deps, sent = fake_server({ { code } })

        local result = sync.flush(books, deps)

        eq(result.ok, true, "HTTP " .. code)
        eq(#sent, 2, "HTTP " .. code)
        eq(books[ALPHA.uuid], nil, "HTTP " .. code)
        eq(sync.pending(books[BETA.uuid]), false, "HTTP " .. code)
    end
end)

test("flush stops on a failure and keeps every remaining entry pending", function()
    local failures = {
        { name = "no response", answer = { nil, nil, "connection refused" }, expect = "connection refused" },
        { name = "a server error", answer = { 503 }, expect = "503" },
        { name = "a 401", answer = { 401 }, expect = sync.REMOVED_MESSAGE },
    }
    for _, case in ipairs(failures) do
        local books = {
            [ALPHA.uuid] = entry({ dirty_percent = true }),
            [BETA.uuid] = entry({ dirty_percent = true }),
        }
        local deps, sent = fake_server({ case.answer })

        local result = sync.flush(books, deps)

        eq(result.ok, false, case.name)
        assert(result.message:find(case.expect, 1, true), case.name .. ": " .. result.message)
        eq(#sent, 1, case.name)
        eq(books[ALPHA.uuid].dirty_percent, true, case.name)
        eq(books[BETA.uuid].dirty_percent, true, case.name)
    end
end)

test("pull_plan moves to a remote position newer than the local entry", function()
    local plan = sync.pull_plan(entry(), { position = { percent = 70, event_at = 300 } }, READING40)

    eq(plan.percent, 70)
    eq(plan.percent_at, 300)
    eq(plan.status, nil)
end)

test("pull_plan ignores a remote position older than the local entry", function()
    local plan = sync.pull_plan(entry({ percent_at = 500 }),
        { position = { percent = 70, event_at = 300 } }, READING40)

    eq(plan, nil)
end)

test("P2: pull_plan adopts a remote position that ties the local time", function()
    local plan = sync.pull_plan(entry({ percent_at = 300 }),
        { position = { percent = 70, event_at = 300 } }, READING40)

    eq(plan.percent, 70)
end)

test("pull_plan returns nothing when the remote value is the one the device holds", function()
    local plan = sync.pull_plan(entry({ percent_at = 300 }),
        { position = { percent = 40, event_at = 300 }, status = { status = "reading", event_at = 900 } },
        READING40)

    eq(plan, nil)
end)

test("pull_plan applies a newer remote complete status", function()
    local plan = sync.pull_plan(entry(),
        { position = { percent = 100, event_at = 300 }, status = { status = "complete", event_at = 350 } },
        READING40)

    eq(plan.status, "complete")
    eq(plan.status_at, 350)
    eq(plan.percent, 100)
    eq(plan.percent_at, 300)
end)

test("E6: settling a status pull leaves the percent clock, so a later web position still applies", function()
    local books = { [ALPHA.uuid] = entry() }
    local plan = sync.pull_plan(books[ALPHA.uuid], { status = { status = "complete", event_at = 350 } }, READING40)
    sync.settle(books, ALPHA.uuid, { percent = 40, status = "complete" }, plan)

    eq(books[ALPHA.uuid].status_at, 350)
    eq(books[ALPHA.uuid].percent_at, 100)
    local later = sync.pull_plan(books[ALPHA.uuid], { position = { percent = 70, event_at = 340 } },
        { percent = 40, status = "complete" })
    eq(later.percent, 70)
end)

test("pull_plan leaves a field that waits to be pushed but still pulls the other", function()
    local plan = sync.pull_plan(entry({ dirty_percent = true }),
        { position = { percent = 70, event_at = 300 }, status = { status = "complete", event_at = 300 } },
        { percent = 55, status = "reading" })

    eq(plan.percent, nil)
    eq(plan.status, "complete")
end)

test("pull_plan treats a missing entry as time zero and compares with the device", function()
    local plan = sync.pull_plan(nil, { position = { percent = 70, event_at = 1 } }, { percent = 5, status = nil })

    eq(plan.percent, 70)
    eq(sync.pull_plan(nil, { position = { percent = 5, event_at = 1 } }, { percent = 5, status = nil }), nil)
end)

test("pull_plan returns nothing when the server holds no state", function()
    eq(sync.pull_plan(entry(), {}, READING40), nil)
end)

test("pull_plan reads a decoded JSON null as no state", function()
    -- KOReader's json decodes null to a function, not nil.
    local null = function() end
    eq(sync.pull_plan(entry(), { position = null, status = null }, READING40), nil)
end)

test("settle advances only the fields that have a clock and clears their pending marks", function()
    local books = { [ALPHA.uuid] = entry({ dirty_percent = true, dirty_status = true }) }

    sync.settle(books, ALPHA.uuid, { percent = 70, status = "complete" }, { percent_at = 300 })

    local e = books[ALPHA.uuid]
    eq(e.percent, 70)
    eq(e.percent_at, 300)
    eq(e.dirty_percent, false)
    eq(e.status, "reading")
    eq(e.status_at, 100)
    eq(e.dirty_status, true)
end)

test("adopt_empty_server queues a first-seen book's own state when the server holds none", function()
    local books = {}
    sync.settle(books, ALPHA.uuid, READING40, { percent_at = 0, status_at = 0 })

    local adopted = sync.adopt_empty_server(books, ALPHA.uuid, READING40, {}, 700)

    eq(adopted, true)
    eq(books[ALPHA.uuid].percent_at, 700)
    eq(books[ALPHA.uuid].dirty_percent, true)
    eq(books[ALPHA.uuid].dirty_status, true)
end)

test("adopt_empty_server leaves the baseline alone when the server holds state", function()
    local books = {}
    sync.settle(books, ALPHA.uuid, READING40, { percent_at = 0, status_at = 0 })

    local adopted = sync.adopt_empty_server(books, ALPHA.uuid, READING40,
        { position = { percent = 70, event_at = 300 } }, 700)

    eq(adopted, false)
    eq(sync.pending(books[ALPHA.uuid]), false)
end)

test("upgrade gives an entry saved with one time and pending flag a clock and mark per field", function()
    local books = {
        [ALPHA.uuid] = { percent = 55, status = "reading", event_at = 500, pending = true },
        [BETA.uuid] = { percent = 40, status = "abandoned", event_at = 100, pending = false },
    }

    sync.upgrade(books)

    local a, b = books[ALPHA.uuid], books[BETA.uuid]
    eq(a.percent_at, 500)
    eq(a.status_at, 500)
    eq(a.dirty_percent, true)
    eq(a.dirty_status, true)
    eq(a.event_at, nil)
    eq(b.status, nil)
    eq(sync.pending(b), false)
end)

os.exit(failures == 0 and 0 or 1)
