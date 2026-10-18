//! Shared Dioxus components for `omnibus` (web) and `omnibus-mobile` (native).
//! Platform-specific behavior (nav variant, data-fetching transport) is gated
//! behind the `web` and `mobile` features; components themselves stay
//! platform-agnostic, using `use_signal` + `use_effect` over the feature-gated
//! transport layer the [`data`] module provides.

use dioxus::prelude::*;

pub mod audiobook_progress;
pub mod client_store;
pub mod components;
pub mod contexts;
pub mod data;
pub mod date_fmt;
pub mod focus_after_paint;
pub mod focus_trap;
pub mod format;
pub mod index_prefs;
pub mod js_interop;
#[cfg(feature = "mobile")]
pub(crate) mod native_share;
#[cfg(feature = "mobile")]
pub mod offline;
pub mod pages;
pub mod platform_sleep;
pub mod read_status_auto;
pub mod reader_progress;
pub mod routes;
pub mod rpc;
pub mod scroll_restore;
pub mod session_tracker;
pub mod shelf_access;
pub mod shelf_selection;
// Test harness. Its SSR render helpers gate themselves on `server`, where
// `dioxus::ssr` exists; the handler helpers serve every target's tests.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
pub mod time;
pub mod version;
pub mod view_prefs;

pub use components::Nav;
pub use contexts::*;
pub use pages::{
    AccountPage, AuthorPage, AuthorsIndexPage, BookDetailPage, BookListenPage, BookReadPage,
    LandingPage, LoginPage, MetadataEditPage, RegisterPage, SearchPage, SeriesIndexPage,
    SeriesPage, SettingsPage,
};
pub use routes::*;

#[cfg(feature = "mobile")]
pub use data::ServerUrl;

/// Platform-specific page chrome. Web puts nav at the top of the flow;
/// mobile puts it at the bottom (via `position: fixed`). The web variant is
/// the default (WASM client and SSR), so SSR'd markup matches what hydrates.
#[cfg(not(feature = "mobile"))]
#[component]
fn ScreenLayout(children: Element) -> Element {
    // #57: web-side reactive redirect to /login on 401, for a session that
    // lapses mid-visit (the server's page gate redirects a signed-out page
    // load before it renders), returning the reader to this page after
    // sign-in. Mirrors the mobile ScreenLayout's `token_store::subscribe()`
    // loop, but driven by `data::web_auth_state` since web auth lives in a
    // session cookie (no client-side token to clear). Render path stays
    // unconditional so SSR and WASM produce identical markup — only the
    // effect runs on the WASM client. `Login` / `Register` routes don't go
    // through `ScreenLayout`, so they stay reachable for unauthenticated
    // users and the redirect can't loop.
    // Declared on every target so SSR and the client share a hook order
    // (rule 07); only the web client reads it, in the redirect below.
    let route = dioxus_router::use_route::<Route>();
    #[cfg(not(feature = "web"))]
    let _ = &route;
    #[cfg(feature = "web")]
    {
        let nav = dioxus_router::use_navigator();
        let mut unauthorized = use_signal(|| false);
        use_future(move || async move {
            let mut rx = data::web_auth_state::subscribe();
            // Sync the initial value once before awaiting changes. The
            // signal's initial closure ran at scope-creation time, which
            // can race with a 401 that fired (e.g. during SSR-to-WASM
            // hydration) between channel creation and this future
            // starting — without this borrow_and_update the first 401
            // is lost. Mirrors the mobile ScreenLayout pattern.
            if !*rx.borrow_and_update() {
                unauthorized.set(true);
                return;
            }
            while rx.changed().await.is_ok() {
                if !*rx.borrow_and_update() {
                    unauthorized.set(true);
                    break;
                }
            }
        });
        use_effect(move || {
            if unauthorized() {
                nav.replace(login_target_from(&route));
            }
        });
    }

    rsx! {
        div { class: "app-shell",
            Nav {}
            main { {children} }
            // Persistent mini-dock. Lives in `ScreenLayout` (not the
            // immersive `/listen` / `/read` routes, which render bare) so it
            // shows on every main page while an audiobook is loaded and is
            // absent on the full player. Renders an empty host until a book
            // is playing — see `pages::MiniDock`.
            pages::MiniDock {}
            // Search palette overlay. Mounted here rather than beside its
            // trigger in `TopNav` — the topbar's `backdrop-filter` makes it
            // the containing block for `position: fixed` children, which
            // shrank the scrim to the header strip. See
            // `components::search_palette::SearchPaletteOverlay`.
            components::search_palette::SearchPaletteOverlay {}
            // Centered check-in overlay. Root-mounted (not beside its trigger
            // in `TopNav`) for the same containing-block reason as the search
            // palette; renders nothing until opened.
            pages::CheckInOverlay {}
            // Phone-width section switcher. Always rendered on web (SSR +
            // WASM, so hydration markup matches); CSS hides it above the
            // phone breakpoint so the desktop chrome is unchanged.
            components::BottomNav {}
        }
    }
}

