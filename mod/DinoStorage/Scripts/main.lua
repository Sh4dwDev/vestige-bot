-- DinoStorage — dinosaur storage for The Isle: EVRIMA
--
-- Captures a player's LIVE pawn in server memory and restores it later. The
-- encrypted TheIslePersistence.db is never read or written.
--
-- Rules:
--   * only fully grown dinosaurs can be stored
--   * three slots per player
--   * restoring consumes the slot
--   * you must be the same species to restore
--
-- Everything here follows patterns verified against a live 0.21.720 server.
-- The comments marked "why" record things that cost real debugging time; do not
-- unpick them without reading docs/NOTES.md first.

local MOD_NAME = "DinoStorage"
local MOD_VERSION = "3.0.0"

local SCHEMA_VERSION = 1
local MAX_SLOTS = 3
local MIN_GROWTH = 0.999      -- a "100%" dino reads back as 0.999996
local SHRINK_GROWTH = 0.05    -- corpse size before the kill, so it is not free food
local FAST_TICK_MS = 500
local POLL_TICK_MS = 3000
local KILL_DELAY_TICKS = 2    -- ~1s for the shrink to replicate before death

-- why: UE4SS print() does not append a newline.
local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

-- why: an unguarded Lua error inside a tick kills that loop permanently and
-- silently. Native crashes are uncatchable, but this stops the avoidable half.
local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(string.format("ERROR in %s: %s", label, tostring(err))) end
    return ok
end

log(string.format("boot: %s v%s", MOD_NAME, MOD_VERSION))

-- ---------------------------------------------------------------------------
-- Storage location
-- ---------------------------------------------------------------------------

local SAVED_CANDIDATES = {
    "ue4ss/Mods/DinoStorage/Saved/",
    "Mods/DinoStorage/Saved/",
    "./",
}

local savedDir = nil
for _, candidate in ipairs(SAVED_CANDIDATES) do
    local ok, writable = pcall(function()
        local probe = candidate .. ".probe"
        local f = io.open(probe, "wb")
        if f == nil then return false end
        f:write("x"); f:close(); os.remove(probe)
        return true
    end)
    if ok and writable then savedDir = candidate break end
end

log(savedDir and ("savedDir: " .. savedDir) or "FATAL: no writable Saved directory")

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

local function isSteamId(value)
    return type(value) == "string" and value:match("^7656119%d%d%d%d%d%d%d%d%d%d$") ~= nil
end

local function slotNameOk(slot)
    -- Lua patterns have no {n,m}, so length is checked separately.
    if type(slot) ~= "string" or #slot < 1 or #slot > 24 then return false end
    return slot:match("^[%w_%-]+$") ~= nil
end

-- why: tostring() on FString/FName userdata returns a POINTER rendering
-- ("FString: 0000000016A30DF8") — a different one each read. :ToString() must
-- be tried first or one player registers as several phantoms.
local function looksLikeUserdata(s)
    return s:find("^UObject") ~= nil or s:find("^FString:") ~= nil
        or s:find("^FName") ~= nil or s:find("^%a+:%s*[0-9A-Fa-f]+$") ~= nil
end

local function safeString(value)
    if value == nil then return "" end
    local okT, t = pcall(function() return value:ToString() end)
    if okT and type(t) == "string" and t ~= "" and not looksLikeUserdata(t) then return t end
    local okS, s = pcall(function() return tostring(value) end)
    if okS and type(s) == "string" and s ~= "" and not looksLikeUserdata(s) then return s end
    return ""
end

local function callNumber(obj, method)
    local v
    if pcall(function() v = obj[method](obj) end) and type(v) == "number" then return v end
    return nil
end

local function callBool(obj, method)
    local v
    if pcall(function() v = obj[method](obj) end) and type(v) == "boolean" then return v end
    return nil
end

local function unwrap(param)
    if param == nil then return nil end
    local obj
    pcall(function() obj = param:get() end)
    return obj
end

local function stripClassPrefix(full)
    if full == nil or full == "" then return "" end
    return (full:gsub("^BlueprintGeneratedClass ", ""):gsub("^Class ", ""))
end

local function speciesOf(classPath)
    if classPath == nil or classPath == "" then return "Unknown" end
    local tail = classPath:match("([^/]+)$") or classPath
    tail = tail:match("^([^%.]+)") or tail
    return (tail:gsub("^BP_", ""):gsub("_C$", ""))
end

-- ---------------------------------------------------------------------------
-- Engine access
-- ---------------------------------------------------------------------------

local reportedGameMode = nil

-- why: FindFirstOf on a class with NO live instances triggers a native access
-- violation ~1.7s later that pcall cannot catch. Never call this at boot —
-- only from ticks, once a map is loaded.
local function findGameMode()
    local candidates = { "BP_SurvivalGameMode_C", "TISurvivalGameMode", "TIGameModeBase", "GameModeBase" }
    for _, name in ipairs(candidates) do
        local gm
        pcall(function() gm = FindFirstOf(name) end)
        if gm ~= nil then
            if reportedGameMode ~= name then
                reportedGameMode = name
                log("game mode: " .. name)
            end
            return gm
        end
    end
    return nil
end

local function steamIdOf(ctrl)
    if ctrl == nil then return "" end
    local getter, field
    pcall(function() getter = ctrl:GetSteamId() end)
    pcall(function() field = ctrl.SteamId end)

    local a = safeString(getter)
    if isSteamId(a) then return a end
    local b = safeString(field)
    if isSteamId(b) then return b end
    return ""
end

-- why: K2_GetPawn returns a NON-NIL wrapper around a null pointer while the
-- player is on spawn-select or mid-respawn. The address check is the only way
-- to tell that from a real pawn.
local function livePawn(ctrl)
    if ctrl == nil then return nil end
    local pawn
    pcall(function() pawn = ctrl:K2_GetPawn() end)
    if pawn == nil then return nil end
    local addr
    pcall(function() addr = pawn:GetAddress() end)
    if addr == nil or addr == 0 then return nil end
    return pawn
end

-- why: a player can be possessing BP_AdminPawn_C, which answers nil to every
-- vital getter. Storing that would save a meaningless snapshot.
local function dinosaurCheck(pawn)
    local classPath
    pcall(function() classPath = stripClassPrefix(pawn:GetClass():GetFullName()) end)
    if classPath == nil or classPath == "" then return false, "class unreadable", nil end
    if not classPath:find("/Dinosaurs/", 1, true) then return false, "not a dinosaur", classPath end
    if callNumber(pawn, "GetGrowth") == nil then return false, "growth unreadable", classPath end
    return true, nil, classPath
end

-- ---------------------------------------------------------------------------
-- Presence
--
-- why: FindAllOf("TIPlayerController") returns stale post-disconnect
-- controllers that crash on access. Track steam IDs (plain strings, safe to
-- hold) and re-derive controllers each tick instead.
-- ---------------------------------------------------------------------------

local presence = {}
local PRESENCE_TTL = 180

local function presenceSee(steam)
    if not isSteamId(steam) then return end
    if presence[steam] == nil then
        presence[steam] = { first = os.time() }
        log("player: " .. steam)
    end
    presence[steam].last = os.time()
end

