"""Exchange finger cues and sensor readings with the Arduino over USB."""

import argparse
import json
import re
import sys
from time import monotonic
from urllib.error import URLError
from urllib.request import Request, urlopen

import serial
from serial.tools.list_ports import comports

try:
    from termios import error as TermiosError
except ImportError:
    TermiosError = OSError


ZONES = {"INDEX": 1, "MIDDLE": 2, "RING": 3, "PINKY": 4}
FINGERS = {zone: finger for finger, zone in ZONES.items()}
LED_COLORS = ("OFF", "RED", "GREEN", "BLUE", "YELLOW", "PURPLE")
CONTROLLER_SAMPLE = re.compile(rb"S,(?:[01],){4}(?P<fsr>[0-9]+)")
FINGERTIP_ONLY_SAMPLE = re.compile(rb"S,[01](?:,[01]){3}")
FINGER_NAME = rb"(?P<finger>INDEX|MIDDLE|RING|PINKY)"
CONTROLLER_CONTACT = re.compile(rb"(?:CONTACT,|-> CONTACT: *)" + FINGER_NAME)
CONTROLLER_RELEASE = re.compile(rb"RELEASE," + FINGER_NAME + rb",[0-9]+")
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
    with urlopen(request, timeout=0.2):
        pass


def send_command(board, command, debug):
    if debug:
        print(f"Arduino ← {command}", flush=True)
    board.write((command + "\n").encode("ascii"))


def read_game_state(server_url):
    with urlopen(server_url + "/api/state", timeout=0.2) as response:
        state = json.load(response)
    if not isinstance(state, dict) or "hardware" not in state:
        raise ValueError("This game server does not expose live hardware status.")
    return state


def read_controls(server_url):
    try:
        return read_game_state(server_url)
    except (URLError, TimeoutError, ValueError):
        return None


def report(server_url, endpoint, payload):
    try:
        post_json(server_url + endpoint, payload)
    except (URLError, TimeoutError) as error:
        print(f"Could not update {endpoint}: {error}", file=sys.stderr)


