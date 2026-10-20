import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import type { within } from "storybook/test";
import {
  getGetCleanupCountsMockHandler200,
  getGetCleanupQueueMockHandler200,
} from "../../api/generated/omnibus.msw";
import {
  aWireCleanupCounts,
  aWireSuggestion,
  cleanupDecisionHandler,
  cleanupUndoHandler,
  type Decided,
} from "../../testing/adminHandlers";
import { CleanupReview } from "./CleanupReview";

// Shared by the three CleanupReview story files; the name keeps it out of the `*.stories.tsx` glob.

export const TAG_QUEUE = "/api/admin/cleanup/tag/queue";

const MERGE = aWireSuggestion({
  id: 1,
  primary_name: "Science Fiction",
  secondary_name: null,
  source_names: ["Sci-Fi", "SciFi", "Science-Fiction"],
  book_count: 3,
});
export const SPLIT = aWireSuggestion({
  id: 2,
  action: "split",
  primary_name: "Fiction; Poland",
  secondary_name: null,
  source_names: [],
  proposed_parts: ["Fiction", "Poland"],
  book_count: 1,
});
const MERGE_AGAIN = aWireSuggestion({
  id: 3,
  primary_name: "Horror",
  secondary_name: "Horror fiction",
  source_names: ["Horror fiction"],
  book_count: 2,
});
export const QUEUE = [MERGE, SPLIT, MERGE_AGAIN];

export const decided: Decided[] = [];
export const undone: number[] = [];
/** How often each list has been read since the story began. */
export const reads = { queue: 0, counts: 0 };

/** The review page at its route, as the app mounts it. */
export function ReviewRoute() {
  return (
    <Routes>
      <Route path="/admin/cleanup/:kind" element={<CleanupReview />} />
    </Routes>
  );
}

/** What every story starts from: the recorders emptied and the three-card tag queue. */
export const resetReview: NonNullable<
  Meta<typeof CleanupReview>["beforeEach"]
> = ({ msw }) => {
  decided.length = 0;
  undone.length = 0;
  reads.queue = 0;
  reads.counts = 0;
  msw.use(
    getGetCleanupQueueMockHandler200(() => {
      reads.queue += 1;
      return QUEUE;
    }),
    getGetCleanupCountsMockHandler200(() => {
      reads.counts += 1;
      return aWireCleanupCounts();
    }),
    cleanupDecisionHandler({ decided }),
    cleanupUndoHandler({ undone }),
  );
};

type Story = StoryObj<typeof CleanupReview>;

const RENAMES = [
  aWireSuggestion({
    id: 11,
    kind: "book_title",
    action: "rename",
    primary_name: "Shelley, Mary - Frankenstein",
    secondary_name: "Frankenstein",
    source_names: [],
    book_count: 1,
  }),
  aWireSuggestion({
    id: 12,
    kind: "book_title",
    action: "rename",
    primary_name: "Austen - Emma",
    secondary_name: "Emma",
    source_names: [],
    book_count: 1,
  }),
];

/** A story over the book-title queue, whose cards carry a title the reviewer can rewrite. */
export const renaming = (play: Story["play"]): Story => ({
  parameters: { path: "/admin/cleanup/book_title" },
  beforeEach({ msw }) {
    msw.use(getGetCleanupQueueMockHandler200(() => RENAMES));
  },
  play,
});

/** The dots' state words, for the card the pass is on. */
export const progressText = (canvas: ReturnType<typeof within>) =>
  canvas.getByTestId("cleanup-progress").textContent;
