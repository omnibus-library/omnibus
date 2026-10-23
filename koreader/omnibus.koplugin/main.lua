--[[--
Omnibus: a "Sync now" menu entry that mirrors the shelves marked "Sync to my devices"
into an Omnibus folder, and keeps each delivered book's reading position and status in
step with the server: pulled when the book opens, pushed when it closes, the device
suspends or Sync now runs. A book edited in Omnibus gets its title, authors, series,
description and cover written into KOReader's custom metadata on the next sync. The
decisions live in omnibussync.lua; this file is the wiring
to KOReader (menu, HTTP, files, UI). omnibus.json, written by the server's plugin
download, holds the server URL and this device's token.
--]]--

local BookList = require("ui/widget/booklist")
local DataStorage = require("datastorage")
local DocSettings = require("docsettings")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local JSON = require("json")
local LuaSettings = require("luasettings")
local Notification = require("ui/widget/notification")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")
local filemanagerutil = require("apps/filemanager/filemanagerutil")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")
local http = require("socket.http")
local util = require("util")

local sync = require("omnibussync")

local FOLDER = "Omnibus"
local MISSING_CONFIG = _("Download the plugin from Omnibus Settings › Devices.")
-- Reading state is a few bytes, and a book open or close waits on it: give up sooner than a download.
local STATE_BLOCK_TIMEOUT, STATE_TOTAL_TIMEOUT = 5, 15

local Omnibus = WidgetContainer:extend{
    name = "omnibus",
    is_doc_only = false,
}

function Omnibus:init()
    self.ui.menu:registerToMainMenu(self)
    -- Only a reader has this: the file manager's instance never pulls a position.
    if self.ui.registerPostReaderReadyCallback then
        -- After the book restored its local position, before it is first shown.
        self.ui:registerPostReaderReadyCallback(function()
            self:guarded("pull", self.pull_on_open)
        end)
    end
end

function Omnibus:addToMainMenu(menu_items)
    menu_items.omnibus = {
        text = _("Omnibus"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Sync now"),
                callback = function()
                    NetworkMgr:runWhenOnline(function()
                        self:sync()
                    end)
                end,
            },
        },
    }
end

-- The server URL and token from omnibus.json, or nil when it is missing or unreadable.
function Omnibus:loadConfig()
    local file = io.open(self.path .. "/omnibus.json", "r")
    if not file then
        return nil
    end
    local text = file:read("*a")
    file:close()
    local ok, config = pcall(JSON.decode, text)
    if ok and type(config) == "table" and type(config.server_url) == "string"
        and type(config.token) == "string" then
        config.server_url = config.server_url:gsub("/+$", "")
        return config
    end
end

local function sync_dir()
    local home = G_reader_settings:readSetting("home_dir") or filemanagerutil.getDefaultDir()
    return (home:gsub("/+$", "")) .. "/" .. FOLDER
end

-- GET `url` (PUT it with `put_body`, a JSON string) with the device token and no redirects,
-- so the token only ever reaches the configured server; `extra_headers` are sent as well.
-- Returns the status code and the response headers (names in lower case), or nil and the error.
local function fetch(url, token, sink, block_timeout, total_timeout, put_body, extra_headers)
    local headers = { Authorization = "Bearer " .. token }
    if put_body then
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = #put_body
    end
    for name, value in pairs(extra_headers or {}) do
        headers[name] = value
    end
    socketutil:set_timeout(block_timeout, total_timeout)
    local code, response_headers = socket.skip(1, http.request{
        url = url,
        method = put_body and "PUT" or "GET",
        headers = headers,
        source = put_body and ltn12.source.string(put_body) or nil,
        sink = sink,
        redirect = false,
    })
    socketutil:reset_timeout()
    if type(code) == "number" then
        return code, response_headers
    end
    return nil, tostring(code)
end

