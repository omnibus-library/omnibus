import { useEffect, useRef, useState } from "react";
import { Button } from "../Button/Button";
import { Ring } from "../Loading/Loading";
import { loadScanner } from "./loadScanner";
import {
  isTerminal,
  parseScanStatus,
  type ScanStatus,
  STATUS_MESSAGE,
} from "./scanStatus";
import "./BarcodeScanner.css";

/** The one `<video>` the glue attaches the camera to; it looks the element up by id. */
const VIDEO_ID = "omnibus-scanner-video";

type Props = {
  /** A confirmed 13-digit EAN; the glue stops the decode loop before reporting it. */
  onDetect: (isbn: string) => void;
  /** The reader chose the keypad, or the camera is unavailable. */
  onManual: () => void;
};

/** Rear-camera preview with auto-detecting EAN-13 decode, an optional torch, and a way out to typing. */
export function BarcodeScanner({ onDetect, onManual }: Props) {
  const [status, setStatus] = useState<ScanStatus>("starting");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // The glue is started once; a later render's callback is still the one it should call.
  const detect = useRef(onDetect);
  detect.current = onDetect;

  useEffect(() => {
    let mounted = true;
    window.__omnibusOnScanStatus = (state) => setStatus(parseScanStatus(state));
    window.__omnibusOnScanTorch = (flag) => setTorchAvailable(flag === "1");
    window.__omnibusOnScanResult = (text) => detect.current(text);
    loadScanner()
      .then((wasmUrl) =>
        mounted
          ? window.OmnibusScanner?.start(VIDEO_ID, { wasmUrl })
          : undefined,
      )
      .catch(() => setStatus("error"));
    return () => {
      mounted = false;
      // Releases the camera track, so the OS capture indicator goes out.
      window.OmnibusScanner?.stop();
      delete window.__omnibusOnScanStatus;
      delete window.__omnibusOnScanTorch;
      delete window.__omnibusOnScanResult;
    };
  }, []);

  const terminal = isTerminal(status);
  return (
    <div className="scanner" data-testid="barcode-scanner">
      <div
        className="scanner-stage"
        data-state={
          status === "starting" || status === "ready" ? status : "off"
        }
      >
        <video
          id={VIDEO_ID}
          className="scanner-video"
          data-testid="barcode-scanner-video"
          autoPlay
          muted
          playsInline
        />
        <div className="scanner-reticle">
          <span className="scanner-corner scanner-corner--tl" />
          <span className="scanner-corner scanner-corner--tr" />
          <span className="scanner-corner scanner-corner--bl" />
          <span className="scanner-corner scanner-corner--br" />
          <span className="scanner-sweep" />
        </div>
      </div>
      <p
        className="scanner-status"
        data-testid="barcode-scanner-status"
        role="status"
      >
        {status === "starting" && (
          <Ring size="xs" className="scanner-status-ring" />
        )}
        {STATUS_MESSAGE[status]}
      </p>
      <div className="scanner-actions">
        {torchAvailable && !terminal && (
          <Button
            variant="ghost"
            className="scanner-torch"
            data-testid="barcode-scanner-torch"
            aria-pressed={torchOn}
            onClick={() => {
              setTorchOn(!torchOn);
              window.OmnibusScanner?.setTorch(!torchOn);
            }}
          >
            {torchOn ? "Torch on" : "Torch off"}
          </Button>
        )}
        <Button
          variant={terminal ? "primary" : "ghost"}
          data-testid="barcode-scanner-manual"
          onClick={onManual}
        >
          Enter ISBN instead
        </Button>
      </div>
    </div>
  );
}
