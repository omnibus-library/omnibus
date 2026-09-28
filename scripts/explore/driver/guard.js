// Ownership guard installed into an agent's browser by `driver.sh guard`.
//
// start.md says an agent may only destroy what it added. Until now that was a
// convention in a prompt: every exploration account is an admin, so the server
// will happily let agent-2 delete agent-5's book, and nothing but the agent's
// own compliance stood in the way. This makes it enforced — the request is
// refused in the browser before it reaches the server.
//
// It lives inside the page, as a wrapper around `window.fetch`, and not in
// DevTools request interception. The first version was a `page.route()`
// handler, and that is what killed run r-20260829-01's uploads (#2361):
// routing turns on CDP `Fetch` interception for every request, and Chromium
// then has to copy each request body into one DevTools event before the
// handler can see it — a multi-hundred-MB audiobook took the whole browser
// down with it, before the upload ever reached the app. The wrapper sees the
// same requests (the WASM client's HTTP all goes through `fetch`; nothing in
// the app uses XMLHttpRequest) and never touches a body it is not about to
// inspect, so an upload of any size passes straight through.
//
// State lives in the driver's Node process, reached over bindings, so a
// navigation resets nothing: `driver.sh refusals` reads
// `globalThis.__omnibusGuardRefusals` here, and the approved-merge count that
// lets an undo through survives the page it was earned on.
//
// Ownership is asked of the journals on every destructive call, not baked in
// when the guard is installed: a snapshot left a book the agent created
// mid-flow unownable until the runner re-guarded by hand (#2486, #2518). The
// uuids still come from `owned.sh`, never from the agent.
//
// __ACTOR__ is replaced with the actor id, __OWNED_SH__ with the path to
// owned.sh, __VERSION__ with a hash of this file so `driver.sh guard` can say
// which rules are live.
(async () => {
  const actor = "__ACTOR__";
  const version = "__VERSION__";

  globalThis.__omnibusGuardActor = actor;
  globalThis.__omnibusGuardOwnedScript = "__OWNED_SH__";
  globalThis.__omnibusGuardRefusals ||= [];
  globalThis.__omnibusGuardApprovedMerges ||= 0;

  const { execFile } = process.getBuiltinModule("node:child_process");
  const { promisify } = process.getBuiltinModule("node:util");
  const execFileAsync = promisify(execFile);
  const ownedNow = async () => {
    const { stdout } = await execFileAsync(globalThis.__omnibusGuardOwnedScript, [globalThis.__omnibusGuardActor]);
    return new Set(stdout.trim().split(",").filter(Boolean));
  };

  // A binding can be exposed once per page, so each is registered by name; a
  // driver guarded by an older guard.js already holds the first two.
  globalThis.__omnibusGuardBindings ||= new Set(
    globalThis.__omnibusGuardBound ? ["__omnibusGuardRefused", "__omnibusGuardMerge"] : [],
  );
  const bind = async (name, fn) => {
    if (globalThis.__omnibusGuardBindings.has(name)) return;
    await page.exposeBinding(name, fn);
    globalThis.__omnibusGuardBindings.add(name);
  };
  await bind("__omnibusGuardRefused", (_source, refusal) => {
    globalThis.__omnibusGuardRefusals.push(refusal);
  });
  // "approve" banks a merge the guard let through; "spend" consumes one for
  // an undo and says whether there was one to spend.
  await bind("__omnibusGuardMerge", (_source, op) => {
    if (op === "approve") {
      globalThis.__omnibusGuardApprovedMerges += 1;
      return true;
    }
    if (globalThis.__omnibusGuardApprovedMerges > 0) {
      globalThis.__omnibusGuardApprovedMerges -= 1;
      return true;
    }
    return false;
  });
  // Which of these uuids the actor has no `book.add` for, read at call time.
  await bind("__omnibusGuardUnowned", async (_source, uuids) => {
    const owned = await ownedNow();
    return uuids.filter((u) => !owned.has(u));
  });

  // Runs inside the page. Playwright serialises it, so it closes over nothing.
  const install = ({ actor, version }) => {
    window.__omnibusGuardActor = actor;
    // A re-guard must *replace* the wrapper, not return early leaving the old
    // one in place: run r-20260908-02 patched this file mid-run, re-ran
    // `driver.sh guard`, and every agent kept the pre-fix rules because of an
    // early return here. The pristine fetch is parked on `window` so a later
    // install can restore it before wrapping again.
    // A page guarded by a *previous* version of this file parked no pristine
    // fetch, so there is nothing to restore and wrapping again would stack a
    // new wrapper on the old one — the old refusals would still win while the
    // command reported success, which is the false sense of safety this
    // replacement exists to remove. Refuse instead, and say what fixes it.
    if (window.__omnibusGuardInstalled && !window.__omnibusGuardOriginalFetch) {
      window.__omnibusGuardStale = true;
      return { installed: false, reason: "stale-guard-cannot-be-replaced" };
    }
    if (window.__omnibusGuardInstalled) window.fetch = window.__omnibusGuardOriginalFetch;
    window.__omnibusGuardStale = false;
    window.__omnibusGuardInstalled = true;
    window.__omnibusGuardVersion = version;

    // Endpoints that destroy or restructure a book. Anything book-scoped is
    // gated on the owned set; author and series deletion is refused outright,
    // because start.md forbids it for every agent regardless of ownership.
    // Only the calls that name a book uuid and destroy something can be
    // ownership-checked, so only they belong here: file deletion, merge, and
    // the two routes that delete a fileless book. A blanket `physical/` — run
    // r-20260908-01's fix for copy removals slipping past — refused the whole
    // surface instead, reads included, because no copy route carries a uuid.
    const BOOK_SCOPED =
      /\/api\/(rpc\/(books\/delete-files|merge-books|physical\/book\/delete)$|physical\/[0-9a-f-]{36}$)/;
    // Reads wearing POST, plus the wishlist. The wishlist is per-user state on
    // any book in the library, so gating it on the owned set would stop an
    // agent wishlisting a book somebody else uploaded — which every reader may
    // do.
    const PHYSICAL_ALLOWED = /\/api\/rpc\/physical\/(copies|wishlist\/(get|add|remove))$/;
    // A copy note or removal names a copy id and no book uuid. The copy card
    // that sends it sits on its book's page, so the guard asks the server who
    // filed that copy and lets through only the signed-in account's own.
    const COPY_SCOPED = /\/api\/(rpc\/physical\/copies\/(note|delete)$|physical\/copies\/\d+$)/;
    const ALWAYS_REFUSED = /\/api\/rpc\/(author\/delete|cleanup\/delete-entity)/;
    // Undo is destructive and owner-only, but its payload carries a merge_log_id
    // and no uuid, so ownership cannot be read from the request. Refusing it
    // outright would block the very step that found the undo data-loss bug
    // (#2234), so instead it is allowed only to reverse a merge this guard
    // already approved — which was itself ownership-checked.
    const UNDO = /\/api\/rpc\/merge-books\/undo$/;
    // `merge-books/candidates` is a search, not a mutation. It must keep working
    // or the merge dialog cannot be used at all.
    const MERGE_READ = /\/api\/rpc\/merge-books\/candidates$/;

    const uuidsIn = (text) =>
      (text || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];

    // The body as text, read only for a guarded call — never for an upload.
    const bodyText = async (input, init) => {
      const body = init && init.body !== undefined && init.body !== null ? init.body : null;
      if (typeof body === "string") return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        return [...body.entries()].map(([k, v]) => (typeof v === "string" ? `${k}=${v}` : k)).join("&");
      }
      if (body === null && input instanceof Request) return input.clone().text();
      return "";
    };

    const originalFetch = window.fetch;
    window.__omnibusGuardOriginalFetch = originalFetch;

    const json = async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${response.url}`);
      return response.json();
    };
    // Why a copy write is refused, or null when the signed-in account filed it.
    const copyRefusal = async (url, text) => {
      const match = /copies\/(\d+)$/.exec(url) || /copy_id\D{0,4}(\d+)/.exec(text);
      if (!match) return "copy call carried no copy id to check";
      const [book] = uuidsIn(location.pathname);
      if (!book) return "copy call made from a page that names no book";
      try {
        const me = await json(await originalFetch("/api/auth/me"));
        const copies = await json(
          await originalFetch("/api/rpc/physical/copies", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uuid: book }),
          }),
        );
        const copy = copies.find((c) => c.id === Number(match[1]));
        if (!copy) return `copy ${match[1]} is not on book ${book}`;
        return copy.added_by_user_id === me.id ? null : "copy was filed by another reader";
      } catch (e) {
        return `could not look up who filed copy ${match[1]}: ${e.message}`;
      }
    };

    window.fetch = async function (input, init) {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href).href;
      const method = ((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" || method === "HEAD" || !/\/api\//.test(url)) {
        return originalFetch.call(this, input, init);
      }

      const refuse = (why, targets) => {
        const refusal = { actor: window.__omnibusGuardActor, url, method, why, targets };
        Promise.resolve(window.__omnibusGuardRefused(refusal)).catch(() => {});
        // 403 rather than a transport error: the app renders a permission
        // failure, which is what the agent should observe and journal, instead
        // of a network stack error it would mistake for a bug.
        const response = new Response(JSON.stringify({ error: "ownership_guard", why, targets }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
        // A synthetic Response has an empty `url`, and the Dioxus server-function
        // client parses `response.url` before it reads the status — so the
        // refusal surfaced as "relative URL without a base", a transport error
        // an agent cannot tell from an app bug (r-20260908-01). Give it the URL
        // the request was made to, so the app renders the 403 it was built for.
        Object.defineProperty(response, "url", { value: url });
        return response;
      };

      if (ALWAYS_REFUSED.test(url)) return refuse("author and series deletion are forbidden by the rails", []);
      if (PHYSICAL_ALLOWED.test(url)) return originalFetch.call(this, input, init);
      if (COPY_SCOPED.test(url)) {
        const why = await copyRefusal(url, await bodyText(input, init));
        return why ? refuse(why, []) : originalFetch.call(this, input, init);
      }
      if (MERGE_READ.test(url)) return originalFetch.call(this, input, init);
      if (UNDO.test(url)) {
        if (await window.__omnibusGuardMerge("spend")) return originalFetch.call(this, input, init);
        return refuse("undo has no uuid to check and follows no merge this guard approved", []);
      }
      if (BOOK_SCOPED.test(url)) {
        const targets = [...uuidsIn(await bodyText(input, init)), ...uuidsIn(url)];
        // No uuid at all in a destructive call means the guard cannot prove
        // ownership — refuse rather than wave it through.
        if (targets.length === 0) return refuse("destructive call carried no book uuid to check", []);
        let unowned;
        try {
          unowned = await window.__omnibusGuardUnowned(targets);
        } catch (e) {
          return refuse(`could not read the ownership ledger: ${e.message}`, targets);
        }
        if (unowned.length > 0) return refuse("actor does not own these books", unowned);
        // Remember an approved merge so its undo can be allowed through.
        if (/merge-books$/.test(url)) await window.__omnibusGuardMerge("approve");
      }
      return originalFetch.call(this, input, init);
    };
    return { installed: true };
  };

  await page.addInitScript(install, { actor, version });
  const result = await page.evaluate(install, { actor, version });
  return JSON.stringify({
    reason: result && result.installed === false ? result.reason : null,
    live: await page.evaluate(() => window.__omnibusGuardVersion ?? null),
    owned: (await ownedNow()).size,
  });
})()
