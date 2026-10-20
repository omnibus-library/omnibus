import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type MetadataLibrary,
  type MetadataSource,
  metadataOrderQuery,
  saveMetadataOrder,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { useUnsavedForm } from "../../components/SettingsShell/SettingsShell";
import {
  changedOrder,
  type Direction,
  focusAfterMove,
  moveSource,
  positionAnnouncement,
  type SaveOutcome,
  saveSummary,
  sourceLabel,
} from "./metadataOrder";
import { LiveStatus, type Status } from "./StatusLine";

const LIBRARIES = [
  { library: "ebook", label: "Ebook library" },
  { library: "audiobook", label: "Audiobook library" },
] as const;

type Order = readonly MetadataSource[];

// Items are keyed by source, so a move carries the row rather than relabelling rows in place.
function PrecedenceList({
  library,
  label,
  order,
  busy,
  onMove,
}: {
  library: MetadataLibrary;
  label: string;
  order: Order;
  busy: boolean;
  onMove: (index: number, direction: Direction) => void;
}) {
  const testId = `${library}-metadata-precedence`;
  return (
    <div className="settings-field" data-testid={testId}>
      <span className="settings-label" id={`${testId}-label`}>
        {label}
      </span>
      <ol
        className="metadata-precedence-list"
        aria-labelledby={`${testId}-label`}
      >
        {order.map((source, i) => (
          <li
            key={source}
            className="metadata-precedence-item"
            data-testid={`${testId}-item-${i}`}
          >
            <span>{sourceLabel(source)}</span>
            {(["up", "down"] as const).map((direction) => (
              <Button
                key={direction}
                variant="ghost"
                size="sm"
                disabled={
                  busy ||
                  (direction === "up" ? i === 0 : i === order.length - 1)
                }
                data-testid={`${testId}-${direction}-${i}`}
                aria-label={`Move ${sourceLabel(source)} ${direction}`}
                onClick={() => onMove(i, direction)}
              >
                {direction === "up" ? "Up" : "Down"}
              </Button>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Both libraries' metadata source orders, reordered with buttons and saved together. */
export function MetadataOrderCard() {
  const queryClient = useQueryClient();
  const queries = {
    ebook: useQuery(metadataOrderQuery("ebook")),
    audiobook: useQuery(metadataOrderQuery("audiobook")),
  };
  // A library's unsaved order; null shows the one the server holds.
  const [edits, setEdits] = useState<Record<MetadataLibrary, Order | null>>({
    ebook: null,
    audiobook: null,
  });
  const [announcement, setAnnouncement] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const card = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // The moved row has rendered by now, so its button exists at the new index.
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target) {
      card.current
        ?.querySelector<HTMLElement>(`[data-testid="${target}"]`)
        ?.focus();
    }
  });

  const shown = (library: MetadataLibrary) =>
    edits[library] ?? queries[library].data ?? null;
  const loaded = LIBRARIES.every(({ library }) => shown(library) !== null);
  const changed = LIBRARIES.flatMap(({ library }) => {
    const order = changedOrder(shown(library), queries[library].data ?? null);
    return order ? [{ library, order }] : [];
  });
  useUnsavedForm("metadata-order", changed.length > 0);

  const move = (
    library: MetadataLibrary,
    index: number,
    direction: Direction,
  ) => {
    const order = shown(library);
    const moved = order && moveSource(order, index, direction);
    if (!moved) return;
    setEdits((current) => ({ ...current, [library]: moved.order }));
    const { landed, source } = moved;
    const len = moved.order.length;
    setAnnouncement(positionAnnouncement({ source, index: landed, len }));
    const focus = focusAfterMove({ index: landed, len, pressed: direction });
    pendingFocus.current = `${library}-metadata-precedence-${focus}-${landed}`;
  };

  const save = useMutation({
    mutationFn: async (pending: typeof changed) => {
      const outcomes: SaveOutcome[] = [];
      for (const { library, order } of pending) {
        try {
          const answer = await saveMetadataOrder(library, order);
          await queryClient.cancelQueries({
            queryKey: metadataOrderQuery(library).queryKey,
          });
          queryClient.setQueryData(
            metadataOrderQuery(library).queryKey,
            answer,
          );
          setEdits((current) => ({ ...current, [library]: null }));
          outcomes.push({ library, failure: null });
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          outcomes.push({ library, failure });
        }
      }
      return outcomes;
    },
    onSuccess: (outcomes) => setStatus(saveSummary(outcomes)),
  });

  const [loadError] = Object.values(queries).flatMap((query) =>
    query.data === undefined && query.error ? [query.error] : [],
  );
  const line: Status | null =
    status ??
    (loadError
      ? {
          text: `Couldn’t load the saved order: ${loadError.message}`,
          isError: true,
        }
      : null);

  return (
    <section className="card" data-testid="metadata-precedence-card" ref={card}>
      <h3>Source order</h3>
      <p className="subtitle">
        Order the sources Omnibus resolves each field from. Lower items win. The
        last source in the list that has a value for a field is used.
      </p>
      {loaded
        ? LIBRARIES.map(({ library, label }) => (
            <PrecedenceList
              key={library}
              library={library}
              label={label}
              order={shown(library) ?? []}
              busy={save.isPending}
              onMove={(index, direction) => move(library, index, direction)}
            />
          ))
        : !loadError && (
            <Loading
              kind="section"
              className="start"
              testId="metadata-precedence-loading"
              label="Reading the saved order…"
            />
          )}
      <p className="ld-sr" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="settings-actions">
        {loadError && (
          <Button
            variant="ghost"
            data-testid="metadata-precedence-retry"
            onClick={() => {
              for (const query of Object.values(queries)) {
                if (query.isError) query.refetch();
              }
            }}
          >
            Try again
          </Button>
        )}
        <Button
          variant="primary"
          disabled={save.isPending || !loaded || changed.length === 0}
          aria-busy={save.isPending}
          data-testid="metadata-precedence-save"
          onClick={() => save.mutate(changed)}
        >
          <BusyLabel
            busy={save.isPending}
            label="Save metadata order"
            busyLabel="Saving…"
          />
        </Button>
      </div>
      <LiveStatus testId="metadata-precedence-status" status={line} />
    </section>
  );
}
