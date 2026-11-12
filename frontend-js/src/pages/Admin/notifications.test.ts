import { describe, expect, it } from "vitest";
import { ApiError, type NotificationConnection } from "../../api";
import {
  blankDraft,
  type ConnectionDraft,
  clipError,
  connectionInputOf,
  connectionKey,
  connectionSchema,
  deliveryLine,
  draftOf,
  draftProblems,
  eventChoices,
  isGone,
  NO_SAVED_SECRETS,
  parseTags,
  postsTo,
  savedSecretsOf,
  savedTestOf,
  secretRetypeHint,
  secretState,
  settingsInputOf,
  testOf,
  toggledInput,
} from "./notifications";

const DRAFT: ConnectionDraft = {
  ...blankDraft(["request_needs_chooser"]),
  name: " Phone ",
  server_url: " https://ntfy.sh ",
  topic: " omnibus-requests ",
};

function aConnection(
  overrides: Partial<NotificationConnection> = {},
  settings: Partial<NotificationConnection["settings"]> = {},
): NotificationConnection {
  return {
    id: 7,
    name: "Phone",
    enabled: true,
    events: ["request_needs_chooser"],
    last_delivery: null,
    ...overrides,
    settings: {
      kind: "ntfy",
      server_url: "https://ntfy.sh",
      topic: "omnibus-requests",
      auth: "token",
      username: null,
      token_set: true,
      password_set: false,
      priority: 4,
      tags: ["books", "bell"],
      include_details: false,
      ...settings,
    },
  };
}

describe("settingsInputOf", () => {
  it("sends a new connection's token with its trimmed fields", () => {
    expect(
      settingsInputOf({ ...DRAFT, auth: "token", token: " tk_new " }),
    ).toEqual({
      kind: "ntfy",
      server_url: "https://ntfy.sh",
      topic: "omnibus-requests",
      auth: "token",
      token: "tk_new",
      priority: 3,
      tags: [],
      include_details: true,
    });
  });

  it("leaves out a blank token, so the saved one is kept", () => {
    const sent = settingsInputOf({ ...draftOf(aConnection()), token: "" });

    expect(sent).not.toHaveProperty("token");
    expect(sent).not.toHaveProperty("password");
  });

  it("sends a typed token in place of the saved one", () => {
    expect(
      settingsInputOf({ ...draftOf(aConnection()), token: "tk_replaced" }),
    ).toMatchObject({ auth: "token", token: "tk_replaced" });
  });

  it("sends no secret and no username with no sign-in", () => {
    const sent = settingsInputOf({
      ...DRAFT,
      auth: "none",
      token: "left over",
      username: "ada",
      password: "left over",
    });

    expect(sent.auth).toBe("none");
    expect(sent).not.toHaveProperty("token");
    expect(sent).not.toHaveProperty("username");
    expect(sent).not.toHaveProperty("password");
  });

  it("sends the username and password, and not a token typed before switching", () => {
    const sent = settingsInputOf({
      ...DRAFT,
      auth: "basic",
      token: "typed earlier",
      username: " ada ",
      password: " secret ",
    });

    expect(sent).toMatchObject({
      auth: "basic",
      username: "ada",
      password: " secret ",
    });
    expect(sent).not.toHaveProperty("token");
  });

  it("sends a token typed after switching back from a password", () => {
    const sent = settingsInputOf({
      ...DRAFT,
      auth: "token",
      username: "ada",
      password: "typed earlier",
      token: "tk",
    });

    expect(sent).toMatchObject({ auth: "token", token: "tk" });
    expect(sent).not.toHaveProperty("password");
    expect(sent).not.toHaveProperty("username");
  });

  it("leaves out a blank password, so the saved one is kept", () => {
    const saved = aConnection(
      {},
      { auth: "basic", username: "ada", token_set: false, password_set: true },
    );

    const sent = settingsInputOf(draftOf(saved));

    expect(sent).toMatchObject({ auth: "basic", username: "ada" });
    expect(sent).not.toHaveProperty("password");
  });

  it("reads the priority as a number", () => {
    expect(settingsInputOf({ ...DRAFT, priority: "5" }).priority).toBe(5);
  });
});

describe("parseTags", () => {
  it("splits on commas, trims and drops blanks", () => {
    expect(parseTags(" books, ,bell ,  , warning ")).toEqual([
      "books",
      "bell",
      "warning",
    ]);
  });

  it("reads a blank field as no tags", () => {
    expect(parseTags("  ")).toEqual([]);
  });
});

