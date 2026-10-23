--[[--
Omnibus E2E: drive one KOReader scenario against a live Omnibus server.

A `late` user patch (prio 2), so it runs in reader.lua after UIManager is up
and before FileManager:showFiles. The lane opens KO_HOME as a directory, so
showFiles runs and the deferred first nextTick finds FileManager.instance.opds.
Each step goes through a KOReader plugin (OPDS, or the Omnibus plugin the runner
downloaded and mounted): the only HTTP this patch makes itself goes through api(), the
REST calls of `delivery` (opt the shelf out) and `roundtrip` (opt it in, stand in for the
web reader with a POST /api/progress, read the result back with GET /api/progress/{uuid}
and GET /api/read-status/{uuid}).

Env (scripts/koreader-e2e.sh sets them on `docker run`):
  KOREADER_E2E_SCENARIO  scenario name: "opds", "delivery" or "roundtrip"
  KOREADER_E2E_RESULTS   writable dir for <scenario>.json and <scenario>.png
  OMNIBUS_URL            server origin; the `opds` scenario appends /opds
  OMNIBUS_USER / OMNIBUS_PASSWORD   Basic credentials of the seeded account
  OMNIBUS_SESSION_TOKEN / OMNIBUS_SHELF_ID   `delivery` and `roundtrip`: a bearer session of
                         that account, and the shelf holding Alpha that they switch off and on

Writes <results>/<scenario>.json exactly once — pass, fail or watchdog —
screenshots to <results>/<scenario>.png on failure, then quits.
--]]--

local Screen = require("device").screen
local UIManager = require("ui/uimanager")
local util = require("util")

local SCENARIO = os.getenv("KOREADER_E2E_SCENARIO") or ""
local RESULTS = os.getenv("KOREADER_E2E_RESULTS") or "/results"
local BASE_URL = os.getenv("OMNIBUS_URL") or ""
local USER = os.getenv("OMNIBUS_USER") or ""
local PASSWORD = os.getenv("OMNIBUS_PASSWORD") or ""
local SESSION_TOKEN = os.getenv("OMNIBUS_SESSION_TOKEN") or ""
local SHELF_ID = os.getenv("OMNIBUS_SHELF_ID") or ""

-- Titles of test_data/epubs/generated/alpha.epub and beta.epub — the two
-- files scripts/koreader-e2e.sh copies into the scratch library.
local FIXTURE_TITLES = { "Alpha", "Beta in the Series" }

local WATCHDOG_SECS = 120

local steps = {}
local done = false
local current_step = nil
local search_url = nil
local download_path = nil

local function record(name, ok, detail)
    table.insert(steps, { name = name, ok = ok, detail = detail })
end

local function finish(screenshot_name)
    if done then
        return
    end
    done = true
    local JSON = require("json")
    local result = { scenario = SCENARIO, steps = steps }
    if screenshot_name then
        result.screenshot = screenshot_name
    end
    util.writeToFile(JSON.encode(result), RESULTS .. "/" .. SCENARIO .. ".json")
    UIManager:quit()
end

local function fail(name, detail)
    if done then
        return
    end
    record(name, false, detail)
    local shot = SCENARIO .. ".png"
    UIManager:forceRePaint()
    Screen:shot(RESULTS .. "/" .. shot)
    finish(shot)
end

local function titles_of(item_table)
    local titles = {}
    for _, item in ipairs(item_table) do
        table.insert(titles, '"' .. (item.title or item.text or "?") .. '"')
    end
    return "[" .. table.concat(titles, ", ") .. "]"
end

local function find_item(item_table, title)
    for _, item in ipairs(item_table) do
        if item.title == title then
            return item
        end
    end
end

-- A REST call as the lane's account (the bearer session the runner passes in). Returns the
-- status code and the decoded JSON body, nil when there is none.
local function api(method, path, body)
    local JSON = require("json")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local http = require("socket.http")
    local text = body and JSON.encode(body)
    local headers = { Authorization = "Bearer " .. SESSION_TOKEN }
    if text then
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = #text
    end
    local chunks = {}
    local code = socket.skip(1, http.request{
        url = BASE_URL .. path,
        method = method,
        headers = headers,
        source = text and ltn12.source.string(text) or nil,
        sink = ltn12.sink.table(chunks),
    })
    local ok, decoded = pcall(JSON.decode, table.concat(chunks))
    return code, ok and decoded or nil
