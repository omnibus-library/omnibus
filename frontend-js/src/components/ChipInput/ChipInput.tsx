import { useId, useState } from "react";
import { plural } from "../../format";
import { isPicked } from "../FilterBar/filters";
import "../Chip/Chip.css";
import "./ChipInput.css";

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
};

/** A list of text chips, added by Enter, comma or a pick from the suggestions. */
export function ChipInput({
  label,
  values,
  onChange,
  suggestions,
  placeholder,
  removeLabel,
  inputClass = "me-tag-input",
}: ChipInputProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const add = (text: string) => {
    const name = text.trim();
    setDraft("");
    if (name && !isPicked(values, name)) onChange([...values, name]);
  };
  return (
    <div className="chip-editor-root">
      {values.map((value) => (
        <div key={value} className="chip me-chip-item">
          <span className="me-chip-label">{value}</span>
          <button
            type="button"
            className="me-chip-remove"
            aria-label={`${removeLabel} ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="chip-editor-input-wrap">
        <input
          className={inputClass}
          aria-label={label}
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
          {suggestions
            .filter((s) => !isPicked(values, s.name))
            .map((s) => (
              <option
                key={s.name}
                value={s.name}
                label={`${s.count} book${plural(s.count)}`}
              />
            ))}
        </datalist>
      </div>
    </div>
  );
}
