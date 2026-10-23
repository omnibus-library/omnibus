--[[--
The Omnibus plugin's sync logic, with no KOReader dependency: main.lua hands in every
side effect (HTTP, files, the manifest) as `deps`, so this runs under plain luajit.

The manifest maps a book's uuid to the file this plugin delivered for it. It is the only
thing sync deletes by, so a file the plugin did not deliver is never touched.

Reading state is kept per book in `books`: the percent, status and (for a reflowable book)
XPointer the device last agreed with the server, when (`event_at`), and whether a change
still waits to be pushed. A change is captured only when the device differs from that
agreed state, so a stale device never overwrites a newer server position with a fresh
timestamp.

Metadata is kept per delivered book in `files` (path, the `last_modified` it was last
written at, and the file's ETag), which outlives a delete so a returning book finds its
old path and its sidecar. A book whose server version moved gets its custom metadata
rewritten and, if the server's file changed too, the file replaced at the same path.

Highlights are kept per book in `synced` (the book's `omnibus_annotations` setting): the
server's listing cursor and, for each highlight the device and server agreed on, a
fingerprint of what the device held and what the server named (its time, colour and text). A highlight
is pushed only when its fingerprint moved; one is deleted on the server only when it was
agreed on and has left the device, so a lost `synced` can never read as deleting everything.
--]]--

local M = {}

local FOLDER_LIMIT = 80

M.REMOVED_MESSAGE = "This device was removed from Omnibus. Download the plugin again from Settings › Devices."

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

--- Record the device's own state as agreed with the server at `event_at`, nothing to push.
--- `current` = { percent = int|nil, status = string|nil, xpointer = string|nil }.
function M.settle(books, uuid, current, event_at)
    books[uuid] = {
        percent = current.percent,
        status = current.status,
        xpointer = current.xpointer,
        event_at = event_at,
        pending = false,
    }
end

-- An XPointer moved within the same percent. An entry saved before XPointers existed has
-- none to compare with: it learns one at the next settle and never pushes for it.
local function xpointer_moved(agreed, current)
    return current.xpointer ~= nil and agreed.xpointer ~= nil and agreed.xpointer ~= current.xpointer
end

--- Mark a book pending at `now` when the device's percent, status or XPointer differs from the
--- agreed one. Repeated captures leave one entry, so the latest event wins.
function M.capture(books, uuid, current, now)
    local agreed = books[uuid]
    if not agreed or current.percent == nil then
        return
    end
    if agreed.percent ~= current.percent or agreed.status ~= current.status
        or xpointer_moved(agreed, current) then
        M.settle(books, uuid, current, now)
        books[uuid].pending = true
    end
end

local function sorted_pending(books)
    local uuids = {}
    for uuid, entry in pairs(books) do
        if entry.pending then
            table.insert(uuids, uuid)
        end
    end
    table.sort(uuids)
    return uuids
end

--- Push every pending book once; `deps` = { put_state(uuid, body) -> code|nil, err|nil, save() }.
--- 200 and 409 (the server holds a newer position) settle a book, 400/404/422 drop it so it
--- cannot block the queue; no response, 401 or a server error stop with every remaining book
--- still pending for the next sync. Returns { ok, message }.
function M.flush(books, deps)
    for _, uuid in ipairs(sorted_pending(books)) do
        local entry = books[uuid]
        local body = {
            percent = entry.percent,
            status = entry.status,
            xpointer = entry.xpointer,
            event_at = entry.event_at,
        }
        local code, err = deps.put_state(uuid, body)
        if not code then
            return { ok = false, message = string.format("Couldn't reach Omnibus: %s", tostring(err)) }
        elseif code == 401 then
            return { ok = false, message = M.REMOVED_MESSAGE }
        elseif code == 200 or code == 409 then
            entry.pending = false
        elseif code == 400 or code == 404 or code == 422 then
            books[uuid] = nil
        else
            return { ok = false, message = string.format("Omnibus answered HTTP %d", code) }
        end
        deps.save()
    end
    return { ok = true }
end

--- What opening a book should change on the device, or nil for nothing: the server's state
--- (`remote` = the GET body) when it is newer than the local entry, which a book still
--- waiting to be pushed outranks. Returns { percent = int|nil, status = string|nil,
--- xpointer = string|nil, event_at } where they appear only when they differ from `current`.
--- A newer position with an XPointer moves by it (with the percent as the fallback when the
--- document can't place it); one without, or a device that has no XPointer, moves by percent.
function M.pull_plan(entry, remote, current)
    if entry and entry.pending then
        return nil
    end
    local local_at = entry and entry.event_at or 0
    local plan
    local function newer(event_at)
        if event_at > local_at then
            plan = plan or { event_at = event_at }
            plan.event_at = math.max(plan.event_at, event_at)
            return true
        end
    end
    -- A decoded JSON null is not nil (KOReader's json yields a function), so keep only tables.
    local position = type(remote.position) == "table" and remote.position or nil
    local status = type(remote.status) == "table" and remote.status or nil
    if position and newer(position.event_at) then
        if type(position.xpointer) == "string" and current.xpointer ~= nil then
            if position.xpointer ~= current.xpointer then
                plan.xpointer = position.xpointer
                plan.percent = position.percent
            end
        elseif position.percent ~= current.percent then
            plan.percent = position.percent
        end
    end
    if status and newer(status.event_at) and status.status ~= current.status then
        plan.status = status.status
    end
    return plan
end

-- Most upserts, and most deletes, the server takes in one push.
M.PUSH_BATCH = 500

--- The epoch second of a KOReader local "%Y-%m-%d %H:%M:%S" stamp; nil when it isn't one.
function M.parse_datetime(stamp)
    if type(stamp) ~= "string" then
        return nil
    end
    local year, month, day, hour, min, sec = stamp:match("^(%d%d%d%d)-(%d%d)-(%d%d) (%d%d):(%d%d):(%d%d)$")
    if not year then
        return nil
    end
    return os.time({ year = tonumber(year), month = tonumber(month), day = tonumber(day),
        hour = tonumber(hour), min = tonumber(min), sec = tonumber(sec) })
end

-- A decoded JSON null is a function, so a field is only used when it has the type asked for.
local function string_or_nil(value)
    return type(value) == "string" and value or nil
end

local function table_or_nil(value)
    return type(value) == "table" and value or nil
end

local function is_highlight(item)
    return type(item) == "table" and item.drawer ~= nil and type(item.pos0) == "string"
        and type(item.pos1) == "string"
end

-- What the server would store of `item`: any change to it is a change to push.
local function fingerprint(item)
    return table.concat({ item.color or "", item.note or "", item.text or "", item.pos0, item.pos1 }, "\0")
end

-- The highlights on the device, numbering any that have no id yet. Returns them in order,
-- by id, and whether an id was minted.
local function numbered_highlights(items, deps)
    local list, by_id, minted = {}, {}, false
    for _, item in ipairs(items) do
        if is_highlight(item) then
            if not item.omnibus_id then
                item.omnibus_id = deps.new_id()
                minted = true
            end
            by_id[item.omnibus_id] = item
            table.insert(list, item)
        end
    end
    return list, by_id, minted
end

-- When the device last changed `item`: its own stamp, but never before the server time it
-- last agreed on, since a note edit leaves the stamp alone.
local function event_time(item, agreed)
    local stamp = M.parse_datetime(item.datetime_updated) or M.parse_datetime(item.datetime) or 0
    return math.max(stamp, agreed and agreed.server_at or 0)
end

-- The highlights to push (`{ id, fp, item, wire }`) and the agreed ids that left the device.
-- An id the server never took (`local_only`) that left is forgotten rather than deleted.
local function outgoing(list, by_id, agreed)
    local upserts, deletes, forgot = {}, {}, false
    for _, item in ipairs(list) do
        local id, fp = item.omnibus_id, fingerprint(item)
        local entry = agreed[id]
        if not entry or entry.fp ~= fp then
            table.insert(upserts, {
                id = id,
                fp = fp,
                item = item,
                wire = {
                    id = id, pos0 = item.pos0, pos1 = item.pos1, text = item.text, note = item.note,
                    color = item.color, created_at = M.parse_datetime(item.datetime) or 0,
                    updated_at = event_time(item, entry),
                },
            })
        end
    end
    for id, entry in pairs(agreed) do
        if not by_id[id] then
            if entry.local_only then
                agreed[id] = nil
                forgot = true
            else
                table.insert(deletes, id)
            end
        end
    end
    table.sort(deletes)
    return upserts, deletes, forgot
end

-- The message for a call that did not answer 200, or nil when it did.
local function http_problem(code, err)
    if not code then
        return string.format("Couldn't reach Omnibus: %s", tostring(err))
    elseif code == 401 then
        return M.REMOVED_MESSAGE
    elseif code ~= 200 then
        return string.format("Omnibus answered HTTP %d", code)
    end
end

-- Take the server's version of a highlight the device holds. The colour only follows when the
-- server's colour moved from the one agreed on, so a shade the server can't name survives.
local function take_server_version(item, server, entry)
    item.note = string_or_nil(server.note)
    item.text = string_or_nil(server.text)
    local color = string_or_nil(server.color)
    if color and color ~= (entry and entry.server_color) then
        item.color = color
    end
end

-- What the server holds of a highlight that the device would show: a change to it is a change
-- made elsewhere. Compared as well as the time because the server's clock counts whole seconds.
local function server_fingerprint(server)
    return table.concat({ string_or_nil(server.color) or "", string_or_nil(server.note) or "",
        string_or_nil(server.text) or "" }, "\0")
end

-- The agreed entry for a highlight whose device-side fingerprint is `fp` and whose server
-- version is `server`.
local function agree(fp, server)
    return {
        fp = fp,
        server_at = type(server.updated_at) == "number" and server.updated_at or nil,
        server_color = string_or_nil(server.color),
        server_fp = server_fingerprint(server),
    }
end

-- Whether the listed version of a highlight is one the device has not seen: not older than the
-- agreed time, and different from what it agreed on.
local function newer_on_server(entry, wire)
    if entry.server_at and wire.updated_at < entry.server_at then
        return false
    end
    return entry.server_fp ~= server_fingerprint(wire)
end

-- Record what the server answered for each upsert of one push: `applied` and `stale` agree on
-- the server's version, `deleted` removes the highlight, `unplaceable` keeps it local. An
-- upsert with no answer stays as it was, so the next sync sends it again.
local function settle_results(sent, results, deps, state)
    local answers = {}
    for _, answer in ipairs(results) do
        if type(answer) == "table" and type(answer.id) == "string" then
            answers[answer.id] = answer
        end
    end
    for _, up in ipairs(sent) do
        local answer = answers[up.id] or {}
        local server = table_or_nil(answer.annotation)
        local landed = true
        if answer.outcome == "applied" and server then
            state.agreed[up.id] = agree(up.fp, server)
        elseif answer.outcome == "stale" and server then
            take_server_version(up.item, server, state.agreed[up.id])
            state.agreed[up.id] = agree(fingerprint(up.item), server)
        elseif answer.outcome == "deleted" then
            deps.remove(up.item)
            state.by_id[up.id] = nil
            state.agreed[up.id] = nil
        elseif answer.outcome == "unplaceable" then
            state.agreed[up.id] = { fp = up.fp, local_only = true }
        else
            landed = false
        end
        state.result.changed = state.result.changed or landed
    end
end

-- Push the upserts and deletes in requests within the server's cap. Returns a failure
-- message, or nil when everything landed.
local function push(upserts, deletes, deps, state)
    local at_up, at_del = 1, 1
    while at_up <= #upserts or at_del <= #deletes do
        local sent, wires, gone = {}, {}, {}
        for i = at_up, math.min(at_up + M.PUSH_BATCH - 1, #upserts) do
            table.insert(sent, upserts[i])
            table.insert(wires, upserts[i].wire)
        end
        for i = at_del, math.min(at_del + M.PUSH_BATCH - 1, #deletes) do
            table.insert(gone, deletes[i])
        end
        at_up, at_del = at_up + #sent, at_del + #gone
        -- An empty array may encode as an object, which the server would refuse.
        local code, reply, err = deps.post({ upserts = #sent > 0 and wires or nil,
            deletes = #gone > 0 and gone or nil })
        local problem = http_problem(code, err)
        if problem then
            return problem
        end
        if type(reply) ~= "table" or (#sent > 0 and type(reply.results) ~= "table") then
            return "Omnibus sent a reply this plugin could not read"
        end
        settle_results(sent, reply.results or {}, deps, state)
        for _, id in ipairs(gone) do
            state.agreed[id] = nil
            state.result.changed = true
        end
    end
end

-- Bring in what the listing says changed: new highlights, newer versions, deletions.
local function apply_listing(listing, synced, deps, state)
    local gone = {}
    for _, id in ipairs(table_or_nil(listing.deleted) or {}) do
        if type(id) == "string" then
            gone[id] = true
        end
    end
    for _, wire in ipairs(listing.annotations) do
        local id = type(wire) == "table" and wire.id
        if type(id) == "string" and type(wire.updated_at) == "number" and not gone[id] then
            local item, entry = state.by_id[id], synced.agreed[id]
            if not item and not entry then
                item = deps.add(wire)
                if item then
                    state.by_id[id] = item
                    synced.agreed[id] = agree(fingerprint(item), wire)
                    state.result.changed = true
                end
            elseif item and entry and newer_on_server(entry, wire) then
                take_server_version(item, wire, entry)
                synced.agreed[id] = agree(fingerprint(item), wire)
                state.result.changed = true
            end
        end
    end
    for id in pairs(gone) do
        if state.by_id[id] then
            deps.remove(state.by_id[id])
            state.by_id[id] = nil
        end
        if synced.agreed[id] then
            synced.agreed[id] = nil
            state.result.changed = true
        end
    end
    if type(listing.cursor) == "number" and listing.cursor ~= synced.cursor then
        synced.cursor = listing.cursor
        state.result.changed = true
    end
end

--- Reconcile the open book's highlights with Omnibus: push what changed on the device, then
--- pull what changed on the server. `items` is the document's annotation list (highlights get
--- an `omnibus_id` in place), `synced` = { cursor = int, agreed = { [id] = { fp, server_at,
--- server_color, server_fp, local_only } } } is mutated, and `deps` = { new_id() -> string,
--- post(body) -> code|nil, reply|nil, err|nil, get(since) -> code|nil, listing|nil, err|nil,
--- add(wire) -> item|nil, remove(item) }. `changed` says the caller has something to save,
--- failure or not. Returns { ok, changed, message }.
function M.sync_annotations(items, synced, deps)
    synced.cursor = synced.cursor or 0
    synced.agreed = synced.agreed or {}
    local list, by_id, minted = numbered_highlights(items, deps)
    local result = { ok = true, changed = minted }
    local state = { agreed = synced.agreed, by_id = by_id, result = result }
    local function failed(message)
        result.ok, result.message = false, message
        return result
    end

    local upserts, deletes, forgot = outgoing(list, by_id, synced.agreed)
    result.changed = result.changed or forgot
    local problem = push(upserts, deletes, deps, state)
    if problem then
        return failed(problem)
    end

    local code, listing, err = deps.get(synced.cursor)
    problem = http_problem(code, err)
    if problem then
        return failed(problem)
    end
    if type(listing) ~= "table" or type(listing.annotations) ~= "table" then
        return failed("Omnibus sent annotations this plugin could not read")
    end
    apply_listing(listing, synced, deps, state)
    return result
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
        return nil, M.REMOVED_MESSAGE
    end
    if code ~= 200 then
        return nil, string.format("Omnibus answered HTTP %d", code), true
    end
    if type(body) ~= "table" or type(body.books) ~= "table" then
        return nil, "Omnibus sent a library this plugin could not read", true
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
