--[[--
Omnibus: a "Sync now" menu entry that mirrors the shelves marked "Sync to my devices"
into an Omnibus folder, and keeps each delivered book's reading position and status in
step with the server: pulled when the book opens, pushed when it closes, the device
suspends or Sync now runs. The decisions live in omnibussync.lua; this file is the wiring
to KOReader (menu, HTTP, files, UI). omnibus.json, written by the server's plugin
download, holds the server URL and this device's token.
--]]--

local BookList = require("ui/widget/booklist")
local DataStorage = require("datastorage")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local JSON = require("json")
local LuaSettings = require("luasettings")
local Notification = require("ui/widget/notification")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")
local ffiutil = require("ffi/util")
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
    local path = self.path .. "/omnibus.json"
    if lfs.attributes(path, "mode") ~= "file" then
        return nil
    end
    local ok, config = pcall(JSON.decode, util.readFromFile(path, "rb") or "")
    if ok and type(config) == "table" and type(config.server_url) == "string"
        and type(config.token) == "string" then
        config.server_url = config.server_url:match("^%s*(.-)%s*$"):gsub("/+$", "")
        if config.server_url ~= "" then
            return config
        end
    end
end

local function sync_dir()
    local home = G_reader_settings:readSetting("home_dir") or filemanagerutil.getDefaultDir()
    return (home:gsub("/+$", "")) .. "/" .. FOLDER
end

-- One request with the device token and no redirects, so the token only ever reaches the
-- configured server. `opts.sink` builds the sink after the timeouts are set, because
-- socketutil's sinks read them. Returns the status code, or nil and the error.
local function request(url, token, opts)
    socketutil:set_timeout(opts.block_timeout, opts.total_timeout)
    local ok, code = pcall(function()
        local req = {
            url = url,
            method = opts.method or "GET",
            headers = { Authorization = "Bearer " .. token },
            sink = opts.sink(),
            redirect = false,
        }
        if opts.body then
            req.headers["Content-Type"] = "application/json"
            req.headers["Content-Length"] = #opts.body
            req.source = ltn12.source.string(opts.body)
        end
        return socket.skip(1, http.request(req))
    end)
    socketutil:reset_timeout()
    if ok and type(code) == "number" then
        return code
    end
    return nil, tostring(code)
end

-- One JSON call to the server: the status code and the decoded body (nil when unreadable), or
-- nil, nil and the error. `body` is a table to send as JSON.
local function call_json(config, method, path, body, block_timeout, total_timeout)
    local chunks = {}
    local code, err = request(config.server_url .. path, config.token, {
        method = method,
        body = body and JSON.encode(body),
        sink = function()
            return socketutil.table_sink(chunks)
        end,
        block_timeout = block_timeout,
        total_timeout = total_timeout,
    })
    if not code then
        return nil, nil, err
    end
    local ok, decoded = pcall(JSON.decode, table.concat(chunks))
    return code, ok and decoded or nil
end

