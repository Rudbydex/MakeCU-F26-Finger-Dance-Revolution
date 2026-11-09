"""Song library: store audio, chart it with Dance Dance Convolution, and read StepMania charts."""

import io
import json
import os
import re
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import uuid4
import zipfile


SONGS = Path(__file__).resolve().parents[1] / "frontend" / "songs"
UPLOADS = SONGS / "uploads"
AUDIO_TYPES = (".mp3", ".ogg", ".wav", ".flac", ".m4a")
DIFFICULTIES = ("Beginner", "Easy", "Medium", "Hard", "Challenge")
DDC_URL = os.environ.get("DDC_URL", "http://127.0.0.1:8080")
# A thumb pinch takes longer than a foot step, so keep notes at least this far apart.
MIN_GAP = {"Beginner": 1.2, "Easy": 0.6, "Medium": 0.42, "Hard": 0.3, "Challenge": 0.24}
# A chart cue stays lit for at most this long when the next note is far away.
# Slower levels keep each hand on screen longer.
MAX_CUE = {"Beginner": 1.8, "Easy": 1.3, "Medium": 0.8, "Hard": 0.8, "Challenge": 0.8}

chart_lock = Lock()


class SongError(Exception):
    pass


def title_from_name(name):
    return re.sub(r"[_\s]+", " ", Path(name).stem).strip() or "Untitled"


def song_path(song_id):
    """Resolve a song id (its path inside songs/) without letting it escape that folder."""
    if not isinstance(song_id, str):
        raise SongError("Unknown song")
    path = (SONGS / song_id).resolve()
    if SONGS.resolve() not in path.parents or path.suffix.lower() not in AUDIO_TYPES or not path.is_file():
        raise SongError("Unknown song")
    return path


def chart_path(audio, difficulty):
    return audio.parent / "charts" / f"{audio.stem}.{difficulty}.sm"


def describe(audio):
    song_id = audio.relative_to(SONGS).as_posix()
    info = {"title": title_from_name(audio.name), "artist": ""}
    try:
        info.update(json.loads(audio.with_suffix(".json").read_text()))
    except (OSError, ValueError):
        pass
    return {
        "id": song_id,
        "title": str(info.get("title") or title_from_name(audio.name)),
        "artist": str(info.get("artist") or ""),
        "starter": audio.parent == SONGS,
        "audio_url": "/songs/" + quote(song_id),
        "charted": [d for d in DIFFICULTIES if chart_path(audio, d).is_file()],
    }


def list_songs():
    def audio_in(folder):
        if not folder.is_dir():
            return []
        return sorted((p for p in folder.iterdir() if p.suffix.lower() in AUDIO_TYPES and p.is_file()),
                      key=lambda p: p.name.lower())

    uploads = sorted(audio_in(UPLOADS), key=lambda p: p.stat().st_mtime, reverse=True)
    return [describe(p) for p in audio_in(SONGS) + uploads]


def save_upload(filename, data, title="", artist=""):
    extension = Path(filename or "").suffix.lower()
    if extension not in AUDIO_TYPES:
        raise SongError("Use an MP3, OGG, WAV, FLAC, or M4A file")
    if not data:
        raise SongError("The audio file is empty")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", Path(filename).stem.lower()).strip("-")[:40] or "song"
    audio = UPLOADS / f"{slug}-{uuid4().hex[:6]}{extension}"
    audio.write_bytes(data)
    meta = {"title": title.strip()[:120] or title_from_name(filename), "artist": artist.strip()[:120]}
    audio.with_suffix(".json").write_text(json.dumps(meta))
    return describe(audio)


