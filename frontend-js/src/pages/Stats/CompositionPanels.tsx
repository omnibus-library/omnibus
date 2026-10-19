import type { LibraryComposition } from "../../api";
import { Skeleton } from "../../components/Loading/Loading";
import {
  barWidth,
  buildPanels,
  ghostedNote,
  isEmptyComposition,
  type Panel,
  sliceColor,
} from "./composition";
import { groupThousands } from "./summary";

/** One dimension's bars, or a sentence when nothing in the library carries it rather than an axis with no bars. Every slice the server sent is drawn; the decade histogram is unfolded and untruncated. */
function CompositionPanel({ panel }: { panel: Panel }) {
  const max = Math.max(0, ...panel.slices.map((slice) => slice.books));
  return (
    <section className="card st-comp-panel" data-testid={panel.testId}>
      <div className="st-comp-head">
        <h4 className="st-comp-title">{panel.title}</h4>
        {panel.note !== null && (
          <span className="st-comp-note" data-testid="stats-composition-note">
            {panel.note}
          </span>
        )}
      </div>
      {panel.slices.length === 0 ? (
        <p className="st-card-empty" data-testid="stats-composition-empty">
          {panel.empty}
        </p>
      ) : (
        <div className="st-comp-rows">
          {panel.slices.map((slice, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the server folds a tail into an "Other" row a real publisher could collide with
              key={i}
              className="st-split-half"
              data-testid="stats-composition-bar"
            >
              <div className="st-split-head">
                <span className="st-split-name">{slice.label}</span>
                {/* The count, not the share, grouped like every figure here so a four-digit bucket doesn't read differently from its note. */}
                <span className="st-split-pct">
                  {groupThousands(slice.books)}
                </span>
              </div>
              <div className="st-split-track">
                <div
                  className="st-split-fill"
                  style={{
                    width: `${barWidth(slice.books, max)}%`,
                    background: sliceColor(i),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** What the collection is made of, a card per dimension. Placeholder panels until the read lands, never carrying the card's testid, and nothing for a library with no live books. */
export function CompositionPanels({
  composition,
}: {
  composition: LibraryComposition | undefined;
}) {
  if (composition === undefined) {
    return (
      <div
        className="st-comp"
        role="status"
        aria-live="polite"
        data-testid="stats-library-composition-loading"
      >
        <span className="ld-sr">Sorting the collection</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card st-comp-panel">
            <Skeleton index={i} style={{ "--w": "40%" }} />
            <Skeleton
              shape="block"
              index={i}
              style={{ "--h": "120px", marginTop: "16px" }}
            />
          </div>
        ))}
      </div>
    );
  }
  if (isEmptyComposition(composition)) return null;
  const ghosted = ghostedNote(composition.ghosted_books);
  return (
    <>
      <div className="st-comp" data-testid="stats-library-composition">
        {buildPanels(composition).map((panel) => (
          <CompositionPanel key={panel.testId} panel={panel} />
        ))}
      </div>
      {ghosted !== null && (
        <p className="st-comp-ghosted" data-testid="stats-composition-ghosted">
          {ghosted}
        </p>
      )}
    </>
  );
}
