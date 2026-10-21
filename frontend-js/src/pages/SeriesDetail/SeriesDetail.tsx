import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { parseSeriesId, seriesQuery } from "../../api";
import { ButtonLink } from "../../components/Button/Button";
import { CoverImage } from "../../components/Cover/CoverImage";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { seriesEyebrow } from "../Series/seriesIndex";
import "../../components/DiscPage/DiscPage.css";
import "./SeriesDetail.css";

/** `/series/:id`: the series' books in reading order, each with its blurb. */
export function SeriesDetail() {
  const id = parseSeriesId(useParams().id);
  const query = useQuery(seriesQuery(id));
  const series = query.data;

  if (series === undefined) {
    return query.isError ? (
      <PageError message={query.error.message} />
    ) : id === null ? (
      <PageNotFound subject="Series" />
    ) : (
      <Loading kind="page" label="Gathering the series" />
    );
  }
  if (series === null) return <PageNotFound subject="Series" />;

  const accent = series.books.find((b) => b.accent !== null)?.accent ?? null;
  const space = series.name.indexOf(" ");
  const first = space < 0 ? series.name : series.name.slice(0, space);
  const rest = space < 0 ? "" : series.name.slice(space + 1);
  return (
    <div
      className="disc-page"
      style={accent ? { "--accent": accent } : undefined}
    >
      <PageTitle page={series.name} />
      <div className="disc-series-header">
        <div className="disc-series-head-row">
          <div>
            <span className="label">{`Series · ${series.bookCount} in library`}</span>
            <h1 className="disc-hero-title">
              <em>{first}</em>
              {rest && ` ${rest}`}
            </h1>
          </div>
        </div>
      </div>
      <div className="disc-body">
        {series.books.length === 0 ? (
          <>
            <p className="subtitle" data-testid="series-empty">
              No books in this series are in your library.
            </p>
            <ButtonLink to="/series">Back to series</ButtonLink>
          </>
        ) : (
          <div className="series-cards">
            {series.books.map((book) => (
              <article key={book.uuid} className="card series-card">
                <div className="series-card-cover">
                  <Link to={`/books/${book.uuid}`}>
                    <CoverImage book={book} />
                  </Link>
                </div>
                <div className="series-card-info">
                  <span className="label">{seriesEyebrow(book)}</span>
                  <h3 className="series-card-title">
                    <Link
                      to={`/books/${book.uuid}`}
                      className="series-card-hit"
                    >
                      {book.title}
                    </Link>
                  </h3>
                  {book.description && (
                    <div
                      className="series-card-desc"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: the API runs descriptions through ammonia, which the Dioxus page relies on too
                      dangerouslySetInnerHTML={{ __html: book.description }}
                    />
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