#[cfg(feature = "mobile")]
#[component]
fn ScreenLayout(children: Element) -> Element {
    // Mobile auth gate. Two layers:
    //
    // * **Render-path placeholder.** When `authed` is false we render a
    //   page loader instead of `{children}`. This is the no-flash
    //   guarantee — protected pages never mount and never kick off a
    //   data-fetch effect that would 401.
    // * **Reactive redirect.** `authed` is a Dioxus `Signal` driven by
    //   the `data::token_store::subscribe()` watch channel. When the
    //   token gets cleared mid-session (e.g. `data::note_status` on a
    //   401), the worker pushes `false`, the `use_future` loop updates
    //   the signal, the component re-renders, and the `use_effect`
    //   (which now reads a reactive signal) fires `nav.replace`.
    //
    // The auth-shell screens (`Login` / `Register`) don't go through
    // `ScreenLayout`, so they stay reachable for unauthenticated users.
    let nav = dioxus_router::use_navigator();
    let mut authed = use_signal(|| data::token_store::get().is_some());

    use_future(move || async move {
        let mut rx = data::token_store::subscribe();
        // Sync initial value once before awaiting changes — the signal's
        // initial closure ran at scope-creation time, which can race with
        // a token write that happens between scope creation and this
        // future starting.
        let current = *rx.borrow_and_update();
        if current != authed() {
            authed.set(current);
        }
        while rx.changed().await.is_ok() {
            let now = *rx.borrow_and_update();
            if now != authed() {
                authed.set(now);
            }
        }
    });

    // Single prioritized redirect: an unconfigured server URL sends the user
    // to the Connect screen first, then an absent token to Login. Reading
    // `use_server_url()` inside the effect subscribes the effect to the
    // context signal, so a URL set on the Connect screen re-runs this.
    // `ServerConnect` / `Login` are unguarded, so neither redirect loops.
    use_effect(move || {
        if use_server_url().is_empty() {
            nav.replace(Route::ServerConnect {});
        } else if !authed() {
            nav.replace(login_target());
        }
    });

    // Synthesized left-edge back-swipe (the native WKWebView gesture can't
    // reach the router). Unconditional — before the auth early-return — so the
    // hook order stays stable across renders.
    use_mobile_edge_swipe_back(nav);

    if use_server_url().is_empty() || !authed() {
        return rsx! {
            div { class: "screen",
                components::Loading { kind: components::LoadingKind::Page, label: "Finding your library" }
            }
        };
    }
    rsx! {
        div { class: "screen",
            {children}
            // Persistent mini-player. Lives in `ScreenLayout` (not the
            // immersive `/listen` / `/read` routes, which render bare) so it
            // shows on every main page while an audiobook is loaded and is
            // absent on the full player. Renders nothing until a book plays.
            pages::MobileMiniPlayer {}
            // Connectivity pill — "Offline · N changes queued" / "Syncing".
            // Renders nothing in the steady online state.
            components::OfflinePill {}
            // "You're offline" sheet raised when a reader/player route
            // bounces (book not downloaded). Renders nothing until then.
            components::OfflineGuardModal {}
            // Centered check-in overlay — raised by the add-books sheet and
            // the "You" tab's check-in row. Renders nothing until opened.
            pages::CheckInOverlay {}
            Nav {}
        }
    }
}

