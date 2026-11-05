import {
  ApiError,
  type BookRequest,
  type RequestListing,
  type RequestState,
  type RequestVersion,
  type StuckReason,
  type User,
  type UserId,
} from "../../api";
import { fileSize } from "../../format";

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
  Math.floor((progress ?? 0) * 100);

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
  return [
    head,
    ...(picked ? versionFacts(picked) : []),
    ...(ended && request.progress !== null
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

/** Whether a listed request's book matches what was typed into the book filter: its title or an author, in any case. */
export function matchesBook({ book }: RequestListing, query: string) {
  const needle = query.trim().toLowerCase();
  return [book.title, ...book.authors].some((text) =>
    text.toLowerCase().includes(needle),
  );
}
