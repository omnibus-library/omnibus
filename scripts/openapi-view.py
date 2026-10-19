"""Serve openapi/ on a free loopback port and open its API reference in a browser.

`just openapi` runs this after regenerating openapi/openapi.json. The page,
openapi/index.html, renders the spec with Scalar.
"""

import functools
import http.server
import pathlib
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent / "openapi"


def main() -> None:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Omnibus API reference at {url} (Ctrl-C to stop)")
        webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