/// Atrium design-system stylesheet. Served as a hashed static asset via
/// Dioxus's Manganis pipeline so the browser caches it independently of
/// the WASM bundle.
const ATRIUM_CSS: Asset = asset!("/assets/atrium.css");

/// The loading vocabulary's stylesheet (boot screen, marks, skeletons) — kept
/// apart from Atrium so every loading visual lives in one reviewable file.
const LOADING_CSS: Asset = asset!("/assets/loading.css");

/// The library filter bar's stylesheet (chips and the add-filter popover).
const FILTER_BAR_CSS: Asset = asset!("/assets/filter_bar.css");

/// The authors browser's stylesheet (the list, its rail, and the author pane).
const AUTHORS_CSS: Asset = asset!("/assets/authors.css");

/// Browser-tab favicon — the Omnibus brand mark, served as a hashed static
/// asset via Manganis. 128² PNG; browsers downscale it to the tab size.
const FAVICON: Asset = asset!("/assets/omnibus-stoat.png");

/// Install the search-palette context and the global `⌘K` shortcut. Called
/// unconditionally from [`App`], with the cfg in the helper body; the mobile
/// build is a no-op stub. Rule 07's SSR-vs-WASM hydration invariant holds
/// within the web build.
#[cfg(not(feature = "mobile"))]
fn use_palette_setup() {
    use_context_provider(|| components::search_palette::PaletteOpen(Signal::new(false)));
    // App mounts once for the app's lifetime; registering the keydown
    // listener here keeps a single closure alive across route changes.
    components::search_palette::use_palette_global_shortcut();
}

/// Mobile stub: no palette, no global shortcut.
#[cfg(feature = "mobile")]
fn use_palette_setup() {}

/// Install the cached-user and playback contexts. Web (and SSR) only; mobile
/// uses bearer tokens via `token_store`, and its twin below provides
/// `MobilePlayback` instead. Called unconditionally from [`App`]; rule 07's
/// hydration invariant holds because web and SSR share `not(mobile)`.
#[cfg(not(feature = "mobile"))]
fn use_user_and_playback_contexts() {
    // Cached `/api/auth/me`. Provided unconditionally on non-mobile builds
    // so SSR can render the placeholder topbar without resolving anything;
    // the WASM hydration phase then runs the boot effect below to fill it
    // in once for the lifetime of the App instance.
    use_context_provider(|| CurrentUser(Signal::new(None)));
    // App-wide audiobook playback. Provided unconditionally on
    // not(mobile) so SSR markup matches the WASM client; the web-only
    // driver below reacts to its `uuid` signal.
    let playback = use_context_provider(PlaybackState::new);
    // App-scoped sleep timer, so an armed countdown keeps ticking (and
    // fading/pausing) after the user leaves /listen — the mini-dock's sleep
    // chip and the full player share this one controller via `use_sleep`.
    let sleep = pages::use_sleep_timer(&playback);
    use_context_provider(|| sleep);
}

/// Mobile: no `/me` cache (bearer tokens via `token_store`), but an app-wide
/// playback context — the analogue of web's `PlaybackState` — so the full
/// player, the mini-player, and the app-root audio host share one state.
#[cfg(feature = "mobile")]
fn use_user_and_playback_contexts() {
    use_context_provider(pages::MobilePlayback::new);
}

