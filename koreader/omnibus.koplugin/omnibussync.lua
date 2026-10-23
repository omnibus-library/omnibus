--[[--
The Omnibus plugin's sync logic, with no KOReader dependency: main.lua hands in every
side effect (HTTP, files, the manifest) as `deps`, so this runs under plain luajit.

The manifest maps a book's uuid to the file this plugin delivered for it. It is the only
thing sync deletes by, so a file the plugin did not deliver is never touched.

Reading state is kept per book in `books`: the percent and status the device last agreed
with the server, when (`event_at`), and whether a change still waits to be pushed. A
change is captured only when the device differs from that agreed state, so a stale device
never overwrites a newer server position with a fresh timestamp.
A reflowable book's XPointer is part of its percent field: it is captured, pushed and
settled with the percent, and a move within the same percent still counts as a change.

Metadata is kept per delivered book in `files`: its path, the file's ETag and the
`last_modified` its bytes (`version`) and its custom metadata (`meta_version`) were last
brought to. It outlives a delete, so a returning book finds its old path and its sidecar.
A book whose server version moved gets its custom metadata rewritten and, if the server's
file changed too, the file replaced at the same path, unless replacing is refused.

Highlights are kept per book in `synced` (the book's `omnibus_annotations` setting): the
server's listing cursor and, for each highlight the device and server agreed on, a
fingerprint of what the device held and what the server named (its time, colour and text). A highlight
is pushed only when its fingerprint moved; one is deleted on the server only when it was
agreed on and has left the device, so a lost `synced` can never read as deleting everything.
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

-- The file extension `book` is delivered under.
local function extension(book)
    return ((book.format or "epub"):gsub("[^%w]", "_"))
end

local function path_extension(path)
    return path:match("%.([^./]+)$")
end

--- "<title> - <first 8 of uuid>.<format>", safe to create on any filesystem.
function M.file_name(book)
    local title = cap(safe(book.title or ""), FOLDER_LIMIT)
    if title == "" then
        title = "Untitled"
    end
    local id = (book.uuid or ""):sub(1, 8):gsub("[^%w%-]", "_")
    return string.format("%s - %s.%s", title, id, extension(book))
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

local COVER_EXTENSIONS = { ["image/jpeg"] = "jpg", ["image/png"] = "png", ["image/gif"] = "gif",
    ["image/webp"] = "webp" }

--- The file extension for a cover of `content_type`, nil when KOReader cannot show that type.
function M.cover_extension(content_type)
    return COVER_EXTENSIONS[(content_type or ""):match("^[^;]*"):lower()]
end

--- Bring `files` entries from before bytes and metadata had their own version up to date.
function M.upgrade_files(files)
    for _, entry in pairs(files) do
        if entry.meta_version == nil then
            entry.meta_version = entry.version
        end
    end
end

--- The delivered books to refresh, `{ book, path }` at their manifest path: those whose bytes
--- or metadata are behind the server's version, or whose file extension is not the format the
--- server now serves. The open document, a file that is gone and one outside `dir` are left
--- to `plan`.
function M.refresh_plan(manifest, files, books, dir, exists, open_path)
    local refresh = {}
    for _, book in ipairs(books) do
        local path = manifest[book.uuid]
        local kept = files[book.uuid]
        if inside(dir, path) and path ~= open_path and exists(path)
            and (not kept or kept.version ~= book.last_modified or kept.meta_version ~= book.last_modified
                or path_extension(path) ~= extension(book)) then
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
--- { percent = int|nil, status = string|nil, xpointer = string|nil }; `clocks` = { percent_at,
--- status_at } and only the arm that has a clock advances, so each field keeps the time its own
--- value was set. The XPointer is part of the percent field and moves with it.
function M.settle(books, uuid, current, clocks)
    local entry = books[uuid] or {}
    books[uuid] = entry
    if clocks.percent_at then
        entry.percent, entry.percent_at, entry.dirty_percent = current.percent, clocks.percent_at, false
        entry.xpointer = current.xpointer
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

-- crengine reads `text()` and `text()[1]` (and every other `[1]` step) as the same place.
local function normalized(xpointer)
    return xpointer and (xpointer:gsub("%[1%]", ""))
end

-- An XPointer moved within the same percent. An entry saved before XPointers existed has
-- none to compare with: it learns one at the next settle and never pushes for it.
local function xpointer_moved(entry, current)
    return current.xpointer ~= nil and entry.xpointer ~= nil
        and normalized(entry.xpointer) ~= normalized(current.xpointer)
end

--- Mark each field that differs from the agreed one pending at `now`, leaving the other
--- field's clock alone. Repeated captures leave one entry, so the latest change wins.
function M.capture(books, uuid, current, now)
    local entry = books[uuid]
    if not entry or current.percent == nil then
        return
    end
    if entry.percent ~= current.percent or xpointer_moved(entry, current) then
        entry.percent, entry.percent_at, entry.dirty_percent = current.percent, now, true
        entry.xpointer = current.xpointer
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
            if body.percent then
                body.xpointer = entry.xpointer
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
--- Returns { percent, percent_at, xpointer, status, status_at } with only the applied fields.
--- A position with an XPointer moves by it (the percent is the fallback when the document can't
--- place it); one without it, or a device that reports none, moves by percent. The same place
--- under a new clock returns the clock alone.
function M.pull_plan(entry, remote, current)
    entry = entry or {}
    local plan
    for _, arm in ipairs(ARMS) do
        -- A decoded JSON null is not nil (KOReader's json yields a function), so keep only tables.
        local server = remote[ANSWER_KEY[arm]]
        local at = entry[arm .. "_at"]
        -- A tie adopts the server's value, which survived a same-second write.
        if type(server) == "table" and not entry["dirty_" .. arm] and server.event_at >= (at or 0) then
            local local_value = device_value(arm, current)
            if at then
                local_value = entry[arm]
            end
            local by_xpointer = arm == "percent" and type(server.xpointer) == "string"
                and current.xpointer ~= nil
            local local_xpointer = at and entry.xpointer or current.xpointer
            if by_xpointer and normalized(server.xpointer) ~= normalized(local_xpointer) then
                plan = plan or {}
                plan.xpointer, plan.percent, plan.percent_at = server.xpointer, server.percent, server.event_at
            elseif server[arm] ~= local_value then
                plan = plan or {}
                plan[arm .. "_at"] = server.event_at
                if not by_xpointer then
                    plan[arm] = server[arm]
                end
            end
        end
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

-- Where `book` is delivered: the path it had before when that is free inside the folder and
-- of the right format, so its kept sidecar is found again, else the file name its title gives.
local function delivery_path(book, deps)
    local kept = deps.files[book.uuid]
    if kept and inside(deps.dir, kept.path) and not deps.exists(kept.path)
        and path_extension(kept.path) == extension(book) then
        return kept.path
    end
    return deps.dir .. "/" .. M.file_name(book)
end

-- Put `book` in `path` as the file the server serves now, recording what was delivered.
local function replace_file(book, path, deps, result, failures)
    local kept = deps.files[book.uuid]
    local format_changed = path_extension(path) ~= extension(book)
    local target = format_changed and (deps.dir .. "/" .. M.file_name(book)) or path
    local ok, etag_or_reason, not_modified = deps.download(book, target, not format_changed and kept.etag or nil)
    if not ok then
        return nil, etag_or_reason
    end
    if format_changed then
        -- The old file goes, its sidecar stays; the new file has no custom metadata yet.
        deps.manifest[book.uuid] = target
        kept.path, kept.meta_version = target, nil
        local removed, reason = deps.remove(path)
        if not removed then
            table.insert(failures, string.format("%s: %s", path, tostring(reason)))
        end
    end
    if not not_modified then
        kept.etag = etag_or_reason
        result.replaced = result.replaced + 1
    end
    kept.version = book.last_modified
    deps.save_manifest()
    return target
end

-- Bring one delivered book up to the server's version: replace its file when its bytes are
-- behind (the server answers 304 when the ETag still matches) and replacing is allowed, then
-- rewrite its metadata when that is behind.
local function refresh_book(item, deps, result, remove_failures)
    local book, path = item.book, item.path
    local kept = deps.files[book.uuid] or { path = path }
    deps.files[book.uuid] = kept
    local touched = false
    local format_changed = path_extension(path) ~= extension(book)
    if (format_changed or kept.version ~= book.last_modified) and deps.can_replace(path) then
        local target, reason = replace_file(book, path, deps, result, remove_failures)
        if not target then
            return false, reason
        end
        path, touched = target, true
    end
    if kept.meta_version ~= book.last_modified then
        local ok, reason = deps.apply_metadata(book, path)
        if not ok then
            return false, reason
        end
        kept.meta_version, touched = book.last_modified, true
        deps.save_manifest()
    end
    if touched then
        result.refreshed = result.refreshed + 1
    end
    return true
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

    M.upgrade_files(deps.files)
    local plan = M.plan(deps.manifest, books, deps.dir, deps.exists, deps.open_path)
    local refresh = M.refresh_plan(deps.manifest, deps.files, books, deps.dir, deps.exists, deps.open_path)
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
            deps.files[book.uuid] = { path = path, etag = etag_or_reason, version = book.last_modified }
            result.added = result.added + 1
            -- Saved before the metadata fetch, so a crash there cannot orphan the file.
            deps.save_manifest()
            local applied, reason = deps.apply_metadata(book, path)
            if applied then
                deps.files[book.uuid].meta_version = book.last_modified
                deps.save_manifest()
            else
                table.insert(update_failures, string.format("%s: %s", book.title, tostring(reason)))
            end
        else
            table.insert(download_failures, string.format("%s: %s", book.title, tostring(etag_or_reason)))
        end
    end
    for _, item in ipairs(refresh) do
        local ok, reason = refresh_book(item, deps, result, remove_failures)
        if not ok then
            table.insert(update_failures, string.format("%s: %s", item.book.title, tostring(reason)))
        end
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
