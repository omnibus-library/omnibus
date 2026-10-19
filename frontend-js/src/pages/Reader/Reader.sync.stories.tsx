import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import type { CrossFormatResume } from "../../api/generated/schemas";
import { failing } from "../../testing/handlers";
import { epubRelocate } from "../../testing/readerGlue";
import { readerFixture, SAVED_CFI, UUID } from "../../testing/readerStory";
import { Reader } from "./Reader";

const r = readerFixture();

const SERVER_CFI = "epubcfi(/6/20!/4/2/1:0)";
const RESUME_URL = `/api/books/${UUID}/cross-format-resume?target=epub&derive=cfi`;

const meta = {
  title: "Pages/Reader/Sync",
  component: Reader,
  parameters: { path: `/read/${UUID}` },
  beforeEach: ({ msw }) => r.setup(msw),
  render: () => (
    <Routes>
      <Route path="/read/:uuid" element={<Reader />} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  ),
} satisfies Meta<typeof Reader>;

export default meta;
type Story = StoryObj<typeof meta>;

type Args = Pick<
  Parameters<NonNullable<Story["play"]>>[0],
  "canvas" | "userEvent"
>;

/** A resume whose candidate is the audiobook's place, with `mapped` laid over it. */
const resume = (
  mapped: NonNullable<CrossFormatResume["candidate"]>,
  follow = true,
): CrossFormatResume => ({ state: "candidate", follow, candidate: mapped });

const AUDIO_PLACE = {
  confidence: "user_anchored",
  source_client_updated_at: 1_760_000_000,
  source_format: "audio",
  target: "epub",
} as const;

const calls = (method: string) =>
  r.glue.calls.filter((c) => c.method === method).map((c) => c.args);

const asked = () => r.syncCalls.filter((c) => c.method === "GET").length;

/** Waits until the resume answer has been handled: a page turn runs through the same event loop. */
async function afterTheAnswer({ canvas, userEvent }: Args) {
  await canvas.findByTestId("reader-header-chapter");
  await waitFor(() => expect(asked()).toBe(1));
  await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(calls("next")).toHaveLength(1));
}

/** A glue that reports one relocate with the given overrides, then `ready`. */
const relocatingTo = (overrides: Record<string, unknown>) =>
  r.install({
    onInit() {
      window.__omnibusOnRelocate?.(
        epubRelocate({ chapterTitle: "Prologue", ...overrides }),
      );
      window.__omnibusOnStatus?.("ready");
    },
  });

const pill = (canvas: Args["canvas"]) => canvas.getByTestId("reader-sync-here");

export const FollowMovesTheTextToTheServerCfi: Story = {
  beforeEach() {
    r.crossFormat.resume = resume({
      ...AUDIO_PLACE,
      epub_cfi: SERVER_CFI,
      fraction: 0.6,
      percent: 60,
    });
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await waitFor(() => expect(calls("displayCfi")).toEqual([[SERVER_CFI]]));
    await expect(calls("displayPercentage")).toEqual([]);
    await expect(r.syncCalls).toEqual([
      { method: "GET", path: RESUME_URL, body: undefined },
    ]);
  },
};

export const FollowFallsBackToTheFractionAsAPercentage: Story = {
  beforeEach() {
    r.crossFormat.resume = resume({
      ...AUDIO_PLACE,
      fraction: 0.5,
      percent: 49,
    });
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await waitFor(() => expect(calls("displayPercentage")).toEqual([[50]]));
    await expect(calls("displayCfi")).toEqual([]);
  },
};

export const FollowFallsBackToThePercentWithNoFraction: Story = {
  beforeEach() {
    r.crossFormat.resume = resume({ ...AUDIO_PLACE, percent: 37 });
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await waitFor(() => expect(calls("displayPercentage")).toEqual([[37]]));
  },
};

export const WithFollowOffTheTextStaysPut: Story = {
  beforeEach() {
    r.crossFormat.resume = resume(
      { ...AUDIO_PLACE, epub_cfi: SERVER_CFI },
      false,
    );
  },
  play: async (args) => {
    await afterTheAnswer(args);

    await expect(calls("displayCfi")).toEqual([]);
    await expect(calls("displayPercentage")).toEqual([]);
  },
};