/// Install the app-root playback shim and the single boot-time `/me` fetch.
/// Web only: installs the `window.OmnibusAudio` shim (so the `<audio>` element
/// outlives navigation) and runs one `current_user()` fetch, then subscribes
/// to `web_auth_state` so a fresh login refills the cache and a 401 clears it.
/// Called unconditionally from [`App`].
#[cfg(feature = "web")]
fn use_current_user_boot() {
    // App-root audiobook playback driver: installs the `window.OmnibusAudio`
    // shim and reacts to the playback context's `uuid` signal.
    pages::install_audio_bootstrap(use_playback());

    let mut slot = use_context::<CurrentUser>().0;
    use_future(move || async move {
        // Initial fetch on mount, retried with backoff: only an answer
        // settles `CurrentUser`, and the access gates show loading until one
        // arrives, so a single transient error (network blip, 5xx, 429) must
        // not leave them loading for good.
        let mut backoff_ms = 1_000;
        loop {
            match data::current_user().await {
                Ok(resolved) => {
                    slot.set(Some(resolved));
                    break;
                }
                Err(_) => {
                    platform_sleep::async_sleep_ms(backoff_ms).await;
                    backoff_ms = (backoff_ms * 2).min(30_000);
                }
            }
        }

        // React to subsequent auth-state transitions. `current_user`
        // itself pings `web_auth_state` on every call (true on 200,
        // false on 401), so the very first transition we observe
        // here is usually `true -> true` from the initial fetch
        // above — skip same-value updates to avoid a redundant
        // refetch loop.
        let mut rx = data::web_auth_state::subscribe();
        let mut last = *rx.borrow_and_update();
        while rx.changed().await.is_ok() {
            let now = *rx.borrow_and_update();
            if now == last {
                continue;
            }
            last = now;
            if now {
                // Fresh login (channel flipped false -> true): refetch
                // so the avatar / admin gates update without a reload.
                if let Ok(resolved) = data::current_user().await {
                    slot.set(Some(resolved));
                }
            } else {
                // 401 observed elsewhere: flip to unauthenticated
                // immediately. ScreenLayout already drives the
                // /login redirect off the same channel.
                slot.set(Some(None));
            }
        }
    });
}

/// Non-web stub: no playback shim, no `/me` boot fetch.
#[cfg(not(feature = "web"))]
fn use_current_user_boot() {}

/// Patch the viewport meta on mobile so content fills the screen edge-to-edge.
/// Mobile (wry WKWebView) only: without `viewport-fit=cover` the WebView insets
/// scroll content by the safe areas (a phantom ~100px of scroll behind the
/// fixed player) and `env(safe-area-inset-*)` reads 0. Non-mobile is a no-op
/// stub, called unconditionally from [`App`].
#[cfg(feature = "mobile")]
fn use_mobile_viewport_fix() {
    use_effect(|| {
        dioxus::document::eval(
            "const m = document.querySelector('meta[name=viewport]');\
             if (m) m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');",
        );
    });
}

/// Non-mobile stub: the viewport meta is already correct.
#[cfg(not(feature = "mobile"))]
fn use_mobile_viewport_fix() {}

/// JS installed on the Android shell to report this device's zone. Sends on
/// install and on every `visibilitychange`, so the answer survives travel and
/// DST. The sign of `getTimezoneOffset` is flipped to the minutes-east-of-UTC
/// convention the wire uses.
#[cfg(feature = "mobile")]
const ZONE_CAPTURE_JS: &str = "\
    const report = () => {\
      let z = null;\
      try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) {}\
      dioxus.send([-new Date().getTimezoneOffset(), z]);\
    };\
    document.addEventListener('visibilitychange', () => {\
      if (!document.hidden) report();\
    });\
    report();";

/// Keep `time::local_utc_offset_minutes` answering on the Android shell.
/// The native shell has no local offset, so without this it is `None` and the
/// server falls back to UTC (rule 10). Effect-only, so no markup depends on
/// it (rule 07).
#[cfg(feature = "mobile")]
fn use_mobile_zone_capture() {
    let mut eval = use_hook(|| dioxus::document::eval(ZONE_CAPTURE_JS));
    use_future(move || async move {
        // Ends when the channel closes; the app root never unmounts in practice.
        while let Ok((offset, zone)) = eval.recv::<(i64, Option<String>)>().await {
            time::set_local_zone(offset, zone);
        }
    });
}

/// Non-mobile stub: web asks the browser synchronously and SSR has nothing to
/// ask. Called unconditionally from [`App`], per `use_mobile_viewport_fix`.
#[cfg(not(feature = "mobile"))]
fn use_mobile_zone_capture() {}

