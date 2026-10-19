import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import glue from "../../vendor/barcode/barcode-scanner-glue.js?raw";

type Cam = { stopped: ReturnType<typeof vi.fn>; arrive: () => void };

let getUserMedia: ReturnType<typeof vi.fn>;
let cams: Cam[];
let statuses: string[];
const realMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
const realGetContext = HTMLCanvasElement.prototype.getContext;

/** A camera that answers `getUserMedia` only once the test lets it, and counts its track stops. */
function camera(trackExtras: object = {}): Promise<MediaStream> {
  return new Promise((resolve) => {
    const stopped = vi.fn();
    const track = { stop: stopped, ...trackExtras };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    cams.push({ stopped, arrive: () => resolve(stream) });
  });
}

const start = () =>
  window.OmnibusScanner?.start("v", { wasmUrl: "/z.wasm" }) as Promise<void>;

describe("barcode scanner glue", () => {
  beforeEach(() => {
    cams = [];
    statuses = [];
    getUserMedia = vi.fn(() => camera());
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    window.ZXingWASM = { prepareZXingModule: async () => {} };
    window.__omnibusOnScanStatus = (s) => statuses.push(s);
    HTMLCanvasElement.prototype.getContext = () => ({}) as never;
    document.body.innerHTML = '<video id="v"></video>';
    (document.getElementById("v") as HTMLVideoElement).play = async () => {};
    // The glue is a classic script that binds window.OmnibusScanner (jsdom doesn't run inline scripts), so it is evaluated.
    // biome-ignore lint/security/noGlobalEval: the vendored file under test is the only input
    window.eval(glue);
  });

  afterEach(() => {
    window.OmnibusScanner?.stop();
    delete window.OmnibusScanner;
    delete window.ZXingWASM;
    delete window.__omnibusOnScanStatus;
    if (realMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", realMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    HTMLCanvasElement.prototype.getContext = realGetContext;
    document.body.innerHTML = "";
  });

  it("releases a camera that arrives after stop", async () => {
    const started = start();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    window.OmnibusScanner?.stop();
    cams[0]?.arrive();
    await started;

    expect(cams[0]?.stopped).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain("ready");
  });

  it("releases the first camera when a second start supersedes it", async () => {
    const first = start();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const second = start();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    cams[0]?.arrive();
    cams[1]?.arrive();
    await Promise.all([first, second]);

    expect(cams[0]?.stopped).toHaveBeenCalledTimes(1);
    expect(cams[1]?.stopped).not.toHaveBeenCalled();
    expect(statuses.filter((s) => s === "ready")).toHaveLength(1);
  });

  it("releases the camera when reading its capabilities throws", async () => {
    getUserMedia.mockImplementationOnce(() =>
      camera({
        getCapabilities: () => {
          throw new Error("no capabilities");
        },
      }),
    );
    const started = start();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    cams[0]?.arrive();
    await started;

    expect(cams[0]?.stopped).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("ready");
  });

  it("is the same file in both asset directories", () => {
    const dioxus = readFileSync(
      resolve(
        process.cwd(),
        "../frontend/assets/vendor/barcode-scanner-glue.js",
      ),
      "utf8",
    );

    expect(dioxus).toBe(glue);
  });
});