export const AnUnlinkedBookStaysPut: Story = {
  play: async (args) => {
    await afterTheAnswer(args);

    await expect(calls("displayCfi")).toEqual([]);
    await expect(calls("displayPercentage")).toEqual([]);
  },
};

export const ARefusedResumeLeavesTheTextAlone: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/books/:uuid/cross-format-resume", () => {
        r.syncCalls.push({ method: "GET", path: RESUME_URL, body: undefined });
        return new HttpResponse("failed", { status: 500 });
      }),
    );
  },
  play: async (args) => {
    await afterTheAnswer(args);

    await expect(calls("displayCfi")).toEqual([]);
    await expect(calls("displayPercentage")).toEqual([]);
  },
};

export const ThePillIsReadyOnceARelocateIsPrecise: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await expect(pill(canvas)).toBeEnabled();
    await expect(pill(canvas)).toHaveTextContent("Synced here");
    await expect(pill(canvas)).toHaveAttribute("aria-busy", "false");
    await expect(pill(canvas)).toHaveAttribute(
      "title",
      "Declare the ebook and audiobook aligned at this spot",
    );
  },
};

export const ThePillWaitsForAPreciseRelocate: Story = {
  beforeEach: () => relocatingTo({ pctApprox: true }),
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");
    await expect(pill(canvas)).toBeDisabled();

    window.__omnibusOnRelocate?.(epubRelocate({ pctApprox: false }));

    await waitFor(() => expect(pill(canvas)).toBeEnabled());
  },
};

export const ThePillWaitsForAPosition: Story = {
  // A glue that never reports a location.
  beforeEach: () => r.install({ onInit() {} }),
  play: async ({ canvas }) => {
    await waitFor(() => expect(r.inits()).toHaveLength(1));

    await expect(pill(canvas)).toBeDisabled();
  },
};

export const ThePillIsDisabledOffline: Story = {
  beforeEach() {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    return () => {
      Reflect.deleteProperty(navigator, "onLine");
    };
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("reader-header-chapter");

    await expect(pill(canvas)).toBeDisabled();
    await expect(r.syncCalls.filter((c) => c.method === "POST")).toEqual([]);
  },
};

let release = () => {};

export const PressingThePillDeclaresTheSyncPoint: Story = {
  beforeEach: ({ msw }) => {
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    msw.use(
      http.post("/api/books/:uuid/sync-point", async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return relocatingTo({ cfi: SAVED_CFI, frac: 0.4 });
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(pill(canvas));

    await expect(pill(canvas)).toHaveTextContent("Syncing…");
    await expect(pill(canvas)).toHaveAttribute("aria-busy", "true");
    await expect(pill(canvas)).toBeDisabled();

    release();

    await waitFor(() => expect(pill(canvas)).toHaveTextContent("Synced ✓"));
    await expect(pill(canvas)).toBeEnabled();
  },
};

export const TheDeclaredFractionAndCfiReachTheServer: Story = {
  beforeEach: () => relocatingTo({ cfi: SAVED_CFI, frac: 0.4 }),
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(pill(canvas));

    await waitFor(() =>
      expect(r.syncCalls.filter((c) => c.method === "POST")).toEqual([
        {
          method: "POST",
          path: `/api/books/${UUID}/sync-point`,
          body: {
            book_uuid: UUID,
            format: "epub",
            ebook_fraction: 0.4,
            epub_cfi: SAVED_CFI,
          },
        },
      ]),
    );
  },
};

export const TheDeclaredFractionIsClampedToTheBook: Story = {
  beforeEach: () => relocatingTo({ cfi: SAVED_CFI, frac: 1.2 }),
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(pill(canvas));

    await waitFor(() =>
      expect(r.syncCalls.at(-1)?.body).toMatchObject({ ebook_fraction: 1 }),
    );
  },
};

export const AnUnlinkedBookSaysToLinkFormatsFirst: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/books/:uuid/sync-point", 409));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(pill(canvas));

    await waitFor(() =>
      expect(pill(canvas)).toHaveTextContent("Link formats first"),
    );
  },
};

export const AnyOtherRefusalSaysSyncFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/books/:uuid/sync-point", 422));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("reader-header-chapter");

    await userEvent.click(pill(canvas));

    await waitFor(() => expect(pill(canvas)).toHaveTextContent("Sync failed"));
  },
};
