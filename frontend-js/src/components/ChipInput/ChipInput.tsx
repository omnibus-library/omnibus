import { useId, useState } from "react";
import { bookCount } from "../../format";
import "../Chip/Chip.css";
import "./ChipInput.css";

/** The most suggestions drawn at once; a library's tag cloud can run to thousands. */
const MAX_SUGGESTIONS = 50;

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type ChipInputProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: { name: string; count: number }[];
  placeholder: string;
  /** Names a chip's remove button with its value: "Remove tag" gives "Remove tag cozy". */
  removeLabel: string;
  /** Authors take the plain input, tags the dashed pill. */
  inputClass?: "me-chip-input" | "me-tag-input";
  /** Draws each chip's initials, as author chips do. */
  avatar?: boolean;
  /** The input's `data-testid`, which the E2E suite finds the editor by. */
  testId?: string;
};

/** The first two capitals of a name: "Sora Inkwell" gives "SI". */
const initials = (name: string) =>
  name
    .match(/\p{Lu}/gu)
    ?.slice(0, 2)
    .join("");

/** A list of text chips, added by Enter, comma or a pick from the suggestions. */
export function ChipInput({
  label,
  values,
  onChange,
  suggestions,
  placeholder,
  removeLabel,
  inputClass = "me-tag-input",
  avatar = false,
  testId,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const picked = (name: string) => values.some((v) => sameName(v, name));
  const add = (text: string) => {
    const name = text.trim();
    setDraft("");
    if (name && !picked(name)) onChange([...values, name]);
  };
  const needle = draft.trim().toLowerCase();
  const offered = suggestions
    .filter((s) => !picked(s.name) && s.name.toLowerCase().includes(needle))
    .slice(0, MAX_SUGGESTIONS);
  return (
    <div className="chip-editor-root">
      {values.map((value, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stored data may hold the same text twice, so the text alone is not a key
        <div key={`${i}-${value}`} className="chip me-chip-item">
          {avatar && <span className="me-avatar">{initials(value)}</span>}
          <span className="me-chip-label">{value}</span>
          <button
            type="button"
            className="me-chip-remove"
            aria-label={`${removeLabel} ${value}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="chip-editor-input-wrap">
        <input
          className={inputClass}
          aria-label={label}
          data-testid={testId}
          placeholder={placeholder}
          list={listId}
          value={draft}
          onChange={(e) => {
            // A pick from the datalist arrives as a replacement, not as typing.
            const picked =
              "inputType" in e.nativeEvent &&
              e.nativeEvent.inputType === "insertReplacementText";
            if (picked) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
        <datalist id={listId}>
          {offered.map((s) => (
            <option key={s.name} value={s.name} label={bookCount(s.count)} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
