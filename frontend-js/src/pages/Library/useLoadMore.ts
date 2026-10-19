import { useEffect, useRef } from "react";

type Pager = {
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
};

/** The ref for the load-more row: the next page is fetched as the row nears the viewport while `enabled`. */
export function useLoadMore(
  { isFetchingNextPage, isFetchNextPageError, fetchNextPage }: Pager,
  enabled: boolean,
) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    // After a failed page the button is the retry; re-arming here would refetch it in a loop.
    if (!el || !enabled || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      // Entries queue while the page is busy, so a stale "not yet" can precede the current one.
      (entries) =>
        entries.some((entry) => entry.isIntersecting) && fetchNextPage(),
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return row;
}
