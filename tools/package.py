"""One-command packaging of the *unchanged* game into a Windows executable.

Usage::

    python tools/package.py

Produces a self-contained bundle in ``build/win_amd64/`` (the launcher is
``build/win_amd64/Hells Balls.exe``). Zip that folder and upload it to a GitHub
Release to make it downloadable.

Why this wrapper exists (documented, not magical): Panda3D's ``build_apps``
packages the game's Python code and its native dependencies correctly, but two
runtime data-sets are loaded dynamically and are *not* picked up by its static
dependency scan, so the exe crashes on launch unless they are copied in:

1. **Panda3D renderer/audio DLLs** (``libpandagl.dll``, ``libpandadx9.dll``,
   ``libp3openal_audio.dll``, ...). Panda3D loads these at runtime via
   ``load_dso``, so the scanner never sees them; without them the app fails
   with "No graphics pipe is available!".

2. **Ursina's built-in data** (``fonts/``, ``models_compressed/``, ``textures/``).
   Ursina resolves these relative to ``Path(sys.argv[0]).parent`` (the exe's
   directory), so they must sit next to the executable; without them the app
   fails on the default font and on the ``quad``/``cube``/``sphere`` models.

The script only *adds* files next to the built exe; it never touches the game.
"""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _extract(archive, member, destination, strip_prefix):
    """Extract one member, dropping ``strip_prefix``, into ``destination``."""
    rel = member[len(strip_prefix):]
    out = destination / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(member) as src, open(out, 'wb') as dst:
        dst.write(src.read())


def find_bundle_dir():
    """Locate the built app directory (contains ``Hells Balls.exe``)."""
    candidates = [p for p in (ROOT / 'build').glob('win_amd64/*.exe')
                  if 'Hells Balls' in p.name]
    if not candidates:
        candidates = [p for p in (ROOT / 'build').glob('*/Hells Balls.exe')]
    if not candidates:
        raise SystemExit('build_apps did not produce "Hells Balls.exe"')
    return candidates[0].parent


def main():
    subprocess.check_call([sys.executable, 'setup.py', 'build_apps'],
                          cwd=str(ROOT))
    bundle = find_bundle_dir()

    cache = ROOT / 'build' / '__whl_cache__'
    panda_whls = sorted(cache.rglob('panda3d-*.whl'))
    ursina_whls = sorted(cache.rglob('ursina-*.whl'))

    if not panda_whls or not ursina_whls:
        raise SystemExit('could not locate the panda3d/ursina wheels in '
                         f'{cache}')

    with zipfile.ZipFile(str(panda_whls[0])) as z:
        for member in z.namelist():
            if member.startswith('panda3d/') and member.endswith('.dll'):
                _extract(z, member, bundle, 'panda3d/')

    with zipfile.ZipFile(str(ursina_whls[0])) as z:
        for member in z.namelist():
            if member.startswith(('ursina/fonts/', 'ursina/models_compressed/',
                                  'ursina/textures/')) and not member.endswith('/'):
                _extract(z, member, bundle, 'ursina/')

    exe = bundle / 'Hells Balls.exe'
    print(f'\nDone. Bundle: {bundle}')
    print(f'Executable: {exe}')


if __name__ == '__main__':
    main()
