"""Serve the rhythm demo and exchange cues and taps with a local hardware bridge."""

import argparse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from time import monotonic


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
ZONES = range(1, 5)


class DanceState:
    def __init__(self):
        self.lock = Lock()
        self.last_tap = None
        self.cue = None
        self.cue_until = 0.0

    def snapshot(self):
        with self.lock:
            cue = self.cue if monotonic() < self.cue_until else None
            return {"last_tap": self.last_tap, "cue": cue}

    def record_tap(self, zone, source):
        with self.lock:
            tap_id = self.last_tap["id"] + 1 if self.last_tap else 1
            self.last_tap = {"id": tap_id, "zone": zone, "source": source}
            return self.last_tap

    def record_cue(self, zone):
        with self.lock:
            self.cue = zone
            self.cue_until = monotonic() + 0.75


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, state, **kwargs):
        self.state = state
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def send_json(self, value, status=HTTPStatus.OK):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(self.state.snapshot())
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/tap", "/api/cue"):
            self.send_json({"error": "Unknown endpoint"}, HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or "zone" not in body:
                raise ValueError
            zone = body["zone"]
            if not (type(zone) is int and zone in ZONES):
                if self.path != "/api/cue" or zone is not None:
                    raise ValueError
        except (ValueError, UnicodeError):
            self.send_json(
                {"error": "Expected a JSON object with a zone from 1 to 4"},
                HTTPStatus.BAD_REQUEST,
            )
            return

        if self.path == "/api/cue":
            self.state.record_cue(zone)
            self.send_json({"cue": zone})
            return

        source = body.get("source", "hardware")
        if source not in ("browser", "hardware"):
            self.send_json({"error": "Invalid tap source"}, HTTPStatus.BAD_REQUEST)
            return
        self.send_json(self.state.record_tap(zone, source))

    def log_request(self, code="-", size="-"):
        if not self.path.startswith("/api/") or str(code).startswith(("4", "5")):
            super().log_request(code, size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    handler = partial(Handler, state=DanceState())
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Open http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