/// Offline runtime (mobile): keeps the sync engine's server URL fresh and
/// runs the probe/drain loop. Cfg lives in the body per the
/// `use_mobile_viewport_fix` pattern so [`App`]'s call site stays gate-free.
#[cfg(feature = "mobile")]
fn use_offline_runtime() {
    offline::sync::use_offline_runtime();
}

/// Non-mobile stub: web/SSR have no offline layer.
#[cfg(not(feature = "mobile"))]
fn use_offline_runtime() {}

/// Cache revalidation generation (mobile): read the returned signal inside
/// a fetch effect so the page re-fetches when a background revalidation
/// lands changed data — the re-fetch is served from the fresh cache with
/// zero network. Cfg lives in the body so call sites stay gate-free; hook
/// counts match across targets (one `use_signal` + one `use_future` each).
#[cfg(feature = "mobile")]
pub fn use_cache_generation() -> Signal<u64> {
    let mut generation = use_signal(|| 0u64);
    use_future(move || async move {
        let mut rx = offline::cache::subscribe();
        loop {
            let now = *rx.borrow_and_update();
            if now != generation() {
                generation.set(now);
            }
            if rx.changed().await.is_err() {
                break;
            }
        }
    });
    generation
}

/// Non-mobile stub: web/SSR have no offline cache; the signal never moves.
#[cfg(not(feature = "mobile"))]
pub fn use_cache_generation() -> Signal<u64> {
    let generation = use_signal(|| 0u64);
    use_future(move || async move {});
    generation
}

/// Capture-phase left-edge back-swipe listener for the mobile WebView. The
/// native edge gesture can't drive navigation (the WebView's history is fed
/// only by `history.pushState`, which the in-memory router never calls), so
/// this synthesizes it on every screen mount. `id` tags the install so the
/// unmount cleanup removes only its own ([`edge_swipe_cleanup_js`]).
#[cfg(feature = "mobile")]
fn edge_swipe_install_js(id: u64) -> String {
    format!(
        r#"
(function(){{
  var prev = window.__omnibusEdgeSwipe;
  if (prev) {{
    document.removeEventListener('touchstart', prev.onStart, true);
    document.removeEventListener('touchend', prev.onEnd, true);
  }}
  var startX = 0, startY = 0, startT = 0, tracking = false;
  var EDGE = 24, MIN_DX = 64, MAX_SLOPE = 0.5, MAX_MS = 600;
  function onStart(e){{
    if (!e.touches || e.touches.length !== 1) {{ tracking = false; return; }}
    var t = e.touches[0];
    if (t.clientX <= EDGE) {{ startX = t.clientX; startY = t.clientY; startT = Date.now(); tracking = true; }}
    else {{ tracking = false; }}
  }}
  function onEnd(e){{
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - startX, dy = t.clientY - startY, dt = Date.now() - startT;
    // Left-edge start, mostly-horizontal, far enough, fast enough.
    if (dx >= MIN_DX && Math.abs(dy) <= dx * MAX_SLOPE && dt <= MAX_MS) {{
      try {{ dioxus.send(1); }} catch (_e) {{}}
    }}
  }}
  // Passive capture listeners: we only read coordinates, never preventDefault,
  // so the immersive reader/player keep their own page-turn / scrub gestures.
  document.addEventListener('touchstart', onStart, {{ capture: true, passive: true }});
  document.addEventListener('touchend', onEnd, {{ capture: true, passive: true }});
  window.__omnibusEdgeSwipe = {{ onStart: onStart, onEnd: onEnd, id: {id} }};
}})();
"#
    )
}

/// Remove this screen's edge-swipe listener on unmount, only when it's still
/// the installed one (`id` match). A `ScreenLayout` → `ScreenLayout` nav
/// reinstalls with a new id first, so the outgoing cleanup no-ops; an
/// immersive nav has no reinstall, so the listener is torn down.
#[cfg(feature = "mobile")]
fn edge_swipe_cleanup_js(id: u64) -> String {
    format!(
        r#"
(function(){{
  var s = window.__omnibusEdgeSwipe;
  if (s && s.id === {id}) {{
    document.removeEventListener('touchstart', s.onStart, true);
    document.removeEventListener('touchend', s.onEnd, true);
    window.__omnibusEdgeSwipe = null;
  }}
}})();
"#
    )
}

