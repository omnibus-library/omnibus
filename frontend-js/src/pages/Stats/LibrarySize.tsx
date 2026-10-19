import type { LibrarySize } from "../../api";
import { Skeleton } from "../../components/Loading/Loading";
import { buildFigures, heroSentence } from "./library";

/** The Library scope's hero: the collection in one sentence over its size in words, pages and hours of audio. A placeholder until the read lands, never carrying the card's testid, and nothing when the library has been measured for nothing, as three zeroes would read as a claim about the collection. */
export function LibrarySizeHero({ size }: { size: LibrarySize | undefined }) {
  if (size === undefined) {
    return (
      <div
        className="card st-lib"
        role="status"
        aria-live="polite"
        data-testid="stats-library-size-loading"
      >
        <span className="ld-sr">Measuring the shelf</span>
        <Skeleton style={{ "--w": "78%", height: "1.6em" }} />
        <Skeleton
          style={{ "--w": "52%", height: "1.6em", marginTop: "12px" }}
        />
      </div>
    );
  }
  const figures = buildFigures(size);
  if (figures.length === 0) return null;
  const { books, words, tail } = heroSentence(size);
  return (
    <div className="card st-lib" data-testid="stats-library-size">
      <p className="st-lib-sentence">
        {books}{" "}
        {words !== null && (
          <>
            <span className="st-lib-accent">{words}</span>
            {tail}
          </>
        )}
      </p>
      <div className="st-lib-grid">
        {figures.map((figure) => (
          <div
            key={figure.unit}
            className="st-lib-figure"
            data-testid="stats-library-figure"
          >
            <div className="st-lib-value">
              {figure.value}
              <span className="st-lib-unit">{` ${figure.unit}`}</span>
            </div>
            <div className="st-lib-coverage">{figure.coverage}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
