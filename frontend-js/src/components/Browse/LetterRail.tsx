import { letterFrag } from "./browseOrder";
import "./Browse.css";

const ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** The A–Z rail beside a browse list: present letters jump to their group, absent ones are dimmed, hidden text. */
export function LetterRail({
  testid,
  present,
  active,
}: {
  /** Each present letter's test id is `{testid}-letter-{L}`. */
  testid: string;
  present: string[];
  active: string | null;
}) {
  return (
    <nav className="au-rail" aria-label="Jump to letter">
      {ALPHABET.map((letter) => {
        const frag = letterFrag(letter);
        const has = present.includes(letter);
        const on = has && active === letter;
        // One element type either way: an `a` without an `href` is plain, unfocusable text.
        const absent = has ? {} : { "aria-hidden": true };
        return (
          <a
            key={letter}
            className={
              on
                ? "au-rail-letter is-active"
                : has
                  ? "au-rail-letter"
                  : "au-rail-letter is-empty"
            }
            href={has ? `#letter-${frag}` : undefined}
            aria-current={on ? "location" : undefined}
            data-testid={has ? `${testid}-letter-${frag}` : undefined}
            {...absent}
          >
            {letter}
          </a>
        );
      })}
    </nav>
  );
}
