import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type BookUuid, fetchCoverPalette, thumbUrl } from "../../api";
import { ChevronDownGlyph, RotateGlyph } from "../Glyphs/Glyphs";
import { Skeleton } from "../Loading/Loading";
import { MoreMenu } from "../MoreMenu/MoreMenu";
import {
  bookWash,
  customSolidWash,
  GRADIENTS,
  gradientInk,
  pairWash,
  SOLIDS,
  solidWash,
  type Wash,
} from "./quoteColor";

type Kind = "solid" | "gradient";
type Pick = { kind: Kind; id: string };

const KINDS = [
  ["solid", "Solid"],
  ["gradient", "Gradient"],
] as const;
const CUSTOM_SOLID = "#6b4f8a";
const CUSTOM_GRADIENT = { from: "#e8735a", to: "#2a8c8c", angle: 135 };
const ROTATE_STEP = 45;

type GradientStops = typeof CUSTOM_GRADIENT;

const customGradientWash = ({ from, to, angle }: GradientStops): Wash => ({
  from,
  to,
  ink: gradientInk(from, to),
  angle,
});

const flat = (from: string, to: string) =>
  `linear-gradient(135deg, ${from}, ${to})`;

// A horizontal row that fades on the side with more to scroll to.
function SwatchRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const next = {
      start: el.scrollLeft > 1,
      end: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    };
    setFade((was) =>
      was.start === next.start && was.end === next.end ? was : next,
    );
  };
  // Every render, since the cover pairs arriving change how far the row scrolls.
  useEffect(measure);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div
      ref={row}
      className="rd-quote-swatches"
      role="group"
      aria-label={label}
      data-fade-start={fade.start}
      data-fade-end={fade.end}
      onScroll={measure}
    >
      {children}
    </div>
  );
}

type SwatchProps = {
  name: string;
  on: boolean;
  shape: Kind;
  background: string;
  onClick: () => void;
};

function Swatch({ name, on, shape, background, onClick }: SwatchProps) {
  return (
    <button
      type="button"
      className={`rd-quote-swatch ${shape}${on ? " on" : ""}`}
      style={{ background }}
      aria-label={name}
      aria-pressed={on}
      onClick={onClick}
    />
  );
}