describe("connectionInputOf", () => {
  it("trims the name and carries the events and switch", () => {
    expect(
      connectionInputOf({ ...DRAFT, enabled: false, tags: "books, bell" }),
    ).toEqual({
      name: "Phone",
      enabled: false,
      events: ["request_needs_chooser"],
      settings: expect.objectContaining({ tags: ["books", "bell"] }),
    });
  });

  it("keeps an event the server doesn't offer now", () => {
    const saved = aConnection({ events: ["request_needs_chooser"] });
    expect(connectionInputOf(draftOf(saved)).events).toEqual([
      "request_needs_chooser",
    ]);
  });
});

describe("draftOf", () => {
  it("fills the form from a saved connection with both secrets blank", () => {
    expect(draftOf(aConnection())).toEqual({
      name: "Phone",
      server_url: "https://ntfy.sh",
      topic: "omnibus-requests",
      auth: "token",
      username: "",
      token: "",
      password: "",
      priority: "4",
      tags: "books, bell",
      include_details: false,
      events: ["request_needs_chooser"],
      enabled: true,
    });
  });

  it("round-trips a saved connection into the same input with no secret", () => {
    const connection = aConnection(
      { enabled: false },
      { auth: "basic", username: "ada", token_set: false, password_set: true },
    );

    expect(connectionInputOf(draftOf(connection))).toEqual({
      name: "Phone",
      enabled: false,
      events: ["request_needs_chooser"],
      settings: {
        kind: "ntfy",
        server_url: "https://ntfy.sh",
        topic: "omnibus-requests",
        auth: "basic",
        username: "ada",
        priority: 4,
        tags: ["books", "bell"],
        include_details: false,
      },
    });
  });
});

describe("toggledInput", () => {
  it("flips the switch and carries no secret", () => {
    const sent = toggledInput(aConnection(), false);

    expect(sent.enabled).toBe(false);
    expect(sent.settings).toMatchObject({ auth: "token", priority: 4 });
    expect(sent.settings).not.toHaveProperty("token");
    expect(sent.settings).not.toHaveProperty("password");
  });
});

describe("testOf", () => {
  it("names the saved connection, so a blank secret comes from it", () => {
    expect(testOf(draftOf(aConnection()), 7)).toEqual({
      id: 7,
      settings: expect.not.objectContaining({ token: expect.anything() }),
    });
  });

  it("names no connection for one not saved yet", () => {
    expect(testOf({ ...DRAFT, auth: "token", token: "tk" }, null)).toEqual({
      settings: expect.objectContaining({ token: "tk" }),
    });
  });

  it("tests a saved connection as it is", () => {
    const test = savedTestOf(aConnection());

    expect(test.id).toBe(7);
    expect(test.settings).not.toHaveProperty("token");
  });
});

describe("savedSecretsOf", () => {
  it("counts a token only for a connection saved with token sign-in", () => {
    expect(savedSecretsOf(aConnection())).toEqual({
      token: true,
      password: false,
      serverUrl: "https://ntfy.sh",
      username: "",
    });
  });

  it("counts a password only for a connection saved with basic sign-in", () => {
    expect(
      savedSecretsOf(
        aConnection(
          {},
          {
            auth: "basic",
            username: "ada",
            token_set: false,
            password_set: true,
          },
        ),
      ),
    ).toEqual({
      token: false,
      password: true,
      serverUrl: "https://ntfy.sh",
      username: "ada",
    });
  });
});

describe("secretState", () => {
  const TOKEN = savedSecretsOf(aConnection());
  const BASIC = savedSecretsOf(
    aConnection(
      {},
      { auth: "basic", username: "ada", token_set: false, password_set: true },
    ),
  );

  it("keeps the saved token while the address is the one it was saved for", () => {
    expect(secretState({ ...draftOf(aConnection()) }, TOKEN, "token")).toBe(
      "kept",
    );
  });

  it("ignores whitespace around the address", () => {
    expect(
      secretState(
        { ...draftOf(aConnection()), server_url: " https://ntfy.sh " },
        TOKEN,
        "token",
      ),
    ).toBe("kept");
  });

  it.each([
    ["another host", "https://ntfy.example.com"],
    ["an added trailing slash", "https://ntfy.sh/"],
  ])("lets the token go for %s", (_condition, server_url) => {
    expect(
      secretState({ ...draftOf(aConnection()), server_url }, TOKEN, "token"),
    ).toBe("server_url_changed");
  });

  it("keeps the token again once the address is changed back", () => {
    const draft = { ...draftOf(aConnection()), server_url: "https://x.test" };
    expect(secretState(draft, TOKEN, "token")).toBe("server_url_changed");
    expect(
      secretState({ ...draft, server_url: "https://ntfy.sh" }, TOKEN, "token"),
    ).toBe("kept");
  });

  it("lets the password go when the username changes", () => {
    const draft = draftOf(
      aConnection(
        {},
        {
          auth: "basic",
          username: "ada",
          token_set: false,
          password_set: true,
        },
      ),
    );
    expect(secretState(draft, BASIC, "password")).toBe("kept");
    expect(
      secretState({ ...draft, username: "grace" }, BASIC, "password"),
    ).toBe("username_changed");
  });

  it("names the address first when both changed", () => {
    const draft = {
      ...draftOf(aConnection()),
      auth: "basic" as const,
      server_url: "https://x.test",
      username: "grace",
    };
    expect(secretState(draft, BASIC, "password")).toBe("server_url_changed");
  });

  it("has nothing to keep in another mode or for a new connection", () => {
    expect(
      secretState(
        { ...draftOf(aConnection()), auth: "basic" },
        TOKEN,
        "password",
      ),
    ).toBe("none");
    expect(secretState(DRAFT, NO_SAVED_SECRETS, "token")).toBe("none");
  });
});

