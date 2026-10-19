/** Where the camera got to; the glue reports it as a string. */
export type ScanStatus =
  | "starting"
  | "ready"
  | "denied"
  | "unsupported"
  | "error";

const STATUSES: ScanStatus[] = [
  "starting",
  "ready",
  "denied",
  "unsupported",
  "error",
];

/** The glue's status string; anything it does not recognise is an error, not a state to ignore. */
export function parseScanStatus(state: string): ScanStatus {
  return STATUSES.find((s) => s === state) ?? "error";
}

/** Whether the camera is out of the running for good, so the screen leads with typing the ISBN. */
export const isTerminal = (status: ScanStatus) =>
  status === "denied" || status === "unsupported" || status === "error";

/** The line shown under, or in place of, the viewfinder. */
export const STATUS_MESSAGE = {
  starting: "Starting camera…",
  ready: "Point the camera at the barcode on the back cover.",
  denied:
    "Omnibus can't use the camera. Allow camera access in your settings, or type the ISBN instead.",
  unsupported: "No camera is available on this device. Type the ISBN instead.",
  error: "The scanner couldn't start. Type the ISBN instead.",
} satisfies Record<ScanStatus, string>;
