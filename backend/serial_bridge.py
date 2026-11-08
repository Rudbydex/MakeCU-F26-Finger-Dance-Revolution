"""Forward pinch events from the Arduino contact detector to the local game."""

import argparse
import json
import re
import sys
from time import monotonic
from urllib.error import URLError
from urllib.request import Request, urlopen

import serial


ZONES = {"INDEX": 1, "MIDDLE": 2, "RING": 3, "PINKY": 4}
SAMPLE = re.compile(
    rb"(?:Touch I M R P|touch \(I M R P\)):(?:\s+[01]){4}\s*\| FSR:\s*(?P<fsr>\d+)"
    rb"(?:\s+\(rest \d+\))?(?:\s+THUMB PRESSED)?"
    rb"(?:\s*(?:>>>|->) CONTACT:\s*(?P<finger>INDEX|MIDDLE|RING|PINKY))?\s*"
)


def post_json(url, data):
    request = Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=1):
        pass


def forward_contacts(board, server_url, debug=False):
    last_zone = None
    last_status_at = float("-inf")
    empty_reads = 0
    warned_standalone = False
    while True:
        line = board.readline()
        if not line:
            empty_reads += 1
            if debug and empty_reads % 3 == 0:
                print("No bytes received from Arduino for 3 seconds.", flush=True)
            continue
        empty_reads = 0

        sample = SAMPLE.fullmatch(line) if line.endswith(b"\n") else None
        if debug:
            result = "sample" if sample else "ignored"
            print(f"Serial [{result}]: {line.rstrip()!r}", flush=True)
        if not sample:
            standalone = b"=== THUMB-TO-FINGER GAME ===" in line or line.lstrip().startswith(b">>> Trial ")
            if standalone and not warned_standalone:
                print(
                    "Arduino is running its standalone game. Set TEST_MODE = true in the sketch "
                    "and upload it to stream sensor readings to the web game.",
                    file=sys.stderr,
                    flush=True,
                )
                warned_standalone = True
            continue

        finger = sample.group("finger")
        name = finger.decode("ascii") if finger else None
        zone = ZONES.get(name)
        changed = zone != last_zone
        last_zone = zone
        if changed and zone is not None:
            try:
                post_json(server_url + "/api/tap", {"zone": zone, "source": "hardware"})
                print(f"{name} pinch sent as zone {zone}", flush=True)
            except (URLError, TimeoutError) as error:
                print(f"Could not send {name} pinch: {error}", file=sys.stderr)

        now = monotonic()
        if changed or now - last_status_at >= 0.15:
            if last_status_at == float("-inf"):
                print("Receiving Arduino sensor samples.", flush=True)
            last_status_at = now
            try:
                post_json(server_url + "/api/hardware", {"fsr": int(sample.group("fsr")), "zone": zone})
            except (URLError, TimeoutError) as error:
                print(f"Could not update sensor status: {error}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="Arduino USB serial port, such as /dev/cu.usbmodem1234")
    parser.add_argument("--server", default="http://127.0.0.1:8000", help="Game server URL")
    parser.add_argument("--debug", action="store_true", help="Print serial data and parser results")
    args = parser.parse_args()
    try:
        with serial.Serial(args.port, 115200, timeout=1) as board:
            print("Listening at 115200 baud. Leave your thumb off the sensor during calibration.", flush=True)
            forward_contacts(board, args.server.rstrip("/"), args.debug)
    except KeyboardInterrupt:
        return
    except serial.SerialException as error:
        parser.exit(1, f"Serial connection error: {error}\n")


if __name__ == "__main__":
    main()