describe("secretRetypeHint", () => {
  it.each([
    [
      "server_url_changed",
      "token",
      "The server URL changed, so enter the token again.",
    ],
    [
      "username_changed",
      "password",
      "The username changed, so enter the password again.",
    ],
    ["kept", "token", null],
    ["none", "password", null],
  ] as const)("says why for %s (%s)", (state, secret, hint) => {
    expect(secretRetypeHint(state, secret)).toBe(hint);
  });
});

describe("draftProblems", () => {
  it("accepts a complete connection", () => {
    expect(draftProblems(DRAFT, NO_SAVED_SECRETS)).toEqual({});
  });

  it("asks for a name, an address and a topic", () => {
    expect(
      draftProblems(
        { ...DRAFT, name: " ", server_url: "", topic: "" },
        NO_SAVED_SECRETS,
      ),
    ).toEqual({
      name: "Give the connection a name.",
      server_url: "Enter the ntfy server’s address.",
      topic: "Enter a topic.",
    });
  });

  it("refuses a name past 100 characters", () => {
    expect(
      draftProblems({ ...DRAFT, name: "x".repeat(101) }, NO_SAVED_SECRETS),
    ).toEqual({ name: "Keep the name to 100 characters." });
  });

  it.each([
    ["an address that is not http", "ftp://ntfy.sh"],
    ["an address with no scheme", "ntfy.sh"],
  ])("refuses %s", (_condition, server_url) => {
    expect(draftProblems({ ...DRAFT, server_url }, NO_SAVED_SECRETS)).toEqual({
      server_url: "Enter an http:// or https:// address.",
    });
  });

  it.each([
    ["a space", "omnibus requests"],
    ["a slash", "omnibus/requests"],
    ["65 characters", "x".repeat(65)],
  ])("refuses a topic with %s", (_condition, topic) => {
    expect(draftProblems({ ...DRAFT, topic }, NO_SAVED_SECRETS)).toEqual({
      topic: "A topic is 1 to 64 letters, digits, hyphens or underscores.",
    });
  });

  it("asks for a token when none is saved", () => {
    expect(
      draftProblems({ ...DRAFT, auth: "token", token: "  " }, NO_SAVED_SECRETS),
    ).toEqual({ token: "Enter the access token." });
  });

  it("keeps a saved token when the field is blank", () => {
    expect(
      draftProblems(
        { ...DRAFT, auth: "token" },
        { ...NO_SAVED_SECRETS, token: true, serverUrl: "https://ntfy.sh" },
      ),
    ).toEqual({});
  });

  it("asks for the token again once the server URL changed", () => {
    const saved = savedSecretsOf(aConnection());

    expect(
      draftProblems(
        { ...draftOf(aConnection()), server_url: "https://ntfy.example.com" },
        saved,
      ),
    ).toEqual({
      token: "The server URL changed, so enter the token again.",
    });
  });

  it("asks for the password again once the username changed", () => {
    const connection = aConnection(
      {},
      { auth: "basic", username: "ada", token_set: false, password_set: true },
    );

    expect(
      draftProblems(
        { ...draftOf(connection), username: "grace" },
        savedSecretsOf(connection),
      ),
    ).toEqual({
      password: "The username changed, so enter the password again.",
    });
  });

  it("accepts a retyped token at a new server URL", () => {
    expect(
      draftProblems(
        {
          ...draftOf(aConnection()),
          server_url: "https://ntfy.example.com",
          token: "tk_new",
        },
        savedSecretsOf(aConnection()),
      ),
    ).toEqual({});
  });

  it("asks for a username and a password when none is saved", () => {
    expect(
      draftProblems({ ...DRAFT, auth: "basic" }, NO_SAVED_SECRETS),
    ).toEqual({
      username: "Enter the username.",
      password: "Enter the password.",
    });
  });

  it("asks for a password after switching from a saved token", () => {
    const saved = savedSecretsOf(aConnection());

    expect(
      draftProblems({ ...DRAFT, auth: "basic", username: "ada" }, saved),
    ).toEqual({ password: "Enter the password." });
  });
});