-- why: the SetAdminCred heartbeat fires in bursts up to ~8 minutes apart, so
-- seeding from the game mode's own set is what keeps the registry alive
-- (and repopulates it instantly after a hot reload).
local function seedPresence(gm)
    local set
    pcall(function() set = gm.AllPlayerControllers end)
    if set == nil then return end
    pcall(function()
        set:ForEach(function(elem)
            local ctrl = unwrap(elem) or elem
            local steam = steamIdOf(ctrl)
            if steam ~= "" then presenceSee(steam) end
        end)
    end)
end

local function onlinePlayers()
    local out = {}
    local gm = findGameMode()
    if gm == nil then return out end
    local now = os.time()
    for steam, entry in pairs(presence) do
        if (now - entry.last) > PRESENCE_TTL then
            presence[steam] = nil
        else
            local ctrl
            pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
            if ctrl == nil then
                presence[steam] = nil
            else
                out[#out + 1] = { steam = steam, ctrl = ctrl, pawn = livePawn(ctrl) }
            end
        end
    end
    return out
end

local function resolvePlayer(steam)
    local gm = findGameMode()
    if gm == nil then return nil, "server is still starting up" end
    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return nil, "you are not on the server" end
    local pawn = livePawn(ctrl)
    if pawn == nil then return nil, "you are not spawned in yet" end
    return pawn, nil
end

-- ---------------------------------------------------------------------------
-- JSON
--
-- why: production Evrima mods do not `require` a JSON library; pulling one into
-- a game server's Lua VM is an unnecessary failure mode. Encoder and parser are
-- small enough to own.
-- ---------------------------------------------------------------------------

local ARRAY_MT = {}
local function arr(t) return setmetatable(t or {}, ARRAY_MT) end

local function jsonEscape(s)
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    return (s:gsub("[%z\1-\31]", function(c) return string.format("\\u%04x", string.byte(c)) end))
end

local encodeValue

local function encodeTable(t, indent)
    local pad, closePad = string.rep("  ", indent + 1), string.rep("  ", indent)

    if getmetatable(t) == ARRAY_MT or #t > 0 then
        if #t == 0 then return "[]" end
        local parts = {}
        for i = 1, #t do parts[#parts + 1] = pad .. encodeValue(t[i], indent + 1) end
        return "[\n" .. table.concat(parts, ",\n") .. "\n" .. closePad .. "]"
    end

    local keys = {}
    for k in pairs(t) do keys[#keys + 1] = tostring(k) end
    if #keys == 0 then return "{}" end
    table.sort(keys) -- stable output makes two snapshots diffable

    local parts = {}
    for _, k in ipairs(keys) do
        parts[#parts + 1] = string.format('%s"%s": %s', pad, jsonEscape(k), encodeValue(t[k], indent + 1))
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n" .. closePad .. "}"
end

encodeValue = function(v, indent)
    if v == nil then return "null" end
    local kind = type(v)
    if kind == "boolean" then return v and "true" or "false" end
    if kind == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        if math.type(v) == "integer" then return string.format("%d", v) end
        return (string.format("%.14g", v))
    end
    if kind == "string" then return '"' .. jsonEscape(v) .. '"' end
    if kind == "table" then return encodeTable(v, indent or 0) end
    return '"' .. jsonEscape(tostring(v)) .. '"'
end

local function jsonParse(text)
    local pos = 1
    local function skipWs() pos = text:find("[^ \t\r\n]", pos) or (#text + 1) end
    local parseValue

    local function parseString()
        pos = pos + 1
        local buf = {}
        while true do
            local c = text:sub(pos, pos)
            if c == "" then error("unterminated string") end
            if c == '"' then pos = pos + 1 break end
            if c == "\\" then
                local esc = text:sub(pos + 1, pos + 1)
                pos = pos + 2
                if esc == "n" then buf[#buf + 1] = "\n"
                elseif esc == "t" then buf[#buf + 1] = "\t"
                elseif esc == "r" then buf[#buf + 1] = "\r"
                elseif esc == "u" then
                    local code = tonumber(text:sub(pos, pos + 3), 16)
                    pos = pos + 4
                    buf[#buf + 1] = (code and code < 128) and string.char(code) or "?"
                else buf[#buf + 1] = esc end
            else
                buf[#buf + 1] = c
                pos = pos + 1
            end
        end
        return table.concat(buf)
    end

    local function parseObject()
        pos = pos + 1
        local obj = {}
        skipWs()
        if text:sub(pos, pos) == "}" then pos = pos + 1 return obj end
        while true do
            skipWs()
            local key = parseString()
            skipWs()
            pos = pos + 1 -- ':'
            obj[key] = parseValue()
            skipWs()
            local c = text:sub(pos, pos)
            pos = pos + 1
            if c == "}" then break end
            if c ~= "," then error("expected , or }") end
        end
        return obj
    end

    local function parseArray()
        pos = pos + 1
        local list = {}
        skipWs()
        if text:sub(pos, pos) == "]" then pos = pos + 1 return list end
        while true do
            list[#list + 1] = parseValue()
            skipWs()
            local c = text:sub(pos, pos)
            pos = pos + 1
            if c == "]" then break end
            if c ~= "," then error("expected , or ]") end
        end
        return list
    end

    parseValue = function()
        skipWs()
        local c = text:sub(pos, pos)
        if c == "{" then return parseObject() end
        if c == "[" then return parseArray() end
        if c == '"' then return parseString() end
        if text:sub(pos, pos + 3) == "true" then pos = pos + 4 return true end
        if text:sub(pos, pos + 4) == "false" then pos = pos + 5 return false end
        if text:sub(pos, pos + 3) == "null" then pos = pos + 4 return nil end
        local start = pos
        pos = text:find("[^%-%+%d%.eE]", pos) or (#text + 1)
        return tonumber(text:sub(start, pos - 1))
    end

    return parseValue()
end

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

local function readAll(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*all")
    f:close()
    return body
end

-- why: os.rename on Windows/Wine refuses to clobber an existing target, so the
-- old file has to go first. Writing via a temp name means a crash mid-write
-- cannot leave a half-written snapshot behind.
local function writeAtomic(path, body)
    local tmp = path .. ".tmp"
    local f = io.open(tmp, "wb")
    if f == nil then return false, "cannot open " .. tmp end
    local ok = pcall(function() f:write(body) end)
    f:close()
    if not ok then return false, "write failed" end
    os.remove(path)
    local renamed, err = os.rename(tmp, path)
    if not renamed then os.remove(tmp) return false, tostring(err) end
    return true
end

local INDEX = "storage.json"
local function slotFile(steam, slot) return string.format("stored/%s__%s.json", steam, slot) end

-- why: Lua here has no directory listing, so the index is authoritative rather
-- than a cache that could be rebuilt by scanning. It is also why slot files are
-- flat: there is no mkdir either, so a per-player folder cannot be created for
-- someone we have never seen.
local function readIndex()
    local body = readAll(savedDir .. INDEX)
    if body == nil then return {} end

    -- why: matching %b{} over the WHOLE file grabs the outer object first and
    -- yields exactly one entry however many exist — which silently dropped
    -- everyone's slots on the next write. Isolate the array first.
    local inner = body:match('"slots"%s*:%s*(%b[])')
    if inner == nil then return {} end

    local entries = {}
    for chunk in inner:gmatch("%b{}") do
        local steam = chunk:match('"steam"%s*:%s*"([^"]*)"')
        local slot = chunk:match('"slot"%s*:%s*"([^"]*)"')
        if steam and slot then
            entries[#entries + 1] = {
                steam = steam,
                slot = slot,
                species = chunk:match('"species"%s*:%s*"([^"]*)"'),
                storedAt = tonumber(chunk:match('"storedAt"%s*:%s*(%d+)') or ""),
            }
        end
    end
    return entries
end

local function writeIndex(entries)
    return writeAtomic(savedDir .. INDEX,
        encodeValue({ version = SCHEMA_VERSION, updatedAt = os.time(), slots = arr(entries) }, 0) .. "\n")
end

local function slotsOf(steam)
    local mine = {}
    for _, entry in ipairs(readIndex()) do
        if entry.steam == steam then mine[#mine + 1] = entry end
    end
    return mine
end

-- why: index first when removing. An entry pointing at a deleted file breaks
-- restore; an orphaned file is inert.
local function removeSlot(steam, slot)
    local kept, found = {}, false
    for _, entry in ipairs(readIndex()) do
        if entry.steam == steam and entry.slot == slot then found = true
        else kept[#kept + 1] = entry end
    end
    if not found then return false, "no such slot" end
    local ok, err = writeIndex(kept)
    if not ok then return false, err end
    os.remove(savedDir .. slotFile(steam, slot))
    return true
end

-- ---------------------------------------------------------------------------
-- Capture
--
-- Every read below is a scalar getter, a POD struct field, or an FName via
-- :ToString(). Struct userdata is read inside one call and never held across
-- ticks — caching it causes a stale-pointer crash about a second later.
-- ---------------------------------------------------------------------------

local VITALS = {
    { "health", "GetHealth", "SetHealth" },
    { "stamina", "GetStamina", "SetStamina" },
    { "hunger", "GetHunger", "SetHunger" },
    { "thirst", "GetThirst", "SetThirst" },
    { "oxygen", "GetOxygen", "SetOxygen" },
    { "blood", "GetBlood", "SetBlood" },
    { "lockedDamage", "GetLockedDamage", "SetLockedDamage" },
    { "foodValue", "GetFoodValue", "SetFoodValue" },
    { "rottenValue", "GetRottenValue", "SetRottenValue" },
}

local MAXES = {
    { "maxHunger", "GetMaxHunger", "SetMaxHunger" },
    { "maxFoodValue", "GetMaxFoodValue", "SetMaxFoodValue" },
    { "maxThirst", "GetMaxThirst", "SetMaxThirst" },
    { "maxStamina", "GetMaxStamina", "SetMaxStamina" },
}

local NUTRIENTS = {
    "CarbValue", "ProteinValue", "LipidValue", "BonesValue",
    "CannibalValue", "MagyValue", "RottenFleshValue", "MushroomsValue",
}

local MUTATION_SLOTS = {
    "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4",
    "ParentMutationSlot1", "ParentMutationSlot2", "ParentMutationSlot3", "ParentMutationSlot4",
    "ElderMutationSlot1A", "ElderMutationSlot2A", "ElderMutationSlot3A", "ElderMutationSlot4A",
    "ElderMutationSlot1B", "ElderMutationSlot2B", "ElderMutationSlot3B", "ElderMutationSlot4B",
}

local function capture(pawn, steam)
    local state = {
        version = SCHEMA_VERSION,
        steam = steam,
        storedAt = os.time(),
        vitals = {}, maxVitals = {}, nutrients = {},
        mutations = {}, primeData = {}, unlockRequiredMutations = arr({}),
    }

    pcall(function() state.classPath = stripClassPrefix(pawn:GetClass():GetFullName()) end)
    state.species = speciesOf(state.classPath)
    state.growth = callNumber(pawn, "GetGrowth")
    state.isFemale = callBool(pawn, "IsFemale")
    -- why: no SetIsFemale exists, so gender is recorded for display only.
    state.elderStacks = callNumber(pawn, "GetElderReplicationStacks")

    for _, v in ipairs(VITALS) do state.vitals[v[1]] = callNumber(pawn, v[2]) end
    for _, m in ipairs(MAXES) do state.maxVitals[m[1]] = callNumber(pawn, m[2]) end

    -- why: prime lives in a struct, not a bool. The engine RECOMPUTES
    -- bIsEligiblePrime from the ten condition flags, so all eleven must travel
    -- together or the restored dino loses its prime progress.
    pcall(function()
        local pe = pawn:GetEligiblePrimeElderData()
        if pe == nil then return end
        for i = 1, 10 do
            local field = string.format("bPrimeCondition%d", i)
            local v
            if pcall(function() v = pe[field] end) and type(v) == "boolean" then
                state.primeData[field] = v
            end
        end
        local cached
        if pcall(function() cached = pe.bIsEligiblePrime end) and type(cached) == "boolean" then
            state.primeData.bIsEligiblePrime = cached
        end
    end)

    pcall(function()
        local nut = pawn.NutrientsStruct
        if nut == nil then return end
        for _, field in ipairs(NUTRIENTS) do
            local v
            if pcall(function() v = nut[field] end) and type(v) == "number" then
                state.nutrients[field] = v
            end
        end
        local mal
        if pcall(function() mal = nut.bMalnutrition end) and type(mal) == "boolean" then
            state.nutrients.bMalnutrition = mal
        end
    end)

    pcall(function()
        local mut = pawn.ReplicatedMutationsData
        if mut == nil then return end
        for _, field in ipairs(MUTATION_SLOTS) do
            local v
            if pcall(function() v = mut[field] end) then
                local s = safeString(v)
                if s ~= "" and s ~= "None" then state.mutations[field] = s end
            end
        end
    end)

    -- why: pawn-local and lost on respawn, because respawn rehydrates from
    -- stale TIPlayerData. Must be captured before the pawn dies.
    pcall(function()
        local req = pawn.MutationsRequirementsData
        if req == nil or req.UnlockRequiredMutations == nil then return end
        req.UnlockRequiredMutations:ForEach(function(_, elem)
            local value = unwrap(elem) or elem
            local s = safeString(value)
            if s ~= "" and s ~= "None" then
                state.unlockRequiredMutations[#state.unlockRequiredMutations + 1] = s
            end
        end)
    end)

    return state
end

-- ---------------------------------------------------------------------------
-- Restore
--
-- why: ordering is mandatory, not stylistic. SetGrowth recomputes and REFILLS
-- every max vital, and the engine rejects mutation writes that land in the same
-- tick as bulk state writes. Stages run 500ms apart and the pawn is re-derived
-- each time, because caching a pawn pointer across ticks crashes.
-- ---------------------------------------------------------------------------

local fastTick = 0
local pendingKills = {}
local pendingRestores = {}
local writeResult -- forward declaration; defined with the command interface

-- why: some values have no Set* UFunction at all (SetFoodValue does not exist
-- on 0.21.720) and some setters exist but silently no-op. Try the setter, fall
-- back to a direct property write, then read it back and prove it landed.
local function applyVerified(pawn, setter, getter, value, results)
    if value == nil then return end
    local how = setter
    local ok = pcall(function() pawn[setter](pawn, value) end)
    if not ok then
        local prop = setter:gsub("^Set", "")
        ok = pcall(function() pawn[prop] = value end)
        how = prop .. "="
    end

    local note = ok and "" or "!ERR"
    if getter ~= nil then
        local back = callNumber(pawn, getter)
        if back == nil then note = note .. "!UNVERIFIED"
        elseif math.abs(back - value) > math.max(0.5, math.abs(value) * 0.01) then
            note = note .. string.format("!GOT=%.0f", back)
        end
    end
    results[#results + 1] = how .. note
end

local function applyVitals(pawn, state, label)
    local results = {}
    -- Maxes before currents: a current above its max gets clamped.
    for _, m in ipairs(MAXES) do applyVerified(pawn, m[3], m[2], state.maxVitals[m[1]], results) end
    for _, v in ipairs(VITALS) do applyVerified(pawn, v[3], v[2], state.vitals[v[1]], results) end
    log(string.format("  restore[%s]: %s", label, table.concat(results, " ")))
end

local function stage(steam, state, slot, n, delay, resultId)
    pendingRestores[#pendingRestores + 1] = {
        steam = steam, state = state, slot = slot, stage = n,
        due = fastTick + (delay or 1), resultId = resultId,
    }
end

local function runStage(job)
    local pawn, err = resolvePlayer(job.steam)
    if pawn == nil then
        log(string.format("restore: %s aborted at stage %d — %s", job.steam, job.stage, err))
        if job.resultId then writeResult(job.resultId, "restore", job.steam, false, err) end
        return
    end

    local state = job.state

    if job.stage == 1 then
        if state.growth ~= nil then
            local ok = pcall(function() pawn:SetGrowth(state.growth) end)
            log(string.format("  restore[growth]: %s%s", tostring(state.growth), ok and "" or " !FAILED"))
        end
        applyVitals(pawn, state, "vitals-1")

        -- why: ServerSetPrimeEligible only writes a cached bool the engine
        -- recomputes away within one frame. The struct is the real path.
        if next(state.primeData) ~= nil then
            local ok = pcall(function()
                local pe = pawn:GetEligiblePrimeElderData()
                if pe == nil then return end
                for i = 1, 10 do
                    local field = string.format("bPrimeCondition%d", i)
                    if state.primeData[field] ~= nil then pe[field] = state.primeData[field] end
                end
                if state.primeData.bIsEligiblePrime ~= nil then
                    pe.bIsEligiblePrime = state.primeData.bIsEligiblePrime
                end
                pawn:SetEligiblePrimeElderData(pe)
            end)
            log("  restore[prime]: " .. (ok and "ok" or "FAILED"))
        end
        stage(job.steam, state, job.slot, 2, 1, job.resultId)

    elseif job.stage == 2 or job.stage == 3 then
        -- why: SetSlotNEquippedMutation silently rejects calls in the same tick
        -- as bulk writes, only commits the last of a rapid batch, and fails
        -- validation on freshly restored Life 2+ dinos. Writing the struct
        -- fields directly and forcing replication bypasses all three.
        local active = job.stage == 2
        local written = 0
        local ok = pcall(function()
            local mut = pawn.ReplicatedMutationsData
            if mut == nil then return end
            for _, field in ipairs(MUTATION_SLOTS) do
                local isActive = field:match("^MutationSlot%d$") ~= nil
                if isActive == active then
                    local value = state.mutations[field]
                    if value ~= nil then
                        mut[field] = FName(value)
                        written = written + 1
                    end
                end
            end
            pawn:SetReplicatedMutationsData(mut, true)
        end)
        log(string.format("  restore[mutations-%s]: %d written%s",
            active and "active" or "inherited", written, ok and "" or " FAILED"))
        stage(job.steam, state, job.slot, job.stage + 1, 1, job.resultId)

    elseif job.stage == 4 then
        local ok = pcall(function()
            local nut = pawn.NutrientsStruct
            if nut == nil then return end
            for _, field in ipairs(NUTRIENTS) do
                if state.nutrients[field] ~= nil then nut[field] = state.nutrients[field] end
            end
            if state.nutrients.bMalnutrition ~= nil then
                nut.bMalnutrition = state.nutrients.bMalnutrition
            end
            pawn:SetNutrientsStruct(nut, true)
        end)
        log("  restore[nutrients]: " .. (ok and "ok" or "FAILED"))
        stage(job.steam, state, job.slot, 5, 1, job.resultId)

    elseif job.stage == 5 then
        -- why: mutation staging disturbs GAS attributes, so vitals go on again.
        applyVitals(pawn, state, "vitals-2")
        stage(job.steam, state, job.slot, 6, 1, job.resultId)

    elseif job.stage == 6 then
        -- why: this counter ALONE decides mutation tier. Slot type does not.
        -- Skip it and a restored Life 3 dino silently behaves as Life 1.
        if state.elderStacks ~= nil and state.elderStacks > 0 then
            local ok = pcall(function() pawn:SetElderReplicationStacks(state.elderStacks) end)
            log(string.format("  restore[elderStacks]: %d%s", state.elderStacks, ok and "" or " FAILED"))
        end

        local growthNow = callNumber(pawn, "GetGrowth")
        local landed = growthNow ~= nil and math.abs(growthNow - (state.growth or 0)) < 0.01

        local msg
        if landed then
            -- why: consume the slot. Otherwise a snapshot is an unlimited
            -- supply of that dinosaur — die, restore, repeat.
            local removed = removeSlot(job.steam, job.slot)
            msg = string.format("restored your %s%s", state.species,
                removed and "" or " (WARNING: slot could not be cleared)")
        else
            msg = string.format("restore finished but growth reads %s, expected %s; slot kept",
                tostring(growthNow), tostring(state.growth))
        end

        log(string.format("restore: %s %s", job.steam, msg))
        if job.resultId then writeResult(job.resultId, "restore", job.steam, landed, msg) end
    end
end

-- ---------------------------------------------------------------------------
-- Commands (NDJSON over files — Lua here has no sockets)
-- ---------------------------------------------------------------------------

local INBOX = "inbox.ndjson"
local PROCESSING = "inbox.processing"
local RESULTS = "results.ndjson"
local PROCESSED = "processed.json"

local RESULTS_MAX_BYTES = 256 * 1024
local RESULTS_KEEP = 200

local function appendLine(path, line)
    local f = io.open(path, "ab")
    if f == nil then return false end
    f:write(line .. "\n")
    f:close()
    return true
end

writeResult = function(id, verb, steam, ok, msg, data)
    local parts = {
        string.format('"id":"%s"', jsonEscape(tostring(id or ""))),
        string.format('"ts":%d', os.time()),
        string.format('"verb":"%s"', jsonEscape(tostring(verb or ""))),
        string.format('"steam":"%s"', jsonEscape(tostring(steam or ""))),
        string.format('"ok":%s', ok and "true" or "false"),
        string.format('"msg":"%s"', jsonEscape(tostring(msg or ""))),
    }
    if data ~= nil then parts[#parts + 1] = '"data":' .. data end
    appendLine(savedDir .. RESULTS, "{" .. table.concat(parts, ",") .. "}")
end

-- why: append-only would grow without limit, and the bot re-reads this file
-- while waiting for a reply.
local function rotateResults()
    local path = savedDir .. RESULTS
    local f = io.open(path, "rb")
    if f == nil then return end
    local size = f:seek("end")
    f:close()
    if size == nil or size <= RESULTS_MAX_BYTES then return end

    local body = readAll(path)
    if body == nil then return end
    local lines = {}
    for line in body:gmatch("[^\r\n]+") do lines[#lines + 1] = line end
    if #lines <= RESULTS_KEEP then return end

    local kept = {}
    for i = #lines - RESULTS_KEEP + 1, #lines do kept[#kept + 1] = lines[i] end
    if writeAtomic(path, table.concat(kept, "\n") .. "\n") then
        log(string.format("results rotated: %d -> %d lines", #lines, #kept))
    end
end

-- why: a writer doing read-append-write on the inbox can race the rename that
-- claims it, putting an already-executed command back. Without this, that
-- command runs twice — a second kill, or a slot consumed twice.
local processedIds, processedOrder = {}, {}
local PROCESSED_KEEP = 300

local function loadProcessed()
    local body = readAll(savedDir .. PROCESSED)
    if body == nil then return end
    for id in body:gmatch('"([^"]+)"') do
        if not processedIds[id] then
            processedIds[id] = true
            processedOrder[#processedOrder + 1] = id
        end
    end
end

local function markProcessed(id)
    if id == nil or id == "" or processedIds[id] then return end
    processedIds[id] = true
    processedOrder[#processedOrder + 1] = id

    if #processedOrder > PROCESSED_KEEP * 2 then
        local trimmed = {}
        for i = #processedOrder - PROCESSED_KEEP + 1, #processedOrder do
            trimmed[#trimmed + 1] = processedOrder[i]
        end
        processedIds = {}
        for _, kept in ipairs(trimmed) do processedIds[kept] = true end
        processedOrder = trimmed
    end

    local quoted = {}
    for _, id2 in ipairs(processedOrder) do quoted[#quoted + 1] = '"' .. jsonEscape(id2) .. '"' end
    writeAtomic(savedDir .. PROCESSED, "[" .. table.concat(quoted, ",") .. "]\n")
end

-- ---- verbs ----------------------------------------------------------------

-- why: guards against a second command landing mid-pipeline, which would
-- capture a 5%-growth pawn over the real snapshot. Time-boxed so a crashed
-- pipeline cannot lock someone out.
local busyUntil = {}
local function busy(steam)
    local until_ = busyUntil[steam]
    if until_ ~= nil and os.time() <= until_ then return true end
    busyUntil[steam] = nil
    return false
end

local function handleList(cmd)
    local mine = slotsOf(cmd.steam)
    local items = {}
    for _, entry in ipairs(mine) do
        items[#items + 1] = string.format('{"slot":"%s","species":"%s","storedAt":%d}',
            jsonEscape(entry.slot), jsonEscape(entry.species or "Unknown"), entry.storedAt or 0)
    end
    writeResult(cmd.id, "list", cmd.steam, true,
        string.format("%d of %d slots used", #mine, MAX_SLOTS),
        "[" .. table.concat(items, ",") .. "]")
end

local function handleStore(cmd)
    local slot = cmd.args and cmd.args.slot
    if not slotNameOk(slot) then
        writeResult(cmd.id, "store", cmd.steam, false,
            "slot names can be 1-24 letters, numbers, dashes or underscores")
        return
    end
    if busy(cmd.steam) then
        writeResult(cmd.id, "store", cmd.steam, false, "your last action is still finishing")
        return
    end

    local mine, exists = slotsOf(cmd.steam), false
    for _, entry in ipairs(mine) do
        if entry.slot == slot then exists = true end
    end
    if exists then
        writeResult(cmd.id, "store", cmd.steam, false,
            string.format("you already have a slot called %s", slot))
        return
    end
    if #mine >= MAX_SLOTS then
        writeResult(cmd.id, "store", cmd.steam, false,
            string.format("all %d slots are full — delete one first", MAX_SLOTS))
        return
    end

    local pawn, err = resolvePlayer(cmd.steam)
    if pawn == nil then
        writeResult(cmd.id, "store", cmd.steam, false, err)
        return
    end

    local isDino, reason = dinosaurCheck(pawn)
    if not isDino then
        writeResult(cmd.id, "store", cmd.steam, false, reason)
        return
    end

    local growth = callNumber(pawn, "GetGrowth")
    if growth == nil or growth < MIN_GROWTH then
        writeResult(cmd.id, "store", cmd.steam, false, string.format(
            "only fully grown dinosaurs can be stored — you are at %.0f%%", (growth or 0) * 100))
        return
    end

    local state = capture(pawn, cmd.steam)
    state.slot = slot

    local ok, err2 = writeAtomic(savedDir .. slotFile(cmd.steam, slot), encodeValue(state, 0) .. "\n")
    if not ok then
        -- why: abort WITHOUT killing. Losing the dinosaur with no snapshot is
        -- the one outcome this feature must never produce.
        writeResult(cmd.id, "store", cmd.steam, false,
            "could not save your dinosaur, so nothing was changed: " .. tostring(err2))
        return
    end

    -- Index after the file: an orphaned file is recoverable, an index entry
    -- pointing at a missing file is not.
    local entries = readIndex()
    entries[#entries + 1] = {
        steam = cmd.steam, slot = slot, species = state.species, storedAt = state.storedAt,
    }
    if not writeIndex(entries) then
        os.remove(savedDir .. slotFile(cmd.steam, slot))
        writeResult(cmd.id, "store", cmd.steam, false, "could not update storage, nothing was changed")
        return
    end

    -- why: shrink BEFORE zeroing food. SetGrowth refills FoodValue, so the
    -- other order silently undoes itself and leaves a full-size corpse feeding
    -- the whole server.
    local shrink = {}
    applyVerified(pawn, "SetGrowth", "GetGrowth", SHRINK_GROWTH, shrink)
    applyVerified(pawn, "SetFoodValue", "GetFoodValue", 0, shrink)
    applyVerified(pawn, "SetRottenValue", "GetRottenValue", 0, shrink)
    log("  store[shrink]: " .. table.concat(shrink, " "))

    busyUntil[cmd.steam] = os.time() + 15
    pendingKills[#pendingKills + 1] = {
        steam = cmd.steam, slot = slot, species = state.species,
        due = fastTick + KILL_DELAY_TICKS, resultId = cmd.id,
    }
    log(string.format("store: %s -> %s (%s)", cmd.steam, slot, state.species))
end

local function handleRestore(cmd)
    local slot = cmd.args and cmd.args.slot
    if not slotNameOk(slot) then
        writeResult(cmd.id, "restore", cmd.steam, false, "that is not a valid slot name")
        return
    end
    if busy(cmd.steam) then
        writeResult(cmd.id, "restore", cmd.steam, false, "your last action is still finishing")
        return
    end

    local body = readAll(savedDir .. slotFile(cmd.steam, slot))
    if body == nil then
        writeResult(cmd.id, "restore", cmd.steam, false, "nothing is stored in that slot")
        return
    end

    local parsed
    local okParse = pcall(function() parsed = jsonParse(body) end)
    if not okParse or type(parsed) ~= "table" or parsed.version ~= SCHEMA_VERSION then
        writeResult(cmd.id, "restore", cmd.steam, false, "that snapshot could not be read")
        return
    end

    parsed.vitals = parsed.vitals or {}
    parsed.maxVitals = parsed.maxVitals or {}
    parsed.nutrients = parsed.nutrients or {}
    parsed.mutations = parsed.mutations or {}
    parsed.primeData = parsed.primeData or {}

    local pawn, err = resolvePlayer(cmd.steam)
    if pawn == nil then
        writeResult(cmd.id, "restore", cmd.steam, false, err)
        return
    end

    local isDino, reason, classPath = dinosaurCheck(pawn)
    if not isDino then
        writeResult(cmd.id, "restore", cmd.steam, false, reason)
        return
    end

    -- why: cross-species restore breaks the nest visual and can crash
    -- coexisting nest-persistence mods with 0xffffffffffffffff access
    -- violations. Same species only.
    local liveSpecies = speciesOf(classPath)
    if parsed.species ~= nil and liveSpecies ~= parsed.species then
        writeResult(cmd.id, "restore", cmd.steam, false, string.format(
            "that slot holds a %s but you are playing a %s", parsed.species, liveSpecies))
        return
    end

    busyUntil[cmd.steam] = os.time() + 20
    log(string.format("restore: %s <- %s (%s)", cmd.steam, slot, parsed.species))
    stage(cmd.steam, parsed, slot, 1, 0, cmd.id)
end

local function handleDelete(cmd)
    local slot = cmd.args and cmd.args.slot
    if not slotNameOk(slot) then
        writeResult(cmd.id, "delete", cmd.steam, false, "that is not a valid slot name")
        return
    end
    local ok, err = removeSlot(cmd.steam, slot)
    writeResult(cmd.id, "delete", cmd.steam, ok,
        ok and ("deleted " .. slot) or ("nothing is stored in that slot (" .. tostring(err) .. ")"))
end

-- why: shrink first here too. Slaying a full-grown dinosaur would otherwise
-- drop a corpse that feeds everyone nearby, turning a self-kill into a way to
-- hand out free food.
local function handleSlay(cmd)
    if busy(cmd.steam) then
        writeResult(cmd.id, "slay", cmd.steam, false, "your last action is still finishing")
        return
    end

    local pawn, err = resolvePlayer(cmd.steam)
    if pawn == nil then
        writeResult(cmd.id, "slay", cmd.steam, false, err)
        return
    end

    local isDino, reason, classPath = dinosaurCheck(pawn)
    if not isDino then
        writeResult(cmd.id, "slay", cmd.steam, false, reason)
        return
    end

    local species = speciesOf(classPath)
    local shrink = {}
    applyVerified(pawn, "SetGrowth", "GetGrowth", SHRINK_GROWTH, shrink)
    applyVerified(pawn, "SetFoodValue", "GetFoodValue", 0, shrink)
    applyVerified(pawn, "SetRottenValue", "GetRottenValue", 0, shrink)
    log("  slay[shrink]: " .. table.concat(shrink, " "))

    busyUntil[cmd.steam] = os.time() + 15
    pendingKills[#pendingKills + 1] = {
        steam = cmd.steam, species = species, slay = true,
        due = fastTick + KILL_DELAY_TICKS, resultId = cmd.id,
    }
    log(string.format("slay: %s (%s)", cmd.steam, species))
end

-- Read-only snapshot of who is playing what. Carries no names or positions —
-- it exists to answer "what is on the server", not to track anyone.
local function handlePlayers(cmd)
    local items = {}

    for _, p in ipairs(onlinePlayers()) do
        if p.pawn ~= nil then
            local isDino, _, classPath = dinosaurCheck(p.pawn)
            if isDino then
                local growth = callNumber(p.pawn, "GetGrowth") or 0
                local female = callBool(p.pawn, "IsFemale")

                local prime = false
                pcall(function()
                    local pe = p.pawn:GetEligiblePrimeElderData()
                    if pe ~= nil and pe.bIsEligiblePrime == true then prime = true end
                end)

                items[#items + 1] = string.format(
                    '{"species":"%s","growth":%.4f,"female":%s,"prime":%s}',
                    jsonEscape(speciesOf(classPath)), growth,
                    female and "true" or "false", prime and "true" or "false")
            end
        end
    end

    writeResult(cmd.id, "players", cmd.steam, true,
        string.format("%d playing", #items), "[" .. table.concat(items, ",") .. "]")
end

-- ---------------------------------------------------------------------------
-- Gift
--
-- why this works without a live pawn: restore compares only `species` against
-- whatever the player is playing — the stored classPath is never read back. So
-- a snapshot can be synthesised for someone who is offline, and they collect it
-- by spawning that species and releasing it like anything else.
--
-- Vitals are deliberately left empty. SetGrowth recomputes and refills every
-- max vital anyway (see NOTES), so a gifted dinosaur arrives healthy rather
-- than carrying somebody else's hunger.
-- ---------------------------------------------------------------------------

local function handleGive(cmd)
    local args = cmd.args or {}
    local slot = args.slot
    local species = args.species

    if not slotNameOk(slot) then
        writeResult(cmd.id, "give", cmd.steam, false, "that is not a valid slot name")
        return
    end
    if type(species) ~= "string" or species == "" then
        writeResult(cmd.id, "give", cmd.steam, false, "no species given")
        return
    end

    local mine = slotsOf(cmd.steam)
    if #mine >= MAX_SLOTS then
        writeResult(cmd.id, "give", cmd.steam, false, string.format(
            "their storage is full (%d of %d)", #mine, MAX_SLOTS))
        return
    end
    for _, entry in ipairs(mine) do
        if entry.slot == slot then
            writeResult(cmd.id, "give", cmd.steam, false, "they already have a slot with that name")
            return
        end
    end

    local growth = tonumber(args.growth) or 1.0
    if growth > 1 then growth = 1 end
    if growth < 0.05 then growth = 0.05 end

    local state = {
        version = SCHEMA_VERSION,
        steam = cmd.steam,
        storedAt = os.time(),
        slot = slot,
        species = species,
        classPath = "",
        growth = growth,
        isFemale = args.female == true,
        elderStacks = tonumber(args.elderStacks) or 0,
        vitals = {}, maxVitals = {}, nutrients = {},
        mutations = {}, primeData = {}, unlockRequiredMutations = arr({}),
        giftedBy = tostring(args.by or "an admin"),
    }

    -- Mutations arrive as a plain list and are laid into the active slots in
    -- order. Anything past the four active slots is ignored rather than spilling
    -- into the inherited ones, which are not the admin's to set.
    if type(args.mutations) == "table" then
        local n = 0
        for _, name in ipairs(args.mutations) do
            if type(name) == "string" and name ~= "" and n < 4 then
                n = n + 1
                state.mutations["MutationSlot" .. n] = name
            end
        end
    end

    local ok, err = writeAtomic(savedDir .. slotFile(cmd.steam, slot), encodeValue(state, 0) .. "\n")
    if not ok then
        writeResult(cmd.id, "give", cmd.steam, false, "could not write the slot: " .. tostring(err))
        return
    end

    local entries = readIndex()
    entries[#entries + 1] = {
        steam = cmd.steam, slot = slot, species = species, storedAt = state.storedAt,
    }
    if not writeIndex(entries) then
        os.remove(savedDir .. slotFile(cmd.steam, slot))
        writeResult(cmd.id, "give", cmd.steam, false, "could not update storage, nothing was changed")
        return
    end

    log(string.format("give: %s <- %s (%s, %.0f%%)", cmd.steam, slot, species, growth * 100))
    writeResult(cmd.id, "give", cmd.steam, true, string.format(
        "%s added to their archive as %s", species, slot))
end

local function dispatch(cmd)
    if type(cmd) ~= "table" then return end

    if processedIds[cmd.id] then
        log("inbox: ignoring duplicate " .. tostring(cmd.id))
        return
    end
    markProcessed(cmd.id)

    local verb = tostring(cmd.verb or ""):lower()

    -- `players` is an aggregate query asked on nobody's behalf, so it does not
    -- need a real Steam ID attached.
    if verb ~= "players" and not isSteamId(cmd.steam) then
        writeResult(cmd.id, cmd.verb, cmd.steam, false, "invalid steam id")
        return
    end

    if verb == "store" then handleStore(cmd)
    elseif verb == "restore" then handleRestore(cmd)
    elseif verb == "list" then handleList(cmd)
    elseif verb == "delete" then handleDelete(cmd)
    elseif verb == "slay" then handleSlay(cmd)
    elseif verb == "players" then handlePlayers(cmd)
    elseif verb == "give" then handleGive(cmd)
    else writeResult(cmd.id, verb, cmd.steam, false, "unknown command: " .. verb) end
end

local function pollInbox()
    if savedDir == nil then return end
    local inbox = savedDir .. INBOX
    local probe = io.open(inbox, "rb")
    if probe == nil then return end
    probe:close()

    -- Claim the file before reading it, so a writer appending mid-parse cannot
    -- have its command silently truncated away.
    local processing = savedDir .. PROCESSING
    os.remove(processing)
    if not os.rename(inbox, processing) then return end

    local body = readAll(processing)
    os.remove(processing)
    if body == nil then return end

    for line in body:gmatch("[^\r\n]+") do
        if line:match("%S") then
            local ok, cmd = pcall(jsonParse, line)
            if ok then safeCall("dispatch", function() dispatch(cmd) end)
            else log("inbox: unparseable line") end
        end
    end
end

-- ---------------------------------------------------------------------------
-- Hot reload
--
-- why: an empty read means we caught the writer mid-upload. Deleting the flag
-- then would silently swallow the command — which once made a deploy look
-- successful while the old code kept running.
-- ---------------------------------------------------------------------------

local emptyFlagSeen = {}

local function consumeFlag(path)
    local f = io.open(path, "rb")
    if f == nil then emptyFlagSeen[path] = nil return nil end
    local body = f:read("*all")
    f:close()
    body = (body or ""):gsub("^%s+", ""):gsub("%s+$", "")

    if body == "" then
        local seen = (emptyFlagSeen[path] or 0) + 1
        emptyFlagSeen[path] = seen
        if seen >= 3 then
            os.remove(path)
            emptyFlagSeen[path] = nil
        end
        return nil
    end

    os.remove(path)
    emptyFlagSeen[path] = nil
    return body
end

-- ---------------------------------------------------------------------------
-- Account linking via chat
--
-- The bot shows a code in Discord and the player types "!link CODE" in game.
-- Typing it in game is what proves they control the Steam account.
--
-- why this way round: the reverse (server sends the code in game) puts the code
-- in a notification that vanishes after a second, which is a miserable thing to
-- have to read and retype accurately.
-- ---------------------------------------------------------------------------

local LINK_PATTERN = "^%s*!link%s+([%w]+)%s*$"

-- why: the chat hook can fire more than once for a single message, so identical
-- (sender, text) pairs inside a short window are ignored.
local recentChat = {}
local CHAT_DEDUPE_SEC = 3

local chatShapeLogged = false

local function onChat(a, b, c)
    -- The parameter layout is not documented, so try each one as the controller
    -- and as the text rather than assuming an order.
    local params = { unwrap(a) or a, unwrap(b) or b, unwrap(c) or c }

    local steam, text = "", ""
    for _, param in ipairs(params) do
        if param ~= nil then
            if steam == "" then
                local candidate = steamIdOf(param)
                if isSteamId(candidate) then steam = candidate end
            end
            if text == "" then
                local candidate = safeString(param)
                -- A steam ID is not the message; neither is an empty read.
                if candidate ~= "" and not isSteamId(candidate) then text = candidate end
            end
        end
    end

    if not chatShapeLogged then
        chatShapeLogged = true
        log(string.format("chat hook: steam=%q text=%q", steam, text:sub(1, 40)))
    end

    if steam == "" or text == "" then return end

    local now = os.time()

    local code = text:match(LINK_PATTERN)
    if code ~= nil then
        local key = steam .. "|" .. code
        if recentChat[key] ~= nil and (now - recentChat[key]) < CHAT_DEDUPE_SEC then return end
        recentChat[key] = now

        log(string.format("link: %s offered code %s", steam, code:upper()))
        -- The bot watches the results file for these and matches the code
        -- against whoever asked for it in Discord.
        writeResult("chat-" .. steam .. "-" .. tostring(now), "linkcode", steam, true, code:upper())
        return
    end

    -- why the bot answers instead of the mod: UpdateChat is unreachable from
    -- Lua (rule 13), so the mod can read chat but cannot write to it. It raises
    -- the request and the bot replies over RCON.
    if text:match("^%s*!discord%s*$") then
        local key = steam .. "|discord"
        if recentChat[key] ~= nil and (now - recentChat[key]) < CHAT_DEDUPE_SEC then return end
        recentChat[key] = now

        log(string.format("discord: %s asked for the invite", steam))
        writeResult("chat-" .. steam .. "-" .. tostring(now), "discordreq", steam, true, "")
    end
end

-- ---------------------------------------------------------------------------
-- Ticks
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Kill attribution
--
-- why this shape: Evrima has **no server-side death event**. OnDeath,
-- OnPawnDeath, SetHealth and SetIsAlive all either never fire or fire
-- unreliably on a natural death (upstream EVRIMA_KillFeed_Design). So the only
-- workable split is: ApplyDamage says who hit whom, polling says who died, and
-- a time window joins the two.
--
-- ApplyDamage covers **direct player attacks only** — never damage over time,
-- environmental or AI damage. Those deaths are real and will have no attacker.
--
-- Stage 1: record and log only. Nothing depends on this yet; it exists to prove
-- the hook fires on this build before any leaderboard is built on top.
-- ---------------------------------------------------------------------------

local HIT_WINDOW_SEC = 20

local lastHit = {}      -- victim steam -> { by = attacker steam, at = unix }
local lastHealth = {}   -- steam -> last health seen, for the >0 to 0 edge
local hitSeen = 0

local function steamIdOfPawn(pawn)
    if pawn == nil then return "" end
    -- why: never keep this controller. Take the ID and drop the pointer.
    local ctrl
    pcall(function() ctrl = pawn:GetController() end)
    if ctrl == nil then pcall(function() ctrl = pawn.Controller end) end
    return steamIdOf(ctrl)
end

local function pruneHits()
    hitSeen = hitSeen + 1
    if hitSeen < 200 then return end
    hitSeen = 0
    local cutoff = os.time() - HIT_WINDOW_SEC
    for victim, hit in pairs(lastHit) do
        if hit.at < cutoff then lastHit[victim] = nil end
    end
end

local function speciesOfPawn(pawn)
    if pawn == nil then return "" end
    local isDino, _, classPath = dinosaurCheck(pawn)
    if not isDino then return "" end
    return speciesOf(classPath)
end

local function onApplyDamage(selfParam, targetParam)
    local attackerPawn = unwrap(selfParam)
    local attacker = steamIdOfPawn(attackerPawn)
    local victim = steamIdOfPawn(unwrap(targetParam))

    -- Self-damage and anything involving AI carries no Steam ID on one side.
    if attacker == "" or victim == "" or attacker == victim then return end

    -- The attacker's species is only readable here, while we hold their pawn.
    -- By the time the victim dies they may have moved on, and caching the pawn
    -- itself would be a stale pointer.
    lastHit[victim] = {
        by = attacker,
        at = os.time(),
        bySpecies = speciesOfPawn(attackerPawn),
    }
    pruneHits()
end

local function emitDeath(steam, pawn, cause)
    local species = speciesOfPawn(pawn)

    -- Attribution is best-effort by design: only a direct player attack leaves
    -- a hit, so anything else — bleed, starvation, drowning, AI, a fall — dies
    -- unattributed. That is a real gap, not a bug to paper over.
    local killer, killerSpecies = "", ""
    local hit = lastHit[steam]
    if hit ~= nil and (os.time() - hit.at) <= HIT_WINDOW_SEC then
        killer = hit.by
        killerSpecies = hit.bySpecies or ""
    end
    lastHit[steam] = nil

    log(killer ~= ""
        and string.format("kill: %s (%s) killed %s (%s)", killer, killerSpecies, steam, species)
        or string.format("death: %s (%s, %s)", steam, species, cause))

    writeResult("kill-" .. steam .. "-" .. tostring(os.time()), "kill", steam, true, species,
        string.format(
            '{"killer":"%s","killerSpecies":"%s","victim":"%s","species":"%s","cause":"%s"}',
            killer, jsonEscape(killerSpecies), steam, jsonEscape(species), cause))
end

-- why polling: Evrima fires no death event a server can hook, so health
-- crossing to zero is the only trustworthy signal.
--
-- A vanishing pawn is NOT trustworthy on its own. Spectator camera unpossesses
-- the pawn exactly like death does — observed live, and it reported a healthy
-- player as dead. So a vanish only counts when something hit them moments
-- before, which is the case a fast death would otherwise slip through.
local function watchDeaths()
    for _, player in ipairs(onlinePlayers()) do
        local health
        if player.pawn ~= nil then
            pcall(function() health = player.pawn:GetHealth() end)
        end

        local previous = lastHealth[player.steam]

        if type(health) == "number" then
            if previous ~= nil and previous > 0 and health <= 0 then
                emitDeath(player.steam, player.pawn, "health")
                lastHealth[player.steam] = nil
            else
                lastHealth[player.steam] = health
            end
        elseif previous ~= nil and previous > 0 then
            local hit = lastHit[player.steam]
            if hit ~= nil and (os.time() - hit.at) <= HIT_WINDOW_SEC then
                emitDeath(player.steam, nil, "killed")
            end
            -- Otherwise: spectating, disconnecting or on spawn-select. Forget
            -- the health so returning does not look like a resurrection.
            lastHealth[player.steam] = nil
        end
    end
end

if LoopInGameThreadWithDelay == nil then
    log("FATAL: LoopInGameThreadWithDelay unavailable — nothing can run")
else
    loadProcessed()

    pcall(function()
        RegisterHook("/Script/TheIsle.TIPlayerController:SetAdminCred", function(ctrlParam)
            local ctrl = unwrap(ctrlParam)
            if ctrl == nil then return end
            -- why: never cache this pointer. Take the steam ID and drop it.
            local steam = steamIdOf(ctrl)
            if steam ~= "" then presenceSee(steam) end
        end)
    end)

    local chatHooked = pcall(function()
        RegisterHook("/Script/TheIsle.TIPlayerController:GetChatMessage", function(a, b, c)
            safeCall("onChat", function() onChat(a, b, c) end)
        end)
    end)
    log(chatHooked and "chat hook registered (!link CODE)" or "WARNING: chat hook failed — linking will not work")

    -- A failure here must not stop the mod: kills are a nice-to-have, storage
    -- is not.
    local damageHooked = pcall(function()
        RegisterHook("/Script/TheIsle.TICharacterBase:ApplyDamage", function(a, b)
            safeCall("onApplyDamage", function() onApplyDamage(a, b) end)
        end)
    end)
    log(damageHooked and "damage hook registered (kill attribution)"
        or "WARNING: damage hook failed — deaths will all be unattributed")

    -- 1.5s: fast enough that a corpse is usually still readable, slow enough
    -- that it is not walking every controller twice a second.
    LoopInGameThreadWithDelay(1500, function()
        safeCall("watchDeaths", watchDeaths)
    end)

    LoopInGameThreadWithDelay(15000, function()
        safeCall("presence", function()
            local gm = findGameMode()
            if gm ~= nil then seedPresence(gm) end
        end)
    end)

    LoopInGameThreadWithDelay(FAST_TICK_MS, function()
        safeCall("fastTick", function()
            fastTick = fastTick + 1

            if #pendingKills > 0 then
                local keep = {}
                for _, job in ipairs(pendingKills) do
                    if job.due <= fastTick then
                        local pawn = resolvePlayer(job.steam)
                        local ok = pawn ~= nil and pcall(function() pawn:SetHealth(0) end)
                        log(string.format("%s: %s killed%s", job.slay and "slay" or "store",
                            job.steam, ok and "" or " (pawn already gone)"))
                        busyUntil[job.steam] = nil

                        if job.resultId then
                            if job.slay then
                                writeResult(job.resultId, "slay", job.steam, ok,
                                    ok and string.format("your %s is dead", job.species)
                                       or "your dinosaur was already gone")
                            else
                                -- The snapshot is already safe on disk, so a
                                -- vanished pawn is still a success.
                                writeResult(job.resultId, "store", job.steam, true,
                                    string.format("stored your %s in %s", job.species, job.slot))
                            end
                        end
                    else
                        keep[#keep + 1] = job
                    end
                end
                pendingKills = keep
            end

            if #pendingRestores > 0 then
                local keep = {}
                for _, job in ipairs(pendingRestores) do
                    if job.due <= fastTick then
                        safeCall("restoreStage", function() runStage(job) end)
                        if job.stage == 6 then busyUntil[job.steam] = nil end
                    else
                        keep[#keep + 1] = job
                    end
                end
                pendingRestores = keep
            end
        end)
    end)

    local ticks = 0
    LoopInGameThreadWithDelay(POLL_TICK_MS, function()
        safeCall("poll", function()
            ticks = ticks + 1

            if savedDir ~= nil then
                local token = consumeFlag(savedDir .. "reload.flag")
                if token ~= nil then
                    log("reload requested (" .. token .. ")")
                    if RestartCurrentMod ~= nil then RestartCurrentMod() end
                    return
                end
            end

            pollInbox()
            if ticks % 100 == 0 then rotateResults() end
        end)
    end)

    log(string.format("ready — %d slots per player, %.0f%% growth to store", MAX_SLOTS, MIN_GROWTH * 100))
end
