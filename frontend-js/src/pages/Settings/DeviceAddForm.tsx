import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";

/** What a card tells a reader who adds a device without naming it. */
export const NAME_REQUIRED = "Enter a name for your device.";

const NameSchema = z.object({
  name: z.string().trim().min(1, NAME_REQUIRED),
});

/** The add form's one field, kept by the card so it can clear it after an add. */
export const useNameForm = () =>
  useForm({ resolver: zodResolver(NameSchema), defaultValues: { name: "" } });

type DeviceAddFormProps = {
  /** `kobo` or `koreader`: the form's id and its test ids. */
  prefix: "kobo" | "koreader";
  placeholder: string;
  /** The Add button's label. */
  label: string;
  form: ReturnType<typeof useNameForm>;
  /** A request is out: the button is off. */
  busy: boolean;
  /** The add itself is the request: the button shows it working. */
  adding: boolean;
  onAdd: (name: string) => void;
  /** The name was empty. */
  onRefuse: (message: string) => void;
  /** The reader typed, so the last result is stale. */
  onEdit: () => void;
  /** Controls under the name row, such as the KOReader card's checkbox. */
  extra?: ReactNode;
  /** The card's result line. */
  status: ReactNode;
};

/** The add form both device cards draw: the name field and Add button on one line, `extra`, then the status. */
export function DeviceAddForm({
  prefix,
  placeholder,
  label,
  form,
  busy,
  adding,
  onAdd,
  onRefuse,
  onEdit,
  extra,
  status,
}: DeviceAddFormProps) {
  return (
    <form
      id={`${prefix}-add-form`}
      className="settings-form"
      onSubmit={form.handleSubmit(
        ({ name }) => onAdd(name),
        (errors) => onRefuse(errors.name?.message ?? ""),
      )}
    >
      <div className="device-add-row">
        <div className="settings-field">
          <label htmlFor={`${prefix}-device-name`}>Device name</label>
          <input
            type="text"
            id={`${prefix}-device-name`}
            data-testid={`${prefix}-device-name-input`}
            autoComplete="off"
            placeholder={placeholder}
            maxLength={100}
            {...form.register("name", { onChange: onEdit })}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          aria-busy={adding}
          data-testid={`${prefix}-device-add`}
        >
          <BusyLabel busy={adding} label={label} busyLabel="Adding…" />
        </Button>
      </div>
      {extra}
      <div className="settings-actions">{status}</div>
    </form>
  );
}