end

-- The `opds` scenario: add the Omnibus catalog with Basic credentials, browse
-- All Books, search, download the EPUB acquisition of "Alpha", open it.
local function opds_scenario()
    local root_url = BASE_URL .. "/opds"
    local browser

    -- updateCatalog swaps item_table in only when the feed loaded with entries.
    local function load(url)
        local before = browser.item_table
        browser:updateCatalog(url)
        return browser.item_table ~= before
    end

    return {
        {
            name = "add_catalog",
            fn = function()
                local FileManager = require("apps/filemanager/filemanager")
                local plugin = FileManager.instance and FileManager.instance.opds
                if not plugin then
                    return false, "FileManager.instance.opds missing"
                end
                plugin:onShowOPDSCatalog()
                browser = plugin.opds_browser
                if not browser then
                    return false, "OPDS browser missing"
                end
                browser:editCatalogFromInput(
                    { "Omnibus", root_url, USER, PASSWORD, false, false }, nil, true)
                for _, server in ipairs(browser.servers) do
                    if server.title == "Omnibus" and server.url == root_url then
                        if server.username == USER and server.password == PASSWORD then
                            return true, "catalog added"
                        end
                        return false, "stored credentials do not match"
                    end
                end
                return false, "server not recorded in browser.servers"
            end,
        },
        {
            name = "browse_all",
            fn = function()
                -- onMenuSelect sets the root credentials this way before
                -- updateCatalog; fetchFeed sends them as Basic auth.
                browser.root_catalog_title = "Omnibus"
                browser.root_catalog_username = USER
                browser.root_catalog_password = PASSWORD
                if not load(root_url) then
                    return false, "feed failed to load or carried no entries: " .. root_url
                end
                -- genItemTableFromCatalog clears search_url on every feed.
                search_url = browser.search_url
                if not search_url then
                    return false, "root feed carried no search template"
                end
                local all = find_item(browser.item_table, "All Books")
                if not all then
                    return false, 'expected "All Books" entry in root feed, got '
                        .. titles_of(browser.item_table)
                end
                if not load(all.url) then
                    return false, "feed failed to load or carried no entries: " .. all.url
                end
                for _, title in ipairs(FIXTURE_TITLES) do
                    if not find_item(browser.item_table, title) then
                        return false, string.format(
                            'expected "%s" in All Books, got %s', title,
                            titles_of(browser.item_table))
                    end
                end
                return true, "both fixture titles in All Books"
            end,
        },
        {
            name = "search",
            fn = function()
                -- searchCatalog substitutes the query into %s the same way.
                local query = FIXTURE_TITLES[1]
                local url = search_url:gsub("%%s", function()
                    return query
                end)
                if not load(url) then
                    return false, "feed failed to load or carried no entries: " .. url
                end
                if not find_item(browser.item_table, query) then
                    return false, string.format(
                        'expected "%s" in search results, got %s', query,
                        titles_of(browser.item_table))
                end
                if find_item(browser.item_table, FIXTURE_TITLES[2]) then
                    return false, string.format(
                        'expected "%s" absent from search results, got %s',
                        FIXTURE_TITLES[2], titles_of(browser.item_table))
                end
                return true, "search hit only the query title"
            end,
        },
        {
            name = "download",
            fn = function()
                local item = find_item(browser.item_table, FIXTURE_TITLES[1])
                local href
                for _, acquisition in ipairs(item.acquisitions or {}) do
                    if acquisition.type and acquisition.type:find("epub", 1, true) then
                        href = acquisition.href
                        break
                    end
                end
                if not href then
                    return false, string.format(
                        'no EPUB acquisition on "%s"', FIXTURE_TITLES[1])
                end
                local lfs = require("libs/libkoreader-lfs")
                local dir = RESULTS .. "/downloads"
                util.makePath(dir)
                G_reader_settings:saveSetting("download_dir", dir)
                local path = browser:getLocalDownloadPath(browser:getFileName(item), "epub", href)
                if not browser:downloadFile(path, href, USER, PASSWORD) then
                    return false, "downloadFile failed for " .. href
                end
                local size = lfs.attributes(path, "size") or 0
                if size <= 0 then
                    return false, "downloaded file is empty: " .. path
                end
                download_path = path
                return true, "downloaded " .. size .. " bytes"
            end,
        },
        {
            name = "open",
            deferred = true,
            fn = function(resume)
                local ReaderUI = require("apps/reader/readerui")
                ReaderUI:showReader(download_path, nil, nil, nil, function(reader_ui)
                    local pages = reader_ui.document and reader_ui.document:getPageCount() or 0
                    local title = reader_ui.doc_props.title
                    if pages > 0 and title == FIXTURE_TITLES[1] then
                        resume(true, title .. ", pages=" .. pages)
                    else
                        resume(false, string.format('expected title "%s", got "%s", pages=%d',
                            FIXTURE_TITLES[1], tostring(title), pages))
                    end
                end)
                return true
            end,
        },
    }
