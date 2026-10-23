--[[--
The Omnibus plugin's sync logic, with no KOReader dependency: main.lua hands in every
side effect (HTTP, files, the manifest) as `deps`, so this runs under plain luajit.

The manifest maps a book's uuid to the file this plugin delivered for it. It is the only
thing sync deletes by, so a file the plugin did not deliver is never touched.

Reading state is kept per book in `books`: the percent and status the device last agreed
with the server, when (`event_at`), and whether a change still waits to be pushed. A
change is captured only when the device differs from that agreed state, so a stale device
never overwrites a newer server position with a fresh timestamp.

Metadata is kept per delivered book in `files` (path, the `last_modified` it was last
written at, and the file's ETag), which outlives a delete so a returning book finds its
old path and its sidecar. A book whose server version moved gets its custom metadata
rewritten and, if the server's file changed too, the file replaced at the same path.
--]]--

local M = {}

local FOLDER_LIMIT = 80
local UNREADABLE_MESSAGE = "Omnibus sent a library this plugin could not read. Download the plugin again from Settings › Devices."

M.REMOVED_MESSAGE = "This device was removed from Omnibus. Add a new KOReader in Settings › Devices and install its plugin."

local function cap(text, limit)
    local count = 0
    for i = 1, #text do
        local byte = text:byte(i)
        if byte < 0x80 or byte >= 0xC0 then
            count = count + 1
            if count > limit then
                return text:sub(1, i - 1)
            end
        end
    end
    return text
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

-- `url` on `server_url`: nil unless it is a path, so a token is never sent to a host the
-- config doesn't name.
local function on_server(server_url, url)
    if type(url) ~= "string" or url:sub(1, 1) ~= "/" or url:sub(1, 2) == "//" then
        return nil
    end
    return server_url:gsub("/+$", "") .. url
end

--- The URL to fetch `book` from, always on `server_url`.
function M.book_url(server_url, book)
    return on_server(server_url, book.download_url)
end

--- The URL of `book`'s cover, always on `server_url`.
function M.cover_url(server_url, book)
    return on_server(server_url, book.cover_url)
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
        if not (inside(dir, path) and exists(path)) then
            table.insert(plan.download, book)
            if path and not inside(dir, path) then
                table.insert(plan.forget, book.uuid)
            end
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

local function text(value)
    return type(value) == "string" and value ~= "" and value or nil
end

--- The custom-metadata fields KOReader shows for `book`; a field the server has none for is
--- nil, which clears a stale value. A decoded JSON null is a function, so only keep real types.
function M.custom_props(book)
    local authors = type(book.authors) == "table" and table.concat(book.authors, "\n") or nil
    return {
        title = text(book.title),
        authors = text(authors),
        series = text(book.series),
        series_index = type(book.series_index) == "number" and book.series_index or nil,
        description = text(book.description),
    }
end

--- The delivered books to refresh, `{ book, path }` at their manifest path: those whose
--- recorded version differs from the server's. The open document and a file that is gone
--- are left to `plan`.
function M.refresh_plan(manifest, files, books, exists, open_path)
    local refresh = {}
    for _, book in ipairs(books) do
        local path = manifest[book.uuid]
        local kept = files[book.uuid]
        if path and path ~= open_path and exists(path) and not (kept and kept.version == book.last_modified) then
            table.insert(refresh, { book = book, path = path })
        end
    end
    return refresh
end

--- The whole-book percent of a 0..1 fraction, floored (never overstate how far along the
--- device is) and clamped to 0..100; nil when the device has none.
function M.percent(fraction)
    if type(fraction) ~= "number" then
        return nil
    end
    return math.max(0, math.min(100, math.floor(fraction * 100)))
end

--- The uuid of the book this plugin delivered to `path`; nil for a sideloaded file.
function M.uuid_for_path(manifest, path)
    for uuid, delivered in pairs(manifest) do
        if delivered == path then
            return uuid
        end
    end
end

-- Statuses the server syncs; KOReader's others ("abandoned") never leave the device.
local function wire_status(status)
    if status == "reading" or status == "complete" then
        return status
    end
end

local ARMS = { "percent", "status" }
-- The GET/PUT answer's name for each arm.
local ANSWER_KEY = { percent = "position", status = "status" }

--- Whether a book has a change the server has not heard.
function M.pending(entry)
    return entry.dirty_percent == true or entry.dirty_status == true
end

--- Record the device's own state as agreed with the server, nothing to push. `current` =
--- { percent = int|nil, status = string|nil }; `clocks` = { percent_at, status_at } and only
--- the arm that has a clock advances, so each field keeps the time its own value was set.
function M.settle(books, uuid, current, clocks)
    local entry = books[uuid] or {}
    books[uuid] = entry
    if clocks.percent_at then
        entry.percent, entry.percent_at, entry.dirty_percent = current.percent, clocks.percent_at, false
    end
    if clocks.status_at then
        entry.status, entry.status_at, entry.dirty_status = wire_status(current.status), clocks.status_at, false
    end
end

--- Bring an entry saved with one `event_at` and `pending` flag up to one clock per field.
function M.upgrade(books)
    for _, entry in pairs(books) do
        if entry.event_at ~= nil and entry.percent_at == nil then
            entry.status = wire_status(entry.status)
            entry.percent_at, entry.status_at = entry.event_at, entry.event_at
            entry.dirty_percent = entry.pending == true
            entry.dirty_status = entry.pending == true and entry.status ~= nil
            entry.event_at, entry.pending = nil, nil
        end
    end
end

--- Mark each field that differs from the agreed one pending at `now`, leaving the other
--- field's clock alone. Repeated captures leave one entry, so the latest change wins.
function M.capture(books, uuid, current, now)
    local entry = books[uuid]
    if not entry or current.percent == nil then
        return
    end
    if entry.percent ~= current.percent then
        entry.percent, entry.percent_at, entry.dirty_percent = current.percent, now, true
    end
    local status = wire_status(current.status)
    if entry.status ~= status then
        -- A status the server does not sync (or none) is dated but has nothing to send.
        entry.status, entry.status_at, entry.dirty_status = status, now, status ~= nil
    end
end

--- A book met for the first time while the server holds nothing for it: queue the device's
--- own state so it reaches the server. Returns whether it did.
function M.adopt_empty_server(books, uuid, current, remote, now)
    if type(remote.position) == "table" or type(remote.status) == "table" then
        return false
    end
    M.settle(books, uuid, {}, { percent_at = 0, status_at = 0 })
    M.capture(books, uuid, current, now)
    return true
end

local function sorted_pending(books)
    local uuids = {}
    for uuid, entry in pairs(books) do
        if M.pending(entry) then
            table.insert(uuids, uuid)
        end
    end
    table.sort(uuids)
    return uuids
end

-- The PUTs a book needs: one per pending field, or one for both when they share a time.
local function batches(entry)
    local dirty = {}
    for _, arm in ipairs(ARMS) do
        if entry["dirty_" .. arm] then
            table.insert(dirty, { arm })
        end
    end
    if #dirty == 2 and entry.percent_at == entry.status_at then
        return { { "percent", "status" } }
    end
    return dirty
end

-- Settle a pushed field to what the server answered. A write that landed takes the server's
-- (clamped) time, so a device clock ahead of the server's cannot shadow later server writes; one
-- that lost keeps the device's own value and time, so the next open sees the newer server value
-- and applies it.
local function settle_answer(entry, arm, answer)
    local stored = type(answer) == "table" and answer[ANSWER_KEY[arm]]
    if type(stored) == "table" and type(stored.event_at) == "number"
        and stored.event_at <= entry[arm .. "_at"] then
        entry[arm .. "_at"] = stored.event_at
    end
    entry["dirty_" .. arm] = false
end

--- Push every pending book; `deps` = { put_state(uuid, body) -> code|nil, answer|nil, err|nil,
--- save() }. Only the changed fields go, each with its own time. 200 and 409 (the server holds
--- a newer position) settle a field, 400/404/422 drop the book so it cannot block the queue; no
--- response, 401 or a server error stop with every remaining field still pending for the next
--- sync. Returns { ok, message }.
function M.flush(books, deps)
    for _, uuid in ipairs(sorted_pending(books)) do
        local entry = books[uuid]
        for _, arms in ipairs(batches(entry)) do
            local body = { event_at = entry[arms[1] .. "_at"] }
            for _, arm in ipairs(arms) do
                body[arm] = entry[arm]
            end
            local code, answer, err = deps.put_state(uuid, body)
            if not code then
                return { ok = false, message = string.format("Couldn't reach Omnibus: %s", tostring(err)) }
            elseif code == 401 then
                return { ok = false, message = M.REMOVED_MESSAGE }
            elseif code == 200 or code == 409 then
                for _, arm in ipairs(arms) do
                    settle_answer(entry, arm, answer)
                end
            elseif code == 400 or code == 404 or code == 422 then
                books[uuid] = nil
            else
                return { ok = false, message = string.format("Omnibus answered HTTP %d", code) }
            end
            deps.save()
            if not books[uuid] then
                break
            end
        end
    end
    return { ok = true }
end

local function device_value(arm, current)
    if arm == "status" then
        return wire_status(current.status)
    end
    return current.percent
end

--- What opening a book should change on the device, or nil for nothing. Each of the server's
--- fields (`remote` = the GET body) is applied when its time is at least the device's own for
--- that field and its value differs; a field still waiting to be pushed outranks the server.
--- Returns { percent, percent_at, status, status_at } with only the applied fields.
function M.pull_plan(entry, remote, current)
    entry = entry or {}
    local plan
    for _, arm in ipairs(ARMS) do
        -- A decoded JSON null is not nil (KOReader's json yields a function), so keep only tables.
        local server = remote[ANSWER_KEY[arm]]
        local at = entry[arm .. "_at"]
        if type(server) == "table" and not entry["dirty_" .. arm] then
            local local_value = device_value(arm, current)
            if at then
                local_value = entry[arm]
            end
            -- A tie adopts the server's value, which survived a same-second write.
            if server.event_at >= (at or 0) and server[arm] ~= local_value then
                plan = plan or {}
                plan[arm], plan[arm .. "_at"] = server[arm], server.event_at
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

-- A books list that is a real sequence of complete entries; anything else must not be
-- mistaken for an empty library, which would remove every delivered book.
local function readable_library(body)
    if type(body) ~= "table" or type(body.books) ~= "table" then
        return false
    end
    local count = 0
    for _, book in pairs(body.books) do
        count = count + 1
        if type(book) ~= "table" or type(book.uuid) ~= "string" or type(book.title) ~= "string"
            or type(book.format) ~= "string" or type(book.download_url) ~= "string" then
            return false
        end
    end
    return count == #body.books
end

local function fetch_library(server_url, deps)
    local code, body, err = deps.get_library()
    if not code then
        return nil, string.format("Couldn't reach %s: %s", server_url, tostring(err))
    end
    if code == 401 then
        return nil, M.REMOVED_MESSAGE
    end
    if code ~= 200 then
        return nil, string.format("Omnibus answered HTTP %d. Try again later.", code), true
    end
    if not readable_library(body) then
        return nil, UNREADABLE_MESSAGE, true
    end
    return body.books
end

-- Where `book` is delivered: the path it had before when that is free inside the folder, so
-- its kept sidecar is found again, else the file name its title gives.
local function delivery_path(book, deps)
    local kept = deps.files[book.uuid]
    if kept and inside(deps.dir, kept.path) and not deps.exists(kept.path) then
        return kept.path
    end
    return deps.dir .. "/" .. M.file_name(book)
end

-- Write `book`'s metadata at `path` and, only if that worked, record the version it was written at.
local function apply_metadata(book, path, deps)
    local ok, reason = deps.apply_metadata(book, path)
    if ok then
        deps.files[book.uuid].version = book.last_modified
    end
    return ok, reason
end

-- Bring one delivered book up to the server's version: replace its file when the server's
-- changed (an ETag the saved one no longer matches), then rewrite its metadata.
local function refresh_book(item, deps, result)
    local book, path = item.book, item.path
    deps.files[book.uuid] = deps.files[book.uuid] or { path = path }
    local kept = deps.files[book.uuid]
    if deps.can_replace then
        local ok, etag_or_reason, not_modified = deps.download(book, path, kept.etag)
        if not ok then
            return false, etag_or_reason
        end
        if not not_modified then
            kept.etag = etag_or_reason
            result.replaced = result.replaced + 1
        end
    end
    local ok, reason = apply_metadata(book, path, deps)
    if ok then
        result.refreshed = result.refreshed + 1
    end
    return ok, reason
end

--- One sync: bring the Omnibus folder in line with the server's library.
--- Returns { ok, added, removed, refreshed, replaced, message }.
function M.run(server_url, deps)
    local books, message, reportable = fetch_library(server_url, deps)
    if not books then
        if reportable then
            deps.report(message)
        end
        return { ok = false, added = 0, removed = 0, refreshed = 0, replaced = 0, message = message }
    end

    local plan = M.plan(deps.manifest, books, deps.dir, deps.exists, deps.open_path)
    local refresh = M.refresh_plan(deps.manifest, deps.files, books, deps.exists, deps.open_path)
    local result = { ok = true, added = 0, removed = 0, refreshed = 0, replaced = 0 }
    local download_failures, remove_failures, update_failures = {}, {}, {}

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
        local path = delivery_path(book, deps)
        local ok, etag_or_reason = deps.download(book, path)
        if ok then
            deps.manifest[book.uuid] = path
            deps.files[book.uuid] = { path = path, etag = etag_or_reason }
            result.added = result.added + 1
            local applied, reason = apply_metadata(book, path, deps)
            if not applied then
                table.insert(update_failures, string.format("%s: %s", book.title, tostring(reason)))
            end
            deps.save_manifest()
        else
            table.insert(download_failures, string.format("%s: %s", book.title, tostring(etag_or_reason)))
        end
    end
    for _, item in ipairs(refresh) do
        local ok, reason = refresh_book(item, deps, result)
        if not ok then
            table.insert(update_failures, string.format("%s: %s", item.book.title, tostring(reason)))
        end
        deps.save_manifest()
    end

    local problems = {}
    for _, group in ipairs({ { "download", download_failures }, { "remove", remove_failures },
                             { "update", update_failures } }) do
        -- Not ipairs over the messages: a nil (no failures) would end the loop early.
        local text = failure_message(group[1], group[2])
        if text then
            table.insert(problems, text)
        end
    end
    if #problems > 0 then
        result.ok = false
        result.message = table.concat(problems, "; ")
    end
    deps.report(result.message)
    return result
end

return M