function Omnibus:library_getter(config)
    return function()
        return call_json(config, "GET", "/koreader/v1/library", nil,
            socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    end
end

-- Flush the finished part file, then the folder entry the rename creates, so a power cut
-- cannot leave an empty book that the manifest already counts as delivered.
local function publish(part, path)
    local written = io.open(part, "rb")
    if written then
        ffiutil.fsyncOpenedFile(written)
        written:close()
    end
    local renamed, rename_err = os.rename(part, path)
    if renamed then
        ffiutil.fsyncDirectory(path)
    end
    return renamed, rename_err
end

function Omnibus:book_downloader(config)
    return function(book, path)
        local url = sync.book_url(config.server_url, book)
        if not url then
            return false, "unexpected download address. Download the plugin again from Settings › Devices."
        end
        local part = path .. ".part"
        local file, open_err = io.open(part, "wb")
        if not file then
            return false, open_err
        end
        local code, err = request(url, config.token, {
            sink = function()
                return socketutil.file_sink(file)
            end,
            block_timeout = socketutil.FILE_BLOCK_TIMEOUT,
            total_timeout = socketutil.FILE_TOTAL_TIMEOUT,
        })
        -- LuaSocket skips the sink's terminator when a request fails before the body.
        pcall(file.close, file)
        if code ~= 200 then
            os.remove(part)
            return false, code and ("HTTP " .. code) or err
        end
        local renamed, rename_err = publish(part, path)
        if not renamed then
            os.remove(part)
            return false, rename_err
        end
        return true
    end
end

-- Best effort: a report that cannot be delivered is dropped, the device still shows the result.
function Omnibus:reporter(config)
    return function(error_text)
        request(config.server_url .. "/koreader/v1/sync-report", config.token, {
            method = "POST",
            body = JSON.encode({ error = error_text or JSON.util.null }),
            sink = ltn12.sink.null,
            block_timeout = socketutil.LARGE_BLOCK_TIMEOUT,
            total_timeout = socketutil.LARGE_TOTAL_TIMEOUT,
        })
    end
end

-- GET one book's server-side state: the status code and decoded body, or nil, nil and the error.
function Omnibus:state_getter(config)
    return function(uuid)
        return call_json(config, "GET", "/koreader/v1/books/" .. uuid .. "/state", nil,
            STATE_BLOCK_TIMEOUT, STATE_TOTAL_TIMEOUT)
    end
end

-- PUT one book's state: the status code and the state the server now holds, or nil, nil and the error.
function Omnibus:state_putter(config)
    return function(uuid, body)
        return call_json(config, "PUT", "/koreader/v1/books/" .. uuid .. "/state", body,
            STATE_BLOCK_TIMEOUT, STATE_TOTAL_TIMEOUT)
    end
end

-- The per-book reading state (see omnibussync.lua) in its own settings file, loaded at each use
-- because the file manager's and the reader's instances of this plugin both read and write it.
-- Returns the books table and a function that saves it.
local function state_store()
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/omnibus_state.lua")
    local books = settings:readSetting("books", {})
    sync.upgrade(books)
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

-- The open book's whole percent and status as the device holds them.
function Omnibus:current_state()
    local ui = self.ui
    local module = ui.document.info.has_pages and ui.paging or ui.rolling
    local summary = ui.doc_settings:readSetting("summary")
    return { percent = sync.percent(module:getLastPercent()), status = summary and summary.status }
end

-- Mark the open book `status` the way the reader's own "Mark as finished" does.
function Omnibus:set_status(status)
    local summary = self.ui.doc_settings:readSetting("summary", {})
    summary.status = status
    summary.modified = os.date("%Y-%m-%d", os.time())
    BookList.setBookInfoCacheProperty(self.ui.document.file, "status", status)
end

-- Push every pending book in `books`; a failure leaves them pending and is logged (the message
-- never carries the token or the request).
function Omnibus:push_pending(config, books, save)
    local result = sync.flush(books, { put_state = self:state_putter(config), save = save })
    if not result.ok then
        logger.warn("omnibus reading state push failed:", result.message)
    end
    return result
end

-- Open: baseline an unseen book, push what waits, then move to the server's state where it is
-- newer. A first-seen book the server knows nothing about pushes the device's own state instead.
function Omnibus:pull_on_open()
    local config = self:loadConfig()
    local uuid = self:open_book_uuid()
    if not config or not uuid then
        return
    end
    local books, save = state_store()
    local current = self:current_state()
    local first_sight = not books[uuid]
    if first_sight then
        -- Time 0 so any server state outranks a book the device only just met.
        sync.settle(books, uuid, current, { percent_at = 0, status_at = 0 })
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
    if first_sight and sync.adopt_empty_server(books, uuid, current, remote, os.time()) then
        save()
        self:push_pending(config, books, save)
        return
    end
    local plan = sync.pull_plan(books[uuid], remote, current)
    if not plan then
        return
    end
    if plan.percent then
        self.ui:handleEvent(Event:new("GotoPercent", plan.percent))
    end
    if plan.status then
        self:set_status(plan.status)
    end
    -- Read the percent back: the device lands on a page, not on the exact percent asked for.
    sync.settle(books, uuid, self:current_state(), plan)
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

    local progress = InfoMessage:new{ text = _("Syncing with Omnibus…") }
    UIManager:show(progress)
    UIManager:forceRePaint()
    local ran, result = pcall(sync.run, config.server_url, {
        dir = dir,
        open_path = self.ui.document and self.ui.document.file,
        manifest = manifest,
        save_manifest = function()
            settings:saveSetting("manifest", manifest)
            settings:flush()
        end,
        get_library = self:library_getter(config),
        download = self:book_downloader(config),
        remove = remove_file,
        exists = function(path)
            return lfs.attributes(path, "mode") == "file"
        end,
        report = self:reporter(config),
    })
    UIManager:close(progress)
    if not ran then
        result = { ok = false, added = 0, removed = 0, message = tostring(result) }
    end

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
