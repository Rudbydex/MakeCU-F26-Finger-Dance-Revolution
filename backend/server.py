"""Serve the rhythm demo and exchange cues and taps with a local hardware bridge."""

import argparse
from collections import deque
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from time import monotonic
from urllib.parse import parse_qs, urlsplit

import songs


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
ZONES = range(1, 5)
FINGER_COLORS = ("GREEN", "BLUE", "YELLOW", "PURPLE")
MAX_UPLOAD = 60 * 1024 * 1024


class DanceState:
    def __init__(self):
        self.lock = Lock()
        self.last_tap = None
        self.hardware_taps = deque(maxlen=32)
        self.cue = None
        self.cue_until = 0.0
        self.led_color = "OFF"
        self.led_until = 0.0
        self.hardware = None
        self.hardware_until = 0.0
        self.hardware_id = 0
        self.hardware_samples = deque(maxlen=40)

    def snapshot(self):
        with self.lock:
            now = monotonic()
            cue = self.cue if now < self.cue_until else None
            hardware = None
            if now < self.hardware_until:
                hardware = {**self.hardware, "age_ms": round((now - self.hardware_received_at) * 1000)}
            # The controller streams faster than the browser polls. Keep recent
            # samples so a brief pressure peak can be recovered on the next poll.
            samples = [
                {**reading, "age_ms": round((now - received_at) * 1000)}
                for received_at, reading in self.hardware_samples
                if now - received_at < 2
            ]
            return {
                "last_tap": self.last_tap,
                "hardware_taps": [
                    {**tap, "age_ms": round((now - received_at) * 1000)}
                    for received_at, tap in self.hardware_taps
                    if now - received_at < 1
                ],
                "cue": cue,
                "led_color": self.led_color if now < self.led_until else "OFF",
                "hardware": hardware,
                "hardware_samples": samples,
            }

    def record_hardware(self, fsr, zone, pressure_counts=None):
        with self.lock:
            self.hardware_id += 1
            self.hardware = {"fsr": fsr, "zone": zone, "id": self.hardware_id}
            if pressure_counts is not None:
                self.hardware["pressure_counts"] = pressure_counts
            self.hardware_received_at = monotonic()
            self.hardware_until = self.hardware_received_at + 2
            self.hardware_samples.append((self.hardware_received_at, self.hardware))

    def record_tap(self, zone, source):
        with self.lock:
            tap_id = self.last_tap["id"] + 1 if self.last_tap else 1
            self.last_tap = {"id": tap_id, "zone": zone, "source": source}
            if source == "hardware":
                self.hardware_taps.append((monotonic(), self.last_tap))
            return self.last_tap

    def record_cue(self, zone):
        with self.lock:
            self.cue = zone
            self.cue_until = monotonic() + 0.75

    def record_feedback(self, zone, correct):
        with self.lock:
            self.led_color = FINGER_COLORS[zone - 1] if correct else "RED"
            self.led_until = monotonic() + 0.35


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
        url = urlsplit(self.path)
        if url.path == "/api/state":
            self.send_json(self.state.snapshot())
            return
        if url.path == "/api/songs":
            self.send_json({"songs": songs.list_songs(), "difficulties": songs.DIFFICULTIES})
            return
        if url.path == "/api/chart":
            query = parse_qs(url.query)
            try:
                chart = songs.chart_notes(query.get("id", [None])[0], query.get("difficulty", ["Easy"])[0])
            except songs.SongError as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_GATEWAY)
                return
            self.send_json(chart)
            return
        super().do_GET()

    def upload_song(self):
        query = parse_qs(urlsplit(self.path).query)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_UPLOAD:
            self.send_json({"error": "Choose an audio file up to 60 MB"}, HTTPStatus.BAD_REQUEST)
            return
        data = self.rfile.read(length)
        try:
            song = songs.save_upload(
                query.get("filename", [""])[0], data,
                query.get("title", [""])[0], query.get("artist", [""])[0],
            )
        except songs.SongError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        self.send_json(song, HTTPStatus.CREATED)

    def do_POST(self):
        if urlsplit(self.path).path == "/api/songs":
            self.upload_song()
            return
        if self.path not in ("/api/tap", "/api/cue", "/api/hardware", "/api/feedback"):
            self.send_json({"error": "Unknown endpoint"}, HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or "zone" not in body:
                raise ValueError
        except (ValueError, UnicodeError):
            self.send_json({"error": "Expected a JSON object with a zone"}, HTTPStatus.BAD_REQUEST)
            return

        zone = body["zone"]
        valid_zone = type(zone) is int and zone in ZONES
        if not valid_zone and (zone is not None or self.path in ("/api/tap", "/api/feedback")):
            self.send_json({"error": "Expected a zone from 1 to 4"}, HTTPStatus.BAD_REQUEST)
            return

        if self.path == "/api/hardware":
            fsr = body.get("fsr")
            if type(fsr) is not int or fsr < 0:
                self.send_json({"error": "Expected a nonnegative FSR reading"}, HTTPStatus.BAD_REQUEST)
                return
            pressure_counts = body.get("pressure_counts")
            if pressure_counts is not None and (
                not isinstance(pressure_counts, list)
                or len(pressure_counts) != 4
                or any(type(count) is not int or count < 0 for count in pressure_counts)
            ):
                self.send_json({"error": "Expected four nonnegative finger pressure counts"}, HTTPStatus.BAD_REQUEST)
                return
            self.state.record_hardware(fsr, zone, pressure_counts)
            self.send_json({"ok": True})
            return

        if self.path == "/api/feedback":
            correct = body.get("correct")
            if type(correct) is not bool:
                self.send_json({"error": "Expected a boolean game result"}, HTTPStatus.BAD_REQUEST)
                return
            self.state.record_feedback(zone, correct)
            self.send_json({"ok": True})
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
    parser.add_argument("--ddc-url", default=songs.DDC_URL, help="Dance Dance Convolution server")
    args = parser.parse_args()
    songs.DDC_URL = args.ddc_url
    handler = partial(Handler, state=DanceState())
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Open http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
