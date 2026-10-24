import { useParams } from "react-router";
import { parseSeriesId } from "../../api";
import { PageNotFound } from "../../components/PageState/PageState";
import { SeriesPane } from "./SeriesPane";

/** `/series/:id`'s pane, inside the series list's layout. */
export function SeriesDetail() {
  const id = parseSeriesId(useParams().id);
  return id === null ? (
    <PageNotFound
      subject="Series"
      backTo="/series"
      backLabel="Back to series"
    />
  ) : (
    <SeriesPane id={id} />
  );
}
