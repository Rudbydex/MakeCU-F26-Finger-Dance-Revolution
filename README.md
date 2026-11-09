# MakeCU-F26-Finger-Dance-Revolution

```
docker run --rm --platform linux/amd64 -p 8080:80 chrisdonahue/ddc:latest
.venv/bin/python backend/serial_bridge.py auto
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

Choose **Gentle** (0.4×), **Relax** (0.5×), **Practice** (0.8×, the default), **Hard work** (1.3×), or **Challenge** (1.6×)
before the songs start. Both rounds use synthesized notes and a newly shuffled
pattern each run. Click a finger button or use the arrow keys or numbers 1-4.
Press **Pause** to freeze the song. While paused you can change the speed, then
**Resume** where you left off or **Restart** the song from the beginning.

| Hardware zone | Finger | Key | Image |
| --- | --- | --- | --- |
| 1 | Index | Left arrow or 1 | `left.png` |
| 2 | Middle | Down arrow or 2 | `down.png` |
| 3 | Ring | Up arrow or 3 | `up.png` |
| 4 | Little | Right arrow or 4 | `right.png` |

Each song starts 3 seconds before its first step, skipping any long intro.

- `frontend/` contains the plain HTML, CSS, JavaScript, octopus and hand artwork.
- `backend/` serves the page and exchanges JSON with a hardware bridge.
  The server uses Python's standard library. The serial bridge uses pySerial.

## Adaptive coach

The game adapts to each player and keeps a separate profile for each hand in
the browser. It does this quietly, without on-screen messages.

**Difficulty.** The game tracks the hit rate over the last 10 notes.

- Below 50%: it eases off. During a song it switches to the next easier chart,
  but only if that chart is already made. Otherwise it skips every third note,
  then every second note.
- 90% or more: it brings the skipped notes back, then steps up a level.
- The level you finish on, adjusted by how the end went, becomes the next
  play's starting level.

Picking a speed yourself on the speed scale wins for that play: the coach can
still ease off, but never goes faster than the speed you picked.

**Fingers.** After a play, the game checks each finger. A finger is struggling
if it hits under 75% and at least 20 points below the others. It is also
struggling if it is suddenly much slower than usual (1.6× its normal reaction
time). When a finger is struggling, the game asks:

> It looks like you're struggling with the ring finger. Would you like to practice more?

- **Practice more** gives that finger about 35% of the steps instead of 25%.
  This lasts until it hits 80% or better and keeps up with the others, for at
  most 5 plays.
- **Take a break** gives that finger about 10% of the steps. This lasts at
  least 2 plays and at most 4. It ends early once the finger has recovered.

Notes keep their original finger whenever possible, so the choreography only
changes as much as needed. The tuning values are at the top of `frontend/coach.js`.

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
| Gentle | Beginner | 0.75 s |
| Relax | Easy | 0.6 s |
| Practice | Medium | 0.42 s |
| Hard work | Hard | 0.3 s |
| Challenge | Challenge | 0.24 s |

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
python3 backend/chart_songs.py            # all five difficulties for every starter
```

## Connecting hardware

Upload the Finger Dance Revolution controller sketch to the Arduino. Start the
game server, then run these commands in a second terminal from the project folder:

```sh
python3 -m venv .venv                 # first time only
.venv/bin/pip install pyserial        # first time only
.venv/bin/python backend/serial_bridge.py auto
```

`auto` finds the Arduino by its USB ID. If several boards are connected, run
`python3 -m serial.tools.list_ports` and pass the port instead, for example
`/dev/cu.usbmodem1234`. The controller firmware is `backend/code.ino`. Close Arduino Serial Monitor
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

The tempo settings and the pattern generator live in `frontend/dance.js`; the adaptive coach lives in `frontend/coach.js`.

Pastel Crayon is by Letters + Numbers. The DaFont edition is listed as free for
personal use on [DaFont](https://www.dafont.com/pastel-crayon.font).

To use Pastel Crayon locally, download the personal-use edition from the link
above, unzip it, and save `pastel crayon.ttf` as
`frontend/assets/pastel-crayon.ttf`. The browser uses a cursive fallback when
the font is unavailable.