describe("connectionSchema", () => {
  it("reads a valid form into the input a save sends", () => {
    expect(
      connectionSchema(NO_SAVED_SECRETS).parse({ ...DRAFT, tags: "books" }),
    ).toMatchObject({ name: "Phone", settings: { tags: ["books"] } });
  });

  it("points each refusal at its field", () => {
    const result = connectionSchema(NO_SAVED_SECRETS).safeParse({
      ...DRAFT,
      auth: "token",
      topic: "",
    });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["topic"], message: "Enter a topic." }),
      expect.objectContaining({
        path: ["token"],
        message: "Enter the access token.",
      }),
    ]);
  });
});

describe("eventChoices", () => {
  it("offers the server's events", () => {
    expect(eventChoices(["request_needs_chooser"], [])).toEqual([
      {
        event: "request_needs_chooser",
        label: "A request needs a version picked",
        offered: true,
      },
    ]);
  });

  it("keeps a saved event the server doesn't offer now", () => {
    expect(eventChoices([], ["request_needs_chooser"])).toEqual([
      expect.objectContaining({
        event: "request_needs_chooser",
        offered: false,
      }),
    ]);
  });

  it("offers nothing when the server offers nothing and none is saved", () => {
    expect(eventChoices([], [])).toEqual([]);
  });
});

describe("isGone", () => {
  it("reads a 404 as a connection deleted elsewhere", () => {
    expect(isGone(new ApiError(404, "not found"))).toBe(true);
  });

  it.each([
    ["a refusal", new ApiError(422, "topic must be …")],
    ["a network failure", new Error("Failed to fetch")],
  ])("reads %s as something else", (_condition, error) => {
    expect(isGone(error)).toBe(false);
  });
});

describe("connectionKey", () => {
  it("stays the same when only the last delivery moves", () => {
    expect(
      connectionKey(
        aConnection({ last_delivery: { at: 1, ok: true, error: null } }),
      ),
    ).toBe(connectionKey(aConnection()));
  });

  it.each([
    ["is renamed", aConnection({ name: "Tablet" })],
    ["is turned off", aConnection({ enabled: false })],
    ["moves server", aConnection({}, { server_url: "https://x.test" })],
  ])("changes when the connection %s", (_condition, changed) => {
    expect(connectionKey(changed)).not.toBe(connectionKey(aConnection()));
  });
});

describe("postsTo", () => {
  it("names the server without its scheme, then the topic", () => {
    expect(
      postsTo(
        aConnection({}, { server_url: "https://example.com/ntfy" }).settings,
      ),
    ).toBe("example.com/ntfy/omnibus-requests");
  });

  it("reads an address saved with a trailing slash the same way", () => {
    expect(
      postsTo(
        aConnection({}, { server_url: "https://example.com/ntfy/" }).settings,
      ),
    ).toBe("example.com/ntfy/omnibus-requests");
  });
});

describe("deliveryLine", () => {
  const NOW = 1_700_010_000;

  it("says nothing has been delivered yet", () => {
    expect(deliveryLine(null, NOW)).toEqual({
      state: "none",
      text: "No deliveries yet",
    });
  });

  it("says when the last one was delivered", () => {
    expect(
      deliveryLine({ at: NOW - 3 * 3600, ok: true, error: null }, NOW),
    ).toEqual({ state: "ok", text: "Delivered 3 hours ago", at: NOW - 10_800 });
  });

  it("says when the last one failed, and why", () => {
    expect(
      deliveryLine(
        { at: NOW - 30, ok: false, error: "the server answered 401" },
        NOW,
      ),
    ).toEqual({
      state: "failed",
      text: "Failed just now",
      at: NOW - 30,
      error: "the server answered 401",
    });
  });

  it("still says a failure has no recorded reason", () => {
    expect(
      deliveryLine({ at: NOW, ok: false, error: null }, NOW),
    ).toMatchObject({ error: "No reason was recorded." });
  });
});

describe("clipError", () => {
  it("keeps a short error whole", () => {
    expect(clipError("could not reach the server", 140)).toEqual({
      text: "could not reach the server",
      clipped: false,
    });
  });

  it("cuts a long error at a word break", () => {
    const error = `${"word ".repeat(40)}end`;

    const { text, clipped } = clipError(error, 50);

    expect(clipped).toBe(true);
    expect(text).toBe(`${"word ".repeat(9)}word…`);
  });

  it("cuts a long error with no spaces at the limit", () => {
    expect(clipError("x".repeat(60), 50)).toEqual({
      text: `${"x".repeat(50)}…`,
      clipped: true,
    });
  });
});
