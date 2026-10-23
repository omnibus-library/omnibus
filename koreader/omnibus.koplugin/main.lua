--[[--
Omnibus: a "Sync now" menu entry that mirrors the shelves marked "Sync to my devices"
into an Omnibus folder. The decisions live in omnibussync.lua; this file is the wiring
to KOReader (menu, HTTP, files, UI). omnibus.json, written by the server's plugin
download, holds the server URL and this device's token.
--]]--

local DataStorage = require("datastorage")
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

local Omnibus = WidgetContainer:extend{
    name = "omnibus",
    is_doc_only = false,
}

function Omnibus:init()
    self.ui.menu:registerToMainMenu(self)
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

function Omnibus:library_getter(config)
    return function()
        local chunks = {}
        local code, err = request(config.server_url .. "/koreader/v1/library", config.token, {
            sink = function()
                return socketutil.table_sink(chunks)
            end,
            block_timeout = socketutil.LARGE_BLOCK_TIMEOUT,
            total_timeout = socketutil.LARGE_TOTAL_TIMEOUT,
        })
        if not code then
            return nil, nil, err
        end
        local ok, body = pcall(JSON.decode, table.concat(chunks))
        return code, ok and body or nil
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
