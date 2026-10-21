import { Button } from "../Button/Button";
import { BusyLabel } from "../Loading/Loading";

type ModalFootProps = {
  /** `shelf-modal-foot` or `pick-foot`. */
  className: string;
  busy: boolean;
  onCancel: () => void;
  cancelTestId?: string;
  submit: {
    label: string;
    busyLabel: string;
    testId: string;
    /** On top of `busy`, which always disables it. */
    disabled?: boolean;
    onClick: () => void;
  };
};

/** The ghost Cancel and primary submit that close a shelf modal; both lock while `busy`. */
export function ModalFoot({
  className,
  busy,
  onCancel,
  cancelTestId,
  submit,
}: ModalFootProps) {
  return (
    <div className={className}>
      <Button
        className="shelf-btn-ghost"
        data-testid={cancelTestId}
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        className="shelf-btn-primary"
        data-testid={submit.testId}
        disabled={busy || submit.disabled}
        aria-busy={busy}
        onClick={submit.onClick}
      >
        <BusyLabel
          busy={busy}
          label={submit.label}
          busyLabel={submit.busyLabel}
        />
      </Button>
    </div>
  );
}
