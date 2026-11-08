# MakeCU-F26-Finger-Dance-Revolution

From this folder, run:

```sh
python3 backend/server.py
```

Open http://127.0.0.1:8000 and click **Start game**. Choose a hand, then
complete or skip the squeeze check. The tutorial shows the highlighted index
finger and the matching thumb pinch. Select **Index** to begin the 12-beat slow
song, followed by the 16-beat fast song.

**See your strength record!** shows the most recent squeeze saved in this
browser. Earlier rows and the example conclusion are generated for the demo.

Choose **Relax** (0.5×), **Practise** (0.8×, the default), or **Hard work** (1.3×)
before the songs start. Both rounds use synthesized notes and a newly shuffled
pattern each run. Click a finger button or use the arrow keys or numbers 1-4.

| Hardware zone | Direction | Finger | Image |
| --- | --- | --- | --- |
| 1 | Left | Index | `left.png` |
| 2 | Down | Middle | `down.png` |
| 3 | Up | Ring | `up.png` |
| 4 | Right | Little | `right.png` |

- `frontend/` contains the plain HTML, CSS, JavaScript, octopus and hand artwork.
- `backend/` serves the page and exchanges JSON with a hardware bridge.
  The server uses Python's standard library. The serial bridge uses pySerial.

## Connecting hardware

Upload the Finger Dance Revolution controller sketch to the Arduino. Start the
game server, then run these commands in a second terminal from the project folder:

```sh
python3 -m pip install pyserial
python3 -m serial.tools.list_ports
python3 backend/serial_bridge.py /dev/cu.usbmodem1234
```

Replace the example USB port with your Arduino port. Close Arduino Serial Monitor
before opening the bridge. Keep your thumb off the FSR during board startup so
it can calibrate. If the game server uses a different port, pass its URL to the
bridge with `--server`, for example `--server http://127.0.0.1:8002`.

The bridge enables the controller's raw pressure stream. The website scores
each contact and sends the result back as a brief RGB flash. Correct index,
middle, ring, and pinky taps flash green, blue, yellow, and purple respectively.
A wrong tap flashes red. **Sensor connected** appears once the game receives
live pressure samples. Use `--debug` to see the USB messages.

For the squeeze check, relax your hand, click **Begin squeeze**, then squeeze
firmly and comfortably. A rise in thumb pressure or a reported pinch starts
the one-second capture. The game displays the running peak and saves the
highest raw reading for the selected hand. The controller sends one thumb
pressure reading and four digital touch flags.

The older contact-detector sketches can still send taps and pressure, but only
the controller sketch supports RGB feedback from the webpage.

Both tempo settings and the pattern generator live in `frontend/dance.js`.

Pastel Crayon is by Letters + Numbers. The DaFont edition is listed as free for
personal use on [DaFont](https://www.dafont.com/pastel-crayon.font).

To use Pastel Crayon locally, download the personal-use edition from the link
above, unzip it, and save `pastel crayon.ttf` as
`frontend/assets/pastel-crayon.ttf`. The browser uses a cursive fallback when
the font is unavailable.
