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

-- GET `url` with the device token and no redirects, so the token only ever reaches the
-- configured server. Returns the status code, or nil and the error.
local function fetch(url, token, sink, block_timeout, total_timeout)
    socketutil:set_timeout(block_timeout, total_timeout)
    local code = socket.skip(1, http.request{
        url = url,
        method = "GET",
        headers = { Authorization = "Bearer " .. token },
        sink = sink,
        redirect = false,
    })
    socketutil:reset_timeout()
    if type(code) == "number" then
        return code
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

function Omnibus:book_downloader(config)
    return function(book, path)
        local url = sync.book_url(config.server_url, book)
        if not url then
            return false, "unexpected download address"
        end
        local part = path .. ".part"
        local file, open_err = io.open(part, "wb")
        if not file then
            return false, open_err
        end
        local code, err = fetch(url, config.token, ltn12.sink.file(file),
            socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
        if code ~= 200 then
            os.remove(part)
            return false, code and ("HTTP " .. code) or err
        end
        local renamed, rename_err = os.rename(part, path)
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
    local result = sync.run(config.server_url, {
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