/// Install the edge-swipe → router-back bridge. Drains the `eval` channel the
/// injected listener sends on and asks `nav` to go back (when there's history
/// to unwind), and removes the listener on unmount. Called from the mobile
/// [`ScreenLayout`], so it rides that component's mount lifecycle.
#[cfg(feature = "mobile")]
fn use_mobile_edge_swipe_back(nav: dioxus_router::Navigator) {
    // Per-mount id so the unmount cleanup only removes its own listener, not
    // one a later screen already rebound.
    let id = use_hook(|| {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    });
    let mut eval = use_hook(|| dioxus::document::eval(&edge_swipe_install_js(id)));
    use_future(move || async move {
        // Loop ends when the channel closes (this screen unmounted).
        while eval.recv::<i32>().await.is_ok() {
            if nav.can_go_back() {
                nav.go_back();
            }
        }
    });
    use_drop(move || {
        dioxus::document::eval(&edge_swipe_cleanup_js(id));
    });
}

/// Root app component. Renders global styles and the router.
#[component]
pub fn App() -> Element {
    // Browser-tab title, defaulting to the bare app name. Each route refines it
    // via `use_page_title`; rendered once as `document::Title` below.
    let page_title = use_signal(|| "Omnibus".to_string());
    use_context_provider(|| PageTitle(page_title));
    // Cover cache-bust registry — see `contexts::CoverCacheBust`.
    use_context_provider(|| CoverCacheBust(Signal::new(std::collections::HashMap::new())));
    // Avatar cache-bust counter — see `contexts::AvatarCacheBust`.
    use_context_provider(|| AvatarCacheBust(Signal::new(0u32)));
    // Check-in overlay open/closed. Provided above both `ScreenLayout`
    // variants so every entry point can raise the centered modal and the
    // root-mounted `CheckInOverlay` can read it. Starts closed for SSR/WASM
    // hydration parity (rule 07).
    use_context_provider(|| pages::CheckInOpen(Signal::new(false)));
    use_context_provider(|| pages::CheckInPrefill(Signal::new(None)));
    use_context_provider(|| pages::CheckInWrites(Signal::new(0)));
    // Hook calls in App() are unconditional — the feature gates live inside
    // the helper bodies (mobile compiles them to no-op stubs). This keeps
    // rule 07's SSR-vs-WASM hydration parity within the not(mobile) build,
    // where the helpers are real hooks; true hook-count parity across mobile
    // isn't claimed (the stubs run no hooks).
    use_palette_setup();
    use_user_and_playback_contexts();
    use_current_user_boot();

    components::atrium::init_theme();
    components::loading::use_hydration_marker();

    use_mobile_viewport_fix();
    use_mobile_zone_capture();
    use_offline_runtime();

    // The single `<audio>` element, mounted at the App root (sibling of the
    // Router) so it never unmounts on navigation — the persistence anchor for
    // cross-page playback. Rendered on not(mobile) for SSR/WASM hydration
    // parity; mobile mounts its render-less audio host (which installs the
    // JS-owned element into `document.body`) at the same anchor instead.
    #[cfg(not(feature = "mobile"))]
    let audio_host = rsx! { pages::AudioElement {} };
    #[cfg(feature = "mobile")]
    let audio_host = rsx! { pages::MobileAudioHost {} };

    rsx! {
        document::Title { "{page_title}" }
        document::Link { rel: "icon", href: FAVICON }
        document::Stylesheet { href: ATRIUM_CSS }
        document::Stylesheet { href: LOADING_CSS }
        document::Stylesheet { href: FILTER_BAR_CSS }
        document::Stylesheet { href: AUTHORS_CSS }
        components::atrium::AtriumRoot {
            // First child: its pre-paint script must run before the page
            // paints, and finds the `.atrium` root around it.
            components::loading::BootScript {}
            {audio_host}
            dioxus_router::Router::<Route> {}
        }
    }
}
