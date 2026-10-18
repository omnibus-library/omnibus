# Browsers, the ownership guard, the iOS simulator, and the Kobo devices

Companion to [SKILL.md](SKILL.md) step 7. The commands are there; this is what
they buy and how the agents use them.

## One browser per agent is not a nicety

Run `r-20260828-01` died because three subagents shared a single browser tab:
one cookie jar, three users collapsed into one, and two agents correctly
aborted rather than journal under a wrong actor. `driver.sh up <N>` gives each
agent its own server, session and browser, which makes that impossible.

Agents drive theirs with `driver.sh run <n> "<command>"`, which prints
`{"text": ..., "isError": ...}`. Hand each agent **its own** number and no
other's, and the `scratch` directory `up` printed for it — its own place for
helper scripts, since the harness's scratchpad is shared. Tear down with
`driver.sh down` (and `ios.sh down`, `kobo.sh down`) when the run ends, whatever the outcome.

`driver.sh console <n> [--errors]` prints what that browser has logged since
its server started — console messages, uncaught page errors, and any rejection
a command left unawaited — so "the page logged a JavaScript error" is a
criterion an agent can check without injecting anything into the page.

## The guard

```bash
scripts/explore/driver.sh guard 1 agent-1
```

Every agent is guarded before any of them starts. On every destructive call
the guard asks `owned.sh` which books the actor owns, so the uuids come from
the journals at that moment, never from the agent — and a book the agent
journals a `book.add` for mid-flow, by upload or by a paper-only check-in, is
destroyable by it on the next call with nothing for you to do. `owned.sh`
reads **every** journal, not just this run's — ownership is durable
provenance, the same reason `provision.sh` keeps usernames stable. Without the
guard, ownership is only a sentence in `start.md` and every exploration
account is an admin, so nothing stops one agent destroying another's books;
with it, the request is refused before it is sent.

A copy note or removal carries a copy id and no book, so the guard asks the
server who filed that copy and lets through only the agent's own. The refusal
is a synthetic 403 carrying the request URL, so the app renders a permission
failure rather than a transport error.

`guard` prints the version of the rules it read back from the page. If it says
the browser still runs an older guard, the page kept a wrapper from before
re-guarding could replace one — `driver.sh restart <n>` and guard again. Any
browser guarded by this `guard.js` or later is re-guarded in place.

After the run, `driver.sh refusals <n>` lists what each agent was stopped from
doing. **A non-empty list is a finding about the agent or the flow document,
not about the app.**

The guard is a `fetch` wrapper inside the page, not DevTools interception.
Routing every request through CDP made Chromium copy each upload body into one
event, and a large audiobook killed the browser before the upload reached the
app (#2361); the wrapper never touches a body it is not about to inspect, so an
upload of any size passes through.

## When a browser dies

`driver.sh run` answers `{"driver": "dead"}` when the agent's server went down
under a command, and `{"driver": "up"}` when the server is fine and the command
never returned — an app hang, or a locator that never matched. The first is the
harness: the agent journals an `issue`, runs `driver.sh restart <n>`, and the
guard is reinstalled — it lives in the old process and does not come back on
its own. A promise a command left unawaited no longer takes the server down
(#2485): its failure comes back as an `unhandled` list on the next `run`
result, and in `console`. `restart` re-registers the server, so `status` still knows it and
`down` still stops it; `down` sweeps the whole port window regardless (#2363),
and `status` names any driver it finds there unregistered.

## The iOS agent

```bash
scripts/explore/ios.sh up            # boot a simulator, build, install, launch
scripts/explore/ios.sh state         # {online, running, forced_offline}
```

**One iOS agent, ever.** Two on one simulator share a keychain, a container and
a session — the same collapse as a shared browser, with no isolation available
to fix it. `--ios` adds one; asking for more is a refusal, not a clamp.

It is a full agent with its own account, so provision `N+1`. `ios.sh up`
uninstalls the app before installing it, so the container — and with it the
previous run's session, downloads and outbox — starts empty (set
`OMNIBUS_IOS_KEEP_CONTAINER=1` to keep it); the brief still tells the agent
to check the You tab first, because a kept container comes up signed in as
the previous run's iOS actor. Give it
`surface: ios`, [`ios_lane.md`](../../../docs/qa/agentic_exploration/ios_lane.md)
alongside `start.md`, and the `offline_outbox` scenario from that file **on top
of** its sampled flows — it is the only surface that can run it. There is no
ownership guard here, so keep it off `adding_book` and `merging_books`.

## Kobo agents

```bash
scripts/explore/kobo.sh up --agent <n> --accounts <accounts.json>   # one agent at a time
scripts/explore/kobo.sh state --agent <n>                           # "running": true
```

`--kobo K` adds K Kobo agents, numbered after the web agents and the iOS agent,
and **several are fine**: each has its own account, `mock-kobo` process, port,
state file and hardware id, so none meets another's library. Each is also a
browser agent, since it turns shelves on and reads the results there, so
`driver.sh up` must reach its number and it gets `driver.sh guard` like any
other. `driver.sh up <M>` numbers from 1, so under `--ios` the iOS agent's
browser starts too and idles; nobody is handed its number.

`up` starts the `mock-kobo` that `OMNIBUS_EXPLORE_MOCK_KOBO` names, or builds one
with cargo through `scripts/with-dev-env.sh`, which needs Nix.

Start the devices one at a time — two `up`s for one agent race. A device keeps
its account's "Mock Kobo" and its `state.json` across runs on purpose: `up`
reuses it when the state file names this instance and that device's token, and
otherwise revokes the old one and registers a new one.
Teardown includes `kobo.sh down`, which stops every device and keeps the state
files and logs.
Give a Kobo agent `surface: kobo`, [`kobo_lane.md`](../../../docs/qa/agentic_exploration/kobo_lane.md)
beside `start.md`, and its number for both `driver.sh` and `kobo.sh`.
