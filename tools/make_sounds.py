"""Regenerate the generated sound effects without launching the game.

    python tools/make_sounds.py [--force] [--out assets/audio]

Every effect is synthesised by :mod:`game.audio` with the standard library, so
this is just a convenience wrapper (and a way to rebuild the folder after
deleting it).
"""
import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from game.audio import AUDIO_DIR, ensure_sounds   # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default=str(AUDIO_DIR))
    parser.add_argument('--force', action='store_true',
                        help='rewrite files that already exist')
    args = parser.parse_args()
    paths = ensure_sounds(Path(args.out), force=args.force)
    print(f'{len(paths)} sound files in {args.out}')
    for name, path in sorted(paths.items()):
        print(f'  {name:16} {path.stat().st_size:>7} bytes  {path.name}')


if __name__ == '__main__':
    main()