function Omnibus:library_getter(config)
    return function()
        local chunks = {}
        local code, err = fetch(config.server_url .. "/koreader/v1/library", config.token,
            ltn12.sink.table(chunks), socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
        if not code then
            return nil, nil, err
        end
        local ok, body = pcall(JSON.decode, table.concat(chunks))
        return code, ok and body or nil
    end
end

-- Download one book to `path` through a `.part` file, so a failed download leaves the book the
-- reader already has. With `if_none_match`, a 304 keeps the file: returns true, nil, true.
-- A new file returns true and its ETag.
function Omnibus:book_downloader(config)
    return function(book, path, if_none_match)
        local url = sync.book_url(config.server_url, book)
        if not url then
            return false, "unexpected download address"
        end
        local part = path .. ".part"
        local file, open_err = io.open(part, "wb")
        if not file then
            return false, open_err
        end
        local code, headers = fetch(url, config.token, ltn12.sink.file(file),
            socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT, nil,
            if_none_match and { ["If-None-Match"] = if_none_match } or nil)
        -- A bodiless answer never reaches the sink, which would have closed the file.
        pcall(file.close, file)
        if code == 304 then
            os.remove(part)
            return true, nil, true
        elseif code ~= 200 then
            os.remove(part)
            return false, code and ("HTTP " .. code) or headers
        end
        local renamed, rename_err = os.rename(part, path)
        if not renamed then
            os.remove(part)
            return false, rename_err
        end
        return true, headers.etag
    end
end

local COVER_EXTENSIONS = { ["image/jpeg"] = "jpg", ["image/png"] = "png", ["image/gif"] = "gif",
    ["image/webp"] = "webp" }
local CUSTOM_PROP_KEYS = { "title", "authors", "series", "series_index", "description" }

-- Write the book's metadata as KOReader's own "custom metadata", the way Book information
-- does: the five fields in the book's metadata file, which the file itself is never edited for.
local function write_custom_props(book, path)
    local props = sync.custom_props(book)
    local custom = DocSettings.openSettingsFile(DocSettings:findCustomMetadataFile(path))
    if not custom:readSetting("doc_props") then
        custom:saveSetting("doc_props", {})
    end
    local custom_props = custom:readSetting("custom_props", {})
    for _, key in ipairs(CUSTOM_PROP_KEYS) do
        custom_props[key] = props[key]
    end
    if not custom:flushCustomMetadata(path) then
        return false, "couldn't write the custom metadata"
    end
    return true
end

local function remove_custom_cover(path)
    local old = DocSettings:findCustomCoverFile(path)
    if old then
        os.remove(old)
    end
end

-- Make the server's cover the book's custom cover; a book with none loses the custom one.
function Omnibus:write_custom_cover(config, book, path)
    local url = sync.cover_url(config.server_url, book)
    if not url then
        return false, "unexpected cover address"
    end
    local chunks = {}
    local code, headers = fetch(url, config.token, ltn12.sink.table(chunks),
        socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    if code == 404 then
        remove_custom_cover(path)
        return true
    elseif code ~= 200 then
        return false, code and ("cover HTTP " .. code) or headers
    end
    local content_type = (headers["content-type"] or ""):match("^[^;]*"):lower()
    local extension = COVER_EXTENSIONS[content_type]
    if not extension then
        return false, "unsupported cover type " .. content_type
    end
    local cache = DataStorage:getDataDir() .. "/cache"
    util.makePath(cache)
    local image = cache .. "/omnibus-cover." .. extension
    local written, write_err = util.writeToFile(table.concat(chunks), image)
    if not written then
        return false, write_err
    end
    remove_custom_cover(path)
    local flushed = DocSettings:flushCustomCover(path, image)
    os.remove(image)
    if not flushed then
        return false, "couldn't write the custom cover"
    end
    return true
end

function Omnibus:metadata_applier(config)
    return function(book, path)
        local ok, reason = write_custom_props(book, path)
        if ok then
            ok, reason = self:write_custom_cover(config, book, path)
        end
        -- The file manager keeps a row per book; make it read the new title and cover.
        UIManager:broadcastEvent(Event:new("InvalidateMetadataCache", path))
        return ok, reason
    end
end

-- Best effort: a report that cannot be delivered is dropped, the device still shows the result.
function Omnibus:reporter(config)
    return function(error_text)
        local body = JSON.encode({ error = error_text or JSON.util.null })
        pcall(function()
            socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
            http.request{
                url = config.server_url .. "/koreader/v1/sync-report",
                method = "POST",
                headers = {
                    Authorization = "Bearer " .. config.token,
                    ["Content-Type"] = "application/json",
                    ["Content-Length"] = #body,
                },
                source = ltn12.source.string(body),
                sink = ltn12.sink.null(),
                redirect = false,
            }
            socketutil:reset_timeout()
        end)
    end
end

-- GET one book's server-side state: the status code and decoded body, or nil and the error.
function Omnibus:state_getter(config)
    return function(uuid)
        local chunks = {}
        local code, err = fetch(config.server_url .. "/koreader/v1/books/" .. uuid .. "/state",
            config.token, ltn12.sink.table(chunks), STATE_BLOCK_TIMEOUT, STATE_TOTAL_TIMEOUT)
        if not code then
            return nil, nil, err
        end
        local ok, body = pcall(JSON.decode, table.concat(chunks))
        return code, ok and body or nil
    end
end

-- PUT one book's state: the status code, or nil and the error.
function Omnibus:state_putter(config)
    return function(uuid, body)
        return fetch(config.server_url .. "/koreader/v1/books/" .. uuid .. "/state", config.token,
            ltn12.sink.null(), STATE_BLOCK_TIMEOUT, STATE_TOTAL_TIMEOUT, JSON.encode(body))
    end
end

-- The per-book reading state (see omnibussync.lua) in its own settings file, loaded at each use
-- because the file manager's and the reader's instances of this plugin both read and write it.
-- Returns the books table and a function that saves it.
local function state_store()
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus_state.lua")
    local books = settings:readSetting("books", {})
    return books, function()
        settings:saveSetting("books", books)
        settings:flush()
    end
end

-- Run `method` and log a failure instead of raising it: reading state must never stop a
-- book from opening or closing.
function Omnibus:guarded(what, method, ...)
    local ok, err = pcall(method, self, ...)
    if not ok then
        logger.warn("omnibus reading state", what, "failed:", err)
    end
end

-- The uuid of the open book if this plugin delivered it; a sideloaded book is never synced.
function Omnibus:open_book_uuid()
    local document = self.ui.document
    if not document then
        return nil
    end
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus.lua")
    return sync.uuid_for_path(settings:readSetting("manifest", {}), document.file)
end

-- The open book's whole percent, status and (reflowable books only) XPointer as the device holds them.
function Omnibus:current_state()
    local ui = self.ui
    local paged = ui.document.info.has_pages
    local module = paged and ui.paging or ui.rolling
    local summary = ui.doc_settings:readSetting("summary")
    return {
        percent = sync.percent(module:getLastPercent()),
        status = summary and summary.status,
        xpointer = not paged and ui.rolling:getLastProgress() or nil,
    }
end

-- Mark the open book `status` the way the reader's own "Mark as finished" does.
function Omnibus:set_status(status)
    local summary = self.ui.doc_settings:readSetting("summary", {})
    summary.status = status
    summary.modified = os.date("%Y-%m-%d", os.time())
    BookList.setBookInfoCacheProperty(self.ui.document.file, "status", status)
end

-- Push every pending book in `books`.
function Omnibus:push_pending(config, books, save)
    return sync.flush(books, { put_state = self:state_putter(config), save = save })
end

-- Open: baseline an unseen book, push what waits, then move to the server's state if it is newer.
function Omnibus:pull_on_open()
    local config = self:loadConfig()
    local uuid = self:open_book_uuid()
    if not config or not uuid then
        return
    end
    local books, save = state_store()
    local current = self:current_state()
    if not books[uuid] then
        -- Event time 0 so any server state outranks a book the device only just met.
        sync.settle(books, uuid, current, 0)
        save()
    end
    if not NetworkMgr:isOnline() then
        return
    end
    self:push_pending(config, books, save)
    local code, remote = self:state_getter(config)(uuid)
    if code ~= 200 or type(remote) ~= "table" then
        return
    end
    local plan = sync.pull_plan(books[uuid], remote, current)
    if not plan then
        return
    end
    if plan.xpointer and self.ui.document:isXPointerInDocument(plan.xpointer) then
        self.ui:handleEvent(Event:new("GotoXPointer", plan.xpointer))
    elseif plan.percent then
        self.ui:handleEvent(Event:new("GotoPercent", plan.percent))
    end
    if plan.status then
        self:set_status(plan.status)
    end
    -- Read the position back: the device lands on a page, not on the exact percent asked for.
    sync.settle(books, uuid, self:current_state(), plan.event_at)
    save()
end

-- Close, suspend or Sync now: record a change to the open book (if a book is open), then push
-- everything pending if there is a connection.
function Omnibus:capture_and_flush()
    local config = self:loadConfig()
    if not config then
        return
    end
    local books, save = state_store()
    local uuid = self:open_book_uuid()
    if uuid then
        sync.capture(books, uuid, self:current_state(), os.time())
        save()
    end
    if NetworkMgr:isOnline() then
        self:push_pending(config, books, save)
    end
end

function Omnibus:onCloseDocument()
    self:guarded("close", self.capture_and_flush)
end

function Omnibus:onSuspend()
    self:guarded("suspend", self.capture_and_flush)
end

local function remove_file(path)
    if lfs.attributes(path, "mode") ~= "file" then
        return true
    end
    return os.remove(path)
end

-- Sync the Omnibus folder with the server and show the outcome; returns the result table.
function Omnibus:sync()
    local config = self:loadConfig()
    if not config then
        UIManager:show(InfoMessage:new{ text = MISSING_CONFIG })
        return { ok = false, added = 0, removed = 0, message = MISSING_CONFIG }
    end
    -- Reading state goes up first. A removed device fails the library fetch below with the
    -- same message, so a failed push needs no handling here.
    self:guarded("push", self.capture_and_flush)
    local dir = sync_dir()
    util.makePath(dir)
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus.lua")
    local manifest = settings:readSetting("manifest", {})
    local files = settings:readSetting("files", {})

    local progress = InfoMessage:new{ text = _("Syncing with Omnibus…") }
    UIManager:show(progress)
    UIManager:forceRePaint()
    local result = sync.run(config.server_url, {
        dir = dir,
        open_path = self.ui.document and self.ui.document.file,
        manifest = manifest,
        files = files,
        -- Files KOReader keys by the file's content cannot be replaced without orphaning them.
        can_replace = G_reader_settings:readSetting("document_metadata_folder", "doc") ~= "hash",
        save_manifest = function()
            settings:saveSetting("manifest", manifest)
            settings:saveSetting("files", files)
            settings:flush()
        end,
        get_library = self:library_getter(config),
        download = self:book_downloader(config),
        apply_metadata = self:metadata_applier(config),
        remove = remove_file,
        exists = function(path)
            return lfs.attributes(path, "mode") == "file"
        end,
        report = self:reporter(config),
    })
    UIManager:close(progress)

    if result.ok then
        Notification:notify(string.format(_("Omnibus synced: %d added, %d removed"),
            result.added, result.removed))
    else
        UIManager:show(InfoMessage:new{ text = result.message })
    end
    logger.info("omnibus sync finished; added", result.added, "removed", result.removed)
    local FileManager = require("apps/filemanager/filemanager")
    if FileManager.instance then
        FileManager.instance:onRefresh()
    end
    return result
end

return Omnibus
