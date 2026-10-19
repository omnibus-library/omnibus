import { queryOptions, skipToken } from "@tanstack/react-query";
import {
  type BookUuid,
  fetchAlignment,
  fetchProgress,
  fetchReadStatus,
  fetchSeries,
  type SeriesId,
} from "../../api";

// The cached answers more than one stop reads; the keys let a write invalidate by prefix.

export const seriesQuery = (id: SeriesId | null) =>
  queryOptions({
    queryKey: ["series", id],
    queryFn: id === null ? skipToken : () => fetchSeries(id),
  });

export const progressQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "progress"],
    queryFn: () => fetchProgress(uuid),
  });

export const alignmentQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "alignment"],
    queryFn: () => fetchAlignment(uuid),
  });

export const readStatusQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "readStatus"],
    queryFn: () => fetchReadStatus(uuid),
  });
