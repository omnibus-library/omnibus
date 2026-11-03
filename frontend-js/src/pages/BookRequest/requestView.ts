import { ApiError, type RequestState } from "../../api";
import { fileSize } from "../../format";

/** What a request's state is called on the page, in Omnibus's words rather than the downloader's. */
export function stateView(state: RequestState): {
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
    case "stuck":
      return {
        heading: "Couldn’t find it",
        note: "Nothing worth showing turned up.",
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

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
