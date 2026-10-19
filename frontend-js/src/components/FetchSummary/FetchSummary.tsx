import { useState } from "react";
import { type BookUuid, fetchSummary, fetchSummarySources } from "../../api";
import type { SummarySource } from "../../api/generated/schemas";
import { SparkleGlyph } from "../Glyphs/Glyphs";
import { Ring } from "../Loading/Loading";
import "./FetchSummary.css";

const SEARCHING = {
  Hardcover: "Searching for summary on Hardcover…",
  GoogleBooks: "Searching for summary on Google Books…",
  OpenLibrary: "Searching for summary on OpenLibrary…",
} satisfies Record<SummarySource, string>;

type State =
  | { kind: "idle" }
  | { kind: "searching"; source: SummarySource }
  | { kind: "error"; message: string };

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Walks the server's ordered plan. A miss or an error on one source falls through to
// the next: the goal is a summary from anywhere, so only the last source's outcome is reported.
async function findSummary(
  uuid: BookUuid,
  show: (state: State) => void,
): Promise<string | null> {
  const sources = await fetchSummarySources().catch((error: unknown) => {
    show({
      kind: "error",
      message: `Couldn't fetch summary sources: ${messageOf(error)}`,
    });
    return null;
  });
  if (!sources) return null;
  if (sources.length === 0) {
    show({
      kind: "error",
      message: "Couldn't fetch a summary: no sources are configured.",
    });
    return null;
  }
  for (const [i, source] of sources.entries()) {
    show({ kind: "searching", source });
    const isLast = i === sources.length - 1;
    try {
      const text = await fetchSummary(uuid, source);
      if (text) return text;
      if (isLast) show({ kind: "error", message: "No summary found." });
    } catch (error) {
      if (isLast)
        show({
          kind: "error",
          message: `Couldn't fetch a summary: ${messageOf(error)}`,
        });
    }
  }
  return null;
}

type FetchSummaryProps = {
  uuid: BookUuid;
  /** Saves the text it finds; a rejection is shown under the button. */
  onFetched: (text: string) => Promise<unknown>;
};

/** A button that asks the summary sources for a blurb, one by one, and hands the first it finds to `onFetched`. */
export function FetchSummary({ uuid, onFetched }: FetchSummaryProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const text = await findSummary(uuid, setState);
    try {
      if (text) await onFetched(text);
      if (text) setState({ kind: "idle" });
    } catch (error) {
      setState({
        kind: "error",
        message: `Couldn't save the summary: ${messageOf(error)}`,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fs-fetch">
      <button
        type="button"
        className="btn fs-fetch-btn"
        data-testid="fetch-summary"
        disabled={running}
        onClick={run}
      >
        <span className="fs-fetch-mark" aria-hidden="true">
          <SparkleGlyph />
        </span>
        Fetch Summary
      </button>
      {state.kind === "searching" && (
        <div
          className="fs-fetch-status"
          role="status"
          data-testid="fetch-summary-status"
        >
          <Ring />
          <span>{SEARCHING[state.source]}</span>
        </div>
      )}
      {state.kind === "error" && (
        <div
          className="fs-fetch-error"
          role="alert"
          data-testid="fetch-summary-error"
        >
          {state.message}
        </div>
      )}
    </div>
  );
}
