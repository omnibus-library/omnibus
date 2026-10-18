import { AccountRequests } from "../apiRequests/AccountRequests";
import { AuthorsRequests } from "../apiRequests/AuthorsRequests";
import { BookmarksRequests } from "../apiRequests/BookmarksRequests";
import { CrossFormatRequests } from "../apiRequests/CrossFormatRequests";
import { EbooksRequests } from "../apiRequests/EbooksRequests";
import { GoalsRequests } from "../apiRequests/GoalsRequests";
import { HighlightsRequests } from "../apiRequests/HighlightsRequests";
import { JournalsRequests } from "../apiRequests/JournalsRequests";
import { McpRequests } from "../apiRequests/McpRequests";
import { MergeRequests } from "../apiRequests/MergeRequests";
import { MetadataKeysRequests } from "../apiRequests/MetadataKeysRequests";
import { OverridesRequests } from "../apiRequests/OverridesRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ProgressRequests } from "../apiRequests/ProgressRequests";
import { RatingsRequests } from "../apiRequests/RatingsRequests";
import { ReadStatusRequests } from "../apiRequests/ReadStatusRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { SettingsRequests } from "../apiRequests/SettingsRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { StatsRequests } from "../apiRequests/StatsRequests";
import { ThumbsRequests } from "../apiRequests/ThumbsRequests";
import { UploadsRequests } from "../apiRequests/UploadsRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import { test as base, expect } from "./test";

type RequestFixtures = {
  scanRequests: ScanRequests;
  physicalRequests: PhysicalRequests;
  highlightsRequests: HighlightsRequests;
  progressRequests: ProgressRequests;
  readStatusRequests: ReadStatusRequests;
  bookmarksRequests: BookmarksRequests;
  shelvesRequests: ShelvesRequests;
  accountRequests: AccountRequests;
  overridesRequests: OverridesRequests;
  mergeRequests: MergeRequests;
  goalsRequests: GoalsRequests;
  settingsRequests: SettingsRequests;
  mcpRequests: McpRequests;
  usersRequests: UsersRequests;
  metadataKeysRequests: MetadataKeysRequests;
  ratingsRequests: RatingsRequests;
  ebooksRequests: EbooksRequests;
  journalsRequests: JournalsRequests;
  uploadsRequests: UploadsRequests;
  thumbsRequests: ThumbsRequests;
  authorsRequests: AuthorsRequests;
  crossFormatRequests: CrossFormatRequests;
  statsRequests: StatsRequests;
};

/**
 * Request objects over the suite admin's API context, one per endpoint family.
 * Everything above this file builds on them.
 */
export const test = base.extend<RequestFixtures>({
  scanRequests: async ({ request }, use) => {
    await use(new ScanRequests(request));
  },

  physicalRequests: async ({ request }, use) => {
    await use(new PhysicalRequests(request));
  },

  highlightsRequests: async ({ request }, use) => {
    await use(new HighlightsRequests(request));
  },

  progressRequests: async ({ request }, use) => {
    await use(new ProgressRequests(request));
  },

  readStatusRequests: async ({ request }, use) => {
    await use(new ReadStatusRequests(request));
  },

  bookmarksRequests: async ({ request }, use) => {
    await use(new BookmarksRequests(request));
  },

  shelvesRequests: async ({ request }, use) => {
    await use(new ShelvesRequests(request));
  },

  accountRequests: async ({ request }, use) => {
    await use(new AccountRequests(request));
  },

  overridesRequests: async ({ request }, use) => {
    await use(new OverridesRequests(request));
  },

  mergeRequests: async ({ request }, use) => {
    await use(new MergeRequests(request));
  },

  goalsRequests: async ({ request }, use) => {
    await use(new GoalsRequests(request));
  },

  settingsRequests: async ({ request }, use) => {
    await use(new SettingsRequests(request));
  },

  mcpRequests: async ({ request }, use) => {
    await use(new McpRequests(request));
  },

  usersRequests: async ({ request }, use) => {
    await use(new UsersRequests(request));
  },

  metadataKeysRequests: async ({ request }, use) => {
    await use(new MetadataKeysRequests(request));
  },

  ratingsRequests: async ({ request }, use) => {
    await use(new RatingsRequests(request));
  },

  ebooksRequests: async ({ request }, use) => {
    await use(new EbooksRequests(request));
  },

  journalsRequests: async ({ request }, use) => {
    await use(new JournalsRequests(request));
  },

  uploadsRequests: async ({ request }, use) => {
    await use(new UploadsRequests(request));
  },

  thumbsRequests: async ({ request }, use) => {
    await use(new ThumbsRequests(request));
  },

  authorsRequests: async ({ request }, use) => {
    await use(new AuthorsRequests(request));
  },

  crossFormatRequests: async ({ request }, use) => {
    await use(new CrossFormatRequests(request));
  },

  statsRequests: async ({ request }, use) => {
    await use(new StatsRequests(request));
  },
});

export { expect };
