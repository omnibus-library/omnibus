import {
  ApiError,
  type BookRequest,
  isMoving,
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
  note: string;
} {
  switch (state) {
    case "looking":
      return {
        heading: "Looking",
        note: "Searching for versions of this book.",
      };
    case "choose":
      return {
        heading: "Choose a version",
        note: "Pick the version you want.",
      };
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
  request.state === "looking" ||
  request.state === "choose" ||
  request.state === "chosen" ||
  isDownloading(request);

/** A download's progress as a whole percent, rounded down so the bar never reads done early. */
export const progressPercent = (progress: number | null) =>
  // Rounded to a hundredth of a percent first, so 0.29 * 100 = 28.999… still reads 29.
  Math.floor(Math.round((progress ?? 0) * 1e4) / 100);

/** How long the Undo toast stays: until a second and a half before the server's `cancelAt` (Unix seconds), so Undo is never offered after the grace. */
export const undoToastMs = (cancelAt: number, now: number) =>
  Math.max(0, (cancelAt - now - 1.5) * 1000);

/** A request's own page: the book's address with `/request`. */
export const requestPath = (uuid: string, id: number) =>
  `/books/${uuid}/request?id=${id}`;

/** The format a version is in; one whose name says none is Unknown. */
export const versionFormat = (format: string | null) => format ?? "Unknown";

/** A version's size, or `null` when the source did not say. */
export const versionSize = (bytes: number | null) =>
  bytes === null ? null : fileSize(bytes);

/** How many peers share a version, or `null` for a source with none, such as Usenet. */
export const versionSeeders = (seeders: number | null) =>
  seeders === null
    ? null
    : `${seeders} ${seeders === 1 ? "seeder" : "seeders"}`;

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

/** How long a search may run before its request offers Try again: past the server's 30 s timeout. */
export const SEARCH_STALE_AFTER_SECS = 60;

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

/** Whether `viewer` may act on `request`: an admin, or the reader who made it while they may still request. */
export const canActOn = (
  viewer: Pick<User, "id" | "isAdmin" | "canRequest">,
  request: Pick<BookRequest, "userId">,
) => viewer.isAdmin || (viewer.canRequest && viewer.id === request.userId);

const versionFacts = (version: RequestVersion) => {
  const size = versionSize(version.sizeBytes);
  return [versionFormat(version.format), ...(size ? [size] : [])];
};

/** What happened to a request, only from what was recorded: "Cancelled by you · EPUB · 2.4 MB · stopped at 40%". */
export function requestFacts(
  { request, cancelledByName }: RequestListing,
  viewer: UserId,
): string {
  const canceller =
    request.cancelledBy === viewer ? "you" : (cancelledByName ?? null);
  const head =
    request.state !== "cancelled"
      ? stateView(request.state, request.stuckReason).heading
      : canceller
        ? `Cancelled by ${canceller}`
        : "Cancelled";
  const picked = request.versions.find((v) => v.id === request.chosenResultId);
  const ended = request.state === "cancelled" || request.state === "stuck";
  const stoppedShort =
    ended && request.progress !== null && request.progress < 1;
  return [
    head,
    ...(picked ? versionFacts(picked) : []),
    ...(stoppedShort
      ? [`stopped at ${progressPercent(request.progress)}%`]
      : []),
  ].join(" · ");
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
  viewer: Pick<User, "id" | "canRequest">,
  bookRequests: readonly Pick<BookRequest, "userId" | "kind" | "state">[],
  now: number,
): boolean {
  const undoOpen = request.cancelAt !== null && now < request.cancelAt;
  const alreadyGoing = bookRequests.some(
    (r) => r.userId === viewer.id && r.kind === request.kind && isLive(r.state),
  );
  return (
    request.state === "cancelled" &&
    viewer.canRequest &&
    !undoOpen &&
    !alreadyGoing
  );
}

/** Whether a request is still going for its reader: looking, choosing, picked or downloading. */
export const isLive = (state: RequestState) =>
  state === "choose" || isMoving(state);

/** A book's requests besides the one on screen: those still going get a lane of their own, and the history keeps the cancelled and stuck ones and any that swapped a version. */
export function splitBookRequests(
  listings: readonly RequestListing[],
  shown: number,
) {
  const others = listings.filter((l) => l.request.id !== shown);
  return {
    lanes: others.filter((l) => isLive(l.request.state)),
    history: others.filter(
      ({ request }) =>
        request.state === "cancelled" ||
        request.state === "stuck" ||
        request.versions.some((v) => v.rejected),
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

/** Whether the page was opened from the Requests list, which hands this router state over. */
export const cameFromRequests = (state: unknown) =>
  typeof state === "object" &&
  state !== null &&
  "from" in state &&
  state.from === "requests";

/** The router state a link from the Requests list carries. */
export const FROM_REQUESTS = { from: "requests" } as const;

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
  const downloading =
    request.state === "on_its_way" &&
    request.progress !== null &&
    request.progress < 1;
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
      percent: downloading ? progressPercent(request.progress) : null,
    },
    { label: "Ready", status: status(3), percent: null },
  ];
}

/** How long a download has left from `now` to `expectedDoneAt` (Unix seconds), roughly; `null` when the client can't tell. */
export function timeLeft(
  expectedDoneAt: number | null,
  now: number,
): string | null {
  if (expectedDoneAt === null) return null;
  const secs = expectedDoneAt - now;
  if (secs < 60) return "less than a minute left";
  const minutes = Math.round(secs / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.round(secs / 3600);
  return `about ${hours} hour${plural(hours)} left`;
}

/** A picked version's size and source, "3.1 MB · MyAnonamouse", leaving out what is unknown. */
export const pickedMeta = (version: RequestVersion) =>
  [versionSize(version.sizeBytes), version.indexer]
    .filter((part) => part !== null)
    .join(" · ");

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
