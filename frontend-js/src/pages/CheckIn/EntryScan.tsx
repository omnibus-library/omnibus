import { BarcodeScanner } from "../../components/BarcodeScanner/BarcodeScanner";
import { Button } from "../../components/Button/Button";
import { applyKey, cleanIsbn, ISBN_SLOTS, isbnRejection } from "./checkInFlow";
import { ProviderNote } from "./Lookup";
import { IsbnField } from "./Screens";

const SLOTS = Array.from({ length: ISBN_SLOTS }, (_, i) => i);

/** The keypad's face, row-major; `X` is the ISBN-10 check digit, the one non-digit a valid ISBN can end with. */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "X", "0", "⌫"];

type ScanProps = {
  onDetect: (isbn: string) => void;
  onManual: () => void;
  onSearch: () => void;
};

/** The camera screen: chrome around the scanner, which owns the camera while the flow owns what a decode means. */
export function ScanScreen({ onDetect, onManual, onSearch }: ScanProps) {
  return (
    <div className="check-in-screen" data-testid="check-in-scan">
      <h1>Scan a barcode</h1>
      <p className="subtitle">
        Hold the back cover in the frame — we'll read the ISBN automatically.
      </p>
      <BarcodeScanner onDetect={onDetect} onManual={onManual} />
      <div className="check-in-actions">
        <Button
          variant="ghost"
          data-testid="check-in-search-by-title"
          onClick={onSearch}
        >
          Search by title
        </Button>
      </div>
      <ProviderNote />
    </div>
  );
}

type EntryProps = {
  isbn: string;
  busy: boolean;
  onIsbn: (isbn: string) => void;
  onResolve: (raw: string) => void;
  onScan: () => void;
  onSearch: () => void;
};

/** Manual ISBN entry, the scanner's always-available fallback: a text field over an on-screen keypad. */
export function EntryScreen({
  isbn,
  busy,
  onIsbn,
  onResolve,
  onScan,
  onSearch,
}: EntryProps) {
  const cleaned = cleanIsbn(isbn);
  const ready = isbnRejection(cleaned) === null;
  return (
    <div className="check-in-screen" data-testid="check-in-entry">
      <h1>Enter the ISBN</h1>
      <p className="subtitle">
        It's the 13-digit number under the barcode on the back cover.
      </p>
      <form
        className="settings-form"
        data-testid="check-in-form"
        onSubmit={(e) => {
          e.preventDefault();
          onResolve(isbn);
        }}
      >
        <IsbnField isbn={isbn} busy={busy} onIsbn={onIsbn} />
        {/* Each slot shows its character once typed, so a misread digit is visible without counting along. */}
        <div
          className="isbn-progress"
          data-testid="check-in-isbn-progress"
          data-filled={cleaned.length}
          aria-hidden="true"
        >
          {SLOTS.map((slot) => (
            <span
              key={slot}
              className={
                slot < cleaned.length ? "isbn-slot filled" : "isbn-slot"
              }
            >
              {cleaned[slot]}
            </span>
          ))}
        </div>
        <div className="isbn-keypad" data-testid="check-in-keypad">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="isbn-key"
              disabled={busy}
              data-testid={`check-in-key-${key}`}
              aria-label={key === "⌫" ? "Delete" : key}
              onClick={() => onIsbn(applyKey(isbn, key))}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !ready}
            data-testid="check-in-submit"
          >
            Find book
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            data-testid="check-in-scan-instead"
            onClick={onScan}
          >
            Scan a barcode instead
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            data-testid="check-in-search-by-title"
            onClick={onSearch}
          >
            Search by title
          </Button>
        </div>
      </form>
    </div>
  );
}