def multipart(fields, file_field, filename, data):
    boundary = uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    safe_name = re.sub(r'["\r\n]', "", filename)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{safe_name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n".encode() + data + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def request_ddc_chart(audio, difficulty, title, artist, ddc_url=None):
    """Send audio to a running DDC server and return the StepMania .sm text it generates."""
    body, content_type = multipart(
        {"song_title": title, "song_artist": artist, "diff_coarse": difficulty},
        "audio_file", audio.name, audio.read_bytes(),
    )
    url = (ddc_url or DDC_URL).rstrip("/") + "/choreograph"
    request = Request(url, data=body, headers={"Content-Type": content_type}, method="POST")
    try:
        with urlopen(request, timeout=900) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
    except HTTPError as error:
        detail = error.read().decode(errors="replace").strip()[:200]
        raise SongError(f"DDC could not chart this song: {detail or error.reason}") from error
    except (URLError, OSError) as error:
        raise SongError(f"Could not reach the DDC step generator at {ddc_url or DDC_URL}. Is it running?") from error
    except zipfile.BadZipFile as error:
        raise SongError("DDC returned an unexpected response") from error
    for name in archive.namelist():
        if name.lower().endswith(".sm"):
            return archive.read(name).decode("utf-8", errors="replace")
    raise SongError("DDC did not return a StepMania chart")


def ensure_chart(song_id, difficulty, ddc_url=None):
    if difficulty not in DIFFICULTIES:
        raise SongError("Unknown difficulty")
    audio = song_path(song_id)
    target = chart_path(audio, difficulty)
    with chart_lock:
        if not target.is_file():
            song = describe(audio)
            text = request_ddc_chart(audio, difficulty, song["title"], song["artist"], ddc_url)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
    return target


def sm_value(text, tag):
    match = re.search(rf"#{tag}:([^;]*);", text, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def parse_sm(text, difficulty=None):
    """Read a dance-single chart from .sm text as a sorted list of (seconds, column) steps."""
    text = re.sub(r"//[^\n]*", "", text)
    offset = float(sm_value(text, "OFFSET") or 0)
    bpms = []
    for pair in filter(None, (p.strip() for p in sm_value(text, "BPMS").split(","))):
        beat, bpm = pair.split("=")
        bpms.append((float(beat), float(bpm)))
    bpms = sorted(bpms) or [(0.0, 120.0)]
    if bpms[0][0] > 0:
        bpms.insert(0, (0.0, bpms[0][1]))

    charts = []
    for block in re.findall(r"#NOTES:([^;]*);", text, re.IGNORECASE):
        fields = [field.strip() for field in block.split(":")]
        if len(fields) >= 6 and fields[0].lower() == "dance-single":
            charts.append((fields[2], fields[5]))
    if not charts:
        raise SongError("The chart has no dance-single steps")
    notes = next((data for name, data in charts if name.lower() == (difficulty or "").lower()), charts[0][1])

    def seconds(beat):
        total, (last_beat, bpm) = 0.0, bpms[0]
        for change_beat, change_bpm in bpms[1:]:
            if change_beat >= beat:
                break
            total += (change_beat - last_beat) * 60 / bpm
            last_beat, bpm = change_beat, change_bpm
        return total + (beat - last_beat) * 60 / bpm - offset

    steps = []
    for measure_index, measure in enumerate(notes.split(",")):
        rows = [row for row in measure.split() if row]
        for row_index, row in enumerate(rows):
            # 1 = tap, 2 = hold head, 4 = roll head. Mines and hold tails are not pinches.
            columns = [column for column, char in enumerate(row[:4]) if char in "124"]
            if columns:
                steps.append((seconds(4 * measure_index + 4 * row_index / len(rows)), columns))
    return steps


def finger_notes(steps, difficulty):
    """Turn foot steps into one-finger pinches: one finger per jump, and a minimum gap between pinches."""
    gap = MIN_GAP.get(difficulty, 0.3)
    picked = []
    for time, columns in steps:
        if time < 0 or (picked and time - picked[-1][0] < gap):
            continue
        zone = columns[0] + 1
        if len(columns) > 1 and picked:
            # On a jump, prefer a finger that differs from the previous pinch.
            zone = next((c + 1 for c in columns if c + 1 != picked[-1][1]), zone)
        picked.append((time, zone))
    cue = MAX_CUE.get(difficulty, 0.8)
    notes = []
    for index, (time, zone) in enumerate(picked):
        following = picked[index + 1][0] if index + 1 < len(picked) else time + cue
        notes.append({"time": round(time, 3), "zone": zone, "end": round(min(following, time + cue), 3)})
    return notes


def chart_notes(song_id, difficulty, ddc_url=None):
    path = ensure_chart(song_id, difficulty, ddc_url)
    text = path.read_text(errors="replace")
    notes = finger_notes(parse_sm(text, difficulty), difficulty)
    if not notes:
        raise SongError("The generated chart has no steps")
    return {"id": song_id, "difficulty": difficulty, "bpm": sm_value(text, "BPMS"), "notes": notes}
