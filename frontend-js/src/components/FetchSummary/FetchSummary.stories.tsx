import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor } from "storybook/test";
import { parseBookUuid } from "../../api";
import { FetchSummaryBody } from "../../api/generated/schemas";
import { hanging } from "../../testing/handlers";
import { FetchSummary } from "./FetchSummary";

const UUID = parseBookUuid("ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0");
const FOUND = "A station at the edge of the map hears something answer.";

if (!UUID) throw new Error("fixture uuid");

const sources = (...names: string[]) =>
  http.get("/api/summary/sources", () => HttpResponse.json(names));

// Answers each source from `bySource`: a string is a summary, null is a miss, a number is a status.
const summaries = (bySource: Record<string, string | null | number>) =>
  http.post("/api/ebooks/:uuid/summary/fetch", async ({ request }) => {
    const { source } = FetchSummaryBody.parse(await request.json());
    const answer = bySource[source];
    return typeof answer === "number"
      ? new HttpResponse(`failed with ${answer}`, { status: answer })
      : HttpResponse.json(answer ?? null);
  });

const meta = {
  title: "Components/FetchSummary",
  component: FetchSummary,
  args: { uuid: UUID, onFetched: fn(async () => {}) },
} satisfies Meta<typeof FetchSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FindsASummaryOnALaterSource: Story = {
  beforeEach({ msw }) {
    msw.use(
      sources("Hardcover", "GoogleBooks"),
      summaries({ Hardcover: null, GoogleBooks: FOUND }),
    );
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    );

    await waitFor(() => expect(args.onFetched).toHaveBeenCalledWith(FOUND));
    await waitFor(() =>
      expect(canvas.queryByRole("status")).not.toBeInTheDocument(),
    );
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const SearchesWhileWaiting: Story = {
  beforeEach({ msw }) {
    msw.use(
      sources("Hardcover"),
      hanging("/api/ebooks/:uuid/summary/fetch", "post"),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Fetch Summary" });

    await userEvent.click(button);

    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Searching for summary on Hardcover…",
    );
    await expect(button).toBeDisabled();
  },
};

export const FindsNoSummary: Story = {
  beforeEach({ msw }) {
    msw.use(sources("Hardcover", "OpenLibrary"), summaries({}));
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "No summary found.",
    );
    await expect(args.onFetched).not.toHaveBeenCalled();
    await expect(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    ).toBeEnabled();
  },
};

export const ReportsOnlyTheLastSourceFailing: Story = {
  beforeEach({ msw }) {
    msw.use(
      sources("Hardcover", "GoogleBooks"),
      summaries({ Hardcover: 500, GoogleBooks: 502 }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't fetch a summary: failed with 502",
    );
  },
};

export const SourcesFailToLoad: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(
        "/api/summary/sources",
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't fetch summary sources:",
    );
  },
};

export const SavingFails: Story = {
  args: {
    onFetched: fn(async () => {
      throw new Error("not allowed");
    }),
  },
  beforeEach({ msw }) {
    msw.use(sources("Hardcover"), summaries({ Hardcover: FOUND }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Fetch Summary" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't save the summary: not allowed",
    );
  },
};
