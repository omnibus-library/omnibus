--[[--
Omnibus E2E: drive one KOReader scenario against a live Omnibus server.

A `late` user patch (prio 2), so it runs in reader.lua after UIManager is up
and before FileManager:showFiles. The lane opens KO_HOME as a directory, so
showFiles runs and the deferred first nextTick finds FileManager.instance.opds.
Each step goes through a KOReader plugin (OPDS, or the Omnibus plugin the runner
downloaded and mounted): the only HTTP this patch makes itself goes through api(), the
REST calls of `delivery` (opt the shelf out), `roundtrip` (opt it in, stand in for the
web reader with a POST /api/progress, read the result back with GET /api/progress/{uuid}
and GET /api/read-status/{uuid}) and `metadata` (opt it in, stand in for the web editor
with POST /api/ebooks/{uuid}/overrides and POST /api/ebooks/{uuid}/cover, read the cover
back with GET /api/covers/{uuid}) and `precise` (put two more books on the shelf, stand in for
the web reader with a POST /api/progress, read the result back with GET /api/progress/{uuid}).

Env (scripts/koreader-e2e.sh sets them on `docker run`):
  KOREADER_E2E_SCENARIO  scenario name: "opds", "delivery", "roundtrip", "metadata" or "precise"
  KOREADER_E2E_RESULTS   writable dir for <scenario>.json and <scenario>.png
  OMNIBUS_URL            server origin; the `opds` scenario appends /opds
  OMNIBUS_USER / OMNIBUS_PASSWORD   Basic credentials of the seeded account
  OMNIBUS_SESSION_TOKEN / OMNIBUS_SHELF_ID   `delivery`, `roundtrip` and `metadata`: a bearer
                         session of that account, and the shelf holding Alpha that they switch off and on
  OMNIBUS_LAGOON_UUID / OMNIBUS_RELAY_UUID   `precise`: the uuids of Lagoon of Ligatures and
                         Frontmatter Relay, which it adds to that shelf

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
local LAGOON_UUID = os.getenv("OMNIBUS_LAGOON_UUID") or ""
local RELAY_UUID = os.getenv("OMNIBUS_RELAY_UUID") or ""

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

-- A REST call as the lane's account (the bearer session the runner passes in). `body` is a
-- table sent as JSON, or with a `content_type` the string to send as it is. Returns the status
-- code, the decoded JSON body (nil when there is none) and the raw body.
local function api(method, path, body, content_type)
    local JSON = require("json")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local http = require("socket.http")
    local text = body
    if body and not content_type then
        text = JSON.encode(body)
    end
    local headers = { Authorization = "Bearer " .. SESSION_TOKEN }
    if text then
        headers["Content-Type"] = content_type or "application/json"
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
    local raw = table.concat(chunks)
    local ok, decoded = pcall(JSON.decode, raw)
    return code, ok and decoded or nil, raw
end

-- The Omnibus plugin instance of the file manager now showing; closing a book builds a new one.
local function omnibus_plugin()
    local FileManager = require("apps/filemanager/filemanager")
    return FileManager.instance and FileManager.instance.omnibus
end

-- The uuid and path of the book titled `title` as the plugin's manifest records its delivery;
-- nil without one.
local function delivered_book(title)
    local DataStorage = require("datastorage")
    local LuaSettings = require("luasettings")
    local manifest = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus.lua")
        :readSetting("manifest", {})
    for book_uuid, book_path in pairs(manifest) do
        if book_path:find("/" .. title .. " - ", 1, true) then
            return book_uuid, book_path
        end
    end
end

local function delivered_alpha()
    return delivered_book("Alpha")
end

-- The epub record the server holds for a book (an empty table when it has none), or nil and
-- the error.
local function web_epub_record(uuid)
    local code, progress = api("GET", "/api/progress/" .. uuid)
    if code ~= 200 or type(progress) ~= "table" then
        return nil, "GET /api/progress answered " .. tostring(code)
    end
    for _, record in ipairs(progress.records or {}) do
        if record.format == "epub" then
            return record
        end
    end
    return {}
end

-- The step that opts the shelf in: `delivery` switched it off, and each scenario starts on a
-- fresh device.
local function opt_in_step()
    return {
        name = "opt_in",
        fn = function()
            local code = api("PATCH", "/api/shelves/" .. SHELF_ID, { sync_to_kobo = true })
            if code ~= 200 then
                return false, "opting the shelf in answered " .. tostring(code)
            end
            return true, "shelf opted in"
        end,
    }
end

-- The step that syncs the shelf into <results>/<scenario>/home (`added` books, one unless the
-- scenario put more on it) and gives Alpha a huge font: the two-line book becomes several
-- pages, so a place in it is not always "the only page". `delivered(uuid, path)` hands the
-- scenario what the plugin recorded for Alpha.
local function deliver_step(scenario, delivered, added)
    return {
        name = "deliver",
        fn = function()
            local plugin = omnibus_plugin()
            if not plugin then
                return false, "FileManager.instance.omnibus missing"
            end
            local home = RESULTS .. "/" .. scenario .. "/home"
            util.makePath(home)
            G_reader_settings:saveSetting("home_dir", home)
            local result = plugin:sync()
            if not result.ok or result.added ~= (added or 1) then
                return false, string.format("sync: ok=%s added=%s %s",
                    tostring(result.ok), tostring(result.added), tostring(result.message))
            end
            local uuid, path = delivered_alpha()
            if not uuid then
                return false, "Alpha missing from the plugin's manifest"
            end
            local sidecar = require("docsettings"):open(path)
            sidecar:saveSetting("copt_font_size", 200)
            sidecar:flush()
            delivered(uuid, path)
            return true, "delivered " .. path
        end,
    }
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
        local record, err = web_epub_record(uuid)
        if not record then
            return nil, err
        end
        local percent = record.progress_percent
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
        opt_in_step(),
        deliver_step("roundtrip", function(book_uuid, book_path)
            uuid, path = book_uuid, book_path
        end),
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

-- The `metadata` scenario: an edit made on the web (title and cover) reaches the delivered
-- book on the next sync, in KOReader's custom metadata and in a replaced file, and the
-- reader's place and highlights survive the replacement.
local function metadata_scenario()
    local Blitbuffer = require("ffi/blitbuffer")
    local DocSettings = require("docsettings")
    local DocumentRegistry = require("document/documentregistry")
    local Event = require("ui/event")
    local FileManagerBookInfo = require("apps/filemanager/filemanagerbookinfo")
    local ReaderUI = require("apps/reader/readerui")
    local lfs = require("libs/libkoreader-lfs")
    local EDITED_TITLE = "Alpha Revised"
    local uuid, path, xp, expected_cover, inode

    -- A 60x90 picture written as a PNG: the cover the web editor "uploads". A different
    -- `shade` is a different cover.
    local function cover_png(shade)
        local file_path = RESULTS .. "/metadata/cover.png"
        local bb = Blitbuffer.new(60, 90, Blitbuffer.TYPE_BBRGB32)
        bb:fill(shade)
        bb:paintRect(10, 10, 40, 70, Blitbuffer.COLOR_WHITE)
        bb:writePNG(file_path)
        bb:free()
        return util.readFromFile(file_path, "rb")
    end

    -- Upload `png` as the book's cover and return the bytes the server now serves for it.
    local function upload_cover(png)
        local boundary = "----omnibus-lane-cover"
        local form = table.concat({
            "--" .. boundary,
            'Content-Disposition: form-data; name="cover"; filename="cover.png"',
            "Content-Type: image/png",
            "",
            png,
            "--" .. boundary .. "--",
            "",
        }, "\r\n")
        local code = api("POST", "/api/ebooks/" .. uuid .. "/cover", form,
            "multipart/form-data; boundary=" .. boundary)
        if code ~= 200 then
            return nil, "uploading the cover answered " .. tostring(code)
        end
        local cover_code, _, bytes = api("GET", "/api/covers/" .. uuid)
        if cover_code ~= 200 or #bytes == 0 then
            return nil, "reading the cover back answered " .. tostring(cover_code)
        end
        return bytes
    end

    -- The properties of the file itself that "Reset custom" would restore.
    local function own_props(book_path)
        local custom = DocSettings.openSettingsFile(DocSettings:findCustomMetadataFile(book_path))
        return custom:readSetting("doc_props") or {}
    end

    local function sync_alpha()
        local plugin = omnibus_plugin()
        if not plugin then
            return nil, "FileManager.instance.omnibus missing"
        end
        local result = plugin:sync()
        if not result.ok then
            return nil, "sync failed: " .. tostring(result.message)
        end
        return result
    end

    return {
        opt_in_step(),
        deliver_step("metadata", function(book_uuid, book_path)
            uuid, path = book_uuid, book_path
        end),
        {
            name = "custom_metadata_written",
            fn = function()
                local props = FileManagerBookInfo.extendProps({}, path)
                if props.title ~= "Alpha" then
                    return false, 'expected the custom title "Alpha", got ' .. tostring(props.title)
                end
                local own = own_props(path)
                if own.title ~= "Alpha" then
                    return false, 'expected the file\'s own title "Alpha" kept for Reset custom, got '
                        .. tostring(own.title)
                end
                return true, "custom title written over a copy of the file's own"
            end,
        },
        {
            name = "read",
            deferred = true,
            fn = function(resume)
                ReaderUI:showReader(path, nil, nil, nil, function(reader_ui)
                    reader_ui:handleEvent(Event:new("GotoPercent", 50))
                    resume(true, "opened at the middle")
                end)
                return true
            end,
        },
        {
            name = "read_saves_place",
            fn = function()
                -- Home, as a reader leaves a book: it also brings the file manager back.
                ReaderUI.instance:onHome()
                local sidecar = DocSettings:open(path)
                xp = sidecar:readSetting("last_xpointer")
                if not xp then
                    return false, "closing the book saved no last_xpointer"
                end
                sidecar:saveSetting("annotations", { {
                    text = "lane highlight", page = xp, pos0 = xp, pos1 = xp,
                    drawer = "lighten", datetime = os.date("%Y-%m-%d %H:%M:%S"),
                } })
                sidecar:flush()
                return true, "place " .. xp .. " and one highlight saved"
            end,
        },
        {
            name = "edit",
            fn = function()
                local creator = function(name)
                    return { name = name }
                end
                local code = api("POST", "/api/ebooks/" .. uuid .. "/overrides", {
                    title = EDITED_TITLE,
                    creators = { creator("Ada Lovelace"), creator("Bo Peep") },
                    series = "The Greek Letters",
                    series_index = "2",
                    description = "An edited blurb",
                })
                if code ~= 200 then
                    return false, "saving the metadata answered " .. tostring(code)
                end
                local bytes, err = upload_cover(cover_png(Blitbuffer.COLOR_DARK_GRAY))
                if not bytes then
                    return false, err
                end
                expected_cover = bytes
                return true, "edited the metadata and the cover, cover " .. #bytes .. " bytes"
            end,
        },
        {
            name = "sync_refreshes",
            fn = function()
                local result, err = sync_alpha()
                if not result then
                    return false, err
                end
                if result.refreshed ~= 1 or result.replaced ~= 1 or result.added ~= 0 then
                    return false, string.format("expected 1 refreshed and 1 replaced, got %s and %s (added %s)",
                        tostring(result.refreshed), tostring(result.replaced), tostring(result.added))
                end
                local _, now_path = delivered_alpha()
                if now_path ~= path then
                    return false, "the file moved from " .. path .. " to " .. tostring(now_path)
                end
                local props = FileManagerBookInfo.extendProps({}, path)
                local shown = {
                    title = EDITED_TITLE, authors = "Ada Lovelace\nBo Peep",
                    series = "The Greek Letters", series_index = 2,
                }
                for key, expected in pairs(shown) do
                    if props[key] ~= expected then
                        return false, string.format("%s: expected %s, got %s", key, tostring(expected), tostring(props[key]))
                    end
                end
                if not tostring(props.description):find("An edited blurb", 1, true) then
                    return false, "description: got " .. tostring(props.description)
                end
                local cover = DocSettings:findCustomCoverFile(path)
                if not cover or util.readFromFile(cover, "rb") ~= expected_cover then
                    return false, "the custom cover is not the uploaded one: " .. tostring(cover)
                end
                local document = DocumentRegistry:openDocument(path)
                local own_title
                if document then
                    if not document.loadDocument or document:loadDocument(false) then
                        own_title = document:getProps().title
                    end
                    document:close()
                end
                if own_title ~= EDITED_TITLE then
                    return false, 'the re-downloaded file reads "' .. tostring(own_title) .. '"'
                end
                local reset_title = own_props(path).title
                if reset_title ~= EDITED_TITLE then
                    return false, 'Reset custom would show "' .. tostring(reset_title) .. '"'
                end
                return true, "custom fields, cover and the file itself show the edit"
            end,
        },
        {
            name = "reopen_keeps_place",
            deferred = true,
            fn = function(resume)
                ReaderUI:showReader(path, nil, nil, nil, function(reader_ui)
                    local kept_xp = reader_ui.doc_settings:readSetting("last_xpointer")
                    local highlighted = false
                    for _, annotation in ipairs(reader_ui.annotation.annotations) do
                        highlighted = highlighted or annotation.text == "lane highlight"
                    end
                    local title = reader_ui.doc_props.display_title
                    if kept_xp ~= xp then
                        resume(false, string.format("place moved from %s to %s", xp, tostring(kept_xp)))
                    elseif not highlighted then
                        resume(false, "the lane highlight is gone")
                    elseif title ~= EDITED_TITLE then
                        resume(false, 'the book shows "' .. tostring(title) .. '"')
                    else
                        resume(true, "same place, highlight kept, titled " .. title)
                    end
                end)
                return true
            end,
        },
        {
            name = "close_reopened",
            fn = function()
                ReaderUI.instance:onHome()
                return true, "closed the book"
            end,
        },
        {
            name = "unchanged",
            fn = function()
                inode = lfs.attributes(path, "ino")
                local result, err = sync_alpha()
                if not result then
                    return false, err
                end
                if result.added + result.refreshed + result.replaced ~= 0 then
                    return false, string.format("expected nothing to do, got %d added, %d refreshed, %d replaced",
                        result.added, result.refreshed, result.replaced)
                end
                if lfs.attributes(path, "ino") ~= inode then
                    return false, "the file was replaced although nothing changed"
                end
                return true, "second sync changed nothing"
            end,
        },
        {
            name = "recover",
            deferred = true,
            fn = function(resume)
                -- A book's version is the second of its last edit: let one pass after the first.
                UIManager:scheduleIn(1.1, function()
                    local bytes, err = upload_cover(cover_png(Blitbuffer.COLOR_BLACK))
                    if not bytes then
                        resume(false, err)
                    elseif bytes == expected_cover then
                        resume(false, "the second cover is the same as the first")
                    else
                        expected_cover = bytes
                        resume(true, "replaced the cover only")
                    end
                end)
                return true
            end,
        },
        {
            name = "sync_cover_only",
            fn = function()
                local result, err = sync_alpha()
                if not result then
                    return false, err
                end
                -- Not `replaced`: an EPUB is re-baked on any edit, so the server's file (and
                -- its ETag) is new even when only the cover moved. The 304 for a book that is
                -- never baked is covered by the server's CBZ test and the plugin's unit tests.
                if result.refreshed ~= 1 then
                    return false, "expected 1 refreshed, got " .. tostring(result.refreshed)
                end
                local cover = DocSettings:findCustomCoverFile(path)
                if not cover or util.readFromFile(cover, "rb") ~= expected_cover then
                    return false, "the custom cover is not the new one: " .. tostring(cover)
                end
                return true, "new cover shown"
            end,
        },
    }
end

-- The `precise` scenario: a position inside a paragraph travels both ways, so the book and the
-- web reader open on the same sentence and not just the same percent.
local function precise_scenario()
    local Event = require("ui/event")
    local ReaderUI = require("apps/reader/readerui")
    -- Paragraph 23 of Lagoon ("... fixture. The expedition charted ...") at the "e" of
    -- "expedition", and the CFI the web reader holds for the same character.
    local LAGOON_XPOINTER = "/body/DocFragment/body/p[23]/text().43"
    local LAGOON_WORD_END = "/body/DocFragment/body/p[23]/text().53"
    local LAGOON_CFI = "epubcfi(/6/2!/4/48/1:43)"
    -- The "t" of "test" in the last chapter of Relay's six-item spine, and its CFI.
    local RELAY_XPOINTER = "/body/DocFragment[6]/body/p/text().10"
    local RELAY_WORD_END = "/body/DocFragment[6]/body/p/text().14"
    local RELAY_CFI = "epubcfi(/6/12!/4/4/1:10)"
    local lagoon_path, relay_path

    return {
        {
            name = "add_books",
            fn = function()
                local code = api("POST", "/api/shelves/" .. SHELF_ID .. "/books",
                    { book_uuids = { LAGOON_UUID, RELAY_UUID } })
                if code ~= 204 then
                    return false, "adding the books to the shelf answered " .. tostring(code)
                end
                return true, "shelf holds Lagoon and Relay"
            end,
        },
        opt_in_step(),
        deliver_step("precise", function()
            local lagoon_uuid, relay_uuid
            lagoon_uuid, lagoon_path = delivered_book("Lagoon of Ligatures")
            relay_uuid, relay_path = delivered_book("Frontmatter Relay")
            if lagoon_uuid ~= LAGOON_UUID or relay_uuid ~= RELAY_UUID then
                error("the manifest does not hold both books: "
                    .. tostring(lagoon_uuid) .. ", " .. tostring(relay_uuid))
            end
        end, 3),
        {
            name = "koreader_mid_paragraph",
            deferred = true,
            fn = function(resume)
                ReaderUI:showReader(lagoon_path, nil, nil, nil, function(reader_ui)
                    reader_ui:handleEvent(Event:new("GotoXPointer", LAGOON_XPOINTER))
                    local at = reader_ui.rolling:getLastProgress()
                    local word = reader_ui.document:getTextFromXPointers(LAGOON_XPOINTER, LAGOON_WORD_END)
                    if at ~= LAGOON_XPOINTER then
                        resume(false, "expected the device at " .. LAGOON_XPOINTER .. ", got " .. tostring(at))
                    elseif word ~= "expedition" then
                        resume(false, 'expected the word "expedition" there, got "' .. tostring(word) .. '"')
                    else
                        resume(true, 'the device is at the start of "expedition"')
                    end
                end)
                return true
            end,
        },
        {
            name = "close_pushes",
            fn = function()
                ReaderUI.instance:onHome()
                return true, "closed the book"
            end,
        },
        {
            name = "web_on_same_paragraph",
            fn = function()
                local record, err = web_epub_record(LAGOON_UUID)
                if not record then
                    return false, err
                end
                if record.epub_cfi ~= LAGOON_CFI then
                    return false, string.format("expected %s on the web, got %s",
                        LAGOON_CFI, tostring(record.epub_cfi))
                end
                return true, "the web holds " .. record.epub_cfi
            end,
        },
        {
            name = "web_mid_paragraph",
            fn = function()
                -- The web reader posts its percent beside the CFI; the device reads the percent.
                local code = api("POST", "/api/progress", {
                    book_uuid = RELAY_UUID, format = "epub", epub_cfi = RELAY_CFI, progress_percent = 90,
                })
                if code ~= 200 then
                    return false, "saving the web position answered " .. tostring(code)
                end
                return true, "web position " .. RELAY_CFI
            end,
        },
        {
            name = "koreader_on_same_paragraph",
            deferred = true,
            fn = function(resume)
                ReaderUI:showReader(relay_path, nil, nil, nil, function(reader_ui)
                    local at = reader_ui.rolling:getLastProgress()
                    local document = reader_ui.document
                    local word = document:getTextFromXPointers(RELAY_XPOINTER, RELAY_WORD_END)
                    if at ~= RELAY_XPOINTER then
                        resume(false, "expected the device at " .. RELAY_XPOINTER .. ", got " .. tostring(at))
                    elseif document:getPageFromXPointer(at) ~= document:getCurrentPage() then
                        resume(false, string.format("page %s is not the one shown, %s",
                            tostring(document:getPageFromXPointer(at)), tostring(document:getCurrentPage())))
                    elseif word ~= "test" then
                        resume(false, 'expected the word "test" there, got "' .. tostring(word) .. '"')
                    else
                        resume(true, 'opened at the start of "test"')
                    end
                end)
                return true
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
    metadata = metadata_scenario,
    precise = precise_scenario,
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
