# MakeCU-F26-Finger-Dance-Revolution

From this folder, run:

```sh
python3 backend/server.py
```

Open http://127.0.0.1:8000 and click **Start game**. Play the 12-beat slow
song, then the 16-beat fast song. Both use synthesized notes and a newly shuffled
pattern each run. Click a direction or use the arrow keys or numbers 1-4.

| Hardware zone | Direction | Finger | Image |
| --- | --- | --- | --- |
| 1 | Left | Index | `left.png` |
| 2 | Down | Middle | `down.png` |
| 3 | Up | Ring | `up.png` |
| 4 | Right | Little | `right.png` |

- `frontend/` contains the plain HTML, CSS, JavaScript, octopus and hand artwork.
- `backend/` serves the page and exchanges JSON with a hardware bridge.
  It uses Python's standard library.

## Connecting hardware

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

The actual board adapter depends on the hardware's transport and message format.
Both tempo settings and the pattern generator live in `frontend/dance.js`.

Pastel Crayon is by Letters + Numbers. The DaFont edition is listed as free for
personal use on [DaFont](https://www.dafont.com/pastel-crayon.font).

To use Pastel Crayon locally, download the personal-use edition from the link
above, unzip it, and save `pastel crayon.ttf` as
`frontend/assets/pastel-crayon.ttf`. The browser uses a cursive fallback when
the font is unavailable.
