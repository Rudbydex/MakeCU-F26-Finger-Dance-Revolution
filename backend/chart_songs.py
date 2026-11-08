"""Pre-generate DDC charts for the starter songs so the game can play them without waiting.

Run with the DDC server up (see README):  python3 backend/chart_songs.py
"""

import argparse

import songs


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ddc-url", default=songs.DDC_URL)
parser.add_argument("--difficulty", action="append", choices=songs.DIFFICULTIES,
                    help="Repeat to chart several. Defaults to Easy, Medium, and Hard.")
parser.add_argument("--all", action="store_true", help="Include uploaded songs as well as starters")
args = parser.parse_args()

difficulties = args.difficulty or list(songs.DIFFICULTIES)
library = [song for song in songs.list_songs() if args.all or song["starter"]]
if not library:
    print(f"No songs found. Put MP3 files in {songs.SONGS}")
for song in library:
    for difficulty in difficulties:
        print(f"{song['title']} ({difficulty})... ", end="", flush=True)
        try:
            count = len(songs.chart_notes(song["id"], difficulty, args.ddc_url)["notes"])
            print(f"{count} pinches")
        except songs.SongError as error:
            print(error)
