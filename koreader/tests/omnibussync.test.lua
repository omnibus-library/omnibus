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

-- A fake device: `files` is the set of paths on disk; every call lands in `log`.
local function fake(opts)
    opts = opts or {}
    local files = opts.files or {}
    local log = { downloads = {}, removed = {}, reports = {}, saves = 0 }
    local deps = {
        dir = DIR,
        open_path = opts.open_path,
        manifest = opts.manifest or {},
        save_manifest = function()
            log.saves = log.saves + 1
        end,
        get_library = function()
            if opts.library then
                return (table.unpack or unpack)(opts.library, 1, 3)
            end
            return 200, { books = opts.books or {} }
        end,
        download = function(book, path)
            table.insert(log.downloads, path)
            local failure = opts.fail_download and opts.fail_download[book.title]
            if failure then
                return false, failure
            end
            files[path] = true
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

os.exit(failures == 0 and 0 or 1)
