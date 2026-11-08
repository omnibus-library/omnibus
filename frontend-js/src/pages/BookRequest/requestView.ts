import {
  ApiError,
  type BookRequest,
  isLive,
  type RequestKind,
  type RequestListing,
  type RequestState,
  type RequestVersion,
  type StuckReason,
  type User,
  type UserId,
} from "../../api";
import { fileSize, plural } from "../../format";

function stuckView(reason: StuckReason | null) {
  switch (reason) {
    case "stopped_moving":
      return {
        heading: "Stopped moving",
        note: "The download stopped making progress.",
      };
    case "couldnt_add":
      return {
        heading: "Couldn’t add it",
        note: "It downloaded but couldn’t be added to the library.",
      };
    default:
      return {
        heading: "Couldn’t find it",
        note: "Nothing worth showing turned up.",
      };
  }
}

/** What a request's state is called on the page, in Omnibus's words rather than the downloader's. */
export function stateView(
  state: RequestState,
  stuckReason: StuckReason | null = null,
): {
  heading: string;
  /** Absent where the lane's own content says it. */
  note: string | null;
} {
  switch (state) {
    case "looking":
      return {
        heading: "Looking",
        note: "Searching for versions of this book.",
      };
    case "choose":
      return { heading: "Choose a version", note: null };
    case "chosen":
      return { heading: "Version chosen", note: "We’ll fetch it next." };
    case "on_its_way":
      return {
        heading: "On its way",
        note: "Downloading, then adding it to the library.",
      };
    case "ready":
      return { heading: "Ready to read", note: "It’s in the library." };
    case "stuck":
      return stuckView(stuckReason);
    case "cancelled":
      return { heading: "Cancelled", note: "This request was cancelled." };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Whether a request's picked version is still downloading. */
export const isDownloading = ({
  state,
  progress,
}: Pick<BookRequest, "state" | "progress">) =>
  state === "on_its_way" && (progress ?? 0) < 1;

/** Whether Cancel is offered: any request still going, until its download is complete. */
export const isCancellable = (
  request: Pick<BookRequest, "state" | "progress">,
) =>
  request.state === "on_its_way"
    ? isDownloading(request)
    : isLive(request.state);

/** A download's progress as a whole percent, rounded down and held under 100 until it is done, so the bar never reads done early. */
export function progressPercent(progress: number | null) {
  // Rounded to a hundredth of a percent first, so 0.29 * 100 = 28.999… still reads 29.
  const percent = Math.floor(Math.round((progress ?? 0) * 1e4) / 100);
  return progress !== null && progress < 1 ? Math.min(percent, 99) : percent;
}

/** The percent a download shows while it runs; `null` before the client reports, once it is complete, or for any other state. */
export const downloadPercent = (
  request: Pick<BookRequest, "state" | "progress">,
) =>
  isDownloading(request) && request.progress !== null
    ? progressPercent(request.progress)
    : null;

/** The version a request picked, if any. */
export const pickedVersion = (
  request: Pick<BookRequest, "versions" | "chosenResultId">,
) => request.versions.find((v) => v.id === request.chosenResultId);

/** How long the Undo toast stays: until a second and a half before the server's `cancelAt` (Unix seconds), so Undo is never offered after the grace. */
export const undoToastMs = (cancelAt: number, now: number) =>
  Math.max(0, (cancelAt - now - 1.5) * 1000);

/** A book's request: the Requests page with the book selected. */
export const requestPath = (uuid: string) =>
  `/requests?book=${encodeURIComponent(uuid)}`;

/** A version's size, kept on one line, or `null` when the source did not say. */
export const versionSize = (bytes: number | null) =>
  bytes === null ? null : (fileSize(bytes)?.replace(" ", "\u00a0") ?? null);

/** Joins the parts of a line; non-breaking before the dot, so a line never starts with a separator. */
export const SEP = "\u00a0· ";

const seeds = (n: number) =>
  `${n.toLocaleString("en-US")}\u00a0seed${plural(n)}`;

/** How a version is shared: Usenet, its seeds, or `null` for a torrent whose seeds are unknown. */
const sharing = ({
  protocol,
  seeders,
}: Pick<RequestVersion, "protocol" | "seeders">) => {
  if (protocol === "usenet") return "Usenet";
  return seeders === null ? null : seeds(seeders);
};

/** A version's source line: "MyAnonamouse · EPUB · 1.8 MB · 142 seeds", or "… · Usenet"; a missing source or seed count drops out. */
export const versionSource = (
  version: Pick<
    RequestVersion,
    "indexer" | "format" | "sizeBytes" | "seeders" | "protocol"
  >,
) =>
  [
    version.indexer,
    version.format ?? "Format unknown",
    versionSize(version.sizeBytes) ?? "Size unknown",
    sharing(version),
  ]
    .filter((part) => part !== null)
    .join(SEP);

/** The line under a picked version's name: its size and source, each left out when unknown. */
export const pickedMeta = (
  version: Pick<RequestVersion, "indexer" | "sizeBytes">,
) =>
  [versionSize(version.sizeBytes), version.indexer]
    .filter((part) => part !== null)
    .join(SEP);

/** The heading a phone gives a picked version: its format and size, each left out when unknown. */
export const pickedHeading = (
  version: Pick<RequestVersion, "format" | "sizeBytes">,
) =>
  [version.format, versionSize(version.sizeBytes)]
    .filter((part) => part !== null)
    .join(SEP);

/** The caption over the versions: how many can be chosen, and that the best match leads when one does. */
export function versionsFound(versions: readonly RequestVersion[]) {
  const choosable = versions.filter((v) => !v.rejected);
  const count = `${choosable.length} version${plural(choosable.length)} found`;
  return choosable.some((v) => v.bestMatch)
    ? `${count} · Best match first`
    : count;
}

/** How many versions that can be chosen show before Show more. */
const SHOWN_AT_FIRST = 4;

/** The versions shown before Show more: the first four that can be chosen, and every one that was tried. */
export function firstShown(versions: readonly RequestVersion[]) {
  const offerable = versions
    .filter((v) => !v.rejected)
    .slice(0, SHOWN_AT_FIRST);
  return versions.filter((v) => v.rejected || offerable.includes(v));
}

/** A size's "×", with a non-breaking space either side so a size never splits across lines. */
const TIMES = "\u00a0×\u00a0";

/** The cover offer's sizes in pixels, as the card says them; it never says where the existing cover came from. */
export const coverSizesLine = ({
  width,
  height,
  currentWidth,
  currentHeight,
}: NonNullable<BookRequest["coverOffer"]>) =>
  `Its cover is ${width}${TIMES}${height}. The existing one is ${currentWidth}${TIMES}${currentHeight}.`;

/** Why starting a request failed, as a sentence for a toast. */
export function startFailure(error: unknown): string {
  const status = error instanceof ApiError ? error.status : null;
  switch (status) {
    case 429:
      return "You have a lot of requests going. Try again in a few minutes.";
    case 403:
      return "Your account can’t make requests.";
    case 404:
      return "That book is no longer in the library.";
    default:
      return "Couldn’t start the request.";
  }
}

/** What the lane says while a search runs, and once it has run long enough to say it is still going. */
export const LOOKING_LABEL = "Looking for versions…";
export const LOOKING_SLOW_LABEL = "Still searching for versions…";

/** How long a search runs before its lane says it is still going. */
export const SEARCH_SLOW_AFTER_SECS = 20;

/** How long a search may run before its request offers Try again: past the first attempt's 120 s timeout. */
export const SEARCH_STALE_AFTER_SECS = 150;

/** Whether a search that began at `updatedAt` (Unix seconds) has run long enough by `now` to say it is still going. */
export const isSearchSlow = (updatedAt: number, now: number) =>
  now - updatedAt >= SEARCH_SLOW_AFTER_SECS;

/** Whether a search that began at `updatedAt` (Unix seconds) has run past its timeout by `now`. */
export const isSearchStale = (updatedAt: number, now: number) =>
  now - updatedAt >= SEARCH_STALE_AFTER_SECS;

const AUDIO_FORMATS = ["M4B", "M4A", "MP3"];

const upper = (formats: readonly string[]) =>
  formats.map((f) => f.toUpperCase());

/** Whether `formats` include an ebook: print never counts, audio is M4B, M4A or MP3, and any other format is an ebook. */
export const holdsEbook = (formats: readonly string[]) =>
  upper(formats).some((f) => f !== "PRINT" && !AUDIO_FORMATS.includes(f));

/** Whether `formats` include an audiobook. */
export const holdsAudiobook = (formats: readonly string[]) =>
  upper(formats).some((f) => AUDIO_FORMATS.includes(f));

/** Whether `viewer` may cancel `request`: anyone who can pick versions, or the reader who made it. */
export const canCancel = (
  viewer: Pick<User, "id" | "canChooseRequestVersions">,
  request: Pick<BookRequest, "userId">,
) => viewer.canChooseRequestVersions || viewer.id === request.userId;

const versionFacts = (version: RequestVersion) => {
  const size = versionSize(version.sizeBytes);
  return [version.format ?? "Unknown", ...(size ? [size] : [])];
};

/** What happened to a request, only from what was recorded: its `head` ("Cancelled by you") and the `details` after it (the version and how far it got). */
export function factParts(
  { request, cancelledByName }: RequestListing,
  viewer: UserId,
): { head: string; details: string[] } {
  const canceller =
    request.cancelledBy === viewer ? "you" : (cancelledByName ?? null);
  const head =
    request.state !== "cancelled"
      ? stateView(request.state, request.stuckReason).heading
      : canceller
        ? `Cancelled by ${canceller}`
        : "Cancelled";
  const picked = pickedVersion(request);
  const ended = request.state === "cancelled" || request.state === "stuck";
  const stoppedShort =
    ended && request.progress !== null && request.progress < 1;
  return {
    head,
    details: [
      ...(picked ? versionFacts(picked) : []),
      ...(stoppedShort
        ? [`stopped at ${progressPercent(request.progress)}%`]
        : []),
    ],
  };
}

/** What happened to a request in one line: "Cancelled by you · EPUB · 2.4 MB · stopped at 40%". */
export function requestFacts(listing: RequestListing, viewer: UserId): string {
  const { head, details } = factParts(listing, viewer);
  return [head, ...details].join(" · ");
}

/** One line per version the request gave up for another, keyed by the version's id. */
export const swapFacts = ({ request }: RequestListing) =>
  request.versions
    .filter((v) => v.rejected)
    .map((v) => ({
      id: v.id,
      text: ["Swapped for another version", ...versionFacts(v)].join(" · "),
    }));

/** What a request's format is called: "Ebook" or "Audiobook". */
export function kindLabel(kind: RequestKind): string {
  switch (kind) {
    case "ebook":
      return "Ebook";
    case "audiobook":
      return "Audiobook";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** The file format a request's chip names. */
export const kindChip = (kind: RequestKind) =>
  kind === "ebook" ? "EPUB" : "M4B";

/** Whether Request again is offered on `request`: a cancelled one whose undo has run out (`now` in Unix seconds), to a reader who may request and has no request of that format going for the book already, since starting one would only return it. */
export function offersRequestAgain(
  request: Pick<BookRequest, "kind" | "state" | "cancelAt">,
  viewer: Pick<User, "id" | "canStartRequests">,
  bookRequests: readonly Pick<BookRequest, "userId" | "kind" | "state">[],
  now: number,
): boolean {
  const undoOpen = request.cancelAt !== null && now < request.cancelAt;
  const alreadyGoing = bookRequests.some(
    (r) => r.userId === viewer.id && r.kind === request.kind && isLive(r.state),
  );
  return (
    request.state === "cancelled" &&
    viewer.canStartRequests &&
    !undoOpen &&
    !alreadyGoing
  );
}

/** A book's requests besides the one on screen: those still going, and stuck ones that await a Try again, get a lane of their own; the history keeps the cancelled ones and any that swapped a version. */
export function splitBookRequests(
  listings: readonly RequestListing[],
  shown: number,
) {
  const others = listings.filter((l) => l.request.id !== shown);
  return {
    lanes: others.filter(
      ({ request }) => isLive(request.state) || request.state === "stuck",
    ),
    history: others.filter(
      ({ request }) =>
        request.state === "cancelled" ||
        (request.state !== "stuck" && request.versions.some((v) => v.rejected)),
    ),
  };
}

/** A history row's day, "Oct 12", on the reader's calendar unless `timeZone` names another. */
export const historyDay = (unixSecs: number, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(unixSecs * 1000);

/** Whether a wishlist opened the page, from the router state its link handed over. */
export const fromWishlists = (state: unknown) =>
  typeof state === "object" &&
  state !== null &&
  "from" in state &&
  state.from === FROM_WISHLISTS.from;

/** The router state a request started from a wishlist carries. */
export const FROM_WISHLISTS = { from: "wishlists" } as const;

/** One step of a lane's stepper: done, the one it is on, or still to come. */
export type RequestStep = {
  label: string;
  status: "done" | "current" | "todo";
  /** The download's percent, on the On its way step while it runs. */
  percent: number | null;
};

/** The step each state is on; ready has passed them all. */
const STEP_OF = {
  looking: 0,
  choose: 1,
  chosen: 2,
  on_its_way: 2,
  ready: 4,
} as const;

/** A lane's stepper, Looking → Choose a version → On its way → Ready, labelled by how far the request got; `null` for a stuck or cancelled one, which says so in words instead. */
export function stepsFor(
  request: Pick<BookRequest, "state" | "progress" | "versions">,
): RequestStep[] | null {
  if (request.state === "stuck" || request.state === "cancelled") return null;
  const at = STEP_OF[request.state];
  const status = (step: number): RequestStep["status"] =>
    step < at ? "done" : step === at ? "current" : "todo";
  const found = request.versions.length;
  return [
    {
      label: at > 0 && found > 0 ? `Looking · ${found} found` : "Looking",
      status: status(0),
      percent: null,
    },
    {
      label: at > 1 ? "Chose a version" : "Choose a version",
      status: status(1),
      percent: null,
    },
    {
      label: "On its way",
      status: status(2),
      percent: downloadPercent(request),
    },
    { label: "Ready", status: status(3), percent: null },
  ];
}

/** How long a download has left at `now` (Unix seconds), roughly; `null` when the client can't tell, the time has come, or the download is complete. */
export function timeLeft(
  {
    expectedDoneAt,
    progress,
  }: Pick<BookRequest, "expectedDoneAt" | "progress">,
  now: number,
): string | null {
  if (expectedDoneAt === null || (progress ?? 0) >= 1) return null;
  const secs = expectedDoneAt - now;
  if (secs <= 0) return null;
  if (secs < 60) return "less than a minute left";
  const minutes = Math.round(secs / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.round(secs / 3600);
  return `about ${hours} hour${plural(hours)} left`;
}

/** Who wants the book, "On Jordan’s and Riley’s wishlists", with the viewer as "your"; `null` when nobody does. */
export function wishersLine(
  wanters: readonly { id: UserId; name: string }[],
  viewer: UserId,
): string | null {
  const owners = wanters.map((w) => (w.id === viewer ? "your" : `${w.name}’s`));
  const last = owners.pop();
  if (last === undefined) return null;
  if (owners.length === 0) return `On ${last} wishlist`;
  return `On ${owners.join(", ")} and ${last} wishlists`;
}
