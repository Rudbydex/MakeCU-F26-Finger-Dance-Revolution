# MakeCU-F26-Finger-Dance-Revolution

```
docker run --rm --platform linux/amd64 -p 8080:80 chrisdonahue/ddc:latest
```

```
python3 backend/chart_songs.py
python3 backend/server.py
```

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

## Songs

Click **Choose a song** to open the songs page. It lists the built-in warm-up
songs, the starter songs, and the songs you add. To add a starter song, put an
audio file (MP3, OGG, WAV, FLAC, or M4A) in `frontend/songs/`. The file name is
used as the title. Upload a song from the page to save it in
`frontend/songs/uploads/`, which is git-ignored.

Steps come from [Dance Dance Convolution](https://github.com/chrisdonahue/ddc)
(DDC). DDC produces a StepMania `.sm` chart. The game turns that chart into
finger pinches:

- StepMania columns left, down, up, and right map to fingers 1–4.
- A jump becomes a single finger.
- A hold or roll becomes a single tap.
- Mines are ignored.
- Notes are spaced so each pinch has time to happen.

The speed setting picks the DDC difficulty:

| Speed | DDC difficulty | Minimum gap between pinches |
| --- | --- | --- |
| Relax | Easy | 0.6 s |
| Practise | Medium | 0.42 s |
| Hard work | Hard | 0.3 s |

Charts are cached in a `charts/` folder next to each audio file. A cached chart
skips DDC the next time.

DDC needs Python 2 and TensorFlow 0.12, so run its official Docker image
alongside the game. On Apple Silicon, add `--platform linux/amd64`. The image
then runs emulated, and charting a song can take a few minutes.

```sh
docker run --rm -p 8080:80 chrisdonahue/ddc:latest
python3 backend/server.py                 # uses DDC at http://127.0.0.1:8080
python3 backend/server.py --ddc-url http://other-host:8080   # or set DDC_URL
```

To pre-chart the starter songs so the demo does not need DDC running, run:

```sh
python3 backend/chart_songs.py            # Easy, Medium, and Hard for every starter
```

## Connecting hardware

Set `TEST_MODE = true` in the Arduino UNO R4 rehab sketch and upload it to
stream sensor samples. The bridge supports both that sketch's `-> CONTACT: INDEX`
format and the older contact detector's `>>> CONTACT: INDEX` format. Start the
game server, then run these commands in a second terminal from the project folder:

```sh
python3 -m pip install pyserial
python3 -m serial.tools.list_ports
python3 backend/serial_bridge.py /dev/cu.usbmodem1234
```

Replace the sample port with the Arduino port and close Arduino Serial Monitor
before opening the bridge. Keep your thumb off the FSR during board startup so
the sketch can calibrate. The bridge sends one tap per contact and waits for a
release or a change of finger before sending another.

The game displays **Sensor connected** while it receives live Arduino readings.
The status also shows the raw thumb pressure and the finger currently detected.

Click **Begin squeeze**, then pinch when ready. The squeeze check uses the
strongest live reading from the first second after the glove detects contact.
The current Arduino bridge sends a single thumb reading. A bridge with individual
finger pressure sensors can send `pressure_counts` with four counts in index,
middle, ring, little order to `POST /api/hardware`. The game drops the lowest
count from each sample, then saves the highest average of the remaining three.

Run the bridge on the same computer as the server. Have it map the board's sensor
events to zones 1–4 and send one request per tap:

```sh
curl -X POST http://127.0.0.1:8000/api/tap \
  -H 'Content-Type: application/json' \
  -d '{"zone":2,"source":"hardware"}'
```

The browser reads hardware taps for scoring. Poll `GET /api/state` to read `cue`, the zone
to light, or `null` to turn the lights off. The browser posts cue changes to
`/api/cue`. The server clears a cue after 750 ms as a fallback if playback stops.
The demo assumes a single browser drives the session.

Both tempo settings and the pattern generator live in `frontend/dance.js`.

Pastel Crayon is by Letters + Numbers. The DaFont edition is listed as free for
personal use on [DaFont](https://www.dafont.com/pastel-crayon.font).

To use Pastel Crayon locally, download the personal-use edition from the link
above, unzip it, and save `pastel crayon.ttf` as
`frontend/assets/pastel-crayon.ttf`. The browser uses a cursive fallback when
the font is unavailable.