// The book's own cover, small, at the head of each row. Decorative, and never part of the card.
function CoverThumb({ uuid }: { uuid: BookUuid }) {
  return (
    <img
      className="rd-quote-thumb"
      alt=""
      src={thumbUrl(uuid, "sm")}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}

type QuoteBackgroundProps = {
  uuid: BookUuid;
  /** The book's `oklch(L C H)` accent; null falls back to the house tone. */
  accent: string | null;
  onChange: (wash: Wash) => void;
};

/** The quote card's Background section: its heading, the Solid / Gradient menu and the row of swatches. */
export function QuoteBackground({
  uuid,
  accent,
  onChange,
}: QuoteBackgroundProps) {
  const [pick, setPick] = useState<Pick>({ kind: "solid", id: "book" });
  const [menu, setMenu] = useState(false);
  const [custom, setCustom] = useState(CUSTOM_SOLID);
  const [stops, setStops] = useState(CUSTOM_GRADIENT);
  // Pairs are optional: an error or a 404 leaves the row with its presets alone.
  const palette = useQuery({
    queryKey: ["book", uuid, "coverPalette"],
    queryFn: () => fetchCoverPalette(uuid),
  });
  const pairs = palette.data ?? [];
  const choose = (kind: Kind, id: string, wash: Wash) => {
    setPick({ kind, id });
    onChange(wash);
  };
  const chooseKind = (kind: Kind) => {
    if (kind === pick.kind) return;
    if (kind === "solid") return choose("solid", "book", bookWash(accent));
    const first = pairs[0];
    if (first) return choose("gradient", "cover-0", pairWash(first));
    choose("gradient", GRADIENTS[0].id, GRADIENTS[0]);
  };
  const editStops = (next: GradientStops) => {
    setStops(next);
    choose("gradient", "custom", customGradientWash(next));
  };
  const on = (id: string) => pick.id === id;
  const current = KINDS.find(([kind]) => kind === pick.kind)?.[1];
  return (
    <>
      <div className="rd-quote-heading">
        <div className="rd-quote-label">Background</div>
        <div className="shd-more">
          <button
            type="button"
            className="rd-quote-kind-pill"
            aria-label={current}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {current}
            <ChevronDownGlyph />
          </button>
          {menu && (
            <MoreMenu
              label="Background type"
              radio
              onClose={() => setMenu(false)}
              items={KINDS.map(([kind, label]) => ({
                label,
                testId: `quote-kind-${kind}`,
                checked: pick.kind === kind,
                icon: <span className={`rd-quote-kind-icon ${kind}`} />,
                onSelect: () => chooseKind(kind),
              }))}
            />
          )}
        </div>
      </div>
      {pick.kind === "solid" ? (
        <SwatchRow label="Solid backgrounds">
          <CoverThumb uuid={uuid} />
          <Swatch
            name="Book"
            on={on("book")}
            shape="solid"
            background={bookWash(accent).from}
            onClick={() => choose("solid", "book", bookWash(accent))}
          />
          {SOLIDS.map((solid) => (
            <Swatch
              key={solid.id}
              name={solid.name}
              on={on(solid.id)}
              shape="solid"
              background={solidWash(solid.base, solid.light).from}
              onClick={() =>
                choose("solid", solid.id, solidWash(solid.base, solid.light))
              }
            />
          ))}
          {/* A transparent input over a rainbow reads as a picker, not a preset. */}
          <label
            className={`rd-quote-custom solid${on("custom") ? " on" : ""}`}
            title="Custom color"
          >
            <input
              type="color"
              aria-label="Custom background color"
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                choose("solid", "custom", customSolidWash(event.target.value));
              }}
            />
            <span aria-hidden="true">+</span>
          </label>
        </SwatchRow>
      ) : (
        <>
          <SwatchRow label="Gradient backgrounds">
            <CoverThumb uuid={uuid} />
            {palette.isPending && (
              <span data-testid="quote-cover-pending">
                <Skeleton
                  shape="block"
                  style={{ "--w": "72px", "--h": "28px" }}
                />
              </span>
            )}
            {pairs.map((pair, i) => (
              <Swatch
                // biome-ignore lint/suspicious/noArrayIndexKey: pairs have no ids, and the list is replaced whole
                key={i}
                name={`Cover gradient ${i + 1}`}
                on={on(`cover-${i}`)}
                shape="gradient"
                background={flat(pair.from, pair.to)}
                onClick={() => choose("gradient", `cover-${i}`, pairWash(pair))}
              />
            ))}
            {pairs.length > 0 && (
              <span
                className="rd-quote-divider"
                data-testid="quote-gradient-divider"
                aria-hidden="true"
              />
            )}
            {GRADIENTS.map((g) => (
              <Swatch
                key={g.id}
                name={g.name}
                on={on(g.id)}
                shape="gradient"
                background={flat(g.from, g.to)}
                onClick={() => choose("gradient", g.id, g)}
              />
            ))}
            <button
              type="button"
              className={`rd-quote-swatch gradient rd-quote-custom-gradient${on("custom") ? " on" : ""}`}
              aria-label="Custom gradient"
              aria-pressed={on("custom")}
              onClick={() =>
                choose("gradient", "custom", customGradientWash(stops))
              }
            >
              +
            </button>
          </SwatchRow>
          {on("custom") && (
            <div className="rd-quote-stops">
              {(["from", "to"] as const).map((end) => (
                <label key={end} className="rd-quote-stop">
                  <span>{end === "from" ? "From" : "To"}</span>
                  <input
                    type="color"
                    aria-label={end === "from" ? "From" : "To"}
                    value={stops[end]}
                    onChange={(event) =>
                      editStops({ ...stops, [end]: event.target.value })
                    }
                  />
                  <code>{stops[end]}</code>
                </label>
              ))}
              <button
                type="button"
                className="rd-chip rd-quote-rotate"
                aria-label={`Rotate direction, now ${stops.angle} degrees`}
                onClick={() =>
                  editStops({
                    ...stops,
                    angle: (stops.angle + ROTATE_STEP) % 360,
                  })
                }
              >
                <RotateGlyph />
                {stops.angle}°
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
