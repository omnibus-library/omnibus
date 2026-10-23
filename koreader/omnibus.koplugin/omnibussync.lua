--[[--
The Omnibus plugin's sync logic, with no KOReader dependency: main.lua hands in every
side effect (HTTP, files, the manifest) as `deps`, so this runs under plain luajit.

The manifest maps a book's uuid to the file this plugin delivered for it. It is the only
thing sync deletes by, so a file the plugin did not deliver is never touched.
--]]--

local M = {}

local FOLDER_LIMIT = 80
local REMOVED_MESSAGE = "This device was removed from Omnibus. Download the plugin again from Settings › Devices."

-- shortcut: limits by bytes, not characters, backing off to a character boundary.
local function cap(text, limit)
    if #text <= limit then
        return text
    end
    local cut = limit
    while cut > 0 and text:byte(cut + 1) >= 0x80 and text:byte(cut + 1) < 0xC0 do
        cut = cut - 1
    end
    return text:sub(1, cut)
end

local function safe(text)
    return (text:gsub('[/\\:*?"<>|%c]', "_"))
end

--- "<title> - <first 8 of uuid>.<format>", safe to create on any filesystem.
function M.file_name(book)
    local title = cap(safe(book.title or ""), FOLDER_LIMIT)
    if title == "" then
        title = "Untitled"
    end
    local id = (book.uuid or ""):sub(1, 8):gsub("[^%w%-]", "_")
    local format = (book.format or "epub"):gsub("[^%w]", "_")
    return string.format("%s - %s.%s", title, id, format)
end

--- The URL to fetch `book` from, always on `server_url`: nil unless the server's
--- `download_url` is a path, so a token is never sent to a host the config doesn't name.
function M.book_url(server_url, book)
    local url = book.download_url
    if type(url) ~= "string" or url:sub(1, 1) ~= "/" or url:sub(1, 2) == "//" then
        return nil
    end
    return server_url:gsub("/+$", "") .. url
end

local function inside(dir, path)
    return type(path) == "string"
        and path:sub(1, #dir + 1) == dir .. "/"
        and not path:find("/%.%./")
        and not path:find("/%.%.$")
end

--- What a sync must do: `download` (books to fetch), `delete` ({uuid, path} to remove from
--- the Omnibus folder) and `forget` (uuids to drop from the manifest without deleting).
function M.plan(manifest, books, dir, exists, open_path)
    local plan = { download = {}, delete = {}, forget = {} }
    local wanted = {}
    for _, book in ipairs(books) do
        wanted[book.uuid] = true
        local path = manifest[book.uuid]
        if not path or not exists(path) then
            table.insert(plan.download, book)
        end
    end
    for uuid, path in pairs(manifest) do
        if not wanted[uuid] then
            if not inside(dir, path) then
                table.insert(plan.forget, uuid)
            elseif path ~= open_path then
                table.insert(plan.delete, { uuid = uuid, path = path })
            end
        end
    end
    return plan
end

local function failure_message(verb, failures)
    if #failures == 0 then
        return nil
    end
    return string.format("Couldn't %s %d book%s: %s", verb, #failures, #failures == 1 and "" or "s",
        table.concat(failures, "; "))
end

local function fetch_library(server_url, deps)
    local code, body, err = deps.get_library()
    if not code then
        return nil, string.format("Couldn't reach %s: %s", server_url, tostring(err))
    end
    if code == 401 then
        return nil, REMOVED_MESSAGE
    end
    if code ~= 200 then
        return nil, string.format("Omnibus answered HTTP %d", code), true
    end
    if type(body) ~= "table" or type(body.books) ~= "table" then
        return nil, "Omnibus sent a library this plugin could not read", true
    end
    return body.books
end

--- One sync: bring the Omnibus folder in line with the server's library.
--- Returns { ok, added, removed, message }.
function M.run(server_url, deps)
    local books, message, reportable = fetch_library(server_url, deps)
    if not books then
        if reportable then
            deps.report(message)
        end
        return { ok = false, added = 0, removed = 0, message = message }
    end

    local plan = M.plan(deps.manifest, books, deps.dir, deps.exists, deps.open_path)
    local result = { ok = true, added = 0, removed = 0 }
    local download_failures, remove_failures = {}, {}

    for _, uuid in ipairs(plan.forget) do
        deps.manifest[uuid] = nil
        deps.save_manifest()
    end
    for _, entry in ipairs(plan.delete) do
        local ok, reason = deps.remove(entry.path)
        if ok then
            deps.manifest[entry.uuid] = nil
            deps.save_manifest()
            result.removed = result.removed + 1
        else
            table.insert(remove_failures, string.format("%s: %s", entry.path, tostring(reason)))
        end
    end
    for _, book in ipairs(plan.download) do
        local path = deps.dir .. "/" .. M.file_name(book)
        local ok, reason = deps.download(book, path)
        if ok then
            deps.manifest[book.uuid] = path
            deps.save_manifest()
            result.added = result.added + 1
        else
            table.insert(download_failures, string.format("%s: %s", book.title, tostring(reason)))
        end
    end

    local problems = {}
    for _, text in ipairs({ failure_message("download", download_failures),
                            failure_message("remove", remove_failures) }) do
        if text then
            table.insert(problems, text)
        end
    end
    if #problems > 0 then
        result.ok = false
        result.message = table.concat(problems, " ")
    end
    deps.report(result.message)
    return result
end

return M
