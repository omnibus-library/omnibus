import { letterFrag } from "./authorsOrder";

const ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** The A–Z rail beside the authors list: present letters jump to their group, absent ones are dimmed, hidden text. */
export function LetterRail({
  present,
  active,
}: {
  present: string[];
  active: string | null;
}) {
  return (
    <nav className="au-rail" aria-label="Jump to letter">
      {ALPHABET.map((letter) => {
        if (!present.includes(letter)) {
          return (
            <span
              key={letter}
              className="au-rail-letter is-empty"
              aria-hidden="true"
            >
              {letter}
            </span>
          );
        }
        const frag = letterFrag(letter);
        const on = active === letter;
        return (
          <a
            key={letter}
            className={on ? "au-rail-letter is-active" : "au-rail-letter"}
            href={`#letter-${frag}`}
            aria-current={on ? "location" : undefined}
            data-testid={`authors-letter-${frag}`}
          >
            {letter}
          </a>
        );
      })}
    </nav>
  );
}