end

-- The `delivery` scenario: the Omnibus plugin syncs the one shelf the runner opted in,
-- then removes its book when the shelf is opted out, leaving the .sdr and a sideload.
local function delivery_scenario()
    local lfs = require("libs/libkoreader-lfs")
    local DocSettings = require("docsettings")
    local plugin
    local omnibus_dir = RESULTS .. "/home/Omnibus"
    local sideload = omnibus_dir .. "/Sideloaded.epub"
    local delivered

    local function names()
        local found = {}
        for name in lfs.dir(omnibus_dir) do
            if name ~= "." and name ~= ".." then
                table.insert(found, name)
            end
        end
        table.sort(found)
        return found
    end

    local function find_name(prefix)
        for _, name in ipairs(names()) do
            if name:sub(1, #prefix) == prefix then
                return name
            end
        end
    end

    return {
        {
            name = "plugin_loaded",
            fn = function()
                local FileManager = require("apps/filemanager/filemanager")
                plugin = FileManager.instance and FileManager.instance.omnibus
                if not plugin then
                    return false, "FileManager.instance.omnibus missing"
                end
                local config = plugin:loadConfig()
                if not config or config.server_url ~= BASE_URL then
                    return false, "plugin config does not name " .. BASE_URL
                end
                util.makePath(omnibus_dir)
                G_reader_settings:saveSetting("home_dir", RESULTS .. "/home")
                util.writeToFile("sideloaded", sideload)
                return true, "configured for " .. config.server_url
            end,
        },
        {
            name = "sync_delivers",
            fn = function()
                local result = plugin:sync()
                if not result.ok or result.added ~= 1 then
                    return false, string.format("sync: ok=%s added=%s %s",
                        tostring(result.ok), tostring(result.added), tostring(result.message))
                end
                local alpha = find_name("Alpha - ")
                if not alpha or not alpha:find("%.epub$") then
                    return false, "no Alpha epub delivered, got " .. table.concat(names(), ", ")
                end
                if find_name("Beta in the Series - ") then
                    return false, "Beta was delivered from an unsynced shelf"
                end
                delivered = omnibus_dir .. "/" .. alpha
                -- A reader's progress sidecar: it must outlive the book.
                local sidecar = DocSettings:open(delivered)
                sidecar:saveSetting("omnibus_lane", true)
                sidecar:flush()
                if lfs.attributes(DocSettings:getSidecarDir(delivered), "mode") ~= "directory" then
                    return false, "sidecar was not written for " .. delivered
                end
                return true, "delivered " .. alpha
            end,
        },
        {
            name = "unopt",
            fn = function()
                local code = api("PATCH", "/api/shelves/" .. SHELF_ID, { sync_to_kobo = false })
                if code ~= 200 then
                    return false, "opting the shelf out answered " .. tostring(code)
                end
                return true, "shelf opted out"
            end,
        },
        {
            name = "sync_removes",
            fn = function()
                local result = plugin:sync()
                if not result.ok or result.removed ~= 1 then
                    return false, string.format("sync: ok=%s removed=%s %s",
                        tostring(result.ok), tostring(result.removed), tostring(result.message))
                end
                if lfs.attributes(delivered, "mode") then
                    return false, "delivered book still present: " .. delivered
                end
                if lfs.attributes(DocSettings:getSidecarDir(delivered), "mode") ~= "directory" then
                    return false, "sidecar was deleted with the book"
                end
                if lfs.attributes(sideload, "mode") ~= "file" then
                    return false, "sideloaded file was deleted"
                end
                return true, "book removed; sidecar and sideload kept"
            end,
        },
    }
end

-- The `roundtrip` scenario: the web reader's position reaches the book when it opens, and the
-- device's own reading reaches the web when the device suspends, when the book closes, and, for
-- a change made offline, with the next Sync now.
local function roundtrip_scenario()
    local Event = require("ui/event")
    local ReaderUI = require("apps/reader/readerui")
    local uuid, path

    -- The open book's whole percent, as the reader's own plugin instance reports it.
    local function device_percent()
        return ReaderUI.instance.omnibus:current_state().percent
    end

    -- The epub position and the read status the server holds for the book.
    local function web_state()
        local code, progress = api("GET", "/api/progress/" .. uuid)
        if code ~= 200 or type(progress) ~= "table" then
            return nil, "GET /api/progress answered " .. tostring(code)
        end
        local percent
        for _, record in ipairs(progress.records or {}) do
            if record.format == "epub" then
                percent = record.progress_percent
            end
        end
        local status_code, status = api("GET", "/api/read-status/" .. uuid)
        if status_code ~= 200 or type(status) ~= "table" then
            return nil, "GET /api/read-status answered " .. tostring(status_code)
        end
        return { percent = percent, status = status.status }
    end

    -- Pass when the web holds `percent` and `reading` for the book.
    local function web_holds(percent)
        local state, err = web_state()
        if not state then
            return false, err
        end
        if state.percent ~= percent or state.status ~= "reading" then
            return false, string.format("expected %d%% reading on the web, got %s%% %s",
                percent, tostring(state.percent), tostring(state.status))
        end
        return true, string.format("web shows %d%% reading", percent)
    end

    -- Whether the plugin's state store still holds a change it has not pushed.
    local function store_pending()
        local DataStorage = require("datastorage")
        local LuaSettings = require("luasettings")
        local books = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus_state.lua")
            :readSetting("books", {})
        return books[uuid] ~= nil and require("omnibussync").pending(books[uuid])
    end

    -- Read to `percent` in the open book and return the percent the device landed on.
    local function read_to(percent)
        ReaderUI.instance:handleEvent(Event:new("GotoPercent", percent))
        return device_percent()
    end

    local function open_book(resume, expect)
        ReaderUI:showReader(path, nil, nil, nil, function(reader_ui)
            local pages = reader_ui.document:getPageCount()
            local percent = reader_ui.omnibus:current_state().percent
            -- Within half a page of the expected percent is the page the position lands on;
            -- with fewer than four pages every page is close and the check proves nothing.
            if pages >= 4 and math.abs(percent - expect) <= 50 / pages + 1 then
                resume(true, string.format("opened at %d%% of %d pages", percent, pages))
            else
                resume(false, string.format(
                    "expected about %d%% of at least 4 pages, opened at %d%% of %d pages",
                    expect, percent, pages))
            end
        end)
        return true
    end

    local suspended, closed

    return {
        {
            name = "opt_in",
            fn = function()
                -- `delivery` switched the shelf off; each scenario starts on a fresh device.
                local code = api("PATCH", "/api/shelves/" .. SHELF_ID, { sync_to_kobo = true })
                if code ~= 200 then
                    return false, "opting the shelf in answered " .. tostring(code)
                end
                return true, "shelf opted in"
            end,
        },
        {
            name = "deliver",
            fn = function()
                local DataStorage = require("datastorage")
                local LuaSettings = require("luasettings")
                local FileManager = require("apps/filemanager/filemanager")
                local plugin = FileManager.instance and FileManager.instance.omnibus
                if not plugin then
                    return false, "FileManager.instance.omnibus missing"
                end
                local home = RESULTS .. "/roundtrip/home"
                util.makePath(home)
                G_reader_settings:saveSetting("home_dir", home)
                local result = plugin:sync()
                if not result.ok or result.added ~= 1 then
                    return false, string.format("sync: ok=%s added=%s %s",
                        tostring(result.ok), tostring(result.added), tostring(result.message))
                end
                local manifest = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus.lua")
                    :readSetting("manifest", {})
                for book_uuid, book_path in pairs(manifest) do
                    if book_path:find("/Alpha - ", 1, true) then
                        uuid, path = book_uuid, book_path
                    end
                end
                if not uuid then
                    return false, "Alpha missing from the plugin's manifest"
                end
                -- Alpha is two lines, one page; a huge font spreads it over several, so a
                -- position is a place in the book and not always "the only page".
                local sidecar = require("docsettings"):open(path)
                sidecar:saveSetting("copt_font_size", 200)
                sidecar:flush()
                return true, "delivered " .. path
            end,
        },
        {
            name = "web_position",
            fn = function()
                local code = api("POST", "/api/progress",
                    { book_uuid = uuid, format = "epub", progress_percent = 40 })
                if code ~= 200 then
                    return false, "saving the web position answered " .. tostring(code)
                end
                return true, "web position 40"
            end,
        },
        {
            name = "open_lands_on_web_position",
            deferred = true,
            fn = function(resume)
                return open_book(resume, 40)
            end,
        },
        {
            name = "suspend_pushes",
            fn = function()
                suspended = read_to(80)
                if suspended <= 40 then
                    return false, "the device did not move past the web position: " .. suspended .. "%"
                end
                ReaderUI.instance.omnibus:onSuspend()
                return web_holds(suspended)
            end,
        },
        {
            name = "close_pushes",
            fn = function()
                closed = read_to(100)
                if closed <= suspended then
                    return false, "the device did not read past " .. suspended .. "%: " .. closed .. "%"
                end
                ReaderUI.instance:onClose()
                if store_pending() then
                    return false, "the plugin still holds an unpushed change after the close"
                end
                return web_holds(closed)
            end,
        },
        {
            name = "reopen",
            deferred = true,
            fn = function(resume)
                return open_book(resume, closed)
            end,
        },
        {
            name = "close_offline",
            fn = function()
                local NetworkMgr = require("ui/network/manager")
                local online = NetworkMgr.isOnline
                NetworkMgr.isOnline = function()
                    return false
                end
                local ok, err = pcall(function()
                    read_to(20)
                    ReaderUI.instance:onClose()
                end)
                NetworkMgr.isOnline = online
                if not ok then
                    return false, "error: " .. tostring(err)
                end
                if not store_pending() then
                    return false, "the offline change was not queued on the device"
                end
                local state = web_state()
                if not state or state.percent ~= closed then
                    return false, "the web moved while the device was offline"
                end
                return true, "queued 20% on the device; the web still shows " .. closed .. "%"
            end,
        },
        {
            name = "sync_now_flushes",
            fn = function()
                -- A fresh file manager: its plugin instance has no book open, so only the
                -- queue the reader's instance left can move the web.
                local FileManager = require("apps/filemanager/filemanager")
                FileManager:showFiles(RESULTS .. "/roundtrip/home")
                local result = FileManager.instance.omnibus:sync()
                if not result.ok then
                    return false, "sync: " .. tostring(result.message)
                end
                if store_pending() then
                    return false, "the queue was not flushed by Sync now"
                end
                return web_holds(20)
            end,
        },
    }
end

-- Every scenario the lane can run, by KOREADER_E2E_SCENARIO. A new scenario
-- is an entry here plus an entry in the runner's `scenarios` list.
local SCENARIOS = {
    opds = opds_scenario,
    delivery = delivery_scenario,
    roundtrip = roundtrip_scenario,
}

local function run_at(scenario_steps, i)
    if done then
        return
    end
    local spec = scenario_steps[i]
    if not spec then
        finish(nil)
        return
    end
    current_step = spec.name
    local function resume(ok, detail)
        if done then
            return
        end
        if not ok then
            fail(spec.name, detail or "step failed")
            return
        end
        record(spec.name, true, detail)
        UIManager:nextTick(function()
            run_at(scenario_steps, i + 1)
        end)
    end
    local call_ok, step_ok, detail = pcall(spec.fn, resume)
    if not call_ok then
        fail(spec.name, "error: " .. tostring(step_ok))
        return
    end
    -- A deferred step returns once it has started and calls resume when it is over.
    if spec.deferred and step_ok then
        return
    end
    resume(step_ok, detail)
end

UIManager:nextTick(function()
    local build = SCENARIOS[SCENARIO]
    if not build then
        fail("scenario", "unknown KOREADER_E2E_SCENARIO '" .. SCENARIO .. "'")
        return
    end
    local scenario_steps = build()
    UIManager:scheduleIn(WATCHDOG_SECS, function()
        fail("timeout", "timed out in " .. (current_step or "startup"))
    end)
    run_at(scenario_steps, 1)
end)