def forward_contacts(board, server_url, debug=False):
    protocol = None
    last_sample_at = float("-inf")
    next_status_warning = monotonic() + 4
    active_zone = None
    target = None
    led_color = None
    next_stream_request = 0.0
    next_cue_poll = 0.0
    pending = bytearray()
    warned_standalone = False
    warned_fingertip_only = False
    last_legacy_status_at = float("-inf")

    try:
        while True:
            now = monotonic()
            if protocol != "legacy" and now - last_sample_at >= 1 and now >= next_stream_request:
                send_command(board, "STREAM,1", debug)
                next_stream_request = now + 1
            if now >= next_status_warning and now - last_sample_at >= 3:
                print("No live pressure samples from Arduino. Check the uploaded sketch and USB connection.",
                      file=sys.stderr, flush=True)
                next_status_warning = now + 5

            if protocol == "controller" and now >= next_cue_poll:
                next_cue_poll = now + 0.025
                controls = read_controls(server_url)
                if controls is None:
                    controls = {"led_color": "OFF"} if led_color is not None else {}
                color = controls.get("led_color")
                if color in LED_COLORS:
                    # Manual colors work when the Arduino is not judging a target.
                    if target is not None:
                        send_command(board, "CANCEL", debug)
                        target = None
                    if color != led_color:
                        send_command(board, f"COLOR,{color}", debug)
                        led_color = color
                else:
                    # Older game servers still use the board's target feedback.
                    if led_color is not None:
                        send_command(board, "COLOR,OFF", debug)
                        led_color = None
                    cue = controls.get("cue")
                    cue = cue if type(cue) is int and cue in FINGERS else None
                    if cue != target:
                        send_command(board, f"TARGET,{FINGERS[cue]}" if cue else "CANCEL", debug)
                        target = cue

            chunk = board.readline()
            if not chunk:
                continue
            pending.extend(chunk)
            if not chunk.endswith(b"\n"):
                if len(pending) > 512:
                    pending.clear()
                continue

            line = bytes(pending).strip()
            pending.clear()
            if debug:
                print(f"Arduino → {line!r}", flush=True)

            if line.startswith(b"DONE,"):
                # The firmware clears its target on a successful release.
                finger = line.split(b",", 2)[1].decode("ascii", errors="replace")
                if target == ZONES.get(finger):
                    target = None
                continue

            if line.startswith(b"READY,"):
                last_sample_at = float("-inf")
                next_status_warning = monotonic() + 4
                active_zone = None
                target = None
                led_color = None
                next_cue_poll = 0.0
                send_command(board, "STREAM,1", debug)
                next_stream_request = monotonic() + 1
                # The board starts with no target. Wait for its stream before polling.
                protocol = None
                continue

            sample = CONTROLLER_SAMPLE.fullmatch(line)
            contact = CONTROLLER_CONTACT.fullmatch(line)
            release = CONTROLLER_RELEASE.fullmatch(line)
            if sample or contact or release or line == b"OK,STREAM,1":
                if protocol != "controller":
                    protocol = "controller"
                    send_command(board, "CANCEL", debug)
                    print("Controller responded over USB. Waiting for pressure samples.", flush=True)

                if sample:
                    if now - last_sample_at >= 3:
                        print("Receiving live Arduino pressure readings.", flush=True)
                    last_sample_at = now
                    report(server_url, "/api/hardware",
                           {"fsr": int(sample.group("fsr")), "zone": active_zone})
                elif contact:
                    zone = ZONES[contact.group("finger").decode("ascii")]
                    # The sketch emits both contact formats before the matching release.
                    if zone != active_zone:
                        active_zone = zone
                        report(server_url, "/api/tap", {"zone": zone, "source": "hardware"})
                elif release and ZONES[release.group("finger").decode("ascii")] == active_zone:
                    active_zone = None
                # The browser scores each contact itself, so HIT and WRONG are ignored.
                continue

            sample = SAMPLE.fullmatch(line)
            if sample:
                last_sample_at = now
                if protocol != "legacy":
                    protocol = "legacy"
                    print("Receiving legacy Arduino sensor samples.", flush=True)
                finger = sample.group("finger")
                zone = ZONES[finger.decode("ascii")] if finger else None
                changed = zone != active_zone
                active_zone = zone
                if changed and zone is not None:
                    report(server_url, "/api/tap", {"zone": zone, "source": "hardware"})
                if changed or now - last_legacy_status_at >= 0.15:
                    last_legacy_status_at = now
                    report(server_url, "/api/hardware",
                           {"fsr": int(sample.group("fsr")), "zone": zone})
                continue

            if FINGERTIP_ONLY_SAMPLE.fullmatch(line) and not warned_fingertip_only:
                print("Arduino is sending touch readings without the FSR value. "
                      "Upload the current controller sketch (backend/new_elec.ino).",
                      file=sys.stderr, flush=True)
                warned_fingertip_only = True
                continue

            standalone = b"=== THUMB-TO-FINGER GAME ===" in line or line.startswith(b">>> Trial ")
            if standalone and not warned_standalone:
                print(
                    "Arduino is running its standalone game. Upload the controller sketch or "
                    "enable TEST_MODE in the older sketch to send sensor readings to the web game.",
                    file=sys.stderr,
                    flush=True,
                )
                warned_standalone = True
    finally:
        if protocol == "controller":
            try:
                send_command(board, "CANCEL", debug)
                send_command(board, "COLOR,OFF", debug)
            except (OSError, TermiosError):
                pass


def find_arduino():
    ports = comports()
    arduinos = [p.device for p in ports if p.vid in (0x2341, 0x2A03)]
    if len(arduinos) == 1:
        return arduinos[0]
    if arduinos:
        raise ValueError(f"Multiple Arduino ports found: {', '.join(arduinos)}. Specify the port explicitly.")
    visible = ", ".join(p.device for p in ports) or "none"
    raise ValueError(f"Arduino USB serial port was not detected.\nVisible serial ports: {visible}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="Arduino USB serial port, such as /dev/cu.usbmodem1234, or auto")
    parser.add_argument("--server", default="http://127.0.0.1:8000", help="Game server URL")
    parser.add_argument("--debug", action="store_true", help="Print serial data and parser results")
    args = parser.parse_args()
    if args.port == "auto":
        try:
            args.port = find_arduino()
        except ValueError as error:
            parser.exit(1, f"{error}\n")
    server_url = args.server.rstrip("/")
    try:
        read_game_state(server_url)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cannot send hardware readings to {server_url}: {error}\n"
                       "Start the current game server and pass its URL with --server.\n")

    print(f"Sending hardware readings to {server_url}", flush=True)
    try:
        with serial.Serial(args.port, 115200, timeout=0.025, write_timeout=0.2) as board:
            print("Listening at 115200 baud. Leave your thumb off the sensor during calibration.", flush=True)
            forward_contacts(board, server_url, args.debug)
    except KeyboardInterrupt:
        return
    except (OSError, TermiosError) as error:
        parser.exit(1, f"Could not use Arduino serial port {args.port}: {error}\n"
                       "Check the USB port and close Arduino Serial Monitor or any other bridge.\n")


if __name__ == "__main__":
    main()
